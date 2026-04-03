import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { FiUser, FiSlash, FiSearch, FiLock } from 'react-icons/fi';
import { usePendingMint } from '@/hooks/usePendingMint';
import { usePendingTxMonitor } from '@/hooks/usePendingTxMonitor';
import { InkingLogModal } from '@/components/PendingTxModal';
import FeedPage from '@/pages/FeedPage';
import SearchPage from '@/pages/SearchPage';
import DiscoverPage from '@/pages/DiscoverPage';
import SUPflixPage from '@/pages/SUPflixPage';
import JukeboxPage from '@/pages/JukeboxPage';
import ProfileDetailPage from '@/pages/ProfileDetailPage';
import ObjectsPage from '@/pages/ObjectsPage';
import UserObjectsPage from '@/pages/UserObjectsPage';
import SingleObjectPage from '@/pages/SingleObjectPage';
import CollectionPage from '@/pages/CollectionPage';
import AuthPage from '@/pages/AuthPage';
import ProfileSetupPage from '@/pages/ProfileSetupPage';
import WalkieTalkiePage from '@/pages/WalkieTalkiePage';
import VaultPage from '@/pages/VaultPage';
import DMPage from '@/pages/DMPage';
import ObjectChatPage from '@/pages/ObjectChatPage';
import PaywallGate from '@/pages/PaywallGate';
import WikiPage from '@/pages/WikiPage';
import LandingPage from '@/pages/LandingPage';
import DownloadPage from '@/pages/DownloadPage';
import AdminDashboard from '@/pages/AdminDashboard';
import ChatsPage from '@/pages/ChatsPage';
import MyProfilePage from '@/pages/MyProfilePage';
import { getBurnedAddresses, addBurnedAddress, cleanBurnBlocklist } from '@/utils/burnBlocklist';
import CreateTetherPage from '@/components/CreateTetherPage';
import SettingsModal from '@/components/SettingsModal';
import { BottomNav } from '@/components/BottomNav';
import { ProfileThumb } from '@/components/ProfileThumb';
import { WalletModal } from '@/components/WalletModal';
import { ObjectCreateModal } from '@/components/ObjectCreateModal';
import { UnlockWalletPrompt } from '@/components/UnlockWalletPrompt';
import { DesktopHeader } from '@/components/DesktopHeader';
import IncomingCallAlert from '@/components/IncomingCallAlert';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { WalletProvider, useWallet } from '@/hooks/useWallet';
import { useFollows } from '@/hooks/useFollows';
import { useDMNotifications } from '@/hooks/useDMNotifications';
import { useClaimedProfile } from '@/hooks/useClaimedProfile';
import { useWalletNotifications } from '@/hooks/useWalletNotifications';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useWalkieMonitor } from '@/hooks/useWalkieMonitor';
import { useBlockList } from '@/hooks/useBlockList';
import { useMeshRelayInit } from '@/hooks/useMeshRelay';
import { setOnInkNotify } from '@/hooks/useMeshRelay';
import { useIpfsStatus } from '@/hooks/useIpfsStatus';
import { useInkNotifications } from '@/hooks/useInkNotifications';
import { useTheme, ThemeProvider } from '@/hooks/useTheme';
import { UploadQueueProvider } from '@/contexts/UploadQueueContext';
import { MiniPlayerProvider } from '@/contexts/MiniPlayerContext';
import { getTotalRoomUnread, getServerUnread, startUnreadPolling, stopUnreadPolling, registerRoomForTracking } from '@/utils/unreadTracker';
import { handleGossipNotify, getGossipUnreadTotal, clearGossipRoom, fetchOfflineHints, onNotifChange } from '@/utils/meshNotifications';
import { playNotificationSound } from '@/utils/notificationSound';
import { getGlobalMeshClient, getGlobalMeshNode } from '@/utils/meshRelay';
// SEC backup is now manual via Settings — no auto-restore on login
import UploadQueueBar from '@/components/UploadQueueBar';
import MiniPlayer from '@/components/MiniPlayer';
import { CthulhuLogo } from '@/components/CthulhuLogo';
import '@/App.css';
import { Toaster } from '@/components/ui/sonner';

const BLOCKCHAINS = [
  {
    id: 'btc-mainnet',
    name: 'Bitcoin',
    label: 'BTC Mainnet',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg'
  },
  {
    id: 'btc-testnet',
    name: 'Bitcoin Testnet',
    label: 'BTC Testnet v3',
    logo: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/svg/color/btc.svg',
    filter: 'hue-rotate(90deg) saturate(1.5)'
  },
];

// Profiles Page (Search Landing)
const ProfilesPage = ({ network, myAddress, follows = [], blockList }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [showAllConnections, setShowAllConnections] = useState(false);
  const navigate = useNavigate();
  const { user, isConnected } = useAuth();

  // Read cached profile image
  const profileImgKey = user?.urn ? `cthulhu_profile_img_${user.urn}_${network}` : null;
  const cachedUrn = typeof window !== 'undefined' ? localStorage.getItem(`cthulhu_profile_urn_${network}`) : null;
  const profileImage = profileImgKey ? localStorage.getItem(profileImgKey) : null;
  const displayUrn = cachedUrn || user?.urn;

  // Protect against Emergent badge script fetch interception
  useEffect(() => {
    // Suppress postMessage errors from Emergent script
    const handler = (event) => {
      if (event.message && (event.message.includes('postMessage') || event.message.includes('could not be cloned'))) {
        event.preventDefault();
        return true;
      }
    };
    window.addEventListener('error', handler);
    // Also suppress unhandled promise rejections from the script
    const rejHandler = (event) => {
      const msg = event.reason?.message || String(event.reason || '');
      if (msg.includes('postMessage') || msg.includes('could not be cloned')) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', rejHandler);
    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', rejHandler);
    };
  }, []);

  // Remove Emergent badge (backup — CSS handles most of it)
  useEffect(() => {
    const id = setInterval(() => {
      const el = document.getElementById('emergent-badge');
      if (el) el.style.setProperty('opacity', '0', 'important');
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Fetch suggested users
  useEffect(() => {
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    import('@/utils/dedupFetch').then(({ dedupGet }) =>
      dedupGet(`${API}/known-users/${network}?limit=20`)
    ).then(data => {
        const users = data?.users || data || [];
        const followAddrs = new Set(follows.map(f => f.address));
        setSuggestedUsers(users.filter(u => !followAddrs.has(u.address) && u.address !== myAddress).slice(0, 8));
      })
      .catch(() => {});
  }, [network, follows, myAddress]);

  // Instant search on keystroke
  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    if (searchQuery.length > 20) {
      navigate(`/profile/${searchQuery}`);
    } else {
      setSearchLoading(true);
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      fetch(`${API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, network }),
      }).then(r => r.ok ? r.json() : {}).then(data => {
        setSearchResults(data.profiles || []);
      }).catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }
  };

  // Mutual connections: users we follow who also have us in their tethers
  // For now show all followed users as connections
  const connections = follows || [];

  return (
    <div className="h-full overflow-y-auto pb-20" data-testid="contacts-page">
      {/* Header with profile image */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
        {isConnected && (
          <button onClick={() => navigate('/my-profile')} className="rounded-full hover:ring-2 hover:ring-gray-600 transition-all" data-testid="contacts-avatar-btn">
            <ProfileThumb name={displayUrn || '?'} image={profileImage} size="sm" />
          </button>
        )}
        <h1 className="text-lg font-bold text-gray-100">Contacts</h1>
      </div>

      <div className="p-4 space-y-5">
        {/* Search */}
        <form onSubmit={handleSearch} className="relative" data-testid="contacts-search-form">
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            placeholder="Search by username or address..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800/60 text-gray-100 rounded-lg border border-gray-700/50 focus:border-purple-500/60 focus:outline-none text-sm"
            data-testid="contacts-search-input"
          />
        </form>

        {/* Search results */}
        {searchLoading && (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />
          </div>
        )}
        {searchResults && !searchLoading && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider px-1">
              {searchResults.length > 0 ? `${searchResults.length} Results` : 'No users found'}
            </p>
            {searchResults.map((p, i) => {
              // Prefer URN as display name; only use display_name if it's human-readable (not an address)
              const isAddr = p.display_name && /^[a-km-zA-HJ-NP-Z1-9]{25,}$/.test(p.display_name);
              const name = (!p.display_name || isAddr) ? p.urn : p.display_name;
              return (
              <button
                key={i}
                onClick={() => navigate(`/profile/${p.address}`)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors text-left group"
                data-testid={`search-result-${i}`}
              >
                <ProfileThumb name={name || p.urn} image={p.image} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{name}</p>
                  <p className="text-xs text-purple-400/70 truncate">@{p.urn}</p>
                </div>
                {blockList && p.address !== myAddress && (
                  <button
                    onClick={(e) => { e.stopPropagation(); blockList.blockUser(p.address, p.urn || ''); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-red-500/20 text-gray-600 hover:text-red-400 transition-all"
                    title="Block user"
                    data-testid={`block-search-${i}`}
                  >
                    <FiSlash size={14} />
                  </button>
                )}
              </button>
              );
            })}
          </div>
        )}

        {/* Connections (followed users) — collapsed to 3 by default */}
        {!searchResults && connections.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider px-1 mb-2">
              Connections ({connections.length})
            </p>
            <div className="space-y-0.5">
              {(showAllConnections ? connections : connections.slice(0, 3)).map(friend => (
                <button
                  key={friend.address}
                  onClick={() => navigate(`/profile/${friend.address}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors text-left"
                  data-testid={`contact-${friend.address?.slice(0, 8)}`}
                >
                  <ProfileThumb name={friend.display_name || friend.urn || friend.address?.slice(0, 8)} image={friend.image} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-100 truncate">
                      {friend.display_name || friend.urn || friend.address?.slice(0, 12)}
                    </p>
                    {friend.urn && <p className="text-xs text-purple-400/70 truncate">@{friend.urn}</p>}
                  </div>
                </button>
              ))}
            </div>
            {connections.length > 3 && (
              <button
                onClick={() => setShowAllConnections(prev => !prev)}
                className="w-full mt-2 py-2 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors rounded-lg hover:bg-gray-800/40"
                data-testid="connections-show-more-btn"
              >
                {showAllConnections ? 'Show less' : `Show all ${connections.length} connections`}
              </button>
            )}
          </div>
        )}

        {/* Suggested users */}
        {!searchResults && suggestedUsers.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider px-1 mb-2">
              Discover
            </p>
            <div className="space-y-0.5">
              {suggestedUsers.map(u => (
                <button
                  key={u.address}
                  onClick={() => navigate(`/profile/${u.address}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors text-left"
                  data-testid={`suggested-${u.address?.slice(0, 8)}`}
                >
                  <ProfileThumb name={u.display_name || u.urn || u.address?.slice(0, 8)} image={u.image} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-100 truncate">
                      {u.display_name || u.urn || u.address?.slice(0, 12)}
                    </p>
                    {u.urn && <p className="text-xs text-gray-500 truncate">@{u.urn}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when not searching and no connections */}
        {!searchResults && connections.length === 0 && suggestedUsers.length === 0 && (
          <div className="text-center py-12">
            <FiUser size={36} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">No connections yet</p>
            <p className="text-xs text-gray-600 mt-1">Search for users to connect</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Layout with Sidebar
const Layout = ({ children, network, setNetwork, follows, toggleFollow, claimed, claimProfile, unclaimProfile, pendingMint }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettingsPage = location.pathname === '/settings';
  const isChatsPage = location.pathname === '/chats';
  const isCreateTetherPage = location.pathname === '/create-tether';
  const isCreateObjectPage = location.pathname === '/create-object';
  const isProfileEditPage = location.pathname === '/profile/edit';
  const isWalletPage = location.pathname === '/wallet';
  const isObjectsPage = location.pathname === '/objects';
  const isProfilesPage = location.pathname === '/profiles';
  const dmNotifications = useDMNotifications(network);
  const blockList = useBlockList(network);
  // P2P Mesh — runs at app level so all IPFS fetches can use it
  useMeshRelayInit(network);
  // Track desktop breakpoint to avoid double-mounting ChatsPage
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  const [selectedBlockchain, setSelectedBlockchain] = useState(BLOCKCHAINS[1]);
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(null);

  const [authProfileImage, setAuthProfileImage] = useState(null);
  const [authProfileUrn, setAuthProfileUrn] = useState(null);
  const [mintedOnNetwork, setMintedOnNetwork] = useState(false);
  const [showPendingTxModal, setShowPendingTxModal] = useState(false);
  const [friendMessages, setFriendMessages] = useState({});
  const [tetheredRooms, setTetheredRooms] = useState([]);
  const [tethersLoading, setTethersLoading] = useState(false);
  const [personContextMenu, setPersonContextMenu] = useState(null);
  const [roomUnreadTotal, setRoomUnreadTotal] = useState(0);
  const [gossipUnread, setGossipUnread] = useState(0);
  const { wallet, balance, isConnected: walletConnected, disconnectWallet } = useWallet();
  const { user: authUser, isConnected: authConnected, logout, wif: authWif, unlockWallet, needsUnlock } = useAuth();

  // Auto-show unlock prompt when user has valid JWT but WIF session expired
  useEffect(() => {
    if (needsUnlock && authConnected && !authWif && !showUnlockPrompt) {
      setShowUnlockPrompt('startup');
    }
  }, [needsUnlock, authConnected, authWif, showUnlockPrompt]);

  // ─── Network Isolation: Reset all in-memory state on network switch ───
  const prevNetworkRef = useRef(network);
  useEffect(() => {
    if (prevNetworkRef.current === network) return;
    prevNetworkRef.current = network;
    // Wipe in-memory state to prevent cross-network data bleed
    setTetheredRooms([]);
    setFriendMessages({});
    setGossipUnread(0);
    setRoomUnreadTotal(0);
    setAuthProfileImage(null);
    setAuthProfileUrn(null);
    setMintedOnNetwork(false);
  }, [network]);

  const walkie = useWalkieMonitor(network, authUser?.address);
  const { pendingTxs, count: pendingTxCount } = usePendingTxMonitor();
  const ipfsStatus = useIpfsStatus();
  const { theme } = useTheme();
  const myAddress = authUser?.address || wallet?.address || '';

  // Ink notifications — track new mints from mesh peers (must be after myAddress)
  const { inksBySender, addInk, clearInk, clearInksFrom } = useInkNotifications(network, myAddress);
  useEffect(() => {
    setOnInkNotify(addInk);
    return () => setOnInkNotify(null);
  }, [addInk]);

  const [pinnedFriends, setPinnedFriends] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`cthulhu_pinned_${myAddress}_${network}`)) || []; } catch { return []; }
  });
  // Reload pinned friends when user or network changes — restore from backend if local is empty
  useEffect(() => {
    try { setPinnedFriends(JSON.parse(localStorage.getItem(`cthulhu_pinned_${myAddress}_${network}`)) || []); } catch { setPinnedFriends([]); }
    if (!myAddress) return;
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    import('@/utils/dedupFetch').then(({ dedupGet }) =>
      dedupGet(`${API}/user-state/${myAddress}?network=${network}`, 10000)
    ).then(data => {
        const remotePinned = data?.pinned_friends || [];
        if (remotePinned.length > 0) {
          const local = JSON.parse(localStorage.getItem(`cthulhu_pinned_${myAddress}_${network}`) || '[]');
          if (local.length === 0) {
            localStorage.setItem(`cthulhu_pinned_${myAddress}_${network}`, JSON.stringify(remotePinned));
            setPinnedFriends(remotePinned);
          }
        }
      })
      .catch(() => {});
  }, [myAddress, network]);

  // Fetch tethered rooms from API (owned + created tether objects) — deduped
  const fetchTetheredRooms = useCallback(async () => {
    if (!myAddress) { setTetheredRooms([]); return; }
    setTethersLoading(true);
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    try {
      const { dedupGet } = await import('@/utils/dedupFetch');
      const [ownedRes, createdRes] = await Promise.all([
        dedupGet(`${API}/objects/owned/${myAddress}?network=${network}&skip=0&limit=50`).then(d => d || { objects: [] }),
        dedupGet(`${API}/objects/created/${myAddress}?network=${network}&skip=0&limit=50`).then(d => d || { objects: [] }),
      ]);
      const allObjs = [...(ownedRes.objects || []), ...(createdRes.objects || [])];
      const tethers = allObjs.filter(o => (o.license || '').toLowerCase().startsWith('cthulhu:tether'));
      const burned = getBurnedAddresses(myAddress, network);
      // Deduplicate by object_address, skip burned
      const seen = new Set();
      const deduped = [];
      for (const t of tethers) {
        const addr = t.object_address || t.creators?.[0]?.address;
        if (addr && !seen.has(addr) && !burned.has(addr)) {
          seen.add(addr);
          deduped.push({
            objectAddress: addr,
            name: t.name || t.Name || 'Room',
            image: t.image || t.Image,
            description: t.description,
            license: t.license,
            uri: t.uri || t.URI || undefined,
            total_supply: t.total_supply || t.maximum || 1,
            owner_count: t.owner_count || 0,
            owners: t.owners || [],
            listings: t.listings || [],
            is_listed: t.is_listed || false,
            creators: t.creators || [],
            created_date: t.created_date,
          });
        }
      }
      // Auto-clean blocklist: remove addresses the API no longer returns
      if (burned.size > 0) {
        const apiAddrs = new Set(tethers.map(t => t.object_address || t.creators?.[0]?.address));
        cleanBurnBlocklist(myAddress, network, apiAddrs);
      }
      // Merge with localStorage pending rooms (mempool handoff — not yet indexed)
      try {
        const pending = JSON.parse(localStorage.getItem(`cthulhu_rooms_${myAddress}_${network}`)) || [];
        for (const p of pending) {
          if (p.objectAddress && !seen.has(p.objectAddress) && !burned.has(p.objectAddress)) {
            seen.add(p.objectAddress);
            deduped.push({ ...p, pending: true });
          }
        }
      } catch {}
      setTetheredRooms(deduped);
    } catch (err) {
      console.error('Failed to fetch tethered rooms:', err);
      try { setTetheredRooms(JSON.parse(localStorage.getItem(`cthulhu_rooms_${myAddress}_${network}`)) || []); } catch { setTetheredRooms([]); }
    } finally {
      setTethersLoading(false);
    }
  }, [myAddress, network]);

  useEffect(() => { fetchTetheredRooms(); }, [fetchTetheredRooms]);

  // Sync tethered rooms to backend after fetch (for persistence across cache clears)
  useEffect(() => {
    if (!myAddress || tetheredRooms.length === 0) return;
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    const serializable = tetheredRooms.map(r => ({
      objectAddress: r.objectAddress, name: r.name, image: r.image,
      description: r.description, license: r.license, uri: r.uri,
      total_supply: r.total_supply, created_date: r.created_date,
    }));
    fetch(`${API}/user-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: myAddress, network, tethered_rooms: serializable }),
    }).catch(() => {});
  }, [tetheredRooms, myAddress, network]);

  // Listen for room unread changes and update badge total
  useEffect(() => {
    const update = () => setRoomUnreadTotal(getTotalRoomUnread(myAddress) + getServerUnread());
    update(); // initial read
    window.addEventListener('cthulhu-unread-change', update);
    return () => window.removeEventListener('cthulhu-unread-change', update);
  }, [myAddress]);

  // Poll server for unread messages (catches messages received while offline)
  useEffect(() => {
    if (myAddress) {
      startUnreadPolling(myAddress, 30000);
    }
    return () => stopUnreadPolling();
  }, [myAddress]);

  // Register tethered rooms for server-side unread tracking
  useEffect(() => {
    if (!myAddress || !tetheredRooms.length) return;
    tetheredRooms.forEach(r => {
      if (r.objectAddress) registerRoomForTracking(myAddress, r.objectAddress);
    });
  }, [myAddress, tetheredRooms]);

  // ─── Gossip Notification Listener ───
  // Listen for mesh gossip notifications at app level (catches notifs when NOT in the room)
  useEffect(() => {
    if (!myAddress) return;
    const gossipHandler = (msg) => {
      const isNew = handleGossipNotify(msg, myAddress);
      if (isNew) playNotificationSound();
    };

    // Wire up listeners on mesh client/node
    const meshClient = getGlobalMeshClient();
    const meshNode = getGlobalMeshNode();
    if (meshClient) meshClient.setOnGossipNotify(gossipHandler);
    if (meshNode) meshNode.setOnGossipNotify(gossipHandler);

    // Subscribe to gossip state changes for badge updates
    const unsub = onNotifChange(() => {
      setGossipUnread(getGossipUnreadTotal());
    });

    // Fetch offline hints on mount (catch up on missed messages)
    fetchOfflineHints(myAddress, network);

    return unsub;
  }, [myAddress, network]);

  // Re-wire gossip listeners when mesh connections change
  useEffect(() => {
    if (!myAddress) return;
    const gossipHandler = (msg) => {
      const isNew = handleGossipNotify(msg, myAddress);
      if (isNew) playNotificationSound();
    };
    const interval = setInterval(() => {
      const meshClient = getGlobalMeshClient();
      const meshNode = getGlobalMeshNode();
      // Only set handler if not already set (avoid duplicate listeners)
      if (meshClient && !meshClient._onGossipNotify) meshClient.setOnGossipNotify(gossipHandler);
      if (meshNode && !meshNode._onGossipNotify) meshNode.setOnGossipNotify(gossipHandler);
    }, 10000);
    return () => clearInterval(interval);
  }, [myAddress]);

  // Wallet-guarded action: show unlock prompt if wif is missing, otherwise proceed
  const walletAction = (action) => {
    if (authWif) {
      if (action === 'create') {
        // Navigate to full-page route instead of overlay to avoid double-mount
        navigate('/create-object');
      }
    } else {
      setShowUnlockPrompt(action);
    }
  };

  // Wallet notifications for incoming transactions
  useWalletNotifications(wallet?.address, network, walletConnected);
  useKeyboardShortcuts();

  // ─── State Backup: Restore on WIF unlock, safety net on tab close ───
  // Initialize notification sync on login
  const stateRestoredRef = useRef(false);
  useEffect(() => {
    if (!authWif || !myAddress || stateRestoredRef.current) return;
    stateRestoredRef.current = true;
    // Initialize notification sync — restores vault timestamps to IndexedDB
    import('@/utils/notificationSync').then(m => m.initNotificationSync(myAddress)).catch(() => {});
  }, [authWif, myAddress, network]);

  // Profile image: load from localStorage cache instantly, then refresh from network
  const profileImageCacheKey = authUser ? `cthulhu_profile_img_${authUser.urn}_${network}` : null;

  useEffect(() => {
    if (!profileImageCacheKey) return;
    const cached = localStorage.getItem(profileImageCacheKey);
    if (cached) setAuthProfileImage(cached);
  }, [profileImageCacheKey]);

  const resolveAuthProfile = useCallback(async () => {
    if (!authUser?.address) {
      setAuthProfileImage(null);
      setAuthProfileUrn(null);
      setMintedOnNetwork(false);
      return;
    }
    try {
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      const { dedupGet } = await import('@/utils/dedupFetch');
      const data = await dedupGet(`${API}/profile/${authUser.address}?network=${network}`, 15000);
      if (data) {
        if (data?.image) {
          setAuthProfileImage(data.image);
          if (profileImageCacheKey) localStorage.setItem(profileImageCacheKey, data.image);
        } else {
          setAuthProfileImage(null);
          if (profileImageCacheKey) localStorage.removeItem(profileImageCacheKey);
        }
        // Detect real minted profile: urn must exist and differ from the raw address
        // Also check display_name as fallback (p2fk.io sometimes returns URN=address even for minted profiles)
        const realUrn = (data?.URN || data?.urn || '');
        const displayName = (data?.display_name || data?.DisplayName || '');
        const isMinted = (!!realUrn && realUrn !== data?.address && realUrn !== authUser.address)
          || (!!displayName && displayName !== data?.address && displayName !== authUser.address);
        const effectiveUrn = (realUrn && realUrn !== data?.address && realUrn !== authUser.address)
          ? realUrn
          : (displayName && displayName !== data?.address ? displayName : null);
        setAuthProfileUrn(isMinted ? effectiveUrn : null);
        setMintedOnNetwork(isMinted);
        // Cache URN for useMyProfile hook
        localStorage.setItem(`cthulhu_profile_urn_${network}`, isMinted ? realUrn : '');
        window.dispatchEvent(new Event('profile-updated'));
      } else {
        // No profile found for this address on this network
        setAuthProfileImage(null);
        setAuthProfileUrn(null);
        setMintedOnNetwork(false);
        if (profileImageCacheKey) localStorage.removeItem(profileImageCacheKey);
      }
    } catch {
      setAuthProfileImage(null);
      setAuthProfileUrn(null);
      setMintedOnNetwork(false);
    }
  }, [authUser?.address, network, profileImageCacheKey]);

  useEffect(() => {
    // Clear stale profile state immediately, then re-resolve
    setMintedOnNetwork(false);
    setAuthProfileUrn(null);
    setAuthProfileImage(null);
    if (authConnected) resolveAuthProfile();
  }, [authConnected, resolveAuthProfile]);

  // Fetch last messages for each friend from the feed
  useEffect(() => {
    if (!follows.length) return;
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    import('@/utils/dedupFetch').then(({ dedupGet }) =>
      dedupGet(`${API}/feed/${network}?limit=50`)
    ).then(data => {
        if (!data?.feed) return;
        const msgs = {};
        const friendAddrs = new Set(follows.map(f => f.address));
        for (const m of data.feed) {
          const addr = m.from_address;
          if (friendAddrs.has(addr) && !msgs[addr]) {
            const rawContent = m.content || '';
            // Extract attachment references
            const attachments = [...rawContent.matchAll(/<<([^>]+)>>/g)].map(x => x[1]);
            // Strip <<...>> attachments for text preview
            const textOnly = rawContent.replace(/<<[^>]*>>/g, '').replace(/<<-\w+>>/g, '').trim();

            let preview = textOnly;
            let mediaType = null;
            let mediaRef = null;

            if (!textOnly && attachments.length > 0) {
              const att = attachments[0];
              mediaRef = att;
              if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(att) || att.match(/IPFS:.*\.(jpg|jpeg|png|gif|webp)/i)) {
                preview = 'Photo'; mediaType = 'photo';
              } else if (/\.(mp4|webm|mov|avi|mkv)$/i.test(att) || att.match(/IPFS:.*\.(mp4|webm|mov)/i)) {
                preview = 'Video'; mediaType = 'video';
              } else if (/\.(mp3|wav|ogg|flac|aac|m4a|wma)$/i.test(att) || att.match(/IPFS:.*\.(mp3|wav|ogg)/i)) {
                preview = 'Audio'; mediaType = 'audio';
              } else if (/voice\.webm|voice\./i.test(att)) {
                preview = 'Voice message'; mediaType = 'voice';
              } else if (att.startsWith('IPFS:')) {
                preview = 'File'; mediaType = 'file';
              } else {
                preview = 'Media'; mediaType = 'media';
              }
            }
            // Check for object actions encoded in content
            if (!preview && !attachments.length) {
              preview = '';
            }
            msgs[addr] = {
              content: preview || textOnly || '',
              created_at: m.created_at,
              txid: m.transaction_id,
              mediaType,
              mediaRef,
            };
          }
        }
        setFriendMessages(msgs);
      })
      .catch(() => {});
  }, [follows, network]);

  const togglePinFriend = useCallback((address) => {
    setPinnedFriends(prev => {
      const next = prev.includes(address)
        ? prev.filter(a => a !== address)
        : prev.length < 3 ? [...prev, address] : prev;
      localStorage.setItem(`cthulhu_pinned_${myAddress}_${network}`, JSON.stringify(next));
      // Sync to backend
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      fetch(`${API}/user-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: myAddress, network, pinned_friends: next }),
      }).catch(() => {});
      return next;
    });
  }, [myAddress, network]);

  const tetherRoom = useCallback((room) => {
    // Save to localStorage for mempool handoff (before API indexes it)
    try {
      const key = `cthulhu_rooms_${myAddress}_${network}`;
      const pending = JSON.parse(localStorage.getItem(key)) || [];
      if (!pending.some(r => r.objectAddress === room.objectAddress)) {
        pending.push({ ...room, tetheredAt: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(pending));
      }
    } catch {}
    // Also add to state immediately
    setTetheredRooms(prev => {
      if (prev.some(r => r.objectAddress === room.objectAddress)) return prev;
      return [...prev, { ...room, pending: true, tetheredAt: new Date().toISOString() }];
    });
  }, [myAddress, network]);

  const untetherRoom = useCallback((objectAddress) => {
    // Remove from localStorage pending
    try {
      const key = `cthulhu_rooms_${myAddress}_${network}`;
      const pending = JSON.parse(localStorage.getItem(key)) || [];
      localStorage.setItem(key, JSON.stringify(pending.filter(r => r.objectAddress !== objectAddress)));
    } catch {}
    setTetheredRooms(prev => prev.filter(r => r.objectAddress !== objectAddress));
  }, [myAddress, network]);

  // Sort friends: pinned first, then by last message recency — filter out blocked
  const sortedFriends = [...follows].filter(f => !blockList.isBlocked(f.address)).sort((a, b) => {
    const aPin = pinnedFriends.includes(a.address);
    const bPin = pinnedFriends.includes(b.address);
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    const aTime = friendMessages[a.address]?.created_at || '';
    const bTime = friendMessages[b.address]?.created_at || '';
    return bTime.localeCompare(aTime);
  });

  // Compute DM unread count only for followed users (exclude message requests)
  const followedAddrs = new Set(follows.map(f => f.address));
  const followedDmUnread = Object.entries(dmNotifications?.unreadEncrypted || {}).reduce((sum, [addr, n]) => {
    return followedAddrs.has(addr) ? sum + n : sum;
  }, 0) + Object.entries(dmNotifications?.unreadDM || {}).reduce((sum, [addr, n]) => {
    return followedAddrs.has(addr) ? sum + n : sum;
  }, 0);

  // Listen for tethers-changed events — refetch from API, handle burns
  useEffect(() => {
    const handleTethersChanged = (e) => {
      // If this is a burn event, add the address to the blocklist first
      if (e.detail?.burned) {
        addBurnedAddress(myAddress, network, e.detail.burned);
        // Immediately remove from local state
        setTetheredRooms(prev => prev.filter(t => t.objectAddress !== e.detail.burned));
      }
      fetchTetheredRooms();
    };
    window.addEventListener('tethers-changed', handleTethersChanged);
    return () => window.removeEventListener('tethers-changed', handleTethersChanged);
  }, [fetchTetheredRooms, myAddress, network]);



  // Global event listener for wallet unlock requests (e.g. from SUPphone page)
  useEffect(() => {
    const unlockHandler = () => {
      if (!authWif) setShowUnlockPrompt('walkie');
    };
    const settingsHandler = () => navigate('/settings');
    const walletHandler = () => navigate('/wallet');
    window.addEventListener('wallet-action-requested', unlockHandler);
    window.addEventListener('open-settings', settingsHandler);
    window.addEventListener('open-wallet', walletHandler);
    return () => {
      window.removeEventListener('wallet-action-requested', unlockHandler);
      window.removeEventListener('open-settings', settingsHandler);
      window.removeEventListener('open-wallet', walletHandler);
    };
  }, [authWif, navigate]);

  // Close person context menu on outside click
  useEffect(() => {
    if (!personContextMenu) return;
    const close = () => setPersonContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); };
  }, [personContextMenu]);


  return (
    <div className="min-h-screen-safe text-gray-100" style={{ backgroundColor: theme.colors.bg, color: theme.colors.text }}>

      {/* Settings — now a full page at /settings */}

      {/* Unlock Wallet Prompt */}
      {showUnlockPrompt && (
        <UnlockWalletPrompt
          onUnlock={async (password) => {
            await unlockWallet(password);
            const action = showUnlockPrompt;
            setShowUnlockPrompt(null);
            // Navigate to full-page route instead of overlay (prevents desktop/mobile clash)
            if (action === 'create') navigate('/create-object');
          }}
          onClose={() => setShowUnlockPrompt(null)}
        />
      )}

      {/* Inking Log Modal */}
      {showPendingTxModal && (
        <InkingLogModal pendingTxs={pendingTxs} myAddress={myAddress} onClose={() => setShowPendingTxModal(false)} />
      )}

      {/* Main Layout */}
      <div className="flex flex-col" style={{ height: '100dvh' }}>
        {/* Inner content wrapper: sidebar + main column */}
        <div className="flex flex-1 min-h-0">

        {/* Desktop Sidebar — renders the full ChatsPage as a persistent panel */}
        <aside
          className="hidden lg:flex lg:flex-col lg:relative lg:w-80 border-r overflow-hidden flex-shrink-0"
          style={{ backgroundColor: theme.colors.card, borderColor: theme.colors.border }}
          data-testid="sidebar"
        >
          <ChatsPage
            network={network}
            sortedFriends={sortedFriends}
            friendMessages={friendMessages}
            tetheredRooms={tetheredRooms}
            dmNotifications={dmNotifications}
            authConnected={authConnected}
            pinnedFriends={pinnedFriends}
            tetherRoom={tetherRoom}
            profileImage={authProfileImage}
            profileUrn={authProfileUrn}
            onAcceptRequest={toggleFollow}
            gossipUnread={gossipUnread}
            inksBySender={inksBySender}
            clearInk={clearInk}
            clearInksFrom={clearInksFrom}
          />
        </aside>

        {/* Main column: desktop header + content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Desktop Header — always visible on desktop */}
          <DesktopHeader
            network={network}
            onCreateObject={() => walletAction('create')}
            onOpenWallet={() => {
              // Navigate to full-page wallet route to avoid overlay/route clash
              navigate('/wallet');
            }}
            mintedOnNetwork={mintedOnNetwork}
            walkieActive={walkie.active}
            walkieChannel={walkie.channel}
            pendingTxCount={pendingTxCount}
            onShowInkingLog={() => setShowPendingTxModal(true)}
            authConnected={authConnected}
          />

        {/* Main Content */}
        <main className="flex-1 overflow-hidden min-h-0" style={{ backgroundColor: theme.colors.bg }}>
          {isSettingsPage ? (
            <SettingsModal fullPage onClose={() => navigate('/feed')} profileImage={authProfileImage} network={network} mintedOnNetwork={mintedOnNetwork} authProfileUrn={authProfileUrn} blockList={blockList} claimProfile={claimProfile} myAddress={myAddress} onNetworkChange={(n) => { setNetwork(n); setSelectedBlockchain(BLOCKCHAINS.find(b => b.id === n) || BLOCKCHAINS[1]); navigate('/feed'); }} onRefreshProfile={resolveAuthProfile} />
          ) : isChatsPage ? (
            <>
              {/* Mobile only: render ChatsPage — desktop already has it in sidebar */}
              {!isDesktop && (
                <div className="h-full">
                  <ChatsPage network={network} sortedFriends={sortedFriends} friendMessages={friendMessages} tetheredRooms={tetheredRooms} dmNotifications={dmNotifications} authConnected={authConnected} pinnedFriends={pinnedFriends} tetherRoom={tetherRoom} profileImage={authProfileImage} profileUrn={authProfileUrn} onAcceptRequest={toggleFollow} gossipUnread={gossipUnread} inksBySender={inksBySender} clearInk={clearInk} clearInksFrom={clearInksFrom} />
                </div>
              )}
              {/* Desktop: sidebar already shows chats — show placeholder */}
              {isDesktop && (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center space-y-3">
                    <CthulhuLogo className="w-16 h-16 mx-auto opacity-20" />
                    <p className="text-sm text-gray-600">Select a conversation from the sidebar</p>
                  </div>
                </div>
              )}
            </>
          ) : isCreateTetherPage ? (
            <CreateTetherPage network={network} tetherRoom={tetherRoom} />
          ) : isCreateObjectPage ? (
            <ObjectCreateModal fullPage onClose={() => navigate(-1)} network={network} tetherRoom={tetherRoom} />
          ) : isProfileEditPage ? (
            <ProfileSetupPage />
          ) : isWalletPage ? (
            <WalletModal isOpen={true} fullPage onClose={() => navigate(-1)} network={network} />
          ) : children}
        </main>
        </div>{/* End main column */}
        </div>{/* End inner content wrapper */}

        {/* Global Incoming Call Alert (shown when NOT on walkie page) */}
        {walkie.incomingCall && !location.pathname.startsWith('/walkie') && (
          <IncomingCallAlert
            caller={{
              address: walkie.incomingCall.from,
              urn: walkie.incomingCall.urn,
              image: walkie.incomingCall.image,
            }}
            callType={walkie.incomingCall.video ? 'video' : 'audio'}
            onAccept={() => {
              navigate('/walkie', { state: { autoAcceptCall: walkie.incomingCall } });
              walkie.dismissCall();
            }}
            onDecline={() => { walkie.dismissCall(); }}
          />
        )}

        {/* Bottom Navigation */}
        <MiniPlayer />
        <UploadQueueBar />
        <BottomNav network={network} dmBadge={followedDmUnread + roomUnreadTotal + gossipUnread} walkieActive={walkie.active} incomingCall={walkie.incomingCall} walkieSender={walkie.walkieSender} onAnswerCall={walkie.dismissCall} />
      </div>

      {/* Person context menu — long-press/right-click on tethered people */}
      {personContextMenu && (
        <div
          className="fixed z-[100] bg-gray-950 border border-gray-700/50 rounded-xl shadow-2xl shadow-black/60 py-1.5 min-w-[170px] backdrop-blur-sm"
          style={{ left: Math.min(personContextMenu.x, window.innerWidth - 200), top: personContextMenu.y }}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          data-testid="person-context-menu"
        >
          <button
            onClick={() => { navigate(`/dm/${personContextMenu.address}`); setPersonContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10"
            data-testid="person-ctx-pm"
          >
            <FiLock size={14} /> Encrypted PM
          </button>
          <button
            onClick={() => { navigate(`/profile/${personContextMenu.address}`); setPersonContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800"
            data-testid="person-ctx-profile"
          >
            <FiUser size={14} /> View Profile
          </button>
          <div className="border-t border-gray-700/50 my-1" />
          <button
            onClick={() => { blockList.blockUser(personContextMenu.address, personContextMenu.urn || ''); setPersonContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10"
            data-testid="person-ctx-block"
          >
            <FiSlash size={14} /> Block User
          </button>
        </div>
      )}
    </div>
  );
};

function App() {
  const [network, setNetwork] = useState(() => {
    return localStorage.getItem('cthulhu_network') || 'btc-testnet';
  });
  const handleSetNetwork = (n) => {
    // Phase 1: Nuclear cache wipe — clear all sessionStorage API cache
    // This prevents stale testnet data bleeding into mainnet and vice versa.
    // WIF storage is safe — it lives in localStorage, not sessionStorage.
    sessionStorage.clear();
    // Also clear in-flight dedup cache to prevent stale cross-network data
    import('@/utils/dedupFetch').then(({ clearDedupCache }) => clearDedupCache()).catch(() => {});
    localStorage.setItem('cthulhu_network', n);
    setNetwork(n);
  };

  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <UploadQueueProvider>
            <MiniPlayerProvider>
              <AppRoutes network={network} setNetwork={handleSetNetwork} />
            </MiniPlayerProvider>
          </UploadQueueProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

// Inner component that has access to Auth context
function AppRoutes({ network, setNetwork }) {
  const { user: authUser } = useAuth();
  const { claimed, claimProfile, unclaimProfile } = useClaimedProfile(network);
  const { pendingMint, addPendingMint } = usePendingMint();
  const ipfsStatus = useIpfsStatus();

  // Animated favicon: pulse green dot when IPFS is online
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"][sizes="32x32"]') || document.querySelector('link[rel="icon"]');
    if (!link) return;
    const originalHref = link.getAttribute('href');

    if (!ipfsStatus.online) {
      // Restore default favicon
      if (link.dataset.animated) {
        link.href = originalHref.startsWith('/') ? originalHref : link.dataset.originalHref || '/favicon-32x32.png';
        delete link.dataset.animated;
      }
      return;
    }

    // Store original href
    if (!link.dataset.originalHref) link.dataset.originalHref = link.href;

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/cthulhu-logo.svg';

    let frame = 0;
    let intervalId;

    img.onload = () => {
      const draw = () => {
        ctx.clearRect(0, 0, 32, 32);
        ctx.drawImage(img, 0, 0, 32, 32);
        // Green pulsing dot in bottom-right
        const pulse = 0.5 + 0.5 * Math.sin(frame * 0.15);
        ctx.beginPath();
        ctx.arc(27, 27, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(52, 211, 153, ${0.6 + 0.4 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(6, 78, 59, ${0.8})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        link.href = canvas.toDataURL('image/png');
        link.dataset.animated = 'true';
        frame++;
      };
      draw();
      intervalId = setInterval(draw, 200);
    };

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (link.dataset.originalHref) {
        link.href = link.dataset.originalHref;
        delete link.dataset.animated;
      }
    };
  }, [ipfsStatus.online]);

  const handleWalletConnect = (profileData) => {
    if (profileData?.address) {
      // Merge with existing claimed data — preserve non-null local values
      if (claimed) {
        const merged = { ...claimed };
        for (const [key, val] of Object.entries(profileData)) {
          if (val !== null && val !== undefined && val !== '') {
            merged[key] = val;
          }
        }
        claimProfile(merged);
      } else {
        claimProfile(profileData);
      }
    }
  };

  const handleWalletDisconnect = () => {
    unclaimProfile();
  };

  return (
    <WalletProvider network={network} onConnect={handleWalletConnect} onDisconnect={handleWalletDisconnect}>
      <Toaster theme="dark" position="top-right" richColors closeButton />
      <AppLayout network={network} setNetwork={setNetwork} claimed={claimed} claimProfile={claimProfile} unclaimProfile={unclaimProfile} pendingMint={pendingMint} />
    </WalletProvider>
  );
}


// Auth guard — stable component defined outside AppLayout to prevent remounting
function RequireAuth({ children }) {
  const navigate = useNavigate();
  const { isConnected } = useAuth();
  useEffect(() => {
    if (!isConnected) navigate('/auth', { replace: true });
  }, [isConnected, navigate]);
  return isConnected ? children : null;
}

const IS_STANDALONE_APP = process.env.REACT_APP_STANDALONE === 'true' || !process.env.REACT_APP_BACKEND_URL;

// Innermost component that has access to both Auth + Wallet
function AppLayout({ network, setNetwork, claimed, claimProfile, unclaimProfile, pendingMint }) {
  const { user: authUser, isConnected: authConnected } = useAuth();
  const { wallet } = useWallet();
  const myAddress = authUser?.address || wallet?.address || '';
  const { follows, isFollowing, toggleFollow } = useFollows(network, myAddress);
  const blockList = useBlockList(network);
  const [paywallPassed, setPaywallPassed] = useState(false);
  const [paywallLoading, setPaywallLoading] = useState(true);

  useEffect(() => {
    if (IS_STANDALONE_APP || !authConnected || !authUser?.urn) {
      setPaywallPassed(true);
      setPaywallLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/paywall/status/${authUser.urn}`);
        const data = await res.json();
        setPaywallPassed(data.paid || data.status === 'paywall_disabled');
      } catch {
        setPaywallPassed(true);
      }
      setPaywallLoading(false);
    })();
  }, [authConnected, authUser?.urn]);

  // Standalone: "/" goes straight to auth (or feed if logged in), no admin
  const homeElement = IS_STANDALONE_APP
    ? (authConnected ? <Navigate to="/feed" replace /> : <Navigate to="/auth" replace />)
    : <LandingPage />;

  return (
    <Routes>
      <Route path="/" element={homeElement} />
      {!IS_STANDALONE_APP && <Route path="/admin" element={<AdminDashboard />} />}
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/setup" element={<ProfileSetupPage />} />
      <Route path="*" element={
        authConnected && !paywallLoading && !paywallPassed ? (
          <PaywallGate onAccessGranted={() => setPaywallPassed(true)} />
        ) : (
        <Layout network={network} setNetwork={setNetwork} follows={follows} toggleFollow={toggleFollow} claimed={claimed} claimProfile={claimProfile} unclaimProfile={unclaimProfile} pendingMint={pendingMint}>
          <Routes>
            {/* Public routes — browsable without login */}
            <Route path="/feed" element={<FeedPage network={network} follows={follows} />} />
            <Route path="/objects" element={<ObjectsPage network={network} />} />
            <Route path="/object/addr/:address" element={<SingleObjectPage network={network} lookupByAddress />} />
            <Route path="/object/:txid" element={<SingleObjectPage network={network} />} />
            <Route path="/collection/:urn" element={<CollectionPage network={network} />} />
            <Route path="/collection-by-address/:address" element={<CollectionPage network={network} byAddress />} />
            <Route path="/profiles" element={<ProfilesPage network={network} myAddress={myAddress} follows={follows} blockList={blockList} />} />
            <Route path="/profile/:address/objects" element={<UserObjectsPage network={network} myAddress={myAddress} />} />
            <Route path="/profile/:address" element={
              <ProfileDetailPage network={network} isFollowing={isFollowing} toggleFollow={toggleFollow} myAddress={myAddress} blockUser={blockList.blockUser} isBlocked={blockList.isBlocked} />
            } />
            <Route path="/search" element={<SearchPage network={network} follows={follows} toggleFollow={toggleFollow} myAddress={myAddress} />} />
            <Route path="/discover" element={<DiscoverPage network={network} />} />
            <Route path="/supflix" element={<SUPflixPage network={network} />} />
            <Route path="/jukebox" element={<JukeboxPage />} />
            <Route path="/wiki" element={<WikiPage />} />
            {/* Protected routes — require login */}
            <Route path="/my-profile" element={<RequireAuth><MyProfilePage network={network} /></RequireAuth>} />
            <Route path="/profile/edit" element={<RequireAuth><ProfileSetupPage /></RequireAuth>} />
            <Route path="/walkie" element={<RequireAuth><WalkieTalkiePage network={network} /></RequireAuth>} />
            <Route path="/vault" element={<RequireAuth><VaultPage network={network} /></RequireAuth>} />
            <Route path="/dm/:address" element={<RequireAuth><DMPage network={network} /></RequireAuth>} />
            <Route path="/room/:address" element={<RequireAuth><ObjectChatPage network={network} /></RequireAuth>} />
            <Route path="/settings" element={null} />
            <Route path="/chats" element={null} />
            <Route path="/create-tether" element={null} />
            <Route path="/create-object" element={null} />
            <Route path="/wallet" element={null} />
          </Routes>
        </Layout>
        )
      } />
    </Routes>
  );
}

export default App;