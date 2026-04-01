import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOptimisticItems,
  getOptimisticByAddress,
  addOptimisticItem,
  updateOptimisticStatus,
  removeOptimisticItem,
  cleanupStaleItems,
} from '@/utils/optimisticCache';

const API = process.env.REACT_APP_BACKEND_URL;
const POLL_INTERVAL = 30_000; // 30s

/**
 * Hook for reading and managing optimistic P2FK actions.
 * Polls mempool.space for TX confirmation status and backend proxy for indexer status.
 */
export function useOptimisticCache(network, senderAddress) {
  const [items, setItems] = useState([]);
  const pollRef = useRef(null);

  // Load items
  const refresh = useCallback(async () => {
    if (!network) return;
    const all = senderAddress
      ? await getOptimisticByAddress(senderAddress)
      : await getOptimisticItems(network);
    // Filter to current network
    setItems(all.filter(i => i.network === network));
  }, [network, senderAddress]);

  useEffect(() => { refresh(); }, [refresh]);

  // Add a new optimistic item
  const addItem = useCallback(async (item) => {
    await addOptimisticItem({ ...item, network, senderAddress });
    refresh();
  }, [network, senderAddress, refresh]);

  // Poll for status changes
  useEffect(() => {
    if (!network || items.length === 0) return;

    const isMainnet = network.includes('mainnet');
    const mempoolBase = isMainnet
      ? 'https://mempool.space/api'
      : 'https://mempool.space/testnet/api';

    const poll = async () => {
      let changed = false;

      for (const item of items) {
        // Check mempool confirmation for 'mempool' items
        if (item.status === 'mempool') {
          try {
            const resp = await fetch(`${mempoolBase}/tx/${item.txid}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data.status?.confirmed) {
                await updateOptimisticStatus(item.txid, 'confirmed');
                changed = true;
              }
            }
          } catch { /* retry next poll */ }
        }

        // Check indexer via backend proxy for confirmed (or stale mempool) items
        // If the indexer has the object, remove the optimistic entry
        if ((item.status === 'confirmed' || (item.status === 'mempool' && Date.now() - item.createdAt > 120000)) && item.objectAddress) {
          try {
            const resp = await fetch(
              `${API}/api/p2fk/object-by-address/${item.objectAddress}?network=${network}`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (resp.ok) {
              const data = await resp.json();
              const obj = Array.isArray(data) ? data[0] : data;
              if (obj && (obj.Name || obj.URN || obj.name || obj.urn)) {
                await removeOptimisticItem(item.txid);
                changed = true;
              }
            }
          } catch { /* retry next poll */ }
        }
      }

      if (changed) refresh();
    };

    poll(); // immediate
    pollRef.current = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [items.length, network, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup stale items on mount
  useEffect(() => { cleanupStaleItems(); }, []);

  return { items, addItem, refresh };
}
