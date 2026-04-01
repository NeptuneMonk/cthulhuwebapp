/**
 * Optimistic Local Cache — IndexedDB-backed store for P2FK actions.
 * Stores object/action data locally on broadcast, displays instantly in UI
 * with status badges, and self-cleans when the p2fk.io indexer catches up.
 *
 * Statuses: mempool → confirmed → indexed (then removed)
 */

const DB_NAME = 'cthulhu-optimistic';
const STORE_NAME = 'pending-actions';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'txid' });
        store.createIndex('network', 'network', { unique: false });
        store.createIndex('senderAddress', 'senderAddress', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Add a new optimistic action to the cache.
 * @param {Object} item - { txid, type, network, senderAddress, objectAddress?, data, status? }
 */
export async function addOptimisticItem(item) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        ...item,
        status: item.status || 'mempool',
        createdAt: Date.now(),
        confirmedAt: null,
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

/**
 * Get all optimistic items for a given network.
 */
export async function getOptimisticItems(network) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('network');
      const req = idx.getAll(network);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Get optimistic items by sender address.
 */
export async function getOptimisticByAddress(senderAddress) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('senderAddress');
      const req = idx.getAll(senderAddress);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Update status of an item (e.g. mempool → confirmed).
 */
export async function updateOptimisticStatus(txid, status) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(txid);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          item.status = status;
          if (status === 'confirmed') item.confirmedAt = Date.now();
          store.put(item);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Remove an item (when indexer has caught up).
 */
export async function removeOptimisticItem(txid) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(txid);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Clear all optimistic items for a network.
 */
export async function clearOptimisticItems(network) {
  try {
    const items = await getOptimisticItems(network);
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const item of items) store.delete(item.txid);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Clean up stale items (older than 24 hours).
 */
export async function cleanupStaleItems() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const item of req.result || []) {
          if (item.createdAt < cutoff) store.delete(item.txid);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
