/**
 * DesktopApp — Main shell for the Tauri desktop build.
 *
 * This is a completely separate app entry from the web App.js.
 * It uses NodeContext (Core Wallet RPC) instead of AuthContext (WIF/login).
 *
 * Key differences from the web app:
 *   - No login/signup — relies on Core Wallet connection status
 *   - Signing happens inside the wallet daemon, not in the browser
 *   - Network list includes BTC mainnet/testnet + LTC/DOG/MZC mainnet
 *   - Sidebar shows wallet connections, scanner status, navigation
 *   - No WIF, no localStorage keys, no password prompts
 *
 * NEVER imported by the web app. Loaded via index.js when
 * REACT_APP_DESKTOP_MODE=true.
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { NodeProvider, useNode, DESKTOP_NETWORKS } from '@/contexts/NodeContext';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { MiniPlayerProvider } from '@/contexts/MiniPlayerContext';
import { UploadQueueProvider } from '@/contexts/UploadQueueContext';

// Desktop-specific components
import { DesktopSidebar } from '@/components/desktop/DesktopSidebar';
import { DesktopNodeHeader } from '@/components/desktop/DesktopNodeHeader';
import { DesktopWalletPanel } from '@/components/desktop/DesktopWalletPanel';

// Shared pages — these work without AuthContext (read-only browsing)
import FeedPage from '@/pages/FeedPage';
import SearchPage from '@/pages/SearchPage';
import DiscoverPage from '@/pages/DiscoverPage';
import SUPflixPage from '@/pages/SUPflixPage';
import JukeboxPage from '@/pages/JukeboxPage';
import ProfileDetailPage from '@/pages/ProfileDetailPage';
import ObjectsPage from '@/pages/ObjectsPage';
import UserObjectsPage from '@/pages/UserObjectsPage';
import SingleObjectPage from '@/pages/SingleObjectPage';
import CollectionPage from '@/pages/CollectionPage';
import WikiPage from '@/pages/WikiPage';

import MiniPlayer from '@/components/MiniPlayer';
import UploadQueueBar from '@/components/UploadQueueBar';
import { CthulhuLogo } from '@/components/CthulhuLogo';
import { Toaster } from '@/components/ui/sonner';
import '@/App.css';


function DesktopApp() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <NodeProvider>
          <UploadQueueProvider>
            <MiniPlayerProvider>
              <DesktopRoutes />
            </MiniPlayerProvider>
          </UploadQueueProvider>
        </NodeProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

function DesktopRoutes() {
  const { activeNetwork, activeConfig } = useNode();
  // Map desktop network id to the format existing pages expect
  const network = activeNetwork;

  return (
    <>
      <Toaster theme="dark" position="top-right" richColors closeButton />
      <DesktopLayout network={network} />
    </>
  );
}


function DesktopLayout({ network }) {
  const { theme } = useTheme();
  const { isConnected, connectedChains, activeChain, isChainConnected, getScannerProgress } = useNode();
  const location = useLocation();

  const isWalletPage = location.pathname === '/wallet';

  // Poll scanner progress at layout level
  useEffect(() => {
    getScannerProgress();
    const interval = setInterval(getScannerProgress, 10000);
    return () => clearInterval(interval);
  }, [getScannerProgress]);

  return (
    <div className="min-h-screen text-gray-100" style={{ backgroundColor: theme.colors.bg, color: theme.colors.text }}>
      <div className="flex flex-col" style={{ height: '100dvh' }}>
        <div className="flex flex-1 min-h-0">

          {/* Sidebar */}
          <aside
            className="flex flex-col w-64 border-r overflow-hidden flex-shrink-0"
            style={{ backgroundColor: theme.colors.card, borderColor: theme.colors.border }}
            data-testid="desktop-sidebar-container"
          >
            <DesktopSidebar network={network} />
          </aside>

          {/* Main column */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Desktop Header with wallet status */}
            <DesktopNodeHeader />

            {/* Main Content */}
            <main className="flex-1 overflow-hidden min-h-0" style={{ backgroundColor: theme.colors.bg }}>
              {isWalletPage ? (
                <DesktopWalletPanel />
              ) : (
                <Routes>
                  <Route path="/" element={<Navigate to="/feed" replace />} />
                  <Route path="/feed" element={<FeedPage network={network} follows={[]} />} />
                  <Route path="/objects" element={<ObjectsPage network={network} />} />
                  <Route path="/object/addr/:address" element={<SingleObjectPage network={network} lookupByAddress />} />
                  <Route path="/object/:txid" element={<SingleObjectPage network={network} />} />
                  <Route path="/collection/:urn" element={<CollectionPage network={network} />} />
                  <Route path="/collection-by-address/:address" element={<CollectionPage network={network} byAddress />} />
                  <Route path="/profiles" element={<DesktopProfilesPage network={network} />} />
                  <Route path="/profile/:address/objects" element={<UserObjectsPage network={network} myAddress="" />} />
                  <Route path="/profile/:address" element={
                    <ProfileDetailPage network={network} isFollowing={() => false} toggleFollow={() => {}} myAddress="" />
                  } />
                  <Route path="/search" element={<SearchPage network={network} follows={[]} toggleFollow={() => {}} myAddress="" />} />
                  <Route path="/discover" element={<DiscoverPage network={network} />} />
                  <Route path="/supflix" element={<SUPflixPage network={network} />} />
                  <Route path="/jukebox" element={<JukeboxPage />} />
                  <Route path="/wiki" element={<WikiPage />} />
                  <Route path="/wallet" element={null} />
                  {/* Catch-all */}
                  <Route path="*" element={<Navigate to="/feed" replace />} />
                </Routes>
              )}
            </main>
          </div>

          {/* Right panel: wallet details (visible on wider screens when a wallet is connected) */}
          {isChainConnected && !isWalletPage && (
            <aside
              className="hidden xl:flex xl:flex-col xl:w-80 border-l overflow-hidden flex-shrink-0"
              style={{ backgroundColor: theme.colors.card, borderColor: theme.colors.border }}
              data-testid="desktop-wallet-sidebar"
            >
              <DesktopWalletPanel />
            </aside>
          )}

        </div>

        {/* Bottom bars */}
        <MiniPlayer />
        <UploadQueueBar />
      </div>

      {/* Connection status overlay when no wallets detected */}
      {!isConnected && <NoWalletsOverlay />}
    </div>
  );
}


/**
 * Overlay shown when no Core Wallets are detected.
 * Guides the user to start their wallet daemons.
 */
function NoWalletsOverlay() {
  const { scanning, scanWallets } = useNode();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      data-testid="no-wallets-overlay"
    >
      <div className="max-w-md mx-4 p-6 rounded-2xl border border-white/[0.06] text-center"
           style={{ backgroundColor: 'rgba(8,12,20,0.95)' }}>
        <CthulhuLogo className="w-16 h-16 mx-auto mb-4 opacity-40" />
        <h2 className="text-lg font-bold text-gray-100 mb-2">No Wallets Detected</h2>
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          Start one or more Core wallet daemons to begin using Cthulhu Desktop.
          Supported wallets:
        </p>

        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { name: 'Bitcoin Core', cmd: 'bitcoind / bitcoin-qt', color: '#f7931a' },
            { name: 'Litecoin Core', cmd: 'litecoind / litecoin-qt', color: '#bfbbbb' },
            { name: 'Dogecoin Core', cmd: 'dogecoind / dogecoin-qt', color: '#c2a633' },
            { name: 'Mazacoin Core', cmd: 'mazacoind / mazacoin-qt', color: '#00aced' },
          ].map(w => (
            <div key={w.name} className="px-3 py-2 rounded-lg border border-white/[0.04] bg-white/[0.02] text-left">
              <p className="text-xs font-medium" style={{ color: w.color }}>{w.name}</p>
              <p className="text-[10px] text-gray-500 font-mono mt-0.5">{w.cmd}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Ensure <code className="px-1 py-0.5 rounded bg-white/[0.04] text-gray-300">server=1</code> is set in your wallet's config file.
        </p>

        <button
          onClick={() => scanWallets()}
          disabled={scanning}
          className="px-5 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm font-medium hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
          data-testid="scan-wallets-btn"
        >
          {scanning ? 'Scanning...' : 'Scan for Wallets'}
        </button>
      </div>
    </div>
  );
}


/**
 * Desktop Profiles page — simplified version without auth dependencies.
 */
function DesktopProfilesPage({ network }) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState([]);

  useEffect(() => {
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    fetch(`${API}/known-users/${network}?limit=20`)
      .then(r => r.json())
      .then(data => setSuggestedUsers(data?.users || data || []))
      .catch(() => {});
  }, [network]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    if (searchQuery.length > 20) {
      navigate(`/profile/${searchQuery}`);
      return;
    }
    setSearchLoading(true);
    const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
    fetch(`${API}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, network }),
    })
      .then(r => r.ok ? r.json() : {})
      .then(data => setSearchResults(data.profiles || []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="desktop-profiles-page">
      <div className="p-4 space-y-4">
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            placeholder="Search by username or address..."
            className="w-full pl-4 pr-4 py-2.5 bg-gray-800/60 text-gray-100 rounded-lg border border-gray-700/50 focus:border-emerald-500/60 focus:outline-none text-sm"
            data-testid="desktop-profiles-search"
          />
        </form>

        {searchLoading && (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500" />
          </div>
        )}

        {(searchResults || suggestedUsers).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider px-1">
              {searchResults ? `${searchResults.length} Results` : 'Known Users'}
            </p>
            {(searchResults || suggestedUsers).map((p, i) => (
              <button
                key={i}
                onClick={() => navigate(`/profile/${p.address}`)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-800/50 transition-colors text-left"
                data-testid={`profile-result-${i}`}
              >
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                  {(p.urn || p.display_name || '?')[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{p.display_name || p.urn || p.address?.slice(0, 12)}</p>
                  {p.urn && <p className="text-xs text-emerald-400/70 truncate">@{p.urn}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export default DesktopApp;
