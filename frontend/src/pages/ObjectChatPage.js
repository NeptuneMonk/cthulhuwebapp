/**
 * ObjectChatPage — Public chat room for an on-chain object.
 * Messages are P2FK posts targeted at the object's creator address (keyword).
 * Anyone can read; posting requires a wallet.
 *
 * Room types (determined by license):
 * - cthulhu:tether          → Public Room (everyone speaks)
 * - cthulhu:tether:venue    → Speaking Venue (only seat holders speak, audience watches + tips)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useBlockList } from '@/hooks/useBlockList';
import { useTheme } from '@/hooks/useTheme';
import { FiArrowLeft, FiGrid, FiLink2, FiLink, FiCopy, FiSlash, FiUser, FiMoreVertical, FiPlus, FiLock, FiEye, FiX, FiMove, FiMic, FiDollarSign, FiRepeat, FiCheck, FiSend, FiRadio, FiUploadCloud } from 'react-icons/fi';
import axios from 'axios';
import { ProfileThumb } from '@/components/ProfileThumb';
import { MessageContent } from '@/components/MessageContent';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { ComposeBar } from '@/components/ComposeBar';
import { useOffchainChat } from '@/hooks/useOffchainChat';
import { toast } from 'sonner';
import { markAsRead, notifyUnreadChange } from '@/utils/unreadTracker';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function ChatBubble({ message, isMine, showDate, dateLabel, profiles, onBlock, navigate, humanCreatorAddresses, creatorUsesRoomImage, roomImage }) {
  const senderProfile = profiles[message.from];
  const isCreatorMsg = humanCreatorAddresses?.includes(message.from);
  // Use inline sender info from offchain messages as fallback when profile not in cache
  const displayImage = (isCreatorMsg && creatorUsesRoomImage && roomImage)
    ? roomImage
    : senderProfile?.image || message.senderImage || null;
  const displayName = (isCreatorMsg && creatorUsesRoomImage && roomImage)
    ? (profiles[message.from]?.urn || 'Room')
    : (senderProfile?.urn || senderProfile?.display_name || message.senderUrn || `${message.from?.slice(0, 12)}...`);
  const [contextMenu, setContextMenu] = useState(null);
  const longPressTimer = useRef(null);
  const menuOpenedAt = useRef(0);
  const bubbleRef = useRef(null);

  useEffect(() => {
    if (!contextMenu) return;
    menuOpenedAt.current = Date.now();
    const close = () => {
      if (Date.now() - menuOpenedAt.current < 400) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); };
  }, [contextMenu]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    const rect = bubbleRef.current?.getBoundingClientRect();
    setContextMenu({ x: Math.min(e.clientX - (rect?.left || 0), (rect?.width || 200) - 160), y: e.clientY - (rect?.top || 0) });
  };
  const handleTouchStart = (e) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      const rect = bubbleRef.current?.getBoundingClientRect();
      e.target?.addEventListener('touchend', (ev) => ev.preventDefault(), { once: true });
      setContextMenu({ x: Math.min(touch.clientX - (rect?.left || 0), (rect?.width || 200) - 160), y: touch.clientY - (rect?.top || 0) });
    }, 500);
  };
  const handleTouchEnd = () => clearTimeout(longPressTimer.current);
  const handleTouchMove = () => clearTimeout(longPressTimer.current);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text || '');
    setContextMenu(null);
  };

  return (
    <>
      {showDate && (
        <div className="flex justify-center my-3">
          <span className="bg-gray-800/80 text-gray-500 text-[10px] px-3 py-1 rounded-full">{dateLabel}</span>
        </div>
      )}
      <div
        ref={bubbleRef}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`relative flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}
        data-testid="room-chat-bubble"
      >
        {!isMine && (
          <div className="flex-shrink-0 mr-2 mt-1">
            <ProfileThumb name={displayName} image={displayImage} size="sm" />
          </div>
        )}
        <div className={`max-w-[75%] ${isMine ? '' : ''}`}>
          {!isMine && (
            <p className="text-[10px] mb-0.5 px-1 truncate" style={{ color: 'var(--c-accent)' }}>
              {displayName}
            </p>
          )}
          <div
            className={`px-3 py-2 rounded-xl text-sm ${
              isMine
                ? 'text-gray-200 rounded-br-sm border'
                : 'bg-gray-800/50 text-gray-200 rounded-bl-sm border border-gray-700/30'
            } ${message.pending ? 'opacity-70' : ''}`}
            style={isMine ? { backgroundColor: 'rgba(var(--c-accent-rgb), 0.2)', borderColor: 'rgba(var(--c-accent-rgb), 0.15)' } : {}}
          >
            <MessageContent content={message.text} />
            {message.pending && (
              <p className="text-gray-500 italic text-[10px] mt-0.5">Sending...</p>
            )}
            {message.error && (
              <p className="text-red-400 italic text-[10px] mt-0.5">{message.error}</p>
            )}
            <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
              {message._source && message._source !== 'onchain' && (
                <span className="text-[9px] text-green-500/60" title="Off-chain (P2P)">P2P</span>
              )}
              <span className="text-[10px] text-gray-500">{formatTime(message.timestamp)}</span>
            </div>
          </div>
        </div>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="absolute z-30 bg-gray-950 border border-gray-700/50 rounded-xl shadow-2xl shadow-black/60 py-1.5 min-w-[150px] backdrop-blur-sm"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            data-testid="room-context-menu"
          >
            <button onClick={handleCopy} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800" data-testid="room-ctx-copy">
              <FiCopy size={14} /> Copy Text
            </button>
            {!isMine && (
              <>
                <button onClick={() => { setContextMenu(null); navigate(`/profile/${message.from}`); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800" data-testid="room-ctx-profile">
                  <FiUser size={14} /> View Profile
                </button>
                <button onClick={() => { setContextMenu(null); onBlock?.(message.from, senderProfile?.urn || ''); }} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10" data-testid="room-ctx-block">
                  <FiSlash size={14} /> Block User
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// Audience Modal — floating, draggable, creator-only view of ephemeral audience messages
function AudienceModal({ messages, profiles, onClose, navigate, onClear }) {
  const [pos, setPos] = useState({ x: 16, y: 80 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = (e) => {
    if (e.target.closest('[data-no-drag]')) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
  };
  const onPointerUp = () => { dragging.current = false; };

  return (
    <div
      className="fixed z-50 w-80 max-h-[50vh] flex flex-col bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-xl shadow-2xl shadow-black/60"
      style={{ left: pos.x, top: pos.y, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-testid="audience-modal"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800/50 cursor-move select-none">
        <FiMove size={12} className="text-gray-600 flex-shrink-0" />
        <FiEye size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-gray-300 flex-1 truncate">Audience Feed</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 rounded-full px-1.5 py-0.5">{messages.length}</span>
        {messages.length > 0 && (
          <button data-no-drag="true" onClick={onClear} className="text-[9px] text-red-400 hover:text-red-300 px-1.5" data-testid="audience-clear-inline">
            Clear
          </button>
        )}
        <button data-no-drag="true" onClick={onClose} className="p-0.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" data-testid="audience-close-btn">
          <FiX size={14} />
        </button>
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" data-no-drag="true" data-testid="audience-messages">
        {messages.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">No audience messages yet</p>
        ) : (
          messages.map((msg, i) => {
            const isTip = msg.is_tip;
            const displayName = msg.sender_urn || `${msg.sender_address?.slice(0, 10)}...`;
            const sats = msg.amount_sats || 555;
            return (
              <div
                key={msg.txid || i}
                className={`rounded-lg px-2.5 py-1.5 ${isTip ? 'bg-amber-500/10 border border-amber-500/20' : ''}`}
                data-testid={isTip ? 'audience-tip-msg' : 'audience-msg'}
              >
                <div className="flex items-baseline gap-1.5">
                  <button
                    data-no-drag="true"
                    onClick={() => navigate(`/profile/${msg.sender_address}`)}
                    className={`text-[10px] font-semibold truncate hover:underline ${isTip ? 'text-amber-400' : ''}`}
                    style={!isTip ? { color: 'var(--c-accent)' } : {}}
                  >
                    {displayName}
                  </button>
                  {isTip && (
                    <span className="text-[9px] font-bold text-amber-400">
                      tipped {sats.toLocaleString()} sats
                    </span>
                  )}
                  <span className="text-[9px] text-gray-600 flex-shrink-0 ml-auto">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                {!isTip && msg.content && (
                  <div className="text-xs text-gray-400 break-words mt-0.5">
                    {msg.content}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-800/50">
        <p className="text-[9px] text-gray-600 text-center">Ephemeral — 555 sats/msg, tips highlighted</p>
      </div>
    </div>
  );
}

export default function ObjectChatPage({ network }) {
  const { address: objectAddress } = useParams();
  const navigate = useNavigate();
  const { user, wif: authWif, isConnected: authConnected } = useAuth();
  const { wallet, isConnected: walletConnected } = useWallet();
  const { filterBlocked, blockUser } = useBlockList(network);
  const { wallpaperStyle } = useTheme();

  const activeWif = authWif || wallet?.wif;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);

  const [objectInfo, setObjectInfo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [isTethered, setIsTethered] = useState(false);
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);
  const [showRoomMenu, setShowRoomMenu] = useState(false);
  const [showAudienceModal, setShowAudienceModal] = useState(false);
  const [showAddSeats, setShowAddSeats] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showBuySeatModal, setShowBuySeatModal] = useState(false);
  const [buySeatSending, setBuySeatSending] = useState(false);
  const [buySeatResult, setBuySeatResult] = useState(null);
  const [transferAddress, setTransferAddress] = useState('');
  const [transferSending, setTransferSending] = useState(false);
  const [transferMode, setTransferMode] = useState('give'); // 'give' or 'sell'
  const [transferPrice, setTransferPrice] = useState('0.001');
  const [tipAmount, setTipAmount] = useState('0.0001');
  const [tipSending, setTipSending] = useState(false);
  // Audience feed (ephemeral, off-chain)
  const [audienceMessages, setAudienceMessages] = useState([]);
  const [audienceText, setAudienceText] = useState('');
  const [audienceSending, setAudienceSending] = useState(false);
  const [audienceTipMode, setAudienceTipMode] = useState(false);
  const [audienceTipAmount, setAudienceTipAmount] = useState('0.001');
  const audiencePollRef = useRef(null);
  const [seatHolders, setSeatHolders] = useState([]);
  const [roomCreators, setRoomCreators] = useState([]);
  const [addSeatsQty, setAddSeatsQty] = useState(1);
  const [addSeatsPrice, setAddSeatsPrice] = useState('0.0001');
  const [addSeatsLoading, setAddSeatsLoading] = useState(false);

  // Creator avatar toggle: speak as self (profile) or as room (object image)
  const [creatorUsesRoomImage, setCreatorUsesRoomImage] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`cthulhu_room_avatar_${objectAddress}`)) || false; } catch { return false; }
  });
  const toggleCreatorAvatar = useCallback(() => {
    setCreatorUsesRoomImage(prev => {
      const next = !prev;
      localStorage.setItem(`cthulhu_room_avatar_${objectAddress}`, JSON.stringify(next));
      return next;
    });
  }, [objectAddress]);

  const myAddress = user?.address || wallet?.address || '';
  const myUrn = user?.urn || '';
  const myImage = user?.image || '';

  // Off-chain chat (P2P mesh + WebSocket relay)
  const {
    offchainMessages, sendMessage: sendOffchain, triggerCheckpoint,
    isCheckpointing, checkpointHint, cacheStats, wsConnected,
  } = useOffchainChat(objectAddress, myAddress, myUrn, myImage, network);
  const [composeMode, setComposeMode] = useState('offchain'); // 'offchain' | 'onchain'
  const [offchainText, setOffchainText] = useState('');

  // Optimistic message callbacks for ComposeBar
  const pendingTempId = useRef(null);
  const handleBeforeSend = useCallback((content) => {
    const tempId = `pending-${Date.now()}`;
    pendingTempId.current = tempId;
    setMessages(prev => [...prev, {
      id: tempId, text: content, timestamp: new Date().toISOString(),
      from: myAddress, isMine: true, pending: true
    }]);
  }, [myAddress]);

  const handleSendSuccess = useCallback(() => {
    if (pendingTempId.current) {
      setMessages(prev => prev.map(m =>
        m.id === pendingTempId.current ? { ...m, pending: false } : m
      ));
      pendingTempId.current = null;
    }
  }, []);

  const handleSendError = useCallback((error) => {
    if (pendingTempId.current) {
      setMessages(prev => prev.map(m =>
        m.id === pendingTempId.current ? { ...m, error: `Failed: ${error}` } : m
      ));
      pendingTempId.current = null;
    }
  }, []);

  // Determine room type and permissions
  const supply = objectInfo?.total_supply || objectInfo?.maximum || 1;
  const roomLicense = (objectInfo?.license || '').toLowerCase();
  const isTetherRoom = roomLicense.startsWith('cthulhu:tether');
  const isVenue = roomLicense === 'cthulhu:tether:venue';
  const isPublicRoom = !isVenue; // Public rooms = everything that's not a venue
  const isCreator = myAddress && objectInfo?.creators?.some(c => (c.address || c) === myAddress);
  // Human creator addresses = all creators except the object's own address
  // In P2FK, creators[0] is the object address, creators[1+] are human creators
  const humanCreatorAddresses = useMemo(() => {
    if (!objectInfo?.creators) return [];
    return objectInfo.creators
      .map(c => c.address || c)
      .filter(addr => addr !== objectAddress);
  }, [objectInfo?.creators, objectAddress]);
  const hasSeat = isPublicRoom || (myAddress && objectInfo?.owners?.some(o => (o.address || o) === myAddress));
  const canSpeak = isConnected && activeWif && (isPublicRoom || hasSeat);
  const isAudience = isConnected && activeWif && isVenue && !hasSeat;
  const listedCount = (objectInfo?.listings || []).length;

  // Gating: for venues, only show seated P2FK messages in main chat
  // Audience messages are now separate (off-chain, tip-based)
  const seatedMessages = isVenue ? messages.filter(m => m.is_seat_holder || m.is_creator || m.pending) : messages;

  // Merge on-chain + offchain messages, deduplicated by ID
  const mergedMessages = useMemo(() => {
    const onchain = seatedMessages.map(m => ({ ...m, _source: 'onchain' }));
    const offchain = offchainMessages.map(m => ({
      id: m.id,
      text: m.content,
      timestamp: m.timestamp,
      from: m.sender,
      senderUrn: m.senderUrn,
      senderImage: m.senderImage,
      isMine: m.sender === myAddress,
      _source: m.source || 'offchain',
    }));
    // Deduplicate: prefer on-chain if same content from same sender within ~60s
    const onchainSet = new Set(onchain.map(m => `${m.from}:${(m.text || '').trim().slice(0, 50)}`));
    const filteredOffchain = offchain.filter(m => {
      const key = `${m.from}:${(m.text || '').trim().slice(0, 50)}`;
      return !onchainSet.has(key);
    });
    const all = [...onchain, ...filteredOffchain];
    all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return all;
  }, [seatedMessages, offchainMessages, myAddress]);

  // Check if this room is tethered
  useEffect(() => {
    try {
      const rooms = JSON.parse(localStorage.getItem(`cthulhu_rooms_${myAddress}_${network}`)) || [];
      setIsTethered(rooms.some(r => r.objectAddress === objectAddress));
    } catch { setIsTethered(false); }
  }, [objectAddress, myAddress, network]);

  // Fetch object info with local fallback for mempool handoff
  useEffect(() => {
    if (!objectAddress) return;
    axios.get(`${API}/object/addr/${objectAddress}`, { params: { network } })
      .then(res => setObjectInfo(res.data))
      .catch(() => {
        // Fallback: check localStorage for pending tether data
        try {
          const rooms = JSON.parse(localStorage.getItem(`cthulhu_rooms_${myAddress}_${network}`)) || [];
          const local = rooms.find(r => r.objectAddress === objectAddress);
          if (local) {
            setObjectInfo({
              name: local.name,
              image: local.image,
              imageUrl: local.imageUrl,
              description: local.description,
              license: local.license,
              pending: true,
            });
          }
        } catch {}
      });
  }, [objectAddress, network, myAddress]);

  // Fetch messages for the object's address — preserves pending messages
  const fetchMessages = useCallback(async () => {
    if (!objectAddress) return;
    try {
      const res = await axios.get(`${API}/room/${objectAddress}/messages`, { params: { network, limit: 100 } });
      // Store seat/creator data from the API
      if (res.data.seat_holders) setSeatHolders(res.data.seat_holders);
      if (res.data.creators) setRoomCreators(res.data.creators);

      const msgs = (res.data.messages || []).map(m => ({
        id: m.txid || m.transaction_id,
        text: m.content,
        timestamp: m.first_seen || m.created_at || m.block_date,
        from: m.sender_address || m.from_address,
        isMine: (m.sender_address || m.from_address) === myAddress,
        is_seat_holder: m.is_seat_holder || false,
        is_creator: m.is_creator || false,
      }));
      // Sort chronologically
      msgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Merge: keep pending messages that haven't appeared in backend results yet
      setMessages(prev => {
        const pendingMsgs = prev.filter(m => m.pending || m.error);
        const fetchedTexts = new Set(msgs.map(m => (m.text || '').trim()));
        const survivingPending = pendingMsgs.filter(m => !fetchedTexts.has((m.text || '').trim()));
        return [...msgs, ...survivingPending];
      });

      // Resolve unique sender profiles
      const addrs = [...new Set(msgs.map(m => m.from).filter(Boolean))];
      const newProfiles = { ...profiles };
      const toFetch = addrs.filter(a => !newProfiles[a]);
      if (toFetch.length > 0) {
        await Promise.all(toFetch.map(async (addr) => {
          try {
            const pRes = await axios.get(`${API}/profile/${addr}`, { params: { network } });
            if (pRes.data) newProfiles[addr] = pRes.data;
          } catch {}
        }));
        setProfiles(newProfiles);
      }

      // Mark this room as read now that we've viewed it
      if (myAddress && msgs.length > 0) {
        markAsRead(myAddress, objectAddress, msgs.length);
        notifyUnreadChange();
      }
    } catch (err) {
      console.error('Room message fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [objectAddress, network, myAddress, profiles]);

  // Poll for messages
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setLoading(true);
    setMessages([]);
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [objectAddress, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages (both on-chain and offchain)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, offchainMessages]);

  // Resolve profiles for offchain message senders not in cache
  useEffect(() => {
    const offchainAddrs = offchainMessages
      .map(m => m.sender)
      .filter(addr => addr && addr !== myAddress && !profiles[addr]);
    const unique = [...new Set(offchainAddrs)];
    if (unique.length === 0) return;
    const resolve = async () => {
      const newProfiles = { ...profiles };
      await Promise.all(unique.map(async (addr) => {
        try {
          const pRes = await axios.get(`${API}/profile/${addr}`, { params: { network } });
          if (pRes.data) newProfiles[addr] = pRes.data;
        } catch {}
      }));
      setProfiles(newProfiles);
    };
    resolve();
  }, [offchainMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audience feed (ephemeral, off-chain) ─────────────────
  const fetchAudienceMessages = useCallback(async () => {
    if (!objectAddress) return;
    try {
      const res = await axios.get(`${API}/room/${objectAddress}/audience`, { params: { network } });
      setAudienceMessages(res.data.messages || []);
    } catch {}
  }, [objectAddress, network]);

  // Poll audience messages for venue creators
  useEffect(() => {
    if (audiencePollRef.current) clearInterval(audiencePollRef.current);
    if (!objectAddress) return;
    fetchAudienceMessages();
    audiencePollRef.current = setInterval(fetchAudienceMessages, 15000);
    return () => { if (audiencePollRef.current) clearInterval(audiencePollRef.current); };
  }, [objectAddress, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audience send: builds a tip TX + stores message in backend
  const handleAudienceSend = async () => {
    if (!activeWif || !objectAddress) return;
    const text = audienceText.trim();
    const isTipMsg = audienceTipMode;
    const sats = isTipMsg ? Math.round(parseFloat(audienceTipAmount) * 100_000_000) : 555;
    if (isTipMsg && (isNaN(sats) || sats <= 555)) {
      toast.error('Tip must be more than 555 sats');
      return;
    }
    setAudienceSending(true);
    try {
      const [{ buildAndBroadcast }] = await Promise.all([import('@/utils/txBuilder')]);
      // Simple BTC send to the room address (creator controls it)
      const result = await buildAndBroadcast(activeWif, [], network, [{ address: objectAddress, value: sats }], 0, 546, []);
      if (result.success) {
        // Store the ephemeral message in backend
        await axios.post(`${API}/room/${objectAddress}/audience`, {
          sender_address: myAddress,
          sender_urn: user?.urn || '',
          content: isTipMsg ? '' : text,
          txid: result.txid,
          amount_sats: sats,
          network,
        });
        setAudienceText('');
        setAudienceTipMode(false);
        fetchAudienceMessages();
        toast.success(isTipMsg ? `Tipped ${sats.toLocaleString()} sats!` : 'Message sent (555 sats)');
      }
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setAudienceSending(false);
    }
  };

  // Clear audience cache (creator only)
  const handleClearAudience = async () => {
    try {
      await axios.delete(`${API}/room/${objectAddress}/audience`, { params: { network, creator_address: myAddress } });
      setAudienceMessages([]);
      toast.success('Audience feed cleared');
    } catch {
      toast.error('Failed to clear');
    }
  };

  // Toggle tether
  const toggleTether = () => {
    try {
      const key = `cthulhu_rooms_${myAddress}_${network}`;
      const rooms = JSON.parse(localStorage.getItem(key)) || [];
      if (isTethered) {
        const next = rooms.filter(r => r.objectAddress !== objectAddress);
        localStorage.setItem(key, JSON.stringify(next));
        setIsTethered(false);
      } else {
        rooms.push({
          objectAddress,
          name: objectInfo?.name || 'Unnamed Room',
          image: objectInfo?.image || null,
          tetheredAt: new Date().toISOString(),
        });
        localStorage.setItem(key, JSON.stringify(rooms));
        setIsTethered(true);
      }
      window.dispatchEvent(new CustomEvent('tethers-changed'));
    } catch {}
  };

  // Add Seats (List function)
  const handleAddSeats = async () => {
    if (!activeWif || !isCreator) return;
    const priceNum = parseFloat(addSeatsPrice);
    if (addSeatsQty < 1 || isNaN(priceNum) || priceNum < 0) return;
    setAddSeatsLoading(true);
    try {
      const [{ buildListTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);
      const { addresses, taxInsertIndex } = buildListTransaction(activeWif, objectAddress, addSeatsQty, priceNum, network);
      const result = await buildAndBroadcast(activeWif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        toast.success(`Listed ${addSeatsQty} seat${addSeatsQty > 1 ? 's' : ''}`);
        setShowAddSeats(false);
        setShowRoomMenu(false);
      }
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setAddSeatsLoading(false);
    }
  };

  // Tip the Room — send BTC to the room's creator address
  const handleTip = async () => {
    if (!activeWif || !objectInfo?.creators?.length) return;
    const amount = parseFloat(tipAmount);
    if (isNaN(amount) || amount <= 0) return;
    setTipSending(true);
    try {
      const [{ buildAndBroadcast }] = await Promise.all([import('@/utils/txBuilder')]);
      const creatorAddr = objectInfo.creators[0]?.address || objectInfo.creators[0];
      const satoshis = Math.round(amount * 100000000);
      // Build a simple payment: no P2FK payload, just send BTC
      const result = await buildAndBroadcast(activeWif, [], network, [{ address: creatorAddr, value: satoshis }], 0, 546, []);
      if (result.success) {
        toast.success(`Tipped ${amount} BTC to the venue!`);
        setShowTipModal(false);
        setTipAmount('0.0001');
      }
    } catch (err) {
      toast.error(`Tip failed: ${err.message}`);
    } finally {
      setTipSending(false);
    }
  };

  // Transfer venue — OBJ update transaction to change creator
  const handleTransfer = async () => {
    if (!activeWif || !isCreator || !transferAddress.trim()) return;
    setTransferSending(true);
    try {
      const [{ buildObjectUpdateTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);
      const { addresses, taxInsertIndex } = buildObjectUpdateTransaction(
        activeWif, objectAddress, transferAddress.trim(), {}, network
      );
      const result = await buildAndBroadcast(activeWif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        toast.success('Transfer broadcast! Creator control will update after confirmation.');
        setShowTransferModal(false);
        setTransferAddress('');
      }
    } catch (err) {
      toast.error(`Transfer failed: ${err.message}`);
    } finally {
      setTransferSending(false);
    }
  };

  // Buy a seat — simplified in-venue purchase
  const handleBuySeat = async () => {
    if (!activeWif || !objectInfo?.listings?.length) return;
    const listing = objectInfo.listings.find(l => l.price > 0) || objectInfo.listings[0];
    if (!listing) return;
    setBuySeatSending(true);
    try {
      const [{ buildBuyTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);
      const priceSats = Math.round((listing.price || 0) * 100_000_000);
      const royalties = {};
      if (objectInfo.royalties && typeof objectInfo.royalties === 'object') {
        for (const [addr, pct] of Object.entries(objectInfo.royalties)) {
          if (pct > 0) royalties[addr] = pct;
        }
      }
      const { addresses, extraPaymentOutputs, postPaymentDustAddresses, taxInsertIndex } = buildBuyTransaction(
        activeWif, objectAddress, listing.owner, 1, priceSats, network, royalties
      );
      const result = await buildAndBroadcast(activeWif, addresses, network, [...extraPaymentOutputs], 0, 546, postPaymentDustAddresses, taxInsertIndex);
      if (result.success) {
        setBuySeatResult(result.txid);
      }
    } catch (err) {
      toast.error(`Purchase failed: ${err.message}`);
    } finally {
      setBuySeatSending(false);
    }
  };

  let lastDate = '';

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden" data-testid="object-chat-page">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50 bg-gray-900/50 flex-shrink-0">
        <button onClick={() => navigate('/chats')} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="room-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <button onClick={() => {
          if (objectInfo?.license?.startsWith('cthulhu:tether')) return;
          navigate(`/object/addr/${objectAddress}`);
        }} className="flex items-center gap-3 flex-1 min-w-0">
          {(() => {
            const parsed = parseMediaString(objectInfo?.image, { mainnet: isMainnetNetwork(network) });
            const imgSrc = parsed?.url || (objectInfo?.imageUrl && !objectInfo.imageUrl.startsWith('blob:') ? objectInfo.imageUrl : null);
            return imgSrc ? (
              <img src={imgSrc} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-gray-800" />
            ) : (
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--c-accentMuted)', borderColor: 'rgba(var(--c-accent-rgb), 0.2)', borderWidth: '1px' }}>
                {isVenue ? <FiMic size={18} style={{ color: 'var(--c-accent)' }} /> : <FiGrid size={18} style={{ color: 'var(--c-accent)' }} />}
              </div>
            );
          })()}
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-gray-200 truncate" data-testid="room-name">
              {objectInfo?.name || `Room ${objectAddress?.slice(0, 12)}...`}
            </p>
            <p className="text-[10px] text-gray-500 truncate cursor-pointer hover:text-gray-300 transition-colors"
              onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(objectAddress); }}
              title="Copy room address"
              data-testid="copy-room-address"
            >
              {objectInfo?.pending ? 'Confirming...' : isVenue ? `Venue · ${seatHolders.length} seat holder${seatHolders.length !== 1 ? 's' : ''}` : objectAddress?.slice(0, 24) + '...'}
            </p>
          </div>
        </button>
        <button
          onClick={toggleTether}
          className={`p-2 rounded-lg transition-colors ${isTethered ? 'bg-accent-muted text-accent' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
          title={isTethered ? 'Untether room' : 'Tether room'}
          data-testid="tether-toggle-btn"
        >
          {isTethered ? <FiLink size={16} /> : <FiLink2 size={16} />}
        </button>
        {/* Room menu */}
        <div className="relative">
          <button onClick={() => setShowRoomMenu(!showRoomMenu)} className="p-2 rounded-lg bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" data-testid="room-menu-btn">
            <FiMoreVertical size={16} />
          </button>
          {showRoomMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-50 py-1" data-testid="room-menu-dropdown">
              {isCreator && (
                <>
                  <button onClick={() => { toggleCreatorAvatar(); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors" data-testid="toggle-avatar-btn">
                    <FiUser size={14} /> {creatorUsesRoomImage ? 'Speak as Self' : 'Speak as Room'}
                  </button>
                  {isVenue && audienceMessages.length > 0 && (
                    <button onClick={() => { setShowAudienceModal(true); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors" data-testid="audience-chat-btn">
                      <FiEye size={14} /> Audience
                      <span className="ml-auto text-[10px] text-gray-500 bg-gray-800 rounded-full px-1.5 py-0.5">{audienceMessages.length}</span>
                    </button>
                  )}
                  {isVenue && isCreator && audienceMessages.length > 0 && (
                    <button onClick={() => { handleClearAudience(); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors" data-testid="clear-audience-btn">
                      <FiX size={14} /> Clear Audience Feed
                    </button>
                  )}
                  {isVenue && (
                    <button onClick={() => { setShowAddSeats(true); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors" data-testid="add-seats-btn">
                      <FiPlus size={14} /> List Seats
                      <span className="text-[10px] text-gray-600 ml-auto">{supply} total</span>
                    </button>
                  )}
                  <button onClick={() => { setShowTransferModal(true); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors" data-testid="transfer-venue-btn">
                    <FiRepeat size={14} /> Transfer Control
                  </button>
                </>
              )}
              <button onClick={() => { navigator.clipboard?.writeText(objectAddress); toast.success('Room address copied'); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors">
                <FiCopy size={14} /> Copy Address
              </button>
              {objectInfo && !objectInfo.license?.startsWith('cthulhu:tether') && (
                <button onClick={() => { navigate(`/object/addr/${objectAddress}`); setShowRoomMenu(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors">
                  <FiGrid size={14} /> View Object
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col" style={wallpaperStyle} data-testid="room-messages">
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
        {/* Venue indicator */}
        {isVenue && !loading && (
          <div className="flex items-center justify-center mb-2">
            <span className="bg-gray-800/80 text-gray-500 text-[10px] px-3 py-1 rounded-full flex items-center gap-1.5">
              <FiMic size={10} /> Speaking Venue &middot; {seatHolders.length} seat holder{seatHolders.length !== 1 ? 's' : ''}
              {audienceMessages.length > 0 && isCreator && (
                <button
                  onClick={() => setShowAudienceModal(true)}
                  className="ml-1 hover:text-purple-300 underline underline-offset-2"
                  style={{ color: 'var(--c-accent)' }}
                  data-testid="audience-inline-btn"
                >
                  {audienceMessages.length} audience msg{audienceMessages.length !== 1 ? 's' : ''}
                </button>
              )}
            </span>
          </div>
        )}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-600">
              <div className="animate-pulse mb-2">Loading room messages...</div>
            </div>
          </div>
        ) : mergedMessages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-600">
              <FiGrid size={32} className="mx-auto mb-2 text-gray-700" />
              <p className="text-sm">No messages in this room yet</p>
              <p className="text-xs text-gray-700 mt-1">Be the first to start the conversation</p>
            </div>
          </div>
        ) : (
          <div className="mt-auto">
            {filterBlocked(mergedMessages, 'from').map((msg) => {
              const dateLabel = formatDate(msg.timestamp);
              const showDate = dateLabel !== lastDate;
              if (showDate) lastDate = dateLabel;
              return (
                <ChatBubble key={msg.id} message={msg} isMine={msg.isMine} showDate={showDate} dateLabel={dateLabel} profiles={profiles} onBlock={blockUser} navigate={navigate} humanCreatorAddresses={humanCreatorAddresses} creatorUsesRoomImage={creatorUsesRoomImage} roomImage={objectInfo?.image || objectInfo?.imageUrl} />
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>{/* End max-w-3xl */}
      </div>

      {/* Compose area */}
      {isAudience ? (
        /* Audience compose — tip-based ephemeral messaging */
        <div className="flex-shrink-0 border-t border-gray-800/50 bg-gray-900/50" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }} data-testid="audience-compose">
          <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-[10px] text-gray-500 flex items-center gap-1"><FiEye size={10} /> Audience</span>
            <span className="text-[10px] text-gray-600">555 sats/msg</span>
            <span className="flex-1" />
            {listedCount > 0 && (
              <button onClick={() => setShowBuySeatModal(true)} className="text-[10px] underline underline-offset-2" style={{ color: 'var(--c-accent)' }} data-testid="buy-seat-link">
                {listedCount} seat{listedCount !== 1 ? 's' : ''} available
              </button>
            )}
          </div>
          <div className="flex items-end gap-2 px-3 pb-2">
            {/* Tip toggle */}
            <button
              onClick={() => setAudienceTipMode(!audienceTipMode)}
              className={`p-2 rounded-lg flex-shrink-0 transition-colors ${audienceTipMode ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
              title={audienceTipMode ? 'Cancel tip' : 'Send a super chat tip'}
              data-testid="audience-tip-toggle"
            >
              <FiDollarSign size={16} />
            </button>
            {audienceTipMode ? (
              /* Tip mode: amount input + send */
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={audienceTipAmount}
                  onChange={e => setAudienceTipAmount(e.target.value)}
                  placeholder="0.001"
                  className="flex-1 px-3 py-2 bg-gray-800 border border-amber-500/30 rounded-lg text-gray-100 text-sm focus:outline-none font-mono"
                  data-testid="audience-tip-amount"
                />
                <span className="text-[10px] text-gray-500 flex-shrink-0">BTC</span>
              </div>
            ) : (
              /* Message mode: text input */
              <input
                type="text"
                value={audienceText}
                onChange={e => setAudienceText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && audienceText.trim()) { e.preventDefault(); handleAudienceSend(); } }}
                placeholder="Message (555 sats)..."
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-600"
                disabled={audienceSending}
                data-testid="audience-text-input"
              />
            )}
            <button
              onClick={handleAudienceSend}
              disabled={audienceSending || (!audienceTipMode && !audienceText.trim())}
              className="p-2 rounded-lg flex-shrink-0 text-white transition-all disabled:opacity-40 active:scale-95"
              style={{ backgroundColor: audienceTipMode ? '#d97706' : 'var(--c-accent, #8b5cf6)' }}
              data-testid="audience-send-btn"
            >
              {audienceSending ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
              ) : audienceTipMode ? (
                <FiDollarSign size={16} />
              ) : (
                <FiMic size={16} />
              )}
            </button>
          </div>
          </div>{/* End max-w-3xl */}
        </div>
      ) : !isConnected || !activeWif ? (
        /* Not signed in */
        <div className="flex-shrink-0 border-t border-gray-800/50 bg-gray-900/50 px-3 py-3" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }} data-testid="room-compose">
          <div className="max-w-3xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500" data-testid="signin-notice">
            <FiLock size={12} />
            <span>Sign in to broadcast</span>
          </div>
        </div>
      ) : isVenue && !hasSeat && !isAudience ? (
        /* Venue but audience compose already handled above — this is fallback for non-connected audience */
        <div className="flex-shrink-0 border-t border-gray-800/50 bg-gray-900/50 px-3 py-3" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }} data-testid="room-compose">
          <div className="max-w-3xl mx-auto flex items-center justify-center gap-2 text-xs text-gray-500" data-testid="read-only-notice">
            <FiLock size={12} />
            <span>Read only — purchase a seat to speak</span>
            {listedCount > 0 && (
              <button onClick={() => setShowBuySeatModal(true)} className="hover:text-purple-300 underline underline-offset-2 ml-1" style={{ color: 'var(--c-accent)' }}>
                {listedCount} seat{listedCount !== 1 ? 's' : ''} available
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Dual-mode compose: offchain (default, free) or on-chain (P2FK, costs sats) */
        <div className="flex-shrink-0 border-t border-gray-800/50 bg-gray-900/50" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }} data-testid="room-compose">
          <div className="max-w-3xl mx-auto">
            {/* P2P connection status */}
            {composeMode === 'offchain' && (
              <div className="flex items-center gap-1.5 px-4 pt-1.5 pb-0.5" data-testid="p2p-status">
                <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-[10px] text-gray-600">{wsConnected ? 'P2P relay connected' : 'P2P relay disconnected'}</span>
              </div>
            )}
            {/* Mode selector + input */}
            {composeMode === 'offchain' ? (
              <div className="flex items-end gap-2 px-3 py-2">
                <button
                  onClick={() => setComposeMode('onchain')}
                  className="p-2 rounded-lg flex-shrink-0 bg-gray-800 text-green-400 hover:bg-gray-700 transition-colors"
                  title="Switch to on-chain broadcast (costs sats)"
                  data-testid="compose-mode-toggle"
                >
                  <FiRadio size={16} />
                </button>
                <input
                  type="text"
                  value={offchainText}
                  onChange={e => setOffchainText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && offchainText.trim()) {
                      e.preventDefault();
                      sendOffchain(offchainText.trim());
                      setOffchainText('');
                    }
                  }}
                  placeholder="Message (free, P2P)..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500/40"
                  data-testid="offchain-text-input"
                />
                <button
                  onClick={() => { if (offchainText.trim()) { sendOffchain(offchainText.trim()); setOffchainText(''); } }}
                  disabled={!offchainText.trim()}
                  className="p-2 rounded-lg flex-shrink-0 text-white transition-all disabled:opacity-40 active:scale-95"
                  style={{ backgroundColor: 'var(--c-accent, #22c55e)' }}
                  data-testid="offchain-send-btn"
                >
                  <FiSend size={16} />
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 px-3 pt-1.5">
                  <button
                    onClick={() => setComposeMode('offchain')}
                    className="text-[10px] text-gray-500 hover:text-green-400 flex items-center gap-1 transition-colors"
                    data-testid="compose-mode-back"
                  >
                    <FiRadio size={10} /> Switch to free P2P
                  </button>
                  <span className="text-[10px] text-gray-600">On-chain broadcast (costs sats)</span>
                </div>
                <ComposeBar network={network} targetAddress={objectAddress} onPostSuccess={fetchMessages} onBeforeSend={handleBeforeSend} onSendSuccess={handleSendSuccess} onSendError={handleSendError} placeholder={isVenue ? 'Speak in this venue...' : 'Broadcast on-chain...'} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>

    {/* Add Seats Modal */}
    {showAddSeats && (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowAddSeats(false)} data-testid="add-seats-modal">
        <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FiPlus size={16} className="text-purple-400" /> List Seats
          </h3>
          <p className="text-xs text-gray-500">Open additional seats for sale. Currently {supply} total, {listedCount} listed.</p>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Number of Seats</label>
            <input type="number" value={addSeatsQty} onChange={e => setAddSeatsQty(Math.max(1, parseInt(e.target.value) || 1))} min={1}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none" data-testid="add-seats-qty" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Price per Seat (BTC)</label>
            <input type="text" value={addSeatsPrice} onChange={e => setAddSeatsPrice(e.target.value)} placeholder="0.0001"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none" data-testid="add-seats-price" />
            {addSeatsPrice && !isNaN(parseFloat(addSeatsPrice)) && (
              <p className="text-[10px] text-gray-500 mt-1">{Math.round(parseFloat(addSeatsPrice) * 100000000).toLocaleString()} sats each</p>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowAddSeats(false)} className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors">Cancel</button>
            <button onClick={handleAddSeats} disabled={addSeatsLoading || addSeatsQty < 1 || isNaN(parseFloat(addSeatsPrice)) || parseFloat(addSeatsPrice) < 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors" data-testid="add-seats-submit">
              <FiPlus size={14} /> {addSeatsLoading ? 'Listing...' : 'List Seats'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Tip the Room Modal */}
    {showTipModal && (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowTipModal(false)} data-testid="tip-modal">
        <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FiDollarSign size={16} className="text-amber-400" /> Tip the Venue
          </h3>
          <p className="text-xs text-gray-500">Send BTC directly to the venue creator.</p>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Amount (BTC)</label>
            <input type="text" value={tipAmount} onChange={e => setTipAmount(e.target.value)} placeholder="0.0001"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-amber-500 focus:outline-none" data-testid="tip-amount" />
            {tipAmount && !isNaN(parseFloat(tipAmount)) && (
              <p className="text-[10px] text-gray-500 mt-1">{Math.round(parseFloat(tipAmount) * 100000000).toLocaleString()} sats</p>
            )}
          </div>
          {/* Quick tip amounts */}
          <div className="flex gap-2">
            {['0.0001', '0.0005', '0.001', '0.005'].map(amt => (
              <button key={amt} onClick={() => setTipAmount(amt)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${tipAmount === amt ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-300'}`}
                data-testid={`tip-quick-${amt}`}
              >
                {Math.round(parseFloat(amt) * 100000000)} sats
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowTipModal(false)} className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors">Cancel</button>
            <button onClick={handleTip} disabled={tipSending || isNaN(parseFloat(tipAmount)) || parseFloat(tipAmount) <= 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors" data-testid="tip-submit">
              <FiDollarSign size={14} /> {tipSending ? 'Sending...' : 'Send Tip'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Close menu when clicking outside */}
    {showRoomMenu && <div className="fixed inset-0 z-40" onClick={() => setShowRoomMenu(false)} />}

    {/* Buy Seat Modal — simple popup */}
    {showBuySeatModal && (() => {
      const listing = objectInfo?.listings?.find(l => l.price > 0) || objectInfo?.listings?.[0];
      const seatPrice = listing?.price || 0;
      const seatAvail = listing?.quantity || 0;
      const seatSats = Math.round(seatPrice * 100_000_000);
      return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => { setShowBuySeatModal(false); setBuySeatResult(null); }} data-testid="buy-seat-modal">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-xs p-5" onClick={e => e.stopPropagation()}>
            {buySeatResult ? (
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                  <FiCheck size={24} className="text-emerald-400" />
                </div>
                <p className="text-emerald-400 font-medium text-sm">Seat purchased!</p>
                <p className="text-[10px] text-gray-500 font-mono break-all">{buySeatResult}</p>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <p className="text-xs text-gray-400">Confirmation typically takes <span className="text-gray-200 font-medium">~10 minutes</span> on testnet. Your speaking access will activate once the transaction confirms.</p>
                </div>
                <button onClick={() => { setShowBuySeatModal(false); setBuySeatResult(null); }} className="w-full py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors" data-testid="buy-seat-close">
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-base font-bold text-gray-100 text-center">Get a Seat</h3>
                <div className="text-center space-y-1">
                  <p className="text-2xl font-bold text-gray-100">{seatPrice === 0 ? 'FREE' : `${seatPrice} BTC`}</p>
                  {seatSats > 0 && <p className="text-xs text-gray-500">{seatSats.toLocaleString()} sats</p>}
                  <p className="text-[10px] text-gray-600">{seatAvail} seat{seatAvail !== 1 ? 's' : ''} available</p>
                </div>
                <div className="bg-gray-800/30 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                    Purchasing a seat grants speaking access in this venue. Confirmation may take ~10 minutes.
                  </p>
                </div>
                <button
                  onClick={handleBuySeat}
                  disabled={buySeatSending || !activeWif || !listing}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-white transition-all disabled:opacity-40 active:scale-[0.98]"
                  style={{ backgroundColor: 'var(--c-accent, #8b5cf6)' }}
                  data-testid="buy-seat-confirm"
                >
                  <FiMic size={16} />
                  {buySeatSending ? 'Signing...' : seatPrice === 0 ? 'Claim Seat' : 'Purchase Seat'}
                </button>
                <button onClick={() => setShowBuySeatModal(false)} className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      );
    })()}

    {/* Transfer Control Modal — enhanced with Give/Sell */}
    {showTransferModal && isCreator && (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowTransferModal(false)} data-testid="transfer-modal">
        <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FiRepeat size={16} className="text-orange-400" /> Transfer Creator Control
          </h3>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTransferMode('give')}
              className={`py-2 rounded-lg text-xs font-medium transition-colors ${transferMode === 'give' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-300'}`}
              data-testid="transfer-mode-give"
            >
              Give Away
            </button>
            <button
              onClick={() => setTransferMode('sell')}
              className={`py-2 rounded-lg text-xs font-medium transition-colors ${transferMode === 'sell' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-300'}`}
              data-testid="transfer-mode-sell"
            >
              Sell Control
            </button>
          </div>

          <div className="bg-red-900/15 border border-red-800/30 rounded-lg p-3">
            <p className="text-[11px] text-red-400 leading-relaxed font-medium">
              {transferMode === 'give'
                ? 'This is irreversible. The new address gets full creator privileges — listing seats, receiving tips, transferring again. You lose creator access.'
                : 'Set your price and the buyer\'s address. The transfer executes immediately — collect payment separately before confirming.'}
            </p>
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">
              {transferMode === 'give' ? 'Recipient Address' : 'Buyer Address'}
            </label>
            <input
              type="text"
              value={transferAddress}
              onChange={e => setTransferAddress(e.target.value)}
              placeholder="Destination address"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono focus:border-orange-500 focus:outline-none"
              data-testid="transfer-address-input"
            />
          </div>

          {transferMode === 'sell' && (
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Sale Price (BTC)</label>
              <input
                type="text"
                value={transferPrice}
                onChange={e => setTransferPrice(e.target.value)}
                placeholder="0.001"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-orange-500 focus:outline-none"
                data-testid="transfer-price-input"
              />
              {transferPrice && !isNaN(parseFloat(transferPrice)) && (
                <p className="text-[10px] text-gray-500 mt-1">{Math.round(parseFloat(transferPrice) * 100000000).toLocaleString()} sats</p>
              )}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 mt-2">
                <p className="text-[10px] text-amber-400/80 leading-relaxed">
                  Confirm the buyer has sent {transferPrice || '...'} BTC to your address before executing. This transfer is on-chain and irreversible.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setShowTransferModal(false); setTransferAddress(''); }} className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleTransfer}
              disabled={transferSending || !transferAddress.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
              data-testid="transfer-submit"
            >
              <FiRepeat size={14} /> {transferSending ? 'Broadcasting...' : transferMode === 'give' ? 'Give Away' : 'Execute Transfer'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Audience Modal — floating, draggable, creator-only */}
    {showAudienceModal && isCreator && (
      <AudienceModal
        messages={audienceMessages}
        profiles={profiles}
        onClose={() => setShowAudienceModal(false)}
        navigate={navigate}
        onClear={handleClearAudience}
      />
    )}
    </>
  );
}
