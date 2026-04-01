import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FiSend, FiAlertTriangle, FiCheck, FiZap, FiClock, FiDollarSign, FiSliders, FiChevronDown, FiChevronUp, FiLoader, FiRefreshCw } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { fetchUtxos } from '@/utils/txBuilder';

export const WalletSend = ({ network }) => {
  const { wallet, balance, refreshBalance } = useWallet();
  const { user, wif: authWif } = useAuth();
  const activeWif = authWif || wallet?.wif;
  const mainAddress = user?.address || wallet?.address;

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [feePreset, setFeePreset] = useState('standard');
  const [customFee, setCustomFee] = useState('');
  const [feeRates, setFeeRates] = useState({ priority: 20, standard: 10, economy: 5, minimum: 1 });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  // Coin Control state
  const [showCoinControl, setShowCoinControl] = useState(false);
  const [allUtxos, setAllUtxos] = useState([]);
  const [utxoLoading, setUtxoLoading] = useState(false);
  const [selectedUtxos, setSelectedUtxos] = useState(new Set()); // Set of "txid:vout" keys
  const [coinControlActive, setCoinControlActive] = useState(false);

  const fetchFees = useCallback(async () => {
    try {
      const { getFees } = await import('@/utils/chainExplorer');
      const fees = await getFees(network);
      if (fees) {
        setFeeRates({
          priority: fees.fastestFee || 20,
          standard: fees.halfHourFee || 10,
          economy: fees.hourFee || fees.economyFee || 5,
          minimum: fees.minimumFee || 1,
        });
      }
    } catch {}
  }, [network]);

  useEffect(() => { fetchFees(); }, [fetchFees]);

  // Fetch UTXOs from all addresses for coin control
  const loadUtxos = useCallback(async () => {
    if (!mainAddress) return;
    setUtxoLoading(true);
    try {
      // Gather all known addresses
      const addresses = [{ address: mainAddress, label: 'Main', type: 'main' }];

      // Change address
      const { getCachedChangeAddress } = await import('@/utils/txBuilder');
      const changeAddr = getCachedChangeAddress(mainAddress);
      if (changeAddr) addresses.push({ address: changeAddr, label: 'Change', type: 'change' });

      // Object addresses
      try {
        const objAddrs = JSON.parse(localStorage.getItem(`cthulhu_obj_addresses_${mainAddress}`) || '[]');
        objAddrs.forEach(o => {
          if (o.address) addresses.push({ address: o.address, label: o.label || 'Object', type: 'object' });
        });
      } catch {}

      // Fetch UTXOs from all addresses in parallel
      const results = await Promise.allSettled(
        addresses.map(async (a) => {
          const utxos = await fetchUtxos(a.address, network);
          return utxos.map(u => ({ ...u, ownerAddress: a.address, ownerLabel: a.label, ownerType: a.type }));
        })
      );

      const combined = [];
      results.forEach(r => {
        if (r.status === 'fulfilled') combined.push(...r.value);
      });

      // Sort: confirmed first, then by value descending
      combined.sort((a, b) => {
        const aConf = a.status?.confirmed ? 1 : 0;
        const bConf = b.status?.confirmed ? 1 : 0;
        if (aConf !== bConf) return bConf - aConf;
        return b.value - a.value;
      });

      setAllUtxos(combined);
    } catch {}
    finally { setUtxoLoading(false); }
  }, [mainAddress, network]);

  // Load UTXOs when coin control panel opens
  useEffect(() => {
    if (showCoinControl && allUtxos.length === 0) loadUtxos();
  }, [showCoinControl, allUtxos.length, loadUtxos]);

  const utxoKey = (u) => `${u.txid}:${u.vout}`;

  const toggleUtxo = (u) => {
    const key = utxoKey(u);
    setSelectedUtxos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setCoinControlActive(true);
  };

  const selectAll = () => {
    setSelectedUtxos(new Set(allUtxos.map(utxoKey)));
    setCoinControlActive(true);
  };

  const selectNone = () => {
    setSelectedUtxos(new Set());
    setCoinControlActive(false);
  };

  // Computed values
  const activeFeeRate = feePreset === 'custom'
    ? parseInt(customFee, 10) || 1
    : feeRates[feePreset] || 10;

  useEffect(() => {
    if (activeFeeRate < feeRates.minimum) setWarning('Fee rate is below the minimum. Transaction may not be accepted.');
    else if (activeFeeRate < feeRates.economy) setWarning('Low fee rate. Transaction may take very long to confirm.');
    else setWarning('');
  }, [activeFeeRate, feeRates]);

  const amountSats = Math.floor(parseFloat(amount || '0') * 1e8);

  // Calculate available balance from selected UTXOs
  const selectedBalance = useMemo(() => {
    if (!coinControlActive || selectedUtxos.size === 0) return balance?.balance_sats || 0;
    return allUtxos.filter(u => selectedUtxos.has(utxoKey(u))).reduce((sum, u) => sum + u.value, 0);
  }, [coinControlActive, selectedUtxos, allUtxos, balance]);

  const selectedCount = coinControlActive ? selectedUtxos.size : 'auto';
  const inputCount = coinControlActive ? selectedUtxos.size : 2; // estimate 2 inputs in auto mode
  const estimatedTxSize = Math.max(inputCount, 1) * 148 + (2 + 1) * 34 + 10; // inputs + outputs + overhead
  const estimatedFeeSats = Math.max(estimatedTxSize * activeFeeRate, 300);
  const totalCost = amountSats + estimatedFeeSats;
  const canSend = recipient.trim() && amountSats > 546 && selectedBalance >= totalCost;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      if (coinControlActive && selectedUtxos.size > 0) {
        // Manual coin control: use buildAndSendWithUtxos
        const { buildAndSendWithUtxos } = await import('@/utils/txBuilder');
        const chosen = allUtxos.filter(u => selectedUtxos.has(utxoKey(u)));
        const res = await buildAndSendWithUtxos(activeWif, recipient.trim(), amountSats, chosen, network, activeFeeRate);
        setResult(res);
      } else {
        // Auto mode: standard buildAndSend
        const { buildAndSend } = await import('@/utils/txBuilder');
        const res = await buildAndSend(activeWif, recipient.trim(), amountSats, network, activeFeeRate);
        setResult(res);
      }
      refreshBalance();
    } catch (err) {
      setError(err.message || 'Transaction failed');
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    const max = selectedBalance - estimatedFeeSats - 100;
    if (max > 0) setAmount((max / 1e8).toFixed(8));
  };

  const isTestnet = network?.includes('testnet');

  if (result) {
    return (
      <div className="space-y-4 text-center" data-testid="send-success">
        <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
          <FiCheck size={28} className="text-emerald-400" />
        </div>
        <p className="text-gray-200 font-semibold">Transaction Sent!</p>
        <p className="text-xs text-gray-500 font-mono break-all">{result.txid}</p>
        <a href={`https://mempool.space/${isTestnet ? 'testnet/' : ''}tx/${result.txid}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">View on Mempool.space</a>
        <button onClick={() => { setResult(null); setAmount(''); setRecipient(''); }}
          className="w-full px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">Send Another</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="wallet-send-tab">
      {/* Recipient */}
      <div>
        <label className="block text-xs text-gray-400 font-medium mb-1.5">Pay To</label>
        <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Enter Bitcoin address..."
          className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono focus:border-blue-500 focus:outline-none"
          data-testid="send-recipient-input" />
      </div>

      {/* Amount */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-gray-400 font-medium">Amount (BTC)</label>
          <button onClick={handleMax} className="text-[10px] text-blue-400 hover:text-blue-300" data-testid="send-max-btn">MAX</button>
        </div>
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00000000" type="number" step="0.00000001" min="0"
          className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono focus:border-blue-500 focus:outline-none"
          data-testid="send-amount-input" />
        <p className="text-[10px] text-gray-600 mt-1">{amountSats.toLocaleString()} sats</p>
      </div>

      {/* Coin Control (expandable) */}
      <div className="rounded-lg border border-gray-700/50 overflow-hidden">
        <button onClick={() => setShowCoinControl(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-800/40 hover:bg-gray-800/70 text-xs text-gray-400 transition-colors"
          data-testid="coin-control-toggle">
          <div className="flex items-center gap-2">
            <FiSliders size={13} />
            <span className="font-medium">Coin Control</span>
            {coinControlActive && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/20 text-amber-300" data-testid="coin-control-badge">
                {selectedUtxos.size} UTXO{selectedUtxos.size !== 1 ? 's' : ''} selected
              </span>
            )}
          </div>
          {showCoinControl ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
        </button>

        {showCoinControl && (
          <div className="border-t border-gray-800/50 p-3 space-y-2 max-h-[250px] overflow-y-auto" data-testid="coin-control-panel" style={{ WebkitOverflowScrolling: 'touch' }}>
            {/* Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-[10px] text-blue-400 hover:text-blue-300" data-testid="cc-select-all">Select All</button>
                <span className="text-gray-700">|</span>
                <button onClick={selectNone} className="text-[10px] text-gray-500 hover:text-gray-300" data-testid="cc-select-none">Clear / Auto</button>
              </div>
              <button onClick={loadUtxos} className="text-gray-600 hover:text-gray-300 transition-colors" data-testid="cc-refresh">
                <FiRefreshCw size={12} className={utxoLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* UTXO List */}
            {utxoLoading ? (
              <div className="flex items-center justify-center py-4 text-gray-500 text-xs"><FiLoader size={14} className="animate-spin mr-2" /> Loading UTXOs...</div>
            ) : allUtxos.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">No UTXOs found across any address</p>
            ) : (
              <div className="space-y-1">
                {allUtxos.map((utxo, i) => {
                  const key = utxoKey(utxo);
                  const isSelected = selectedUtxos.has(key);
                  const isConfirmed = utxo.status?.confirmed;
                  const typeColor = {
                    main: 'text-blue-400', change: 'text-amber-400', object: 'text-teal-400', royalty: 'text-purple-400',
                  }[utxo.ownerType] || 'text-gray-400';

                  return (
                    <button key={key} onClick={() => toggleUtxo(utxo)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                        isSelected ? 'bg-blue-600/15 border border-blue-500/30' : 'bg-gray-800/30 border border-transparent hover:bg-gray-800/50'
                      }`}
                      data-testid={`utxo-row-${i}`}>
                      {/* Checkbox */}
                      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                        isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-600'
                      }`}>
                        {isSelected && <FiCheck size={10} className="text-white" />}
                      </div>

                      {/* UTXO Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[9px] font-bold uppercase ${typeColor}`}>{utxo.ownerType}</span>
                          <span className="text-[10px] text-gray-400">{utxo.ownerLabel}</span>
                          {!isConfirmed && <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">Unconfirmed</span>}
                        </div>
                        <p className="text-[9px] text-gray-600 font-mono truncate">{utxo.txid}:{utxo.vout}</p>
                      </div>

                      {/* Amount */}
                      <span className="text-xs font-medium text-gray-200 flex-shrink-0">{(utxo.value / 1e8).toFixed(8)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected total */}
            {coinControlActive && selectedUtxos.size > 0 && (
              <div className="pt-2 border-t border-gray-800/50 flex justify-between text-xs">
                <span className="text-gray-500">Selected Total</span>
                <span className="text-gray-200 font-semibold">{(selectedBalance / 1e8).toFixed(8)} BTC</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fee Selection */}
      <div>
        <label className="block text-xs text-gray-400 font-medium mb-1.5">Network Fee (sat/vB)</label>
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {[
            { key: 'economy', label: 'Economy', icon: FiClock, rate: feeRates.economy },
            { key: 'standard', label: 'Standard', icon: FiDollarSign, rate: feeRates.standard },
            { key: 'priority', label: 'Priority', icon: FiZap, rate: feeRates.priority },
            { key: 'custom', label: 'Custom', icon: FiSliders, rate: null },
          ].map(f => (
            <button key={f.key} onClick={() => setFeePreset(f.key)}
              className={`p-2 rounded-lg border text-center transition-colors ${
                feePreset === f.key ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-gray-700 bg-gray-800/50 text-gray-500 hover:text-gray-300'
              }`}
              data-testid={`fee-${f.key}`}>
              <f.icon size={14} className="mx-auto mb-0.5" />
              <p className="text-[10px] font-medium">{f.label}</p>
              {f.rate !== null && <p className="text-[9px]">{f.rate} sat/vB</p>}
            </button>
          ))}
        </div>
        {feePreset === 'custom' && (
          <input value={customFee} onChange={e => setCustomFee(e.target.value)} placeholder="sat/vB" type="number" min="1"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
            data-testid="custom-fee-input" />
        )}
      </div>

      {/* Warning */}
      {warning && (
        <div className="flex items-start gap-2 p-2.5 bg-amber-900/20 border border-amber-700/30 rounded-lg text-amber-400 text-xs">
          <FiAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{warning}
        </div>
      )}

      {/* Summary */}
      <div className="p-3 bg-gray-800/50 rounded-lg space-y-1.5" data-testid="send-summary">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Amount</span>
          <span className="text-gray-300">{amount || '0'} BTC</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Inputs</span>
          <span className="text-gray-300">{coinControlActive ? `${selectedUtxos.size} selected` : 'Auto'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Est. Fee ({activeFeeRate} sat/vB)</span>
          <span className="text-gray-300">~{(estimatedFeeSats / 1e8).toFixed(8)} BTC</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Available</span>
          <span className="text-gray-300">{(selectedBalance / 1e8).toFixed(8)} BTC</span>
        </div>
        <div className="border-t border-gray-700 pt-1.5 flex justify-between text-xs font-semibold">
          <span className="text-gray-400">Total</span>
          <span className="text-white">{(totalCost / 1e8).toFixed(8)} BTC</span>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="send-error">{error}</p>
      )}

      <button onClick={handleSend} disabled={!canSend || sending}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
        data-testid="send-confirm-btn">
        <FiSend size={16} />
        {sending ? 'Signing & Broadcasting...' : 'Send Transaction'}
      </button>
    </div>
  );
};
