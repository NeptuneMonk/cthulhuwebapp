/**
 * IncomingCallAlert — Notification shown when a RING signal is detected in the mempool.
 * Shows caller info, accept/decline buttons, and the answering machine option.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { FiPhone, FiPhoneOff, FiVideo, FiVoicemail } from 'react-icons/fi';
import { startRingtone, stopRingtone } from '@/utils/callTones';

function resolveImageUrl(ref) {
  if (!ref) return null;
  if (ref.startsWith('http')) return ref;
  const upper = (ref || '').toUpperCase();
  if (upper.startsWith('IPFS:')) {
    const path = ref.slice(5).replace(/\\/g, '/');
    const parts = path.split('/');
    return `https://ipfs.io/ipfs/${parts[0]}${parts.length > 1 ? '/' + encodeURIComponent(parts.slice(1).join('/')) : ''}`;
  }
  if (/^Qm[a-zA-Z0-9]{44}/.test(ref) || /^bafy/.test(ref)) return `https://ipfs.io/ipfs/${ref}`;
  return null;
}

export default function IncomingCallAlert({
  caller,        // { address, urn, image }
  signal,        // The raw RING signal from createCallMonitor
  onAccept,      // () => void
  onDecline,     // () => void
  onMissed,      // () => void — called when countdown expires (missed call)
  autoDeclineSeconds = 30,
}) {
  const [countdown, setCountdown] = useState(autoDeclineSeconds);
  const [ringing, setRinging] = useState(true);

  // Start ringtone on mount, stop on unmount or answer
  useEffect(() => {
    startRingtone();
    return () => stopRingtone();
  }, []);

  // Countdown timer
  useEffect(() => {
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(iv);
          if (onMissed) onMissed();
          else onDecline();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [onDecline, onMissed]);

  // Ring animation pulse
  useEffect(() => {
    const iv = setInterval(() => setRinging(r => !r), 800);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 w-72" data-testid="incoming-call-alert">
      <div className={`rounded-lg overflow-hidden transition-all ${
        ringing ? 'ring-2 ring-green-500/60 shadow-lg shadow-green-500/10' : ''
      }`}
           style={{
             background: '#0a1a0a',
             border: '2px solid #1a4a1a',
           }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-green-900/30">
          <div className={`w-2 h-2 rounded-full ${ringing ? 'bg-green-400' : 'bg-green-800'}`} />
          <span className="text-[9px] font-mono tracking-[0.2em] text-green-500 animate-pulse">
            INCOMING CALL
          </span>
          <span className="ml-auto text-[8px] font-mono text-green-700/50">
            {countdown}s
          </span>
        </div>

        {/* Caller info */}
        <div className="flex items-center gap-3 px-3 py-3">
          <div className={`w-12 h-12 rounded-full overflow-hidden border-2 flex-shrink-0 ${
            ringing ? 'border-green-500' : 'border-green-800'
          }`}>
            {resolveImageUrl(caller?.image) ? (
              <img src={resolveImageUrl(caller.image)} alt=""
                   className="w-full h-full object-cover"
                   style={{ filter: 'saturate(0.3) brightness(0.8) sepia(0.2)' }}
                   onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-green-950/50 text-green-600 text-sm font-mono">
                {(caller?.urn || '?')[0].toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono text-green-400 truncate">
              {caller?.urn || `${caller?.address?.slice(0, 16)}...`}
            </p>
            <p className="text-[8px] font-mono text-green-700/50">
              via mempool signal
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-3 pb-3">
          <button onClick={onAccept}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-green-900/40 border border-green-600/30 text-green-400 text-[10px] font-mono hover:bg-green-800/40 transition-all"
            data-testid="incoming-call-accept">
            <FiPhone size={12} /> ACCEPT
          </button>
          <button onClick={onDecline}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded bg-red-900/30 border border-red-700/30 text-red-400 text-[10px] font-mono hover:bg-red-800/30 transition-all"
            data-testid="incoming-call-decline">
            <FiPhoneOff size={12} /> DECLINE
          </button>
        </div>
      </div>
    </div>
  );
}
