/**
 * Unread message tracking for Tethers (Chats) panel.
 *
 * Uses a simple lastReadCount model:
 *   unread = totalMessages - lastReadCount
 *
 * Storage: localStorage key = `cthulhu_unread_${userAddress}_${network}`
 * Format: { [roomOrDmId]: { lastReadCount: number, markedReadAt?: string } }
 *
 * Fully client-side — no server dependency. The blockchain is the source
 * of truth for messages; localStorage just tracks what the user has seen.
 */

function _currentNetwork() {
  return localStorage.getItem('cthulhu_network') || 'btc-testnet';
}

function storageKey(userAddress) {
  return `cthulhu_unread_${userAddress}_${_currentNetwork()}`;
}

function getStore(userAddress) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userAddress)) || '{}');
  } catch { return {}; }
}

function saveStore(userAddress, store) {
  localStorage.setItem(storageKey(userAddress), JSON.stringify(store));
}

/**
 * Mark a room/DM as read up to totalCount messages.
 * Stored purely in localStorage — no server dependency.
 */
export function markAsRead(userAddress, chatId, totalCount) {
  if (!userAddress || !chatId) return;
  const store = getStore(userAddress);
  store[chatId] = {
    lastReadCount: totalCount || 0,
    markedReadAt: new Date().toISOString(),
  };
  saveStore(userAddress, store);
}

/**
 * Get the unread count for a room/DM.
 * Returns 0 if all messages are read or if no tracking data exists.
 */
export function getUnreadCount(userAddress, chatId, totalCount) {
  if (!userAddress || !chatId) return 0;
  const store = getStore(userAddress);
  const entry = store[chatId];
  if (!entry) return totalCount || 0; // Never visited = all unread
  const unread = (totalCount || 0) - (entry.lastReadCount || 0);
  return Math.max(0, unread);
}

/**
 * Get the lastReadCount for a room/DM.
 */
export function getLastReadCount(userAddress, chatId) {
  if (!userAddress || !chatId) return 0;
  const store = getStore(userAddress);
  return store[chatId]?.lastReadCount || 0;
}

/**
 * Check if a room/DM has unread messages.
 */
export function hasUnread(userAddress, chatId, totalCount) {
  return getUnreadCount(userAddress, chatId, totalCount) > 0;
}

/**
 * Store the total room unread count for the badge in the bottom nav.
 * This is updated by ChatsPage whenever room previews are computed.
 */
export function setTotalRoomUnread(userAddress, total) {
  if (!userAddress) return;
  localStorage.setItem(`cthulhu_room_unread_total_${userAddress}_${_currentNetwork()}`, String(total));
  window.dispatchEvent(new CustomEvent('cthulhu-unread-change'));
}

/**
 * Read the cached total room unread count.
 */
export function getTotalRoomUnread(userAddress) {
  if (!userAddress) return 0;
  return parseInt(localStorage.getItem(`cthulhu_room_unread_total_${userAddress}_${_currentNetwork()}`) || '0', 10);
}

/**
 * Notify listeners that unread counts have changed (e.g. after marking as read).
 */
export function notifyUnreadChange() {
  window.dispatchEvent(new CustomEvent('cthulhu-unread-change'));
}

// ─── Server-side unread polling ───
// NOTE: Removed in scalability audit (April 2026).
// Unread counts are now fully client-side (localStorage).
// The server is just a read cache — it must not be the source of truth
// for any UX state. If the server's SQLite is wiped, unread counts
// survive in the user's browser.

let _serverUnread = 0;

/**
 * Fetch server-side unread counts — DEPRECATED.
 * Kept as a no-op to avoid breaking existing callers.
 * Unread tracking is fully localStorage-based via getUnreadCount().
 */
export async function fetchServerUnread(userAddress) {
  return 0;
}

/**
 * Get the last fetched server unread total — always 0 (client-side only).
 */
export function getServerUnread() {
  return _serverUnread;
}

/**
 * Start polling server for unread counts — NO-OP.
 * Unread counts are tracked purely in localStorage.
 */
export function startUnreadPolling(userAddress, intervalMs = 30000) {
  // No-op: all unread tracking is client-side
}

/**
 * Stop the server unread polling — NO-OP.
 */
export function stopUnreadPolling() {
  _serverUnread = 0;
}

/**
 * Register a room for server-side unread tracking — NO-OP.
 * Rooms are tracked client-side via localStorage.
 */
export function registerRoomForTracking(userAddress, roomAddress) {
  // No-op: unread tracking is fully client-side
}
