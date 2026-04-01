/**
 * MiniPlayerContext — Global audio player state.
 * Manages a queue of tracks with play/pause/skip/previous.
 * Persists playback state across page navigation.
 */
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const MiniPlayerContext = createContext(null);

export function MiniPlayerProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(new Audio());

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  // Sync audio element with state
  useEffect(() => {
    const audio = audioRef.current;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (currentIndex < queue.length - 1) {
        setCurrentIndex(i => i + 1);
      } else {
        setPlaying(false);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [currentIndex, queue.length]);

  // Load and play when track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (currentTrack && currentTrack.url) {
      audio.src = currentTrack.url;
      // On error, try alternate URL (CID/filename fallback for IPFS)
      const onError = () => {
        if (currentTrack.url_alt && audio.src !== currentTrack.url_alt) {
          audio.src = currentTrack.url_alt;
          audio.play().catch(() => {});
        }
      };
      audio.addEventListener('error', onError);
      audio.play().catch(() => {});
      return () => audio.removeEventListener('error', onError);
    } else {
      audio.pause();
      audio.src = '';
    }
  }, [currentTrack]);

  const playTrack = useCallback((track) => {
    const idx = queue.findIndex(t => t.id === track.id);
    if (idx >= 0) {
      setCurrentIndex(idx);
    } else {
      setQueue(prev => [...prev, track]);
      setCurrentIndex(queue.length);
    }
    setPlaying(true);
  }, [queue]);

  const playAll = useCallback((tracks, startIndex = 0) => {
    setQueue(tracks);
    setCurrentIndex(startIndex);
    setPlaying(true);
  }, []);

  const addToQueue = useCallback((track) => {
    setQueue(prev => {
      if (prev.some(t => t.id === track.id)) return prev;
      return [...prev, track];
    });
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [playing]);

  const next = useCallback(() => {
    if (currentIndex < queue.length - 1) setCurrentIndex(i => i + 1);
  }, [currentIndex, queue.length]);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
    }
  }, [currentIndex]);

  const seek = useCallback((time) => {
    audioRef.current.currentTime = time;
  }, []);

  const clearQueue = useCallback(() => {
    audioRef.current.pause();
    audioRef.current.src = '';
    setQueue([]);
    setCurrentIndex(-1);
    setPlaying(false);
  }, []);

  return (
    <MiniPlayerContext.Provider value={{
      queue, currentTrack, currentIndex, playing, currentTime, duration,
      playTrack, playAll, addToQueue, togglePlay, next, prev, seek, clearQueue,
    }}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer() {
  return useContext(MiniPlayerContext);
}
