/**
 * Thumbnail Prefetcher — warms the server-side thumb cache and browser HTTP
 * cache for every image CID found in a batch of feed posts, before the user
 * scrolls past them. Keeps scroll buttery-smooth with zero thumbnail pops.
 *
 * Strategy:
 *   - Scan each post's Message for <<IPFS:CID/filename.{img-ext}>> tokens
 *   - Dedupe across the session (prefetched CIDs never re-fetched)
 *   - Fire low-priority fetches with a concurrency cap of 6
 *   - Silent best-effort; 404s (small/non-image) are expected and ignored
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?|$)/i;
const IPFS_RE = /<<IPFS:([A-Za-z0-9]+)[\\/]?([^>]*)>>/g;
const CONCURRENCY = 6;

const _prefetched = new Set();
let _inflight = 0;
const _queue = [];

function _drain() {
  while (_inflight < CONCURRENCY && _queue.length) {
    const cid = _queue.shift();
    _inflight++;
    fetch(`${API}/ipfs/thumb?cid=${cid}`, {
      method: 'GET',
      priority: 'low',
      cache: 'force-cache',
    })
      .catch(() => {})
      .finally(() => {
        _inflight--;
        _drain();
      });
  }
}

function _extractImageCids(text) {
  if (!text || typeof text !== 'string') return [];
  const cids = [];
  let m;
  IPFS_RE.lastIndex = 0;
  while ((m = IPFS_RE.exec(text)) !== null) {
    const [, cid, filename = ''] = m;
    // Treat as image if filename has image extension OR no extension at all
    if (!filename || IMG_EXT_RE.test(filename)) cids.push(cid);
  }
  return cids;
}

/**
 * Prefetch thumbnails for every image CID referenced in a list of posts.
 * @param {Array} posts - feed posts with .Message / .message field
 */
export function prefetchThumbs(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return;
  for (const p of posts) {
    const msg = p?.Message ?? p?.message ?? p?.root?.Message ?? '';
    for (const cid of _extractImageCids(msg)) {
      if (!_prefetched.has(cid)) {
        _prefetched.add(cid);
        _queue.push(cid);
      }
    }
  }
  _drain();
}
