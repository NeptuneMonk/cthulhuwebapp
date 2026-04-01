/**
 * Client-side wallet encryption using Web Crypto API (AES-GCM).
 * Private key never leaves the browser unencrypted.
 *
 * Supports multiple wallets per network (max 5).
 * Storage format: cthulhu_wallets_{urn}_{network} = [{ address, encryptedWIF, label, storedAt }]
 */

const MAX_WALLETS_PER_NETWORK = 100;

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptWIF(wif, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(wif)
  );
  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(ciphertext).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  // Use chunked conversion to avoid call stack overflow on large data
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function decryptWIF(encryptedBase64, password) {
  try {
    const raw = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const salt = raw.slice(0, 16);
    const iv = raw.slice(16, 28);
    const ciphertext = raw.slice(28);
    const key = await deriveKey(password, salt);
    const dec = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return dec.decode(plaintext);
  } catch {
    return null;
  }
}

// --- Multi-wallet storage ---

const WALLETS_PREFIX = 'cthulhu_wallets_';
const LEGACY_PREFIX = 'cthulhu_wallet_';

function walletsKey(urn, network) {
  return WALLETS_PREFIX + urn.toLowerCase() + '_' + network;
}

/** Get all wallets for a user on a network */
export function getWalletsForNetwork(urn, network) {
  if (!urn || !network) return [];
  const raw = localStorage.getItem(walletsKey(urn, network));
  if (raw) {
    try { return JSON.parse(raw); } catch { return []; }
  }
  // Migrate from legacy single-wallet format
  const legacyKey = LEGACY_PREFIX + urn.toLowerCase() + '_' + network;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    try {
      const data = JSON.parse(legacy);
      const wallets = [{ address: data.address, encryptedWIF: data.encryptedWIF, label: '', storedAt: data.storedAt || Date.now() }];
      localStorage.setItem(walletsKey(urn, network), JSON.stringify(wallets));
      localStorage.removeItem(legacyKey);
      return wallets;
    } catch { return []; }
  }
  // Also check bare legacy (no network suffix)
  const bareLegacy = localStorage.getItem(LEGACY_PREFIX + urn.toLowerCase());
  if (bareLegacy) {
    try {
      const data = JSON.parse(bareLegacy);
      const net = data.network || 'btc-testnet';
      const wallets = [{ address: data.address, encryptedWIF: data.encryptedWIF, label: '', storedAt: data.storedAt || Date.now() }];
      localStorage.setItem(walletsKey(urn, net), JSON.stringify(wallets));
      localStorage.removeItem(LEGACY_PREFIX + urn.toLowerCase());
      if (net === network) return wallets;
    } catch {}
    return [];
  }
  return [];
}

/** Store (add or update) a wallet for a user on a network */
export function storeEncryptedWallet(urn, encryptedWIF, address, network, label = '') {
  const wallets = getWalletsForNetwork(urn, network);
  const idx = wallets.findIndex(w => w.address === address);
  if (idx >= 0) {
    // Update existing
    wallets[idx] = { ...wallets[idx], encryptedWIF, label: label || wallets[idx].label, storedAt: Date.now() };
  } else {
    wallets.push({ address, encryptedWIF, label, storedAt: Date.now() });
  }
  localStorage.setItem(walletsKey(urn, network), JSON.stringify(wallets));
}

/** Get a specific wallet's encrypted data (for unlock) */
export function getStoredWallet(urn, network, address) {
  const wallets = getWalletsForNetwork(urn, network);
  if (address) return wallets.find(w => w.address === address) || null;
  // No address specified — return the first wallet (backwards compat)
  return wallets[0] || null;
}

/** Remove a specific wallet */
export function removeStoredWallet(urn, network, address) {
  if (!address) {
    // Remove all wallets for this network
    localStorage.removeItem(walletsKey(urn, network));
    return;
  }
  const wallets = getWalletsForNetwork(urn, network).filter(w => w.address !== address);
  if (wallets.length === 0) {
    localStorage.removeItem(walletsKey(urn, network));
  } else {
    localStorage.setItem(walletsKey(urn, network), JSON.stringify(wallets));
  }
}

/** Update a wallet's label */
export function updateWalletLabel(urn, network, address, label) {
  const wallets = getWalletsForNetwork(urn, network);
  const idx = wallets.findIndex(w => w.address === address);
  if (idx >= 0) {
    wallets[idx].label = label;
    localStorage.setItem(walletsKey(urn, network), JSON.stringify(wallets));
  }
}

/** Get count of wallets for a network */
export function getWalletCount(urn, network) {
  return getWalletsForNetwork(urn, network).length;
}

/** Re-encrypt all wallets for a user across all networks with a new password */
export async function reEncryptAllWallets(urn, oldPassword, newPassword) {
  if (!urn) return;
  const prefix = WALLETS_PREFIX + urn.toLowerCase() + '_';
  const networks = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      networks.push(key.slice(prefix.length));
    }
  }
  for (const network of networks) {
    const wallets = getWalletsForNetwork(urn, network);
    const updated = [];
    for (const w of wallets) {
      try {
        const plainWif = await decryptWIF(w.encryptedWIF, oldPassword);
        if (plainWif) {
          const reEncrypted = await encryptWIF(plainWif, newPassword);
          updated.push({ ...w, encryptedWIF: reEncrypted, storedAt: Date.now() });
        } else {
          updated.push(w); // keep as-is if old password didn't work
        }
      } catch {
        updated.push(w); // keep as-is on error
      }
    }
    localStorage.setItem(walletsKey(urn, network), JSON.stringify(updated));
  }
}

export { MAX_WALLETS_PER_NETWORK };
