import React, { useState, useEffect, useCallback, useContext, createContext } from 'react';

const THEME_KEY = 'cthulhu_theme';
const WALLPAPER_KEY = 'cthulhu_wallpaper';
const CUSTOM_WP_KEY = 'cthulhu_custom_wallpaper';
const BRIGHT_KEY = 'cthulhu_bright_mode';

// Lighten a hex color by a factor (0-1)
function lightenHex(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * factor));
  const ng = Math.min(255, Math.round(g + (255 - g) * factor));
  const nb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// Convert hex to "r, g, b" string for rgba usage
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

export const THEMES = {
  midnight: {
    id: 'midnight', label: 'Midnight', accent: '#14b8a6',
    colors: { bg: '#080c12', card: '#0f1923', border: '#1a2a3a', accent: '#14b8a6', accentMuted: 'rgba(20,184,166,0.15)', text: '#e5e7eb', textMuted: '#6b7280' },
    preview: ['#080c12', '#14b8a6', '#1a2a3a'],
  },
  ocean: {
    id: 'ocean', label: 'Ocean', accent: '#00d4ff',
    colors: { bg: '#041628', card: '#082844', border: '#0d3f6e', accent: '#00d4ff', accentMuted: 'rgba(0,212,255,0.18)', text: '#c8e6ff', textMuted: '#4d8bb8' },
    preview: ['#041628', '#00d4ff', '#0d3f6e'],
  },
  ember: {
    id: 'ember', label: 'Ember', accent: '#ff6b2b',
    colors: { bg: '#1a0a04', card: '#2a1208', border: '#4a2010', accent: '#ff6b2b', accentMuted: 'rgba(255,107,43,0.18)', text: '#ffd8c0', textMuted: '#a06840' },
    preview: ['#1a0a04', '#ff6b2b', '#4a2010'],
  },
  matrix: {
    id: 'matrix', label: 'Matrix', accent: '#00ff41',
    colors: { bg: '#020a02', card: '#061806', border: '#0a300a', accent: '#00ff41', accentMuted: 'rgba(0,255,65,0.12)', text: '#b0ffb0', textMuted: '#2a7a2a' },
    preview: ['#020a02', '#00ff41', '#0a300a'],
  },
  violet: {
    id: 'violet', label: 'Violet', accent: '#bf5af2',
    colors: { bg: '#120818', card: '#1e0e2e', border: '#381a54', accent: '#bf5af2', accentMuted: 'rgba(191,90,242,0.18)', text: '#e8d0ff', textMuted: '#7a4a9a' },
    preview: ['#120818', '#bf5af2', '#381a54'],
  },
  crimson: {
    id: 'crimson', label: 'Crimson', accent: '#ef4444',
    colors: { bg: '#140404', card: '#220808', border: '#3a1010', accent: '#ef4444', accentMuted: 'rgba(239,68,68,0.18)', text: '#fdd', textMuted: '#994040' },
    preview: ['#140404', '#ef4444', '#3a1010'],
  },
  gold: {
    id: 'gold', label: 'Gold', accent: '#f59e0b',
    colors: { bg: '#141004', card: '#221c08', border: '#3a3010', accent: '#f59e0b', accentMuted: 'rgba(245,158,11,0.18)', text: '#ffefd0', textMuted: '#8a7030' },
    preview: ['#141004', '#f59e0b', '#3a3010'],
  },
  arctic: {
    id: 'arctic', label: 'Arctic', accent: '#7dd3fc',
    colors: { bg: '#0a0e14', card: '#101820', border: '#1e2e3e', accent: '#7dd3fc', accentMuted: 'rgba(125,211,252,0.14)', text: '#e0f0ff', textMuted: '#5580a0' },
    preview: ['#0a0e14', '#7dd3fc', '#1e2e3e'],
  },
  rose: {
    id: 'rose', label: 'Rose', accent: '#f472b6',
    colors: { bg: '#140810', card: '#22101c', border: '#3a1830', accent: '#f472b6', accentMuted: 'rgba(244,114,182,0.18)', text: '#ffe0f0', textMuted: '#905070' },
    preview: ['#140810', '#f472b6', '#3a1830'],
  },
  slate: {
    id: 'slate', label: 'Slate', accent: '#94a3b8',
    colors: { bg: '#0e1015', card: '#181c22', border: '#2a2e36', accent: '#94a3b8', accentMuted: 'rgba(148,163,184,0.14)', text: '#d8dce4', textMuted: '#5a6070' },
    preview: ['#0e1015', '#94a3b8', '#2a2e36'],
  },
};

export const WALLPAPERS = {
  none: { id: 'none', label: 'None', css: 'none' },
  starfield: {
    id: 'starfield', label: 'Starfield',
    css: 'radial-gradient(1.2px 1.2px at 20px 30px, rgba(255,255,255,0.15) 50%, transparent 50%), radial-gradient(1px 1px at 60px 80px, rgba(255,255,255,0.08) 50%, transparent 50%), radial-gradient(1.5px 1.5px at 110px 50px, rgba(255,255,255,0.12) 50%, transparent 50%), radial-gradient(0.8px 0.8px at 150px 120px, rgba(255,255,255,0.06) 50%, transparent 50%)',
    size: '180px 160px, 220px 200px, 260px 240px, 300px 280px',
  },
  diamonds: {
    id: 'diamonds', label: 'Diamonds',
    css: 'repeating-linear-gradient(45deg, transparent, transparent 24px, rgba(255,255,255,0.04) 24px, rgba(255,255,255,0.04) 25px), repeating-linear-gradient(-45deg, transparent, transparent 24px, rgba(255,255,255,0.04) 24px, rgba(255,255,255,0.04) 25px)',
    size: 'auto',
  },
  circuit: {
    id: 'circuit', label: 'Circuit',
    css: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(circle 2px at 20px 20px, rgba(255,255,255,0.06) 2px, transparent 2px)',
    size: '40px 40px, 40px 40px, 40px 40px',
  },
  topography: {
    id: 'topography', label: 'Topography',
    css: 'repeating-radial-gradient(circle at 50% 50%, transparent 0, transparent 18px, rgba(255,255,255,0.025) 18px, rgba(255,255,255,0.025) 19px)',
    size: '60px 60px',
  },
  waves: {
    id: 'waves', label: 'Waves',
    css: 'repeating-linear-gradient(110deg, transparent, transparent 30px, rgba(255,255,255,0.02) 30px, rgba(255,255,255,0.04) 50px, transparent 50px, transparent 80px)',
    size: 'auto',
  },
  hexgrid: {
    id: 'hexgrid', label: 'Hex Grid',
    css: 'radial-gradient(circle farthest-side at 0% 50%, transparent 23%, rgba(255,255,255,0.04) 24%, rgba(255,255,255,0.04) 25%, transparent 26%), radial-gradient(circle farthest-side at 100% 50%, transparent 23%, rgba(255,255,255,0.04) 24%, rgba(255,255,255,0.04) 25%, transparent 26%)',
    size: '32px 56px',
  },
  aurora: {
    id: 'aurora', label: 'Aurora',
    css: 'linear-gradient(135deg, rgba(0,255,128,0.06) 0%, transparent 30%), linear-gradient(225deg, rgba(0,128,255,0.08) 0%, transparent 35%), linear-gradient(315deg, rgba(128,0,255,0.06) 0%, transparent 40%)',
    size: 'cover',
  },
  sunset: {
    id: 'sunset', label: 'Sunset',
    css: 'linear-gradient(180deg, rgba(255,60,60,0.04) 0%, rgba(255,120,0,0.06) 30%, rgba(255,180,0,0.04) 60%, rgba(100,0,80,0.06) 100%)',
    size: 'cover',
  },
  nebula: {
    id: 'nebula', label: 'Nebula',
    css: 'radial-gradient(ellipse at 20% 50%, rgba(120,0,255,0.1) 0%, transparent 50%), radial-gradient(ellipse at 80% 30%, rgba(0,100,255,0.08) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(255,0,120,0.06) 0%, transparent 50%)',
    size: 'cover',
  },
};

const BRIGHT_FACTOR = 0.25; // how much to lighten in bright mode

function applyThemeToDOM(themeId, bright) {
  const t = THEMES[themeId] || THEMES.midnight;
  const root = document.documentElement;
  const colors = { ...t.colors };

  // In bright mode, lighten the base dark colors
  if (bright) {
    colors.bg = lightenHex(colors.bg, BRIGHT_FACTOR);
    colors.card = lightenHex(colors.card, BRIGHT_FACTOR);
    colors.border = lightenHex(colors.border, BRIGHT_FACTOR);
    colors.textMuted = lightenHex(colors.textMuted, 0.15);
    // Slightly brighten the accent's muted background
    const accentRgb = hexToRgb(colors.accent);
    colors.accentMuted = `rgba(${accentRgb}, 0.22)`;
  }

  Object.entries(colors).forEach(([key, val]) => {
    root.style.setProperty(`--c-${key}`, val);
  });

  // Extra: expose accent as RGB for flexible opacity usage
  root.style.setProperty('--c-accent-rgb', hexToRgb(colors.accent));
  root.style.setProperty('--theme-id', themeId);
  root.style.setProperty('--bright-mode', bright ? '1' : '0');

  document.body.style.backgroundColor = colors.bg;
  document.body.style.color = colors.text;

  return colors;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeId, setThemeIdState] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES[saved]) return saved;
    return 'midnight';
  });
  const [wallpaperId, setWallpaperIdState] = useState(() => localStorage.getItem(WALLPAPER_KEY) || 'none');
  const [customWallpaper, setCustomWallpaperState] = useState(() => localStorage.getItem(CUSTOM_WP_KEY) || '');
  const [brightMode, setBrightModeState] = useState(() => localStorage.getItem(BRIGHT_KEY) === 'true');

  useEffect(() => { applyThemeToDOM(themeId, brightMode); }, [themeId, brightMode]);

  const setTheme = useCallback((id) => {
    localStorage.setItem(THEME_KEY, id);
    setThemeIdState(id);
    applyThemeToDOM(id, localStorage.getItem(BRIGHT_KEY) === 'true');
  }, []);

  const setWallpaper = useCallback((id) => {
    localStorage.setItem(WALLPAPER_KEY, id);
    setWallpaperIdState(id);
  }, []);

  const setCustomWallpaper = useCallback((url) => {
    localStorage.setItem(CUSTOM_WP_KEY, url);
    setCustomWallpaperState(url);
  }, []);

  const setBrightMode = useCallback((val) => {
    localStorage.setItem(BRIGHT_KEY, val ? 'true' : 'false');
    setBrightModeState(val);
  }, []);

  const baseTheme = THEMES[themeId] || THEMES.midnight;
  // Compute effective colors (may be brightened)
  const effectiveColors = brightMode
    ? {
        ...baseTheme.colors,
        bg: lightenHex(baseTheme.colors.bg, BRIGHT_FACTOR),
        card: lightenHex(baseTheme.colors.card, BRIGHT_FACTOR),
        border: lightenHex(baseTheme.colors.border, BRIGHT_FACTOR),
        textMuted: lightenHex(baseTheme.colors.textMuted, 0.15),
      }
    : baseTheme.colors;

  const theme = { ...baseTheme, colors: effectiveColors };

  const wallpaperStyle = wallpaperId === 'custom' && customWallpaper
    ? { backgroundImage: `url(${customWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : wallpaperId !== 'none' && WALLPAPERS[wallpaperId]
    ? { backgroundImage: WALLPAPERS[wallpaperId].css, backgroundSize: WALLPAPERS[wallpaperId].size || 'auto' }
    : {};

  const value = { themeId, wallpaperId, customWallpaper, brightMode, theme, wallpaperStyle, setTheme, setWallpaper, setCustomWallpaper, setBrightMode };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    const t = THEMES[localStorage.getItem(THEME_KEY)] || THEMES.midnight;
    return { themeId: 'midnight', wallpaperId: 'none', customWallpaper: '', brightMode: false, theme: t, wallpaperStyle: {}, setTheme: () => {}, setWallpaper: () => {}, setCustomWallpaper: () => {}, setBrightMode: () => {} };
  }
  return ctx;
}
