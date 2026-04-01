import React, { useState, useMemo } from 'react';
import { FiX, FiExternalLink, FiClock, FiCheck, FiTrash2, FiFeather, FiAlertCircle } from 'react-icons/fi';
import { clearPendingTxs } from '@/utils/txBuilder';
import { getTransactions, clearTransactions } from '@/utils/txHistory';

function getExplorerUrl(txid, network) {
  if (network?.includes('testnet')) return `https://mempool.space/testnet/tx/${txid}`;
  if (network?.startsWith('ltc')) return `https://litecoinspace.org/tx/${txid}`;
  if (network?.startsWith('doge')) return `https://blockchair.com/dogecoin/transaction/${txid}`;
  return `https://mempool.space/tx/${txid}`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TYPE_STYLES = {
  POST: { color: 'text-blue-400', bg: 'bg-blue-500/10' },
  MINT: { color: 'text-purple-400', bg: 'bg-purple-500/10' },
  GIVE: { color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  BUY: { color: 'text-amber-400', bg: 'bg-amber-500/10' },
  BURN: { color: 'text-red-400', bg: 'bg-red-500/10' },
  LIST: { color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  Tip: { color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  Forward: { color: 'text-teal-400', bg: 'bg-teal-500/10' },
  Post: { color: 'text-blue-400', bg: 'bg-blue-500/10' },
  Give: { color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  Buy: { color: 'text-amber-400', bg: 'bg-amber-500/10' },
  Burn: { color: 'text-red-400', bg: 'bg-red-500/10' },
  Create: { color: 'text-purple-400', bg: 'bg-purple-500/10' },
};

function getTypeStyle(type) {
  return TYPE_STYLES[type] || { color: 'text-gray-400', bg: 'bg-gray-500/10' };
}

function TxRow({ tx, isPending }) {
  const style = getTypeStyle(tx.type);
  return (
    <div
      className="bg-gray-800/40 border border-gray-700/30 rounded-lg p-3 space-y-1.5 hover:bg-gray-800/60 transition-colors"
      data-testid={`inking-tx-${tx.txid?.slice(0, 8)}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-semibold uppercase ${style.color} ${style.bg} px-2 py-0.5 rounded tracking-wider`}>
            {tx.type || 'TX'}
          </span>
          {tx.label && (
            <span className="text-xs text-gray-400 truncate max-w-[160px]">{tx.label}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isPending ? (
            <>
              <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
              <span className="text-[9px] text-amber-400/80 font-mono tracking-wider">INKING...</span>
            </>
          ) : (
            <>
              <FiCheck size={10} className="text-emerald-500/70" />
              <span className="text-[9px] text-emerald-500/60 font-mono tracking-wider">INKED</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <code className="text-[10px] text-gray-500 font-mono truncate flex-1 mr-2">
          {tx.txid?.slice(0, 20)}...{tx.txid?.slice(-6)}
        </code>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[10px] text-gray-600">{timeAgo(tx.createdAt || tx.timestamp)}</span>
          <a
            href={getExplorerUrl(tx.txid, tx.network)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-400/70 hover:text-blue-300 flex items-center gap-0.5 transition-colors"
            data-testid="view-tx-explorer"
          >
            <FiExternalLink size={10} />
          </a>
        </div>
      </div>
    </div>
  );
}

export function InkingLogModal({ pendingTxs, myAddress, onClose }) {
  const [tab, setTab] = useState(pendingTxs.length > 0 ? 'pending' : 'recent');

  const recentTxs = useMemo(() => {
    return getTransactions(myAddress).slice(0, 15);
  }, [myAddress]);

  const pendingCount = pendingTxs.length;
  const recentCount = recentTxs.length;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700/50 rounded-xl w-full max-w-md max-h-[75vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        data-testid="inking-log-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800/50">
          <div className="flex items-center gap-2">
            <FiFeather size={18} className="text-purple-400" />
            <h2 className="text-base font-semibold text-gray-200">Inking Log</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="close-inking-log">
            <FiX size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800/50">
          <button
            onClick={() => setTab('pending')}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
              tab === 'pending'
                ? 'text-amber-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid="inking-tab-pending"
          >
            <span className="flex items-center justify-center gap-1.5">
              <FiClock size={12} />
              Pending
              {pendingCount > 0 && (
                <span className="min-w-[18px] h-4 px-1 bg-amber-500/20 text-amber-400 rounded-full flex items-center justify-center text-[10px] font-bold">
                  {pendingCount}
                </span>
              )}
            </span>
            {tab === 'pending' && <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-amber-400 rounded-full" />}
          </button>
          <button
            onClick={() => setTab('recent')}
            className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
              tab === 'recent'
                ? 'text-purple-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid="inking-tab-recent"
          >
            <span className="flex items-center justify-center gap-1.5">
              <FiFeather size={12} />
              Recent
              {recentCount > 0 && (
                <span className="min-w-[18px] h-4 px-1 bg-purple-500/15 text-purple-400 rounded-full flex items-center justify-center text-[10px] font-bold">
                  {recentCount}
                </span>
              )}
            </span>
            {tab === 'recent' && <div className="absolute bottom-0 left-4 right-4 h-0.5 bg-purple-400 rounded-full" />}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tab === 'pending' && (
            <>
              {pendingCount === 0 ? (
                <div className="text-center py-10">
                  <FiCheck size={28} className="mx-auto text-emerald-500/40 mb-3" />
                  <p className="text-sm text-gray-400">No inkings in progress</p>
                  <p className="text-[10px] text-gray-600 mt-1">Transactions appear here while the chain confirms them</p>
                </div>
              ) : (
                pendingTxs.map(tx => <TxRow key={tx.txid} tx={tx} isPending />)
              )}
            </>
          )}

          {tab === 'recent' && (
            <>
              {recentCount === 0 ? (
                <div className="text-center py-10">
                  <FiFeather size={28} className="mx-auto text-gray-700 mb-3" />
                  <p className="text-sm text-gray-400">No recent inkings</p>
                  <p className="text-[10px] text-gray-600 mt-1">Your on-chain actions will be recorded here</p>
                </div>
              ) : (
                recentTxs.map(tx => <TxRow key={tx.txid} tx={tx} isPending={false} />)
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {((tab === 'pending' && pendingCount > 0) || (tab === 'recent' && recentCount > 0)) && (
          <div className="p-3 border-t border-gray-800/50 flex items-center justify-between">
            {tab === 'pending' ? (
              <>
                <p className="text-[10px] text-gray-600 flex items-center gap-1">
                  <FiAlertCircle size={10} /> Polling every ~15s
                </p>
                <button
                  onClick={() => clearPendingTxs()}
                  className="text-[10px] text-red-400/60 hover:text-red-400 flex items-center gap-1 transition-colors"
                  data-testid="clear-pending-inkings"
                >
                  <FiTrash2 size={10} /> Clear
                </button>
              </>
            ) : (
              <>
                <p className="text-[10px] text-gray-600">Last {recentCount} inkings</p>
                <button
                  onClick={() => { clearTransactions(myAddress); }}
                  className="text-[10px] text-red-400/60 hover:text-red-400 flex items-center gap-1 transition-colors"
                  data-testid="clear-recent-inkings"
                >
                  <FiTrash2 size={10} /> Clear history
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
