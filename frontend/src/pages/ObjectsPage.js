import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FiSearch, FiTrendingUp, FiPlus, FiFilter, FiArrowLeft, FiX, FiGlobe, FiArrowRight } from 'react-icons/fi';
import { ObjectCard } from '@/components/ObjectCard';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { ObjectCreateModal } from '@/components/ObjectCreateModal';
import { cachedFetch } from '@/utils/apiCache';

const API = process.env.REACT_APP_BACKEND_URL;

const DEFAULT_QTY = 40;
const DEFAULT_SEARCH = '';
const INITIAL_QTY = 20;
/** Cross-network discovery prompt */
function CrossNetworkModal({ object, userNetwork, onClose, navigate }) {
  const [checking, setChecking] = useState(false);
  const [localResult, setLocalResult] = useState(null); // null=not checked, []=not found, [items]=found

  const objName = object.Name || object.name || 'Unnamed Object';
  const objURN = object.URN || object.urn || '';
  const objImage = object.Image || object.image || '';
  const objectChain = object._blockchain || '';
  const objectIsTestnet = objectChain.toLowerCase().includes('testnet');

  const checkLocalNetwork = async () => {
    setChecking(true);
    try {
      // Search by object name on the user's current network
      const searchTerms = [objName];
      // Also try URN prefix if available
      if (objURN) {
        const urnPart = objURN.split(':').length > 1 ? objURN.split(':')[0] + ':' + objURN.split(':')[1].substring(0, 12) : objURN.substring(0, 20);
        searchTerms.push(urnPart);
      }

      let found = [];
      for (const term of searchTerms) {
        if (!term || term === 'Unnamed Object') continue;
        const res = await axios.get(`${API}/api/p2fk/search/objects?searchString=${encodeURIComponent(term)}&qty=10&skip=0&network=${encodeURIComponent(userNetwork)}`);
        const items = Array.isArray(res.data) ? res.data : [];
        // Filter to objects on the user's network
        const isUserTestnet = (userNetwork || '').includes('testnet');
        const matches = items.filter(item => {
          const chain = (item.blockchain || item.object?.blockchain || '').toLowerCase();
          return isUserTestnet ? chain.includes('testnet') : !chain.includes('testnet');
        });
        if (matches.length > 0) {
          found = matches;
          break;
        }
      }
      setLocalResult(found);
    } catch {
      setLocalResult([]);
    }
    setChecking(false);
  };

  // Get first creator address from local result to navigate
  const getObjAddr = (item) => {
    const creators = item?.object?.Creators;
    if (!creators || typeof creators !== 'object') return null;
    return Object.keys(creators)[0] || null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="cross-network-modal">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FiGlobe size={18} className="text-amber-400" />
            <h3 className="text-sm font-bold text-gray-100">Cross-Network Object</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><FiX size={18} /></button>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 mb-4">
          <p className="text-sm font-semibold text-gray-200 mb-1">{objName}</p>
          <p className="text-xs text-gray-500 mb-2">
            This object exists on <span className={`font-bold ${objectIsTestnet ? 'text-blue-400' : 'text-orange-400'}`}>{objectChain}</span>
          </p>
          {objURN && <p className="text-[10px] text-gray-600 font-mono truncate">URN: {objURN}</p>}
        </div>

        <p className="text-sm text-gray-400 mb-4">
          You're on <strong className="text-gray-200">{userNetwork}</strong>. Want to check if this object has been claimed on your network?
        </p>

        {localResult === null ? (
          <button
            onClick={checkLocalNetwork}
            disabled={checking}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
            data-testid="check-local-network-btn"
          >
            {checking ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Searching...</>
            ) : (
              <>Check on {userNetwork} <FiArrowRight size={14} /></>
            )}
          </button>
        ) : localResult.length > 0 ? (
          <div>
            <p className="text-sm text-emerald-400 font-medium mb-3">Found on your network!</p>
            {localResult.slice(0, 3).map((item, i) => {
              const addr = getObjAddr(item);
              const n = item.object?.Name || 'Unnamed';
              return (
                <button
                  key={i}
                  onClick={() => { onClose(); if (addr) navigate(`/object/addr/${addr}`); }}
                  className="w-full flex items-center justify-between p-3 bg-gray-800/60 border border-gray-700/50 rounded-lg mb-2 hover:border-emerald-600/50 transition-colors text-left"
                  data-testid={`cross-network-result-${i}`}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-200">{n}</p>
                    <p className="text-[10px] text-gray-500 font-mono">{item.blockchain}</p>
                  </div>
                  <FiArrowRight size={14} className="text-gray-500" />
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <p className="text-sm text-amber-400 font-medium mb-2">Not claimed on {userNetwork}!</p>
            <p className="text-xs text-gray-500 mb-4">
              This object hasn't been minted on your network yet. You could claim it by minting an object with the same URN.
            </p>
            <button
              onClick={() => { onClose(); }}
              className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-sm transition-colors"
              data-testid="claim-object-btn"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const CHAIN_FILTERS = [
  { key: 'all',  label: 'All',       color: 'bg-gray-600/20 text-gray-200 border-gray-400/50', match: null },
  { key: 'BTC',  label: 'BTC',       color: 'bg-amber-600/20 text-amber-400 border-amber-500/50', match: 'BTC' },
  { key: 'LTC',  label: 'LTC',       color: 'bg-gray-600/20 text-gray-300 border-gray-400/50', match: 'LTC' },
  { key: 'DOG',  label: 'DOG',       color: 'bg-yellow-600/20 text-yellow-400 border-yellow-500/50', match: 'DOG' },
  { key: 'MZC',  label: 'MZC',       color: 'bg-green-600/20 text-green-400 border-green-500/50', match: 'MZC' },
  { key: 'IPFS', label: 'IPFS',      color: 'bg-blue-600/20 text-blue-400 border-blue-500/50', match: 'IPFS' },
];

export default function ObjectsPage({ network }) {
  const { isConnected: walletConnected } = useWallet();
  const { isConnected: authConnected } = useAuth();
  const isConnected = authConnected || walletConnected;
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const skipRef = useRef(0);
  const activeSearchRef = useRef(DEFAULT_SEARCH);
  const [isUserSearch, setIsUserSearch] = useState(false);

  const [crossNetObj, setCrossNetObj] = useState(null);

  const [currentSkip, setCurrentSkip] = useState(0);
  const scrollContainerRef = useRef(null);
  const restoredRef = useRef(false);
  const skipFetchOnRestoreRef = useRef(false);
  const burnedSetRef = useRef(new Set());

  // Fetch burned object addresses once on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/api/snapshot/burned-set?network=${network}`);
        if (res.data?.addresses) {
          burnedSetRef.current = new Set(res.data.addresses);
        }
      } catch {}
    })();
  }, [network]);

  // ─── Scroll + state preservation ───
  // Save state to sessionStorage on any navigation away
  useEffect(() => {
    return () => {
      const container = scrollContainerRef.current;
      const scrollY = container ? container.scrollTop : 0;
      try {
        sessionStorage.setItem('objects_page_state', JSON.stringify({
          objects, query, activeFilter, isUserSearch,
          skipCurrent: skipRef.current,
          currentSkip,
          scrollY,
          search: activeSearchRef.current,
        }));
      } catch {}
    };
  });

  /** Detect the data repository from an object's URN prefix.
   *  URN examples: "IPFS:Qm...", "DOG:txid...", "LTC:txid...", "BTC:txid..." */
  const getDataRepo = useCallback((obj) => {
    const urn = (obj.URN || obj.urn || '').toUpperCase();
    if (urn.startsWith('LTC:')) return 'LTC';
    if (urn.startsWith('DOG:')) return 'DOG';
    if (urn.startsWith('MZC:')) return 'MZC';
    if (urn.startsWith('IPFS:')) return 'IPFS';
    if (urn.startsWith('BTC:')) return 'BTC';
    // Fallback: check _blockchain field
    const bc = (obj._blockchain || '').toUpperCase();
    if (bc.includes('LTC')) return 'LTC';
    if (bc.includes('DOG')) return 'DOG';
    if (bc.includes('MZC')) return 'MZC';
    return 'BTC';
  }, []);

  /** Normalize a single API response item to a flat object with _blockchain.
   *  Handles both p2fk.io wrapped format {object:{...}, blockchain:"BTC"}
   *  and flat format {TransactionId, Name, ...} from the local decoder. */
  const normalizeItem = useCallback((item) => {
    if (item?.object && typeof item.object === 'object') {
      return { ...item.object, _blockchain: item.blockchain || '' };
    }
    // Flat object — use as-is, try to detect blockchain from address
    return { ...item, _blockchain: item._blockchain || item.blockchain || '' };
  }, []);

  /** Fetch objects via backend proxy with caching */
  const fetchObjects = useCallback(async (searchString, skip, qty, isReset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const cacheId = `objs_${searchString}_${skip}_${qty}_${network}`;
      const doFetch = async () => {
        // Always use the cross-chain search proxy — works for both browse (empty) and search
        const url = `${API}/api/p2fk/search/objects?searchString=${encodeURIComponent(searchString)}&qty=${qty}&skip=${skip}&network=${encodeURIComponent(network)}`;
        const res = await axios.get(url);
        return Array.isArray(res.data) ? res.data : [];
      };

      const items = await cachedFetch('objects', cacheId, doFetch, (freshItems) => {
        // Background update with fresh data
        const normalized = freshItems
          .map(normalizeItem)
          .filter(o => {
            // Filter out fully burned objects (total_supply == 0)
            const supply = o.total_supply ?? o.TotalSupply;
            if (supply !== undefined && supply <= 0) return false;
            const owners = o.Owners || o.owners;
            if (owners) {
              const ownerArr = Array.isArray(owners) ? owners : Object.values(owners);
              const totalQty = ownerArr.reduce((sum, v) => {
                if (typeof v === 'number') return sum + v;
                if (typeof v === 'object') return sum + (v.Item1 ?? v.quantity ?? 0);
                return sum;
              }, 0);
              if (ownerArr.length > 0 && totalQty <= 0) return false;
            }
            return true;
          })
          .filter(o => {
            const name = o.Name || o.name;
            const image = o.Image || o.image;
            const license = o.License || o.license || '';
            if (license.toLowerCase().startsWith('cthulhu:tether')) return false;
            if ((!name || name === 'Unnamed Object' || name === 'Unnamed') && !image) return false;
            return true;
          })
          .filter(o => {
            const creators = o.Creators || o.creators;
            const addr = creators
              ? (typeof creators === 'object' && !Array.isArray(creators))
                ? Object.keys(creators)[0] || ''
                : Array.isArray(creators) ? (creators[0]?.address || creators[0] || '') : ''
              : '';
            return !burnedSetRef.current.has(addr);
          });
        const activeChainFilter = CHAIN_FILTERS.find(f => f.key === activeFilter);
        const chainMatch = activeChainFilter?.match;
        const finalObjects = chainMatch
          ? normalized.filter(o => getDataRepo(o) === chainMatch)
          : normalized;
        setObjects(finalObjects);
        setHasMore(freshItems.length >= qty);
      });

      const normalized = items
        .map(normalizeItem)
        .filter(o => {
          // Filter out fully burned objects (total_supply == 0)
          const supply = o.total_supply ?? o.TotalSupply;
          if (supply !== undefined && supply <= 0) return false;
          // Also check Owners dict — if all owners have qty 0, object is burned
          const owners = o.Owners || o.owners;
          if (owners) {
            const ownerArr = Array.isArray(owners) ? owners : Object.values(owners);
            const totalQty = ownerArr.reduce((sum, v) => {
              if (typeof v === 'number') return sum + v;
              if (typeof v === 'object') return sum + (v.Item1 ?? v.quantity ?? 0);
              return sum;
            }, 0);
            if (ownerArr.length > 0 && totalQty <= 0) return false;
          }
          return true;
        })
        .filter(o => {
          const name = o.Name || o.name;
          const image = o.Image || o.image;
          const license = o.License || o.license || '';
          if (license.toLowerCase().startsWith('cthulhu:tether')) return false;
          if ((!name || name === 'Unnamed Object' || name === 'Unnamed') && !image) return false;
          return true;
        })
        .filter(o => {
          const creators = o.Creators || o.creators;
          const addr = creators
            ? (typeof creators === 'object' && !Array.isArray(creators))
              ? Object.keys(creators)[0] || ''
              : Array.isArray(creators) ? (creators[0]?.address || creators[0] || '') : ''
            : '';
          return !burnedSetRef.current.has(addr);
        });

      // Apply strict data-repo filter when a chain filter is active
      // Checks URN prefix (DOG:, LTC:, MZC:, IPFS:, BTC:) not just _blockchain
      const activeChainFilter = CHAIN_FILTERS.find(f => f.key === activeFilter);
      const chainMatch = activeChainFilter?.match;
      const finalObjects = chainMatch
        ? normalized.filter(o => getDataRepo(o) === chainMatch)
        : normalized;

      setObjects(finalObjects);
      setHasMore(items.length >= qty);
      setCurrentSkip(skip);
      skipRef.current = skip + qty;
    } catch (err) {
      console.error('p2fk search error:', err);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, network, normalizeItem, activeFilter, getDataRepo]);

  // Load on mount and when filter changes
  useEffect(() => {
    // Try to restore saved state on first mount (back navigation)
    if (!restoredRef.current) {
      restoredRef.current = true;
      try {
        const saved = sessionStorage.getItem('objects_page_state');
        if (saved) {
          const state = JSON.parse(saved);
          sessionStorage.removeItem('objects_page_state');
          if (state.objects?.length > 0) {
            setObjects(state.objects);
            setQuery(state.query || '');
            setIsUserSearch(!!state.isUserSearch);
            setCurrentSkip(state.currentSkip || 0);
            skipRef.current = state.skipCurrent || 0;
            activeSearchRef.current = state.search || DEFAULT_SEARCH;
            setHasMore(true);
            // If saved filter differs from initial, set it but skip the next fetch
            if (state.activeFilter && state.activeFilter !== activeFilter) {
              skipFetchOnRestoreRef.current = true;
              setActiveFilter(state.activeFilter);
            }
            // Double rAF ensures React has committed the DOM before scrolling
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const container = scrollContainerRef.current;
                if (container && state.scrollY) container.scrollTop = state.scrollY;
              });
            });
            return;
          }
        }
      } catch {}
    }
    // Skip one fetch cycle after restoration changed the filter
    if (skipFetchOnRestoreRef.current) {
      skipFetchOnRestoreRef.current = false;
      return;
    }
    setObjects([]);
    skipRef.current = 0;
    setIsUserSearch(false);
    setQuery('');
    activeSearchRef.current = activeFilter === 'all' ? '' : activeFilter;
    fetchObjects(activeSearchRef.current, 0, DEFAULT_QTY, true);
  }, [activeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e) => {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    activeSearchRef.current = term;
    skipRef.current = 0;
    setIsUserSearch(true);
    fetchObjects(term, 0, DEFAULT_QTY, true);
  };

  const clearSearch = () => {
    setIsUserSearch(false);
    setQuery('');
    setObjects([]);
    skipRef.current = 0;
    activeSearchRef.current = activeFilter === 'all' ? '' : activeFilter;
    fetchObjects(activeSearchRef.current, 0, DEFAULT_QTY, true);
  };

  const loadMore = () => {
    fetchObjects(activeSearchRef.current, skipRef.current, DEFAULT_QTY, true);
  };

  const loadPrev = () => {
    const prevSkip = Math.max(0, currentSkip - DEFAULT_QTY);
    fetchObjects(activeSearchRef.current, prevSkip, DEFAULT_QTY, true);
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="objects-page" ref={scrollContainerRef}>
      {/* Mobile back header */}
      <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <button onClick={() => navigate('/feed')} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="objects-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <span className="text-sm font-medium text-gray-300">Storefront</span>
        {isConnected && (
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition-colors"
            data-testid="create-object-btn-mobile"
          >
            <FiPlus size={12} /> Create
          </button>
        )}
      </div>
      <div className="p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <img src="/storefront-logo.png" alt="" className="w-8 h-8 object-contain" />
            <h2 className="text-2xl font-bold text-gray-100" data-testid="objects-page-title">
              {isUserSearch ? 'Search Results' : 'Object Storefront'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {isUserSearch && (
              <button onClick={clearSearch} className="text-sm text-blue-400 hover:underline" data-testid="clear-search">
                Back to Storefront
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSubmit} className="relative mb-6">
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search objects by name or keyword..."
            className="w-full pl-10 pr-4 py-3 bg-gray-800 text-gray-100 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none"
            data-testid="objects-search-input"
          />
        </form>

          {/* Chain Filters */}
          {!isUserSearch && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 mb-6" data-testid="chain-filter-section">
              <div className="flex items-center gap-2 mb-3">
                <FiFilter size={14} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-300">Filter by Chain</span>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="chain-filters">
                {CHAIN_FILTERS.map(f => {
                  const isActive = activeFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setActiveFilter(f.key)}
                      className={`px-4 py-2 text-sm font-medium rounded-lg border transition-all ${
                        isActive ? f.color + ' border-current shadow-sm' : 'bg-gray-800/40 text-gray-500 border-gray-700/60 hover:text-gray-300 hover:border-gray-600'
                      }`}
                      data-testid={`chain-filter-${f.key.toLowerCase()}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Results */}
          {loading && objects.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4" />
              {isUserSearch ? 'Searching objects...' : 'Loading storefront...'}
            </div>
          ) : objects.length === 0 ? (
            <div className="text-center py-16">
              <FiTrendingUp size={48} className="mx-auto text-gray-700 mb-4" />
              <p className="text-lg text-gray-400">
                {isUserSearch ? `No objects found for "${activeSearchRef.current}"` : 'No objects found'}
              </p>
              <p className="text-sm text-gray-600">Try a different search term or filter.</p>
            </div>
          ) : (
            <>
              {isUserSearch && (
                <p className="text-sm text-gray-500 mb-4" data-testid="objects-result-count">
                  Showing {objects.length} result{objects.length !== 1 ? 's' : ''} for "{activeSearchRef.current}"
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {objects.map((obj, idx) => (
                  <ObjectCard key={`${obj.TransactionId || obj.transaction_id || obj.Id || obj.id || idx}`} object={obj} network={network} onCrossNetwork={setCrossNetObj} />
                ))}
              </div>

              {(hasMore || currentSkip > 0) && (
                <div className="mt-8 flex items-center justify-center gap-4">
                  {currentSkip > 0 && (
                    <button
                      onClick={loadPrev}
                      disabled={loading}
                      className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                      data-testid="storefront-prev"
                    >
                      {loading ? 'Loading...' : 'Previous'}
                    </button>
                  )}
                  <span className="text-sm text-gray-500">
                    {currentSkip + 1}&ndash;{currentSkip + objects.length}
                  </span>
                  {hasMore && (
                    <button
                      onClick={loadMore}
                      disabled={loading}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                      data-testid="storefront-load-more"
                    >
                      {loading ? 'Loading...' : 'Next'}
                    </button>
                  )}
                </div>
              )}

              {!hasMore && objects.length > 0 && currentSkip === 0 && (
                <p className="text-center py-6 text-gray-600" data-testid="storefront-end">All objects loaded</p>
              )}
            </>
          )}
      </div>
      </div>
      {showCreate && (
        <ObjectCreateModal onClose={() => setShowCreate(false)} network={network} />
      )}
      {crossNetObj && (
        <CrossNetworkModal
          object={crossNetObj}
          userNetwork={network}
          onClose={() => setCrossNetObj(null)}
          navigate={navigate}
        />
      )}
    </div>
  );
}
