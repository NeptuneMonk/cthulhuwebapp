/**
 * meshAudioRelay.js — Audio relay over mesh WebSocket.
 *
 * When direct P2P (WebRTC ICE) fails, this module captures audio from
 * the local microphone, encodes it as small base64 chunks, and sends
 * them through the mesh signaling WebSocket. The receiving end decodes
 * and plays each chunk via AudioContext.
 *
 * Latency: ~200-400ms (vs ~50ms for direct WebRTC)
 * Bandwidth: ~2-4KB/s per direction (Opus @ 16kbps)
 */

const CHUNK_INTERVAL_MS = 250; // capture a chunk every 250ms

/**
 * Start sending audio from a MediaStream through the mesh phone.
 * Returns a stop() function.
 */
export function startAudioSender(localStream, meshPhone, targetAddress, onLog) {
  if (!localStream || !meshPhone || !targetAddress) return () => {};

  let seq = 0;
  let stopped = false;

  // Use MediaRecorder to capture small audio chunks
  const recorder = new MediaRecorder(localStream, {
    mimeType: getSupportedMimeType(),
    audioBitsPerSecond: 16000,
  });

  recorder.ondataavailable = async (event) => {
    if (stopped || !event.data || event.data.size === 0) return;

    try {
      // Convert blob to base64
      const buffer = await event.data.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      // Send through mesh
      const sent = meshPhone.sendAudioChunk(targetAddress, base64, seq++);
      if (!sent && onLog) {
        onLog('RELAY', 'MESH SEND FAILED — WS DISCONNECTED');
      }
    } catch (e) {
      if (onLog) onLog('RELAY', `ENCODE ERROR: ${e.message}`);
    }
  };

  recorder.start(CHUNK_INTERVAL_MS);
  if (onLog) onLog('RELAY', 'AUDIO SENDER STARTED');

  return () => {
    stopped = true;
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    if (onLog) onLog('RELAY', 'AUDIO SENDER STOPPED');
  };
}

/**
 * Create an audio player that receives chunks from the mesh and plays them.
 * Returns { feedChunk(base64, seq), stop() }
 */
export function createAudioReceiver(onLog) {
  let ctx = null;
  let nextTime = 0;
  let stopped = false;
  let chunksReceived = 0;

  // Lazily init AudioContext (needs user gesture on some browsers)
  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
      });
      nextTime = ctx.currentTime;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function feedChunk(base64) {
    if (stopped) return;
    chunksReceived++;

    try {
      const audioCtx = ensureContext();
      const buffer = base64ToArrayBuffer(base64);

      // Decode the audio data
      const audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));

      // Schedule playback
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      // Schedule to play at the right time (prevents gaps/overlaps)
      const now = audioCtx.currentTime;
      if (nextTime < now) nextTime = now;
      source.start(nextTime);
      nextTime += audioBuffer.duration;
    } catch (e) {
      // If decode fails, try to play raw — some codecs may not be supported
      if (onLog && chunksReceived <= 3) onLog('RELAY', `DECODE: ${e.message?.slice(0, 40)}`);
    }
  }

  function stop() {
    stopped = true;
    if (ctx) {
      try { ctx.close(); } catch {}
      ctx = null;
    }
    if (onLog) onLog('RELAY', `AUDIO RECEIVER STOPPED (${chunksReceived} chunks received)`);
  }

  return { feedChunk, stop };
}


// ─── Helpers ──────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getSupportedMimeType() {
  // Prefer opus for smallest size, fall back to webm then default
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // browser default
}
