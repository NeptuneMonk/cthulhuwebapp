/**
 * MeshNode — P2P relay node that serves content to peers via WebRTC.
 *
 * Registers with the backend, connects via WebSocket signaling,
 * and serves IPFS, API cache, and URN content to connecting peers.
 */

const API = process.env.REACT_APP_BACKEND_URL;
const HEARTBEAT_INTERVAL = 30_000;
const MAX_PEERS = 5;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export class MeshNode {
  constructor(address, network, urn) {
    this.address = address;
    this.network = network;
    this.urn = urn;
    this.ws = null;
    this.heartbeatTimer = null;
    this.peers = new Map();
    this.cache = new Map();
    this.stats = { bytesRelayed: 0, requestsServed: 0, peersServed: 0 };
    this.onStatusChange = null;
    this._running = false;
  }

  // ─── Lifecycle ───

  async start() {
    if (this._running) return;
    this._running = true;
    await this._register();
    this._connectSignaling();
    this.heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_INTERVAL);
    setTimeout(() => this._discoverAndPeer(), 3000);
    this._peerDiscoveryTimer = setInterval(() => this._discoverAndPeer(), 45_000);
    if (this.onStatusChange) this.onStatusChange('online');
  }

  async stop() {
    this._running = false;
    try {
      await fetch(`${API}/api/mesh/deregister?address=${this.address}&network=${this.network}`, { method: 'POST' });
    } catch {}
    for (const [, peer] of this.peers) {
      try { peer.pc?.close(); } catch {}
    }
    this.peers.clear();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this._peerDiscoveryTimer) { clearInterval(this._peerDiscoveryTimer); this._peerDiscoveryTimer = null; }
    if (this._wsPingTimer) { clearInterval(this._wsPingTimer); this._wsPingTimer = null; }
    this._reportStats();
    if (this.onStatusChange) this.onStatusChange('offline');
  }

  // ─── Registration & Heartbeat ───

  async _register() {
    try {
      await fetch(`${API}/api/mesh/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.address,
          network: this.network,
          urn: this.urn,
          capacity: MAX_PEERS,
          bandwidth: 'normal',
          services: ['ipfs', 'api_cache'],
        }),
      });
    } catch (e) {
      console.warn('[MeshNode] Registration failed:', e.message);
    }
  }

  async _heartbeat() {
    try {
      await fetch(`${API}/api/mesh/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.address,
          network: this.network,
          capacity: MAX_PEERS - this.peers.size,
        }),
      });
    } catch {}
  }

  // ─── Signaling ───

  _connectSignaling() {
    const wsBase = API.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/api/mesh/signal/${this.address}`;
    try {
      this.ws = new WebSocket(wsUrl);
    } catch { return; }

    this.ws.onopen = () => {
      console.log('[MeshNode] Signaling connected');
      if (this._wsPingTimer) clearInterval(this._wsPingTimer);
      this._wsPingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try { this.ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        }
      }, 15_000);
      setTimeout(() => this._discoverAndPeer(), 2000);
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ping') return;
        if (msg.type?.startsWith('call-') && this._phoneDispatch) {
          this._phoneDispatch(msg);
          return;
        }
        if (msg.type === 'offer') {
          await this._handleOffer(msg.from, msg.payload);
        } else if (msg.type === 'answer') {
          await this._handleAnswer(msg.from, msg.payload);
        } else if (msg.type === 'ice-candidate') {
          await this._handleIceCandidate(msg.from, msg.payload);
        }
      } catch (e) {
        console.warn('[MeshNode] Signal handling error:', e.message);
      }
    };

    this.ws.onclose = () => {
      console.log('[MeshNode] Signaling disconnected');
      if (this._wsPingTimer) { clearInterval(this._wsPingTimer); this._wsPingTimer = null; }
      if (this._running) {
        setTimeout(() => this._connectSignaling(), 5000);
      }
    };

    this.ws.onerror = () => {};
  }

  // ─── Peer Discovery & WebRTC ───

  async _discoverAndPeer() {
    if (!this._running || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.peers.size >= MAX_PEERS) return;

    try {
      const res = await fetch(`${API}/api/mesh/nodes?network=${this.network}`);
      if (!res.ok) return;
      const { nodes } = await res.json();
      const candidates = nodes.filter(n =>
        n.address !== this.address &&
        !this.peers.has(n.address) &&
        n.active_peers < n.capacity
      );
      const slotsAvailable = MAX_PEERS - this.peers.size;
      const toConnect = candidates.slice(0, slotsAvailable);
      for (const node of toConnect) {
        await this._connectToPeer(node.address);
      }
      if (toConnect.length > 0) {
        console.log(`[MeshNode] Peered with ${toConnect.length} node(s):`, toConnect.map(n => (n.urn || n.address.slice(0, 12))).join(', '));
      }
    } catch (e) {
      console.warn('[MeshNode] Peer discovery failed:', e.message);
    }
  }

  async _connectToPeer(targetAddress) {
    if (this.peers.has(targetAddress)) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('mesh-relay', { ordered: true });
    const peer = { pc, channel, connected: false, _iceCandidateQueue: [] };
    this.peers.set(targetAddress, peer);

    channel.onopen = () => {
      peer.connected = true;
      this.stats.peersServed++;
      console.log(`[MeshNode] Data channel open with ${targetAddress.slice(0, 12)}...`);
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
    };
    channel.onmessage = (e) => this._handleDataMessage(targetAddress, e.data);
    channel.onclose = () => {
      this.peers.delete(targetAddress);
      console.log(`[MeshNode] Peer ${targetAddress.slice(0, 12)}... disconnected`);
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          to: targetAddress,
          type: 'ice-candidate',
          payload: JSON.stringify(event.candidate),
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.peers.delete(targetAddress);
        try { pc.close(); } catch {}
        if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws.send(JSON.stringify({
        to: targetAddress,
        type: 'offer',
        payload: JSON.stringify(offer),
      }));
    } catch (e) {
      console.warn(`[MeshNode] Failed to create offer for ${targetAddress.slice(0, 12)}:`, e.message);
      this.peers.delete(targetAddress);
      try { pc.close(); } catch {}
    }
  }

  async _handleOffer(fromAddress, offerSDP) {
    if (this.peers.size >= MAX_PEERS) return;
    const existing = this.peers.get(fromAddress);
    if (existing?.pc) {
      if (this.address < fromAddress && existing.pc.signalingState === 'have-local-offer') return;
      try { existing.pc.close(); } catch {}
      this.peers.delete(fromAddress);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pc, channel: null, connected: false, _iceCandidateQueue: [] };
    this.peers.set(fromAddress, peer);

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      peer.channel = channel;
      peer.connected = true;
      this.stats.peersServed++;
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
      channel.onmessage = (e) => this._handleDataMessage(fromAddress, e.data);
      channel.onclose = () => {
        this.peers.delete(fromAddress);
        if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          to: fromAddress,
          type: 'ice-candidate',
          payload: JSON.stringify(event.candidate),
        }));
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerSDP)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        to: fromAddress,
        type: 'answer',
        payload: JSON.stringify(answer),
      }));
    }
  }

  async _handleAnswer(fromAddress, answerSDP) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.pc) return;
    if (peer.pc.signalingState !== 'have-local-offer') return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(answerSDP)));
      if (peer._iceCandidateQueue) {
        for (const c of peer._iceCandidateQueue) {
          try { await peer.pc.addIceCandidate(c); } catch {}
        }
        peer._iceCandidateQueue = [];
      }
    } catch (e) {
      console.warn('[MeshNode] setRemoteDescription(answer) failed:', e.message);
    }
  }

  async _handleIceCandidate(fromAddress, candidateJSON) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.pc) return;
    const candidate = new RTCIceCandidate(JSON.parse(candidateJSON));
    if (!peer.pc.remoteDescription) {
      if (!peer._iceCandidateQueue) peer._iceCandidateQueue = [];
      peer._iceCandidateQueue.push(candidate);
    } else {
      try { await peer.pc.addIceCandidate(candidate); } catch {}
    }
  }

  // ─── Data Channel Message Handling ───

  _handleDataMessage(fromAddress, data) {
    try {
      if (typeof data === 'string' && data.length > 262144) return;
      const request = JSON.parse(data);
      if (!request.type || typeof request.type !== 'string') return;
      if (request.id !== undefined && typeof request.id !== 'number') return;

      if (request.type === 'ipfs') {
        this._serveIpfsContent(fromAddress, request);
      } else if (request.type === 'api') {
        this._serveApiCache(fromAddress, request);
      } else if (request.type === 'urn') {
        this._serveUrnContent(fromAddress, request);
      } else if (request.type === 'room_message') {
        this._relayRoomMessage(fromAddress, request);
      } else if (request.type === 'gossip_notify') {
        this._relayGossipNotify(fromAddress, request);
      } else if (request.type === 'ink_notify') {
        this._relayInkNotify(fromAddress, request);
      }
    } catch (e) {
      console.warn('[MeshNode] Bad data message:', e.message);
    }
  }

  _relayGossipNotify(fromAddress, msg) {
    const payload = JSON.stringify(msg);
    let delivered = false;
    for (const [addr, peer] of this.peers) {
      if (addr === fromAddress || !peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); delivered = true; } catch {}
    }
    if (this._onGossipNotify) this._onGossipNotify(msg);
    if (msg.to && !this.peers.has(msg.to) && !delivered) {
      import('@/utils/meshNotifications').then(({ postOfflineHint }) => {
        postOfflineHint(msg.to, msg.room, msg.sender, msg.senderUrn, this.network);
      }).catch(() => {});
    }
    this.stats.requestsServed++;
  }

  _relayRoomMessage(fromAddress, msg) {
    const payload = JSON.stringify(msg);
    for (const [addr, peer] of this.peers) {
      if (addr === fromAddress || !peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
    this.stats.bytesRelayed += payload.length;
    this.stats.requestsServed++;
    if (this._onRoomMessage) this._onRoomMessage(msg);
  }

  // ─── Content Serving ───

  async _serveIpfsContent(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const cid = request.key;
    if (!cid || typeof cid !== 'string' || cid.length < 10 || cid.length > 128 ||
        !/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z2-7]{50,})$/.test(cid)) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'invalid_cid' }));
      return;
    }

    const cacheKey = `ipfs:${cid}`;
    const cached = this.cache.get(cacheKey);

    let blob;
    if (cached && Date.now() - cached.timestamp < 3600_000) {
      blob = cached.data;
    } else {
      try {
        const { getPinnedContent, recordAccess } = await import('@/components/PinningManager');
        const pinned = await getPinnedContent(request.key);
        if (pinned) {
          blob = pinned;
          recordAccess(request.key).catch(() => {});
        }
      } catch {}

      if (!blob) {
        try {
          const res = await fetch(`${API}/api/ipfs/cat/${cid}`);
          if (!res.ok) {
            peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
            return;
          }
          blob = await res.arrayBuffer();
          this.cache.set(cacheKey, { data: blob, timestamp: Date.now() });
        } catch {
          peer.channel.send(JSON.stringify({ id: request.id, error: 'fetch_failed' }));
          return;
        }
      }
    }

    const CHUNK_SIZE = 16384;
    const totalChunks = Math.ceil(blob.byteLength / CHUNK_SIZE);

    peer.channel.send(JSON.stringify({
      id: request.id,
      type: 'ipfs-response',
      size: blob.byteLength,
      chunks: totalChunks,
    }));

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, blob.byteLength);
      peer.channel.send(blob.slice(start, end));
    }

    this.stats.bytesRelayed += blob.byteLength;
    this.stats.requestsServed++;
  }

  async _serveApiCache(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const allowedPrefixes = [
      '/api/feed', '/api/objects/', '/api/profiles/', '/api/profile/',
      '/api/posts/', '/api/network/', '/api/onchain/',
    ];
    const requestPath = request.key;
    if (!requestPath || !allowedPrefixes.some(p => requestPath.startsWith(p))) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'forbidden' }));
      return;
    }

    const cacheKey = `api:${requestPath}`;
    const cached = this.cache.get(cacheKey);

    let jsonData;
    if (cached && Date.now() - cached.timestamp < 60_000) {
      jsonData = cached.data;
    } else {
      try {
        const res = await fetch(`${API}${requestPath}`);
        if (!res.ok) {
          peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
          return;
        }
        jsonData = await res.text();
        if (jsonData.length > 5_000_000) {
          peer.channel.send(JSON.stringify({ id: request.id, error: 'response_too_large' }));
          return;
        }
        this.cache.set(cacheKey, { data: jsonData, timestamp: Date.now() });
      } catch {
        peer.channel.send(JSON.stringify({ id: request.id, error: 'fetch_failed' }));
        return;
      }
    }

    const responsePayload = JSON.stringify({ id: request.id, type: 'api-response', data: jsonData });
    peer.channel.send(responsePayload);
    this.stats.bytesRelayed += responsePayload.length;
    this.stats.requestsServed++;
  }

  async _serveUrnContent(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const urn = request.key;
    if (!urn || typeof urn !== 'string' || urn.length > 256) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'invalid_urn' }));
      return;
    }

    const cacheKey = `urn:${urn}`;
    const cached = this.cache.get(cacheKey);

    if (!cached || Date.now() - cached.timestamp > 300_000) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
      return;
    }

    const meta = cached.meta || {};
    const hasBlob = !!(cached.data);
    const blobSize = hasBlob ? cached.data.byteLength : 0;
    const CHUNK_SIZE = 16384;
    const totalChunks = hasBlob ? Math.ceil(blobSize / CHUNK_SIZE) : 0;

    peer.channel.send(JSON.stringify({
      id: request.id,
      type: 'urn-response',
      urn,
      meta,
      hasBlob,
      size: blobSize,
      chunks: totalChunks,
    }));

    if (hasBlob) {
      const blob = cached.data;
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, blobSize);
        peer.channel.send(blob.slice(start, end));
      }
      this.stats.bytesRelayed += blobSize;
    }

    this.stats.requestsServed++;
  }

  async _reportStats() {
    if (this.stats.bytesRelayed === 0) return;
    try {
      await fetch(`${API}/api/mesh/relay-stat?address=${this.address}&bytes_relayed=${this.stats.bytesRelayed}&network=${this.network}`, { method: 'POST' });
    } catch {}
  }

  // ─── Fetch FROM Peers (Node-to-Node) ───

  async fetchFromPeers(cid, timeoutMs = 10000) {
    for (const [, peer] of this.peers) {
      if (!peer.channel || peer.channel.readyState !== 'open') continue;
      try {
        const result = await this._fetchFromSinglePeer(peer, cid, timeoutMs);
        if (result) return result;
      } catch {}
    }
    return null;
  }

  _fetchFromSinglePeer(peer, cid, timeoutMs) {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      let totalChunks = 0;
      let expectedSize = 0;
      let receivedChunks = 0;
      let buffers = [];
      let headerReceived = false;

      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); peer.channel.removeEventListener('message', handler); };

      const handler = (event) => {
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          if (!headerReceived) return;
          const buf = event.data instanceof Blob
            ? event.data.arrayBuffer().then(ab => { processChunk(ab); })
            : processChunk(event.data);
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.id !== id) return;
          if (msg.error) { cleanup(); resolve(null); return; }
          if (msg.type === 'ipfs-response') {
            headerReceived = true;
            totalChunks = msg.chunks;
            expectedSize = msg.size;
            buffers = [];
            receivedChunks = 0;
          }
        } catch {}
      };

      const processChunk = (buf) => {
        buffers.push(buf);
        receivedChunks++;
        if (receivedChunks >= totalChunks) {
          cleanup();
          const total = new Uint8Array(expectedSize);
          let offset = 0;
          for (const b of buffers) { total.set(new Uint8Array(b), offset); offset += b.byteLength; }
          resolve(total.buffer);
        }
      };

      peer.channel.addEventListener('message', handler);
      peer.channel.send(JSON.stringify({ id, type: 'ipfs', key: cid }));
    });
  }

  async fetchUrnFromPeers(urn, timeoutMs = 8000) {
    for (const [, peer] of this.peers) {
      if (!peer.channel || peer.channel.readyState !== 'open') continue;
      try {
        const result = await this._fetchUrnFromSinglePeer(peer, urn, timeoutMs);
        if (result) return result;
      } catch {}
    }
    return null;
  }

  _fetchUrnFromSinglePeer(peer, urn, timeoutMs) {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      let totalChunks = 0;
      let expectedSize = 0;
      let receivedChunks = 0;
      let buffers = [];
      let headerReceived = false;
      let meta = null;
      let hasBlob = false;

      const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); peer.channel.removeEventListener('message', handler); };

      const handler = (event) => {
        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          if (!headerReceived || !hasBlob) return;
          const processBuf = (buf) => {
            buffers.push(buf);
            receivedChunks++;
            if (receivedChunks >= totalChunks) {
              cleanup();
              const total = new Uint8Array(expectedSize);
              let offset = 0;
              for (const b of buffers) { total.set(new Uint8Array(b), offset); offset += b.byteLength; }
              resolve({ meta, data: total.buffer });
            }
          };
          if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(processBuf);
          } else {
            processBuf(event.data);
          }
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.id !== id) return;
          if (msg.error) { cleanup(); resolve(null); return; }
          if (msg.type === 'urn-response') {
            headerReceived = true;
            meta = msg.meta;
            hasBlob = msg.hasBlob;
            totalChunks = msg.chunks || 0;
            expectedSize = msg.size || 0;
            if (!hasBlob) {
              cleanup();
              resolve({ meta, data: null });
            }
          }
        } catch {}
      };

      peer.channel.addEventListener('message', handler);
      peer.channel.send(JSON.stringify({ id, type: 'urn', key: urn }));
    });
  }

  // ─── Status & Broadcasting ───

  getStatus() {
    return {
      online: this._running,
      peers: this.peers.size,
      maxPeers: MAX_PEERS,
      bytesRelayed: this.stats.bytesRelayed,
      requestsServed: this.stats.requestsServed,
      peersServed: this.stats.peersServed,
      cacheSize: this.cache.size,
    };
  }

  setOnRoomMessage(cb) { this._onRoomMessage = cb; }
  setOnGossipNotify(cb) { this._onGossipNotify = cb; }

  broadcastRoomMessage(msg) {
    const payload = JSON.stringify(msg);
    for (const [, peer] of this.peers) {
      if (!peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
  }

  broadcastGossipNotify(msg) {
    const payload = JSON.stringify({ ...msg, type: 'gossip_notify' });
    for (const [, peer] of this.peers) {
      if (!peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
  }

  /**
   * Broadcast an ink (object mint) notification to all connected peers.
   * Sends all IPFS CIDs from the object so peers can pin every file.
   */
  broadcastInk({ cids, objectUrn, objectAddress, senderUrn, senderAddress, image, network }) {
    const msg = {
      type: 'ink_notify', cids: cids || [], objectUrn, objectAddress,
      sender: senderAddress, senderUrn, image, network,
      ts: Date.now(),
    };
    const payload = JSON.stringify(msg);
    for (const [, peer] of this.peers) {
      if (!peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
  }

  _relayInkNotify(fromAddress, msg) {
    // Relay to all peers except sender
    const payload = JSON.stringify(msg);
    for (const [addr, peer] of this.peers) {
      if (addr === fromAddress || !peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
    // Notify the UI
    if (this._onInkNotify) this._onInkNotify(msg);
    this.stats.requestsServed++;
  }
}
