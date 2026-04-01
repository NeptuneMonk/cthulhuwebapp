/**
 * MiniPlayer — Persistent audio player bar.
 * Shows currently playing track, play/pause, skip, progress bar.
 * Renders above the bottom nav when a track is active.
 */
import React, { useState } from 'react';
import { FiPlay, FiPause, FiSkipForward, FiSkipBack, FiX, FiMusic } from 'react-icons/fi';
import { useMiniPlayer } from '@/contexts/MiniPlayerContext';

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function MiniPlayerThumb({ image, imageFallback }) {
  const [src, setSrc] = useState(image);
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset when track changes
  React.useEffect(() => {
    setSrc(image);
    setTried(false);
    setFailed(false);
  }, [image]);

  if (failed || !src) return <FiMusic size={14} className="text-purple-400" />;
  return (
    <img src={src} alt="" className="w-full h-full rounded-lg object-cover" onError={() => {
      if (!tried && imageFallback && imageFallback !== src) {
        setTried(true);
        setSrc(imageFallback);
      } else {
        setFailed(true);
      }
    }} />
  );
}

export default function MiniPlayer() {
  const player = useMiniPlayer();
  if (!player || !player.currentTrack) return null;

  const { currentTrack, playing, currentTime, duration, togglePlay, next, prev, seek, clearQueue, queue, currentIndex } = player;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="border-t border-gray-800/60 bg-gray-950/95 backdrop-blur-sm" data-testid="mini-player">
      {/* Progress bar (clickable) */}
      <div
        className="h-1 bg-gray-800 cursor-pointer group relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek(pct * duration);
        }}
        data-testid="mini-player-progress"
      >
        <div className="h-full bg-purple-500 transition-all duration-200" style={{ width: `${progress}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `${progress}%`, marginLeft: -5 }} />
      </div>

      <div className="flex items-center gap-3 px-3 py-2">
        {/* Track info */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-purple-900/30 border border-purple-800/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
            <MiniPlayerThumb image={currentTrack.image} imageFallback={currentTrack.image_fallback} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-200 font-medium truncate" data-testid="mini-player-title">{currentTrack.name || 'Unknown Track'}</p>
            <p className="text-[10px] text-gray-500 truncate">
              {formatTime(currentTime)} / {formatTime(duration)}
              {queue.length > 1 && <span className="ml-2 text-gray-600">{currentIndex + 1} of {queue.length}</span>}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <button onClick={prev} className="p-1.5 text-gray-500 hover:text-gray-200 transition-colors" data-testid="mini-player-prev">
            <FiSkipBack size={14} />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 bg-purple-600 hover:bg-purple-500 rounded-full text-white transition-colors"
            data-testid="mini-player-toggle"
          >
            {playing ? <FiPause size={14} /> : <FiPlay size={14} className="ml-0.5" />}
          </button>
          <button onClick={next} className="p-1.5 text-gray-500 hover:text-gray-200 transition-colors" disabled={currentIndex >= queue.length - 1} data-testid="mini-player-next">
            <FiSkipForward size={14} />
          </button>
          <button onClick={clearQueue} className="p-1.5 text-gray-600 hover:text-red-400 transition-colors ml-1" data-testid="mini-player-close">
            <FiX size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
