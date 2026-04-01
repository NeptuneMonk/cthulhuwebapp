/**
 * WebRTC P2P Audio Engine — Mempool-Signaled Decentralized Calling
 *
 * Architecture:
 *   1. Caller creates WebRTC offer (SDP) → encrypts with ECIES → P2FK transaction to recipient
 *   2. Recipient detects RING in mempool (~2s) → decrypts SDP → creates WebRTC answer
 *   3. Answer encrypted → P2FK transaction back to caller
 *   4. Caller decrypts answer → WebRTC peer connection established → live audio
 *
 * Signaling data is compact enough to embed directly in P2FK address payloads
 * (SDP offers compress to ~300-500 bytes for audio-only).
 *
 * ICE candidates are trickled via additional small transactions if needed,
 * but typically the initial offer/answer contain enough candidates.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { eciesDecrypt, unwrapSEC } from './ecies';
import { buildPrivateMessageTransaction } from './p2fk';
import { buildAndBroadcast } from './txBuilder';

const API = process.env.REACT_APP_BACKEND_URL;
const PHONE_KEYWORD = 'PHONE';
const RING_DUST = 547;   // Dust value for RING (offer)
const ANSW_DUST = 548;   // Dust value for ANSWER

// Mempool API bases
const WS_TESTNET = 'wss://mempool.space/testnet/api/v1/ws';
const WS_MAINNET = 'wss://mempool.space/api/v1/ws';
const REST_TESTNET = 'https://mempool.space/testnet/api';
const REST_MAINNET = 'https://mempool.space/api';

// ICE servers — STUN for NAT traversal + TURN relays for mobile/symmetric NAT fallback
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  // Free TURN relays — critical for mobile-to-mobile calls where STUN fails
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

/**
 * Compress an SDP string for on-chain embedding.
 * Audio-only SDPs are typically 2-4KB. We strip unnecessary lines
 * and compress to ~300-500 bytes.
 */
function compressSDP(sdp) {
  const lines = sdp.split('\r\n').filter(l => l.length > 0);
  // Keep only lines strictly required for WebRTC connectivity.
  // Strip extmap, ssrc, and redundant c= lines to minimize transaction size.
  let seenC = false;
  const essential = lines.filter(l => {
    // Session-level
    if (l.startsWith('v=') || l.startsWith('o=') || l.startsWith('s=') || l.startsWith('t=')) return true;
    if (l.startsWith('a=group') || l.startsWith('a=msid-semantic')) return true;
    // Media descriptions
    if (l.startsWith('m=audio') || l.startsWith('m=video')) { seenC = false; return true; }
    // Keep only first c= per section
    if (l.startsWith('c=')) { if (!seenC) { seenC = true; return true; } return false; }
    // ICE + DTLS (required for connectivity)
    if (l.startsWith('a=ice-ufrag') || l.startsWith('a=ice-pwd') || l.startsWith('a=ice-options')) return true;
    if (l.startsWith('a=fingerprint') || l.startsWith('a=setup')) return true;
    // Media direction + mux
    if (l.startsWith('a=mid') || l.startsWith('a=sendrecv') || l.startsWith('a=recvonly') || l.startsWith('a=sendonly')) return true;
    if (l.startsWith('a=rtcp-mux') || l.startsWith('a=rtcp-rsize')) return true;
    // Codec lines — keep rtpmap + fmtp (needed for media negotiation)
    if (l.startsWith('a=rtpmap') || l.startsWith('a=fmtp')) return true;
    // ICE candidates
    if (l.startsWith('a=candidate') || l.startsWith('a=end-of-candidates')) return true;
    return false;
  });
  return essential.join('\n');
}

/**
 * Decompress a compressed SDP back to standard format.
 */
function decompressSDP(compressed) {
  return compressed.split('\n').join('\r\n') + '\r\n';
}

/**
 * Create a WebRTC peer connection with optional video.
 * @param {object} options - { video: boolean }
 * @returns {{ pc: RTCPeerConnection, localStream: MediaStream }}
 */
export async function createMediaConnection({ video = false } = {}) {
  const constraints = { audio: true };
  if (video) constraints.video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }

  return { pc, localStream: stream };
}

// Keep backward compat alias
export const createAudioConnection = () => createMediaConnection({ video: false });

/**
 * Create a WebRTC offer and wait for ICE gathering to complete.
 * Returns the complete SDP offer with embedded ICE candidates.
 */
export async function createOffer(pc) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (so all candidates are in the SDP)
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', checkState);
    // Timeout after 5 seconds — proceed with whatever candidates we have
    setTimeout(resolve, 5000);
  });

  return pc.localDescription.sdp;
}

/**
 * Create a WebRTC answer from a received offer.
 */
export async function createAnswer(pc, offerSDP) {
  await pc.setRemoteDescription(new RTCSessionDescription({
    type: 'offer',
    sdp: offerSDP,
  }));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Wait for ICE gathering
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', checkState);
    setTimeout(resolve, 5000);
  });

  return pc.localDescription.sdp;
}

/**
 * Apply a received answer SDP to the peer connection.
 */
export async function applyAnswer(pc, answerSDP) {
  await pc.setRemoteDescription(new RTCSessionDescription({
    type: 'answer',
    sdp: answerSDP,
  }));
}

/**
 * Build and broadcast a RING (call offer) transaction via mempool.
 *
 * Payload format: RING:<callerAddress>|<callerPKX>|<callerPKY>|<compressed_sdp>
 * This embeds the caller's identity so the receiver can:
 * 1. Display the caller's name/avatar (even if tx came from change address)
 * 2. Encrypt the ANSW back using the caller's public keys
 *
 * @param {string} recipientAddress - Recipient's Bitcoin address
 * @param {string} pkx - Recipient's PKX hex
 * @param {string} pky - Recipient's PKY hex
 * @param {string} sdpOffer - The WebRTC SDP offer string
 * @param {string} wif - Caller's WIF private key
 * @param {string} callerAddress - Caller's main Bitcoin address
 * @param {string} callerPKX - Caller's PKX hex
 * @param {string} callerPKY - Caller's PKY hex
 * @param {string} network - Network name (e.g., 'btc-testnet')
 * @returns {Promise<{txid: string, success: boolean}>}
 */
export async function broadcastRing(recipientAddress, pkx, pky, sdpOffer, wif, callerAddress, callerPKX, callerPKY, network) {
  const compressed = compressSDP(sdpOffer);
  // Embed caller identity: address|pkx|pky|sdp
  const message = `RING:${callerAddress}|${callerPKX}|${callerPKY}|${compressed}`;

  const txData = await buildPrivateMessageTransaction(wif, message, recipientAddress, pkx, pky, network);

  const result = await buildAndBroadcast(
    wif,
    txData.addresses,
    network,
    [],
    0,
    RING_DUST,
    [],
    txData.taxInsertIndex,
  );
  return result;
}

/**
 * Build and broadcast an ANSWER transaction.
 */
export async function broadcastAnswer(callerAddress, pkx, pky, sdpAnswer, wif, network) {
  const compressed = compressSDP(sdpAnswer);
  const message = `ANSW:${compressed}`;

  const txData = await buildPrivateMessageTransaction(wif, message, callerAddress, pkx, pky, network);

  const result = await buildAndBroadcast(
    wif,
    txData.addresses,
    network,
    [],
    0,
    ANSW_DUST,
    [],
    txData.taxInsertIndex,
  );
  return result;
}

/**
 * Decode a RING or ANSWER from a mempool transaction.
 * Returns { type: 'RING'|'ANSW', sdp, from, txid } or null.
 */
export function decodeCallSignal(tx, myAddress, privateKey) {
  if (!tx?.vout) return null;

  // Check for RING_DUST or ANSW_DUST
  const hasRing = tx.vout.some(out => out.value === RING_DUST);
  const hasAnsw = tx.vout.some(out => out.value === ANSW_DUST);
  if (!hasRing && !hasAnsw) return null;

  const dustValue = hasRing ? RING_DUST : ANSW_DUST;
  const signalType = hasRing ? 'RING' : 'ANSW';

  // Check if this tx is addressed to us
  const dustOutputs = tx.vout.filter(
    out => out.value === dustValue && out.scriptpubkey_address
  );
  const isForMe = dustOutputs.some(o => o.scriptpubkey_address === myAddress);
  if (!isForMe) return null;

  // Sender: check transaction inputs first (most reliable), fall back to dust outputs
  const inputAddresses = (tx.vin || [])
    .map(v => v.prevout?.scriptpubkey_address)
    .filter(Boolean);
  // Use first input address as primary sender, but return all for contact matching
  const senderAddr = inputAddresses[0] || dustOutputs[dustOutputs.length - 1]?.scriptpubkey_address;

  // Decode P2FK address payloads to get raw bytes
  const allAddrs = dustOutputs.map(o => o.scriptpubkey_address);
  const allBytes = decodeAddressPayloads(allAddrs);

  // Also check OP_RETURN
  let opReturnData = Buffer.alloc(0);
  for (const out of tx.vout) {
    if (out.value === 0 && out.scriptpubkey) {
      try {
        const script = Buffer.from(out.scriptpubkey, 'hex');
        const chunks = bitcoin.script.decompile(script);
        if (chunks && chunks[0] === bitcoin.opcodes.OP_RETURN && Buffer.isBuffer(chunks[1])) {
          opReturnData = chunks[1];
        }
      } catch { /* skip */ }
    }
  }

  const fullRaw = opReturnData.length > 0
    ? Buffer.concat([opReturnData, allBytes])
    : allBytes;

  // Search for SEC pattern
  const P2FK_SEPS = [0x5C, 0x2F, 0x3A, 0x2A, 0x3F, 0x22, 0x3C, 0x3E, 0x7C];
  let secStart = -1;
  for (let i = 0; i < fullRaw.length - 5; i++) {
    if (fullRaw[i] === 0x53 && fullRaw[i + 1] === 0x45 && fullRaw[i + 2] === 0x43 && P2FK_SEPS.includes(fullRaw[i + 3])) {
      secStart = i;
      break;
    }
  }

  if (secStart < 0) return null;

  // Parse SEC header
  let j = secStart + 4;
  let sizeStr = '';
  while (j < fullRaw.length && fullRaw[j] >= 0x30 && fullRaw[j] <= 0x39) {
    sizeStr += String.fromCharCode(fullRaw[j]);
    j++;
  }
  if (!sizeStr || j >= fullRaw.length || !P2FK_SEPS.includes(fullRaw[j])) return null;
  j++;
  const contentSize = parseInt(sizeStr, 10);
  const secData = fullRaw.slice(secStart, j + contentSize);

  return {
    type: signalType,
    secData: new Uint8Array(secData),
    from: senderAddr,
    inputAddresses, // All input addresses for contact matching
    txid: tx.txid,
    dustValue,
  };
}

/**
 * Decrypt a call signal's SDP payload.
 * RING format: "RING:<address>|<pkx>|<pky>|<compressed_sdp>"
 * ANSW format: "ANSW:<compressed_sdp>"
 */
export async function decryptCallSignal(signal, privateKey) {
  const { stripSigPrefix } = await import('./p2fk');
  const encrypted = unwrapSEC(signal.secData);
  const decrypted = await eciesDecrypt(privateKey, encrypted);

  const messageBytes = stripSigPrefix(decrypted);
  const text = new TextDecoder().decode(messageBytes);

  const colonIdx = text.indexOf(':');
  if (colonIdx < 0) return null;

  const prefix = text.slice(0, colonIdx);
  let payload = text.slice(colonIdx + 1);

  // Strip the salt suffix <<-NNNNN>>
  const saltPattern = /<<-?\d+>>$/;
  payload = payload.replace(saltPattern, '');

  // For RING signals, parse embedded caller identity
  let callerAddress = null, callerPKX = null, callerPKY = null;
  let compressedSDP = payload;

  if (prefix === 'RING') {
    // New format: address|pkx|pky|sdp
    const parts = payload.split('|');
    if (parts.length >= 4) {
      callerAddress = parts[0];
      callerPKX = parts[1];
      callerPKY = parts[2];
      compressedSDP = parts.slice(3).join('|'); // rejoin in case SDP has |
    }
    // Old format (no identity): just compressed SDP — callerAddress stays null
  }

  const sdp = decompressSDP(compressedSDP);

  return { type: prefix, sdp, callerAddress, callerPKX, callerPKY };
}

/**
 * Helper: decode Base58Check addresses to raw byte payloads.
 */
function decodeAddressPayloads(addresses) {
  const buffers = [];
  for (const addr of addresses) {
    try {
      const decoded = bitcoin.address.fromBase58Check(addr);
      buffers.push(Buffer.from(decoded.hash));
    } catch {
      try {
        const decoded = bitcoin.address.fromBech32(addr);
        buffers.push(Buffer.from(decoded.data));
      } catch { /* skip */ }
    }
  }
  return buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0);
}

/**
 * Create a mempool monitor specifically for phone call signals.
 * Watches for RING and ANSW transactions addressed to the user.
 *
 * @param {string} myAddress - User's Bitcoin address
 * @param {string} network - Network name
 * @param {function} onSignal - Callback: ({ type, secData, from, txid }) => void
 * @returns {{ connect, disconnect }}
 */
export function createCallMonitor(myAddress, network, onSignal) {
  const isMainnet = network.includes('mainnet');
  const apiBase = isMainnet ? REST_MAINNET : REST_TESTNET;
  const wsUrl = isMainnet ? WS_MAINNET : WS_TESTNET;
  const seenTxids = new Set();
  let ws = null;
  let alive = false;
  let pollTimer = null;
  let reconnectTimer = null;

  const processTx = (tx) => {
    if (!tx?.txid || seenTxids.has(tx.txid)) return;
    seenTxids.add(tx.txid);

    const signal = decodeCallSignal(tx, myAddress, null);
    if (signal) onSignal(signal);
  };

  const connectWs = () => {
    if (!alive) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        // Track mempool transactions to our address
        ws.send(JSON.stringify({ 'track-address': myAddress }));
      };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          // address-transactions event
          if (data['address-transactions']) {
            for (const tx of (data['address-transactions'].mempool || [])) {
              processTx(tx);
            }
          }
        } catch { /* ignore parse errors */ }
      };
      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onerror = () => { ws?.close(); };
    } catch { /* WebSocket not available */ }
  };

  const poll = async () => {
    if (!alive) return;
    try {
      const res = await fetch(`${apiBase}/address/${myAddress}/txs/mempool`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const txs = await res.json();
        for (const tx of txs) processTx(tx);
      }
    } catch { /* network error */ }
  };

  const connect = () => {
    alive = true;
    connectWs();
    poll();
    pollTimer = setInterval(poll, 4000); // Poll every 4s for low latency
  };

  const disconnect = () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    if (ws) { ws.close(); ws = null; }
  };

  return { connect, disconnect };
}

/**
 * Check if an SDP contains a video track.
 */
export function sdpHasVideo(sdp) {
  return /m=video\s/.test(sdp || '');
}

/**
 * Clean up a peer connection and all associated resources.
 */
export function cleanupCall(pc, localStream) {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (pc) {
    pc.close();
  }
}
