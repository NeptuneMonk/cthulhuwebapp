/**
 * Pending Posts Manager — tracks user's broadcast posts through mempool → confirmation.
 * Posts appear instantly in feed as "pending", update to "confirmed" when mined.
 */

const STORAGE_KEY = 'cthulhu-pending-posts';

export function getPendingPosts(network) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return all.filter(p => p.network === network);
  } catch { return []; }
}

export function addPendingPost(post) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    all.unshift({
      ...post,
      status: 'mempool',
      mempool_time: new Date().toISOString(),
      confirmed_time: null,
    });
    // Keep max 20 pending posts
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 20)));
  } catch { /* silent */ }
}

export function confirmPost(txid) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const updated = all.map(p => {
      if (p.txid !== txid) return p;
      const confirmed = { ...p, status: 'confirmed', confirmed_time: new Date().toISOString() };
      // Also update nested poll_data status if present
      if (confirmed.poll_data) {
        confirmed.poll_data = { ...confirmed.poll_data, status: 'active' };
      }
      return confirmed;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* silent */ }
}

export function removePendingPost(txid) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter(p => p.txid !== txid)));
  } catch { /* silent */ }
}

/**
 * Check confirmation status of pending posts via mempool.space API.
 * Returns list of newly confirmed txids.
 */
export async function checkConfirmations(network) {
  const pending = getPendingPosts(network).filter(p => p.status === 'mempool');
  if (pending.length === 0) return [];

  const isMainnet = network.includes('mainnet');
  const base = isMainnet
    ? 'https://mempool.space/api'
    : 'https://mempool.space/testnet/api';

  const confirmed = [];
  for (const post of pending) {
    try {
      const resp = await fetch(`${base}/tx/${post.txid}/status`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.confirmed) {
          confirmPost(post.txid);
          confirmed.push(post.txid);
        }
      }
    } catch { /* silent */ }
  }
  return confirmed;
}

/**
 * Clean up old confirmed posts (older than 1 hour).
 */
export function cleanupOldPosts() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const filtered = all.filter(p => {
      if (p.status === 'confirmed' && p.confirmed_time) {
        return new Date(p.confirmed_time).getTime() > oneHourAgo;
      }
      return true;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch { /* silent */ }
}
