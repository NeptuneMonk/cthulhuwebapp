import React from 'react';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';

/**
 * Drop-in replacement for <img> that caches IPFS content in IndexedDB.
 * Non-IPFS URLs pass through unchanged.
 * Shows subtle "cached" hover tooltip when served from local cache.
 */
export const CachedImage = ({ src, alt, className, style, onLoad, onError, loading, ...props }) => {
  const isIPFS = src && src.includes('/ipfs/');
  const { url: cachedSrc, fromCache } = useCachedIPFS(isIPFS ? src : null);
  const finalSrc = isIPFS ? cachedSrc : src;

  return (
    <div className="group relative inline-block">
      <img
        src={finalSrc}
        alt={alt}
        className={className}
        style={style}
        onLoad={onLoad}
        onError={onError}
        loading={loading}
        {...props}
      />
      {fromCache && (
        <div className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-gray-950/80 text-[8px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          cached
        </div>
      )}
    </div>
  );
};
