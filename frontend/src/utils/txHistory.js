/**
 * Transaction history — persisted in localStorage, keyed by wallet address.
 * Each entry stores the txid, type, output addresses, timestamp, and network.
 */

const STORAGE_PREFIX = 'cthulhu_tx_history_';
const MAX_ENTRIES = 100;

function storageKey(address) {
  return `${STORAGE_PREFIX}${address}`;
}

/** Get all transactions for an address, newest first. */
export function getTransactions(address) {
  if (!address) return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey(address)) || '[]');
  } catch {
    return [];
  }
}

/**
 * Log a new transaction.
 * @param {string} address - The sender/wallet address (used as the storage key)
 * @param {{ txid: string, type: string, network: string, addresses: string[], label?: string }} tx
 */
export function addTransaction(address, tx) {
  if (!address || !tx?.txid) return;
  const history = getTransactions(address);
  const entry = {
    txid: tx.txid,
    type: tx.type || 'UNKNOWN',
    network: tx.network || 'btc-testnet',
    addresses: tx.addresses || [],
    label: tx.label || '',
    timestamp: Date.now(),
  };
  // Deduplicate by txid, prepend new entry, cap at MAX_ENTRIES
  const updated = [entry, ...history.filter(t => t.txid !== tx.txid)].slice(0, MAX_ENTRIES);
  localStorage.setItem(storageKey(address), JSON.stringify(updated));
}

/** Clear all transaction history for an address. */
export function clearTransactions(address) {
  if (!address) return;
  localStorage.removeItem(storageKey(address));
}
