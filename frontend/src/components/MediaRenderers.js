import React from 'react';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';

/**
 * Renders IPFS media (image, audio, video) with local IndexedDB caching.
 * Shows a subtle hover tooltip when content is served from cache.
 */
export const IPFSMedia = ({ url, filename, extension }) => {
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  const videoExts = ['webm', 'mov', 'mp4', 'avi', 'mkv'];
  const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac'];
  const isIPFS = url && url.includes('/ipfs/');
  const { url: cachedUrl, fromCache } = useCachedIPFS(isIPFS ? url : null);
  const src = isIPFS ? cachedUrl : url;

  const CacheTooltip = ({ children }) => (
    <div className="group relative">
      {children}
      {fromCache && (
        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-gray-950/95 border border-gray-700/40 text-[10px] text-gray-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
          Cached locally — ownership is on-chain/IPFS
        </div>
      )}
    </div>
  );

  if (imageExts.includes(extension)) {
    return (
      <CacheTooltip>
        <div className="mt-3">
          <img src={src} alt={filename} className="max-w-full rounded-lg border border-gray-700" loading="lazy" />
          <p className="text-xs text-gray-500 mt-1">{filename}</p>
        </div>
      </CacheTooltip>
    );
  }

  if (audioExts.includes(extension)) {
    return (
      <CacheTooltip>
        <div className="mt-3">
          <audio controls className="w-full">
            <source src={src} type={`audio/${extension === 'mp3' ? 'mpeg' : extension}`} />
          </audio>
          <p className="text-xs text-gray-500 mt-1">{filename}</p>
        </div>
      </CacheTooltip>
    );
  }

  if (videoExts.includes(extension)) {
    return (
      <CacheTooltip>
        <div className="mt-3">
          <video controls className="max-w-full rounded-lg border border-gray-700" preload="metadata">
            <source src={src} type={`video/${extension === 'mkv' ? 'x-matroska' : extension}`} />
          </video>
          <p className="text-xs text-gray-500 mt-1">{filename}</p>
        </div>
      </CacheTooltip>
    );
  }

  return (
    <div className="mt-3">
      <a href={src} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm">
        {filename}
      </a>
    </div>
  );
};

/**
 * Displays on-chain-only media placeholder.
 */
export const OnChainMedia = ({ chain, filename }) => (
  <div className="mt-3 bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
    <p className="text-gray-400 text-sm font-medium">This media is fully on-chain</p>
    <p className="text-gray-500 text-xs mt-1">Download SUP to see media.</p>
    {chain && (
      <p className="text-gray-500 text-xs mt-1">
        You will need SUP and will need to sync {chain === 'BTC' ? 'Bitcoin' : chain === 'LTC' ? 'Litecoin' : chain === 'DOGE' ? 'Dogecoin' : chain} node.
      </p>
    )}
    {filename && <p className="text-gray-600 text-xs mt-2">{filename}</p>}
  </div>
);
