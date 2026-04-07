import React, { useState, useEffect } from 'react';
import {
  FiArrowLeft, FiArrowRight, FiCopy, FiCheck,
  FiRefreshCw, FiAlertTriangle, FiZap, FiExternalLink
} from 'react-icons/fi';
import { copyToClipboard } from '@/utils/clipboard';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function FundWalletStep({ user, balance, balanceLoading, fetchBalance, hasFunds, onNext, onBack, network }) {
  const [copied, setCopied] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetResult, setFaucetResult] = useState(null);
  const [faucetAvailable, setFaucetAvailable] = useState(false);
  const [tbtcPrice, setTbtcPrice] = useState(null);

  // Check faucet availability on mount
  useEffect(() => {
    if (network?.includes('testnet')) {
      fetch(`${API}/treasury/info?network=${network}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.faucet_available) setFaucetAvailable(true); })
        .catch(() => {});
      fetch(`${API}/tbtc-price`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.price) setTbtcPrice(d.price); })
        .catch(() => {});
    }
  }, [network]);

  const requestFaucet = async () => {
    if (!user?.address || faucetLoading) return;
    setFaucetLoading(true);
    try {
      const res = await fetch(`${API}/treasury/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_address: user.address, network: network || 'btc-testnet' }),
      });
      // Clone before reading to avoid "body disturbed" errors from service workers
      const clone = res.clone();
      let data;
      try { data = await res.json(); } catch { data = await clone.json(); }
      if (data.success) {
        setFaucetResult({ success: true, txid: data.txid, amount: data.amount_sats });
        setTimeout(() => fetchBalance(), 3000);
      } else {
        setFaucetResult({ success: false, error: data.detail || data.error || 'Faucet request failed' });
      }
    } catch (err) {
      setFaucetResult({ success: false, error: err.message });
    }
    setFaucetLoading(false);
  };

  const balanceSats = balance?.balance_sats || 0;
  const balanceBTC = (balanceSats / 100_000_000).toFixed(8);

  const copyAddress = () => {
    if (user?.address) {
      copyToClipboard(user.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isTestnet = (network || '').includes('testnet');
  const coinLabel = isTestnet ? 'tBTC' : 'BTC';
  const networkLabel = isTestnet ? 'Testnet' : 'Mainnet';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-gray-100 mb-1">Fund Your Wallet</h2>
      <p className="text-sm text-gray-500 mb-6">
        Send {coinLabel} to your address. A profile mint costs ~10,000 sats (546 x ~20 outputs + fee).
      </p>

      {/* Address */}
      <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 mb-4">
        <label className="text-xs text-gray-500 block mb-2">Your {networkLabel} Address</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm text-blue-400 break-all font-mono select-all" data-testid="fund-address">
            {user.address}
          </code>
          <button
            onClick={copyAddress}
            className="flex-shrink-0 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            data-testid="fund-copy-address"
          >
            {copied ? <FiCheck size={14} className="text-emerald-400" /> : <FiCopy size={14} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Balance */}
      <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Balance</label>
            <p className={`text-lg font-bold ${hasFunds ? 'text-emerald-400' : 'text-gray-300'}`} data-testid="fund-balance">
              {balanceBTC} {coinLabel}
            </p>
            <p className="text-xs text-gray-500">{balanceSats.toLocaleString()} sats</p>
          </div>
          <button
            onClick={fetchBalance}
            disabled={balanceLoading}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            data-testid="fund-refresh-balance"
          >
            <FiRefreshCw size={16} className={`text-gray-400 ${balanceLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Cthulhu Faucet — testnet only */}
      {isTestnet && !hasFunds && faucetAvailable && !faucetResult?.success && (
        <button
          onClick={requestFaucet}
          disabled={faucetLoading}
          className="w-full mb-4 py-3 bg-teal-600/20 border border-teal-500/30 rounded-lg text-teal-300 hover:bg-teal-600/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="faucet-request-btn"
        >
          <FiZap size={16} />
          {faucetLoading ? 'Requesting funds...' : 'Get Free Testnet Coins from Cthulhu'}
        </button>
      )}
      {faucetResult?.success && (
        <div className="mb-4 p-3 bg-emerald-900/20 border border-emerald-700/30 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <FiCheck size={14} className="text-emerald-400" />
            <span className="text-sm text-emerald-300 font-medium">Funded!</span>
          </div>
          <p className="text-xs text-gray-400">
            {faucetResult.amount?.toLocaleString()} sats sent. TX: <code className="text-gray-500">{faucetResult.txid?.slice(0, 16)}...</code>
          </p>
          <p className="text-xs text-gray-500 mt-1">Balance will update shortly...</p>
        </div>
      )}
      {faucetResult && !faucetResult.success && (
        <p className="mb-4 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {faucetResult.error}
        </p>
      )}

      {/* External funding links */}
      {isTestnet ? (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-6 flex gap-2">
          <FiExternalLink size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-400/80">
            <p className="mb-1">{faucetAvailable ? 'Or buy testnet BTC:' : 'Need testnet BTC?'}</p>
            <a href="https://buytestnet.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1">
              buytestnet.com — Buy tBTC instantly
              {tbtcPrice && <span className="text-gray-500 ml-1">(~${tbtcPrice}/tBTC)</span>}
            </a>
          </div>
        </div>
      ) : (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mb-6 flex gap-2">
          <FiAlertTriangle size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-orange-400/80">
            <p>Send real BTC from your wallet or exchange to the address above.</p>
            <p className="mt-1 text-gray-500">This is mainnet — transactions use real funds.</p>
          </div>
        </div>
      )}

      {!hasFunds && (
        <p className="text-xs text-gray-500 text-center mb-4">
          Waiting for funds... balance refreshes every 10 seconds.
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm flex items-center gap-2 transition-colors"
          data-testid="setup-back-btn"
        >
          <FiArrowLeft size={16} /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!hasFunds}
          className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          data-testid="setup-mint-btn"
        >
          {hasFunds ? <>Mint Profile <FiArrowRight size={16} /></> : 'Fund wallet to continue'}
        </button>
      </div>
    </div>
  );
}
