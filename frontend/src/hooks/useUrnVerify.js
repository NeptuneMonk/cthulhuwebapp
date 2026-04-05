import { useState, useCallback, useRef } from 'react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Module-level cache: URN → { official_address, impersonation_detected, ts }
const urnCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve a URN to its official (earliest) claimant address.
 * Results are cached module-wide so all components share the same data.
 */
export async function resolveUrnOfficial(urn, network = 'btc-testnet') {
  if (!urn) return null;
  const key = `${urn}__${network}`;
  const cached = urnCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;

  try {
    const res = await fetch(`${API}/urn/verify/${encodeURIComponent(urn)}?network=${network}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = {
      official_address: data.official_address,
      impersonation_detected: data.impersonation_detected,
      claimants: data.claimants || [],
      ts: Date.now(),
    };
    urnCache[key] = entry;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Check if a given address is the official owner of a URN.
 * An object can temporarily have two creators during trades,
 * so we check if the official address is one of the creators.
 * Returns: true (official), false (impersonator), null (unknown/not yet checked).
 */
export function isOfficialCached(urn, address, network = 'btc-testnet') {
  if (!urn || !address) return null;
  const key = `${urn}__${network}`;
  const cached = urnCache[key];
  if (!cached || Date.now() - cached.ts > CACHE_TTL) return null;
  if (!cached.impersonation_detected) return true; // No dupes — they're the real one
  // Check if the given address matches the official registered address
  return cached.official_address === address;
}

/**
 * Hook for checking URN availability during profile creation.
 * Returns { checkUrn, urnStatus, urnError }
 */
export function useUrnAvailability(network = 'btc-testnet') {
  const [urnStatus, setUrnStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [urnError, setUrnError] = useState('');
  const debounceRef = useRef(null);

  const checkUrn = useCallback((urn) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setUrnError('');

    if (!urn || urn.trim().length < 2) {
      setUrnStatus(null);
      return;
    }

    setUrnStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await resolveUrnOfficial(urn.trim(), network);
        if (!result || !result.official_address) {
          setUrnStatus('available');
          setUrnError('');
        } else {
          setUrnStatus('taken');
          setUrnError(`"${urn}" is already claimed by ${result.official_address.slice(0, 12)}...`);
        }
      } catch {
        setUrnStatus(null);
        setUrnError('Could not verify URN availability');
      }
    }, 600);
  }, [network]);

  return { checkUrn, urnStatus, urnError };
}

/**
 * Hook for lazy-checking if a profile is official.
 * Checks in background, returns the result when ready.
 */
export function useOfficialCheck(urn, address, network = 'btc-testnet') {
  const [isOfficial, setIsOfficial] = useState(null);
  const checkedRef = useRef(false);

  if (urn && address && !checkedRef.current) {
    // Check cache first (synchronous)
    const cached = isOfficialCached(urn, address, network);
    if (cached !== null && isOfficial !== cached) {
      setIsOfficial(cached);
      checkedRef.current = true;
    } else if (cached === null) {
      // Fire async check once
      checkedRef.current = true;
      resolveUrnOfficial(urn, network).then(result => {
        if (!result) return;
        const official = !result.impersonation_detected || result.official_address === address;
        setIsOfficial(official);
      });
    }
  }

  return isOfficial;
}
