/**
 * MeshPanel — Desktop mesh network status and controls.
 *
 * Shows:
 *   - Master node status (online/offline)
 *   - Connected peers count
 *   - Data relayed stats
 *   - Start/stop mesh toggle
 *   - Connected peer list
 *
 * Desktop only. NEVER imported by the web app.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNode } from '@/contexts/NodeContext';
import { DesktopMeshNode } from '@/utils/desktopMeshNode';
import { FiWifi, FiWifiOff, FiUsers, FiActivity, FiUpload, FiDatabase, FiCpu } from 'react-icons/fi';

let _meshInstance = null;

export function MeshPanel() {
  const { connectedChains, activeNetwork } = useNode();
  const [meshStatus, setMeshStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const statusPollRef = useRef(null);

  const handleStatusChange = useCallback((status, data) => {
    setMeshStatus(data);
    setRunning(status === 'online');
  }, []);

  const startMesh = useCallback(async () => {
    if (_meshInstance) {
      await _meshInstance.stop();
    }
    _meshInstance = new DesktopMeshNode(activeNetwork);
    _meshInstance.onStatusChange = handleStatusChange;
    await _meshInstance.start(connectedChains);
    setRunning(true);
    setMeshStatus(_meshInstance.getStatus());
  }, [activeNetwork, connectedChains, handleStatusChange]);

  const stopMesh = useCallback(async () => {
    if (_meshInstance) {
      await _meshInstance.stop();
      _meshInstance = null;
    }
    setRunning(false);
    setMeshStatus(null);
  }, []);

  // Poll status while running
  useEffect(() => {
    if (running && _meshInstance) {
      statusPollRef.current = setInterval(() => {
        setMeshStatus(_meshInstance.getStatus());
      }, 5000);
    }
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, [running]);

  // Update chains when they change
  useEffect(() => {
    if (_meshInstance && running) {
      _meshInstance.updateConnectedChains(connectedChains);
    }
  }, [connectedChains, running]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (_meshInstance) {
        _meshInstance.stop();
        _meshInstance = null;
      }
    };
  }, []);

  const stats = meshStatus?.stats || {};

  return (
    <div className="p-3 space-y-3" data-testid="mesh-panel">
      {/* Header + Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {running ? (
            <FiWifi size={14} className="text-emerald-400" />
          ) : (
            <FiWifiOff size={14} className="text-gray-500" />
          )}
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Mesh Network</span>
        </div>
        <button
          onClick={running ? stopMesh : startMesh}
          disabled={connectedChains.length === 0 && !running}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
            running
              ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          data-testid="mesh-toggle-btn"
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Status Card */}
      {running && meshStatus && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ backgroundColor: 'rgba(255,255,255,0.01)', borderColor: 'rgba(52,211,153,0.15)' }}
        >
          {/* Node ID */}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"
                  style={{ boxShadow: '0 0 6px rgba(52,211,153,0.6)' }} />
            <span className="text-[10px] text-gray-400 font-mono truncate">
              {meshStatus.nodeId}
            </span>
          </div>

          {/* Chains */}
          <div className="flex items-center gap-1 flex-wrap">
            {(meshStatus.chains || []).map(c => (
              <span key={c} className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-white/[0.04] text-gray-300">
                {c}
              </span>
            ))}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-1.5">
            <StatBox icon={<FiUsers size={11} />} label="Peers" value={meshStatus.peers || 0} max={meshStatus.maxPeers} />
            <StatBox icon={<FiUpload size={11} />} label="Relayed" value={formatBytes(stats.bytesRelayed || 0)} />
            <StatBox icon={<FiActivity size={11} />} label="Requests" value={stats.requestsServed || 0} />
            <StatBox icon={<FiDatabase size={11} />} label="Blockchain" value={stats.blockchainQueries || 0} />
            <StatBox icon={<FiCpu size={11} />} label="Index" value={stats.indexQueries || 0} />
            <StatBox icon={<FiWifi size={11} />} label="IPFS" value={stats.ipfsServed || 0} />
          </div>

          {/* Services */}
          <div className="pt-1 border-t border-white/[0.04]">
            <p className="text-[9px] text-gray-500 mb-1">SERVING</p>
            <div className="flex flex-wrap gap-1">
              {(meshStatus.services || []).map(s => (
                <span key={s} className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/10">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Offline state */}
      {!running && (
        <div className="text-center py-3">
          <FiWifiOff size={20} className="mx-auto mb-1.5 text-gray-600" />
          <p className="text-[11px] text-gray-500">
            {connectedChains.length === 0
              ? 'Connect a wallet to join the mesh'
              : 'Start to broadcast as a master node'
            }
          </p>
        </div>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, max }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-white/[0.02]">
      <span className="text-gray-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-500 leading-none">{label}</p>
        <p className="text-[11px] text-gray-200 font-medium leading-tight">
          {value}{max !== undefined && <span className="text-gray-500">/{max}</span>}
        </p>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default MeshPanel;
