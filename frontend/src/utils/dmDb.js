/**
 * Centralized IndexedDB manager for the DM system.
 * All DM-related stores must be defined here to prevent version conflicts.
 */
const DB_NAME = 'cthulhu_dm';
const DB_VERSION = 7; // Bump to 7 to add dm_conversations store
const SENT_STORE = 'sent_messages';
const SETTINGS_STORE = 'dm_settings';
const LAST_SEEN_STORE = 'last_seen';
const MENTIONS_STORE = 'mentions_seen';
const DECRYPT_CACHE_STORE = 'decrypt_cache';
const CONVERSATIONS_STORE = 'dm_conversations';

function openDMDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SENT_STORE)) {
        const store = db.createObjectStore(SENT_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('conversation', 'conversation', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'conversation' });
      }
      if (!db.objectStoreNames.contains(LAST_SEEN_STORE)) {
        db.createObjectStore(LAST_SEEN_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(MENTIONS_STORE)) {
        db.createObjectStore(MENTIONS_STORE, { keyPath: 'txid' });
      }
      if (!db.objectStoreNames.contains(DECRYPT_CACHE_STORE)) {
        db.createObjectStore(DECRYPT_CACHE_STORE, { keyPath: 'key' });
      } else if (req.oldVersion < 6) {
        db.deleteObjectStore(DECRYPT_CACHE_STORE);
        db.createObjectStore(DECRYPT_CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'key' });
      }
    };
    req.onblocked = () => {
      console.warn('cthulhu_dm DB upgrade blocked by another connection');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function hasStore(db, name) {
  return db.objectStoreNames.contains(name);
}

// --- Sent Messages ---

export async function saveSentMessage(myAddress, partnerAddress, network, text, txid = null) {
  const db = await openDMDB();
  const tx = db.transaction(SENT_STORE, 'readwrite');
  const store = tx.objectStore(SENT_STORE);
  const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
  store.add({
    conversation: conversationKey,
    from: myAddress,
    to: partnerAddress,
    text,
    txid,
    timestamp: new Date().toISOString(),
    network,
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSentMessages(myAddress, partnerAddress, network) {
  const db = await openDMDB();
  const tx = db.transaction(SENT_STORE, 'readonly');
  const store = tx.objectStore(SENT_STORE);
  const idx = store.index('conversation');
  const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
  const req = idx.getAll(conversationKey);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearSentMessages(myAddress, partnerAddress, network) {
  const db = await openDMDB();
  const tx = db.transaction(SENT_STORE, 'readwrite');
  const store = tx.objectStore(SENT_STORE);
  const idx = store.index('conversation');
  const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
  const req = idx.getAllKeys(conversationKey);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      for (const key of req.result) store.delete(key);
      tx.oncomplete = resolve;
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Self-Destruct Timer ---

export async function getSelfDestructTimer(myAddress, partnerAddress, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, SETTINGS_STORE)) return 0;
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const store = tx.objectStore(SETTINGS_STORE);
    const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
    const req = store.get(conversationKey);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result?.timer || 0);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

export async function setSelfDestructTimer(myAddress, partnerAddress, network, timer) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, SETTINGS_STORE)) return;
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
    store.put({ conversation: conversationKey, timer });
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* silently fail if store not available */ }
}

export async function pruneExpiredMessages(myAddress, partnerAddress, network, timerMs) {
  if (!timerMs) return;
  const db = await openDMDB();
  const tx = db.transaction(SENT_STORE, 'readwrite');
  const store = tx.objectStore(SENT_STORE);
  const idx = store.index('conversation');
  const conversationKey = [myAddress, partnerAddress, network].sort().join('|');
  const req = idx.getAll(conversationKey);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const now = Date.now();
      for (const msg of req.result) {
        if (now - new Date(msg.timestamp).getTime() > timerMs) {
          store.delete(msg.id);
        }
      }
      tx.oncomplete = resolve;
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Last Seen (for notifications) ---

export async function getLastSeen(myAddress, partnerAddress, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, LAST_SEEN_STORE)) return '';
    const tx = db.transaction(LAST_SEEN_STORE, 'readonly');
    const store = tx.objectStore(LAST_SEEN_STORE);
    const key = `${myAddress}|${partnerAddress}|${network}`;
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result?.timestamp || '');
      req.onerror = () => resolve('');
    });
  } catch { return ''; }
}

export async function setLastSeen(myAddress, partnerAddress, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, LAST_SEEN_STORE)) return;
    const tx = db.transaction(LAST_SEEN_STORE, 'readwrite');
    const store = tx.objectStore(LAST_SEEN_STORE);
    const key = `${myAddress}|${partnerAddress}|${network}`;
    const timestamp = new Date().toISOString();
    store.put({ key, timestamp });
    // Snapshot for vault backup persistence
    import('@/utils/notificationSync').then(m => m.snapshotDmLastSeen(key, timestamp)).catch(() => {});
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch { /* silently fail */ }
}

// --- Mention Tracking ---

export async function getSeenMentions() {
  try {
    const db = await openDMDB();
    if (!hasStore(db, MENTIONS_STORE)) return new Set();
    const tx = db.transaction(MENTIONS_STORE, 'readonly');
    const store = tx.objectStore(MENTIONS_STORE);
    const req = store.getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(new Set((req.result || []).map(r => r.txid)));
      req.onerror = () => resolve(new Set());
    });
  } catch (e) { return new Set(); }
}

export async function markMentionSeen(txid) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, MENTIONS_STORE)) return;
    const tx = db.transaction(MENTIONS_STORE, 'readwrite');
    const store = tx.objectStore(MENTIONS_STORE);
    store.put({ txid, timestamp: new Date().toISOString() });
    // Snapshot for vault backup persistence
    import('@/utils/notificationSync').then(m => m.snapshotMentionSeen(txid)).catch(() => {});
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch (e) { /* silent */ }
}


export const SELF_DESTRUCT_OPTIONS = [
  { label: '1 hour', value: 3600000 },
  { label: '24 hours', value: 86400000 },
  { label: '7 days', value: 604800000 },
  { label: '30 days', value: 2592000000 },
  { label: 'Off', value: 0 },
];

// --- Decrypt Cache ---
// Caches the result of decrypting a SEC message so we never re-decrypt the same txid.
// Format: { key, txid, viewer, direction: 'inbound'|'outbound', text, sender, cachedAt }
// Key is `${txid}:${viewerAddress}` to ensure each user gets their own result.

export async function getCachedDecrypt(txid, viewerAddress) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, DECRYPT_CACHE_STORE)) return null;
    const tx = db.transaction(DECRYPT_CACHE_STORE, 'readonly');
    const store = tx.objectStore(DECRYPT_CACHE_STORE);
    const key = `${txid}:${viewerAddress}`;
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function getCachedDecryptBatch(txids, viewerAddress) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, DECRYPT_CACHE_STORE)) return {};
    const tx = db.transaction(DECRYPT_CACHE_STORE, 'readonly');
    const store = tx.objectStore(DECRYPT_CACHE_STORE);
    const results = {};
    const promises = txids.map(txid => new Promise((resolve) => {
      const key = `${txid}:${viewerAddress}`;
      const req = store.get(key);
      req.onsuccess = () => { if (req.result) results[txid] = req.result; resolve(); };
      req.onerror = () => resolve();
    }));
    await Promise.all(promises);
    return results;
  } catch { return {}; }
}

export async function cacheDecryptResult(txid, viewerAddress, { direction, text, sender, walkieIpfsRef }) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, DECRYPT_CACHE_STORE)) return;
    const tx = db.transaction(DECRYPT_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(DECRYPT_CACHE_STORE);
    const key = `${txid}:${viewerAddress}`;
    store.put({ key, txid, viewer: viewerAddress, direction, text, sender, walkieIpfsRef: walkieIpfsRef || null, cachedAt: new Date().toISOString() });
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch { /* silent */ }
}

export async function clearDecryptCache() {
  try {
    const db = await openDMDB();
    if (!hasStore(db, DECRYPT_CACHE_STORE)) return;
    const tx = db.transaction(DECRYPT_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(DECRYPT_CACHE_STORE);
    store.clear();
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch { /* silent */ }
}

// --- Conversation Cache ---
// Caches the full rendered conversation for instant Phase-1 rendering.
// Format: { key, messages: [...], lastFetchTimestamp: ISO, clearedBefore: ISO|null }

function conversationKey(myAddr, partnerAddr, network) {
  return `${myAddr}|${partnerAddr}|${network}`;
}

export async function getConversationCache(myAddr, partnerAddr, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return null;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const key = conversationKey(myAddr, partnerAddr, network);
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function saveConversationCache(myAddr, partnerAddr, network, messages, lastFetchTimestamp) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const key = conversationKey(myAddr, partnerAddr, network);
    store.put({ key, messages, lastFetchTimestamp, updatedAt: new Date().toISOString() });
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch { /* silent */ }
}

export async function clearConversationCache(myAddr, partnerAddr, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const key = conversationKey(myAddr, partnerAddr, network);
    // Instead of deleting, set clearedBefore so frontend can filter on reload
    const existing = await new Promise(resolve => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    const clearedBefore = new Date().toISOString();
    store.put({
      key,
      messages: [],
      lastFetchTimestamp: null,
      clearedBefore,
      updatedAt: new Date().toISOString(),
    });
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch { /* silent */ }
}

/**
 * Get the clearedBefore timestamp for a conversation (stored client-side).
 * This persists even if the backend DB resets.
 */
export async function getClearedBefore(myAddr, partnerAddr, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return null;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const key = conversationKey(myAddr, partnerAddr, network);
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result?.clearedBefore || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/**
 * Set the clearedBefore timestamp for a conversation.
 * Future fetches will exclude messages older than this timestamp.
 */
export async function setClearedBefore(myAddr, partnerAddr, network, timestamp) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const key = conversationKey(myAddr, partnerAddr, network);
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const existing = req.result || { key };
        existing.clearedBefore = timestamp;
        store.put(existing);
        tx.oncomplete = resolve;
      };
      req.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}


export async function clearDecryptCacheForConversation(myAddr, partnerAddr, network) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, DECRYPT_CACHE_STORE)) return;
    const tx = db.transaction(DECRYPT_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(DECRYPT_CACHE_STORE);
    const req = store.getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => {
        for (const entry of (req.result || [])) {
          if (entry.viewer === myAddr) {
            store.delete(entry.key);
          }
        }
        tx.oncomplete = resolve;
      };
      req.onerror = () => resolve();
    });
  } catch { /* silent */ }
}


// ─── Vault Export/Import (used by notificationSync.js) ───

/**
 * Export all DM last-seen timestamps for a given user address.
 * Returns { "addr|partner|network": ISO_timestamp, ... }
 */
export async function _exportDmLastSeen(myAddress) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, LAST_SEEN_STORE)) return {};
    const tx = db.transaction(LAST_SEEN_STORE, 'readonly');
    const store = tx.objectStore(LAST_SEEN_STORE);
    const req = store.getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const result = {};
        for (const entry of (req.result || [])) {
          if (entry.key?.startsWith(`${myAddress}|`)) {
            result[entry.key] = entry.timestamp || '';
          }
        }
        resolve(result);
      };
      req.onerror = () => resolve({});
    });
  } catch { return {}; }
}

/**
 * Export cleared-before timestamps from dm_conversations.
 * Returns { "convKey": ISO_timestamp, ... }
 */
export async function _exportClearedBefore(myAddress) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return {};
    const tx = db.transaction(CONVERSATIONS_STORE, 'readonly');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    const req = store.getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const result = {};
        for (const entry of (req.result || [])) {
          if (entry.clearedBefore && entry.conversation?.includes(myAddress)) {
            result[entry.conversation] = entry.clearedBefore;
          }
        }
        resolve(result);
      };
      req.onerror = () => resolve({});
    });
  } catch { return {}; }
}

/**
 * Export all seen mention txids.
 */
export async function _exportMentionsSeen() {
  try {
    const db = await openDMDB();
    if (!hasStore(db, MENTIONS_STORE)) return [];
    const tx = db.transaction(MENTIONS_STORE, 'readonly');
    const store = tx.objectStore(MENTIONS_STORE);
    const req = store.getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result || []).map(r => r.txid));
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

/**
 * Import DM last-seen timestamps into IndexedDB (from vault restore).
 * Merges: latest timestamp wins.
 */
export async function _importDmLastSeen(myAddress, data) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, LAST_SEEN_STORE)) return;
    const tx = db.transaction(LAST_SEEN_STORE, 'readwrite');
    const store = tx.objectStore(LAST_SEEN_STORE);
    for (const [key, timestamp] of Object.entries(data)) {
      if (!key.startsWith(`${myAddress}|`)) continue;
      const existing = await new Promise(r => {
        const req = store.get(key);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r(null);
      });
      if (!existing || timestamp > (existing.timestamp || '')) {
        store.put({ key, timestamp });
      }
    }
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch {}
}

/**
 * Import cleared-before timestamps into IndexedDB (from vault restore).
 */
export async function _importClearedBefore(myAddress, data) {
  try {
    const db = await openDMDB();
    if (!hasStore(db, CONVERSATIONS_STORE)) return;
    const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
    const store = tx.objectStore(CONVERSATIONS_STORE);
    for (const [conversation, clearedBefore] of Object.entries(data)) {
      if (!conversation.includes(myAddress)) continue;
      const existing = await new Promise(r => {
        const req = store.get(conversation);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r(null);
      });
      if (!existing) {
        store.put({ conversation, clearedBefore });
      } else if (clearedBefore > (existing.clearedBefore || '')) {
        store.put({ ...existing, clearedBefore });
      }
    }
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch {}
}
