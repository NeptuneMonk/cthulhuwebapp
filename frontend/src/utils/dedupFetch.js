/**
 * Request Deduplication — prevents the same API call from firing multiple times
 * concurrently. If a request for the same URL is already in-flight, returns
 * the existing Promise instead of creating a new one.
 *
 * Also provides a simple TTL cache to avoid re-fetching recently-fetched data.
 */

const _inflight = new Map();   // url -> Promise
const _cache = new Map();      // url -> { data, ts }
const DEFAULT_TTL = 3000;      // 3 seconds — stale-while-revalidate window

/**
 * Deduplicated fetch wrapper. Same-URL calls within the TTL window
 * return cached data instantly. Concurrent calls share one Promise.
 *
 * @param {string} url - Full URL to fetch
 * @param {object} options - fetch options (method, headers, etc.)
 * @param {number} ttl - Cache TTL in ms (default 3000)
 * @returns {Promise<Response>} - fetch Response (cloned for each caller)
 */
export async function dedupFetch(url, options = {}, ttl = DEFAULT_TTL) {
  const method = (options.method || 'GET').toUpperCase();
  // Only dedup GET requests
  if (method !== 'GET') return fetch(url, options);

  const key = url;

  // Check TTL cache first
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return new Response(JSON.stringify(cached.data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Dedup': 'cache' },
    });
  }

  // Check if already in-flight
  if (_inflight.has(key)) {
    return _inflight.get(key).then(data => {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Dedup': 'inflight' },
      });
    });
  }

  // Create new request
  const promise = fetch(url, options)
    .then(async resp => {
      if (!resp.ok) {
        _inflight.delete(key);
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      _cache.set(key, { data, ts: Date.now() });
      _inflight.delete(key);
      return data;
    })
    .catch(err => {
      _inflight.delete(key);
      throw err;
    });

  _inflight.set(key, promise);

  const data = await promise;
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Dedup': 'fresh' },
  });
}

/**
 * Simplified dedup wrapper that returns parsed JSON directly.
 * Use this instead of `fetch(url).then(r => r.json())` patterns.
 */
export async function dedupGet(url, ttl = DEFAULT_TTL) {
  const key = url;

  // Check TTL cache
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.data;
  }

  // Check in-flight
  if (_inflight.has(key)) {
    return _inflight.get(key);
  }

  const promise = fetch(url)
    .then(async resp => {
      _inflight.delete(key);
      if (!resp.ok) return null;
      const data = await resp.json();
      _cache.set(key, { data, ts: Date.now() });
      return data;
    })
    .catch(() => {
      _inflight.delete(key);
      return null;
    });

  _inflight.set(key, promise);
  return promise;
}

/** Clear the dedup cache (e.g., on network change) */
export function clearDedupCache() {
  _cache.clear();
  _inflight.clear();
}
