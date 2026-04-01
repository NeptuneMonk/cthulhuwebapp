import React, { useState, useRef, useCallback } from 'react';
import { getProfileImageUrl, parseMediaString } from '@/utils/media';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';

/**
 * Profile avatar thumbnail. Renders IPFS image if available (with IndexedDB cache), else initials.
 * Long-press (or right-click) copies the associated address to clipboard.
 */
export const ProfileThumb = ({ name, image, size = 'md', address }) => {
  const sizes = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    'dm-header': 'w-[44px] h-[44px] text-base',
    xl: 'w-24 h-24 text-3xl',
  };

  const parsed = parseMediaString(image);
  const imageUrl = parsed?.url || null;
  const fallbackUrl = parsed?.fallbackUrl || null;
  const isIPFS = imageUrl && imageUrl.includes('/ipfs/');
  const { url: cachedUrl } = useCachedIPFS(isIPFS ? imageUrl : null);
  const [useFallback, setUseFallback] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  const finalUrl = useFallback ? fallbackUrl : (isIPFS ? cachedUrl : imageUrl);
  const initials = (name || '?').substring(0, 2).toUpperCase();

  const copyAddr = useCallback(() => {
    const toCopy = address || name;
    if (!toCopy) return;
    navigator.clipboard.writeText(toCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [address, name]);

  // Long-press handlers for mobile
  const onTouchStart = useCallback((e) => {
    timerRef.current = setTimeout(() => {
      e.preventDefault();
      copyAddr();
    }, 500);
  }, [copyAddr]);

  const onTouchEnd = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Right-click for desktop
  const onContextMenu = useCallback((e) => {
    if (address) {
      e.preventDefault();
      copyAddr();
    }
  }, [address, copyAddr]);

  const handlers = address ? { onTouchStart, onTouchEnd, onTouchCancel: onTouchEnd, onContextMenu } : {};

  const wrapper = (child) => (
    <div className="relative inline-flex flex-shrink-0" {...handlers}>
      {child}
      {copied && (
        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gray-800 border border-gray-600 text-[10px] text-green-400 rounded whitespace-nowrap z-50 shadow-lg" data-testid="copy-toast">
          Copied!
        </div>
      )}
    </div>
  );

  if (finalUrl && !imgFailed) {
    return wrapper(
      <img
        src={finalUrl}
        alt={name || 'Profile'}
        className={`${sizes[size]} rounded-full object-cover flex-shrink-0`}
        onError={() => {
          if (!useFallback && fallbackUrl && fallbackUrl !== finalUrl) {
            setUseFallback(true);
          } else {
            setImgFailed(true);
          }
        }}
      />
    );
  }

  return wrapper(
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-bold flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-600 text-white`}
    >
      {initials}
    </div>
  );
};
