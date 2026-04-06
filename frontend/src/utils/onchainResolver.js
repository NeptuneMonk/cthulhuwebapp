/**
 * Resolves cross-transaction references in on-chain HTML content.
 * Handles:
 *   1. Same-root CSS inlining (<link href="file.css">)
 *   2. Same-root image/media src rewriting
 *   3. Cross-transaction ../txid/filename references (global string replacement)
 *
 * @param {string} html - Raw HTML content
 * @param {string} txid - Root transaction ID
 * @param {string[]} rootFiles - List of files in this root
 * @param {string} baseUrl - Backend proxy base URL for this root
 * @param {string} baseQuery - Query string for proxy requests
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<string>} Assembled HTML with resolved references
 */
const API = process.env.REACT_APP_BACKEND_URL;

async function fetchWithRetry(url, attempts = 4, delay = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.ok && r.status === 200) {
        const txt = await r.text();
        if (!txt.startsWith('{') || !txt.includes('"status":"resolving"')) {
          return txt;
        }
      }
    } catch (_e) { /* retry */ }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

export async function resolveOnchainHtml(html, txid, rootFiles, network, onProgress) {
  const mainnet = network?.includes('mainnet') ? 'true' : 'false';
  const baseUrl = `${API}/api/onchain/file/${txid}/`;
  const baseQuery = `?chain=BTC&mainnet=${mainnet}`;
  let assembled = html;

  // ── Step 1: Inline same-root CSS files ──
  const cssFiles = (rootFiles || []).filter(f => /\.css$/i.test(f));
  const linkPattern = /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi;
  let cssMatch;
  const cssInlines = [];

  while ((cssMatch = linkPattern.exec(html)) !== null) {
    const hrefFile = cssMatch[1];
    const baseName = hrefFile.replace(/^\.\//, '');
    if (!hrefFile.includes('/') && cssFiles.some(f => f.toLowerCase() === baseName.toLowerCase())) {
      cssInlines.push({ fullTag: cssMatch[0], filename: baseName });
    }
  }

  for (let ci = 0; ci < cssInlines.length; ci++) {
    const { fullTag, filename } = cssInlines[ci];
    if (onProgress) onProgress(`Loading CSS ${ci + 1}/${cssInlines.length}: ${filename}`);
    const cssUrl = `${baseUrl}${encodeURIComponent(filename)}${baseQuery}`;
    const cssText = await fetchWithRetry(cssUrl);
    if (cssText) {
      const rewritten = cssText.replace(/url\(["']?([^"')]+)["']?\)/g, (match, path) => {
        if (path.startsWith('data:') || path.startsWith('http')) return match;
        return `url(${baseUrl}${encodeURIComponent(path)}${baseQuery})`;
      });
      assembled = assembled.replace(fullTag, `<style>/* ${filename} */\n${rewritten}</style>`);
    }
  }

  // ── Step 2: Rewrite same-root image/media src references ──
  const imgPattern = /(src|href)=["']([^"':]+\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|mp4|mp3|wav|pdf|js))["']/gi;
  assembled = assembled.replace(imgPattern, (match, attr, filepath) => {
    if (filepath.startsWith('http') || filepath.startsWith('data:') || filepath.startsWith('//') || filepath.startsWith('../')) return match;
    const cleanName = filepath.replace(/^\.\//, '');
    if ((rootFiles || []).some(f => f.toLowerCase() === cleanName.toLowerCase())) {
      return `${attr}="${baseUrl}${encodeURIComponent(cleanName)}${baseQuery}"`;
    }
    return match;
  });

  // ── Step 3: Handle cross-transaction references (../txid/filename) ──
  const crossTxPattern = /\.\.\/([a-fA-F0-9]{64})\/([^"'\s)><]+)/g;
  let ctxMatch;
  const crossRefs = new Map();
  const tempHtml = assembled;
  while ((ctxMatch = crossTxPattern.exec(tempHtml)) !== null) {
    const key = `${ctxMatch[1]}/${ctxMatch[2]}`;
    if (!crossRefs.has(key)) {
      crossRefs.set(key, { refTxid: ctxMatch[1], refFile: ctxMatch[2] });
    }
  }

  if (crossRefs.size > 0) {
    if (onProgress) onProgress(`Resolving ${crossRefs.size} cross-chain references...`);

    // Pre-warm all cross-tx files
    const warmPromises = Array.from(crossRefs.values()).map(ref =>
      fetch(`${API}/api/onchain/file/${ref.refTxid}/${encodeURIComponent(ref.refFile)}${baseQuery}`,
        { signal: AbortSignal.timeout(10000) }).catch(() => null)
    );
    await Promise.allSettled(warmPromises);
    if (crossRefs.size > 2) await new Promise(r => setTimeout(r, 3000));

    for (const [, ref] of crossRefs) {
      try {
        const refUrl = `${API}/api/onchain/file/${ref.refTxid}/${encodeURIComponent(ref.refFile)}${baseQuery}`;
        const ext = ref.refFile.split('.').pop()?.toLowerCase();
        const originalRef = `../${ref.refTxid}/${ref.refFile}`;

        // For JS and CSS: inline for sandbox reliability
        if (ext === 'js' || ext === 'css') {
          const content = await fetchWithRetry(refUrl);
          if (content) {
            if (ext === 'js') {
              assembled = assembled.split(originalRef).join('');
              assembled = assembled.replace('</head>', `<script>/* ${ref.refFile} */\n${content}<\/script>\n</head>`);
            } else {
              assembled = assembled.split(originalRef).join('');
              assembled = assembled.replace('</head>', `<style>/* ${ref.refFile} */\n${content}</style>\n</head>`);
            }
            continue;
          }
        }

        // For all other files: rewrite URL to proxy
        assembled = assembled.split(originalRef).join(refUrl);
      } catch (_e) { /* skip */ }
    }
  }

  return assembled;
}
