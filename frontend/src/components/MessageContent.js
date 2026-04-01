import React, { useState, useEffect } from 'react';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';
import { FiFile, FiLoader, FiDownload, FiMaximize2, FiX } from 'react-icons/fi';
import { LinkPreview } from '@/components/LinkPreview';

/**
 * Parse SUP protocol message content and render inline media.
 * Formats:
 *   <<IPFS:CID\filename>> or <<IPFS:CID/filename>> for IPFS-hosted media
 *   <<txid/filename>> for on-chain (BTC) file references (64-hex-char txid)
 *   <<-12345>> for metadata (stripped)
 *   << #tags >> for tag blocks (stripped)
 */

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const API = process.env.REACT_APP_BACKEND_URL + '/api';

function parseMessageParts(content) {
  if (!content) return [];
  const parts = [];
  // Match IPFS refs, on-chain txid refs, or any other <<...>> block
  const regex = /<<(IPFS:([A-Za-z0-9]+)[\\/]?([^>]*))>>|<<([0-9a-f]{64}[\\/][^>]*)>>|<<[^>]*>>/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', value: content.slice(lastIdx, match.index) });
    }

    if (match[1]) {
      // IPFS reference: <<IPFS:CID/filename>>
      const cid = match[2];
      const filename = match[3] || '';
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const url = filename
        ? `${IPFS_GATEWAY}${cid}/${filename}`
        : `${IPFS_GATEWAY}${cid}`;

      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
        parts.push({ type: 'image', url, filename, cid });
      } else if (['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext) || (ext === 'webm' && /voice|audio|record/i.test(filename))) {
        parts.push({ type: 'audio', url, filename, cid });
      } else if (['mp4', 'webm', 'mov'].includes(ext)) {
        parts.push({ type: 'video', url, filename, cid });
      } else {
        parts.push({ type: 'image', url, filename: filename || cid, cid });
      }
    } else if (match[4]) {
      // On-chain txid reference: <<txid/filename>>
      const raw = match[4];
      const slashIdx = raw.indexOf('/') !== -1 ? raw.indexOf('/') : raw.indexOf('\\');
      const filename = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
      parts.push({ type: 'onchain-file', filename, ref: raw });
    }
    // All other <<...>> blocks (numbers, tags, etc.) are silently consumed/stripped

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIdx) });
  }

  return parts;
}

const InlineImage = ({ url, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { url: cachedUrl, fromCache } = useCachedIPFS(url);

  if (error) return null;

  return (
    <>
      <div
        className="group relative my-2 rounded-lg overflow-hidden cursor-pointer inline-block max-w-full"
        onClick={() => loaded && setExpanded(true)}
        data-testid="inline-ipfs-image"
      >
        {!loaded && (
          <div className="w-full h-32 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 animate-pulse rounded-lg" />
        )}
        <img
          src={cachedUrl}
          alt={alt}
          className={`max-w-full max-h-64 rounded-lg object-contain transition-opacity ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        {fromCache && loaded && (
          <div className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-gray-950/80 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            cached
          </div>
        )}
      </div>
      {expanded && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <img src={cachedUrl} alt={alt} className="max-w-[95vw] max-h-[95vh] object-contain" />
        </div>
      )}
    </>
  );
};

const InlineVideo = ({ url }) => {
  const { url: cachedUrl, fromCache } = useCachedIPFS(url);
  return (
    <div className="group relative inline-block my-2">
      <video src={cachedUrl} controls className="max-w-full max-h-64 rounded-lg" data-testid="inline-ipfs-video" />
      {fromCache && (
        <div className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-gray-950/80 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          cached
        </div>
      )}
    </div>
  );
};

const InlineAudio = ({ url }) => {
  const { url: cachedUrl } = useCachedIPFS(url);
  return (
    <audio src={cachedUrl} controls className="w-full my-2" data-testid="inline-ipfs-audio" />
  );
};

const OnChainMedia = ({ fileRef, filename }) => {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [blobUrl, setBlobUrl] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Determine network from localStorage
  const network = (() => {
    try { return localStorage.getItem('cthulhu_network') || 'btc-testnet'; } catch { return 'btc-testnet'; }
  })();
  const isMainnet = network.includes('mainnet');
  const chain = network.startsWith('ltc') ? 'LTC' : network.startsWith('doge') ? 'DOGE' : 'BTC';

  const slashIdx = fileRef.indexOf('/') !== -1 ? fileRef.indexOf('/') : fileRef.indexOf('\\');
  const txid = slashIdx >= 0 ? fileRef.slice(0, slashIdx) : fileRef;
  const fname = slashIdx >= 0 ? fileRef.slice(slashIdx + 1) : filename;
  const ext = fname.split('.').pop()?.toLowerCase() || '';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
  const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext);

  const apiUrl = `${API}/onchain/file/${txid}/${fname}?chain=${chain}&mainnet=${isMainnet}`;

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 8;

    const fetchFile = async () => {
      try {
        const res = await fetch(apiUrl);
        if (res.status === 202) {
          // Still resolving — retry with backoff
          if (retryCount < maxRetries && !cancelled) {
            retryCount++;
            setTimeout(fetchFile, 2000 * retryCount);
          } else {
            setStatus('error');
          }
          return;
        }
        if (!res.ok) { setStatus('error'); return; }
        const blob = await res.blob();
        if (!cancelled) {
          setBlobUrl(URL.createObjectURL(blob));
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    fetchFile();
    return () => { cancelled = true; };
  }, [apiUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 my-1 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50 text-xs text-gray-400" data-testid="onchain-file-loading">
        <FiLoader size={14} className="text-amber-500 shrink-0 animate-spin" />
        <span className="truncate">{fname}</span>
        <span className="text-gray-600 text-[10px]">resolving on-chain...</span>
      </div>
    );
  }

  if (status === 'error' || !blobUrl) {
    return (
      <div className="flex items-center gap-2 my-1 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700/50 text-xs text-gray-400" data-testid="onchain-file-ref">
        <FiFile size={14} className="text-amber-500 shrink-0" />
        <a href={apiUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:text-amber-400 underline">{fname}</a>
        <span className="text-gray-600 text-[10px]">on-chain</span>
      </div>
    );
  }

  if (isImage) {
    return (
      <>
        <div
          className="group relative my-2 rounded-lg overflow-hidden cursor-pointer inline-block max-w-full"
          onClick={() => setExpanded(true)}
          data-testid="onchain-image"
        >
          <img src={blobUrl} alt={fname} className="max-w-full max-h-64 rounded-lg object-contain" />
          <div className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-gray-950/80 text-[8px] text-amber-500/70 opacity-0 group-hover:opacity-100 transition-opacity">
            on-chain
          </div>
        </div>
        {expanded && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 cursor-pointer" onClick={() => setExpanded(false)}>
            <img src={blobUrl} alt={fname} className="max-w-[95vw] max-h-[95vh] object-contain" />
          </div>
        )}
      </>
    );
  }

  if (isVideo) {
    return (
      <div className="group relative inline-block my-2">
        <video src={blobUrl} controls className="max-w-full max-h-64 rounded-lg" data-testid="onchain-video" />
        <div className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-gray-950/80 text-[8px] text-amber-500/70 opacity-0 group-hover:opacity-100 transition-opacity">
          on-chain
        </div>
      </div>
    );
  }

  if (isAudio) {
    return <audio src={blobUrl} controls className="w-full my-2" data-testid="onchain-audio" />;
  }

  // Generic file — download link
  return (
    <div className="flex items-center gap-2 my-1 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700/50 text-xs text-gray-400" data-testid="onchain-file-ref">
      <FiFile size={14} className="text-amber-500 shrink-0" />
      <a href={blobUrl} download={fname} className="truncate hover:text-amber-400 underline">{fname}</a>
      <span className="text-gray-600 text-[10px]">on-chain</span>
    </div>
  );
};


const BITFOSSIL_BASE = 'https://bitfossil.com';

const FileAttachment = ({ filename, fileSize, txid }) => {
  const [expanded, setExpanded] = useState(false);
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  const isVideo = ['mp4', 'webm', 'mov'].includes(ext);
  const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext);

  const bitfossilFileUrl = `${BITFOSSIL_BASE}/${txid}/${encodeURIComponent(filename)}`;

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  if (isPdf) {
    return (
      <>
        <div className="my-2 rounded-lg overflow-hidden border border-gray-700/50 bg-gray-800/50" data-testid="file-attachment-pdf">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-800/80 border-b border-gray-700/50">
            <div className="flex items-center gap-2 min-w-0">
              <FiFile size={14} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-gray-200 font-medium truncate">{filename}</span>
              {fileSize && <span className="text-[10px] text-gray-600 flex-shrink-0">{formatSize(fileSize)}</span>}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 text-gray-500 hover:text-white rounded transition-colors"
                title={expanded ? 'Collapse' : 'Expand PDF'}
                data-testid="pdf-expand-btn"
              >
                {expanded ? <FiX size={13} /> : <FiMaximize2 size={13} />}
              </button>
              <a
                href={bitfossilFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 text-gray-500 hover:text-blue-400 rounded transition-colors"
                title="Open PDF"
                data-testid="pdf-open-link"
              >
                <FiDownload size={13} />
              </a>
            </div>
          </div>
          {expanded ? (
            <iframe
              src={bitfossilFileUrl}
              title={filename}
              className="w-full border-0"
              style={{ height: '600px' }}
              data-testid="pdf-iframe"
            />
          ) : (
            <button
              onClick={() => setExpanded(true)}
              className="w-full py-4 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
              data-testid="pdf-preview-btn"
            >
              Click to view PDF
            </button>
          )}
        </div>
      </>
    );
  }

  if (isImage) {
    return (
      <div className="my-2" data-testid="file-attachment-image">
        <img
          src={bitfossilFileUrl}
          alt={filename}
          className="max-w-full max-h-64 rounded-lg object-contain"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <a href={bitfossilFileUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 inline-block"
        >{filename} {fileSize ? `(${formatSize(fileSize)})` : ''}</a>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="my-2" data-testid="file-attachment-video">
        <video src={bitfossilFileUrl} controls className="max-w-full max-h-64 rounded-lg" />
        <a href={bitfossilFileUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 inline-block"
        >{filename}</a>
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="my-2" data-testid="file-attachment-audio">
        <audio src={bitfossilFileUrl} controls className="w-full" />
        <a href={bitfossilFileUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-gray-600 hover:text-gray-400 mt-0.5 inline-block"
        >{filename}</a>
      </div>
    );
  }

  // Generic file — card with direct file link
  return (
    <div className="my-2 flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700/50" data-testid="file-attachment-generic">
      <FiFile size={14} className="text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <a href={bitfossilFileUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-gray-200 hover:text-amber-400 font-medium truncate block transition-colors"
        >{filename}</a>
        {fileSize && <span className="text-[10px] text-gray-600">{formatSize(fileSize)}</span>}
      </div>
      <a href={bitfossilFileUrl} target="_blank" rel="noopener noreferrer"
        className="text-gray-500 hover:text-blue-400 flex-shrink-0 transition-colors p-1"
        title="Download"
      ><FiDownload size={13} /></a>
    </div>
  );
};

const TextSegment = ({ text }) => {
  // Split on URLs, @mentions, and #hashtags
  const tokenRegex = /(https?:\/\/[^\s<>]+)|(@[A-Za-z0-9_]+)|(#[A-Za-z0-9_]+)/g;
  const tokens = [];
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: 'plain', value: text.slice(lastIdx, match.index) });
    }
    if (match[1]) tokens.push({ type: 'url', value: match[1] });
    else if (match[2]) tokens.push({ type: 'mention', value: match[2] });
    else if (match[3]) tokens.push({ type: 'hashtag', value: match[3] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) tokens.push({ type: 'plain', value: text.slice(lastIdx) });

  return (
    <span>
      {tokens.map((t, i) => {
        if (t.type === 'url') {
          // Clean trailing punctuation that's likely not part of the URL
          let url = t.value.replace(/[).,;:!?]+$/, '');
          let trailing = t.value.slice(url.length);
          let display = url.replace(/^https?:\/\/(www\.)?/, '');
          if (display.length > 50) display = display.slice(0, 47) + '...';
          return (
            <span key={i}>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-teal-400 hover:text-teal-300 underline underline-offset-2 decoration-teal-700 hover:decoration-teal-500 transition-colors break-all"
                data-testid="post-link"
                onClick={e => e.stopPropagation()}
              >{display}</a>{trailing}
            </span>
          );
        }
        if (t.type === 'mention') {
          const urn = t.value.slice(1); // strip @
          return (
            <a key={i} href={`/search?q=${encodeURIComponent(urn)}`}
              className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
              data-testid="post-mention"
              onClick={e => e.stopPropagation()}
            >{t.value}</a>
          );
        }
        if (t.type === 'hashtag') {
          return (
            <a key={i} href={`/search?q=${encodeURIComponent(t.value)}`}
              className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
              data-testid="post-hashtag"
              onClick={e => e.stopPropagation()}
            >{t.value}</a>
          );
        }
        return <span key={i}>{t.value}</span>;
      })}
    </span>
  );
};

export const MessageContent = ({ content, files, txid }) => {
  const parts = parseMessageParts(content);

  if (parts.length === 0 && !files) return null;

  // Collect all URLs from text parts for link previews
  const urls = [];
  for (const part of parts) {
    if (part.type === 'text') {
      const urlMatches = part.value.match(/https?:\/\/[^\s<>]+/g);
      if (urlMatches) {
        for (const u of urlMatches) {
          const clean = u.replace(/[).,;:!?]+$/, '');
          if (!urls.includes(clean)) urls.push(clean);
        }
      }
    }
  }

  // File attachments from the root's File field
  const fileEntries = files && typeof files === 'object' ? Object.entries(files) : [];

  return (
    <div className="space-y-1" data-testid="message-content">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          const trimmed = part.value.trim();
          if (!trimmed) return null;
          return (
            <p key={i} className="text-gray-300 text-sm whitespace-pre-wrap break-words">
              <TextSegment text={trimmed} />
            </p>
          );
        }
        if (part.type === 'image') {
          return <InlineImage key={i} url={part.url} alt={part.filename} />;
        }
        if (part.type === 'video') {
          return <InlineVideo key={i} url={part.url} />;
        }
        if (part.type === 'audio') {
          return <InlineAudio key={i} url={part.url} />;
        }
        if (part.type === 'onchain-file') {
          return <OnChainMedia key={i} fileRef={part.ref} filename={part.filename} />;
        }
        return null;
      })}
      {/* File attachments from on-chain File field */}
      {fileEntries.length > 0 && fileEntries.map(([fname, fsize], i) => (
        <FileAttachment key={`file-${i}`} filename={fname} fileSize={fsize} txid={txid} />
      ))}
      {/* Show link previews for the first URL only (to avoid clutter) */}
      {urls.length > 0 && <LinkPreview url={urls[0]} />}
    </div>
  );
};
