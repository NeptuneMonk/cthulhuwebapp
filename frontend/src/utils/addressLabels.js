/**
 * Smart label generation from URN strings.
 * Extracts human-readable labels: filename from IPFS paths, or first N chars of text URNs.
 */

/** Extract a human-readable label from a URN string.
 *  - IPFS URN with filename: "IPFS:QmXXX/myfile.png" → "myfile.png"
 *  - IPFS URN without filename: "IPFS:QmXXX" → "QmXXX..." (first 15 chars)
 *  - Chain-prefixed: "BTC:abc123..." → "BTC:abc123..." (first 18 chars)
 *  - Text URN: "my-cool-nft-thing-here" → "my-cool-nft-thi..."
 *  - Null/empty → null (caller should use fallback)
 */
export function labelFromUrn(urn) {
  if (!urn) return null;
  // IPFS URN with path — extract filename
  if (urn.toUpperCase().startsWith('IPFS:')) {
    const path = urn.substring(5); // strip "IPFS:"
    const parts = path.split(/[/\\]/);
    if (parts.length > 1) {
      const filename = parts[parts.length - 1];
      if (filename) return filename;
    }
    // No filename, just a CID — first 15 chars of CID
    const cid = parts[0];
    return cid.length > 15 ? cid.substring(0, 15) + '...' : cid;
  }
  // Chain-prefixed URN (BTC:, DOG:, LTC:, MZC:) — first 18 chars
  if (/^[A-Z]{3}:/i.test(urn) && urn.length > 4) {
    return urn.length > 18 ? urn.substring(0, 18) + '...' : urn;
  }
  // Plain text URN — first 15 chars
  return urn.length > 15 ? urn.substring(0, 15) + '...' : urn;
}
