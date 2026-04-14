import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiArrowDownLeft, FiArrowUpRight, FiExternalLink, FiCopy, FiCheck,
  FiClock, FiCheckCircle, FiLoader, FiRefreshCw
} from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { getTransactions } from '@/utils/txHistory';
import { getRoyaltyAddresses } from '@/utils/royaltyAddresses';
import { getCachedChangeAddress, getCachedRoyaltiesAddress } from '@/utils/txBuilder';
import { labelFromUrn } from '@/utils/addressLabels';
import { copyToClipboard } from '@/utils/clipboard';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export const WalletTransactions = ({ network }) => {
  const { wallet } = useWallet();
  const { user, wif } = useAuth();
  const [allTxs, setAllTxs] = useState([]);
  const [localTxs, setLocalTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const hasLoadedRef = useRef(false);

  const mainAddress = user?.address || wallet?.address;
  const urn = user?.urn || '';

  const copy = (text, label) => {
    copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const formatBTC = (sats) => (!sats && sats !== 0) ? '0' : (sats / 1e8).toFixed(8);

  // Gather all addresses to monitor
  const addressMap = useMemo(() => {
    const map = {};
    if (!mainAddress) return map;
    map[mainAddress] = { type: 'main', label: 'Main' };

    const changeAddr = getCachedChangeAddress(mainAddress);
    if (changeAddr) map[changeAddr] = { type: 'change', label: 'Change' };

    const defaultRoy = getCachedRoyaltiesAddress(mainAddress);
    if (defaultRoy) map[defaultRoy] = { type: 'royalty', label: 'Default Royalty' };

    // Named royalty addresses
    const namedRoyalties = getRoyaltyAddresses(urn, network);
    for (const r of namedRoyalties) {
      if (!map[r.address]) {
        map[r.address] = { type: 'royalty', label: labelFromUrn(r.label) || r.label || 'Royalty' };
      }
    }

    return map;
  }, [mainAddress, urn, network]);

  const fetchAllTxs = useCallback(async (silent = false) => {
    const addresses = Object.keys(addressMap);
    if (!addresses.length) return;
    // Only show loading spinner on the very first load
    if (!silent && !hasLoadedRef.current) setLoading(true);
    try {
      const results = await Promise.all(
        addresses.map(addr =>
          axios.get(`${API}/wallet/address-txs/${addr}`, { params: { network } })
            .then(res => ({ addr, txs: res.data?.transactions || [] }))
            .catch(() => ({ addr, txs: [] }))
        )
      );

      // Merge and tag transactions with source info
      const txMap = new Map();
      for (const { addr, txs } of results) {
        const meta = addressMap[addr];
        for (const tx of txs) {
          const key = tx.txid;
          if (txMap.has(key)) {
            // Already seen — append this address as another source
            const existing = txMap.get(key);
            if (!existing.sources.some(s => s.address === addr)) {
              existing.sources.push({ address: addr, ...meta });
            }
            // Merge amounts
            if (tx.is_incoming) {
              existing.received_sats = (existing.received_sats || 0) + (tx.received_sats || 0);
            }
          } else {
            txMap.set(key, {
              ...tx,
              sources: [{ address: addr, ...meta }],
              primarySource: meta,
            });
          }
        }
      }

      // Sort by block_time desc, pending first
      const merged = Array.from(txMap.values()).sort((a, b) => {
        if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
        return (b.block_time || Infinity) - (a.block_time || Infinity);
      });

      setAllTxs(merged);
      hasLoadedRef.current = true;
    } catch (err) {
      console.error('Failed to fetch combined txs:', err);
    } finally {
      setLoading(false);
    }
  }, [addressMap, network]);

  useEffect(() => {
    fetchAllTxs();
    if (mainAddress) setLocalTxs(getTransactions(mainAddress));
  }, [fetchAllTxs, mainAddress]);

  // Merge local P2FK tx types
  const localByTxid = useMemo(() => {
    const map = {};
    localTxs.forEach(tx => { map[tx.txid] = tx; });
    return map;
  }, [localTxs]);

  const enriched = useMemo(() => allTxs.map(tx => ({
    ...tx,
    p2fkType: localByTxid[tx.txid]?.type || null,
    p2fkLabel: localByTxid[tx.txid]?.label || null,
  })), [allTxs, localByTxid]);

  // Filter by source
  const filtered = useMemo(() => enriched.filter(tx => {
    if (sourceFilter === 'all') return true;
    return tx.sources?.some(s => s.type === sourceFilter);
  }), [enriched, sourceFilter]);

  const typeColors = {
    PRO: 'text-purple-400 bg-purple-500/15',
    POST: 'text-blue-400 bg-blue-500/15',
    REPLY: 'text-blue-400 bg-blue-500/15',
    OBJ: 'text-emerald-400 bg-emerald-500/15',
    GIV: 'text-amber-400 bg-amber-500/15',
    BRN: 'text-red-400 bg-red-500/15',
    BUY: 'text-cyan-400 bg-cyan-500/15',
    LST: 'text-blue-400 bg-blue-500/15',
    SEND: 'text-orange-400 bg-orange-500/15',
    WALKIE: 'text-green-400 bg-green-500/15',
    LIKE: 'text-pink-400 bg-pink-500/15',
    PIN: 'text-yellow-400 bg-yellow-500/15',
    DELETE: 'text-red-400 bg-red-500/15',
    TIP: 'text-amber-400 bg-amber-500/15',
    POLL: 'text-indigo-400 bg-indigo-500/15',
    VOTE: 'text-indigo-400 bg-indigo-500/15',
  };

  const sourceColors = {
    main: 'text-blue-400 bg-blue-500/10',
    change: 'text-amber-400 bg-amber-500/10',
    royalty: 'text-purple-400 bg-purple-500/10',
  };

  const getSmartLabel = (tx) => {
    if (tx.p2fkType) return { type: tx.p2fkType, label: tx.p2fkLabel };
    const amt = tx.is_incoming ? tx.received_sats : tx.sent_sats;
    if (amt === 546 && tx.is_incoming) return { type: null, label: 'Dust (P2FK activity)' };
    if (!tx.p2fkType && !tx.is_incoming && amt > 546) return { type: 'SEND', label: null };
    return { type: null, label: null };
  };

  // Auto-refresh when pending txs exist (silent — no scroll reset)
  useEffect(() => {
    const hasPending = enriched.some(tx => !tx.confirmed);
    if (!hasPending) return;
    const interval = setInterval(() => fetchAllTxs(true), 30000);
    return () => clearInterval(interval);
  }, [enriched, fetchAllTxs]);

  const isTestnet = network?.includes('testnet');
  const explorerBase = isTestnet ? 'https://mempool.space/testnet/tx/' : 'https://mempool.space/tx/';

  // Counts per source for filter badges
  const sourceCounts = useMemo(() => {
    const counts = { all: enriched.length, main: 0, change: 0, royalty: 0 };
    for (const tx of enriched) {
      const types = new Set(tx.sources?.map(s => s.type) || []);
      if (types.has('main')) counts.main++;
      if (types.has('change')) counts.change++;
      if (types.has('royalty')) counts.royalty++;
    }
    return counts;
  }, [enriched]);

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'main', label: 'Main' },
    { key: 'change', label: 'Change' },
    { key: 'royalty', label: 'Royalties' },
  ];

  return (
    <div className="space-y-3" data-testid="wallet-transactions-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Combined history across all addresses</p>
        <button
          onClick={fetchAllTxs}
          disabled={loading}
          className="text-gray-500 hover:text-white transition-colors p-1"
          data-testid="refresh-txs-btn"
        >
          <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Source Filter Tabs */}
      <div className="flex gap-1 p-0.5 bg-gray-800/50 rounded-lg">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md transition-colors ${
              sourceFilter === f.key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid={`tx-filter-${f.key}`}
          >
            {f.label}
            {sourceCounts[f.key] > 0 && (
              <span className={`text-[9px] px-1 rounded-full ${
                sourceFilter === f.key ? 'bg-gray-600 text-gray-300' : 'bg-gray-800 text-gray-600'
              }`}>{sourceCounts[f.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Transaction List */}
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <FiLoader size={18} className="animate-spin mr-2" /> Loading...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-8">No transactions found</p>
        ) : (
          filtered.map(tx => {
            const smart = getSmartLabel(tx);
            return (
              <div key={tx.txid} className="p-3 bg-gray-800/40 hover:bg-gray-800/70 rounded-lg transition-colors group" data-testid={`tx-${tx.txid?.substring(0, 8)}`}>
                <div className="flex items-center gap-2.5">
                  {/* Direction Icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    tx.is_incoming ? 'bg-emerald-500/15' : 'bg-red-500/15'
                  }`}>
                    {tx.is_incoming
                      ? <FiArrowDownLeft size={14} className="text-emerald-400" />
                      : <FiArrowUpRight size={14} className="text-red-400" />
                    }
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {smart.type && (
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${typeColors[smart.type] || 'text-gray-400 bg-gray-500/15'}`}>
                          {smart.type}
                        </span>
                      )}
                      {tx.sources?.map(s => (
                        <span key={s.address} className={`px-1 py-0.5 text-[8px] font-medium rounded ${sourceColors[s.type] || ''}`}>
                          {s.label}
                        </span>
                      ))}
                      <span className="text-xs text-gray-300 font-medium">
                        {tx.is_incoming ? 'Received' : 'Sent'}
                      </span>
                    </div>
                    {smart.label && <span className="text-[10px] text-gray-500 block truncate">{smart.label}</span>}
                    <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5">{tx.txid}</p>
                  </div>

                  {/* Amount + Status */}
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-medium ${tx.is_incoming ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.is_incoming ? '+' : '-'}{formatBTC(tx.is_incoming ? tx.received_sats : tx.sent_sats)}
                    </p>
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      {tx.confirmed
                        ? <FiCheckCircle size={9} className="text-emerald-500" />
                        : <FiClock size={9} className="text-amber-500 animate-pulse" />
                      }
                      <span className="text-[9px] text-gray-600">
                        {tx.block_time ? new Date(tx.block_time * 1000).toLocaleDateString() : 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons (show on hover) */}
                <div className="flex gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => copy(tx.txid, `tx-${tx.txid}`)}
                    className="flex items-center gap-1 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-[10px] text-gray-400 transition-colors"
                  >
                    {copied === `tx-${tx.txid}` ? <FiCheck size={9} className="text-emerald-400" /> : <FiCopy size={9} />} Copy ID
                  </button>
                  <a href={`${explorerBase}${tx.txid}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-1 bg-gray-700/50 hover:bg-gray-700 rounded text-[10px] text-blue-400 transition-colors"
                  >
                    <FiExternalLink size={9} /> Explorer
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
