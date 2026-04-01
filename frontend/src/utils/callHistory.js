/**
 * Call History — Persists call events to localStorage for user-visible history.
 * Separate from callDebugLog (which is for developer debugging).
 */

const STORAGE_KEY = 'cthulhu_call_history';
const MAX_ENTRIES = 100;

/**
 * @typedef {Object} CallRecord
 * @property {string} id - Unique call ID
 * @property {'incoming'|'outgoing'|'missed'} type
 * @property {string} contactUrn - Display name / URN of the other party
 * @property {string} contactAddress - Blockchain address
 * @property {string} contactImage - Profile image URL (if available)
 * @property {number} timestamp - Unix timestamp (ms)
 * @property {number} duration - Call duration in seconds (0 for missed)
 * @property {'completed'|'missed'|'failed'|'declined'|'no_answer'} status
 * @property {string} network - e.g., 'btc-testnet'
 */

function _load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function _save(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_ENTRIES)));
  } catch {}
}

export function addCallRecord(record) {
  const records = _load();
  records.unshift({
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    duration: 0,
    ...record,
  });
  _save(records);
}

export function updateCallDuration(id, duration) {
  const records = _load();
  const rec = records.find(r => r.id === id);
  if (rec) {
    rec.duration = duration;
    rec.status = 'completed';
    _save(records);
  }
}

export function getCallHistory() {
  return _load();
}

export function clearCallHistory() {
  localStorage.removeItem(STORAGE_KEY);
}
