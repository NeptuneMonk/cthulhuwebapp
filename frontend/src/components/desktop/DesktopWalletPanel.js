/**
 * DesktopWalletPanel — Core Wallet details for desktop app.
 *
 * Shows balance, addresses, UTXOs, and recent transactions
 * from the connected Core Wallet daemon. Replaces WalletModal
 * for the desktop build.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNode } from '@/contexts/NodeContext';
import { FiRefreshCw, FiCopy, FiCheck, FiArrowUp, FiArrowDown, FiBox } from 'react-icons/fi';

export function DesktopWalletPanel() {
  const { activeChain, isChainConnected, getWalletInfo, getAddress, getUtxos, rpcCall } = useNode();
  const [walletInfo, setWalletInfo] = useState(null);
  const [utxos, setUtxos] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [newAddress, setNewAddress] = useState('');
  const [copied, setCopied] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('overview');

  const refresh = useCallback(async () => {
    if (!isChainConnected) return;
    setLoading(true);
    try {
      const [info, utxoData] = await Promise.all([
        getWalletInfo(activeChain),
        getUtxos(activeChain),
      ]);
      setWalletInfo(info);
      setUtxos(utxoData);

      // Get recent transactions
      try {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/node/transactions/${activeChain}?count=20`);
        if (res.ok) {
          const data = await res.json();
          setTransactions(data.transactions || []);
        }
      } catch {}
    } catch {}
    setLoading(false);
  }, [activeChain, isChainConnected, getWalletInfo, getUtxos]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleNewAddress = useCallback(async () => {
    const addr = await getAddress(activeChain, 'cthulhu');
    if (addr) setNewAddress(addr);
  }, [activeChain, getAddress]);

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  if (!isChainConnected) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm" data-testid="wallet-panel-disconnected">
        <div className="text-center">
          <FiBox size={24} className="mx-auto mb-2 opacity-50" />
          <p>{activeChain} Core Wallet not connected</p>
          <p className="text-xs mt-1 text-gray-600">Start {activeChain.toLowerCase()}d or {activeChain.toLowerCase()}-qt</p>
        </div>
      </div>
    );
  }

  const balance = walletInfo?.wallet?.balance ?? 0;
  const unconfirmed = walletInfo?.wallet?.unconfirmed_balance ?? 0;
  const blockHeight = walletInfo?.blockchain?.blocks ?? 0;
  const synced = walletInfo?.blockchain?.synced ?? false;

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'utxos', label: `UTXOs (${utxos.length})` },
    { id: 'transactions', label: 'Transactions' },
  ];

  return (
    <div className="h-full flex flex-col" data-testid="wallet-panel">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">{activeChain} Wallet</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-gray-500">
              Block {blockHeight.toLocaleString()} {synced ? '' : '(syncing...)'}
            </span>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-white/[0.04] text-gray-400 transition-colors disabled:opacity-30"
          data-testid="wallet-refresh-btn"
        >
          <FiRefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Balance */}
      <div className="px-4 py-4 text-center border-b border-white/[0.04]">
        <p className="text-2xl font-bold text-gray-100" data-testid="wallet-balance">
          {balance.toFixed(8)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{activeChain}</p>
        {unconfirmed !== 0 && (
          <p className="text-[10px] text-amber-400/70 mt-1">
            {unconfirmed > 0 ? '+' : ''}{unconfirmed.toFixed(8)} unconfirmed
          </p>
        )}
      </div>

      {/* New Address */}
      <div className="px-4 py-2 border-b border-white/[0.04]">
        <button
          onClick={handleNewAddress}
          className="w-full text-left text-xs text-gray-400 hover:text-gray-200 transition-colors py-1"
          data-testid="wallet-new-address-btn"
        >
          + Generate New Address
        </button>
        {newAddress && (
          <div className="flex items-center gap-2 mt-1 p-2 rounded bg-white/[0.02] border border-white/[0.04]">
            <span className="text-[11px] text-gray-300 font-mono flex-1 truncate">{newAddress}</span>
            <button
              onClick={() => copyToClipboard(newAddress, 'addr')}
              className="text-gray-500 hover:text-gray-200 transition-colors"
            >
              {copied === 'addr' ? <FiCheck size={12} className="text-emerald-400" /> : <FiCopy size={12} />}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.04]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
              tab === t.id ? 'text-gray-100 border-b border-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
            data-testid={`wallet-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="p-4 space-y-3 text-xs">
            <InfoRow label="Wallet" value={walletInfo?.wallet?.wallet_name || 'default'} />
            <InfoRow label="Chain" value={walletInfo?.blockchain?.chain || activeChain} />
            <InfoRow label="Block Height" value={blockHeight.toLocaleString()} />
            <InfoRow label="TX Count" value={walletInfo?.wallet?.tx_count ?? '—'} />
            <InfoRow label="UTXOs" value={utxos.length} />
            <InfoRow label="Sync" value={synced ? 'Complete' : `${((walletInfo?.blockchain?.verification_progress || 0) * 100).toFixed(1)}%`} />
          </div>
        )}

        {tab === 'utxos' && (
          <div className="p-2 space-y-1">
            {utxos.length === 0 ? (
              <p className="text-center text-gray-500 text-xs py-6">No UTXOs</p>
            ) : utxos.map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.02] text-[11px]">
                <span className="text-gray-500 font-mono truncate flex-1">{u.txid?.slice(0, 16)}...:{u.vout}</span>
                <span className="text-gray-200 font-medium whitespace-nowrap">{u.amount?.toFixed(8)}</span>
                <span className="text-gray-500">{u.confirmations}c</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'transactions' && (
          <div className="p-2 space-y-1">
            {transactions.length === 0 ? (
              <p className="text-center text-gray-500 text-xs py-6">No transactions</p>
            ) : transactions.map((tx, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.02] text-[11px]"
              >
                {tx.category === 'receive' ? (
                  <FiArrowDown size={12} className="text-emerald-400 flex-shrink-0" />
                ) : (
                  <FiArrowUp size={12} className="text-red-400 flex-shrink-0" />
                )}
                <span className="text-gray-400 font-mono truncate flex-1">{tx.txid?.slice(0, 20)}...</span>
                <span className={`font-medium whitespace-nowrap ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount?.toFixed(8)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 font-medium">{value}</span>
    </div>
  );
}

export default DesktopWalletPanel;
