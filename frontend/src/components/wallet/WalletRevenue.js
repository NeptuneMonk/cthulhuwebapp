import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiTrendingUp, FiArrowDownLeft, FiAward, FiRepeat, FiKey,
  FiLoader, FiRefreshCw, FiExternalLink
} from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { getRoyaltyAddresses } from '@/utils/royaltyAddresses';
import { getCachedChangeAddress, getCachedRoyaltiesAddress } from '@/utils/txBuilder';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export const WalletRevenue = ({ network }) => {
  const { wallet } = useWallet();
  const { user } = useAuth();
  const [revenueData, setRevenueData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all');

  const mainAddress = user?.address || wallet?.address;
  const urn = user?.urn || '';

  const formatBTC = (sats) => {
    if (!sats && sats !== 0) return '0.00000000';
    return (sats / 1e8).toFixed(8);
  };

  const formatCompact = (sats) => {
    if (!sats) return '0';
    if (sats >= 1e8) return (sats / 1e8).toFixed(4) + ' BTC';
    if (sats >= 1e5) return (sats / 1e5).toFixed(1) + 'k sats';
    return sats.toLocaleString() + ' sats';
  };

  // Build address map
  const addressMap = useMemo(() => {
    const map = {};
    if (!mainAddress) return map;
    map[mainAddress] = { type: 'main', label: 'Main Address', icon: 'key' };

    const changeAddr = getCachedChangeAddress(mainAddress);
    if (changeAddr) map[changeAddr] = { type: 'change', label: 'Change Address', icon: 'repeat' };

    const defaultRoy = getCachedRoyaltiesAddress(mainAddress);
    if (defaultRoy) map[defaultRoy] = { type: 'royalty', label: 'Default Royalty', icon: 'award' };

    const namedRoyalties = getRoyaltyAddresses(urn, network);
    for (const r of namedRoyalties) {
      if (!map[r.address]) {
        map[r.address] = { type: 'royalty', label: r.label || 'Royalty', icon: 'award' };
      }
    }

    return map;
  }, [mainAddress, urn, network]);

  const fetchRevenue = useCallback(async () => {
    const addresses = Object.keys(addressMap);
    if (!addresses.length) return;
    // Only show loading spinner on initial load, not refreshes
    if (!revenueData) setLoading(true);
    try {
      const results = await Promise.all(
        addresses.map(addr =>
          axios.get(`${API}/wallet/address-txs/${addr}`, { params: { network } })
            .then(res => ({ addr, txs: res.data?.transactions || [] }))
            .catch(() => ({ addr, txs: [] }))
        )
      );

      // Build a set of all user-owned addresses for self-transaction detection
      const ownAddresses = new Set(addresses);

      // Build a set of txids where the user is the SENDER (outgoing from any owned address)
      // These represent self-spends — their change outputs are NOT income
      const selfSpendTxids = new Set();
      for (const { addr, txs } of results) {
        for (const tx of txs) {
          if (!tx.is_incoming && tx.sent_sats > 0) {
            selfSpendTxids.add(tx.txid);
          }
        }
      }

      // Calculate revenue by source
      const now = Date.now() / 1000;
      const ranges = {
        '7d': now - 7 * 86400,
        '30d': now - 30 * 86400,
        '90d': now - 90 * 86400,
        'all': 0,
      };
      const cutoff = ranges[timeRange] || 0;

      const bySource = {};
      let totalIncome = 0;
      let totalOutgoing = 0;
      let txCount = 0;
      const recentIncoming = [];

      for (const { addr, txs } of results) {
        const meta = addressMap[addr];
        const sourceKey = `${meta.type}:${addr}`;
        if (!bySource[sourceKey]) {
          bySource[sourceKey] = { ...meta, address: addr, income: 0, outgoing: 0, txCount: 0 };
        }

        for (const tx of txs) {
          if (cutoff > 0 && tx.block_time && tx.block_time < cutoff) continue;

          if (tx.is_incoming && tx.received_sats > 0) {
            // Skip dust (546 sats) — P2FK data, not real income
            if (tx.received_sats <= 546) continue;
            // Skip self-change: if this txid is also an outgoing tx from one of our addresses,
            // the "income" on this address is just change returning to us, not real revenue
            if (selfSpendTxids.has(tx.txid)) continue;

            bySource[sourceKey].income += tx.received_sats;
            bySource[sourceKey].txCount++;
            totalIncome += tx.received_sats;
            txCount++;
            recentIncoming.push({
              ...tx,
              source: meta,
              sourceAddress: addr,
            });
          } else if (!tx.is_incoming && tx.sent_sats > 0) {
            bySource[sourceKey].outgoing += tx.sent_sats;
            totalOutgoing += tx.sent_sats;
          }
        }
      }

      // Sort recent incoming by time
      recentIncoming.sort((a, b) => (b.block_time || Infinity) - (a.block_time || Infinity));

      // Group by type
      const byType = { main: 0, change: 0, royalty: 0 };
      const countByType = { main: 0, change: 0, royalty: 0 };
      for (const src of Object.values(bySource)) {
        byType[src.type] = (byType[src.type] || 0) + src.income;
        countByType[src.type] = (countByType[src.type] || 0) + src.txCount;
      }

      setRevenueData({
        totalIncome,
        totalOutgoing,
        txCount,
        bySource: Object.values(bySource).filter(s => s.income > 0 || s.outgoing > 0),
        byType,
        countByType,
        recentIncoming: recentIncoming.slice(0, 15),
      });
    } catch (err) {
      console.error('Revenue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [addressMap, network, timeRange]);

  useEffect(() => { fetchRevenue(); }, [fetchRevenue]);

  const isTestnet = network?.includes('testnet');
  const unit = isTestnet ? 'tBTC' : 'BTC';
  const explorerBase = isTestnet ? 'https://mempool.space/testnet/tx/' : 'https://mempool.space/tx/';

  const typeIcons = {
    main: FiKey,
    change: FiRepeat,
    royalty: FiAward,
  };

  const typeColors = {
    main: { bg: 'bg-blue-500/15', text: 'text-blue-400', bar: 'bg-blue-500' },
    change: { bg: 'bg-amber-500/15', text: 'text-amber-400', bar: 'bg-amber-500' },
    royalty: { bg: 'bg-purple-500/15', text: 'text-purple-400', bar: 'bg-purple-500' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500" data-testid="revenue-loading">
        <FiLoader size={18} className="animate-spin mr-2" /> Loading revenue data...
      </div>
    );
  }

  if (!revenueData) {
    return (
      <div className="text-center py-12" data-testid="revenue-empty">
        <FiTrendingUp size={28} className="mx-auto text-gray-700 mb-3" />
        <p className="text-sm text-gray-500">No revenue data available</p>
      </div>
    );
  }

  const maxTypeIncome = Math.max(...Object.values(revenueData.byType), 1);

  return (
    <div className="space-y-4" data-testid="wallet-revenue-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-gray-400 font-medium uppercase tracking-wider flex items-center gap-1.5">
          <FiTrendingUp size={12} /> Ink Revenue
        </h3>
        <button
          onClick={fetchRevenue}
          className="text-gray-500 hover:text-white transition-colors p-1"
          data-testid="refresh-revenue-btn"
        >
          <FiRefreshCw size={12} />
        </button>
      </div>

      {/* Time Range Filter */}
      <div className="flex gap-1 p-0.5 bg-gray-800/50 rounded-lg">
        {[
          { key: '7d', label: '7 Days' },
          { key: '30d', label: '30 Days' },
          { key: '90d', label: '90 Days' },
          { key: 'all', label: 'All Time' },
        ].map(r => (
          <button
            key={r.key}
            onClick={() => setTimeRange(r.key)}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              timeRange === r.key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid={`revenue-range-${r.key}`}
          >{r.label}</button>
        ))}
      </div>

      {/* Total Income Card */}
      <div className="p-4 bg-gradient-to-br from-emerald-900/20 to-purple-900/20 border border-gray-800 rounded-xl">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Total Income</span>
        <p className="text-xl font-bold text-emerald-400 mt-0.5" data-testid="total-income">
          +{formatBTC(revenueData.totalIncome)} <span className="text-sm text-gray-500">{unit}</span>
        </p>
        <p className="text-[10px] text-gray-600 mt-1">
          {revenueData.txCount} incoming transaction{revenueData.txCount !== 1 ? 's' : ''} (excluding dust)
        </p>
      </div>

      {/* Revenue by Type - Visual Breakdown */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Revenue by Source</p>
        {['main', 'change', 'royalty'].map(type => {
          const Icon = typeIcons[type];
          const colors = typeColors[type];
          const income = revenueData.byType[type] || 0;
          const count = revenueData.countByType[type] || 0;
          const pct = maxTypeIncome > 0 ? (income / maxTypeIncome) * 100 : 0;

          return (
            <div key={type} className="p-3 bg-gray-800/40 rounded-lg" data-testid={`revenue-source-${type}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${colors.bg}`}>
                    <Icon size={11} className={colors.text} />
                  </div>
                  <div>
                    <span className="text-xs text-gray-300 font-medium capitalize">{type === 'royalty' ? 'Royalties' : type}</span>
                    <span className="text-[9px] text-gray-600 ml-1.5">{count} tx{count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <span className={`text-xs font-medium ${income > 0 ? colors.text : 'text-gray-600'}`}>
                  {income > 0 ? `+${formatCompact(income)}` : '--'}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
                  style={{ width: `${Math.max(pct, income > 0 ? 2 : 0)}%`, opacity: income > 0 ? 1 : 0.2 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-Address Breakdown */}
      {revenueData.bySource.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider">By Address</p>
          {revenueData.bySource
            .filter(s => s.income > 0)
            .sort((a, b) => b.income - a.income)
            .map((src, idx) => {
              const colors = typeColors[src.type] || typeColors.main;
              return (
                <div key={idx} className="p-2.5 bg-gray-800/30 rounded-lg" data-testid={`revenue-addr-${idx}`}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className={`text-[10px] font-medium ${colors.text}`}>{src.label}</span>
                      <p className="text-[9px] text-gray-600 font-mono truncate">{src.address}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-xs text-emerald-400 font-medium">+{formatCompact(src.income)}</p>
                      <p className="text-[9px] text-gray-600">{src.txCount} tx</p>
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>
      )}

      {/* Recent Incoming Transactions */}
      {revenueData.recentIncoming.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Recent Income</p>
          <div className="space-y-1 max-h-[250px] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            {revenueData.recentIncoming.map(tx => {
              const colors = typeColors[tx.source.type] || typeColors.main;
              return (
                <div key={tx.txid} className="flex items-center gap-2.5 p-2.5 bg-gray-800/30 rounded-lg group" data-testid={`revenue-tx-${tx.txid?.substring(0, 8)}`}>
                  <div className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <FiArrowDownLeft size={12} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1 py-0.5 text-[8px] font-medium rounded ${colors.bg} ${colors.text}`}>
                        {tx.source.label}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {tx.block_time ? new Date(tx.block_time * 1000).toLocaleDateString() : 'Pending'}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-600 font-mono truncate">{tx.txid}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-emerald-400 font-medium">+{formatCompact(tx.received_sats)}</p>
                  </div>
                  <a
                    href={`${explorerBase}${tx.txid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 p-1"
                  >
                    <FiExternalLink size={10} />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No Income State */}
      {revenueData.totalIncome === 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-gray-600">No income recorded yet.</p>
          <p className="text-[10px] text-gray-700 mt-1">
            Create objects with royalties to start earning from sales.
          </p>
        </div>
      )}

      {/* Info Footer */}
      <div className="p-3 bg-gray-800/30 rounded-lg">
        <p className="text-[10px] text-gray-600 leading-relaxed">
          <strong className="text-gray-500">Ink Revenue</strong> tracks all non-dust ({'>'}546 sats) incoming transactions
          across your main, change, and royalty addresses. Dust transactions (546 sats) are excluded as they represent P2FK protocol data, not actual payments.
        </p>
      </div>
    </div>
  );
};
