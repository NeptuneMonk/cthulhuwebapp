import React, { useState, useEffect } from 'react';
import { FiX, FiGift, FiTrash2, FiShoppingCart, FiAlertTriangle, FiCheck, FiShield, FiTag, FiKey, FiCopy, FiArrowLeft } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { addTransaction } from '@/utils/txHistory';
import { addPendingTx } from '@/utils/txBuilder';
import { addOptimisticItem } from '@/utils/optimisticCache';

const ModalShell = ({ title, icon: Icon, onClose, children }) => (
  <div className="fixed inset-0 bg-black/80 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose} data-testid="action-modal-overlay">
    <div className="bg-gray-900 w-full h-full lg:h-auto lg:border lg:border-gray-800 lg:rounded-xl lg:w-auto lg:max-w-md lg:max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()} data-testid="action-modal">
      <div className="flex items-center justify-between px-4 lg:px-5 py-3 lg:py-4 border-b border-gray-800 bg-gray-900 z-10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors lg:hidden" data-testid="action-modal-back">
            <FiArrowLeft size={20} />
          </button>
          <h3 className="text-base lg:text-lg font-bold text-gray-100 flex items-center gap-2">
            <Icon size={18} /> {title}
          </h3>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white p-1 hidden lg:block" data-testid="action-modal-close">
          <FiX size={22} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 lg:p-5">{children}</div>
    </div>
  </div>
);

const TxSuccess = ({ txid, type, onClose }) => (
  <div className="text-center py-4" data-testid="tx-success">
    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
      <FiCheck size={24} className="text-green-400" />
    </div>
    <p className="text-green-400 font-medium mb-2">{type} transaction broadcast!</p>
    <p className="text-xs text-gray-500 font-mono break-all mb-4">TX: {txid}</p>
    <button onClick={onClose} className="px-5 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors" data-testid="tx-success-close">
      Close
    </button>
  </div>
);

/** Helper: get active WIF from auth or legacy wallet */
function useActiveWallet() {
  const { wallet, isConnected: walletConnected, balance, refreshBalance } = useWallet();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();

  return {
    wif: authWif || wallet?.wif,
    address: authUser?.address || wallet?.address,
    // "Connected" means user has a wallet address — WIF may still need unlocking
    isConnected: (authConnected && !!authUser?.address) || (walletConnected && !!wallet?.address),
    balance,
    refreshBalance,
  };
}

export const GiveModal = ({ object, network, onClose }) => {
  const { wif, address, isConnected, refreshBalance } = useActiveWallet();
  const [recipient, setRecipient] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [walletSats, setWalletSats] = useState(null);

  // Cascade transfer state
  const [subtopics, setSubtopics] = useState([]);
  const [cascadeEnabled, setCascadeEnabled] = useState(true);
  const [cascadeProgress, setCascadeProgress] = useState(null); // { current, total, results }
  const isTether = (object.license || '').toLowerCase().startsWith('cthulhu:tether');

  const objectAddress = object.object_address || object.creators?.[0]?.address || '';
  const myOwned = object.owners?.find(o => o.address === address)?.quantity || 0;

  // Estimated cost per GIV: ~6 P2FK dust outputs + network fee
  const perTxCost = 6 * 546 + 1500;
  const totalTxCount = 1 + (cascadeEnabled ? subtopics.length : 0);
  const estimatedMinSats = perTxCost * totalTxCount;
  const insufficientFunds = walletSats !== null && walletSats < estimatedMinSats;

  // Fetch balance on mount
  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const { fetchUtxos, getCachedChangeAddress } = await import('@/utils/txBuilder');
        const mainUtxos = await fetchUtxos(address, network);
        const mainTotal = mainUtxos.reduce((s, u) => s + (u.value || 0), 0);
        let changeTotal = 0;
        try {
          const changeAddr = getCachedChangeAddress(address);
          if (changeAddr) {
            const changeUtxos = await fetchUtxos(changeAddr, network);
            changeTotal = changeUtxos.reduce((s, u) => s + (u.value || 0), 0);
          }
        } catch {}
        setWalletSats(mainTotal + changeTotal);
      } catch { setWalletSats(null); }
    })();
  }, [address, network]);

  // Fetch owned sub-topics for cascade when this is a tether
  useEffect(() => {
    if (!isTether || !address || !objectAddress) return;
    const API = process.env.REACT_APP_BACKEND_URL;
    fetch(`${API}/api/rooms/${objectAddress}/owned-subtopics/${address}?network=${network}`)
      .then(r => r.ok ? r.json() : { subtopics: [] })
      .then(data => setSubtopics(data.subtopics || []))
      .catch(() => setSubtopics([]));
  }, [isTether, address, objectAddress, network]);

  const handleGive = async () => {
    if (!recipient.trim() || !isConnected) return;
    if (!wif) { setError('Wallet is locked. Enter your password to unlock.'); return; }
    setSending(true);
    setError(null);

    try {
      const [{ buildGiveTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      // 1. Give the parent object
      const { addresses, taxInsertIndex } = buildGiveTransaction(wif, objectAddress, recipient.trim(), parseInt(quantity) || 1, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);

      if (!result.success) throw new Error('Parent transfer failed');

      addTransaction(address, { txid: result.txid, type: 'GIV', network, addresses, label: `Give ${object.name || 'object'}` });
      addPendingTx({ txid: result.txid, type: 'Give', label: object.name || 'Object', network });
      addOptimisticItem({
        txid: result.txid, type: 'GIV', network, senderAddress: address, objectAddress,
        data: { name: object.name || 'Object', recipient: recipient.trim(), quantity: parseInt(quantity) || 1 },
      });

      // 2. Cascade: give each sub-topic sequentially
      const cascadeResults = [{ name: object.name, txid: result.txid, success: true }];
      if (cascadeEnabled && subtopics.length > 0) {
        setCascadeProgress({ current: 0, total: subtopics.length, results: cascadeResults });
        for (let i = 0; i < subtopics.length; i++) {
          const sub = subtopics[i];
          setCascadeProgress({ current: i + 1, total: subtopics.length, results: [...cascadeResults] });
          try {
            // Brief delay to let mempool accept previous tx
            await new Promise(r => setTimeout(r, 1500));
            const subGiv = buildGiveTransaction(wif, sub.topic_address, recipient.trim(), sub.owned_quantity || 1, network);
            const subResult = await buildAndBroadcast(wif, subGiv.addresses, network, [], 0, 546, [], subGiv.taxInsertIndex);
            if (subResult.success) {
              cascadeResults.push({ name: sub.name, txid: subResult.txid, success: true });
              addTransaction(address, { txid: subResult.txid, type: 'GIV', network, addresses: subGiv.addresses, label: `Cascade: ${sub.name}` });
              addPendingTx({ txid: subResult.txid, type: 'Give', label: `${sub.name} (cascade)`, network });
            } else {
              cascadeResults.push({ name: sub.name, success: false, error: 'Broadcast failed' });
            }
          } catch (err) {
            cascadeResults.push({ name: sub.name, success: false, error: err.message });
          }
        }
        setCascadeProgress({ current: subtopics.length, total: subtopics.length, results: cascadeResults });
      }

      setTxResult({ ...result, cascadeResults });
      refreshBalance();
    } catch (err) {
      setError(err.message || 'Give failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell title="Give Object" icon={FiGift} onClose={onClose}>
      {txResult ? (
        <div className="space-y-3" data-testid="tx-success">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
            <FiCheck size={24} className="text-green-400" />
          </div>
          <p className="text-green-400 font-medium text-center mb-1">Transfer complete!</p>
          {(txResult.cascadeResults || []).map((cr, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${cr.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`} data-testid={`cascade-result-${i}`}>
              {cr.success ? <FiCheck size={12} /> : <FiAlertTriangle size={12} />}
              <span className="font-medium truncate">{cr.name}</span>
              {cr.success && <span className="text-gray-600 font-mono ml-auto">{cr.txid?.slice(0, 12)}...</span>}
              {!cr.success && <span className="ml-auto">{cr.error}</span>}
            </div>
          ))}
          <button onClick={onClose} className="w-full mt-2 px-5 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors" data-testid="tx-success-close">Close</button>
        </div>
      ) : cascadeProgress ? (
        <div className="space-y-4 py-4" data-testid="cascade-progress">
          <p className="text-sm text-gray-300 text-center font-medium">Cascade Transfer in Progress</p>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${((cascadeProgress.current + 1) / (cascadeProgress.total + 1)) * 100}%` }} />
          </div>
          <p className="text-xs text-gray-500 text-center">
            Transferring sub-topic {cascadeProgress.current} of {cascadeProgress.total}...
          </p>
          {cascadeProgress.results.map((cr, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${cr.success ? 'text-green-400' : 'text-red-400'}`}>
              {cr.success ? <FiCheck size={10} /> : <FiAlertTriangle size={10} />}
              <span className="truncate">{cr.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center gap-3">
            <div className="text-sm text-gray-300 font-medium">{object.name}</div>
            {myOwned > 0 && <span className="text-xs text-gray-500">You own: {myOwned}</span>}
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Recipient Address</label>
            <input
              type="text"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Bitcoin address..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono text-xs"
              data-testid="give-recipient-input"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={myOwned || 999999}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              data-testid="give-quantity-input"
            />
          </div>

          {/* Cascade Transfer Section — only for tethers with sub-topics */}
          {isTether && subtopics.length > 0 && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 space-y-2" data-testid="cascade-section">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cascadeEnabled}
                  onChange={e => setCascadeEnabled(e.target.checked)}
                  className="rounded border-gray-600 text-purple-500"
                  data-testid="cascade-toggle"
                />
                <span className="text-xs font-medium text-purple-400">
                  Include {subtopics.length} linked sub-topic{subtopics.length > 1 ? 's' : ''}
                </span>
              </label>
              {cascadeEnabled && (
                <div className="space-y-1 pl-6">
                  {subtopics.map((sub, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-400" data-testid={`cascade-subtopic-${i}`}>
                      <FiTag size={10} className="text-purple-400/60" />
                      <span className="truncate">{sub.name}</span>
                      <span className="text-gray-600 ml-auto">x{sub.owned_quantity}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-600 mt-1">
                    {subtopics.length + 1} sequential transactions will be broadcast (~{(estimatedMinSats / 1000).toFixed(1)}k sats total)
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="give-error">{error}</p>}

          {/* Balance check */}
          {walletSats !== null && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              insufficientFunds
                ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                : 'text-gray-500 bg-gray-800/50 border-gray-700/50'
            }`} data-testid="give-balance-check">
              {insufficientFunds ? (
                <>
                  <FiAlertTriangle size={12} className="inline mr-1" />
                  <span className="font-medium">Insufficient balance:</span> {walletSats.toLocaleString()} sats available, need ~{estimatedMinSats.toLocaleString()} sats for fees.
                  {network.includes('testnet') && (
                    <span className="block mt-1 text-amber-500/70">Fund your wallet with tBTC before sending.</span>
                  )}
                </>
              ) : (
                <span>Balance: {walletSats.toLocaleString()} sats</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <FiAlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-400">This will create an on-chain transaction. Make sure the recipient address is correct.</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
            <button
              onClick={handleGive}
              disabled={!recipient.trim() || sending || !isConnected || insufficientFunds}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
              data-testid="give-confirm-btn"
            >
              <FiGift size={16} />
              {sending ? 'Signing...' : cascadeEnabled && subtopics.length > 0
                ? `Give + ${subtopics.length} sub-topic${subtopics.length > 1 ? 's' : ''}`
                : `Give ${quantity} unit${quantity > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export const BurnModal = ({ object, network, onClose }) => {
  const { wif, address, isConnected, refreshBalance } = useActiveWallet();
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [walletSats, setWalletSats] = useState(null);

  const objectAddress = object.object_address || object.creators?.[0]?.address || '';
  const myOwned = object.owners?.find(o => o.address === address)?.quantity || 0;

  // Estimated cost: ~5 P2FK dust outputs + network fee
  const estimatedMinSats = 5 * 546 + 1500;
  const insufficientFunds = walletSats !== null && walletSats < estimatedMinSats;

  // Fetch balance on mount
  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const { fetchUtxos, getCachedChangeAddress } = await import('@/utils/txBuilder');
        const mainUtxos = await fetchUtxos(address, network);
        const mainTotal = mainUtxos.reduce((s, u) => s + (u.value || 0), 0);
        let changeTotal = 0;
        try {
          const changeAddr = getCachedChangeAddress(address);
          if (changeAddr) {
            const changeUtxos = await fetchUtxos(changeAddr, network);
            changeTotal = changeUtxos.reduce((s, u) => s + (u.value || 0), 0);
          }
        } catch {}
        setWalletSats(mainTotal + changeTotal);
      } catch { setWalletSats(null); }
    })();
  }, [address, network]);

  const handleBurn = async () => {
    if (!confirmed || !isConnected) return;
    if (!wif) { setError('Wallet is locked. Enter your password to unlock.'); return; }
    setSending(true);
    setError(null);
    try {
      const [{ buildBurnTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      const { addresses, taxInsertIndex } = buildBurnTransaction(wif, objectAddress, parseInt(quantity) || 1, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);

      if (result.success) {
        setTxResult(result);
        addTransaction(address, {
          txid: result.txid,
          type: 'BRN',
          network,
          addresses,
          label: `Burn ${object.name || 'object'}`,
        });
        addPendingTx({ txid: result.txid, type: 'Burn', label: object.name || 'Object', network });
        addOptimisticItem({
          txid: result.txid,
          type: 'BRN',
          network,
          senderAddress: address,
          objectAddress,
          data: {
            name: object.name || 'Object',
            quantity: parseInt(quantity) || 1,
          },
        });
        refreshBalance();
        // Also notify the tether blocklist
        window.dispatchEvent(new CustomEvent('tethers-changed', { detail: { burned: objectAddress } }));
      }
    } catch (err) {
      setError(err.message || 'Burn failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell title="Burn Object" icon={FiTrash2} onClose={onClose}>
      {txResult ? (
        <TxSuccess txid={txResult.txid} type="Burn" onClose={onClose} />
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center gap-3">
            <div className="text-sm text-gray-300 font-medium">{object.name}</div>
            {myOwned > 0 && <span className="text-xs text-gray-500">You own: {myOwned}</span>}
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Quantity to Burn</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={myOwned || 999999}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              data-testid="burn-quantity-input"
            />
          </div>

          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
            <div className="flex items-start gap-3">
              <FiAlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-400 font-medium mb-1">This action is irreversible</p>
                <p className="text-xs text-gray-400">Burned objects are permanently destroyed and cannot be recovered.</p>
              </div>
            </div>
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="rounded border-gray-700 bg-gray-800"
                data-testid="burn-confirm-checkbox"
              />
              <span className="text-xs text-gray-300">I understand this is permanent</span>
            </label>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="burn-error">{error}</p>}

          {/* Balance check */}
          {walletSats !== null && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              insufficientFunds
                ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                : 'text-gray-500 bg-gray-800/50 border-gray-700/50'
            }`} data-testid="burn-balance-check">
              {insufficientFunds ? (
                <>
                  <FiAlertTriangle size={12} className="inline mr-1" />
                  <span className="font-medium">Insufficient balance:</span> {walletSats.toLocaleString()} sats available, need ~{estimatedMinSats.toLocaleString()} sats for fees.
                </>
              ) : (
                <span>Balance: {walletSats.toLocaleString()} sats</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
            <button
              onClick={handleBurn}
              disabled={!confirmed || sending || !isConnected || insufficientFunds}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
              data-testid="burn-confirm-btn"
            >
              <FiTrash2 size={16} />
              {sending ? 'Signing...' : `Burn ${quantity} unit${quantity > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export const BuyModal = ({ object, network, onClose }) => {
  const { wif, address, isConnected, refreshBalance } = useActiveWallet();
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [walletSats, setWalletSats] = useState(null);

  const listing = object.listings?.[0];
  const objectAddress = object.object_address || object.creators?.[0]?.address || '';
  const pricePerUnit = listing?.price || 0;
  const totalPriceBtc = pricePerUnit * quantity;
  const totalPriceSats = Math.round(totalPriceBtc * 100_000_000);
  const available = listing?.quantity || 0;

  // Minimum sats needed: ~6 P2FK addresses × 546 dust + price + ~1000 fee
  const estimatedMinSats = 6 * 546 + totalPriceSats + 1500;
  const insufficientFunds = walletSats !== null && walletSats < estimatedMinSats;

  // Fetch balance on mount (both main address AND change address)
  useEffect(() => {
    if (!address) return;
    const fetchBal = async () => {
      try {
        const { fetchUtxos, getCachedChangeAddress } = await import('@/utils/txBuilder');
        const mainUtxos = await fetchUtxos(address, network);
        const mainTotal = mainUtxos.reduce((s, u) => s + (u.value || 0), 0);
        let changeTotal = 0;
        try {
          const changeAddr = getCachedChangeAddress(address);
          if (changeAddr) {
            const changeUtxos = await fetchUtxos(changeAddr, network);
            changeTotal = changeUtxos.reduce((s, u) => s + (u.value || 0), 0);
          }
        } catch {}
        setWalletSats(mainTotal + changeTotal);
      } catch { setWalletSats(null); }
    };
    fetchBal();
  }, [address, network]);

  // Build royalty map from object data (address -> percentage)
  const royalties = {};
  if (object.royalties && typeof object.royalties === 'object') {
    for (const [addr, pct] of Object.entries(object.royalties)) {
      if (pct > 0) royalties[addr] = pct;
    }
  }

  const handleBuy = async () => {
    if (!listing || !isConnected) return;
    if (!wif) {
      // Wallet is locked — need password to sign the transaction
      setError('Wallet is locked. Please unlock your wallet (enter your password) before buying.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const [{ buildBuyTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      // Pass royalties so buildBuyTransaction can calculate distribution (per SUP C# ObjectBuy.cs)
      const { addresses, extraPaymentOutputs, postPaymentDustAddresses, taxInsertIndex } = buildBuyTransaction(
        wif, objectAddress, listing.owner, parseInt(quantity) || 1, totalPriceSats, network, royalties
      );

      // Build extra outputs: royalty + owner payments from p2fk (per SUP C# ObjectBuy.cs)
      const extraOutputs = [...extraPaymentOutputs];
      // Pass postPaymentDustAddresses (objectAddress + senderAddress) to be placed AFTER payments
      // taxInsertIndex positions the tax after data/keywords, before payments and special addresses
      const result = await buildAndBroadcast(wif, addresses, network, extraOutputs, 0, 546, postPaymentDustAddresses, taxInsertIndex);

      if (result.success) {
        setTxResult(result);
        addTransaction(address, {
          txid: result.txid,
          type: 'BUY',
          network,
          addresses,
          label: `Buy ${object.name || 'object'}`,
        });
        addPendingTx({ txid: result.txid, type: 'Buy', label: object.name || 'Object', network });
        addOptimisticItem({
          txid: result.txid,
          type: 'BUY',
          network,
          senderAddress: address,
          objectAddress,
          data: {
            name: object.name || 'Object',
            quantity: parseInt(quantity) || 1,
            price: totalPriceBtc,
          },
        });
        refreshBalance();
      }
    } catch (err) {
      setError(err.message || 'Purchase failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell title="Buy Object" icon={FiShoppingCart} onClose={onClose}>
      {txResult ? (
        <TxSuccess txid={txResult.txid} type="Buy" onClose={onClose} />
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-sm text-gray-300 font-medium mb-1">{object.name}</div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>{available.toLocaleString()} available</span>
              <span>{pricePerUnit === 0 ? 'FREE' : `${pricePerUnit} BTC each`}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(Math.max(1, Math.min(available, parseInt(e.target.value) || 1)))}
              min={1}
              max={available}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              data-testid="buy-quantity-input"
            />
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Unit Price</span>
              <span className="text-gray-200">{pricePerUnit === 0 ? 'FREE' : `${pricePerUnit} BTC`}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Quantity</span>
              <span className="text-gray-200">{quantity}</span>
            </div>
            {Object.keys(royalties).length > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Royalties</span>
                <span className="text-gray-400">{Object.values(royalties).reduce((a, b) => a + b, 0)}%</span>
              </div>
            )}
            <div className="border-t border-gray-700 pt-2 flex justify-between text-sm font-semibold">
              <span className="text-gray-300">Total</span>
              <span className="text-emerald-400">{totalPriceBtc === 0 ? 'FREE' : `${totalPriceBtc} BTC`}</span>
            </div>
            <p className="text-[10px] text-gray-600">+ network fee (~{(300 * 10 / 100_000_000).toFixed(8)} BTC)</p>
          </div>

          {/* Wallet balance indicator */}
          {walletSats !== null && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              insufficientFunds
                ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                : 'text-gray-500 bg-gray-800/50 border-gray-700/50'
            }`} data-testid="buy-balance-check">
              {insufficientFunds ? (
                <>
                  <span className="font-medium">Low balance:</span> {walletSats.toLocaleString()} sats available, need ~{estimatedMinSats.toLocaleString()} sats.
                  {network.includes('testnet') && (
                    <span className="block mt-1 text-amber-500/70">Buy tBTC at <a href="https://buytestnet.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">buytestnet.com</a> before buying.</span>
                  )}
                </>
              ) : (
                <span>Balance: {walletSats.toLocaleString()} sats</span>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="buy-error">{error}</p>}

          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
            <button
              onClick={handleBuy}
              disabled={!listing || sending || !isConnected || insufficientFunds}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
              data-testid="buy-confirm-btn"
            >
              <FiShoppingCart size={16} />
              {sending ? 'Signing...' : (pricePerUnit === 0 ? 'Claim (Free)' : `Buy for ${totalPriceBtc} BTC`)}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export const ListModal = ({ object, network, onClose }) => {
  const { wif, address, isConnected, refreshBalance } = useActiveWallet();
  const DRAFT_KEY = `list-draft-${object?.creators?.[0]?.address || 'unknown'}`;

  // Restore draft state
  const savedDraft = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; } })();

  const [quantity, setQuantity] = useState(savedDraft.quantity || 1);
  const [priceEach, setPriceEach] = useState(savedDraft.priceEach || '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [showRoyalties, setShowRoyalties] = useState(false);
  const [royaltiesAddr, setRoyaltiesAddr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [walletSats, setWalletSats] = useState(null);

  const objectAddress = object.object_address || object.creators?.[0]?.address || '';
  const myOwned = object.owners?.find(o => o.address === address)?.quantity || 0;
  const isPrimary = objectAddress === address;

  // Estimated cost: ~5 P2FK dust outputs + network fee
  const estimatedMinSats = 5 * 546 + 1500;
  const insufficientFunds = walletSats !== null && walletSats < estimatedMinSats;

  // Fetch balance on mount
  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const { fetchUtxos, getCachedChangeAddress } = await import('@/utils/txBuilder');
        const mainUtxos = await fetchUtxos(address, network);
        const mainTotal = mainUtxos.reduce((s, u) => s + (u.value || 0), 0);
        let changeTotal = 0;
        try {
          const changeAddr = getCachedChangeAddress(address);
          if (changeAddr) {
            const changeUtxos = await fetchUtxos(changeAddr, network);
            changeTotal = changeUtxos.reduce((s, u) => s + (u.value || 0), 0);
          }
        } catch {}
        setWalletSats(mainTotal + changeTotal);
      } catch { setWalletSats(null); }
    })();
  }, [address, network]);

  // Auto-save draft on change
  useEffect(() => {
    if (quantity || priceEach) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ quantity, priceEach }));
    }
  }, [quantity, priceEach, DRAFT_KEY]);

  // Clear draft on success
  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  // Generate royalties address
  const generateRoyaltiesAddr = async () => {
    if (!wif) return;
    try {
      const { getRoyaltiesAddress } = await import('@/utils/txBuilder');
      const addr = getRoyaltiesAddress(wif, network);
      setRoyaltiesAddr(addr);
    } catch (err) {
      setError('Failed to generate royalties address: ' + err.message);
    }
  };

  const copyAddr = () => {
    if (!royaltiesAddr) return;
    navigator.clipboard.writeText(royaltiesAddr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleList = async () => {
    if (!priceEach || !isConnected) return;
    if (!wif) { setError('Wallet is locked. Enter your password to unlock.'); return; }
    const priceNum = parseFloat(priceEach);
    if (isNaN(priceNum) || priceNum < 0) return;
    setSending(true);
    setError(null);
    try {
      const [{ buildListTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      const { addresses, taxInsertIndex } = buildListTransaction(
        wif, objectAddress, parseInt(quantity) || 1, priceNum, network
      );
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);

      if (result.success) {
        setTxResult(result);
        clearDraft();
        addTransaction(address, {
          txid: result.txid,
          type: 'LST',
          network,
          addresses,
          label: `List ${object.name || 'object'} for sale`,
        });
        addPendingTx({ txid: result.txid, type: 'List', label: object.name || 'Object', network });
        addOptimisticItem({
          txid: result.txid,
          type: 'LST',
          network,
          senderAddress: address,
          objectAddress,
          data: {
            name: object.name || 'Object',
            quantity: parseInt(quantity) || 1,
            priceEach: parseFloat(priceEach),
          },
        });
        refreshBalance();
      }
    } catch (err) {
      setError(err.message || 'List failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalShell title="List for Sale" icon={FiTag} onClose={onClose}>
      {txResult ? (
        <TxSuccess txid={txResult.txid} type="List" onClose={onClose} />
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center gap-3">
            <div className="text-sm text-gray-300 font-medium">{object.name}</div>
            {myOwned > 0 && <span className="text-xs text-gray-500">You own: {myOwned}</span>}
            {isPrimary && <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">Primary</span>}
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Quantity to List</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(Math.max(1, Math.min(myOwned || 999999, parseInt(e.target.value) || 1)))}
              min={1}
              max={myOwned || 999999}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none"
              data-testid="list-quantity-input"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Price per Unit (BTC)</label>
            <input
              type="text"
              value={priceEach}
              onChange={e => setPriceEach(e.target.value)}
              placeholder="0.001"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
              data-testid="list-price-input"
            />
          </div>

          {priceEach && parseFloat(priceEach) >= 0 && (
            <div className="bg-gray-800/50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Listing</span>
                <span className="text-gray-200">{quantity} unit{quantity > 1 ? 's' : ''} at {priceEach} BTC each</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Type</span>
                <span className={isPrimary ? 'text-amber-400' : 'text-blue-400'}>
                  {isPrimary ? 'Primary Listing' : 'Secondary Listing'}
                </span>
              </div>
            </div>
          )}

          {/* Royalties Address */}
          <div className="border border-gray-800/50 rounded-lg overflow-hidden">
            <button
              onClick={() => { setShowRoyalties(v => !v); if (!royaltiesAddr) generateRoyaltiesAddr(); }}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gray-400 hover:bg-gray-800/30 transition-colors"
              data-testid="list-royalties-toggle"
            >
              <span className="flex items-center gap-1.5"><FiKey size={12} /> Royalties Address</span>
              <span className="text-gray-600">{showRoyalties ? '−' : '+'}</span>
            </button>
            {showRoyalties && (
              <div className="px-3 pb-3 space-y-2">
                {royaltiesAddr ? (
                  <div className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
                    <code className="text-[10px] text-gray-300 font-mono flex-1 break-all">{royaltiesAddr}</code>
                    <button onClick={copyAddr} className="flex-shrink-0 text-gray-500 hover:text-white p-1" data-testid="list-royalties-copy">
                      {copied ? <FiCheck size={12} className="text-emerald-400" /> : <FiCopy size={12} />}
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-600">Generating...</p>
                )}
                <p className="text-[10px] text-gray-600">Use this address in object royalties to receive a % of every sale.</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <FiAlertTriangle size={14} className="text-blue-400 flex-shrink-0" />
            <p className="text-xs text-blue-400">This will create an on-chain listing. Others can purchase at this price.</p>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="list-error">{error}</p>}

          {/* Balance check */}
          {walletSats !== null && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              insufficientFunds
                ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                : 'text-gray-500 bg-gray-800/50 border-gray-700/50'
            }`} data-testid="list-balance-check">
              {insufficientFunds ? (
                <>
                  <FiAlertTriangle size={12} className="inline mr-1" />
                  <span className="font-medium">Insufficient balance:</span> {walletSats.toLocaleString()} sats available, need ~{estimatedMinSats.toLocaleString()} sats for fees.
                </>
              ) : (
                <span>Balance: {walletSats.toLocaleString()} sats</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
            <button
              onClick={handleList}
              disabled={!priceEach || parseFloat(priceEach) < 0 || sending || !isConnected || insufficientFunds}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
              data-testid="list-confirm-btn"
            >
              <FiTag size={16} />
              {sending ? 'Signing...' : `List ${quantity} unit${quantity > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};
