import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiServer } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL;
const CHECK_INTERVAL = 30_000;
const POLL_AFTER_RESTART = 3_000; // Poll every 3s after restart
const MAX_RESTART_POLLS = 10; // Give up after 30s of polling

export function IpfsIndicator() {
  const [online, setOnline] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [peerInfo, setPeerInfo] = useState('');
  const timer = useRef(null);
  const pollCount = useRef(0);

  const checkStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/ipfs/status`);
      const data = await resp.json();
      const isOnline = data.online === true;
      setOnline(isOnline);
      if (isOnline && data.agent) setPeerInfo(data.agent);
      return isOnline;
    } catch {
      setOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    checkStatus();
    timer.current = setInterval(checkStatus, CHECK_INTERVAL);
    return () => clearInterval(timer.current);
  }, [checkStatus]);

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    pollCount.current = 0;

    try {
      // Fire the restart request (may take 10-20s for binary download + init)
      const resp = await fetch(`${API}/api/ipfs/restart`, { method: 'POST' });
      const data = await resp.json();

      if (data.online) {
        setOnline(true);
        if (data.agent) setPeerInfo(data.agent);
        setRestarting(false);
        return;
      }

      // Daemon not ready yet — poll until it comes online
      const pollInterval = setInterval(async () => {
        pollCount.current++;
        const isOnline = await checkStatus();
        if (isOnline || pollCount.current >= MAX_RESTART_POLLS) {
          clearInterval(pollInterval);
          setRestarting(false);
          if (!isOnline) setOnline(false);
        }
      }, POLL_AFTER_RESTART);
    } catch {
      setOnline(false);
      setRestarting(false);
    }
  };

  const dotColor = online === null
    ? 'bg-gray-500'
    : online
      ? 'bg-emerald-400'
      : 'bg-red-400';

  const label = restarting
    ? 'IPFS: Installing & starting daemon...'
    : online === null
      ? 'IPFS: Checking...'
      : online
        ? `IPFS: Online${peerInfo ? ` (${peerInfo})` : ''}`
        : 'IPFS: Offline — Click to restart';

  return (
    <button
      onClick={!online && !restarting ? handleRestart : undefined}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
        online
          ? 'bg-emerald-500/10 text-emerald-400 cursor-default'
          : restarting
            ? 'bg-amber-500/10 text-amber-400 cursor-wait'
            : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer'
      }`}
      title={label}
      data-testid="ipfs-indicator"
    >
      {restarting ? (
        <FiServer size={14} className="animate-spin" />
      ) : (
        <div className="relative flex items-center">
          <div className={`w-2 h-2 rounded-full ${dotColor} ${online ? 'animate-none' : online === false ? 'animate-pulse' : ''}`} />
        </div>
      )}
      <span className="hidden sm:inline">{restarting ? 'Starting...' : 'IPFS'}</span>
    </button>
  );
}
