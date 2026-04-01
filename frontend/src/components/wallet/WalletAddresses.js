import React, { useState, useMemo } from 'react';
import { FiCopy, FiCheck, FiKey, FiRepeat, FiAward, FiPlusCircle, FiBox, FiX, FiShield } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { getCachedChangeAddress, getRoyaltiesAddress, getCachedRoyaltiesAddress } from '@/utils/txBuilder';
import { copyToClipboard } from '@/utils/clipboard';
import { KeyRevealModal } from '@/components/KeyRevealModal';

const ObjectAddressesModal = ({ addresses, onClose }) => {
  const [copied, setCopied] = useState('');
  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70" onClick={onClose} data-testid="object-addresses-modal">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-96 max-w-[92vw] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <FiBox className="text-purple-400" size={16} />
            <h3 className="text-sm font-medium text-gray-200">Object Addresses</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><FiX size={16} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2 flex-1">
          {addresses.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">No object addresses generated yet. Create an object to see its address here.</p>
          ) : (
            addresses.map((item, i) => (
              <div key={i} className="p-3 bg-gray-800/60 rounded-lg" data-testid={`obj-addr-${i}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-purple-400 font-medium">{item.label || `Object ${i + 1}`}</span>
                  {item.status === 'pending' && (
                    <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">pending</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-gray-300 font-mono flex-1 break-all select-all">{item.address}</code>
                  <button
                    onClick={() => copy(item.address, `obj-${i}`)}
                    className="text-gray-500 hover:text-white flex-shrink-0 p-1"
                    data-testid={`copy-obj-addr-${i}`}
                  >
                    {copied === `obj-${i}` ? <FiCheck size={12} className="text-emerald-400" /> : <FiCopy size={12} />}
                  </button>
                </div>
                {item.created && (
                  <p className="text-[9px] text-gray-600 mt-1">{new Date(item.created).toLocaleDateString()}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const WalletAddresses = ({ network }) => {
  const { wallet } = useWallet();
  const { user: authUser, wif: authWif } = useAuth();
  const [copied, setCopied] = useState('');
  const [royaltiesGenerated, setRoyaltiesGenerated] = useState(false);
  const [qrAddress, setQrAddress] = useState(null);
  const [showObjAddresses, setShowObjAddresses] = useState(false);
  const [showKeyReveal, setShowKeyReveal] = useState(false);

  // Use auth address as primary (matches how objects are stored during creation)
  const primaryAddress = authUser?.address || wallet?.address;
  const activeWif = authWif || wallet?.wif;

  const copy = (text, label) => {
    copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const changeAddress = useMemo(() => {
    if (!primaryAddress) return null;
    return getCachedChangeAddress(primaryAddress);
  }, [primaryAddress]);

  const royaltiesAddress = useMemo(() => {
    if (!primaryAddress) return getCachedRoyaltiesAddress(primaryAddress);
    return getCachedRoyaltiesAddress(primaryAddress);
  }, [primaryAddress, royaltiesGenerated]); // eslint-disable-line

  const generateRoyaltiesAddress = () => {
    if (!activeWif) return;
    getRoyaltiesAddress(activeWif, network);
    setRoyaltiesGenerated(true);
  };

  const toggleQR = (address) => setQrAddress(prev => prev === address ? null : address);

  const AddressRow = ({ label, address, icon: Icon, iconColor, onGenerate }) => (
    <div className="p-3 bg-gray-800/50 rounded-lg" data-testid={`address-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${iconColor}`}>
          <Icon size={12} />
        </div>
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</span>
      </div>
      {address ? (
        <>
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-200 font-mono flex-1 break-all">{address}</code>
            <button onClick={() => toggleQR(address)} className="text-gray-500 hover:text-white flex-shrink-0 p-1.5" title="Show QR" data-testid={`qr-toggle-${label.toLowerCase().replace(/\s/g, '-')}`}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M0 0h7v7H0zm1 1v5h5V1zm1 1h3v3H2zm7-2h7v7H9zm1 1v5h5V1zm1 1h3v3h-3zM0 9h7v7H0zm1 1v5h5v-5zm1 1h3v3H2zm8-1h1v1h-1zm2 0h1v1h-1zm2 0h2v2h-1v1h-1v-1h-1v2h-1v-1h-1v1h-1v-2h2v-1h1zm-2 4h1v1h-1zm2 0h2v2h-2zm-4-2h1v3h-1zm4 0h1v1h-1z"/></svg>
            </button>
            <button onClick={() => copy(address, label)} className="text-gray-500 hover:text-white flex-shrink-0 p-1.5">
              {copied === label ? <FiCheck size={13} className="text-emerald-400" /> : <FiCopy size={13} />}
            </button>
          </div>
          {qrAddress === address && (
            <div className="mt-3 flex justify-center p-3 bg-white rounded-lg" data-testid={`qr-code-${label.toLowerCase().replace(/\s/g, '-')}`}>
              <QRCodeSVG value={address} size={160} bgColor="#ffffff" fgColor="#000000" level="M" />
            </div>
          )}
        </>
      ) : onGenerate ? (
        <button
          onClick={onGenerate}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
          data-testid="generate-royalties-address"
        >
          <FiPlusCircle size={12} /> Generate Royalties Address
        </button>
      ) : (
        <p className="text-xs text-gray-600">Not yet derived</p>
      )}
    </div>
  );

  const objectAddresses = useMemo(() => {
    if (!primaryAddress) return [];
    try {
      return JSON.parse(localStorage.getItem(`cthulhu_obj_addresses_${primaryAddress}`) || '[]');
    } catch { return []; }
  }, [primaryAddress, showObjAddresses]);

  return (
    <div className="space-y-3" data-testid="wallet-addresses-tab">
      <p className="text-xs text-gray-500">
        All addresses are derived from your single private key. Copy any address to receive funds.
      </p>

      <AddressRow
        label="Main Address"
        address={primaryAddress}
        icon={FiKey}
        iconColor="bg-blue-500/20 text-blue-400"
      />

      <AddressRow
        label="Change Address"
        address={changeAddress}
        icon={FiRepeat}
        iconColor="bg-amber-500/20 text-amber-400"
      />

      <AddressRow
        label="Royalties Address"
        address={royaltiesAddress}
        icon={FiAward}
        iconColor="bg-purple-500/20 text-purple-400"
      />

      {/* Object Addresses Link */}
      <button
        onClick={() => setShowObjAddresses(true)}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors group"
        data-testid="see-object-addresses-btn"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-purple-500/20 text-purple-400">
            <FiBox size={12} />
          </div>
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Object Addresses</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">{objectAddresses.length}</span>
          <span className="text-gray-600 group-hover:text-gray-400 text-xs transition-colors">&rarr;</span>
        </div>
      </button>

      <div className="p-3 bg-gray-800/30 rounded-lg">
        <p className="text-[10px] text-gray-600 leading-relaxed">
          <strong className="text-gray-500">Main:</strong> Primary address for receiving and signing.
          <br />
          <strong className="text-gray-500">Change:</strong> Automatically receives leftover funds from transactions.
          <br />
          <strong className="text-gray-500">Royalties:</strong> Dedicated address for receiving object royalty payments. Generated on first use.
        </p>
      </div>

      {/* Secure Key Access */}
      <button
        onClick={() => setShowKeyReveal(true)}
        className="w-full flex items-center justify-center gap-2 p-3 bg-amber-600/10 border border-amber-500/20 hover:bg-amber-600/20 rounded-lg text-sm text-amber-400 transition-colors"
        data-testid="reveal-key-button"
      >
        <FiShield size={14} /> Reveal Private Key (Password Required)
      </button>

      {/* Key Reveal Modal */}
      {showKeyReveal && (
        <KeyRevealModal onClose={() => setShowKeyReveal(false)} />
      )}

      {/* Object Addresses Modal */}
      {showObjAddresses && (
        <ObjectAddressesModal
          addresses={objectAddresses}
          onClose={() => setShowObjAddresses(false)}
        />
      )}
    </div>
  );
};
