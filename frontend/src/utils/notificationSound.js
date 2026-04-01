/**
 * Notification Sound System — audible pings for incoming messages.
 *
 * Uses Web Audio API to synthesize a short notification tone,
 * avoiding the need for external sound files.
 *
 * Mute state persisted in localStorage.
 */

const STORAGE_KEY = 'cthulhu_notif_muted';

let _audioCtx = null;
let _muted = localStorage.getItem(STORAGE_KEY) === 'true';
let _lastPlayedAt = 0;
const MIN_INTERVAL_MS = 15000; // Don't play more than once per 15s

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

/**
 * Play a short notification ping sound.
 * Two-tone ascending chirp, subtle and pleasant.
 */
export function playNotificationSound() {
  if (_muted) return;
  const now = Date.now();
  if (now - _lastPlayedAt < MIN_INTERVAL_MS) return;
  _lastPlayedAt = now;

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    // First tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, t);
    gain1.gain.setValueAtTime(0.15, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.15);

    // Second tone (higher)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1174.66, t + 0.08);
    gain2.gain.setValueAtTime(0, t);
    gain2.gain.setValueAtTime(0.12, t + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.08);
    osc2.stop(t + 0.25);
  } catch {
    // Audio not available
  }
}

/** Check if notifications are muted. */
export function isMuted() {
  return _muted;
}

/** Toggle mute state. Returns new muted value. */
export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem(STORAGE_KEY, _muted ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('cthulhu-mute-change', { detail: { muted: _muted } }));
  return _muted;
}

/** Set mute state explicitly. */
export function setMuted(val) {
  _muted = !!val;
  localStorage.setItem(STORAGE_KEY, _muted ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('cthulhu-mute-change', { detail: { muted: _muted } }));
}
