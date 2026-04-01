import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FiSearch, FiX, FiLoader } from 'react-icons/fi';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const SUGGESTED_TAGS = ['gif', 'FEG', 'meme', 'sup', 'pepe', 'bitcoin', 'doge', 'art', 'love', 'lol'];
const GIPHY_TAGS = ['funny', 'reaction', 'yes', 'no', 'wow', 'love', 'sad', 'dance', 'thumbs up', 'facepalm'];

const GifThumb = ({ gif, index, onSelect }) => {
  const [status, setStatus] = useState('loading');
  return (
    <button
      onClick={() => onSelect(gif)}
      className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 hover:ring-2 hover:ring-blue-500 transition-all group"
      data-testid={`gif-item-${index}`}
    >
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-700/40 to-gray-800/60" />
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600">
          <span className="text-xs">GIF</span>
        </div>
      )}
      <img
        src={gif.url}
        alt=""
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      {gif.source === 'giphy' && (
        <div className="absolute bottom-0.5 right-0.5 text-[7px] bg-black/60 text-gray-400 px-1 rounded">GIPHY</div>
      )}
    </button>
  );
};

export const GifSelector = ({ network, onSelect, onClose }) => {
  const [tab, setTab] = useState('giphy');
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  const fetchOnChain = useCallback(async (keyword) => {
    if (!keyword.trim()) { setGifs([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      const res = await fetch(`${API}/gifs/search/${encodeURIComponent(keyword.trim())}?network=${network || 'btc-testnet'}`);
      if (res.ok) { const data = await res.json(); setGifs(data.gifs || []); }
    } catch { /* silent */ }
    setLoading(false);
  }, [network]);

  const fetchGiphy = useCallback(async (keyword) => {
    if (!keyword.trim()) { setGifs([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      const res = await fetch(`${API}/gifs/giphy/${encodeURIComponent(keyword.trim())}`);
      if (res.ok) { const data = await res.json(); setGifs(data.gifs || []); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    const defaultQ = tab === 'giphy' ? 'funny' : 'gif';
    setQuery(defaultQ);
    if (tab === 'giphy') fetchGiphy(defaultQ);
    else fetchOnChain(defaultQ);
  }, [tab, fetchOnChain, fetchGiphy]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (tab === 'giphy') fetchGiphy(val);
      else fetchOnChain(val);
    }, 600);
  };

  const handleTagClick = (tag) => {
    setQuery(tag);
    if (tab === 'giphy') fetchGiphy(tag);
    else fetchOnChain(tag);
  };

  const handleSelect = async (gif) => {
    if (gif.source === 'giphy' && gif.full_url) {
      try {
        const res = await fetch(`${API}/gifs/giphy/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: gif.full_url, filename: `${gif.giphy_id || 'giphy'}.gif` }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ref) {
            onSelect({ ref: data.ref, url: gif.full_url });
            if (onClose) onClose();
            return;
          }
        }
      } catch { /* fallback to direct URL */ }
      onSelect({ ref: gif.full_url, url: gif.full_url });
    } else {
      onSelect({ ref: gif.ref, url: gif.url });
    }
    if (onClose) onClose();
  };

  const tags = tab === 'giphy' ? GIPHY_TAGS : SUGGESTED_TAGS;

  return (
    <div className="flex flex-col border-t border-gray-700 rounded-t-xl overflow-hidden" style={{ maxHeight: '360px', background: '#111827' }} data-testid="gif-selector">
      {/* Tabs + Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700/50" style={{ background: 'rgba(31,41,55,0.8)' }}>
        <div className="flex gap-1 mr-1">
          <button onClick={() => setTab('giphy')}
            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${tab === 'giphy' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            data-testid="gif-tab-giphy">Giphy</button>
          <button onClick={() => setTab('onchain')}
            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${tab === 'onchain' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            data-testid="gif-tab-onchain">On-Chain</button>
        </div>
        <FiSearch size={13} className="text-gray-500 flex-shrink-0" />
        <input
          type="text" value={query} onChange={handleInputChange}
          placeholder={tab === 'giphy' ? 'Search Giphy GIFs...' : 'Search on-chain GIFs...'}
          autoFocus
          className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
          data-testid="gif-search-input"
        />
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-0.5" data-testid="gif-close-btn">
            <FiX size={16} />
          </button>
        )}
      </div>

      {/* Quick tags */}
      <div className="flex gap-1.5 px-3 py-1.5 overflow-x-auto" style={{ background: 'rgba(31,41,55,0.4)' }} data-testid="gif-tags">
        {tags.map(tag => (
          <button key={tag} onClick={() => handleTagClick(tag)}
            className={`px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
              query === tag ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`} data-testid={`gif-tag-${tag}`}>
            {tag}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0" style={{ maxHeight: '260px' }} data-testid="gif-grid">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <FiLoader size={20} className="text-gray-500 animate-spin" />
          </div>
        ) : gifs.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {gifs.map((gif, i) => (
              <GifThumb key={(gif.ref || gif.giphy_id) + i} gif={gif} index={i} onSelect={handleSelect} />
            ))}
          </div>
        ) : searched ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <p className="text-sm">No GIFs found for &quot;{query}&quot;</p>
            {tab === 'giphy' && <p className="text-[10px] mt-1 text-gray-600">Powered by GIPHY</p>}
          </div>
        ) : null}
      </div>

      {/* Giphy attribution */}
      {tab === 'giphy' && gifs.length > 0 && (
        <div className="text-center py-1 border-t border-gray-700/30" style={{ background: 'rgba(31,41,55,0.4)' }}>
          <span className="text-[8px] text-gray-500">Powered by GIPHY</span>
        </div>
      )}
    </div>
  );
};
