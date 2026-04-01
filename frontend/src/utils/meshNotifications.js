/**
 * Mesh Gossip Notifications — Decentralized notification delivery.
 *
 * When a user sends a message, a lightweight notification hint is
 * gossiped through the mesh to all connected peers. If the recipient
 * is online anywhere on the mesh, they get an instant badge update.
 *
 * For offline users, the hint is posted to the backend as an ephemeral
 * relay so they can catch up on reconnect.
 *
 * Notification format:
 *   { type: "gossip_notify", room, sender, senderUrn, timestamp, count }
 */

const API = process.env.REACT_APP_BACKEND_URL;

// Local state: accumulated notifications from gossip
// Key: room address, Value: { count, sender, senderUrn, lastTimestamp }
const _pendingNotifs = new Map();
let _listeners = new Set();

/** Subscribe to gossip notification changes. */
export function onNotifChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notifyListeners() {
  const snapshot = getNotifSnapshot();
  _listeners.forEach(fn => fn(snapshot));
}

/** Get a snapshot of all pending gossip notifications. */
export function getNotifSnapshot() {
  const result = {};
  for (const [room, data] of _pendingNotifs) {
    result[room] = { ...data };
  }
  return result;
}

/** Get total unread count from gossip notifications. */
export function getGossipUnreadTotal() {
  let total = 0;
  for (const [, data] of _pendingNotifs) {
    total += data.count;
  }
  return total;
}

/** Get unread count for a specific room from gossip. */
export function getGossipRoomUnread(room) {
  return _pendingNotifs.get(room)?.count || 0;
}

/** Clear gossip notifications for a room (user opened it). */
export function clearGossipRoom(room) {
  if (_pendingNotifs.has(room)) {
    _pendingNotifs.delete(room);
    notifyListeners();
  }
}

/** Clear all gossip notifications. */
export function clearAllGossipNotifs() {
  _pendingNotifs.clear();
  notifyListeners();
}

/**
 * Handle an incoming gossip notification (from mesh peer or WS relay).
 * Returns true if this is a genuinely NEW notification that should trigger a sound.
 * Deduplicates by timestamp to prevent repeated chimes from gossip echoes.
 */
export function handleGossipNotify(msg, myAddress) {
  if (!msg.room || msg.sender === myAddress) return false;

  const existing = _pendingNotifs.get(msg.room);
  const count = msg.count || 1;
  const ts = msg.timestamp || new Date().toISOString();

  if (existing) {
    // Only treat as "new" if the timestamp is actually newer
    if (ts <= existing.lastTimestamp) {
      return false; // Duplicate gossip echo — no sound
    }
    existing.count += count;
    existing.sender = msg.sender;
    existing.senderUrn = msg.senderUrn || existing.senderUrn;
    existing.lastTimestamp = ts;
  } else {
    _pendingNotifs.set(msg.room, {
      count,
      sender: msg.sender,
      senderUrn: msg.senderUrn || '',
      lastTimestamp: ts,
    });
  }

  notifyListeners();
  return true;
}

/**
 * Post a notification hint to the backend for an offline user.
 * Called by mesh nodes when gossip can't reach the target.
 */
export async function postOfflineHint(to, room, sender, senderUrn, network) {
  try {
    await fetch(`${API}/api/mesh/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, room, sender, sender_urn: senderUrn, network }),
    });
  } catch {
    // Silent — best effort
  }
}

/**
 * Fetch offline notification hints from the backend.
 * Called on reconnect to catch up on missed messages.
 */
export async function fetchOfflineHints(address, network) {
  try {
    const res = await fetch(`${API}/api/mesh/notifications/${address}?network=${network}`);
    if (!res.ok) return [];
    const data = await res.json();
    const hints = data.hints || [];

    // Merge into local state
    for (const hint of hints) {
      handleGossipNotify({
        room: hint.room,
        sender: hint.sender,
        senderUrn: hint.sender_urn || '',
        count: hint.count || 1,
        timestamp: hint.updated || hint.created,
      }, address);
    }

    return hints;
  } catch {
    return [];
  }
}
