/**
 * useMeshRelay — React hook for managing the P2P mesh relay.
 *
 * Two entry points:
 *   useMeshRelayInit(network) — side effects only, no re-renders (for Layout)
 *   useMeshRelay(network) — full hook with state subscription (for Settings UI)
 *
 * Node mode state is persisted in localStorage. MeshNode/MeshClient
 * are global singletons shared across all callers.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MeshNode, MeshClient,
  setGlobalMeshClient, setGlobalMeshNode,
} from '@/utils/meshRelay';
import { useAuth } from '@/hooks/useAuth';

const API = process.env.REACT_APP_BACKEND_URL;
const STORAGE_KEY = 'cthulhu_node_mode';

// ── Global state shared across all hook instances ──
let _nodeInstance = null;
let _clientInstance = null;
let _nodeMode = localStorage.getItem(STORAGE_KEY) === 'true';
let _nodeStatus = null;
let _listeners = new Set();
let _onInkNotifyGlobal = null;

/** Register a global callback for ink notifications from mesh peers. */
export function setOnInkNotify(fn) { _onInkNotifyGlobal = fn; }

let _notifyTimer = null;
function notifyListeners() {
  // Throttle: at most once per 2 seconds to avoid rapid re-renders
  if (_notifyTimer) return;
  _notifyTimer = setTimeout(() => {
    _notifyTimer = null;
    _listeners.forEach(fn => fn());
  }, 2000);
}
function notifyImmediate() {
  if (_notifyTimer) { clearTimeout(_notifyTimer); _notifyTimer = null; }
  _listeners.forEach(fn => fn());
}

/**
 * useMeshRelayInit — Side effects only, NO state subscription.
 * Use in Layout/App.js to auto-restore node mode and connect client
 * WITHOUT causing re-renders on status changes.
 */
export function useMeshRelayInit(network) {
  const { user, isConnected } = useAuth();
  const address = user?.address;
  const urn = user?.urn;
  const initRef = useRef(false);
  const clientRef = useRef(null);

  // Auto-restore node mode on mount
  useEffect(() => {
    if (initRef.current) return;
    if (!address || !isConnected || !network) return;
    initRef.current = true;

    if (_nodeMode && !_nodeInstance) {
      const node = new MeshNode(address, network, urn);
      node.onStatusChange = (status, details) => {
        _nodeStatus = details || { online: status === 'online' };
        notifyListeners();
      };
      // Wire ink notification callback
      node._onInkNotify = (msg) => {
        if (_onInkNotifyGlobal) _onInkNotifyGlobal(msg);
      };
      _nodeInstance = node;
      setGlobalMeshNode(node);
      node.start();
    }
  }, [address, network, urn, isConnected]);

  // Auto-connect as client when not in node mode
  useEffect(() => {
    if (!address || !isConnected || _nodeMode) return;
    if (clientRef.current) return;

    let cancelled = false;
    (async () => {
      const client = new MeshClient(address, network);
      clientRef.current = client;
      _clientInstance = client;
      setGlobalMeshClient(client);
      const connected = await client.connect();
      if (cancelled || !connected) {
        if (!cancelled) { setGlobalMeshClient(null); _clientInstance = null; }
      }
    })();

    return () => {
      cancelled = true;
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
        _clientInstance = null;
        setGlobalMeshClient(null);
      }
    };
  }, [address, network, isConnected]);
}

/**
 * useMeshRelay — Full hook with state subscription for UI display.
 * Use in SettingsModal to show node status, toggle, and stats.
 */
export function useMeshRelay(network) {
  const { user, isConnected } = useAuth();
  const address = user?.address;
  const urn = user?.urn;

  const [nodeMode, setNodeModeLocal] = useState(_nodeMode);
  const [nodeStatus, setNodeStatusLocal] = useState(_nodeStatus);
  const [meshStats, setMeshStats] = useState(null);
  const statsTimerRef = useRef(null);

  // Subscribe to global state changes (only this hook re-renders, not Layout)
  useEffect(() => {
    const handler = () => {
      setNodeModeLocal(_nodeMode);
      setNodeStatusLocal(_nodeStatus);
    };
    _listeners.add(handler);
    // Sync immediately
    handler();
    return () => { _listeners.delete(handler); };
  }, []);

  // Fetch mesh stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/mesh/stats?network=${network}`);
      if (res.ok) setMeshStats(await res.json());
    } catch {}
  }, [network]);

  useEffect(() => {
    fetchStats();
    statsTimerRef.current = setInterval(fetchStats, 30_000);
    return () => clearInterval(statsTimerRef.current);
  }, [fetchStats]);

  // Enable node mode
  const enableNodeMode = useCallback(async () => {
    if (!address || !isConnected || _nodeInstance) return;

    const node = new MeshNode(address, network, urn);
    node.onStatusChange = (status, details) => {
      _nodeStatus = details || { online: status === 'online' };
      notifyListeners();
    };
    node._onInkNotify = (msg) => {
      if (_onInkNotifyGlobal) _onInkNotifyGlobal(msg);
    };
    _nodeInstance = node;
    setGlobalMeshNode(node);
    await node.start();

    _nodeMode = true;
    _nodeStatus = node.getStatus();
    localStorage.setItem(STORAGE_KEY, 'true');
    notifyImmediate();
    fetchStats();
  }, [address, network, urn, isConnected, fetchStats]);

  // Disable node mode
  const disableNodeMode = useCallback(async () => {
    if (_nodeInstance) {
      await _nodeInstance.stop();
      _nodeInstance = null;
      setGlobalMeshNode(null);
    }
    _nodeMode = false;
    _nodeStatus = null;
    localStorage.setItem(STORAGE_KEY, 'false');
    notifyImmediate();
    fetchStats();
  }, [fetchStats]);

  const toggleNodeMode = useCallback(async () => {
    if (_nodeMode) await disableNodeMode();
    else await enableNodeMode();
  }, [enableNodeMode, disableNodeMode]);

  return {
    nodeMode,
    toggleNodeMode,
    nodeStatus,
    meshClient: _clientInstance,
    meshStats,
    refreshStats: fetchStats,
  };
}
