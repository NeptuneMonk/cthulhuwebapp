import { useState, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Hook to check if the current user has published encryption keys (PKX/PKY).
 * Returns { hasKeys, loading, refresh } — call refresh() after publishing.
 */
export function useMyKeys(address, network) {
  const [hasKeys, setHasKeys] = useState(null); // null = loading, true/false = known
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address || !network) { setHasKeys(null); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/profile/keys/${address}?network=${network}`);
      const data = await res.json();
      setHasKeys(!!data.has_keys);
    } catch {
      setHasKeys(false);
    }
    setLoading(false);
  }, [address, network]);

  useEffect(() => { refresh(); }, [refresh]);

  return { hasKeys, loading, refresh };
}
