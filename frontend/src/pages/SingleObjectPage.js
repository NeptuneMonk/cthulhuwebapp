import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  FiArrowLeft, FiShoppingCart, FiTrash2, FiGift,
  FiExternalLink, FiUsers, FiClock, FiLock, FiCopy, FiCreditCard, FiPercent,
  FiPlay, FiMusic, FiGlobe, FiFile, FiDownload, FiMaximize2, FiTag,
  FiMessageSquare, FiLink, FiLink2, FiShield, FiAlertTriangle
} from 'react-icons/fi';
import { AddressLabel } from '@/components/AddressLabel';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';
import { copyToClipboard } from '@/utils/clipboard';
import { GiveModal, BurnModal, BuyModal, ListModal } from '@/components/ObjectActionModals';
import { ZipAppViewer } from '@/components/ZipAppViewer';
import { classifyFile, needsWarning, THREAT_LEVELS } from '@/utils/fileSafety';
import { FileWarningModal } from '@/components/FileWarningModal';
import { FiWifi } from 'react-icons/fi';
import OnChainAgeBadge from '@/components/OnChainAgeBadge';
import ObjectHistory from '@/components/ObjectHistory';
import { meshFetchBlob, getGlobalMeshNode } from '@/utils/meshRelay';
import { cacheByUrn, meshFetchByUrn } from '@/utils/meshFirstFetch';

import { isMainnetNetwork } from '@/utils/media';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const P2FK_ROOT_FALLBACK = 'https://p2fk.io/root';

/** Chain prefixes that indicate on-chain data (from SUP protocol) */
const CHAIN_PREFIXES = ['BTC:', 'LTC:', 'MZC:', 'DOG:', 'btc:', 'ltc:', 'mzc:', 'dog:'];

const PROPAGATION_GATEWAYS = [
  { name: 'Kubo', url: (cid) => `${API}/ipfs/cat/${cid}`, label: 'Local' },
  { name: 'ipfs.io', url: (cid) => `https://ipfs.io/ipfs/${cid}`, label: 'ipfs.io' },
  { name: 'dweb', url: (cid) => `https://dweb.link/ipfs/${cid}`, label: 'dweb' },
  { name: 'cf', url: (cid) => `https://cloudflare-ipfs.com/ipfs/${cid}`, label: 'CF' },
  { name: 'w3s', url: (cid) => `https://w3s.link/ipfs/${cid}`, label: 'w3s' },
];

/** Non-blocking IPFS propagation status bar — checks gateway availability in background */
function IpfsPropagationBar({ cids }) {
  const [results, setResults] = useState([]); // array of { name, status: 'checking'|'ok'|'fail' }
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!cids?.length) return;
    // Use the first CID as the representative probe
    const cid = cids[0];
    const initial = PROPAGATION_GATEWAYS.map(g => ({ name: g.name, label: g.label, status: 'checking' }));
    setResults(initial);
    setStarted(true);

    // Fire all checks in parallel, update state as each resolves
    PROPAGATION_GATEWAYS.forEach((gw, idx) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      fetch(gw.url(cid), { method: 'HEAD', signal: controller.signal })
        .then(res => {
          clearTimeout(timer);
          // Our backend returns proper status. Public gateways with CORS return ok/not-ok.
          // Opaque (no-cors fallback) treated as success since fetch resolved.
          const ok = res.ok || res.type === 'opaque';
          setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: ok ? 'ok' : 'fail' } : r));
        })
        .catch(() => {
          clearTimeout(timer);
          // HEAD might be blocked by CORS — retry with GET (1 byte range)
          const ctrl2 = new AbortController();
          const t2 = setTimeout(() => ctrl2.abort(), 5000);
          fetch(gw.url(cid), { signal: ctrl2.signal, headers: { Range: 'bytes=0-0' } })
            .then(res => {
              clearTimeout(t2);
              const ok = res.ok || res.status === 206 || res.type === 'opaque';
              // Cancel body download
              res.body?.cancel?.();
              setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: ok ? 'ok' : 'fail' } : r));
            })
            .catch(() => {
              clearTimeout(t2);
              setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: 'fail' } : r));
            });
        });
    });
  }, [cids?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!started || !cids?.length) return null;

  const okCount = results.filter(r => r.status === 'ok').length;
  const total = results.length;
  const checking = results.some(r => r.status === 'checking');

  return (
    <div className="mt-3 bg-gray-900/60 border border-gray-800/50 rounded-lg px-3 py-2" data-testid="ipfs-propagation-bar">
      <div className="flex items-center gap-2 mb-1.5">
        <FiWifi size={11} className={`${checking ? 'text-gray-500 animate-pulse' : okCount >= 4 ? 'text-emerald-400' : okCount >= 2 ? 'text-amber-400' : okCount >= 1 ? 'text-orange-400' : 'text-red-500'}`} />
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">IPFS Propagation</span>
        <span className={`text-[10px] ml-auto font-mono ${checking ? 'text-gray-600' : okCount >= 4 ? 'text-emerald-500' : okCount >= 2 ? 'text-amber-500' : 'text-gray-600'}`}>
          {checking ? 'Probing...' : `${okCount}/${total} gateways`}
        </span>
      </div>
      {/* Segmented bar — one segment per gateway */}
      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-gray-800/50">
        {results.map((r) => (
          <div
            key={r.name}
            className={`flex-1 rounded-sm transition-all duration-700 ease-out ${
              r.status === 'ok' ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]'
              : r.status === 'fail' ? 'bg-gray-800/80'
              : 'bg-gray-700 animate-pulse'
            }`}
            title={`${r.label}: ${r.status === 'ok' ? 'Available' : r.status === 'fail' ? 'Not found' : 'Checking...'}`}
          />
        ))}
      </div>
      {/* Gateway labels */}
      <div className="flex gap-0.5 mt-1">
        {results.map((r) => (
          <div key={r.name} className="flex-1 text-center">
            <span className={`text-[8px] ${r.status === 'ok' ? 'text-green-500' : r.status === 'fail' ? 'text-gray-700' : 'text-gray-600'}`}>
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Check if a string looks like a hex transaction ID (exactly 64 hex chars, optionally followed by /filename) */
const isHexTxId = (s) => /^[0-9a-fA-F]{64}([\\/]|$)/.test(s);

/**
 * Resolve on-chain content with proper priority order:
 * 1. Mesh network (peer-to-peer) — fastest if a peer already has it
 * 2. Backend endpoint (which fetches from blockchain/bitfossil, caches in DB)
 *
 * Returns { blob, blobUrl, source } or keeps polling until resolved.
 * Calls onResolved(blobUrl) when content is ready.
 * Calls onResolving() when waiting for reconstruction.
 * Calls onError() on failure.
 */
function useOnchainResolver(primaryUrl, txid, filename, { fallbackUrl, enabled = true, onResolved, onResolving, onError }) {
  useEffect(() => {
    if (!enabled || !primaryUrl) return;
    let cancelled = false;
    let pollTimer = null;

    const resolve = async () => {
      // Priority 1: Try mesh network — other peers may already have the reconstructed file
      if (txid && filename) {
        const meshKey = `onchain:${txid}/${filename}`;
        try {
          const meshBlob = await meshFetchBlob(meshKey);
          if (meshBlob && !cancelled) {
            const url = URL.createObjectURL(meshBlob);
            onResolved?.(url, 'mesh');
            return;
          }
        } catch {}
      }

      // Priority 2: p2fk.io root endpoint (serves on-chain files directly)
      try {
        const resp = await fetch(primaryUrl);
        if (cancelled) return;
        if (resp.ok) {
          const blob = await resp.blob();
          if (!cancelled && blob.size > 0) {
            cacheBlobInMesh(txid, filename, blob);
            onResolved?.(URL.createObjectURL(blob), 'p2fk');
            return;
          }
        }
      } catch {}

      // Priority 3: Backend endpoint (reconstructs from blockchain, with polling)
      if (fallbackUrl && !cancelled) {
        try { await pollBackend(fallbackUrl); } catch { if (!cancelled) onError?.(); }
      } else if (!cancelled) {
        onError?.();
      }
    };

    const pollBackend = async (url) => {
      if (cancelled) return;
      try {
        const r = await fetch(url);
        if (cancelled) return;
        if (r.status === 200) {
          const ct = r.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = await r.json();
            if (data.status === 'resolving') {
              onResolving?.();
              pollTimer = setTimeout(() => pollBackend(url), 4000);
              return;
            }
            if (data.status === 'failed') { onError?.(); return; }
          }
          const blob = await (await fetch(url)).blob();
          if (!cancelled) {
            cacheBlobInMesh(txid, filename, blob);
            onResolved?.(URL.createObjectURL(blob), 'blockchain');
          }
        } else if (r.status === 202) {
          onResolving?.();
          pollTimer = setTimeout(() => pollBackend(url), 4000);
        } else {
          onError?.();
        }
      } catch {
        if (!cancelled) onError?.();
      }
    };

    resolve();
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryUrl, fallbackUrl, txid, filename, enabled]);
}

/** Cache resolved content in the mesh node's memory for serving to peers */
function cacheBlobInMesh(txid, filename, blob, urn = null) {
  try {
    const node = getGlobalMeshNode();
    if (node?._running) {
      blob.arrayBuffer().then(ab => {
        node.cache.set(`onchain:${txid}/${filename}`, { data: ab, timestamp: Date.now() });
        // Also cache under URN for chain-agnostic lookups
        if (urn) {
          const existing = node.cache.get(`urn:${urn}`);
          node.cache.set(`urn:${urn}`, {
            meta: existing?.meta || {},
            data: ab,
            timestamp: Date.now(),
          });
        }
      }).catch(() => {});
    }
  } catch {}
}

/** Parse any media reference string into { url, filename, extension, source } */
const parseMediaRef = (ref, mainnet = true) => {
  if (!ref || typeof ref !== 'string') return null;

  // IPFS references: IPFS:QmHash\filename.ext or IPFS:QmHash/filename.ext
  if (ref.toUpperCase().startsWith('IPFS:')) {
    const raw = ref.replace(/^IPFS:/i, '');
    const parts = raw.split(/[\\/]/);
    const cid = parts[0];
    const filename = parts.length > 1 ? parts.slice(1).join('/') : '';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    // Primary: CID+filename (for directory CIDs). Fallback: CID-only (for single-file CIDs).
    const fullUrl = filename ? `https://ipfs.io/ipfs/${cid}/${encodeURIComponent(filename)}` : `https://ipfs.io/ipfs/${cid}`;
    const cidOnlyUrl = `https://ipfs.io/ipfs/${cid}`;
    return { url: fullUrl, fallbackUrl: cidOnlyUrl, filename, extension: ext, source: 'ipfs' };
  }

  // On-chain references with chain prefix: BTC:txid/filename, LTC:txid/filename, etc.
  const chainPrefix = CHAIN_PREFIXES.find(p => ref.startsWith(p));
  if (chainPrefix) {
    const stripped = ref.slice(chainPrefix.length);
    const parts = stripped.split(/[\\/]/);
    const txid = parts[0];
    const filename = parts.length > 1 ? parts.slice(1).join('/') : '';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const resolvedFilename = filename || 'data.txt';
    const resolvedExt = ext || 'txt';
    const chain = chainPrefix.replace(':', '').toUpperCase();
    const useMainnet = (chain === 'MZC' || chain === 'DOG') ? true : mainnet;
    const url = `${API}/onchain/file/${txid}/${encodeURIComponent(resolvedFilename)}?chain=${chain}&mainnet=${useMainnet}`;
    const fallbackUrl = `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(resolvedFilename)}?mainnet=${useMainnet}`;
    return { url, fallbackUrl, filename: resolvedFilename, extension: resolvedExt, source: 'onchain', chain, txid };
  }

  // On-chain references without prefix: {64-char-hex-txid}/filename or {64-char-hex-txid}\filename
  if (isHexTxId(ref)) {
    const parts = ref.split(/[\\/]/);
    const txid = parts[0];
    const filename = parts.length > 1 ? parts.slice(1).join('/') : '';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    const resolvedFilename = filename || 'data.txt';
    const resolvedExt = ext || 'txt';
    const url = `${API}/onchain/file/${txid}/${encodeURIComponent(resolvedFilename)}?chain=BTC&mainnet=${mainnet}`;
    const fallbackUrl = `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(resolvedFilename)}?mainnet=${mainnet}`;
    return { url, fallbackUrl, filename: resolvedFilename, extension: resolvedExt, source: 'onchain', chain: 'BTC', txid };
  }

  // Bare domain names (e.g., "embii.wtf") — treat as web link, not file
  const KNOWN_TLDS = ['com','org','net','io','wtf','xyz','co','me','dev','app','gg','tv','fm','ai','cc','to','ly','sh','info'];
  const dotParts = ref.split('.');
  if (dotParts.length >= 2 && !ref.includes(' ') && !ref.includes('/') && !ref.includes('\\') && KNOWN_TLDS.includes(dotParts[dotParts.length - 1].toLowerCase()) && dotParts[0].length < 64) {
    return { url: `https://${ref}`, filename: ref, extension: dotParts[dotParts.length - 1].toLowerCase(), source: 'web-link' };
  }

  // HTTP/HTTPS URLs — intercept dead services (bitfossil.org is DOWN)
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    if (ref.includes('bitfossil.org') || ref.includes('bitfossil.com')) {
      // Try to extract txid from URL like bitfossil.org/txid/filename
      const pathMatch = ref.match(/bitfossil\.[a-z]+\/([a-fA-F0-9]{64})(?:\/(.+))?/);
      if (pathMatch) {
        const txid = pathMatch[1];
        const fname = decodeURIComponent(pathMatch[2] || 'data');
        const ext = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
        const url = `${API}/onchain/file/${txid}/${encodeURIComponent(fname)}?chain=BTC&mainnet=${mainnet}`;
        const fallbackUrl = `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(fname)}?mainnet=${mainnet}`;
        return { url, fallbackUrl, filename: fname, extension: ext, source: 'onchain', chain: 'BTC', txid };
      }
    }
    const filename = ref.split('/').pop() || '';
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    return { url: ref, filename, extension: ext, source: 'web' };
  }

  // Nothing matched — if the string has content, treat it as raw text data
  if (ref.length > 0) {
    return { url: null, filename: null, extension: 'txt', source: 'raw-text', rawText: ref };
  }

  return null;
};

/** Determine what kind of media a file is based on extension */
const getMediaType = (ext, filename, source) => {
  // raw-text takes priority — URN contains the content directly, not a file reference
  if (source === 'raw-text') return 'raw-text';
  if (source === 'web-link') return 'web-link';
  if (!ext) return 'unknown';
  // Special case: index.zip = embedded web app
  if (ext === 'zip' && filename && filename.toLowerCase().includes('index.zip')) return 'webapp';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'amr', 'arm'].includes(ext)) return 'audio';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['txt'].includes(ext)) return 'text';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'file';
};

/** Inline video player with mesh-first on-chain resolution and IPFS fallback */
const VideoPlayer = ({ src, fallbackSrc, poster, posterFallback, filename, source, chain }) => {
  const [activeSrc, setActiveSrc] = useState(source === 'onchain' ? null : src);
  const [triedFallback, setTriedFallback] = useState(false);
  const [activePoster, setActivePoster] = useState(poster);
  const [triedPosterFallback, setTriedPosterFallback] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const isOnchain = source === 'onchain';
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];

  // Non-onchain: set src directly
  useEffect(() => {
    if (!isOnchain) setActiveSrc(src);
  }, [src, isOnchain]);

  // Mesh-first resolver for on-chain video
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback((blobUrl, from) => { setActiveSrc(blobUrl); setResolving(false); setResolvedFrom(from); }, []),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => { if (fallbackSrc && fallbackSrc !== src) setActiveSrc(fallbackSrc); }, [fallbackSrc, src]),
  });

  // Test poster URL - if it fails, swap to fallback
  useEffect(() => {
    if (!poster) return;
    const img = new Image();
    img.onload = () => setActivePoster(poster);
    img.onerror = () => {
      if (posterFallback && posterFallback !== poster && !triedPosterFallback) {
        setTriedPosterFallback(true);
        setActivePoster(posterFallback);
      }
    };
    img.src = poster;
  }, [poster, posterFallback, triedPosterFallback]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden" data-testid="video-player">
      {resolving ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-800/50 rounded-lg">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mb-2" />
          <p className="text-xs text-gray-400">Reconstructing video from {chain || 'blockchain'}...</p>
        </div>
      ) : activeSrc ? (
        <video
          key={activeSrc}
          controls
          preload="metadata"
          poster={activePoster || undefined}
          className="w-full max-h-[70vh] object-contain"
          data-testid="video-element"
          onError={() => {
            if (!triedFallback && fallbackSrc && fallbackSrc !== activeSrc) {
              setActiveSrc(fallbackSrc);
              setTriedFallback(true);
            }
          }}
        >
          <source src={activeSrc} />
          Your browser does not support video playback.
        </video>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-800/50 rounded-lg">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mb-2" />
          <p className="text-xs text-gray-400">Loading...</p>
        </div>
      )}
      {filename && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 pointer-events-none">
          <p className="text-xs text-gray-300 truncate flex items-center gap-1.5">
            <FiPlay size={10} /> {filename}
          </p>
        </div>
      )}
    </div>
  );
};

/** Inline audio player with IPFS fallback for broken URLs and on-chain 202 polling */
const AudioPlayer = ({ src, coverUrl, coverFallbackUrl, filename, fallbackSrc, source, chain }) => {
  const [playError, setPlayError] = useState(false);
  const [activeSrc, setActiveSrc] = useState(source === 'onchain' ? null : src);
  const [triedFallback, setTriedFallback] = useState(false);
  const [coverSrc, setCoverSrc] = useState(coverUrl);
  const [triedCoverFallback, setTriedCoverFallback] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const ext = filename?.split('.').pop()?.toLowerCase();
  const unsupported = ['amr', 'arm'].includes(ext);
  const isOnchain = source === 'onchain';
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];

  // MIME type for the audio source element
  const AUDIO_MIMES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma' };
  const audioMime = AUDIO_MIMES[ext] || 'audio/mpeg';

  // Non-onchain: set src directly
  useEffect(() => {
    if (!isOnchain) setActiveSrc(src);
  }, [src, isOnchain]);

  // Mesh-first resolver for on-chain audio — re-type blob for browser compatibility
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback(async (blobUrl, from) => {
      // Re-create blob with explicit MIME type for <audio> compatibility
      try {
        const resp = await fetch(blobUrl);
        const rawBlob = await resp.blob();
        const typedBlob = new Blob([rawBlob], { type: audioMime });
        const typedUrl = URL.createObjectURL(typedBlob);
        setActiveSrc(typedUrl);
      } catch {
        setActiveSrc(blobUrl);
      }
      setResolving(false);
      setResolvedFrom(from);
    }, [audioMime]),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => {
      if (fallbackSrc && fallbackSrc !== src) setActiveSrc(fallbackSrc);
      else setPlayError(true);
    }, [fallbackSrc, src]),
  });

  const handleError = () => {
    if (!triedFallback && fallbackSrc && fallbackSrc !== activeSrc) {
      setTriedFallback(true);
      setActiveSrc(fallbackSrc);
    } else {
      setPlayError(true);
    }
  };

  return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden" data-testid="audio-player">
      {coverSrc && (
        <div className="flex justify-center p-6 bg-gradient-to-b from-gray-800 to-gray-900">
          <img
            src={coverSrc} alt="Cover" className="max-h-64 rounded-lg shadow-2xl object-contain"
            onError={() => {
              if (!triedCoverFallback && coverFallbackUrl && coverFallbackUrl !== coverSrc) {
                setTriedCoverFallback(true);
                setCoverSrc(coverFallbackUrl);
              } else {
                setCoverSrc(null);
              }
            }}
          />
        </div>
      )}
      <div className="p-4 space-y-3">
        {filename && (
          <p className="text-sm text-gray-300 flex items-center gap-2">
            <FiMusic size={14} style={{ color: 'var(--c-accent)' }} /> {filename}
          </p>
        )}
        {resolving ? (
          <div className="flex items-center gap-3 py-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500" />
            <p className="text-xs text-gray-400">Reconstructing audio from {chain || 'blockchain'}...</p>
          </div>
        ) : (unsupported || playError) ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-400">
              {unsupported ? `This audio format (.${ext}) is not supported for in-browser playback.` : 'Audio failed to load from source. Try downloading instead.'}
            </p>
            <a
              href={activeSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg transition-colors btn-accent"
              data-testid="audio-download-link"
            >
              <FiDownload size={14} /> Download Audio
            </a>
          </div>
        ) : (
          <audio key={activeSrc} controls className="w-full" preload="metadata" onError={handleError} data-testid="audio-element">
            <source src={activeSrc} type={audioMime} />
            Your browser does not support audio playback.
          </audio>
        )}
      </div>
    </div>
  );
};

/** Detect actual content type from blob magic bytes */
const sniffBlobType = async (blobUrl) => {
  try {
    const resp = await fetch(blobUrl);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf.slice(0, 8));
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image';
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image';
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image';
    // WebP: RIFF....WEBP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image';
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    return 'html';
  } catch {
    return 'html';
  }
};

/** Inline HTML viewer (iframe) with content-sniffing for on-chain blobs */
const HtmlViewer = ({ src, fallbackSrc, filename, source, chain }) => {
  const [error, setError] = useState(false);
  const [activeSrc, setActiveSrc] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const [detectedType, setDetectedType] = useState(null); // 'html' | 'image' | 'pdf'

  const isOnchain = source === 'onchain' || src?.includes('/onchain/file/') || src?.includes('p2fk.io/root/');
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];

  // For non-onchain content, use src directly (no sniffing needed)
  useEffect(() => {
    if (!isOnchain) { setActiveSrc(src); setDetectedType('html'); }
  }, [src, isOnchain]);

  // Mesh-first resolver for on-chain content — sniff blob type after resolution
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback(async (blobUrl, from) => {
      const type = await sniffBlobType(blobUrl);
      setDetectedType(type);
      setActiveSrc(blobUrl);
      setResolving(false);
      setResolvedFrom(from);
    }, []),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => setError(true), []),
  });

  const handleLoad = (e) => {
    try {
      const doc = e.target.contentDocument;
      if (doc && doc.title && doc.title.includes('504')) setError(true);
    } catch (_) {}
  };

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700" data-testid="html-viewer">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <FiGlobe size={12} /> {filename || 'HTML Content'}
          {resolvedFrom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 ml-1">via {resolvedFrom}</span>}
          {detectedType === 'image' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 ml-1">image detected</span>}
        </p>
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
          Open in new tab <FiExternalLink size={10} />
        </a>
      </div>
      {resolving ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-900" data-testid="html-resolving">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mb-3" />
          <p className="text-sm text-gray-400">Reconstructing from {chain || 'blockchain'}...</p>
          <p className="text-xs text-gray-500 mt-1">This may take a moment for on-chain files</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-900" data-testid="html-error">
          <FiGlobe size={32} className="text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 mb-1">Content unavailable</p>
          <p className="text-xs text-gray-500 mb-3">This file may not be pinned on IPFS. The gateway couldn't retrieve it.</p>
          <a href={src} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
            Try opening directly
          </a>
        </div>
      ) : activeSrc && detectedType === 'image' ? (
        <img
          src={activeSrc}
          alt={filename || 'On-chain image'}
          className="w-full max-h-[70vh] object-contain rounded-b-lg bg-gray-900"
          data-testid="html-sniffed-image"
        />
      ) : activeSrc ? (
        <iframe
          src={activeSrc}
          title="Object Content"
          className="w-full bg-white"
          style={{ height: '60vh' }}
          sandbox="allow-scripts"
          onLoad={handleLoad}
          onError={() => setError(true)}
          data-testid="html-iframe"
        />
      ) : (
        <div className="flex items-center justify-center py-16 bg-gray-900">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      )}
    </div>
  );
};

/** Image viewer with fullscreen, mesh-first on-chain resolution, and IPFS fallback */
const ImageViewer = ({ src, fallbackSrc, alt, source, chain }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imgSrc, setImgSrc] = useState(src);
  const [triedFallback, setTriedFallback] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const isIPFS = source === 'ipfs';
  const isOnchain = source === 'onchain';
  const { url: cachedSrc } = useCachedIPFS(isIPFS ? src : null);
  const displaySrc = isIPFS ? (cachedSrc || imgSrc) : imgSrc;

  // Extract txid for mesh cache key
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];
  const filename = src?.split('/').pop()?.split('?')[0];

  // Mesh-first resolver for on-chain images
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback((blobUrl, from) => {
      setImgSrc(blobUrl);
      setResolving(false);
      setResolvedFrom(from);
    }, []),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => { setLoading(false); setError(true); }, []),
  });

  return (
    <>
      <div className="relative cursor-pointer group" onClick={() => !loading && !error && setFullscreen(true)} data-testid="image-viewer">
        {(loading || resolving) && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800/50 rounded-lg z-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mb-2" />
            {source === 'onchain' && (
              <p className="text-xs text-gray-400">
                {resolving ? `Reconstructing from ${chain || 'blockchain'}...` : 'Loading...'}
              </p>
            )}
          </div>
        )}
        {error && !resolving ? (
          <div className="bg-gray-800/50 rounded-lg p-8 flex flex-col items-center gap-2" data-testid="image-error">
            <p className="text-sm text-gray-500">Could not load image</p>
            {source === 'onchain' && <p className="text-xs text-gray-600">On-chain content may be unavailable</p>}
          </div>
        ) : (
          <img
            src={displaySrc}
            alt={alt}
            className="w-full max-h-[70vh] object-contain rounded-lg"
            onLoad={() => { setLoading(false); setResolving(false); }}
            onError={() => {
              if (resolving) return;
              if (!triedFallback && fallbackSrc && fallbackSrc !== imgSrc) {
                setTriedFallback(true);
                setImgSrc(fallbackSrc);
              } else {
                setLoading(false); setError(true);
              }
            }}
          />
        )}
        {!loading && !resolving && !error && (
          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-full p-2">
            <FiMaximize2 size={16} className="text-white" />
          </div>
        )}
      </div>
      {isOnchain && !loading && !resolving && !error && (
        <p className="text-xs text-amber-400/80 mt-2 flex items-center gap-1.5" data-testid="onchain-badge">
          On-Chain ({chain === 'DOG' || chain === 'DOGE' ? 'Dogecoin' : chain === 'LTC' ? 'Litecoin' : chain === 'BTC' ? 'Bitcoin' : chain || 'Bitcoin'})
          {resolvedFrom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">via {resolvedFrom}</span>}
        </p>
      )}
      {fullscreen && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 cursor-pointer" onClick={() => setFullscreen(false)} data-testid="fullscreen-overlay">
          <img src={displaySrc} alt={alt} className="max-w-[95vw] max-h-[95vh] object-contain" />
        </div>
      )}
    </>
  );
};

/** Fallback file display with safety warnings and on-chain resolution */
const FileDownload = ({ src, fallbackSrc, filename, extension, source, chain }) => {
  const [activeSrc, setActiveSrc] = useState(src);
  const [triedFallback, setTriedFallback] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);
  const classification = classifyFile(filename || `file.${extension}`);
  const isRisky = classification.level === THREAT_LEVELS.WARNING || classification.level === THREAT_LEVELS.DANGER;

  const isOnchain = source === 'onchain';
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];
  const fname = src?.split('/').pop()?.split('?')[0];

  // Mesh-first resolver for on-chain files
  useOnchainResolver(src, txid, fname, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback((blobUrl, from) => {
      setActiveSrc(blobUrl);
      setResolving(false);
      setResolvedFrom(from);
    }, []),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => setResolving(false), []),
  });

  // Pre-check: if primary URL fails, use fallback for download link
  useEffect(() => {
    if (!fallbackSrc || fallbackSrc === src) return;
    fetch(src, { method: 'HEAD' }).then(r => {
      if (!r.ok && !triedFallback) { setTriedFallback(true); setActiveSrc(fallbackSrc); }
    }).catch(() => {
      if (!triedFallback) { setTriedFallback(true); setActiveSrc(fallbackSrc); }
    });
  }, [src, fallbackSrc, triedFallback]);

  const handleDownload = (e) => {
    if (isRisky) {
      e.preventDefault();
      setShowWarning(true);
    }
  };

  const borderColor = classification.level === THREAT_LEVELS.DANGER ? 'border-red-500/30' :
    classification.level === THREAT_LEVELS.WARNING ? 'border-orange-500/30' : 'border-gray-700';

  return (
  <>
    <div className={`bg-gray-800/50 rounded-lg p-6 flex flex-col items-center gap-4 border ${borderColor}`} data-testid="file-download">
      {resolving ? (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
          <p className="text-xs text-gray-400">Reconstructing {filename || 'file'} from {chain || 'blockchain'}...</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 bg-gray-700 rounded-xl flex items-center justify-center">
            {isRisky ? <FiAlertTriangle size={28} className={classification.level === THREAT_LEVELS.DANGER ? 'text-red-400' : 'text-orange-400'} />
                      : <FiFile size={28} className="text-gray-400" />}
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-200 font-medium mb-1">{filename || 'Unknown file'}</p>
            {extension && <p className="text-xs text-gray-500 uppercase">.{extension} file</p>}
            {isRisky && (
              <p className={`text-xs mt-1 ${classification.level === THREAT_LEVELS.DANGER ? 'text-red-400' : 'text-orange-400'}`}>
                {classification.label} — {classification.level === THREAT_LEVELS.DANGER ? 'May contain malware' : 'Verify source before opening'}
              </p>
            )}
          </div>
          <a
            href={activeSrc}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleDownload}
            className={`flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg transition-colors ${
              isRisky ? 'bg-orange-900/50 hover:bg-orange-800/60 border border-orange-700/50' : 'btn-accent'
            }`}
            data-testid="file-download-link"
          >
            <FiDownload size={14} /> {isRisky ? 'Download (Review Warning)' : 'Download / View'}
          </a>
          {isOnchain && resolvedFrom && (
            <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
              On-Chain ({chain || 'Bitcoin'})
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">via {resolvedFrom}</span>
            </p>
          )}
        </>
      )}
    </div>
    {showWarning && (
      <FileWarningModal
        filename={filename}
        onProceed={() => {
          setShowWarning(false);
          window.open(activeSrc, '_blank', 'noopener,noreferrer');
        }}
        onCancel={() => setShowWarning(false)}
      />
    )}
  </>
  );
};

/** PDF viewer with on-chain resolution, mesh-first, and IPFS fallback */
const PdfViewer = ({ src, fallbackSrc, source, chain }) => {
  const [activeSrc, setActiveSrc] = useState(source === 'onchain' ? null : src);
  const [triedFallback, setTriedFallback] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);

  const isOnchain = source === 'onchain';
  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];
  const filename = src?.split('/').pop()?.split('?')[0];

  // Mesh-first resolver for on-chain PDFs
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: isOnchain,
    onResolved: useCallback((blobUrl, from) => {
      setActiveSrc(blobUrl);
      setResolving(false);
      setResolvedFrom(from);
    }, []),
    onResolving: useCallback(() => setResolving(true), []),
    onError: useCallback(() => { setResolving(false); setError(true); }, []),
  });

  // Non-onchain: use direct src
  useEffect(() => {
    if (!isOnchain && src) setActiveSrc(src);
  }, [isOnchain, src]);

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700" data-testid="pdf-viewer">
      {(resolving || (!activeSrc && isOnchain && !error)) && (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-900">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mb-2" />
          <p className="text-xs text-gray-400">
            {resolving ? `Reconstructing PDF from ${chain || 'blockchain'}...` : 'Loading PDF...'}
          </p>
        </div>
      )}
      {error && !resolving && (
        <div className="flex flex-col items-center justify-center py-16 bg-gray-900">
          <p className="text-sm text-gray-500">Could not load PDF</p>
          {isOnchain && <p className="text-xs text-gray-600 mt-1">On-chain content may take time to reconstruct</p>}
          {src && (
            <a href={src} target="_blank" rel="noopener noreferrer" className="mt-3 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <FiDownload size={12} /> Try Direct Download
            </a>
          )}
        </div>
      )}
      {activeSrc && !error && (
        <div className="flex flex-col items-center gap-4 p-6 bg-gray-900">
          <div className="w-16 h-20 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <span className="text-red-400 text-xs font-bold">PDF</span>
          </div>
          <p className="text-sm text-gray-300 text-center">{filename || 'document.pdf'}</p>
          <div className="flex items-center gap-3">
            <a href={activeSrc} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm rounded-lg btn-accent"
              data-testid="pdf-open-external">
              <FiExternalLink size={14} /> Open PDF
            </a>
            <a href={activeSrc} download={filename || 'document.pdf'}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-gray-400 hover:text-white text-sm rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              data-testid="pdf-download">
              <FiDownload size={14} /> Download
            </a>
          </div>
        </div>
      )}
      {isOnchain && activeSrc && !resolving && !error && (
        <p className="text-xs text-amber-400/80 mt-2 px-2 flex items-center gap-1.5" data-testid="onchain-pdf-badge">
          On-Chain ({chain === 'DOG' || chain === 'DOGE' ? 'Dogecoin' : chain === 'LTC' ? 'Litecoin' : chain === 'BTC' ? 'Bitcoin' : chain || 'Bitcoin'})
          {resolvedFrom && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">via {resolvedFrom}</span>}
        </p>
      )}
    </div>
  );
};


/** Raw text content viewer — displays text directly from the URN field */
const RawTextViewer = ({ text, objectName }) => {
  const textBgColors = [
    'from-indigo-900 to-slate-900',
    'from-emerald-900 to-cyan-950',
    'from-rose-950 to-purple-950',
    'from-amber-900 to-orange-950',
    'from-sky-900 to-blue-950',
    'from-teal-900 to-slate-900',
  ];
  const nameHash = (objectName || '').split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const bgIdx = Math.abs(nameHash) % textBgColors.length;

  // Determine if it's a long number string (like PI digits) for monospace display
  const isNumeric = /^\d+$/.test(text);
  // Auto-size font based on text length
  const fontSize = text.length > 500 ? 'text-xs sm:text-sm' : text.length > 200 ? 'text-sm sm:text-base' : 'text-base sm:text-lg';

  return (
    <div data-testid="raw-text-content-viewer">
      <div className={`bg-gradient-to-br ${textBgColors[bgIdx]} rounded-lg p-6 sm:p-8 flex items-center justify-center`}
           style={{ minHeight: '280px' }}>
        <p className={`${isNumeric ? 'font-mono' : 'font-serif'} text-gray-100 leading-relaxed text-center break-all ${fontSize}`}
           style={{ textShadow: '0 1px 6px rgba(0,0,0,0.4)', wordBreak: 'break-all', maxWidth: '100%' }}>
          {text}
        </p>
      </div>
      <p className="text-xs text-amber-400/80 mt-2" data-testid="raw-text-badge">
        On-Chain Data (URN)
      </p>
    </div>
  );
};


/** Domain Redirect card — for objects whose URN is a domain name and URI is a redirect target */
const DomainRedirectCard = ({ domainName, targetUri, imageUrl, imageFallbackUrl }) => {
  const isP2fk = targetUri?.startsWith('p2fk://');
  const displayTarget = targetUri?.replace(/^https?:\/\//, '').replace(/\/$/, '') || targetUri;

  return (
    <div className="rounded-xl overflow-hidden" data-testid="domain-redirect-card">
      {/* Domain visual */}
      <div className="bg-gradient-to-br from-violet-950 via-gray-900 to-indigo-950 p-8 flex flex-col items-center gap-5">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={domainName}
            className="w-24 h-24 rounded-2xl object-cover border-2 border-violet-500/30 shadow-lg shadow-violet-500/10"
            onError={e => {
              if (imageFallbackUrl && e.target.src !== imageFallbackUrl) e.target.src = imageFallbackUrl;
              else e.target.style.display = 'none';
            }}
          />
        )}
        <div className="text-center">
          <p className="text-3xl font-bold text-white leading-tight">{domainName}</p>
          <span className="inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/20">
            Decentralized Domain
          </span>
        </div>
      </div>

      {/* Redirect target */}
      <div className="bg-gray-800/60 border-t border-gray-700/50 px-6 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            {isP2fk ? 'Redirects to domain' : 'Redirects to'}
          </p>
          <p className="text-sm text-gray-200 truncate font-mono" title={targetUri}>
            {displayTarget}
          </p>
        </div>
        <a
          href={targetUri}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-medium rounded-lg btn-accent transition-all hover:scale-105"
          data-testid="domain-visit-btn"
        >
          <FiExternalLink size={14} /> Visit
        </a>
      </div>
    </div>
  );
};


/** On-chain text content viewer with 202 polling */
const TextContentViewer = ({ src, fallbackSrc, objectName, chain }) => {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resolvedFrom, setResolvedFrom] = useState(null);

  const txidMatch = src?.match(/(?:onchain\/file|root)\/([a-fA-F0-9]{64})\//);
  const txid = txidMatch?.[1];
  const filename = src?.split('/').pop()?.split('?')[0];

  // Mesh-first resolver for on-chain text
  useOnchainResolver(src, txid, filename, {
    fallbackUrl: fallbackSrc,
    enabled: true,
    onResolved: useCallback(async (blobUrl, from) => {
      try {
        const resp = await fetch(blobUrl);
        const content = await resp.text();
        setText(content);
        setResolvedFrom(from);
      } catch { setError(true); }
      setLoading(false);
    }, []),
    onResolving: useCallback(() => {}, []),
    onError: useCallback(() => { setError(true); setLoading(false); }, []),
  });

  const textBgColors = [
    'from-indigo-900 to-slate-900',
    'from-emerald-900 to-cyan-950',
    'from-rose-950 to-purple-950',
    'from-amber-900 to-orange-950',
    'from-sky-900 to-blue-950',
    'from-teal-900 to-slate-900',
  ];
  const nameHash = (objectName || '').split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const bgIdx = Math.abs(nameHash) % textBgColors.length;

  if (loading) {
    return (
      <div className={`bg-gradient-to-br ${textBgColors[bgIdx]} rounded-lg flex flex-col items-center justify-center`}
           style={{ minHeight: '320px' }} data-testid="text-content-loading">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mb-3" />
        <p className="text-sm text-gray-300">Reconstructing text from blockchain...</p>
        {chain && <p className="text-xs text-gray-500 mt-1">Source: {chain === 'DOG' || chain === 'DOGE' ? 'Dogecoin' : chain === 'LTC' ? 'Litecoin' : 'Bitcoin'}</p>}
      </div>
    );
  }

  if (error || !text) {
    return (
      <div className={`bg-gradient-to-br ${textBgColors[bgIdx]} rounded-lg flex items-center justify-center`}
           style={{ minHeight: '320px' }} data-testid="text-content-error">
        <p className="text-sm text-gray-400">Could not load on-chain text content</p>
      </div>
    );
  }

  return (
    <div data-testid="text-content-viewer">
      <div className={`bg-gradient-to-br ${textBgColors[bgIdx]} rounded-lg p-8 sm:p-10`}
           style={{ minHeight: '240px' }}>
        <pre className="font-serif text-gray-100 leading-relaxed whitespace-pre-wrap break-words text-base sm:text-lg"
             style={{ textShadow: '0 1px 6px rgba(0,0,0,0.4)' }}>
          {text}
        </pre>
      </div>
      <p className="text-xs text-amber-400/80 mt-2" data-testid="text-onchain-badge">
        On-Chain Text ({chain === 'DOG' || chain === 'DOGE' ? 'Dogecoin' : chain === 'LTC' ? 'Litecoin' : 'Bitcoin'})
      </p>
    </div>
  );
};


/** Tether/Untether button for object chat rooms */
function TetherButton({ objectAddress, objectName, objectImage, network }) {
  const { user } = useAuth();
  const { wallet } = useWallet();
  const myAddress = user?.address || wallet?.address || '';
  const [tethered, setTethered] = useState(false);

  useEffect(() => {
    try {
      const rooms = JSON.parse(localStorage.getItem(`cthulhu_rooms_${myAddress}_${network}`)) || [];
      setTethered(rooms.some(r => r.objectAddress === objectAddress));
    } catch { setTethered(false); }
  }, [objectAddress, myAddress, network]);

  const toggle = () => {
    try {
      const key = `cthulhu_rooms_${myAddress}_${network}`;
      const rooms = JSON.parse(localStorage.getItem(key)) || [];
      if (tethered) {
        localStorage.setItem(key, JSON.stringify(rooms.filter(r => r.objectAddress !== objectAddress)));
        setTethered(false);
      } else {
        rooms.push({ objectAddress, name: objectName || 'Unnamed', image: objectImage, tetheredAt: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(rooms));
        setTethered(true);
      }
      window.dispatchEvent(new CustomEvent('tethers-changed'));
    } catch {}
  };

  if (!myAddress) return null;

  return (
    <button
      onClick={toggle}
      className={`px-4 py-3 rounded-lg transition-colors text-sm font-medium flex items-center gap-2 ${
        tethered
          ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
          : 'bg-gray-800 hover:bg-gray-700 text-gray-400 border border-transparent'
      }`}
      title={tethered ? 'Untether room' : 'Tether room to sidebar'}
      data-testid="tether-object-btn"
    >
      {tethered ? <FiLink size={16} /> : <FiLink2 size={16} />}
      {tethered ? 'Tethered' : 'Tether'}
    </button>
  );
}


export default function SingleObjectPage({ network, lookupByAddress }) {
  const { txid: paramTxid, address } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { wallet, balance, isConnected: walletConnected } = useWallet();
  const { user, wif: authWif, isConnected: authConnected } = useAuth();
  const isConnected = authConnected || walletConnected;
  const activeWif = authWif || wallet?.wif;
  const activeAddress = user?.address || wallet?.address || '';
  const [object, setObject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showGive, setShowGive] = useState(false);
  const [showBurn, setShowBurn] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [showList, setShowList] = useState(false);

  const identifier = lookupByAddress ? address : paramTxid;
  const apiPath = lookupByAddress ? `object/addr/${address}` : `object/${paramTxid}`;
  // Resolve txid: prefer URL param, fall back to fetched object data
  const txid = paramTxid || object?.transaction_id || '';

  useEffect(() => {
    if (!identifier) return;

    // If navigated with prefetched object data (e.g., object has no txid),
    // use it directly instead of re-fetching from an unreliable address lookup
    const prefetched = location.state?.prefetchedObject;
    if (prefetched && lookupByAddress) {
      setObject(prefetched);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchObject = async () => {
      // Skip mesh/blockchain for direct object lookups — backend cache is fast
      try {
        const { data, source } = await import('@/utils/meshFirstFetch').then(m =>
          m.meshFirstFetch(`/${apiPath}`, { network }, { timeout: 2000 })
        );
        if (data && !data.error && !data.detail) {
          setObject(data);
          // Cache by URN for future cross-chain lookups
          if (data.urn) cacheByUrn(data.urn, data, null);
          setLoading(false);
          return;
        }
      } catch {}

      // Fallback to direct axios
      try {
        const res = await axios.get(`${API}/${apiPath}`, { params: { network } });
        setObject(res.data);
        if (res.data?.urn) cacheByUrn(res.data.urn, res.data, null);
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load object');
      }
      setLoading(false);
    };

    fetchObject();
  }, [identifier, apiPath, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract IPFS CIDs from object fields (memoized for propagation bar + auto-pin)
  const ipfsCids = React.useMemo(() => {
    if (!object) return [];
    const fields = [object.urn, object.image, object.uri, object.file].filter(Boolean);
    const cids = [];
    for (const f of fields) {
      const m = String(f).match(/^IPFS:([A-Za-z0-9]+)/i);
      if (m) cids.push(m[1]);
    }
    return [...new Set(cids)];
  }, [object?.urn, object?.image, object?.uri, object?.file]);

  // Auto-pin + propagate: when viewing any object, pin its IPFS CIDs to local Kubo
  // and trigger DHT announcement + gateway warming. Every viewer becomes a pinning node.
  useEffect(() => {
    if (ipfsCids.length === 0) return;
    for (const cid of ipfsCids) {
      fetch(`${API}/api/ipfs/propagate/${cid}`, { method: 'POST' }).catch(() => {});
    }
  }, [ipfsCids]);

  // Lazy-load ChangeLog after basic object data renders
  const [changeLog, setChangeLog] = useState(null);
  const [changeLogLoading, setChangeLogLoading] = useState(false);
  useEffect(() => {
    if (!object || !txid) return;
    // If the object already has change_log from cache, use it
    if (object.change_log && object.change_log.length > 0) {
      setChangeLog(object.change_log);
      return;
    }
    setChangeLogLoading(true);
    axios.get(`${API}/object/${txid}/changelog`, { params: { network } })
      .then(res => {
        if (res.data?.change_log) {
          setChangeLog(res.data.change_log);
          // Also backfill dates into object if available
          if (res.data.created_date && (!object.created_date || object.created_date === '0001-01-01T00:00:00')) {
            setObject(prev => ({ ...prev, created_date: res.data.created_date, change_date: res.data.change_date }));
          }
        }
      })
      .catch(() => {})
      .finally(() => setChangeLogLoading(false));
  }, [object?.transaction_id, txid, network]);

  // Tether objects no longer auto-redirect; they show the object page with a "Chat Room" button

  const copyTxid = () => {
    copyToClipboard(txid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (error || !object) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-xl text-gray-400">{error || 'Object not found'}</p>
        <button onClick={() => navigate(-1)} className="text-blue-400 hover:underline" data-testid="back-link">Go Back</button>
      </div>
    );
  }

  const resolved = object.resolved_profiles || {};
  const resolvedName = (addr) => {
    const r = resolved[addr];
    return r?.urn || r?.display_name || `${addr.substring(0, 8)}...${addr.slice(-4)}`;
  };

  // Parse URI (additional reference), URN (primary content/media), and Image (cover thumbnail)
  const mainnet = isMainnetNetwork(network);
  const uriParsed = parseMediaRef(object.uri, mainnet);
  const urnParsed = parseMediaRef(object.urn, mainnet);
  // URN is always primary — it's what the user owns
  const primaryParsed = urnParsed || uriParsed;
  const imageParsed = parseMediaRef(object.image, mainnet);

  // Determine primary content type from URI/URN
  const urnMediaType = primaryParsed ? getMediaType(primaryParsed.extension, primaryParsed.filename, primaryParsed.source) : 'unknown';
  const hasUrnMedia = primaryParsed && ['video', 'audio', 'html', 'image', 'pdf', 'file', 'archive', 'webapp', 'text', 'raw-text', 'web-link'].includes(urnMediaType);

  // Domain redirect: URN is plain text (domain name) + URI is a URL target
  const isDomainRedirect = urnMediaType === 'raw-text' && primaryParsed?.rawText
    && object.uri && /^(https?:\/\/|p2fk:\/\/)/.test(object.uri);

  // If URN has playable content -> URN is primary, Image is thumbnail
  // If URN is null or not media -> Image is primary (current behavior)

  /** Render the primary content area */
  const renderPrimaryContent = () => {
    if (isDomainRedirect) {
      return <DomainRedirectCard
        domainName={primaryParsed.rawText}
        targetUri={object.uri}
        imageUrl={imageParsed?.url}
        imageFallbackUrl={imageParsed?.fallbackUrl}
      />;
    }

    if (hasUrnMedia && primaryParsed) {
      switch (urnMediaType) {
        case 'webapp':
          return <ZipAppViewer ipfsUrl={primaryParsed.url} filename={primaryParsed.filename} />;
        case 'video':
          return <VideoPlayer src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} poster={imageParsed?.url} posterFallback={imageParsed?.fallbackUrl} filename={primaryParsed.filename} source={primaryParsed.source} chain={primaryParsed.chain} />;
        case 'audio':
          return <AudioPlayer src={primaryParsed.url} coverUrl={imageParsed?.url} coverFallbackUrl={imageParsed?.fallbackUrl} filename={primaryParsed.filename} fallbackSrc={primaryParsed.fallbackUrl} source={primaryParsed.source} chain={primaryParsed.chain} />;
        case 'html':
          return <HtmlViewer src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} filename={primaryParsed.filename} source={primaryParsed.source || primaryParsed.type} chain={primaryParsed.chain} />;
        case 'image':
          return <ImageViewer src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} alt={object.name} source={primaryParsed.source} chain={primaryParsed.chain} />;
        case 'text':
          return <TextContentViewer src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} objectName={object.name} chain={primaryParsed.chain} />;
        case 'raw-text':
          return <RawTextViewer text={primaryParsed.rawText} objectName={object.name} />;
        case 'web-link':
          return (
            <div className="bg-gray-800/50 rounded-lg p-6 flex flex-col items-center gap-4 border border-blue-500/20" data-testid="web-link-card">
              <div className="w-16 h-16 bg-blue-900/30 rounded-xl flex items-center justify-center">
                <FiExternalLink size={28} className="text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-200 font-medium">{primaryParsed.filename}</p>
                <p className="text-xs text-gray-500 mt-1">External website</p>
              </div>
              <a href={primaryParsed.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg btn-accent" data-testid="web-link-open">
                <FiExternalLink size={14} /> Open Website
              </a>
            </div>
          );
        case 'pdf':
          return <PdfViewer src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} source={primaryParsed.source} chain={primaryParsed.chain} />;
        default:
          return <FileDownload src={primaryParsed.url} fallbackSrc={primaryParsed.fallbackUrl} filename={primaryParsed.filename} extension={primaryParsed.extension} source={primaryParsed.source} chain={primaryParsed.chain} />;
      }
    }

    // No URN media - show Image as primary
    if (imageParsed) {
      return <ImageViewer src={imageParsed.url} fallbackSrc={imageParsed.fallbackUrl} alt={object.name} source={imageParsed.source} chain={imageParsed.chain} />;
    }

    // No media at all — display object name as styled text card
    const textBgColors = [
      'from-indigo-900 to-slate-900',
      'from-emerald-900 to-cyan-950',
      'from-rose-950 to-purple-950',
      'from-amber-900 to-orange-950',
      'from-sky-900 to-blue-950',
      'from-teal-900 to-slate-900',
      'from-fuchsia-950 to-indigo-950',
      'from-lime-900 to-emerald-950',
    ];
    const objName = object.name || 'Unnamed';
    const nameHash = objName.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const bgIdx = Math.abs(nameHash) % textBgColors.length;
    return (
      <div className={`bg-gradient-to-br ${textBgColors[bgIdx]} rounded-lg flex items-center justify-center`}
           style={{ minHeight: '320px' }}
           data-testid="text-object-display">
        <span className="font-serif text-center text-gray-100 leading-relaxed px-8 py-12 select-none" style={{
          fontSize: objName.length > 80 ? '1rem' : objName.length > 40 ? '1.4rem' : objName.length > 20 ? '1.8rem' : objName.length > 10 ? '2.4rem' : '3rem',
          wordBreak: 'break-word',
          textShadow: '0 2px 12px rgba(0,0,0,0.5)',
          maxWidth: '100%',
        }}>
          {objName}
        </span>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }} data-testid="single-object-page">
      {/* Top bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-3 -ml-3 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors flex-shrink-0" data-testid="back-button">
          <FiArrowLeft size={22} />
        </button>
        <h2 className="text-base sm:text-lg font-bold text-gray-100 truncate flex-1">{object.name}</h2>
        {object.is_listed && (
          <span className="px-3 py-1 bg-emerald-600/20 text-emerald-400 text-xs font-semibold rounded-full flex-shrink-0" data-testid="listed-badge">
            For Sale
          </span>
        )}
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Media + Description */}
          <div className="lg:col-span-3">
            {/* Primary Content Area */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden" data-testid="object-media">
              <div className="p-4">
                {renderPrimaryContent()}
              </div>
            </div>

            {/* IPFS Propagation Status */}
            {ipfsCids.length > 0 && <IpfsPropagationBar cids={ipfsCids} />}

            {/* Description + Thumbnail (when URN has primary media, Image becomes thumbnail here) */}
            {object.description && (
              <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-description">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Description</h3>
                <div className="flex gap-4">
                  {/* Show Image as thumbnail next to description when URN is the primary content (skip for domain redirects — image already shown in card) */}
                  {hasUrnMedia && imageParsed && urnMediaType !== 'audio' && !isDomainRedirect && (
                    <div className="flex-shrink-0" data-testid="description-thumbnail">
                      <img
                        src={imageParsed.url}
                        alt={object.name}
                        className="w-24 h-24 object-cover rounded-lg border border-gray-700"
                        onError={e => {
                          if (imageParsed.fallbackUrl && e.target.src !== imageParsed.fallbackUrl) {
                            e.target.src = imageParsed.fallbackUrl;
                          } else {
                            e.target.style.display = 'none';
                          }
                        }}
                      />
                    </div>
                  )}
                  <p className="text-gray-300 whitespace-pre-wrap text-sm leading-relaxed flex-1">{object.description}</p>
                </div>
              </div>
            )}

            {/* On-Chain Age Badge */}
            {object.created_date && (
              <div className="mt-4">
                <OnChainAgeBadge createdDate={object.created_date} />
              </div>
            )}

            {/* Owners Table */}
            <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-owners">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <FiUsers size={14} /> Owners ({object.owner_count})
              </h3>
              <div className="space-y-3">
                {object.owners.map((owner, idx) => {
                  const isCreator = object.creators.some(c => c.address === owner.address);
                  const rp = resolved[owner.address];
                  const displayName = rp?.urn || rp?.display_name;
                  return (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                      <div className="flex items-center gap-2">
                        {displayName ? (
                          <span className="text-sm text-gray-200 font-medium">{displayName}</span>
                        ) : (
                          <AddressLabel address={owner.address} network={network} className="text-sm" />
                        )}
                        {isCreator && (
                          <span className="px-1.5 py-0.5 bg-purple-500/15 text-purple-400 text-[10px] font-semibold rounded" data-testid="creator-badge">
                            Creator
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-gray-400 font-mono">{owner.quantity.toLocaleString()} units</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Offers */}
            {object.offers && object.offers.length > 0 && (
              <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-offers">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Offers ({object.offer_count})
                </h3>
                <div className="space-y-3">
                  {object.offers.map((offer, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                      <AddressLabel address={offer.requestor} network={network} className="text-sm" />
                      <div className="text-right">
                        <span className="text-sm font-semibold text-amber-400">{offer.price} BTC</span>
                        <span className="text-xs text-gray-500 ml-2">x{offer.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Object History / ChangeLog */}
            <div className="mt-6">
              <ObjectHistory
                changeLog={changeLog || object.change_log}
                resolvedProfiles={resolved}
                network={network}
                createdDate={object.created_date}
                lockedDate={object.locked_date}
                loading={changeLogLoading}
              />
            </div>
          </div>

          {/* Right: Info + Actions */}
          <div className="lg:col-span-2 space-y-6">
            {/* Price & Actions Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-actions-card">
              {object.is_listed ? (
                <>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Price</p>
                  <p className="text-3xl font-bold text-white mb-1" data-testid="object-price">
                    {object.min_price === 0 ? 'FREE' : `${object.min_price} BTC`}
                  </p>
                  {object.listings.length > 0 && (
                    <p className="text-xs text-gray-500 mb-6">
                      {object.listings[0].quantity.toLocaleString()} available from{' '}
                      <AddressLabel address={object.listings[0].owner} network={network} className="text-xs" />
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500 mb-6">Not currently listed for sale</p>
              )}

              <div className="space-y-3">
                {!isConnected && (
                  <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-400 flex items-center gap-2 mb-1">
                    <FiCreditCard size={14} className="flex-shrink-0" />
                    Connect a wallet from the sidebar to interact with objects
                  </div>
                )}
                <button
                  onClick={() => {
                    if (!isConnected) { alert('Connect a wallet first from the sidebar.'); return; }
                    setShowBuy(true);
                  }}
                  disabled={!object.is_listed}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-semibold"
                  data-testid="buy-button"
                >
                  <FiShoppingCart size={18} />
                  {object.is_listed ? (object.min_price === 0 ? 'Claim (Free)' : 'Buy Now') : 'Not For Sale'}
                </button>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => {
                      if (!isConnected) { alert('Connect a wallet first from the sidebar.'); return; }
                      setShowGive(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium"
                    data-testid="give-button"
                  >
                    <FiGift size={16} />
                    Give
                  </button>
                  <button
                    onClick={() => {
                      if (!isConnected) { alert('Connect a wallet first from the sidebar.'); return; }
                      setShowList(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-blue-900/30 text-gray-300 hover:text-blue-400 rounded-lg transition-colors text-sm font-medium"
                    data-testid="list-button"
                  >
                    <FiTag size={16} />
                    List
                  </button>
                  <button
                    onClick={() => {
                      if (!isConnected) { alert('Connect a wallet first from the sidebar.'); return; }
                      setShowBurn(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-red-900/30 text-gray-300 hover:text-red-400 rounded-lg transition-colors text-sm font-medium"
                    data-testid="burn-button"
                  >
                    <FiTrash2 size={16} />
                    Burn
                  </button>
                </div>

                {/* Chat Room + Tether */}
                {(object.object_address || (object.creators && object.creators[0]?.address)) && (
                  <div className="flex gap-3 mt-1">
                    <button
                      onClick={() => navigate(`/room/${object.object_address || object.creators[0]?.address}`)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 rounded-lg transition-colors text-sm font-medium border border-purple-700/30"
                      data-testid="open-room-btn"
                    >
                      <FiMessageSquare size={16} />
                      Chat Room
                    </button>
                    <TetherButton objectAddress={object.object_address || object.creators[0]?.address} objectName={object.name} objectImage={object.image} network={network} />
                  </div>
                )}
              </div>
            </div>

            {/* Details Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4" data-testid="object-details-card">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Supply</span>
                  <span className="text-gray-200 font-mono">{object.total_supply.toLocaleString()}</span>
                </div>
                {object.maximum > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max Supply</span>
                    <span className="text-gray-200 font-mono">{object.maximum.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Owners</span>
                  <span className="text-gray-200">{object.owner_count}</span>
                </div>
                {object.license && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">License</span>
                    <span className="text-gray-200">{object.license}</span>
                  </div>
                )}
                {/* Show content file info */}
                {hasUrnMedia && primaryParsed?.filename && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Content</span>
                    <span className="text-gray-200 text-xs truncate max-w-[160px]">{primaryParsed.filename}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1"><FiClock size={12} /> Created</span>
                  <span className="text-gray-200">{object.created_date ? new Date(object.created_date).toLocaleDateString() : '\u2014'}</span>
                </div>
                {object.locked_date && object.locked_date !== '0001-01-01T00:00:00' && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 flex items-center gap-1"><FiLock size={12} /> Locked</span>
                    <span className="text-gray-200">{new Date(object.locked_date).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Creators Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-creators">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Creators</h3>
              <div className="space-y-2">
                {object.creators.map((c, idx) => {
                  const isAlsoOwner = object.owners.some(o => o.address === c.address);
                  const rp = resolved[c.address];
                  const displayName = rp?.urn || rp?.display_name;
                  const isObjectSelf = rp?.is_object;
                  const isCollection = rp?.is_collection;
                  // Non-object resolved profiles are either collections or user profiles — make them clickable
                  const isClickable = !isObjectSelf && (displayName || isCollection);
                  const handleClick = () => {
                    if (!isClickable) return;
                    navigate(`/profile/${c.address}`);
                  };
                  return (
                    <div key={idx} className="flex items-center gap-3 py-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isObjectSelf ? 'bg-gray-800 text-gray-600' :
                        isCollection ? 'bg-violet-900/50 text-violet-400' :
                        'bg-purple-900/50 text-purple-400'
                      }`}>
                        {idx + 1}
                      </div>
                      {displayName ? (
                        <button
                          onClick={handleClick}
                          disabled={!isClickable}
                          className={`text-sm font-medium ${isClickable ? 'text-blue-400 hover:underline cursor-pointer' : 'text-gray-200 cursor-default'}`}
                          data-testid={`creator-${idx}`}
                        >
                          {displayName}
                        </button>
                      ) : (
                        <button
                          onClick={handleClick}
                          disabled={!isClickable}
                          className={`text-sm ${isClickable ? 'cursor-pointer' : ''}`}
                          data-testid={`creator-${idx}`}
                        >
                          <AddressLabel address={c.address} network={network} className="text-sm" />
                        </button>
                      )}
                      {isObjectSelf && (
                        <span className="px-1.5 py-0.5 bg-gray-700/50 text-gray-500 text-[10px] font-semibold rounded">
                          This Object
                        </span>
                      )}
                      {isCollection && (
                        <span className="px-1.5 py-0.5 bg-violet-500/15 text-violet-400 text-[10px] font-semibold rounded">
                          Collection
                        </span>
                      )}
                      {isAlsoOwner && !isObjectSelf && (
                        <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold rounded" data-testid="self-owned-badge">
                          Owner
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Royalties Card */}
            {object.royalties && Object.keys(object.royalties).length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-royalties">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FiPercent size={14} /> Royalties
                </h3>
                <div className="space-y-2">
                  {Object.entries(object.royalties).map(([addr, pct], idx) => {
                    const rp = resolved[addr];
                    const displayName = rp?.urn || rp?.display_name;
                    return (
                      <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                        {displayName ? (
                          <span className="text-sm text-gray-200 font-medium">{displayName}</span>
                        ) : (
                          <AddressLabel address={addr} network={network} className="text-sm" />
                        )}
                        <span className="text-sm font-semibold text-amber-400">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-600 mt-3">Royalties are automatically deducted from sales.</p>
              </div>
            )}

            {/* Transaction Info */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-tx-info">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Transaction</h3>
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-400 font-mono truncate flex-1">{txid}</code>
                <button onClick={copyTxid} className="text-gray-500 hover:text-white transition-colors" data-testid="copy-txid">
                  <FiCopy size={14} />
                </button>
              </div>
              {copied && <p className="text-xs text-emerald-400 mt-1">Copied!</p>}
              <a
                href={`https://mempool.space/${network?.includes('mainnet') ? '' : 'testnet/'}tx/${txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm transition-colors"
                data-testid="mempool-link"
              >
                <FiExternalLink size={14} /> View on Mempool
              </a>
            </div>

            {/* Listings Detail */}
            {object.listings.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-listings">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Active Listings</h3>
                <div className="space-y-3">
                  {object.listings.map((l, idx) => (
                    <div key={idx} className="bg-gray-800/50 rounded-lg p-3">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-gray-300 font-semibold">
                          {l.price === 0 ? 'FREE' : `${l.price} BTC`}
                        </span>
                        <span className="text-xs text-gray-500">{l.quantity.toLocaleString()} available</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        Seller: <AddressLabel address={l.owner} network={network} className="text-xs" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Modals */}
      {showGive && <GiveModal object={object} network={network} onClose={() => setShowGive(false)} />}
      {showBurn && <BurnModal object={object} network={network} onClose={() => setShowBurn(false)} />}
      {showBuy && <BuyModal object={object} network={network} onClose={() => setShowBuy(false)} />}
      {showList && <ListModal object={object} network={network} onClose={() => setShowList(false)} />}
    </div>
  );
}
