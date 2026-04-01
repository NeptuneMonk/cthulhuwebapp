/**
 * PaywallGate — One-time crypto payment gate.
 * Shown after login when paywall is enabled and user hasn't paid.
 * Supports BTC, LTC, DOGE treasury wallets.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { FiCheck, FiClock, FiCopy, FiShield, FiAlertTriangle } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';

const API = process.env.REACT_APP_BACKEND_URL;

const CHAIN_INFO = {
  btc: { name: 'Bitcoin', symbol: 'BTC', color: 'orange', icon: '/btc.svg', explorer: 'https://mempool.space/testnet/address/' },
  ltc: { name: 'Litecoin', symbol: 'LTC', color: 'blue', icon: '/ltc.svg', explorer: 'https://litecoinspace.org/testnet/address/' },
  doge: { name: 'Dogecoin', symbol: 'DOGE', color: 'yellow', icon: '/doge.svg', explorer: '' },
};

export default function PaywallGate({ onAccessGranted }) {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [selectedChain, setSelectedChain] = useState(null);
  const [txid, setTxid] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!user?.urn) return;
    try {
      const [cfgRes, statusRes] = await Promise.all([
        fetch(`${API}/api/paywall/config`),
        fetch(`${API}/api/paywall/status/${user.urn}`),
      ]);
      const cfg = await cfgRes.json();
      const sts = await statusRes.json();
      setConfig(cfg);
      setStatus(sts);

      if (!cfg.enabled || sts.paid) {
        onAccessGranted?.();
      }
      if (sts.status === 'pending') {
        setSubmitted(true);
        setSelectedChain(sts.chain);
      }
    } catch {
      // If paywall API fails, grant access (fail open)
      onAccessGranted?.();
    } finally {
      setLoading(false);
    }
  }, [user?.urn, onAccessGranted]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Poll for status changes every 30s when pending
  useEffect(() => {
    if (!submitted) return;
    const interval = setInterval(async () => {
      if (!user?.urn) return;
      const res = await fetch(`${API}/api/paywall/status/${user.urn}`);
      const sts = await res.json();
      if (sts.paid) onAccessGranted?.();
    }, 30000);
    return () => clearInterval(interval);
  }, [submitted, user?.urn, onAccessGranted]);

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async () => {
    if (!selectedChain || !user?.urn) return;
    setSubmitting(true);
    try {
      await fetch(`${API}/api/paywall/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: user.urn, chain: selectedChain, txid, note }),
      });
      setSubmitted(true);
    } catch {
      // silent
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-600">Checking access...</div>
      </div>
    );
  }

  if (!config?.enabled || status?.paid) return null;

  const treasuryAddr = selectedChain ? config.treasury_addresses?.[selectedChain] : null;
  const chainMeta = selectedChain ? CHAIN_INFO[selectedChain] : null;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4" data-testid="paywall-gate">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-purple-900/30 border border-purple-700/30 flex items-center justify-center mx-auto mb-4">
            <FiShield size={36} className="text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100 mb-2">Access Cthulhu</h1>
          <p className="text-sm text-gray-500">{config.fee_description || 'One-time access fee'}</p>
          <p className="text-3xl font-bold text-purple-400 mt-3">${config.fee_usd?.toFixed(2)} USD</p>
          <p className="text-xs text-gray-600 mt-1">equivalent in your chosen cryptocurrency</p>
        </div>

        {/* Pending state */}
        {submitted ? (
          <div className="bg-gray-900/80 border border-amber-800/30 rounded-xl p-6 text-center" data-testid="paywall-pending">
            <div className="w-14 h-14 rounded-full bg-amber-900/30 border border-amber-700/50 flex items-center justify-center mx-auto mb-4">
              <FiClock size={24} className="text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-gray-200 mb-2">Payment Pending</h2>
            <p className="text-sm text-gray-400 mb-4">
              Your payment is being verified. This may take some time as verification is done manually.
              You'll get access as soon as it's confirmed.
            </p>
            <p className="text-xs text-gray-600">
              Paid via <span className="text-gray-400 font-medium uppercase">{selectedChain}</span>
            </p>
            <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Auto-checking every 30 seconds</p>
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-amber-400">Waiting for confirmation</span>
              </div>
            </div>
          </div>
        ) : !selectedChain ? (
          /* Chain selection */
          <div className="space-y-3" data-testid="paywall-chain-select">
            <p className="text-xs text-gray-500 text-center mb-4">Choose your payment method</p>
            {Object.entries(CHAIN_INFO).map(([key, info]) => {
              const addr = config.treasury_addresses?.[key];
              const available = !!addr;
              return (
                <button
                  key={key}
                  disabled={!available}
                  onClick={() => setSelectedChain(key)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                    available
                      ? 'bg-gray-900/80 border-gray-700/50 hover:border-purple-600/50 hover:bg-gray-800/80 cursor-pointer'
                      : 'bg-gray-900/30 border-gray-800/30 opacity-40 cursor-not-allowed'
                  }`}
                  data-testid={`paywall-chain-${key}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                    key === 'btc' ? 'bg-orange-900/40 text-orange-400' :
                    key === 'ltc' ? 'bg-blue-900/40 text-blue-400' :
                    'bg-yellow-900/40 text-yellow-400'
                  }`}>
                    {info.symbol.charAt(0)}
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-semibold text-gray-200">{info.name}</p>
                    <p className="text-xs text-gray-500">{available ? 'Pay with ' + info.symbol : 'Not available'}</p>
                  </div>
                  {available && (
                    <span className="text-xs text-gray-600">&rarr;</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* Payment instructions */
          <div className="space-y-4" data-testid="paywall-payment-form">
            <button
              onClick={() => setSelectedChain(null)}
              className="text-xs text-gray-500 hover:text-gray-300 mb-2"
            >
              &larr; Choose different chain
            </button>

            <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  selectedChain === 'btc' ? 'bg-orange-900/40 text-orange-400' :
                  selectedChain === 'ltc' ? 'bg-blue-900/40 text-blue-400' :
                  'bg-yellow-900/40 text-yellow-400'
                }`}>
                  {chainMeta?.symbol?.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-200">Send {chainMeta?.symbol}</p>
                  <p className="text-xs text-gray-500">${config.fee_usd?.toFixed(2)} USD equivalent</p>
                </div>
              </div>

              {/* Treasury address */}
              <div className="mb-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Send to this address</p>
                <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg p-3">
                  <code className="text-xs text-purple-400 flex-1 break-all font-mono" data-testid="paywall-treasury-addr">
                    {treasuryAddr}
                  </code>
                  <button
                    onClick={() => handleCopy(treasuryAddr)}
                    className="text-gray-500 hover:text-gray-300 flex-shrink-0"
                    data-testid="paywall-copy-addr"
                  >
                    {copied ? <FiCheck size={14} className="text-green-400" /> : <FiCopy size={14} />}
                  </button>
                </div>
              </div>

              {/* TXID input */}
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Transaction ID (optional)</p>
                <input
                  type="text"
                  value={txid}
                  onChange={(e) => setTxid(e.target.value)}
                  placeholder="Paste your TXID for faster verification"
                  className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-600/50"
                  data-testid="paywall-txid-input"
                />
              </div>

              {/* Note input */}
              <div className="mb-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Note to admin (optional)</p>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. My URN or username"
                  className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-600/50"
                  data-testid="paywall-note-input"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
                data-testid="paywall-submit-btn"
              >
                {submitting ? 'Submitting...' : "I've Sent Payment"}
              </button>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 p-3 bg-amber-900/10 border border-amber-800/20 rounded-lg">
              <FiAlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-500/80 leading-relaxed">
                Send the exact USD equivalent in {chainMeta?.symbol} at current market rate.
                Verification is manual and may take some time. You'll get access as soon as payment is confirmed.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-gray-700 mt-6">
          Welcome to Cthulhu &mdash; Where Ancient Artifacts Meet the Blockchain
        </p>
      </div>
    </div>
  );
}
