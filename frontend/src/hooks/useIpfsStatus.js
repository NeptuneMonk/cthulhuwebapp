import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Singleton IPFS status poller — shared across all hook consumers.
 * Only one interval runs regardless of how many components call useIpfsStatus().
 */
let _subscribers = new Set();
let _status = { online: false, peerId: null, agent: null };
let _intervalId = null;
let _refCount = 0;

function _notify() {
  _subscribers.forEach(fn => fn());
}

async function _poll() {
  try {
    const res = await fetch(`${API}/api/ipfs/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error();
    const data = await res.json();
    _status = { online: !!data.online, peerId: data.peer_id || null, agent: data.agent || null };
  } catch {
    _status = { online: false, peerId: null, agent: null };
  }
  _notify();
}

function _subscribe(cb) {
  _subscribers.add(cb);
  _refCount++;
  if (_refCount === 1) {
    _poll();
    _intervalId = setInterval(_poll, 15000);
  }
  return () => {
    _subscribers.delete(cb);
    _refCount--;
    if (_refCount === 0 && _intervalId) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  };
}

function _getSnapshot() {
  return _status;
}

/**
 * Hook that polls IPFS daemon status (singleton — one poll shared by all consumers).
 * Returns { online, peerId, agent }
 */
export function useIpfsStatus() {
  return useSyncExternalStore(_subscribe, _getSnapshot);
}
