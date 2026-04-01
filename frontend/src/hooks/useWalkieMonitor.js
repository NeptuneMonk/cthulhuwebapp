/**
 * Persistent Walkie-Talkie + Phone monitor hook.
 * Keeps the walkie WebSocket alive across page navigations.
 * Detects incoming phone calls globally via mesh signaling.
 * Plays incoming walkie audio automatically.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { createWalkieMonitor, fetchIPFSAudio } from '@/utils/walkieTalkie';
import { createMeshPhone } from '@/utils/meshPhone';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

function storageKeyForUser(userAddress) {
  return `cthulhu_walkie_state_${userAddress || 'anon'}`;
}

function loadPersistedState(userAddress) {
  try {
    const raw = localStorage.getItem(storageKeyForUser(userAddress));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { active: false, channel: 546 };
}

function persistState(userAddress, state) {
  try { localStorage.setItem(storageKeyForUser(userAddress), JSON.stringify(state)); } catch {}
}

export function useWalkieMonitor(network, userAddress) {
  const [active, setActive] = useState(() => loadPersistedState(userAddress).active);
  const [channel, setChannel] = useState(() => loadPersistedState(userAddress).channel);
  const [lastRx, setLastRx] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [walkieSender, setWalkieSender] = useState(null); // avatar overlay for walkie broadcasts
  const monitorRef = useRef(null);
  const meshPhoneRef = useRef(null);
  const audioRef = useRef(null);
  const recentCallersRef = useRef(new Map());

  // ─── Walkie audio monitor ──────────────────────────────────────
  useEffect(() => {
    if (!active || !network || window.__walkiePageActive) {
      monitorRef.current?.disconnect();
      monitorRef.current = null;
      return;
    }

    const monitor = createWalkieMonitor(network, async (transmission) => {
      setLastRx({ from: transmission.from?.slice(0, 10), ts: Date.now() });
      toast.info(`Walkie: incoming on CH ${transmission.channel}`, { duration: 3000 });

      // Show sender avatar on the green button
      const senderAddr = transmission.from;
      if (senderAddr) {
        let senderUrn = senderAddr.slice(0, 10) + '...';
        let senderImage = null;
        try {
          const res = await fetch(`${API}/api/profile/${senderAddr}?network=${network}`);
          if (res.ok) {
            const prof = await res.json();
            if (prof?.urn) senderUrn = prof.urn;
            if (prof?.image) senderImage = prof.image;
          }
        } catch {}
        setWalkieSender({ from: senderAddr, urn: senderUrn, image: senderImage });
        // Clear after 6 seconds (roughly how long a walkie message plays)
        setTimeout(() => setWalkieSender(null), 6000);
      }

      if (transmission.ipfsRefs?.[0]) {
        try {
          const blobUrl = await fetchIPFSAudio(transmission.ipfsRefs[0]);
          if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
          const audio = new Audio(blobUrl);
          audio.volume = 0.8;
          audioRef.current = audio;
          try { await audio.play(); } catch {
            const handler = async () => {
              try { await audio.play(); } catch {}
              document.removeEventListener('pointerdown', handler);
            };
            document.addEventListener('pointerdown', handler, { once: true });
          }
        } catch {}
      }
    });
    monitor.setChannel(channel);
    if (userAddress) monitor.setMyAddress(userAddress);
    monitor.connect();
    monitorRef.current = monitor;

    return () => { monitor.disconnect(); monitorRef.current = null; };
  }, [active, network, userAddress, channel]);

  // ─── Mesh phone call monitor (global) ──────────────────────────
  // Detects incoming RING signals via the mesh WebSocket.
  // Runs whenever the walkie is powered on (even when not on the walkie page).
  useEffect(() => {
    if (!active || !network || !userAddress) {
      meshPhoneRef.current?.disconnect();
      meshPhoneRef.current = null;
      return;
    }

    // Don't run global monitor when WalkieTalkiePage is active
    // (it manages its own meshPhone with full call handling)
    if (window.__walkiePageActive) return;

    const phone = createMeshPhone(userAddress, network);

    phone.setOnRing(async (signal) => {
      if (signal.from === userAddress) return;

      // Deduplicate: ignore repeat RINGs within 10 seconds
      const now = Date.now();
      const last = recentCallersRef.current.get(signal.from);
      if (last && (now - last) < 10000) return;
      recentCallersRef.current.set(signal.from, now);

      // Get caller profile for avatar
      let callerUrn = signal.callerInfo?.urn || signal.from?.slice(0, 12) + '...';
      let callerImage = signal.callerInfo?.image || null;

      // If callerInfo wasn't included, look it up
      if (!callerImage) {
        try {
          const res = await fetch(`${API}/api/profile/${signal.from}?network=${network}`);
          if (res.ok) {
            const prof = await res.json();
            if (prof?.urn) callerUrn = prof.urn;
            if (prof?.image) callerImage = prof.image;
          }
        } catch {}
      }

      setIncomingCall({
        from: signal.from,
        urn: callerUrn,
        image: callerImage,
        video: signal.video || false,
        sdp: signal.sdp,
        timestamp: now,
        viaMesh: true,
      });

      // Auto-dismiss after 30 seconds
      setTimeout(() => {
        setIncomingCall(prev => prev?.from === signal.from && prev?.timestamp === now ? null : prev);
      }, 30000);
    });

    phone.connect();
    meshPhoneRef.current = phone;

    return () => { phone.disconnect(); meshPhoneRef.current = null; };
  }, [active, network, userAddress]);

  // ─── Sync with walkie page events ─────────────────────────────
  useEffect(() => {
    const onPageChange = () => {
      // Sync both active and channel from persisted state
      const s = loadPersistedState(userAddress);
      setActive(s.active);
      setChannel(s.channel);
    };
    // Listen for incoming call events dispatched by WalkieTalkiePage
    const onIncomingCall = (e) => {
      if (e.detail) {
        setIncomingCall({
          from: e.detail.from,
          urn: e.detail.urn,
          image: e.detail.image,
          video: e.detail.video || false,
          timestamp: Date.now(),
          viaMesh: true,
        });
        // Auto-dismiss after 30 seconds
        const ts = Date.now();
        setTimeout(() => {
          setIncomingCall(prev => prev?.timestamp === ts ? null : prev);
        }, 30000);
      } else {
        setIncomingCall(null);
      }
    };
    window.addEventListener('walkie-page-changed', onPageChange);
    window.addEventListener('walkie-incoming-call', onIncomingCall);
    return () => {
      window.removeEventListener('walkie-page-changed', onPageChange);
      window.removeEventListener('walkie-incoming-call', onIncomingCall);
    };
  }, [userAddress]);

  // Persist state
  useEffect(() => { persistState(userAddress, { active, channel }); }, [active, channel, userAddress]);

  const toggleActive = useCallback(() => {
    setActive(prev => {
      const next = !prev;
      persistState(userAddress, { active: next, channel });
      return next;
    });
  }, [channel, userAddress]);

  const updateChannel = useCallback((ch) => {
    setChannel(ch);
    monitorRef.current?.setChannel(ch);
    persistState(userAddress, { active, channel: ch });
  }, [active, userAddress]);

  const dismissCall = useCallback(() => {
    setIncomingCall(null);
    recentCallersRef.current.clear();
  }, []);

  return { active, channel, lastRx, incomingCall, walkieSender, toggleActive, updateChannel, dismissCall };
}
