/**
 * useBlockList — Manages a local blocked addresses list (mirrors SUP's block.txt).
 * Blocked users' content is hidden from feeds, DMs, and tethers.
 * Stored in localStorage, keyed by network.
 * Syncs across all hook instances via custom events.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';

const STORAGE_KEY = 'cthulhu_blocked';
const SYNC_EVENT = 'cthulhu-blocklist-changed';

function loadBlocked(network) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${network}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBlocked(network, list) {
  localStorage.setItem(`${STORAGE_KEY}_${network}`, JSON.stringify(list));
  // Fire custom event so all hook instances in this tab re-read
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { network } }));
}

export function useBlockList(network) {
  const [blockedList, setBlockedList] = useState(() => loadBlocked(network));

  // Re-read when another instance in the same tab writes
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.network === network) {
        setBlockedList(loadBlocked(network));
      }
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [network]);

  // Re-read when network changes
  useEffect(() => {
    setBlockedList(loadBlocked(network));
  }, [network]);

  const blockedSet = useMemo(() => new Set(blockedList.map(b => b.address)), [blockedList]);

  const isBlocked = useCallback((address) => blockedSet.has(address), [blockedSet]);

  const blockUser = useCallback((address, urn = '', reason = '') => {
    const current = loadBlocked(network);
    if (current.some(b => b.address === address)) return;
    const next = [...current, { address, urn, reason, blocked_at: new Date().toISOString() }];
    saveBlocked(network, next);
  }, [network]);

  const unblockUser = useCallback((address) => {
    const current = loadBlocked(network);
    const next = current.filter(b => b.address !== address);
    saveBlocked(network, next);
  }, [network]);

  const filterBlocked = useCallback((items, addressKey = 'from_address') => {
    if (blockedSet.size === 0) return items;
    return items.filter(item => !blockedSet.has(item[addressKey]));
  }, [blockedSet]);

  return { blockedList, blockedSet, isBlocked, blockUser, unblockUser, filterBlocked };
}
