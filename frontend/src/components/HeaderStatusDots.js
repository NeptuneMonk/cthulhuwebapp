import React from 'react';
import { useIpfsStatus } from '@/hooks/useIpfsStatus';

/**
 * Compact status dots for IPFS and Walkie-Talkie, designed for the mobile header.
 * Uses the singleton useIpfsStatus hook (no duplicate polling).
 */
export function HeaderStatusDots({ walkieActive, walkieChannel }) {
  const { online: ipfsOnline } = useIpfsStatus();

  return (
    <div className="flex items-center gap-1.5" data-testid="header-status-dots">
      {/* IPFS dot */}
      <div className="relative group" data-testid="header-ipfs-status">
        <div className={`w-2 h-2 rounded-full transition-colors ${
          ipfsOnline ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'
        }`} />
        <div className="pointer-events-none absolute -bottom-6 right-0 px-1.5 py-0.5 rounded bg-gray-900/95 border border-gray-700/40 text-[8px] text-gray-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30">
          IPFS {ipfsOnline ? 'Online' : 'Offline'}
        </div>
      </div>
      {/* Walkie-Talkie dot */}
      <div className="relative group" data-testid="header-walkie-status">
        <div className={`w-2 h-2 rounded-full transition-colors ${
          walkieActive ? 'bg-amber-400' : 'bg-gray-700'
        }`}
        style={walkieActive ? { boxShadow: '0 0 4px rgba(251,191,36,0.4)' } : {}}
        />
        <div className="pointer-events-none absolute -bottom-6 right-0 px-1.5 py-0.5 rounded bg-gray-900/95 border border-gray-700/40 text-[8px] text-gray-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30">
          Radio {walkieActive ? `CH ${walkieChannel}` : 'Off'}
        </div>
      </div>
    </div>
  );
}
