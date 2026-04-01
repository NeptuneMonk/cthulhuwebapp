import React, { useState, useEffect } from 'react';
import { FiExternalLink } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

// Simple in-memory cache to avoid re-fetching
const previewCache = {};

export function LinkPreview({ url }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!url) return;

    // Check cache first
    if (previewCache[url]) {
      setData(previewCache[url]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${API}/og-preview?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        previewCache[url] = d;
        setData(d);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [url]);

  // Don't show anything while loading or if no useful data
  if (loading || !data || (!data.title && !data.description && !data.image)) return null;

  const domain = data.site_name || '';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 rounded-lg border border-gray-800/60 bg-gray-900/40 hover:bg-gray-800/40 overflow-hidden transition-colors group"
      onClick={e => e.stopPropagation()}
      data-testid="link-preview"
    >
      {data.image && (
        <div className="w-full h-32 sm:h-40 bg-gray-900 overflow-hidden">
          <img
            src={data.image}
            alt={data.title || ''}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; }}
          />
        </div>
      )}
      <div className="px-3 py-2.5">
        {domain && (
          <p className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5">
            <FiExternalLink size={9} />
            {domain}
          </p>
        )}
        {data.title && (
          <p className="text-xs font-medium text-gray-200 leading-snug line-clamp-2 group-hover:text-teal-400 transition-colors">
            {data.title}
          </p>
        )}
        {data.description && (
          <p className="text-[11px] text-gray-500 leading-snug mt-0.5 line-clamp-2">
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}
