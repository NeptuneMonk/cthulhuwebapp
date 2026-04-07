import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX, FiUser, FiInfo, FiHardDrive, FiArrowRight, FiArrowLeft, FiKey,
  FiDatabase, FiTrash2, FiRefreshCw, FiCheck, FiRadio, FiGlobe, FiAlertTriangle,
  FiDollarSign, FiCopy, FiSlash, FiDroplet, FiImage, FiSend, FiAlertCircle, FiBook, FiPhone,
  FiServer, FiBell, FiEye, FiEyeOff, FiUploadCloud, FiClock
} from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { clearDecryptCache } from '@/utils/dmDb';
import { getWalletsForNetwork } from '@/utils/walletCrypto';
import { useFollows } from '@/hooks/useFollows';
import { THEMES, WALLPAPERS, useTheme } from '@/hooks/useTheme';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { buildProfileTransaction } from '@/utils/p2fk';
import FeePicker from '@/components/FeePicker';
import { buildAndBroadcast } from '@/utils/txBuilder';
import { CTHULHU_SVG } from '@/components/CthulhuLogo';
import CallSettings from '@/components/CallSettings';
import { useMeshRelay } from '@/hooks/useMeshRelay';
import MeshVisualizer from '@/components/MeshVisualizer';
import PinningManager from '@/components/PinningManager';
import { isMuted, toggleMute, playNotificationSound } from '@/utils/notificationSound';
import { estimateSECCost, secBackupToChain, secRestoreFromTxid, getLastBackup, getBackupHistory, parsePointer } from '@/utils/secBackup';

import { ProfileThumb } from '@/components/ProfileThumb';
import { toast } from 'sonner';

const SETTINGS_API = process.env.REACT_APP_BACKEND_URL;

const IS_STANDALONE = process.env.REACT_APP_STANDALONE === 'true' || !process.env.REACT_APP_BACKEND_URL;

function IpfsNodeStatus() {
  const [online, setOnline] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [info, setInfo] = useState('');

  const [restartSteps, setRestartSteps] = useState(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${SETTINGS_API}/api/ipfs/status`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      setOnline(data.online === true);
      if (data.online && data.agent) setInfo(data.agent);
      if (data.online) setRestartSteps(null);
    } catch { setOnline(false); }
  }, []);

  useEffect(() => { check(); const t = setInterval(check, 20000); return () => clearInterval(t); }, [check]);

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    setRestartSteps(null);
    try {
      const restartRes = await fetch(`${SETTINGS_API}/api/ipfs/restart`, { method: 'POST' });
      const restartData = await restartRes.json().catch(() => ({}));
      if (restartData.online) {
        setOnline(true);
        if (restartData.agent) setInfo(restartData.agent);
        setRestarting(false);
        return;
      }
      if (restartData.steps) setRestartSteps(restartData.steps);
      // Poll for readiness
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const res = await fetch(`${SETTINGS_API}/api/ipfs/status`, { signal: AbortSignal.timeout(4000) });
          const d = await res.json();
          if (d.online) { setOnline(true); if (d.agent) setInfo(d.agent); setRestartSteps(null); setRestarting(false); return; }
        } catch {}
      }
      setOnline(false);
    } catch { setOnline(false); }
    setRestarting(false);
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4" data-testid="ipfs-node-status">
      <p className="text-xs text-gray-500 mb-2">{IS_STANDALONE ? 'Local Kubo IPFS Node' : 'IPFS Node'}</p>
      <div className="flex items-center gap-2">
        {restarting ? (
          <FiServer size={12} className="text-amber-400 animate-spin" />
        ) : (
          <div className={`w-2 h-2 rounded-full ${
            online === null ? 'bg-gray-500' : online ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'
          }`} />
        )}
        <span className={`text-sm ${online ? 'text-gray-300' : online === false ? 'text-red-400' : 'text-gray-500'}`}>
          {restarting ? 'Restarting Kubo daemon...'
            : online === null ? 'Checking...'
            : online ? `Kubo daemon active${info ? ` (${info})` : ''}`
            : IS_STANDALONE ? 'Kubo not detected — make sure it is running on localhost:5001' : 'IPFS daemon offline'}
        </span>
        {online === false && !restarting && (
          <button onClick={handleRestart}
            className="ml-auto text-[10px] font-mono text-emerald-400 hover:text-emerald-300 border border-emerald-700/30 px-2 py-0.5 rounded transition-colors"
            data-testid="ipfs-restart-btn">
            {IS_STANDALONE ? 'CHECK' : 'RESTART'}
          </button>
        )}
      </div>
      {restartSteps && !online && (
        <div className="mt-2 bg-gray-900/50 rounded p-2 text-[10px] font-mono text-gray-500 space-y-0.5 max-h-32 overflow-y-auto" data-testid="ipfs-restart-steps">
          {restartSteps.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      )}
    </div>
  );
}

/** Connect Your Node — Bitcoin Core RPC configuration */
function ConnectNodeSection({ network }) {
  const [status, setStatus] = useState(null); // { connected, configured, chain, blocks, ... }
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);
  const [configuring, setConfiguring] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [rpcHost, setRpcHost] = useState('127.0.0.1');
  const [rpcPort, setRpcPort] = useState(network?.includes('mainnet') ? '8332' : '18332');
  const [rpcUser, setRpcUser] = useState('');
  const [rpcPass, setRpcPass] = useState('');
  const [error, setError] = useState('');

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SETTINGS_API}/api/p2fk-local/node/status`);
      const data = await res.json();
      setStatus(data);
    } catch { setStatus({ connected: false, configured: false }); }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const res = await fetch(`${SETTINGS_API}/api/p2fk-local/node/detect`);
      const data = await res.json();
      setDetected(data.detected || []);
      if (data.count === 0) setError('No local Bitcoin Core node detected on standard ports');
    } catch { setError('Detection failed'); }
    setDetecting(false);
  };

  const handleConnect = async (url) => {
    setConfiguring(true);
    setError('');
    try {
      const res = await fetch(`${SETTINGS_API}/api/p2fk-local/node/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc_url: url }),
      });
      const data = await res.json();
      if (data.connected) {
        setStatus(data);
        setShowForm(false);
      } else {
        setError(data.error || 'Connection failed — check credentials');
      }
    } catch { setError('Connection failed'); }
    setConfiguring(false);
  };

  const handleDisconnect = async () => {
    try {
      await fetch(`${SETTINGS_API}/api/p2fk-local/node/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc_url: null }),
      });
      setStatus({ connected: false, configured: false });
    } catch {}
  };

  const handleFormSubmit = () => {
    if (!rpcUser || !rpcPass) { setError('Username and password required'); return; }
    const url = `http://${rpcUser}:${rpcPass}@${rpcHost}:${rpcPort}`;
    handleConnect(url);
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4" data-testid="connect-node-section">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">Connect Your Node</p>
        {status?.connected && (
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">CONNECTED</span>
        )}
      </div>

      {status?.connected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-gray-300">
              Bitcoin Core ({status.chain || 'unknown'})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-900/50 rounded px-2 py-1.5">
              <span className="text-gray-500">Blocks:</span>{' '}
              <span className="text-gray-300 font-mono">{status.blocks?.toLocaleString()}</span>
            </div>
            <div className="bg-gray-900/50 rounded px-2 py-1.5">
              <span className="text-gray-500">Sync:</span>{' '}
              <span className="text-gray-300 font-mono">{((status.verification_progress || 0) * 100).toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Transactions are fetched directly from your node instead of public explorers. Your node acts as the source of truth.
          </p>
          <button
            onClick={handleDisconnect}
            className="w-full text-xs text-red-400 hover:text-red-300 border border-red-800/30 rounded-lg py-1.5 transition-colors"
            data-testid="disconnect-node-btn"
          >
            Disconnect Node
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Connect a local Bitcoin Core node for maximum sovereignty. Your node becomes the primary data source instead of public APIs.
          </p>

          <div className="flex gap-2">
            <button
              onClick={handleDetect}
              disabled={detecting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700/50 text-xs text-gray-300 transition-colors disabled:opacity-40"
              data-testid="detect-node-btn"
            >
              <FiRefreshCw size={12} className={detecting ? 'animate-spin' : ''} />
              {detecting ? 'Scanning...' : 'Auto-Detect'}
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-700/50 text-xs text-gray-300 transition-colors"
              data-testid="manual-connect-btn"
            >
              <FiServer size={12} />
              Manual Setup
            </button>
          </div>

          {/* Auto-detected nodes */}
          {detected && detected.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-gray-500 font-medium">Detected nodes:</p>
              {detected.map((node, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-900/50 rounded-lg p-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${node.accessible ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">{node.label}</p>
                    <p className="text-[10px] text-gray-500 font-mono">{node.url}</p>
                  </div>
                  {node.auth_required && !node.accessible ? (
                    <button
                      onClick={() => { setShowForm(true); setRpcPort(node.url.split(':').pop()); }}
                      className="text-[10px] text-amber-400 border border-amber-700/30 px-2 py-0.5 rounded"
                    >
                      Add Credentials
                    </button>
                  ) : node.accessible ? (
                    <button
                      onClick={() => handleConnect(node.url)}
                      disabled={configuring}
                      className="text-[10px] text-emerald-400 border border-emerald-700/30 px-2 py-0.5 rounded"
                      data-testid={`connect-detected-${i}`}
                    >
                      Connect
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Manual form */}
          {showForm && (
            <div className="bg-gray-900/50 border border-gray-700/30 rounded-lg p-3 space-y-2">
              <p className="text-[10px] text-gray-500 font-medium">Bitcoin Core RPC Connection</p>

              {/* Cloud-hosted warning */}
              {(rpcHost === '127.0.0.1' || rpcHost === 'localhost') && (
                <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-2.5">
                  <p className="text-[10px] text-amber-400 leading-relaxed">
                    <span className="font-bold">Note:</span> This app is cloud-hosted. <code className="font-mono bg-amber-900/30 px-1 rounded">127.0.0.1</code> points to the server, not your computer. To connect your local Bitcoin Core node, use the <strong>Cthulhu desktop app</strong> or expose your node via port forwarding / tunnel.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] text-gray-600 block mb-0.5">Host</label>
                  <input
                    value={rpcHost} onChange={e => setRpcHost(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                    placeholder="127.0.0.1"
                    data-testid="node-rpc-host"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 block mb-0.5">Port</label>
                  <input
                    value={rpcPort} onChange={e => setRpcPort(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                    placeholder="18332"
                    data-testid="node-rpc-port"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-600 block mb-0.5">RPC User</label>
                  <input
                    value={rpcUser} onChange={e => setRpcUser(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                    placeholder="rpcuser"
                    data-testid="node-rpc-user"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 block mb-0.5">RPC Password</label>
                  <input
                    type="password"
                    value={rpcPass} onChange={e => setRpcPass(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-purple-500"
                    placeholder="rpcpassword"
                    data-testid="node-rpc-pass"
                  />
                </div>
              </div>
              <p className="text-[10px] text-gray-600 leading-relaxed">
                Find these in your <span className="font-mono text-gray-500">bitcoin.conf</span> file. Usually at <span className="font-mono text-gray-500">~/.bitcoin/bitcoin.conf</span> (Linux) or <span className="font-mono text-gray-500">%APPDATA%\Bitcoin\bitcoin.conf</span> (Windows).
              </p>
              <button
                onClick={handleFormSubmit}
                disabled={configuring || !rpcUser || !rpcPass}
                className="w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs text-white font-medium transition-colors"
                data-testid="connect-node-submit"
              >
                {configuring ? 'Connecting...' : 'Connect to Node'}
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-2.5">
              <p className="text-[10px] text-red-400 leading-relaxed" data-testid="node-error">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** IPFS Cache Manager — view/clear the local IndexedDB IPFS content cache */
function IpfsCacheManager() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [cacheEnabled, setCacheEnabled] = useState(isCacheEnabled());
  const [showItems, setShowItems] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const { getCacheStats } = await import('@/utils/ipfsCache');
      const s = await getCacheStats();
      setStats(s);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleClear = async () => {
    setClearing(true);
    try {
      const { clearCache } = await import('@/utils/ipfsCache');
      await clearCache();
      setStats({ count: 0, totalSize: 0, items: [] });
    } catch {}
    setClearing(false);
  };

  const handleToggle = (val) => {
    setCacheEnabled(val);
    setCacheEnabledPref(val);
  };

  const handleRemoveItem = async (cid) => {
    try {
      const { removeCached } = await import('@/utils/ipfsCache');
      await removeCached(cid);
      loadStats();
    } catch {}
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-4" data-testid="ipfs-cache-manager">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-200">IPFS Content Cache</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Content you browse is cached locally, making you a pinning node for the network.
          </p>
        </div>
        <button
          onClick={() => handleToggle(!cacheEnabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${cacheEnabled ? 'bg-emerald-600' : 'bg-gray-700'}`}
          data-testid="ipfs-cache-toggle"
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${cacheEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Cache Stats */}
      {loading ? (
        <div className="text-xs text-gray-600 animate-pulse">Loading cache stats...</div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-900/50 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">Cached Items</p>
            <p className="text-lg font-bold text-gray-200">{stats.count}</p>
          </div>
          <div className="bg-gray-900/50 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">Total Size</p>
            <p className="text-lg font-bold text-gray-200">{formatBytes(stats.totalSize)}</p>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleClear}
          disabled={clearing || !stats?.count}
          className="flex items-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs disabled:opacity-40 border border-red-800/50 transition-colors"
          data-testid="ipfs-cache-clear"
        >
          <FiTrash2 size={12} />
          {clearing ? 'Clearing...' : 'Clear All Cache'}
        </button>
        {stats?.count > 0 && (
          <button
            onClick={() => setShowItems(!showItems)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 rounded-lg text-xs border border-gray-700/50 transition-colors"
            data-testid="ipfs-cache-browse"
          >
            <FiDatabase size={12} />
            {showItems ? 'Hide Items' : 'Browse Cache'}
          </button>
        )}
      </div>

      {/* Browseable cache items */}
      {showItems && stats?.items?.length > 0 && (
        <div className="bg-gray-900/40 rounded-lg border border-gray-800/50 max-h-64 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="border-b border-gray-800/50">
                <th className="text-left py-1.5 px-2 text-gray-500 font-medium">CID</th>
                <th className="text-left py-1.5 px-2 text-gray-500 font-medium">File</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Size</th>
                <th className="text-right py-1.5 px-2 text-gray-500 font-medium">Cached</th>
                <th className="py-1.5 px-1"></th>
              </tr>
            </thead>
            <tbody>
              {stats.items.slice(0, 50).map((item, i) => (
                <tr key={i} className="border-b border-gray-800/20 hover:bg-gray-800/30">
                  <td className="py-1 px-2 text-gray-400 font-mono truncate max-w-[120px]" title={item.cid}>{item.cid?.slice(0, 12)}...</td>
                  <td className="py-1 px-2 text-gray-500 truncate max-w-[100px]">{item.filename || '-'}</td>
                  <td className="py-1 px-2 text-right text-gray-500">{formatBytes(item.size || 0)}</td>
                  <td className="py-1 px-2 text-right text-gray-600">{item.cachedAt ? new Date(item.cachedAt).toLocaleDateString() : '-'}</td>
                  <td className="py-1 px-1">
                    <button
                      onClick={() => handleRemoveItem(item.cid)}
                      className="text-red-500/50 hover:text-red-400 p-0.5"
                      title="Remove from cache"
                    >
                      <FiTrash2 size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.items.length > 50 && (
            <p className="text-center text-[10px] text-gray-600 py-1">...and {stats.items.length - 50} more</p>
          )}
        </div>
      )}
    </div>
  );
}



function NotificationsTab() {
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    const handler = (e) => setMutedState(e.detail?.muted ?? isMuted());
    window.addEventListener('cthulhu-mute-change', handler);
    return () => window.removeEventListener('cthulhu-mute-change', handler);
  }, []);

  const handleToggle = () => {
    toggleMute();
    setMutedState(isMuted());
  };

  const handleTest = () => {
    const wasMuted = isMuted();
    if (wasMuted) toggleMute();
    playNotificationSound();
    if (wasMuted) setTimeout(() => toggleMute(), 300);
  };

  return (
    <div className="space-y-4" data-testid="settings-notifications-tab">
      {/* Mute toggle */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-200">Message Sounds</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Play a ping when new messages arrive
            </p>
          </div>
          <button
            onClick={handleToggle}
            className={`relative w-11 h-6 rounded-full transition-colors ${muted ? 'bg-gray-700' : 'bg-emerald-500'}`}
            data-testid="notif-mute-toggle"
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${muted ? 'left-0.5' : 'left-[22px]'}`} />
          </button>
        </div>
      </div>

      {/* Test sound */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-200">Test Sound</p>
            <p className="text-xs text-gray-500 mt-0.5">Preview the notification ping</p>
          </div>
          <button
            onClick={handleTest}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: 'var(--c-accentMuted)', color: 'var(--c-accent)' }}
            data-testid="notif-test-sound-btn"
          >
            Play
          </button>
        </div>
      </div>

      {/* Gossip notifications info */}
      <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
        <p className="text-sm font-medium text-gray-200 mb-2">Mesh Gossip Notifications</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Notifications are delivered peer-to-peer through the mesh network.
          When you're online, connected mesh nodes relay notification hints
          directly to your browser — no central server needed.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed mt-2">
          When you're offline, notification hints are temporarily cached by
          relay nodes and delivered when you reconnect.
        </p>
      </div>
    </div>
  );
}

const VERSION = 'v5.5.4-beta';

const MENU_ITEMS = [
  { id: 'notifications', label: 'Notifications', subtitle: 'Sounds, Mute, Alerts', icon: FiBell, color: '#F43F5E' },
  { id: 'appearance', label: 'Chat Settings', subtitle: 'Wallpaper, Theme, Brightness', icon: FiDroplet, color: '#F97316' },
  { id: 'network', label: 'Network', subtitle: 'Switch Networks, Connect Node', icon: FiGlobe, color: '#22C55E' },
  { id: 'walkie', label: 'Walkie Talkie', subtitle: 'On-chain Voice Broadcast', icon: FiRadio, color: '#EF4444' },
  { id: 'phone', label: 'Phone Settings', subtitle: 'Incoming Calls, Answering Machine', icon: FiPhone, color: '#10B981' },
  { id: 'treasury', label: 'Treasury', subtitle: 'Platform Fees, Address', icon: FiDollarSign, color: '#14B8A6' },
  { id: 'ipfs', label: 'Data and Storage', subtitle: 'IPFS Cache, Backups', icon: FiHardDrive, color: '#6366F1' },
  { id: 'mesh', label: 'Mesh Relay', subtitle: 'P2P Node, Network Stats', icon: FiServer, color: '#0EA5E9' },
  { id: 'blocked', label: 'Privacy', subtitle: 'Blocked Users', icon: FiSlash, color: '#A855F7' },
  { id: 'paywall', label: 'Report / Admin', subtitle: 'Report Content', icon: FiAlertCircle, color: '#F59E0B', hostedOnly: true },
  { id: 'wiki', label: 'Knowledge Base', subtitle: 'SUP Protocol, Tutorials', icon: FiBook, color: '#8B5CF6', isLink: true },
  { id: 'about', label: 'About', subtitle: 'Version, Credits', icon: FiInfo, color: '#6B7280' },
];

const VISIBLE_MENU_ITEMS = IS_STANDALONE
  ? MENU_ITEMS.filter(item => !item.hostedOnly)
  : MENU_ITEMS;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Cache settings stored in localStorage
const CACHE_ENABLED_KEY = 'cthulhu_ipfs_cache_enabled';
function isCacheEnabled() {
  const v = localStorage.getItem(CACHE_ENABLED_KEY);
  return v === null ? true : v === 'true';
}
function setCacheEnabledPref(val) {
  localStorage.setItem(CACHE_ENABLED_KEY, val ? 'true' : 'false');
}

// Export for use by caching hooks
export { isCacheEnabled, setCacheEnabledPref, VERSION };

/** Wallet Manager — shows all wallets on the current network with switch/remove */
function WalletManager({ user, network, getLocalWallets, switchActiveWallet, removeWallet, resetNetworkWallet }) {
  const [wallets, setWallets] = useState([]);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchTarget, setSwitchTarget] = useState(null);
  const [switchError, setSwitchError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { setWallets(getLocalWallets()); }, [getLocalWallets, network, user?.address]);

  if (wallets.length <= 1 && !user?.address) return null;

  const activeAddr = user?.address;

  const handleSwitch = async () => {
    if (!switchTarget || !switchPassword) return;
    setSwitching(true); setSwitchError('');
    try {
      await switchActiveWallet(switchTarget, switchPassword);
      setSwitchTarget(null); setSwitchPassword('');
      setWallets(getLocalWallets());
    } catch (err) { setSwitchError(err.message); }
    finally { setSwitching(false); }
  };

  const handleRemove = async (addr) => {
    await removeWallet(network, addr);
    setConfirmRemove(null);
    setWallets(getLocalWallets());
  };

  const handleReset = async () => {
    await resetNetworkWallet(network);
    setConfirmReset(false);
    setWallets([]);
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="wallet-manager">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiKey size={14} className="text-purple-400" />
          <span className="text-sm font-medium text-gray-200">Wallets ({wallets.length})</span>
        </div>
        <span className="text-[10px] text-gray-600 uppercase">{network}</span>
      </div>

      {wallets.map((w) => {
        const isActive = w.address === activeAddr;
        return (
          <div
            key={w.address}
            className={`rounded-lg p-3 border transition-colors ${isActive ? 'bg-purple-900/15 border-purple-700/30' : 'bg-gray-900/50 border-gray-800/50'}`}
            data-testid={`wallet-item-${w.address?.slice(0, 8)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-gray-400 font-mono truncate">{w.address?.slice(0, 16)}...{w.address?.slice(-6)}</code>
                  {isActive && (
                    <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-purple-500/20 text-purple-400 rounded tracking-wider">Active</span>
                  )}
                </div>
                {w.label && <p className="text-[10px] text-gray-500 mt-0.5">{w.label}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!isActive && (
                  <button
                    onClick={() => { setSwitchTarget(w.address); setSwitchPassword(''); setSwitchError(''); }}
                    className="px-2 py-1 text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors"
                    data-testid={`switch-wallet-${w.address?.slice(0, 8)}`}
                  >
                    Switch
                  </button>
                )}
                <button
                  onClick={() => setConfirmRemove(w.address)}
                  className="p-1 text-gray-600 hover:text-red-400 rounded transition-colors"
                  title="Remove wallet"
                  data-testid={`remove-wallet-${w.address?.slice(0, 8)}`}
                >
                  <FiTrash2 size={12} />
                </button>
              </div>
            </div>

            {/* Switch password prompt */}
            {switchTarget === w.address && (
              <div className="mt-2 pt-2 border-t border-gray-800 space-y-2">
                <input
                  type="password"
                  value={switchPassword}
                  onChange={e => { setSwitchPassword(e.target.value); setSwitchError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSwitch()}
                  placeholder="Enter password to switch"
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                  autoFocus
                  data-testid="switch-wallet-password"
                />
                {switchError && <p className="text-[10px] text-red-400">{switchError}</p>}
                <div className="flex gap-1">
                  <button onClick={() => setSwitchTarget(null)} className="px-2 py-1 text-[10px] bg-gray-800 text-gray-500 rounded">Cancel</button>
                  <button
                    onClick={handleSwitch}
                    disabled={!switchPassword || switching}
                    className="px-2 py-1 text-[10px] bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded"
                    data-testid="switch-wallet-confirm"
                  >
                    {switching ? 'Switching...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {/* Remove confirmation */}
            {confirmRemove === w.address && (
              <div className="mt-2 pt-2 border-t border-red-900/30 space-y-2">
                <div className="flex gap-2 p-2 bg-red-900/20 rounded">
                  <FiAlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-300">This will permanently remove this key from this device. Make sure you have backed up the WIF!</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setConfirmRemove(null)} className="px-2 py-1 text-[10px] bg-gray-800 text-gray-500 rounded">Cancel</button>
                  <button
                    onClick={() => handleRemove(w.address)}
                    className="px-2 py-1 text-[10px] bg-red-600 hover:bg-red-500 text-white rounded"
                    data-testid="remove-wallet-confirm"
                  >
                    Remove Forever
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Reset all wallets for this network */}
      {wallets.length > 0 && (
        <div className="pt-2 border-t border-gray-800/50">
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
              data-testid="reset-network-wallets"
            >
              Reset all wallets for {network}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 p-2 bg-red-900/20 border border-red-700/30 rounded">
                <FiAlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-300">This will remove ALL encrypted keys for {network} from this device. This cannot be undone.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmReset(false)} className="px-3 py-1.5 text-[10px] bg-gray-800 text-gray-400 rounded">Cancel</button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 text-[10px] bg-red-600 hover:bg-red-500 text-white rounded"
                  data-testid="reset-wallets-confirm"
                >
                  Reset All Wallets
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** Wallpaper object thumbnail with IPFS fallback */
function WallpaperObjectThumb({ obj, imgUrl, fallbackUrl, isSelected, onSelect }) {
  const [src, setSrc] = useState(imgUrl);
  const [triedFallback, setTriedFallback] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <button
      onClick={() => onSelect(src)}
      className={`relative aspect-square rounded-lg border overflow-hidden transition-all ${
        isSelected ? 'border-white/40 ring-1 ring-white/20' : 'border-gray-800 hover:border-gray-600'
      }`}
      title={obj.name || ''}
      data-testid={`wp-object-${obj.txid?.slice(0, 8)}`}
    >
      {!failed ? (
        <img
          src={src}
          alt={obj.name || ''}
          className="w-full h-full object-cover"
          onError={() => {
            if (!triedFallback && fallbackUrl && fallbackUrl !== src) {
              setTriedFallback(true);
              setSrc(fallbackUrl);
            } else {
              setFailed(true);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-600 text-[9px] text-center p-1 leading-tight">
          {obj.name?.slice(0, 12) || 'No preview'}
        </div>
      )}
      {isSelected && <FiCheck size={10} className="absolute top-0.5 right-0.5 text-white drop-shadow-lg" />}
    </button>
  );
}


export default function SettingsModal({ fullPage, onClose, profileImage, network = 'btc-testnet', mintedOnNetwork = false, authProfileUrn, blockList, claimProfile, myAddress, onNetworkChange, onRefreshProfile }) {
  const navigate = useNavigate();
  const { user, isConnected, logout, importWallet, importWalletForNetwork, unlockWallet, changePassword, renameUrn, wif, isWalletUnlocked, generateWalletForNetwork, switchNetworkWithPassword, activateStoredWalletForNetwork, switchNetwork, switchActiveWallet, removeWallet, resetNetworkWallet, getLocalWallets } = useAuth();
  const { disconnectWallet } = useWallet();
  const { follows } = useFollows(network, user?.address);
  const { nodeMode, toggleNodeMode, nodeStatus, meshStats } = useMeshRelay(network);
  // meshRelay hook is also called at Layout level (App.js) for always-on connectivity.
  // This instance provides the toggle controls and reads the same global state.
  const [tab, setTab] = useState('menu');
  const [vizExpanded, setVizExpanded] = useState(false);

  // WIF import state
  const [showWifImport, setShowWifImport] = useState(false);
  const [importWifValue, setImportWifValue] = useState('');
  const [importPasswordValue, setImportPasswordValue] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importingWif, setImportingWif] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);

  // Change password state
  const [showChangePw, setShowChangePw] = useState(false);
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpConfirm, setCpConfirm] = useState('');
  const [cpLoading, setCpLoading] = useState(false);
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState(false);
  const [cpShowPw, setCpShowPw] = useState(false);
  // Rename URN state
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [renameSuccess, setRenameSuccess] = useState(false);

  // Encryption key status — fetch from network
  const [pkxPublishing, setPkxPublishing] = useState(false);
  const [pkxPassword, setPkxPassword] = useState('');
  const [pkxError, setPkxError] = useState('');
  const [pkxSuccess, setPkxSuccess] = useState(false);
  const [showPkxPrompt, setShowPkxPrompt] = useState(false);
  const [myKeys, setMyKeys] = useState(null); // { has_keys, pkx, pky }

  // Network switch state
  const [pendingNetwork, setPendingNetwork] = useState(null);
  const [netSwitchPassword, setNetSwitchPassword] = useState('');
  const [netSwitchError, setNetSwitchError] = useState('');
  const [netSwitchLoading, setNetSwitchLoading] = useState(false);
  const [netSwitchMode, setNetSwitchMode] = useState('create'); // 'create' | 'import' | 'select'
  const [netSwitchImportWif, setNetSwitchImportWif] = useState('');
  const [netSwitchSelectedAddr, setNetSwitchSelectedAddr] = useState('');

  // Treasury state
  const [treasuryData, setTreasuryData] = useState(null);
  const [treasuryLoading, setTreasuryLoading] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const { themeId, wallpaperId, customWallpaper, brightMode, setTheme, setWallpaper, setCustomWallpaper, setBrightMode } = useTheme();
  const [ownedObjects, setOwnedObjects] = useState([]);

  // Claim profile state
  const [claimURN, setClaimURN] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState('');

  // Reset custom wallpaper if user is not signed in
  useEffect(() => {
    if (!user?.address && wallpaperId === 'custom') {
      setWallpaper('none');
      setCustomWallpaper('');
    }
  }, [user?.address, wallpaperId, setWallpaper, setCustomWallpaper]);

  const loadTreasury = useCallback(async () => {
    setTreasuryLoading(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/treasury/info?network=${network}`);
      if (res.ok) setTreasuryData(await res.json());
    } catch {}
    setTreasuryLoading(false);
  }, [network]);

  useEffect(() => {
    if (tab === 'treasury') loadTreasury();
  }, [tab, loadTreasury]);

  // Refresh profile resolution when settings page mounts or wallet/profile section is viewed
  useEffect(() => {
    if (onRefreshProfile) onRefreshProfile();
  }, [onRefreshProfile]);

  // Fetch user's own encryption key status from the network
  useEffect(() => {
    if (!user?.address || !isConnected) { setMyKeys(null); return; }
    const API = process.env.REACT_APP_BACKEND_URL;
    fetch(`${API}/api/profile/keys/${user.address}?network=${network}`)
      .then(r => r.json())
      .then(d => setMyKeys({ has_keys: d.has_keys, pkx: d.pkx || '', pky: d.pky || '' }))
      .catch(() => setMyKeys(null));
  }, [user?.address, isConnected, network, pkxSuccess]);

  // Fetch owned objects for wallpaper selector — only images
  useEffect(() => {
    if (tab !== 'appearance' || !user?.address) return;
    const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const isImageUrl = (url) => {
      if (!url) return false;
      // Normalize backslashes to forward slashes (SUP Windows paths)
      const lower = url.replace(/\\/g, '/').toLowerCase().split('?')[0];
      return IMAGE_EXTS.some(ext => lower.endsWith(ext));
    };
    const hasImage = (val) => {
      if (!val) return false;
      if (isImageUrl(val)) return true;
      if (val.startsWith('IPFS:') || val.startsWith('Qm')) return true;
      return false;
    };
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/objects/owned/${user.address}?network=${network}&limit=100`)
      .then(r => r.ok ? r.json() : { objects: [] })
      .then(d => {
        const objs = (d.objects || []).filter(o => {
          // Check image, then uri, then urn for any image-like reference
          return hasImage(o.image) || hasImage(o.uri) || (o.urn && o.urn.startsWith('IPFS:') && isImageUrl(o.urn));
        }).slice(0, 30);
        setOwnedObjects(objs);
      })
      .catch(() => {});
  }, [tab, user?.address, network]);

  const [clearingDecrypt, setClearingDecrypt] = useState(false);
  const handleClearDecryptCache = async () => {
    setClearingDecrypt(true);
    await clearDecryptCache();
    setClearingDecrypt(false);
  };

  // SEC Backup state
  const [backupFetching, setBackupFetching] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [lastBackupSave, setLastBackupSave] = useState(() => getLastBackup());
  const [signingOut, setSigningOut] = useState(false);
  const [secHistory, setSecHistory] = useState(() => getBackupHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [backupCostEstimate, setBackupCostEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [restoreTxid, setRestoreTxid] = useState('');

  // Step 1: Estimate cost before saving
  const handleEstimateBackup = async () => {
    setEstimating(true);
    setBackupCostEstimate(null);
    setBackupResult(null);
    try {
      if (!wif || !user?.address) {
        toast.error('Unlock your wallet first');
        setEstimating(false);
        return;
      }
      const est = await estimateSECCost(wif);
      setBackupCostEstimate(est);
    } catch (err) {
      toast.error('Failed to estimate: ' + (err.message || '').slice(0, 80));
    }
    setEstimating(false);
  };

  // Step 2: Confirm and broadcast SEC backup
  const handleConfirmBackup = async () => {
    setBackupSaving(true);
    setBackupResult(null);
    try {
      const result = await secBackupToChain(wif, network);
      toast.success(`SEC backup etched: ${result.pointer}`);
      setLastBackupSave(result);
      setSecHistory(getBackupHistory());
      setBackupCostEstimate(null);
      return result;
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('[SEC] Save error:', msg, err);
      if (msg.includes('No UTXOs')) {
        toast.error('No testnet balance. Fund your testnet wallet first.');
      } else {
        toast.error(`SEC backup failed: ${msg.slice(0, 120)}`);
      }
    } finally {
      setBackupSaving(false);
    }
  };

  // Restore from TXID
  const handleRestoreFromTxid = async (txid, txNetwork) => {
    if (!txid || txid.length < 64) {
      toast.error('Enter a valid 64-character transaction ID');
      return;
    }
    setBackupFetching(true);
    setBackupResult(null);
    try {
      const currentWif = wif;
      if (!currentWif) {
        setBackupResult({ error: 'Wallet not unlocked. Enter your password first.' });
        setBackupFetching(false);
        return;
      }
      const result = await secRestoreFromTxid(currentWif, txid.trim(), txNetwork || 'btc-testnet');
      const parts = [];
      for (const [net, counts] of Object.entries(result.restored || {})) {
        for (const [key, val] of Object.entries(counts)) {
          if (key === 'follows') parts.push(`${val} follow${val > 1 ? 's' : ''}`);
          else if (key === 'tetheredRooms') parts.push(`${val} room${val > 1 ? 's' : ''}`);
          else if (key === 'pinnedFriends') parts.push(`${val} pinned friend${val > 1 ? 's' : ''}`);
          else if (key === 'profileUrn') parts.push('profile URN');
          else if (key === 'objectAddresses') parts.push(`${val} object addr${val > 1 ? 's' : ''}`);
          else if (key === 'favorites') parts.push(`${val} favorite${val > 1 ? 's' : ''}`);
          else if (key === 'playlists') parts.push(`${val} playlist${val > 1 ? 's' : ''}`);
          else if (key === 'objectIndex') parts.push('object index');
          else if (key.startsWith('collections')) parts.push(`${val} collection WIF${val > 1 ? 's' : ''}`);
        }
      }
      setBackupResult({
        success: true,
        restored: parts.length > 0 ? parts : null,
        backupDate: result.backupDate,
        txid: result.txid,
        alreadyCurrent: parts.length === 0,
      });
      if (parts.length > 0) toast.success(`Restored: ${parts.join(', ')}`);
      else toast.info('Backup found but local data is already current.');
    } catch (err) {
      setBackupResult({ error: err.message || 'Failed to restore' });
      toast.error(err.message || 'Restore failed');
    }
    setBackupFetching(false);
  };

  // Publish encryption keys (PKX/PKY) to enable private messaging
  const handlePublishKeys = async () => {
    setPkxError('');
    setPkxPublishing(true);
    try {
      let currentWif = wif;
      if (!currentWif) {
        // Unlock wallet first — this sets wif in auth state
        await unlockWallet(pkxPassword);
        // We need to wait a tick for React state to update
        // But we can't rely on state, so decrypt manually here
        const { getStoredWallet, decryptWIF } = await import('@/utils/walletCrypto');
        const stored = getStoredWallet(user?.urn, user?.network);
        if (!stored?.encryptedWIF) throw new Error('No wallet found');
        currentWif = await decryptWIF(stored.encryptedWIF, pkxPassword);
        if (!currentWif) throw new Error('Wrong password');
        // Clean WIF
        const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        currentWif = currentWif.split('').filter(c => BASE58.includes(c)).join('');
      }

      // Build a minimal profile update with PKX/PKY (urn identifies the profile)
      // CRITICAL: Use authProfileUrn (resolved on-chain URN), NOT user?.urn which may be the address placeholder
      const resolvedUrn = authProfileUrn || '';
      if (!resolvedUrn || resolvedUrn === user?.address) {
        throw new Error('No minted profile found on-chain. Mint your profile first to publish encryption keys.');
      }
      const profileData = { urn: resolvedUrn };
      const { addresses, taxInsertIndex } = buildProfileTransaction(currentWif, profileData, network);

      // Build PSBT, sign, and broadcast
      const result = await buildAndBroadcast(currentWif, addresses, network, [], 0, 546, [], taxInsertIndex);
      console.log('PKX/PKY publish result:', result);

      // Store keys locally for resilience against indexer downtime
      try {
        const { derivePKXPKY } = await import('@/utils/p2fk');
        const { pkx: pkxLocal, pky: pkyLocal } = derivePKXPKY(currentWif, network);
        await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/profile/keys/store`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: user?.address, pkx: pkxLocal, pky: pkyLocal, network }),
        });
      } catch (storeErr) {
        console.warn('Failed to store keys locally:', storeErr);
      }

      setPkxSuccess(true);
      setShowPkxPrompt(false);
      setPkxPassword('');
    } catch (err) {
      setPkxError(err.message || 'Failed to publish keys');
    } finally {
      setPkxPublishing(false);
    }
  };

  // Network switch: require password, then switch + unlock wallet (or generate new one)
  // If user has no wallet for the target network, allow guest browsing OR wallet generation
  const handleNetworkSwitchRequest = (targetNetwork) => {
    if (targetNetwork === network) return;
    if (!isConnected) {
      // Not logged in — just switch the data view
      if (onNetworkChange) onNetworkChange(targetNetwork);
      return;
    }
    const hasAddr = !!(user?.addresses?.[targetNetwork]);
    setPendingNetwork(targetNetwork);
    setNetSwitchPassword('');
    setNetSwitchError('');
    setNetSwitchImportWif('');
    setNetSwitchSelectedAddr('');
    // If stored wallets exist for the target network, default to 'select' mode
    const stored = user?.urn ? getWalletsForNetwork(user.urn, targetNetwork) : [];
    setNetSwitchMode(stored.length > 0 ? 'select' : 'create');
  };

  const handleBrowseAsGuest = () => {
    if (!pendingNetwork) return;
    switchNetwork(pendingNetwork);
    if (onNetworkChange) onNetworkChange(pendingNetwork);
    setPendingNetwork(null);
  };

  const handleNetworkSwitchConfirm = async () => {
    if (!pendingNetwork || !netSwitchPassword) return;
    setNetSwitchLoading(true);
    setNetSwitchError('');
    try {
      const hasAddr = !!(user?.addresses?.[pendingNetwork]);
      if (hasAddr) {
        // Atomically switch network + decrypt wallet
        await switchNetworkWithPassword(pendingNetwork, netSwitchPassword);
        if (onNetworkChange) onNetworkChange(pendingNetwork);
      } else if (netSwitchMode === 'select' && netSwitchSelectedAddr) {
        // Activate a stored wallet that has no active address mapping yet
        await activateStoredWalletForNetwork(netSwitchSelectedAddr, netSwitchPassword, pendingNetwork);
        if (onNetworkChange) onNetworkChange(pendingNetwork);
      } else if (netSwitchMode === 'import' && netSwitchImportWif.trim()) {
        // Import a WIF for the target network
        await importWalletForNetwork(netSwitchImportWif.trim(), netSwitchPassword, pendingNetwork);
        if (onNetworkChange) onNetworkChange(pendingNetwork);
      } else {
        // No wallet for this network — generate one
        await generateWalletForNetwork(pendingNetwork, netSwitchPassword);
        if (onNetworkChange) onNetworkChange(pendingNetwork);
      }
      setPendingNetwork(null);
      setNetSwitchPassword('');
      setNetSwitchImportWif('');
      setNetSwitchSelectedAddr('');
    } catch (err) {
      setNetSwitchError(err.message || 'Incorrect password');
    } finally {
      setNetSwitchLoading(false);
    }
  };

  const activeMenuItem = MENU_ITEMS.find(m => m.id === tab);

  const wrapperCls = fullPage
    ? "h-full overflow-hidden flex flex-col bg-gray-900"
    : undefined;

  const content = (
    <>
        {/* Header */}
        <div className="flex items-center justify-between px-4 lg:px-6 py-3 lg:py-4 border-b border-gray-800 bg-gray-900 z-10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={tab === 'menu' ? onClose : () => setTab('menu')}
              className={`p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors ${fullPage ? '' : 'lg:hidden'}`}
              data-testid="settings-back"
            >
              <FiArrowLeft size={20} />
            </button>
            {tab === 'menu' ? (
              <>
                <img src={CTHULHU_SVG} alt="Cthulhu" className="h-7 lg:h-8 w-auto" />
                <div>
                  <h2 className="text-base lg:text-lg font-bold text-gray-100">Settings</h2>
                  <span className="text-xs text-gray-500">{VERSION}</span>
                </div>
              </>
            ) : (
              <h2 className="text-base lg:text-lg font-bold text-gray-100">{activeMenuItem?.label || 'Settings'}</h2>
            )}
          </div>
          {!fullPage && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors hidden lg:block"
              data-testid="settings-close"
            >
              <FiX size={22} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ===== MENU VIEW ===== */}
          {tab === 'menu' && (
            <div data-testid="settings-menu">
              {/* Profile Header */}
              {isConnected && (
                <button
                  onClick={() => setTab('profile')}
                  className="w-full px-4 py-5 flex items-center gap-4 border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors text-left"
                  data-testid="settings-profile-header"
                >
                  <ProfileThumb name={authProfileUrn || user?.urn || '?'} image={mintedOnNetwork ? profileImage : null} size="lg" />
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold text-gray-100 truncate">{mintedOnNetwork ? (authProfileUrn || user?.urn) : user?.urn}</p>
                    {user?.address && (
                      <p className="text-xs text-gray-500 truncate font-mono mt-0.5">{user.address}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5">{network.includes('mainnet') ? 'Bitcoin Mainnet' : 'Bitcoin Testnet'}</p>
                  </div>
                  <FiArrowRight size={16} className="text-gray-600 flex-shrink-0" />
                </button>
              )}

              {/* Menu Items */}
              <div className="py-2">
                {VISIBLE_MENU_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => item.isLink ? navigate(`/${item.id}`) : setTab(item.id)}
                      className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-800/50 active:bg-gray-800 transition-colors"
                      data-testid={`settings-menu-${item.id}`}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: item.color }}
                      >
                        <Icon size={18} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-semibold text-gray-100">{item.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{item.subtitle}</p>
                      </div>
                      <FiArrowRight size={16} className="text-gray-600 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>

              {/* Sign Out at bottom */}
              {isConnected && (
                <div className="px-4 py-3 border-t border-gray-800/60">
                  {/* Switch Identity — preserves all wallet data and caches */}
                  <button
                    onClick={() => {
                      // Clear only session state, not wallets or caches
                      localStorage.removeItem('cthulhu_auth_user');
                      localStorage.removeItem('cthulhu_auth_recovery');
                      localStorage.removeItem('cthulhu_pending_mints');
                      localStorage.removeItem('cthulhu-pending-posts');
                      localStorage.removeItem('cthulhu_pending_txs');
                      logout();
                      disconnectWallet();
                      onClose();
                      navigate('/auth');
                    }}
                    className="w-full py-3 text-sm text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-xl transition-colors text-center font-medium"
                    data-testid="settings-switch-identity"
                  >
                    Switch Identity
                  </button>
                  <p className="text-[10px] text-gray-600 text-center -mt-1 mb-2">Sign in as a different URN or create a new one. Your current wallet stays saved.</p>

                  {!signingOut ? (
                    <button
                      onClick={() => setSigningOut(true)}
                      className="w-full py-3 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors text-center font-medium"
                      data-testid="settings-logout"
                    >
                      Sign Out
                    </button>
                  ) : (
                    <div className="space-y-3 py-2" data-testid="signout-backup-prompt">
                      <p className="text-sm text-gray-300 font-medium text-center">Save SEC backup before signing out?</p>
                      <p className="text-xs text-gray-500 text-center">Encrypts and etches your state to testnet as raw data. You'll get a TXID to restore from anywhere.</p>
                      {!backupCostEstimate && !backupSaving && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setSigningOut(false); logout(); disconnectWallet(); onClose(); navigate('/auth'); }}
                            className="flex-1 py-2.5 text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                            data-testid="signout-skip-btn"
                          >
                            Skip &amp; Sign Out
                          </button>
                          <button
                            onClick={handleEstimateBackup}
                            disabled={estimating || !isWalletUnlocked}
                            className="flex-1 py-2.5 text-sm text-purple-300 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-700/30 rounded-lg transition-colors font-medium disabled:opacity-50"
                            data-testid="signout-estimate-btn"
                          >
                            {estimating ? 'Estimating...' : 'Estimate Cost'}
                          </button>
                        </div>
                      )}
                      {!isWalletUnlocked && !backupCostEstimate && (
                        <p className="text-[10px] text-amber-400/70 text-center">Unlock your wallet first to save.</p>
                      )}
                      {backupCostEstimate && !backupSaving && (
                        <div className="space-y-2">
                          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Data size</span>
                              <span className="text-gray-300">{backupCostEstimate.bundleSize} bytes</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Output addresses</span>
                              <span className="text-gray-300">{backupCostEstimate.numAddresses}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Dust + fee</span>
                              <span className="text-gray-300">{backupCostEstimate.dustCost} + {backupCostEstimate.txFee} sats</span>
                            </div>
                            <div className="flex justify-between text-xs font-medium border-t border-gray-800 pt-1.5 mt-1.5">
                              <span className="text-gray-400">Total est.</span>
                              <span className="text-purple-400">{backupCostEstimate.totalSats} sats</span>
                            </div>
                            {backupCostEstimate.itemCount > 0 && (
                              <p className="text-[10px] text-gray-600">{backupCostEstimate.itemCount} items in bundle</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setBackupCostEstimate(null); setSigningOut(false); logout(); disconnectWallet(); onClose(); navigate('/auth'); }}
                              className="flex-1 py-2.5 text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                              data-testid="signout-skip-after-estimate"
                            >
                              Skip
                            </button>
                            <button
                              onClick={async () => {
                                const result = await handleConfirmBackup();
                                if (result) {
                                  // Show the pointer before logging out
                                  toast.success(`Backup pointer: ${result.pointer}`, { duration: 10000 });
                                }
                                setBackupCostEstimate(null);
                                setSigningOut(false);
                                logout(); disconnectWallet(); onClose(); navigate('/auth');
                              }}
                              className="flex-1 py-2.5 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors font-medium"
                              data-testid="signout-save-btn"
                            >
                              Etch &amp; Sign Out
                            </button>
                          </div>
                        </div>
                      )}
                      {backupSaving && (
                        <div className="text-center py-2">
                          <FiUploadCloud size={16} className="mx-auto text-purple-400 animate-pulse mb-1" />
                          <p className="text-xs text-purple-300">Etching to blockchain...</p>
                        </div>
                      )}
                      {!backupCostEstimate && !backupSaving && !estimating && (
                        <button
                          onClick={() => setSigningOut(false)}
                          className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors text-center py-1"
                          data-testid="signout-cancel"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Sign In for guests */}
              {!isConnected && (
                <div className="px-4 py-6 text-center">
                  <button
                    onClick={() => { onClose(); navigate('/auth'); }}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                    data-testid="settings-signin"
                  >
                    Sign In / Create Account
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== SECTION CONTENT ===== */}
          {tab !== 'menu' && (
            <div className="p-4 lg:p-6">
          {/* ===== PROFILE TAB ===== */}
          {tab === 'profile' && (
            <div className="space-y-4" data-testid="settings-profile-tab">
              {isConnected ? (
                <>
                  {/* Current profile info */}
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <ProfileThumb name={authProfileUrn || user?.urn || '?'} image={mintedOnNetwork ? profileImage : null} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-200 truncate">
                          {mintedOnNetwork ? (authProfileUrn || user?.urn) : user?.urn}
                        </p>
                        {mintedOnNetwork && authProfileUrn && authProfileUrn !== user?.urn && (
                          <p className="text-[10px] text-gray-600 truncate">Login: {user?.urn}</p>
                        )}
                        <p className="text-xs text-gray-500 truncate font-mono">
                          {user?.address || 'No wallet on this network'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        mintedOnNetwork
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`} data-testid="profile-mint-status">
                        {mintedOnNetwork ? 'Minted' : 'Not Minted'}
                      </span>
                      <span className="text-xs text-gray-600">{network}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {!mintedOnNetwork && (
                    <button
                      onClick={() => { onClose(); navigate('/setup'); }}
                      className="w-full flex items-center justify-between px-4 py-3 bg-purple-600/20 border border-purple-500/30 rounded-xl text-purple-300 hover:bg-purple-600/30 transition-colors"
                      data-testid="settings-mint-profile"
                    >
                      <span className="font-medium">Mint Profile</span>
                      <FiArrowRight size={16} />
                    </button>
                  )}

                  {mintedOnNetwork && (
                    <button
                      onClick={() => { onClose(); navigate('/setup'); }}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                      data-testid="settings-update-profile"
                    >
                      <span className="font-medium">Update Profile</span>
                      <FiArrowRight size={16} />
                    </button>
                  )}

                  {/* Encryption Keys Status & Publishing */}
                  {mintedOnNetwork && (
                    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <FiKey size={16} className={myKeys?.has_keys ? 'text-emerald-400' : 'text-red-400'} />
                        <span className="text-sm font-medium text-gray-200">Private Messaging</span>
                        {myKeys?.has_keys && (
                          <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-emerald-500/20 text-emerald-400 rounded tracking-wider" data-testid="keys-status-badge">Active</span>
                        )}
                        {myKeys && !myKeys.has_keys && (
                          <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-yellow-500/20 text-yellow-400 rounded tracking-wider" data-testid="keys-status-badge">Not Active</span>
                        )}
                      </div>

                      {myKeys?.has_keys ? (
                        <>
                          <p className="text-xs text-gray-500">
                            Private messaging is active. Other users can send you encrypted messages.
                          </p>
                          <div className="space-y-2">
                            <div>
                              <p className="text-[10px] text-gray-600 font-mono mb-0.5">PKX</p>
                              <div className="flex items-center gap-1">
                                <code className="text-[10px] text-emerald-400/70 font-mono bg-gray-900 px-2 py-1 rounded break-all flex-1 select-all" data-testid="my-pkx-value">{myKeys.pkx}</code>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(myKeys.pkx); toast.success('PKX copied'); }}
                                  className="p-1 text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0"
                                  title="Copy PKX"
                                >
                                  <FiCopy size={11} />
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-600 font-mono mb-0.5">PKY</p>
                              <div className="flex items-center gap-1">
                                <code className="text-[10px] text-emerald-400/70 font-mono bg-gray-900 px-2 py-1 rounded break-all flex-1 select-all" data-testid="my-pky-value">{myKeys.pky}</code>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(myKeys.pky); toast.success('PKY copied'); }}
                                  className="p-1 text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0"
                                  title="Copy PKY"
                                >
                                  <FiCopy size={11} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500">
                            Activate private messaging to let other users send you encrypted messages.
                            This is a one-time on-chain transaction.
                          </p>
                          {!showPkxPrompt && !pkxSuccess ? (
                            <button
                              onClick={() => isWalletUnlocked ? handlePublishKeys() : setShowPkxPrompt(true)}
                              className="w-full py-2.5 bg-emerald-600/20 border border-emerald-500/30 rounded-lg text-emerald-300 hover:bg-emerald-600/30 transition-colors text-sm font-medium"
                              data-testid="publish-keys-btn"
                            >
                              Activate Private Messaging
                            </button>
                          ) : !pkxSuccess ? (
                            <div className="space-y-2">
                              <input
                                type="password"
                                value={pkxPassword}
                                onChange={(e) => setPkxPassword(e.target.value)}
                                placeholder="Wallet password"
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500/50"
                                data-testid="publish-keys-password"
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handlePublishKeys()}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handlePublishKeys}
                                  disabled={pkxPublishing || !pkxPassword}
                                  className="flex-1 py-2 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 rounded-lg text-white text-sm font-medium transition-colors"
                                  data-testid="publish-keys-confirm"
                                >
                                  {pkxPublishing ? 'Broadcasting...' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => { setShowPkxPrompt(false); setPkxError(''); }}
                                  className="px-4 py-2 bg-gray-800 rounded-lg text-gray-400 text-sm hover:bg-gray-700 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                              {pkxError && <p className="text-xs text-red-400">{pkxError}</p>}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                  {pkxSuccess && (
                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-4 flex items-center gap-2">
                      <FiCheck size={16} className="text-emerald-400" />
                      <p className="text-sm text-emerald-300">Encryption keys published! Private messaging will be available once the transaction confirms.</p>
                    </div>
                  )}

                  {/* Change Password */}
                  {!showChangePw ? (
                    <button
                      onClick={() => { setShowChangePw(true); setCpError(''); setCpSuccess(false); setCpCurrent(''); setCpNew(''); setCpConfirm(''); }}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                      data-testid="settings-change-password-toggle"
                    >
                      <span className="font-medium">Change Password</span>
                      <FiKey size={16} />
                    </button>
                  ) : (
                    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-change-password-form">
                      <p className="text-sm text-gray-400">Update your login &amp; wallet encryption password.</p>
                      <div className="relative">
                        <input
                          type={cpShowPw ? 'text' : 'password'}
                          value={cpCurrent}
                          onChange={e => { setCpCurrent(e.target.value); setCpError(''); }}
                          placeholder="Current password"
                          className="w-full px-3 py-2 pr-10 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                          data-testid="change-pw-current"
                          autoFocus
                        />
                        <button type="button" onClick={() => setCpShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" tabIndex={-1}>
                          {cpShowPw ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={cpShowPw ? 'text' : 'password'}
                          value={cpNew}
                          onChange={e => { setCpNew(e.target.value); setCpError(''); }}
                          placeholder="New password (min 6 characters)"
                          className="w-full px-3 py-2 pr-10 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                          data-testid="change-pw-new"
                        />
                        <button type="button" onClick={() => setCpShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" tabIndex={-1}>
                          {cpShowPw ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={cpShowPw ? 'text' : 'password'}
                          value={cpConfirm}
                          onChange={e => { setCpConfirm(e.target.value); setCpError(''); }}
                          placeholder="Confirm new password"
                          className={`w-full px-3 py-2 pr-10 bg-gray-900 border rounded-lg text-gray-100 text-sm focus:outline-none ${cpConfirm && cpNew ? (cpNew === cpConfirm ? 'border-emerald-500 focus:border-emerald-500' : 'border-red-500 focus:border-red-500') : 'border-gray-700 focus:border-purple-500'}`}
                          data-testid="change-pw-confirm"
                        />
                        <button type="button" onClick={() => setCpShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" tabIndex={-1}>
                          {cpShowPw ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                        </button>
                      </div>
                      {cpConfirm && cpNew && cpNew !== cpConfirm && (
                        <p className="text-xs text-red-400" data-testid="change-pw-mismatch">Passwords do not match</p>
                      )}
                      {cpConfirm && cpNew && cpNew === cpConfirm && (
                        <p className="text-xs text-emerald-400" data-testid="change-pw-match">Passwords match</p>
                      )}
                      {cpError && <p className="text-xs text-red-400">{cpError}</p>}
                      {cpSuccess && <p className="text-xs text-emerald-400">Password changed! All wallets re-encrypted.</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setShowChangePw(false); setCpError(''); setCpSuccess(false); }}
                          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            if (!cpCurrent || !cpNew || !cpConfirm) { setCpError('All fields required'); return; }
                            if (cpNew.length < 6) { setCpError('New password must be at least 6 characters'); return; }
                            if (cpNew !== cpConfirm) { setCpError('New passwords do not match'); return; }
                            setCpLoading(true); setCpError('');
                            try {
                              await changePassword(cpCurrent, cpNew);
                              setCpSuccess(true);
                              setCpCurrent(''); setCpNew(''); setCpConfirm('');
                              setTimeout(() => { setShowChangePw(false); setCpSuccess(false); }, 2500);
                            } catch (err) { setCpError(err.message); }
                            finally { setCpLoading(false); }
                          }}
                          disabled={cpLoading || !cpCurrent || !cpNew || !cpConfirm}
                          className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                          data-testid="change-pw-submit"
                        >
                          {cpLoading ? 'Updating...' : 'Change Password'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Rename Profile */}
                  {!showRename ? (
                    <button
                      onClick={() => { setShowRename(true); setRenameValue(user?.urn || ''); setRenameError(''); setRenameSuccess(false); }}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                      data-testid="settings-rename-toggle"
                    >
                      <span className="font-medium">Rename Profile</span>
                      <FiUser size={16} />
                    </button>
                  ) : (
                    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-rename-form">
                      <p className="text-sm text-gray-400">Change your login name. Current: <strong className="text-gray-200">{user?.urn}</strong></p>
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => { setRenameValue(e.target.value); setRenameError(''); }}
                        placeholder="New profile name"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                        data-testid="rename-urn-input"
                        autoFocus
                      />
                      {renameError && <p className="text-xs text-red-400">{renameError}</p>}
                      {renameSuccess && <p className="text-xs text-emerald-400">Profile renamed!</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setShowRename(false); setRenameError(''); }}
                          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            if (!renameValue.trim() || renameValue.trim().length < 2) { setRenameError('Name must be at least 2 characters'); return; }
                            if (renameValue.trim().toLowerCase() === user?.urn?.toLowerCase()) { setRenameError('Same as current name'); return; }
                            setRenameLoading(true); setRenameError('');
                            try {
                              await renameUrn(renameValue.trim());
                              setRenameSuccess(true);
                              setTimeout(() => { setShowRename(false); setRenameSuccess(false); }, 2000);
                            } catch (err) { setRenameError(err.message); }
                            finally { setRenameLoading(false); }
                          }}
                          disabled={renameLoading || !renameValue.trim()}
                          className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                          data-testid="rename-urn-submit"
                        >
                          {renameLoading ? 'Saving...' : 'Rename'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* WIF Import */}
                  {!showWifImport ? (
                    <button
                      onClick={() => setShowWifImport(true)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                      data-testid="settings-import-wif-toggle"
                    >
                      <span className="font-medium">Import Wallet (WIF)</span>
                      <FiKey size={16} />
                    </button>
                  ) : (
                    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-wif-import-form">
                      {/* Backup warning for existing wallets */}
                      {getLocalWallets().length > 0 && (
                        <div className="flex gap-2 p-3 bg-amber-900/20 border border-amber-700/30 rounded-lg">
                          <FiAlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-300/80 leading-relaxed">
                            <p className="font-semibold text-amber-300">You have {getLocalWallets().length} wallet(s) on this network.</p>
                            <p className="mt-1">Importing a new key will <span className="text-amber-200 font-medium">add it alongside</span> your existing wallets and switch to it. Make sure you have backed up your previous WIF(s) — if lost, they are gone forever.</p>
                          </div>
                        </div>
                      )}
                      <p className="text-sm text-gray-400">Enter a private key (WIF) and a password to encrypt it on this device.</p>
                      <input
                        type="password"
                        value={importWifValue}
                        onChange={e => { setImportWifValue(e.target.value); setImportError(''); }}
                        placeholder="Private key (WIF)"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono focus:border-purple-500 focus:outline-none"
                        data-testid="settings-wif-input"
                      />
                      <input
                        type="text"
                        value={importLabel}
                        onChange={e => setImportLabel(e.target.value)}
                        placeholder="Label (optional, e.g. 'Trading Wallet')"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                        data-testid="settings-wif-label"
                      />
                      <input
                        type="password"
                        value={importPasswordValue}
                        onChange={e => { setImportPasswordValue(e.target.value); setImportError(''); }}
                        placeholder="Encryption password"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                        data-testid="settings-wif-password"
                      />
                      {importError && <p className="text-xs text-red-400">{importError}</p>}
                      {importSuccess && <p className="text-xs text-emerald-400">Wallet imported successfully!</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setShowWifImport(false); setImportWifValue(''); setImportPasswordValue(''); setImportLabel(''); setImportError(''); setImportSuccess(false); }}
                          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            if (!importWifValue || !importPasswordValue) { setImportError('Both key and password required'); return; }
                            setImportingWif(true); setImportError('');
                            try {
                              await importWallet(importWifValue, importPasswordValue, importLabel);
                              setImportSuccess(true);
                              setImportWifValue(''); setImportPasswordValue(''); setImportLabel('');
                              setTimeout(() => { setShowWifImport(false); setImportSuccess(false); }, 2000);
                            } catch (err) { setImportError(err.message); }
                            finally { setImportingWif(false); }
                          }}
                          disabled={importingWif || !importWifValue || !importPasswordValue}
                          className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                          data-testid="settings-wif-submit"
                        >
                          {importingWif ? 'Importing...' : 'Import & Encrypt'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Wallet Management */}
                  <WalletManager
                    user={user}
                    network={user?.network || network}
                    getLocalWallets={getLocalWallets}
                    switchActiveWallet={switchActiveWallet}
                    removeWallet={removeWallet}
                    resetNetworkWallet={resetNetworkWallet}
                  />

                  <button
                    onClick={() => { onClose(); navigate(`/profile/${user?.address}`); }}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-700 transition-colors"
                    data-testid="settings-view-profile"
                  >
                    <span className="font-medium">View My Profile</span>
                    <FiArrowRight size={16} />
                  </button>

                  {/* Claim Profile Section */}
                  <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 mt-3" data-testid="claim-profile-section">
                    <p className="text-sm font-medium text-gray-300 mb-2">Claim Profile</p>
                    <p className="text-xs text-gray-500 mb-3">Link an existing on-chain URN to this wallet.</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={claimURN}
                        onChange={(e) => { setClaimURN(e.target.value); setClaimError(''); setClaimSuccess(''); }}
                        placeholder="Enter URN (e.g. embii4u)"
                        className="flex-1 px-3 py-2 bg-gray-900 text-gray-100 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm"
                        data-testid="settings-claim-urn-input"
                      />
                      <button
                        disabled={claiming || !claimURN.trim()}
                        onClick={async () => {
                          setClaiming(true); setClaimError(''); setClaimSuccess('');
                          try {
                            const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
                            const res = await fetch(`${API}/profile/${claimURN.trim()}?network=${network}`);
                            const profile = await res.json();
                            if (profile && profile.urn) {
                              if (myAddress && profile.address && profile.address !== myAddress) {
                                setClaimError('Not your keys, not your profile.');
                              } else if (claimProfile) {
                                claimProfile(profile);
                                setClaimSuccess('Profile claimed!');
                                setClaimURN('');
                              }
                            } else {
                              setClaimError('Profile not found.');
                            }
                          } catch { setClaimError('Lookup failed.'); }
                          finally { setClaiming(false); }
                        }}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                        data-testid="settings-claim-button"
                      >
                        {claiming ? '...' : 'Claim'}
                      </button>
                    </div>
                    {claimError && <p className="mt-2 text-red-400 text-xs">{claimError}</p>}
                    {claimSuccess && <p className="mt-2 text-green-400 text-xs">{claimSuccess}</p>}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <FiUser size={24} className="text-purple-400" />
                  </div>
                  <p className="text-gray-300 font-medium mb-2">No Profile Connected</p>
                  <p className="text-sm text-gray-500 mb-6">Sign in to mint a profile or import an existing wallet.</p>
                  <button
                    onClick={() => { onClose(); navigate('/auth'); }}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                    data-testid="settings-signin"
                  >
                    Sign In / Create Account
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ===== NOTIFICATIONS TAB ===== */}
          {tab === 'notifications' && (
            <NotificationsTab />
          )}

          {/* ===== APPEARANCE TAB ===== */}
          {tab === 'appearance' && (
            <div className="space-y-6" data-testid="settings-appearance-tab">
              {/* Theme Selector */}
              <div>
                <p className="text-sm font-medium text-gray-200 mb-3">Color Theme</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {Object.values(THEMES).map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
                        themeId === t.id ? 'border-white/30 ring-1 ring-white/20 bg-white/5' : 'border-gray-800 hover:border-gray-600'
                      }`}
                      data-testid={`theme-${t.id}`}
                    >
                      <div className="w-full h-6 rounded-md flex overflow-hidden border border-white/5">
                        {t.preview.map((c, i) => (
                          <div key={i} className="flex-1" style={{ background: c }} />
                        ))}
                      </div>
                      <span className="text-[9px] text-gray-400 leading-tight">{t.label}</span>
                      {themeId === t.id && <FiCheck size={9} className="absolute top-0.5 right-0.5 text-white/70" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bright Mode Toggle */}
              <div className="flex items-center justify-between px-1">
                <div>
                  <p className="text-sm font-medium text-gray-200">Bright Mode</p>
                  <p className="text-[11px] text-gray-500">Lighten backgrounds for better visibility</p>
                </div>
                <button
                  onClick={() => setBrightMode(!brightMode)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${brightMode ? '' : 'bg-gray-700'}`}
                  style={brightMode ? { backgroundColor: 'var(--c-accent)' } : {}}
                  data-testid="bright-mode-toggle"
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${brightMode ? 'translate-x-5.5 left-auto right-0.5' : 'left-0.5'}`}
                    style={brightMode ? { transform: 'translateX(0)', right: '2px', left: 'auto', position: 'absolute' } : { transform: 'translateX(0)', left: '2px', position: 'absolute' }}
                  />
                </button>
              </div>

              {/* Wallpaper Selector */}
              <div>
                <p className="text-sm font-medium text-gray-200 mb-3">Chat Wallpaper</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(WALLPAPERS).map(wp => {
                    const isActive = wallpaperId === wp.id;
                    return (
                      <button
                        key={wp.id}
                        onClick={() => setWallpaper(wp.id)}
                        className={`relative h-20 rounded-xl border overflow-hidden transition-all ${
                          isActive ? 'border-white/30 ring-1 ring-white/20' : 'border-gray-800 hover:border-gray-600'
                        }`}
                        style={{
                          backgroundColor: (THEMES[themeId] || THEMES.midnight).colors.bg,
                          ...(wp.css !== 'none' ? { backgroundImage: wp.css, backgroundSize: wp.size || 'auto' } : {}),
                        }}
                        data-testid={`wallpaper-${wp.id}`}
                      >
                        <span className="absolute inset-x-0 bottom-0 text-[9px] text-gray-400 bg-black/60 py-0.5 text-center">{wp.label}</span>
                        {isActive && <FiCheck size={12} className="absolute top-1 right-1 text-white/80" />}
                      </button>
                    );
                  })}

                  {/* Custom wallpaper from owned objects - only for signed-in users */}
                  {user?.address && (
                    <button
                      onClick={() => wallpaperId === 'custom' ? setWallpaper('none') : setWallpaper('custom')}
                      className={`relative h-20 rounded-xl border overflow-hidden transition-all ${
                        wallpaperId === 'custom' ? 'border-white/30 ring-1 ring-white/20' : 'border-gray-800 hover:border-gray-600'
                      }`}
                      data-testid="wallpaper-custom"
                    >
                      {customWallpaper ? (
                        <img src={customWallpaper} alt="" className="w-full h-full object-cover opacity-60" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <FiImage size={16} className="text-gray-600" />
                        </div>
                      )}
                      <span className="absolute inset-x-0 bottom-0 text-[9px] text-gray-400 bg-black/60 py-0.5 text-center">Object</span>
                      {wallpaperId === 'custom' && <FiCheck size={12} className="absolute top-1 right-1 text-white/80" />}
                    </button>
                  )}
                </div>

                {/* Owned objects for custom wallpaper */}
                {wallpaperId === 'custom' && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-2">Select from your owned objects:</p>
                    {ownedObjects.length > 0 ? (
                      <div className="grid grid-cols-5 gap-1.5 max-h-40 overflow-y-auto">
                        {ownedObjects.map(obj => {
                          // Try image field first, then uri as fallback image source
                          const parsed = parseMediaString(obj.image || '', { mainnet: isMainnetNetwork(network) });
                          const uriParsed = (!parsed?.url && obj.uri) ? parseMediaString(obj.uri, { mainnet: isMainnetNetwork(network) }) : null;
                          const imgUrl = parsed?.url || uriParsed?.url || obj.image || '';
                          const fallbackUrl = parsed?.fallbackUrl || uriParsed?.fallbackUrl || '';
                          return (
                            <WallpaperObjectThumb
                              key={obj.txid || obj.name}
                              obj={obj}
                              imgUrl={imgUrl}
                              fallbackUrl={fallbackUrl}
                              isSelected={customWallpaper === imgUrl || customWallpaper === fallbackUrl}
                              onSelect={(url) => setCustomWallpaper(url)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">
                        {user?.address ? 'No objects with images found.' : 'Sign in to see your objects.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== WALKIE TALKIE TAB ===== */}
          {tab === 'walkie' && (
            <div className="space-y-4" data-testid="settings-walkie-tab">
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-200 mb-2">SUP Walkie Talkie</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  On-chain broadcast voice using the Bitcoin mempool. Record a voice message,
                  upload to IPFS, and broadcast it as a standard P2FK message.
                </p>
                <p className="text-xs text-gray-500 leading-relaxed mt-2">
                  <span className="text-amber-400">Channel</span> = dust value (546-646 sats). 
                  Everyone on the same channel hears your transmission.
                </p>
              </div>
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-1">How it works</p>
                <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
                  <li>Power on to start monitoring the mempool</li>
                  <li>Set your channel with the CHANNEL knob</li>
                  <li>Hold PUSH TO TALK to record, release to transmit</li>
                  <li>Incoming transmissions on your channel auto-play</li>
                </ul>
              </div>
              <button
                onClick={() => { onClose(); navigate('/walkie'); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
                data-testid="goto-walkie"
              >
                <FiRadio size={14} /> Open Walkie Talkie <FiArrowRight size={14} />
              </button>
            </div>
          )}

          {/* ===== PHONE SETTINGS TAB ===== */}
          {tab === 'phone' && (
            <div className="space-y-4" data-testid="settings-phone-tab">
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-200 mb-2">Phone Settings</p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Control whether other users can reach you via the walkie-talkie phone.
                  When disabled, callers hear your answering machine (if set up) or a busy signal.
                </p>
              </div>
              {myAddress ? (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <CallSettings userAddress={myAddress} network={network} />
                </div>
              ) : (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 text-center">
                  <p className="text-xs text-gray-500">Log in to manage call settings</p>
                </div>
              )}
            </div>
          )}

          {/* ===== NETWORK TAB ===== */}
          {tab === 'network' && (
            <div className="space-y-4" data-testid="settings-network-tab">
              {/* Current Network + Address */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-2">Current Network</p>
                <div className="flex items-center gap-3">
                  <img
                    src="https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg"
                    alt="BTC"
                    className="w-8 h-8"
                    style={network.includes('testnet') ? { filter: 'hue-rotate(90deg) saturate(1.5)' } : {}}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-200">
                      {network.includes('mainnet') ? 'Bitcoin Mainnet' : 'Bitcoin Testnet v3'}
                    </p>
                    {user?.addresses?.[network] ? (
                      <p className="text-xs text-gray-500 truncate">{user.addresses[network]}</p>
                    ) : user?.address && user?.network === network ? (
                      <p className="text-xs text-gray-500 truncate">{user.address}</p>
                    ) : (
                      <p className="text-xs text-amber-400">No wallet for this network</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Network Toggle */}
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium">Switch Network</p>
                {[
                  { id: 'btc-mainnet', name: 'Bitcoin Mainnet', label: 'BTC Mainnet', testnet: false },
                  { id: 'btc-testnet', name: 'Bitcoin Testnet', label: 'BTC Testnet v3', testnet: true },
                ].map(n => {
                  const hasAddr = !!(user?.addresses?.[n.id]);
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleNetworkSwitchRequest(n.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                        network === n.id
                          ? 'bg-purple-600/15 border-purple-500/40 text-purple-300'
                          : 'bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                      }`}
                      data-testid={`network-select-${n.id}`}
                    >
                      <img
                        src="https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg"
                        alt="BTC" className="w-6 h-6"
                        style={n.testnet ? { filter: 'hue-rotate(90deg) saturate(1.5)' } : {}}
                      />
                      <div className="flex-1 text-left">
                        <p className="text-sm font-medium">{n.name}</p>
                        <p className="text-xs opacity-60">
                          {hasAddr ? n.label : (() => {
                            const stored = user?.urn ? getWalletsForNetwork(user.urn, n.id) : [];
                            return stored.length > 0 ? `${stored.length} wallet${stored.length !== 1 ? 's' : ''} stored` : 'No wallet yet';
                          })()}
                        </p>
                      </div>
                      {network === n.id && <FiCheck size={16} className="text-purple-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Password prompt for network switch */}
              {pendingNetwork && (
                <div className="bg-gray-950 border border-purple-500/30 rounded-xl p-4 space-y-3" data-testid="network-switch-prompt">
                  {user?.addresses?.[pendingNetwork] ? (
                    <>
                      <p className="text-sm text-gray-200">
                        Enter password to switch to {pendingNetwork.includes('mainnet') ? 'Mainnet' : 'Testnet'}
                      </p>
                      <input
                        type="password"
                        value={netSwitchPassword}
                        onChange={e => setNetSwitchPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleNetworkSwitchConfirm()}
                        placeholder="Your Cthulhu password"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                        autoFocus
                        data-testid="network-switch-password"
                      />
                      {netSwitchError && <p className="text-xs text-red-400">{netSwitchError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPendingNetwork(null)}
                          className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
                          data-testid="network-switch-cancel"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNetworkSwitchConfirm}
                          disabled={!netSwitchPassword || netSwitchLoading}
                          className="flex-1 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm text-white transition-colors"
                          data-testid="network-switch-confirm"
                        >
                          {netSwitchLoading ? 'Switching...' : 'Confirm'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Show stored wallets for this network */}
                      {(() => {
                        const stored = user?.urn ? getWalletsForNetwork(user.urn, pendingNetwork) : [];
                        if (stored.length === 0) return (
                          <p className="text-sm text-gray-200">
                            No wallet on {pendingNetwork.includes('mainnet') ? 'Mainnet' : 'Testnet'} yet
                          </p>
                        );
                        return (
                          <div className="space-y-2" data-testid="stored-wallets-panel">
                            <p className="text-xs text-gray-400 font-medium">
                              {stored.length} wallet{stored.length !== 1 ? 's' : ''} on {pendingNetwork.includes('mainnet') ? 'Mainnet' : 'Testnet'}
                            </p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {stored.map((w, i) => (
                                <button
                                  key={w.address}
                                  onClick={() => { setNetSwitchSelectedAddr(w.address); setNetSwitchMode('select'); setNetSwitchError(''); }}
                                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors border ${
                                    netSwitchSelectedAddr === w.address
                                      ? 'bg-purple-600/20 border-purple-600/50 ring-1 ring-purple-500/30'
                                      : 'bg-gray-950/60 border-gray-800/40 hover:bg-gray-900/80'
                                  }`}
                                  data-testid={`stored-wallet-${i}`}
                                >
                                  <FiKey size={12} className={netSwitchSelectedAddr === w.address ? 'text-purple-400' : 'text-gray-600'} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-gray-300 truncate font-mono">{w.address}</p>
                                    <p className="text-[9px] text-gray-600">
                                      {w.label || `Wallet ${i + 1}`}
                                      {w.storedAt ? ` \u00B7 ${new Date(w.storedAt).toLocaleDateString()}` : ''}
                                    </p>
                                  </div>
                                  {netSwitchSelectedAddr === w.address && <FiCheck size={14} className="text-purple-400 flex-shrink-0" />}
                                </button>
                              ))}
                            </div>
                            {netSwitchSelectedAddr && (
                              <p className="text-[10px] text-purple-400/70">Enter password below to activate this wallet.</p>
                            )}
                          </div>
                        );
                      })()}

                      <button
                        onClick={handleBrowseAsGuest}
                        className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors"
                        data-testid="network-browse-guest"
                      >
                        Browse as Guest
                      </button>
                      <div className="relative flex items-center gap-2 my-1">
                        <div className="flex-1 h-px bg-gray-800" />
                        <span className="text-[10px] text-gray-600 uppercase">or</span>
                        <div className="flex-1 h-px bg-gray-800" />
                      </div>

                      {/* Mode toggle: Create vs Import */}
                      <div className="flex bg-gray-900 rounded-lg p-0.5 mb-2">
                        <button
                          onClick={() => { setNetSwitchMode('create'); setNetSwitchSelectedAddr(''); setNetSwitchError(''); }}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            netSwitchMode === 'create' ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                          data-testid="net-switch-mode-create"
                        >
                          New Wallet
                        </button>
                        <button
                          onClick={() => { setNetSwitchMode('import'); setNetSwitchSelectedAddr(''); setNetSwitchError(''); }}
                          className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            netSwitchMode === 'import' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
                          }`}
                          data-testid="net-switch-mode-import"
                        >
                          Import WIF
                        </button>
                      </div>

                      {netSwitchMode === 'import' && (
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Private Key (WIF)</label>
                          <input
                            type="password"
                            value={netSwitchImportWif}
                            onChange={e => { setNetSwitchImportWif(e.target.value); setNetSwitchError(''); }}
                            placeholder="Paste your WIF key..."
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                            data-testid="network-switch-import-wif"
                          />
                        </div>
                      )}

                      <p className="text-xs text-gray-500">
                        {netSwitchMode === 'select' ? 'Enter password to unlock selected wallet:' : netSwitchMode === 'create' ? 'Enter password to generate a wallet:' : 'Enter password to encrypt & switch:'}
                      </p>
                      <input
                        type="password"
                        value={netSwitchPassword}
                        onChange={e => setNetSwitchPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleNetworkSwitchConfirm()}
                        placeholder="Your Cthulhu password"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500"
                        data-testid="network-switch-password"
                      />
                      {netSwitchError && <p className="text-xs text-red-400">{netSwitchError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPendingNetwork(null)}
                          className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
                          data-testid="network-switch-cancel"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleNetworkSwitchConfirm}
                          disabled={!netSwitchPassword || netSwitchLoading || (netSwitchMode === 'import' && !netSwitchImportWif.trim()) || (netSwitchMode === 'select' && !netSwitchSelectedAddr)}
                          className={`flex-1 py-2 rounded-lg disabled:opacity-40 text-sm text-white transition-colors ${
                            netSwitchMode === 'import' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-purple-600 hover:bg-purple-500'
                          }`}
                          data-testid="network-switch-confirm"
                        >
                          {netSwitchLoading
                            ? (netSwitchMode === 'import' ? 'Importing...' : netSwitchMode === 'select' ? 'Activating...' : 'Generating...')
                            : (netSwitchMode === 'import' ? 'Import & Switch' : netSwitchMode === 'select' ? 'Activate Wallet' : 'Create Wallet')
                          }
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* IPFS Node Status — live polling */}
              <IpfsNodeStatus />

              {/* Connect Your Node */}
              <ConnectNodeSection network={network} />

              {/* Warning */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                <FiAlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Each network has its own wallet and profile. Switching networks changes which blockchain you interact with. Your Cthulhu login remains the same.
                </p>
              </div>
            </div>
          )}

          {/* ===== TREASURY TAB ===== */}
          {tab === 'treasury' && (
            <div className="space-y-4" data-testid="settings-treasury-tab">
              {treasuryLoading ? (
                <div className="text-center py-8">
                  <FiRefreshCw size={20} className="animate-spin text-gray-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Loading treasury...</p>
                </div>
              ) : !treasuryData?.configured ? (
                <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <p className="text-sm text-gray-400">Treasury not configured for this network yet.</p>
                  <p className="text-xs text-gray-600 mt-1">Mainnet treasury address will be set after deployment.</p>
                </div>
              ) : (
                <>
                  {/* Tax Rate */}
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FiDollarSign size={16} className="text-teal-400" />
                      <span className="text-sm font-medium text-gray-200">Platform Fee</span>
                    </div>
                    <p className="text-3xl font-bold text-teal-400">{(treasuryData.tax_rate * 100).toFixed(0)}%</p>
                    <p className="text-xs text-gray-500 mt-1">
                      A {(treasuryData.tax_rate * 100).toFixed(0)}% fee (minimum {647} sats) is added to every on-chain transaction.
                      {network.includes('testnet')
                        ? ' On testnet, these funds are recycled as a faucet for new users.'
                        : ' Revenue supports platform operations, marketing, and server costs.'}
                    </p>
                  </div>

                  {/* Treasury Address & Balance */}
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Treasury Address</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(treasuryData.address);
                          setCopiedAddr(true);
                          setTimeout(() => setCopiedAddr(false), 2000);
                        }}
                        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                        data-testid="treasury-copy-address"
                      >
                        {copiedAddr ? <FiCheck size={10} className="text-emerald-400" /> : <FiCopy size={10} />}
                        {copiedAddr ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <code className="block text-xs text-gray-300 font-mono break-all bg-gray-900 px-3 py-2 rounded-lg" data-testid="treasury-address">
                      {treasuryData.address}
                    </code>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-xs text-gray-500">Balance</span>
                        <p className="text-lg font-bold text-gray-100" data-testid="treasury-balance">
                          {treasuryData.balance_sats?.toLocaleString()} <span className="text-xs text-gray-500">sats</span>
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500">BTC</span>
                        <p className="text-lg font-bold text-gray-100">
                          {treasuryData.balance_btc?.toFixed(8)}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={loadTreasury}
                      className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-xs transition-colors"
                      data-testid="treasury-refresh"
                    >
                      <FiRefreshCw size={11} />
                      Refresh
                    </button>
                  </div>

                  {/* Faucet info (testnet only) */}
                  {!network.includes('mainnet') && (
                    <div className="bg-teal-900/15 border border-teal-700/30 rounded-xl p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-teal-300">Testnet Faucet</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded ${
                          treasuryData.faucet_available
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`} data-testid="faucet-status">
                          {treasuryData.faucet_available ? 'Active' : 'Low Balance'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        New users on testnet automatically receive <strong className="text-teal-300">{treasuryData.faucet_amount?.toLocaleString()} sats</strong> from
                        the treasury to fund their first profile mint. The 2% platform fee from all testnet transactions feeds back into this faucet.
                      </p>
                    </div>
                  )}

                  {/* Transparency note */}
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 leading-relaxed">
                      All platform fees are transparent and trackable on-chain. The treasury address above is a standard {network.includes('mainnet') ? 'Bitcoin' : 'Bitcoin Testnet'} address
                      — you can verify all incoming transactions on any block explorer.
                      The fee is an extra output in your transaction that P2FK ignores entirely.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== PAYWALL ADMIN TAB ===== */}
          {tab === 'paywall' && (
            <PaywallAdminTab user={user} />
          )}

          {/* ===== BLOCKED USERS TAB ===== */}
          {tab === 'blocked' && (
            <div className="space-y-4" data-testid="settings-blocked-tab">
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-200">Blocked Users</p>
                <p className="text-xs text-gray-500 mt-0.5">Blocked users' content is hidden from your feed, DMs, and tethers. This is local to your device.</p>
              </div>

              {blockList?.blockedList?.length > 0 ? (
                <div className="space-y-2">
                  {blockList.blockedList.map((entry) => (
                    <div key={entry.address} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded-xl p-3" data-testid={`blocked-user-${entry.address}`}>
                      <div className="flex items-center gap-3 overflow-hidden min-w-0">
                        <ProfileThumb name={entry.urn || entry.address?.slice(0, 8)} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 font-medium truncate">{entry.urn || 'Unknown'}</p>
                          <p className="text-[10px] text-gray-600 font-mono truncate">{entry.address}</p>
                          {entry.blocked_at && (
                            <p className="text-[9px] text-gray-700">Blocked {new Date(entry.blocked_at).toLocaleDateString()}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => blockList.unblockUser(entry.address)}
                        className="flex-shrink-0 px-3 py-1.5 bg-red-900/20 border border-red-800/30 rounded-lg text-xs text-red-400 hover:bg-red-900/40 transition-colors"
                        data-testid={`unblock-${entry.address}`}
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600">
                  <FiSlash size={24} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No blocked users</p>
                  <p className="text-xs mt-1">You can block users from their profile or DM conversations</p>
                </div>
              )}
            </div>
          )}

          {/* ===== IPFS PINNING TAB ===== */}
          {tab === 'ipfs' && (
            <div className="space-y-4" data-testid="settings-ipfs-tab">
              {/* IPFS Cache Manager */}
              <IpfsCacheManager />

              {/* Note pointing to Mesh Relay */}
              <div className="bg-gray-800/40 rounded-xl p-4">
                <p className="text-xs text-gray-400 leading-relaxed">
                  IPFS content is also shared peer-to-peer via <button onClick={() => setTab('mesh')} className="text-cyan-400 hover:underline font-medium">Mesh Relay</button>. Content you browse is automatically cached and shared with mesh peers.
                </p>
              </div>

              {/* Decrypt Cache */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-200">Message Decrypt Cache</p>
                  <p className="text-xs text-gray-500 mt-0.5">Cached decryption results for encrypted messages. Speeds up loading by skipping re-decryption on every visit.</p>
                </div>
                <button
                  onClick={handleClearDecryptCache}
                  disabled={clearingDecrypt}
                  className="flex items-center gap-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm disabled:opacity-50 border border-red-800/50 transition-colors"
                  data-testid="settings-decrypt-cache-clear"
                >
                  <FiTrash2 size={12} />
                  {clearingDecrypt ? 'Clearing...' : 'Clear Decrypt Cache'}
                </button>
              </div>

              {/* SEC Backup — Save to Blockchain */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-sec-backup-save">
                <div>
                  <p className="text-sm font-medium text-gray-200 flex items-center gap-2">
                    <FiUploadCloud size={14} className="text-purple-400" />
                    SEC Etch Backup
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Encrypt and inject your state directly onto the blockchain as raw data.
                    Invisible to all indexers — only your WIF + TXID can recover it.
                  </p>
                </div>
                {lastBackupSave && (
                  <div className="text-[10px] text-gray-500 bg-gray-900/60 rounded-lg px-3 py-2">
                    Last: {new Date(lastBackupSave.savedAt).toLocaleString()}
                    {lastBackupSave.txid && (
                      <> &middot; <span className="text-cyan-500 font-mono">{lastBackupSave.pointer || `tBTC:${lastBackupSave.txid.slice(0, 12)}...`}</span></>
                    )}
                    {lastBackupSave.addressCount && <> &middot; {lastBackupSave.addressCount} addrs</>}
                  </div>
                )}

                {!backupCostEstimate && !backupSaving && (
                  <button
                    onClick={handleEstimateBackup}
                    disabled={estimating || !isWalletUnlocked}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg text-sm disabled:opacity-50 border border-purple-800/50 transition-colors font-medium"
                    data-testid="settings-sec-estimate-btn"
                  >
                    <FiUploadCloud size={13} className={estimating ? 'animate-pulse' : ''} />
                    {estimating ? 'Estimating...' : 'Estimate Etch Cost'}
                  </button>
                )}

                {backupCostEstimate && !backupSaving && (
                  <div className="space-y-2">
                    <div className="bg-gray-900/60 rounded-lg p-3 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Data size</span>
                        <span className="text-gray-300">{backupCostEstimate.bundleSize} bytes</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Encrypted</span>
                        <span className="text-gray-300">{backupCostEstimate.encryptedSize} bytes</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Output addresses</span>
                        <span className="text-gray-300">{backupCostEstimate.numAddresses}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Dust + fee</span>
                        <span className="text-gray-300">{backupCostEstimate.dustCost} + {backupCostEstimate.txFee} sats</span>
                      </div>
                      <div className="flex justify-between text-xs font-medium border-t border-gray-800 pt-1.5 mt-1.5">
                        <span className="text-gray-400">Total est.</span>
                        <span className="text-purple-400">{backupCostEstimate.totalSats} sats</span>
                      </div>
                      {backupCostEstimate.itemCount > 0 && (
                        <p className="text-[10px] text-gray-600">{backupCostEstimate.itemCount} items in bundle</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <FeePicker network={network} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setBackupCostEstimate(null)}
                        className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-sm transition-colors"
                        data-testid="settings-sec-cancel"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmBackup}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors"
                        data-testid="settings-sec-confirm-btn"
                      >
                        <FiUploadCloud size={13} />
                        Etch to Chain
                      </button>
                    </div>
                  </div>
                )}

                {backupSaving && (
                  <div className="flex items-center gap-2 px-4 py-2.5 text-purple-300 text-sm">
                    <FiUploadCloud size={13} className="animate-pulse" />
                    Injecting to blockchain...
                  </div>
                )}

                {!isWalletUnlocked && (
                  <p className="text-[10px] text-amber-400/70">Unlock your wallet first.</p>
                )}
              </div>

              {/* SEC Restore — By Transaction ID */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-sec-restore">
                <div>
                  <p className="text-sm font-medium text-gray-200 flex items-center gap-2">
                    <FiDatabase size={14} className="text-teal-400" />
                    Restore from TXID
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Enter your backup transaction ID to decrypt and restore state. Format: tBTC:txid or just the 64-char TXID.</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={restoreTxid}
                    onChange={e => setRestoreTxid(e.target.value)}
                    placeholder="tBTC:abc123... or paste TXID"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-teal-600"
                    data-testid="settings-sec-restore-input"
                  />
                  <button
                    onClick={() => {
                      const parsed = parsePointer(restoreTxid.trim());
                      if (parsed) {
                        handleRestoreFromTxid(parsed.txid, parsed.network);
                      } else {
                        // Assume raw txid on testnet
                        handleRestoreFromTxid(restoreTxid.trim(), 'btc-testnet');
                      }
                    }}
                    disabled={backupFetching || !isWalletUnlocked || !restoreTxid.trim()}
                    className="px-4 py-2 bg-teal-600/20 hover:bg-teal-600/30 text-teal-400 rounded-lg text-sm disabled:opacity-50 border border-teal-800/50 transition-colors font-medium"
                    data-testid="settings-sec-restore-btn"
                  >
                    <FiRefreshCw size={13} className={backupFetching ? 'animate-spin' : ''} />
                  </button>
                </div>
                {!isWalletUnlocked && (
                  <p className="text-[10px] text-amber-400/70">Unlock your wallet first to decrypt.</p>
                )}
                {backupResult && (
                  <div className={`text-xs px-3 py-2.5 rounded-lg border ${
                    backupResult.error
                      ? 'text-red-400 bg-red-400/10 border-red-400/20'
                      : backupResult.alreadyCurrent
                        ? 'text-gray-400 bg-gray-800/50 border-gray-700/50'
                        : 'text-teal-400 bg-teal-400/10 border-teal-400/20'
                  }`} data-testid="settings-sec-restore-result">
                    {backupResult.error ? (
                      <span>{backupResult.error}</span>
                    ) : backupResult.alreadyCurrent ? (
                      <span>Backup decrypted (from {new Date(backupResult.backupDate).toLocaleDateString()}) — local data is already up to date.</span>
                    ) : (
                      <div>
                        <p className="font-medium mb-1">Restored from chain ({new Date(backupResult.backupDate).toLocaleDateString()}):</p>
                        <ul className="list-disc list-inside space-y-0.5 text-teal-300/80">
                          {backupResult.restored.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                        <p className="mt-2 text-[10px] text-gray-500">Refresh the page to see restored data.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SEC Backup History (from localStorage) */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3" data-testid="settings-sec-history">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-200 flex items-center gap-2">
                    <FiClock size={14} className="text-teal-400" />
                    Backup History
                  </p>
                  {secHistory.length > 0 && (
                    <button
                      onClick={() => setHistoryOpen(!historyOpen)}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      data-testid="settings-sec-history-toggle"
                    >
                      {historyOpen ? 'Hide' : `Show (${secHistory.length})`}
                    </button>
                  )}
                </div>
                {secHistory.length === 0 && (
                  <p className="text-xs text-gray-600">No SEC backups yet. Save one above.</p>
                )}
                {historyOpen && secHistory.length > 0 && (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {secHistory.map((sp, idx) => {
                      const d = new Date(sp.savedAt);
                      const label = !isNaN(d) ? d.toLocaleString() : 'Unknown date';
                      const pointer = sp.pointer || `tBTC:${sp.txid}`;
                      return (
                        <div key={sp.txid || idx} className="flex items-center gap-2 px-3 py-2 bg-gray-900/60 border border-gray-800/40 rounded-lg group" data-testid={`sec-sp-${idx}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-300">{label}</p>
                            <p className="text-[10px] text-gray-600 font-mono truncate">{pointer}</p>
                            {sp.addressCount && <p className="text-[10px] text-gray-700">{sp.addressCount} addrs &middot; {sp.cost || '?'} sats</p>}
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(pointer);
                              toast.success('Pointer copied');
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-gray-300 transition-all"
                            title="Copy pointer"
                            data-testid={`sec-sp-copy-${idx}`}
                          >
                            <FiCopy size={12} />
                          </button>
                          <button
                            onClick={() => setRestoreTxid(pointer)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-teal-500 hover:text-teal-300 transition-all"
                            title="Restore from this backup"
                            data-testid={`sec-sp-restore-${idx}`}
                          >
                            <FiRefreshCw size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== MESH RELAY TAB ===== */}
          {tab === 'mesh' && (
            <div className="space-y-5" data-testid="settings-mesh-tab">
              {/* Node mode toggle */}
              <div className="bg-gray-800/40 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-gray-100">Node Mode</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Relay data to other users via P2P</p>
                  </div>
                  <button
                    onClick={toggleNodeMode}
                    disabled={!isConnected}
                    className={`relative w-12 h-7 rounded-full transition-colors ${nodeMode ? 'bg-emerald-500' : 'bg-gray-700'} ${!isConnected ? 'opacity-40' : ''}`}
                    data-testid="mesh-node-toggle"
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${nodeMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {nodeMode && nodeStatus && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-emerald-400">{nodeStatus.peers || 0}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Peers</p>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-cyan-400">{nodeStatus.requestsServed || 0}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Served</p>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                      <p className="text-lg font-bold text-amber-400">{formatBytes(nodeStatus.bytesRelayed || 0)}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Relayed</p>
                    </div>
                  </div>
                )}
                {nodeMode && !nodeStatus && (
                  <p className="text-xs text-emerald-400 mt-2">Starting node...</p>
                )}
              </div>

              {/* Content Pinning & Cache Management — unified here */}
              <PinningManager nodeMode={nodeMode} nodeStatus={nodeStatus} />

              {/* Mesh Network Visualizer */}
              <MeshVisualizer
                myAddress={user?.address}
                network={network}
                expanded={vizExpanded}
                onToggleExpand={() => setVizExpanded(v => !v)}
              />

              {/* Network stats */}
              <div className="bg-gray-800/40 rounded-xl p-4">
                <h4 className="text-sm font-bold text-gray-100 mb-3">Network Stats</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900/60 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2.5 h-2.5 rounded-full ${meshStats?.online_nodes > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
                      <span className="text-xs text-gray-400">Nodes Online</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-100">{meshStats?.online_nodes || 0}</p>
                  </div>
                  <div className="bg-gray-900/60 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <FiServer size={12} className="text-gray-500" />
                      <span className="text-xs text-gray-400">Total Registered</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-100">{meshStats?.total_registered || 0}</p>
                  </div>
                  <div className="bg-gray-900/60 rounded-lg p-3 col-span-2">
                    <div className="flex items-center gap-2 mb-1">
                      <FiDatabase size={12} className="text-gray-500" />
                      <span className="text-xs text-gray-400">Total Data Relayed</span>
                    </div>
                    <p className="text-2xl font-bold text-gray-100">{formatBytes(meshStats?.total_bytes_relayed || 0)}</p>
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-gray-800/40 rounded-xl p-4">
                <h4 className="text-sm font-bold text-gray-100 mb-2">How It Works</h4>
                <div className="space-y-2 text-xs text-gray-400">
                  <p>When you enable Node Mode, your device helps relay IPFS content and cached data to other Cthulhu users via direct peer-to-peer connections.</p>
                  <p><strong className="text-cyan-400">Pinning</strong> — Content you view is cached locally and served to peers, creating a decentralized CDN that supplements IPFS.</p>
                  <p><strong className="text-amber-400">Etching</strong> — Store files permanently on the blockchain using P2FK encoding, like the Potcoin Pac-Man game.</p>
                  <p className="text-emerald-400/80">All relayed content is cryptographically verified — nodes cannot serve fake data.</p>
                </div>
              </div>
            </div>
          )}

          {/* ===== ABOUT TAB ===== */}
          {tab === 'about' && (
            <div className="space-y-4" data-testid="settings-about-tab">
              <div className="flex items-center gap-4 mb-2">
                <img
                  src={CTHULHU_SVG}
                  alt="Cthulhu"
                  className="h-14 w-auto"
                />
                <div>
                  <h3 className="text-xl font-bold text-gray-100">Cthulhu</h3>
                  <p className="text-sm text-gray-500">{VERSION}</p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-gray-400">
                <p>
                  <strong className="text-gray-200">Cthulhu</strong> is a modern web interface for the{' '}
                  <strong style={{ color: 'var(--c-accent)' }}>Satoshi Universal Protocol (SUP)</strong>.
                </p>
                <p>
                  SUP is a decentralized protocol for blockchain-based social media, tokenized objects,
                  and data storage using the p2fk (pay-to-future-key) method invented by embii in 2013.
                </p>
              </div>

              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                <h4 className="font-semibold text-gray-200 text-sm mb-2">Built on SUP Protocol</h4>
                <p className="text-xs text-gray-500">
                  This interface provides a Telegram-inspired experience for interacting with
                  blockchain data across Bitcoin, Litecoin, Dogecoin, and testnet networks.
                </p>
              </div>

              <div className="text-xs text-gray-500 space-y-1">
                <p>Original SUP: <a href="https://github.com/embiimob/Sup" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">github.com/embiimob/Sup</a></p>
                <p>P2FK Protocol: <a href="https://p2fk.io" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">p2fk.io</a></p>
                <p>p2fk API: <a href="https://p2fk.io" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">p2fk.io</a></p>
              </div>
            </div>
          )}
            </div>
          )}
        </div>
    </>
  );

  if (fullPage) {
    return <div className={wrapperCls} data-testid="settings-page">{content}</div>;
  }
  return (
    <div className="fixed inset-0 bg-black/70 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose}>
      <div className="bg-gray-900 w-full h-full lg:border lg:border-gray-800 lg:rounded-2xl lg:w-auto lg:h-auto lg:max-w-lg lg:max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="settings-modal">
        {content}
      </div>
    </div>
  );
}


const API = process.env.REACT_APP_BACKEND_URL;

function PaywallAdminTab({ user }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [reports, setReports] = useState([]);
  const [adminKeys, setAdminKeys] = useState({ admin_pkx: '', admin_pky: '' });

  const loadReports = useCallback(async () => {
    if (!user?.address) return;
    try {
      const res = await fetch(`${API}/api/admin/my-reports/${user.address}`);
      if (res.ok) {
        const d = await res.json();
        setReports(d.reports || []);
      }
    } catch {}
  }, [user?.address]);

  useEffect(() => {
    loadReports();
    fetch(`${API}/api/admin/public-keys`).then(r => r.json()).then(d => setAdminKeys(d)).catch(() => {});
  }, [loadReports]);

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/admin/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          user_address: user?.address || null,
          user_urn: user?.urn || null,
        }),
      });
      if (res.ok) {
        setSent(true);
        setSubject('');
        setMessage('');
        loadReports();
        setTimeout(() => setSent(false), 3000);
      }
    } catch {}
    setSending(false);
  };

  return (
    <div className="space-y-4" data-testid="report-admin-tab">
      {/* Admin Public Keys */}
      {(adminKeys.admin_pkx || adminKeys.admin_pky) && (
        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-200 flex items-center gap-2"><FiKey size={14} className="text-purple-400" /> Admin Encryption Keys</p>
          <p className="text-xs text-gray-500 mt-1 mb-3">Use these to encrypt private on-chain messages to the admin.</p>
          {adminKeys.admin_pkx && (
            <div className="mb-2">
              <span className="text-[10px] text-gray-500">PKX:</span>
              <p className="text-[11px] text-gray-300 font-mono break-all bg-gray-900/50 rounded p-1.5 mt-0.5" data-testid="admin-pkx-display">{adminKeys.admin_pkx}</p>
            </div>
          )}
          {adminKeys.admin_pky && (
            <div>
              <span className="text-[10px] text-gray-500">PKY:</span>
              <p className="text-[11px] text-gray-300 font-mono break-all bg-gray-900/50 rounded p-1.5 mt-0.5" data-testid="admin-pky-display">{adminKeys.admin_pky}</p>
            </div>
          )}
        </div>
      )}

      {/* Report Form */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-200 flex items-center gap-2"><FiAlertCircle size={14} className="text-yellow-400" /> Report a Bug or Issue</p>
        {sent && <p className="text-xs text-green-400 bg-green-900/20 rounded-lg p-2">Report submitted successfully!</p>}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Subject</label>
          <input
            type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief summary..."
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-purple-600 focus:outline-none"
            data-testid="report-subject"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Message</label>
          <textarea
            value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe the issue in detail..."
            rows={4}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-purple-600 focus:outline-none resize-none"
            data-testid="report-message"
          />
        </div>
        <button
          onClick={handleSubmit} disabled={sending || !subject.trim() || !message.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          data-testid="report-submit"
        >
          <FiSend size={12} /> {sending ? 'Sending...' : 'Submit Report'}
        </button>
      </div>

      {/* Past Reports */}
      {reports.length > 0 && (
        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-200">Your Reports ({reports.length})</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {reports.map(r => (
              <div key={r._id} className="bg-gray-900/60 border border-gray-800/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                    r.status === 'open' ? 'text-yellow-400 bg-yellow-900/30' : 'text-green-400 bg-green-900/30'
                  }`}>{r.status}</span>
                  <p className="text-xs text-white font-medium truncate">{r.subject}</p>
                  <span className="text-[10px] text-gray-600 ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-[11px] text-gray-400 line-clamp-2">{r.message}</p>
                {r.admin_response && (
                  <div className="mt-2 p-2 bg-green-900/10 border border-green-800/20 rounded-lg">
                    <p className="text-[10px] text-green-500 font-medium mb-0.5">Admin Response:</p>
                    <p className="text-[11px] text-green-300">{r.admin_response}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
