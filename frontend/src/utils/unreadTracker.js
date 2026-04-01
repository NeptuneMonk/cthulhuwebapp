/**
 * Unread message tracking for Tethers (Chats) panel.
 *
 * Uses a simple lastReadCount model:
 *   unread = totalMessages - lastReadCount
 *
 * Storage: localStorage key = `cthulhu_unread_${userAddress}_${network}`
 * Format: { [roomOrDmId]: { lastReadCount: number, markedReadAt?: string } }
 *
 * Also polls the backend /api/chat/unread/{address} for messages received
 * while the user was offline (server-side unread tracking).
 */
const API = process.env.REACT_APP_BACKEND_URL;

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
 */
export function markAsRead(userAddress, chatId, totalCount) {
  if (!userAddress || !chatId) return;
  const store = getStore(userAddress);
  store[chatId] = {
    lastReadCount: totalCount || 0,
    markedReadAt: new Date().toISOString(),
  };
  saveStore(userAddress, store);
  // Also tell the server
  if (API) {
    fetch(`${API}/api/chat/mark-read/${encodeURIComponent(chatId)}?address=${encodeURIComponent(userAddress)}`, { method: 'POST' }).catch(() => {});
  }
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

let _pollInterval = null;
let _serverUnread = 0;

/**
 * Fetch server-side unread counts and merge with local tracking.
 * This catches messages received while the user was offline.
 */
export async function fetchServerUnread(userAddress) {
  if (!userAddress || !API) return 0;
  try {
    const resp = await fetch(`${API}/api/chat/unread/${encodeURIComponent(userAddress)}`);
    if (!resp.ok) return _serverUnread;
    const data = await resp.json();
    _serverUnread = data.total_unread || 0;
    // If server has unread, trigger a badge update
    if (_serverUnread > 0) {
      notifyUnreadChange();
    }
    return _serverUnread;
  } catch {
    return _serverUnread;
  }
}

/**
 * Get the last fetched server unread total.
 */
export function getServerUnread() {
  return _serverUnread;
}

/**
 * Start polling server for unread counts (call once from App.js).
 */
export function startUnreadPolling(userAddress, intervalMs = 30000) {
  stopUnreadPolling();
  if (!userAddress) return;
  // Immediate first fetch
  fetchServerUnread(userAddress);
  // Register for all rooms the user has tethered
  _pollInterval = setInterval(() => fetchServerUnread(userAddress), intervalMs);
}

/**
 * Stop the server unread polling.
 */
export function stopUnreadPolling() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
  _serverUnread = 0;
}

/**
 * Register a room for server-side unread tracking (call when user joins a room).
 */
export function registerRoomForTracking(userAddress, roomAddress) {
  if (!userAddress || !roomAddress || !API) return;
  fetch(`${API}/api/chat/register-room?address=${encodeURIComponent(userAddress)}&room=${encodeURIComponent(roomAddress)}`, { method: 'POST' }).catch(() => {});
}
