/**
 * File Safety Scanner — classifies files by threat level and provides
 * user-facing warnings before opening potentially dangerous content.
 *
 * Threat levels:
 *   SAFE     — images, plain text, audio (render inline)
 *   CAUTION  — HTML, PDF, video (render in sandbox with notice)
 *   WARNING  — archives, documents with macros (show warning before open)
 *   DANGER   — executables, scripts, unknown binaries (block with override)
 */

const THREAT_LEVELS = {
  SAFE: 'safe',
  CAUTION: 'caution',
  WARNING: 'warning',
  DANGER: 'danger',
};

// Extension → threat classification
const EXT_MAP = {
  // SAFE — static media, render inline
  jpg: THREAT_LEVELS.SAFE, jpeg: THREAT_LEVELS.SAFE, png: THREAT_LEVELS.SAFE,
  gif: THREAT_LEVELS.SAFE, webp: THREAT_LEVELS.SAFE, bmp: THREAT_LEVELS.SAFE,
  ico: THREAT_LEVELS.SAFE, svg: THREAT_LEVELS.CAUTION, // SVG can contain scripts
  txt: THREAT_LEVELS.SAFE, md: THREAT_LEVELS.SAFE, csv: THREAT_LEVELS.SAFE,
  json: THREAT_LEVELS.SAFE, xml: THREAT_LEVELS.SAFE,
  mp3: THREAT_LEVELS.SAFE, wav: THREAT_LEVELS.SAFE, ogg: THREAT_LEVELS.SAFE,
  flac: THREAT_LEVELS.SAFE, aac: THREAT_LEVELS.SAFE, m4a: THREAT_LEVELS.SAFE,
  woff: THREAT_LEVELS.SAFE, woff2: THREAT_LEVELS.SAFE, ttf: THREAT_LEVELS.SAFE,

  // CAUTION — can contain active content but sandboxed
  html: THREAT_LEVELS.CAUTION, htm: THREAT_LEVELS.CAUTION,
  pdf: THREAT_LEVELS.CAUTION,
  mp4: THREAT_LEVELS.SAFE, webm: THREAT_LEVELS.SAFE, mov: THREAT_LEVELS.SAFE,

  // WARNING — archives and complex documents
  zip: THREAT_LEVELS.WARNING, rar: THREAT_LEVELS.WARNING,
  '7z': THREAT_LEVELS.WARNING, tar: THREAT_LEVELS.WARNING,
  gz: THREAT_LEVELS.WARNING, bz2: THREAT_LEVELS.WARNING,
  doc: THREAT_LEVELS.WARNING, docx: THREAT_LEVELS.WARNING,
  xls: THREAT_LEVELS.WARNING, xlsx: THREAT_LEVELS.WARNING,
  ppt: THREAT_LEVELS.WARNING, pptx: THREAT_LEVELS.WARNING,

  // DANGER — executables and scripts
  exe: THREAT_LEVELS.DANGER, msi: THREAT_LEVELS.DANGER,
  bat: THREAT_LEVELS.DANGER, cmd: THREAT_LEVELS.DANGER,
  sh: THREAT_LEVELS.DANGER, bash: THREAT_LEVELS.DANGER,
  ps1: THREAT_LEVELS.DANGER, psm1: THREAT_LEVELS.DANGER,
  vbs: THREAT_LEVELS.DANGER, vbe: THREAT_LEVELS.DANGER,
  js: THREAT_LEVELS.DANGER, // standalone JS files
  py: THREAT_LEVELS.DANGER, rb: THREAT_LEVELS.DANGER, pl: THREAT_LEVELS.DANGER,
  dll: THREAT_LEVELS.DANGER, so: THREAT_LEVELS.DANGER, dylib: THREAT_LEVELS.DANGER,
  app: THREAT_LEVELS.DANGER, dmg: THREAT_LEVELS.DANGER,
  deb: THREAT_LEVELS.DANGER, rpm: THREAT_LEVELS.DANGER,
  apk: THREAT_LEVELS.DANGER, ipa: THREAT_LEVELS.DANGER,
  iso: THREAT_LEVELS.DANGER, img: THREAT_LEVELS.DANGER,
  com: THREAT_LEVELS.DANGER, scr: THREAT_LEVELS.DANGER,
  jar: THREAT_LEVELS.DANGER, class: THREAT_LEVELS.DANGER,
  swf: THREAT_LEVELS.DANGER, cab: THREAT_LEVELS.DANGER,
  reg: THREAT_LEVELS.DANGER, inf: THREAT_LEVELS.DANGER,
  lnk: THREAT_LEVELS.DANGER, pif: THREAT_LEVELS.DANGER,
};

/**
 * Classify a file's threat level by its name/extension.
 * @param {string} filename
 * @returns {{ level: string, label: string, description: string, color: string }}
 */
export function classifyFile(filename) {
  if (!filename) return dangerResult('Unknown file');

  // Detect web addresses / domain names (e.g., "embii.wtf", "example.com")
  // These are URLs, not files — treat as caution (external link)
  const KNOWN_TLDS = ['com','org','net','io','wtf','xyz','co','me','dev','app','gg','tv','fm','ai','cc','to','ly','sh','info','biz','us','uk','de','fr','es','it','nl','eu','br','au','ca','jp','cn','in','ru','ch','at','be','se','no','dk','fi','pl','pt','cz','hu','ro','bg','hr','sk','si','lt','lv','ee','mt','cy','lu'];
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const nameWithoutExt = filename.slice(0, filename.lastIndexOf('.'));

  // If it looks like a domain: no spaces, no path separators, known TLD, short base name
  if (KNOWN_TLDS.includes(ext) && nameWithoutExt && !nameWithoutExt.includes(' ') && !nameWithoutExt.includes('/') && nameWithoutExt.length < 64) {
    return { level: THREAT_LEVELS.CAUTION, label: 'Web Link', description: 'This is a web address. Opening it will navigate to an external site.', color: 'blue' };
  }

  const level = EXT_MAP[ext] || THREAT_LEVELS.DANGER; // unknown = danger

  switch (level) {
    case THREAT_LEVELS.SAFE:
      return { level, label: 'Safe', description: 'Standard media file.', color: 'emerald' };
    case THREAT_LEVELS.CAUTION:
      return { level, label: 'Caution', description: 'This file type can contain active content. It will be opened in a restricted sandbox.', color: 'yellow' };
    case THREAT_LEVELS.WARNING:
      return { level, label: 'Warning', description: 'Archives and documents can contain hidden executables, scripts, or malware. Only open files from sources you trust.', color: 'orange' };
    case THREAT_LEVELS.DANGER:
      return dangerResult(ext);
    default:
      return dangerResult(ext);
  }
}

function dangerResult(ext) {
  return {
    level: THREAT_LEVELS.DANGER,
    label: 'Dangerous',
    description: `This file type (.${ext}) can execute code on your device. It may contain viruses or malware. Do NOT open unless you fully trust the source.`,
    color: 'red',
  };
}

/**
 * Check if a file should show a warning before opening.
 */
export function needsWarning(filename) {
  const { level } = classifyFile(filename);
  return level === THREAT_LEVELS.WARNING || level === THREAT_LEVELS.DANGER;
}

/**
 * Check if a file is an embedded web app (index.zip).
 */
export function isWebApp(filename) {
  return filename && filename.toLowerCase().includes('index.zip');
}

export { THREAT_LEVELS };
