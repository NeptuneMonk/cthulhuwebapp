import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  encryptWIF, decryptWIF,
  storeEncryptedWallet, getStoredWallet, removeStoredWallet,
  getWalletsForNetwork, reEncryptAllWallets,
} from '@/utils/walletCrypto';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const AUTH_USER_KEY = 'cthulhu_auth_user';
const SESSION_WIF_KEY = 'cthulhu_session_wif';
const RECOVERY_KEY = 'cthulhu_auth_recovery';
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function cleanWif(wif) {
  return wif.split('').filter(c => BASE58_CHARS.includes(c)).join('');
}

/** Save minimal recovery data that survives auth wipes (urn + address + network) */
function saveRecovery(urn, address, network) {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify({ urn, address, network, ts: Date.now() })); } catch {}
}
function getRecovery() {
  try { return JSON.parse(localStorage.getItem(RECOVERY_KEY)); } catch { return null; }
}

/** Profile lookup via backend proxy (avoids CORS issues with direct p2fk.io calls) */
async function lookupOnChainProfile(address, network) {
  try {
    const { dedupGet } = await import('@/utils/dedupFetch');
    const data = await dedupGet(`${API}/profile/${address}?network=${network || 'btc-testnet'}`, 15000);
    if (data) {
      // Backend formats profile differently — check for minted profile
      const urn = data?.URN || data?.urn;
      if (urn && urn !== address) {
        return {
          urn: urn,
          display_name: data.Name || data.display_name || urn,
          bio: data.Bio || data.bio || null,
          image: data.Image || data.image || null,
          is_minted: true,
        };
      }
    }
  } catch (e) { console.warn('Profile lookup failed:', e); }
  return null;
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY)); } catch { return null; }
  });
  const [wif, _setWif] = useState(() => {
    try { const s = sessionStorage.getItem(SESSION_WIF_KEY); return s || null; } catch { return null; }
  });
  const setWif = useCallback((w) => {
    _setWif(w);
    try { if (w) sessionStorage.setItem(SESSION_WIF_KEY, w); else sessionStorage.removeItem(SESSION_WIF_KEY); } catch {}
  }, []);
  const [loading, setLoading] = useState(true);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  // "Finding your blob..." state
  const [lookingUp, setLookingUp] = useState(false);

  // On mount: check for stored wallet → show unlock or auth page (NO server call)
  useEffect(() => {
    const recovery = getRecovery();
    if (recovery?.address) {
      const stored = getStoredWallet(recovery.urn || recovery.address, recovery.network, recovery.address);
      if (stored?.encryptedWIF) {
        // Encrypted wallet exists → show unlock prompt
        const recoveredUser = {
          urn: recovery.urn || recovery.address,
          address: recovery.address,
          addresses: { [recovery.network]: recovery.address },
          network: recovery.network,
          is_minted: !!recovery.urn && recovery.urn !== recovery.address,
        };
        setUser(recoveredUser);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(recoveredUser));
        // Check if WIF is already in session
        const sessionWif = sessionStorage.getItem(SESSION_WIF_KEY);
        if (!sessionWif) {
          setNeedsUnlock(true);
        }
      }
    }
    setLoading(false);
  }, []);

  // Bridge: sync auth wallet → legacy useWallet system
  useEffect(() => {
    if (wif && user?.address) {
      const legacyData = { address: user.address, wif, network: user.network || 'btc-testnet' };
      localStorage.setItem('cthulhu_wallet', JSON.stringify(legacyData));
      window.dispatchEvent(new CustomEvent('cthulhu-wallet-sync'));
    } else if (!wif) {
      const existing = localStorage.getItem('cthulhu_wallet');
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed.wif) {
            localStorage.removeItem('cthulhu_wallet');
            window.dispatchEvent(new CustomEvent('cthulhu-wallet-sync'));
          }
        } catch {}
      }
    }
  }, [wif, user?.address, user?.network]);

  // --- Core helpers ---

  const updateUserState = useCallback((updates) => {
    setUser(prev => {
      const updated = { ...prev, ...updates };
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // --- Pure client-side auth operations ---

  /** Import a WIF key — derive address, encrypt, store, look up on-chain. No server. */
  const importKeyLogin = useCallback(async (wifKey, password, network = 'btc-testnet') => {
    const clean = cleanWif(wifKey);
    if (clean.length < 50) throw new Error('Invalid WIF — too short (' + clean.length + ' chars)');

    // Step 1: Derive addresses for ALL supported networks up front
    const { getAddressFromWIF } = await import('@/utils/txBuilder');
    let address;
    const allAddresses = {};
    try {
      address = getAddressFromWIF(clean, network);
      allAddresses[network] = address;
    } catch (e) {
      throw new Error('Key derivation failed: ' + (e.message || 'unknown'));
    }
    if (!address) throw new Error('Could not derive address from WIF — check that the key matches the selected network');

    // Derive for other networks too (same WIF → different addresses per network)
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === network) continue;
      try {
        const otherAddr = getAddressFromWIF(clean, net);
        if (otherAddr) allAddresses[net] = otherAddr;
      } catch {}
    }

    // Step 2: Encrypt and store for ALL networks
    let encryptedWIF;
    try {
      encryptedWIF = await encryptWIF(clean, password);
    } catch (e) {
      throw new Error('Encryption failed: ' + (e.message || 'unknown'));
    }

    // Store encrypted wallet for primary network
    try {
      storeEncryptedWallet(address, encryptedWIF, address, network, 'Primary');
    } catch (e) {
      throw new Error('Storage failed: ' + (e.message || 'unknown'));
    }

    // Store for other networks immediately (so switching works without re-import)
    for (const [net, addr] of Object.entries(allAddresses)) {
      if (net === network) continue;
      try { storeEncryptedWallet(address, encryptedWIF, addr, net, 'Primary'); } catch {}
    }

    // Set initial user state with ALL derived addresses
    const userObj = {
      urn: address,
      address,
      addresses: allAddresses,
      network,
      is_minted: false,
    };
    setUser(userObj);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userObj));
    setWif(clean);
    setNeedsUnlock(false);

    // "Finding your blob on-chain..."
    setLookingUp(true);
    try {
      const profile = await lookupOnChainProfile(address, network);
      if (profile) {
        // Re-store wallets under the on-chain URN key for all networks
        storeEncryptedWallet(profile.urn, encryptedWIF, address, network, 'Primary');
        for (const [net, addr] of Object.entries(allAddresses)) {
          if (net === network) continue;
          try { storeEncryptedWallet(profile.urn, encryptedWIF, addr, net, 'Primary'); } catch {}
        }
        const updated = {
          ...userObj,
          urn: profile.urn,
          display_name: profile.display_name,
          bio: profile.bio,
          image: profile.image,
          is_minted: true,
          addresses: allAddresses, // preserve all network addresses
        };
        setUser(updated);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
        saveRecovery(profile.urn, address, network);
      } else {
        saveRecovery(address, address, network);
      }
    } catch { /* Non-fatal — user is logged in regardless */ }
    setLookingUp(false);

    // Trigger background P2FK address discovery
    fetch(`${API}/wallet/discover-addresses/${address}?network=${network}`)
      .then(r => r.json())
      .then(disc => {
        if (disc.addresses?.length > 0) {
          localStorage.setItem(`cthulhu_p2fk_addresses_${address}`, JSON.stringify(disc.addresses));
        }
      }).catch(() => {});

    return { address, urn: userObj.urn };
  }, [setWif]);

  /** Create a new wallet (client-side keypair gen). Returns { wif, address } for backup screen. */
  const createNewWallet = useCallback(async (password, network = 'btc-testnet') => {
    const { generateNewWallet, getAddressFromWIF } = await import('@/utils/txBuilder');
    const { wif: newWif, address } = generateNewWallet(network);

    const encryptedWIF = await encryptWIF(newWif, password);
    storeEncryptedWallet(address, encryptedWIF, address, network, 'Primary');

    // Derive and store for all networks
    const allAddresses = { [network]: address };
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === network) continue;
      try {
        const otherAddr = getAddressFromWIF(newWif, net);
        if (otherAddr) {
          storeEncryptedWallet(address, encryptedWIF, otherAddr, net, 'Primary');
          allAddresses[net] = otherAddr;
        }
      } catch {}
    }

    const userObj = {
      urn: address,
      address,
      addresses: allAddresses,
      network,
      is_minted: false,
    };
    setUser(userObj);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userObj));
    saveRecovery(address, address, network);
    setWif(newWif);
    setNeedsUnlock(false);

    // Generate key pool in background
    import('@/utils/keyPool').then(({ generatePoolKeys }) => {
      generatePoolKeys(address, password, 50, network).catch(() => {});
    });

    return { wif: newWif, address };
  }, [setWif]);

  /** Import an additional wallet (when already logged in) */
  const importWallet = useCallback(async (importedWif, password, label = '') => {
    if (!user) throw new Error('Must be logged in');
    const clean = cleanWif(importedWif);
    if (clean.length < 50) throw new Error('Invalid WIF — too short after cleaning');
    const network = user.network || 'btc-testnet';

    const existing = getWalletsForNetwork(user.urn, network);

    const { getAddressFromWIF } = await import('@/utils/txBuilder');
    const importedAddress = getAddressFromWIF(clean, network);
    if (!importedAddress) throw new Error('Could not derive address from WIF');

    const encryptedWIF = await encryptWIF(clean, password);
    storeEncryptedWallet(user.urn, encryptedWIF, importedAddress, network, label);

    // Also store for other networks
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === network) continue;
      try {
        const otherAddr = getAddressFromWIF(clean, net);
        if (otherAddr) storeEncryptedWallet(user.urn, encryptedWIF, otherAddr, net, label);
      } catch {}
    }

    const updatedAddresses = { ...(user.addresses || {}), [network]: importedAddress };
    // Also populate other network addresses from this WIF
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === network) continue;
      try {
        const otherAddr = getAddressFromWIF(clean, net);
        if (otherAddr && !updatedAddresses[net]) updatedAddresses[net] = otherAddr;
      } catch {}
    }
    updateUserState({ addresses: updatedAddresses, address: importedAddress });
    setWif(clean);

    // Trigger background P2FK address discovery
    fetch(`${API}/wallet/discover-addresses/${importedAddress}?network=${network}`)
      .then(r => r.json())
      .then(data => {
        if (data.addresses?.length > 0) {
          localStorage.setItem(`cthulhu_p2fk_addresses_${importedAddress}`, JSON.stringify(data.addresses));
        }
      }).catch(() => {});
  }, [user, updateUserState, setWif]);

  /** Import a WIF for a SPECIFIC target network (used during network switch) */
  const importWalletForNetwork = useCallback(async (importedWif, password, targetNetwork) => {
    if (!user) throw new Error('Must be logged in');
    const clean = cleanWif(importedWif);
    if (clean.length < 50) throw new Error('Invalid WIF — too short after cleaning');

    const { getAddressFromWIF } = await import('@/utils/txBuilder');
    const importedAddress = getAddressFromWIF(clean, targetNetwork);
    if (!importedAddress) throw new Error('Could not derive address from WIF for ' + targetNetwork);

    const encryptedWIF = await encryptWIF(clean, password);
    storeEncryptedWallet(user.urn, encryptedWIF, importedAddress, targetNetwork, 'Imported');

    // Also store for other networks from same WIF
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === targetNetwork) continue;
      try {
        const otherAddr = getAddressFromWIF(clean, net);
        if (otherAddr) storeEncryptedWallet(user.urn, encryptedWIF, otherAddr, net, 'Imported');
      } catch {}
    }

    // Update addresses and switch to target network
    const updatedAddresses = { ...(user.addresses || {}), [targetNetwork]: importedAddress };
    for (const net of ['btc-testnet', 'btc-mainnet']) {
      if (net === targetNetwork) continue;
      try {
        const otherAddr = getAddressFromWIF(clean, net);
        if (otherAddr && !updatedAddresses[net]) updatedAddresses[net] = otherAddr;
      } catch {}
    }
    updateUserState({ addresses: updatedAddresses, network: targetNetwork, address: importedAddress });
    setWif(clean);
  }, [user, updateUserState, setWif]);

  /** Unlock the active wallet with password */
  const unlockWallet = useCallback(async (password) => {
    if (!user) throw new Error('No wallet to unlock');
    // Try with URN key first, then with address key
    let stored = getStoredWallet(user.urn, user.network, user.address);
    if (!stored?.encryptedWIF) {
      stored = getStoredWallet(user.address, user.network, user.address);
    }
    if (!stored?.encryptedWIF) throw new Error('No wallet found. Please import your WIF.');
    const decryptedWif = await decryptWIF(stored.encryptedWIF, password);
    if (!decryptedWif) throw new Error('Wrong password');
    const clean = cleanWif(decryptedWif);
    setWif(clean);
    setNeedsUnlock(false);

    // Verify address matches WIF — reconcile if stale
    const { getAddressFromWIF } = await import('@/utils/txBuilder');
    const derivedAddr = getAddressFromWIF(clean, user.network);
    if (derivedAddr && derivedAddr !== user.address) {
      const updatedAddresses = { ...(user.addresses || {}), [user.network]: derivedAddr };
      updateUserState({ addresses: updatedAddresses, address: derivedAddr });
    }

    // Background: refresh on-chain profile
    if (derivedAddr || user.address) {
      lookupOnChainProfile(derivedAddr || user.address, user.network).then(profile => {
        if (profile) {
          updateUserState({
            urn: profile.urn,
            display_name: profile.display_name,
            is_minted: true,
          });
          saveRecovery(profile.urn, derivedAddr || user.address, user.network);
        }
      }).catch(() => {});
    }

    return true;
  }, [user, updateUserState, setWif]);

  /** Change password — re-encrypts all local wallets */
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) throw new Error('Must be logged in');

    // Re-encrypt the active wallet using in-memory WIF
    if (wif && user.urn && user.address && user.network) {
      const freshEncrypted = await encryptWIF(wif, newPassword);
      storeEncryptedWallet(user.urn, freshEncrypted, user.address, user.network);
    }

    // Re-encrypt other wallets
    await reEncryptAllWallets(user.urn, currentPassword, newPassword);

    return true;
  }, [user, wif]);

  /** Switch active wallet on same network */
  const switchActiveWallet = useCallback(async (address, password) => {
    if (!user) throw new Error('Must be logged in');
    const network = user.network;
    const stored = getStoredWallet(user.urn, network, address);
    if (!stored?.encryptedWIF) throw new Error('Wallet not found on this device');
    const decryptedWif = await decryptWIF(stored.encryptedWIF, password);
    if (!decryptedWif) throw new Error('Incorrect password');

    const updatedAddresses = { ...(user.addresses || {}), [network]: address };
    updateUserState({ addresses: updatedAddresses, address });
    setWif(cleanWif(decryptedWif));
  }, [user, updateUserState, setWif]);

  /** Remove a wallet */
  const removeWallet = useCallback(async (network, address) => {
    if (!user) throw new Error('Must be logged in');
    removeStoredWallet(user.urn, network, address);

    const wallets = getWalletsForNetwork(user.urn, network);
    const isActive = user.address === address && user.network === network;

    if (isActive) {
      if (wallets.length > 0) {
        const next = wallets[0];
        const updatedAddresses = { ...(user.addresses || {}), [network]: next.address };
        updateUserState({ addresses: updatedAddresses, address: next.address });
      } else {
        const updatedAddresses = { ...(user.addresses || {}) };
        delete updatedAddresses[network];
        const newAddr = network === user.network ? '' : user.address;
        updateUserState({ addresses: updatedAddresses, address: newAddr });
      }
      setWif(null);
    }
  }, [user, updateUserState, setWif]);

  /** Reset all wallets for a network */
  const resetNetworkWallet = useCallback(async (network) => {
    if (!user) throw new Error('Must be logged in');
    removeStoredWallet(user.urn, network);
    const updatedAddresses = { ...(user.addresses || {}) };
    delete updatedAddresses[network];
    const isCurrentNetwork = user.network === network;
    updateUserState({
      addresses: updatedAddresses,
      address: isCurrentNetwork ? '' : user.address,
    });
    if (isCurrentNetwork) setWif(null);
  }, [user, updateUserState, setWif]);

  const logout = useCallback(() => {
    // Clear session state but KEEP wallet encryption + recovery data
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem('cthulhu_pending_mints');
    localStorage.removeItem('cthulhu-pending-posts');
    localStorage.removeItem('cthulhu_pending_txs');
    localStorage.removeItem('cthulhu_walkie_state');
    localStorage.removeItem('cthulhu_custom_wallpaper');
    if (localStorage.getItem('cthulhu_wallpaper') === 'custom') {
      localStorage.setItem('cthulhu_wallpaper', 'none');
    }
    setUser(null);
    setWif(null);
    setNeedsUnlock(false);
  }, [setWif]);

  /** Switch to a different network */
  const switchNetwork = useCallback((newNetwork) => {
    if (!user) return;
    const addresses = user.addresses || {};
    const newAddress = addresses[newNetwork] || null;
    updateUserState({ network: newNetwork, address: newAddress || '' });
    setWif(null);
  }, [user, updateUserState, setWif]);

  /** Switch network and unlock in one step */
  const switchNetworkWithPassword = useCallback(async (newNetwork, password) => {
    if (!user) throw new Error('Must be logged in');
    const addresses = user.addresses || {};
    const newAddress = addresses[newNetwork] || null;
    if (!newAddress) throw new Error('No wallet for this network');

    let stored = getStoredWallet(user.urn, newNetwork, newAddress);
    if (!stored?.encryptedWIF) stored = getStoredWallet(user.address, newNetwork, newAddress);
    if (!stored?.encryptedWIF) throw new Error('No wallet found for this network on this device');
    const decryptedWif = await decryptWIF(stored.encryptedWIF, password);
    if (!decryptedWif) throw new Error('Incorrect password');

    updateUserState({ network: newNetwork, address: newAddress });
    setWif(cleanWif(decryptedWif));
  }, [user, updateUserState, setWif]);

  /** Activate a stored wallet on a network where user.addresses[network] is not yet set */
  const activateStoredWalletForNetwork = useCallback(async (address, password, network) => {
    if (!user) throw new Error('Must be logged in');
    const stored = getStoredWallet(user.urn, network, address);
    if (!stored?.encryptedWIF) throw new Error('Wallet not found on this device');
    const decryptedWif = await decryptWIF(stored.encryptedWIF, password);
    if (!decryptedWif) throw new Error('Incorrect password');
    const updatedAddresses = { ...(user.addresses || {}), [network]: address };
    updateUserState({ addresses: updatedAddresses, address, network });
    setWif(cleanWif(decryptedWif));
  }, [user, updateUserState, setWif]);

  /** Generate a new wallet for a network */
  const generateWalletForNetwork = useCallback(async (network, password) => {
    if (!user) throw new Error('Must be logged in');

    const existing = getWalletsForNetwork(user.urn, network);

    const { generateNewWallet } = await import('@/utils/txBuilder');
    const { wif: newWif, address } = generateNewWallet(network);

    const encryptedWIF = await encryptWIF(newWif, password);
    storeEncryptedWallet(user.urn, encryptedWIF, address, network);

    const updatedAddresses = { ...(user.addresses || {}), [network]: address };
    updateUserState({ addresses: updatedAddresses, network, address });
    setWif(newWif);

    return { address, wif: newWif };
  }, [user, updateUserState, setWif]);

  /** Get all local wallets for the current network */
  const getLocalWallets = useCallback(() => {
    if (!user) return [];
    return getWalletsForNetwork(user.urn, user.network);
  }, [user]);

  /** Rename URN (local-only in blockchain model) */
  const renameUrn = useCallback(async (newUrn) => {
    if (!user) throw new Error('Must be logged in');
    updateUserState({ urn: newUrn });
    saveRecovery(newUrn, user.address, user.network);
    return { urn: newUrn };
  }, [user, updateUserState]);

  const isConnected = !!user;
  const isWalletUnlocked = !!wif;
  const hasWalletForNetwork = !!user?.address;

  return (
    <AuthContext.Provider value={{
      user,
      token: null, // No JWT — blockchain is the auth
      wif,
      isConnected,
      isWalletUnlocked,
      hasWalletForNetwork,
      isMinted: user?.is_minted || false,
      needsUnlock,
      loading,
      lookingUp,
      // New blockchain-identity auth
      importKeyLogin,
      createNewWallet,
      // Wallet management
      importWallet,
      importWalletForNetwork,
      unlockWallet,
      changePassword,
      switchNetwork,
      switchNetworkWithPassword,
      activateStoredWalletForNetwork,
      generateWalletForNetwork,
      switchActiveWallet,
      removeWallet,
      resetNetworkWallet,
      getLocalWallets,
      renameUrn,
      logout,
      // Legacy compat — these are no-ops now
      signup: async () => { throw new Error('Use createNewWallet instead'); },
      login: async () => { throw new Error('Use importKeyLogin instead'); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
