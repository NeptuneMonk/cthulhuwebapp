import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FiArrowLeft, FiBox, FiUser, FiGrid, FiLayers, FiList, FiMessageSquare, FiUsers, FiTrash2, FiX } from 'react-icons/fi';
import { ObjectCard } from '@/components/ObjectCard';
import { CachedImage } from '@/components/CachedImage';
import { BurnTetherModal } from '@/components/BurnTetherModal';
import { BatchBurnModal } from '@/components/BatchBurnModal';
import { useTheme } from '@/hooks/useTheme';
import { useMyProfile } from '@/hooks/useMyProfile';
import { ProfileThumb } from '@/components/ProfileThumb';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { cachedFetch, cacheInvalidatePrefix } from '@/utils/apiCache';
import { getBurnedAddresses } from '@/utils/burnBlocklist';
import { getOptimisticByAddress, removeOptimisticItem } from '@/utils/optimisticCache';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PAGE_SIZE = 12;

function isTether(obj) {
  const lic = (obj.license || obj.License || '').toLowerCase();
  return lic.startsWith('cthulhu:tether') && lic !== 'cthulhu:tether:topic';
}

function isSubTopic(obj) {
  return (obj.license || obj.License || '').toLowerCase() === 'cthulhu:tether:topic';
}

export default function UserObjectsPage({ network, myAddress }) {
  const { address } = useParams();
  const navigate = useNavigate();
  const { wallpaperStyle } = useTheme();
  const { image: myImage, urn: myUrn } = useMyProfile(network);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolvedAddr, setResolvedAddr] = useState(null);
  const [activeView, setActiveView] = useState('created');

  const [ownedCount, setOwnedCount] = useState(0);
  const [createdCount, setCreatedCount] = useState(0);

  const mediaOpts = { mainnet: isMainnetNetwork(network) };

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/profile/${address}`, { params: { network } })
      .then(res => { setProfile(res.data); setResolvedAddr(res.data?.address || address); })
      .catch(() => setResolvedAddr(address))
      .finally(() => setLoading(false));
  }, [address, network]);

  useEffect(() => {
    if (!resolvedAddr) return;
    cachedFetch('counts', `${resolvedAddr}_${network}`, async () => {
      const res = await axios.get(`${API}/objects/counts/${resolvedAddr}`, { params: { network } });
      return res.data;
    }).then(data => { setOwnedCount(data.owned || 0); setCreatedCount(data.created || 0); }).catch(() => {});
  }, [resolvedAddr, network]);

  const getImageUrl = (ref) => {
    const parsed = parseMediaString(ref, mediaOpts);
    return parsed?.url || null;
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" /></div>;
  }

  return (
    <div className="h-full overflow-y-auto" style={wallpaperStyle} data-testid="user-objects-page">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800/60 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="objects-back-btn">
          <FiArrowLeft size={20} />
        </button>
        {myImage && (
          <ProfileThumb name={myUrn || '?'} image={myImage} size="sm" />
        )}
        <span className="text-sm font-medium text-gray-300 truncate">
          {profile?.display_name || profile?.urn || 'Objects'}
        </span>
        <span className="text-xs text-gray-600">Objects</span>
      </div>

      {/* Navigation Buttons — profile-page style */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-lg mx-auto px-6 py-5">
          <div className="flex items-center justify-center gap-5">
            <NavBtn icon={FiUser} label={`Created`} count={createdCount} active={activeView === 'created'} onClick={() => setActiveView('created')} testId="nav-created" />
            <NavBtn icon={FiGrid} label={`Owned`} count={ownedCount} active={activeView === 'owned'} onClick={() => setActiveView('owned')} testId="nav-owned" />
            <NavBtn icon={FiLayers} label="Collections" active={activeView === 'collection'} onClick={() => setActiveView('collection')} testId="nav-collection" />
            <NavBtn icon={FiList} label="History" active={activeView === 'history'} onClick={() => setActiveView('history')} testId="nav-history" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="max-w-4xl mx-auto">
          {activeView === 'created' && <ObjectListView key="created" filter="created" resolvedAddr={resolvedAddr} network={network} getImageUrl={getImageUrl} mediaOpts={mediaOpts} navigate={navigate} myAddress={myAddress} />}
          {activeView === 'owned' && <ObjectListView key="owned" filter="owned" resolvedAddr={resolvedAddr} network={network} getImageUrl={getImageUrl} mediaOpts={mediaOpts} navigate={navigate} myAddress={myAddress} />}
          {activeView === 'collection' && <CollectionView resolvedAddr={resolvedAddr} network={network} mediaOpts={mediaOpts} navigate={navigate} />}
          {activeView === 'history' && <HistoryView resolvedAddr={resolvedAddr} network={network} getImageUrl={getImageUrl} navigate={navigate} />}
        </div>
      </div>
    </div>
  );
}


/* ── Nav Button (matches profile page style) ── */
function NavBtn({ icon: Icon, label, count, active, onClick, testId }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 min-w-[52px]" data-testid={testId}>
      <div className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-purple-600' : 'hover:bg-gray-800'}`}
        style={!active ? { backgroundColor: 'rgba(75, 85, 99, 0.3)' } : {}}>
        <Icon size={18} className={active ? 'text-white' : 'text-gray-400'} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white px-1 leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </div>
      <span className={`text-[11px] ${active ? 'text-purple-400 font-medium' : 'text-gray-500'}`}>{label}</span>
    </button>
  );
}


/* ── Tethers Section (vertical, with seat logic) ── */
function TethersSection({ tethers, getImageUrl, navigate, onBurnTether }) {
  if (!tethers.length) return null;
  return (
    <div className="mb-6" data-testid="tethers-section">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Venues &amp; Tethers</p>
      <div className="space-y-2">
        {tethers.map(t => {
          const imgUrl = getImageUrl(t.image || t.Image);
          const objAddr = t.object_address || t.creators?.[0]?.address;
          const supply = t.total_supply || t.maximum || 1;
          const listedCount = (t.listings || []).length;
          const isPublic = supply <= 1;
          const desc = t.description || '';

          return (
            <div
              key={t.transaction_id || t.TransactionId || objAddr}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800/40 hover:bg-gray-800/70 transition-colors group"
            >
              <button
                onClick={() => navigate(`/room/${objAddr}`)}
                className="flex items-center gap-3 flex-1 min-w-0"
                data-testid={`tether-obj-${objAddr}`}
              >
                <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-gray-700/50 group-hover:border-purple-500/60 transition-colors bg-gray-800 flex-shrink-0 flex items-center justify-center">
                  {imgUrl ? (
                    <CachedImage src={imgUrl} alt={t.name || t.Name} className="w-full h-full object-cover" />
                  ) : (
                    <FiMessageSquare size={18} className="text-gray-500" />
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">{t.name || t.Name || 'Room'}</p>
                  {isPublic ? (
                    <p className="text-[10px] text-gray-500 truncate">
                      Public Room{desc ? ': ' + desc.slice(0, 60) : ''}
                    </p>
                  ) : (
                    <p className="text-[10px] text-gray-500 flex items-center gap-1.5">
                      <FiUsers size={9} />
                      {listedCount > 0
                        ? <span className="text-green-400">{listedCount} seat{listedCount !== 1 ? 's' : ''} available</span>
                        : <span>Gated</span>
                      }
                    </p>
                  )}
                </div>
              </button>
              {onBurnTether && (
                <button
                  onClick={(e) => { e.stopPropagation(); onBurnTether(t); }}
                  className="p-2 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                  title="Burn tether"
                  data-testid={`burn-tether-${objAddr}`}
                >
                  <FiTrash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ── Created / Owned Object List ── */
function ObjectListView({ filter, resolvedAddr, network, getImageUrl, navigate, myAddress }) {
  const [objects, setObjects] = useState([]);
  const [tethers, setTethers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const skipRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [burnTarget, setBurnTarget] = useState(null);
  const [optimisticObjs, setOptimisticObjs] = useState([]);
  const [showBatchBurn, setShowBatchBurn] = useState(false);
  const isOwnProfile = myAddress && myAddress === resolvedAddr;

  // Load optimistic objects for this address (only show on created view for own profile)
  useEffect(() => {
    if (filter !== 'created' || !resolvedAddr) { setOptimisticObjs([]); return; }
    getOptimisticByAddress(resolvedAddr).then(items => {
      const objs = items
        .filter(i => i.type === 'OBJ' && i.network === network)
        .map(i => ({
          _optimistic: true,
          _status: i.status,
          _txid: i.txid,
          name: i.data?.name || i.data?.urn || 'Pending Object',
          Name: i.data?.name || i.data?.urn || 'Pending Object',
          image: i.data?.image || '',
          description: i.data?.description || '',
          object_address: i.objectAddress,
          creators: [{ address: resolvedAddr }],
          total_supply: i.data?.supply || 1,
          transaction_id: i.txid,
        }));
      setOptimisticObjs(objs);
    }).catch(() => setOptimisticObjs([]));
  }, [filter, resolvedAddr, network]);

  const fetchData = useCallback(async (skip, isReset = false) => {
    if (!resolvedAddr) return;
    if (loading && !isReset) return;
    setLoading(true);
    try {
      const endpoint = filter === 'owned'
        ? `${API}/objects/owned/${resolvedAddr}`
        : `${API}/objects/created/${resolvedAddr}`;
      const cacheId = `${filter}_${resolvedAddr}_${network}_${skip}`;
      const data = await cachedFetch('objects', cacheId, async () => {
        const res = await axios.get(endpoint, { params: { network, skip, limit: PAGE_SIZE } });
        return res.data;
      });
      const all = data.objects || [];
      const burned = myAddress && myAddress === resolvedAddr ? getBurnedAddresses(myAddress, network) : new Set();
      const regular = all.filter(o => !isTether(o) && !isSubTopic(o));
      const tetherItems = all.filter(o => isTether(o) && !burned.has(o.object_address || o.creators?.[0]?.address));
      setObjects(prev => isReset ? regular : [...prev, ...regular]);
      setTethers(prev => isReset ? tetherItems : [...prev, ...tetherItems]);
      setHasMore(data.has_more);
      setTotal(data.total || 0);
      skipRef.current = skip + PAGE_SIZE;
    } catch { setHasMore(false); }
    finally { setLoading(false); }
  }, [resolvedAddr, network, filter, loading, myAddress]);

  useEffect(() => {
    setObjects([]); setTethers([]); skipRef.current = 0; setHasMore(true);
    fetchData(0, true);
  }, [resolvedAddr, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleForceRefresh = useCallback(async () => {
    if (!resolvedAddr || refreshing) return;
    setRefreshing(true);
    try {
      cacheInvalidatePrefix('objects');
      setObjects([]); setTethers([]); skipRef.current = 0;
      const endpoint = filter === 'owned' ? `${API}/objects/owned/${resolvedAddr}` : `${API}/objects/created/${resolvedAddr}`;
      const res = await axios.get(endpoint, { params: { network, skip: 0, limit: PAGE_SIZE, force: true } });
      const all = res.data.objects || [];
      const burned = myAddress && myAddress === resolvedAddr ? getBurnedAddresses(myAddress, network) : new Set();
      setObjects(all.filter(o => !isTether(o) && !isSubTopic(o)));
      setTethers(all.filter(o => isTether(o) && !burned.has(o.object_address || o.creators?.[0]?.address)));
      setHasMore(res.data.has_more);
      setTotal(res.data.total || 0);
      skipRef.current = PAGE_SIZE;
    } catch {} finally { setRefreshing(false); }
  }, [resolvedAddr, network, filter, refreshing]);

  return (
    <div>
      {refreshing && <div className="flex items-center gap-2 text-xs text-teal-400 animate-pulse mb-3"><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-teal-400" /> Refreshing...</div>}

      {/* Batch Burn button — only on owned view for own profile */}
      {filter === 'owned' && isOwnProfile && objects.length > 0 && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowBatchBurn(true)}
            className="flex items-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 hover:border-red-500/40 text-red-400 rounded-lg transition-colors text-sm font-medium"
            data-testid="batch-burn-btn"
          >
            <FiTrash2 size={14} /> Batch Burn
          </button>
        </div>
      )}

      <TethersSection tethers={tethers} getImageUrl={getImageUrl} navigate={navigate} onBurnTether={(t) => setBurnTarget({
        objectAddress: t.object_address || t.creators?.[0]?.address,
        name: t.name || t.Name || 'Room',
      })} />

      {objects.length === 0 && optimisticObjs.length === 0 && !loading ? (
        <div className="text-center py-12">
          <FiBox size={32} className="mx-auto text-gray-700 mb-3" />
          <p className="text-lg text-gray-400">No {filter} objects</p>
          <button onClick={handleForceRefresh} className="mt-3 text-xs text-purple-400 hover:text-purple-300">Force refresh</button>
        </div>
      ) : (
        <>
          {/* Optimistic (pending) objects */}
          {optimisticObjs.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Pending Indexing</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {optimisticObjs.map((obj) => (
                  <div key={obj._txid} className="relative group/pending" data-testid={`optimistic-obj-${obj._txid}`}>
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        obj._status === 'mempool' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-blue-500/20 text-blue-400'
                      }`} data-testid="optimistic-badge">
                        {obj._status === 'mempool' ? 'Broadcasting...' : 'Confirming...'}
                      </span>
                      <button
                        onClick={async (e) => { e.stopPropagation(); await removeOptimisticItem(obj._txid); setOptimisticObjs(prev => prev.filter(o => o._txid !== obj._txid)); }}
                        className="w-5 h-5 rounded-full bg-gray-900/80 border border-gray-700/60 flex items-center justify-center text-gray-400 hover:text-red-400 hover:border-red-500/50 transition-colors sm:opacity-0 sm:group-hover/pending:opacity-100"
                        title="Dismiss pending item"
                        data-testid={`optimistic-dismiss-${obj._txid}`}
                      >
                        <FiX size={10} />
                      </button>
                    </div>
                    <ObjectCard object={obj} network={network} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {objects.map((obj, idx) => (
              <ObjectCard key={`${obj.TransactionId || obj.transaction_id || obj.object_address || idx}`} object={obj} network={network} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-6 text-center">
              <button onClick={() => fetchData(skipRef.current)} disabled={loading}
                className="px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium" data-testid="objects-load-more">
                {loading ? 'Loading...' : `Load More (${objects.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}
      {loading && objects.length === 0 && (
        <div className="text-center py-12 text-gray-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2" /> Loading objects...</div>
      )}

      {burnTarget && (
        <BurnTetherModal
          tether={burnTarget}
          network={network}
          onClose={() => setBurnTarget(null)}
          onBurned={(addr) => {
            setTethers(prev => prev.filter(t => (t.object_address || t.creators?.[0]?.address) !== addr));
            setBurnTarget(null);
          }}
        />
      )}

      {showBatchBurn && (
        <BatchBurnModal
          ownedObjects={objects}
          network={network}
          onClose={() => setShowBatchBurn(false)}
          onBurned={(addrs) => {
            setObjects(prev => prev.filter(o => !addrs.includes(o.object_address || o.creators?.[0]?.address)));
            setShowBatchBurn(false);
          }}
        />
      )}
    </div>
  );
}


/* ── Collections View ── */
function CollectionView({ resolvedAddr, network, mediaOpts, navigate }) {
  const [collections, setCollections] = useState([]);
  const [unacknowledged, setUnacknowledged] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!resolvedAddr) return;
    setLoading(true);
    axios.get(`${API}/collections/by-creator/${resolvedAddr}`, { params: { network } })
      .then(res => {
        setCollections(res.data.collections || []);
        setUnacknowledged(res.data.unacknowledged || []);
      })
      .catch(() => { setCollections([]); setUnacknowledged([]); })
      .finally(() => setLoading(false));
  }, [resolvedAddr, network]);

  if (loading) return <div className="text-center py-12 text-gray-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2" /> Loading collections...</div>;
  if (collections.length === 0 && unacknowledged.length === 0) return <div className="text-center py-12"><FiBox size={32} className="mx-auto text-gray-700 mb-3" /><p className="text-lg text-gray-400">No collections</p></div>;

  const renderCard = (col, idx, greyed) => {
    const imgParsed = parseMediaString(col.image, mediaOpts);
    const isProfile = col.type === 'profile';
    const subtitle = isProfile ? col.bio : col.description;
    return (
      <div key={col.urn || idx} onClick={() => {
          if (isProfile) navigate(`/collection/${encodeURIComponent(col.urn)}`);
          else navigate(`/collection-by-address/${col.address}?network=${network}`);
        }}
        className={`group bg-gray-900 border rounded-xl overflow-hidden transition-all cursor-pointer ${greyed ? 'border-gray-800/50 opacity-50 hover:opacity-70' : 'border-gray-800 hover:border-purple-500/60 hover:shadow-lg hover:shadow-purple-900/10'}`}
        data-testid={`collection-card-${col.urn}`}>
        <div className="aspect-video bg-gradient-to-br from-purple-900/30 to-blue-900/30 flex items-center justify-center overflow-hidden relative">
          {imgParsed?.url ? <CachedImage src={imgParsed.url} alt={col.urn} className={`w-full h-full object-cover group-hover:scale-105 transition-transform ${greyed ? 'grayscale' : ''}`} /> : <FiBox size={32} className="text-gray-600" />}
          <span className={`absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${isProfile ? 'bg-blue-500/20 text-blue-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {isProfile ? 'Profile' : 'Object'}
          </span>
        </div>
        <div className="p-4">
          <h3 className="text-base font-bold text-gray-100 mb-1 truncate">{col.urn}</h3>
          {subtitle && <p className="text-xs text-gray-500 line-clamp-2 mb-2">{subtitle}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-400">{col.object_count} object{col.object_count !== 1 ? 's' : ''}</span>
            {col.created_date && <span className="text-[10px] text-gray-600">{new Date(col.created_date).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="collections-content">
      {collections.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {collections.map((col, idx) => renderCard(col, idx, false))}
        </div>
      )}
      {unacknowledged.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Unacknowledged</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {unacknowledged.map((col, idx) => renderCard(col, idx, true))}
          </div>
        </div>
      )}
    </div>
  );
}


/* ── History View ── */
function HistoryView({ resolvedAddr, network, getImageUrl, navigate }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const skipRef = useRef(0);

  const badgeColors = {
    MINT: 'bg-green-500/20 text-green-400',
    PROFILE: 'bg-indigo-500/20 text-indigo-400',
    LIST: 'bg-blue-500/20 text-blue-400',
    GIVE_SENT: 'bg-purple-500/20 text-purple-400',
    GIVE_RECEIVED: 'bg-teal-500/20 text-teal-400',
    BUY: 'bg-amber-500/20 text-amber-400',
    BURN: 'bg-red-500/20 text-red-400',
  };

  // Human-readable labels for action types
  const actionLabels = {
    MINT: 'MINT',
    PROFILE: 'PROFILE',
    LIST: 'LIST',
    GIVE_SENT: 'GIVE',
    GIVE_RECEIVED: 'RECEIVED',
    BUY: 'BUY',
    BURN: 'BURN',
  };

  const fetchHistory = useCallback(async (skip, isReset = false) => {
    if (!resolvedAddr) return;
    if (loading && !isReset) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/objects/history/${resolvedAddr}`, { params: { network, skip, limit: 50 } });
      const items = res.data.history || [];
      setHistory(prev => isReset ? items : [...prev, ...items]);
      setHasMore(res.data.has_more);
      setTotal(res.data.total || 0);
      skipRef.current = skip + 50;
    } catch { setHasMore(false); }
    finally { setLoading(false); }
  }, [resolvedAddr, network, loading]);

  useEffect(() => {
    setHistory([]); skipRef.current = 0; setHasMore(true);
    fetchHistory(0, true);
  }, [resolvedAddr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (history.length === 0 && !loading) {
    return <div className="text-center py-12"><FiList size={32} className="mx-auto text-gray-700 mb-3" /><p className="text-lg text-gray-400">No transaction history</p></div>;
  }

  return (
    <div data-testid="history-content">
      <div className="space-y-1">
        {history.map((item, idx) => {
          const imgUrl = getImageUrl(item.object_image);
          const isFailed = (item.status || '').toLowerCase().includes('fail');
          return (
            <div key={idx} className={`flex items-center gap-3 px-4 py-3 border rounded-lg transition-colors ${isFailed ? 'bg-red-900/10 border-red-900/30' : 'bg-gray-900/50 border-gray-800 hover:bg-gray-800/50'}`} data-testid={`history-row-${idx}`}>
              <div className="w-10 h-10 rounded bg-gray-800 flex-shrink-0 overflow-hidden">
                {imgUrl ? <CachedImage src={imgUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600"><FiBox size={16} /></div>}
              </div>
              <span className={`px-2 py-0.5 text-xs font-bold rounded ${badgeColors[item.action] || 'bg-gray-700 text-gray-300'}`}>{actionLabels[item.action] || (item.action || '').toUpperCase()}</span>
              <span className="text-sm text-gray-200 truncate flex-1 min-w-0">{item.object_name || (item.object_address ? `${item.object_address.substring(0, 12)}...` : 'Unknown')}</span>
              {item.quantity > 0 && <span className="text-xs text-gray-500">x{item.quantity}</span>}
              <span className="text-xs text-gray-600 flex-shrink-0">{item.date ? new Date(item.date).toLocaleDateString() : ''}</span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="mt-6 text-center">
          <button onClick={() => fetchHistory(skipRef.current)} disabled={loading}
            className="px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium" data-testid="history-load-more">
            {loading ? 'Loading...' : `Load More (${history.length} of ${total})`}
          </button>
        </div>
      )}
      {loading && history.length === 0 && (
        <div className="text-center py-12 text-gray-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2" /> Loading history...</div>
      )}
    </div>
  );
}
