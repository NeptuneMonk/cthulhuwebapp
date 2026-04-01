/**
 * UploadQueueBar — Persistent notification bar showing active/completed uploads.
 * Renders above the bottom nav. Only visible when there are uploads in the queue.
 */
import React from 'react';
import { FiCheck, FiX, FiUploadCloud, FiAlertCircle } from 'react-icons/fi';
import { useUploadQueue } from '@/contexts/UploadQueueContext';

export default function UploadQueueBar() {
  const ctx = useUploadQueue();
  if (!ctx) return null;
  const { uploads, dismissUpload, clearCompleted } = ctx;

  if (uploads.length === 0) return null;

  const active = uploads.filter(u => u.status === 'uploading');
  const done = uploads.filter(u => u.status === 'done');
  const errored = uploads.filter(u => u.status === 'error');

  return (
    <div
      className="border-t border-gray-800/60 bg-gray-950/95 backdrop-blur-sm px-3 py-2 space-y-1.5"
      data-testid="upload-queue-bar"
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiUploadCloud size={13} className="text-purple-400" />
          <span className="text-[10px] font-medium text-gray-400">
            {active.length > 0
              ? `Uploading ${active.length} file${active.length > 1 ? 's' : ''}...`
              : `${done.length} complete${errored.length > 0 ? `, ${errored.length} failed` : ''}`}
          </span>
        </div>
        {active.length === 0 && (
          <button
            onClick={clearCompleted}
            className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            data-testid="upload-queue-clear"
          >
            Dismiss all
          </button>
        )}
      </div>

      {/* Upload items */}
      {uploads.map(u => (
        <div key={u.id} className="flex items-center gap-2" data-testid={`upload-item-${u.id}`}>
          {/* Icon */}
          {u.status === 'uploading' && (
            <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          {u.status === 'done' && <FiCheck size={12} className="text-emerald-400 flex-shrink-0" />}
          {u.status === 'error' && <FiAlertCircle size={12} className="text-red-400 flex-shrink-0" />}

          {/* Filename + progress */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-300 truncate">{u.filename}</span>
              <span className="text-[10px] text-gray-600 flex-shrink-0">
                {(u.size / 1024 / 1024).toFixed(1)}MB
              </span>
            </div>
            {u.status === 'uploading' && (
              <div className="h-0.5 bg-gray-800 rounded-full mt-0.5 overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all duration-300"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            )}
            {u.status === 'error' && (
              <span className="text-[9px] text-red-400/80">{u.error}</span>
            )}
          </div>

          {/* Progress text or dismiss */}
          {u.status === 'uploading' && (
            <span className="text-[10px] text-purple-400 font-mono flex-shrink-0">{u.progress}%</span>
          )}
          {u.status !== 'uploading' && (
            <button onClick={() => dismissUpload(u.id)} className="text-gray-600 hover:text-gray-400 flex-shrink-0">
              <FiX size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
