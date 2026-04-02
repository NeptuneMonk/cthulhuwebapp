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
import { FiAtSign, FiArrowDown, FiUsers, FiGlobe } from 'react-icons/fi';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PAGE_SIZE = 20;
const MAX_RENDERED_POSTS = 150;
const FEED_MODE_KEY = 'cthulhu_feed_mode';

function getFeedMode() {
  try { return localStorage.getItem(FEED_MODE_KEY) || 'global'; } catch { return 'global'; }
}

export default function FeedPage({ network, follows = [] }) {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [replyTo, setReplyTo] = useState(null);
  const [myProfileImage, setMyProfileImage] = useState(null);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [forwardMsg, setForwardMsg] = useState(null); // { txid, senderUrn, senderAddress, content }
  const [tipMsg, setTipMsg] = useState(null); // { txid, senderUrn, senderAddress }
  const [feedMode, setFeedMode] = useState(getFeedMode);
  const { user } = useAuth();
  const { filterBlocked, blockUser } = useBlockList(network);
  const { performLike, performPin, performDelete, performMonetizedLike, performForward, busy, busyAction } = useOnChainActions(network);
  const { newTxCount, clearNewTxCount } = useFeedMonitor(network, user?.address);
  const { unseenCount, scrollToNext, registerMentionRef, isMention, isUnseen } = useMentions(feed);
  const { wallpaperStyle, theme } = useTheme();

  // Load pending posts
  const refreshPending = useCallback(() => {
    setPendingPosts(getPendingPosts(network));
  }, [network]);

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

  const skipRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const observerRef = useRef(null);
  const bottomRef = useRef(null);
  const hasScrolledRef = useRef(false);
  const scrollContainerRef = useRef(null);
  const [showBackToBottom, setShowBackToBottom] = useState(false);

  // Track scroll position to show/hide "back to latest" button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      // scrollContainerRef wraps the flex-col-reverse child.
      // At the visual bottom (newest posts): scrollTop ≈ scrollHeight - clientHeight
      // Scrolling towards older posts: scrollTop decreases
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distFromBottom = scrollHeight - clientHeight - scrollTop;
      setShowBackToBottom(distFromBottom > 400);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    // Reset feed to fresh state — clears all loaded history
    setFeed([]);
    skipRef.current = 0;
    setHasMore(true);
    hasMoreRef.current = true;
    setShowBackToBottom(false);
    fetchPageRef.current(0, true);
    // Scroll to bottom after new data loads
    setTimeout(() => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }, 500);
  }, []);

  useEffect(() => {
    setFeed([]); skipRef.current = 0;
    setHasMore(true); hasMoreRef.current = true;
    setInitialLoad(true); fetchPageRef.current(0, true);
    refreshPending();
    hasScrolledRef.current = false;
  }, [network, feedMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on initial load (chat-style: newest at bottom)
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

  const fetchPageRef = useRef(null);
  const fetchPage = useCallback(async (skip, isReset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true);
    try {
      // Build query params for feed mode
      const params = { skip, limit: PAGE_SIZE };
      if (feedMode === 'following' && follows.length > 0) {
        params.mode = 'following';
        params.followed = follows.map(f => f.address).join(',');
      }
      // Mesh-first: peers → blockchain → backend
      const { data: res, source } = await meshFirstFetch(`/feed/${network}`, params);
      if (!res) throw new Error('All sources failed');
      const newPosts = res.feed || [];
      setFeed(prev => {
        const updated = isReset ? newPosts : [...prev, ...newPosts];
        if (updated.length >= MAX_RENDERED_POSTS) {
          setHasMore(false); hasMoreRef.current = false;
          return updated.slice(0, MAX_RENDERED_POSTS);
        }
        return updated;
      });
      const more = res.has_more;
      if (skip + PAGE_SIZE < MAX_RENDERED_POSTS) {
        setHasMore(more); hasMoreRef.current = more;
      }
      skipRef.current = skip + PAGE_SIZE;
    } catch (err) {
      console.error('Feed error:', err);
      setHasMore(false); hasMoreRef.current = false;
    } finally { loadingRef.current = false; setLoading(false); setInitialLoad(false); }
  }, [network, feedMode, follows]);
  fetchPageRef.current = fetchPage;

  const sentinelRef = useCallback((node) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !loadingRef.current && hasMoreRef.current) fetchPage(skipRef.current); },
      { threshold: 0.1, rootMargin: '800px' }
    );
    observerRef.current.observe(node);
  }, [fetchPage]);

  const handlePostSuccess = () => {
    refreshPending();
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
    // Don't re-fetch immediately — the pending post is already visible in the feed.
    // The feed monitor will detect the new TX and show "new transactions detected" banner.
    // The pending post system handles the transition: pending → confirmed → merged into feed.
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
          <div className="text-center py-12 text-gray-500">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--c-accent)' }} />
            Loading feed...
          </div>
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

            {/* New TX banner (visual bottom area) */}
            {newTxCount > 0 && (
              <button
                onClick={() => { clearNewTxCount(); setFeed([]); skipRef.current = 0; hasMoreRef.current = true; fetchPage(0, true); }}
                className="w-full py-2 rounded-lg border text-xs font-medium hover:opacity-80 transition-colors"
                style={{ backgroundColor: 'rgba(var(--c-accent-rgb), 0.15)', borderColor: 'rgba(var(--c-accent-rgb), 0.2)', color: 'var(--c-accent)' }}
                data-testid="feed-new-activity-banner"
              >
                {newTxCount} new transaction{newTxCount > 1 ? 's' : ''} detected — tap to refresh
              </button>
            )}

            {/* Feed posts: feed[0]=newest at visual bottom, feed[n]=oldest at visual top */}
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
            {!hasMore && feed.length > 0 && feed.length >= MAX_RENDERED_POSTS && (
              <div className="text-center py-6" data-testid="feed-cap">
                <p className="text-gray-500 text-sm">Showing latest {MAX_RENDERED_POSTS} transmissions</p>
                <p className="text-gray-700 text-xs mt-1">Older posts archived to keep the feed fast</p>
              </div>
            )}
            {!hasMore && feed.length > 0 && feed.length < MAX_RENDERED_POSTS && (
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

      {/* Forward recipient picker */}
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

      {/* Monetized Like / Tip modal */}
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

      {/* Back to Latest floating button */}
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

      {/* @ Mention floating badge */}
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
