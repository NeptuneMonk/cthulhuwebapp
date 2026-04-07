import React, { useState } from 'react';
import { FiTrash2, FiAlertTriangle, FiShield, FiX } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import FeePicker from '@/components/FeePicker';

function useActiveWallet() {
  const { wallet, isConnected: walletConnected, refreshBalance } = useWallet();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  return {
    wif: authWif || wallet?.wif,
    address: authUser?.address || wallet?.address,
    isConnected: (authConnected && !!authUser?.address) || (walletConnected && !!wallet?.address),
    refreshBalance,
  };
}

export function BurnTetherModal({ tether, network, onClose, onBurned }) {
  const { wif, isConnected, refreshBalance } = useActiveWallet();
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);

  const objectAddress = tether.objectAddress || tether.object_address || '';

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
      const { addresses, taxInsertIndex } = buildBurnTransaction(wif, objectAddress, 1, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        setTxResult(result);
        refreshBalance();
        // Dispatch burn event to App.js blocklist before callback
        window.dispatchEvent(new CustomEvent('tethers-changed', { detail: { burned: objectAddress } }));
        if (onBurned) onBurned(objectAddress);
      }
    } catch (err) {
      setError(err.message || 'Burn failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose} data-testid="burn-tether-modal">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FiTrash2 size={16} className="text-red-400" /> Delete Tether
          </h3>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-white transition-colors" data-testid="burn-tether-close">
            <FiX size={18} />
          </button>
        </div>

        {txResult ? (
          <div className="text-center py-4" data-testid="burn-tether-success">
            <p className="text-green-400 font-medium mb-2">Tether burned!</p>
            <p className="text-xs text-gray-500 font-mono break-all">TX: {txResult.txid}</p>
            <button onClick={onClose} className="mt-4 px-5 py-2 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors">Close</button>
          </div>
        ) : (
          <>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-sm text-gray-200 font-medium">{tether.name || 'Room'}</p>
              <p className="text-[10px] text-gray-500 font-mono break-all mt-1">{objectAddress}</p>
            </div>

            <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <FiAlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-400 font-medium mb-1">Are you sure?</p>
                  <p className="text-xs text-gray-400">This will permanently burn this tether. The chat room will no longer be accessible.</p>
                </div>
              </div>
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="rounded border-gray-700 bg-gray-800" data-testid="burn-tether-confirm-checkbox" />
                <span className="text-xs text-gray-300">I understand this is permanent</span>
              </label>
            </div>

            {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="burn-tether-error">{error}</p>}

            <FeePicker network={network} />

            <div className="flex items-center gap-3">
              <span className="text-xs text-emerald-600 flex items-center gap-1"><FiShield size={11} /> Signed locally</span>
              <button onClick={handleBurn} disabled={!confirmed || sending || !isConnected}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
                data-testid="burn-tether-btn">
                <FiTrash2 size={16} />
                {sending ? 'Burning...' : 'Burn Tether'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
