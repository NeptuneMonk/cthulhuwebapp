import { useState, useEffect, useCallback, useRef } from 'react';
import { FiZap } from 'react-icons/fi';

const FEE_APIS = {
  'btc-testnet': 'https://mempool.space/testnet/api/v1/fees/recommended',
  'btc-mainnet': 'https://mempool.space/api/v1/fees/recommended',
  'ltc-testnet': 'https://litecoinspace.org/testnet/api/v1/fees/recommended',
  'ltc-mainnet': 'https://litecoinspace.org/api/v1/fees/recommended',
};

const TIERS = [
  { key: 'economy', label: 'Economy', desc: '~1 hr', field: 'economyFee', floor: 3 },
  { key: 'normal', label: 'Normal', desc: '~30 min', field: 'halfHourFee', floor: 7 },
  { key: 'priority', label: 'Priority', desc: '~10 min', field: 'fastestFee', floor: 15 },
];

const FIXED_RATE_CHAINS = ['dog', 'doge', 'mzc'];

export default function FeePicker({ network, onChange, compact = false }) {
  const [rates, setRates] = useState(null);
  const [selected, setSelected] = useState('normal');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const chain = (network || 'btc-testnet').toLowerCase();
  const isFixed = FIXED_RATE_CHAINS.some(c => chain.includes(c));

  const persist = useCallback((rate) => {
    try { sessionStorage.setItem('cthulhu_fee_rate', String(rate)); } catch {}
    onChange?.(rate);
  }, [onChange]);

  useEffect(() => {
    if (isFixed) {
      setRates({ economyFee: 1, halfHourFee: 1, fastestFee: 2, minimumFee: 1 });
      persist(1);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const apiUrl = FEE_APIS[chain] || FEE_APIS['btc-testnet'];

    (async () => {
      try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        if (!cancelled) {
          setRates(data);
          const normalFloor = TIERS.find(t => t.key === 'normal').floor;
          const defaultRate = Math.max(data.halfHourFee || 3, normalFloor, data.minimumFee || 1);
          persist(defaultRate);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRates({ economyFee: 3, halfHourFee: 7, fastestFee: 15, minimumFee: 1 });
          persist(7);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chain, isFixed, persist]);

  // Close popup on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (tier) => {
    setSelected(tier.key);
    const rate = Math.max(rates?.[tier.field] || 3, tier.floor);
    persist(rate);
    if (compact) setOpen(false);
  };

  const currentTier = TIERS.find(t => t.key === selected);
  const currentRate = Math.max(rates?.[currentTier?.field] || 7, currentTier?.floor || 7);

  if (isFixed) {
    if (compact) return null; // No picker needed for fixed-fee chains in compact mode
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-1" data-testid="fee-picker-fixed">
        <span className="text-gray-400">Fee:</span>
        <span className="text-gray-300">1 sat/vB (fixed)</span>
      </div>
    );
  }

  // ── Compact mode: lightning icon + popup ──
  if (compact) {
    return (
      <div className="relative" ref={ref} data-testid="fee-picker-compact">
        <button
          type="button"
          onClick={() => setOpen(p => !p)}
          data-testid="fee-picker-toggle"
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all border ${
            open
              ? 'bg-purple-600/30 border-purple-500 text-purple-300'
              : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
          }`}
          title={`Fee: ${loading ? '...' : `${currentRate} sat/vB (${currentTier?.label})`}`}
        >
          <FiZap size={12} />
          {!loading && <span>{currentRate}</span>}
        </button>

        {open && !loading && (
          <div className="absolute bottom-full mb-2 right-0 z-50 bg-gray-900 border border-gray-700 rounded-xl p-2 shadow-xl min-w-[200px]">
            <div className="text-[10px] text-gray-500 px-1 pb-1.5">Network fee (sat/vB)</div>
            <div className="space-y-1">
              {TIERS.map(tier => {
                const rate = Math.max(rates?.[tier.field] || 3, tier.floor);
                const isActive = selected === tier.key;
                return (
                  <button
                    key={tier.key}
                    type="button"
                    onClick={() => handleSelect(tier)}
                    data-testid={`fee-tier-${tier.key}`}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all ${
                      isActive
                        ? 'bg-purple-600/25 text-purple-300'
                        : 'text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FiZap size={11} className={isActive ? 'text-purple-400' : 'text-gray-600'} />
                      <span className="font-medium">{tier.label}</span>
                      <span className={`text-[10px] ${isActive ? 'text-purple-400/70' : 'text-gray-600'}`}>{tier.desc}</span>
                    </div>
                    <span className={`font-mono ${isActive ? 'text-purple-300' : 'text-gray-500'}`}>{rate}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Full inline mode (for dedicated modals) ──
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-1" data-testid="fee-picker-loading">
        <span className="text-gray-400">Fetching fee rates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="fee-picker">
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <FiZap size={11} />
        <span>Network fee</span>
        <span className="text-gray-600">(sat/vB)</span>
      </div>
      <div className="flex gap-1.5">
        {TIERS.map(tier => {
          const rate = rates?.[tier.field] || 3;
          const isActive = selected === tier.key;
          return (
            <button
              key={tier.key}
              type="button"
              onClick={() => handleSelect(tier)}
              data-testid={`fee-tier-${tier.key}`}
              className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all border ${
                isActive
                  ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div>{tier.label}</div>
              <div className={`text-[10px] mt-0.5 ${isActive ? 'text-purple-400' : 'text-gray-500'}`}>
                {Math.max(rate, tier.floor)} sat/vB
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
