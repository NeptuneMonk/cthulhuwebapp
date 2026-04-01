/**
 * useInkNotifications — Track new object mints from mesh peers.
 *
 * When a connected mesh peer inks (mints) an object, they broadcast
 * the CID to all peers. This hook:
 *   1. Stores ink notifications (per-session, scoped by network)
 *   2. Auto-pins CIDs to local Kubo if active
 *   3. Provides clearInk() to dismiss on click (navigates to object)
 *
 * Storage: sessionStorage (cleared on tab close or network switch)
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;
const STORAGE_KEY = 'cthulhu_ink_notifs';

function _getStored(network) {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_KEY}_${network}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function _setStored(network, notifs) {
  sessionStorage.setItem(`${STORAGE_KEY}_${network}`, JSON.stringify(notifs));
}

// Global listeners for cross-component updates
let _listeners = new Set();
function _notify() { _listeners.forEach(fn => fn()); }

export function useInkNotifications(network, myAddress) {
  const [inks, setInks] = useState(() => _getStored(network));
  const networkRef = useRef(network);

  // Re-sync when network changes
  useEffect(() => {
    networkRef.current = network;
    setInks(_getStored(network));
  }, [network]);

  // Subscribe to global updates
  useEffect(() => {
    const handler = () => setInks(_getStored(networkRef.current));
    _listeners.add(handler);
    return () => _listeners.delete(handler);
  }, []);

  // Called when an ink_notify arrives from mesh
  const addInk = useCallback((msg) => {
    // Don't show your own inks
    if (msg.sender === myAddress) return;
    // Don't show wrong network
    if (msg.network && msg.network !== networkRef.current) return;

    const notif = {
      id: `${msg.sender}_${(msg.cids || [])[0] || msg.cid || ''}_${msg.ts}`,
      cids: msg.cids || (msg.cid ? [msg.cid] : []),
      objectUrn: msg.objectUrn,
      objectAddress: msg.objectAddress,
      senderAddress: msg.sender,
      senderUrn: msg.senderUrn,
      image: msg.image,
      ts: msg.ts || Date.now(),
    };

    const current = _getStored(networkRef.current);
    // Deduplicate by first CID
    const primaryCid = notif.cids[0];
    if (primaryCid && current.some(n => n.cids && n.cids[0] === primaryCid)) return;
    const updated = [notif, ...current].slice(0, 50); // Cap at 50
    _setStored(networkRef.current, updated);
    _notify();

    // Desktop toast notification
    const label = msg.senderUrn || msg.sender?.substring(0, 12) || 'Peer';
    toast(`${label} inked ${msg.objectUrn || primaryCid?.substring(0, 12) || 'an object'}`, {
      description: notif.cids.length > 0 ? `Pinning ${notif.cids.length} CID${notif.cids.length > 1 ? 's' : ''}...` : undefined,
      duration: 5000,
    });

    // Auto-pin ALL CIDs to local Kubo (fire & forget)
    for (const cid of notif.cids) {
      if (cid) fetch(`${API}/api/ipfs/pin/${cid}`, { method: 'POST' }).catch(() => {});
    }
  }, [myAddress]);

  // Clear a specific ink notification (on click)
  const clearInk = useCallback((id) => {
    const current = _getStored(networkRef.current);
    const updated = current.filter(n => n.id !== id);
    _setStored(networkRef.current, updated);
    _notify();
  }, []);

  // Clear all inks from a specific sender
  const clearInksFrom = useCallback((senderAddress) => {
    const current = _getStored(networkRef.current);
    const updated = current.filter(n => n.senderAddress !== senderAddress);
    _setStored(networkRef.current, updated);
    _notify();
  }, []);

  // Group inks by sender for sidebar display
  const inksBySender = inks.reduce((acc, ink) => {
    const key = ink.senderAddress;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ink);
    return acc;
  }, {});

  return { inks, inksBySender, addInk, clearInk, clearInksFrom, count: inks.length };
}
