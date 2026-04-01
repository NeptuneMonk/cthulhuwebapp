/**
 * callTones.js — Synthesized call sounds using Web Audio API.
 * No external files needed. All tones are generated programmatically.
 */

let audioCtx = null;

function getCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Play a tone at given frequency for given duration
function playTone(freq, duration, volume = 0.15, type = 'sine') {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration);
}

// --- DIALING TONE (outgoing ring) ---
// Classic North American ringback: 440 + 480 Hz, 2s on / 4s off
let dialingInterval = null;
export function startDialingTone() {
  stopDialingTone();
  const ring = () => {
    const ctx = getCtx();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    osc1.type = 'sine';
    osc2.type = 'sine';
    gain.gain.value = 0.08;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime + 1.8);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
    osc1.stop(ctx.currentTime + 2.0);
    osc2.stop(ctx.currentTime + 2.0);
  };
  ring();
  dialingInterval = setInterval(ring, 4000);
}
export function stopDialingTone() {
  if (dialingInterval) { clearInterval(dialingInterval); dialingInterval = null; }
}

// --- INCOMING RING TONE ---
// Two-tone alert: alternating 800/1000 Hz beeps
let ringtoneInterval = null;
export function startRingtone() {
  stopRingtone();
  const ring = () => {
    playTone(800, 0.15, 0.12);
    setTimeout(() => playTone(1000, 0.15, 0.12), 200);
    setTimeout(() => playTone(800, 0.15, 0.12), 400);
  };
  ring();
  ringtoneInterval = setInterval(ring, 2500);
}
export function stopRingtone() {
  if (ringtoneInterval) { clearInterval(ringtoneInterval); ringtoneInterval = null; }
}

// --- CONNECTED BEEP ---
// Short ascending two-tone confirmation
export function playConnectedTone() {
  playTone(600, 0.12, 0.1);
  setTimeout(() => playTone(900, 0.15, 0.1), 140);
}

// --- HANGUP / DISCONNECT TONE ---
// Descending tone
export function playHangupTone() {
  playTone(800, 0.1, 0.1);
  setTimeout(() => playTone(500, 0.15, 0.1), 120);
  setTimeout(() => playTone(350, 0.2, 0.08), 260);
}

// --- BUSY TONE ---
// 480 + 620 Hz, 0.5s on / 0.5s off
let busyInterval = null;
export function startBusyTone() {
  stopBusyTone();
  const beep = () => {
    const ctx = getCtx();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 480;
    osc2.frequency.value = 620;
    gain.gain.value = 0.08;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc1.stop(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 0.5);
  };
  beep();
  busyInterval = setInterval(beep, 1000);
}
export function stopBusyTone() {
  if (busyInterval) { clearInterval(busyInterval); busyInterval = null; }
}

// --- VOICEMAIL BEEP (single beep before recording) ---
export function playVoicemailBeep() {
  playTone(1000, 0.4, 0.15);
}

// --- STOP ALL TONES ---
export function stopAllTones() {
  stopDialingTone();
  stopRingtone();
  stopBusyTone();
}
