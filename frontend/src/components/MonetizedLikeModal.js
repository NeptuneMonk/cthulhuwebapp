import React, { useState, useRef, useEffect } from 'react';
import { FiHeart, FiX, FiZap, FiArrowLeft } from 'react-icons/fi';

const PRESETS = [1000, 5000, 10000, 50000];

export function MonetizedLikeModal({ txid, authorUrn, authorAddress, onConfirm, onClose }) {
  const [amount, setAmount] = useState('1000');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const sats = parseInt(amount, 10) || 0;
  const isValid = sats >= 546;

  const handleConfirm = async () => {
    if (!isValid || sending) return;
    setSending(true);
    await onConfirm(sats);
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 lg:flex lg:items-center lg:justify-center bg-black/70 backdrop-blur-sm lg:p-4" onClick={onClose}>
      <div
        className="w-full h-full bg-gray-900 lg:h-auto lg:max-w-xs lg:mx-4 lg:rounded-2xl lg:border lg:border-gray-700/50 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
        data-testid="monetized-like-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors lg:hidden" data-testid="monetized-like-back">
              <FiArrowLeft size={20} />
            </button>
            <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center">
              <FiHeart size={16} className="text-pink-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-200">Tip {authorUrn || 'author'}</p>
              <p className="text-[10px] text-gray-600 font-mono">{authorAddress?.substring(0, 16)}...</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors hidden lg:block" data-testid="monetized-like-close">
            <FiX size={18} />
          </button>
        </div>

        {/* Amount input */}
        <div className="px-4 py-3">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 block">Tip Amount (sats)</label>
          <input
            ref={inputRef}
            type="number"
            min="546"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-lg font-mono text-gray-100 focus:outline-none focus:border-pink-500/50 text-center"
            placeholder="1000"
            data-testid="monetized-like-amount"
          />
          {sats > 0 && (
            <p className="text-[10px] text-gray-600 text-center mt-1">
              ~ {(sats / 100_000_000).toFixed(8)} BTC
            </p>
          )}
        </div>

        {/* Presets */}
        <div className="px-4 pb-3 flex gap-2 justify-center">
          {PRESETS.map(p => (
            <button
              key={p}
              onClick={() => setAmount(String(p))}
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono border transition-colors ${
                sats === p
                  ? 'bg-pink-500/15 border-pink-500/40 text-pink-400'
                  : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:text-gray-300 hover:border-gray-600'
              }`}
              data-testid={`tip-preset-${p}`}
            >
              {p >= 1000 ? `${p / 1000}k` : p}
            </button>
          ))}
        </div>

        {/* Confirm */}
        <div className="px-4 pb-4">
          <button
            onClick={handleConfirm}
            disabled={!isValid || sending}
            className="w-full py-2.5 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-30 bg-pink-600 hover:bg-pink-500 text-white"
            data-testid="monetized-like-confirm"
          >
            <FiZap size={14} />
            {sending ? 'Broadcasting...' : `Send ${sats.toLocaleString()} sats`}
          </button>
          {!isValid && sats > 0 && (
            <p className="text-[10px] text-red-400 text-center mt-1">Minimum 546 sats (dust limit)</p>
          )}
        </div>
      </div>
    </div>
  );
}
