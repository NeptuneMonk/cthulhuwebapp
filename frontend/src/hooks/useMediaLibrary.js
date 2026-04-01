/**
 * useMediaLibrary — Persistent favorites, playlists, and play tracking.
 * Syncs with the backend /api/favorites endpoint.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/favorites`;

export function useMediaLibrary(address, network) {
  const [favorites, setFavorites] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  // Load library on mount
  useEffect(() => {
    if (!address || loadedRef.current) return;
    loadedRef.current = true;
    fetch(`${API}/${address}?network=${encodeURIComponent(network || 'btc-testnet')}`)
      .then(r => r.json())
      .then(data => {
        setFavorites(data.favorites || []);
        setPlaylists(data.playlists || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [address, network]);

  const isFavorite = useCallback((url) => {
    return favorites.some(f => f.url === url);
  }, [favorites]);

  const getFavoriteByUrl = useCallback((url) => {
    return favorites.find(f => f.url === url) || null;
  }, [favorites]);

  const addFavorite = useCallback(async (item) => {
    if (!address) return null;
    try {
      const res = await fetch(`${API}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          network: network || 'btc-testnet',
          url: item.url || item.media_url,
          fallbackUrl: item.fallbackUrl || item.media_url_alt || item.url_alt || '',
          name: item.name || 'Untitled',
          type: item.type || 'audio',
          chain: item.chain || item.blockchain || '',
          image: item.image || '',
          imageFallback: item.imageFallback || item.image_fallback || '',
        }),
      });
      const data = await res.json();
      if (data.item) {
        setFavorites(prev => [...prev, data.item]);
      }
      return data;
    } catch {
      return null;
    }
  }, [address, network]);

  const removeFavorite = useCallback(async (id) => {
    if (!address) return;
    setFavorites(prev => prev.filter(f => f.id !== id));
    try {
      await fetch(`${API}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', id }),
      });
    } catch {}
  }, [address, network]);

  const toggleFavorite = useCallback(async (item) => {
    const url = item.url || item.media_url;
    const existing = favorites.find(f => f.url === url);
    if (existing) {
      await removeFavorite(existing.id);
      return false;
    }
    await addFavorite(item);
    return true;
  }, [favorites, addFavorite, removeFavorite]);

  const recordPlay = useCallback(async (id) => {
    if (!address || !id) return;
    setFavorites(prev => prev.map(f =>
      f.id === id ? { ...f, playCount: (f.playCount || 0) + 1, lastPlayed: new Date().toISOString() } : f
    ));
    try {
      await fetch(`${API}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', id }),
      });
    } catch {}
  }, [address, network]);

  const createPlaylist = useCallback(async (name) => {
    if (!address || !name) return null;
    try {
      const res = await fetch(`${API}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', name, itemIds: [] }),
      });
      const data = await res.json();
      if (data.id) {
        const pl = { id: data.id, name, createdAt: new Date().toISOString(), itemIds: [] };
        setPlaylists(prev => [...prev, pl]);
        return pl;
      }
    } catch {}
    return null;
  }, [address, network]);

  const deletePlaylist = useCallback(async (id) => {
    if (!address) return;
    setPlaylists(prev => prev.filter(p => p.id !== id));
    try {
      await fetch(`${API}/playlist/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', id }),
      });
    } catch {}
  }, [address, network]);

  const addToPlaylist = useCallback(async (playlistId, itemId) => {
    if (!address) return;
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, itemIds: [...new Set([...p.itemIds, itemId])] } : p
    ));
    try {
      await fetch(`${API}/playlist/add-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', playlistId, itemId }),
      });
    } catch {}
  }, [address, network]);

  const removeFromPlaylist = useCallback(async (playlistId, itemId) => {
    if (!address) return;
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId ? { ...p, itemIds: p.itemIds.filter(i => i !== itemId) } : p
    ));
    try {
      await fetch(`${API}/playlist/remove-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', playlistId, itemId }),
      });
    } catch {}
  }, [address, network]);

  const renamePlaylist = useCallback(async (id, name) => {
    if (!address) return;
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name } : p));
    try {
      await fetch(`${API}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, network: network || 'btc-testnet', id, name, itemIds: pl.itemIds }),
      });
    } catch {}
  }, [address, network, playlists]);

  // Helper: get favorite items for a playlist
  const getPlaylistItems = useCallback((playlistId) => {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return [];
    return pl.itemIds.map(id => favorites.find(f => f.id === id)).filter(Boolean);
  }, [playlists, favorites]);

  return {
    favorites,
    playlists,
    loaded,
    isFavorite,
    getFavoriteByUrl,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    recordPlay,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    renamePlaylist,
    getPlaylistItems,
  };
}
