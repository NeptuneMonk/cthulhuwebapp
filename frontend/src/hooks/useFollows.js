import { useState, useEffect, useCallback, useRef } from 'react';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const STORAGE_PREFIX = 'cthulhu_follows_';

function storageKey(userAddress, network) {
  return STORAGE_PREFIX + (userAddress || 'anon') + '_' + network;
}

function loadFollows(userAddress, network) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userAddress, network))) || [];
  } catch {
    return [];
  }
}

function saveFollows(userAddress, network, follows) {
  localStorage.setItem(storageKey(userAddress, network), JSON.stringify(follows));
}

/** Sync follows to backend (debounced, fire-and-forget). */
function syncFollowsToBackend(userAddress, network, follows) {
  if (!userAddress || userAddress === 'anon') return;
  fetch(`${API}/user-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: userAddress, network, follows }),
  }).catch(() => {});
}

/**
 * Hook for managing followed profiles, scoped per user + network.
 * Each entry: { address, urn, image, display_name }
 * Auto-syncs to backend for persistence across cache clears.
 */
export function useFollows(network, userAddress) {
  const [follows, setFollows] = useState(() => loadFollows(userAddress, network));
  const restoredRef = useRef(false);

  // On init: load from backend, merge with localStorage (backend wins for missing entries)
  useEffect(() => {
    if (!userAddress || userAddress === 'anon' || restoredRef.current) return;
    restoredRef.current = true;
    const local = loadFollows(userAddress, network);
    import('@/utils/dedupFetch').then(({ dedupGet }) =>
      dedupGet(`${API}/user-state/${userAddress}?network=${network}`, 10000)
    ).then(data => {
        const remote = data?.follows || [];
        if (remote.length === 0 && local.length > 0) return; // local is authoritative if backend is empty
        if (remote.length > 0 && local.length === 0) {
          // Restore from backend
          saveFollows(userAddress, network, remote);
          setFollows(remote);
        } else if (remote.length > 0) {
          // Merge: keep local entries + add any remote-only entries
          const localAddrs = new Set(local.map(f => f.address));
          const merged = [...local];
          for (const r of remote) {
            if (!localAddrs.has(r.address)) merged.push(r);
          }
          if (merged.length !== local.length) {
            saveFollows(userAddress, network, merged);
            setFollows(merged);
          }
        }
      })
      .catch(() => {});
  }, [userAddress, network]);

  // Reset restored flag when user/network changes
  useEffect(() => {
    restoredRef.current = false;
    setFollows(loadFollows(userAddress, network));
  }, [network, userAddress]);

  // Sync across tabs
  useEffect(() => {
    const key = storageKey(userAddress, network);
    const onStorage = (e) => {
      if (e.key === key) setFollows(loadFollows(userAddress, network));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [network, userAddress]);

  const isFollowing = useCallback(
    (address) => follows.some((f) => f.address === address),
    [follows]
  );

  const toggleFollow = useCallback((profile) => {
    setFollows((prev) => {
      const exists = prev.some((f) => f.address === profile.address);
      const next = exists
        ? prev.filter((f) => f.address !== profile.address)
        : [...prev, {
            address: profile.address,
            urn: profile.urn,
            image: profile.image,
            display_name: profile.display_name,
            pkx: profile.pkx || '',
            pky: profile.pky || '',
          }];
      saveFollows(userAddress, network, next);
      // Sync to backend
      syncFollowsToBackend(userAddress, network, next);
      return next;
    });
  }, [network, userAddress]);

  return { follows, isFollowing, toggleFollow };
}
