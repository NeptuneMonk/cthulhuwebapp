import React, { useState, useMemo, useCallback } from 'react';
import { FiCopy, FiCheck, FiPlus, FiTrash2, FiAward, FiEdit2, FiX } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { copyToClipboard } from '@/utils/clipboard';
import {
  getRoyaltyAddresses,
  generateAndStoreRoyalty,
  removeRoyaltyAddress,
  updateRoyaltyLabel,
} from '@/utils/royaltyAddresses';
import { getCachedRoyaltiesAddress, getRoyaltiesAddress } from '@/utils/txBuilder';

export const WalletRoyalties = ({ network }) => {
  const { wallet } = useWallet();
  const { user, wif } = useAuth();
  const [copied, setCopied] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editIdx, setEditIdx] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [listVersion, setListVersion] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const urn = user?.urn || '';
  const activeWif = wif || wallet?.wif;
  const mainAddress = user?.address || wallet?.address;

  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  // Default royalty address from txBuilder (the legacy "single" address)
  const defaultRoyaltyAddr = useMemo(() => {
    if (!mainAddress) return null;
    return getCachedRoyaltiesAddress(mainAddress);
  }, [mainAddress]);

  // Named royalty addresses from localStorage
  const royaltyList = useMemo(() => {
    return getRoyaltyAddresses(urn, network);
    // eslint-disable-next-line
  }, [urn, network, listVersion]);

  const handleGenerate = useCallback(() => {
    if (!activeWif || !urn) return;
    const label = newLabel.trim() || `Royalty ${royaltyList.length + 1}`;
    generateAndStoreRoyalty(activeWif, urn, network, label);
    setNewLabel('');
    setListVersion(v => v + 1);
  }, [activeWif, urn, network, newLabel, royaltyList.length]);

  const handleRemove = useCallback((address) => {
    removeRoyaltyAddress(urn, network, address);
    setConfirmDelete(null);
    setListVersion(v => v + 1);
  }, [urn, network]);

  const handleRename = useCallback((address) => {
    if (!editLabel.trim()) return;
    updateRoyaltyLabel(urn, network, address, editLabel.trim());
    setEditIdx(null);
    setEditLabel('');
    setListVersion(v => v + 1);
  }, [urn, network, editLabel]);

  // Generate default if not cached yet
  const ensureDefault = () => {
    if (!activeWif) return;
    getRoyaltiesAddress(activeWif, network);
    setListVersion(v => v + 1);
  };

  return (
    <div className="space-y-4" data-testid="wallet-royalties-tab">
      <p className="text-xs text-gray-500">
        Manage dedicated addresses for receiving royalty payments from object sales.
        Each address is deterministically derived from your wallet key.
      </p>

      {/* Default (Legacy) Royalty Address */}
      <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700/50" data-testid="default-royalty-section">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center">
            <FiAward size={12} className="text-purple-400" />
          </div>
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Default Royalty Address</span>
        </div>
        {defaultRoyaltyAddr ? (
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-200 font-mono flex-1 break-all">{defaultRoyaltyAddr}</code>
            <button
              onClick={() => copy(defaultRoyaltyAddr, 'default')}
              className="text-gray-500 hover:text-white flex-shrink-0 p-1.5"
              data-testid="copy-default-royalty"
            >
              {copied === 'default' ? <FiCheck size={13} className="text-emerald-400" /> : <FiCopy size={13} />}
            </button>
          </div>
        ) : activeWif ? (
          <button
            onClick={ensureDefault}
            className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            data-testid="generate-default-royalty"
          >
            + Generate default royalty address
          </button>
        ) : (
          <p className="text-xs text-gray-600">Unlock your wallet to generate</p>
        )}
        <p className="text-[10px] text-gray-600 mt-1.5">
          Legacy address used when no named address is selected during object creation.
        </p>
      </div>

      {/* Named Royalty Addresses */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium">Named Royalty Addresses</span>
          <span className="text-[10px] text-gray-600">{royaltyList.length} address{royaltyList.length !== 1 ? 'es' : ''}</span>
        </div>

        {royaltyList.length === 0 ? (
          <div className="py-6 text-center">
            <FiAward size={24} className="mx-auto text-gray-700 mb-2" />
            <p className="text-xs text-gray-600">No named royalty addresses yet.</p>
            <p className="text-[10px] text-gray-700 mt-1">
              Create named addresses to organize royalty income by project or object.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {royaltyList.map((item, idx) => (
              <div
                key={item.address}
                className="p-3 bg-gray-800/40 rounded-lg group"
                data-testid={`royalty-item-${idx}`}
              >
                <div className="flex items-center justify-between mb-1">
                  {editIdx === idx ? (
                    <div className="flex items-center gap-1.5 flex-1 mr-2">
                      <input
                        type="text"
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleRename(item.address)}
                        className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-100 focus:border-purple-500 focus:outline-none"
                        autoFocus
                        data-testid={`royalty-edit-input-${idx}`}
                      />
                      <button
                        onClick={() => handleRename(item.address)}
                        className="text-emerald-400 hover:text-emerald-300 p-1"
                        data-testid={`royalty-save-label-${idx}`}
                      >
                        <FiCheck size={12} />
                      </button>
                      <button
                        onClick={() => { setEditIdx(null); setEditLabel(''); }}
                        className="text-gray-500 hover:text-gray-300 p-1"
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-purple-400 font-medium">{item.label}</span>
                      <button
                        onClick={() => { setEditIdx(idx); setEditLabel(item.label || ''); }}
                        className="text-gray-600 hover:text-gray-400 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`royalty-edit-${idx}`}
                      >
                        <FiEdit2 size={10} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copy(item.address, `roy-${idx}`)}
                      className="text-gray-500 hover:text-white p-1"
                      data-testid={`copy-royalty-${idx}`}
                    >
                      {copied === `roy-${idx}` ? <FiCheck size={12} className="text-emerald-400" /> : <FiCopy size={12} />}
                    </button>
                    {confirmDelete === idx ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRemove(item.address)}
                          className="text-red-400 hover:text-red-300 text-[10px] px-1.5 py-0.5 bg-red-500/10 rounded"
                          data-testid={`royalty-confirm-delete-${idx}`}
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-gray-500 hover:text-gray-300 text-[10px] px-1.5 py-0.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(idx)}
                        className="text-gray-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-all"
                        data-testid={`royalty-delete-${idx}`}
                      >
                        <FiTrash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <code className="text-[11px] text-gray-300 font-mono break-all select-all block">{item.address}</code>
                {item.createdAt && (
                  <p className="text-[9px] text-gray-600 mt-1">{new Date(item.createdAt).toLocaleDateString()}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate New */}
      {activeWif ? (
        <div className="flex gap-2" data-testid="generate-royalty-form">
          <input
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            placeholder="Label (e.g. Art Collection)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-xs placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            data-testid="royalty-label-input"
          />
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 rounded-lg text-xs text-purple-400 font-medium transition-colors"
            data-testid="generate-royalty-btn"
          >
            <FiPlus size={12} /> Generate
          </button>
        </div>
      ) : (
        <div className="p-3 bg-amber-900/10 border border-amber-500/20 rounded-lg">
          <p className="text-xs text-amber-400">Unlock your wallet to generate new royalty addresses.</p>
        </div>
      )}

      {/* Info */}
      <div className="p-3 bg-gray-800/30 rounded-lg">
        <p className="text-[10px] text-gray-600 leading-relaxed">
          <strong className="text-gray-500">SUP Compatible:</strong> Royalty addresses are standard P2PKH addresses derived from your key.
          They're embedded in object transactions so buyers automatically pay royalties on purchases.
          <br />
          <strong className="text-gray-500">Deterministic:</strong> Each address is re-derivable from your wallet key + its tag, so funds are always recoverable.
        </p>
      </div>
    </div>
  );
};
