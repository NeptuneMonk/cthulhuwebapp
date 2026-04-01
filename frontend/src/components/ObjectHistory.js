import React, { useState } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { AddressLabel } from './AddressLabel';

const ACTION_STYLES = {
  claim:  { label: 'Claimed', bg: 'bg-emerald-900/30', text: 'text-emerald-400', border: 'border-emerald-800/40' },
  grant:  { label: 'Granted', bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-800/40' },
  give:   { label: 'Given', bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-800/40' },
  lock:   { label: 'Locked', bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-800/40' },
  buy:    { label: 'Bought', bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-800/40' },
  burn:   { label: 'Burned', bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-800/40' },
  List:   { label: 'Listed', bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-800/40' },
  offer:  { label: 'Offered', bg: 'bg-indigo-900/30', text: 'text-indigo-400', border: 'border-indigo-800/40' },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function ObjectHistory({ changeLog, resolvedProfiles, network, createdDate, lockedDate, loading }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-history">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b border-gray-500" />
          Loading history...
        </div>
      </div>
    );
  }

  if (!changeLog || changeLog.length === 0) return null;

  const resolved = resolvedProfiles || {};
  const displayName = (addr) => {
    const rp = resolved[addr];
    return rp?.urn || rp?.display_name || null;
  };

  // Show first 5 entries, expand to show all
  const visibleEntries = expanded ? changeLog : changeLog.slice(0, 5);
  const hasMore = changeLog.length > 5;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6" data-testid="object-history">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        History ({changeLog.length} events)
      </h3>

      {/* Key Dates */}
      <div className="flex flex-wrap gap-3 mb-4">
        {createdDate && createdDate !== '0001-01-01T00:00:00' && (
          <div className="px-2.5 py-1 bg-gray-800 rounded text-[11px]">
            <span className="text-gray-500">Created </span>
            <span className="text-gray-300">{formatDate(createdDate)}</span>
          </div>
        )}
        {lockedDate && lockedDate !== '0001-01-01T00:00:00' && (
          <div className="px-2.5 py-1 bg-amber-900/20 border border-amber-800/30 rounded text-[11px]">
            <span className="text-amber-500">Locked </span>
            <span className="text-amber-300">{formatDate(lockedDate)}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-800" />

        <div className="space-y-1">
          {visibleEntries.map((entry, idx) => {
            const action = (entry.action || '').toLowerCase();
            const style = ACTION_STYLES[entry.action] || ACTION_STYLES[action] || {
              label: entry.action || '?',
              bg: 'bg-gray-800/50',
              text: 'text-gray-400',
              border: 'border-gray-700/40',
            };

            const fromName = displayName(entry.from);
            const toName = displayName(entry.to);

            return (
              <div key={idx} className="flex items-start gap-3 py-1.5 pl-1 relative" data-testid={`history-entry-${idx}`}>
                {/* Timeline dot */}
                <div className={`w-5 h-5 rounded-full ${style.bg} border ${style.border} flex items-center justify-center flex-shrink-0 z-10`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${style.text.replace('text-', 'bg-')}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${style.bg} ${style.text} ${style.border} border`}>
                      {style.label}
                    </span>
                    {entry.quantity && entry.quantity !== '' && entry.quantity !== '0' && (
                      <span className="text-[11px] text-gray-400 font-mono">x{entry.quantity}</span>
                    )}
                    {entry.date && (
                      <span className="text-[10px] text-gray-600 ml-auto flex-shrink-0">{formatDate(entry.date)}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500 truncate">
                    {fromName ? (
                      <span className="text-gray-400">{fromName}</span>
                    ) : entry.from ? (
                      <AddressLabel address={entry.from} network={network} className="text-[11px]" />
                    ) : null}
                    {entry.to && entry.to !== entry.from && (
                      <>
                        <span className="text-gray-600 mx-1">&rarr;</span>
                        {toName ? (
                          <span className="text-gray-400">{toName}</span>
                        ) : (
                          <AddressLabel address={entry.to} network={network} className="text-[11px]" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 w-full flex items-center justify-center gap-1 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          data-testid="history-toggle"
        >
          {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
          {expanded ? 'Show less' : `Show all ${changeLog.length} events`}
        </button>
      )}
    </div>
  );
}
