import React, { useState, useMemo, useCallback } from 'react';
import { FiCopy, FiCheck, FiPlus, FiKey, FiRepeat, FiAward, FiBox, FiTag, FiTrash2, FiEdit2, FiX } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { copyToClipboard } from '@/utils/clipboard';
import { getCachedChangeAddress, getCachedRoyaltiesAddress, getRoyaltiesAddress } from '@/utils/txBuilder';
import {
  getRoyaltyAddresses,
  generateAndStoreRoyalty,
  removeRoyaltyAddress,
  updateRoyaltyLabel,
} from '@/utils/royaltyAddresses';

export const WalletReceive = ({ network }) => {
  const { wallet } = useWallet();
  const { user, wif } = useAuth();
  const [copied, setCopied] = useState('');
  const [qrAddr, setQrAddr] = useState(null);

  const mainAddress = user?.address || wallet?.address;

  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="space-y-4" data-testid="wallet-receive-tab">
      {/* Primary Receiving Address with QR */}
      <div className="p-4 rounded-xl border border-gray-700/50 bg-gray-900/80 text-center">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Your Receiving Address</p>
        <div className="inline-block p-3 bg-white rounded-xl mb-3">
          <QRCodeSVG value={mainAddress || ''} size={140} level="M" data-testid="receive-qr" />
        </div>
        <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2 mx-auto max-w-md">
          <code className="text-xs text-gray-300 font-mono flex-1 truncate text-left" data-testid="receive-main-address">{mainAddress}</code>
          <button onClick={() => copy(mainAddress, 'main')} className="text-gray-500 hover:text-white flex-shrink-0 transition-colors" data-testid="copy-receive-address">
            {copied === 'main' ? <FiCheck size={14} className="text-emerald-400" /> : <FiCopy size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-2">Share this address to receive payments</p>
      </div>

      {/* Tap any address below for QR */}
      {qrAddr && qrAddr !== mainAddress && (
        <div className="p-3 rounded-xl border border-gray-700/50 bg-gray-900/80 text-center">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">QR for selected address</p>
            <button onClick={() => setQrAddr(null)} className="text-gray-500 hover:text-gray-300"><FiX size={14} /></button>
          </div>
          <div className="inline-block p-2 bg-white rounded-lg mb-2">
            <QRCodeSVG value={qrAddr} size={100} level="M" />
          </div>
          <p className="text-[10px] text-gray-400 font-mono break-all">{qrAddr}</p>
        </div>
      )}

      {/* All Addresses */}
      <AddressListSection
        mainAddress={mainAddress}
        network={network}
        activeWif={wif || wallet?.wif}
        urn={user?.urn || ''}
        copied={copied}
        onCopy={copy}
        onShowQr={(addr) => setQrAddr(addr === qrAddr ? null : addr)}
        qrAddr={qrAddr}
      />
    </div>
  );
};

function AddressListSection({ mainAddress, network, activeWif, urn, copied, onCopy, onShowQr, qrAddr }) {
  const [showGenerate, setShowGenerate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [listVersion, setListVersion] = useState(0);
  const [editIdx, setEditIdx] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const changeAddr = useMemo(() => getCachedChangeAddress(mainAddress), [mainAddress]);
  const defaultRoyalty = useMemo(() => getCachedRoyaltiesAddress(mainAddress), [mainAddress]);

  const royaltyList = useMemo(() => {
    return getRoyaltyAddresses(urn, network);
  }, [urn, network, listVersion]); // eslint-disable-line

  const objectAddresses = useMemo(() => {
    if (!mainAddress) return [];
    try { return JSON.parse(localStorage.getItem(`cthulhu_obj_addresses_${mainAddress}`) || '[]'); }
    catch { return []; }
  }, [mainAddress]);

  const handleGenerate = useCallback(() => {
    if (!activeWif || !urn) return;
    const label = newLabel.trim() || `Royalty ${royaltyList.length + 1}`;
    generateAndStoreRoyalty(activeWif, urn, network, label);
    setNewLabel('');
    setShowGenerate(false);
    setListVersion(v => v + 1);
  }, [activeWif, urn, network, newLabel, royaltyList.length]);

  const handleRemove = (address) => {
    removeRoyaltyAddress(urn, network, address);
    setConfirmDelete(null);
    setListVersion(v => v + 1);
  };

  const handleRename = (address) => {
    if (editLabel.trim()) {
      updateRoyaltyLabel(urn, network, address, editLabel.trim());
      setListVersion(v => v + 1);
    }
    setEditIdx(null);
    setEditLabel('');
  };

  // Derive generates the default royalty on first use
  const ensureDefaultRoyalty = () => {
    if (!defaultRoyalty && activeWif) {
      getRoyaltiesAddress(activeWif, network);
      setListVersion(v => v + 1);
    }
  };

  const AddrRow = ({ address, label, type, icon: Icon, iconColor, actions }) => (
    <div className={`flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors ${qrAddr === address ? 'bg-gray-700/40' : 'hover:bg-gray-800/40'}`}>
      <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${iconColor}`}>
        <Icon size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-400">{label}</p>
        <p className="text-[10px] text-gray-500 font-mono truncate">{address || 'Not generated'}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {address && (
          <>
            <button onClick={() => onShowQr(address)} className={`p-1 rounded text-gray-600 hover:text-gray-300 transition-colors text-[10px]`} title="Show QR">QR</button>
            <button onClick={() => onCopy(address, address)} className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors">
              {copied === address ? <FiCheck size={11} className="text-emerald-400" /> : <FiCopy size={11} />}
            </button>
          </>
        )}
        {actions}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* System Addresses */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 px-1">System Addresses</p>
        <div className="rounded-lg border border-gray-800/50 divide-y divide-gray-800/30">
          <AddrRow address={mainAddress} label="Main Address" type="main" icon={FiKey} iconColor="bg-blue-500/15 text-blue-400" />
          <AddrRow address={changeAddr} label="Change Address" type="change" icon={FiRepeat} iconColor="bg-amber-500/15 text-amber-400" />
          <AddrRow address={defaultRoyalty} label="Default Royalty" type="royalty" icon={FiAward} iconColor="bg-purple-500/15 text-purple-400"
            actions={!defaultRoyalty && activeWif ? <button onClick={ensureDefaultRoyalty} className="text-[9px] text-blue-400 hover:text-blue-300 px-1">Generate</button> : null} />
        </div>
      </div>

      {/* Royalty Addresses */}
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Royalty Addresses</p>
          <button onClick={() => setShowGenerate(v => !v)} className="text-gray-600 hover:text-gray-300 transition-colors" data-testid="add-royalty-btn">
            <FiPlus size={14} />
          </button>
        </div>

        {showGenerate && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-gray-800/40 rounded-lg">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (optional)" className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-gray-600" data-testid="royalty-label-input" />
            <button onClick={handleGenerate} disabled={!activeWif} className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/40 text-purple-300 text-xs rounded font-medium disabled:opacity-30 transition-colors" data-testid="generate-royalty-btn">Generate</button>
          </div>
        )}

        {royaltyList.length === 0 ? (
          <p className="text-[10px] text-gray-600 text-center py-3">No named royalty addresses yet</p>
        ) : (
          <div className="rounded-lg border border-gray-800/50 divide-y divide-gray-800/30">
            {royaltyList.map((r, i) => (
              <div key={r.address} className="flex items-center gap-2 py-2 px-2.5">
                <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-purple-500/15 text-purple-400"><FiAward size={12} /></div>
                <div className="flex-1 min-w-0">
                  {editIdx === i ? (
                    <div className="flex items-center gap-1">
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-200 focus:outline-none" onKeyDown={e => e.key === 'Enter' && handleRename(r.address)} autoFocus />
                      <button onClick={() => handleRename(r.address)} className="text-emerald-400"><FiCheck size={10} /></button>
                      <button onClick={() => setEditIdx(null)} className="text-gray-500"><FiX size={10} /></button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400">{r.label || r.tag || 'Unnamed'}</p>
                  )}
                  <p className="text-[10px] text-gray-500 font-mono truncate">{r.address}</p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => onCopy(r.address, r.address)} className="p-1 text-gray-600 hover:text-gray-300">
                    {copied === r.address ? <FiCheck size={11} className="text-emerald-400" /> : <FiCopy size={11} />}
                  </button>
                  <button onClick={() => { setEditIdx(i); setEditLabel(r.label || r.tag || ''); }} className="p-1 text-gray-600 hover:text-gray-300"><FiEdit2 size={10} /></button>
                  {confirmDelete === r.address ? (
                    <button onClick={() => handleRemove(r.address)} className="px-1.5 py-0.5 bg-red-600/30 text-red-400 text-[9px] rounded">Confirm</button>
                  ) : (
                    <button onClick={() => setConfirmDelete(r.address)} className="p-1 text-gray-600 hover:text-red-400"><FiTrash2 size={10} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Object Addresses */}
      {objectAddresses.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 px-1">Object Addresses ({objectAddresses.length})</p>
          <div className="rounded-lg border border-gray-800/50 divide-y divide-gray-800/30 max-h-[200px] overflow-y-auto">
            {objectAddresses.map(obj => (
              <AddrRow key={obj.address} address={obj.address} label={obj.label || 'Object'} type="object" icon={FiBox} iconColor="bg-teal-500/15 text-teal-400" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
