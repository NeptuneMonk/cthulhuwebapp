import { useState, useRef, useEffect } from 'react';
import { FiPlay, FiMaximize2, FiMinimize2, FiAlertTriangle, FiLoader, FiRefreshCw } from 'react-icons/fi';
import { resolveOnchainHtml } from '@/utils/onchainResolver';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Renders on-chain HTML apps stored directly on the Bitcoin blockchain.
 * Handles both same-root files (CSS, images) and cross-transaction references.
 * Uses the backend's /api/onchain/file/{txid}/{filename} proxy to resolve files.
 *
 * Strategy: inject a <base> tag into the HTML pointing to the onchain file proxy,
 * so relative references (index.css, logo.png) resolve naturally via the backend.
 * Cross-transaction refs (../othertxid/file) are handled by inlining.
 */
export const OnchainAppViewer = ({ txid, files, network }) => {
  const [status, setStatus] = useState('consent'); // consent | loading | ready | error
  const [htmlContent, setHtmlContent] = useState(null);
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [freshFetch, setFreshFetch] = useState(false);
  const [progress, setProgress] = useState('');
  const iframeRef = useRef(null);

  const mainnet = network?.includes('mainnet') ? 'true' : 'false';
  const hasIndex = files.some(f => f.toLowerCase() === 'index.html');

  // Base URL for resolving same-root relative file references
  const baseUrl = `${API}/api/onchain/file/${txid}/`;
  const baseQuery = `?chain=BTC&mainnet=${mainnet}`;

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;

    const loadApp = async () => {
      try {
        const indexFile = files.find(f => f.toLowerCase() === 'index.html') || 'index.html';
        const freshParam = freshFetch ? '&fresh=true' : '';
        const url = `${baseUrl}${encodeURIComponent(indexFile)}${baseQuery}${freshParam}`;

        // ── Pre-warm: trigger resolution for ALL files in the root ──
        const otherFiles = files.filter(f => f.toLowerCase() !== indexFile.toLowerCase());
        if (otherFiles.length > 0) {
          setProgress(`Pre-caching ${otherFiles.length} files...`);
          // Fire off all file requests in parallel to trigger backend resolution
          const warmups = otherFiles.map(f =>
            fetch(`${baseUrl}${encodeURIComponent(f)}${baseQuery}`, { signal: AbortSignal.timeout(10000) }).catch(() => null)
          );
          await Promise.allSettled(warmups);
          // Wait a moment for background resolution
          if (otherFiles.length > 5) {
            setProgress('Waiting for blockchain reconstruction...');
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        setProgress('Fetching index.html...');

        // Fetch index.html with retry
        let html = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
          if (!resp.ok) {
            if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
            throw new Error(`Failed to fetch: ${resp.status}`);
          }
          const text = await resp.text();
          if (text.startsWith('{') && text.includes('"status":"resolving"')) {
            setProgress('Resolving on-chain data...');
            if (attempt < 2) { await new Promise(r => setTimeout(r, 4000)); continue; }
            throw new Error('On-chain file is still being resolved. Try again in a moment.');
          }
          html = text;
          break;
        }

        if (cancelled || !html) return;

        // Resolve all same-root and cross-transaction references using shared utility
        const assembled = await resolveOnchainHtml(html, txid, files, network, (msg) => {
          if (!cancelled) setProgress(msg);
        });

        if (!cancelled) {

        // ── Step 2: Rewrite same-root image/media src references ──
        // For <img src="logo.png">, rewrite to point to our proxy URL
        const imgPattern = /(src|href)=["']([^"':]+\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|mp4|mp3|wav|pdf|js))["']/gi;
        assembled = assembled.replace(imgPattern, (match, attr, filepath, ext) => {
          if (filepath.startsWith('http') || filepath.startsWith('data:') || filepath.startsWith('//')) return match;
          // Cross-txid refs start with ../
          if (filepath.startsWith('../')) return match;
          const cleanName = filepath.replace(/^\.\//, '');
          // Check if this file exists in the root
          if (files.some(f => f.toLowerCase() === cleanName.toLowerCase())) {
            const proxyUrl = `${baseUrl}${encodeURIComponent(cleanName)}${baseQuery}`;
            return `${attr}="${proxyUrl}"`;
          }
          return match;
        });

        // ── Step 3: Handle cross-transaction references (../txid/filename) ──
        // Global replacement: find ALL ../hexTxid/filename patterns regardless
        // of context (HTML attributes, JS strings, CSS urls) and rewrite to proxy URLs.
        // For JS and CSS files, also inline them to avoid sandbox loading issues.
        const crossTxPattern = /\.\.\/([a-fA-F0-9]{64})\/([^"'\s\)><]+)/g;
        let ctxMatch;
        const crossRefs = new Map(); // deduplicate by txid+filename
        // Reset regex
        const tempHtml = assembled;
        while ((ctxMatch = crossTxPattern.exec(tempHtml)) !== null) {
          const key = `${ctxMatch[1]}/${ctxMatch[2]}`;
          if (!crossRefs.has(key)) {
            crossRefs.set(key, { refTxid: ctxMatch[1], refFile: ctxMatch[2] });
          }
        }

        if (crossRefs.size > 0) {
          setProgress(`Resolving ${crossRefs.size} cross-chain references...`);

          // Pre-warm all cross-tx files to trigger resolution
          const warmPromises = Array.from(crossRefs.values()).map(ref =>
            fetch(`${API}/api/onchain/file/${ref.refTxid}/${encodeURIComponent(ref.refFile)}${baseQuery}`,
              { signal: AbortSignal.timeout(10000) }).catch(() => null)
          );
          await Promise.allSettled(warmPromises);
          // Wait for resolution
          if (crossRefs.size > 2) await new Promise(r => setTimeout(r, 3000));

          for (const [key, ref] of crossRefs) {
            try {
              const refUrl = `${API}/api/onchain/file/${ref.refTxid}/${encodeURIComponent(ref.refFile)}${baseQuery}`;
              const ext = ref.refFile.split('.').pop()?.toLowerCase();
              const originalRef = `../${ref.refTxid}/${ref.refFile}`;

              // For JS and CSS: try to inline for reliability inside sandbox
              if (ext === 'js' || ext === 'css') {
                let content = null;
                for (let a = 0; a < 4; a++) {
                  const r = await fetch(refUrl, { signal: AbortSignal.timeout(15000) });
                  if (r.ok && r.status === 200) {
                    const txt = await r.text();
                    if (!txt.startsWith('{') || !txt.includes('"status":"resolving"')) {
                      content = txt;
                      break;
                    }
                  }
                  if (a < 3) await new Promise(resolve => setTimeout(resolve, 2000));
                }
                if (content) {
                  if (ext === 'js') {
                    // Replace all script src references with empty, inject inline
                    assembled = assembled.split(originalRef).join('');
                    assembled = assembled.replace('</head>', `<script>/* ${ref.refFile} */\n${content}<\/script>\n</head>`);
                  } else {
                    assembled = assembled.split(originalRef).join('');
                    assembled = assembled.replace('</head>', `<style>/* ${ref.refFile} */\n${content}</style>\n</head>`);
                  }
                  continue;
                }
              }

              // For all other files (images, html links, etc): rewrite URL to proxy
              assembled = assembled.split(originalRef).join(refUrl);
            } catch (_e) { /* skip unresolvable refs */ }
          }
        }

        // ── Step 4: Handle CSS background-image url() references that are same-root ──
        // Already handled in Step 1's CSS inlining via url() replacement

        if (!cancelled) {
          setHtmlContent(assembled);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus('error');
        }
      }
    };

    loadApp();
    return () => { cancelled = true; };
  }, [status, txid, files, mainnet, freshFetch, baseUrl, baseQuery]);

  if (!hasIndex) return null;

  if (status === 'consent') {
    return (
      <div className="mt-3 p-3 rounded-lg border border-amber-800/20 bg-amber-900/5">
        <div className="flex items-start gap-2 mb-2">
          <FiAlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-300 font-medium">On-chain Web Application</p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              This root contains an index.html stored directly on the Bitcoin blockchain.
              {files.length > 1 && ` It includes ${files.length} files (CSS, images, scripts) which will be reconstructed.`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setStatus('loading')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 border border-amber-700/30"
          data-testid="onchain-launch-btn"
        >
          <FiPlay size={11} /> Launch On-chain App
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="mt-3 p-4 rounded-lg border border-gray-700/30 bg-gray-900/30 flex flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-2">
          <FiLoader size={14} className="text-amber-400 animate-spin" />
          <span className="text-xs text-gray-400">Reconstructing on-chain app...</span>
        </div>
        {progress && <span className="text-[10px] text-gray-600">{progress}</span>}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mt-3 p-3 rounded-lg border border-red-800/20 bg-red-900/5">
        <p className="text-xs text-red-400">Failed to load on-chain app</p>
        <p className="text-[10px] text-gray-500 mt-1">{error}</p>
        <button
          onClick={() => { setError(null); setStatus('loading'); }}
          className="mt-2 text-[10px] text-blue-400 hover:text-blue-300"
        >
          Retry
        </button>
      </div>
    );
  }

  // Ready — render in sandboxed iframe
  return (
    <div className={`mt-3 ${fullscreen ? 'fixed inset-0 z-50 bg-black' : 'relative'}`}>
      <div className="flex items-center justify-between px-2 py-1 bg-gray-900/80 border-b border-gray-700/30">
        <span className="text-[10px] text-gray-500">On-chain app: {txid.slice(0, 16)}... ({files.length} files)</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setHtmlContent(null); setFreshFetch(true); setStatus('loading'); }}
            className="text-gray-500 hover:text-gray-300 p-1"
            title="Re-fetch from blockchain"
            data-testid="onchain-refresh-btn"
          >
            <FiRefreshCw size={11} />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="text-gray-500 hover:text-gray-300 p-1"
            data-testid="onchain-fullscreen-toggle"
          >
            {fullscreen ? <FiMinimize2 size={12} /> : <FiMaximize2 size={12} />}
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={htmlContent}
        sandbox="allow-scripts"
        className={`w-full border-0 bg-white ${fullscreen ? 'h-[calc(100vh-28px)]' : 'h-[400px] rounded-b-lg'}`}
        title="On-chain application"
        data-testid="onchain-app-iframe"
      />
    </div>
  );
};
