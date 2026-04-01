/**
 * Notification system for incoming wallet transactions.
 * Uses sonner toasts for in-app notifications and Browser Notification API for background.
 */
import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

const POLL_INTERVAL = 30000; // 30 seconds

/**
 * Hook that monitors wallet balance changes and shows notifications.
 * @param {string} address - The wallet address to monitor
 * @param {string} network - The network name
 * @param {boolean} enabled - Whether notifications are enabled
 */
export function useWalletNotifications(address, network, enabled = true) {
  const lastBalanceRef = useRef(null);
  const lastUnconfirmedRef = useRef(0);
  const permissionRef = useRef('default');

  // Request browser notification permission once (never re-prompt)
  useEffect(() => {
    if (!enabled || typeof Notification === 'undefined') return;
    permissionRef.current = Notification.permission;
    if (Notification.permission === 'default' && !localStorage.getItem('cthulhu_notif_asked')) {
      localStorage.setItem('cthulhu_notif_asked', '1');
      Notification.requestPermission().then(p => { permissionRef.current = p; });
    }
  }, [enabled]);

  const showNotification = useCallback((title, body, type = 'info') => {
    // In-app toast
    if (type === 'incoming') {
      toast.success(title, { description: body, duration: 5000 });
    } else if (type === 'warning') {
      toast.warning(title, { description: body, duration: 5000 });
    } else {
      toast.info(title, { description: body, duration: 4000 });
    }

    // Browser notification (when tab not focused)
    if (document.hidden && permissionRef.current === 'granted' && typeof Notification !== 'undefined') {
      try {
        new Notification(title, { body, icon: '/favicon.ico', tag: 'cthulhu-wallet' });
      } catch {}
    }
  }, []);

  // Poll for balance changes
  useEffect(() => {
    if (!address || !enabled) return;

    const checkBalance = async () => {
      try {
        const { getBalance } = await import('@/utils/chainExplorer');
        const bal = await getBalance(address, network);
        const newBalance = bal.total || 0;
        const newUnconfirmed = bal.unconfirmed || 0;

        if (lastBalanceRef.current !== null) {
          const diff = newBalance - lastBalanceRef.current;
          if (diff > 0) {
            const btcAmount = (diff / 1e8).toFixed(8);
            if (diff === 546) {
              showNotification('P2FK Activity', 'Received dust (546 sats) — likely a message, give, or object action', 'incoming');
            } else if (diff < 2000) {
              showNotification('Dust Received', `+${diff} sats — possible P2FK transaction`, 'incoming');
            } else {
              showNotification('Deposit Received', `+${btcAmount} BTC received`, 'incoming');
            }
          }
          if (newUnconfirmed > 0 && newUnconfirmed !== lastUnconfirmedRef.current) {
            showNotification('Pending Transaction', `${(newUnconfirmed / 1e8).toFixed(8)} BTC awaiting confirmation`, 'info');
          }
        }
        lastBalanceRef.current = newBalance;
        lastUnconfirmedRef.current = newUnconfirmed;
      } catch {}
    };

    // Initial check (set baseline)
    checkBalance();
    const interval = setInterval(checkBalance, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [address, network, enabled, showNotification]);

  return { showNotification };
}
