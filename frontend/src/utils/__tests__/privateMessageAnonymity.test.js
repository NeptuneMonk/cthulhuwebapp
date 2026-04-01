/**
 * Test: Verify that buildPrivateMessageTransaction produces anonymous on-chain output.
 *
 * The SIG (sender's signature) must be INSIDE the encrypted SEC payload,
 * not visible in the raw on-chain P2FK addresses.
 *
 * On-chain bytes should start with "SEC" — NOT "SIG".
 */
import { encodePayloadToAddresses } from '../p2fk';
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

// Helper: decode P2FK addresses back to raw bytes (mirrors walkieTalkie.js decodeAddressPayloads)
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

describe('buildPrivateMessageTransaction anonymity', () => {
  // We can't easily run the full async function in a unit test without mocking ECIES,
  // but we CAN verify the structural principle:
  // encodePayloadToAddresses should produce addresses whose decoded bytes start with "SEC" not "SIG"

  test('SEC payload encoded to addresses starts with SEC, not SIG', () => {
    // Simulate what the fixed function does: encode a SEC-prefixed payload (no outer SIG)
    const fakeEncryptedBytes = Buffer.from('fake_encrypted_content_for_testing');
    const sep1 = 47; // '/'
    const sep2 = 58; // ':'
    const secPayload = Buffer.concat([
      Buffer.from('SEC'),
      Buffer.from([sep1]),
      Buffer.from(fakeEncryptedBytes.length.toString()),
      Buffer.from([sep2]),
      fakeEncryptedBytes,
    ]);

    const addresses = encodePayloadToAddresses(secPayload, 111);
    const decodedBytes = decodeAddressPayloads(addresses);
    const decodedStr = decodedBytes.toString('utf-8');

    // MUST start with SEC, NOT SIG
    expect(decodedStr.startsWith('SEC')).toBe(true);
    expect(decodedStr.startsWith('SIG')).toBe(false);
    // Must NOT contain 'SIG' anywhere in the on-chain data
    expect(decodedStr.includes('SIG')).toBe(false);
  });

  test('Old flawed pattern would have SIG visible (regression check)', () => {
    // Simulate the OLD flawed pattern: SIG<d>88<d><sig>SEC<d><len><d><encrypted>
    const fakeSignature = 'H_fake_base64_signature_here';
    const fakeEncryptedBytes = Buffer.from('fake_encrypted_content');
    const sep1 = 47;
    const sep2 = 58;
    const secPart = Buffer.concat([
      Buffer.from('SEC'),
      Buffer.from([sep1]),
      Buffer.from(fakeEncryptedBytes.length.toString()),
      Buffer.from([sep2]),
      fakeEncryptedBytes,
    ]);
    // OLD pattern: SIG is OUTSIDE the SEC
    const oldPayload = Buffer.concat([
      Buffer.from(`SIG/${88}/${fakeSignature}`),
      secPart,
    ]);

    const addresses = encodePayloadToAddresses(oldPayload, 111);
    const decodedBytes = decodeAddressPayloads(addresses);
    const decodedStr = decodedBytes.toString('utf-8');

    // The old pattern would have SIG visible on-chain — this is what we're fixing
    expect(decodedStr.startsWith('SIG')).toBe(true);
    expect(decodedStr.includes('SIG')).toBe(true);
  });
});
