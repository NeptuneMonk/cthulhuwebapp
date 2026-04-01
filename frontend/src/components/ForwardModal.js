import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FiX, FiSearch, FiSend, FiUser, FiArrowLeft } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export function ForwardModal({ message, network, onConfirm, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null); // { address, urn, image }
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const searchTimer = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/known-users/${network}?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const users = data.users || data || [];
        const lq = q.toLowerCase();
        const matches = users.filter(u =>
          (u.urn || '').toLowerCase().includes(lq) ||
          (u.display_name || '').toLowerCase().includes(lq) ||
          (u.address || '').toLowerCase().includes(lq)
        ).slice(0, 10);
        setResults(matches);
      }
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [network]);

  const handleQueryChange = (val) => {
    setQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 300);
  };

  // Check if query is a raw address (>= 26 chars, base58-like)
  const isRawAddress = query.length >= 26 && /^[13mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(query);

  const handleSelectUser = (u) => {
    setSelected({ address: u.address, urn: u.urn || u.display_name, image: u.image });
    setQuery('');
    setResults([]);
  };

  const handleSelectRawAddress = () => {
    setSelected({ address: query, urn: query.substring(0, 12) + '...', image: null });
    setQuery('');
    setResults([]);
  };

  const handleSend = async () => {
    if (!selected || sending) return;
    setSending(true);
    await onConfirm(message.txid, selected.address, note);
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 lg:flex lg:items-center lg:justify-center bg-black/70 backdrop-blur-sm lg:p-4" onClick={onClose}>
      <div
        className="w-full h-full bg-gray-900 lg:h-auto lg:max-w-sm lg:mx-4 lg:rounded-2xl lg:border lg:border-gray-700/50 shadow-2xl lg:max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        data-testid="forward-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors lg:hidden" data-testid="forward-back">
              <FiArrowLeft size={20} />
            </button>
            <h3 className="text-sm font-medium text-gray-200">Forward Message</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 hidden lg:block" data-testid="forward-close">
            <FiX size={18} />
          </button>
        </div>

        {/* Original message preview */}
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700/30">
          <p className="text-[10px] text-gray-500 mb-0.5">from {message.senderUrn}</p>
          <p className="text-xs text-gray-300 line-clamp-2">{message.content || '(media)'}</p>
        </div>

        {/* Selected recipient */}
        {selected && (
          <div className="mx-4 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-900/20 border border-teal-800/30">
            <ProfileThumb name={selected.urn} image={selected.image} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-teal-300 truncate">{selected.urn}</p>
              <p className="text-[10px] text-gray-600 font-mono truncate">{selected.address}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-500 hover:text-red-400 transition-colors"
              data-testid="forward-remove-recipient"
            >
              <FiX size={14} />
            </button>
          </div>
        )}

        {/* Search input */}
        {!selected && (
          <div className="px-4 mb-2">
            <div className="relative">
              <FiSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                placeholder="Search by URN or paste address..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-500/50"
                data-testid="forward-search-input"
              />
            </div>
          </div>
        )}

        {/* Search results */}
        {!selected && (results.length > 0 || isRawAddress) && (
          <div className="px-4 mb-3 max-h-40 overflow-y-auto space-y-0.5">
            {isRawAddress && (
              <button
                onClick={handleSelectRawAddress}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                data-testid="forward-raw-address"
              >
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                  <FiUser size={14} className="text-gray-400" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs text-gray-300 font-mono truncate">{query}</p>
                  <p className="text-[10px] text-gray-600">Send to this address</p>
                </div>
              </button>
            )}
            {results.map(u => (
              <button
                key={u.address}
                onClick={() => handleSelectUser(u)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                data-testid={`forward-user-${u.urn || u.address}`}
              >
                <ProfileThumb name={u.urn || u.display_name} image={u.image} size="sm" />
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs text-gray-200 truncate">{u.display_name || u.urn}</p>
                  <p className="text-[10px] text-gray-500 truncate">@{u.urn}</p>
                </div>
              </button>
            ))}
            {loading && <p className="text-[10px] text-gray-600 text-center py-2">Searching...</p>}
          </div>
        )}

        {/* Optional note */}
        {selected && (
          <div className="px-4 mb-3">
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value.slice(0, 100))}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Add a note (optional)..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-500/50"
              data-testid="forward-note-input"
            />
          </div>
        )}

        {/* Send button */}
        <div className="px-4 pb-4 flex-shrink-0">
          <button
            onClick={handleSend}
            disabled={!selected || sending}
            className="w-full py-2.5 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-30 bg-teal-600 hover:bg-teal-500 text-white"
            data-testid="forward-send-btn"
          >
            <FiSend size={14} />
            {sending ? 'Forwarding...' : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}
