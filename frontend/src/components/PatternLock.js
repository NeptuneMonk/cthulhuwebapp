/**
 * PatternLock — 3x3 dot grid pattern input component.
 * User draws a pattern by connecting dots. The sequence is used as key material.
 * Minimum 4 dots required for security.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const DOT_COUNT = 9; // 3x3 grid
const MIN_DOTS = 4;
const GRID = 3;
const DOT_RADIUS = 8;
const HIT_RADIUS = 28;

function getDotCenter(index, size) {
  const padding = 40;
  const usable = size - padding * 2;
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  return {
    x: padding + (col * usable) / (GRID - 1),
    y: padding + (row * usable) / (GRID - 1),
  };
}

export function PatternLock({ size = 240, onComplete, mode = 'input', error = false, disabled = false }) {
  const canvasRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [mousePos, setMousePos] = useState(null);
  const [showError, setShowError] = useState(error);

  useEffect(() => { setShowError(error); }, [error]);

  const getEventPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const hitTest = useCallback((pos) => {
    for (let i = 0; i < DOT_COUNT; i++) {
      const center = getDotCenter(i, size);
      const dist = Math.sqrt((pos.x - center.x) ** 2 + (pos.y - center.y) ** 2);
      if (dist < HIT_RADIUS) return i;
    }
    return -1;
  }, [size]);

  const handleStart = (e) => {
    if (disabled) return;
    e.preventDefault();
    setShowError(false);
    const pos = getEventPos(e);
    if (!pos) return;
    const dot = hitTest(pos);
    if (dot >= 0) {
      setSelected([dot]);
      setDrawing(true);
      setMousePos(pos);
    }
  };

  const handleMove = (e) => {
    if (!drawing || disabled) return;
    e.preventDefault();
    const pos = getEventPos(e);
    if (!pos) return;
    setMousePos(pos);
    const dot = hitTest(pos);
    if (dot >= 0 && !selected.includes(dot)) {
      setSelected(prev => [...prev, dot]);
    }
  };

  const handleEnd = () => {
    if (!drawing) return;
    setDrawing(false);
    setMousePos(null);
    if (selected.length >= MIN_DOTS && onComplete) {
      onComplete(selected);
    } else if (selected.length > 0 && selected.length < MIN_DOTS) {
      setShowError(true);
      setTimeout(() => { setSelected([]); setShowError(false); }, 600);
    }
  };

  const reset = useCallback(() => {
    setSelected([]);
    setDrawing(false);
    setMousePos(null);
    setShowError(false);
  }, []);

  // Expose reset via ref
  useEffect(() => {
    if (canvasRef.current) canvasRef.current._reset = reset;
  }, [reset]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const lineColor = showError ? '#ef4444' : '#14b8a6';
    const dotColor = showError ? '#ef4444' : '#6b7280';
    const activeDotColor = showError ? '#ef4444' : '#14b8a6';

    // Draw lines between selected dots
    if (selected.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < selected.length; i++) {
        const c = getDotCenter(selected[i], size);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      }
      // Draw line to current mouse position while drawing
      if (drawing && mousePos) {
        ctx.lineTo(mousePos.x, mousePos.y);
      }
      ctx.stroke();
    } else if (selected.length === 1 && drawing && mousePos) {
      const c = getDotCenter(selected[0], size);
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.stroke();
    }

    // Draw dots
    for (let i = 0; i < DOT_COUNT; i++) {
      const c = getDotCenter(i, size);
      const isSelected = selected.includes(i);

      // Outer ring for selected dots
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, DOT_RADIUS + 8, 0, Math.PI * 2);
        ctx.strokeStyle = activeDotColor + '40';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Dot
      ctx.beginPath();
      ctx.arc(c.x, c.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? activeDotColor : dotColor;
      ctx.fill();
    }
  }, [selected, drawing, mousePos, size, showError]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, touchAction: 'none' }}
        className={`cursor-pointer ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        data-testid="pattern-lock-canvas"
      />
      {showError && selected.length > 0 && selected.length < MIN_DOTS && (
        <p className="text-xs text-red-400 mt-1">Connect at least {MIN_DOTS} dots</p>
      )}
    </div>
  );
}

/**
 * Derive an AES-GCM key from a pattern sequence using PBKDF2.
 * @param {number[]} pattern - Array of dot indices (0-8)
 * @param {string} saltHex - Hex-encoded salt
 * @returns {Promise<{key: CryptoKey, keyHash: string}>}
 */
export async function derivePatternKey(pattern, saltHex) {
  const encoder = new TextEncoder();
  const patternStr = pattern.join('-');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(patternStr), 'PBKDF2', false, ['deriveBits', 'deriveKey']
  );
  const salt = hexToBytes(saltHex);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  // Compute verification hash (export key → SHA-256)
  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const hashBuf = await crypto.subtle.digest('SHA-256', rawKey);
  const keyHash = bytesToHex(new Uint8Array(hashBuf));
  return { key: aesKey, keyHash };
}

/**
 * Encrypt data with AES-GCM using the pattern-derived key.
 * Returns base64-encoded (iv + ciphertext).
 */
export async function patternEncrypt(aesKey, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    dataBytes
  );
  // Combine iv + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  // Use chunked conversion to avoid call stack overflow on large data
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, combined.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decrypt AES-GCM encrypted data using the pattern-derived key.
 * Input is base64-encoded (iv + ciphertext).
 */
export async function patternDecrypt(aesKey, base64Data) {
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );
  return new Uint8Array(plaintext);
}

export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
