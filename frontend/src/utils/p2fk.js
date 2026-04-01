/**
 * P2FK Protocol - Client-side encoding for SUP-compatible blockchain transactions.
 * Encodes JSON payloads into Bitcoin addresses using the Pay-to-Future-Key scheme.
 * The private key NEVER leaves the browser.
 *
 * IMPORTANT: Data types in P2FK JSON payloads must match the SUP C# reference exactly:
 *   - OBJ: { urn, uri, img, nme, dsc, atr, lic, max, cre: string[], own: Dict<string,long>, roy: Dict<string,decimal> }
 *          cre MUST be string[] (e.g. ["1","0"]), own keys MUST be strings, roy keys MUST be strings
 *   - GIV: List<List<string>> — ALL values are strings, salt is D5-padded
 *   - BRN: List<List<long>>  — ALL values are integers, salt is plain integer
 *   - BUY: List<List<string>> — ALL values are strings, salt is D5-padded
 *   - LST: [[address, qty, price], [salt1, salt2]] — address is string, all others are numbers
 *
 * Uses pure JS crypto (@noble/secp256k1) — no WASM required.
 */
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { ecc } from './ecc';
import * as secp from '@noble/secp256k1';

const ECPair = ECPairFactory(ecc);

// Initialize bitcoinjs-lib with our pure JS ECC
bitcoin.initEccLib(ecc);

// Base58 character set — used to sanitize WIF from invisible chars
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function cleanWIF(wif) { return wif.split('').filter(c => BASE58.includes(c)).join(''); }

// Both networks — for network-agnostic WIF parsing
const BOTH_NETWORKS = [bitcoin.networks.bitcoin, bitcoin.networks.testnet];

/**
 * Parse a WIF regardless of its encoded network, re-derive for the target network.
 * Fixes: mainnet WIF can create testnet transactions and vice versa.
 */
function parseWIF(wif, targetNetwork) {
  const parsed = ECPair.fromWIF(cleanWIF(wif), BOTH_NETWORKS);
  return ECPair.fromPrivateKey(parsed.privateKey, { network: targetNetwork, compressed: parsed.compressed });
}

// P2FK delimiter characters — subset of Windows illegal filename chars.
// NOTE: backslash (\) and double-quote (") are excluded because they break
// p2fk.io's parser when used as SIG/OBJ delimiters (confirmed 2026-03-30).
const DELIMITERS = ['/', ':', '*', '?', '<', '>', '|'];

function randomDelimiter() {
  return DELIMITERS[Math.floor(Math.random() * DELIMITERS.length)];
}

/**
 * Generate a random negative salt value (matches C# RNG pattern).
 * Range: -99999 to 0 (matching C# `Math.Abs(BitConverter.ToInt32(...) % 100000)`)
 */
function generateSalt() {
  return -Math.abs(Math.floor(Math.random() * 100000));
}

/**
 * Format an integer as a D5-padded string (matches C# .ToString("D5")).
 * Ensures at least 5 digits with zero-padding, preserving the negative sign.
 * -12 → "-00012", -99999 → "-99999", 0 → "00000"
 */
function formatD5(val) {
  const abs = Math.abs(val);
  const padded = abs.toString().padStart(5, '0');
  return val < 0 ? `-${padded}` : padded;
}

/**
 * Encode a payload into P2FK addresses.
 * Accepts a Buffer (binary-safe) or a string (converted to UTF-8).
 * Splits into 20-byte chunks, pads with '#', prepends version byte, Base58Check encodes.
 */
export function encodePayloadToAddresses(payload, versionByte = 111) {
  const inputBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  const addresses = [];

  for (let i = 0; i < inputBytes.length; i += 20) {
    let chunk = inputBytes.slice(i, i + 20);
    if (chunk.length < 20) {
      const pad = Buffer.alloc(20 - chunk.length, 0x23); // '#' padding
      chunk = Buffer.concat([chunk, pad]);
    }
    const address = bitcoin.address.toBase58Check(chunk, versionByte);
    addresses.push(address);
  }
  return addresses;
}

/**
 * Convert a keyword (URN, hashtag) to its P2FK address.
 */
export function getKeywordAddress(keyword, versionByte = 111) {
  let keyBytes = Buffer.from(keyword, 'utf-8');
  if (keyBytes.length < 20) {
    const pad = Buffer.alloc(20 - keyBytes.length, 0x23);
    keyBytes = Buffer.concat([keyBytes, pad]);
  } else if (keyBytes.length > 20) {
    keyBytes = keyBytes.slice(0, 20);
  }
  return bitcoin.address.toBase58Check(keyBytes, versionByte);
}

/**
 * Bitcoin message signing (matches Bitcoin Core's signmessage format).
 * Uses recoverable ECDSA via @noble/secp256k1.
 */
export function bitcoinMessageSign(wif, message, network) {
  const keyPair = parseWIF(wif, network);
  const msgBytes = Buffer.from(message, 'utf-8');

  // Bitcoin Signed Message format
  const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'binary');
  const msgLen = compactSize(msgBytes.length);
  const toHash = Buffer.concat([prefix, msgLen, msgBytes]);
  const msgHash = bitcoin.crypto.hash256(toHash); // double SHA256

  // Sign with recoverable ECDSA
  const { signature, recoveryId } = ecc.signRecoverable(msgHash, keyPair.privateKey);

  // Bitcoin format: flag (1 byte) + signature (64 bytes)
  const compressed = keyPair.compressed !== false;
  const flag = (compressed ? 31 : 27) + recoveryId;
  const bitcoinSig = Buffer.concat([Buffer.from([flag]), Buffer.from(signature)]);

  return bitcoinSig.toString('base64');
}

/** Encode an integer as a Bitcoin compact size (varint). */
function compactSize(n) {
  if (n < 253) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 253;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 254;
  buf.writeUInt32LE(n, 1);
  return buf;
}

/**
 * Build a signed P2FK payload.
 * Accepts a Buffer (binary-safe) or a string (converted to UTF-8).
 * Returns a Buffer: SIG<d>88<d><signature> concatenated with the payload bytes.
 */
export function buildSignedPayload(payload, wif, network) {
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
  // bitcoin.crypto.sha256 returns Uint8Array, must wrap in Buffer for .toString('hex')
  const hashHex = Buffer.from(bitcoin.crypto.sha256(payloadBuf)).toString('hex').toUpperCase();
  const signature = bitcoinMessageSign(wif, hashHex, network);

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  // Match SUP format exactly: SIG<d1>88<d2><signature><payload>
  // The signature is always 88 chars (base64 Bitcoin message signature).
  // NO extra delimiter/length wrapper between signature and payload —
  // Root.cs parser uses the FIRST <delim><digits> match after SIG to determine
  // the fileName (e.g. "BUY", "GIV", "OBJ"). An extra wrapper would set
  // fileName="" causing the content to be saved as "MSG" instead.
  const prefix = Buffer.from(`SIG${d1}88${d2}${signature}`);
  return Buffer.concat([prefix, payloadBuf]);
}

/**
 * Build a complete P2FK PRO (profile) transaction address list.
 * Returns { addresses, senderAddress, proJson } ready for transaction construction.
 */
export function buildProfileTransaction(wif, profileData, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Derive PKX/PKY from the wallet's public key (uncompressed)
  const uncompressedPubKey = Buffer.from(secp.getPublicKey(keyPair.privateKey, false));
  const pkxHex = uncompressedPubKey.slice(1, 33).toString('hex');
  const pkyHex = uncompressedPubKey.slice(33, 65).toString('hex');

  // Build PRO JSON — all fields per SUP PRO.cs
  const proData = {};
  if (profileData.urn) proData.urn = profileData.urn;
  if (profileData.displayName) proData.dnm = profileData.displayName;
  if (profileData.firstName) proData.fnm = profileData.firstName;
  if (profileData.middleName) proData.mnm = profileData.middleName;
  if (profileData.lastName) proData.lnm = profileData.lastName;
  if (profileData.suffix) proData.sfx = profileData.suffix;
  if (profileData.bio) proData.bio = profileData.bio;
  if (profileData.image) proData.img = profileData.image;
  // PKX/PKY for encrypted messaging
  proData.pkx = pkxHex;
  proData.pky = pkyHex;
  // url: Dictionary<string,string> — only include if at least one key has a value
  if (profileData.url && typeof profileData.url === 'object' && Object.keys(profileData.url).length > 0) {
    const cleanUrl = {};
    for (const [k, v] of Object.entries(profileData.url)) { if (v) cleanUrl[k] = v; }
    if (Object.keys(cleanUrl).length > 0) proData.url = cleanUrl;
  }
  // loc: Dictionary<string,string> — only include if at least one key has a value
  if (profileData.loc && typeof profileData.loc === 'object' && Object.keys(profileData.loc).length > 0) {
    const cleanLoc = {};
    for (const [k, v] of Object.entries(profileData.loc)) { if (v) cleanLoc[k] = v; }
    if (Object.keys(cleanLoc).length > 0) proData.loc = cleanLoc;
  }
  proData.cre = ['0']; // Self-owned

  const proJson = JSON.stringify(proData);
  const proBytes = Buffer.from(proJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `PRO${d1}${proBytes.length}${d2}${proJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Keywords come BEFORE the sender (their bytes get appended to the payload stream)
  const urnAddress = getKeywordAddress(profileData.urn, versionByte);
  if (!encodedAddresses.includes(urnAddress)) {
    encodedAddresses.push(urnAddress);
  }

  // P2FK protocol: sender MUST be the LAST dust output.
  // The indexer sets SignedBy = last dust address, so sender must come after all keywords.
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);

  // Tax goes AFTER keywords, BEFORE object/sender (embii confirmed this is the sweet spot)
  const taxInsertIndex = encodedAddresses.length;

  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, proJson, network: networkName, taxInsertIndex };
}

/**
 * Build a complete P2FK post (SUP message) address list.
 */
export function buildPostTransaction(wif, message, hashtags = [], toAddress = null, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  const salt = -Math.abs(Math.floor(Math.random() * 99999));
  const saltedMessage = `${message}<<${salt}>>`;
  const msgBytes = Buffer.from(saltedMessage, 'utf-8');
  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `${d1}${msgBytes.length}${d2}${saltedMessage}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Keywords come BEFORE the sender
  if (hashtags && hashtags.length > 0) {
    for (const tag of hashtags) {
      const cleanTag = tag.replace(/^#/, '');
      if (cleanTag) {
        const kwAddr = getKeywordAddress(cleanTag, versionByte);
        if (!encodedAddresses.includes(kwAddr)) encodedAddresses.push(kwAddr);
      }
    }
  }

  const recipient = toAddress || senderAddress;
  if (recipient !== senderAddress && !encodedAddresses.includes(recipient)) {
    encodedAddresses.push(recipient);
  }

  // Tax goes AFTER keywords, BEFORE sender (embii confirmed position)
  const taxInsertIndex = encodedAddresses.length;

  // Sender MUST be LAST dust output (indexer sets SignedBy = last dust address)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Derive a deterministic object address from the user's WIF + index.
 * Uses the same pattern as change/royalties derivation:
 *   SHA256(privateKey || "p2fk-obj-" || index_bytes) → child private key → P2PKH address.
 * This is always recoverable from the WIF alone.
 *
 * @param {string} wif - The user's WIF private key
 * @param {number} index - Sequential index (0, 1, 2, ...)
 * @param {string} networkName - Network identifier
 * @returns {{ address: string, wif: string }} - Derived object address and its WIF
 */
/**
 * Check if an address contains P2FK delimiter conflicts.
 * Mirrors SUP C# Root.GetKeywordByPublicAddress + delimiter regex check.
 * Decodes address to raw bytes and checks for delimiter byte followed by digit byte.
 * Delimiter bytes: \ / : * ? " < > |  (92,47,58,42,63,34,60,62,124)
 */
export function hasP2fkDelimiterConflict(address) {
  try {
    const decoded = bitcoin.address.fromBase58Check(address);
    const hashBytes = decoded.hash; // 20-byte RIPEMD160(SHA256(pubkey))
    const delimiterBytes = [92, 47, 58, 42, 63, 34, 60, 62, 124];
    for (let i = 0; i < hashBytes.length - 1; i++) {
      if (delimiterBytes.includes(hashBytes[i]) && hashBytes[i + 1] >= 0x30 && hashBytes[i + 1] <= 0x39) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function deriveObjectAddress(wif, index, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIF(wif, network);

  // Try up to 50 consecutive indices to find a delimiter-safe address (mirrors SUP approach)
  for (let attempt = 0; attempt < 50; attempt++) {
    const idx = index + attempt;
    const tag = Buffer.from(`p2fk-obj-${idx}`, 'utf-8');
    const seed = Buffer.concat([keyPair.privateKey, tag]);
    const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));

    try {
      const childKP = ECPair.fromPrivateKey(childPrivKey, { network, compressed: true });
      const { address } = bitcoin.payments.p2pkh({ pubkey: childKP.publicKey, network });

      // SUP validates addresses don't contain delimiter+digit patterns (ObjectMint.cs L793-799)
      if (!hasP2fkDelimiterConflict(address)) {
        return { address, wif: childKP.toWIF(), usedIndex: idx };
      }
    } catch {
      // Extremely rare: hash fell outside curve order. Continue to next index.
    }
  }

  // Fallback — use the last attempted index without delimiter check
  const fallbackTag = Buffer.from(`p2fk-obj-${index + 50}`, 'utf-8');
  const fallbackSeed = Buffer.concat([keyPair.privateKey, fallbackTag]);
  const fallbackKey = Buffer.from(bitcoin.crypto.sha256(fallbackSeed));
  const fallbackKP = ECPair.fromPrivateKey(fallbackKey, { network, compressed: true });
  const { address } = bitcoin.payments.p2pkh({ pubkey: fallbackKP.publicKey, network });
  return { address, wif: fallbackKP.toWIF(), usedIndex: index + 50 };
}

/**
 * Derive a deterministic profile address from the user's WIF.
 * SHA256(privateKey || "p2fk-pro-" || index_bytes) → child private key → P2PKH address.
 */
export function deriveProfileAddress(wif, index = 0, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIF(wif, network);

  const tag = Buffer.from(`p2fk-pro-${index}`, 'utf-8');
  const seed = Buffer.concat([keyPair.privateKey, tag]);
  const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));

  const childKP = ECPair.fromPrivateKey(childPrivKey, { network, compressed: true });
  const { address } = bitcoin.payments.p2pkh({ pubkey: childKP.publicKey, network });
  return { address, wif: childKP.toWIF() };
}

/**
 * Derive a deterministic collection address from the user's WIF.
 * SHA256(privateKey || "p2fk-col-" || index_bytes) → child private key → P2PKH address.
 */
export function deriveCollectionAddress(wif, index = 0, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIF(wif, network);

  const tag = Buffer.from(`p2fk-col-${index}`, 'utf-8');
  const seed = Buffer.concat([keyPair.privateKey, tag]);
  const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));

  const childKP = ECPair.fromPrivateKey(childPrivKey, { network, compressed: true });
  const { address } = bitcoin.payments.p2pkh({ pubkey: childKP.publicKey, network });
  return { address, wif: childKP.toWIF() };
}

/**
 * Get the next available object index for deterministic derivation.
 * Reads from localStorage counter; falls back to 0.
 */
export function getNextObjectIndex(mainAddress) {
  try {
    return parseInt(localStorage.getItem(`p2fk_obj_idx_${mainAddress}`) || '0', 10);
  } catch { return 0; }
}

/**
 * Increment and save the object derivation index.
 */
export function bumpObjectIndex(mainAddress) {
  const next = getNextObjectIndex(mainAddress) + 1;
  try { localStorage.setItem(`p2fk_obj_idx_${mainAddress}`, String(next)); } catch {}
  return next;
}

/**
 * Generate a safe object address (random keypair, checking for delimiter quirk).
 * Returns { address, wif } — the WIF is only needed for the object address itself.
 */
export function generateObjectAddress(networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  for (let i = 0; i < 50; i++) {
    const keyPair = ECPair.makeRandom({ network });
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });
    // Use proper byte-level P2FK delimiter check (mirrors SUP ObjectMint.cs L793-799)
    if (!hasP2fkDelimiterConflict(address)) {
      return { address, wif: keyPair.toWIF() };
    }
  }
  // Fallback
  const keyPair = ECPair.makeRandom({ network });
  const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });
  return { address, wif: keyPair.toWIF() };
}

/**
 * Build a P2FK OBJ (object creation) transaction address list.
 *
 * EXACTLY mirrors SUP C# ObjectMint.cs lines 259-403.
 *
 * Address list construction order:
 *   1. Encoded data addresses (SIG + OBJ payload)
 *   2. URN keyword address
 *   3. Extra keyword addresses
 *   4. Royalty addresses (skip signatureAddress)
 *   5. Owner addresses (skip signatureAddress) — currently only sender
 *   6. Creator addresses (skip signatureAddress) — for co-creators
 *   --- CLEANUP ---
 *   7. Remove ALL objectAddress instances
 *   8. Remove ALL signatureAddress instances
 *   9. Append objectAddress (second-to-last)
 *  10. Append signatureAddress (LAST)
 *
 * Collection support: when collectionAddress is provided, it is added to cre[1].
 * Final Creators order: [objectAddress, collectionAddress, signatureAddress]
 * This matches SUP OBJ.cs GetObjectCollectionsByAddress which reads Creators[1] as collection.
 */
export function buildObjectTransaction(wif, objectData, networkName = 'btc-testnet', pregenObj = undefined) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: signatureAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Each object gets its own unique address — always derived deterministically from WIF.
  // If pregenObj is provided, use it. Otherwise derive from WIF + auto-index.
  let objectAddress;
  if (pregenObj) {
    objectAddress = pregenObj.address;
  } else {
    // Deterministic fallback — derive from WIF so we never lose access to the object address.
    const idx = getNextObjectIndex(signatureAddress);
    const derived = deriveObjectAddress(wif, idx, networkName);
    objectAddress = derived.address;
    // Store the actual index used (may differ from idx if delimiter-unsafe addresses were skipped)
    try { localStorage.setItem(`p2fk_obj_idx_${signatureAddress}`, String((derived.usedIndex || idx) + 1)); } catch {}
  }

  // --- Build keyword addresses (non-data outputs, in forward order) ---
  const keywordAddresses = [];

  // 1. URN keyword (SUP line 296)
  const urnAddr = getKeywordAddress(objectData.urn, versionByte);
  if (!keywordAddresses.includes(urnAddr)) keywordAddresses.push(urnAddr);

  // 2. Extra keywords (SUP lines 357-360)
  if (objectData.keywords) {
    for (const kw of objectData.keywords) {
      const clean = kw.replace(/^#/, '');
      if (clean) {
        const kwAddr = getKeywordAddress(clean, versionByte);
        if (!keywordAddresses.includes(kwAddr)) keywordAddresses.push(kwAddr);
      }
    }
  }

  // 3. Royalty addresses — skip signatureAddress (SUP lines 362-368)
  const royaltyAddrs = [];
  if (objectData.royalties && Object.keys(objectData.royalties).length > 0) {
    for (const addr of Object.keys(objectData.royalties)) {
      if (addr !== signatureAddress && !keywordAddresses.includes(addr)) {
        keywordAddresses.push(addr);
        royaltyAddrs.push(addr);
      }
    }
  }

  // 4. Owner addresses — skip signatureAddress (SUP lines 372-379)
  // Currently only sender is initial owner, so nothing extra to add.

  // 5. Creator addresses — collection address if provided (SUP lines 382-389)
  const hasCollection = !!objectData.collectionAddress;
  if (hasCollection && !keywordAddresses.includes(objectData.collectionAddress)) {
    keywordAddresses.push(objectData.collectionAddress);
  }

  // --- CLEANUP: Match SUP lines 391-403 exactly ---
  // Remove ALL instances of objectAddress and signatureAddress from the list
  // Then re-add them at the END in the correct order: objectAddress, signatureAddress

  // --- Build OBJ JSON with integer reverse indices ---
  // Reverse index = position from the END of the final keyword+object+sender list
  // Final list will be: [...keywords, objectAddress, signatureAddress]
  //   (collection address stays in keywords if present)
  // Reverse: signatureAddress=0, objectAddress=1, last_keyword=2, ...

  const totalKeywords = keywordAddresses.length + 2; // +2 for objectAddress and signatureAddress
  const senderRevIdx = 0; // signatureAddress is always LAST → reverse index 0
  const objAddrRevIdx = 1; // objectAddress is always second-to-last → reverse index 1

  // Royalty reverse indices
  const getRevIdx = (addr) => {
    const fwdIdx = keywordAddresses.indexOf(addr);
    if (fwdIdx === -1) return -1;
    return totalKeywords - 1 - fwdIdx;
  };

  const objData = { urn: objectData.urn };
  if (objectData.name) objData.nme = objectData.name;
  if (objectData.description) objData.dsc = objectData.description;
  if (objectData.image) objData.img = objectData.image;
  if (objectData.uri) objData.uri = objectData.uri;
  if (objectData.license) objData.lic = objectData.license;
  if (objectData.maxPerAddress && objectData.maxPerAddress > 0) objData.max = objectData.maxPerAddress;

  // Creator ordering (per SUP C# OBJ.cs):
  //   cre is string[] in C# — ALL values MUST be strings (not integers)
  //   cre[0] = objectAddress (Creators[0], MUST match the transaction's object address)
  //   cre[1] = collectionAddress (Creators[1], if part of a collection)
  //   cre[last] = signatureAddress (artist, always reverse index 0)
  if (hasCollection) {
    const collRevIdx = getRevIdx(objectData.collectionAddress);
    objData.cre = [String(objAddrRevIdx), String(collRevIdx), String(senderRevIdx)];
  } else {
    objData.cre = [String(objAddrRevIdx), String(senderRevIdx)];
  }

  // own: Dictionary<string, long> in C# — keys are string reverse indices, values are integers
  objData.own = {};
  objData.own[String(senderRevIdx)] = objectData.quantity || 1;

  // roy: Dictionary<string, decimal> in C# — keys are string reverse indices, values are decimals
  if (royaltyAddrs.length > 0) {
    objData.roy = {};
    for (const addr of royaltyAddrs) {
      const revIdx = getRevIdx(addr);
      if (revIdx >= 0) {
        objData.roy[String(revIdx)] = objectData.royalties[addr];
      }
    }
  }

  const objJson = JSON.stringify(objData);
  const objBytes = Buffer.from(objJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `OBJ${d1}${objBytes.length}${d2}${objJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Build the full address list: [encoded_data] + [keywords]
  const fullList = [...encodedAddresses];
  for (const kwAddr of keywordAddresses) {
    if (!fullList.includes(kwAddr)) fullList.push(kwAddr);
  }

  // CLEANUP (SUP lines 391-403): Remove ALL objectAddress and signatureAddress, re-add at end
  while (fullList.includes(objectAddress)) {
    fullList.splice(fullList.indexOf(objectAddress), 1);
  }
  while (fullList.includes(signatureAddress)) {
    fullList.splice(fullList.indexOf(signatureAddress), 1);
  }

  // Tax goes AFTER keywords, BEFORE object/sender (embii confirmed: sweet spot
  // between keyword addresses and creators/owners/object address)
  const taxInsertIndex = fullList.length;

  fullList.push(objectAddress);       // second-to-last (reverse index 1)
  fullList.push(signatureAddress);    // LAST (reverse index 0)

  return { addresses: fullList, senderAddress: signatureAddress, objectAddress, network: networkName, taxInsertIndex };
}

/**
 * Build a P2FK OBJ update transaction — used to transfer creator control.
 *
 * In the SUP protocol, an existing creator can send a new OBJ transaction
 * to the same object address with updated fields. The indexer:
 *   1. Verifies the signer is a current creator
 *   2. Keeps objectAddress as the first creator (collection identity)
 *   3. Replaces remaining creators with the new `cre` array entries
 *   4. Updates any other provided fields (if object is not locked)
 *
 * For creator transfer: send cre=[objectAddress, newCreatorAddress]
 * The old creator (signer) is dropped from the creator list.
 *
 * @param {string} wif - Current creator's private key (WIF)
 * @param {string} objectAddress - The object to update
 * @param {string} newCreatorAddress - The new creator/owner address
 * @param {object} [updateFields] - Optional additional fields to update (nme, dsc, img, lic, atr, etc.)
 * @param {string} networkName - Network identifier
 */
export function buildObjectUpdateTransaction(wif, objectAddress, newCreatorAddress, updateFields = {}, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: signatureAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Build keyword addresses
  const keywordAddresses = [];

  // Add the new creator address as a keyword (if different from object and sender)
  if (newCreatorAddress !== objectAddress && newCreatorAddress !== signatureAddress) {
    if (!keywordAddresses.includes(newCreatorAddress)) {
      keywordAddresses.push(newCreatorAddress);
    }
  }

  // Final address list will be: [...encoded, ...keywords, objectAddress, signatureAddress]
  // Reverse indices: signatureAddress=0, objectAddress=1, then keywords from end
  const totalKeywords = keywordAddresses.length + 2; // +2 for objectAddress and signatureAddress
  const senderRevIdx = 0;
  const objAddrRevIdx = 1;

  // Compute new creator's reverse index
  let newCreatorRevIdx;
  if (newCreatorAddress === objectAddress) {
    newCreatorRevIdx = objAddrRevIdx;
  } else if (newCreatorAddress === signatureAddress) {
    newCreatorRevIdx = senderRevIdx;
  } else {
    const fwdIdx = keywordAddresses.indexOf(newCreatorAddress);
    newCreatorRevIdx = totalKeywords - 1 - fwdIdx;
  }

  // Build the OBJ JSON — only include cre and any update fields
  const objData = {};

  // cre: string[] in C# — [objectAddress (collection identity), newCreator]
  objData.cre = [String(objAddrRevIdx), String(newCreatorRevIdx)];

  // Include any additional update fields
  if (updateFields.name) objData.nme = updateFields.name;
  if (updateFields.description) objData.dsc = updateFields.description;
  if (updateFields.image) objData.img = updateFields.image;
  if (updateFields.license) objData.lic = updateFields.license;
  if (updateFields.uri) objData.uri = updateFields.uri;
  if (updateFields.attributes) objData.atr = updateFields.attributes;

  const objJson = JSON.stringify(objData);
  const objBytes = Buffer.from(objJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `OBJ${d1}${objBytes.length}${d2}${objJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Build the full address list
  const fullList = [...encodedAddresses];
  for (const kwAddr of keywordAddresses) {
    if (!fullList.includes(kwAddr)) fullList.push(kwAddr);
  }

  // CLEANUP: Remove objectAddress and signatureAddress, re-add at end
  while (fullList.includes(objectAddress)) {
    fullList.splice(fullList.indexOf(objectAddress), 1);
  }
  while (fullList.includes(signatureAddress)) {
    fullList.splice(fullList.indexOf(signatureAddress), 1);
  }

  // Tax goes AFTER keywords, BEFORE object/sender (embii confirmed: sweet spot)
  const taxInsertIndex = fullList.length;

  fullList.push(objectAddress);       // second-to-last (reverse index 1)
  fullList.push(signatureAddress);    // LAST (reverse index 0)

  return { addresses: fullList, senderAddress: signatureAddress, objectAddress, network: networkName, taxInsertIndex };
}


/**
 * Build a P2FK GIV (give object) transaction address list.
 *
 * Matches SUP C# ObjectGive.cs:
 *   - JSON is List<List<string>> — ALL values are strings
 *   - Position indices reference Keyword.Reverse() in the indexer:
 *       0 = sender (self), 1 = object address, 2+ = recipients
 *   - Salt is D5-padded negative integer string
 *   - Address order: [...encoded, ...recipients(reversed), objectAddress, senderAddress]
 */
export function buildGiveTransaction(wif, objectAddress, recipientAddress, quantity = 1, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Determine position index based on recipient (matches C# ObjectGive.cs logic)
  // Keyword.Reverse() indices: 0=sender, 1=objectAddress, 2+=recipients
  let givEntries;
  if (recipientAddress === senderAddress) {
    // Self-give: position 0 (references sender)
    givEntries = [['0', String(quantity)]];
  } else if (objectAddress === senderAddress) {
    // Sender IS the primary pool (object address): position 1
    givEntries = [['1', String(quantity)]];
  } else {
    // Normal give: position 2 for recipient
    givEntries = [['2', String(quantity)]];
  }

  // Salt: D5-padded negative integer string (matches C# salt.ToString("D5"))
  const salt = generateSalt();
  givEntries.push(['0', formatD5(salt)]);

  const givJson = JSON.stringify(givEntries);
  const givBytes = Buffer.from(givJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `GIV${d1}${givBytes.length}${d2}${givJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Tax goes AFTER keywords/recipient, BEFORE sender (embii confirmed: after keywords, before creators/object)
  if (recipientAddress !== senderAddress && recipientAddress !== objectAddress) {
    if (!encodedAddresses.includes(recipientAddress)) encodedAddresses.push(recipientAddress);
  }

  const taxInsertIndex = encodedAddresses.length;

  if (!encodedAddresses.includes(objectAddress)) encodedAddresses.push(objectAddress);

  // Sender MUST be LAST dust output (indexer sets SignedBy = last dust address)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Build a P2FK BRN (burn object) transaction address list.
 *
 * Matches SUP C# ObjectBurn.cs:
 *   - JSON is List<List<long>> — ALL values are integers (NOT strings)
 *   - Position 1 = first object (brnOrder starts at 1)
 *   - Position 0 = self-burn (if burning own held units)
 *   - Salt is plain integer (NOT D5-padded)
 *   - Address order: [...encoded, ...burnTargets(reversed), senderAddress]
 */
export function buildBurnTransaction(wif, objectAddress, quantity = 1, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // BRN JSON: [[position, qty], [0, salt]] — all integers (matches C# List<List<long>>)
  // C# ObjectBurn.cs special case: when the object address IS the sender's address
  // (self-burn, e.g. creator burning their own object), use position 0.
  // Otherwise use position 1 (index into Keyword.Reverse() pointing to objectAddress).
  // With self-burn there is only ONE keyword (the combined address), so index 1
  // would be out of bounds and the indexer silently ignores the burn.
  const salt = generateSalt();
  const burnPosition = (objectAddress === senderAddress) ? 0 : 1;
  const brnData = [[burnPosition, quantity], [0, salt]];
  const brnJson = JSON.stringify(brnData);
  const brnBytes = Buffer.from(brnJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `BRN${d1}${brnBytes.length}${d2}${brnJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // C# ObjectBurn.cs: burn target addresses (reversed), then senderAddress
  // IMPORTANT: No tax address for burns — the indexer uses burn[0] as an index
  // into the tail addresses (Keyword.Reverse). A tax address would shift the index.
  const taxInsertIndex = -1; // No tax for burns

  if (!encodedAddresses.includes(objectAddress)) encodedAddresses.push(objectAddress);

  // Sender MUST be LAST dust output (indexer sets SignedBy = last dust address)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Build a P2FK batch BRN (multi-object burn) transaction address list.
 *
 * Per embii (protocol author):
 *   - Batch burn happens in a SINGLE transaction
 *   - Every object address being burned gets its own dust output
 *   - Use the HIGHEST quantity across all items for the BRN payload
 *   - The indexer burns what it can per object (graceful over-burn)
 *   - BRN payload: [[1, maxQty], [0, salt]] — position 1, same as single burn
 *   - Special case: if any objectAddress === senderAddress, use position 0 (self-burn)
 *
 * @param {string} wif
 * @param {{objectAddress: string, quantity: number}[]} burnItems
 * @param {string} networkName
 * @returns {{ addresses: string[], senderAddress: string, network: string, taxInsertIndex: number }}
 */
export function buildBatchBurnTransaction(wif, burnItems, networkName = 'btc-testnet') {
  if (!burnItems?.length) throw new Error('No items to burn');

  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Collect unique object addresses, find the max quantity
  const objectAddresses = [];
  let maxQty = 0;
  let hasSelfBurn = false;

  for (const { objectAddress, quantity } of burnItems) {
    if (objectAddresses.includes(objectAddress)) continue; // skip dupes
    objectAddresses.push(objectAddress);
    if (quantity > maxQty) maxQty = quantity;
    if (objectAddress === senderAddress) hasSelfBurn = true;
  }

  // BRN payload: single entry with max qty. Position 0 = self-burn, 1 = normal.
  const salt = generateSalt();
  const burnPosition = hasSelfBurn ? 0 : 1;
  const brnData = [[burnPosition, maxQty], [0, salt]];

  const brnJson = JSON.stringify(brnData);
  const brnBytes = Buffer.from(brnJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `BRN${d1}${brnBytes.length}${d2}${brnJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  const taxInsertIndex = -1; // No tax for burns

  // Dust every object address (reversed, per C# dictionary.Keys.Reverse())
  const objectAddrsReversed = [...objectAddresses].reverse();
  for (const addr of objectAddrsReversed) {
    if (!encodedAddresses.includes(addr)) encodedAddresses.push(addr);
  }

  // Sender MUST be LAST dust output (indexer sets SignedBy = last dust address)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Build a P2FK BUY (buy object) transaction address list.
 *
 * EXACTLY mirrors SUP C# ObjectBuy.cs lines 1341-1372.
 * SUP uses a Dictionary<string,decimal> for recipients, which means:
 *   - Each address appears ONCE (no duplicate outputs)
 *   - objectAddress uses try-catch on Add (silently skips if already in dict)
 *
 * Output order: [encoded_data(dust)] → [royalties(payment)] → [owner(payment)]
 *               → [objectAddress(dust)] → [senderAddress(dust)] → [change]
 *
 * If objectAddress == ownerAddress, the owner payment replaces the dust output.
 * If a royalty address == a data address, the payment amount replaces the dust.
 */
export function buildBuyTransaction(wif, objectAddress, ownerAddress, quantity = 1, priceSats = 0, networkName = 'btc-testnet', royalties = {}) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // BUY JSON: [["ownerAddress", "qty"], ["0", "salt_D5"]] (all strings)
  const salt = generateSalt();
  const buyData = [[ownerAddress, String(quantity)], ['0', formatD5(salt)]];
  const buyJson = JSON.stringify(buyData);
  const buyBytes = Buffer.from(buyJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `BUY${d1}${buyBytes.length}${d2}${buyJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // ----- Build a Dictionary-style recipients map (mirrors SUP C# exactly) -----
  // SUP uses Dictionary.Add which throws on duplicates; we use a Map to merge.
  const recipients = new Map(); // address → { value, isDust }

  // 1) Encoded data addresses — 546 dust each (SUP line 1342-1345)
  for (const addr of encodedAddresses) {
    if (!recipients.has(addr)) {
      recipients.set(addr, { value: 546, isDust: true });
    }
    // If duplicate in encoded list, skip (SUP uses try-catch)
  }

  // 2) Royalty payments (SUP lines 1351-1367)
  const DUST = 546;
  let remainingCost = priceSats;
  if (royalties && Object.keys(royalties).length > 0) {
    for (const [royaltyAddr, royaltyPct] of Object.entries(royalties)) {
      // SUP line 1353: skip if royalty recipient is the owner OR the buyer
      if (royaltyAddr === ownerAddress || royaltyAddr === senderAddress) continue;
      const rawRoyalty = Math.floor(priceSats * (royaltyPct / 100));
      let royaltyCost = rawRoyalty;
      if (royaltyCost < DUST) royaltyCost = DUST;
      // Overwrite any existing dust for this address (payment takes priority)
      recipients.set(royaltyAddr, { value: royaltyCost, isDust: false });
      remainingCost -= rawRoyalty;
    }
  }

  // 3) Owner payment — ALWAYS added, min 546 sats (SUP lines 1369-1370)
  if (remainingCost < DUST) remainingCost = DUST;
  recipients.set(ownerAddress, { value: remainingCost, isDust: false });

  // 4) Object address — try-add as dust (SUP line 1371, uses try-catch)
  // If objectAddress already exists (e.g., it == ownerAddress), skip silently
  if (!recipients.has(objectAddress)) {
    recipients.set(objectAddress, { value: DUST, isDust: true });
  }

  // 5) Sender address — always added as dust (SUP line 1372)
  // If sender is already in the dict (unlikely but possible), overwrite
  if (!recipients.has(senderAddress)) {
    recipients.set(senderAddress, { value: DUST, isDust: true });
  }

  // ----- Convert the Map into buildAndBroadcast parameters -----
  // Split into: dataAddresses (dust targets), extraPaymentOutputs, postPaymentDustAddresses
  // We need to maintain the SUP output order:
  //   [data_dust] → [royalty_payments] → [owner_payment] → [objectAddr_dust] → [sender_dust]

  const dataAddresses = [];      // P2FK encoded data only (dust)
  const extraPaymentOutputs = []; // royalties + owner (non-dust payments)
  const postPaymentDustAddresses = []; // object + sender dust (after payments)

  // Track which addresses have been assigned
  const encodedSet = new Set(encodedAddresses);

  for (const [addr, info] of recipients) {
    if (encodedSet.has(addr) && info.isDust) {
      // Encoded data address with dust value
      dataAddresses.push(addr);
    } else if (addr === objectAddress && info.isDust) {
      postPaymentDustAddresses.push(addr);
    } else if (addr === senderAddress && info.isDust) {
      postPaymentDustAddresses.push(addr);
    } else if (!info.isDust) {
      extraPaymentOutputs.push({ address: addr, value: info.value });
    } else {
      // Fallback — shouldn't happen, but add as data
      dataAddresses.push(addr);
    }
  }

  return {
    addresses: dataAddresses,
    senderAddress,
    priceSats,
    ownerAddress,
    extraPaymentOutputs,
    postPaymentDustAddresses,
    network: networkName,
    taxInsertIndex: dataAddresses.length,
  };
}


/**
 * Build a P2FK LST (list object for sale) transaction address list.
 *
 * Matches SUP C# ObjectBuy.cs (giveButton_Click / LST section):
 *   - JSON is List<List<string>> — ALL values are strings
 *   - Entry: ["objectAddress", "quantity", "priceEach"]
 *   - Salt: ["0", D5-padded negative integer]
 *   - Address order: [...encoded, objectAddress, senderAddress]
 *
 * Primary vs Secondary listing (per embii):
 *   - If senderAddress == objectAddress → Primary listing
 *   - Otherwise → Secondary listing
 */
export function buildListTransaction(wif, objectAddress, quantity, priceEachBtc, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // LST JSON: List<List<string>> — ALL values are strings (matches SUP C# ObjectBuy.cs line 1454)
  // Salt: D5-padded negative integer string (matches C# salt.ToString("D5"))
  const salt = generateSalt();
  const lstData = [
    [objectAddress, String(quantity), String(priceEachBtc)],
    ['0', formatD5(salt)],
  ];
  const lstJson = JSON.stringify(lstData);
  const lstBytes = Buffer.from(lstJson, 'utf-8');

  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `LST${d1}${lstBytes.length}${d2}${lstJson}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // C# ObjectBuy.cs LST: objectAddress then senderAddress
  // Tax insert point: after data, before objectAddress and sender
  const taxInsertIndex = encodedAddresses.length;

  if (!encodedAddresses.includes(objectAddress)) encodedAddresses.push(objectAddress);

  // Sender MUST be LAST dust output (indexer sets SignedBy = last dust address)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, objectAddress, network: networkName, taxInsertIndex };
}


/**
 * Build a P2FK private message (SEC-encrypted root) with ANONYMOUS signing.
 *
 * Per SUP DiscoBall.cs: the sender's signature (SIG) must be INSIDE the encrypted
 * SEC payload so no one but the recipient can identify the sender.
 *
 * On-chain format: SEC<sep><byteLength><sep><encrypted_bytes>
 *   — NO public SIG visible on-chain.
 *
 * Inside the encrypted payload (visible only to recipient after decryption):
 *   SIG<d>88<d><signature><saltedMessage>
 *
 * The recipient decrypts, strips the SIG prefix, and gets the plaintext message.
 *
 * @param {string} wif - Sender's WIF
 * @param {string} message - Plaintext message to encrypt
 * @param {string} recipientAddress - Recipient's Bitcoin address
 * @param {string} pkx - Recipient's PKX hex (from profile)
 * @param {string} pky - Recipient's PKY hex (from profile)
 * @param {string} networkName - 'btc-testnet' or 'btc-mainnet'
 * @returns {Promise<{addresses, senderAddress, network, taxInsertIndex}>}
 */
export async function buildPrivateMessageTransaction(wif, message, recipientAddress, pkx, pky, networkName = 'btc-testnet') {
  const { eciesEncrypt, publicKeyFromPKXY } = await import('./ecies');

  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Step 1: Build the salted message (same as regular posts)
  const salt = -Math.abs(Math.floor(Math.random() * 99999));
  const saltedMessage = `${message}<<${salt}>>`;

  // Step 2: Sign the salted message — SIG goes INSIDE the encrypted envelope
  // After decryption, recipient sees: SIG<d>88<d><base64_signature><saltedMessage>
  const signedInner = buildSignedPayload(saltedMessage, wif, network);

  // Step 3: Encrypt the SIGNED payload with the recipient's public key (ECIES)
  const recipientPubKey = publicKeyFromPKXY(pkx, pky);
  const encryptedBytes = await eciesEncrypt(recipientPubKey, signedInner);

  // Step 4: Wrap as SEC format — this is the ONLY thing visible on-chain
  // On-chain: SEC<sep><byteLength><sep><encrypted_blob> — NO outer SIG
  const separators = [92, 47, 58, 42, 63, 34, 60, 62, 124];
  const sep1 = separators[Math.floor(Math.random() * separators.length)];
  const sep2 = separators[Math.floor(Math.random() * separators.length)];
  const secPayload = Buffer.concat([
    Buffer.from('SEC'),
    Buffer.from([sep1]),
    Buffer.from(encryptedBytes.length.toString()),
    Buffer.from([sep2]),
    Buffer.from(encryptedBytes),
  ]);

  // Step 5: Encode SEC directly into P2FK addresses — NO outer signature
  const encodedAddresses = encodePayloadToAddresses(secPayload, versionByte);

  // Keywords: recipient address comes before sender
  if (!encodedAddresses.includes(recipientAddress)) {
    encodedAddresses.push(recipientAddress);
  }

  // Tax insert point: after data+recipient, before sender
  const taxInsertIndex = encodedAddresses.length;

  // Sender MUST be LAST dust output (P2FK protocol requirement for UTXO routing)
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Strip the SIG prefix from a decrypted private message payload.
 *
 * Handles both formats:
 *  - Correct (SUP-compatible): SIG<d>88<d><88_char_base64_sig><message>
 *  - Legacy (broken pre-fix): SIG<d>88<d><88_char_base64_sig><d><len><d><message>
 *
 * Returns just the message bytes after stripping signature + any legacy delimiters.
 *
 * @param {Uint8Array|Buffer} plainBytes — decrypted inner payload
 * @returns {Uint8Array} — message bytes with SIG prefix stripped
 */
export function stripSigPrefix(plainBytes) {
  const bytes = plainBytes instanceof Uint8Array ? plainBytes : new Uint8Array(plainBytes);

  // Check for SIG prefix (0x53=S, 0x49=I, 0x47=G)
  if (bytes.length < 6 || bytes[0] !== 0x53 || bytes[1] !== 0x49 || bytes[2] !== 0x47) {
    return bytes; // No SIG prefix — return as-is (backwards compat with old format)
  }

  // SIG<d1>88<d2><88_chars_signature>...
  // d1 is at index 3, "88" at index 4-5, d2 at index 6, signature starts at index 7
  const sigStart = 7;
  const sigEnd = sigStart + 88;

  if (bytes.length <= sigEnd) {
    return bytes; // Malformed — too short, return as-is
  }

  let msgStart = sigEnd;

  // Check for delimiter-wrapped byte length: <d3><digits><d4><message>
  // Only advance past delimiters if actual DIGITS follow the first separator.
  // Without digits, the "separator" byte is actually part of the message itself.
  const afterSig = bytes[msgStart];
  if (afterSig && _isP2fkSeparator(afterSig)) {
    let i = msgStart + 1; // tentatively skip d3
    let hasDigits = false;
    while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39) {
      i++;
      hasDigits = true;
    }
    if (hasDigits) {
      // Found digits → this IS the delimiter-wrapped format: {d3}{len}{d4}
      if (i < bytes.length && _isP2fkSeparator(bytes[i])) i++; // skip d4
      msgStart = i;
    }
    // No digits after the "separator" → it's part of the message, don't advance
  }

  return bytes.slice(msgStart);
}

// P2FK separator characters: \ / : * ? " < > |
function _isP2fkSeparator(byte) {
  return [92, 47, 58, 42, 63, 34, 60, 62, 124].includes(byte);
}


// ─── INQ (Inquiry/Poll) Transaction Builder ──────────────────────────────────
/**
 * Build an INQ (poll) transaction.
 * Follows the SUP C# INQMint pattern exactly:
 *   - Generate unique address for question (que key)
 *   - Generate unique address for each answer (ans keys)
 *   - Encode INQ JSON as P2FK payload: "INQ<delim><len><delim><json>"
 *   - Send to the question address
 *
 * @param {string} wif              - Creator's wallet WIF
 * @param {string} question         - The poll question text
 * @param {string[]} answers        - Array of answer option strings
 * @param {object} gates            - Token gating: { own: [objectAddr], cre: [creatorAddr] }
 * @param {number} endBlocks        - Blocks until poll closes (0 = never)
 * @param {boolean} requireSignature - Require signed votes (default true)
 * @param {string} networkName      - 'btc-testnet' | 'btc-mainnet' etc.
 * @returns {object} { addresses, senderAddress, questionAddress, answerAddresses, network, taxInsertIndex }
 */
export function buildInquiryTransaction(wif, question, answers, gates = {}, endBlocks = 0, requireSignature = true, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;
  const cleanedWif = cleanWIF(wif);
  const keyPair = parseWIF(cleanedWif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Generate a unique address for the question
  // SUP uses: getnewaddress(question + "!" + timestamp + "!" + attempt)
  // We use: hash-derived address from question + timestamp + random
  const questionSeed = question + '!' + Date.now().toString() + '!' + Math.random().toString(36);
  const questionAddress = generateDeterministicAddress(questionSeed, versionByte);

  // Generate unique addresses for each answer
  const answerAddresses = {};
  answers.forEach((ans, i) => {
    const ansSeed = ans + '!' + Date.now().toString() + '!' + i + '!' + Math.random().toString(36);
    answerAddresses[generateDeterministicAddress(ansSeed, versionByte)] = ans;
  });

  // Build INQ JSON (matching C# INQ class structure)
  const inqJson = {};
  inqJson.que = { [questionAddress]: question };
  if (Object.keys(answerAddresses).length > 0) {
    inqJson.ans = answerAddresses;
  }
  if (gates.own && gates.own.length > 0) {
    inqJson.own = gates.own;
  }
  if (gates.cre && gates.cre.length > 0) {
    inqJson.cre = gates.cre;
  }
  if (!requireSignature) {
    inqJson.any = 1;
  }
  if (endBlocks > 0) {
    inqJson.end = endBlocks;
  }

  // Serialize — match C# NullValueHandling.Ignore + strip empty defaults
  let jsonStr = JSON.stringify(inqJson);
  // Remove empty fields same as C#
  jsonStr = jsonStr.replace(/,"ans":\{\}/g, '').replace(/,"que":\{\}/g, '')
                   .replace(/,"own":\[\]/g, '').replace(/,"cre":\[\]/g, '')
                   .replace(/,"end":0/g, '').replace(/,"any":0/g, '');

  const jsonBytes = Buffer.from(jsonStr, 'utf-8');
  const d3 = randomDelimiter();
  const d4 = randomDelimiter();
  const inqPayloadPart = `INQ${d3}${jsonBytes.length}${d4}${jsonStr}`;

  // C# DiscoBall flow:
  //   transMessage = messageText + "<<salt>>"
  //   OBJP2FK = delimiter + msgBytes.Length + delimiter + transMessage + txtINQJson.Text
  //   Then signed: "SIG" + d + "88" + d + signature + OBJP2FK
  //
  // The INQ JSON is APPENDED to the message payload, not encoded separately.
  const salt = -Math.abs(Math.floor(Math.random() * 99999));
  const messageText = `<<${salt}>>`;
  const msgBytes = Buffer.from(messageText, 'utf-8');
  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const messagePayload = `${d1}${msgBytes.length}${d2}${messageText}${inqPayloadPart}`;

  // Sign and encode the combined payload
  const fullPayload = buildSignedPayload(messagePayload, cleanedWif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Question address goes AFTER payload, BEFORE sender (matches C# txtINQAddress)
  if (!encodedAddresses.includes(questionAddress)) {
    encodedAddresses.push(questionAddress);
  }

  // Tax insert point: after data + question keyword, before sender
  const taxInsertIndex = encodedAddresses.length;

  // Sender MUST be LAST dust output
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return {
    addresses: encodedAddresses,
    senderAddress,
    questionAddress,
    answerAddresses,
    network: networkName,
    taxInsertIndex,
  };
}

/**
 * Build a vote transaction for an INQ poll.
 * Voting = sending a transaction to the answer's address.
 * The P2FK indexer counts transactions at each answer address as votes.
 *
 * @param {string} wif           - Voter's WIF
 * @param {string} answerAddress - The P2FK address of the answer to vote for
 * @param {string} networkName   - Network
 * @returns {object} { addresses, senderAddress, network, taxInsertIndex }
 */
export function buildVoteTransaction(wif, answerAddress, networkName = 'btc-testnet', pollTxId = null) {
  // Matches C# DiscoBall vote flow EXACTLY:
  //   string INQToKey = Root.GetPublicAddressByKeyword(transactionId);
  //   string voteDust = INQToKey + "," + answerAddress;
  //   DiscoBall disco = new DiscoBall(activeprofile, "", voteDust, ...);
  //
  // DiscoBall reverses the comma-split destinations, so output order is:
  //   [payload_addrs..., answerAddress, INQToKey, senderAddress]
  //
  // A vote is a SIGNED P2FK Root with EMPTY content, destinations are
  // the answer address and the INQ keyword address (not hashtags).

  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Empty message with salt (matches C#: supMessage.Text = "")
  const salt = -Math.abs(Math.floor(Math.random() * 99999));
  const saltedMessage = `<<${salt}>>`;
  const msgBytes = Buffer.from(saltedMessage, 'utf-8');
  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const payload = `${d1}${msgBytes.length}${d2}${saltedMessage}`;

  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Destinations: answerAddress first, then INQToKey (matches C# reverse iteration)
  if (answerAddress && answerAddress !== senderAddress && !encodedAddresses.includes(answerAddress)) {
    encodedAddresses.push(answerAddress);
  }
  if (pollTxId) {
    const inqToKey = getKeywordAddress(pollTxId, versionByte);
    if (!encodedAddresses.includes(inqToKey)) {
      encodedAddresses.push(inqToKey);
    }
  }

  // Tax position (after destinations, before sender)
  const taxInsertIndex = encodedAddresses.length;

  // Sender MUST be LAST
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress);

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Generate a deterministic P2FK address from a seed string.
 * Used for creating unique question/answer addresses.
 */
function generateDeterministicAddress(seed, versionByte = 111) {
  const seedBytes = Buffer.from(seed, 'utf-8');
  const hashBytes = Buffer.from(bitcoin.crypto.sha256(seedBytes));
  const payload = hashBytes.slice(0, 20);
  return bitcoin.address.toBase58Check(payload, versionByte);
}

/**
 * Derive PKX/PKY hex strings from a WIF private key.
 */
export function derivePKXPKY(wif, network = 'btc-testnet') {
  const libNetwork = network.includes('mainnet') ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIF(wif, libNetwork);
  const uncompressedPubKey = Buffer.from(ecc.pointCompress(keyPair.publicKey, false));
  const pkx = uncompressedPubKey.slice(1, 33).toString('hex');
  const pky = uncompressedPubKey.slice(33, 65).toString('hex');
  return { pkx, pky };
}



/**
 * Build an encrypted P2FK self-message (vault entry) transaction.
 * Takes a pre-encrypted SEC-wrapped payload (binary Uint8Array/Buffer),
 * signs it, encodes into P2FK addresses, and addresses it to self.
 *
 * This mirrors SUP's private message format:
 *   SIG<d1>88<d2><signature> + <d3><byteLength><d4><SEC-encrypted-bytes><<salt>>
 *
 * @param {string} wif - User's private key (WIF)
 * @param {Uint8Array|Buffer} secPayload - SEC-wrapped encrypted bytes from ecies.wrapAsSEC
 * @param {string} networkName - Network identifier (e.g. 'btc-testnet')
 * @returns {{ addresses: string[], senderAddress: string, network: string, taxInsertIndex: number }}
 */
export function buildEncryptedMsgTransaction(wif, secPayload, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const versionByte = isMainnet ? 0 : 111;

  const keyPair = parseWIF(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Construct the message payload: <d1><byteLength><d2><SEC-bytes><<salt>>
  const salt = generateSalt();
  const saltStr = `<<${salt}>>`;
  const secBuf = Buffer.from(secPayload);
  const totalLen = secBuf.length + Buffer.byteLength(saltStr, 'utf-8');
  const d1 = randomDelimiter();
  const d2 = randomDelimiter();
  const header = Buffer.from(`${d1}${totalLen}${d2}`);
  const saltBuf = Buffer.from(saltStr, 'utf-8');
  const payload = Buffer.concat([header, secBuf, saltBuf]);

  // Sign and encode
  const fullPayload = buildSignedPayload(payload, wif, network);
  const encodedAddresses = encodePayloadToAddresses(fullPayload, versionByte);

  // Self-message: sender address as recipient keyword AND last dust output (signedBy)
  // Remove sender if already present, then add at end
  const idx = encodedAddresses.indexOf(senderAddress);
  if (idx !== -1) encodedAddresses.splice(idx, 1);
  encodedAddresses.push(senderAddress); // sender = last = signedBy

  const taxInsertIndex = encodedAddresses.length - 1; // before sender

  return { addresses: encodedAddresses, senderAddress, network: networkName, taxInsertIndex };
}

/**
 * Estimate the on-chain cost (in satoshis) for a vault entry.
 *
 * @param {number} rawByteLength - Size of the plaintext content in bytes
 * @param {number} feeRate - Fee rate in sat/vbyte (default: 3)
 * @returns {{ numAddresses, numOutputs, dustCost, txFee, totalSats, encryptedEstimate }}
 */
export function estimateOnChainCost(rawByteLength, feeRate = 3) {
  // ECIES overhead: 65 (ephemeral pubkey) + 16 (IV) + ~16 (PKCS7 padding max)
  const eciesOverhead = 97;
  // SEC header: "SEC" + sep + length_digits + sep ≈ 12 bytes
  const secOverhead = 12;
  // SIG prefix: "SIG" + sep + "88" + sep + 88-char base64 sig ≈ 95 bytes
  const sigOverhead = 95;
  // Delimiter + length + delimiter + salt "<<-NNNNN>>" ≈ 25 bytes
  const frameOverhead = 25;

  const totalPayloadBytes = rawByteLength + eciesOverhead + secOverhead + sigOverhead + frameOverhead;
  const numAddresses = Math.ceil(totalPayloadBytes / 20);
  const numOutputs = numAddresses + 2; // +1 sender/keyword + 1 change output

  const dustCost = numOutputs * 546;
  // TX size estimate: 10 header + 1 input × ~148 + outputs × 34 + 10 padding
  const txSize = 10 + 148 + numOutputs * 34 + 10;
  const txFee = Math.ceil(txSize * feeRate);

  return {
    numAddresses,
    numOutputs,
    dustCost,
    txFee,
    totalSats: dustCost + txFee,
    encryptedEstimate: totalPayloadBytes,
  };
}
