import { useState, useEffect, useCallback } from 'react';

const FEE_APIS = {
  'btc-testnet': 'https://mempool.space/testnet/api/v1/fees/recommended',
  'btc-mainnet': 'https://mempool.space/api/v1/fees/recommended',
  'ltc-testnet': 'https://litecoinspace.org/testnet/api/v1/fees/recommended',
  'ltc-mainnet': 'https://litecoinspace.org/api/v1/fees/recommended',
};

const TIERS = [
  { key: 'economy', label: 'Economy', desc: '~1 hr', field: 'economyFee' },
  { key: 'normal', label: 'Normal', desc: '~30 min', field: 'halfHourFee' },
  { key: 'priority', label: 'Priority', desc: '~10 min', field: 'fastestFee' },
];

const FIXED_RATE_CHAINS = ['dog', 'doge', 'mzc'];

export default function FeePicker({ network, onChange }) {
  const [rates, setRates] = useState(null);
  const [selected, setSelected] = useState('normal');
  const [loading, setLoading] = useState(true);

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
          const defaultRate = Math.max(data.halfHourFee || 3, data.minimumFee || 1);
          persist(defaultRate);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRates({ economyFee: 2, halfHourFee: 3, fastestFee: 6, minimumFee: 1 });
          persist(3);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chain, isFixed, persist]);

  const handleSelect = (tier) => {
    setSelected(tier.key);
    const rate = rates?.[tier.field] || 3;
    persist(rate);
  };

  if (isFixed) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-1" data-testid="fee-picker-fixed">
        <span className="text-gray-400">Fee:</span>
        <span className="text-gray-300">1 sat/vB (fixed)</span>
      </div>
    );
  }

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
                {rate} sat/vB
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
