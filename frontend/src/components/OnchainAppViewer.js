import { useState, useRef, useEffect } from 'react';
import { FiPlay, FiMaximize2, FiMinimize2, FiAlertTriangle, FiLoader, FiRefreshCw } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * Renders on-chain HTML apps stored directly on the Bitcoin blockchain.
 * Handles multi-transaction apps where files reference other txids via relative paths.
 * Uses the backend's /api/onchain/file/{txid}/{filename} proxy to resolve files.
 */
export const OnchainAppViewer = ({ txid, files, network }) => {
  const [status, setStatus] = useState('consent'); // consent | loading | ready | error
  const [htmlContent, setHtmlContent] = useState(null);
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [freshFetch, setFreshFetch] = useState(false);
  const iframeRef = useRef(null);

  const mainnet = network?.includes('mainnet') ? 'true' : 'false';
  const hasIndex = files.some(f => f.toLowerCase() === 'index.html');

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;

    const loadApp = async () => {
      try {
        // Fetch index.html from the on-chain file proxy
        const indexFile = files.find(f => f.toLowerCase() === 'index.html') || 'index.html';
        const freshParam = freshFetch ? '&fresh=true' : '';
        const url = `${API}/api/onchain/file/${txid}/${encodeURIComponent(indexFile)}?chain=BTC&mainnet=${mainnet}${freshParam}`;

        // May need a retry — first call triggers resolution, second returns content
        let html = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) {
            if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
            throw new Error(`Failed to fetch: ${resp.status}`);
          }
          const ct = resp.headers.get('content-type') || '';
          const text = await resp.text();
          // Check if it's still "resolving" JSON
          if (text.startsWith('{') && text.includes('"status":"resolving"')) {
            if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
            throw new Error('On-chain file is still being resolved. Try again in a moment.');
          }
          html = text;
          break;
        }

        if (cancelled || !html) return;

        // Find all cross-transaction script/link references (../txid/filename pattern)
        // and fetch them inline to avoid cross-origin issues in sandboxed iframe
        const refPattern = /(src|href)=["']\.\.\/([a-fA-F0-9]{64})\/([^"']+)["']/g;
        let match;
        const refs = [];
        while ((match = refPattern.exec(html)) !== null) {
          refs.push({ full: match[0], attr: match[1], refTxid: match[2], refFile: match[3] });
        }

        let assembled = html;
        if (refs.length > 0) {
          for (const ref of refs) {
            try {
              const refUrl = `${API}/api/onchain/file/${ref.refTxid}/${encodeURIComponent(ref.refFile)}?chain=BTC&mainnet=${mainnet}`;
              // Retry loop for resolution
              let content = null;
              for (let a = 0; a < 4; a++) {
                const r = await fetch(refUrl, { signal: AbortSignal.timeout(15000) });
                if (r.ok) {
                  const txt = await r.text();
                  if (!txt.startsWith('{') || !txt.includes('"status":"resolving"')) {
                    content = txt;
                    break;
                  }
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
              if (content) {
                const ext = ref.refFile.split('.').pop()?.toLowerCase();
                if (ext === 'js') {
                  // Inline the script
                  assembled = assembled.replace(ref.full, '');
                  const scriptTag = `<script>${content}<\/script>`;
                  assembled = assembled.replace('</head>', `${scriptTag}\n</head>`);
                } else if (ext === 'css') {
                  assembled = assembled.replace(ref.full, '');
                  const styleTag = `<style>${content}</style>`;
                  assembled = assembled.replace('</head>', `${styleTag}\n</head>`);
                }
              }
            } catch { /* skip unresolvable refs */ }
          }
        }

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
  }, [status, txid, files, mainnet, freshFetch]);

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
              {files.length > 1 && ` It references ${files.length} files which may span multiple transactions.`}
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
      <div className="mt-3 p-4 rounded-lg border border-gray-700/30 bg-gray-900/30 flex items-center justify-center gap-2">
        <FiLoader size={14} className="text-amber-400 animate-spin" />
        <span className="text-xs text-gray-400">Reconstructing on-chain app...</span>
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
        <span className="text-[10px] text-gray-500">On-chain app: {txid.slice(0, 16)}...</span>
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
