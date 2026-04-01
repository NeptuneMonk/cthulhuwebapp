/**
 * PinningManager — Unified mesh cache management component.
 *
 * Storage is backed by ipfsCache.js (single IndexedDB: 'cthulhu-ipfs-pins').
 * Content you view is automatically cached and served to mesh peers.
 * Includes a live "Serving Health" indicator to verify mesh relay is working.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiDatabase, FiTrash2, FiTrendingUp, FiHardDrive, FiRefreshCw, FiActivity, FiWifi, FiWifiOff } from 'react-icons/fi';
import { toast } from 'sonner';
import { getCached, putCache, clearCache, getCacheStats, removeCached } from '@/utils/ipfsCache';

const MAX_PIN_SIZE = 500 * 1024 * 1024; // 500MB max local pin storage

/**
 * Get pinned content by CID — used by meshRelay to serve content to peers.
 * Reads from the unified ipfsCache store.
 */
export async function getPinnedContent(cid) {
  try {
    const cached = await getCached(cid);
    if (cached && cached.data) {
      const blob = cached.data instanceof Blob ? cached.data : new Blob([cached.data]);
      return await blob.arrayBuffer();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Record an access (serve) for a cached item — increments serve count.
 * Directly updates IndexedDB to preserve access_count & last_served fields.
 */
export async function recordAccess(cid) {
  try {
    const cached = await getCached(cid);
    if (cached) {
      cached.access_count = (cached.access_count || 0) + 1;
      cached.last_served = new Date().toISOString();
      // Direct IndexedDB put to preserve all fields (putCache would drop access_count)
      const DB_NAME = 'cthulhu-ipfs-pins';
      const STORE_NAME = 'ipfs-pinned';
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(cached);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {}
}

/**
 * Auto-pin content received from mesh peers.
 * Respects the MAX_PIN_SIZE limit.
 */
export async function autoPinFromMesh(cid, data, type) {
  try {
    const stats = await getCacheStats();
    const dataSize = data.byteLength || data.size || 0;
    if (stats.totalSize + dataSize > MAX_PIN_SIZE) return false;
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    await putCache(cid, blob, '', type || 'application/octet-stream');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get stats from the unified cache.
 */
export async function getPinStats() {
  const stats = await getCacheStats();
  return {
    count: stats.count,
    totalSize: stats.totalSize,
    totalServes: stats.items?.reduce((sum, i) => sum + (i.access_count || 0), 0) || 0,
    items: stats.items || [],
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

/**
 * ServingHealth — Live indicator that checks if mesh serving is operational.
 * Tests: 1) Cache has content  2) Node is online  3) WebSocket is connected
 */
function ServingHealth({ nodeStatus, cacheCount }) {
  const checks = [
    { label: 'Cache populated', ok: cacheCount > 0 },
    { label: 'Node mode active', ok: !!nodeStatus?.online },
    { label: 'Peers connected', ok: (nodeStatus?.peers || 0) > 0 },
  ];

  const allGood = checks.every(c => c.ok);
  const someGood = checks.some(c => c.ok);

  return (
    <div className="bg-gray-900/60 rounded-xl p-3" data-testid="serving-health">
      <div className="flex items-center gap-2 mb-2">
        <FiActivity size={13} className={allGood ? 'text-emerald-400' : someGood ? 'text-amber-400' : 'text-gray-600'} />
        <span className="text-xs font-bold text-gray-200">Serving Health</span>
        <div className={`ml-auto w-2 h-2 rounded-full ${allGood ? 'bg-emerald-400 animate-pulse' : someGood ? 'bg-amber-400' : 'bg-gray-600'}`} />
      </div>
      <div className="space-y-1">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            {c.ok
              ? <FiWifi size={10} className="text-emerald-400" />
              : <FiWifiOff size={10} className="text-gray-600" />
            }
            <span className={c.ok ? 'text-gray-300' : 'text-gray-600'}>{c.label}</span>
          </div>
        ))}
      </div>
      {allGood && (
        <p className="text-[10px] text-emerald-400/70 mt-2">
          Your node is actively serving cached content to peers
        </p>
      )}
      {!allGood && someGood && (
        <p className="text-[10px] text-amber-400/60 mt-2">
          Partially operational — {checks.filter(c => !c.ok).map(c => c.label.toLowerCase()).join(', ')} needed
        </p>
      )}
      {!someGood && (
        <p className="text-[10px] text-gray-600 mt-2">
          Enable Node Mode and browse content to start serving peers
        </p>
      )}
    </div>
  );
}

export default function PinningManager({ nodeMode, nodeStatus }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoPin, setAutoPin] = useState(() => localStorage.getItem('cthulhu_auto_pin') !== 'false');
  const [showItems, setShowItems] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimerRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setStats(await getPinStats()); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30s when visible
  useEffect(() => {
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleAutoPin = () => {
    const next = !autoPin;
    setAutoPin(next);
    localStorage.setItem('cthulhu_auto_pin', next ? 'true' : 'false');
    toast.success(next ? 'Auto-pinning enabled — viewed content will be cached & shared' : 'Auto-pinning disabled');
  };

  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 5000);
      return;
    }
    await clearCache();
    setConfirmClear(false);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    refresh();
    toast.success('All cached content cleared');
  };

  const handleUnpin = async (cid) => {
    await removeCached(cid);
    refresh();
  };

  const usedPct = stats ? Math.min(100, (stats.totalSize / MAX_PIN_SIZE) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="pinning-manager">
      {/* Serving Health */}
      <ServingHealth nodeStatus={nodeStatus} cacheCount={stats?.count || 0} />

      {/* Auto-pin toggle + storage bar */}
      <div className="bg-gray-800/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-sm font-bold text-gray-100">Content Pinning</h4>
            <p className="text-xs text-gray-500 mt-0.5">Cache & serve content to the mesh network</p>
          </div>
          <button
            onClick={toggleAutoPin}
            className={`relative w-12 h-7 rounded-full transition-colors ${autoPin ? 'bg-cyan-500' : 'bg-gray-700'}`}
            data-testid="auto-pin-toggle"
          >
            <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${autoPin ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {autoPin && (
          <p className="text-[10px] text-cyan-400/70 mb-3">
            Content you view is automatically pinned and served to peers
          </p>
        )}

        {/* Storage bar */}
        <div className="mb-4">
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>{loading ? '...' : `${stats?.count || 0} items cached`}</span>
            <span>{loading ? '...' : `${formatBytes(stats?.totalSize || 0)} / ${formatBytes(MAX_PIN_SIZE)}`}</span>
          </div>
          <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all" style={{ width: `${usedPct}%` }} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-gray-900/60 rounded-lg p-2 text-center">
            <FiHardDrive size={12} className="mx-auto text-cyan-400 mb-1" />
            <p className="text-sm font-bold text-gray-100">{stats?.count || 0}</p>
            <p className="text-[9px] text-gray-500">Pinned</p>
          </div>
          <div className="bg-gray-900/60 rounded-lg p-2 text-center">
            <FiTrendingUp size={12} className="mx-auto text-emerald-400 mb-1" />
            <p className="text-sm font-bold text-gray-100">{stats?.totalServes || 0}</p>
            <p className="text-[9px] text-gray-500">Serves</p>
          </div>
          <div className="bg-gray-900/60 rounded-lg p-2 text-center">
            <FiDatabase size={12} className="mx-auto text-amber-400 mb-1" />
            <p className="text-sm font-bold text-gray-100">{formatBytes(stats?.totalSize || 0)}</p>
            <p className="text-[9px] text-gray-500">Stored</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={() => setShowItems(!showItems)} className="flex-1 text-[10px] py-1.5 rounded bg-gray-900/60 text-gray-400 hover:text-gray-200 transition-colors" data-testid="pinning-show-items">
            {showItems ? 'Hide Items' : 'Show Items'}
          </button>
          <button onClick={handleClearAll} className={`text-[10px] py-1.5 px-3 rounded transition-colors ${
            confirmClear
              ? 'bg-red-500/30 text-red-300 border border-red-500/40 animate-pulse'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
          }`} data-testid="pinning-clear-all">
            <FiTrash2 size={10} className="inline mr-1" />{confirmClear ? 'Confirm Purge?' : 'Purge Cache'}
          </button>
          <button onClick={refresh} className="text-[10px] py-1.5 px-2 rounded bg-gray-900/60 text-gray-500 hover:text-gray-300 transition-colors" data-testid="pinning-refresh">
            <FiRefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Item list (collapsible) */}
        {showItems && stats?.items && (
          <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
            {stats.items.length === 0 ? (
              <p className="text-[10px] text-gray-600 text-center py-3">No cached content yet — browse some objects!</p>
            ) : stats.items.map(item => (
              <div key={item.cid} className="flex items-center gap-2 bg-gray-900/40 rounded px-2 py-1.5">
                <span className="text-[9px] font-mono text-gray-500 flex-1 truncate">{item.cid}</span>
                <span className="text-[9px] text-gray-600">{formatBytes(item.size)}</span>
                <button onClick={() => handleUnpin(item.cid)} className="text-red-500/60 hover:text-red-400" data-testid={`unpin-${item.cid?.slice(0, 8)}`}>
                  <FiTrash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
