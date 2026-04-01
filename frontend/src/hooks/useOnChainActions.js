/**
 * Hook for on-chain message actions (Like, Pin, Delete, Monetized Like).
 *
 * All actions work by creating a P2FK transaction that sends dust to a
 * keyword address derived from the target message's transaction ID.
 * This "dusting" pattern is how the SUP protocol links actions to messages.
 *
 * - Like:  post with keyword=txid, content includes action marker
 * - Pin:   post with keyword=txid, content includes pin marker
 * - Delete: post with keyword=txid, content includes delete marker (own msgs only)
 * - Monetized Like: like + extra output (tip) to the author's address
 */
import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { addLocalReaction } from '@/hooks/useFeedMonitor';
import { addPendingTx } from '@/utils/txBuilder';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

/** Save pending reaction to backend so it shows across browsers */
async function savePendingReaction(txid, type, fromAddress, network, broadcastTxid = '', amount = 0) {
  try {
    addLocalReaction(txid, type, fromAddress, amount); // localStorage (instant, same browser)
    await fetch(`${API}/api/reactions/${txid}?network=${network}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, from_address: fromAddress, broadcast_txid: broadcastTxid, amount }),
    });
  } catch { /* best-effort */ }
}

export function useOnChainActions(network) {
  const { wif, user, getLocalWallets } = useAuth();
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState(null); // 'like' | 'pin' | 'delete' | 'tip'

  const requireWallet = () => {
    if (!wif) {
      window.dispatchEvent(new Event('wallet-action-requested'));
      return false;
    }
    return true;
  };

  /**
   * Check if any wallet under this login has already liked/pinned this txid.
   * Checks both localStorage optimistic data and chain data.
   */
  const hasAlreadyReacted = useCallback(async (txid, reactionType) => {
    try {
      // Get all wallet addresses for this login + network
      const wallets = getLocalWallets ? getLocalWallets() : [];
      const allAddrs = wallets.map(w => w.address).filter(Boolean);
      if (user?.address && !allAddrs.includes(user.address)) {
        allAddrs.push(user.address);
      }
      if (allAddrs.length === 0) return false;

      // Check localStorage first (instant)
      const local = (await import('@/hooks/useFeedMonitor')).getLocalReactions(txid);
      const localSet = reactionType === 'like' ? local.likes : reactionType === 'pin' ? local.pins : new Set();
      for (const addr of allAddrs) {
        if (localSet.has(addr)) return true;
      }

      // Check chain data (server)
      const res = await fetch(`${API}/api/reactions/${txid}?network=${network}`);
      if (res.ok) {
        const data = await res.json();
        const chainAddrs = reactionType === 'like' ? (data.like_addrs || []) : (data.pin_addrs || []);
        for (const addr of allAddrs) {
          if (chainAddrs.includes(addr)) return true;
        }
      }
    } catch { /* best-effort */ }
    return false;
  }, [user?.address, getLocalWallets, network]);

  /**
   * Generic dust-to-txid action.
   * Builds a P2FK post where the target txid is a keyword.
   */
  const dustAction = useCallback(async (txid, actionContent, label) => {
    if (!requireWallet()) return null;
    setBusy(true);
    setBusyAction(label);
    try {
      const [{ buildPostTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);
      // Use the target txid as a keyword — this sends dust to the txid-derived address
      const { addresses, taxInsertIndex } = buildPostTransaction(wif, actionContent, [txid], null, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        addPendingTx({ txid: result.txid, type: label, label: label, network });
        toast.success(`${label} broadcast!`);
        return result;
      }
      return null;
    } catch (err) {
      toast.error(`${label} failed: ${err.message}`);
      return null;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }, [wif, network]);

  const performLike = useCallback(async (txid) => {
    // Prevent duplicate likes from the same login (any wallet)
    const alreadyLiked = await hasAlreadyReacted(txid, 'like');
    if (alreadyLiked) {
      toast.info('Already liked this post');
      return null;
    }
    const r = await dustAction(txid, `<<-like>><<${Math.floor(Math.random() * -99999)}>>`, 'Like');
    if (r?.success) savePendingReaction(txid, 'like', user?.address, network, r.txid);
    return r;
  }, [dustAction, user?.address, network, hasAlreadyReacted]);

  const performPin = useCallback((txid) => {
    return dustAction(txid, `<<-pin>><<${Math.floor(Math.random() * -99999)}>>`, 'Pin').then(r => {
      if (r?.success) savePendingReaction(txid, 'pin', user?.address, network, r.txid);
      return r;
    });
  }, [dustAction, user?.address, network]);

  const performDelete = useCallback((txid) => {
    return dustAction(txid, `<<-delete>><<${Math.floor(Math.random() * -99999)}>>`, 'Delete');
  }, [dustAction]);

  /**
   * Monetized Like: dust to txid keyword + tip output to author.
   * Builds a single PSBT with two purposes:
   *   1. Dust outputs for the P2FK like action (keyword = txid)
   *   2. Extra output: tipAmountSats to the author's address
   */
  const performMonetizedLike = useCallback(async (txid, authorAddress, tipAmountSats) => {
    if (!requireWallet()) return null;
    if (!authorAddress) { toast.error('Unknown author address'); return null; }
    if (tipAmountSats < 546) { toast.error('Minimum tip is 546 sats'); return null; }
    // Prevent duplicate likes from the same login (any wallet)
    const alreadyLiked = await hasAlreadyReacted(txid, 'like');
    if (alreadyLiked) {
      toast.info('Already liked/tipped this post');
      return null;
    }
    setBusy(true);
    setBusyAction('tip');
    try {
      const [{ buildPostTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);
      const content = `<<-like>><<${Math.floor(Math.random() * -99999)}>>`;
      const { addresses, taxInsertIndex } = buildPostTransaction(wif, content, [txid], null, network);
      // Extra output: tip to the author
      const extraOutputs = [{ address: authorAddress, value: tipAmountSats }];
      const result = await buildAndBroadcast(wif, addresses, network, extraOutputs, 0, 546, [], taxInsertIndex);
      if (result.success) {
        addPendingTx({ txid: result.txid, type: 'Tip', label: `Tip ${tipAmountSats} sats`, network });
        savePendingReaction(txid, 'like', user?.address, network, result.txid);
        savePendingReaction(txid, 'tip', user?.address, network, result.txid, tipAmountSats);
        toast.success(`Tipped ${tipAmountSats} sats!`);
        return result;
      }
      return null;
    } catch (err) {
      toast.error(`Tip failed: ${err.message}`);
      return null;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }, [wif, network]);

  /**
   * Forward: create a new post with the original txid embedded as <<txid>>,
   * optionally sent to a specific recipient address.
   */
  const performForward = useCallback(async (originalTxid, recipientAddress, extraText = '') => {
    if (!requireWallet()) return null;
    setBusy(true);
    setBusyAction('forward');
    try {
      const [{ buildPostTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);
      const content = extraText
        ? `${extraText}\n<<${originalTxid}>>`
        : `<<${originalTxid}>>`;
      const { addresses, taxInsertIndex } = buildPostTransaction(
        wif, content, [], recipientAddress || null, network
      );
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        addPendingTx({ txid: result.txid, type: 'Forward', label: 'Forwarded message', network });
        toast.success('Message forwarded!');
        return result;
      }
      return null;
    } catch (err) {
      toast.error(`Forward failed: ${err.message}`);
      return null;
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }, [wif, network]);

  return {
    performLike,
    performPin,
    performDelete,
    performMonetizedLike,
    performForward,
    busy,
    busyAction,
    isWalletReady: !!wif,
  };
}
