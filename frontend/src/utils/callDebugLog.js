/**
 * Call Debug Logger — persistent log storage for P2P call troubleshooting.
 * Stores timestamped entries in localStorage so they survive navigation.
 * Viewable from the Admin Dashboard "Call Debug" tab.
 */

const STORAGE_KEY = 'cthulhu_call_debug_log';
const MAX_ENTRIES = 500;

/**
 * Add a log entry.
 * @param {string} level - 'INFO' | 'WARN' | 'ERROR' | 'TX' | 'RX' | 'ICE' | 'SDP'
 * @param {string} message - Human-readable message
 * @param {object} [data] - Optional structured data (will be JSON stringified)
 */
export function callLog(level, message, data = null) {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const entry = {
      ts: new Date().toISOString(),
      t: Date.now(),
      level,
      msg: message,
    };
    if (data) entry.data = typeof data === 'string' ? data : JSON.stringify(data);
    entries.push(entry);
    // Trim to max
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('callLog write failed:', e);
  }
}

/**
 * Get all log entries.
 * @returns {Array<{ts: string, t: number, level: string, msg: string, data?: string}>}
 */
export function getCallLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Clear all log entries.
 */
export function clearCallLogs() {
  localStorage.setItem(STORAGE_KEY, '[]');
}

/**
 * Get logs as a plain-text string for copy-paste.
 */
export function exportCallLogs() {
  const entries = getCallLogs();
  return entries.map(e => {
    const time = e.ts.split('T')[1]?.slice(0, 12) || e.ts;
    const dataStr = e.data ? ` | ${e.data}` : '';
    return `[${time}] [${e.level}] ${e.msg}${dataStr}`;
  }).join('\n');
}
