import React from 'react';
import { FiExternalLink } from 'react-icons/fi';

/**
 * Detect embeddable URLs and return iframe config.
 * Returns null if the URL isn't a recognized embed provider.
 */
export function getEmbedInfo(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname;

    // YouTube: watch, shorts, live, embed
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return { provider: 'YouTube', embedUrl: `https://www.youtube.com/embed/${v}`, aspect: '16/9' };
      const shortsMatch = path.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch) return { provider: 'YouTube', embedUrl: `https://www.youtube.com/embed/${shortsMatch[1]}`, aspect: '9/16' };
      const embedMatch = path.match(/\/embed\/([A-Za-z0-9_-]+)/);
      if (embedMatch) return { provider: 'YouTube', embedUrl: `https://www.youtube.com/embed/${embedMatch[1]}`, aspect: '16/9' };
      const liveMatch = path.match(/\/live\/([A-Za-z0-9_-]+)/);
      if (liveMatch) return { provider: 'YouTube', embedUrl: `https://www.youtube.com/embed/${liveMatch[1]}`, aspect: '16/9' };
    }
    if (host === 'youtu.be') {
      const id = path.slice(1);
      if (id) return { provider: 'YouTube', embedUrl: `https://www.youtube.com/embed/${id}`, aspect: '16/9' };
    }

    // Spotify: track, album, playlist, episode, show
    if (host === 'open.spotify.com') {
      const m = path.match(/\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
      if (m) return { provider: 'Spotify', embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, aspect: null, height: m[1] === 'track' ? 152 : 352 };
    }

    // Archive.org: details page or direct embed
    if (host === 'archive.org') {
      if (path.startsWith('/embed/')) {
        return { provider: 'Archive.org', embedUrl: url, aspect: null, height: 40 };
      }
      const detailsMatch = path.match(/\/details\/([^/?]+)/);
      if (detailsMatch) return { provider: 'Archive.org', embedUrl: `https://archive.org/embed/${detailsMatch[1]}`, aspect: null, height: 300 };
    }

    // SoundCloud
    if (host === 'soundcloud.com' && path.split('/').filter(Boolean).length >= 2) {
      return { provider: 'SoundCloud', embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%2314b8a6&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`, aspect: null, height: 166 };
    }

    // Vimeo
    if (host === 'vimeo.com') {
      const vimeoId = path.match(/^\/(\d+)/);
      if (vimeoId) return { provider: 'Vimeo', embedUrl: `https://player.vimeo.com/video/${vimeoId[1]}`, aspect: '16/9' };
    }

  } catch { /* invalid URL */ }
  return null;
}

/**
 * Render an embedded media player for supported URLs.
 */
export function MediaEmbed({ url }) {
  const info = getEmbedInfo(url);
  if (!info) return null;

  const { provider, embedUrl, aspect, height } = info;

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-gray-800/60 bg-gray-900/40" data-testid="media-embed">
      <div
        className="relative w-full"
        style={aspect
          ? { aspectRatio: aspect }
          : { height: height || 200 }
        }
      >
        <iframe
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          title={`${provider} embed`}
          data-testid={`embed-${provider.toLowerCase().replace('.', '-')}`}
        />
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-gray-500 hover:text-teal-400 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <FiExternalLink size={9} />
        {provider}
      </a>
    </div>
  );
}
