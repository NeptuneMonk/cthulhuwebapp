/**
 * Chain Backup — On-chain encrypted backup for contacts, playlists, settings.
 *
 * Architecture:
 *   Save:  collect ALL-network state (localStorage + favorites/playlists from API)
 *          → ECIES encrypt → base64 → etch on TESTNET as P2FK post with keyword
 *          CTHULHU_BACKUP containing the encrypted data inline.
 *   Restore: discover CTHULHU_BACKUP posts → parse content → ECIES decrypt
 *            → restore to localStorage + re-POST favorites/playlists.
 *
 * Always etches to testnet (free) regardless of current network.
 * Bundles data from BOTH mainnet and testnet in one encrypted blob.
 */

import { ECPairFactory } from 'ecpair';
import * as bitcoin from 'bitcoinjs-lib';
import { ecc } from '@/utils/ecc';
import { eciesEncrypt, eciesDecrypt, publicKeyFromPrivate } from '@/utils/ecies';
import { uint8ToBase64 } from '@/utils/binaryUtils';
import { buildPostTransaction, estimateOnChainCost } from '@/utils/p2fk';
import { buildAndBroadcast, getAddressFromWIF, getChangeAddress } from '@/utils/txBuilder';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const ECPair = ECPairFactory(ecc);
const LAST_BACKUP_KEY = 'cthulhu_last_chain_backup';
const BACKUP_KEYWORD = 'CTHULHU_BACKUP';

const TESTNET = bitcoin.networks.testnet;
const MAINNET = bitcoin.networks.bitcoin;

/**
 * Collect state for a SPECIFIC network from localStorage.
 */
function collectNetworkState(address, network) {
  const state = {};
  try {
    const follows = localStorage.getItem(`cthulhu_follows_${address}_${network}`);
    if (follows) state.follows = JSON.parse(follows);
  } catch {}
  try {
    const rooms = localStorage.getItem(`cthulhu_rooms_${address}_${network}`);
    if (rooms) state.tetheredRooms = JSON.parse(rooms);
  } catch {}
  try {
    const pins = localStorage.getItem(`cthulhu_pinned_${address}_${network}`);
    if (pins) state.pinnedFriends = JSON.parse(pins);
  } catch {}
  try {
    const urn = localStorage.getItem(`cthulhu_profile_urn_${network}`);
    if (urn) state.profileUrn = urn;
  } catch {}
  try {
    const objAddrs = localStorage.getItem(`cthulhu_obj_addresses_${address}`);
    if (objAddrs) state.objectAddresses = JSON.parse(objAddrs);
  } catch {}
  try {
    const txH = localStorage.getItem(`cthulhu_tx_history_${address}`);
    if (txH) state.txHistory = JSON.parse(txH);
  } catch {}
  try {
    const chg = localStorage.getItem(`cthulhu_change_addr_${address}`);
    if (chg) state.changeAddress = chg;
  } catch {}
  // Notification state
  try {
    const unread = localStorage.getItem(`cthulhu_unread_${address}`);
    if (unread) state.unreadState = JSON.parse(unread);
  } catch {}
  try {
    const dmLast = localStorage.getItem(`cthulhu_notifsync_dm_${address}`);
    if (dmLast) state.dmLastSeen = JSON.parse(dmLast);
  } catch {}
  try {
    const dmCleared = localStorage.getItem(`cthulhu_notifsync_cleared_${address}`);
    if (dmCleared) state.dmClearedBefore = JSON.parse(dmCleared);
  } catch {}
  try {
    const mentions = localStorage.getItem(`cthulhu_notifsync_mentions_${address}`);
    if (mentions) state.mentionsSeen = JSON.parse(mentions);
  } catch {}
  try {
    const roomAvatars = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`cthulhu_room_avatar_${address}_`)) {
        roomAvatars[key] = localStorage.getItem(key);
      }
    }
    if (Object.keys(roomAvatars).length) state.roomAvatars = roomAvatars;
  } catch {}

  state.address = address;
  return state;
}

/**
 * Fetch favorites + playlists from the backend API for a given address/network.
 */
async function fetchFavoritesAndPlaylists(address, network) {
  try {
    const res = await fetch(`${API}/favorites/${address}?network=${encodeURIComponent(network)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      favorites: data.favorites || [],
      playlists: data.playlists || [],
    };
  } catch {
    return null;
  }
}

/**
 * Collect ALL state: all networks + global preferences + favorites/playlists.
 */
async function collectAllState(wif) {
  const bundle = { version: 3, savedAt: new Date().toISOString(), networks: {}, preferences: {} };

  const networks = ['btc-testnet', 'btc-mainnet'];
  for (const net of networks) {
    try {
      const addr = getAddressFromWIF(wif, net);
      if (!addr) continue;
      const localState = collectNetworkState(addr, net);
      // Fetch favorites/playlists from backend
      const favData = await fetchFavoritesAndPlaylists(addr, net);
      if (favData) {
        localState.favorites = favData.favorites;
        localState.playlists = favData.playlists;
      }
      if (Object.keys(localState).length > 1) { // > 1 because 'address' is always present
        bundle.networks[net] = localState;
      }
    } catch {}
  }

  // Global preferences
  try {
    const wallpaper = localStorage.getItem('cthulhu_wallpaper');
    if (wallpaper) bundle.preferences.wallpaper = wallpaper;
    const autoPin = localStorage.getItem('cthulhu_auto_pin');
    if (autoPin) bundle.preferences.autoPin = autoPin;
    const walkieState = localStorage.getItem('cthulhu_walkie_state');
    if (walkieState) bundle.preferences.walkieState = walkieState;
    const selectedNetwork = localStorage.getItem('cthulhu_network');
    if (selectedNetwork) bundle.preferences.selectedNetwork = selectedNetwork;
  } catch {}

  return bundle;
}

/**
 * Estimate the on-chain cost for a backup.
 * Returns { numAddresses, dustCost, txFee, totalSats, bundleSize, encryptedEstimate }.
 */
export async function estimateBackupCost(wif) {
  const bundle = await collectAllState(wif);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const estimate = estimateOnChainCost(plaintext.length);
  return {
    ...estimate,
    bundleSize: plaintext.length,
    itemCount: Object.values(bundle.networks).reduce((sum, n) =>
      sum + (n.follows?.length || 0) + (n.tetheredRooms?.length || 0)
      + (n.favorites?.length || 0) + (n.playlists?.length || 0), 0),
  };
}

/**
 * Save state to the blockchain (testnet P2FK post with inline encrypted data).
 * Always etches to testnet regardless of current network.
 *
 * Returns { success, txid } or throws.
 */
export async function backupStateToChain(wif, address, network) {
  if (!wif) return { success: false, error: 'No WIF' };

  // Sync IndexedDB DM state to localStorage snapshots before collecting
  try {
    const { syncIndexedDBToSnapshots } = await import('@/utils/notificationSync');
    await syncIndexedDBToSnapshots();
  } catch {}

  const bundle = await collectAllState(wif);
  const hasData = Object.keys(bundle.networks).length > 0 || bundle.preferences;
  if (!hasData) return { success: false, error: 'Nothing to backup' };

  console.log('[ChainBackup] Started — networks:', Object.keys(bundle.networks));

  // ECIES encrypt with user's own public key
  const keyPair = ECPair.fromWIF(wif, [TESTNET, MAINNET]);
  const { publicKey: pubKey } = publicKeyFromPrivate(keyPair.privateKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const encrypted = await eciesEncrypt(pubKey, plaintext);
  const encryptedBase64 = uint8ToBase64(encrypted);

  // Build post content: BACKUP:v3:<base64_encrypted_data>
  const postContent = `BACKUP:v3:${encryptedBase64}`;

  console.log('[ChainBackup] Encrypted, size:', encryptedBase64.length, 'bytes');

  // Build P2FK post on TESTNET with CTHULHU_BACKUP keyword
  const txData = buildPostTransaction(wif, postContent, [BACKUP_KEYWORD], null, 'btc-testnet');

  console.log('[ChainBackup] P2FK payload built, broadcasting...');

  const result = await buildAndBroadcast(
    wif,
    txData.addresses,
    'btc-testnet',
    [],   // no extra outputs
    0,    // auto fee
    546,  // standard dust
    [],   // no post-payment dust
    txData.taxInsertIndex
  );

  const savedMeta = {
    txid: result.txid,
    savedAt: new Date().toISOString(),
    itemCount: Object.values(bundle.networks).reduce((sum, n) =>
      sum + (n.follows?.length || 0) + (n.tetheredRooms?.length || 0)
      + (n.favorites?.length || 0) + (n.playlists?.length || 0), 0),
  };
  localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(savedMeta));

  return { success: true, ...savedMeta };
}

/**
 * Discover and restore state from an on-chain backup.
 * Queries the backend for CTHULHU_BACKUP keyword posts from user's testnet address.
 *
 * Returns { restored: {...counts}, backupDate } or null if not found.
 */
export async function restoreStateFromChain(wif, address, network) {
  if (!wif) return null;

  const testnetAddr = getAddressFromWIF(wif, 'btc-testnet');

  // Ask backend to discover on-chain backup
  const discoverRes = await fetch(`${API}/vault/discover-onchain/${testnetAddr}?network=${encodeURIComponent(network)}`);
  if (!discoverRes.ok) return null;
  const discovery = await discoverRes.json();

  // Store the latest self-PM date as "notifications seen before" cutoff
  if (discovery.latest_self_pm) {
    localStorage.setItem(`cthulhu_vault_cutoff_${address}`, discovery.latest_self_pm);
  }

  // Try v3 (inline encrypted data) first
  let encryptedBase64 = null;
  let timestamp = null;
  let txid = null;

  if (discovery.backup_v3) {
    encryptedBase64 = discovery.backup_v3.data;
    timestamp = discovery.backup_v3.timestamp;
    txid = discovery.backup_v3.txid;
  } else if (discovery.found && discovery.backup?.cid) {
    // Fallback to legacy v2 (IPFS-based) — try to fetch from IPFS
    const { cid } = discovery.backup;
    txid = discovery.backup.txid;
    timestamp = discovery.backup.timestamp;
    try {
      const ipfsRes = await fetch(`${API}/ipfs/cat/${cid}`);
      if (ipfsRes.ok) {
        encryptedBase64 = await ipfsRes.text();
      } else {
        throw new Error('Local IPFS miss');
      }
    } catch {
      try {
        const gwRes = await fetch(`https://ipfs.io/ipfs/${cid}`);
        if (gwRes.ok) encryptedBase64 = await gwRes.text();
      } catch {}
    }
  }

  if (!encryptedBase64) return null;

  // Decrypt
  const keyPair = ECPair.fromWIF(wif, [TESTNET, MAINNET]);
  const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const decrypted = await eciesDecrypt(keyPair.privateKey, encryptedBytes);
  const bundle = JSON.parse(new TextDecoder().decode(decrypted));

  const restored = {};

  // Restore each network's data
  for (const [net, data] of Object.entries(bundle.networks || {})) {
    const addr = data.address;
    if (!addr) continue;

    // Follows (merge)
    if (data.follows?.length) {
      const key = `cthulhu_follows_${addr}_${net}`;
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      const localAddrs = new Set(local.map(f => f.address));
      const merged = [...local];
      let added = 0;
      for (const f of data.follows) {
        if (!localAddrs.has(f.address)) { merged.push(f); added++; }
      }
      if (added > 0 || local.length === 0) {
        localStorage.setItem(key, JSON.stringify(added > 0 ? merged : data.follows));
        restored[`${net}_follows`] = added || data.follows.length;
      }
    }

    // Tethered rooms (merge)
    if (data.tetheredRooms?.length) {
      const key = `cthulhu_rooms_${addr}_${net}`;
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      const localAddrs = new Set(local.map(r => r.objectAddress));
      const merged = [...local];
      let added = 0;
      for (const r of data.tetheredRooms) {
        if (!localAddrs.has(r.objectAddress)) { merged.push(r); added++; }
      }
      if (added > 0 || local.length === 0) {
        localStorage.setItem(key, JSON.stringify(added > 0 ? merged : data.tetheredRooms));
        restored[`${net}_rooms`] = added || data.tetheredRooms.length;
      }
    }

    // Pinned friends
    if (data.pinnedFriends?.length) {
      const key = `cthulhu_pinned_${addr}_${net}`;
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      if (local.length === 0) {
        localStorage.setItem(key, JSON.stringify(data.pinnedFriends));
        restored[`${net}_pinnedFriends`] = data.pinnedFriends.length;
      }
    }

    // Profile URN
    if (data.profileUrn) {
      localStorage.setItem(`cthulhu_profile_urn_${net}`, data.profileUrn);
      restored[`${net}_profileUrn`] = data.profileUrn;
    }

    // Object addresses
    if (data.objectAddresses?.length) {
      const key = `cthulhu_obj_addresses_${addr}`;
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      if (local.length === 0) {
        localStorage.setItem(key, JSON.stringify(data.objectAddresses));
        restored[`${net}_objectAddresses`] = data.objectAddresses.length;
      }
    }

    // Room avatars
    if (data.roomAvatars) {
      let count = 0;
      for (const [k, val] of Object.entries(data.roomAvatars)) {
        if (!localStorage.getItem(k)) { localStorage.setItem(k, val); count++; }
      }
      if (count) restored[`${net}_roomAvatars`] = count;
    }

    // Transaction history (merge)
    if (data.txHistory?.length) {
      const txKey = `cthulhu_tx_history_${addr}`;
      const localTx = JSON.parse(localStorage.getItem(txKey) || '[]');
      const localTxIds = new Set(localTx.map(t => t.txid));
      const merged = [...localTx];
      let added = 0;
      for (const t of data.txHistory) {
        if (t.txid && !localTxIds.has(t.txid)) { merged.push(t); added++; }
      }
      if (added > 0 || localTx.length === 0) {
        localStorage.setItem(txKey, JSON.stringify(added > 0 ? merged : data.txHistory));
        restored[`${net}_txHistory`] = added || data.txHistory.length;
      }
    }

    // Change address
    if (data.changeAddress) {
      const key = `cthulhu_change_addr_${addr}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, data.changeAddress);
        restored[`${net}_changeAddress`] = true;
      }
    }

    // Notification state
    if (data.unreadState && typeof data.unreadState === 'object') {
      const key = `cthulhu_unread_${addr}`;
      let local = {};
      try { local = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
      const merged = { ...local };
      let count = 0;
      for (const [roomId, remoteData] of Object.entries(data.unreadState)) {
        const localTs = (merged[roomId] || {}).markedReadAt || '';
        const remoteTs = remoteData?.markedReadAt || '';
        if (remoteTs > localTs) { merged[roomId] = remoteData; count++; }
      }
      if (count > 0 || !localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(count > 0 ? merged : data.unreadState));
        restored[`${net}_unreadState`] = count || Object.keys(data.unreadState).length;
      }
    }

    // DM last-seen timestamps (merge)
    if (data.dmLastSeen && typeof data.dmLastSeen === 'object') {
      const key = `cthulhu_notifsync_dm_${addr}`;
      let local = {};
      try { local = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
      const merged = { ...local };
      let count = 0;
      for (const [dmKey, ts] of Object.entries(data.dmLastSeen)) {
        if (ts > (merged[dmKey] || '')) { merged[dmKey] = ts; count++; }
      }
      if (count > 0 || !localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(count > 0 ? merged : data.dmLastSeen));
        restored[`${net}_dmLastSeen`] = count || Object.keys(data.dmLastSeen).length;
      }
    }

    // DM cleared-before timestamps (merge)
    if (data.dmClearedBefore && typeof data.dmClearedBefore === 'object') {
      const key = `cthulhu_notifsync_cleared_${addr}`;
      let local = {};
      try { local = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
      const merged = { ...local };
      let count = 0;
      for (const [convKey, ts] of Object.entries(data.dmClearedBefore)) {
        if (ts > (merged[convKey] || '')) { merged[convKey] = ts; count++; }
      }
      if (count > 0 || !localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(count > 0 ? merged : data.dmClearedBefore));
        restored[`${net}_dmClearedBefore`] = count || Object.keys(data.dmClearedBefore).length;
      }
    }

    // Seen mentions (merge)
    if (data.mentionsSeen?.length) {
      const key = `cthulhu_notifsync_mentions_${addr}`;
      let local = [];
      try { local = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
      const merged = [...new Set([...local, ...data.mentionsSeen])];
      if (merged.length > local.length || !localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(merged));
        restored[`${net}_mentionsSeen`] = merged.length - local.length || data.mentionsSeen.length;
      }
    }

    // Restore favorites & playlists to backend API
    if (data.favorites?.length || data.playlists?.length) {
      try {
        // Fetch current favorites from backend
        const curRes = await fetch(`${API}/favorites/${addr}?network=${encodeURIComponent(net)}`);
        const cur = curRes.ok ? await curRes.json() : { favorites: [], playlists: [] };
        const existingUrls = new Set((cur.favorites || []).map(f => f.url));
        const existingPlaylistNames = new Set((cur.playlists || []).map(p => p.name));

        // Restore favorites (merge by URL)
        let favAdded = 0;
        for (const fav of (data.favorites || [])) {
          if (fav.url && !existingUrls.has(fav.url)) {
            await fetch(`${API}/favorites/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr, network: net, ...fav }),
            });
            favAdded++;
          }
        }
        if (favAdded) restored[`${net}_favorites`] = favAdded;

        // Restore playlists (merge by name)
        let plAdded = 0;
        for (const pl of (data.playlists || [])) {
          if (pl.name && !existingPlaylistNames.has(pl.name)) {
            await fetch(`${API}/favorites/playlist`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: addr, network: net, name: pl.name, itemIds: pl.itemIds || [] }),
            });
            plAdded++;
          }
        }
        if (plAdded) restored[`${net}_playlists`] = plAdded;
      } catch (e) {
        console.warn('[ChainBackup] Failed to restore favorites/playlists:', e);
      }
    }
  }

  // Restore global preferences (only if not already set)
  const prefs = bundle.preferences || {};
  if (prefs.wallpaper && !localStorage.getItem('cthulhu_wallpaper')) {
    localStorage.setItem('cthulhu_wallpaper', prefs.wallpaper);
    restored.wallpaper = true;
  }
  if (prefs.autoPin && !localStorage.getItem('cthulhu_auto_pin')) {
    localStorage.setItem('cthulhu_auto_pin', prefs.autoPin);
    restored.autoPin = true;
  }
  if (prefs.walkieState && !localStorage.getItem('cthulhu_walkie_state')) {
    localStorage.setItem('cthulhu_walkie_state', prefs.walkieState);
    restored.walkieState = true;
  }
  if (prefs.selectedNetwork && !localStorage.getItem('cthulhu_network')) {
    localStorage.setItem('cthulhu_network', prefs.selectedNetwork);
    restored.selectedNetwork = prefs.selectedNetwork;
  }

  return {
    _restored: restored,
    _backupDate: bundle.savedAt || timestamp,
    _txid: txid,
  };
}

/**
 * Get last backup save metadata from localStorage.
 */
export function getLastBackupSave() {
  try {
    return JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) || 'null');
  } catch { return null; }
}

/**
 * isCacheEnabled / setCacheEnabledPref — used by useCachedIPFS hook.
 */
export function isCacheEnabled() {
  return localStorage.getItem('cthulhu_ipfs_cache_enabled') !== 'false';
}
export function setCacheEnabledPref(val) {
  localStorage.setItem('cthulhu_ipfs_cache_enabled', val ? 'true' : 'false');
}

/**
 * Fetch backup history (last N save-points) from the blockchain.
 * Returns array of { txid, timestamp, block_date }.
 */
export async function fetchBackupHistory(address, limit = 12) {
  if (!address) return [];
  try {
    const res = await fetch(`${API}/vault/history/${address}?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.save_points || [];
  } catch { return []; }
}

// Legacy exports for backward compatibility
export const backupStateToVault = backupStateToChain;
export const restoreStateFromVault = restoreStateFromChain;
export const getLastVaultSave = getLastBackupSave;
export const fetchVaultHistory = fetchBackupHistory;
