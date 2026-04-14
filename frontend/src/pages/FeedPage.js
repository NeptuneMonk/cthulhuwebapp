import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { FeedCard } from '@/components/FeedCard';
import { ComposeBar } from '@/components/ComposeBar';
import { ComposeModal } from '@/components/ComposeModal';
import { ForwardModal } from '@/components/ForwardModal';
import { MonetizedLikeModal } from '@/components/MonetizedLikeModal';
import { useAuth } from '@/hooks/useAuth';
import { useBlockList } from '@/hooks/useBlockList';
import { useOnChainActions } from '@/hooks/useOnChainActions';
import { useFeedMonitor } from '@/hooks/useFeedMonitor';
import { useMentions } from '@/hooks/useMentions';
import { useTheme } from '@/hooks/useTheme';
import { getPendingPosts, checkConfirmations, cleanupOldPosts } from '@/utils/pendingPosts';
import { cachedFetch } from '@/utils/apiCache';
import { meshFirstFetch } from '@/utils/meshFirstFetch';
import { FeedSkeleton } from '@/components/SkeletonLoaders';
import { FiAtSign, FiArrowDown, FiUsers, FiGlobe } from 'react-icons/fi';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PAGE_SIZE = 20;
const BUFFER_SIZE = 60;
const FEED_MODE_KEY = 'cthulhu_feed_mode';

function getFeedMode() {
  try { return localStorage.getItem(FEED_MODE_KEY) || 'global'; } catch { return 'global'; }
}

export default function FeedPage({ network, follows = [] }) {
  // Rolling buffer: keep ~60 messages, render ~20 visible
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);      // can load older
  const [hasNewer, setHasNewer] = useState(false);    // can load newer (scrolled into history)
  const [initialLoad, setInitialLoad] = useState(true);
  const [replyTo, setReplyTo] = useState(null);
  const [myProfileImage, setMyProfileImage] = useState(null);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [tipMsg, setTipMsg] = useState(null);
  const [feedMode, setFeedMode] = useState(getFeedMode);
  const { user } = useAuth();
  const { filterBlocked, blockUser } = useBlockList(network);
  const { performLike, performPin, performDelete, performMonetizedLike, performForward, busy, busyAction } = useOnChainActions(network);
  const { newTxCount, clearNewTxCount } = useFeedMonitor(network, user?.address);
  const { unseenCount, scrollToNext, registerMentionRef, isMention, isUnseen } = useMentions(feed);
  const { wallpaperStyle, theme } = useTheme();

  const toggleFeedMode = useCallback(() => {
    setFeedMode(prev => {
      const next = prev === 'global' ? 'following' : 'global';
      try { localStorage.setItem(FEED_MODE_KEY, next); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user?.address) return;
    const cacheId = `img_${user.address}_${user.network || network}`;
    cachedFetch('profile', cacheId, async () => {
      const { dedupGet } = await import('@/utils/dedupFetch');
      return dedupGet(`${API}/profile/${user.address}?network=${user.network || network || 'btc-testnet'}`, 15000);
    }).then(p => { if (p?.image) setMyProfileImage(p.image); }).catch(() => {});
  }, [user?.address, user?.network, network]);

  // Refs for scroll/load state
  const skipRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const bottomRef = useRef(null);
  const hasScrolledRef = useRef(false);
  const scrollContainerRef = useRef(null);
  const [showBackToBottom, setShowBackToBottom] = useState(false);

  // Track scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distFromBottom = scrollHeight - clientHeight - scrollTop;
      setShowBackToBottom(distFromBottom > 400);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Load pending posts
  const refreshPending = useCallback(() => {
    setPendingPosts(getPendingPosts(network));
  }, [network]);

  // Fetch a page of feed data (always fresh, no message caching)
  const fetchPage = useCallback(async (skip, isReset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true);
    try {
      const params = { skip, limit: PAGE_SIZE };
      if (feedMode === 'following' && follows.length > 0) {
        params.mode = 'following';
        const followedAddrs = follows.map(f => f.address);
        if (user?.address && !followedAddrs.includes(user.address)) {
          followedAddrs.push(user.address);
        }
        params.followed = followedAddrs.join(',');
      }
      const { data: res } = await meshFirstFetch(`/feed/${network}`, params);
      if (!res) throw new Error('All sources failed');
      const newPosts = res.feed || [];

      setFeed(prev => {
        if (isReset) {
          // Fresh load — just use the new data
          return newPosts;
        }
        // Appending older posts — combine and trim to BUFFER_SIZE
        const combined = [...prev, ...newPosts];
        // Dedup by transaction_id
        const seen = new Set();
        const deduped = combined.filter(p => {
          if (seen.has(p.transaction_id)) return false;
          seen.add(p.transaction_id);
          return true;
        });
        // If buffer exceeds limit, trim the oldest (end of array since sorted newest-first)
        if (deduped.length > BUFFER_SIZE) {
          setHasNewer(false); // We're at the newest end since we're loading older
          return deduped.slice(0, BUFFER_SIZE);
        }
        return deduped;
      });

      setHasMore(res.has_more);
      hasMoreRef.current = res.has_more;
      skipRef.current = skip + PAGE_SIZE;
    } catch (err) {
      console.error('Feed error:', err);
      setHasMore(false); hasMoreRef.current = false;
    } finally { loadingRef.current = false; setLoading(false); setInitialLoad(false); }
  }, [network, feedMode, follows, user?.address]);

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  // Reset feed on network/mode change
  useEffect(() => {
    setFeed([]); skipRef.current = 0;
    setHasMore(true); hasMoreRef.current = true;
    setHasNewer(false);
    setInitialLoad(true);
    fetchPageRef.current(0, true);
    refreshPending();
    hasScrolledRef.current = false;
  }, [network, feedMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (!initialLoad && feed.length > 0 && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      setTimeout(() => bottomRef.current?.scrollIntoView(), 100);
    }
  }, [initialLoad, feed.length]);

  // Poll for confirmations every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      cleanupOldPosts();
      const confirmed = await checkConfirmations(network);
      if (confirmed.length > 0) refreshPending();
    }, 30000);
    return () => clearInterval(interval);
  }, [network, refreshPending]);

  // Surgical post deletion
  useEffect(() => {
    const handler = (e) => {
      const deletedTxid = e.detail?.txid;
      if (deletedTxid) {
        setFeed(prev => prev.filter(p => p.transaction_id !== deletedTxid));
      }
    };
    window.addEventListener('cthulhu-post-deleted', handler);
    return () => window.removeEventListener('cthulhu-post-deleted', handler);
  }, []);

  // IntersectionObserver for loading older posts (scroll toward top = older)
  const sentinelRef = useCallback((node) => {
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMoreRef.current) {
          fetchPageRef.current(skipRef.current);
        }
      },
      { threshold: 0.1, rootMargin: '600px' }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  const scrollToBottom = useCallback(() => {
    // Jump back to latest — full reset
    setFeed([]);
    skipRef.current = 0;
    setHasMore(true); hasMoreRef.current = true;
    setHasNewer(false);
    setShowBackToBottom(false);
    fetchPageRef.current(0, true);
    setTimeout(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }, 500);
  }, []);

  const handlePostSuccess = () => {
    refreshPending();
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
  };

  // Merge pending posts at top, excluding any already in the feed
  const feedTxids = new Set(feed.map(f => f.transaction_id));
  const visiblePending = pendingPosts.filter(p => !feedTxids.has(p.txid));

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: theme.colors.bg }} data-testid="feed-page">
      {/* Feed Mode Toggle */}
      <div className="flex-shrink-0 flex items-center justify-center py-2 px-4 border-b border-gray-800/50">
        <div className="flex items-center bg-gray-900/80 rounded-full p-0.5 border border-gray-700/50" data-testid="feed-mode-toggle">
          <button
            onClick={() => feedMode !== 'following' && toggleFeedMode()}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              feedMode === 'following'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid="feed-mode-following-btn"
          >
            <FiUsers size={12} />
            Following{follows.length > 0 ? ` (${follows.length})` : ''}
          </button>
          <button
            onClick={() => feedMode !== 'global' && toggleFeedMode()}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              feedMode === 'global'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid="feed-mode-global-btn"
          >
            <FiGlobe size={12} />
            Global
          </button>
        </div>
      </div>

      {/* Scrollable Feed — chat-style: newest at bottom */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 min-h-0" style={wallpaperStyle}>
        {initialLoad && loading ? (
          <FeedSkeleton />
        ) : feed.length === 0 && visiblePending.length === 0 && !loading ? (
          <div className="text-center py-12">
            {feedMode === 'following' && follows.length === 0 ? (
              <>
                <p className="text-xl font-bold text-gray-400 mb-2">No one followed yet</p>
                <p className="text-gray-600">Search for profiles and follow them, or switch to Global to see all activity</p>
              </>
            ) : feedMode === 'following' ? (
              <>
                <p className="text-xl font-bold text-gray-400 mb-2">No transmissions from followed users</p>
                <p className="text-gray-600">Your followed users haven't posted yet on this network</p>
              </>
            ) : (
              <>
                <p className="text-xl font-bold text-gray-400 mb-2">No transmissions yet</p>
                <p className="text-gray-600">Search for profiles or switch to a network with activity</p>
              </>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col-reverse gap-3 py-4">
            {/* DOM first = visual BOTTOM (newest content) */}
            <div ref={bottomRef} className="h-0" />

            {/* Pending posts (newest, at visual bottom) */}
            {visiblePending.map(p => (
              <FeedCard
                key={`pending-${p.txid}`}
                item={{
                  transaction_id: p.txid,
                  content: p.content,
                  from_address: p.from_address,
                  sender_urn: p.sender_urn,
                  sender_image: p.sender_image,
                  is_pending: p.status !== 'confirmed',
                  is_poll: p.is_poll || false,
                  poll_data: p.poll_data || null,
                  mempool_time: p.mempool_time,
                  confirmed_time: p.confirmed_time,
                  status: p.status,
                }}
                network={network}
                currentUserAddress={user?.address}
                currentUserImage={myProfileImage}
              />
            ))}

            {/* New TX banner */}
            {newTxCount > 0 && (
              <button
                onClick={() => { clearNewTxCount(); scrollToBottom(); }}
                className="w-full py-2 rounded-lg border text-xs font-medium hover:opacity-80 transition-colors"
                style={{ backgroundColor: 'rgba(var(--c-accent-rgb), 0.15)', borderColor: 'rgba(var(--c-accent-rgb), 0.2)', color: 'var(--c-accent)' }}
                data-testid="feed-new-activity-banner"
              >
                {newTxCount} new transaction{newTxCount > 1 ? 's' : ''} detected — tap to refresh
              </button>
            )}

            {/* Feed posts */}
            {filterBlocked(feed).map((item, idx) => (
              <FeedCard
                key={`${item.transaction_id}-${idx}`}
                ref={isMention(item) ? (el) => registerMentionRef(item.transaction_id, el) : null}
                item={item}
                network={network}
                currentUserAddress={user?.address}
                currentUserImage={myProfileImage}
                actionBusy={busyAction}
                onForward={(msg) => setForwardMsg(msg)}
                onLike={(msg) => performLike(msg.txid)}
                onPin={(msg) => performPin(msg.txid)}
                onDelete={(msg) => performDelete(msg.txid)}
                onMonetizedLike={(msg) => setTipMsg(msg)}
                onBlock={({ address, urn }) => { blockUser(address, urn); }}
                isMention={isMention(item)}
                isUnseenMention={isMention(item) && isUnseen(item.transaction_id)}
              />
            ))}

            {/* DOM last = visual TOP (load more / end) */}
            {loading && !initialLoad && (
              <div className="text-center py-6 text-gray-500" data-testid="feed-loading-more">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-2" style={{ borderColor: 'var(--c-accent)' }} />
              </div>
            )}
            {hasMore && !initialLoad && <div ref={sentinelRef} className="h-4" data-testid="feed-scroll-sentinel" />}
            {!hasMore && feed.length > 0 && (
              <div className="text-center py-6 text-gray-600" data-testid="feed-end">End of transmission</div>
            )}
          </div>
        )}
      </div>

      {/* Compose Bar */}
      <div className="flex-shrink-0">
        <ComposeBar network={network} onPostSuccess={handlePostSuccess} />
      </div>

      {replyTo && <ComposeModal onClose={() => { setReplyTo(null); refreshPending(); }} network={network} replyTo={replyTo} />}

      {forwardMsg && (
        <ForwardModal
          message={forwardMsg}
          network={network}
          onConfirm={async (txid, recipientAddr, note) => {
            await performForward(txid, recipientAddr, note);
            setForwardMsg(null);
          }}
          onClose={() => setForwardMsg(null)}
        />
      )}

      {tipMsg && (
        <MonetizedLikeModal
          txid={tipMsg.txid}
          authorUrn={tipMsg.senderUrn}
          authorAddress={tipMsg.senderAddress}
          onConfirm={async (sats) => {
            await performMonetizedLike(tipMsg.txid, tipMsg.senderAddress, sats);
            setTipMsg(null);
          }}
          onClose={() => setTipMsg(null)}
        />
      )}

      {showBackToBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 bg-gray-900/95 hover:bg-gray-800 rounded-full shadow-lg shadow-black/50 border border-gray-700/50 transition-all backdrop-blur-sm"
          style={{ color: 'var(--c-accent)' }}
          data-testid="back-to-latest-btn"
        >
          <FiArrowDown size={16} />
          <span className="text-sm font-medium">Back to Latest</span>
        </button>
      )}

      {unseenCount > 0 && (
        <button
          onClick={scrollToNext}
          className="fixed bottom-20 right-6 z-50 flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg shadow-blue-900/40 transition-all"
          data-testid="mention-badge"
          title={`${unseenCount} new @mention${unseenCount > 1 ? 's' : ''}`}
        >
          <FiAtSign size={16} />
          <span className="text-sm font-bold">{unseenCount}</span>
        </button>
      )}
    </div>
  );
}
