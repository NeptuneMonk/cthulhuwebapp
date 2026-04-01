/**
 * notificationSync.js — Bridges IndexedDB DM state to localStorage
 * so the vault backup (stateBackup.js) can include notification timestamps.
 *
 * On every markAsRead / clearChat / setLastSeen, we snapshot the current
 * state to localStorage keys that collectNetworkState() picks up.
 *
 * On restore from vault, the timestamps are written back to localStorage
 * by stateBackup.js, and this module pushes them into IndexedDB.
 */

let _userAddress = null;

/**
 * Initialize — call once on login. Syncs any restored vault data
 * from localStorage back into IndexedDB.
 */
export async function initNotificationSync(userAddress) {
  _userAddress = userAddress;
  // Push any vault-restored timestamps into IndexedDB
  await _restoreToIndexedDB();
}

/**
 * Call after setLastSeen() — snapshots the timestamp to localStorage.
 */
export function snapshotDmLastSeen(key, timestamp) {
  if (!_userAddress) return;
  try {
    const store = JSON.parse(localStorage.getItem(`cthulhu_notifsync_dm_${_userAddress}`) || '{}');
    store[key] = timestamp;
    localStorage.setItem(`cthulhu_notifsync_dm_${_userAddress}`, JSON.stringify(store));
  } catch {}
}

/**
 * Call after clearConversation() — snapshots the cleared-before timestamp.
 */
export function snapshotClearedBefore(key, timestamp) {
  if (!_userAddress) return;
  try {
    const store = JSON.parse(localStorage.getItem(`cthulhu_notifsync_cleared_${_userAddress}`) || '{}');
    store[key] = timestamp;
    localStorage.setItem(`cthulhu_notifsync_cleared_${_userAddress}`, JSON.stringify(store));
  } catch {}
}

/**
 * Call after marking a mention as seen.
 */
export function snapshotMentionSeen(txid) {
  if (!_userAddress) return;
  try {
    const store = JSON.parse(localStorage.getItem(`cthulhu_notifsync_mentions_${_userAddress}`) || '[]');
    if (!store.includes(txid)) store.push(txid);
    localStorage.setItem(`cthulhu_notifsync_mentions_${_userAddress}`, JSON.stringify(store));
  } catch {}
}

/**
 * Bulk export from IndexedDB → localStorage snapshots.
 * Called before a vault backup to ensure fresh data.
 */
export async function syncIndexedDBToSnapshots() {
  if (!_userAddress) return;
  try {
    const { _exportDmLastSeen, _exportClearedBefore, _exportMentionsSeen } = await import('@/utils/dmDb');

    const dmLastSeen = await _exportDmLastSeen(_userAddress);
    if (dmLastSeen && Object.keys(dmLastSeen).length > 0) {
      const existing = JSON.parse(localStorage.getItem(`cthulhu_notifsync_dm_${_userAddress}`) || '{}');
      for (const [key, ts] of Object.entries(dmLastSeen)) {
        if (ts > (existing[key] || '')) existing[key] = ts;
      }
      localStorage.setItem(`cthulhu_notifsync_dm_${_userAddress}`, JSON.stringify(existing));
    }

    const clearedBefore = await _exportClearedBefore(_userAddress);
    if (clearedBefore && Object.keys(clearedBefore).length > 0) {
      const existing = JSON.parse(localStorage.getItem(`cthulhu_notifsync_cleared_${_userAddress}`) || '{}');
      for (const [key, ts] of Object.entries(clearedBefore)) {
        if (ts > (existing[key] || '')) existing[key] = ts;
      }
      localStorage.setItem(`cthulhu_notifsync_cleared_${_userAddress}`, JSON.stringify(existing));
    }

    const mentions = await _exportMentionsSeen();
    if (mentions?.length > 0) {
      const existing = JSON.parse(localStorage.getItem(`cthulhu_notifsync_mentions_${_userAddress}`) || '[]');
      const merged = [...new Set([...existing, ...mentions])];
      localStorage.setItem(`cthulhu_notifsync_mentions_${_userAddress}`, JSON.stringify(merged));
    }
  } catch (e) {
    console.warn('[NotifSync] IndexedDB export failed:', e.message);
  }
}

export function stopNotificationSync() {
  _userAddress = null;
}

// ─── Private ───

async function _restoreToIndexedDB() {
  if (!_userAddress) return;
  try {
    const { _importDmLastSeen, _importClearedBefore } = await import('@/utils/dmDb');

    const dmLastSeen = JSON.parse(localStorage.getItem(`cthulhu_notifsync_dm_${_userAddress}`) || '{}');
    if (Object.keys(dmLastSeen).length > 0) {
      await _importDmLastSeen(_userAddress, dmLastSeen);
    }

    const clearedBefore = JSON.parse(localStorage.getItem(`cthulhu_notifsync_cleared_${_userAddress}`) || '{}');
    if (Object.keys(clearedBefore).length > 0) {
      await _importClearedBefore(_userAddress, clearedBefore);
    }
  } catch (e) {
    console.warn('[NotifSync] IndexedDB restore failed:', e.message);
  }
}
