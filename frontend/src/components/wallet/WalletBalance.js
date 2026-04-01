import React, { useState, useEffect } from 'react';
import { FiCopy, FiCheck, FiRefreshCw, FiArrowDown, FiArrowUp, FiTrendingUp } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { ProfileThumb } from '@/components/ProfileThumb';
import { copyToClipboard } from '@/utils/clipboard';

export const WalletBalance = ({ network }) => {
  const { wallet, balance, profile, refreshBalance } = useWallet();
  const [copied, setCopied] = useState('');

  const copy = (text, label) => {
    copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const formatBTC = (sats) => (!sats && sats !== 0) ? '0.00000000' : (sats / 1e8).toFixed(8);
  const hasProfile = profile?.urn;

  return (
    <div className="space-y-4" data-testid="wallet-balance-tab">
      {hasProfile && (
        <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
          <ProfileThumb name={profile.display_name || profile.urn} image={profile.image} size="md" />
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium text-gray-200 truncate">{profile.display_name || profile.urn}</p>
            <p className="text-xs text-gray-500">@{profile.urn}</p>
          </div>
          <span className="px-2 py-0.5 bg-emerald-600/20 text-emerald-400 text-xs rounded-full">Linked</span>
        </div>
      )}

      {/* Main Balance */}
      <div className="p-4 bg-gradient-to-br from-emerald-900/30 to-blue-900/30 border border-gray-800 rounded-xl">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Total Balance</span>
          <button onClick={refreshBalance} className="text-gray-500 hover:text-white transition-colors" data-testid="refresh-balance">
            <FiRefreshCw size={14} />
          </button>
        </div>
        <p className="text-2xl font-bold text-white" data-testid="wallet-balance">
          {formatBTC(balance?.balance_sats)} <span className="text-sm text-gray-400">{network?.includes('mainnet') ? 'BTC' : 'tBTC'}</span>
        </p>
        {balance?.unconfirmed_sats > 0 && (
          <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
            <FiTrendingUp size={10} /> +{formatBTC(balance.unconfirmed_sats)} unconfirmed
          </p>
        )}
      </div>

      {/* Balance Breakdown */}
      {balance && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Breakdown</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <FiArrowDown size={11} className="text-emerald-400" />
                <span className="text-[10px] text-gray-500 uppercase">Confirmed</span>
              </div>
              <p className="text-sm font-medium text-gray-200">{formatBTC(balance.confirmed_sats || balance.balance_sats)}</p>
            </div>
            <div className="p-3 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <FiArrowUp size={11} className="text-amber-400" />
                <span className="text-[10px] text-gray-500 uppercase">Unconfirmed</span>
              </div>
              <p className="text-sm font-medium text-gray-200">{formatBTC(balance.unconfirmed_sats || 0)}</p>
            </div>
          </div>
          {balance.change_balance_sats > 0 && (
            <div className="p-3 bg-gray-800/50 rounded-lg">
              <span className="text-[10px] text-gray-500 uppercase">Change Address Balance</span>
              <p className="text-sm font-medium text-gray-200">{formatBTC(balance.change_balance_sats)}</p>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Quick Links</p>
        <div className="flex items-center gap-2 p-3 bg-gray-800 rounded-lg">
          <code className="text-xs text-gray-300 font-mono flex-1 truncate" data-testid="wallet-address">{wallet?.address}</code>
          <button onClick={() => copy(wallet?.address, 'addr')} className="text-gray-500 hover:text-white flex-shrink-0" data-testid="copy-wallet-address">
            {copied === 'addr' ? <FiCheck size={14} className="text-emerald-400" /> : <FiCopy size={14} />}
          </button>
        </div>
        <a href={`https://mempool.space/testnet/address/${wallet?.address}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-blue-400 transition-colors"
          data-testid="view-on-mempool"
        >View on Mempool.space</a>
      </div>
    </div>
  );
};
