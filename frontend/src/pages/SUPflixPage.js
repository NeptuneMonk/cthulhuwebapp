import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiSearch, FiPlay, FiFilm, FiMusic, FiArrowLeft, FiChevronLeft, FiChevronRight, FiHeart, FiList, FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiClock, FiBarChart2 } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import { meshFirstFetch } from '@/utils/meshFirstFetch';
import { meshFetchBlob, getGlobalMeshNode } from '@/utils/meshRelay';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

/**
 * Mesh-first video player.
 * Resolution: Mesh peers → IPFS cache → IPFS gateway → on-chain reconstruction → fallback URL
 * Caches played video in mesh node for serving to other peers (BitTorrent-like).
 */
function MeshVideoPlayer({ src, altSrc, onError, autoPlay = true }) {
  const [resolvedSrc, setResolvedSrc] = useState(null);
  const [source, setSource] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;

    const resolve = async () => {
      setResolving(true);
      setTriedFallback(false);

      // Extract CID from IPFS URLs for mesh/cache lookup
      const ipfsMatch = src.match(/ipfs[./](?:ipfs\/)?([A-Za-z0-9]{46,})/);
      const cid = ipfsMatch?.[1];

      // Is this an on-chain file?
      const isOnchain = src.includes('/onchain/file/') || src.startsWith('/api/onchain/');
      const fullSrc = src.startsWith('/') ? `${process.env.REACT_APP_BACKEND_URL}${src}` : src;

      // 1. Try mesh peers (fastest — another viewer may have this cached)
      if (cid) {
        try {
          const blob = await meshFetchBlob(cid);
          if (blob && !cancelled) {
            const url = URL.createObjectURL(blob);
            setResolvedSrc(url);
            setSource('mesh');
            setResolving(false);
            return;
          }
        } catch {}
      }

      // 2. For on-chain content, poll backend until reconstructed
      if (isOnchain) {
        try {
          const resp = await fetch(fullSrc);
          if (cancelled) return;
          if (resp.status === 202) {
            // Still reconstructing — poll
            const poll = async () => {
              if (cancelled) return;
              try {
                const r = await fetch(fullSrc);
                if (cancelled) return;
                if (r.status === 200) {
                  const blob = await r.blob();
                  if (!cancelled) {
                    _cacheInMesh(cid || src, blob);
                    setResolvedSrc(URL.createObjectURL(blob));
                    setSource('blockchain');
                    setResolving(false);
                  }
                } else if (r.status === 202) {
                  setTimeout(poll, 4000);
                }
              } catch { if (!cancelled) setTimeout(poll, 4000); }
            };
            setTimeout(poll, 4000);
            return;
          }
          if (resp.ok) {
            const blob = await resp.blob();
            if (!cancelled) {
              _cacheInMesh(cid || src, blob);
              setResolvedSrc(URL.createObjectURL(blob));
              setSource('blockchain');
              setResolving(false);
            }
            return;
          }
        } catch {}
      }

      // 3. Try IPFS gateway directly (for non-onchain IPFS content)
      if (!isOnchain) {
        // Just use the URL directly — browser will fetch from IPFS gateway
        if (!cancelled) {
          setResolvedSrc(fullSrc);
          setSource('ipfs');
          setResolving(false);
        }
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [src]);

  const handleError = () => {
    if (!triedFallback && altSrc && altSrc !== src) {
      setTriedFallback(true);
      setResolvedSrc(altSrc.startsWith('/') ? `${process.env.REACT_APP_BACKEND_URL}${altSrc}` : altSrc);
      setSource('fallback');
    } else {
      onError?.();
    }
  };

  if (resolving) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-black">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mb-3" />
        <p className="text-xs text-gray-500">Resolving video via mesh network...</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <video
        key={resolvedSrc}
        src={resolvedSrc}
        controls
        autoPlay={autoPlay}
        className="w-full max-h-[60vh] object-contain"
        data-testid="supflix-video-element"
        onError={handleError}
        onPlay={() => {
          // When playback starts, cache in mesh for other peers
          if (resolvedSrc?.startsWith('blob:')) return; // Already from mesh/blob
          const ipfsMatch = src?.match(/ipfs[./](?:ipfs\/)?([A-Za-z0-9]{46,})/);
          if (ipfsMatch?.[1]) {
            fetch(resolvedSrc).then(r => r.blob()).then(blob => _cacheInMesh(ipfsMatch[1], blob)).catch(() => {});
          }
        }}
      />
      {source && source !== 'ipfs' && source !== 'fallback' && (
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium bg-black/60 backdrop-blur-sm"
             style={{ color: source === 'mesh' ? '#34d399' : '#f59e0b' }}>
          via {source}
        </div>
      )}
    </div>
  );
}

/** Cache a video blob in the mesh node for serving to peers */
function _cacheInMesh(key, blob, urn = null) {
  try {
    const node = getGlobalMeshNode();
    if (node?._running) {
      blob.arrayBuffer().then(ab => {
        node.cache.set(`ipfs:${key}`, { data: ab, timestamp: Date.now() });
        // Also index under URN for chain-agnostic mesh lookups
        if (urn) {
          const existing = node.cache.get(`urn:${urn}`);
          node.cache.set(`urn:${urn}`, { meta: existing?.meta || {}, data: ab, timestamp: Date.now() });
        }
      }).catch(() => {});
    }
  } catch {}
}

export default function SUPflixPage({ network }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { wallet } = useWallet();
  const library = useMediaLibrary(wallet?.address, network);

  const [view, setView] = useState('browse'); // 'browse' | 'favorites' | 'playlists'
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editName, setEditName] = useState('');
  const [addToPlaylistItemId, setAddToPlaylistItemId] = useState(null);

  const [featuredKeywords, setFeaturedKeywords] = useState([]);
  const [featuredRows, setFeaturedRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);
  const videoRef = useRef(null);

  // Auto-play from URL param
  useEffect(() => {
    const playUrl = searchParams.get('play');
    const playName = searchParams.get('name');
    if (playUrl) {
      setActiveVideo({ media_url: decodeURIComponent(playUrl), name: playName || 'Video' });
    }
  }, [searchParams]);

  // Fetch admin-configured keywords
  useEffect(() => {
    meshFirstFetch('/admin/supflix-keywords')
      .then(({ data }) => setFeaturedKeywords(data?.keywords || ['movie']))
      .catch(() => setFeaturedKeywords(['movie']));
  }, []);

  // Fetch featured content for each keyword via mesh-first
  useEffect(() => {
    if (!featuredKeywords.length) return;
    setLoading(true);
    const netParam = network || 'btc-testnet';
    Promise.all(
      featuredKeywords.map(kw =>
        meshFirstFetch(`/supflix/discover`, { network: netParam, query: kw, limit: 20 })
          .then(({ data }) => ({ keyword: kw, items: data?.items || [] }))
          .catch(() => ({ keyword: kw, items: [] }))
      )
    ).then(results => {
      const rows = {};
      results.forEach(r => { rows[r.keyword] = r.items; });
      setFeaturedRows(rows);
      setLoading(false);
    });
  }, [featuredKeywords, network]);

  const handleSearch = useCallback(async (q) => {
    const trimmed = (q || '').trim();
    if (trimmed.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const netParam = network || 'btc-testnet';
      const { data } = await meshFirstFetch(`/supflix/discover`, { network: netParam, query: trimmed, limit: 20, skip: 0 });
      setSearchResults({ items: data?.items || [], total: data?.total || 0, has_more: data?.has_more || false, skip: 20, query: trimmed });
    } catch {
      setSearchResults({ items: [], total: 0, has_more: false, skip: 0, query: trimmed });
    }
    setSearchLoading(false);
  }, [network]);

  const loadMoreSearch = useCallback(async () => {
    if (!searchResults || !searchResults.has_more) return;
    setSearchLoading(true);
    try {
      const netParam = network || 'btc-testnet';
      const { data } = await meshFirstFetch(`/supflix/discover`, { network: netParam, query: searchResults.query, limit: 20, skip: searchResults.skip });
      setSearchResults(prev => ({
        ...prev,
        items: [...prev.items, ...(data?.items || [])],
        has_more: data?.has_more || false,
        skip: prev.skip + 20,
      }));
    } catch {}
    setSearchLoading(false);
  }, [searchResults, network]);

  const handleSubmit = (e) => {
    e.preventDefault();
    handleSearch(searchQuery);
  };

  const playVideo = (item) => {
    setActiveVideo(item);
    videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const url = item.url || item.media_url;
    const fav = library.getFavoriteByUrl(url);
    if (fav) library.recordPlay(fav.id);
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    await library.createPlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setShowCreatePlaylist(false);
  };

  const videoFavorites = library.favorites.filter(f => f.type === 'video');

  return (
    <div className="h-full overflow-y-auto" data-testid="supflix-page">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b" style={{ backgroundColor: 'rgba(3, 7, 18, 0.95)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="supflix-back-btn">
            <FiArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <FiFilm size={18} className="text-red-500" />
            <h1 className="text-base font-bold text-white tracking-tight">SUPflix</h1>
          </div>
          {view === 'browse' && (
            <form onSubmit={handleSubmit} className="flex-1 relative ml-3">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search movies, music, media..."
                className="w-full pl-9 pr-4 py-2 bg-gray-800/50 text-gray-100 rounded-lg border border-gray-700/40 focus:border-red-500/50 focus:outline-none text-sm placeholder-gray-600"
                data-testid="supflix-search-input"
              />
            </form>
          )}
          {view !== 'browse' && <div className="flex-1" />}
        </div>
        {/* View Tabs */}
        <div className="max-w-5xl mx-auto flex gap-1 px-4 pb-2">
          {[
            { id: 'browse', label: 'Browse', icon: FiSearch },
            { id: 'favorites', label: 'Favorites', icon: FiHeart, count: videoFavorites.length },
            { id: 'playlists', label: 'Playlists', icon: FiList, count: library.playlists.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setView(tab.id); setActivePlaylistId(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                view === tab.id ? 'bg-red-600/20 text-red-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
              }`}
              data-testid={`supflix-tab-${tab.id}`}
            >
              <tab.icon size={12} />
              {tab.label}
              {tab.count > 0 && <span className="text-[10px] opacity-60">{tab.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto pb-24">
        {/* Video Player */}
        {activeVideo && (
          <div ref={videoRef} className="bg-black" data-testid="supflix-player">
            <MeshVideoPlayer
              src={activeVideo.media_url || activeVideo.url}
              altSrc={activeVideo.media_url_alt || activeVideo.fallbackUrl}
              onError={() => {
                if (activeVideo.media_url) {
                  const ref = activeVideo.media_url.replace('https://ipfs.io/ipfs/', '');
                  fetch(`${API}/ipfs/report-dead`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ref, reason: 'playback_error' }),
                  }).catch(() => {});
                }
              }}
            />
            <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-gray-200">{activeVideo.name || 'Untitled'}</h2>
                {activeVideo.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{activeVideo.description}</p>
                )}
                {(activeVideo.blockchain || activeVideo.chain) && (
                  <span className="inline-block mt-1 text-[10px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded">{activeVideo.blockchain || activeVideo.chain}</span>
                )}
              </div>
              <button
                onClick={() => library.toggleFavorite({ ...activeVideo, url: activeVideo.media_url || activeVideo.url, type: 'video' })}
                className={`p-2 rounded-lg transition-colors ${library.isFavorite(activeVideo.media_url || activeVideo.url) ? 'text-pink-500 bg-pink-500/10' : 'text-gray-500 hover:text-pink-400 hover:bg-gray-800/40'}`}
                data-testid="supflix-player-fav-btn"
              >
                <FiHeart size={16} fill={library.isFavorite(activeVideo.media_url || activeVideo.url) ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
        )}

        {/* Browse View */}
        {view === 'browse' && (
          <>
            {/* Search Results */}
            {searchResults !== null && (
              <div className="px-4 py-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Search Results {searchResults.total > 0 && `(${searchResults.items.length} of ${searchResults.total})`}
                </h3>
                {searchLoading && searchResults.items.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-transparent border-t-red-500" />
                  </div>
                ) : searchResults.items.length === 0 ? (
                  <p className="text-sm text-gray-600 text-center py-6">No media found</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {searchResults.items.map((item, i) => (
                        <MediaCard key={`${item.id}-${item.name}-${i}`} item={item} onClick={() => playVideo(item)} library={library} />
                      ))}
                    </div>
                    {searchResults.has_more && (
                      <button
                        onClick={loadMoreSearch}
                        disabled={searchLoading}
                        className="w-full mt-4 py-2.5 text-xs text-red-400 hover:text-red-300 bg-gray-800/30 hover:bg-gray-800/50 rounded-lg transition-colors disabled:opacity-50"
                        data-testid="supflix-load-more-search"
                      >
                        {searchLoading ? 'Loading...' : `Load More (${searchResults.total - searchResults.items.length} remaining)`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Featured Rows */}
            {!searchResults && (
              <div className="py-4 space-y-6">
                {loading ? (
                  <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-7 w-7 border-2 border-transparent border-t-red-500" />
                  </div>
                ) : (
                  featuredKeywords.map(kw => {
                    const items = featuredRows[kw] || [];
                    if (items.length === 0) return null;
                    return (
                      <FeaturedRow
                        key={kw}
                        title={kw}
                        items={items}
                        onPlay={playVideo}
                        library={library}
                      />
                    );
                  })
                )}

                {!loading && Object.values(featuredRows).every(r => r.length === 0) && (
                  <div className="text-center py-16 space-y-3">
                    <FiFilm size={32} className="mx-auto text-gray-700" />
                    <p className="text-sm text-gray-500">No featured media found</p>
                    <p className="text-xs text-gray-600">Try searching for something specific</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Favorites View */}
        {view === 'favorites' && (
          <div className="px-4 py-4">
            {videoFavorites.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <FiHeart size={32} className="mx-auto text-gray-700" />
                <p className="text-sm text-gray-500">No favorites yet</p>
                <p className="text-xs text-gray-600">Heart videos while browsing to add them here</p>
              </div>
            ) : (
              <>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  Favorites ({videoFavorites.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {videoFavorites
                    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                    .map((fav) => (
                      <FavoriteMediaCard
                        key={fav.id}
                        item={fav}
                        onPlay={() => playVideo(fav)}
                        onRemove={() => library.removeFavorite(fav.id)}
                        onAddToPlaylist={() => setAddToPlaylistItemId(fav.id)}
                      />
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Playlists View */}
        {view === 'playlists' && !activePlaylistId && (
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Playlists</h3>
              <button onClick={() => setShowCreatePlaylist(true)} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300" data-testid="supflix-create-playlist-btn">
                <FiPlus size={12} /> New Playlist
              </button>
            </div>
            {showCreatePlaylist && (
              <div className="flex gap-2 mb-4">
                <input
                  autoFocus
                  value={newPlaylistName}
                  onChange={e => setNewPlaylistName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreatePlaylist()}
                  placeholder="Playlist name..."
                  className="flex-1 px-3 py-2 bg-gray-800/50 text-gray-100 rounded-lg border border-gray-700/40 focus:border-red-500/50 focus:outline-none text-sm"
                  data-testid="supflix-playlist-name-input"
                />
                <button onClick={handleCreatePlaylist} className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm"><FiCheck size={14} /></button>
                <button onClick={() => { setShowCreatePlaylist(false); setNewPlaylistName(''); }} className="px-3 py-2 bg-gray-800 text-gray-400 rounded-lg text-sm"><FiX size={14} /></button>
              </div>
            )}
            {library.playlists.length === 0 && !showCreatePlaylist ? (
              <div className="text-center py-16 space-y-3">
                <FiList size={32} className="mx-auto text-gray-700" />
                <p className="text-sm text-gray-500">No playlists yet</p>
                <p className="text-xs text-gray-600">Create a playlist to organize your favorites</p>
              </div>
            ) : (
              <div className="space-y-1">
                {library.playlists.map(pl => {
                  const items = library.getPlaylistItems(pl.id);
                  return (
                    <div key={pl.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/40 group" data-testid={`supflix-playlist-${pl.id}`}>
                      <button
                        onClick={() => setActivePlaylistId(pl.id)}
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                      >
                        <div className="w-9 h-9 rounded-lg bg-red-900/20 border border-red-800/20 flex items-center justify-center flex-shrink-0">
                          <FiList size={14} className="text-red-500/60" />
                        </div>
                        <div className="min-w-0">
                          {editingPlaylistId === pl.id ? (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { library.renamePlaylist(pl.id, editName); setEditingPlaylistId(null); }}} className="px-2 py-0.5 bg-gray-800 text-gray-100 rounded text-xs border border-gray-700" />
                              <button onClick={() => { library.renamePlaylist(pl.id, editName); setEditingPlaylistId(null); }} className="text-green-400"><FiCheck size={12} /></button>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-gray-200 truncate">{pl.name}</p>
                              <p className="text-[10px] text-gray-600">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingPlaylistId(pl.id); setEditName(pl.name); }} className="p-1.5 text-gray-500 hover:text-red-400" title="Rename"><FiEdit2 size={12} /></button>
                        <button onClick={() => library.deletePlaylist(pl.id)} className="p-1.5 text-gray-500 hover:text-red-400" title="Delete"><FiTrash2 size={12} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Playlist Detail */}
        {view === 'playlists' && activePlaylistId && (() => {
          const playlist = library.playlists.find(p => p.id === activePlaylistId);
          const items = library.getPlaylistItems(activePlaylistId);
          if (!playlist) return null;
          return (
            <div className="px-4 py-4">
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setActivePlaylistId(null)} className="text-gray-400 hover:text-gray-200"><FiArrowLeft size={16} /></button>
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">{playlist.name}</h3>
                  <p className="text-[10px] text-gray-600">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {items.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <FiFilm size={24} className="mx-auto text-gray-700" />
                  <p className="text-xs text-gray-600">This playlist is empty</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((item) => (
                    <FavoriteMediaCard
                      key={item.id}
                      item={item}
                      onPlay={() => playVideo(item)}
                      onRemove={() => library.removeFromPlaylist(activePlaylistId, item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Add to Playlist Modal */}
      {addToPlaylistItemId && (
        <SupflixAddToPlaylistModal
          playlists={library.playlists}
          onSelect={(plId) => { library.addToPlaylist(plId, addToPlaylistItemId); setAddToPlaylistItemId(null); }}
          onClose={() => setAddToPlaylistItemId(null)}
          onCreate={async (name) => { const pl = await library.createPlaylist(name); if (pl) library.addToPlaylist(pl.id, addToPlaylistItemId); setAddToPlaylistItemId(null); }}
        />
      )}
    </div>
  );
}

function FeaturedRow({ title, items, onPlay, library }) {
  const scrollRef = useRef(null);
  const scroll = (dir) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  return (
    <div data-testid={`supflix-row-${title}`}>
      <div className="flex items-center justify-between px-4 mb-2">
        <h3 className="text-sm font-semibold text-gray-200 capitalize">{title}</h3>
        <div className="hidden sm:flex gap-1">
          <button onClick={() => scroll(-1)} className="w-7 h-7 rounded-full bg-gray-800/60 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
            <FiChevronLeft size={14} />
          </button>
          <button onClick={() => scroll(1)} className="w-7 h-7 rounded-full bg-gray-800/60 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
            <FiChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 px-4 sm:hidden">
        {items.map((item, i) => (
          <MediaCard key={item.id || i} item={item} onClick={() => onPlay(item)} library={library} />
        ))}
      </div>
      <div ref={scrollRef} className="hidden sm:flex gap-3 px-4 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {items.map((item, i) => (
          <MediaCard key={`h-${item.id || i}`} item={item} onClick={() => onPlay(item)} horizontal library={library} />
        ))}
      </div>
    </div>
  );
}

function VideoThumbnail({ src, fallbackSrc, alt }) {
  const [thumb, setThumb] = useState(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!src || attempted.current) return;
    attempted.current = true;

    const trySource = (url) => {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'metadata';

        const cleanup = () => { try { video.removeAttribute('src'); video.load(); } catch {} };
        const timer = setTimeout(() => { cleanup(); resolve(null); }, 10000);

        video.onloadeddata = () => {
          video.currentTime = Math.min(5, video.duration * 0.1 || 2);
        };

        video.onseeked = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 180;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            resolve(dataUrl && dataUrl.length > 100 ? dataUrl : null);
          } catch {
            resolve(null);
          }
          cleanup();
        };

        video.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
        video.src = url;
      });
    };

    (async () => {
      let result = await trySource(src);
      if (!result && fallbackSrc && fallbackSrc !== src) {
        result = await trySource(fallbackSrc);
      }
      if (result) setThumb(result);
    })();
  }, [src, fallbackSrc]);

  if (thumb) return <img src={thumb} alt={alt || ''} className="w-full h-full object-cover" />;
  return null;
}

function MediaCard({ item, onClick, horizontal, library }) {
  const isVideo = item.is_video;
  const [imgSrc, setImgSrc] = useState(item.image || '');
  const [triedFallback, setTriedFallback] = useState(false);
  const url = item.media_url || item.url;
  const isFav = library?.isFavorite(url);

  return (
    <div
      className={`group text-left rounded-lg overflow-hidden transition-all hover:ring-1 hover:ring-red-500/30 flex-shrink-0 relative ${
        horizontal ? 'w-44' : 'w-full'
      }`}
      style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
      data-testid={`supflix-card-${item.id || item.name}`}
    >
      <button onClick={onClick} className="w-full text-left">
        <div className="relative aspect-video bg-gray-900 flex items-center justify-center overflow-hidden">
          {imgSrc ? (
            <img src={imgSrc} alt="" className="w-full h-full object-cover" onError={() => {
              if (!triedFallback && item.image_fallback && item.image_fallback !== imgSrc) {
                setTriedFallback(true);
                setImgSrc(item.image_fallback);
              } else {
                setImgSrc('');
              }
            }} />
          ) : isVideo && item.media_url ? (
            <VideoThumbnail src={item.media_url} fallbackSrc={item.media_url_alt} alt={item.name} />
          ) : null}
          {!imgSrc && (
            <div className="absolute inset-0 flex items-center justify-center -z-0" style={{ background: 'linear-gradient(135deg, rgba(127,29,29,0.15), rgba(30,30,30,0.8))' }}>
              {isVideo ? <FiFilm size={20} className="text-red-500/40" /> : <FiMusic size={20} className="text-purple-500/40" />}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center">
              <FiPlay size={16} className="text-white ml-0.5" />
            </div>
          </div>
          {item.blockchain && (
            <span className="absolute top-1.5 right-1.5 text-[9px] bg-black/60 text-gray-400 px-1.5 py-0.5 rounded">{item.blockchain}</span>
          )}
        </div>
      </button>
      <div className="p-2 flex items-center gap-1">
        <button onClick={onClick} className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium text-gray-200 truncate group-hover:text-white transition-colors">{item.name || 'Untitled'}</p>
          {item.type && (
            <p className="text-[10px] text-gray-600 mt-0.5 capitalize">{item.type}</p>
          )}
        </button>
        {library && (
          <button
            onClick={(e) => { e.stopPropagation(); library.toggleFavorite({ ...item, url, type: 'video' }); }}
            className={`p-1 rounded transition-colors flex-shrink-0 ${isFav ? 'text-pink-500' : 'text-gray-600 opacity-0 group-hover:opacity-100 hover:text-pink-400'}`}
            data-testid={`supflix-fav-${item.id || item.name}`}
          >
            <FiHeart size={12} fill={isFav ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    </div>
  );
}


function FavoriteMediaCard({ item, onPlay, onRemove, onAddToPlaylist }) {
  const [imgSrc, setImgSrc] = useState(item.image || '');
  return (
    <div className="group rounded-lg overflow-hidden relative" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }} data-testid={`supflix-fav-card-${item.id}`}>
      <button onClick={onPlay} className="w-full text-left">
        <div className="relative aspect-video bg-gray-900 flex items-center justify-center overflow-hidden">
          {imgSrc ? (
            <img src={imgSrc} alt="" className="w-full h-full object-cover" onError={() => setImgSrc('')} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(127,29,29,0.15), rgba(30,30,30,0.8))' }}>
              <FiFilm size={20} className="text-red-500/40" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center">
              <FiPlay size={16} className="text-white ml-0.5" />
            </div>
          </div>
          {item.chain && <span className="absolute top-1.5 right-1.5 text-[9px] bg-black/60 text-gray-400 px-1.5 py-0.5 rounded">{item.chain}</span>}
        </div>
      </button>
      <div className="p-2">
        <p className="text-xs font-medium text-gray-200 truncate">{item.name}</p>
        <div className="flex items-center gap-2 text-[10px] text-gray-600 mt-0.5">
          {item.playCount > 0 && <span className="flex items-center gap-0.5"><FiBarChart2 size={8} />{item.playCount}</span>}
          {item.lastPlayed && <span className="flex items-center gap-0.5"><FiClock size={8} />{new Date(item.lastPlayed).toLocaleDateString()}</span>}
        </div>
      </div>
      <div className="absolute top-1.5 left-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onAddToPlaylist && (
          <button onClick={onAddToPlaylist} className="w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-gray-300 hover:text-purple-400" title="Add to playlist"><FiList size={10} /></button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-gray-300 hover:text-red-400" title="Remove"><FiTrash2 size={10} /></button>
        )}
      </div>
    </div>
  );
}

function SupflixAddToPlaylistModal({ playlists, onSelect, onClose, onCreate }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-80 max-h-96 overflow-hidden" onClick={e => e.stopPropagation()} data-testid="supflix-add-to-playlist-modal">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Add to Playlist</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><FiX size={16} /></button>
        </div>
        <div className="overflow-y-auto max-h-64 p-2 space-y-1">
          {playlists.map(pl => (
            <button key={pl.id} onClick={() => onSelect(pl.id)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/60 text-left">
              <FiList size={14} className="text-red-500/60 flex-shrink-0" />
              <span className="text-xs text-gray-300 truncate">{pl.name}</span>
              <span className="text-[10px] text-gray-600 ml-auto">{pl.itemIds.length}</span>
            </button>
          ))}
          {creating ? (
            <div className="flex gap-1 px-2">
              <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && name.trim() && onCreate(name.trim())} placeholder="Playlist name..." className="flex-1 px-2 py-1.5 bg-gray-800 text-gray-100 rounded text-xs border border-gray-700" />
              <button onClick={() => name.trim() && onCreate(name.trim())} className="px-2 py-1.5 bg-red-600 text-white rounded text-xs"><FiCheck size={12} /></button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/60 text-gray-500 hover:text-gray-300">
              <FiPlus size={14} /><span className="text-xs">New Playlist</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
