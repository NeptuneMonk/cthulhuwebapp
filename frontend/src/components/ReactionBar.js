import React, { useState, useEffect } from 'react';
import { FiHeart, FiMapPin, FiZap, FiCheck, FiClock } from 'react-icons/fi';
import { getLocalReactions, clearConfirmedReactions } from '@/hooks/useFeedMonitor';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Displays on-chain reaction counts below a feed message.
 * Merges server-side data (chain + MongoDB pending) with localStorage optimistic data.
 * Deduplicates to prevent double-counting confirmed reactions.
 */
export function ReactionBar({ txid, network, myAddress }) {
  const [chain, setChain] = useState(null);

  useEffect(() => {
    if (!txid) return;
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`${API}/api/reactions/${txid}?network=${network}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setChain(data);
          // Clean up localStorage for reactions now confirmed on-chain
          clearConfirmedReactions(txid, data.like_addrs || [], data.pin_addrs || [], data.tip_total || 0);
        }
      } catch { /* ignore */ }
    };

    const timer = setTimeout(fetchData, 500 + Math.random() * 500);
    const poll = setInterval(fetchData, 30000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(poll); };
  }, [txid, network]);

  const local = getLocalReactions(txid);

  // Chain data (from backend: on-chain + MongoDB pending, already merged)
  const chainLikes = chain?.likes || 0;
  const chainPins = chain?.pins || 0;
  const chainLikeAddrs = chain?.like_addrs || [];
  const chainPinAddrs = chain?.pin_addrs || [];
  const chainTipTotal = chain?.tip_total || 0;
  const chainTipCount = chain?.tips || 0;
  const hasPendingOnServer = chain?.has_pending || false;

  // Local-only reactions not yet in chain data (truly pending, this-browser-only)
  const pendingLikeAddrs = [...local.likes].filter(a => !chainLikeAddrs.includes(a));
  const pendingPinAddrs = [...local.pins].filter(a => !chainPinAddrs.includes(a));
  // For tips: if the chain already has tip data, local tips are confirmed — don't add them again
  const pendingTips = chainTipTotal > 0 ? [] : local.tips;

  const totalLikes = chainLikes + pendingLikeAddrs.length;
  const totalPins = chainPins + pendingPinAddrs.length;
  const totalTips = chainTipCount + pendingTips.length;
  const totalSats = chainTipTotal + pendingTips.reduce((s, t) => s + (t.amount || 0), 0);

  const myLikeOnChain = chainLikeAddrs.includes(myAddress);
  const myLikePending = pendingLikeAddrs.includes(myAddress);
  const myPinOnChain = chainPinAddrs.includes(myAddress);
  const myPinPending = pendingPinAddrs.includes(myAddress);
  const hasPending = hasPendingOnServer || pendingLikeAddrs.length > 0 || pendingTips.length > 0 || pendingPinAddrs.length > 0;

  if (totalLikes === 0 && totalPins === 0 && totalTips === 0) {
    return <div data-testid="reaction-bar-empty" className="hidden" />;
  }

  return (
    <div className="px-4 pb-2 flex items-center gap-3" data-testid="reaction-bar">
      {totalLikes > 0 && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-all ${
            myLikePending
              ? 'text-amber-400 border-amber-800/40 bg-amber-900/15 animate-pulse'
              : myLikeOnChain
              ? 'text-pink-400 border-pink-800/40 bg-pink-900/15'
              : hasPending
              ? 'text-amber-400 border-amber-800/40 bg-amber-900/15'
              : 'text-gray-500 border-gray-800/40 bg-gray-900/20'
          }`}
          data-testid="reaction-likes"
        >
          <FiHeart size={10} className={myLikeOnChain ? 'fill-pink-400' : myLikePending || hasPending ? 'fill-amber-400' : ''} />
          {totalLikes}
          {(myLikePending || (hasPending && !myLikeOnChain)) && <FiClock size={8} className="text-amber-500 ml-0.5" />}
          {myLikeOnChain && <FiCheck size={8} className="text-pink-500 ml-0.5" />}
        </span>
      )}
      {totalTips > 0 && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-all ${
            hasPending
              ? 'border-amber-800/40 bg-amber-900/15 text-amber-400 animate-pulse'
              : 'border-amber-800/40 bg-amber-900/15 text-amber-400'
          }`}
          data-testid="reaction-tips"
        >
          <FiZap size={10} />
          {totalSats.toLocaleString()}
          <span className="text-[9px] opacity-60">sats</span>
          {hasPending && <FiClock size={8} className="text-amber-500 ml-0.5" />}
        </span>
      )}
      {totalPins > 0 && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-all ${
            myPinPending
              ? 'text-amber-400 border-amber-800/40 bg-amber-900/15 animate-pulse'
              : myPinOnChain
              ? 'text-teal-400 border-teal-800/40 bg-teal-900/15'
              : 'text-gray-500 border-gray-800/40 bg-gray-900/20'
          }`}
          data-testid="reaction-pins"
        >
          <FiMapPin size={10} />
          {totalPins}
          {myPinPending && <FiClock size={8} className="text-amber-500 ml-0.5" />}
          {myPinOnChain && <FiCheck size={8} className="text-teal-500 ml-0.5" />}
        </span>
      )}
    </div>
  );
}
