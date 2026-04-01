/**
 * JukeboxPage — Audio discovery and playback.
 * Same pattern as SUPflixPage but for audio files.
 * Integrates with MiniPlayer for persistent playback.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiSearch, FiMusic, FiPlay, FiPause, FiPlus, FiChevronLeft, FiChevronRight, FiAlertCircle, FiHeart, FiList, FiTrash2, FiEdit2, FiCheck, FiX, FiClock, FiBarChart2 } from 'react-icons/fi';
import { useMiniPlayer } from '@/contexts/MiniPlayerContext';
import { useWallet } from '@/hooks/useWallet';
import { useMediaLibrary } from '@/hooks/useMediaLibrary';
import { meshFirstFetch } from '@/utils/meshFirstFetch';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function JukeboxPage() {
  const navigate = useNavigate();
  const { network, wallet } = useWallet();
  const player = useMiniPlayer();
  const library = useMediaLibrary(wallet?.address, network);

  const [view, setView] = useState('browse'); // 'browse' | 'favorites' | 'playlist'
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editName, setEditName] = useState('');
  const [addToPlaylistItemId, setAddToPlaylistItemId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [featuredKeywords, setFeaturedKeywords] = useState([]);
  const [featuredRows, setFeaturedRows] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch jukebox keywords
  useEffect(() => {
    meshFirstFetch('/admin/jukebox-keywords')
      .then(({ data }) => setFeaturedKeywords(data?.keywords || ['music']))
      .catch(() => setFeaturedKeywords(['music']));
  }, []);

  // Fetch featured rows
  useEffect(() => {
    if (featuredKeywords.length === 0) return;
    setLoading(true);
    const netParam = network || 'btc-testnet';
    Promise.all(
      featuredKeywords.map(kw =>
        meshFirstFetch(`/jukebox/discover`, { network: netParam, query: kw, limit: 20 })
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
      const { data } = await meshFirstFetch(`/jukebox/discover`, { network: netParam, query: trimmed, limit: 20, skip: 0 });
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
      const { data } = await meshFirstFetch(`/jukebox/discover`, { network: netParam, query: searchResults.query, limit: 20, skip: searchResults.skip });
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

  const playTrack = (item) => {
    if (!player) return;
    const url = item.url || item.media_url;
    player.playTrack({
      id: item.id, name: item.name, url: url,
      url_alt: item.fallbackUrl || item.media_url_alt || '',
      image: item.image || '', image_fallback: item.imageFallback || item.image_fallback || '',
      artist: item.creator_address || item.artist || '',
    });
    // Record play if it's a favorite
    const fav = library.getFavoriteByUrl(url);
    if (fav) library.recordPlay(fav.id);
  };

  const playAll = (items, startIndex = 0) => {
    if (!player) return;
    player.playAll(
      items.map(item => ({
        id: item.id, name: item.name, url: item.url || item.media_url,
        url_alt: item.fallbackUrl || item.media_url_alt || '',
        image: item.image || '', image_fallback: item.imageFallback || item.image_fallback || '',
        artist: item.creator_address || item.artist || '',
      })),
      startIndex
    );
  };

  const addToQueue = (item) => {
    if (!player) return;
    player.addToQueue({
      id: item.id, name: item.name, url: item.url || item.media_url,
      url_alt: item.fallbackUrl || item.media_url_alt || '',
      image: item.image || '', image_fallback: item.imageFallback || item.image_fallback || '',
      artist: item.creator_address || item.artist || '',
    });
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    await library.createPlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
    setShowCreatePlaylist(false);
  };

  const audioFavorites = library.favorites.filter(f => f.type === 'audio');

  return (
    <div className="h-full overflow-y-auto" data-testid="jukebox-page">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b" style={{ backgroundColor: 'rgba(3, 7, 18, 0.95)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="jukebox-back-btn">
            <FiArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <FiMusic size={18} className="text-purple-500" />
            <h1 className="text-base font-bold text-white tracking-tight">Jukebox</h1>
          </div>
          {view === 'browse' && (
            <form onSubmit={handleSubmit} className="flex-1 relative ml-3">
              <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search music, audio, podcasts..."
                className="w-full pl-9 pr-4 py-2 bg-gray-800/50 text-gray-100 rounded-lg border border-gray-700/40 focus:border-purple-500/50 focus:outline-none text-sm placeholder-gray-600"
                data-testid="jukebox-search-input"
              />
            </form>
          )}
          {view !== 'browse' && <div className="flex-1" />}
        </div>
        {/* View Tabs */}
        <div className="max-w-5xl mx-auto flex gap-1 px-4 pb-2">
          {[
            { id: 'browse', label: 'Browse', icon: FiSearch },
            { id: 'favorites', label: 'Favorites', icon: FiHeart, count: audioFavorites.length },
            { id: 'playlists', label: 'Playlists', icon: FiList, count: library.playlists.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setView(tab.id); setActivePlaylistId(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                view === tab.id ? 'bg-purple-600/20 text-purple-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
              }`}
              data-testid={`jukebox-tab-${tab.id}`}
            >
              <tab.icon size={12} />
              {tab.label}
              {tab.count > 0 && <span className="text-[10px] opacity-60">{tab.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto pb-24">
        {/* Browse View */}
        {view === 'browse' && (
          <>
            {/* Search Results */}
            {searchResults !== null && (
              <div className="px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Search Results {searchResults.total > 0 && `(${searchResults.items.length} of ${searchResults.total})`}
                  </h3>
                  {searchResults.items.length > 0 && (
                    <button onClick={() => playAll(searchResults.items)} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
                      <FiPlay size={10} /> Play All
                    </button>
                  )}
                </div>
                {searchLoading && searchResults.items.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-transparent border-t-purple-500" />
                  </div>
                ) : searchResults.items.length === 0 ? (
                  <p className="text-sm text-gray-600 text-center py-6">No audio found</p>
                ) : (
                  <>
                    <div className="space-y-1">
                      {searchResults.items.map((item, i) => (
                        <TrackRow key={`${item.id}-${item.name}-${i}`} item={item} index={i} onPlay={() => playTrack(item)} onQueue={() => addToQueue(item)} isPlaying={player?.currentTrack?.id === item.id && player?.playing} library={library} onAddToPlaylist={setAddToPlaylistItemId} />
                      ))}
                    </div>
                    {searchResults.has_more && (
                      <button
                        onClick={loadMoreSearch}
                        disabled={searchLoading}
                        className="w-full mt-4 py-2.5 text-xs text-purple-400 hover:text-purple-300 bg-gray-800/30 hover:bg-gray-800/50 rounded-lg transition-colors disabled:opacity-50"
                        data-testid="jukebox-load-more-search"
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
                    <div className="animate-spin rounded-full h-7 w-7 border-2 border-transparent border-t-purple-500" />
                  </div>
                ) : (
                  featuredKeywords.map(kw => {
                    const items = featuredRows[kw] || [];
                    if (items.length === 0) return null;
                    return (
                      <FeaturedAudioRow
                        key={kw} title={kw} items={items}
                        onPlay={playTrack} onPlayAll={playAll} onQueue={addToQueue}
                        currentTrackId={player?.currentTrack?.id} isPlaying={player?.playing}
                        library={library} onAddToPlaylist={setAddToPlaylistItemId}
                      />
                    );
                  })
                )}

                {!loading && Object.values(featuredRows).every(r => r.length === 0) && (
                  <div className="text-center py-16 space-y-3">
                    <FiMusic size={32} className="mx-auto text-gray-700" />
                    <p className="text-sm text-gray-500">No featured audio found</p>
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
            {audioFavorites.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <FiHeart size={32} className="mx-auto text-gray-700" />
                <p className="text-sm text-gray-500">No favorites yet</p>
                <p className="text-xs text-gray-600">Heart tracks while browsing to add them here</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Favorites ({audioFavorites.length})
                  </h3>
                  <button onClick={() => playAll(audioFavorites)} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
                    <FiPlay size={10} /> Play All
                  </button>
                </div>
                <div className="space-y-1">
                  {audioFavorites
                    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                    .map((fav, i) => (
                      <FavoriteTrackRow
                        key={fav.id}
                        item={fav}
                        index={i}
                        onPlay={() => playTrack(fav)}
                        onQueue={() => addToQueue(fav)}
                        onRemove={() => library.removeFavorite(fav.id)}
                        isPlaying={player?.currentTrack?.url === fav.url && player?.playing}
                        onAddToPlaylist={setAddToPlaylistItemId}
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
              <button
                onClick={() => setShowCreatePlaylist(true)}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                data-testid="jukebox-create-playlist-btn"
              >
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
                  className="flex-1 px-3 py-2 bg-gray-800/50 text-gray-100 rounded-lg border border-gray-700/40 focus:border-purple-500/50 focus:outline-none text-sm"
                  data-testid="jukebox-playlist-name-input"
                />
                <button onClick={handleCreatePlaylist} className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm"><FiCheck size={14} /></button>
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
                    <div key={pl.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/40 group" data-testid={`jukebox-playlist-${pl.id}`}>
                      <button
                        onClick={() => setActivePlaylistId(pl.id)}
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                      >
                        <div className="w-9 h-9 rounded-lg bg-purple-900/20 border border-purple-800/20 flex items-center justify-center flex-shrink-0">
                          <FiList size={14} className="text-purple-500/60" />
                        </div>
                        <div className="min-w-0">
                          {editingPlaylistId === pl.id ? (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { library.renamePlaylist(pl.id, editName); setEditingPlaylistId(null); }}}
                                className="px-2 py-0.5 bg-gray-800 text-gray-100 rounded text-xs border border-gray-700"
                              />
                              <button onClick={() => { library.renamePlaylist(pl.id, editName); setEditingPlaylistId(null); }} className="text-green-400"><FiCheck size={12} /></button>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-medium text-gray-200 truncate">{pl.name}</p>
                              <p className="text-[10px] text-gray-600">{items.length} track{items.length !== 1 ? 's' : ''}</p>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {items.length > 0 && (
                          <button onClick={() => playAll(items)} className="p-1.5 text-gray-500 hover:text-purple-400" title="Play all"><FiPlay size={12} /></button>
                        )}
                        <button onClick={() => { setEditingPlaylistId(pl.id); setEditName(pl.name); }} className="p-1.5 text-gray-500 hover:text-purple-400" title="Rename"><FiEdit2 size={12} /></button>
                        <button onClick={() => library.deletePlaylist(pl.id)} className="p-1.5 text-gray-500 hover:text-red-400" title="Delete"><FiTrash2 size={12} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Playlist Detail View */}
        {view === 'playlists' && activePlaylistId && (
          <PlaylistDetail
            playlist={library.playlists.find(p => p.id === activePlaylistId)}
            items={library.getPlaylistItems(activePlaylistId)}
            onBack={() => setActivePlaylistId(null)}
            onPlay={playTrack}
            onPlayAll={playAll}
            onQueue={addToQueue}
            onRemoveFromPlaylist={(itemId) => library.removeFromPlaylist(activePlaylistId, itemId)}
            player={player}
          />
        )}
      </div>

      {/* Add to Playlist Modal */}
      {addToPlaylistItemId && (
        <AddToPlaylistModal
          playlists={library.playlists}
          onSelect={(plId) => { library.addToPlaylist(plId, addToPlaylistItemId); setAddToPlaylistItemId(null); }}
          onClose={() => setAddToPlaylistItemId(null)}
          onCreate={async (name) => { const pl = await library.createPlaylist(name); if (pl) library.addToPlaylist(pl.id, addToPlaylistItemId); setAddToPlaylistItemId(null); }}
        />
      )}
    </div>
  );
}

function FeaturedAudioRow({ title, items, onPlay, onPlayAll, onQueue, currentTrackId, isPlaying, library, onAddToPlaylist }) {
  const scrollRef = useRef(null);
  return (
    <div data-testid={`jukebox-row-${title}`}>
      <div className="flex items-center justify-between px-4 mb-2">
        <h3 className="text-sm font-semibold text-gray-200 capitalize">{title}</h3>
        <button onClick={() => onPlayAll(items)} className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
          <FiPlay size={10} /> Play All
        </button>
      </div>
      <div ref={scrollRef} className="px-4 space-y-1">
        {items.slice(0, 15).map((item, i) => (
          <TrackRow key={`${item.id}-${item.name}-${i}`} item={item} index={i} onPlay={() => onPlay(item)} onQueue={() => onQueue(item)} isPlaying={currentTrackId === item.id && isPlaying} library={library} onAddToPlaylist={onAddToPlaylist} />
        ))}
      </div>
    </div>
  );
}

function TrackThumb({ image, fallback }) {
  const [src, setSrc] = useState(image);
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return <FiMusic size={14} className="text-purple-500/40" />;
  return (
    <img src={src} alt="" className="w-full h-full object-cover" onError={() => {
      if (!tried && fallback && fallback !== src) {
        setTried(true);
        setSrc(fallback);
      } else {
        setFailed(true);
      }
    }} />
  );
}


function TrackRow({ item, index, onPlay, onQueue, isPlaying, library, onAddToPlaylist }) {
  const [loadError, setLoadError] = useState(false);
  const isFav = library?.isFavorite(item.media_url || item.url);
  const fav = library?.getFavoriteByUrl(item.media_url || item.url);

  const handleReportDead = () => {
    if (!item.media_url) return;
    const ref = item.media_url.replace('https://ipfs.io/ipfs/', '');
    fetch(`${API}/ipfs/report-dead`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, reason: 'user_report' }),
    }).catch(() => {});
    setLoadError(true);
  };

  if (loadError) return null;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
        isPlaying ? 'bg-purple-900/20 ring-1 ring-purple-700/30' : 'hover:bg-gray-800/40'
      }`}
      data-testid={`jukebox-track-${item.id}`}
    >
      <button onClick={onPlay} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-gray-800/50 group-hover:bg-purple-600 text-gray-500 group-hover:text-white">
        {isPlaying ? <FiPause size={12} /> : <FiPlay size={12} className="ml-0.5" />}
      </button>
      <div className="w-9 h-9 rounded bg-gray-800/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {item.image ? (
          <TrackThumb image={item.image} fallback={item.image_fallback || item.imageFallback} />
        ) : (
          <FiMusic size={14} className="text-purple-500/40" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isPlaying ? 'text-purple-400' : 'text-gray-200'}`}>{item.name || 'Untitled'}</p>
        <p className="text-[10px] text-gray-600 truncate">{item.type} {item.blockchain && `on ${item.blockchain}`}</p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => library?.toggleFavorite({ ...item, url: item.media_url || item.url, type: 'audio' })}
          className={`p-1.5 transition-colors ${isFav ? 'text-pink-500' : 'text-gray-500 hover:text-pink-400'}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          data-testid={`jukebox-fav-${item.id}`}
        >
          <FiHeart size={12} fill={isFav ? 'currentColor' : 'none'} />
        </button>
        {fav && onAddToPlaylist && (
          <button onClick={() => onAddToPlaylist(fav.id)} className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors" title="Add to playlist">
            <FiList size={12} />
          </button>
        )}
        <button onClick={onQueue} className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors" title="Add to queue" data-testid={`jukebox-queue-${item.id}`}>
          <FiPlus size={12} />
        </button>
        <button onClick={handleReportDead} className="p-1.5 text-gray-600 hover:text-red-400 transition-colors" title="Report dead link">
          <FiAlertCircle size={12} />
        </button>
      </div>
    </div>
  );
}


function FavoriteTrackRow({ item, index, onPlay, onQueue, onRemove, isPlaying, onAddToPlaylist }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
        isPlaying ? 'bg-purple-900/20 ring-1 ring-purple-700/30' : 'hover:bg-gray-800/40'
      }`}
      data-testid={`jukebox-fav-track-${item.id}`}
    >
      <button onClick={onPlay} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-gray-800/50 group-hover:bg-purple-600 text-gray-500 group-hover:text-white">
        {isPlaying ? <FiPause size={12} /> : <FiPlay size={12} className="ml-0.5" />}
      </button>
      <div className="w-9 h-9 rounded bg-gray-800/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {item.image ? (
          <TrackThumb image={item.image} fallback={item.imageFallback} />
        ) : (
          <FiMusic size={14} className="text-purple-500/40" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isPlaying ? 'text-purple-400' : 'text-gray-200'}`}>{item.name}</p>
        <div className="flex items-center gap-2 text-[10px] text-gray-600">
          {item.playCount > 0 && <span className="flex items-center gap-0.5"><FiBarChart2 size={8} />{item.playCount} plays</span>}
          {item.lastPlayed && <span className="flex items-center gap-0.5"><FiClock size={8} />{new Date(item.lastPlayed).toLocaleDateString()}</span>}
          {item.chain && <span>{item.chain}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onAddToPlaylist && (
          <button onClick={() => onAddToPlaylist(item.id)} className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors" title="Add to playlist">
            <FiList size={12} />
          </button>
        )}
        <button onClick={onQueue} className="p-1.5 text-gray-500 hover:text-purple-400 transition-colors" title="Queue"><FiPlus size={12} /></button>
        <button onClick={onRemove} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors" title="Remove"><FiTrash2 size={12} /></button>
      </div>
    </div>
  );
}

function PlaylistDetail({ playlist, items, onBack, onPlay, onPlayAll, onQueue, onRemoveFromPlaylist, player }) {
  if (!playlist) return null;
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-200"><FiArrowLeft size={16} /></button>
        <div>
          <h3 className="text-sm font-semibold text-gray-200">{playlist.name}</h3>
          <p className="text-[10px] text-gray-600">{items.length} track{items.length !== 1 ? 's' : ''}</p>
        </div>
        {items.length > 0 && (
          <button onClick={() => onPlayAll(items)} className="ml-auto text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
            <FiPlay size={10} /> Play All
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <FiMusic size={24} className="mx-auto text-gray-700" />
          <p className="text-xs text-gray-600">This playlist is empty</p>
          <p className="text-[10px] text-gray-700">Favorite tracks and add them to this playlist</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
                player?.currentTrack?.url === item.url && player?.playing ? 'bg-purple-900/20 ring-1 ring-purple-700/30' : 'hover:bg-gray-800/40'
              }`}
            >
              <button onClick={() => onPlay(item)} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors bg-gray-800/50 group-hover:bg-purple-600 text-gray-500 group-hover:text-white">
                {player?.currentTrack?.url === item.url && player?.playing ? <FiPause size={12} /> : <FiPlay size={12} className="ml-0.5" />}
              </button>
              <div className="w-9 h-9 rounded bg-gray-800/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {item.image ? <TrackThumb image={item.image} fallback={item.imageFallback} /> : <FiMusic size={14} className="text-purple-500/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">{item.name}</p>
                {item.playCount > 0 && <p className="text-[10px] text-gray-600">{item.playCount} plays</p>}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onQueue(item)} className="p-1.5 text-gray-500 hover:text-purple-400"><FiPlus size={12} /></button>
                <button onClick={() => onRemoveFromPlaylist(item.id)} className="p-1.5 text-gray-500 hover:text-red-400" title="Remove from playlist"><FiX size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddToPlaylistModal({ playlists, onSelect, onClose, onCreate }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-80 max-h-96 overflow-hidden" onClick={e => e.stopPropagation()} data-testid="add-to-playlist-modal">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">Add to Playlist</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><FiX size={16} /></button>
        </div>
        <div className="overflow-y-auto max-h-64 p-2 space-y-1">
          {playlists.map(pl => (
            <button
              key={pl.id}
              onClick={() => onSelect(pl.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/60 text-left"
            >
              <FiList size={14} className="text-purple-500/60 flex-shrink-0" />
              <span className="text-xs text-gray-300 truncate">{pl.name}</span>
              <span className="text-[10px] text-gray-600 ml-auto">{pl.itemIds.length}</span>
            </button>
          ))}
          {creating ? (
            <div className="flex gap-1 px-2">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && onCreate(name.trim())}
                placeholder="Playlist name..."
                className="flex-1 px-2 py-1.5 bg-gray-800 text-gray-100 rounded text-xs border border-gray-700"
              />
              <button onClick={() => name.trim() && onCreate(name.trim())} className="px-2 py-1.5 bg-purple-600 text-white rounded text-xs"><FiCheck size={12} /></button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/60 text-gray-500 hover:text-gray-300">
              <FiPlus size={14} />
              <span className="text-xs">New Playlist</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
