/**
 * Parse any media reference string from p2fk.io into a renderable result.
 *
 * Formats handled:
 *   IPFS:QmHash\filename.ext    -> { type:'ipfs', url, filename, extension }
 *   BTC:txid/filename.ext       -> { type:'onchain', url, chain:'BTC', filename }
 *   LTC:txid/filename.ext       -> { type:'onchain', url, chain:'LTC', filename }
 *   MZC:txid/filename.ext       -> { type:'onchain', url, chain:'MZC', filename }
 *   DOG:txid/filename.ext       -> { type:'onchain', url, chain:'DOG', filename }
 *   {64-hex-txid}/filename.ext  -> { type:'onchain', url, chain:'BTC', filename }
 *   http(s)://...               -> { type:'url', url }
 *   anything else               -> null
 *
 * @param {string} imageStr - The media reference string
 * @param {object} opts - Options: { mainnet: boolean } — defaults to true
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
// On-chain file serving: backend is primary, p2fk.io is last-resort fallback
const P2FK_ROOT_FALLBACK = 'https://p2fk.io/root';
const CHAIN_PREFIXES = ['BTC:', 'LTC:', 'MZC:', 'DOG:', 'btc:', 'ltc:', 'mzc:', 'dog:'];
const HEX_TXID_RE = /^[0-9a-fA-F]{64}/;

/** Determine mainnet flag from a network string like 'btc-testnet' or 'btc-mainnet' */
export function isMainnetNetwork(network) {
  if (!network) return true;
  return network.toLowerCase().includes('mainnet');
}

/** Auto-detect mainnet from stored network setting */
function autoDetectMainnet(opts) {
  if (opts?.mainnet !== undefined) return opts.mainnet;
  try {
    const network = localStorage.getItem('cthulhu_network') || '';
    return isMainnetNetwork(network);
  } catch { return true; }
}

export function parseMediaString(imageStr, opts) {
  if (!imageStr) return null;
  const mainnet = autoDetectMainnet(opts);

  // IPFS references
  if (imageStr.toUpperCase().startsWith('IPFS:')) {
    const raw = imageStr.replace(/^IPFS:/i, '');
    const parts = raw.split(/[\\/]/);
    const ipfsHash = parts[0];
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : '';
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const url = fileName
      ? `https://ipfs.io/ipfs/${ipfsHash}/${encodeURIComponent(fileName)}`
      : `https://ipfs.io/ipfs/${ipfsHash}`;
    const fallbackUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
    return { type: 'ipfs', url, fallbackUrl, filename: fileName, extension };
  }

  // On-chain with chain prefix
  const prefix = CHAIN_PREFIXES.find(p => imageStr.startsWith(p));
  if (prefix) {
    const chain = prefix.replace(':', '').toUpperCase();
    const rest = imageStr.slice(prefix.length);
    const parts = rest.split(/[\\/]/);
    const txid = parts[0];
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : '';
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    // Default to data.txt for chain-prefixed on-chain refs without filename (text-only etchings)
    const resolvedFilename = fileName || 'data.txt';
    const resolvedExtension = extension || 'txt';
    // For non-BTC/LTC chains (MZC, DOG), always use mainnet (no testnet exists)
    const useMainnet = (chain === 'MZC' || chain === 'DOG') ? true : mainnet;
    // Primary: our backend on-chain reconstructor. Fallback: p2fk.io root endpoint.
    return {
      type: 'onchain',
      url: `${API}/onchain/file/${txid}/${encodeURIComponent(resolvedFilename)}?chain=${chain}&mainnet=${useMainnet}`,
      fallbackUrl: `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(resolvedFilename)}?mainnet=${useMainnet}`,
      chain, txid, filename: resolvedFilename, extension: resolvedExtension,
    };
  }

  // On-chain without prefix (bare txid/filename)
  if (HEX_TXID_RE.test(imageStr)) {
    const parts = imageStr.split(/[\\/]/);
    const txid = parts[0];
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : '';
    const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const resolvedFilename = fileName || 'data.txt';
    const resolvedExtension = extension || 'txt';
    // Primary: our backend. Fallback: p2fk.io root.
    return {
      type: 'onchain',
      url: `${API}/onchain/file/${txid}/${encodeURIComponent(resolvedFilename)}?chain=BTC&mainnet=${mainnet}`,
      fallbackUrl: `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(resolvedFilename)}?mainnet=${mainnet}`,
      chain: 'BTC', txid, filename: resolvedFilename, extension: resolvedExtension,
      needsChainDetection: true,
    };
  }

  // HTTP/HTTPS URLs — intercept dead services
  if (imageStr.startsWith('http://') || imageStr.startsWith('https://')) {
    // bitfossil.org is DOWN — try to extract txid and proxy through our on-chain endpoint
    if (imageStr.includes('bitfossil.org') || imageStr.includes('bitfossil.com')) {
      const pathMatch = imageStr.match(/bitfossil\.[a-z]+\/([a-fA-F0-9]{64})(?:\/(.+))?/);
      if (pathMatch) {
        const txid = pathMatch[1];
        const fname = decodeURIComponent(pathMatch[2] || 'data');
        const extension = fname.includes('.') ? fname.split('.').pop().toLowerCase() : '';
        return {
          type: 'onchain',
          url: `${API}/onchain/file/${txid}/${encodeURIComponent(fname)}?chain=BTC&mainnet=${mainnet}`,
          fallbackUrl: `${P2FK_ROOT_FALLBACK}/${txid}/${encodeURIComponent(fname)}?mainnet=${mainnet}`,
          chain: 'BTC', txid, filename: fname, extension,
        };
      }
    }
    return { type: 'url', url: imageStr };
  }

  // Bare IPFS hash (Qm... or bafy...) — no prefix
  if (/^Qm[A-Za-z0-9]{44,}/.test(imageStr) || /^bafy[A-Za-z0-9]{44,}/.test(imageStr)) {
    const parts = imageStr.split(/[\\/]/);
    const ipfsHash = parts[0];
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : '';
    const url = fileName
      ? `https://ipfs.io/ipfs/${ipfsHash}/${encodeURIComponent(fileName)}`
      : `https://ipfs.io/ipfs/${ipfsHash}`;
    return { type: 'ipfs', url, fallbackUrl: `https://ipfs.io/ipfs/${ipfsHash}`, filename: fileName, extension: fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '' };
  }

  return null;
}

/**
 * Parse inline IPFS references from post content.
 */
export function parseIPFSLinks(text) {
  if (!text) return [];
  const str = Array.isArray(text) ? text.join(' ') : String(text);
  const regex = /<<IPFS:([A-Za-z0-9]+)[\\/]([^>]+)>>(?:<<(-?\d+)>>)?/g;
  const matches = [...str.matchAll(regex)];
  return matches.map(match => ({
    hash: match[1],
    filename: match[2],
    url: `https://ipfs.io/ipfs/${match[1]}/${encodeURIComponent(match[2])}`,
    fallbackUrl: `https://ipfs.io/ipfs/${match[1]}`,
    extension: match[2].split('.').pop().toLowerCase(),
  }));
}

/**
 * Strip IPFS markers, size markers, << >> wrappers, and inline HTML from display text.
 */
export function cleanPostContent(text) {
  if (!text) return '';
  const str = Array.isArray(text) ? text.join(' ') : String(text);
  return str
    .replace(/<<IPFS:[^>]+>>(?:<<-?\d+>>)?/g, '')
    .replace(/<<[^>]*>>/g, '')
    .replace(/<</g, '')
    .replace(/>>/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<\/?(?:p|br|center|div|span|b|i|u|em|strong|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Get a renderable image URL from a p2fk.io Image/URN field.
 * Now supports IPFS, on-chain (via backend proxy), and direct URLs.
 */
export function getProfileImageUrl(imageStr, opts) {
  const parsed = parseMediaString(imageStr, opts);
  if (!parsed) return null;
  return parsed.url;
}
