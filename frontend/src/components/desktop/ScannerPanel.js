/**
 * ScannerPanel — Shows P2FK chain scanner status and controls.
 *
 * Desktop only. Displays per-chain scan progress with start/stop controls.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNode } from '@/contexts/NodeContext';
import { FiPlay, FiSquare, FiRefreshCw, FiDatabase } from 'react-icons/fi';

export function ScannerPanel() {
  const { connectedChains, scanProgress, getScannerProgress, startScanner, stopScanner, activeConfig } = useNode();
  const [loading, setLoading] = useState({});

  // Poll scanner progress
  useEffect(() => {
    getScannerProgress();
    const interval = setInterval(getScannerProgress, 5000);
    return () => clearInterval(interval);
  }, [getScannerProgress]);

  const handleStart = useCallback(async (chain) => {
    setLoading(prev => ({ ...prev, [chain]: true }));
    await startScanner(chain, activeConfig.network);
    await getScannerProgress();
    setLoading(prev => ({ ...prev, [chain]: false }));
  }, [startScanner, activeConfig.network, getScannerProgress]);

  const handleStop = useCallback(async (chain) => {
    setLoading(prev => ({ ...prev, [chain]: true }));
    await stopScanner(chain);
    await getScannerProgress();
    setLoading(prev => ({ ...prev, [chain]: false }));
  }, [stopScanner, getScannerProgress]);

  const chains = ['BTC', 'LTC', 'DOG', 'MZC'];

  return (
    <div className="p-3 space-y-2" data-testid="scanner-panel">
      <div className="flex items-center gap-2 mb-2">
        <FiDatabase size={14} className="text-gray-400" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">P2FK Scanner</span>
      </div>

      {chains.map(chain => {
        const progress = scanProgress[chain] || {};
        const isConnected = connectedChains.includes(chain);
        const isScanning = progress.status === 'scanning' || progress.scanning;
        const progressPct = progress.progress_pct || 0;
        const lastHeight = progress.last_height || 0;
        const tipHeight = progress.tip_height || 0;
        const rootsFound = progress.roots_found || 0;

        return (
          <div
            key={chain}
            className="rounded-lg p-2.5 border transition-colors"
            style={{
              backgroundColor: isConnected ? 'rgba(255,255,255,0.02)' : 'transparent',
              borderColor: isScanning ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.04)',
            }}
            data-testid={`scanner-${chain.toLowerCase()}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${isConnected ? 'text-gray-200' : 'text-gray-600'}`}>
                  {chain}
                </span>
                {isScanning && (
                  <FiRefreshCw size={10} className="text-emerald-400 animate-spin" />
                )}
                <span className="text-[10px] text-gray-500">
                  {progress.status || (isConnected ? 'idle' : 'offline')}
                </span>
              </div>

              {isConnected && (
                <button
                  onClick={() => isScanning ? handleStop(chain) : handleStart(chain)}
                  disabled={loading[chain]}
                  className={`p-1 rounded transition-colors ${
                    isScanning
                      ? 'text-red-400 hover:bg-red-500/10'
                      : 'text-emerald-400 hover:bg-emerald-500/10'
                  } disabled:opacity-30`}
                  data-testid={`scanner-toggle-${chain.toLowerCase()}`}
                >
                  {isScanning ? <FiSquare size={12} /> : <FiPlay size={12} />}
                </button>
              )}
            </div>

            {isConnected && (lastHeight > 0 || isScanning) && (
              <>
                {/* Progress bar */}
                <div className="h-1 rounded-full bg-gray-800 overflow-hidden mb-1">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(progressPct, 100)}%`,
                      backgroundColor: progressPct >= 100 ? '#34d399' : '#f59e0b',
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>{rootsFound} roots</span>
                  <span>{lastHeight.toLocaleString()} / {tipHeight.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ScannerPanel;
