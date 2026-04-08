/**
 * WalletStatusBar — Shows Core Wallet connection status.
 *
 * Desktop only. Displays: BTC ✓ | LTC ✗ | DOG ✓ | MZC ✗
 * with balance and sync info for connected wallets.
 */

import { useNode, DESKTOP_NETWORKS } from '@/contexts/NodeContext';

const CHAIN_ORDER = ['BTC', 'LTC', 'DOG', 'MZC'];

const CHAIN_COLORS = {
  BTC: '#f7931a',
  LTC: '#bfbbbb',
  DOG: '#c2a633',
  MZC: '#00aced',
};

export function WalletStatusBar() {
  const { wallets, connectedChains, scanning, activeChain, switchNetwork } = useNode();

  return (
    <div
      className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto scrollbar-hide"
      style={{ borderColor: 'rgba(255,255,255,0.04)', backgroundColor: 'rgba(3,7,18,0.6)' }}
      data-testid="wallet-status-bar"
    >
      {scanning && (
        <div className="flex items-center gap-1.5 mr-2 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Scanning...
        </div>
      )}

      {CHAIN_ORDER.map(chain => {
        const connected = connectedChains.includes(chain);
        const info = wallets[chain] || {};
        const isActive = chain === activeChain;
        const color = CHAIN_COLORS[chain];

        // Find a network id for this chain
        const net = DESKTOP_NETWORKS.find(n => n.chain === chain);

        return (
          <button
            key={chain}
            onClick={() => net && switchNetwork(net.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
              isActive
                ? 'ring-1 ring-white/20 bg-white/[0.06]'
                : 'hover:bg-white/[0.03]'
            }`}
            style={{
              color: connected ? color : 'rgba(107,114,128,0.6)',
              opacity: connected ? 1 : 0.5,
            }}
            data-testid={`wallet-status-${chain.toLowerCase()}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                connected ? 'animate-none' : ''
              }`}
              style={{
                backgroundColor: connected ? '#34d399' : '#4b5563',
                boxShadow: connected ? '0 0 4px rgba(52,211,153,0.5)' : 'none',
              }}
            />
            <span>{chain}</span>
            {connected && info.balance !== undefined && info.balance !== null && (
              <span className="text-[10px] opacity-60 ml-0.5">
                {typeof info.balance === 'number' ? info.balance.toFixed(4) : info.balance}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default WalletStatusBar;
