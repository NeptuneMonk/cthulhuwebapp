/**
 * useDMNotifications — Track unread DM state in IndexedDB (zero server metadata).
 * Polls for both regular DM messages and encrypted messages,
 * comparing against "last seen" timestamps.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { getLastSeen, setLastSeen } from '@/utils/dmDb';
import { playNotificationSound } from '@/utils/notificationSound';
import { dedupGet } from '@/utils/dedupFetch';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_INTERVAL = 45000; // 45 seconds

export function useDMNotifications(network) {
  const { user, isConnected } = useAuth();
  const [unreadEncrypted, setUnreadEncrypted] = useState({});
  const [unreadDM, setUnreadDM] = useState({});
  const [dmThreads, setDmThreads] = useState([]);
  const pollRef = useRef(null);

  const myAddress = user?.address;

  const fetchThreads = useCallback(async () => {
    if (!myAddress) return;
    try {
      // Check encrypted message threads (deduplicated)
      const threadsData = await dedupGet(`${API}/dm/threads/${myAddress}?network=${network}`, 10000);
      const threads = threadsData?.threads || [];
      setDmThreads(threads);

      const newUnreadEnc = {};
      // Get the vault cutoff — notifications before this date are considered "seen"
      const vaultCutoff = localStorage.getItem(`cthulhu_vault_cutoff_${myAddress}`) || '';
      for (const thread of threads) {
        if (thread.address === '__vault__') continue;
        const lastSeen = await getLastSeen(myAddress, thread.address, network);
        // Use the later of lastSeen or vaultCutoff as the "seen" threshold
        const effectiveSeen = (vaultCutoff > lastSeen) ? vaultCutoff : lastSeen;
        if (thread.last_date && thread.last_date > effectiveSeen) {
          newUnreadEnc[thread.address] = (thread.unread_count || 1);
        }
      }
      // Play sound if new unreads appeared (use ref to avoid dependency cycle)
      const newTotal = Object.values(newUnreadEnc).reduce((s, n) => s + n, 0);
      setUnreadEncrypted(prev => {
        const prevTotal = Object.values(prev).reduce((s, n) => s + n, 0);
        if (newTotal > prevTotal) playNotificationSound();
        return newUnreadEnc;
      });

      // Check regular DM messages (from followed users)
      // We check if there are new P2P messages since last seen
      const pmData = await dedupGet(`${API}/pm/messages/${myAddress}?network=${network}&limit=50`, 10000);
      const pmMessages = pmData?.messages || [];
      const newUnreadDM = {};
      // Group by sender — count unread messages
      for (const msg of pmMessages) {
        if (msg.is_incoming && msg.sender_address) {
          const lastSeen = await getLastSeen(myAddress, `dm_${msg.sender_address}`, network);
          const effectiveSeen = (vaultCutoff > lastSeen) ? vaultCutoff : lastSeen;
          const msgDate = msg.first_seen || msg.block_date || '';
          if (msgDate && msgDate > effectiveSeen) {
            newUnreadDM[msg.sender_address] = (newUnreadDM[msg.sender_address] || 0) + 1;
          }
        }
      }
      setUnreadDM(newUnreadDM);
    } catch (e) {
      // silent
    }
  }, [myAddress, network]);

  const markRead = useCallback(async (partnerAddress) => {
    if (!myAddress) return;
    // Mark both DM and encrypted as read
    await setLastSeen(myAddress, partnerAddress, network);
    await setLastSeen(myAddress, `dm_${partnerAddress}`, network);
    setUnreadEncrypted(prev => {
      const next = { ...prev };
      delete next[partnerAddress];
      return next;
    });
    setUnreadDM(prev => {
      const next = { ...prev };
      delete next[partnerAddress];
      return next;
    });
  }, [myAddress, network]);

  // Listen for dm-read events dispatched from DMPage to instantly clear notifications
  useEffect(() => {
    const handler = (e) => {
      const addr = e.detail?.address;
      if (addr) {
        // Immediately clear local state
        setUnreadEncrypted(prev => { const n = { ...prev }; delete n[addr]; return n; });
        setUnreadDM(prev => { const n = { ...prev }; delete n[addr]; return n; });
      }
      // Re-fetch to stay in sync
      fetchThreads();
    };
    window.addEventListener('dm-read', handler);
    window.addEventListener('dm-refresh', handler);
    return () => {
      window.removeEventListener('dm-read', handler);
      window.removeEventListener('dm-refresh', handler);
    };
  }, [fetchThreads]);

  useEffect(() => {
    if (!isConnected || !myAddress) return;
    fetchThreads();
    pollRef.current = setInterval(fetchThreads, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [isConnected, myAddress, fetchThreads]);

  const hasUnreadEncrypted = useCallback((address) => !!unreadEncrypted[address], [unreadEncrypted]);
  const hasUnreadDM = useCallback((address) => !!unreadDM[address], [unreadDM]);
  const hasAnyUnread = useCallback((address) => !!unreadEncrypted[address] || !!unreadDM[address], [unreadEncrypted, unreadDM]);
  const getUnreadCount = useCallback((address) => (unreadEncrypted[address] || 0) + (unreadDM[address] || 0), [unreadEncrypted, unreadDM]);
  const getDMUnreadCount = useCallback((address) => unreadDM[address] || 0, [unreadDM]);
  const getEncUnreadCount = useCallback((address) => unreadEncrypted[address] || 0, [unreadEncrypted]);

  const totalUnread = Object.values(unreadEncrypted).reduce((sum, n) => sum + n, 0) + Object.values(unreadDM).reduce((sum, n) => sum + n, 0);

  return { dmThreads, hasUnreadEncrypted, hasUnreadDM, hasAnyUnread, getUnreadCount, getDMUnreadCount, getEncUnreadCount, markRead, unreadEncrypted, unreadDM, totalUnread, refreshThreads: fetchThreads };
}

export { setLastSeen } from '@/utils/dmDb';
