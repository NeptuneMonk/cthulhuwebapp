/**
 * MeshClient — connects to a relay node to fetch content peer-to-peer.
 *
 * Discovers the best available node via latency probing and scoring,
 * connects via WebRTC, and provides fetch methods for IPFS, API cache,
 * and URN content. Includes auto-failover and reconnection.
 */

const API = process.env.REACT_APP_BACKEND_URL;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export class MeshClient {
  constructor(myAddress, network) {
    this.myAddress = myAddress;
    this.network = network;
    this.ws = null;
    this.pc = null;
    this.channel = null;
    this.connected = false;
    this.connectedNode = null;
    this._pendingRequests = new Map();
    this._requestId = 0;
    this._receivingBinary = null;
    this._nodeScores = new Map();
    this._failedNodes = new Set();
    this._reconnecting = false;
    this._reconnectTimer = null;
  }

  // ─── Connection & Scoring ───

  async _probeLatency() {
    try {
      const start = performance.now();
      const res = await fetch(`${API}/api/mesh/nodes?network=${this.network}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return Infinity;
      return performance.now() - start;
    } catch {
      return Infinity;
    }
  }

  _scoreNode(node, latency) {
    const capacityRemaining = Math.max(0, node.capacity - node.active_peers);
    const capacityScore = capacityRemaining * 20;
    const latencyScore = Math.max(0, 200 - latency);
    const failurePenalty = (this._nodeScores.get(node.address)?.failures || 0) * 50;
    return capacityScore + latencyScore - failurePenalty;
  }

  async connect() {
    try {
      const res = await fetch(`${API}/api/mesh/nodes?network=${this.network}`);
      if (!res.ok) return false;
      const { nodes } = await res.json();

      const available = nodes.filter(n =>
        n.address !== this.myAddress &&
        n.active_peers < n.capacity &&
        !this._failedNodes.has(n.address)
      );
      if (available.length === 0) {
        if (this._failedNodes.size > 0) {
          this._failedNodes.clear();
          return this.connect();
        }
        return false;
      }

      const candidates = available
        .sort((a, b) => (b.capacity - b.active_peers) - (a.capacity - a.active_peers))
        .slice(0, 3);

      const scored = await Promise.all(candidates.map(async (node) => {
        const latency = await this._probeLatency(node);
        const score = this._scoreNode(node, latency);
        this._nodeScores.set(node.address, {
          latency, score,
          failures: this._nodeScores.get(node.address)?.failures || 0,
          lastSeen: Date.now(),
        });
        return { node, score, latency };
      }));

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0]?.node;
      if (!best) return false;

      // Connect signaling WebSocket
      const wsBase = API.replace(/^http/, 'ws');
      this.ws = new WebSocket(`${wsBase}/api/mesh/signal/${this.myAddress}`);

      await new Promise((resolve, reject) => {
        this.ws.onopen = () => {
          this._wsPingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              try { this.ws.send(JSON.stringify({ type: 'pong' })); } catch {}
            }
          }, 15_000);
          resolve();
        };
        this.ws.onerror = reject;
        setTimeout(reject, 5000);
      });

      // Create WebRTC peer connection + data channel
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.channel = this.pc.createDataChannel('mesh-relay', { ordered: true });

      this.channel.onopen = () => {
        this.connected = true;
        this.connectedNode = best;
        const prev = this._nodeScores.get(best.address);
        if (prev) prev.failures = 0;
      };

      this.channel.onmessage = (e) => this._handleMessage(e.data);
      this.channel.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.connectedNode = null;
        if (wasConnected && !this._reconnecting) {
          this._onNodeFailure(best.address);
        }
      };

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            to: best.address,
            type: 'ice-candidate',
            payload: JSON.stringify(event.candidate),
          }));
        }
      };

      this._iceCandidateQueue = [];
      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ping') return;
          if (msg.type === 'answer') {
            if (this.pc.signalingState !== 'have-local-offer') return;
            await this.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)));
            for (const c of this._iceCandidateQueue) {
              try { await this.pc.addIceCandidate(c); } catch {}
            }
            this._iceCandidateQueue = [];
          } else if (msg.type === 'ice-candidate') {
            const candidate = new RTCIceCandidate(JSON.parse(msg.payload));
            if (!this.pc.remoteDescription) {
              this._iceCandidateQueue.push(candidate);
            } else {
              try { await this.pc.addIceCandidate(candidate); } catch {}
            }
          }
        } catch (e) {
          console.warn('[MeshClient] Signal handling error:', e.message);
        }
      };

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.ws.send(JSON.stringify({
        to: best.address,
        type: 'offer',
        payload: JSON.stringify(offer),
      }));

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
        this.channel.onopen = () => { clearTimeout(timer); this.connected = true; this.connectedNode = best; resolve(); };
      });

      console.log(`[MeshClient] Connected to ${best.urn || best.address.slice(0, 12)} (score: ${scored[0].score.toFixed(0)}, latency: ${scored[0].latency.toFixed(0)}ms)`);
      return true;
    } catch {
      this.disconnect();
      return false;
    }
  }

  // ─── Failover & Reconnect ───

  _onNodeFailure(nodeAddr) {
    this._failedNodes.add(nodeAddr);
    const prev = this._nodeScores.get(nodeAddr) || { failures: 0 };
    prev.failures = (prev.failures || 0) + 1;
    this._nodeScores.set(nodeAddr, prev);
    console.warn(`[MeshClient] Node ${nodeAddr.slice(0, 12)} failed (failures: ${prev.failures}). Auto-reconnecting...`);
    this._autoReconnect();
  }

  _autoReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    const attempt = async (delay) => {
      this.disconnect();
      await new Promise(r => { this._reconnectTimer = setTimeout(r, delay); });
      const ok = await this.connect();
      if (ok) {
        this._reconnecting = false;
        console.log('[MeshClient] Auto-reconnect succeeded.');
      } else if (delay < 30_000) {
        attempt(Math.min(delay * 2, 30_000));
      } else {
        this._reconnecting = false;
        console.warn('[MeshClient] Auto-reconnect exhausted.');
      }
    };
    attempt(2000);
  }

  disconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._wsPingTimer) clearInterval(this._wsPingTimer);
    if (this.channel) try { this.channel.close(); } catch {}
    if (this.pc) try { this.pc.close(); } catch {}
    if (this.ws) try { this.ws.close(); } catch {}
    this.connected = false;
    this.connectedNode = null;
    this.channel = null;
    this.pc = null;
    this.ws = null;
    this._wsPingTimer = null;
  }

  // ─── Content Fetching ───

  async fetchIpfs(cid, timeoutMs = 15000) {
    if (!this.connected || !this.channel) return null;
    const id = ++this._requestId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        resolve(null);
      }, timeoutMs);
      this._pendingRequests.set(id, { resolve, timer, chunks: 0, totalChunks: 0, buffers: [], size: 0 });
      this.channel.send(JSON.stringify({ id, type: 'ipfs', key: cid }));
    });
  }

  async fetchApi(path, timeoutMs = 10000) {
    if (!this.connected || !this.channel) return null;
    const id = ++this._requestId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        resolve(null);
      }, timeoutMs);
      this._pendingRequests.set(id, { resolve, timer });
      this.channel.send(JSON.stringify({ id, type: 'api', key: path }));
    });
  }

  async fetchUrn(urn, timeoutMs = 8000) {
    if (!this.connected || !this.channel) return null;
    const id = ++this._requestId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        resolve(null);
      }, timeoutMs);
      this._pendingRequests.set(id, {
        resolve, timer, isUrn: true,
        chunks: 0, totalChunks: 0, buffers: [], size: 0, meta: null, hasBlob: false,
      });
      this.channel.send(JSON.stringify({ id, type: 'urn', key: urn }));
    });
  }

  // ─── Message Handling ───

  _handleMessage(data) {
    if (data instanceof ArrayBuffer || data instanceof Blob) {
      this._handleBinaryChunk(data);
      return;
    }
    try {
      const msg = JSON.parse(data);
      if (msg.error) {
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingRequests.delete(msg.id);
          pending.resolve(null);
        }
        return;
      }
      if (msg.type === 'ipfs-response') {
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          pending.totalChunks = msg.chunks;
          pending.size = msg.size;
          pending.buffers = [];
          pending.chunks = 0;
          this._receivingBinary = msg.id;
        }
      } else if (msg.type === 'api-response') {
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingRequests.delete(msg.id);
          try { pending.resolve(JSON.parse(msg.data)); } catch { pending.resolve(msg.data); }
        }
      } else if (msg.type === 'urn-response') {
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          pending.meta = msg.meta;
          pending.hasBlob = msg.hasBlob;
          if (!msg.hasBlob) {
            clearTimeout(pending.timer);
            this._pendingRequests.delete(msg.id);
            pending.resolve({ meta: msg.meta, data: null });
          } else {
            pending.totalChunks = msg.chunks;
            pending.size = msg.size;
            pending.buffers = [];
            pending.chunks = 0;
            this._receivingBinary = msg.id;
          }
        }
      } else if (msg.type === 'room_message') {
        if (this._onRoomMessage) this._onRoomMessage(msg);
      } else if (msg.type === 'gossip_notify') {
        if (this._onGossipNotify) this._onGossipNotify(msg);
      }
    } catch {}
  }

  async _handleBinaryChunk(data) {
    if (this._receivingBinary === null) return;
    const pending = this._pendingRequests.get(this._receivingBinary);
    if (!pending) { this._receivingBinary = null; return; }
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    pending.buffers.push(buffer);
    pending.chunks++;
    if (pending.chunks >= pending.totalChunks) {
      const total = new Uint8Array(pending.size);
      let offset = 0;
      for (const buf of pending.buffers) {
        total.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      clearTimeout(pending.timer);
      this._pendingRequests.delete(this._receivingBinary);
      this._receivingBinary = null;
      if (pending.isUrn) {
        pending.resolve({ meta: pending.meta, data: total.buffer });
      } else {
        pending.resolve(total.buffer);
      }
    }
  }

  // ─── Status & Broadcasting ───

  getStatus() {
    return {
      connected: this.connected,
      node: this.connectedNode ? {
        address: this.connectedNode.address,
        urn: this.connectedNode.urn,
      } : null,
      reconnecting: this._reconnecting,
      failedNodes: this._failedNodes.size,
      scoredNodes: this._nodeScores.size,
      currentLatency: this.connectedNode
        ? this._nodeScores.get(this.connectedNode.address)?.latency?.toFixed(0)
        : null,
    };
  }

  setOnRoomMessage(cb) { this._onRoomMessage = cb; }
  setOnGossipNotify(cb) { this._onGossipNotify = cb; }

  sendRoomMessage(msg) {
    if (!this.connected || !this.channel || this.channel.readyState !== 'open') return false;
    try { this.channel.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  sendGossipNotify(msg) {
    if (!this.connected || !this.channel || this.channel.readyState !== 'open') return false;
    try { this.channel.send(JSON.stringify({ ...msg, type: 'gossip_notify' })); return true; } catch { return false; }
  }
}
