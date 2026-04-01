import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiArrowDownLeft, FiArrowUpRight, FiRefreshCw, FiLoader, FiExternalLink, FiSend, FiDownload } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { getTransactions } from '@/utils/txHistory';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

export const WalletOverview = ({ network, onSwitchTab }) => {
  const { wallet, balance, refreshBalance } = useWallet();
  const { user } = useAuth();
  const [recentTxs, setRecentTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  const mainAddress = user?.address || wallet?.address;
  const formatBTC = (sats) => (!sats && sats !== 0) ? '0.00000000' : (sats / 1e8).toFixed(8);
  const isTestnet = network?.includes('testnet');
  const unit = isTestnet ? 'tBTC' : 'BTC';

  const fetchRecent = useCallback(async () => {
    if (!mainAddress) return;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const res = await axios.get(`${API}/wallet/address-txs/${mainAddress}`, { params: { network } });
      const txs = (res.data?.transactions || []).slice(0, 10);
      const localTxs = getTransactions(mainAddress);
      const localMap = {};
      localTxs.forEach(t => { localMap[t.txid] = t; });
      setRecentTxs(txs.map(tx => ({ ...tx, p2fkType: localMap[tx.txid]?.type || null, p2fkLabel: localMap[tx.txid]?.label || null })));
      hasLoadedRef.current = true;
    } catch {}
    finally { setLoading(false); }
  }, [mainAddress, network]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // Background refresh every 30s if pending txs
  useEffect(() => {
    if (!recentTxs.some(t => !t.confirmed)) return;
    const iv = setInterval(() => fetchRecent(), 30000);
    return () => clearInterval(iv);
  }, [recentTxs, fetchRecent]);

  const confirmed = balance?.confirmed_sats || balance?.balance_sats || 0;
  const pending = balance?.unconfirmed_sats || 0;
  const [extraBalances, setExtraBalances] = useState({ confirmed: 0, pending: 0 });

  // Fetch balances for ALL wallet addresses (change + object)
  useEffect(() => {
    if (!mainAddress) return;
    let cancelled = false;
    (async () => {
      try {
        // Gather all non-main addresses
        const addresses = [];

        // Change address
        const { getCachedChangeAddress } = await import('@/utils/txBuilder');
        const changeAddr = getCachedChangeAddress(mainAddress);
        if (changeAddr) addresses.push(changeAddr);

        // Object addresses
        try {
          const objAddrs = JSON.parse(localStorage.getItem(`cthulhu_obj_addresses_${mainAddress}`) || '[]');
          objAddrs.forEach(o => { if (o.address) addresses.push(o.address); });
        } catch {}

        if (addresses.length === 0) return;

        let totalConf = 0, totalPend = 0;
        const { getBalance } = await import('@/utils/chainExplorer');
        const results = await Promise.allSettled(
          addresses.map(addr => getBalance(addr, network))
        );
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value) {
            totalConf += r.value.confirmed || 0;
            totalPend += r.value.unconfirmed || 0;
          }
        });
        if (!cancelled) setExtraBalances({ confirmed: totalConf, pending: totalPend });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [mainAddress, network]);

  const totalConfirmed = confirmed + extraBalances.confirmed;
  const totalPending = pending + extraBalances.pending;
  const total = totalConfirmed + totalPending;

  return (
    <div className="space-y-4" data-testid="wallet-overview-tab">
      {/* Balance Card */}
      <div className="p-4 rounded-xl border border-gray-700/50 bg-gray-900/80">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Balances</span>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400">{isTestnet ? 'TESTNET' : 'MAINNET'}</span>
            <button onClick={refreshBalance} className="text-gray-500 hover:text-gray-200 transition-colors" data-testid="refresh-balance-btn"><FiRefreshCw size={13} /></button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5">Available</p>
            <p className="text-sm font-semibold text-emerald-400" data-testid="balance-available">{formatBTC(totalConfirmed)}</p>
            <p className="text-[9px] text-gray-600">{unit}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5">Pending</p>
            <p className="text-sm font-semibold text-amber-400" data-testid="balance-pending">{formatBTC(totalPending)}</p>
            <p className="text-[9px] text-gray-600">{unit}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-0.5">Total</p>
            <p className="text-sm font-bold text-gray-100" data-testid="balance-total">{formatBTC(total)}</p>
            <p className="text-[9px] text-gray-600">{unit}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onSwitchTab?.('send')} className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-sm font-medium transition-colors border border-blue-600/20" data-testid="quick-send-btn">
          <FiSend size={14} /> Send
        </button>
        <button onClick={() => onSwitchTab?.('receive')} className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-sm font-medium transition-colors border border-emerald-600/20" data-testid="quick-receive-btn">
          <FiDownload size={14} /> Receive
        </button>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Recent Transactions</span>
          <button onClick={() => onSwitchTab?.('transactions')} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors" data-testid="view-all-txs-btn">View all</button>
        </div>
        <div className="space-y-1">
          {loading && !hasLoadedRef.current ? (
            <div className="flex items-center justify-center py-6 text-gray-500"><FiLoader size={16} className="animate-spin mr-2" /> Loading...</div>
          ) : recentTxs.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-6">No transactions yet</p>
          ) : (
            recentTxs.map(tx => (
              <RecentTxRow key={tx.txid} tx={tx} isTestnet={isTestnet} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

function RecentTxRow({ tx, isTestnet }) {
  const typeColors = {
    PRO: 'text-purple-400', POST: 'text-blue-400', OBJ: 'text-emerald-400',
    GIV: 'text-amber-400', BRN: 'text-red-400', BUY: 'text-cyan-400', SEND: 'text-orange-400',
  };
  const explorerBase = isTestnet ? 'https://mempool.space/testnet/tx/' : 'https://mempool.space/tx/';

  return (
    <a href={`${explorerBase}${tx.txid}`} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 p-2.5 rounded-lg bg-gray-800/30 hover:bg-gray-800/60 transition-colors group" data-testid={`recent-tx-${tx.txid?.substring(0, 8)}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${tx.is_incoming ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
        {tx.is_incoming ? <FiArrowDownLeft size={13} className="text-emerald-400" /> : <FiArrowUpRight size={13} className="text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {tx.p2fkType && <span className={`text-[9px] font-bold ${typeColors[tx.p2fkType] || 'text-gray-400'}`}>{tx.p2fkType}</span>}
          <span className="text-xs text-gray-300">{tx.is_incoming ? 'Received' : 'Sent'}</span>
        </div>
        <p className="text-[10px] text-gray-600 font-mono truncate">{tx.txid}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-xs font-medium ${tx.is_incoming ? 'text-emerald-400' : 'text-red-400'}`}>
          {tx.is_incoming ? '+' : '-'}{((tx.is_incoming ? tx.received_sats : tx.sent_sats) / 1e8).toFixed(8)}
        </p>
        <p className="text-[9px] text-gray-600">{tx.block_time ? new Date(tx.block_time * 1000).toLocaleDateString() : 'Pending'}</p>
      </div>
      <FiExternalLink size={10} className="text-gray-700 group-hover:text-gray-500 flex-shrink-0" />
    </a>
  );
}
