import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getChangeAddress } from '@/utils/txBuilder';
import { getBalance } from '@/utils/chainExplorer';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STORAGE_KEY = 'cthulhu_wallet';

const WalletContext = createContext(null);

export function WalletProvider({ children, network, onConnect, onDisconnect }) {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null); // resolved SUP profile for this address

  // Load wallet from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.address && parsed.wif) {
          setWallet(parsed);
        }
      } catch { /* ignore corrupt data */ }
    }
  }, []);

  // Listen for auth→wallet sync events
  useEffect(() => {
    const handler = () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.address && parsed.wif) {
            setWallet(parsed);
            return;
          }
        } catch {}
      }
      // No valid wallet in storage — clear state
      setWallet(null);
      setBalance(null);
    };
    window.addEventListener('cthulhu-wallet-sync', handler);
    return () => window.removeEventListener('cthulhu-wallet-sync', handler);
  }, []);

  // When wallet loads (from storage or fresh), resolve profile + auto-claim
  useEffect(() => {
    if (wallet?.address) {
      resolveProfile(wallet.address);
    }
  }, [wallet?.address, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveProfile = async (address) => {
    try {
      const res = await axios.get(`${API}/profile/address/${address}`, { params: { network } });
      if (res.data && res.data.URN) {
        const p = {
          address,
          urn: res.data.URN,
          display_name: res.data.DisplayName || res.data.URN,
          image: res.data.Image || '',
        };
        setProfile(p);
        if (onConnect) onConnect(p);
        return p;
      }
    } catch { /* no profile found — that's ok */ }

    // No existing SUP profile, claim with just the address
    const p = { address, urn: null, display_name: address.substring(0, 12) + '...', image: '' };
    setProfile(p);
    if (onConnect) onConnect({ address, urn: null, display_name: null, image: null });
    return p;
  };

  // Fetch balance from both main address and derived change address
  const refreshBalance = useCallback(async () => {
    if (!wallet?.address) return;
    try {
      const mainBal = await getBalance(wallet.address, network);
      let totalBalance = {
        balance_sats: mainBal.total,
        balance_btc: mainBal.total / 1e8,
        confirmed_sats: mainBal.confirmed,
        unconfirmed_sats: mainBal.unconfirmed,
      };

      // Also fetch change address balance if WIF is available
      if (wallet.wif) {
        try {
          const changeAddr = getChangeAddress(wallet.wif, network);
          const changeBal = await getBalance(changeAddr, network);
          if (changeBal.total) {
            totalBalance.balance_sats = (totalBalance.balance_sats || 0) + changeBal.total;
            totalBalance.balance_btc = totalBalance.balance_sats / 1e8;
            totalBalance.change_address = changeAddr;
            totalBalance.change_balance_sats = changeBal.total;
          }
        } catch { /* change address may not exist yet */ }
      }

      setBalance(totalBalance);
    } catch (err) {
      console.error('Balance fetch error:', err);
    }
  }, [wallet?.address, wallet?.wif, network]);

  useEffect(() => {
    refreshBalance();
    const interval = setInterval(refreshBalance, 30000);
    return () => clearInterval(interval);
  }, [refreshBalance]);

  const createWallet = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/wallet/create?network=${network}`);
      const w = res.data;
      setWallet(w);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
      return w;
    } catch (err) {
      throw new Error(err.response?.data?.detail || 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const importWallet = async (wif) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/wallet/import?network=${network}`, { wif });
      const w = res.data;
      setWallet(w);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(w));

      // Trigger background P2FK address discovery (mirrors useAuth.importWallet)
      if (w.address) {
        fetch(`${API}/wallet/discover-addresses/${w.address}?network=${network}`)
          .then(r => r.json())
          .then(data => {
            if (data.addresses?.length > 0) {
              localStorage.setItem(`cthulhu_p2fk_addresses_${w.address}`, JSON.stringify(data.addresses));
            }
          }).catch(() => {});
      }

      return w;
    } catch (err) {
      throw new Error(err.response?.data?.detail || 'Invalid WIF key');
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    setBalance(null);
    setProfile(null);
    localStorage.removeItem(STORAGE_KEY);
    if (onDisconnect) onDisconnect();
  };

  return (
    <WalletContext.Provider value={{
      wallet, balance, loading, profile,
      createWallet, importWallet, disconnectWallet, refreshBalance,
      isConnected: !!wallet,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be inside WalletProvider');
  return ctx;
}
