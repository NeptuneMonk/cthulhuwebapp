/**
 * IPFS Local Pinning — IndexedDB-backed storage for IPFS content.
 * Each user acts as a local pinning node, storing IPFS data they browse.
 * Also signals the backend to pin content on the server's Kubo daemon.
 */

const DB_NAME = 'cthulhu-ipfs-pins';
const STORE_NAME = 'ipfs-pinned';
const DB_VERSION = 1;

// Note: 'cthulhu-pinning' DB was the old separate mesh cache — now unified into this store.

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get cached IPFS content by CID.
 * Returns { cid, data (Blob), filename, contentType, cachedAt } or null.
 */
export async function getCached(cid) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cid);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Store IPFS content in the local cache.
 * Images are automatically compressed to WebP for space savings.
 */
export async function putCache(cid, data, filename = '', contentType = 'application/octet-stream') {
  try {
    const db = await openDB();
    const isImage = contentType.startsWith('image/') &&
      !contentType.includes('svg') && !contentType.includes('gif');
    let storeData = data;
    let storeSize = data.size || data.byteLength || 0;

    // Compress images to WebP for cache savings
    if (isImage && storeSize > 50000) { // Only compress images > 50KB
      try {
        const compressed = await compressImage(data);
        if (compressed && compressed.size < storeSize * 0.9) {
          storeData = compressed;
          storeSize = compressed.size;
        }
      } catch {} // Fall through to store original on compression failure
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        cid,
        data: storeData,
        filename,
        contentType: storeData === data ? contentType : 'image/webp',
        cachedAt: new Date().toISOString(),
        size: storeSize,
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

/**
 * Compress an image Blob via Canvas → WebP.
 * Returns a smaller Blob, or null if compression fails.
 */
function compressImage(blob, maxDim = 1024, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      // Downscale if larger than maxDim
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (compressed) => resolve(compressed),
        'image/webp',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/**
 * Clear the entire IPFS cache.
 */
export async function clearCache() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

/**
 * Get cache stats: total items, total size.
 */
export async function getCacheStats() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        const totalSize = items.reduce((sum, item) => sum + (item.size || 0), 0);
        resolve({ count: items.length, totalSize, items: items.map(i => ({ cid: i.cid, size: i.size, cachedAt: i.cachedAt, filename: i.filename, access_count: i.access_count || 0 })) });
      };
      req.onerror = () => resolve({ count: 0, totalSize: 0, items: [] });
    });
  } catch {
    return { count: 0, totalSize: 0, items: [] };
  }
}

/**
 * Remove a single item from cache.
 */
export async function removeCached(cid) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(cid);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

// IPFS gateway URLs (fallback chain)
const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/**
 * Fire-and-forget: tell our backend to pin this CID on its Kubo node.
 */
function requestServerPin(cid) {
  const API = process.env.REACT_APP_BACKEND_URL;
  if (!API) return;
  fetch(`${API}/api/ipfs/pin/${cid}`, { method: 'POST' }).catch(() => {});
}

/**
 * Fetch IPFS content with local pin + server pin.
 * Tries local pin store first, then fetches from gateways.
 * For paths like CID/filename, tries CID/filename first then falls back to CID only
 * (handles both directory-wrapped and direct file CIDs).
 * Returns an object URL (blob:) that can be used directly in <img src>.
 */
export async function fetchIPFS(cid, filename = '') {
  const cacheKey = filename ? `${cid}/${filename}` : cid;

  // Check local pin store
  const cached = await getCached(cacheKey);
  if (cached && cached.data) {
    const blob = cached.data instanceof Blob ? cached.data : new Blob([cached.data]);
    return URL.createObjectURL(blob);
  }
  // Also check bare CID cache
  if (filename) {
    const cachedBare = await getCached(cid);
    if (cachedBare && cachedBare.data) {
      const blob = cachedBare.data instanceof Blob ? cachedBare.data : new Blob([cachedBare.data]);
      return URL.createObjectURL(blob);
    }
  }

  // Build paths to try: CID/filename first, then CID only
  const paths = filename ? [`${cid}/${filename}`, cid] : [cid];

  // Try public gateways
  for (const path of paths) {
    for (const gw of GATEWAYS) {
      try {
        const resp = await fetch(`${gw}${path}`, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const blob = await resp.blob();
          await putCache(cacheKey, blob, filename, blob.type);
          requestServerPin(cid);
          return URL.createObjectURL(blob);
        }
      } catch {
        continue;
      }
    }
  }

  // Fallback: try our own backend (which auto-pins on cat)
  const API = process.env.REACT_APP_BACKEND_URL;
  if (API) {
    for (const path of paths) {
      try {
        const resp = await fetch(`${API}/api/ipfs/cat/${path}`, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const blob = await resp.blob();
          await putCache(cacheKey, blob, filename, blob.type);
          return URL.createObjectURL(blob);
        }
      } catch { continue; }
    }
  }

  return null;
}

/**
 * Parse an IPFS reference string (SUP format) into { cid, filename }.
 * Handles: "IPFS:QmCID\file.ext", "IPFS:QmCID/file.ext", "ipfs:QmCID/file.ext"
 */
export function parseIPFSRef(ref) {
  if (!ref) return null;
  const cleaned = ref.replace(/^ipfs:/i, '');
  // Split on either \ or /
  const parts = cleaned.split(/[/\\]/);
  const cid = parts[0];
  const filename = parts.slice(1).join('/');
  return { cid, filename };
}
