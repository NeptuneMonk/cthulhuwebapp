/**
 * Safe binary ↔ base64 conversions for large byte arrays.
 * 
 * The naive `btoa(String.fromCharCode(...uint8Array))` blows the call stack
 * for arrays > ~100KB because the spread creates millions of arguments.
 * These chunked versions work with any size.
 */

/**
 * Convert a Uint8Array to a base64 string (safe for multi-MB arrays).
 */
export function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Convert a base64 string back to a Uint8Array (safe for large strings).
 */
export function base64ToUint8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
