import { useState, useEffect, useCallback, useRef } from 'react';
import { getPendingTxs, removePendingTx } from '@/utils/txBuilder';
import { toast } from 'sonner';

const POLL_INTERVAL = 15_000; // 15 seconds

// Blockchain explorer status APIs by network prefix
function getTxStatusUrl(txid, network) {
  if (network.startsWith('btc')) {
    const base = network.includes('testnet')
      ? 'https://mempool.space/testnet/api'
      : 'https://mempool.space/api';
    return `${base}/tx/${txid}/status`;
  }
  if (network.startsWith('ltc')) {
    return `https://litecoinspace.org/api/tx/${txid}/status`;
  }
  // DOGE fallback
  return null;
}

/**
 * Global hook that monitors pending on-chain transactions.
 * Polls blockchain explorers for confirmation status.
 * When confirmed, shows a toast and triggers an optional callback.
 */
export function usePendingTxMonitor(onConfirmed) {
  const [pendingTxs, setPendingTxs] = useState(() => getPendingTxs());
  const intervalRef = useRef(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  // Listen for changes from other parts of the app
  useEffect(() => {
    const handler = () => setPendingTxs(getPendingTxs());
    window.addEventListener('pending-tx-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('pending-tx-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const checkStatus = useCallback(async () => {
    const txs = getPendingTxs();
    if (!txs.length) return;

    for (const tx of txs) {
      const url = getTxStatusUrl(tx.txid, tx.network || 'btc-testnet');
      if (!url) continue;

      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();

        if (data.confirmed) {
          removePendingTx(tx.txid);
          toast.success(`${tx.type || 'Transaction'} confirmed: ${tx.label || tx.txid.slice(0, 12)}...`, {
            duration: 6000,
          });
          onConfirmedRef.current?.(tx);
        }
      } catch {
        // Network error — skip silently, retry next cycle
      }
    }

    setPendingTxs(getPendingTxs());
  }, []);

  // Start/stop polling based on pending count
  useEffect(() => {
    if (pendingTxs.length > 0) {
      // Run an immediate check
      checkStatus();
      intervalRef.current = setInterval(checkStatus, POLL_INTERVAL);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [pendingTxs.length, checkStatus]);

  return { pendingTxs, count: pendingTxs.length, refresh: () => setPendingTxs(getPendingTxs()) };
}
