import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCheck, FiClock, FiCornerUpLeft, FiShare, FiCopy, FiHeart, FiMapPin, FiTrash2, FiZap, FiSlash, FiHash } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';
import { MessageContent } from '@/components/MessageContent';
import { ComposeModal } from '@/components/ComposeModal';
import { ReactionBar } from '@/components/ReactionBar';
import PollCard from '@/components/PollCard';
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Detect if a string is ONLY emoji characters (with optional ZWJ, variation selectors, whitespace)
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}\s]+$/u;
const isEmojiOnly = (text) => {
  const t = text?.trim();
  if (!t || t.length > 20) return false;
  return EMOJI_RE.test(t);
};

// Strip SUP protocol signature prefix: {sep}{digits}{sep} where sep is one of \ / : * ? " < > |
const SUP_PREFIX_RE = /^[\\/:*?"<>|]\d+[\\/:*?"<>|]/;
const stripSUPPrefix = (text) => text ? text.replace(SUP_PREFIX_RE, '') : text;

// Detect P2FK protocol operations that should NOT be displayed as text posts
const PROTOCOL_OPS = ['BUY', 'GIV', 'OBJ', 'BRN', 'MKR', 'TRD'];
const isProtocolOperation = (raw) => {
  if (!raw || raw.length < 4) return false;
  const prefix = raw.substring(0, 3).toUpperCase();
  if (!PROTOCOL_OPS.includes(prefix)) return false;
  // Verify it has a SUP separator after the prefix
  return '\\//:*?"<>|'.includes(raw[3]);
};

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const fmtDate = (ts) => {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const FeedCard = React.forwardRef(({ item, network, currentUserAddress, currentUserImage, onForward, onLike, onPin, onDelete, onMonetizedLike, onBlock, actionBusy, isMention, isUnseenMention }, ref) => {
  const navigate = useNavigate();
  const [showReply, setShowReply] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [copied, setCopied] = useState(false);
  const cardRef = useRef(null);
  const longPressTimer = useRef(null);
  const menuOpenedAt = useRef(0);

  const message = item;
  const txid = message.transaction_id;
  const rawContent = message.content || '';
  const content = stripSUPPrefix(rawContent);

  // Skip SEC-encrypted private messages that leaked into the feed
  const isSEC = rawContent.startsWith('SEC') && rawContent.length > 4 && '\\//:*?"<>|'.includes(rawContent[3]);

  // Skip protocol operations (BUY, GIV, OBJ, BRN, MKR, TRD) — not user posts
  const isProtocolOp = isProtocolOperation(rawContent);

  // Skip vault backup posts — system messages, not user content
  const isVaultPost = rawContent.startsWith('CTHULHU_VAULT ');

  // Skip INQ vote transactions — empty content or "vote" sent to an answer address
  const isVotePost = content.trim() === 'vote' || (content.trim() === '' && message.to_address && message.to_address !== message.from_address);

  // Detect INQ (poll) transactions — via backend flag or content prefix
  const isINQ = message.is_poll || (rawContent.startsWith('INQ') && rawContent.length > 4 && '\\//:*?"<>|'.includes(rawContent[3]));
  const isPending = message.is_pending || false;
  const [parsedPoll, setParsedPoll] = useState(null);

  useEffect(() => {
    if (!isINQ) return;
    // Use backend-provided poll_data as initial state (works for pending polls too)
    if (message.poll_data?.question) {
      const pollData = { ...message.poll_data };
      // If the parent message is confirmed, override nested poll status
      if (!isPending && pollData.status === 'mempool') {
        pollData.status = 'active';
      }
      setParsedPoll(pollData);
    }
    // Don't fetch from API for pending polls — it won't have data yet
    if (isPending) return;
    // Then try fetching from API (may have vote counts)
    fetch(`${API}/polls/by-txid/${txid}?network=${network}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.question) {
          setParsedPoll(d);
          return;
        }
        // API didn't have it — try parsing INQ JSON from content if available
        if (!content.startsWith('INQ')) return;
        try {
          const rest = content.slice(4);
          const d2Match = rest.match(/^(\d+)(.)/);
          if (d2Match) {
            const jsonStr = rest.slice(d2Match[1].length + 1);
            const inqData = JSON.parse(jsonStr);
            const queAddr = Object.keys(inqData.que || {})[0] || '';
            const question = inqData.que?.[queAddr] || 'Poll';
            const answers = Object.entries(inqData.ans || {}).map(([addr, text]) => ({
              address: addr, answer: text, total_votes: 0, total_value: 0, gated_votes: 0,
            }));
            setParsedPoll({
              txid, question, answers,
              own_gate: inqData.own || [],
              cre_gate: inqData.cre || [],
              total_votes: 0, total_gated_votes: 0,
              status: 'active',
            });
          }
        } catch { /* not parseable */ }
      })
      .catch(() => {});
  }, [isINQ, content, txid, network, message.poll_data, isPending]);

  const senderUrn = message.sender_urn || message.from_address?.substring(0, 12) + '...';
  const senderImage = message.sender_image;
  const senderAddress = message.from_address;
  const recipients = message.recipients || [];
  const blockTime = message.block_time || message.created_at;
  const firstSeen = message.first_seen;
  const mempoolTime = message.mempool_time;
  const status = message.status || (blockTime ? 'confirmed' : isPending ? 'mempool' : 'confirmed');

  // Primary display timestamp: mempool time > first_seen > block_time
  const displayTime = isPending ? mempoolTime : (firstSeen || blockTime);

  const isOwn = senderAddress === currentUserAddress;

  // Detect room/channel posts — targeted at a different address, not a reply or mention
  const isRoomPost = !message.is_reply && !isINQ && message.to_address && message.from_address &&
    message.to_address !== message.from_address && !message.recipient_urn;

  // Strip <<...>> for plain text copy
  const plainContent = content.replace(/<<[^>]*>>/g, '').replace(/<<-\w+>>/g, '').trim();
  const isSticker = !isINQ && !isSEC && isEmojiOnly(plainContent);

  // Cache sticker emoji to backend on first render
  const stickerCachedRef = useRef(false);
  useEffect(() => {
    if (!isSticker || stickerCachedRef.current) return;
    stickerCachedRef.current = true;
    fetch(`${API}/emoji/cache`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: plainContent, address: currentUserAddress || '' }),
    }).catch(() => {});
  }, [isSticker, plainContent, currentUserAddress]);

  // Close context menu on outside click
  // Use a timestamp to prevent touch-to-click synthesis from closing the menu immediately
  useEffect(() => {
    if (!contextMenu) return;
    menuOpenedAt.current = Date.now();
    const close = (e) => {
      // Ignore synthetic click events within 400ms of menu opening (from long-press)
      if (Date.now() - menuOpenedAt.current < 400) return;
      setContextMenu(null);
    };
    // Use pointerdown instead of click for faster desktop response
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); };
  }, [contextMenu]);

  // Filter out encrypted messages after all hooks
  if (isSEC || isProtocolOp || isVaultPost || isVotePost) return null;

  // Right-click handler (desktop)
  const handleContextMenu = (e) => {
    e.preventDefault();
    const rect = cardRef.current?.getBoundingClientRect();
    setContextMenu({
      x: Math.min(e.clientX - (rect?.left || 0), (rect?.width || 200) - 180),
      y: e.clientY - (rect?.top || 0),
    });
  };

  // Long-press handler (mobile)
  const handleTouchStart = (e) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      const rect = cardRef.current?.getBoundingClientRect();
      // Prevent the follow-up touchend/click from triggering navigation
      e.target?.addEventListener('touchend', (ev) => { ev.preventDefault(); }, { once: true });
      setContextMenu({
        x: Math.min(touch.clientX - (rect?.left || 0), (rect?.width || 200) - 180),
        y: touch.clientY - (rect?.top || 0),
      });
    }, 500);
  };
  const handleTouchEnd = () => clearTimeout(longPressTimer.current);
  const handleTouchMove = () => clearTimeout(longPressTimer.current); // Cancel on scroll

  const handleCopy = () => {
    navigator.clipboard.writeText(plainContent).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    setContextMenu(null);
  };

  const menuItems = [
    { icon: <FiCornerUpLeft size={14} />, label: 'Reply', action: () => { setContextMenu(null); setShowReply(true); }, testId: 'ctx-reply' },
    { icon: <FiShare size={14} />, label: 'Forward', action: () => { setContextMenu(null); onForward?.({ txid, senderUrn, senderAddress, content: plainContent }); }, testId: 'ctx-forward' },
    { icon: <FiCopy size={14} />, label: copied ? 'Copied!' : 'Copy Text', action: handleCopy, testId: 'ctx-copy' },
    { icon: <FiHeart size={14} />, label: actionBusy === 'like' ? 'Liking...' : 'Like', action: () => { setContextMenu(null); onLike?.({ txid, senderAddress }); }, testId: 'ctx-like', accent: true, disabled: !!actionBusy },
    { icon: <FiZap size={14} />, label: 'Tip', action: () => { setContextMenu(null); onMonetizedLike?.({ txid, senderUrn, senderAddress }); }, testId: 'ctx-tip', accent: true },
    { icon: <FiMapPin size={14} />, label: actionBusy === 'pin' ? 'Pinning...' : 'Pin', action: () => { setContextMenu(null); onPin?.({ txid }); }, testId: 'ctx-pin', disabled: !!actionBusy },
    ...(isOwn ? [{ icon: <FiTrash2 size={14} />, label: actionBusy === 'delete' ? 'Deleting...' : 'Delete', action: () => { setContextMenu(null); onDelete?.({ txid }); }, testId: 'ctx-delete', danger: true, disabled: !!actionBusy }] : []),
    ...(!isOwn ? [{ icon: <FiSlash size={14} />, label: 'Block User', action: () => { setContextMenu(null); onBlock?.({ address: senderAddress, urn: senderUrn }); }, testId: 'ctx-block', danger: true }] : []),
    ...(blockTime ? [{ icon: <FiCheck size={14} />, label: `Confirmed: ${fmtDate(blockTime)}`, action: () => setContextMenu(null), testId: 'ctx-confirmed', info: true }] : []),
  ];

  // ─── STICKER RENDER (emoji-only messages) ────────────────────────────
  if (isSticker) {
    return (
      <>
        <div
          ref={(el) => { cardRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }}
          onContextMenu={handleContextMenu}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          className={`group relative ${isOwn ? 'ml-auto' : ''}`}
          style={{ background: 'transparent' }}
          data-testid={`feed-card-${txid?.substring(0, 8)}`}
          data-txid={txid}
        >
          <div className="py-1 select-none cursor-default" style={{ lineHeight: 1, background: 'transparent' }}>
            <span className="text-6xl md:text-7xl drop-shadow-lg" data-testid="sticker-emoji">{plainContent}</span>
          </div>
          {contextMenu && (
            <div className="absolute z-30 bg-gray-950 border border-gray-700/50 rounded-xl shadow-2xl shadow-black/60 py-1.5 min-w-[160px] backdrop-blur-sm"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
              data-testid="feed-card-context-menu">
              {menuItems.map((mi) => (
                <button key={mi.testId} onClick={mi.disabled ? undefined : mi.action}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    mi.info ? 'text-gray-500 cursor-default text-xs border-t border-gray-800/50 mt-1 pt-2' :
                    mi.disabled ? 'text-gray-600 cursor-not-allowed' : mi.danger ? 'text-red-400 hover:bg-red-500/10' :
                    mi.accent ? 'text-pink-400 hover:bg-pink-500/10' : 'text-gray-300 hover:bg-gray-800'
                  }`} data-testid={mi.testId}>
                  {mi.icon}<span>{mi.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {showReply && (
          <ComposeModal onClose={() => setShowReply(false)} network={network}
            replyTo={{ txid, urn: senderUrn, address: senderAddress, content: plainContent }} />
        )}
      </>
    );
  }

  return (
    <>
      <div
        ref={(el) => { cardRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`group relative rounded-xl border transition-all duration-500 ${
          isOwn
            ? 'ml-auto max-w-[85%]'
            : isUnseenMention
            ? 'bg-blue-950/30 border-blue-700/50 ring-1 ring-blue-600/30'
            : status === 'mempool'
            ? 'bg-gray-900/50 border-gray-800/40 opacity-80'
            : 'bg-gray-900 border-gray-800/60 hover:border-gray-700/60'
        }`}
        style={isOwn ? { backgroundColor: 'rgba(var(--c-accent-rgb), 0.12)', borderColor: 'rgba(var(--c-accent-rgb), 0.2)' } : {}}
        data-testid={`feed-card-${txid?.substring(0, 8)}`}
        data-txid={txid}
      >
        <div className="p-4">
          {/* Mention indicator */}
          {isMention && (
            <div className="flex items-center gap-1.5 mb-2 text-blue-400 text-xs font-medium" data-testid="mention-indicator">
              <span>@</span> mentioned you
            </div>
          )}
          {/* Room post badge */}
          {isRoomPost && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/room/${message.to_address}?network=${network}`); }}
              className="flex items-center gap-1.5 mb-2 text-purple-400/80 text-xs font-medium hover:text-purple-300 transition-colors"
              data-testid="room-post-badge"
            >
              <FiHash size={12} /> Room post
            </button>
          )}
          {/* Header: avatar + name + status */}
          <div className={`flex items-start gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}>
            <button
              onClick={() => senderAddress && navigate(`/profile/${senderAddress}?network=${network}`)}
              className="flex-shrink-0 hover:opacity-80 transition-opacity"
              data-testid="feed-card-avatar"
            >
              <ProfileThumb name={senderUrn} image={senderImage} size="md" address={senderAddress} />
            </button>

            <div className="flex-1 min-w-0">
              {/* Name + time */}
              <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                <button
                  onClick={() => senderAddress && navigate(`/profile/${senderAddress}?network=${network}`)}
                  className="font-semibold text-sm text-gray-200 hover:text-teal-400 transition-colors truncate"
                  data-testid="feed-card-sender"
                >
                  {senderUrn}
                </button>

                {/* Status indicator */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {status === 'mempool' ? (
                    <span className="text-amber-500" title="In mempool">
                      <FiClock size={11} />
                    </span>
                  ) : (
                    <span className="text-teal-600" title="Confirmed">
                      <FiCheck size={11} /><FiCheck size={11} className="-ml-1.5" />
                    </span>
                  )}

                  {/* Time label — primary: first_seen / mempool time */}
                  <span className="text-[10px] text-gray-600">
                    {fmtDate(displayTime)}
                  </span>
                </div>
              </div>

              {/* Recipients */}
              {recipients.length > 0 && (
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-[10px] text-gray-600">to</span>
                  {recipients.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => r.address && navigate(`/profile/${r.address}?network=${network}`)}
                      className="text-[10px] text-teal-500 hover:text-teal-400 truncate"
                    >
                      {r.urn || r.address?.substring(0, 12) + '...'}
                    </button>
                  ))}
                </div>
              )}

              {/* Message content */}
              <div className="text-sm text-gray-300 leading-relaxed">
                {isINQ && parsedPoll ? (
                  <PollCard poll={parsedPoll} network={network} onVoted={() => { /* optimistic update handles local state */ }} />
                ) : (
                  <MessageContent content={content} files={message.files} txid={txid} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Transaction link — subtle */}
        {txid && (
          <div className="px-4 pb-2.5">
            <a
              href={network?.includes('mainnet')
                ? `https://mempool.space/tx/${txid}`
                : `https://mempool.space/testnet/tx/${txid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-gray-700 hover:text-gray-500 font-mono transition-colors"
              data-testid="feed-card-txlink"
            >
              {txid.substring(0, 12)}...
            </a>
          </div>
        )}

        {/* On-chain reaction counts */}
        <ReactionBar txid={txid} network={network} myAddress={currentUserAddress} />

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="absolute z-30 bg-gray-950 border border-gray-700/50 rounded-xl shadow-2xl shadow-black/60 py-1.5 min-w-[160px] backdrop-blur-sm"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            data-testid="feed-card-context-menu"
          >
            {menuItems.map((mi) => (
              <button
                key={mi.testId}
                onClick={mi.disabled ? undefined : mi.action}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                  mi.info
                    ? 'text-gray-500 cursor-default text-xs border-t border-gray-800/50 mt-1 pt-2'
                    : mi.disabled
                    ? 'text-gray-600 cursor-not-allowed'
                    : mi.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : mi.accent
                    ? 'text-pink-400 hover:bg-pink-500/10'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
                data-testid={mi.testId}
              >
                {mi.icon}
                <span>{mi.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showReply && (
        <ComposeModal
          onClose={() => setShowReply(false)}
          network={network}
          replyTo={{ txid, urn: senderUrn, address: senderAddress, content: plainContent }}
        />
      )}
    </>
  );
});
