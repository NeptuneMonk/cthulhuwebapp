import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiMapPin, FiLock, FiHash, FiMessageCircle, FiX, FiCreditCard, FiFeather, FiFilm, FiMusic, FiCompass, FiMic, FiImage, FiUser, FiArrowLeft, FiChevronRight, FiPlus, FiSend, FiPaperclip } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { useAuth } from '@/hooks/useAuth';
import { getUnreadCount, markAsRead, setTotalRoomUnread, notifyUnreadChange } from '@/utils/unreadTracker';
import { getGossipRoomUnread, clearGossipRoom } from '@/utils/meshNotifications';
import { addTransaction } from '@/utils/txHistory';
import { meshFirstFetch } from '@/utils/meshFirstFetch';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CTHULHU_LOGO = '/cthulhu-logo.svg';

export default function ChatsPage({
  network, sortedFriends = [], friendMessages = {}, tetheredRooms = [],
  dmNotifications, authConnected, pinnedFriends = [], tetherRoom,
  profileImage, profileUrn, onAcceptRequest, gossipUnread = 0,
  inksBySender = {}, clearInk, clearInksFrom
}) {
  const navigate = useNavigate();
  const { user: authUser, wif: authWif, isConnected: authIsConnected } = useAuth();
  const myAddress = authUser?.address;
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFABMenu, setShowFABMenu] = useState(false);
  const [roomPreviews, setRoomPreviews] = useState({});
  const fabMenuRef = useRef(null);
  const fetchedRef = useRef(new Set());
  const [showRequests, setShowRequests] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);
  const [topicSearch, setTopicSearch] = useState('');
  const [showTopicSearch, setShowTopicSearch] = useState(false);
  const [showTopicFAB, setShowTopicFAB] = useState(false);
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const topicFabRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (fabMenuRef.current && !fabMenuRef.current.contains(e.target)) setShowFABMenu(false);
    };
    if (showFABMenu) document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showFABMenu]);

  useEffect(() => {
    const handler = (e) => {
      if (topicFabRef.current && !topicFabRef.current.contains(e.target)) setShowTopicFAB(false);
    };
    if (showTopicFAB) document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showTopicFAB]);

  // Fetch last message for ALL tethered rooms (including topics)
  const fetchRoomPreviews = useCallback(async () => {
    if (!tetheredRooms.length) return;
    const toFetch = tetheredRooms.filter(r => !fetchedRef.current.has(r.objectAddress));
    if (!toFetch.length) return;

    const results = await Promise.allSettled(
      toFetch.map(async (room) => {
        fetchedRef.current.add(room.objectAddress);
        try {
          // Mesh-first: peers → blockchain → backend
          const { data } = await meshFirstFetch(`/room/${room.objectAddress}/messages`, { network, limit: 5 });
          if (!data) return { addr: room.objectAddress, data: null };
          const msgs = data.messages || [];
          if (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            return {
              addr: room.objectAddress,
              data: {
                preview: truncatePreview(last.content),
                timestamp: last.block_date || last.created_at,
                senderUrn: last.sender_urn,
                count: msgs.length,
              }
            };
          }
          return { addr: room.objectAddress, data: null };
        } catch {
          return { addr: room.objectAddress, data: null };
        }
      })
    );

    const newPreviews = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.data) {
        newPreviews[r.value.addr] = r.value.data;
      }
    }
    if (Object.keys(newPreviews).length > 0) {
      setRoomPreviews(prev => ({ ...prev, ...newPreviews }));
    }
  }, [tetheredRooms, network]);

  useEffect(() => { fetchRoomPreviews(); }, [fetchRoomPreviews]);

  // Fetch registered topics from backend for all tethered rooms
  const [backendTopics, setBackendTopics] = useState({}); // parentAddr -> [{topic_address, name, description, image}]
  const fetchedTopicsRef = useRef(new Set());

  useEffect(() => {
    if (!tetheredRooms.length) return;
    const toFetch = tetheredRooms.filter(r => {
      const isTopic = (r.license || '').toLowerCase() === 'cthulhu:tether:topic';
      return !isTopic && !fetchedTopicsRef.current.has(r.objectAddress);
    });
    if (!toFetch.length) return;

    (async () => {
      const results = await Promise.allSettled(
        toFetch.map(async (room) => {
          fetchedTopicsRef.current.add(room.objectAddress);
          const { data } = await meshFirstFetch(`/rooms/${room.objectAddress}/topics`, { network });
          if (!data) return { addr: room.objectAddress, topics: [] };
          return { addr: room.objectAddress, topics: data.topics || [] };
        })
      );
      const newMap = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.topics?.length > 0) {
          newMap[r.value.addr] = r.value.topics;
        }
      }
      if (Object.keys(newMap).length > 0) {
        setBackendTopics(prev => ({ ...prev, ...newMap }));
      }
    })();
  }, [tetheredRooms, network]);

  // Also auto-register any locally-known topics to the backend
  useEffect(() => {
    for (const room of tetheredRooms) {
      const isTopic = (room.license || '').toLowerCase() === 'cthulhu:tether:topic';
      if (isTopic && room.uri) {
        fetch(`${API}/rooms/register-topic`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent_address: room.uri, topic_address: room.objectAddress,
            network, name: room.name, description: room.description, image: room.image,
            creator_address: myAddress,
          }),
        }).catch(() => {});
      }
    }
  }, [tetheredRooms, network]);

  // --- TOPIC GROUPING LOGIC ---
  // Merge local topics (from tetheredRooms) with backend-discovered topics
  const { topicsByParent, topicAddresses } = useMemo(() => {
    const map = {}; // parentAddress -> [topicRoom, ...]
    const addrs = new Set();

    // Local topics (user owns them)
    for (const room of tetheredRooms) {
      const isTopic = (room.license || '').toLowerCase() === 'cthulhu:tether:topic';
      if (isTopic && room.uri) {
        if (!map[room.uri]) map[room.uri] = [];
        map[room.uri].push(room);
        addrs.add(room.objectAddress);
      }
    }

    // Backend-registered topics (from other users)
    for (const [parentAddr, topics] of Object.entries(backendTopics)) {
      for (const bt of topics) {
        if (addrs.has(bt.topic_address)) continue; // already known locally
        if (!map[parentAddr]) map[parentAddr] = [];
        map[parentAddr].push({
          objectAddress: bt.topic_address,
          name: bt.name || 'Topic',
          description: bt.description || '',
          image: bt.image,
          license: 'cthulhu:tether:topic',
          uri: parentAddr,
        });
        addrs.add(bt.topic_address);
      }
    }

    return { topicsByParent: map, topicAddresses: addrs };
  }, [tetheredRooms, backendTopics]);

  // Fetch previews for backend-discovered topics not in tetheredRooms
  useEffect(() => {
    const backendOnlyAddrs = [];
    for (const topics of Object.values(backendTopics)) {
      for (const bt of topics) {
        if (!fetchedRef.current.has(bt.topic_address) && !tetheredRooms.some(r => r.objectAddress === bt.topic_address)) {
          backendOnlyAddrs.push(bt.topic_address);
        }
      }
    }
    if (!backendOnlyAddrs.length) return;
    (async () => {
      const results = await Promise.allSettled(
        backendOnlyAddrs.map(async (addr) => {
          fetchedRef.current.add(addr);
          try {
            const { data } = await meshFirstFetch(`/room/${addr}/messages`, { network, limit: 5 });
            if (!data) return { addr, data: null };
            const msgs = data.messages || [];
            if (msgs.length > 0) {
              const last = msgs[msgs.length - 1];
              return { addr, data: { preview: truncatePreview(last.content), timestamp: last.block_date || last.created_at, senderUrn: last.sender_urn, count: msgs.length } };
            }
            return { addr, data: null };
          } catch { return { addr, data: null }; }
        })
      );
      const newPreviews = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.data) newPreviews[r.value.addr] = r.value.data;
      }
      if (Object.keys(newPreviews).length > 0) setRoomPreviews(prev => ({ ...prev, ...newPreviews }));
    })();
  }, [backendTopics, network, tetheredRooms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: compute unread for a single room (combines local + server + gossip)
  const getRoomUnread = useCallback((roomAddr) => {
    if (!myAddress) return 0;
    const preview = roomPreviews[roomAddr];
    const totalMessages = preview?.count || 0;
    const localUnread = getUnreadCount(myAddress, roomAddr, totalMessages);
    const gossipCount = getGossipRoomUnread(roomAddr);
    return localUnread + gossipCount;
  }, [myAddress, roomPreviews]);

  // Build unified items
  const items = [];

  sortedFriends.forEach(friend => {
    const msg = friendMessages[friend.address];
    const hasUnread = dmNotifications?.hasUnreadEncrypted?.(friend.address);
    const isPinned = pinnedFriends.includes(friend.address);
    let preview = `@${friend.urn || friend.address?.substring(0, 10)}`;
    let isVoicemail = false;
    let mediaType = msg?.mediaType || null;
    if (hasUnread) {
      preview = 'New encrypted message';
    } else if (msg?.content) {
      const content = msg.content.substring(0, 80);
      if (content.startsWith('[VM]')) {
        preview = 'Voicemail';
        isVoicemail = true;
      } else if (content === 'Photo' || content === 'Video' || content === 'Audio' || content === 'Voice message' || content === 'File' || content === 'Media') {
        preview = content;
        mediaType = mediaType || content.toLowerCase();
      } else if (content.startsWith('IPFS:') || content.match(/\.(png|jpg|jpeg|gif|webp|mp4|webm)$/i)) {
        preview = 'Media';
        mediaType = 'media';
      } else if (content === 'voice.webm' || content.startsWith('voice')) {
        preview = 'Voice message';
        mediaType = 'voice';
      } else {
        preview = content;
      }
    }
    items.push({
      type: 'dm', id: friend.address,
      name: friend.display_name || friend.urn || friend.address.substring(0, 12),
      image: friend.image, urn: friend.urn, preview,
      timestamp: msg?.created_at, hasUnread, isPinned, isEncrypted: hasUnread, isVoicemail,
      mediaType, txid: msg?.txid,
      inks: inksBySender[friend.address] || [],
    });
  });

  tetheredRooms.forEach(room => {
    // Skip topics — they are shown inside the parent's panel
    if (topicAddresses.has(room.objectAddress)) return;

    const isCthulhuTether = (room.license || '').toLowerCase().startsWith('cthulhu:tether');
    const roomPreview = roomPreviews[room.objectAddress];
    let preview;
    let timestamp = roomPreview?.timestamp || room.created_date || room.tetheredAt;

    const isActuallyPending = room.pending && !roomPreview;

    if (isActuallyPending) {
      preview = 'Confirming...';
    } else if (roomPreview) {
      const sender = roomPreview.senderUrn ? `${roomPreview.senderUrn}: ` : '';
      preview = `${sender}${roomPreview.preview}`;
    } else if (!isCthulhuTether) {
      const date = room.created_date;
      preview = date ? `Inked on ${formatDateShort(date)}` : 'Inked object';
    } else {
      const supply = room.total_supply || 1;
      const listedCount = (room.listings || []).length;
      if (supply <= 1) {
        preview = room.description ? room.description.slice(0, 60) : 'Public chat room';
      } else if (listedCount > 0) {
        preview = `${listedCount} seat${listedCount !== 1 ? 's' : ''} available`;
      } else {
        preview = 'Gated room';
      }
    }

    const totalMessages = roomPreview?.count || 0;
    const roomUnread = myAddress ? getUnreadCount(myAddress, room.objectAddress, totalMessages) : 0;

    // Aggregate unread from topics under this room
    const topics = topicsByParent[room.objectAddress] || [];
    let topicUnreadSum = 0;
    for (const topic of topics) {
      topicUnreadSum += getRoomUnread(topic.objectAddress);
    }

    const totalUnread = roomUnread + topicUnreadSum;
    const hasTopics = topics.length > 0;

    items.push({
      type: 'room', id: room.objectAddress,
      name: room.name || 'Unnamed Room', image: room.image, imageUrl: room.imageUrl,
      preview, timestamp, hasUnread: totalUnread > 0, isPinned: false,
      isCthulhu: isCthulhuTether,
      messageCount: totalMessages,
      unreadCount: totalUnread,
      hasTopics,
      license: room.license,
    });
  });

  items.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  // Build message requests: DM threads from non-followed users
  const followedAddresses = new Set(sortedFriends.map(f => f.address));
  const messageRequests = (dmNotifications?.dmThreads || [])
    .filter(t => t.address && t.address !== '__vault__' && !followedAddresses.has(t.address))
    .map(t => ({
      address: t.address,
      name: t.profile?.urn || t.profile?.display_name || `${t.address.substring(0, 12)}...`,
      image: t.profile?.image,
      messageCount: t.message_count || 0,
      lastDate: t.last_date,
      profile: t.profile,
    }));

  // Compute total room unreads and store for the bottom nav badge
  useEffect(() => {
    if (!myAddress) return;
    const totalRoomUnread = items.reduce((sum, item) => sum + (item.type === 'room' ? (item.unreadCount || 0) : 0), 0);
    setTotalRoomUnread(myAddress, totalRoomUnread);
  }, [myAddress, roomPreviews, tetheredRooms, gossipUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = searchQuery
    ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : items;

  // --- TOPICS PANEL DATA ---
  const parentRoom = selectedParent
    ? tetheredRooms.find(r => r.objectAddress === selectedParent)
    : null;
  const topicsList = selectedParent ? (topicsByParent[selectedParent] || []) : [];

  // Build topic items with previews/unreads for the panel
  const topicPanelItems = useMemo(() => {
    if (!parentRoom) return [];
    const panelItems = [];

    // Parent room as "General" first entry
    const parentPreview = roomPreviews[parentRoom.objectAddress];
    const parentUnread = getRoomUnread(parentRoom.objectAddress);
    panelItems.push({
      id: parentRoom.objectAddress,
      name: 'General',
      isGeneral: true,
      image: parentRoom.image,
      imageUrl: parentRoom.imageUrl,
      description: parentRoom.description || '',
      lastMessage: parentPreview
        ? `${parentPreview.senderUrn ? parentPreview.senderUrn + ': ' : ''}${parentPreview.preview}`
        : null,
      timestamp: parentPreview?.timestamp,
      unreadCount: parentUnread,
      hasUnread: parentUnread > 0,
      messageCount: parentPreview?.count || 0,
    });

    // Sub-topics
    for (const topic of topicsList) {
      const tp = roomPreviews[topic.objectAddress];
      const tUnread = getRoomUnread(topic.objectAddress);
      panelItems.push({
        id: topic.objectAddress,
        name: topic.name || 'Topic',
        isGeneral: false,
        image: topic.image,
        imageUrl: topic.imageUrl,
        description: topic.description || '',
        lastMessage: tp
          ? `${tp.senderUrn ? tp.senderUrn + ': ' : ''}${tp.preview}`
          : null,
        timestamp: tp?.timestamp,
        unreadCount: tUnread,
        hasUnread: tUnread > 0,
        messageCount: tp?.count || 0,
      });
    }
    return panelItems;
  }, [parentRoom, topicsList, roomPreviews, getRoomUnread]);

  // Filter topics by search
  const filteredTopicItems = topicSearch
    ? topicPanelItems.filter(t => t.name.toLowerCase().includes(topicSearch.toLowerCase()) || (t.description || '').toLowerCase().includes(topicSearch.toLowerCase()))
    : topicPanelItems;

  // --- RENDER ---
  // Topics panel mode — avatars stay same size/position, topics panel replaces text area
  if (selectedParent && parentRoom) {
    return (
      <div className="h-full flex flex-col" data-testid="chats-page-topics">
        {/* Topics header with search + FAB */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60 flex-shrink-0">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <button onClick={() => { setSelectedParent(null); setTopicSearch(''); setShowTopicSearch(false); }} className="p-1 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="topics-back-btn">
              <FiArrowLeft size={18} />
            </button>
            <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
              <RoomAvatar room={parentRoom} network={network} size={36} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-gray-100 truncate">{parentRoom.name}</h3>
              <p className="text-xs text-gray-500">{topicPanelItems.length} topic{topicPanelItems.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setShowTopicSearch(!showTopicSearch); if (showTopicSearch) setTopicSearch(''); }}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
              data-testid="topics-search-btn">
              {showTopicSearch ? <FiX size={18} /> : <FiSearch size={18} />}
            </button>
            <div className="relative" ref={topicFabRef}>
              <button onClick={() => setShowTopicFAB(!showTopicFAB)}
                className={`p-2 rounded-lg transition-all ${showTopicFAB ? 'bg-gray-800' : 'hover:bg-gray-800'}`}
                style={{ color: 'var(--c-accent, #8b5cf6)' }}
                data-testid="topics-fab-btn">
                <FiFeather size={18} className={`transition-transform ${showTopicFAB ? 'rotate-12 scale-110' : ''}`} />
              </button>
              {showTopicFAB && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700/60 rounded-xl shadow-2xl shadow-black/60 py-1 min-w-[190px] overflow-hidden" data-testid="topics-fab-menu">
                  {authConnected && parentRoom && parentRoom.creators?.some(c => c.address === myAddress) && (
                    <>
                      <button onClick={() => { setShowTopicFAB(false); setShowAddTopicModal(true); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-add-topic">
                        <FiPlus size={16} style={{ color: 'var(--c-accent)' }} />
                        <span className="text-sm text-gray-200">Add Topic</span>
                      </button>
                      <div className="border-t border-gray-700/40 my-1" />
                    </>
                  )}
                  {authConnected && (
                    <button onClick={() => { setShowTopicFAB(false); navigate('/wallet'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-wallet-topics">
                      <FiCreditCard size={16} className="text-emerald-400" />
                      <span className="text-sm text-gray-200">Wallet</span>
                    </button>
                  )}
                  <button onClick={() => { setShowTopicFAB(false); navigate('/discover'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-discover-topics">
                    <FiCompass size={16} className="text-cyan-400" />
                    <span className="text-sm text-gray-200">Discover</span>
                  </button>
                  <button onClick={() => { setShowTopicFAB(false); navigate('/supflix'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-supflix-topics">
                    <FiFilm size={16} className="text-rose-400" />
                    <span className="text-sm text-gray-200">SUPflix</span>
                  </button>
                  <button onClick={() => { setShowTopicFAB(false); navigate('/jukebox'); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-jukebox-topics">
                    <FiMusic size={16} className="text-amber-400" />
                    <span className="text-sm text-gray-200">Jukebox</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Topic search bar */}
        {showTopicSearch && (
          <div className="px-3 py-2 border-b border-gray-800/40 flex-shrink-0">
            <input type="text" value={topicSearch} onChange={e => setTopicSearch(e.target.value)}
              placeholder="Search topics..." autoFocus data-testid="topics-search-input"
              className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600" />
          </div>
        )}

        {/* Add Topic Modal */}
        {showAddTopicModal && (
          <AddTopicModal
            parentAddress={selectedParent}
            parentName={parentRoom.name}
            network={network}
            tetherRoom={tetherRoom}
            onClose={() => setShowAddTopicModal(false)}
          />
        )}

        {/* Two-column body: avatar rail + topics */}
        <div className="flex-1 flex overflow-hidden">
          {/* Avatar rail — exact same sizing as normal chat rows */}
          <div className="flex-shrink-0 overflow-y-auto" style={{ width: '82px' }} data-testid="topics-avatar-sidebar">
            {items.map(item => {
              const isActive = item.type === 'room' && item.id === selectedParent;
              const roomImgUrl = item.type === 'room'
                ? (() => {
                    const parsed = parseMediaString(item.image, { mainnet: isMainnetNetwork(network) });
                    if (parsed?.url) return parsed.url;
                    if (item.imageUrl && !item.imageUrl.startsWith('blob:')) return item.imageUrl;
                    return null;
                  })()
                : null;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.type === 'room' && item.hasTopics) {
                      setSelectedParent(item.id);
                    } else if (item.type === 'dm') {
                      navigate(`/dm/${item.id}`);
                    } else {
                      navigate(`/room/${item.id}`);
                    }
                  }}
                  className={`w-full flex items-center pl-3 py-2.5 transition-colors relative ${isActive ? 'bg-gray-800/50' : 'hover:bg-gray-800/30'}`}
                  data-testid={`sidebar-avatar-${item.id.substring(0, 8)}`}
                >
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-9 rounded-r-full" style={{ backgroundColor: 'var(--c-accent, #8b5cf6)' }} />}
                  <div className="w-[58px] h-[58px] rounded-full overflow-hidden flex-shrink-0 relative">
                    {item.type === 'room' && roomImgUrl ? (
                      <img src={roomImgUrl} alt="" className="w-full h-full rounded-full object-cover bg-gray-800" />
                    ) : item.type === 'room' ? (
                      <div className="w-full h-full rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--c-accentMuted, rgba(139,92,246,0.15))' }}>
                        <FiHash size={26} style={{ color: 'var(--c-accent, #8b5cf6)' }} />
                      </div>
                    ) : (
                      <ProfileThumb name={item.name} image={item.image} size="lg" />
                    )}
                    {item.hasUnread && item.id !== selectedParent && (
                      <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-gray-950" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Topics panel */}
          <div className="flex-1 flex flex-col min-w-0" data-testid="topics-panel">
            <div className="flex-1 overflow-y-auto">
              {filteredTopicItems.map(topic => (
                <button
                  key={topic.id}
                  onClick={() => {
                    if (myAddress && topic.messageCount) {
                      markAsRead(myAddress, topic.id, topic.messageCount);
                      notifyUnreadChange();
                    }
                    clearGossipRoom(topic.id);
                    navigate(`/room/${topic.id}`);
                  }}
                  className="w-full flex items-center gap-2 pl-1 pr-3 py-2.5 hover:bg-gray-800/40 active:bg-gray-800/70 transition-colors text-left"
                  data-testid={`topic-${topic.id.substring(0, 8)}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-200">
                        {topic.isGeneral && <span className="text-xs px-1.5 py-0.5 rounded mr-1.5" style={{ backgroundColor: 'var(--c-accentMuted)', color: 'var(--c-accent)' }}>General</span>}
                        {topic.name}
                      </span>
                      <span className={`text-xs flex-shrink-0 ${topic.hasUnread ? 'text-emerald-400' : 'text-gray-600'}`}>
                        {formatTimestamp(topic.timestamp)}
                      </span>
                    </div>
                    {topic.description && (
                      <p className="truncate text-[13px] text-gray-400 mt-0.5">{topic.description}</p>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {topic.lastMessage ? (
                        <p className="truncate text-[13px] text-gray-500">{topic.lastMessage}</p>
                      ) : !topic.description ? (
                        <p className="truncate text-[13px] text-gray-600 italic">No messages yet</p>
                      ) : null}
                      {topic.hasUnread && (
                        <span className="min-w-[20px] h-5 rounded-full flex items-center justify-center text-[11px] font-bold px-1.5 bg-emerald-500 text-white flex-shrink-0" data-testid="topic-badge">
                          {topic.unreadCount > 999 ? `${Math.floor(topic.unreadCount / 1000)}k` : topic.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- DEFAULT LIST VIEW ---
  return (
    <div className="h-full flex flex-col" data-testid="chats-page">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          {authConnected && (
            <button onClick={() => navigate('/my-profile')} className="rounded-full hover:ring-2 hover:ring-gray-600 transition-all" data-testid="chats-avatar-btn">
              <ProfileThumb name={profileUrn || ''} image={profileImage} size="sm" />
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-gray-100">Cthulhu</span>
            <img src={CTHULHU_LOGO} alt="" className="h-5 w-5 opacity-60" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowSearch(!showSearch); if (showSearch) setSearchQuery(''); }}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            data-testid="chats-search-btn">
            {showSearch ? <FiX size={18} /> : <FiSearch size={18} />}
          </button>
          <div className="relative" ref={fabMenuRef}>
            <button onClick={() => setShowFABMenu(!showFABMenu)}
              className={`p-2 rounded-lg transition-all ${showFABMenu ? 'bg-gray-800' : 'hover:bg-gray-800'}`}
              style={{ color: 'var(--c-accent, #8b5cf6)' }}
              data-testid="chats-create-btn">
              <FiFeather size={18} className={`transition-transform ${showFABMenu ? 'rotate-12 scale-110' : ''}`} />
            </button>
            {showFABMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700/60 rounded-xl shadow-2xl shadow-black/60 py-1 min-w-[190px] overflow-hidden" data-testid="chats-fab-menu">
                {authConnected && (
                  <>
                    <button onClick={() => { setShowFABMenu(false); navigate('/create-tether'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-new-tether">
                      <FiHash size={16} style={{ color: 'var(--c-accent)' }} />
                      <span className="text-sm text-gray-200">Craft Chat</span>
                    </button>
                    <button onClick={() => { setShowFABMenu(false); navigate('/wallet'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-wallet">
                      <FiCreditCard size={16} className="text-emerald-400" />
                      <span className="text-sm text-gray-200">Wallet</span>
                    </button>
                    <div className="border-t border-gray-700/40 my-1" />
                  </>
                )}
                <button onClick={() => { setShowFABMenu(false); navigate('/discover'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-discover">
                  <FiCompass size={16} className="text-cyan-400" />
                  <span className="text-sm text-gray-200">Discover</span>
                </button>
                <button onClick={() => { setShowFABMenu(false); navigate('/supflix'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-supflix">
                  <FiFilm size={16} className="text-rose-400" />
                  <span className="text-sm text-gray-200">SUPflix</span>
                </button>
                <button onClick={() => { setShowFABMenu(false); navigate('/jukebox'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 transition-colors text-left" data-testid="fab-jukebox">
                  <FiMusic size={16} className="text-amber-400" />
                  <span className="text-sm text-gray-200">Jukebox</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-gray-800/40 flex-shrink-0">
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search chats..." autoFocus data-testid="chats-search-input"
            className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600" />
        </div>
      )}

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {/* Pinned: Main Feed */}
        {!searchQuery && (
          <TelegramRow
            avatar={<div className="w-full h-full rounded-2xl overflow-hidden flex items-center justify-center p-2" style={{ background: 'linear-gradient(145deg, #1a1a2e 0%, #0a0a14 100%)' }}><img src={CTHULHU_LOGO} alt="" className="w-full h-full object-contain" /></div>}
            name="Main Feed"
            preview="The decentralized social feed"
            pinned
            onClick={() => navigate('/feed')}
            testId="chat-main-feed"
          />
        )}
        {!searchQuery && (
          <TelegramRow
            avatar={<div className="w-full h-full rounded-2xl overflow-hidden flex items-center justify-center p-1.5" style={{ background: 'linear-gradient(145deg, #1a1a2e 0%, #0a0a14 100%)' }}><img src="/storefront-logo.png" alt="" className="w-full h-full object-contain" /></div>}
            name="Storefront"
            preview="Browse tokenized objects"
            pinned
            onClick={() => navigate('/objects')}
            testId="chat-storefront"
          />
        )}

        {!searchQuery && filtered.length > 0 && (
          <div className="mx-4 my-0.5"><div className="border-t border-gray-800/40" /></div>
        )}

        {/* Message Requests */}
        {!searchQuery && messageRequests.length > 0 && (
          <>
            <button
              onClick={() => setShowRequests(!showRequests)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/30 transition-colors"
              data-testid="message-requests-toggle"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-500/15">
                  <FiUser size={14} className="text-amber-400" />
                </div>
                <span className="text-sm font-medium text-gray-300">Message Requests</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="min-w-[20px] h-5 rounded-full flex items-center justify-center bg-gray-700 text-[11px] font-bold text-gray-300 px-1.5">
                  {messageRequests.length}
                </span>
                <FiSearch size={14} className={`text-gray-500 transition-transform ${showRequests ? 'rotate-90' : ''}`} />
              </div>
            </button>
            {showRequests && (
              <div className="bg-gray-900/50 border-y border-gray-800/30" data-testid="message-requests-list">
                {messageRequests.map(req => (
                  <div key={req.address} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors" data-testid={`request-${req.address.substring(0, 8)}`}>
                    <button onClick={() => navigate(`/profile/${req.address}`)} className="flex-shrink-0">
                      <ProfileThumb name={req.name} image={req.image} size="md" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => navigate(`/dm/${req.address}`)} className="text-sm font-medium text-gray-200 truncate block text-left hover:underline">
                        {req.name}
                      </button>
                      <p className="text-xs text-gray-500 truncate">
                        {req.messageCount} message{req.messageCount !== 1 ? 's' : ''} {req.lastDate ? `· ${formatTimestamp(req.lastDate)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {onAcceptRequest && (
                        <button
                          onClick={() => onAcceptRequest(req.profile || { address: req.address, urn: req.name, image: req.image })}
                          className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                          data-testid={`accept-request-${req.address.substring(0, 8)}`}
                        >
                          Accept
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/dm/${req.address}`)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-gray-700/50 text-gray-400 hover:bg-gray-700 transition-colors"
                        data-testid={`view-request-${req.address.substring(0, 8)}`}
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mx-4 my-0.5"><div className="border-t border-gray-800/40" /></div>
          </>
        )}

        {filtered.map(item => {
          const roomImgUrl = item.type === 'room'
            ? (() => {
                const parsed = parseMediaString(item.image, { mainnet: isMainnetNetwork(network) });
                if (parsed?.url) return parsed.url;
                if (item.imageUrl && !item.imageUrl.startsWith('blob:')) return item.imageUrl;
                return null;
              })()
            : null;
          return (
            <React.Fragment key={item.id}>
            <TelegramRow
              avatar={
                item.type === 'room' && roomImgUrl ? (
                  <img src={roomImgUrl} alt="" className="w-full h-full rounded-full object-cover bg-gray-800" />
                ) : item.type === 'room' ? (
                  <div className="w-full h-full rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--c-accentMuted, rgba(139,92,246,0.15))' }}>
                    <FiHash size={26} style={{ color: 'var(--c-accent, #8b5cf6)' }} />
                  </div>
                ) : (
                  <ProfileThumb name={item.name} image={item.image} size="lg" />
                )
              }
              name={item.name}
              preview={item.preview}
              timestamp={formatTimestamp(item.timestamp)}
              hasUnread={item.hasUnread}
              unreadCount={item.unreadCount || (item.hasUnread ? 1 : 0)}
              messageCount={0}
              pinned={item.isPinned}
              isEncrypted={item.isEncrypted}
              isVoicemail={item.isVoicemail}
              hasTopics={item.hasTopics}
              mediaType={item.mediaType}
              onClick={() => {
                // If room has topics, open topics panel instead of navigating
                if (item.type === 'room' && item.hasTopics) {
                  setSelectedParent(item.id);
                  return;
                }
                if (myAddress && item.messageCount) {
                  markAsRead(myAddress, item.id, item.messageCount);
                  notifyUnreadChange();
                }
                clearGossipRoom(item.id);

                // DM rows: tap goes to the content source (profile/post/object)
                if (item.type === 'dm') {
                  if (item.txid) {
                    // Navigate to the specific post/transaction
                    navigate(`/profile/${item.id}`);
                  } else {
                    // No recent activity — go to their profile
                    navigate(`/profile/${item.id}`);
                  }
                  return;
                }
                navigate(`/room/${item.id}`);
              }}
              onSwipeRight={item.type === 'dm' ? () => {
                if (myAddress && item.messageCount) {
                  markAsRead(myAddress, item.id, item.messageCount);
                  notifyUnreadChange();
                }
                clearGossipRoom(item.id);
                navigate(`/dm/${item.id}`);
              } : undefined}
              onLongPress={() => {
                if (myAddress && item.messageCount) {
                  markAsRead(myAddress, item.id, item.messageCount);
                  notifyUnreadChange();
                }
                clearGossipRoom(item.id);
              }}
              testId={`chat-${item.type}-${item.id.substring(0, 8)}`}
            />
            {/* Ink notifications: show new mints from this peer */}
            {item.inks && item.inks.length > 0 && (
              <div className="pl-[72px] pr-4 pb-2 -mt-1 space-y-1">
                {item.inks.map(ink => (
                  <button key={ink.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (clearInk) clearInk(ink.id);
                      navigate(`/object/${ink.objectAddress || (ink.cids && ink.cids[0]) || ''}`);
                    }}
                    className="flex items-center gap-2 w-full text-left group/ink rounded-md px-2 py-1 hover:bg-purple-500/10 transition-colors"
                    data-testid={`ink-notif-${(ink.cids && ink.cids[0])?.substring(0, 8)}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0 animate-pulse" />
                    <span className="text-[11px] text-purple-300 truncate flex-1 font-mono">
                      {ink.objectUrn || (ink.cids && ink.cids[0])?.substring(0, 16) + '...'}
                    </span>
                    <span className="text-[9px] text-gray-600 flex-shrink-0">
                      {ink.cids && ink.cids.length > 1 ? `${ink.cids.length} CIDs` : 'inked'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            </React.Fragment>
          );
        })}

        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--c-accentMuted, rgba(139,92,246,0.15))' }}>
              <FiMessageCircle size={28} style={{ color: 'var(--c-accent, #8b5cf6)' }} />
            </div>
            <p className="text-gray-400 font-medium">No tethers yet</p>
            <p className="text-xs text-gray-600 mt-1 text-center max-w-[220px]">
              Follow users or tether to chat rooms to see them here
            </p>
            <button onClick={() => navigate('/profiles')}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: 'var(--c-accentMuted)', color: 'var(--c-accent)' }}
              data-testid="chats-discover-btn">
              Discover Users
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Telegram-style chat list row.
 */
function TelegramRow({ avatar, name, preview, timestamp, hasUnread, unreadCount, messageCount, pinned, isEncrypted, isVoicemail, hasTopics, mediaType, onClick, onSwipeRight, onLongPress, testId }) {
  const badge = hasUnread ? (unreadCount || 1) : 0;
  const longPressTimer = useRef(null);
  const [showReadToast, setShowReadToast] = useState(false);
  const [showDmHint, setShowDmHint] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiped = useRef(false);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiped.current = false;
    longPressTimer.current = setTimeout(() => {
      if (onLongPress) {
        onLongPress();
        setShowReadToast(true);
        setTimeout(() => setShowReadToast(false), 1500);
      }
    }, 600);
  };
  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    // Swipe right detected (>60px horizontal, <30px vertical)
    if (dx > 60 && dy < 30 && !swiped.current && onSwipeRight) {
      swiped.current = true;
      clearTimeout(longPressTimer.current);
      onSwipeRight();
      setShowDmHint(true);
      setTimeout(() => setShowDmHint(false), 1200);
    }
    // Cancel long press on any significant movement
    if (Math.abs(dx) > 10 || dy > 10) clearTimeout(longPressTimer.current);
  };
  const handleTouchEnd = () => { clearTimeout(longPressTimer.current); };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); if (onLongPress) { onLongPress(); setShowReadToast(true); setTimeout(() => setShowReadToast(false), 1500); } }}
      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-800/40 active:bg-gray-800/70 transition-colors text-left relative overflow-hidden cursor-pointer"
      data-testid={testId}
    >
      {showReadToast && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg z-10 pointer-events-none">
          <span className="text-xs text-emerald-400 font-medium">Marked as read</span>
        </div>
      )}
      {showDmHint && (
        <div className="absolute inset-0 flex items-center justify-center bg-emerald-900/60 rounded-lg z-10 pointer-events-none">
          <FiMessageCircle size={16} className="text-emerald-400 mr-1.5" />
          <span className="text-xs text-emerald-400 font-medium">Opening DM...</span>
        </div>
      )}
      {/* Avatar — 58px */}
      <div className="w-[58px] h-[58px] rounded-full flex-shrink-0 overflow-hidden relative">
        {avatar}
        {isVoicemail && (
          <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-amber-600 flex items-center justify-center border-2 border-gray-900">
            <FiMic size={12} className="text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Top row: Name + Timestamp */}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate leading-tight flex-1 min-w-0" style={{ fontFamily: 'Roboto, sans-serif', fontWeight: 500, fontSize: '16px', lineHeight: 1.15, color: '#EDEDED' }}>
            {pinned && <FiMapPin size={13} className="inline mr-1 -mt-0.5 text-gray-500" />}
            {name}
          </span>
          <span className={`text-[13px] flex-shrink-0 whitespace-nowrap ${hasUnread ? 'text-emerald-400 font-medium' : 'text-gray-500'}`}>
            {timestamp || ''}
          </span>
        </div>

        {/* Bottom row: Preview + Badge */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="truncate flex-1 min-w-0" style={{
            fontFamily: 'Roboto, sans-serif',
            fontWeight: 400,
            fontSize: '15px',
            lineHeight: 1.25,
            color: isVoicemail ? undefined : isEncrypted ? undefined : '#A0A0A0',
          }}>
            <span className={isVoicemail ? 'text-amber-400' : isEncrypted ? 'text-emerald-400' : mediaType ? 'text-sky-400' : ''}>
              {isEncrypted && <FiLock size={12} className="inline mr-1 -mt-0.5" />}
              {isVoicemail && <FiMic size={12} className="inline mr-1 -mt-0.5 text-amber-400" />}
              {mediaType === 'photo' && <FiImage size={12} className="inline mr-1 -mt-0.5" />}
              {mediaType === 'video' && <FiFilm size={12} className="inline mr-1 -mt-0.5" />}
              {mediaType === 'audio' && <FiMusic size={12} className="inline mr-1 -mt-0.5" />}
              {mediaType === 'voice' && <FiMic size={12} className="inline mr-1 -mt-0.5" />}
              {mediaType === 'file' && <FiPaperclip size={12} className="inline mr-1 -mt-0.5" />}
              {mediaType === 'media' && <FiPaperclip size={12} className="inline mr-1 -mt-0.5" />}
              {preview}
            </span>
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onSwipeRight && (
              <button
                onClick={(e) => { e.stopPropagation(); onSwipeRight(); }}
                className="hidden sm:flex w-6 h-6 items-center justify-center rounded-full hover:bg-emerald-900/40 text-gray-600 hover:text-emerald-400 transition-colors"
                title="Open DM"
                data-testid="dm-shortcut-btn"
              >
                <FiMessageCircle size={13} />
              </button>
            )}
            {pinned && !badge && <FiMapPin size={12} className="text-gray-600" />}
            {hasTopics && !badge && (
              <FiChevronRight size={14} className="text-gray-600" />
            )}
            {badge > 0 && (
              <span className={`min-w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] font-bold px-2 ${
                hasUnread
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-700 text-gray-300'
              }`} data-testid="chat-badge">
                {badge > 999 ? `${Math.floor(badge / 1000)}k` : badge}
              </span>
            )}
            {hasTopics && badge > 0 && (
              <FiChevronRight size={14} className="text-gray-500" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Room avatar helper for the topics panel header */
function RoomAvatar({ room, network, size = 36 }) {
  const parsed = parseMediaString(room.image, { mainnet: isMainnetNetwork(network) });
  if (parsed?.url) return <img src={parsed.url} alt="" className="w-full h-full rounded-full object-cover bg-gray-800" />;
  if (room.imageUrl && !room.imageUrl.startsWith('blob:')) return <img src={room.imageUrl} alt="" className="w-full h-full rounded-full object-cover bg-gray-800" />;
  return (
    <div className="w-full h-full rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--c-accentMuted, rgba(139,92,246,0.15))' }}>
      <FiHash size={size * 0.5} style={{ color: 'var(--c-accent, #8b5cf6)' }} />
    </div>
  );
}

/** Lightweight modal for creating a topic under a parent tether */
function AddTopicModal({ parentAddress, parentName, network, tetherRoom, onClose }) {
  const { user: authUser, wif: authWif, isConnected } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleCreate = async () => {
    if (!name.trim() || !isConnected || !authWif) return;
    setSending(true);
    setError(null);
    try {
      const [{ buildObjectTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);
      const urn = 'topic-' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const objectData = {
        urn,
        name: name.trim(),
        description: description.trim() || undefined,
        license: 'cthulhu:tether:topic',
        uri: parentAddress,
        quantity: 1,
      };
      const { addresses, objectAddress, taxInsertIndex } = buildObjectTransaction(authWif, objectData, network || 'btc-testnet');
      const result = await buildAndBroadcast(authWif, addresses, network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        addTransaction(authUser?.address, {
          txid: result.txid, type: 'OBJ', network: network || 'btc-testnet',
          addresses, label: `Topic: ${name.trim()}`, object_address: objectAddress,
        });
        // Register topic on backend so all users can discover it
        fetch(`${API}/rooms/register-topic`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parent_address: parentAddress, topic_address: objectAddress,
            network: network || 'btc-testnet', name: name.trim(),
            description: description.trim() || null,
            creator_address: authUser?.address,
          }),
        }).catch(() => {});
        if (tetherRoom) {
          tetherRoom({
            objectAddress, name: name.trim(), description: description.trim(),
            license: 'cthulhu:tether:topic', uri: parentAddress,
            tetheredAt: new Date().toISOString(),
          });
        }
        setSuccess(objectAddress);
      }
    } catch (err) {
      setError(err.message || 'Failed to create topic');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose} data-testid="add-topic-modal-overlay">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-5" onClick={e => e.stopPropagation()} data-testid="add-topic-modal">
        {success ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)' }}>
              <FiHash size={24} className="text-emerald-400" />
            </div>
            <h4 className="text-base font-bold text-gray-100 mb-1">Topic Created</h4>
            <p className="text-xs text-gray-500 mb-4">Broadcasting to the network...</p>
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: 'var(--c-accent)' }} data-testid="add-topic-done">Done</button>
          </div>
        ) : (
          <>
            <h4 className="text-base font-bold text-gray-100 mb-1">Add Topic</h4>
            <p className="text-xs text-gray-500 mb-4">New topic under <span className="text-gray-300 font-medium">{parentName}</span></p>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Topic title" autoFocus maxLength={60}
              className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 mb-3"
              data-testid="add-topic-title"
            />
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Description (optional)" rows={2} maxLength={200}
              className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-none mb-3"
              data-testid="add-topic-desc"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors" data-testid="add-topic-cancel">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || sending || !isConnected || !authWif}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--c-accent)' }}
                data-testid="add-topic-submit"
              >
                {sending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function truncatePreview(content) {
  if (!content) return 'No messages yet';
  const text = content.trim();
  // Strip <<...>> attachment tags
  const stripped = text.replace(/<<[^>]*>>/g, '').trim();
  const attachments = [...text.matchAll(/<<([^>]+)>>/g)].map(x => x[1]);

  if (stripped && stripped.length > 0) {
    return stripped.length > 55 ? stripped.slice(0, 52) + '...' : stripped;
  }

  // No text, check attachments
  if (attachments.length > 0) {
    const att = attachments[0];
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att)) return 'Photo';
    if (/\.(mp4|webm|mov|avi|mkv)$/i.test(att)) return 'Video';
    if (/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(att) || /voice/i.test(att)) return 'Voice message';
    if (att.startsWith('IPFS:')) return 'File';
    return 'Media';
  }

  // Raw content (no <<>> tags)
  if (text.startsWith('IPFS:') || text.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return 'Photo';
  if (text.match(/\.(mp4|webm|mov)$/i)) return 'Video';
  if (text.match(/\.(mp3|wav|ogg|webm)$/i) || text.includes('voice')) return 'Voice message';
  return text.length > 55 ? text.slice(0, 52) + '...' : text;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${hh}:${min}`;
}

function formatTimestamp(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${min}`;
  if (diff < 86400000 && d.getDate() === now.getDate()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) return `Yesterday ${time}`;
  if (diff < 604800000) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return formatDateShort(dateStr);
}
