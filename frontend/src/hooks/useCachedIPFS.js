import { useState, useEffect, useRef } from 'react';
import { getCached, putCache } from '@/utils/ipfsCache';
import { isCacheEnabled } from '@/components/SettingsModal';
import { meshFetchBlob } from '@/utils/meshRelay';
import { autoPinFromMesh } from '@/components/PinningManager';

const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/** Fire-and-forget: tell backend to propagate this CID (pin + DHT + warm gateways) */
function requestServerPropagate(cid) {
  const API = process.env.REACT_APP_BACKEND_URL;
  if (!API || !cid) return;
  fetch(`${API}/api/ipfs/propagate/${cid}`, { method: 'POST' }).catch(() => {});
}

/**
 * In-memory URL cache — survives re-renders, shared across all hook instances.
 * Maps gateway URL → resolved blob URL.
 */
const resolvedCache = new Map();
const pendingFetches = new Map(); // Dedup concurrent fetches for the same URL

function parseGatewayUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/ipfs\/([A-Za-z0-9]+)\/?(.*)$/);
  if (match) return { cid: match[1], path: match[2] || '' };
  return null;
}

async function fetchFromGateways(fetchPath) {
  for (const gw of GATEWAYS) {
    try {
      const resp = await fetch(`${gw}${fetchPath}`, { signal: AbortSignal.timeout(12000) });
      if (resp.ok) {
        const ct = resp.headers.get('content-type') || '';
        // Skip HTML responses (directory listings, error pages)
        if (ct.includes('text/html')) continue;
        return await resp.blob();
      }
    } catch { continue; }
  }
  return null;
}

/**
 * Core fetch+cache logic. Returns a blob URL or null.
 * Deduplicates concurrent requests for the same URL.
 */
async function resolveIPFS(url) {
  // Already resolved?
  if (resolvedCache.has(url)) return resolvedCache.get(url);

  // Already being fetched?
  if (pendingFetches.has(url)) return pendingFetches.get(url);

  const parsed = parseGatewayUrl(url);
  if (!parsed) return url;

  const cacheKey = parsed.path ? `${parsed.cid}/${parsed.path}` : parsed.cid;
  const cachingEnabled = isCacheEnabled();

  const promise = (async () => {
    // Check IndexedDB cache
    const cached = await getCached(cacheKey);
    if (cached?.data) {
      const blob = cached.data instanceof Blob ? cached.data : new Blob([cached.data]);
      const blobUrl = URL.createObjectURL(blob);
      resolvedCache.set(url, blobUrl);
      return blobUrl;
    }
    // Also check bare CID cache
    if (parsed.path) {
      const cachedBare = await getCached(parsed.cid);
      if (cachedBare?.data) {
        const blob = cachedBare.data instanceof Blob ? cachedBare.data : new Blob([cachedBare.data]);
        const blobUrl = URL.createObjectURL(blob);
        resolvedCache.set(url, blobUrl);
        return blobUrl;
      }
    }

    // P2P Mesh Relay — try peer network before hitting gateways
    let blob = null;
    let fromMesh = false;
    const meshBlob = await meshFetchBlob(parsed.cid);
    if (meshBlob) {
      blob = meshBlob;
      fromMesh = true;
    }

    // Backend IPFS node FIRST — it has local Kubo content + built-in gateway fallback
    if (!blob) {
      const API = process.env.REACT_APP_BACKEND_URL;
      if (API) {
        const paths = parsed.path
          ? [`${parsed.cid}/${parsed.path}`, parsed.cid]
          : [parsed.cid];
        for (const p of paths) {
          try {
            const resp = await fetch(`${API}/api/ipfs/cat/${p}`, { signal: AbortSignal.timeout(30000) });
            if (resp.ok) {
              const ct = resp.headers.get('content-type') || '';
              if (!ct.includes('text/html')) {
                blob = await resp.blob();
                if (blob.size > 0) break;
                blob = null;
              }
            }
          } catch { continue; }
        }
      }
    }

    // Fallback: direct public gateways (in case backend is down)
    if (!blob && parsed.path) {
      blob = await fetchFromGateways(`${parsed.cid}/${parsed.path}`);
    }
    if (!blob) {
      blob = await fetchFromGateways(parsed.cid);
    }

    if (blob) {
      if (cachingEnabled) {
        await putCache(cacheKey, blob, parsed.path, blob.type);
      }
      // Auto-pin for P2P serving (if enabled)
      if (localStorage.getItem('cthulhu_auto_pin') !== 'false') {
        try {
          const ab = await blob.arrayBuffer();
          autoPinFromMesh(parsed.cid, ab, blob.type || 'unknown').catch(() => {});
        } catch {}
      }
      requestServerPropagate(parsed.cid);
      const blobUrl = URL.createObjectURL(blob);
      resolvedCache.set(url, blobUrl);
      return blobUrl;
    }

    return null;
  })();

  pendingFetches.set(url, promise);
  try {
    const result = await promise;
    return result;
  } finally {
    pendingFetches.delete(url);
  }
}

/**
 * React hook: given an IPFS gateway URL, returns a stable cached blob URL.
 * Uses in-memory cache to avoid re-fetching on re-renders.
 */
export function useCachedIPFS(url) {
  const [resolvedUrl, setResolvedUrl] = useState(() => {
    // Instant return if already in memory cache
    if (url && resolvedCache.has(url)) return resolvedCache.get(url);
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    if (!url) { setResolvedUrl(null); return; }

    // Instant hit from memory cache
    if (resolvedCache.has(url)) {
      setResolvedUrl(resolvedCache.get(url));
      setFromCache(true);
      return;
    }

    let cancelled = false;
    setLoading(true);

    resolveIPFS(url).then(blobUrl => {
      if (!cancelled) {
        setResolvedUrl(blobUrl);
        setFromCache(!!blobUrl);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [url]);

  return { url: resolvedUrl, loading, fromCache };
}
