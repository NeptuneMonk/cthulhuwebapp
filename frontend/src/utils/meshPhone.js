/**
 * meshPhone.js — Singleton mesh phone signaling.
 *
 * CRITICAL ARCHITECTURE: Only ONE WebSocket connection per address is
 * maintained, regardless of how many components call createMeshPhone().
 * The backend evicts older connections for the same address (mesh.py),
 * so multiple simultaneous WS connections cause an infinite reconnect loop.
 *
 * Each call to createMeshPhone() returns a lightweight "handle" that
 * registers its own callbacks on the shared connection. Messages are
 * fan-out dispatched to all active handles.
 */
import { getGlobalMeshNode } from '@/utils/meshRelay';

const API = process.env.REACT_APP_BACKEND_URL;

// ─── Shared connection pool (one WS per address) ─────────────────
const _pool = new Map(); // address → SharedConnection

function _ensureShared(address, network) {
  if (_pool.has(address)) return _pool.get(address);
  const shared = {
    address,
    network,
    ws: null,
    pingTimer: null,
    reconnectTimer: null,
    checkTimer: null,
    usingMeshNode: false,
    alive: false,
    refCount: 0,
    dispatchers: new Set(),
  };
  _pool.set(address, shared);
  return shared;
}

function _broadcastToDispatchers(shared, msg) {
  for (const dispatch of shared.dispatchers) {
    try { dispatch(msg); } catch {}
  }
}

function _tryAttachToMeshNode(shared) {
  const node = getGlobalMeshNode();
  if (node?._running && node?.ws?.readyState === WebSocket.OPEN) {
    node._phoneDispatch = (msg) => _broadcastToDispatchers(shared, msg);
    shared.usingMeshNode = true;
    return true;
  }
  return false;
}

function _connectSharedWs(shared) {
  if (!shared.alive || shared.usingMeshNode) return;
  // Don't create a new WS if one is already open or connecting
  if (shared.ws && (shared.ws.readyState === WebSocket.OPEN || shared.ws.readyState === WebSocket.CONNECTING)) return;

  const wsBase = API.replace(/^http/, 'ws');
  try {
    shared.ws = new WebSocket(`${wsBase}/api/mesh/signal/${shared.address}`);
  } catch { return; }

  shared.ws.onopen = () => {
    if (shared.pingTimer) clearInterval(shared.pingTimer);
    shared.pingTimer = setInterval(() => {
      if (shared.ws?.readyState === WebSocket.OPEN) {
        try { shared.ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      }
    }, 15000);
  };

  shared.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'ping') return;
      _broadcastToDispatchers(shared, msg);
    } catch {}
  };

  shared.ws.onclose = () => {
    if (shared.pingTimer) { clearInterval(shared.pingTimer); shared.pingTimer = null; }
    shared.ws = null;
    if (shared.alive && !shared.usingMeshNode) {
      shared.reconnectTimer = setTimeout(() => _connectSharedWs(shared), 5000);
    }
  };

  shared.ws.onerror = () => {};
}

function _startSharedConnection(shared) {
  // Cancel any pending teardown from the grace period
  if (shared._teardownTimer) {
    clearTimeout(shared._teardownTimer);
    shared._teardownTimer = null;
  }
  if (shared.alive) return; // Already running
  shared.alive = true;

  if (!_tryAttachToMeshNode(shared)) {
    _connectSharedWs(shared);
  }

  // Periodically check if mesh node becomes available
  if (shared.checkTimer) clearInterval(shared.checkTimer);
  shared.checkTimer = setInterval(() => {
    if (!shared.usingMeshNode && _tryAttachToMeshNode(shared)) {
      // Mesh node started — close standalone WS
      if (shared.ws) { try { shared.ws.close(); } catch {} shared.ws = null; }
    } else if (shared.usingMeshNode) {
      const node = getGlobalMeshNode();
      if (!node?._running || node?.ws?.readyState !== WebSocket.OPEN) {
        shared.usingMeshNode = false;
        _connectSharedWs(shared);
      }
    }
  }, 5000);
}

function _stopSharedConnection(shared) {
  // Grace period: delay teardown to handle page transitions where
  // one consumer disconnects briefly before another connects.
  if (shared._teardownTimer) clearTimeout(shared._teardownTimer);
  shared._teardownTimer = setTimeout(() => {
    shared._teardownTimer = null;
    if (shared.refCount > 0) return; // Someone reconnected during grace period
    shared.alive = false;
    shared.usingMeshNode = false;
    if (shared.pingTimer) clearInterval(shared.pingTimer);
    if (shared.reconnectTimer) clearTimeout(shared.reconnectTimer);
    if (shared.checkTimer) clearInterval(shared.checkTimer);
    shared.pingTimer = null;
    shared.reconnectTimer = null;
    shared.checkTimer = null;
    if (shared.ws) { try { shared.ws.close(); } catch {} shared.ws = null; }
    const node = getGlobalMeshNode();
    if (node) node._phoneDispatch = null;
    _pool.delete(shared.address);
  }, 3000);
}

function _getWs(shared) {
  const node = getGlobalMeshNode();
  if (node?._running && node?.ws?.readyState === WebSocket.OPEN) return node.ws;
  if (shared.ws?.readyState === WebSocket.OPEN) return shared.ws;
  return null;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a mesh phone signaling handle.
 * Internally shares a single WebSocket per address.
 * Safe to call from multiple components simultaneously.
 *
 * API is backward-compatible: each handle has its own setOnRing, etc.
 */
export function createMeshPhone(myAddress, network) {
  const shared = _ensureShared(myAddress, network);

  // Each consumer gets its own set of callbacks
  let _onRing = null;
  let _onAnswer = null;
  let _onDecline = null;
  let _onIce = null;
  let _onAudioRelay = null;
  let _connected = false;

  // This consumer's dispatch function (registered in shared.dispatchers)
  function _dispatch(msg) {
    if (msg.type === 'call-ring' && _onRing) {
      _onRing({
        from: msg.from,
        sdp: msg.payload?.sdp,
        callerInfo: msg.payload?.callerInfo,
        video: msg.payload?.video,
      });
    } else if (msg.type === 'call-answer' && _onAnswer) {
      _onAnswer({ from: msg.from, sdp: msg.payload?.sdp });
    } else if (msg.type === 'call-decline' && _onDecline) {
      _onDecline({ from: msg.from, reason: msg.payload?.reason });
    } else if (msg.type === 'call-ice' && _onIce) {
      _onIce({ from: msg.from, candidate: msg.payload?.candidate });
    } else if (msg.type === 'audio-relay' && _onAudioRelay) {
      _onAudioRelay({ from: msg.from, chunk: msg.payload?.chunk, seq: msg.payload?.seq });
    }
  }

  function connect() {
    if (_connected) return; // This handle already connected
    _connected = true;
    shared.dispatchers.add(_dispatch);
    shared.refCount++;
    _startSharedConnection(shared);
  }

  function disconnect() {
    if (!_connected) return; // Already disconnected
    _connected = false;
    shared.dispatchers.delete(_dispatch);
    shared.refCount--;
    if (shared.refCount <= 0) {
      _stopSharedConnection(shared);
    }
  }

  function _send(targetAddress, type, payload) {
    const ws = _getWs(shared);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ to: targetAddress, type, payload }));
    return true;
  }

  async function isTargetOnMesh(targetAddress) {
    try {
      const res = await fetch(`${API}/api/mesh/nodes?network=${shared.network}`);
      if (!res.ok) return false;
      const { nodes } = await res.json();
      return nodes.some(n => n.address === targetAddress);
    } catch { return false; }
  }

  return {
    connect,
    disconnect,
    isTargetOnMesh,
    sendRing: (targetAddress, sdp, callerInfo, video = false) =>
      _send(targetAddress, 'call-ring', { sdp, callerInfo, video }),
    sendAnswer: (targetAddress, sdp) =>
      _send(targetAddress, 'call-answer', { sdp }),
    sendDecline: (targetAddress, reason) =>
      _send(targetAddress, 'call-decline', { reason }),
    sendIce: (targetAddress, candidate) =>
      _send(targetAddress, 'call-ice', { candidate }),
    sendAudioChunk: (targetAddress, chunk, seq) =>
      _send(targetAddress, 'audio-relay', { chunk, seq }),
    setOnRing: (cb) => { _onRing = cb; },
    setOnAnswer: (cb) => { _onAnswer = cb; },
    setOnDecline: (cb) => { _onDecline = cb; },
    setOnIce: (cb) => { _onIce = cb; },
    setOnAudioRelay: (cb) => { _onAudioRelay = cb; },
    get isConnected() { return !!_getWs(shared); },
  };
}
