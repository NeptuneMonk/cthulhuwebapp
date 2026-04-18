/**
 * Thumbnail / On-Chain Media Prefetcher — warms the server-side thumb cache,
 * on-chain file resolution cache, and the browser HTTP cache for every media
 * ref found in a batch of feed posts, before the user scrolls past them.
 *
 * Strategy:
 *   - Scan each post's Message for <<IPFS:CID[/filename]>> and
 *     <<txid/filename>> (64-hex txid) tokens
 *   - Dedupe across the session (prefetched refs never re-fetched)
 *   - Fire low-priority fetches with a concurrency cap of 6
 *   - Silent best-effort; 404s/202s are expected and ignored
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const IMG_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?|$)/i;
const IPFS_RE = /<<IPFS:([A-Za-z0-9]+)[\\/]?([^>]*)>>/g;
// On-chain file ref: <<txid/filename>> where txid is 64-hex chars
const ONCHAIN_RE = /<<([0-9a-f]{64})[\\/]([^>]+)>>/g;
const CONCURRENCY = 6;

const _prefetched = new Set();
const _prefetchedOnchain = new Set();
let _inflight = 0;
const _queue = [];

function _drain() {
  while (_inflight < CONCURRENCY && _queue.length) {
    const url = _queue.shift();
    _inflight++;
    fetch(url, {
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

function _extractOnchainRefs(text) {
  if (!text || typeof text !== 'string') return [];
  const refs = [];
  let m;
  ONCHAIN_RE.lastIndex = 0;
  while ((m = ONCHAIN_RE.exec(text)) !== null) {
    const [, txid, filename] = m;
    refs.push({ txid, filename: filename.trim() });
  }
  return refs;
}

function _currentChainParams() {
  try {
    const network = localStorage.getItem('cthulhu_network') || 'btc-testnet';
    const isMainnet = network.includes('mainnet');
    const chain = network.startsWith('ltc') ? 'LTC' : network.startsWith('doge') ? 'DOGE' : 'BTC';
    return { chain, isMainnet };
  } catch {
    return { chain: 'BTC', isMainnet: false };
  }
}

/**
 * Prefetch thumbnails + on-chain file resolutions for every media ref found
 * in a list of posts. IPFS images hit /api/ipfs/thumb; on-chain refs hit
 * /api/onchain/file/{txid}/{filename}. Both populate server caches and the
 * browser HTTP cache so the visible components load instantly.
 * @param {Array} posts - feed posts with .Message / .message field
 */
export function prefetchThumbs(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const { chain, isMainnet } = _currentChainParams();
  for (const p of posts) {
    const msg = p?.Message ?? p?.message ?? p?.root?.Message ?? '';

    // IPFS thumbs
    for (const cid of _extractImageCids(msg)) {
      if (!_prefetched.has(cid)) {
        _prefetched.add(cid);
        _queue.push(`${API}/ipfs/thumb?cid=${cid}`);
      }
    }

    // On-chain file refs
    for (const { txid, filename } of _extractOnchainRefs(msg)) {
      const key = `${txid}/${filename}`;
      if (!_prefetchedOnchain.has(key)) {
        _prefetchedOnchain.add(key);
        const url = `${API}/onchain/file/${txid}/${encodeURIComponent(filename)}?chain=${chain}&mainnet=${isMainnet}`;
        _queue.push(url);
      }
    }
  }
  _drain();
}
