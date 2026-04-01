/**
 * Client-side image compression using Canvas API.
 * Used ONLY when the user explicitly opts in (e.g., thumbnail generation).
 * IPFS uploads should always use the original file — no auto-compression.
 */

const DEFAULT_MAX_SIZE = 250 * 1024; // 250KB — for optional thumbnail compression
const DEFAULT_MAX_DIM = 1200;

/**
 * Compress an image file to target size using canvas.
 * @param {File} file - The image file to compress
 * @param {number} maxSize - Max file size in bytes (default 250KB)
 * @param {number} maxDim - Max width/height (default 1200)
 * @returns {Promise<File>} - Compressed file
 */
export async function compressImage(file, maxSize = DEFAULT_MAX_SIZE, maxDim = DEFAULT_MAX_DIM) {
  // Skip if already small enough or not an image
  if (file.size <= maxSize || !file.type.startsWith('image/')) {
    return file;
  }

  const img = await loadImage(file);
  let { width, height } = img;

  // Scale down if too large
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // Try progressively lower quality until under maxSize
  let quality = 0.85;
  let blob = null;

  while (quality >= 0.1) {
    blob = await canvasToBlob(img, width, height, quality);
    if (blob.size <= maxSize) break;
    quality -= 0.1;
  }

  // If still too big after quality reduction, scale dimensions further
  if (blob.size > maxSize) {
    const scale = Math.sqrt(maxSize / blob.size);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    blob = await canvasToBlob(img, width, height, 0.7);
  }

  // Preserve original filename (important for IPFS references)
  const ext = blob.type === 'image/png' ? '.png' : '.jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const name = baseName + ext;
  return new File([blob], name, { type: blob.type });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(img, width, height, quality) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Size thresholds for user warnings (no caps — just suggestions)
 */
export const SIZE_THRESHOLDS = {
  COVER_SUGGESTED: 2 * 1024 * 1024,        // 2MB — suggested for cover images (thumbnails)
  MEDIUM_WARNING: 100 * 1024 * 1024,       // 100MB — warn about propagation time
  LARGE_WARNING: 1024 * 1024 * 1024,       // 1GB — warn about significant upload/resolve time
};

/**
 * Get a user-friendly size warning message (returns null if no warning needed)
 */
export function getSizeWarning(bytes, target = 'file') {
  if (target === 'cover' && bytes > SIZE_THRESHOLDS.COVER_SUGGESTED) {
    return `Large cover image (${formatFileSize(bytes)}). Suggested: under 2MB for fast thumbnail loading. Original will be uploaded as-is.`;
  }
  if (bytes > SIZE_THRESHOLDS.LARGE_WARNING) {
    return `Very large file (${formatFileSize(bytes)}). Upload and IPFS propagation may take considerable time. The file will be pinned locally and propagate to the network gradually.`;
  }
  if (bytes > SIZE_THRESHOLDS.MEDIUM_WARNING) {
    return `Large file (${formatFileSize(bytes)}). Upload may take a few minutes. IPFS propagation to other nodes may be slow initially.`;
  }
  return null;
}
