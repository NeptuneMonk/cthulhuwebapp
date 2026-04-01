import React, { useState, useEffect, useCallback } from 'react';
import { FiX, FiExternalLink, FiGrid, FiSend, FiDownload, FiList, FiMapPin } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { WalletOverview } from './wallet/WalletOverview';
import { WalletSend } from './wallet/WalletSend';
import { WalletReceive } from './wallet/WalletReceive';
import { WalletTransactions } from './wallet/WalletTransactions';
import { WalletAddressBook } from './wallet/WalletAddressBook';

const TABS = [
  { id: 'overview', label: 'Overview', icon: FiGrid },
  { id: 'send', label: 'Send', icon: FiSend },
  { id: 'receive', label: 'Receive', icon: FiDownload },
  { id: 'transactions', label: 'Transactions', icon: FiList },
  { id: 'addresses', label: 'Addresses', icon: FiMapPin },
];

function WalletWrapper({ isOpen, onClose, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" data-testid="wallet-modal">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mt-4 mx-2 w-full max-w-lg max-h-[90vh] overflow-hidden rounded-2xl bg-gray-900 border border-gray-800 shadow-2xl flex flex-col">
        {children}
      </div>
    </div>
  );
}

export const WalletModal = ({ isOpen, onClose, network }) => {
  const { wallet, createWallet, importWallet, disconnectWallet, isConnected } = useWallet();
  const { user: authUser, wif: authWif, isConnected: authConnected, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [view, setView] = useState('landing');

  // Import form state
  const [importWif, setImportWif] = useState('');
  const [importError, setImportError] = useState('');

  const effectivelyConnected = (authConnected && authWif) || isConnected;

  useEffect(() => {
    if (effectivelyConnected) setView('dashboard');
    else setView('landing');
  }, [effectivelyConnected]);

  const handleDisconnect = useCallback(async () => {
    if (authConnected) logout();
    else disconnectWallet();
    setView('landing');
    setActiveTab('overview');
  }, [authConnected, logout, disconnectWallet]);

  const handleImport = () => {
    const trimmed = importWif.trim();
    if (!trimmed) { setImportError('Please enter a WIF key'); return; }
    try {
      importWallet(trimmed, network);
      setImportWif('');
      setImportError('');
      setView('dashboard');
    } catch (err) {
      setImportError(err.message || 'Invalid WIF');
    }
  };

  return (
    <WalletWrapper isOpen={isOpen} onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-100">Wallet</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-200 transition-colors" data-testid="wallet-close-btn"><FiX size={18} /></button>
      </div>

      {/* Tab Bar (only when connected) */}
      {view === 'dashboard' && (
        <div className="flex border-b border-gray-800/60 flex-shrink-0 overflow-x-auto" data-testid="wallet-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-blue-400 border-blue-400'
                  : 'text-gray-500 hover:text-gray-300 border-transparent'
              }`}
              data-testid={`wallet-tab-${tab.id}`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Landing — Not Connected */}
        {view === 'landing' && (
          <div className="space-y-4" data-testid="wallet-landing">
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-3">
                <FiGrid size={24} className="text-gray-500" />
              </div>
              <h3 className="text-gray-200 font-semibold mb-1">Connect Wallet</h3>
              <p className="text-xs text-gray-500">Sign in or import a wallet to manage your funds</p>
            </div>

            <button
              onClick={() => createWallet(network)}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors"
              data-testid="create-wallet-btn"
            >Create New Wallet</button>

            <div className="space-y-2">
              <p className="text-xs text-gray-500 text-center">or import existing</p>
              <input
                value={importWif}
                onChange={e => { setImportWif(e.target.value); setImportError(''); }}
                placeholder="Enter WIF private key..."
                type="password"
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm font-mono focus:border-blue-500 focus:outline-none"
                data-testid="import-wif-input"
              />
              {importError && <p className="text-xs text-red-400">{importError}</p>}
              <button
                onClick={handleImport}
                disabled={!importWif.trim()}
                className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm transition-colors disabled:opacity-40"
                data-testid="import-wallet-btn"
              >Import Wallet</button>
            </div>
          </div>
        )}

        {/* Dashboard — all tabs always mounted, toggled via display:none */}
        {(wallet || authUser?.address) && (
          <div style={{ display: view === 'dashboard' ? 'block' : 'none' }}>
            <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}><WalletOverview network={network} onSwitchTab={setActiveTab} /></div>
            <div style={{ display: activeTab === 'send' ? 'block' : 'none' }}><WalletSend network={network} /></div>
            <div style={{ display: activeTab === 'receive' ? 'block' : 'none' }}><WalletReceive network={network} /></div>
            <div style={{ display: activeTab === 'transactions' ? 'block' : 'none' }}><WalletTransactions network={network} /></div>
            <div style={{ display: activeTab === 'addresses' ? 'block' : 'none' }}><WalletAddressBook network={network} /></div>

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-gray-800 space-y-2">
              {!network?.includes('mainnet') && (
                <a href="https://buytestnet.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 p-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors"
                  data-testid="faucet-link"
                ><FiExternalLink size={12} /> Buy tBTC at buytestnet.com</a>
              )}
              <button onClick={handleDisconnect}
                className="w-full px-4 py-2.5 bg-red-900/20 border border-red-800/30 hover:bg-red-900/40 text-red-400 rounded-lg transition-colors text-xs"
                data-testid="disconnect-wallet"
              >Disconnect Wallet</button>
            </div>
          </div>
        )}
      </div>
    </WalletWrapper>
  );
};
