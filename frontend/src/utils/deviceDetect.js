/**
 * Device detection utilities for platform-specific optimizations.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
export const isChrome = /Chrome/.test(ua) && !/Edge|Edg/.test(ua);
export const isEdge = /Edg\//.test(ua);
export const isMobile = isIOS || isAndroid || /Mobile/.test(ua);
export const isDesktop = !isMobile;
export const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
export const isPWA = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

/**
 * Get a human-readable device label for analytics or UI.
 */
export function getDeviceLabel() {
  if (isIOS) return isPWA ? 'iOS (PWA)' : `iOS (${isSafari ? 'Safari' : 'Chrome'})`;
  if (isAndroid) return isPWA ? 'Android (PWA)' : 'Android (Chrome)';
  if (isEdge) return 'Desktop (Edge)';
  if (isChrome) return 'Desktop (Chrome)';
  return 'Desktop';
}
