/**
 * DesktopSidebar — Left sidebar for the Tauri desktop build.
 *
 * Shows:
 *   - Network selector (BTC mainnet/testnet, LTC, DOG, MZC)
 *   - Connected wallet balances
 *   - Scanner status & controls
 *   - Navigation links
 *
 * Replaces the web app's ChatsPage-in-sidebar pattern.
 * NEVER imported by the web app.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiRss, FiGrid, FiSearch, FiHardDrive, FiSettings, FiFilm, FiMusic, FiDatabase, FiChevronDown, FiWifi } from 'react-icons/fi';
import { useNode, DESKTOP_NETWORKS } from '@/contexts/NodeContext';
import { ScannerPanel } from './ScannerPanel';
import { MeshPanel } from './MeshPanel';
import { CthulhuLogo } from '@/components/CthulhuLogo';

const NAV_ITEMS = [
  { path: '/feed', label: 'Feed', icon: FiRss },
  { path: '/objects', label: 'Objects', icon: FiGrid },
  { path: '/discover', label: 'Discover', icon: FiSearch },
  { path: '/supflix', label: 'SUPflix', icon: FiFilm },
  { path: '/jukebox', label: 'Jukebox', icon: FiMusic },
  { path: '/profiles', label: 'Profiles', icon: FiDatabase },
];

export function DesktopSidebar({ network }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeConfig, switchNetwork, connectedChains, wallets, scanning, scanWallets } = useNode();
  const [showNetworkPicker, setShowNetworkPicker] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showMesh, setShowMesh] = useState(false);

  return (
    <div className="h-full flex flex-col" data-testid="desktop-sidebar">
      {/* Logo + Network Selector */}
      <div className="px-3 pt-3 pb-2 border-b border-white/[0.04]">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-3 px-1">
          <CthulhuLogo className="w-6 h-6 opacity-80" />
          <span className="text-sm font-bold text-gray-200 tracking-wide">Cthulhu</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium ml-auto">
            DESKTOP
          </span>
        </div>

        {/* Network Picker */}
        <div className="relative">
          <button
            onClick={() => setShowNetworkPicker(!showNetworkPicker)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
            data-testid="network-picker-btn"
          >
            <img
              src={activeConfig.logo}
              alt={activeConfig.label}
              className="w-5 h-5"
              style={{ filter: activeConfig.filter || 'none' }}
            />
            <span className="text-xs font-medium text-gray-200 flex-1 text-left">{activeConfig.label}</span>
            <FiChevronDown size={12} className={`text-gray-500 transition-transform ${showNetworkPicker ? 'rotate-180' : ''}`} />
          </button>

          {showNetworkPicker && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border shadow-2xl shadow-black/60 py-1 overflow-hidden"
              style={{ backgroundColor: 'rgba(8,12,20,0.98)', borderColor: 'rgba(255,255,255,0.06)' }}
              data-testid="network-picker-dropdown"
            >
              {DESKTOP_NETWORKS.map(net => {
                const connected = connectedChains.includes(net.chain);
                const isActive = net.id === activeConfig.id;
                return (
                  <button
                    key={net.id}
                    onClick={() => { switchNetwork(net.id); setShowNetworkPicker(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                    }`}
                    data-testid={`network-option-${net.id}`}
                  >
                    <img
                      src={net.logo}
                      alt={net.label}
                      className="w-4 h-4"
                      style={{ filter: net.filter || 'none' }}
                    />
                    <span className="text-xs text-gray-200 flex-1">{net.label}</span>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor: connected ? '#34d399' : '#4b5563',
                        boxShadow: connected ? '0 0 4px rgba(52,211,153,0.5)' : 'none',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Connected Wallets Summary */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Wallets</span>
          <button
            onClick={() => scanWallets(activeConfig.network)}
            disabled={scanning}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-30"
            data-testid="rescan-wallets-btn"
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
        {connectedChains.length === 0 ? (
          <p className="text-[11px] text-gray-600 py-1">No wallets detected</p>
        ) : (
          <div className="space-y-0.5">
            {connectedChains.map(chain => {
              const info = wallets[chain] || {};
              return (
                <div key={chain} className="flex items-center justify-between py-1 px-1 rounded hover:bg-white/[0.02]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 4px rgba(52,211,153,0.5)' }} />
                    <span className="text-[11px] font-medium text-gray-300">{chain}</span>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">
                    {info.balance !== undefined && info.balance !== null
                      ? (typeof info.balance === 'number' ? info.balance.toFixed(4) : info.balance)
                      : '—'
                    }
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5" data-testid="desktop-nav">
        {NAV_ITEMS.map(item => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                isActive
                  ? 'bg-white/[0.06] text-gray-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
              }`}
              data-testid={`nav-${item.path.slice(1)}`}
            >
              <Icon size={15} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Scanner Panel (collapsible) */}
      <div className="border-t border-white/[0.04]">
        <button
          onClick={() => setShowScanner(!showScanner)}
          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-white/[0.03] transition-colors"
          data-testid="scanner-toggle"
        >
          <FiHardDrive size={13} className="text-gray-500" />
          <span className="text-[11px] font-medium text-gray-400 flex-1">Chain Scanner</span>
          <FiChevronDown size={11} className={`text-gray-500 transition-transform ${showScanner ? 'rotate-180' : ''}`} />
        </button>
        {showScanner && <ScannerPanel />}
      </div>

      {/* Mesh Network (collapsible) */}
      <div className="border-t border-white/[0.04]">
        <button
          onClick={() => setShowMesh(!showMesh)}
          className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-white/[0.03] transition-colors"
          data-testid="mesh-toggle"
        >
          <FiWifi size={13} className="text-gray-500" />
          <span className="text-[11px] font-medium text-gray-400 flex-1">Mesh Network</span>
          <FiChevronDown size={11} className={`text-gray-500 transition-transform ${showMesh ? 'rotate-180' : ''}`} />
        </button>
        {showMesh && <MeshPanel />}
      </div>

      {/* Settings */}
      <div className="border-t border-white/[0.04] px-2 py-2">
        <button
          onClick={() => navigate('/settings')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
            location.pathname === '/settings'
              ? 'bg-white/[0.06] text-gray-100'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
          }`}
          data-testid="nav-settings"
        >
          <FiSettings size={15} />
          <span className="text-xs font-medium">Settings</span>
        </button>
      </div>
    </div>
  );
}

export default DesktopSidebar;
