/**
 * Mesh-First Fetch Layer
 * ======================
 * Resolution priority for ALL data fetches:
 *   1. Mesh peers  — WebRTC data channels (instant, decentralized)
 *   2. Direct blockchain — p2fk.io / standalone handlers (no backend needed)
 *   3. Backend API  — SQLite-cached proxy (last resort)
 *
 * The DB is just a staging buffer. The chain is the permanent record.
 * This module wraps all API calls to enforce this priority automatically.
 */

import { getGlobalMeshClient, getGlobalMeshNode, meshFetchByUrn, cacheByUrn } from '@/utils/meshRelay';

const API = process.env.REACT_APP_BACKEND_URL;

// Standalone handlers — direct blockchain queries from the browser
let _standaloneHandlers = null;
let _standaloneLoading = false;

async function getStandaloneHandlers() {
  if (_standaloneHandlers) return _standaloneHandlers;
  if (_standaloneLoading) return null;
  _standaloneLoading = true;
  try {
    const mod = await import('@/utils/standalone');
    _standaloneHandlers = mod.handlers || mod.default?.handlers || null;
    return _standaloneHandlers;
  } catch { return null; }
  finally { _standaloneLoading = false; }
}

/**
 * Try to fetch API data from mesh peers.
 * Nodes cache recent API responses and serve them over WebRTC.
 * Returns parsed JSON or null.
 */
async function fetchFromMesh(apiPath, timeoutMs = 5000) {
  // Try as a client connected to a node
  const client = getGlobalMeshClient();
  if (client?.connected) {
    try {
      const data = await client.fetchApi(apiPath, timeoutMs);
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return { data: parsed, source: 'mesh' };
      }
    } catch {}
  }

  // Try as a node — check own API cache
  const node = getGlobalMeshNode();
  if (node?._running) {
    const cached = node.cache.get(`api:${apiPath}`);
    if (cached?.data && Date.now() - cached.timestamp < 120_000) {
      try {
        const parsed = typeof cached.data === 'string' ? JSON.parse(cached.data) : cached.data;
        return { data: parsed, source: 'mesh-cache' };
      } catch {}
    }

    // Ask connected peers
    if (node.peers.size > 0) {
      for (const [, peer] of node.peers) {
        if (!peer.channel || peer.channel.readyState !== 'open') continue;
        try {
          const result = await new Promise((resolve) => {
            const id = Date.now() + Math.random();
            const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
            const cleanup = () => { clearTimeout(timer); peer.channel.removeEventListener('message', handler); };
            const handler = (event) => {
              if (typeof event.data !== 'string') return;
              try {
                const msg = JSON.parse(event.data);
                if (msg.id !== id) return;
                cleanup();
                if (msg.error) { resolve(null); return; }
                if (msg.type === 'api-response' && msg.data) {
                  resolve(typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data);
                } else { resolve(null); }
              } catch { resolve(null); }
            };
            peer.channel.addEventListener('message', handler);
            peer.channel.send(JSON.stringify({ id, type: 'api', key: apiPath }));
          });
          if (result) return { data: result, source: 'mesh-peer' };
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Try to fetch data directly from blockchain via standalone handlers.
 * No backend needed — goes straight to p2fk.io from the browser.
 * Returns parsed JSON or null.
 */
async function fetchFromBlockchain(fullUrl) {
  const handlers = await getStandaloneHandlers();
  if (!handlers) return null;

  // Find matching handler
  for (const [prefix, handler] of Object.entries(handlers)) {
    if (fullUrl.includes(prefix)) {
      try {
        const result = await handler(fullUrl);
        if (result) {
          // Standalone handlers return Response-like objects
          const data = result.body ? JSON.parse(result.body) : result;
          return { data, source: 'blockchain' };
        }
      } catch {}
    }
  }
  return null;
}

/**
 * meshFirstFetch — drop-in replacement for axios.get / fetch
 * that tries mesh → blockchain → backend in priority order.
 *
 * Usage:
 *   const { data, source } = await meshFirstFetch('/feed/btc-testnet', { skip: 0, limit: 5 });
 *   const { data, source } = await meshFirstFetch('/feed/btc-testnet', {}, { urn: 'movie.the_vulture' });
 *
 * @param {string} path - API path without /api prefix (e.g., '/feed/btc-testnet')
 * @param {object} params - Query parameters
 * @param {object} options - { timeout, skipMesh, skipBlockchain, urn }
 * @returns {{ data: any, source: string }}
 */
export async function meshFirstFetch(path, params = {}, options = {}) {
  const { timeout = 5000, skipMesh = false, skipBlockchain = false, urn = null } = options;

  // Build the full API path with query params
  const qs = new URLSearchParams(params).toString();
  const apiPath = `/api${path}${qs ? '?' + qs : ''}`;
  const fullUrl = `${API}${apiPath}`;

  // 0. Try URN-based mesh lookup first (chain-agnostic, fastest)
  if (urn && !skipMesh) {
    try {
      const urnResult = await meshFetchByUrn(urn, timeout);
      if (urnResult?.meta && Object.keys(urnResult.meta).length > 0) {
        return { data: urnResult.meta, source: 'mesh-urn', blobData: urnResult.data };
      }
    } catch {}
  }

  // 1. Try mesh peers (path-based lookup)
  if (!skipMesh) {
    const meshResult = await fetchFromMesh(apiPath, timeout);
    if (meshResult) {
      // Cache in node for future peer requests
      cacheInNode(apiPath, meshResult.data);
      return meshResult;
    }
  }

  // 2. Try direct blockchain (no backend needed)
  if (!skipBlockchain) {
    const chainResult = await fetchFromBlockchain(fullUrl);
    if (chainResult) {
      cacheInNode(apiPath, chainResult.data);
      return chainResult;
    }
  }

  // 3. Fall back to backend API (SQLite-backed proxy) — deduplicated
  try {
    const { dedupGet } = await import('@/utils/dedupFetch');
    const data = await dedupGet(fullUrl, 5000);
    if (data !== null) {
      cacheInNode(apiPath, data);
      return { data, source: 'backend' };
    }
  } catch {}

  return { data: null, source: 'failed' };
}

/**
 * Cache API response in the mesh node for serving to peers.
 * If a URN is provided, also index under the URN key for cross-chain lookups.
 */
function cacheInNode(apiPath, data, urn = null) {
  try {
    const node = getGlobalMeshNode();
    if (node?._running) {
      node.cache.set(`api:${apiPath}`, {
        data: JSON.stringify(data),
        timestamp: Date.now(),
      });
    }
    // Also cache under URN if provided (enables chain-agnostic lookups)
    if (urn && data) {
      cacheByUrn(urn, data, null);
    }
  } catch {}
}

export { cacheByUrn, meshFetchByUrn };
export default meshFirstFetch;
