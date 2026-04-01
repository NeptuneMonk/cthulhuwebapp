import { useState, useEffect, useCallback } from 'react';

const STORAGE_PREFIX = 'cthulhu_claimed_';

function loadClaimed(network) {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + network)) || null;
  } catch {
    return null;
  }
}

/**
 * Hook for managing a claimed profile, scoped per network.
 * Stores { address, urn, image, display_name } in localStorage.
 */
export function useClaimedProfile(network) {
  const [claimed, setClaimed] = useState(() => loadClaimed(network));

  // Reload when network changes
  useEffect(() => {
    setClaimed(loadClaimed(network));
  }, [network]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_PREFIX + network) setClaimed(loadClaimed(network));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [network]);

  const claimProfile = useCallback((profile) => {
    const data = {
      address: profile.address,
      urn: profile.urn,
      image: profile.image,
      display_name: profile.display_name,
    };
    localStorage.setItem(STORAGE_PREFIX + network, JSON.stringify(data));
    setClaimed(data);
  }, [network]);

  const unclaimProfile = useCallback(() => {
    localStorage.removeItem(STORAGE_PREFIX + network);
    setClaimed(null);
  }, [network]);

  return { claimed, claimProfile, unclaimProfile };
}
