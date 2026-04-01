/**
 * Key Pool — Bitcoin Core legacy-style pre-generated address pool.
 *
 * On wallet creation, 50 independent random key pairs are generated and
 * encrypted with the user's password. When an object needs an address,
 * it pulls the next unused key from the pool instead of generating on the fly.
 * Pool auto-replenishes when it drops below 10 unused keys.
 *
 * Storage: localStorage key = `cthulhu_keypool_${ownerAddress}`
 * Format: [{ address, encryptedWif, used: boolean, usedFor?: string, usedAt?: string }]
 */
import { encryptWIF, decryptWIF } from './walletCrypto';

const POOL_SIZE = 50;
const REPLENISH_THRESHOLD = 10;

function storageKey(ownerAddress) {
  return `cthulhu_keypool_${ownerAddress}`;
}

function getPool(ownerAddress) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(ownerAddress)) || '[]');
  } catch { return []; }
}

function savePool(ownerAddress, pool) {
  localStorage.setItem(storageKey(ownerAddress), JSON.stringify(pool));
}

/**
 * Generate N new key pairs, encrypt with password, and append to pool.
 * Each key is an independent random key (NOT derived from master).
 * Addresses are validated to not contain P2FK delimiter patterns.
 */
export async function generatePoolKeys(ownerAddress, password, count = POOL_SIZE, networkName = 'btc-testnet') {
  const { generateObjectAddress } = await import('./p2fk');
  const pool = getPool(ownerAddress);
  const existingAddresses = new Set(pool.map(k => k.address));

  const newEntries = [];
  for (let i = 0; i < count; i++) {
    const { address, wif } = generateObjectAddress(networkName);
    if (existingAddresses.has(address)) continue; // skip unlikely collision
    const encryptedWif = await encryptWIF(wif, password);
    newEntries.push({
      address,
      encryptedWif,
      used: false,
      createdAt: new Date().toISOString(),
    });
  }

  const updated = [...pool, ...newEntries];
  savePool(ownerAddress, updated);
  return newEntries.length;
}

/**
 * Pull the next unused key from the pool.
 * Returns { address, encryptedWif } or null if pool is empty.
 * Marks the key as used and records what it was used for.
 */
export function pullKeyFromPool(ownerAddress, usedForLabel) {
  const pool = getPool(ownerAddress);
  const idx = pool.findIndex(k => !k.used);
  if (idx === -1) return null;

  const entry = pool[idx];
  pool[idx] = { ...entry, used: true, usedFor: usedForLabel, usedAt: new Date().toISOString() };
  savePool(ownerAddress, pool);
  return { address: entry.address, encryptedWif: entry.encryptedWif };
}

/**
 * Decrypt a key from the pool using the user's password.
 */
export async function decryptPoolKey(encryptedWif, password) {
  return decryptWIF(encryptedWif, password);
}

/**
 * Get the count of unused keys remaining in the pool.
 */
export function getUnusedCount(ownerAddress) {
  const pool = getPool(ownerAddress);
  return pool.filter(k => !k.used).length;
}

/**
 * Check if the pool needs replenishment and do so if needed.
 * Returns the number of new keys generated (0 if not needed).
 */
export async function replenishIfNeeded(ownerAddress, password, networkName = 'btc-testnet') {
  const unused = getUnusedCount(ownerAddress);
  if (unused >= REPLENISH_THRESHOLD) return 0;
  const needed = POOL_SIZE - unused;
  return generatePoolKeys(ownerAddress, password, needed, networkName);
}

/**
 * Get pool statistics.
 */
export function getPoolStats(ownerAddress) {
  const pool = getPool(ownerAddress);
  const used = pool.filter(k => k.used);
  const unused = pool.filter(k => !k.used);
  return { total: pool.length, used: used.length, unused: unused.length };
}

export { POOL_SIZE, REPLENISH_THRESHOLD };
