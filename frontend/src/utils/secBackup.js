/**
 * SEC Backup — Raw on-chain encrypted state injection.
 *
 * Architecture:
 *   Save:  collect state → AES-256-GCM encrypt → encode into raw addresses
 *          → broadcast as plain TX (no P2FK SIG header) → return TXID
 *   Restore: fetch TX by TXID → decode output addresses → decrypt → restore state
 *
 * The TX has NO SIG header, NO keyword addresses — it's invisible to all
 * P2FK indexers (p2fk.io, SUP, Cthulhu feeds). Just burned dust to data addresses.
 * Only someone with the WIF + TXID can decode and decrypt.
 *
 * Backup pointer format: "tBTC:txid" or "BTC:txid" (network prefix + transaction ID)
 */

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { ecc } from '@/utils/ecc';
import { buildAndBroadcast, fetchUtxos, getAddressFromWIF } from '@/utils/txBuilder';

const ECPair = ECPairFactory(ecc);
const API = process.env.REACT_APP_BACKEND_URL + '/api';

const SEC_BACKUP_HISTORY_KEY = 'cthulhu_sec_backup_history';

// ─── Crypto (AES-256-GCM via Web Crypto API) ───

async function deriveAESKey(wif) {
  const keyPair = ECPair.fromWIF(wif, [bitcoin.networks.testnet, bitcoin.networks.bitcoin]);
  const seed = new Uint8Array([...keyPair.privateKey, ...new TextEncoder().encode('cthulhu-sec')]);
  const rawKey = new Uint8Array(await crypto.subtle.digest('SHA-256', seed));
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(wif, plaintext) {
  const key = await deriveAESKey(wif);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  // Return: IV (12) + ciphertext+tag
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

async function aesDecrypt(wif, data) {
  const key = await deriveAESKey(wif);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(pt);
}

// ─── Address encoding (raw 20-byte chunks, no SIG header) ───

function encodeToAddresses(dataBytes, versionByte) {
  // Prepend 4-byte big-endian length so we know where real data ends
  const len = dataBytes.length;
  const header = new Uint8Array(4);
  header[0] = (len >> 24) & 0xff;
  header[1] = (len >> 16) & 0xff;
  header[2] = (len >> 8) & 0xff;
  header[3] = len & 0xff;

  const full = new Uint8Array(4 + len);
  full.set(header, 0);
  full.set(dataBytes, 4);

  const addresses = [];
  for (let i = 0; i < full.length; i += 20) {
    const chunk = Buffer.alloc(20, 0x23); // '#' padding
    const slice = full.slice(i, i + 20);
    chunk.set(slice, 0);
    addresses.push(bitcoin.address.toBase58Check(chunk, versionByte));
  }
  return addresses;
}

function decodeFromAddresses(addresses, versionByte) {
  const chunks = [];
  for (const addr of addresses) {
    try {
      const decoded = bitcoin.address.fromBase58Check(addr);
      if (decoded.version === versionByte) {
        chunks.push(new Uint8Array(decoded.hash));
      }
    } catch {
      // Skip non-decodable addresses (change addr, etc.)
    }
  }
  if (chunks.length === 0) throw new Error('No data addresses found in transaction');

  const raw = new Uint8Array(chunks.length * 20);
  chunks.forEach((c, i) => raw.set(c, i * 20));

  // Read length header
  const len = (raw[0] << 24) | (raw[1] << 16) | (raw[2] << 8) | raw[3];
  if (len <= 0 || len > raw.length - 4) throw new Error('Invalid data length in SEC backup');
  return raw.slice(4, 4 + len);
}

// ─── State collection (reused from stateBackup logic) ───

function collectNetworkState(address, network) {
  const state = {};
  const keys = [
    [`cthulhu_follows_${address}_${network}`, 'follows'],
    [`cthulhu_rooms_${address}_${network}`, 'tetheredRooms'],
    [`cthulhu_pinned_${address}_${network}`, 'pinnedFriends'],
    [`cthulhu_obj_addresses_${address}`, 'objectAddresses'],
    [`cthulhu_tx_history_${address}`, 'txHistory'],
    [`cthulhu_change_addr_${address}`, 'changeAddress'],
    [`cthulhu_unread_${address}`, 'unreadState'],
    [`cthulhu_notifsync_dm_${address}`, 'dmLastSeen'],
    [`cthulhu_notifsync_cleared_${address}`, 'dmClearedBefore'],
    [`cthulhu_notifsync_mentions_${address}`, 'mentionsSeen'],
  ];
  for (const [lsKey, field] of keys) {
    try {
      const val = localStorage.getItem(lsKey);
      if (val) state[field] = field === 'changeAddress' ? val : JSON.parse(val);
    } catch {}
  }
  // Profile URN
  try {
    const urn = localStorage.getItem(`cthulhu_profile_urn_${network}`);
    if (urn) state.profileUrn = urn;
  } catch {}
  // Room avatars
  try {
    const roomAvatars = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`cthulhu_room_avatar_${address}_`)) {
        roomAvatars[k] = localStorage.getItem(k);
      }
    }
    if (Object.keys(roomAvatars).length) state.roomAvatars = roomAvatars;
  } catch {}
  // Collection WIFs (critical for recovery)
  for (const net of ['btc-testnet', 'btc-mainnet']) {
    try {
      const colKey = `cthulhu_collections_${net}_${address}`;
      const cols = localStorage.getItem(colKey);
      if (cols) state[`collections_${net}`] = JSON.parse(cols);
    } catch {}
  }
  // Object derivation index
  try {
    const idx = localStorage.getItem(`p2fk_obj_idx_${address}`);
    if (idx) state.objectIndex = parseInt(idx, 10);
  } catch {}
  // Blocklist
  try {
    const blocked = localStorage.getItem(`cthulhu_blocked_${network}`);
    if (blocked) state.blockedUsers = JSON.parse(blocked);
  } catch {}
  state.address = address;
  return state;
}

async function collectAllState(wif) {
  const bundle = { version: 4, type: 'SEC', savedAt: new Date().toISOString(), networks: {}, preferences: {} };
  for (const net of ['btc-testnet', 'btc-mainnet']) {
    try {
      const addr = getAddressFromWIF(wif, net);
      if (!addr) continue;
      const localState = collectNetworkState(addr, net);
      // Fetch favorites/playlists from backend
      try {
        const res = await fetch(`${API}/favorites/${addr}?network=${encodeURIComponent(net)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.favorites?.length) localState.favorites = data.favorites;
          if (data.playlists?.length) localState.playlists = data.playlists;
        }
      } catch {}
      if (Object.keys(localState).length > 1) bundle.networks[net] = localState;
    } catch {}
  }
  // Global preferences
  for (const [lsKey, field] of [
    ['cthulhu_wallpaper', 'wallpaper'],
    ['cthulhu_auto_pin', 'autoPin'],
    ['cthulhu_walkie_state', 'walkieState'],
    ['cthulhu_network', 'selectedNetwork'],
  ]) {
    try {
      const val = localStorage.getItem(lsKey);
      if (val) bundle.preferences[field] = val;
    } catch {}
  }
  return bundle;
}

// ─── Public API ───

/**
 * Estimate on-chain cost for a SEC backup.
 */
export async function estimateSECCost(wif) {
  const bundle = await collectAllState(wif);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  // AES-GCM adds 12 (IV) + 16 (tag) bytes. Length header adds 4.
  const encryptedSize = plaintext.length + 28 + 4;
  const numAddresses = Math.ceil(encryptedSize / 20);
  const dustCost = numAddresses * 546;
  const txFee = Math.max(Math.ceil(numAddresses * 34 * 2), 500); // ~34 bytes per output, ~2 sat/vbyte
  return {
    bundleSize: plaintext.length,
    encryptedSize,
    numAddresses,
    dustCost,
    txFee,
    totalSats: dustCost + txFee,
    itemCount: Object.values(bundle.networks).reduce((sum, n) =>
      sum + (n.follows?.length || 0) + (n.tetheredRooms?.length || 0)
      + (n.favorites?.length || 0) + (n.playlists?.length || 0)
      + (n.objectAddresses?.length || 0), 0),
  };
}

/**
 * Etch encrypted state to chain. Returns { success, txid, network }.
 * Always etches to testnet.
 */
export async function secBackupToChain(wif, network = 'btc-testnet') {
  if (!wif) throw new Error('No WIF');

  // Sync IndexedDB DM state
  try {
    const { syncIndexedDBToSnapshots } = await import('@/utils/notificationSync');
    await syncIndexedDBToSnapshots();
  } catch {}

  const bundle = await collectAllState(wif);
  const hasData = Object.keys(bundle.networks).length > 0;
  if (!hasData) throw new Error('Nothing to backup');

  // Encrypt
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = await aesEncrypt(wif, plaintext);

  // Encode into raw addresses (testnet version byte = 111)
  const etchNetwork = 'btc-testnet';
  const versionByte = 111;
  const addresses = encodeToAddresses(encrypted, versionByte);

  console.log(`[SEC] Backup: ${plaintext.length} bytes → ${encrypted.length} encrypted → ${addresses.length} addresses`);

  // Broadcast raw TX (no SIG, no keywords — just dust to data addresses)
  const result = await buildAndBroadcast(wif, addresses, etchNetwork, [], 0, 546, []);
  if (!result.success) throw new Error(result.error || 'Broadcast failed');

  // Save to local history
  const entry = {
    txid: result.txid,
    network: etchNetwork,
    savedAt: new Date().toISOString(),
    itemCount: Object.values(bundle.networks).reduce((sum, n) =>
      sum + (n.follows?.length || 0) + (n.tetheredRooms?.length || 0)
      + (n.favorites?.length || 0) + (n.playlists?.length || 0), 0),
    cost: result.cost_sats,
    addressCount: addresses.length,
  };
  addToHistory(entry);

  return { success: true, ...entry, pointer: `tBTC:${result.txid}` };
}

/**
 * Restore state from a SEC backup by TXID.
 * Fetches the raw TX, decodes output addresses, decrypts, and restores state.
 */
export async function secRestoreFromTxid(wif, txid, txNetwork = 'btc-testnet') {
  if (!wif || !txid) throw new Error('WIF and TXID required');

  // Fetch TX outputs from blockchain explorer
  const outputs = await fetchTxOutputs(txid, txNetwork);
  if (!outputs.length) throw new Error('Transaction not found or has no outputs');

  // Filter dust outputs (546 sats) — these carry our data
  // Exclude the change output (which will have a much larger value)
  const dustOutputs = outputs.filter(o => o.value <= 600);
  if (dustOutputs.length < 2) throw new Error('Not a SEC backup transaction (too few dust outputs)');

  const versionByte = txNetwork.includes('mainnet') ? 0 : 111;
  const dataAddresses = dustOutputs.map(o => o.address);

  // Decode addresses → encrypted bytes
  const encrypted = decodeFromAddresses(dataAddresses, versionByte);

  // Decrypt
  let bundle;
  try {
    const plaintext = await aesDecrypt(wif, encrypted);
    bundle = JSON.parse(new TextDecoder().decode(plaintext));
  } catch (e) {
    throw new Error('Decryption failed — wrong WIF or corrupted backup');
  }

  if (!bundle.networks) throw new Error('Invalid backup format');

  // Restore state
  const restored = {};
  for (const [net, data] of Object.entries(bundle.networks)) {
    const addr = data.address;
    if (!addr) continue;

    // Merge-restore each data type
    restored[net] = restoreNetworkState(addr, net, data);
  }

  // Restore preferences
  const prefs = bundle.preferences || {};
  for (const [field, lsKey] of [
    ['wallpaper', 'cthulhu_wallpaper'],
    ['autoPin', 'cthulhu_auto_pin'],
    ['walkieState', 'cthulhu_walkie_state'],
    ['selectedNetwork', 'cthulhu_network'],
  ]) {
    if (prefs[field] && !localStorage.getItem(lsKey)) {
      localStorage.setItem(lsKey, prefs[field]);
      restored[field] = true;
    }
  }

  // Restore favorites/playlists to backend
  for (const [net, data] of Object.entries(bundle.networks)) {
    const addr = data.address;
    if (!addr) continue;
    if (data.favorites?.length || data.playlists?.length) {
      try {
        const curRes = await fetch(`${API}/favorites/${addr}?network=${encodeURIComponent(net)}`);
        const cur = curRes.ok ? await curRes.json() : { favorites: [], playlists: [] };
        const existingUrls = new Set((cur.favorites || []).map(f => f.url));
        for (const fav of (data.favorites || [])) {
          if (fav.url && !existingUrls.has(fav.url)) {
            await fetch(`${API}/favorites/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr, network: net, ...fav }),
            }).catch(() => {});
          }
        }
        const existingPl = new Set((cur.playlists || []).map(p => p.name));
        for (const pl of (data.playlists || [])) {
          if (pl.name && !existingPl.has(pl.name)) {
            await fetch(`${API}/favorites/playlist`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr, network: net, name: pl.name, itemIds: pl.itemIds || [] }),
            }).catch(() => {});
          }
        }
      } catch {}
    }
  }

  return {
    restored,
    backupDate: bundle.savedAt,
    version: bundle.version,
    txid,
  };
}

// ─── Helpers ───

function restoreNetworkState(addr, net, data) {
  const counts = {};

  // Merge-restore arrays
  const arrayRestores = [
    ['follows', `cthulhu_follows_${addr}_${net}`, 'address'],
    ['tetheredRooms', `cthulhu_rooms_${addr}_${net}`, 'objectAddress'],
    ['pinnedFriends', `cthulhu_pinned_${addr}_${net}`, 'address'],
    ['objectAddresses', `cthulhu_obj_addresses_${addr}`, 'address'],
    ['txHistory', `cthulhu_tx_history_${addr}`, 'txid'],
    ['mentionsSeen', `cthulhu_notifsync_mentions_${addr}`, null],
  ];

  for (const [field, key, idField] of arrayRestores) {
    if (!data[field]?.length) continue;
    try {
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      if (idField) {
        const existing = new Set(local.map(x => x[idField]));
        const merged = [...local];
        let added = 0;
        for (const item of data[field]) {
          if (!existing.has(item[idField])) { merged.push(item); added++; }
        }
        if (added > 0 || local.length === 0) {
          localStorage.setItem(key, JSON.stringify(added > 0 ? merged : data[field]));
          counts[field] = added || data[field].length;
        }
      } else {
        // Simple array merge (e.g., mentionsSeen)
        const merged = [...new Set([...local, ...data[field]])];
        localStorage.setItem(key, JSON.stringify(merged));
        counts[field] = merged.length - local.length || data[field].length;
      }
    } catch {}
  }

  // Simple string restores
  if (data.profileUrn) {
    localStorage.setItem(`cthulhu_profile_urn_${net}`, data.profileUrn);
    counts.profileUrn = true;
  }
  if (data.changeAddress) {
    const k = `cthulhu_change_addr_${addr}`;
    if (!localStorage.getItem(k)) { localStorage.setItem(k, data.changeAddress); counts.changeAddress = true; }
  }
  if (data.objectIndex != null) {
    const k = `p2fk_obj_idx_${addr}`;
    const cur = parseInt(localStorage.getItem(k) || '0', 10);
    if (data.objectIndex > cur) { localStorage.setItem(k, String(data.objectIndex)); counts.objectIndex = true; }
  }

  // Blocklist restore
  if (data.blockedUsers?.length) {
    try {
      const blKey = `cthulhu_blocked_${net}`;
      const local = JSON.parse(localStorage.getItem(blKey) || '[]');
      const existing = new Set(local.map(b => b.address));
      let added = 0;
      const merged = [...local];
      for (const item of data.blockedUsers) {
        if (!existing.has(item.address)) { merged.push(item); added++; }
      }
      if (added > 0) {
        localStorage.setItem(blKey, JSON.stringify(merged));
        counts.blockedUsers = added;
      }
    } catch {}
  }

  // Object merge restores (unread, dmLastSeen, etc.)
  const objectRestores = [
    ['unreadState', `cthulhu_unread_${addr}`],
    ['dmLastSeen', `cthulhu_notifsync_dm_${addr}`],
    ['dmClearedBefore', `cthulhu_notifsync_cleared_${addr}`],
  ];
  for (const [field, key] of objectRestores) {
    if (!data[field] || typeof data[field] !== 'object') continue;
    try {
      const local = JSON.parse(localStorage.getItem(key) || '{}');
      const merged = { ...local, ...data[field] };
      localStorage.setItem(key, JSON.stringify(merged));
      counts[field] = Object.keys(data[field]).length;
    } catch {}
  }

  // Room avatars
  if (data.roomAvatars) {
    let c = 0;
    for (const [k, v] of Object.entries(data.roomAvatars)) {
      if (!localStorage.getItem(k)) { localStorage.setItem(k, v); c++; }
    }
    if (c) counts.roomAvatars = c;
  }

  // Collection WIFs
  for (const colNet of ['btc-testnet', 'btc-mainnet']) {
    const colKey = `collections_${colNet}`;
    if (data[colKey]?.length) {
      const lsKey = `cthulhu_collections_${colNet}_${addr}`;
      try {
        const local = JSON.parse(localStorage.getItem(lsKey) || '[]');
        const existing = new Set(local.map(c => c.address));
        let added = 0;
        const merged = [...local];
        for (const col of data[colKey]) {
          if (!existing.has(col.address)) { merged.push(col); added++; }
        }
        if (added > 0) {
          localStorage.setItem(lsKey, JSON.stringify(merged));
          counts[colKey] = added;
        }
      } catch {}
    }
  }

  return counts;
}

async function fetchTxOutputs(txid, networkName) {
  // Try mempool.space API first (works for BTC testnet/mainnet)
  const isMainnet = networkName.includes('mainnet');
  const mempoolBase = isMainnet
    ? 'https://mempool.space/api'
    : 'https://mempool.space/testnet/api';

  try {
    const res = await fetch(`${mempoolBase}/tx/${txid}`);
    if (res.ok) {
      const tx = await res.json();
      return (tx.vout || []).map(o => ({
        address: o.scriptpubkey_address,
        value: o.value,
      }));
    }
  } catch {}

  // Fallback: our backend raw TX endpoint
  try {
    const res = await fetch(`${API}/wallet/raw-tx/${txid}?network=${networkName}`);
    if (res.ok) {
      const data = await res.json();
      // Parse raw TX hex to extract outputs
      const tx = bitcoin.Transaction.fromHex(data.hex || data.raw_tx || data);
      const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
      return tx.outs.map(o => {
        try {
          return { address: bitcoin.address.fromOutputScript(o.script, network), value: o.value };
        } catch { return null; }
      }).filter(Boolean);
    }
  } catch {}

  throw new Error('Could not fetch transaction. Check the TXID and network.');
}

// ─── Backup History (localStorage) ───

export function getBackupHistory() {
  try {
    return JSON.parse(localStorage.getItem(SEC_BACKUP_HISTORY_KEY) || '[]');
  } catch { return []; }
}

function addToHistory(entry) {
  const history = getBackupHistory();
  history.unshift(entry); // newest first
  // Keep last 20
  localStorage.setItem(SEC_BACKUP_HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
}

export function getLastBackup() {
  const history = getBackupHistory();
  return history.length > 0 ? history[0] : null;
}

/**
 * Parse a backup pointer string like "tBTC:abc123..." into { network, txid }.
 */
export function parsePointer(pointer) {
  if (!pointer || typeof pointer !== 'string') return null;
  const match = pointer.match(/^(tBTC|BTC|tDOGE|DOGE|tLTC|LTC|tMZC|MZC):([a-fA-F0-9]{64})$/);
  if (!match) return null;
  const prefixMap = {
    'tBTC': 'btc-testnet', 'BTC': 'btc-mainnet',
    'tDOGE': 'doge-testnet', 'DOGE': 'doge-mainnet',
    'tLTC': 'ltc-testnet', 'LTC': 'ltc-mainnet',
    'tMZC': 'mzc-testnet', 'MZC': 'mzc-mainnet',
  };
  return { network: prefixMap[match[1]] || 'btc-testnet', txid: match[2] };
}
