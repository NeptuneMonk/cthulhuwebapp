/**
 * ECIES encryption/decryption — SUP-compatible (ECElGamal + AES-256-CBC).
 *
 * Encryption:
 *   1. Generate ephemeral key k
 *   2. tag = G * k                      (uncompressed EC point, 65 bytes)
 *   3. sharedPoint = recipientPubKey * k (uncompressed, 65 bytes)
 *   4. aesKey = SHA256(SHA256(sharedPoint))   (double-hash, 32 bytes)
 *   5. iv = random(16)
 *   6. ciphertext = AES-256-CBC-encrypt(aesKey, iv, PKCS7(data))
 *   7. output = tag(65) || iv(16) || ciphertext
 *
 * Decryption:
 *   1. Parse tag(65) || iv(16) || ciphertext
 *   2. sharedPoint = tag * privateKey
 *   3. aesKey = SHA256(SHA256(sharedPoint))
 *   4. plaintext = AES-256-CBC-decrypt(aesKey, iv, ciphertext)
 *
 * SUP message format for encrypted roots:
 *   SEC<sep><byteLength><sep><encryptedBytes>
 *   where <sep> is a random char from: \ / : * ? " < > |
 */
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

// SUP separator characters (byte values: 92, 47, 58, 42, 63, 34, 60, 62, 124)
const SEPARATORS = [92, 47, 58, 42, 63, 34, 60, 62, 124];

function randomSep() {
  const idx = crypto.getRandomValues(new Uint8Array(1))[0] % SEPARATORS.length;
  return SEPARATORS[idx];
}

/** Double SHA-256 (matching SUP's SHA256.DoubleHash) */
function doubleSha256(data) {
  return sha256(sha256(data));
}

/** Convert hex string to Uint8Array */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build an uncompressed EC public key from PKX/PKY hex strings.
 * Returns a 65-byte Uint8Array: [0x04, x(32), y(32)]
 */
export function publicKeyFromPKXY(pkx, pky) {
  const xBytes = hexToBytes(pkx);
  const yBytes = hexToBytes(pky);
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(xBytes, 1);
  uncompressed.set(yBytes, 33);
  return uncompressed;
}

/**
 * Extract PKX/PKY from a 32-byte private key.
 * Returns { pkx: hex, pky: hex, publicKey: Uint8Array(65) }
 */
export function publicKeyFromPrivate(privateKeyBytes) {
  const uncompressed = secp.getPublicKey(privateKeyBytes, false); // 65 bytes
  const pkx = bytesToHex(uncompressed.slice(1, 33));
  const pky = bytesToHex(uncompressed.slice(33, 65));
  return { pkx, pky, publicKey: uncompressed };
}

/**
 * Derive the AES key from an EC shared point (SUP ECElGamal style).
 * sharedPoint = uncompressed point (65 bytes)
 * key = SHA256(SHA256(sharedPoint))
 */
function deriveAesKey(sharedPointUncompressed) {
  return doubleSha256(sharedPointUncompressed);
}

/**
 * Encrypt data with a recipient's public key (ECIES).
 * @param {Uint8Array} recipientPubKey — 65-byte uncompressed public key
 * @param {Uint8Array} data — plaintext bytes
 * @returns {Promise<Uint8Array>} — tag(65) || iv(16) || ciphertext
 */
export async function eciesEncrypt(recipientPubKey, data) {
  // Validate recipient key is a valid point
  secp.Point.fromHex(recipientPubKey);

  // Generate ephemeral keypair (retry if k is 0 or >= N, matching SUP's loop)
  let k, tag, sharedPoint;
  for (let i = 0; i < 100; i++) {
    k = crypto.getRandomValues(new Uint8Array(32));
    const kBig = BigInt('0x' + bytesToHex(k));
    if (kBig === 0n || kBig >= BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')) {
      continue;
    }
    try {
      tag = secp.getPublicKey(k, false); // G * k, uncompressed (65 bytes)
      const recipientPoint = secp.Point.fromHex(recipientPubKey);
      sharedPoint = recipientPoint.multiply(kBig).toRawBytes(false); // pubKey * k, uncompressed
      break;
    } catch {
      continue;
    }
  }
  if (!tag || !sharedPoint) throw new Error('Failed to generate ephemeral key');

  // Derive AES key
  const aesKey = deriveAesKey(sharedPoint);

  // Random IV
  const iv = crypto.getRandomValues(new Uint8Array(16));

  // AES-256-CBC encrypt (Web Crypto API)
  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, data));

  // Assemble: tag(65) || iv(16) || ciphertext
  const output = new Uint8Array(65 + 16 + ciphertext.length);
  output.set(tag, 0);
  output.set(iv, 65);
  output.set(ciphertext, 81);
  return output;
}

/**
 * Decrypt ECIES ciphertext with a private key.
 * @param {Uint8Array} privateKey — 32-byte private key
 * @param {Uint8Array} cipherData — tag(65) || iv(16) || ciphertext
 * @returns {Promise<Uint8Array>} — decrypted plaintext
 */
export async function eciesDecrypt(privateKey, cipherData) {
  if (cipherData.length < 82) throw new Error('Cipher data too short');

  // Parse components
  const tagBytes = cipherData.slice(0, 65);
  const iv = cipherData.slice(65, 81);
  const cipher = cipherData.slice(81);

  // Compute shared point: tag * privateKey
  const tagPoint = secp.Point.fromHex(tagBytes);
  const privBig = BigInt('0x' + bytesToHex(privateKey));
  const sharedPoint = tagPoint.multiply(privBig).toRawBytes(false);

  // Derive AES key
  const aesKey = deriveAesKey(sharedPoint);

  // AES-256-CBC decrypt
  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, cipher));
  return decrypted;
}

/**
 * Wrap encrypted bytes in SUP's "SEC" format for on-chain embedding.
 * Format: SEC<sep1><byteLength><sep2><encryptedBytes>
 * @param {Uint8Array} encryptedBytes — output of eciesEncrypt
 * @returns {Uint8Array} — the full SEC-prefixed payload
 */
export function wrapAsSEC(encryptedBytes) {
  const sec = new TextEncoder().encode('SEC');
  const sep1 = new Uint8Array([randomSep()]);
  const sizeStr = new TextEncoder().encode(encryptedBytes.length.toString());
  const sep2 = new Uint8Array([randomSep()]);

  const result = new Uint8Array(sec.length + 1 + sizeStr.length + 1 + encryptedBytes.length);
  let offset = 0;
  result.set(sec, offset); offset += sec.length;
  result.set(sep1, offset); offset += 1;
  result.set(sizeStr, offset); offset += sizeStr.length;
  result.set(sep2, offset); offset += 1;
  result.set(encryptedBytes, offset);
  return result;
}

/**
 * Unwrap a SUP "SEC" payload to get the raw encrypted bytes.
 * @param {Uint8Array} payload — the full SEC-prefixed bytes
 * @returns {Uint8Array} — the encrypted bytes (input to eciesDecrypt)
 */
export function unwrapSEC(payload) {
  // If the payload doesn't start with "SEC" (0x53, 0x45, 0x43), return as-is (raw ECIES)
  if (!payload || payload.length < 4 || payload[0] !== 0x53 || payload[1] !== 0x45 || payload[2] !== 0x43) {
    return payload;
  }
  const seps = new Set(SEPARATORS);
  // Find the second separator
  let count = 0;
  let secondIdx = -1;
  for (let i = 0; i < payload.length; i++) {
    if (seps.has(payload[i])) {
      count++;
      if (count === 2) {
        secondIdx = i;
        break;
      }
    }
  }
  if (secondIdx === -1) throw new Error('Invalid SEC format: separators not found');
  return payload.slice(secondIdx + 1);
}

/**
 * High-level: encrypt a text message for a recipient.
 * @param {string} message — plaintext string
 * @param {string} pkx — recipient's PKX hex
 * @param {string} pky — recipient's PKY hex
 * @returns {Promise<Uint8Array>} — SEC-wrapped encrypted payload
 */
export async function encryptMessage(message, pkx, pky) {
  const pubKey = publicKeyFromPKXY(pkx, pky);
  const msgBytes = new TextEncoder().encode(message);
  const encrypted = await eciesEncrypt(pubKey, msgBytes);
  return wrapAsSEC(encrypted);
}

/**
 * High-level: decrypt a SEC-wrapped private message.
 * @param {Uint8Array} secPayload — SEC-format encrypted bytes
 * @param {Uint8Array} privateKey — 32-byte private key
 * @returns {Promise<string>} — decrypted message text
 */
export async function decryptMessage(secPayload, privateKey) {
  const encrypted = unwrapSEC(secPayload);
  const decrypted = await eciesDecrypt(privateKey, encrypted);
  return new TextDecoder().decode(decrypted);
}

export { hexToBytes, bytesToHex };
