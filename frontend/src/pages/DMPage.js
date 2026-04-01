/**
 * DMPage — Encrypted PM (E2E encrypted private messages).
 * Wallet unlock required to view/send.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useBlockList } from '@/hooks/useBlockList';
import { useTheme } from '@/hooks/useTheme';
import { useMyKeys } from '@/hooks/useMyKeys';
import { FiLock, FiSend, FiArrowLeft, FiMoreVertical, FiUser, FiClock, FiTrash2, FiCheck, FiShield, FiSlash, FiPlay, FiRadio, FiMic, FiPhone, FiPause, FiUploadCloud } from 'react-icons/fi';
import axios from 'axios';
import { ProfileThumb } from '@/components/ProfileThumb';
import ComposeToolbar from '@/components/ComposeToolbar';
import { ActivateMessaging } from '@/components/ActivateMessaging';
import { eciesDecrypt, unwrapSEC } from '@/utils/ecies';
import { buildPrivateMessageTransaction, stripSigPrefix } from '@/utils/p2fk';
import { decryptIPFSAudio } from '@/utils/walkieTalkie';
import { buildAndBroadcast } from '@/utils/txBuilder';
import { setLastSeen } from '@/utils/dmDb';
import { useOffchainDM } from '@/hooks/useOffchainDM';
import {
  saveSentMessage, getSentMessages, clearSentMessages,
  getSelfDestructTimer, setSelfDestructTimer as setTimerDB, pruneExpiredMessages,
  SELF_DESTRUCT_OPTIONS,
  getCachedDecryptBatch, cacheDecryptResult,
  getConversationCache, saveConversationCache,
  clearConversationCache, clearDecryptCacheForConversation,
  getClearedBefore, setClearedBefore,
} from '@/utils/dmDb';
import { ECPairFactory } from 'ecpair';
import { ecc } from '@/utils/ecc';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const ECPair = ECPairFactory(ecc);

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function InlineUnlock({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { unlockWallet } = useAuth();

  const handleUnlock = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await unlockWallet(password);
      onUnlock();
    } catch (err) {
      setError(err.message || 'Wrong password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleUnlock} className="flex items-center gap-2 w-full" data-testid="inline-unlock">
      <FiLock size={16} className="text-red-400 flex-shrink-0" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter wallet password to unlock"
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-500/50"
        data-testid="inline-unlock-input"
        autoFocus
      />
      <button
        type="submit"
        disabled={loading || !password}
        className="px-4 py-2 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
        data-testid="inline-unlock-btn"
      >
        {loading ? '...' : 'Unlock'}
      </button>
      {error && <span className="text-xs text-red-400 flex-shrink-0">{error}</span>}
    </form>
  );
}

function WalkieAudioBubble({ ipfsRef, onPlay }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const handlePlay = async () => {
    if (playing) return;
    setPlaying(true);
    setError(null);
    try {
      await onPlay(ipfsRef);
    } catch (err) {
      setError(err.message || 'Playback failed');
    } finally {
      setPlaying(false);
    }
  };
  return (
    <button
      onClick={handlePlay}
      disabled={playing}
      className="flex items-center gap-2 text-left w-full group"
      data-testid="walkie-audio-play"
    >
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${playing ? 'bg-red-600 animate-pulse' : 'bg-red-800/60 group-hover:bg-red-700'} transition`}>
        {playing ? <FiRadio size={14} className="text-white" /> : <FiPlay size={14} className="text-white ml-0.5" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-red-300">{playing ? 'Decrypting...' : 'Encrypted Audio'}</p>
        <p className="text-[10px] text-gray-500">Tap to decrypt & play</p>
        {error && <p className="text-[10px] text-red-400 break-all">{error}</p>}
      </div>
    </button>
  );
}


function VoicemailCard({ ipfsRef, isMine, partnerUrn, onCallback }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);
  const intervalRef = useRef(null);

  const resolveUrl = (ref) => {
    if (!ref) return null;
    if (ref.startsWith('http')) return ref;
    if (ref.startsWith('IPFS:')) {
      const cid = ref.slice(5).split('/')[0];
      return `https://ipfs.io/ipfs/${cid}`;
    }
    if (/^Qm|^bafy/.test(ref)) return `https://ipfs.io/ipfs/${ref}`;
    return null;
  };

  const toggle = async () => {
    if (!audioRef.current) {
      const url = resolveUrl(ipfsRef);
      if (!url) return;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onloadedmetadata = () => setDuration(Math.round(audio.duration));
      audio.onended = () => { setPlaying(false); setProgress(0); clearInterval(intervalRef.current); };
    }
    if (playing) {
      audioRef.current.pause();
      clearInterval(intervalRef.current);
      setPlaying(false);
    } else {
      await audioRef.current.play();
      setPlaying(true);
      intervalRef.current = setInterval(() => {
        if (audioRef.current) setProgress(Math.round(audioRef.current.currentTime));
      }, 200);
    }
  };

  useEffect(() => () => { clearInterval(intervalRef.current); if (audioRef.current) audioRef.current.pause(); }, []);

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div data-testid="voicemail-card">
      <div className="flex items-center gap-2 mb-1.5">
        <FiMic size={12} className="text-amber-400" />
        <span className="text-[11px] font-medium text-amber-400">
          {isMine ? `Voicemail to ${partnerUrn || 'contact'}` : `Voicemail from ${partnerUrn || 'caller'}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={toggle}
          className="w-8 h-8 rounded-full bg-amber-700/30 border border-amber-600/40 flex items-center justify-center hover:bg-amber-700/50 transition-all flex-shrink-0"
          data-testid="voicemail-play-btn">
          {playing ? <FiPause size={14} className="text-amber-300" /> : <FiPlay size={14} className="text-amber-300 ml-0.5" />}
        </button>
        <div className="flex-1">
          <div className="h-1 bg-amber-900/30 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500/60 rounded-full transition-all"
              style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : '0%' }} />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-amber-600/60 tabular-nums">{fmtTime(progress)}</span>
            <span className="text-[9px] text-amber-600/60 tabular-nums">{duration > 0 ? fmtTime(duration) : '--:--'}</span>
          </div>
        </div>
      </div>
      {/* Callback button — only for received voicemails */}
      {!isMine && onCallback && (
        <button onClick={onCallback}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-700/30 bg-green-950/20 text-green-400 text-[10px] font-medium hover:bg-green-900/30 transition-all w-full justify-center"
          data-testid="voicemail-callback-btn">
          <FiPhone size={11} /> CALL BACK
        </button>
      )}
    </div>
  );
}



function ChatBubble({ message, isMine, showDate, dateLabel, isEncrypted, onPlayWalkie, onCallback, partnerUrn }) {
  const isVoicemail = message.text?.startsWith('[VM]');
  const vmIpfsRef = isVoicemail ? message.text.replace('[VM]', '').trim() : null;

  return (
    <>
      {showDate && (
        <div className="flex justify-center my-3">
          <span className="bg-gray-800/80 text-gray-500 text-[10px] px-3 py-1 rounded-full">{dateLabel}</span>
        </div>
      )}
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1.5`} data-testid="chat-bubble">
        <div
          className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${
            isVoicemail
              ? 'bg-amber-950/40 text-gray-200 border border-amber-700/30 rounded-br-sm'
            : isMine
              ? isEncrypted ? 'bg-red-900/40 text-gray-200 rounded-br-sm border border-red-800/30' : 'text-gray-200 rounded-br-sm'
              : isEncrypted ? 'bg-gray-800/80 text-gray-300 rounded-bl-sm border border-red-800/20' : 'bg-gray-800/80 text-gray-300 rounded-bl-sm'
          }`}
          style={isMine && !isEncrypted && !isVoicemail ? { backgroundColor: 'rgba(var(--c-accent-rgb), 0.25)' } : {}}
        >
          {message.decryptError ? (
            message.isMine ? (
              <p className="text-gray-500 italic text-xs">
                Sent (encrypted for recipient)
                {message._dupeCount > 1 && (
                  <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-gray-700/60 text-[9px] text-gray-400 font-medium not-italic">
                    x{message._dupeCount}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-red-400 italic text-xs">{message.decryptError}</p>
            )
          ) : isVoicemail ? (
            <VoicemailCard
              ipfsRef={vmIpfsRef}
              isMine={isMine}
              partnerUrn={partnerUrn}
              onCallback={onCallback}
            />
          ) : message.walkieIpfsRef ? (
            <WalkieAudioBubble ipfsRef={message.walkieIpfsRef} onPlay={onPlayWalkie} />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          )}
          <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
            {isVoicemail && <FiMic size={8} className="text-amber-500/60" />}
            {message._source && message._source !== 'onchain' && !isVoicemail && (
              <span className="text-[9px] text-green-500/60" title="Off-chain (P2P)">P2P</span>
            )}
            {isEncrypted && !isVoicemail && !message._source && <FiLock size={8} className="text-red-500/60" />}
            <span className="text-[10px] text-gray-500">{formatTime(message.timestamp)}</span>
            {isMine && message.pending && <FiClock size={10} className="text-yellow-600" />}
            {isMine && message.confirmed && !message.pending && <FiCheck size={10} className="text-emerald-500" />}
          </div>
        </div>
      </div>
    </>
  );
}

export default function DMPage({ network }) {
  const { address: partnerAddr } = useParams();
  const navigate = useNavigate();
  const { user, wif, isWalletUnlocked, isConnected } = useAuth();
  const { blockUser } = useBlockList(network);
  const { wallpaperStyle } = useTheme();

  const [partnerProfile, setPartnerProfile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadMoreSkip, setLoadMoreSkip] = useState(0);
  const [composing, setComposing] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [timerMenuOpen, setTimerMenuOpen] = useState(false);
  const [selfDestructMs, setSelfDestructMs] = useState(0);
  const [walletUnlocked, setWalletUnlocked] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const messagesEndRef = useRef(null);
  const dmToolbarRef = useRef(null);
  const sendLockRef = useRef(false);
  const cachedTimestampRef = useRef(null);
  const hasCacheRef = useRef(false);
  const selfDestructRef = useRef(0);
  const fetchIdRef = useRef(0); // abort guard for stale async ops

  const myAddress = user?.address;
  const hasEncryptionKeys = partnerProfile?.pkx && partnerProfile?.pky;
  const { hasKeys: myKeysPublished, loading: myKeysLoading, refresh: refreshMyKeys } = useMyKeys(myAddress, network);

  // Derive private key bytes for decryption when wallet is unlocked
  const [privKeyBytes, setPrivKeyBytes] = useState(null);
  useEffect(() => {
    if (wif && network) {
      try {
        const isTestnet = network.includes('testnet');
        const networkObj = isTestnet
          ? { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'tb', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef }
          : { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'bc', bip32: { public: 0x0488b21e, private: 0x0488ade4 }, pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
        const keyPair = ECPair.fromWIF(wif, networkObj);
        setPrivKeyBytes(keyPair.privateKey);
      } catch { setPrivKeyBytes(null); }
    } else {
      setPrivKeyBytes(null);
    }
  }, [wif, network]);

  // Off-chain DM (P2P mesh + WebSocket relay)
  const {
    offchainMessages, sendMessage: sendOffchainDM, triggerCheckpoint,
    isCheckpointing, checkpointHint, cacheStats,
  } = useOffchainDM(partnerAddr, myAddress, user?.urn, partnerProfile, privKeyBytes, network);
  const [dmComposeMode, setDmComposeMode] = useState('offchain');
  const [offchainText, setOffchainText] = useState('');

  // Play encrypted walkie audio from a DM
  const handlePlayWalkieAudio = useCallback(async (ipfsRef) => {
    if (!wif) throw new Error('Wallet locked');
    const isTestnet = network.includes('testnet');
    const networkObj = isTestnet
      ? { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'tb', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef }
      : { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'bc', bip32: { public: 0x0488b21e, private: 0x0488ade4 }, pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
    const keyPair = ECPair.fromWIF(wif, networkObj);
    const blobUrl = await decryptIPFSAudio(ipfsRef, keyPair.privateKey);
    const audio = new Audio(blobUrl);
    await audio.play();
  }, [wif, network]);

  useEffect(() => {
    if (isWalletUnlocked) setWalletUnlocked(true);
  }, [isWalletUnlocked]);

  // Mark conversation as read when entering
  useEffect(() => {
    if (partnerAddr && myAddress) {
      setLastSeen(myAddress, partnerAddr, network);
      setLastSeen(myAddress, `dm_${partnerAddr}`, network);
      // Notify the notification hook immediately
      window.dispatchEvent(new CustomEvent('dm-read', { detail: { address: partnerAddr } }));
    }
  }, [partnerAddr, myAddress, network]);

  // Load self-destruct timer
  useEffect(() => {
    if (!myAddress || !partnerAddr) return;
    getSelfDestructTimer(myAddress, partnerAddr, network).then(v => {
      setSelfDestructMs(v);
      selfDestructRef.current = v;
    });
  }, [myAddress, partnerAddr, network]);

  // Fetch partner profile
  useEffect(() => {
    if (!partnerAddr) return;
    axios.get(`${API}/profile/${partnerAddr}`, { params: { network } })
      .then(res => setPartnerProfile(res.data))
      .catch(() => {});
  }, [partnerAddr, network]);

  // ---- Helper: decrypt a list of raw backend messages ----
  const decryptRawMessages = useCallback(async (incoming, privKeyBytes) => {
    const allTxids = incoming.map(m => m.txid).filter(Boolean);
    const cache = await getCachedDecryptBatch(allTxids, myAddress);

    const decryptedIncoming = [];
    const uncachedMsgs = [];

    for (const msg of incoming) {
      const cached = cache[msg.txid];
      if (cached) {
        // Skip cached phone signaling messages
        if (cached.text && (cached.text.startsWith('RING:') || cached.text.startsWith('ANSW:'))) {
          continue;
        }
        if (!cached.walkieIpfsRef && cached.text && /IPFS:.*[\/\\]SEC/.test(cached.text)) {
          uncachedMsgs.push(msg);
          continue;
        }
        const backendSaysImSender = msg.sender_address === myAddress;
        const isMine = backendSaysImSender;
        const from = isMine ? myAddress : partnerAddr;
        decryptedIncoming.push({
          id: msg.txid, text: cached.text,
          timestamp: msg.first_seen || msg.block_date,
          from, isMine,
          decryptError: isMine && !cached.text ? 'Unable to decrypt' : null,
          walkieIpfsRef: cached.walkieIpfsRef || null,
        });
      } else {
        uncachedMsgs.push(msg);
      }
    }

    const fetchSEC = async (msg) => {
      let encBytes = null;
      const mainnetParam = network.includes('mainnet') ? 'true' : 'false';
      if (msg.txid) {
        try {
          const bfResp = await fetch(`https://bitfossil.com/${msg.txid}/SEC`, { signal: AbortSignal.timeout(6000) });
          if (bfResp.ok) {
            const buf = new Uint8Array(await bfResp.arrayBuffer());
            if (buf.length > 10 && (buf[0] === 0x04 || buf[0] === 0x53)) encBytes = buf;
          }
        } catch { /* bitfossil unavailable */ }
      }
      if (!encBytes && msg.txid) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const backendResp = await fetch(
              `${API}/onchain/file/${msg.txid}/SEC?chain=BTC&mainnet=${mainnetParam}`,
              { signal: AbortSignal.timeout(10000) }
            );
            if (backendResp.status === 202 && attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
            if (backendResp.ok) {
              const buf = new Uint8Array(await backendResp.arrayBuffer());
              if (buf.length > 10 && (buf[0] === 0x04 || buf[0] === 0x53)) encBytes = buf;
            }
            break;
          } catch { break; }
        }
      }
      if (!encBytes && msg.encrypted_data) {
        try { encBytes = Uint8Array.from(atob(msg.encrypted_data), c => c.charCodeAt(0)); } catch {}
      }
      return { msg, encBytes };
    };

    const BATCH_SIZE = 5;
    for (let i = 0; i < uncachedMsgs.length; i += BATCH_SIZE) {
      const batch = uncachedMsgs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(fetchSEC));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { msg, encBytes } = result.value;
        if (!encBytes) {
          const backendSaysImSender = msg.sender_address === myAddress;
          decryptedIncoming.push({
            id: msg.txid, text: '', timestamp: msg.first_seen || msg.block_date,
            from: backendSaysImSender ? myAddress : partnerAddr,
            isMine: backendSaysImSender,
            decryptError: backendSaysImSender ? 'Sent (encrypted for recipient)' : 'Encrypted data still resolving',
            walkieIpfsRef: null,
          });
          continue;
        }
        try {
          let secData;
          if (encBytes[0] === 0x53 && encBytes[1] === 0x45 && encBytes[2] === 0x43) {
            secData = unwrapSEC(encBytes);
          } else {
            secData = encBytes;
          }
          const plainBytes = await eciesDecrypt(privKeyBytes, secData);
          const msgBytes = stripSigPrefix(plainBytes);
          const rawText = new TextDecoder().decode(msgBytes);

          // Filter out phone call signaling messages (RING/ANSW contain SDP data)
          if (rawText.startsWith('RING:') || rawText.startsWith('ANSW:')) {
            continue;
          }

          const ipfsMatch = rawText.match(/<<IPFS:([^>]+[\/\\]SEC)>>/) || rawText.match(/<?<?IPFS:([^>\s]+[\/\\]SEC)>>/);
          const walkieIpfsRef = ipfsMatch ? ipfsMatch[1] : null;
          const text = rawText.replace(/<?<?IPFS:[^>]+[\/\\]SEC>>/g, '').replace(/<<[^>]*>>/g, '').trim();
          const backendSaysImSender = msg.sender_address === myAddress;
          const isMine = backendSaysImSender;
          const from = isMine ? myAddress : partnerAddr;
          decryptedIncoming.push({ id: msg.txid, text, timestamp: msg.first_seen || msg.block_date, from, isMine, walkieIpfsRef });
          cacheDecryptResult(msg.txid, myAddress, { direction: isMine ? 'outbound' : 'inbound', text, sender: from, walkieIpfsRef });
        } catch {
          decryptedIncoming.push({ id: msg.txid, text: '', timestamp: msg.first_seen || msg.block_date, from: myAddress, isMine: true, decryptError: 'Unable to decrypt' });
          cacheDecryptResult(msg.txid, myAddress, { direction: 'outbound', text: '', sender: myAddress });
        }
      }
    }

    return decryptedIncoming;
  }, [myAddress, partnerAddr, network]);

  // ---- Helper: merge decrypted messages with local sent messages, dedup, sort, collapse ----
  const mergeAndFinalize = useCallback(async (decryptedIncoming) => {
    let sentMsgs = [];
    let localByTxid = {};
    try {
      const sentLocal = await getSentMessages(myAddress, partnerAddr, network);
      for (const m of sentLocal) {
        if (m.txid) localByTxid[m.txid] = m.text;
      }
      const apiTxids = new Set(decryptedIncoming.map(m => m.id));
      sentMsgs = sentLocal
        .filter(m => !apiTxids.has(m.txid) && !apiTxids.has(`local-${m.id}`))
        .map(m => ({ id: m.txid || `local-${m.id}`, text: m.text, timestamp: m.timestamp, from: myAddress, isMine: true }));
    } catch {}

    for (const msg of decryptedIncoming) {
      if (msg.isMine && msg.decryptError && localByTxid[msg.id]) {
        msg.text = localByTxid[msg.id];
        msg.decryptError = null;
        msg.sentLocally = true;
        cacheDecryptResult(msg.id, myAddress, { direction: 'outbound', text: localByTxid[msg.id], sender: myAddress });
      }
    }

    const merged = [...decryptedIncoming, ...sentMsgs];
    const seenIds = new Set();
    const all = merged.filter(m => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const collapsed = [];
    for (const msg of all) {
      const prev = collapsed[collapsed.length - 1];
      if (
        prev && prev.isMine && msg.isMine &&
        prev.decryptError && msg.decryptError &&
        !prev.text && !msg.text &&
        prev.timestamp && msg.timestamp &&
        prev.timestamp.slice(0, 16) === msg.timestamp.slice(0, 16)
      ) {
        prev._dupeCount = (prev._dupeCount || 1) + 1;
        prev._dupeIds = prev._dupeIds || [prev.id];
        prev._dupeIds.push(msg.id);
      } else {
        collapsed.push({ ...msg });
      }
    }
    return collapsed;
  }, [myAddress, partnerAddr, network]);

  // ---- ENCRYPTED MESSAGE LOADING (paginated, 20 at a time) ----
  const DM_PAGE_SIZE = 20;

  const fetchEncryptedMessages = useCallback(async (skipCount = 0, append = false) => {
    if (!myAddress || !wif || !partnerAddr) return;
    const thisId = ++fetchIdRef.current; // abort guard
    setFetchError(null);

    const isTestnet = network.includes('testnet');
    const networkObj = isTestnet
      ? { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'tb', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef }
      : { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'bc', bip32: { public: 0x0488b21e, private: 0x0488ade4 }, pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
    const keyPair = ECPair.fromWIF(wif, networkObj);
    const privKeyBytes = keyPair.privateKey;

    // Phase 1: show cache instantly (only on initial load)
    if (!append) {
      try {
        const cached = await getConversationCache(myAddress, partnerAddr, network);
        if (thisId !== fetchIdRef.current) return;
        if (cached && cached.messages && cached.messages.length > 0) {
          setMessages(cached.messages);
          setLoading(false);
          hasCacheRef.current = true;
          cachedTimestampRef.current = cached.lastFetchTimestamp || null;
        }
      } catch { /* cache miss is fine */ }
    }

    if (thisId !== fetchIdRef.current) return;
    if (!append && !hasCacheRef.current) setLoading(true);
    if (append) setLoadingMore(true);
    setBackgroundLoading(true);

    try {
      const sdMs = selfDestructRef.current;
      if (sdMs > 0) {
        try { await pruneExpiredMessages(myAddress, partnerAddr, network, sdMs); } catch {}
      }
      if (thisId !== fetchIdRef.current) return;

      const localClearedBefore = await getClearedBefore(myAddress, partnerAddr, network);

      // Build query params with pagination
      const params = {
        network,
        partner: partnerAddr,
        limit: DM_PAGE_SIZE,
        skip: skipCount,
      };
      if (!append && cachedTimestampRef.current) {
        params.since = cachedTimestampRef.current;
      }

      const inRes = await axios.get(`${API}/dm/messages/${myAddress}`, { params });
      if (thisId !== fetchIdRef.current) return;
      const incoming = inRes.data.messages || [];
      const serverTimestamp = inRes.data.server_timestamp;
      const serverHasMore = inRes.data.has_more || false;

      if (!append && cachedTimestampRef.current && incoming.length === 0) {
        setHasMore(serverHasMore);
        setLoading(false);
        setBackgroundLoading(false);
        return;
      }

      // Decrypt the fetched messages
      let newDecrypted = await decryptRawMessages(incoming, privKeyBytes);
      if (thisId !== fetchIdRef.current) return;

      // Apply client-side clearedBefore filter
      if (localClearedBefore) {
        newDecrypted = newDecrypted.filter(m => !m.timestamp || m.timestamp > localClearedBefore);
      }

      if (append) {
        // "Load more" — prepend older messages
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const onlyNew = newDecrypted.filter(m => !existingIds.has(m.id));
          if (onlyNew.length === 0) return prev;
          return [...onlyNew, ...prev].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        });
      } else if (cachedTimestampRef.current) {
        // Incremental: merge new messages into existing state
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const onlyNew = newDecrypted.filter(m => !existingIds.has(m.id));
          if (onlyNew.length === 0) return prev;
          const merged = [...prev, ...onlyNew].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          saveConversationCache(myAddress, partnerAddr, network, merged, serverTimestamp);
          return merged;
        });
      } else {
        // Full initial fetch: merge with local sent messages and finalize
        const finalized = await mergeAndFinalize(newDecrypted);
        if (thisId !== fetchIdRef.current) return;
        setMessages(finalized);
        saveConversationCache(myAddress, partnerAddr, network, finalized, serverTimestamp);
      }

      setHasMore(serverHasMore);
      setLoadMoreSkip(skipCount + DM_PAGE_SIZE);
      cachedTimestampRef.current = serverTimestamp;
    } catch (err) {
      if (thisId !== fetchIdRef.current) return;
      console.error('Encrypted fetch error:', err);
      setFetchError(err.message || 'Failed to load encrypted messages');
    } finally {
      if (thisId === fetchIdRef.current) {
        setLoading(false);
        setBackgroundLoading(false);
        setLoadingMore(false);
      }
    }
  }, [myAddress, wif, partnerAddr, network, decryptRawMessages, mergeAndFinalize]);

  // Store the latest fetch function in a ref to avoid effect re-triggering
  const fetchRef = useRef(fetchEncryptedMessages);
  fetchRef.current = fetchEncryptedMessages;

  // Fetch encrypted messages when wallet is unlocked
  const pollRef = useRef(null);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    cachedTimestampRef.current = null; // Reset cache pointer on conversation change
    hasCacheRef.current = false;

    if (walletUnlocked && wif) {
      setLoading(true);
      setMessages([]);
      setHasMore(false);
      setLoadMoreSkip(0);
      fetchRef.current(0, false); // Initial fetch, skip=0, append=false
      if (myAddress && partnerAddr) setLastSeen(myAddress, partnerAddr, network);
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletUnlocked, wif, myAddress, partnerAddr, network]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---- SEND Encrypted PM ----
  const handleSend = async () => {
    if (sendLockRef.current) return;
    if (!composing.trim() || !wif || !partnerProfile?.pkx || !partnerProfile?.pky) return;
    sendLockRef.current = true;
    setSending(true);
    try {
      const text = composing.trim();
      await saveSentMessage(myAddress, partnerAddr, network, text);
      setComposing('');
      setMessages(prev => [...prev, { id: `pending-${Date.now()}`, text, timestamp: new Date().toISOString(), from: myAddress, isMine: true, pending: true }]);
      const { addresses, taxInsertIndex } = await buildPrivateMessageTransaction(wif, text, partnerAddr, partnerProfile.pkx, partnerProfile.pky, network);
      const result = await buildAndBroadcast(wif, addresses, network, [], 0, 546, [], taxInsertIndex);
      setMessages(prev => prev.map(m => m.pending ? { ...m, pending: false, id: result.txid || m.id } : m));
      dmToolbarRef.current?.clearAll();
    } catch (err) {
      setMessages(prev => prev.map(m => m.pending ? { ...m, decryptError: `Send failed: ${err.message}` } : m));
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  // Not logged in
  if (!isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <FiShield size={40} className="mx-auto mb-3 text-gray-700" />
          <p className="text-sm">Sign in to access encrypted messages</p>
        </div>
      </div>
    );
  }

  // Encrypted PM: need wallet unlock
  const needsUnlock = !walletUnlocked || !wif;

  // Date grouping
  let lastDate = '';

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="dm-page">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/50 bg-gray-900/50 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="dm-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <button onClick={() => navigate(`/profile/${partnerAddr}`)} className="flex items-center gap-3 flex-1 min-w-0">
          <ProfileThumb
            name={partnerProfile?.urn || partnerProfile?.display_name || partnerAddr}
            image={partnerProfile?.image}
            size="dm-header"
          />
          <div className="text-left min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-200 truncate" data-testid="dm-partner-name">
                {partnerProfile?.urn || partnerProfile?.display_name || `${partnerAddr?.slice(0, 12)}...`}
              </p>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-900/40 border border-red-800/30 text-[9px] text-red-400 font-medium" data-testid="encrypted-badge">
                <FiLock size={8} /> E2E
              </span>
            </div>
            <p className="text-[10px] text-gray-500 truncate">{partnerAddr?.slice(0, 20)}...</p>
          </div>
        </button>
        <div className="relative">
          <button onClick={() => { setMenuOpen(!menuOpen); setTimerMenuOpen(false); }} className="text-gray-400 hover:text-gray-200 p-1" data-testid="dm-menu-btn">
            <FiMoreVertical size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 w-56" data-testid="dm-menu">
              <button
                onClick={() => { navigate(`/profile/${partnerAddr}`); setMenuOpen(false); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50"
                data-testid="dm-view-profile"
              >
                <FiUser size={14} /> View Profile
              </button>
              <div className="relative">
                <button
                  className="flex items-center justify-between w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50"
                  onClick={() => setTimerMenuOpen(!timerMenuOpen)}
                  data-testid="dm-self-destruct-btn"
                >
                  <span className="flex items-center gap-2"><FiClock size={14} /> Self-Destruct</span>
                  <span className="text-[10px] text-gray-500">
                    {SELF_DESTRUCT_OPTIONS.find(o => o.value === selfDestructMs)?.label || 'Off'}
                  </span>
                </button>
                {timerMenuOpen && (
                  <div className="bg-gray-750 border-t border-gray-700/50" data-testid="dm-timer-options">
                    {SELF_DESTRUCT_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={async () => {
                          setSelfDestructMs(opt.value);
                          selfDestructRef.current = opt.value;
                          await setTimerDB(myAddress, partnerAddr, network, opt.value);
                          setTimerMenuOpen(false);
                          setMenuOpen(false);
                        }}
                        className={`flex items-center justify-between w-full px-5 py-1.5 text-xs hover:bg-gray-700/50 ${opt.value === selfDestructMs ? 'text-emerald-400' : 'text-gray-400'}`}
                        data-testid={`timer-${opt.value}`}
                      >
                        {opt.label}
                        {opt.value === selfDestructMs && <FiCheck size={12} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => { blockUser(partnerAddr, partnerProfile?.urn || ''); setMenuOpen(false); navigate(-1); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700/50"
                data-testid="dm-block-user"
              >
                <FiSlash size={14} /> Block User
              </button>
              <div className="border-t border-gray-700/50 my-1" />
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700/50"
                onClick={async () => {
                  if (myAddress && partnerAddr) {
                    // Save the last visible message timestamp as the cutoff
                    const lastMsg = messages[messages.length - 1];
                    const cutoffTs = lastMsg?.timestamp || new Date().toISOString();
                    try {
                      await axios.post(`${API}/dm/clear/${myAddress}`, { partner: partnerAddr, network });
                    } catch { /* backend clear is best-effort */ }
                    await setClearedBefore(myAddress, partnerAddr, network, cutoffTs);
                    await clearSentMessages(myAddress, partnerAddr, network);
                    await clearConversationCache(myAddress, partnerAddr, network);
                    await clearDecryptCacheForConversation(myAddress, partnerAddr, network);
                    cachedTimestampRef.current = null;
                    setMessages([]);
                    setHasMore(false);
                    setLoadMoreSkip(0);
                  }
                  setMenuOpen(false);
                }}
                data-testid="dm-clear-chat"
              >
                <FiTrash2 size={14} /> Clear Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Wallet unlock gate */}
      {needsUnlock ? (
        <div className="flex-1 flex items-center justify-center" data-testid="dm-password-gate">
          <div className="max-w-sm w-full mx-4">
            <div className="bg-gray-900/80 border border-gray-700/50 rounded-xl p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-900/30 border border-red-700/50 flex items-center justify-center mx-auto mb-4">
                <FiLock size={28} className="text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-200 mb-1">Encrypted Channel</h2>
              <p className="text-xs text-gray-500 mb-4">Wallet verification required to decrypt messages</p>
              <InlineUnlock onUnlock={() => setWalletUnlocked(true)} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col" style={wallpaperStyle} data-testid="dm-messages">
            <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
            {backgroundLoading && !loading && (
              <div className="flex justify-center py-1.5 flex-shrink-0">
                <span className="text-[10px] text-gray-600 animate-pulse" data-testid="dm-bg-loading">Checking for new messages...</span>
              </div>
            )}
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-600">
                  <div className="animate-pulse mb-2">Decrypting messages...</div>
                </div>
              </div>
            ) : messages.length === 0 && offchainMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-600">
                  {fetchError ? (
                    <p className="text-sm text-red-400">{fetchError}</p>
                  ) : (
                    <>
                      <FiShield size={32} className="mx-auto mb-2 text-gray-700" />
                      <p className="text-sm">No encrypted messages yet</p>
                      {!hasEncryptionKeys && <p className="text-xs text-yellow-600 mt-1">This user hasn't activated private messaging yet</p>}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-auto">
                {/* Load earlier messages button */}
                {hasMore && (
                  <div className="flex justify-center py-3 flex-shrink-0">
                    <button
                      onClick={() => fetchRef.current(loadMoreSkip, true)}
                      disabled={loadingMore}
                      className="px-4 py-1.5 text-xs text-gray-400 bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/50 rounded-full transition-colors disabled:opacity-50"
                      data-testid="dm-load-more"
                    >
                      {loadingMore ? 'Loading...' : 'Load earlier messages'}
                    </button>
                  </div>
                )}
                {(() => {
                  // Merge on-chain + offchain messages
                  const onchain = messages.map(m => ({ ...m, _source: 'onchain' }));
                  const offchain = offchainMessages.map(m => ({
                    id: m.id,
                    text: m.content,
                    timestamp: m.timestamp,
                    from: m.sender,
                    senderUrn: m.senderUrn,
                    isMine: m.sender === myAddress,
                    _source: m.source || 'offchain',
                  }));
                  // Dedup: skip offchain if same content from same sender exists onchain
                  const onchainKeys = new Set(onchain.map(m => `${m.from}:${(m.text || '').trim().slice(0, 50)}`));
                  const filteredOffchain = offchain.filter(m => !onchainKeys.has(`${m.from}:${(m.text || '').trim().slice(0, 50)}`));
                  const merged = [...onchain, ...filteredOffchain].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                  return merged.map(msg => {
                    const dateLabel = formatDate(msg.timestamp);
                    const showDate = dateLabel !== lastDate;
                    if (showDate) lastDate = dateLabel;
                    return (
                      <ChatBubble key={msg.id} message={msg} isMine={msg.isMine} showDate={showDate} dateLabel={dateLabel} isEncrypted={msg._source === 'onchain'} onPlayWalkie={handlePlayWalkieAudio}
                        partnerUrn={partnerProfile?.urn || partnerAddr?.substring(0, 10)}
                        onCallback={() => navigate(`/walkie?call=${partnerAddr}`)}
                      />
                    );
                  });
                })()}
              </div>
            )}
            <div ref={messagesEndRef} />
            </div>{/* End max-w-3xl */}
          </div>

          {/* Compose bar — dual mode */}
          <div className="flex-shrink-0 border-t border-gray-800/50 bg-gray-900/50" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }} data-testid="dm-compose">
            <div className="max-w-3xl mx-auto">
            {/* Check if current user needs to activate messaging first */}
            {myKeysPublished === false ? (
              <ActivateMessaging network={network} onActivated={refreshMyKeys} compact />
            ) : !hasEncryptionKeys ? (
              <div className="text-center text-xs text-gray-500 py-3" data-testid="partner-no-keys">
                This user hasn't activated private messaging yet.
              </div>
            ) : dmComposeMode === 'offchain' ? (
              <div className="flex items-end gap-2 px-3 py-2">
                <button
                  onClick={() => setDmComposeMode('onchain')}
                  className="p-2 rounded-lg flex-shrink-0 bg-gray-800 text-green-400 hover:bg-gray-700 transition-colors"
                  title="Switch to on-chain encrypted message (costs sats)"
                  data-testid="dm-compose-mode-toggle"
                >
                  <FiRadio size={16} />
                </button>
                <input
                  type="text"
                  value={offchainText}
                  onChange={e => setOffchainText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && offchainText.trim()) {
                      e.preventDefault();
                      sendOffchainDM(offchainText.trim());
                      setOffchainText('');
                    }
                  }}
                  placeholder="Encrypted P2P message (free)..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500/40"
                  data-testid="dm-offchain-text-input"
                />
                <button
                  onClick={() => { if (offchainText.trim()) { sendOffchainDM(offchainText.trim()); setOffchainText(''); } }}
                  disabled={!offchainText.trim()}
                  className="p-2 rounded-lg flex-shrink-0 text-white transition-all disabled:opacity-40 active:scale-95"
                  style={{ backgroundColor: 'var(--c-accent, #22c55e)' }}
                  data-testid="dm-offchain-send-btn"
                >
                  <FiSend size={16} />
                </button>
              </div>
            ) : (
              <div className="px-3 py-1">
                <div className="flex items-center gap-2 pb-1">
                  <button onClick={() => setDmComposeMode('offchain')} className="text-[10px] text-gray-500 hover:text-green-400 flex items-center gap-1 transition-colors" data-testid="dm-compose-mode-back">
                    <FiRadio size={10} /> Switch to free P2P
                  </button>
                  <span className="text-[10px] text-gray-600">On-chain encrypted (costs sats)</span>
                </div>
                <ComposeToolbar
                  ref={dmToolbarRef}
                  text={composing}
                  setText={setComposing}
                  sending={sending}
                  disabled={!wif}
                  placeholder="Write an on-chain encrypted message..."
                  accentColor="red"
                  testIdPrefix="dm"
                  network={network}
                  onKeySubmit={handleSend}
                  textOnly
                />
              </div>
            )}
            </div>{/* End max-w-3xl */}
          </div>
        </>
      )}
    </div>
  );
}
