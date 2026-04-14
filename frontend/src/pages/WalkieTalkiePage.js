import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiArrowLeft, FiX, FiPhone, FiSquare, FiTrash2, FiVideo } from 'react-icons/fi';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { buildAndBroadcast, getChangeAddress } from '@/utils/txBuilder';
import { addTransaction } from '@/utils/txHistory';
import { useTheme } from '@/hooks/useTheme';
import { ECPairFactory } from 'ecpair';
import { ecc } from '@/utils/ecc';
import * as bitcoin from 'bitcoinjs-lib';
import { publicKeyFromPrivate } from '@/utils/ecies';
import PhoneDialer from '@/components/PhoneDialer';
import ActiveCall from '@/components/ActiveCall';
import IncomingCallAlert from '@/components/IncomingCallAlert';
import {
  createCallMonitor,
  decryptCallSignal,
} from '@/utils/webrtcPhone';
import { createMeshPhone } from '@/utils/meshPhone';
import { callLog } from '@/utils/callDebugLog';
import { addCallRecord, updateCallDuration, getCallHistory } from '@/utils/callHistory';
import {
  getWalkieBroadcastAddress,
  createRecorder,
  uploadToIPFS,
  buildWalkieTransmission,
  createWalkieMonitor,
  fetchIPFSAudio,
} from '@/utils/walkieTalkie';

const API = process.env.REACT_APP_BACKEND_URL;
const ECPair = ECPairFactory(ecc);

// ─── Sound FX Engine ───────────────────────────────────────────────────

class RadioSFX {
  constructor() { this.ctx = null; this.vol = 0.8; this.scanNodes = null; }

  init() {
    if (this.ctx?.state === 'running') return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  setVolume(v) { this.vol = v / 100; }

  _gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v * this.vol;
    g.connect(this.ctx.destination);
    return g;
  }

  // Continuous radio static — starts a persistent noise loop for scanning
  startScanStatic() {
    if (!this.ctx || this.scanNodes) return;
    const bufLen = this.ctx.sampleRate * 2; // 2 second loop
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Bandpass filter to sound like radio static
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 2500;
    flt.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = 0.06 * this.vol;
    g.connect(this.ctx.destination);
    src.connect(flt).connect(g);
    src.start();
    this.scanNodes = { src, flt, gain: g };
  }

  // Vary the static slightly on channel change
  varyScanStatic() {
    if (!this.scanNodes) return;
    const freq = 1800 + Math.random() * 2000; // vary between 1800-3800Hz
    this.scanNodes.flt.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    // Brief volume bump
    this.scanNodes.gain.gain.setTargetAtTime(0.1 * this.vol, this.ctx.currentTime, 0.01);
    this.scanNodes.gain.gain.setTargetAtTime(0.06 * this.vol, this.ctx.currentTime + 0.08, 0.05);
  }

  stopScanStatic() {
    if (!this.scanNodes) return;
    try {
      this.scanNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      const nodes = this.scanNodes;
      this.scanNodes = null;
      setTimeout(() => { try { nodes.src.stop(); } catch {} }, 200);
    } catch { this.scanNodes = null; }
  }

  // Quick channel click — crisp millisecond pop
  playChannelClick() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 1200 + Math.random() * 600;
    osc.type = 'square';
    const g = this._gain(0.15);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.008);
    osc.connect(g);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.008); // 8ms click
  }

  playStatic(duration = 0.25, volume = 0.08) {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * duration, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 3000; flt.Q.value = 1;
    const g = this._gain(volume);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(flt).connect(g);
    src.start();
  }

  playClick() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 800 + Math.random() * 400;
    osc.type = 'square';
    const g = this._gain(0.12);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.03);
    osc.connect(g); osc.start(); osc.stop(this.ctx.currentTime + 0.03);
  }

  playKrrrsh() {
    if (!this.ctx) return;
    const dur = 0.35;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'highpass';
    flt.frequency.setValueAtTime(4000, this.ctx.currentTime);
    flt.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + dur);
    const g = this._gain(0.35);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(flt).connect(g); src.start();
  }

}

// ─── Helpers ───────────────────────────────────────────────────────────

function resolveImageUrl(ref) {
  if (!ref) return null;
  if (ref.startsWith('http')) return ref;
  const upper = (ref || '').toUpperCase();
  if (upper.startsWith('IPFS:')) {
    const path = ref.slice(5).replace(/\\/g, '/');
    const parts = path.split('/');
    const cid = parts[0];
    // Use CID+filename for directory CIDs, CID-only for bare CIDs
    if (parts.length > 1) {
      return `https://ipfs.io/ipfs/${cid}/${encodeURIComponent(parts.slice(1).join('/'))}`;
    }
    return `https://ipfs.io/ipfs/${cid}`;
  }
  if (/^Qm[a-zA-Z0-9]{44}/.test(ref) || /^bafy/.test(ref)) return `https://ipfs.io/ipfs/${ref}`;
  return null;
}

// ─── CRT Screen Wrapper ───────────────────────────────────────────────

function CRTScreen({ children, className = '' }) {
  return (
    <div className={`relative overflow-hidden ${className}`}
         style={{ background: '#050a05', borderRadius: 8, border: '2px solid #1a3a1a' }}>
      {children}
      {/* Scan lines */}
      <div className="pointer-events-none absolute inset-0 z-10"
           style={{ background: 'repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)' }} />
      {/* Phosphor vignette */}
      <div className="pointer-events-none absolute inset-0 z-10"
           style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.5), inset 0 0 80px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

// ─── Thumbnail Card ────────────────────────────────────────────────────

function ThumbCard({ image, label, sublabel, onClick }) {
  const [loaded, setLoaded] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [errored, setErrored] = useState(false);
  const url = resolveImageUrl(image);
  // CID-only fallback for single-file CIDs
  const fallbackUrl = image && (image || '').toUpperCase().startsWith('IPFS:')
    ? `https://ipfs.io/ipfs/${image.slice(5).replace(/\\/g, '/').split('/')[0]}`
    : null;
  const activeUrl = useFallback ? fallbackUrl : url;
  return (
    <button onClick={onClick} className="flex-shrink-0 w-20 group" data-testid="viewscreen-thumb">
      <div className="w-20 h-20 rounded bg-black/50 border border-green-900/30 overflow-hidden mb-1 relative">
        {activeUrl && !errored ? (
          <>
            {!loaded && <div className="absolute inset-0 animate-pulse bg-green-950/30" />}
            <img src={activeUrl} alt={label} className="w-full h-full object-cover"
                 style={{ opacity: loaded ? 0.85 : 0, filter: 'saturate(0.3) brightness(0.9) sepia(0.2)' }}
                 onLoad={() => setLoaded(true)}
                 onError={() => {
                   if (!useFallback && fallbackUrl && fallbackUrl !== activeUrl) setUseFallback(true);
                   else setErrored(true);
                 }}
                 loading="lazy" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-green-800 text-[10px] font-mono">
            NO SIG
          </div>
        )}
      </div>
      <p className="text-[9px] font-mono text-green-500/80 truncate group-hover:text-green-300 transition-colors">{label || '???'}</p>
      {sublabel && <p className="text-[8px] font-mono text-green-700/50 truncate">{sublabel}</p>}
    </button>
  );
}

// ─── Viewscreen Component ──────────────────────────────────────────────

const TV_CHANNELS = [
  { id: 'users', label: 'Survivors', icon: 'CH1' },
  { id: 'messages', label: 'Messages', icon: 'CH2' },
];

// ─── Message Card ───────────────────────────────────────────────────────

function MessageCard({ msg, onPlay, onStop, onDelete, isPlaying }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg transition-all w-full text-left border ${
        isPlaying ? 'bg-green-900/30 border-green-600/30' : 'bg-black/30 border-green-900/20 hover:border-green-700/30'
      }`}
      data-testid={`msg-card-${msg.id}`}>
      {/* Play / Avatar area */}
      <button onClick={() => onPlay(msg)} className="flex items-center gap-2 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden border ${
          'border-green-900/30 bg-black/50'
        }`}>
          {msg.image ? (
            <img src={resolveImageUrl(msg.image)} alt="" className="w-full h-full object-cover"
                 style={{ filter: 'saturate(0.4) brightness(0.85)' }}
                 onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div className="text-green-700 text-[9px] font-mono">ANON</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono truncate text-green-400">
            {msg.fromUrn || msg.from?.slice(0, 12) || 'Unknown'}
          </p>
          <p className="text-[8px] font-mono truncate text-green-700/50">
            {`CH ${msg.channel}`}
            {msg.time && ` | ${msg.time}`}
          </p>
        </div>
      </button>
      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isPlaying ? (
          <button
            onClick={(e) => { e.stopPropagation(); onStop?.(); }}
            className="w-7 h-7 rounded-full flex items-center justify-center bg-amber-600/60 hover:bg-amber-500/80 transition-colors"
            title="Stop"
            data-testid={`msg-stop-${msg.id}`}
          >
            <FiSquare size={10} className="text-amber-100 fill-current" />
          </button>
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-green-900/30">
            <div className="w-0 h-0 border-l-[5px] border-y-[3px] border-y-transparent ml-0.5 border-l-green-600" />
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete?.(msg); }}
          className="w-7 h-7 rounded-full flex items-center justify-center bg-red-900/20 hover:bg-red-600/40 transition-colors opacity-50 hover:opacity-100"
          title="Delete message"
          data-testid={`msg-delete-${msg.id}`}
        >
          <FiTrash2 size={10} className="text-red-400" />
        </button>
      </div>
    </div>
  );
}

function Viewscreen({ network, onAction, messageLog, playingId, onPlayMessage, onStopPlayback, onDeleteMessage }) {
  const navigate = useNavigate();
  const [tvCh, setTvCh] = useState('users');
  const [profiles, setProfiles] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    // Fetch known users
    fetch(`${API}/api/known-users/${network}`).then(r => r.json()).then(d => {
      setProfiles((d.users || []).slice(0, 20));
    }).catch(() => {});
  }, [network]);

  const items = tvCh === 'users' ? profiles : [];

  // Auto-scroll for Survivors channel
  useEffect(() => {
    if (tvCh !== 'users') return;
    const el = scrollRef.current;
    if (!el || items.length < 4) return;
    let pos = 0;
    const iv = setInterval(() => {
      pos += 1;
      if (pos >= el.scrollWidth - el.clientWidth) pos = 0;
      el.scrollTo({ left: pos, behavior: 'auto' });
    }, 50);
    return () => clearInterval(iv);
  }, [items, tvCh]);

  // Default channels (Survivors, Messages)
  return (
    <CRTScreen className="mx-4 mt-3">
      {/* Channel buttons */}
      <div className="flex gap-1 p-2 pb-0">
        {TV_CHANNELS.map(ch => (
          <button key={ch.id} onClick={() => setTvCh(ch.id)}
            className={`px-2 py-1 rounded text-[9px] font-mono tracking-wider transition-all border ${
              tvCh === ch.id
                ? 'bg-green-900/40 border-green-600/40 text-green-400 shadow-green-900/20 shadow-sm'
                : 'bg-black/30 border-green-900/20 text-green-700/60 hover:text-green-500'
            }`}
            data-testid={`tv-ch-${ch.id}`}>
            <span className="text-green-600/40 mr-1">{ch.icon}</span>{ch.label}
          </button>
        ))}
      </div>

      {tvCh === 'messages' ? (
        /* Messages Channel — broadcast history */
        <div className="flex flex-col gap-1.5 p-2 overflow-y-auto scrollbar-hide" style={{ maxHeight: 200 }}>
          {(!messageLog || messageLog.length === 0) ? (
            <div className="flex-1 flex items-center justify-center text-green-800/50 text-[10px] font-mono py-6">
              NO MESSAGES YET...
            </div>
          ) : (
            messageLog.map(msg => (
              <MessageCard key={msg.id} msg={msg} isPlaying={playingId === msg.id}
                onPlay={onPlayMessage} onStop={onStopPlayback} onDelete={onDeleteMessage} />
            ))
          )}
        </div>
      ) : (
        /* Survivors Thumbnail strip */
        <div ref={scrollRef} className="flex gap-2 p-2 overflow-x-auto scrollbar-hide" style={{ minHeight: 110 }}>
          {profiles.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-green-800/50 text-[10px] font-mono py-6">
              SCANNING FOR SIGNALS...
            </div>
          ) : (
            profiles.map((u, i) => (
              <ThumbCard key={u.address || i} image={u.image}
                label={u.urn || u.display_name || 'Anon'}
                sublabel={u.address?.slice(0, 10)}
                onClick={() => navigate(`/profile/${u.address}`)} />
            ))
          )}
        </div>
      )}
    </CRTScreen>
  );
}

// ─── SupFlix Thumbnail ─────────────────────────────────────────────────


// ─── Rotary Knob ───────────────────────────────────────────────────────

function RotaryKnob({ value, onChange, min, max, label, step = 1, disabled, displayValue }) {
  const knobRef = useRef(null);
  const dragState = useRef({ active: false, startY: 0, startVal: value });
  const range = max - min;
  const rotation = ((value - min) / range) * 270 - 135;

  const onDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    knobRef.current?.setPointerCapture(e.pointerId);
    dragState.current = { active: true, startY: e.clientY, startVal: value };
  };
  const onMove = (e) => {
    if (!dragState.current.active) return;
    const dy = dragState.current.startY - e.clientY;
    let raw = dragState.current.startVal + dy * (range / 150);
    raw = Math.max(min, Math.min(max, raw));
    if (step > 0) raw = Math.round(raw / step) * step;
    onChange(raw);
  };
  const onUp = () => { dragState.current.active = false; };

  return (
    <div className="flex flex-col items-center select-none" data-testid={`knob-${label.toLowerCase().replace(/\s/g, '-')}`}>
      <span className="text-[9px] tracking-[0.2em] uppercase text-amber-500/60 mb-1.5 font-mono">{label}</span>
      <div className="relative w-14 h-14">
        {[...Array(11)].map((_, i) => {
          const a = (i / 10) * 270 - 135;
          const rad = (a - 90) * Math.PI / 180;
          return <div key={i} className="absolute w-px h-1 bg-amber-600/30 rounded-full"
            style={{ left: 28 + 32 * Math.cos(rad), top: 28 + 32 * Math.sin(rad), transform: `rotate(${a}deg)` }} />;
        })}
        <div ref={knobRef}
          className={`absolute inset-1 rounded-full cursor-grab active:cursor-grabbing touch-none ${disabled ? 'opacity-30' : ''}`}
          style={{
            background: 'conic-gradient(from 180deg, #2a2a2a, #444, #2a2a2a)',
            boxShadow: 'inset 0 1px 4px rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.6)',
            transform: `rotate(${rotation}deg)`,
          }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="absolute top-0.5 left-1/2 -translate-x-1/2 w-0.5 h-3.5 bg-amber-400 rounded-full" />
        </div>
      </div>
      <span className="text-[10px] text-green-400/80 mt-1 font-mono tabular-nums">{displayValue ?? value}</span>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function WalkieTalkiePage({ network = 'btc-testnet' }) {
  const { wif, user, isConnected, isWalletUnlocked, unlockWallet } = useAuth();
  const navigate = useNavigate();
  const { wallpaperStyle } = useTheme();
  const userAddress = user?.address;

  // Radio state — load initial power state from the persisted key
  const [powerOn, setPowerOn] = useState(() => {
    try {
      const key = `cthulhu_walkie_state_${user?.address || 'anon'}`;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw).active || false;
    } catch {}
    return false;
  });
  const [scanning, setScanning] = useState(false);
  const [volume, setVolume] = useState(75);
  const [channel, setChannel] = useState(() => {
    try {
      const key = `cthulhu_walkie_state_${user?.address || 'anon'}`;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw).channel || 546;
    } catch {}
    return 546;
  });
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [transmissions, setTransmissions] = useState([]);
  const [status, setStatus] = useState('OFFLINE');
  const [bootText, setBootText] = useState('');
  const [booting, setBooting] = useState(false);
  const [showInlineAuth, setShowInlineAuth] = useState(false);
  const [inlinePassword, setInlinePassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Derive private key bytes from WIF for ECIES decryption (used by call monitor)
  const privateKeyBytes = useMemo(() => {
    if (!wif) return null;
    try {
      const isMainnet = network.includes('mainnet');
      const networkObj = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
      const keyPair = ECPair.fromWIF(wif, networkObj);
      return keyPair.privateKey;
    } catch { return null; }
  }, [wif, network]);

  // Derive user's own public key (PKX/PKY) for embedding in call signals
  // PKX = 32-byte X coordinate hex, PKY = 32-byte Y coordinate hex (uncompressed)
  const userKeys = useMemo(() => {
    if (!privateKeyBytes) return { pkx: '', pky: '' };
    try {
      const { pkx, pky } = publicKeyFromPrivate(privateKeyBytes);
      return { pkx, pky };
    } catch { return { pkx: '', pky: '' }; }
  }, [privateKeyBytes]);

  // Phone dialer state
  const [phoneOpen, setPhoneOpen] = useState(false);

  // Derive change address for self-filtering in call monitor
  const changeAddress = useMemo(() => {
    if (!wif) return null;
    try { return getChangeAddress(wif, network); } catch { return null; }
  }, [wif, network]);

  // Active call state
  const [activeCall, setActiveCall] = useState(null); // { contact, isIncoming, incomingSignal }
  const [incomingCall, setIncomingCall] = useState(null); // { signal, callerInfo }
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const callMonitorRef = useRef(null);
  const meshPhonePageRef = useRef(null);
  const callRecordIdRef = useRef(null);
  const location = useLocation();

  // Keep refs in sync so effect callbacks always see the latest values
  // without needing activeCall/incomingCall in dependency arrays
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

  // Auto-accept incoming call routed from App.js global alert
  // CRITICAL: Start the call IMMEDIATELY — no async profile fetch delay.
  // The caller is waiting for an ANSWER and every second counts.
  const pendingIceCandidatesRef = useRef([]);

  useEffect(() => {
    const autoCall = location.state?.autoAcceptCall;
    if (!autoCall || !powerOn || activeCall) return;

    // Build contact info from what we already have (no network fetch!)
    const callerInfo = {
      address: autoCall.from,
      urn: autoCall.urn || `${autoCall.from?.slice(0, 12)}...`,
      image: autoCall.image || null,
      pkx: null,
      pky: null,
      hasKeys: false,
    };

    const signal = {
      from: autoCall.from,
      sdp: autoCall.sdp,
      viaMesh: autoCall.viaMesh || true,
    };

    // Start the call immediately
    setActiveCall({
      contact: callerInfo,
      isIncoming: true,
      incomingSignal: signal,
      callType: autoCall.video ? 'video' : 'audio',
    });

    // Fetch profile in background for display updates (non-blocking)
    (async () => {
      try {
        const res = await fetch(`${API}/api/profile/${autoCall.from}?network=${network}`);
        if (res.ok) {
          const prof = await res.json();
          if (prof?.pkx || prof?.pky || prof?.urn || prof?.image) {
            setActiveCall(prev => {
              if (!prev || prev.incomingSignal?.from !== autoCall.from) return prev;
              return {
                ...prev,
                contact: {
                  ...prev.contact,
                  pkx: prof.pkx || prev.contact.pkx,
                  pky: prof.pky || prev.contact.pky,
                  urn: prof.urn || prev.contact.urn,
                  image: prof.image || prev.contact.image,
                  hasKeys: !!(prof.pkx && prof.pky),
                },
              };
            });
          }
        }
      } catch {}
    })();

    // Clear the location state so it doesn't re-trigger
    navigate('/walkie', { replace: true, state: {} });
  }, [location.state]);

  // Message log (public broadcasts)
  const [messageLog, setMessageLog] = useState([]);
  const [playingId, setPlayingId] = useState(null);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      try { URL.revokeObjectURL(audioRef.current.src); } catch {}
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const deleteMessage = useCallback((msg) => {
    stopPlayback();
    setMessageLog(prev => prev.filter(m => m.id !== msg.id));
  }, [stopPlayback]);

  const sfxRef = useRef(new RadioSFX());
  const recorderRef = useRef(null);
  const monitorRef = useRef(null);
  const audioRef = useRef(null);
  const scanTimerRef = useRef(null);
  const logEndRef = useRef(null);
  const playIncomingRef = useRef(null);
  const wifRef = useRef(wif);
  const volumeRef = useRef(volume);

  // Keep refs in sync with latest values for use in closures
  useEffect(() => { wifRef.current = wif; }, [wif]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // Signal to the background monitor that this page is managing its own connection
  useEffect(() => {
    window.__walkiePageActive = true;
    window.dispatchEvent(new Event('walkie-page-changed'));
    return () => {
      window.__walkiePageActive = false;
      window.dispatchEvent(new Event('walkie-page-changed'));
    };
  }, []);

  // Contacts for phone rolodex (fetched from follows API)
  const [allContacts, setAllContacts] = useState([]);

  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/data/follows/${userAddress}?network=${network}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const contacts = (data.follows || data || []).filter(f => f.address !== userAddress);
        if (!cancelled) setAllContacts(contacts);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [userAddress, network]);

  // Sync power state to persistent storage (so background monitor picks up on unmount)
  useEffect(() => {
    try {
      // Write to the same key that useWalkieMonitor reads
      const storageKey = `cthulhu_walkie_state_${userAddress || 'anon'}`;
      localStorage.setItem(storageKey, JSON.stringify({ active: powerOn, channel }));
      // Also write to the legacy key for backwards compat
      localStorage.setItem('cthulhu_walkie_state', JSON.stringify({ active: powerOn, channel }));
    } catch {}
  }, [powerOn, channel, userAddress]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [transmissions]);
  useEffect(() => { sfxRef.current.setVolume(volume); }, [volume]);

  const addLog = useCallback((entry) => {
    setTransmissions(prev => [...prev.slice(-40), { ...entry, id: Date.now() + Math.random(), ts: new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) }]);
  }, []);

  // Play a message from the message log (public broadcasts only)
  const playMessage = useCallback(async (msg) => {
    try {
      setPlayingId(msg.id);
      sfxRef.current.init();
      if (!msg.ipfsRef) { setPlayingId(null); return; }
      const blobUrl = await fetchIPFSAudio(msg.ipfsRef);
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
      const audio = new Audio(blobUrl);
      audio.volume = volume / 100;
      audioRef.current = audio;
      audio.onended = () => { sfxRef.current.playKrrrsh(); setPlayingId(null); };
      await audio.play();
    } catch (err) {
      toast.error(`Playback failed: ${err.message}`);
      setPlayingId(null);
    }
  }, [volume]);

  // ─── Boot Sequence ─────────────────────────────────────────────────

  const runBoot = useCallback(async () => {
    setBooting(true);
    sfxRef.current.init();
    const lines = [
      'INITIALIZING WASTELAND FREQUENCIES...',
      '> SCANNING SPECTRUM.......... OK',
      '> IPFS NODE................ CONNECTED',
      '> MEMPOOL LINK............. ESTABLISHED',
      `> BATTERY.................. ${wif ? 'CHARGED' : 'LOW'}`,
    ];
    let full = '';
    for (const line of lines) {
      for (const ch of line) {
        full += ch;
        setBootText(full);
        await new Promise(r => setTimeout(r, 8));
      }
      full += '\n';
      setBootText(full);
      sfxRef.current.playClick();
      await new Promise(r => setTimeout(r, 120));
    }

    // If wallet is locked, show inline password prompt
    if (!wif) {
      const authLine = '\n> WALLET LOCKED. AUTHENTICATE TO PROCEED.\n';
      for (const ch of authLine) {
        full += ch;
        setBootText(full);
        await new Promise(r => setTimeout(r, 8));
      }
      setBootText(full);
      setBooting(false);
      setShowInlineAuth(true);
      return false; // Signal: don't continue power-on yet
    }

    const readyLines = ['', 'SYSTEM READY. TUNE IN, SURVIVOR.'];
    for (const line of readyLines) {
      for (const ch of line) {
        full += ch;
        setBootText(full);
        await new Promise(r => setTimeout(r, 8));
      }
      full += '\n';
      setBootText(full);
      sfxRef.current.playClick();
      await new Promise(r => setTimeout(r, 120));
    }
    await new Promise(r => setTimeout(r, 500));
    setBooting(false);
    return true; // Signal: ready to go
  }, [wif]);

  // ─── Power On/Off ──────────────────────────────────────────────────

  const togglePower = useCallback(async () => {
    if (powerOn) {
      monitorRef.current?.disconnect();
      monitorRef.current = null;
      clearInterval(scanTimerRef.current);
      setScanning(false);
      setPowerOn(false);
      setStatus('OFFLINE');
      setBootText('');
      setShowInlineAuth(false);
      setInlinePassword('');
      setAuthError('');
      addLog({ type: 'sys', text: 'RADIO POWERED OFF' });
    } else {
      const ready = await runBoot();
      if (!ready) return; // Waiting for inline password
      finishPowerOn();
    }
  }, [powerOn, network, channel, userAddress, addLog, runBoot]);

  // Called after successful boot (or after inline auth succeeds)
  const finishPowerOn = useCallback(() => {
    // Pre-request microphone permissions so they're ready when a call comes in
    // This prevents the permissions popup from blocking/killing active calls
    navigator.mediaDevices?.getUserMedia({ audio: true }).then(stream => {
      stream.getTracks().forEach(t => t.stop()); // Release immediately, just wanted the permission
      callLog('INFO', 'Mic permission pre-granted on power-on');
    }).catch(err => {
      callLog('WARN', `Mic permission pre-request failed: ${err.message}`, { error: err.name });
      addLog({ type: 'sys', text: 'MIC PERMISSION NEEDED FOR CALLS' });
    });

    const monitor = createWalkieMonitor(network, (transmission) => {
        // Stop scanning, play incoming transmission
        if (scanTimerRef.current) {
          wasScanning.current = true;
          clearInterval(scanTimerRef.current);
          scanTimerRef.current = null;
        }
        setScanning(false);
        setChannel(transmission.channel);

        // Skip encrypted transmissions — walkie is public broadcast only
        const isEncrypted = transmission.encrypted === true || transmission.ipfsRefs?.some(r => /[\/\\]SEC$/.test(r));
        if (isEncrypted) return;

        // Add to message log
        setMessageLog(prev => [{
          id: transmission.txid || Date.now(),
          from: transmission.from,
          channel: transmission.channel,
          ipfsRef: transmission.ipfsRefs?.[0] || null,
          time: new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        }, ...prev.slice(0, 50)]);

        addLog({ type: 'rx', from: transmission.from?.slice(0, 10), text: 'INCOMING TRANSMISSION' });
        if (transmission.ipfsRefs?.[0]) playIncomingRef.current?.(transmission.ipfsRefs[0]);
      });
      monitor.setChannel(channel);
      monitor.setMyAddress(userAddress);
      monitor.connect();
      monitorRef.current = monitor;
      setPowerOn(true);
      setStatus(`CH ${channel} MONITORING`);
      addLog({ type: 'sys', text: `TUNED TO CH ${channel}` });
  }, [network, channel, userAddress, addLog]);

  // ─── Inline Password Auth ────────────────────────────────────────────
  const handleInlineAuth = useCallback(async () => {
    if (!inlinePassword) return;
    setAuthError('');
    try {
      await unlockWallet(inlinePassword);
      setShowInlineAuth(false);
      setInlinePassword('');
      // Append success text to boot screen
      setBootText(prev => prev + '> AUTHENTICATION.......... ACCEPTED\n\nSYSTEM READY. TUNE IN, SURVIVOR.\n');
      sfxRef.current.playClick();
      await new Promise(r => setTimeout(r, 800));
      finishPowerOn();
    } catch {
      setAuthError('ACCESS DENIED');
      sfxRef.current.playClick();
    }
  }, [inlinePassword, unlockWallet, finishPowerOn]);

  // ─── Scanner ───────────────────────────────────────────────────────

  const toggleScan = useCallback(() => {
    if (scanning) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
      sfxRef.current.stopScanStatic();
      setScanning(false);
      setStatus(`CH ${channel} MONITORING`);
      addLog({ type: 'sys', text: `SCAN STOPPED — CH ${channel}` });
    } else {
      setScanning(true);
      addLog({ type: 'sys', text: 'SCANNING ALL CHANNELS...' });
      sfxRef.current.startScanStatic(); // Start persistent radio static
      let ch = 546;
      scanTimerRef.current = setInterval(() => {
        ch = ch >= 646 ? 546 : ch + 1;
        setChannel(ch);
        setStatus(`SCANNING CH ${ch}`);
        monitorRef.current?.setChannel(ch);
        sfxRef.current.playChannelClick(); // Quick ms click on channel change
        sfxRef.current.varyScanStatic(); // Shift the static tone slightly
      }, 200);
    }
  }, [scanning, channel, addLog]);

  // Update channel on monitor
  useEffect(() => {
    if (monitorRef.current && !scanning) {
      monitorRef.current.setChannel(channel);
      setStatus(`CH ${channel} MONITORING`);
    }
  }, [channel, scanning]);

  // Cleanup
  useEffect(() => () => {
    monitorRef.current?.disconnect();
    clearInterval(scanTimerRef.current);
    sfxRef.current.stopScanStatic();
  }, []);

  const wasScanning = useRef(false);

  // ─── Audio Playback ────────────────────────────────────────────────

  const playIncoming = useCallback(async (ipfsRef) => {
    try {
      addLog({ type: 'play', text: 'RECEIVING AUDIO...' });
      const blobUrl = await fetchIPFSAudio(ipfsRef);
      if (audioRef.current) { audioRef.current.pause(); URL.revokeObjectURL(audioRef.current.src); }
      const audio = new Audio(blobUrl);
      audio.volume = volume / 100;
      audioRef.current = audio;
      audio.onended = () => {
        sfxRef.current.playKrrrsh();
        addLog({ type: 'sys', text: 'TRANSMISSION COMPLETE *krrsh*' });
        // Auto-resume scanning if it was active before
        if (wasScanning.current) {
          setTimeout(() => toggleScan(), 800);
        }
      };
      // Ensure AudioContext is resumed (required on mobile after user gesture)
      if (sfxRef.current.ctx?.state === 'suspended') {
        try { await sfxRef.current.ctx.resume(); } catch {}
      }
      try {
        await audio.play();
      } catch (playErr) {
        // Mobile autoplay restriction — user must interact first
        addLog({ type: 'sys', text: 'TAP RADIO TO ENABLE AUDIO' });
        const handler = async () => {
          try { await audio.play(); } catch {}
          document.removeEventListener('pointerdown', handler);
        };
        document.addEventListener('pointerdown', handler, { once: true });
      }
    } catch (err) {
      addLog({ type: 'err', text: `PLAYBACK FAILED: ${err.message}` });
    }
  }, [volume, addLog, toggleScan]);

  // Keep ref in sync so the monitor callback always has the latest playIncoming
  useEffect(() => { playIncomingRef.current = playIncoming; }, [playIncoming]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume / 100; }, [volume]);

  // ─── Phone Call Monitor ────────────────────────────────────────────
  // Listen for incoming RING signals via mempool when radio is on
  // Deduplication: ignore repeat RINGs from same caller within 10 seconds
  const recentCallersRef = useRef(new Map()); // address -> timestamp

  // Clear dedup entries when a call ends so the same person can call again
  useEffect(() => {
    if (!activeCall) {
      recentCallersRef.current.clear();
    }
  }, [activeCall]);

  useEffect(() => {
    if (!powerOn || !wif || !userAddress) {
      callMonitorRef.current?.disconnect();
      callMonitorRef.current = null;
      return;
    }

    const monitor = createCallMonitor(userAddress, network, async (signal) => {
      if (signal.type === 'RING') {
        callLog('INFO', `RING received from ${signal.from?.slice(0, 12)}`, { type: signal.type, hasSDPOffer: !!signal.sdpOffer, hasMeshOffer: !!signal.meshOffer });

        // Skip if we're already in a call or have a pending incoming call
        // GLARE DETECTION: if we're calling someone and they call us simultaneously,
        // the lower address yields and accepts the incoming call automatically
        if (activeCallRef.current) {
          const activeContactAddr = activeCallRef.current.contact?.address;
          const callerAddr_ = signal.from;
          if (activeContactAddr && callerAddr_ === activeContactAddr && userAddress > callerAddr_) {
            // Glare: we're calling them AND they're calling us. Lower address wins as caller.
            // We yield — hang up our outgoing call and accept theirs.
            callLog('WARN', `GLARE detected: both calling each other. We yield (our addr > theirs)`, { us: userAddress?.slice(0, 12), them: callerAddr_?.slice(0, 12) });
            addLog({ type: 'sys', text: 'SIMULTANEOUS CALL DETECTED — SWITCHING TO INCOMING' });
            // Let the incoming through by clearing our outgoing state
            setActiveCall(null);
            activeCallRef.current = null;
            // Fall through to process the incoming RING below
          } else {
            callLog('WARN', 'RING ignored: already in active call', { activeContact: activeContactAddr?.slice(0, 12) });
            return;
          }
        }
        if (incomingCallRef.current) {
          callLog('WARN', 'RING ignored: already have pending incoming call');
          return;
        }

        // SELF-FILTER: ignore our own transactions (main address OR change address)
        const ownAddresses = new Set([userAddress, changeAddress].filter(Boolean));
        const signalAddresses = [signal.from, ...(signal.inputAddresses || [])];
        if (signalAddresses.some(addr => ownAddresses.has(addr))) return;

        // Deduplicate: ignore repeat RINGs from same caller within 10 seconds
        const now = Date.now();
        const lastRing = recentCallersRef.current.get(signal.from);
        if (lastRing && (now - lastRing) < 10000) return;
        recentCallersRef.current.set(signal.from, now);

        // Try to decrypt the RING to extract embedded caller identity
        let callerAddr = signal.from;
        let callerPKX = null, callerPKY = null;
        try {
          const decrypted = await decryptCallSignal(signal, privateKeyBytes);
          if (decrypted?.callerAddress) {
            callerAddr = decrypted.callerAddress;
            callerPKX = decrypted.callerPKX;
            callerPKY = decrypted.callerPKY;
          }
        } catch { /* fall back to address-based lookup */ }

        // Look up caller profile by their main address
        let callerContact = allContacts.find(c => c.address === callerAddr);

        // Also check tx input addresses as fallback
        if (!callerContact) {
          const addressesToCheck = [callerAddr, signal.from, ...(signal.inputAddresses || [])];
          for (const addr of addressesToCheck) {
            callerContact = allContacts.find(c => c.address === addr);
            if (callerContact) break;
          }
        }

        // If still not in contacts, fetch from API
        if (!callerContact) {
          try {
            const res = await fetch(`${API}/api/profile/${callerAddr}?network=${network}`);
            if (res.ok) {
              const prof = await res.json();
              if (prof && prof.urn) {
                callerContact = { address: callerAddr, urn: prof.urn, image: prof.image, pkx: callerPKX || prof.pkx, pky: callerPKY || prof.pky, hasKeys: true };
              }
            }
          } catch { /* continue */ }
        }

        // Build callerInfo — prefer embedded keys
        const callerInfo = callerContact
          ? { ...callerContact, pkx: callerPKX || callerContact.pkx, pky: callerPKY || callerContact.pky }
          : {
              address: callerAddr,
              urn: `${callerAddr.slice(0, 8)}...`,
              image: null,
              pkx: callerPKX,
              pky: callerPKY,
              hasKeys: !!(callerPKX && callerPKY),
            };

        // Check if we accept calls
        try {
          const res = await fetch(`${API}/api/call-settings/${userAddress}?network=${network}`);
          const settings = await res.json();
          if (!settings.accept_calls) {
            addLog({ type: 'sys', text: `BLOCKED CALL FROM ${callerInfo.urn} (calls disabled)` });
            return;
          }
        } catch { /* proceed if can't check */ }

        setIncomingCall({ signal, callerInfo });
        addLog({ type: 'rx', text: `INCOMING CALL FROM @${callerInfo.urn}` });
        callLog('INFO', `Incoming call displayed`, { from: callerInfo.urn, address: callerAddr, hasSDPOffer: !!signal.sdpOffer, hasMeshOffer: !!signal.meshOffer });
        // Auto-dismiss after 30 seconds
        const sig = signal;
        setTimeout(() => {
          setIncomingCall(prev => prev?.signal === sig ? null : prev);
        }, 30000);
      }
    });
    callMonitorRef.current = monitor;
    monitor.connect();

    return () => {
      monitor.disconnect();
      callMonitorRef.current = null;
    };
  }, [powerOn, wif, userAddress, changeAddress, network]);

  // ─── Mesh Phone Monitor (for instant free RINGs) ───────────────────
  // The global useWalkieMonitor mesh phone is disabled while this page is active,
  // so we run our own mesh phone here to receive mesh RINGs.
  useEffect(() => {
    if (!powerOn || !userAddress || !network) {
      meshPhonePageRef.current?.disconnect();
      meshPhonePageRef.current = null;
      return;
    }

    const phone = createMeshPhone(userAddress, network);

    phone.setOnRing(async (signal) => {
      if (signal.from === userAddress) return;
      if (activeCallRef.current || incomingCallRef.current) return;

      // Deduplicate: ignore repeat RINGs within 10 seconds
      const now = Date.now();
      const last = recentCallersRef.current.get(signal.from);
      if (last && (now - last) < 10000) return;
      recentCallersRef.current.set(signal.from, now);

      // Build caller info from mesh callerInfo or profile lookup
      let callerUrn = signal.callerInfo?.urn || signal.from?.slice(0, 12) + '...';
      let callerImage = signal.callerInfo?.image || null;
      let callerAddr = signal.callerInfo?.address || signal.from;

      // Look up from contacts first
      let callerContact = allContacts.find(c => c.address === callerAddr);
      if (!callerContact && signal.from !== callerAddr) {
        callerContact = allContacts.find(c => c.address === signal.from);
      }

      // If not in contacts, fetch from API
      if (!callerContact) {
        try {
          const res = await fetch(`${API}/api/profile/${callerAddr}?network=${network}`);
          if (res.ok) {
            const prof = await res.json();
            if (prof?.urn) {
              callerContact = { address: callerAddr, urn: prof.urn, image: prof.image, pkx: prof.pkx, pky: prof.pky, hasKeys: true };
            }
          }
        } catch {}
      }

      if (callerContact) {
        callerUrn = callerContact.urn || callerUrn;
        callerImage = callerContact.image || callerImage;
      }

      const callerInfo = callerContact || {
        address: callerAddr,
        urn: callerUrn,
        image: callerImage,
        pkx: null,
        pky: null,
        hasKeys: false,
      };

      // Mark as mesh call with SDP already available
      const meshSignal = { ...signal, viaMesh: true, sdp: signal.sdp };

      setIncomingCall({ signal: meshSignal, callerInfo });
      addLog({ type: 'rx', text: `INCOMING CALL FROM @${callerInfo.urn}` });

      // Auto-dismiss after 30 seconds if not answered
      setTimeout(() => {
        setIncomingCall(prev => prev?.signal === meshSignal ? null : prev);
      }, 30000);
    });

    // Buffer ICE candidates that arrive before ActiveCall mounts.
    // During auto-accept transitions, the caller sends ICE candidates
    // but ActiveCall hasn't registered its onIce handler yet.
    phone.setOnIce(({ from, candidate }) => {
      if (candidate) {
        pendingIceCandidatesRef.current.push({ from, candidate });
      }
    });

    phone.connect();
    meshPhonePageRef.current = phone;

    return () => { phone.disconnect(); meshPhonePageRef.current = null; };
  }, [powerOn, userAddress, network]);

  // ─── Propagate incoming call to BottomNav green FAB ──────────────
  // Dispatch a custom event so useWalkieMonitor can show the avatar
  useEffect(() => {
    if (incomingCall?.callerInfo) {
      const detail = {
        from: incomingCall.callerInfo.address,
        urn: incomingCall.callerInfo.urn,
        image: incomingCall.callerInfo.image,
        video: incomingCall.signal?.video || false,
      };
      window.dispatchEvent(new CustomEvent('walkie-incoming-call', { detail }));
    } else {
      window.dispatchEvent(new CustomEvent('walkie-incoming-call', { detail: null }));
    }
  }, [incomingCall]);


  // ─── Push-to-Talk ──────────────────────────────────────────────────

  const pttRef = useRef(null);
  const transmittingRef = useRef(false);

  const startTransmit = useCallback(async (e) => {
    if (!wif || !powerOn) return;
    // Capture pointer so pointerup fires on this element even if finger slides off
    if (e?.pointerId !== undefined && pttRef.current) {
      try { pttRef.current.setPointerCapture(e.pointerId); } catch {}
    }
    sfxRef.current.init();
    try {
      const recorder = createRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      transmittingRef.current = true;
      setIsTransmitting(true);
      setStatus('ON AIR');
      sfxRef.current.playClick();
      addLog({ type: 'tx', text: 'RECORDING...' });
    } catch (err) {
      addLog({ type: 'err', text: `MIC: ${err.message}` });
      setStatus(`MIC ERR: ${err.message}`);
    }
  }, [wif, powerOn, addLog]);

  const stopTransmit = useCallback(async () => {
    if (!recorderRef.current && !transmittingRef.current) return;
    transmittingRef.current = false;
    setIsTransmitting(false);
    sfxRef.current.playKrrrsh();
    setStatus('PROCESSING...');
    addLog({ type: 'sys', text: 'PROCESSING TRANSMISSION...' });
    try {
      const blob = await recorderRef.current?.stop();
      recorderRef.current = null;
      if (!blob || blob.size < 500) {
        addLog({ type: 'sys', text: `TOO SHORT (${blob?.size || 0}B)` });
        setStatus('TOO SHORT');
        return;
      }
      addLog({ type: 'tx', text: `RECORDING ${(blob.size / 1024).toFixed(1)}KB — UPLOADING...` });

      // ─── Public Broadcast ─────────────────────────────────────────
      setStatus('IPFS UPLOAD...');
      const cid = await uploadToIPFS(blob, 'audio.webm');
      addLog({ type: 'tx', text: `IPFS: ${cid.slice(0, 14)}...` });
      setStatus('BROADCASTING...');
      const { addresses } = buildWalkieTransmission(wif, cid, 'audio.webm', network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, channel);
      sfxRef.current.playClick();
      addLog({ type: 'tx', text: `TRANSMITTED ON CH ${channel}` });
      addTransaction(userAddress, { txid: result.txid, type: 'WALKIE', network, addresses, label: `Walkie CH ${channel}` });
      setStatus(`CH ${channel} MONITORING`);
    } catch (err) {
      const msg = err.message?.slice(0, 40) || 'UNKNOWN';
      addLog({ type: 'err', text: msg });
      setStatus(`TX FAIL — RETRY`);
      setTimeout(() => { if (!transmittingRef.current) setStatus(`CH ${channel} MONITORING`); }, 4000);
    }
  }, [wif, network, channel, addLog, userAddress, user]);

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden" style={wallpaperStyle} data-testid="walkie-talkie-page">
      {/* Mobile back header */}
      <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-gray-900/80 flex-shrink-0">
        <button onClick={() => navigate('/feed')} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="walkie-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <span className="text-sm font-medium text-green-500/80 font-mono">WALKIE-TALKIE</span>
      </div>
      <div className="flex-1 flex items-start justify-center p-2 overflow-y-auto">
      <style>{`
        @keyframes glow-pulse { 0%,100% { filter: drop-shadow(0 0 4px #33ff3366); } 50% { filter: drop-shadow(0 0 12px #33ff33aa); } }
        @keyframes scan-sweep { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="relative w-full max-w-sm"
           style={{ background: 'linear-gradient(165deg, #1c1c18 0%, #0f0f0b 40%, #0a0a08 100%)',
                    borderRadius: 16, border: '1px solid #2a2820',
                    boxShadow: '0 0 60px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.03)' }}>

        {/* Antenna */}
        <div className="flex justify-center -mt-3 relative z-20">
          <div className="w-2 h-10 rounded-t-full" style={{ background: 'linear-gradient(to right, #333, #666, #333)' }} />
          <div className="absolute -top-1 w-3 h-3 rounded-full bg-green-500/50"
               style={powerOn ? { animation: 'glow-pulse 2s ease-in-out infinite', background: '#33ff33' } : { background: '#1a1a1a' }} />
        </div>

        {/* Brand plate */}
        <div className="mx-4 mt-1 py-1 px-3 text-center"
             style={{ background: 'linear-gradient(135deg, #1a180e, #24200f)', border: '1px solid #3a3520', borderRadius: 6 }}>
          <div className="text-[10px] tracking-[0.35em] font-mono"
               style={powerOn ? { color: '#33ff33', textShadow: '0 0 8px #33ff3344', animation: 'glow-pulse 3s ease-in-out infinite' } : { color: '#3a3520' }}>
            CTHULHU WASTELAND TERMINAL
          </div>
        </div>

        {/* Boot sequence overlay */}
        {booting && (
          <CRTScreen className="mx-4 mt-3">
            <pre className="p-3 text-[10px] font-mono text-green-500 whitespace-pre-wrap min-h-[180px]"
                 style={{ textShadow: '0 0 4px #33ff3344' }}>
              {bootText}<span className="animate-pulse">_</span>
            </pre>
          </CRTScreen>
        )}

        {/* Inline password prompt (replaces boot screen when wallet is locked) */}
        {showInlineAuth && !booting && (
          <CRTScreen className="mx-4 mt-3">
            <div className="p-3 min-h-[180px]">
              <pre className="text-[10px] font-mono text-green-500 whitespace-pre-wrap mb-3"
                   style={{ textShadow: '0 0 4px #33ff3344' }}>
                {bootText}
              </pre>
              <div className="flex items-center gap-1 font-mono text-[10px]" style={{ color: '#33ff33', textShadow: '0 0 4px #33ff3344' }}>
                <span>PASSWORD:</span>
                <input
                  type="password"
                  value={inlinePassword}
                  onChange={e => { setInlinePassword(e.target.value); setAuthError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleInlineAuth(); }}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none font-mono text-[10px] caret-green-500"
                  style={{ color: '#33ff33', textShadow: '0 0 4px #33ff3344', caretColor: '#33ff33' }}
                  data-testid="walkie-inline-password"
                />
                <span className="animate-pulse">_</span>
              </div>
              {authError && (
                <div className="mt-2 text-[10px] font-mono text-red-500" style={{ textShadow: '0 0 4px #ff000044' }}>
                  {authError}
                </div>
              )}
              <button
                onClick={handleInlineAuth}
                className="mt-3 w-full py-1.5 rounded text-[10px] font-mono tracking-wider transition-all"
                style={{
                  background: '#33ff3310',
                  border: '1px solid #33ff3330',
                  color: '#33ff33',
                  textShadow: '0 0 4px #33ff3344',
                }}
                data-testid="walkie-inline-auth-btn"
              >
                [ AUTHENTICATE ]
              </button>
            </div>
          </CRTScreen>
        )}

        {/* Main UI (hidden during boot or inline auth) */}
        {!booting && !showInlineAuth && (
          <>
            {/* Viewscreen — replaced by ActiveCall when in a call, or Phone Rolodex in phone mode */}
            {activeCall ? (
              <CRTScreen className="mx-4 mt-2">
                <ActiveCall
                  contact={activeCall.contact}
                  wif={wif}
                  userAddress={userAddress}
                  userPKX={userKeys.pkx}
                  userPKY={userKeys.pky}
                  userImage={user?.image}
                  network={network}
                  privateKeyBytes={privateKeyBytes}
                  onEnd={(duration) => {
                    if (callRecordIdRef.current && duration > 0) {
                      updateCallDuration(callRecordIdRef.current, duration);
                    } else if (callRecordIdRef.current && duration === 0) {
                      // Call ended without connecting — mark as failed
                      const records = getCallHistory();
                      const rec = records.find(r => r.id === callRecordIdRef.current);
                      if (rec) { rec.status = 'failed'; localStorage.setItem('cthulhu_call_history', JSON.stringify(records)); }
                    }
                    callRecordIdRef.current = null;
                    setActiveCall(null); setPhoneOpen(false);
                  }}
                  isIncoming={activeCall.isIncoming}
                  incomingSignal={activeCall.incomingSignal}
                  callType={activeCall.callType || 'audio'}
                  pendingIceCandidates={pendingIceCandidatesRef}
                />
              </CRTScreen>
            ) : phoneOpen ? (
              <CRTScreen className="mx-4 mt-2">
                <div className="h-[160px] overflow-y-auto p-2 space-y-0.5" data-testid="phone-rolodex">
                  <div className="text-[9px] font-mono text-green-700/60 uppercase tracking-widest mb-1 px-1">Contacts</div>
                  {allContacts.length === 0 && (
                    <p className="text-[9px] font-mono text-green-800/40 text-center py-4">NO CONTACTS — FOLLOW USERS TO ADD</p>
                  )}
                  {allContacts.map(c => (
                    <div key={c.address} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-green-900/15 transition-colors group"
                      data-testid={`rolodex-contact-${c.urn || c.address?.slice(0, 8)}`}>
                      <div className="w-7 h-7 rounded-full bg-gray-800 overflow-hidden flex-shrink-0 border border-green-900/20">
                        {c.image && <img src={resolveImageUrl(c.image)} alt="" className="w-full h-full object-cover"
                          style={{ filter: 'saturate(0.3) brightness(0.8)' }} onError={e => { e.target.style.display='none'; }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-mono text-green-400 truncate block">{c.urn || c.address?.slice(0, 12)}</span>
                        <span className="text-[7px] font-mono text-green-800/50 truncate block">{c.address?.slice(0, 16)}...</span>
                      </div>
                      <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => {
                          const recId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                          callRecordIdRef.current = recId;
                          addCallRecord({ id: recId, type: 'outgoing', contactUrn: c.urn, contactAddress: c.address, contactImage: c.image, status: 'completed', network });
                          callLog('INFO', `Outgoing AUDIO call to ${c.urn}`, { address: c.address });
                          setActiveCall({ contact: c, isIncoming: false, incomingSignal: null, callType: 'audio' });
                        }}
                          className="p-1.5 rounded bg-green-900/20 border border-green-800/30 text-green-500 hover:bg-green-900/40 hover:text-green-300 transition-colors"
                          title={`Audio call @${c.urn}`}
                          data-testid={`call-audio-${c.urn || c.address?.slice(0, 8)}`}>
                          <FiPhone size={11} />
                        </button>
                        <button onClick={() => {
                          const recId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                          callRecordIdRef.current = recId;
                          addCallRecord({ id: recId, type: 'outgoing', contactUrn: c.urn, contactAddress: c.address, contactImage: c.image, status: 'completed', network });
                          callLog('INFO', `Outgoing VIDEO call to ${c.urn}`, { address: c.address });
                          setActiveCall({ contact: c, isIncoming: false, incomingSignal: null, callType: 'video' });
                        }}
                          className="p-1.5 rounded bg-green-900/20 border border-green-800/30 text-green-500 hover:bg-green-900/40 hover:text-green-300 transition-colors"
                          title={`Video call @${c.urn}`}
                          data-testid={`call-video-${c.urn || c.address?.slice(0, 8)}`}>
                          <FiVideo size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CRTScreen>
            ) : (
              powerOn && <Viewscreen network={network}
              messageLog={messageLog}
              playingId={playingId}
              onPlayMessage={playMessage}
              onStopPlayback={stopPlayback}
              onDeleteMessage={deleteMessage}
              onAction={(action, item) => {
              if (action === 'vault') {
                toast('Saved to Vault! (requires funded wallet)', { description: item.name });
              } else if (action === 'forward') {
                navigate('/dm');
                toast('Navigate to DM to forward', { description: item.name });
              }
            }} />
            )}

            {/* Radio display */}
            <CRTScreen className="mx-4 mt-2">
              <div className="p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-lg tabular-nums"
                        style={{ color: '#33ff33', textShadow: '0 0 8px #33ff3344' }}>
                    CH {channel}
                  </span>
                  <div className="flex items-center gap-2">
                    {isTransmitting && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded animate-pulse"
                            style={{ background: '#ff000022', color: '#ff4444', border: '1px solid #ff000033' }}>
                        ON AIR
                      </span>
                    )}
                    {scanning && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: '#33ff3311', color: '#33ff33', border: '1px solid #33ff3322', animation: 'scan-sweep 0.5s ease-in-out infinite' }}>
                        SCAN
                      </span>
                    )}
                    <div className={`w-1.5 h-1.5 rounded-full ${powerOn ? 'bg-green-500' : 'bg-gray-800'}`}
                         style={powerOn ? { boxShadow: '0 0 6px #33ff33' } : {}} />
                  </div>
                </div>
                <div className="text-[9px] font-mono truncate" style={{ color: '#33ff3388' }}>{status}</div>
              </div>
            </CRTScreen>

            {/* Speaker + Log */}
            <div className="mx-4 mt-2 flex gap-2">
              {/* Speaker grille */}
              <div className="rounded-lg flex-shrink-0 p-2 grid grid-cols-5 gap-1"
                   style={{ background: '#080808', border: '1px solid #1a1a18' }}>
                {[...Array(25)].map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full" style={{ background: '#1a1a18', border: '1px solid #22221e' }} />
                ))}
              </div>
              {/* TX Log */}
              <CRTScreen className="flex-1 max-h-28 overflow-y-auto scrollbar-hide relative">
                <div className="p-1.5" data-testid="transmission-log">
                  {transmissions.length === 0 ? (
                    <div className="text-[9px] text-green-900/60 font-mono text-center py-4">
                      {powerOn ? 'AWAITING SIGNAL...' : 'POWER OFF'}
                    </div>
                  ) : transmissions.map(t => (
                    <div key={t.id} className="text-[9px] font-mono mb-0.5 flex gap-1">
                      <span className="text-green-800/50 flex-shrink-0">{t.ts}</span>
                      <span className={
                        t.type === 'rx' ? 'text-cyan-500' :
                        t.type === 'tx' ? 'text-amber-400' :
                        t.type === 'err' ? 'text-red-500' :
                        t.type === 'play' ? 'text-green-400' :
                        'text-green-600/60'
                      }>{t.from ? `[${t.from}] ` : ''}{t.text}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </CRTScreen>
            </div>

            {/* Controls row */}
            <div className="flex items-center justify-around mx-4 mt-2 py-0.5">
              {/* Power button */}
              <button onClick={togglePower}
                className={`px-3 py-1.5 rounded font-mono text-[10px] tracking-widest border transition-all ${
                  powerOn ? 'bg-green-900/30 border-green-600/30 text-green-400' : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                }`} data-testid="power-btn">
                {powerOn ? 'PWR ON' : 'PWR OFF'}
              </button>

              {/* Phone button — toggles viewscreen to phone rolodex mode */}
              <button onClick={() => { if (powerOn && wif) setPhoneOpen(p => !p); }}
                className={`px-3 py-1.5 rounded font-mono text-[10px] tracking-widest border transition-all ${
                  !powerOn || !wif ? 'bg-gray-900 border-gray-800 text-gray-700 cursor-not-allowed'
                  : phoneOpen ? 'bg-green-900/30 border-green-600/40 text-green-400'
                  : 'bg-gray-900 border-green-900/30 text-green-500/80 hover:text-green-400 hover:border-green-600/30 hover:bg-green-950/30'
                }`}
                disabled={!powerOn || !wif}
                data-testid="phone-btn">
                <FiPhone size={12} className="inline mr-1" /> {phoneOpen ? 'RADIO' : 'PHONE'}
              </button>

              {/* Scan button */}
              <button onClick={powerOn ? toggleScan : undefined}
                className={`px-3 py-1.5 rounded font-mono text-[10px] tracking-widest border transition-all ${
                  !powerOn ? 'bg-gray-900 border-gray-800 text-gray-700 cursor-not-allowed'
                  : scanning ? 'bg-amber-900/30 border-amber-600/30 text-amber-400 animate-pulse'
                  : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700'
                }`} data-testid="scan-btn"
                disabled={!powerOn}>
                {scanning ? 'STOP' : 'SCAN'}
              </button>
            </div>

            {/* Knobs */}
            <div className="flex justify-around mx-4 mt-1">
              <RotaryKnob label="VOL" value={volume} onChange={setVolume} min={0} max={100} disabled={!powerOn} displayValue={`${volume}%`} />
              <RotaryKnob label="CHANNEL" value={channel} onChange={v => setChannel(Math.round(v))} min={546} max={646} step={1} disabled={!powerOn || scanning} />
            </div>

            {/* PTT Button */}
            <div className="mx-4 mt-2 mb-3">
              <button
                ref={pttRef}
                className={`w-full py-3 rounded-lg font-mono text-xs tracking-[0.25em] uppercase transition-all select-none touch-none border ${
                  !powerOn || !wif
                    ? 'bg-gray-900 border-gray-800 text-gray-700 cursor-not-allowed'
                    : isTransmitting
                    ? 'bg-red-900/40 border-red-600/40 text-red-400 shadow-red-900/30 shadow-lg'
                    : 'bg-gray-900 border-green-900/30 text-green-500/80 hover:bg-green-950/30 hover:border-green-600/30 active:bg-red-900/40 active:text-red-400'
                }`}
                style={isTransmitting ? { boxShadow: '0 0 20px rgba(255,50,50,0.15)' } : {}}
                onPointerDown={startTransmit}
                onPointerUp={stopTransmit}
                onPointerCancel={stopTransmit}
                disabled={!powerOn || !wif}
                data-testid="ptt-button">
                {isTransmitting ? '/// ON AIR ///'
                  : 'PUSH TO TALK'}
              </button>
              {!wif && powerOn && (
                <p className="text-[9px] text-amber-600/60 text-center mt-1 font-mono">WALLET REQUIRED FOR TX</p>
              )}
            </div>
          </>
        )}
      </div>
      </div>

      {/* Incoming Call Alert */}
      {incomingCall && !activeCall && (
        <IncomingCallAlert
          caller={incomingCall.callerInfo}
          signal={incomingCall.signal}
          onAccept={() => {
            const contact = incomingCall.callerInfo;
            const signal = incomingCall.signal;
            callLog('INFO', `Call ACCEPTED from ${contact.urn}`, { address: contact.address, hasSDPOffer: !!signal.sdpOffer, hasMeshOffer: !!signal.meshOffer });
            const recId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            callRecordIdRef.current = recId;
            addCallRecord({ id: recId, type: 'incoming', contactUrn: contact.urn, contactAddress: contact.address, contactImage: contact.image, status: 'completed', network });
            setIncomingCall(null);
            setActiveCall({ contact, isIncoming: true, incomingSignal: signal });
          }}
          onDecline={() => {
            callLog('INFO', `Call DECLINED from ${incomingCall.callerInfo.urn}`);
            addCallRecord({ type: 'incoming', contactUrn: incomingCall.callerInfo.urn, contactAddress: incomingCall.callerInfo.address, contactImage: incomingCall.callerInfo.image, status: 'declined', network });
            addLog({ type: 'sys', text: `DECLINED CALL FROM @${incomingCall.callerInfo.urn}` });
            setIncomingCall(null);
          }}
          onMissed={() => {
            callLog('WARN', `MISSED CALL from ${incomingCall.callerInfo.urn} (auto-decline timeout)`);
            addCallRecord({ type: 'missed', contactUrn: incomingCall.callerInfo.urn, contactAddress: incomingCall.callerInfo.address, contactImage: incomingCall.callerInfo.image, status: 'no_answer', network });
            addLog({ type: 'sys', text: `MISSED CALL FROM @${incomingCall.callerInfo.urn}` });
            setIncomingCall(null);
          }}
        />
      )}
    </div>
  );
}
