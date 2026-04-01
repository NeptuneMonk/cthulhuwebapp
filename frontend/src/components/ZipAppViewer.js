import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { FiLoader, FiAlertTriangle, FiMaximize2, FiMinimize2, FiRefreshCw, FiShield } from 'react-icons/fi';

const MIME_MAP = {
  'js': 'text/javascript', 'mjs': 'text/javascript',
  'css': 'text/css',
  'html': 'text/html', 'htm': 'text/html',
  'json': 'application/json',
  'png': 'image/png',
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'svg': 'image/svg+xml',
  'webp': 'image/webp',
  'bmp': 'image/bmp',
  'ico': 'image/x-icon',
  'woff': 'font/woff', 'woff2': 'font/woff2',
  'ttf': 'font/ttf', 'otf': 'font/otf',
  'eot': 'application/vnd.ms-fontobject',
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
  'mp4': 'video/mp4', 'webm': 'video/webm',
  'xml': 'application/xml',
  'txt': 'text/plain',
};

const getMime = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return MIME_MAP[ext] || 'application/octet-stream';
};

const isTextFile = (mime) => mime.startsWith('text/') || mime === 'application/json' || mime === 'application/javascript' || mime === 'application/xml' || mime === 'image/svg+xml';

/**
 * ZipAppViewer: Fetches a zip from IPFS, extracts index.html + all assets,
 * inlines everything, and renders in a sandboxed iframe. No server storage.
 */
export const ZipAppViewer = ({ ipfsUrl, filename }) => {
  const [status, setStatus] = useState('consent'); // consent, loading, ready, error
  const [progress, setProgress] = useState('Fetching zip from IPFS...');
  const [error, setError] = useState(null);
  const [htmlContent, setHtmlContent] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;

    const loadZip = async () => {
      try {
        setStatus('loading');
        setProgress('Fetching zip from IPFS...');

        // Fetch the zip
        const response = await fetch(ipfsUrl);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

        const blob = await response.blob();
        if (cancelled) return;
        setProgress('Extracting zip contents...');

        // Extract with JSZip
        const zip = await JSZip.loadAsync(blob);
        const files = {};

        // Find all files, handle nested folder structure
        // Sometimes the zip has a root folder, find where index.html is
        let basePath = '';
        const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);

        // Check if index.html is at root or inside a subfolder
        if (allPaths.includes('index.html')) {
          basePath = '';
        } else {
          // Look for index.html in subfolders
          const indexFile = allPaths.find(p => p.endsWith('/index.html') || p.endsWith('\\index.html'));
          if (indexFile) {
            basePath = indexFile.substring(0, indexFile.lastIndexOf('/') + 1);
          }
        }

        if (cancelled) return;
        setProgress('Processing files...');

        // Extract all files as data URIs
        const dataUriMap = {};
        for (const path of allPaths) {
          const file = zip.files[path];
          const mime = getMime(path);
          const relativePath = basePath ? path.replace(basePath, '') : path;

          if (isTextFile(mime)) {
            const text = await file.async('string');
            files[relativePath] = { content: text, mime, isText: true };
          } else {
            const uint8 = await file.async('uint8array');
            // Convert to base64
            let binary = '';
            const chunk = 8192;
            for (let i = 0; i < uint8.length; i += chunk) {
              binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
            }
            const base64 = btoa(binary);
            const dataUri = `data:${mime};base64,${base64}`;
            dataUriMap[relativePath] = dataUri;
            files[relativePath] = { content: dataUri, mime, isText: false };
          }
        }

        if (cancelled) return;
        if (!files['index.html']) {
          throw new Error('No index.html found in zip');
        }

        setProgress('Building app...');

        // Process CSS files: replace url() references with data URIs
        for (const [path, file] of Object.entries(files)) {
          if (file.mime === 'text/css' && file.isText) {
            let css = file.content;
            css = css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, ref) => {
              if (ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//')) return match;
              // Resolve relative path from the CSS file's directory
              const cssDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
              const resolved = resolvePath(cssDir + ref);
              if (dataUriMap[resolved]) return `url(${dataUriMap[resolved]})`;
              if (files[resolved] && files[resolved].isText) return `url(data:${files[resolved].mime};charset=utf-8,${encodeURIComponent(files[resolved].content)})`;
              return match;
            });
            files[path].content = css;
          }
        }

        // Build the final HTML with inlined resources
        let html = files['index.html'].content;

        // Inline CSS: <link rel="stylesheet" href="..."> → <style>...</style>
        html = html.replace(/<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, (tag) => {
          const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
          if (!hrefMatch) return tag;
          const href = hrefMatch[1];
          if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) return tag;
          const resolved = resolvePath(href);
          if (files[resolved] && files[resolved].isText) {
            return `<style>/* ${resolved} */\n${files[resolved].content}</style>`;
          }
          return tag;
        });

        // Inline JS: <script src="..."></script> → <script>...</script>
        html = html.replace(/<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
          if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) return tag;
          const resolved = resolvePath(src);
          if (files[resolved] && files[resolved].isText) {
            return `<script>/* ${resolved} */\n${files[resolved].content}<\/script>`;
          }
          return tag;
        });

        // Replace image/asset src and href with data URIs
        html = html.replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, (match, attr, ref) => {
          if (ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//') || ref.startsWith('#') || ref.startsWith('javascript:')) return match;
          const resolved = resolvePath(ref);
          if (dataUriMap[resolved]) return `${attr}="${dataUriMap[resolved]}"`;
          return match;
        });

        // Replace CSS url() in inline styles
        html = html.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, ref) => {
          if (ref.startsWith('data:') || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//')) return match;
          const resolved = resolvePath(ref);
          if (dataUriMap[resolved]) return `url(${dataUriMap[resolved]})`;
          return match;
        });

        if (cancelled) return;
        setHtmlContent(html);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus('error');
        }
      }
    };

    loadZip();
    return () => { cancelled = true; };
  }, [ipfsUrl, status]);

  if (status === 'consent') {
    return (
      <div className="bg-gray-800/50 rounded-lg p-8 flex flex-col items-center gap-4 border border-orange-500/30" data-testid="zip-consent">
        <FiShield size={32} className="text-orange-400" />
        <h3 className="text-sm font-bold text-gray-200">Embedded Web Application</h3>
        <p className="text-xs text-gray-400 text-center max-w-sm leading-relaxed">
          This object contains a web application packaged as a zip file.
          It will run in an isolated sandbox with no access to your wallet or local data.
          Only proceed if you trust the creator.
        </p>
        <p className="text-xs text-gray-600 font-mono">{filename || 'index.zip'}</p>
        <div className="flex gap-3">
          <button
            onClick={() => setStatus('loading')}
            className="px-5 py-2 bg-orange-900/50 hover:bg-orange-800/60 text-orange-200 text-sm rounded-lg border border-orange-700/50 transition-colors"
            data-testid="zip-consent-proceed"
          >
            Launch App
          </button>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="bg-gray-800/50 rounded-lg p-8 flex flex-col items-center gap-4" data-testid="zip-loading">
        <FiLoader size={32} className="text-purple-400 animate-spin" />
        <p className="text-sm text-gray-300">{progress}</p>
        <p className="text-xs text-gray-600">{filename || 'index.zip'}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="bg-gray-800/50 rounded-lg p-8 flex flex-col items-center gap-4" data-testid="zip-error">
        <FiAlertTriangle size={32} className="text-red-400" />
        <p className="text-sm text-red-400">Failed to load app</p>
        <p className="text-xs text-gray-500">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
        >
          <FiRefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const iframeEl = (
    <iframe
      ref={iframeRef}
      srcDoc={htmlContent}
      title="Embedded App"
      className="w-full bg-white rounded-lg"
      style={{ height: fullscreen ? '100vh' : '60vh', border: 'none' }}
      sandbox="allow-scripts"
      data-testid="zip-iframe"
    />
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col" data-testid="zip-fullscreen">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
          <p className="text-xs text-gray-400">{filename || 'Embedded App'}</p>
          <button
            onClick={() => setFullscreen(false)}
            className="text-gray-400 hover:text-white transition-colors p-1"
            data-testid="zip-minimize-btn"
          >
            <FiMinimize2 size={18} />
          </button>
        </div>
        {iframeEl}
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700" data-testid="zip-viewer">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <p className="text-xs text-gray-400">{filename || 'Embedded App'}</p>
        <button
          onClick={() => setFullscreen(true)}
          className="text-gray-400 hover:text-white transition-colors p-1"
          data-testid="zip-fullscreen-btn"
        >
          <FiMaximize2 size={14} />
        </button>
      </div>
      {iframeEl}
    </div>
  );
};

/** Resolve a relative path (handle ../ and ./) */
function resolvePath(path) {
  // Normalize slashes
  path = path.replace(/\\/g, '/');
  // Remove leading ./
  path = path.replace(/^\.\//, '');
  // Remove query strings and hashes
  path = path.split('?')[0].split('#')[0];
  // Resolve ../ segments
  const parts = path.split('/');
  const resolved = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  return resolved.join('/');
}
