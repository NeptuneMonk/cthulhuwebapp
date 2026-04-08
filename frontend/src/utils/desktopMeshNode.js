/**
 * DesktopMeshNode — Master node that joins the Cthulhu mesh network.
 *
 * Desktop-only. Extends the same WebRTC mesh protocol used by the web app's
 * MeshNode, but registers as a "master" node with enhanced capabilities:
 *   - Serves blockchain data (raw txs, UTXOs, blocks) from local Core Wallets
 *   - Serves P2FK index data from the local chain scanner
 *   - Serves IPFS content from the local Kubo daemon
 *   - Serves API cache and feed data
 *
 * Uses the SAME signaling server (/api/mesh/signal/) and the SAME mesh
 * registry (/api/mesh/register) as web app nodes. Desktop nodes are
 * distinguished by their `services` list and higher capacity.
 *
 * Web app peers discover desktop master nodes via /api/mesh/nodes and
 * can request data over WebRTC data channels. No web app code changes needed.
 *
 * Protocol: all data channel messages are JSON with { type, id, key, ... }
 * New desktop-only request types:
 *   - "blockchain"  → { chain, method, params }  (proxied to Core Wallet RPC)
 *   - "p2fk_index"  → { query_type, params }     (local P2FK index lookup)
 *   - "ipfs"        → { key: CID }               (local Kubo or gateway)
 *   - "api"         → { key: "/api/..." }         (cached API responses)
 */

const API = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';
const HEARTBEAT_INTERVAL = 30_000;
const MAX_PEERS = 10;         // Desktop can handle more peers
const STATS_REPORT_INTERVAL = 120_000;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// Services this desktop node provides to the mesh
const DESKTOP_SERVICES = ['ipfs', 'api_cache', 'feed', 'blockchain', 'p2fk_index', 'utxo'];

export class DesktopMeshNode {
  constructor(network = 'btc-testnet') {
    this.network = network;
    this.nodeId = `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.ws = null;
    this.heartbeatTimer = null;
    this.statsTimer = null;
    this.peers = new Map();
    this.cache = new Map();
    this.stats = {
      bytesRelayed: 0,
      requestsServed: 0,
      peersConnected: 0,
      blockchainQueries: 0,
      indexQueries: 0,
      ipfsServed: 0,
    };
    this.onStatusChange = null;
    this._running = false;
    this._connectedChains = [];
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async start(connectedChains = []) {
    if (this._running) return;
    this._running = true;
    this._connectedChains = connectedChains;

    await this._register();
    this._connectSignaling();

    this.heartbeatTimer = setInterval(() => this._heartbeat(), HEARTBEAT_INTERVAL);
    this.statsTimer = setInterval(() => this._reportStats(), STATS_REPORT_INTERVAL);

    // Start peer discovery after signaling connects
    setTimeout(() => this._discoverAndPeer(), 3000);
    this._discoveryTimer = setInterval(() => this._discoverAndPeer(), 45_000);

    if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
    console.log(`[DesktopMesh] Master node started: ${this.nodeId}`);
  }

  async stop() {
    this._running = false;
    try {
      await fetch(`${API}/api/mesh/deregister?address=${this.nodeId}&network=${this.network}`, { method: 'POST' });
    } catch {}

    for (const [, peer] of this.peers) {
      try { peer.pc?.close(); } catch {}
    }
    this.peers.clear();

    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    if (this._discoveryTimer) { clearInterval(this._discoveryTimer); this._discoveryTimer = null; }
    if (this._wsPingTimer) { clearInterval(this._wsPingTimer); this._wsPingTimer = null; }

    await this._reportStats();
    if (this.onStatusChange) this.onStatusChange('offline', this.getStatus());
    console.log('[DesktopMesh] Master node stopped');
  }

  updateConnectedChains(chains) {
    this._connectedChains = chains;
  }

  // ── Registration ────────────────────────────────────────────────────

  async _register() {
    try {
      await fetch(`${API}/api/mesh/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.nodeId,
          network: this.network,
          urn: `master:${this._connectedChains.join('+')}`,
          capacity: MAX_PEERS,
          bandwidth: 'high',
          services: DESKTOP_SERVICES,
        }),
      });
    } catch (e) {
      console.warn('[DesktopMesh] Registration failed:', e.message);
    }
  }

  async _heartbeat() {
    try {
      await fetch(`${API}/api/mesh/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.nodeId,
          network: this.network,
          urn: `master:${this._connectedChains.join('+')}`,
          capacity: MAX_PEERS - this.peers.size,
          bandwidth: 'high',
          services: DESKTOP_SERVICES,
        }),
      });
    } catch {}
  }

  // ── Signaling ───────────────────────────────────────────────────────

  _connectSignaling() {
    const wsBase = API.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/api/mesh/signal/${this.nodeId}`;
    try {
      this.ws = new WebSocket(wsUrl);
    } catch { return; }

    this.ws.onopen = () => {
      console.log('[DesktopMesh] Signaling connected');
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

        if (msg.type === 'snapshot-gossip' || msg.type === 'snapshot_gossip') {
          this._relayToAllPeers(msg);
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
        console.warn('[DesktopMesh] Signal error:', e.message);
      }
    };

    this.ws.onclose = () => {
      console.log('[DesktopMesh] Signaling disconnected');
      if (this._wsPingTimer) { clearInterval(this._wsPingTimer); this._wsPingTimer = null; }
      if (this._running) {
        setTimeout(() => this._connectSignaling(), 5000);
      }
    };

    this.ws.onerror = () => {};
  }

  // ── Peer Discovery ──────────────────────────────────────────────────

  async _discoverAndPeer() {
    if (!this._running || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.peers.size >= MAX_PEERS) return;

    try {
      const res = await fetch(`${API}/api/mesh/nodes?network=${this.network}`);
      if (!res.ok) return;
      const { nodes } = await res.json();
      const candidates = nodes.filter(n =>
        n.address !== this.nodeId &&
        !this.peers.has(n.address) &&
        n.active_peers < n.capacity
      );
      const slots = MAX_PEERS - this.peers.size;
      const toConnect = candidates.slice(0, slots);
      for (const node of toConnect) {
        await this._connectToPeer(node.address);
      }
      if (toConnect.length > 0) {
        console.log(`[DesktopMesh] Peered with ${toConnect.length} node(s)`);
      }
    } catch (e) {
      console.warn('[DesktopMesh] Discovery failed:', e.message);
    }
  }

  // ── WebRTC Connection ───────────────────────────────────────────────

  async _connectToPeer(targetAddress) {
    if (this.peers.has(targetAddress) || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('mesh-relay', { ordered: true });
    const peer = { pc, channel, connected: false, _iceCandidateQueue: [] };
    this.peers.set(targetAddress, peer);

    channel.onopen = () => {
      peer.connected = true;
      this.stats.peersConnected++;
      console.log(`[DesktopMesh] Channel open: ${targetAddress.slice(0, 12)}...`);
      // Announce capabilities
      this._announceCapabilities(peer);
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
    };
    channel.onmessage = (e) => this._handleDataMessage(targetAddress, e.data);
    channel.onclose = () => {
      this.peers.delete(targetAddress);
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          to: targetAddress, type: 'ice-candidate',
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
        to: targetAddress, type: 'offer', payload: JSON.stringify(offer),
      }));
    } catch (e) {
      this.peers.delete(targetAddress);
      try { pc.close(); } catch {}
    }
  }

  async _handleOffer(fromAddress, offerSDP) {
    if (this.peers.size >= MAX_PEERS) return;
    const existing = this.peers.get(fromAddress);
    if (existing?.pc) {
      if (this.nodeId < fromAddress && existing.pc.signalingState === 'have-local-offer') return;
      try { existing.pc.close(); } catch {}
      this.peers.delete(fromAddress);
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pc, channel: null, connected: false, _iceCandidateQueue: [] };
    this.peers.set(fromAddress, peer);

    pc.ondatachannel = (event) => {
      const ch = event.channel;
      peer.channel = ch;
      peer.connected = true;
      this.stats.peersConnected++;
      if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
      ch.onmessage = (e) => this._handleDataMessage(fromAddress, e.data);
      ch.onclose = () => {
        this.peers.delete(fromAddress);
        if (this.onStatusChange) this.onStatusChange('online', this.getStatus());
      };
      this._announceCapabilities(peer);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          to: fromAddress, type: 'ice-candidate',
          payload: JSON.stringify(event.candidate),
        }));
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerSDP)));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        to: fromAddress, type: 'answer', payload: JSON.stringify(answer),
      }));
    }
  }

  async _handleAnswer(fromAddress, answerSDP) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.pc || peer.pc.signalingState !== 'have-local-offer') return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(answerSDP)));
      for (const c of (peer._iceCandidateQueue || [])) {
        try { await peer.pc.addIceCandidate(c); } catch {}
      }
      peer._iceCandidateQueue = [];
    } catch (e) {
      console.warn('[DesktopMesh] Answer error:', e.message);
    }
  }

  async _handleIceCandidate(fromAddress, candidateJSON) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.pc) return;
    const candidate = new RTCIceCandidate(JSON.parse(candidateJSON));
    if (!peer.pc.remoteDescription) {
      peer._iceCandidateQueue = peer._iceCandidateQueue || [];
      peer._iceCandidateQueue.push(candidate);
    } else {
      try { await peer.pc.addIceCandidate(candidate); } catch {}
    }
  }

  // ── Capability Announcement ─────────────────────────────────────────

  _announceCapabilities(peer) {
    if (!peer.channel || peer.channel.readyState !== 'open') return;
    try {
      peer.channel.send(JSON.stringify({
        type: 'master_announce',
        nodeId: this.nodeId,
        chains: this._connectedChains,
        services: DESKTOP_SERVICES,
        capacity: MAX_PEERS - this.peers.size,
      }));
    } catch {}
  }

  // ── Data Channel Message Handling ───────────────────────────────────

  _handleDataMessage(fromAddress, data) {
    try {
      if (typeof data === 'string' && data.length > 262144) return;
      const request = JSON.parse(data);
      if (!request.type) return;

      switch (request.type) {
        case 'ipfs':
          this._serveIpfs(fromAddress, request);
          break;
        case 'api':
          this._serveApiCache(fromAddress, request);
          break;
        case 'blockchain':
          this._serveBlockchain(fromAddress, request);
          break;
        case 'p2fk_index':
          this._serveP2fkIndex(fromAddress, request);
          break;
        case 'room_message':
        case 'gossip_notify':
        case 'snapshot_gossip':
        case 'snapshot-gossip':
        case 'ink_notify':
          this._relayToAllPeers(request, fromAddress);
          break;
        case 'master_announce':
          // Acknowledgement from another master node — ignore
          break;
        default:
          break;
      }
    } catch (e) {
      console.warn('[DesktopMesh] Bad data message:', e.message);
    }
  }

  // ── Content Serving: IPFS ───────────────────────────────────────────

  async _serveIpfs(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const cid = request.key;
    if (!cid || typeof cid !== 'string' || cid.length < 10) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'invalid_cid' }));
      return;
    }

    try {
      // Try local Kubo daemon first
      const res = await fetch(`${API}/api/ipfs/cat/${cid}`);
      if (!res.ok) {
        peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
        return;
      }
      const blob = await res.arrayBuffer();

      const CHUNK_SIZE = 16384;
      const totalChunks = Math.ceil(blob.byteLength / CHUNK_SIZE);

      peer.channel.send(JSON.stringify({
        id: request.id, type: 'ipfs-response',
        size: blob.byteLength, chunks: totalChunks,
      }));

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, blob.byteLength);
        peer.channel.send(blob.slice(start, end));
      }

      this.stats.bytesRelayed += blob.byteLength;
      this.stats.ipfsServed++;
      this.stats.requestsServed++;
    } catch {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'fetch_failed' }));
    }
  }

  // ── Content Serving: Blockchain Data ────────────────────────────────

  async _serveBlockchain(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const { chain, method, params } = request;
    if (!chain || !method) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'missing_params' }));
      return;
    }

    // Whitelist of safe RPC methods peers can request
    const ALLOWED_METHODS = [
      'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction',
      'getblockchaininfo', 'estimatesmartfee', 'validateaddress',
      'gettxout', 'getblockheader',
    ];

    if (!ALLOWED_METHODS.includes(method)) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'method_not_allowed' }));
      return;
    }

    try {
      const res = await fetch(`${API}/api/node/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain, method, params: params || [] }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        peer.channel.send(JSON.stringify({
          id: request.id, error: err.detail || 'rpc_error',
        }));
        return;
      }

      const data = await res.json();
      const payload = JSON.stringify({
        id: request.id, type: 'blockchain-response',
        chain, method, result: data.result,
      });

      peer.channel.send(payload);
      this.stats.bytesRelayed += payload.length;
      this.stats.blockchainQueries++;
      this.stats.requestsServed++;
    } catch {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'internal_error' }));
    }
  }

  // ── Content Serving: P2FK Index ─────────────────────────────────────

  async _serveP2fkIndex(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const { query_type, params } = request;
    if (!query_type) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'missing_query_type' }));
      return;
    }

    // Map query types to API endpoints
    const QUERY_MAP = {
      'root':     (p) => `${API}/api/node/index/root/${p.txid}`,
      'roots':    (p) => `${API}/api/node/index/roots/${p.address}${p.chain ? '?chain=' + p.chain : ''}`,
      'keyword':  (p) => `${API}/api/node/index/keyword/${p.address}${p.chain ? '?chain=' + p.chain : ''}`,
      'objects':  (p) => `${API}/api/node/index/objects?chain=${p.chain || ''}&limit=${p.limit || 100}`,
      'profiles': (p) => `${API}/api/node/index/profiles?chain=${p.chain || ''}&limit=${p.limit || 100}`,
      'search':   (p) => `${API}/api/node/index/search?q=${encodeURIComponent(p.query || '')}&chain=${p.chain || ''}`,
      'stats':    () => `${API}/api/node/index/stats`,
    };

    const urlBuilder = QUERY_MAP[query_type];
    if (!urlBuilder) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'unknown_query_type' }));
      return;
    }

    try {
      const url = urlBuilder(params || {});
      const res = await fetch(url);

      if (!res.ok) {
        peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
        return;
      }

      const data = await res.json();
      const payload = JSON.stringify({
        id: request.id, type: 'p2fk_index-response',
        query_type, data,
      });

      peer.channel.send(payload);
      this.stats.bytesRelayed += payload.length;
      this.stats.indexQueries++;
      this.stats.requestsServed++;
    } catch {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'internal_error' }));
    }
  }

  // ── Content Serving: API Cache ──────────────────────────────────────

  async _serveApiCache(fromAddress, request) {
    const peer = this.peers.get(fromAddress);
    if (!peer?.channel) return;

    const allowedPrefixes = [
      '/api/feed', '/api/objects/', '/api/profiles/', '/api/profile/',
      '/api/posts/', '/api/network/', '/api/onchain/',
    ];
    const path = request.key;
    if (!path || !allowedPrefixes.some(p => path.startsWith(p))) {
      peer.channel.send(JSON.stringify({ id: request.id, error: 'forbidden' }));
      return;
    }

    const cacheKey = `api:${path}`;
    const cached = this.cache.get(cacheKey);

    let jsonData;
    if (cached && Date.now() - cached.ts < 60_000) {
      jsonData = cached.data;
    } else {
      try {
        const res = await fetch(`${API}${path}`);
        if (!res.ok) {
          peer.channel.send(JSON.stringify({ id: request.id, error: 'not_found' }));
          return;
        }
        jsonData = await res.text();
        if (jsonData.length > 5_000_000) {
          peer.channel.send(JSON.stringify({ id: request.id, error: 'too_large' }));
          return;
        }
        this.cache.set(cacheKey, { data: jsonData, ts: Date.now() });
      } catch {
        peer.channel.send(JSON.stringify({ id: request.id, error: 'fetch_failed' }));
        return;
      }
    }

    const payload = JSON.stringify({ id: request.id, type: 'api-response', data: jsonData });
    peer.channel.send(payload);
    this.stats.bytesRelayed += payload.length;
    this.stats.requestsServed++;
  }

  // ── Relay & Broadcast ───────────────────────────────────────────────

  _relayToAllPeers(msg, excludeAddress = null) {
    const payload = JSON.stringify(msg);
    for (const [addr, peer] of this.peers) {
      if (addr === excludeAddress || !peer.channel || peer.channel.readyState !== 'open') continue;
      try { peer.channel.send(payload); } catch {}
    }
  }

  broadcastInventory() {
    const msg = {
      type: 'master_inventory',
      nodeId: this.nodeId,
      chains: this._connectedChains,
      services: DESKTOP_SERVICES,
      ts: Date.now(),
    };
    this._relayToAllPeers(msg);
  }

  // ── Stats ───────────────────────────────────────────────────────────

  async _reportStats() {
    if (this.stats.bytesRelayed === 0) return;
    try {
      await fetch(
        `${API}/api/mesh/relay-stat?address=${this.nodeId}&bytes_relayed=${this.stats.bytesRelayed}&network=${this.network}`,
        { method: 'POST' }
      );
    } catch {}
  }

  getStatus() {
    return {
      nodeId: this.nodeId,
      online: this._running,
      network: this.network,
      chains: this._connectedChains,
      peers: this.peers.size,
      maxPeers: MAX_PEERS,
      services: DESKTOP_SERVICES,
      stats: { ...this.stats },
      cacheSize: this.cache.size,
    };
  }
}
