/**
 * P2P Mesh Relay Engine — Orchestrator
 *
 * Re-exports MeshNode (relay server) and MeshClient (consumer) from
 * their dedicated modules, plus standalone helper functions and
 * global singletons for app-wide mesh access.
 *
 * All existing imports from 'meshRelay' continue to work unchanged.
 *
 * Architecture:
 *   - meshNode.js  — MeshNode class (signaling, peering, content serving)
 *   - meshClient.js — MeshClient class (discovery, scoring, fetching)
 *   - meshRelay.js  — This file (globals, standalone helpers, re-exports)
 */

// Re-export classes so all existing imports work
export { MeshNode } from './meshNode';
export { MeshClient } from './meshClient';

const API = process.env.REACT_APP_BACKEND_URL;

// ─── Global Mesh Singletons ───
// Allows resolveIPFS (in useCachedIPFS) to use the mesh without prop drilling.

let _globalMeshClient = null;
let _globalMeshNode = null;

export function setGlobalMeshClient(client) { _globalMeshClient = client; }
export function getGlobalMeshClient() { return _globalMeshClient; }
export function setGlobalMeshNode(node) { _globalMeshNode = node; }
export function getGlobalMeshNode() { return _globalMeshNode; }


// ─── Standalone Helpers ───

/**
 * Fetch IPFS content with mesh-first strategy.
 * Tries mesh relay first, falls back to direct API.
 */
export async function meshFetchIpfs(meshClient, cid) {
  if (meshClient?.connected) {
    const data = await meshClient.fetchIpfs(cid, 8000);
    if (data) return { data, source: 'mesh' };
  }
  try {
    const res = await fetch(`${API}/api/ipfs/cat/${cid}`);
    if (res.ok) {
      const data = await res.arrayBuffer();
      return { data, source: 'direct' };
    }
  } catch {}
  return null;
}

/**
 * Cache content under a URN key in the mesh node.
 * Enables cross-chain, cross-CID lookups by human-readable name.
 */
export function cacheByUrn(urn, meta = {}, data = null) {
  if (!urn) return;
  const node = _globalMeshNode;
  if (!node?._running) return;
  node.cache.set(`urn:${urn}`, { meta, data, timestamp: Date.now() });
}

/**
 * Fetch content by URN from mesh peers.
 * Returns { meta, data (ArrayBuffer or null) } or null.
 */
export async function meshFetchByUrn(urn, timeoutMs = 8000) {
  if (!urn) return null;

  // Try as client
  const client = _globalMeshClient;
  if (client?.connected) {
    try {
      const result = await client.fetchUrn(urn, timeoutMs);
      if (result) return result;
    } catch {}
  }

  // Try own node cache
  const node = _globalMeshNode;
  if (node?._running) {
    const cached = node.cache.get(`urn:${urn}`);
    if (cached && Date.now() - cached.timestamp < 300_000) {
      return { meta: cached.meta, data: cached.data };
    }
    // Ask peers
    if (node.peers.size > 0) {
      try {
        const result = await node.fetchUrnFromPeers(urn, timeoutMs);
        if (result) {
          node.cache.set(`urn:${urn}`, { ...result, timestamp: Date.now() });
          return result;
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Try to fetch an IPFS CID from the mesh network.
 * Returns a Blob or null. Used by the IPFS cache layer.
 */
export async function meshFetchBlob(cid) {
  // As a client — ask a relay node
  const client = _globalMeshClient;
  if (client?.connected) {
    try {
      const data = await client.fetchIpfs(cid, 8000);
      if (data) return new Blob([data]);
    } catch {}
  }
  // As a node — check own in-memory cache first
  const node = _globalMeshNode;
  if (node?._running) {
    const cached = node.cache.get(`ipfs:${cid}`);
    if (cached?.data) return new Blob([cached.data]);
    // Ask connected peers (node-to-node mesh fetch)
    if (node.peers.size > 0) {
      try {
        const data = await node.fetchFromPeers(cid, 8000);
        if (data) {
          node.cache.set(`ipfs:${cid}`, { data, timestamp: Date.now() });
          return new Blob([data]);
        }
      } catch {}
    }
  }
  return null;
}
