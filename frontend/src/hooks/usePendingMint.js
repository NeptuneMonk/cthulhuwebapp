import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'cthulhu_pending_mints';
const POLL_INTERVAL = 30000; // 30 seconds

function getPendingMints() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function savePendingMints(mints) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mints));
}

export function usePendingMint() {
  const [pendingMint, setPendingMint] = useState(null);

  // Load on mount
  useEffect(() => {
    const mints = getPendingMints();
    if (mints.length > 0) setPendingMint(mints[0]);
  }, []);

  // Add a new pending mint
  const addPendingMint = useCallback((txid, network = 'btc-testnet', type = 'profile') => {
    const mint = { txid, network, type, timestamp: Date.now() };
    const mints = [mint, ...getPendingMints().filter(m => m.txid !== txid)];
    savePendingMints(mints);
    setPendingMint(mint);
  }, []);

  // Remove a pending mint (confirmed or expired)
  const removePendingMint = useCallback((txid) => {
    const mints = getPendingMints().filter(m => m.txid !== txid);
    savePendingMints(mints);
    setPendingMint(mints.length > 0 ? mints[0] : null);
  }, []);

  // Poll for confirmation
  useEffect(() => {
    if (!pendingMint) return;

    const checkConfirmation = async () => {
      try {
        const { getTxStatus } = await import('@/utils/chainExplorer');
        const status = await getTxStatus(pendingMint.txid, pendingMint.network || 'btc-testnet');
        if (status.confirmed) {
          removePendingMint(pendingMint.txid);
          return;
        }
      } catch { /* network error, retry next poll */ }

      // Auto-expire after 24 hours
      if (Date.now() - pendingMint.timestamp > 86400000) {
        removePendingMint(pendingMint.txid);
      }
    };

    checkConfirmation();
    const interval = setInterval(checkConfirmation, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [pendingMint, removePendingMint]);

  return { pendingMint, addPendingMint, removePendingMint };
}
