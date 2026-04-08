/**
 * NodeContext — Desktop App wallet connection manager.
 *
 * Replaces AuthContext for the Tauri desktop build.
 * Instead of WIF/password/login, this connects to locally-running
 * Core Wallet daemons (Bitcoin, Litecoin, Dogecoin, Maza) via the
 * backend's /api/node/* RPC proxy endpoints.
 *
 * NEVER imported by the web app.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

const NodeContext = createContext(null);

// Desktop networks: BTC has mainnet + testnet; others mainnet only
export const DESKTOP_NETWORKS = [
  { id: 'btc-mainnet', chain: 'BTC', network: 'mainnet', label: 'BTC Mainnet',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg' },
  { id: 'btc-testnet', chain: 'BTC', network: 'testnet', label: 'BTC Testnet',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg',
    filter: 'hue-rotate(90deg) saturate(1.5)' },
  { id: 'ltc-mainnet', chain: 'LTC', network: 'mainnet', label: 'LTC',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/ltc.svg' },
  { id: 'dog-mainnet', chain: 'DOG', network: 'mainnet', label: 'DOGE',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/doge.svg' },
  { id: 'mzc-mainnet', chain: 'MZC', network: 'mainnet', label: 'MZC',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/generic.svg' },
];

export function NodeProvider({ children }) {
  // Wallet connection status per chain
  const [wallets, setWallets] = useState({});
  const [connectedChains, setConnectedChains] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({});
  const [activeNetwork, setActiveNetwork] = useState(() =>
    localStorage.getItem('cthulhu_desktop_network') || 'btc-testnet'
  );
  const pollRef = useRef(null);

  // Derive current chain from active network
  const activeConfig = DESKTOP_NETWORKS.find(n => n.id === activeNetwork) || DESKTOP_NETWORKS[0];
  const activeChain = activeConfig.chain;
  const activeWallet = wallets[activeChain] || null;

  // ── Scan for connected wallets ──────────────────────────────────────
  const scanWallets = useCallback(async (network = 'mainnet') => {
    setScanning(true);
    try {
      const res = await fetch(`${API}/node/scan?network=${network}`, { method: 'POST' });
      const data = await res.json();
      setWallets(data.wallets || {});
      setConnectedChains(data.connected || []);
      return data;
    } catch (err) {
      console.error('Wallet scan failed:', err);
      return { wallets: {}, connected: [] };
    } finally {
      setScanning(false);
    }
  }, []);

  // ── Poll wallet status every 15s ────────────────────────────────────
  useEffect(() => {
    scanWallets(activeConfig.network);
    pollRef.current = setInterval(() => {
      fetch(`${API}/node/status`)
        .then(r => r.json())
        .then(data => {
          setWallets(data.wallets || {});
          setConnectedChains(data.connected || []);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(pollRef.current);
  }, [activeConfig.network, scanWallets]);

  // ── Get wallet info for a chain ────────────────────────────────────
  const getWalletInfo = useCallback(async (chain) => {
    try {
      const res = await fetch(`${API}/node/wallet/${chain}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, []);

  // ── Get address from Core Wallet ───────────────────────────────────
  const getAddress = useCallback(async (chain, label = '') => {
    try {
      const res = await fetch(`${API}/node/address/${chain}?label=${label}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.address;
    } catch { return null; }
  }, []);

  // ── Get UTXOs from Core Wallet ─────────────────────────────────────
  const getUtxos = useCallback(async (chain) => {
    try {
      const res = await fetch(`${API}/node/utxos/${chain}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.utxos || [];
    } catch { return []; }
  }, []);

  // ── Create + Sign + Broadcast via Core Wallet ──────────────────────
  const createAndSign = useCallback(async (chain, inputs, outputs) => {
    // Create raw tx
    const createRes = await fetch(`${API}/node/tx/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, inputs, outputs }),
    });
    if (!createRes.ok) throw new Error((await createRes.json()).detail || 'Create failed');
    const { raw_tx } = await createRes.json();

    // Sign via Core Wallet (keys never leave daemon)
    const signRes = await fetch(`${API}/node/tx/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, raw_tx_hex: raw_tx }),
    });
    if (!signRes.ok) throw new Error((await signRes.json()).detail || 'Sign failed');
    const signData = await signRes.json();

    if (!signData.complete) throw new Error('Signing incomplete — wallet missing keys');

    // Broadcast
    const broadcastRes = await fetch(`${API}/node/tx/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, signed_tx_hex: signData.hex }),
    });
    if (!broadcastRes.ok) throw new Error((await broadcastRes.json()).detail || 'Broadcast failed');
    return await broadcastRes.json();
  }, []);

  // ── Generic RPC passthrough ────────────────────────────────────────
  const rpcCall = useCallback(async (chain, method, params = []) => {
    const res = await fetch(`${API}/node/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, method, params }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'RPC failed');
    const data = await res.json();
    return data.result;
  }, []);

  // ── Scanner Control ────────────────────────────────────────────────
  const startScanner = useCallback(async (chain, network = 'mainnet') => {
    const res = await fetch(`${API}/node/scanner/start/${chain}?network=${network}`, { method: 'POST' });
    return await res.json();
  }, []);

  const stopScanner = useCallback(async (chain) => {
    const res = await fetch(`${API}/node/scanner/stop/${chain}`, { method: 'POST' });
    return await res.json();
  }, []);

  const getScannerProgress = useCallback(async () => {
    try {
      const res = await fetch(`${API}/node/scanner/progress`);
      const data = await res.json();
      setScanProgress(data.scanners || {});
      return data.scanners;
    } catch { return {}; }
  }, []);

  // ── Network switching ──────────────────────────────────────────────
  const switchNetwork = useCallback((networkId) => {
    localStorage.setItem('cthulhu_desktop_network', networkId);
    setActiveNetwork(networkId);
  }, []);

  // Derived state
  const isConnected = connectedChains.length > 0;
  const isChainConnected = connectedChains.includes(activeChain);

  const value = {
    // State
    wallets,
    connectedChains,
    scanning,
    scanProgress,
    activeNetwork,
    activeConfig,
    activeChain,
    activeWallet,
    isConnected,
    isChainConnected,

    // Actions
    scanWallets,
    getWalletInfo,
    getAddress,
    getUtxos,
    createAndSign,
    rpcCall,
    startScanner,
    stopScanner,
    getScannerProgress,
    switchNetwork,
  };

  return <NodeContext.Provider value={value}>{children}</NodeContext.Provider>;
}

export function useNode() {
  const ctx = useContext(NodeContext);
  if (!ctx) throw new Error('useNode must be used within NodeProvider');
  return ctx;
}

export default NodeContext;
