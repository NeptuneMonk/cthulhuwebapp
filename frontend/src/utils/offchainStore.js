/**
 * Off-Chain Message Store — IndexedDB-backed local message cache.
 *
 * Messages flow P2P through the mesh (free, instant) and are stored locally.
 * Periodically, the cache is bundled, uploaded to IPFS, and a single
 * on-chain checkpoint transaction anchors the CID.
 *
 * Stores:
 *   messages    — individual room/DM messages (the raw content)
 *   checkpoints — IPFS bundle CIDs + txids (on-chain anchors)
 *   subscriptions — rooms this user is actively listening to
 */

const DB_NAME = 'cthulhu_offchain';
const DB_VERSION = 2;
const MSG_STORE = 'messages';
const CHECKPOINT_STORE = 'checkpoints';

// Bundle trigger thresholds
export const BUNDLE_THRESHOLDS = {
  MAX_BYTES: 512 * 1024,      // 512KB of unsynced messages
  MAX_MESSAGES: 200,            // 200 unsynced messages
  MAX_AGE_MS: 60 * 60 * 1000,  // 1 hour since last checkpoint
};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(MSG_STORE)) {
        const store = db.createObjectStore(MSG_STORE, { keyPath: 'id' });
        store.createIndex('room', 'room', { unique: false });
        store.createIndex('room_time', ['room', 'timestamp'], { unique: false });
      }
      if (!db.objectStoreNames.contains(CHECKPOINT_STORE)) {
        const store = db.createObjectStore(CHECKPOINT_STORE, { keyPath: 'id' });
        store.createIndex('room', 'room', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Generate a unique message ID.
 * Format: timestamp-random to ensure chronological + unique.
 */
function generateMsgId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Message Operations ───

/**
 * Store a message in the local cache.
 */
export async function storeMessage(msg) {
  const db = await openDB();
  const record = {
    id: msg.id || generateMsgId(),
    room: msg.room,
    sender: msg.sender,
    senderUrn: msg.senderUrn || null,
    senderImage: msg.senderImage || null,
    content: msg.content,
    timestamp: msg.timestamp || new Date().toISOString(),
    type: msg.type || 'text',     // text, image, voice, file
    mediaRef: msg.mediaRef || null, // IPFS CID for media
    synced: false,                  // true after checkpoint
    source: msg.source || 'mesh',   // mesh, local, restored
    byteSize: new Blob([msg.content || '']).size,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MSG_STORE, 'readwrite');
    tx.objectStore(MSG_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get messages for a room, sorted by timestamp.
 */
export async function getRoomMessages(room, limit = 200) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(MSG_STORE, 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const index = store.index('room');
    const req = index.getAll(room);
    req.onsuccess = () => {
      const msgs = (req.result || [])
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-limit);
      resolve(msgs);
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * Get all unsynced messages (not yet checkpointed).
 */
export async function getUnsyncedMessages() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(MSG_STORE, 'readonly');
    const store = tx.objectStore(MSG_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter(m => !m.synced));
    req.onerror = () => resolve([]);
  });
}

/**
 * Mark messages as synced after a successful checkpoint.
 */
export async function markMessagesSynced(messageIds) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(MSG_STORE, 'readwrite');
    const store = tx.objectStore(MSG_STORE);
    for (const id of messageIds) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.synced = true;
          store.put(req.result);
        }
      };
    }
    tx.oncomplete = () => resolve();
  });
}

/**
 * Import messages from a restored IPFS bundle.
 */
export async function importMessages(messages) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(MSG_STORE, 'readwrite');
    const store = tx.objectStore(MSG_STORE);
    for (const msg of messages) {
      msg.synced = true;
      msg.source = 'restored';
      store.put(msg);
    }
    tx.oncomplete = () => resolve(messages.length);
  });
}

// ─── Checkpoint Operations ───

/**
 * Record a checkpoint (IPFS bundle uploaded + on-chain tx).
 */
export async function saveCheckpoint(checkpoint) {
  const db = await openDB();
  const record = {
    id: checkpoint.id || generateMsgId(),
    room: checkpoint.room || '__global__',
    cid: checkpoint.cid,
    txid: checkpoint.txid || null,
    messageCount: checkpoint.messageCount || 0,
    byteSize: checkpoint.byteSize || 0,
    timestamp: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');
    tx.objectStore(CHECKPOINT_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get the latest checkpoint.
 */
export async function getLatestCheckpoint() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
    const store = tx.objectStore(CHECKPOINT_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      if (all.length === 0) return resolve(null);
      all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      resolve(all[0]);
    };
    req.onerror = () => resolve(null);
  });
}

// ─── Cache Size & Trigger Logic ───

/**
 * Get cache statistics for the bundle trigger.
 */
export async function getCacheStats() {
  const unsynced = await getUnsyncedMessages();
  const totalBytes = unsynced.reduce((sum, m) => sum + (m.byteSize || 0), 0);
  const lastCheckpoint = await getLatestCheckpoint();
  const timeSinceCheckpoint = lastCheckpoint
    ? Date.now() - new Date(lastCheckpoint.timestamp).getTime()
    : Infinity;

  return {
    unsyncedCount: unsynced.length,
    unsyncedBytes: totalBytes,
    timeSinceCheckpointMs: timeSinceCheckpoint,
    lastCheckpoint,
  };
}

/**
 * Check if a bundle checkpoint should be triggered.
 */
export async function shouldTriggerCheckpoint() {
  const stats = await getCacheStats();
  return (
    stats.unsyncedCount >= BUNDLE_THRESHOLDS.MAX_MESSAGES ||
    stats.unsyncedBytes >= BUNDLE_THRESHOLDS.MAX_BYTES ||
    (stats.unsyncedCount > 0 && stats.timeSinceCheckpointMs >= BUNDLE_THRESHOLDS.MAX_AGE_MS)
  );
}

/**
 * Build a bundle from unsynced messages for IPFS upload.
 * Returns { json, messageIds, byteSize }.
 */
export async function buildBundle(address) {
  const unsynced = await getUnsyncedMessages();
  if (unsynced.length === 0) return null;

  // Group by room for organized storage
  const rooms = {};
  for (const msg of unsynced) {
    if (!rooms[msg.room]) rooms[msg.room] = [];
    rooms[msg.room].push({
      id: msg.id,
      sender: msg.sender,
      senderUrn: msg.senderUrn,
      content: msg.content,
      timestamp: msg.timestamp,
      type: msg.type,
      mediaRef: msg.mediaRef,
    });
  }

  const bundle = {
    version: 1,
    address,
    created: new Date().toISOString(),
    messageCount: unsynced.length,
    rooms,
  };

  const json = JSON.stringify(bundle);
  return {
    json,
    messageIds: unsynced.map(m => m.id),
    byteSize: new Blob([json]).size,
    messageCount: unsynced.length,
  };
}

/**
 * Clear all local data (for settings/debug).
 */
export async function clearOffchainStore() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction([MSG_STORE, CHECKPOINT_STORE], 'readwrite');
    tx.objectStore(MSG_STORE).clear();
    tx.objectStore(CHECKPOINT_STORE).clear();
    tx.oncomplete = () => resolve();
  });
}
