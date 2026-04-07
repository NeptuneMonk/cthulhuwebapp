import React, { useState, useEffect, useCallback } from 'react';
import { FiTrash2, FiX, FiCheck, FiAlertTriangle, FiShield, FiArrowLeft, FiMinus, FiPlus } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { addTransaction } from '@/utils/txHistory';
import { addPendingTx } from '@/utils/txBuilder';
import { addOptimisticItem } from '@/utils/optimisticCache';
import { CachedImage } from '@/components/CachedImage';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import FeePicker from '@/components/FeePicker';

function useActiveWallet() {
  const { wallet, isConnected: walletConnected, refreshBalance } = useWallet();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  return {
    wif: authWif || wallet?.wif,
    address: authUser?.address || wallet?.address,
    isConnected: authConnected || walletConnected,
    refreshBalance,
  };
}

export function BatchBurnModal({ ownedObjects, network, onClose, onBurned }) {
  const { wif, address, isConnected, refreshBalance } = useActiveWallet();
  const [selected, setSelected] = useState(new Map());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [walletSats, setWalletSats] = useState(null);
  const mediaOpts = { mainnet: isMainnetNetwork(network) };

  const myObjects = ownedObjects.filter(o => {
    const owned = o.owners?.find(ow => ow.address === address);
    return owned && owned.quantity > 0;
  });

  const selectedCount = selected.size;
  const estimatedMinSats = (7 + selectedCount) * 546 + 1500;
  const insufficientFunds = walletSats !== null && walletSats < estimatedMinSats;

  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const { fetchUtxos, getCachedChangeAddress } = await import('@/utils/txBuilder');
        const utxos = await fetchUtxos(address, network);
        let total = utxos.reduce((s, u) => s + (u.value || 0), 0);
        try {
          const ca = getCachedChangeAddress(address);
          if (ca) { const cu = await fetchUtxos(ca, network); total += cu.reduce((s, u) => s + (u.value || 0), 0); }
        } catch {}
        setWalletSats(total);
      } catch { setWalletSats(null); }
    })();
  }, [address, network]);

  const toggleObject = useCallback((obj) => {
    const a = obj.object_address || obj.creators?.[0]?.address;
    if (!a) return;
    setSelected(p => { const n = new Map(p); if (n.has(a)) n.delete(a); else n.set(a, obj.owners?.find(o => o.address === address)?.quantity || 1); return n; });
  }, [address]);

  const updateQty = useCallback((addr, delta) => {
    setSelected(p => {
      const n = new Map(p);
      const cur = n.get(addr) || 1;
      const obj = myObjects.find(o => (o.object_address || o.creators?.[0]?.address) === addr);
      const max = obj?.owners?.find(o => o.address === address)?.quantity || 1;
      n.set(addr, Math.max(1, Math.min(max, cur + delta)));
      return n;
    });
  }, [myObjects, address]);

  const handleBatchBurn = async () => {
    if (!confirmed || !isConnected || selectedCount === 0) return;
    if (!wif) { setError('Wallet is locked. Enter your password to unlock.'); return; }
    setSending(true); setError(null);
    try {
      const [{ buildBatchBurnTransaction }, { buildAndBroadcast }] = await Promise.all([import('@/utils/p2fk'), import('@/utils/txBuilder')]);
      const burnItems = [...selected.entries()].map(([objectAddress, quantity]) => ({ objectAddress, quantity }));
      const { addresses, taxInsertIndex } = buildBatchBurnTransaction(wif, burnItems, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        setTxResult({ txids: [result.txid], count: burnItems.length });
        for (const { objectAddress, quantity } of burnItems) {
          const obj = myObjects.find(o => (o.object_address || o.creators?.[0]?.address) === objectAddress);
          addTransaction(address, { txid: result.txid, type: 'BRN', network, addresses, label: `Batch burn: ${obj?.name || objectAddress}` });
          addOptimisticItem({ txid: result.txid, type: 'BRN', network, senderAddress: address, objectAddress, data: { name: obj?.name || 'Object', quantity } });
        }
        addPendingTx({ txid: result.txid, type: 'Batch Burn', label: `${burnItems.length} object${burnItems.length > 1 ? 's' : ''}`, network });
        refreshBalance();
        burnItems.forEach(({ objectAddress }) => window.dispatchEvent(new CustomEvent('tethers-changed', { detail: { burned: objectAddress } })));
        if (onBurned) onBurned(burnItems.map(i => i.objectAddress));
      }
    } catch (err) { setError(err.message || 'Batch burn failed'); }
    finally { setSending(false); }
  };

  const getImgUrl = (ref) => parseMediaString(ref, mediaOpts)?.url || null;

  if (txResult) return (
    <div className="fixed inset-0 bg-black/80 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose} data-testid="batch-burn-overlay">
      <div className="bg-gray-900 w-full h-full lg:h-auto lg:border lg:border-gray-800 lg:rounded-xl lg:w-auto lg:max-w-md overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3"><FiCheck size={24} className="text-green-400" /></div>
          <p className="text-green-400 font-medium mb-2">Burns broadcast!</p>
          <p className="text-xs text-gray-500 mb-1">{txResult.count} object{txResult.count > 1 ? 's' : ''} burned in {txResult.txids.length} transaction{txResult.txids.length > 1 ? 's' : ''}</p>
          <div className="space-y-1 mb-4">{txResult.txids.map((txid, i) => (
            <p key={txid} className="text-xs text-gray-500 font-mono break-all">TX{txResult.txids.length > 1 ? ` ${i + 1}` : ''}: {txid}</p>
          ))}</div>
          <button onClick={onClose} className="px-5 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700" data-testid="batch-burn-done">Close</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose} data-testid="batch-burn-overlay">
      <div className="bg-gray-900 w-full h-full lg:h-auto lg:border lg:border-gray-800 lg:rounded-xl lg:w-auto lg:max-w-lg lg:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 lg:px-5 py-3 lg:py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 lg:hidden" data-testid="batch-burn-back"><FiArrowLeft size={20} /></button>
            <h3 className="text-base lg:text-lg font-bold text-gray-100 flex items-center gap-2"><FiTrash2 size={18} /> Batch Burn</h3>
            {selectedCount > 0 && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-medium" data-testid="batch-burn-count">{selectedCount}</span>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1 hidden lg:block" data-testid="batch-burn-close-x"><FiX size={22} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="batch-burn-list">
          {myObjects.length === 0 ? <div className="text-center py-8 text-gray-500 text-sm">No owned objects to burn</div> : myObjects.map(obj => {
            const objAddr = obj.object_address || obj.creators?.[0]?.address;
            const isSel = selected.has(objAddr);
            const ownedQty = obj.owners?.find(o => o.address === address)?.quantity || 0;
            const selQty = selected.get(objAddr) || 0;
            const imgUrl = getImgUrl(obj.image || obj.Image);
            return (
              <div key={objAddr} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${isSel ? 'bg-red-500/5 border-red-500/30' : 'bg-gray-800/40 border-gray-800 hover:border-gray-700'}`}
                onClick={() => toggleObject(obj)} data-testid={`batch-item-${objAddr}`}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSel ? 'bg-red-500 border-red-500' : 'border-gray-600'}`}>{isSel && <FiCheck size={12} className="text-white" />}</div>
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                  {imgUrl ? <CachedImage src={imgUrl} alt={obj.name || obj.Name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">OBJ</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">{obj.name || obj.Name || 'Object'}</p>
                  <p className="text-[10px] text-gray-500">Owned: {ownedQty}</p>
                </div>
                {isSel && <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => updateQty(objAddr, -1)} disabled={selQty <= 1} className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center text-gray-300" data-testid={`batch-qty-minus-${objAddr}`}><FiMinus size={12} /></button>
                  <span className="text-sm text-gray-200 font-mono w-8 text-center" data-testid={`batch-qty-${objAddr}`}>{selQty}</span>
                  <button onClick={() => updateQty(objAddr, 1)} disabled={selQty >= ownedQty} className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 flex items-center justify-center text-gray-300" data-testid={`batch-qty-plus-${objAddr}`}><FiPlus size={12} /></button>
                </div>}
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-800 p-4 space-y-3 flex-shrink-0">
          {selectedCount > 0 && <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
            <div className="flex items-start gap-2"><FiAlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" /><div><p className="text-sm text-red-400 font-medium">Irreversible</p><p className="text-[11px] text-gray-400">{selectedCount} object{selectedCount > 1 ? 's' : ''} will be permanently destroyed.</p></div></div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="rounded border-gray-700 bg-gray-800" data-testid="batch-burn-confirm-checkbox" /><span className="text-xs text-gray-300">I understand this is permanent</span></label>
          </div>}
          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="batch-burn-error">{error}</p>}
          {walletSats !== null && selectedCount > 0 && <div className={`text-xs px-3 py-2 rounded-lg border ${insufficientFunds ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' : 'text-gray-500 bg-gray-800/50 border-gray-700/50'}`} data-testid="batch-burn-balance">
            {insufficientFunds ? <><FiAlertTriangle size={12} className="inline mr-1" /><span className="font-medium">Insufficient:</span> {walletSats.toLocaleString()} sats</> : <span>Est. cost: ~{estimatedMinSats.toLocaleString()} sats ({walletSats.toLocaleString()} available)</span>}
          </div>}
          <FeePicker network={network} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
            <button onClick={handleBatchBurn} disabled={!confirmed || sending || !isConnected || selectedCount === 0 || insufficientFunds}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold" data-testid="batch-burn-submit">
              <FiTrash2 size={16} />{sending ? 'Signing...' : selectedCount > 0 ? `Burn ${selectedCount} Object${selectedCount > 1 ? 's' : ''}` : 'Select Objects'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}