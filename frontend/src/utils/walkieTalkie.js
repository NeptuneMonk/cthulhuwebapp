/**
 * SUP Walkie-Talkie — On-chain broadcast voice system with E2E encryption.
 *
 * Architecture:
 *   - Public broadcast: record → IPFS → P2FK message to WALKIE address
 *   - Private (encrypted): record → ECIES encrypt → IPFS as SEC → SEC message to recipient
 *   - Channel = dust value (546–646 sats, 101 channels)
 *   - Double-SEC: file encrypted before IPFS upload, then IPFS ref encrypted on-chain
 */
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { getKeywordAddress, buildPostTransaction, buildPrivateMessageTransaction } from './p2fk';
import { eciesEncrypt, eciesDecrypt, publicKeyFromPKXY } from './ecies';

const API = process.env.REACT_APP_BACKEND_URL;
const WALKIE_KEYWORD = 'WALKIE';
const WS_TESTNET = 'wss://mempool.space/testnet/api/v1/ws';
const WS_MAINNET = 'wss://mempool.space/api/v1/ws';

const IPFS_GATEWAYS = [
  `${API}/api/ipfs/cat/`,    // Our own backend (Kubo daemon + gateway fallback, auto-pins)
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://w3s.link/ipfs/',
];

// ─── Broadcast Address ─────────────────────────────────────────────────

export function getWalkieBroadcastAddress(networkName) {
  const isMainnet = networkName.includes('mainnet');
  return getKeywordAddress(WALKIE_KEYWORD, isMainnet ? 0 : 111);
}

// ─── Audio Recording ───────────────────────────────────────────────────

export function createRecorder() {
  let mediaRecorder = null;
  let chunks = [];

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.start(100); // 100ms timeslice for responsive recording
  };

  const stop = () => new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') { resolve(null); return; }
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      resolve(blob);
    };
    mediaRecorder.stop();
  });

  const isRecording = () => mediaRecorder?.state === 'recording';

  return { start, stop, isRecording };
}

// ─── IPFS Upload ───────────────────────────────────────────────────────

export async function uploadToIPFS(blob, filename = 'audio.webm') {
  const formData = new FormData();
  formData.append('file', blob, filename);
  const res = await fetch(`${API}/api/ipfs/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('IPFS upload failed');
  const data = await res.json();
  return data.cid || data.hash;
}

// ─── P2FK Message Building ─────────────────────────────────────────────

/**
 * Build a walkie-talkie transmission P2FK message.
 * This is a standard SUP post with an IPFS audio reference,
 * sent to the WALKIE broadcast keyword address.
 */
export function buildWalkieTransmission(wif, ipfsCid, filename, networkName) {
  // SUP compat: uses backslash separator in IPFS refs
  const message = `<<IPFS:${ipfsCid}\\${filename}>>`;
  const walkieAddr = getWalkieBroadcastAddress(networkName);
  return buildPostTransaction(wif, message, [WALKIE_KEYWORD], walkieAddr, networkName);
}

// ─── Mempool Monitor ───────────────────────────────────────────────────

const MEMPOOL_API_TESTNET = 'https://mempool.space/testnet/api';
const MEMPOOL_API_MAINNET = 'https://mempool.space/api';

/**
 * Monitor the WALKIE broadcast address for new transmissions.
 * Dual-mode: WebSocket for instant detection + REST polling as a reliable fallback.
 * Filters by dust value (channel) and decodes IPFS references.
 */
export function createWalkieMonitor(networkName, onTransmission) {
  const walkieAddr = getWalkieBroadcastAddress(networkName);
  const isTestnet = !networkName.includes('mainnet');
  const wsUrl = isTestnet ? WS_TESTNET : WS_MAINNET;
  const apiBase = isTestnet ? MEMPOOL_API_TESTNET : MEMPOOL_API_MAINNET;
  let ws = null;
  let alive = false;
  let reconnectTimer = null;
  let pollTimer = null;
  let channelDust = 546;
  let myAddress = null;
  const seenTxids = new Set();

  const setChannel = (dust) => { channelDust = dust; };
  const setMyAddress = (addr) => { myAddress = addr; };

  const processTx = (tx) => {
    if (!tx?.txid || seenTxids.has(tx.txid)) return;
    const decoded = decodeWalkieTx(tx, walkieAddr, channelDust, myAddress);
    if (decoded) {
      seenTxids.add(tx.txid);
      onTransmission(decoded);
    }
  };

  // ── WebSocket mode ──
  const connectWs = () => {
    if (ws) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        alive = true;
        ws.send(JSON.stringify({ 'track-address': walkieAddr }));
        // Also track user's own address for encrypted private walkies
        if (myAddress) ws.send(JSON.stringify({ 'track-address': myAddress }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Handle multiple response formats from mempool.space
          const addrTxs = data['address-transactions'];
          if (!addrTxs) return;
          const txList = addrTxs.mempool_txs || addrTxs.added || addrTxs.confirmed_txs || [];
          const flat = Array.isArray(addrTxs) ? addrTxs : txList;
          for (const tx of flat) processTx(tx);
        } catch { /* ignore parse errors */ }
      };
      ws.onclose = () => {
        ws = null;
        if (alive) reconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onerror = () => ws?.close();
    } catch {
      ws = null;
      if (alive) reconnectTimer = setTimeout(connectWs, 5000);
    }
  };

  // ── Polling fallback ──
  let warmedUp = false;

  const poll = async () => {
    try {
      // Fetch recent mempool (unconfirmed) transactions for WALKIE address
      const mempoolRes = await fetch(`${apiBase}/address/${walkieAddr}/txs/mempool`, {
        signal: AbortSignal.timeout(8000),
      });
      if (mempoolRes.ok) {
        const mempoolTxs = await mempoolRes.json();
        for (const tx of mempoolTxs) processTx(tx);
      }

      // Also check most recent confirmed TXs on WALKIE address
      const confirmedRes = await fetch(`${apiBase}/address/${walkieAddr}/txs`, {
        signal: AbortSignal.timeout(8000),
      });
      if (confirmedRes.ok) {
        const confirmedTxs = await confirmedRes.json();
        const recent = confirmedTxs.slice(0, 5);
        if (!warmedUp) {
          // First poll: seed seen set without triggering playback
          for (const tx of recent) seenTxids.add(tx.txid);
          warmedUp = true;
        } else {
          for (const tx of recent) processTx(tx);
        }
      }

      // Also poll MY address for encrypted walkies addressed to me
      if (myAddress) {
        try {
          const myMempoolRes = await fetch(`${apiBase}/address/${myAddress}/txs/mempool`, {
            signal: AbortSignal.timeout(8000),
          });
          if (myMempoolRes.ok) {
            const myTxs = await myMempoolRes.json();
            for (const tx of myTxs) processTx(tx);
          }
        } catch { /* skip personal mempool check */ }
      }
    } catch { /* network error — skip, retry next cycle */ }
  };

  const connect = () => {
    alive = true;
    connectWs();
    // Start polling every 8 seconds as fallback
    poll(); // immediate first poll
    pollTimer = setInterval(poll, 8000);
  };

  const disconnect = () => {
    alive = false;
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    if (ws) { ws.close(); ws = null; }
  };

  return { connect, disconnect, isAlive: () => alive, setChannel, setMyAddress };
}

// ─── TX Decoding ───────────────────────────────────────────────────────

/**
 * Decode a mempool TX from the WALKIE broadcast address.
 * Filters by channel dust value and extracts IPFS references.
 */
function decodeWalkieTx(tx, walkieAddr, channelDust, myAddress) {
  if (!tx?.vout) return null;

  // Check if any output matches our channel dust value
  const hasChannelDust = tx.vout.some(out => out.value === channelDust);
  if (!hasChannelDust) return null;

  // Collect all outputs at the channel dust value
  const dustOutputs = tx.vout.filter(
    out => out.value === channelDust && out.scriptpubkey_address
  );
  if (dustOutputs.length < 2) return null;

  // P2FK convention: sender is the LAST dust output
  const senderAddr = dustOutputs[dustOutputs.length - 1].scriptpubkey_address;

  // Decode ALL output addresses to raw bytes (don't filter — use pattern search instead)
  const allAddrs = dustOutputs.map(o => o.scriptpubkey_address);
  const allBytes = decodeAddressPayloads(allAddrs);

  // Also extract OP_RETURN data and prepend
  let opReturnData = Buffer.alloc(0);
  for (const out of tx.vout) {
    if (out.value === 0 && out.scriptpubkey) {
      try {
        const script = Buffer.from(out.scriptpubkey, 'hex');
        const chunks = bitcoin.script.decompile(script);
        if (chunks && chunks[0] === bitcoin.opcodes.OP_RETURN && Buffer.isBuffer(chunks[1])) {
          opReturnData = chunks[1];
        }
      } catch { /* not valid script */ }
    }
  }

  const fullRaw = opReturnData.length > 0
    ? Buffer.concat([opReturnData, allBytes])
    : allBytes;

  // Search for SEC header pattern: SEC{sep}{digits}{sep}{content}
  // This is the same approach as the backend — robust, doesn't need address filtering
  const P2FK_SEPS = [0x5C, 0x2F, 0x3A, 0x2A, 0x3F, 0x22, 0x3C, 0x3E, 0x7C]; // \ / : * ? " < > |
  let secStart = -1;
  for (let i = 0; i < fullRaw.length - 5; i++) {
    if (fullRaw[i] === 0x53 && fullRaw[i + 1] === 0x45 && fullRaw[i + 2] === 0x43 && P2FK_SEPS.includes(fullRaw[i + 3])) {
      secStart = i;
      break;
    }
  }

  if (secStart >= 0) {
    // Parse SEC{sep}{size}{sep}{content}
    let j = secStart + 4; // skip "SEC" + first separator
    let sizeStr = '';
    while (j < fullRaw.length && fullRaw[j] >= 0x30 && fullRaw[j] <= 0x39) {
      sizeStr += String.fromCharCode(fullRaw[j]);
      j++;
    }
    if (sizeStr && j < fullRaw.length && P2FK_SEPS.includes(fullRaw[j])) {
      j++; // skip second separator
      const contentSize = parseInt(sizeStr, 10);
      // Return the FULL SEC file (header + content) so unwrapSEC works
      const secData = fullRaw.slice(secStart, j + contentSize);

      // Determine recipient
      const recipientAddr = myAddress && dustOutputs.some(o => o.scriptpubkey_address === myAddress)
        ? myAddress : null;

      return {
        txid: tx.txid,
        from: senderAddr,
        to: recipientAddr,
        channel: channelDust,
        timestamp: Date.now(),
        encrypted: true,
        secData,
        ipfsRefs: [],
      };
    }
  }

  // No SEC pattern found — try plaintext IPFS refs
  const text = fullRaw.toString('utf-8');
  const ipfsPattern = /<<IPFS:([^>]+)>>/g;
  const matches = [...text.matchAll(ipfsPattern)];
  if (matches.length === 0) return null;

  return {
    txid: tx.txid,
    from: senderAddr,
    channel: channelDust,
    timestamp: Date.now(),
    encrypted: false,
    ipfsRefs: matches.map(m => m[1]),
  };
}

/**
 * Base58-decode P2FK addresses to extract the 20-byte payload from each.
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

// ─── Audio Playback ────────────────────────────────────────────────────

// ─── Audio Playback (Public) ────────────────────────────────────────────

/**
 * Fetch public (unencrypted) audio from IPFS gateways.
 */
export async function fetchIPFSAudio(ipfsRef) {
  // Handle both forward and backslash separators (SUP compat)
  const cid = ipfsRef.split(/[\/\\]/)[0];
  // Normalize backslash to forward slash for URL fetching
  const normalizedRef = ipfsRef.replace(/\\/g, '/');
  // Try bare CID first (single-file uploads), then full path
  const paths = [cid];
  if (normalizedRef !== cid) paths.push(normalizedRef);
  for (const gw of IPFS_GATEWAYS) {
    // Our backend already has gateway fallback, give it more time
    const timeout = gw.includes('/api/ipfs/') ? 30000 : 15000;
    for (const path of paths) {
      try {
        const res = await fetch(`${gw}${path}`, { signal: AbortSignal.timeout(timeout) });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size < 50) continue; // skip tiny error pages
          return URL.createObjectURL(blob);
        }
      } catch { /* try next */ }
    }
  }
  throw new Error('Failed to fetch audio from IPFS');
}

// ─── Encrypted Walkie Functions ─────────────────────────────────────────


/**
 * Upload audio blob to IPFS after ECIES encryption (for private walkie messages).
 * Returns the CID of the encrypted SEC file.
 */
export async function uploadEncryptedToIPFS(blob, recipientPubKey) {
  const audioBytes = new Uint8Array(await blob.arrayBuffer());
  const encrypted = await eciesEncrypt(recipientPubKey, audioBytes);
  const secBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', secBlob, 'SEC');
  const res = await fetch(`${API}/api/ipfs/upload`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('IPFS upload failed');
  const data = await res.json();
  return data.cid || data.hash;
}

/**
 * Build an encrypted (SEC) walkie-talkie transmission.
 * Double-SEC: audio encrypted on IPFS, message encrypted on-chain.
 * Includes WALKIE broadcast address as keyword so monitors detect it.
 */
export async function buildEncryptedWalkieTransmission(wif, ipfsCid, recipientAddress, recipientPKX, recipientPKY, networkName) {
  // SUP compat: backslash separator, no [walkie] prefix — just the IPFS attachment tag
  const message = `<<IPFS:${ipfsCid}\\SEC>>`;
  const result = await buildPrivateMessageTransaction(wif, message, recipientAddress, recipientPKX, recipientPKY, networkName);

  // Add WALKIE broadcast address so walkie monitors detect this TX
  const walkieAddr = getWalkieBroadcastAddress(networkName);
  // Insert WALKIE before sender (sender MUST be last)
  const senderIdx = result.addresses.length - 1;
  if (!result.addresses.includes(walkieAddr)) {
    result.addresses.splice(senderIdx, 0, walkieAddr);
  }
  result.taxInsertIndex = result.addresses.length - 1;

  return result;
}

/**
 * Detect audio MIME type from header bytes.
 * SUP records WAV, our client records WebM/Opus.
 */
function detectAudioMime(bytes) {
  if (bytes.length < 4) return 'audio/webm';
  // WAV: RIFF header
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';
  // WebM/Matroska: EBML header
  if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return 'audio/webm';
  // OGG: OggS header
  if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
  // MP3: ID3 tag or sync word
  if ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
  // FLAC
  if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) return 'audio/flac';
  return 'audio/webm'; // default fallback
}

/**
 * Decrypt an encrypted IPFS audio file and return a playable blob URL.
 */
export async function decryptIPFSAudio(ipfsRef, privKeyBytes) {
  // Strip both /SEC and \SEC suffixes (SUP uses backslash, we use forward slash)
  const cid = ipfsRef.replace(/[\/\\]SEC$/, '');
  // Try bare CID first (single-file upload), then CID/SEC (directory-wrapped) as fallback
  const paths = [cid, `${cid}/SEC`];
  let lastError = 'Not found on IPFS';
  for (const gw of IPFS_GATEWAYS) {
    for (const path of paths) {
      try {
        const res = await fetch(`${gw}${path}`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const encBytes = new Uint8Array(await res.arrayBuffer());
        if (encBytes.length < 50) continue; // too small, probably error page
        // Validate: should be ECIES data (starts with 0x04) or SEC-wrapped
        if (encBytes[0] !== 0x04 && !(encBytes[0] === 0x53 && encBytes[1] === 0x45)) {
          // Check if it's HTML (redirect/error page)
          const peek = new TextDecoder().decode(encBytes.slice(0, 20));
          if (peek.includes('<') || peek.includes('DOCTYPE') || peek.includes('{')) continue;
        }
        // Unwrap SEC header if present
        let raw = encBytes;
        if (encBytes[0] === 0x53 && encBytes[1] === 0x45 && encBytes[2] === 0x43) {
          raw = unwrapSEC(encBytes);
        }
        const decrypted = await eciesDecrypt(privKeyBytes, raw);
        // Detect audio format from header bytes (SUP=WAV, Cthulhu=WebM)
        const mimeType = detectAudioMime(decrypted);
        const blob = new Blob([decrypted], { type: mimeType });
        return URL.createObjectURL(blob);
      } catch (err) {
        lastError = err.message || 'Decrypt failed';
        continue;
      }
    }
  }
  throw new Error(`Audio unavailable: ${lastError}`);
}
