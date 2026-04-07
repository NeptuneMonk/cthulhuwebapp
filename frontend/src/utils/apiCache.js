/**
 * Client-side API response cache using sessionStorage.
 * 
 * Follows embii's objects.html pattern: cache API responses with TTL
 * to reduce redundant calls to p2fk.io and our backend.
 *
 * Since blockchain data is immutable (no edit/delete), we can cache
 * aggressively for posts, replies, mentions, and object metadata.
 *
 * TTL tiers:
 *   - profiles:   30 min  (rarely change)
 *   - posts/feed: 10 min  (immutable once confirmed)
 *   - objects:     5 min  (ownership can change via BUY/GIV)
 *   - counts:      3 min  (derived from objects, semi-volatile)
 */

const TTL = {
  profile:  30 * 60 * 1000,  // 30 min
  posts:    10 * 60 * 1000,  // 10 min
  objects:  10 * 60 * 1000,  // 10 min
  counts:    3 * 60 * 1000,  //  3 min
  feed:     10 * 60 * 1000,  // 10 min
  search:    5 * 60 * 1000,  //  5 min
};

function _key(prefix, id) {
  return `cache_${prefix}_${id}`;
}

/**
 * Get a cached value. Returns null if missing or expired.
 * If `stale` is true, returns expired data too (for stale-while-revalidate).
 */
export function cacheGet(prefix, id, { stale = false } = {}) {
  try {
    const raw = sessionStorage.getItem(_key(prefix, id));
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    const age = Date.now() - ts;
    if (age < ttl) return { data, fresh: true };
    if (stale) return { data, fresh: false };
    return null;
  } catch {
    return null;
  }
}

/**
 * Store a value in the cache with appropriate TTL.
 */
export function cacheSet(prefix, id, data) {
  try {
    const ttl = TTL[prefix] || TTL.objects;
    sessionStorage.setItem(_key(prefix, id), JSON.stringify({
      data,
      ts: Date.now(),
      ttl,
    }));
  } catch {
    // sessionStorage full — evict oldest entries and retry
    _evictOldest();
    try {
      const ttl = TTL[prefix] || TTL.objects;
      sessionStorage.setItem(_key(prefix, id), JSON.stringify({ data, ts: Date.now(), ttl }));
    } catch { /* give up */ }
  }
}

/**
 * Invalidate a specific cache entry.
 */
export function cacheInvalidate(prefix, id) {
  try { sessionStorage.removeItem(_key(prefix, id)); } catch {}
}

/**
 * Invalidate all entries matching a prefix.
 */
export function cacheInvalidatePrefix(prefix) {
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`cache_${prefix}_`)) toRemove.push(key);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

/**
 * Evict oldest cache entries when storage is full.
 */
function _evictOldest() {
  try {
    const entries = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith('cache_')) continue;
      try {
        const { ts } = JSON.parse(sessionStorage.getItem(key));
        entries.push({ key, ts });
      } catch {}
    }
    entries.sort((a, b) => a.ts - b.ts);
    // Remove oldest 25%
    const removeCount = Math.max(1, Math.floor(entries.length / 4));
    for (let i = 0; i < removeCount; i++) {
      sessionStorage.removeItem(entries[i].key);
    }
  } catch {}
}

/**
 * Wrap an async fetch function with stale-while-revalidate caching.
 * 
 * Usage:
 *   const data = await cachedFetch('profile', address, () => axios.get(...));
 *   // Returns cached data instantly if available, refreshes in background.
 *
 * @param {string} prefix - Cache tier (profile, posts, objects, etc.)
 * @param {string} id - Unique cache key (address, network combo, etc.)
 * @param {Function} fetchFn - Async function that returns the data
 * @param {Function} [onUpdate] - Called when background refresh completes with new data
 * @returns {Promise<any>} - Cached data (if available) or fresh data
 */
export async function cachedFetch(prefix, id, fetchFn, onUpdate = null) {
  const cached = cacheGet(prefix, id, { stale: true });

  if (cached?.fresh) {
    // Fresh cache — return immediately, no fetch needed
    return cached.data;
  }

  if (cached && !cached.fresh && onUpdate) {
    // Stale cache — return stale data immediately, refresh in background
    fetchFn().then(freshData => {
      cacheSet(prefix, id, freshData);
      onUpdate(freshData);
    }).catch(() => {}); // silent background failure
    return cached.data;
  }

  // No cache — must fetch
  try {
    const data = await fetchFn();
    cacheSet(prefix, id, data);
    return data;
  } catch (err) {
    // On error, serve stale if available
    if (cached) return cached.data;
    throw err;
  }
}
