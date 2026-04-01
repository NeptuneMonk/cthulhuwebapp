/**
 * Mempool Feed Monitor — SUP-style real-time feed updates.
 *
 * Mirrors SUP's mempool monitoring approach:
 *   1. Connects to mempool.space WebSocket
 *   2. Subscribes to tracked addresses (known users, own address)
 *   3. When new txs appear, signals the feed to refresh
 *   4. Manages optimistic local reactions (likes, tips, pins)
 *
 * Also provides a polling fallback for p2fk.io indexer updates.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_BACKEND_URL;
const WS_TESTNET = 'wss://mempool.space/testnet/api/v1/ws';
const WS_MAINNET = 'wss://mempool.space/api/v1/ws';

// ─── Local Reactions Store (persisted to localStorage, per-user) ──────────────
// Key: txid, Value: { likes: [addr, ...], tips: [{from, amount}], pins: [addr, ...] }
let _currentUser = '';

export function setReactionsUser(userAddress) {
  _currentUser = userAddress || 'anon';
}

function storageKey() {
  return `cthulhu_local_reactions_${_currentUser}`;
}

function readStore() {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeStore(store) {
  try { localStorage.setItem(storageKey(), JSON.stringify(store)); } catch {}
}

export function getLocalReactions(txid) {
  const store = readStore(); // Always read fresh from localStorage
  const r = store[txid];
  if (!r) return { likes: new Set(), tips: [], pins: new Set() };
  return {
    likes: new Set(r.likes || []),
    tips: r.tips || [],
    pins: new Set(r.pins || []),
  };
}

export function addLocalReaction(txid, type, myAddress, amount = 0) {
  const store = readStore();
  if (!store[txid]) {
    store[txid] = { likes: [], tips: [], pins: [] };
  }
  const r = store[txid];
  switch (type) {
    case 'like':
      if (!r.likes.includes(myAddress)) r.likes.push(myAddress);
      break;
    case 'tip':
      r.tips.push({ from: myAddress, amount });
      break;
    case 'pin':
      if (!r.pins.includes(myAddress)) r.pins.push(myAddress);
      break;
    default: break;
  }
  writeStore(store);
}

/**
 * Clear local reactions that have been confirmed on-chain.
 * Called by ReactionBar when chain data arrives.
 */
export function clearConfirmedReactions(txid, confirmedLikeAddrs, confirmedPinAddrs, chainTipTotal) {
  const store = readStore();
  const r = store[txid];
  if (!r) return;

  let changed = false;

  // Remove likes that are now on-chain
  if (r.likes && confirmedLikeAddrs.length > 0) {
    const before = r.likes.length;
    r.likes = r.likes.filter(a => !confirmedLikeAddrs.includes(a));
    if (r.likes.length !== before) changed = true;
  }

  // Remove pins that are now on-chain
  if (r.pins && confirmedPinAddrs.length > 0) {
    const before = r.pins.length;
    r.pins = r.pins.filter(a => !confirmedPinAddrs.includes(a));
    if (r.pins.length !== before) changed = true;
  }

  // Clear tips once the chain has confirmed tip data
  if (r.tips && r.tips.length > 0 && chainTipTotal > 0) {
    r.tips = [];
    changed = true;
  }

  if (changed) {
    // Clean up empty entries
    if (!r.likes?.length && !r.tips?.length && !r.pins?.length) {
      delete store[txid];
    } else {
      store[txid] = r;
    }
    writeStore(store);
  }
}

// ─── Fetch on-chain reactions from backend ─────────────────────────────
export async function fetchReactions(txid, network) {
  try {
    const res = await fetch(`${API}/api/reactions/${txid}?network=${network}`);
    if (res.ok) return await res.json();
  } catch { /* ignore */ }
  return null;
}

// ─── Mempool Feed Monitor Hook ─────────────────────────────────────────
export function useFeedMonitor(network, myAddress) {
  const [newTxCount, setNewTxCount] = useState(0);
  const wsRef = useRef(null);
  const aliveRef = useRef(false);
  const reconnectRef = useRef(null);

  const wsUrl = network?.includes('mainnet') ? WS_MAINNET : WS_TESTNET;

  const connect = useCallback(() => {
    if (!myAddress || wsRef.current) return;
    aliveRef.current = true;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Track our own address for incoming reactions
        ws.send(JSON.stringify({ 'track-address': myAddress }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // mempool.space sends { 'address-transactions': { address, mempool_txs: [...] } }
          if (data['address-transactions']) {
            const txs = data['address-transactions'].mempool_txs || [];
            if (txs.length > 0) {
              setNewTxCount(prev => prev + txs.length);
            }
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (aliveRef.current) {
          reconnectRef.current = setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => ws?.close();
    } catch { /* ignore */ }
  }, [wsUrl, myAddress]);

  const disconnect = useCallback(() => {
    aliveRef.current = false;
    clearTimeout(reconnectRef.current);
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  // Reset count (call after refresh)
  const clearNewTxCount = useCallback(() => setNewTxCount(0), []);

  return { newTxCount, clearNewTxCount };
}
