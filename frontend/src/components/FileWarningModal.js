import React from 'react';
import { FiShield, FiAlertTriangle, FiAlertOctagon, FiX } from 'react-icons/fi';
import { classifyFile, THREAT_LEVELS } from '@/utils/fileSafety';

/**
 * FileWarningModal — Shows a security warning before opening risky files.
 * The user must explicitly acknowledge the risk to proceed.
 */
export const FileWarningModal = ({ filename, onProceed, onCancel }) => {
  const classification = classifyFile(filename);
  const isDanger = classification.level === THREAT_LEVELS.DANGER;

  const iconMap = {
    [THREAT_LEVELS.WARNING]: <FiAlertTriangle size={28} className="text-orange-400" />,
    [THREAT_LEVELS.DANGER]: <FiAlertOctagon size={28} className="text-red-400" />,
    [THREAT_LEVELS.CAUTION]: <FiShield size={28} className="text-yellow-400" />,
  };

  const borderMap = {
    [THREAT_LEVELS.WARNING]: 'border-orange-500/40',
    [THREAT_LEVELS.DANGER]: 'border-red-500/40',
    [THREAT_LEVELS.CAUTION]: 'border-yellow-500/40',
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="file-warning-modal">
      <div className={`bg-gray-900 rounded-xl border ${borderMap[classification.level] || 'border-gray-700'} max-w-md w-full p-6 space-y-4`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {iconMap[classification.level] || iconMap[THREAT_LEVELS.DANGER]}
            <div>
              <h3 className="text-lg font-bold text-gray-100">Security {classification.label}</h3>
              <p className="text-xs text-gray-500 font-mono mt-0.5 break-all">{filename}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 p-1" data-testid="file-warning-close">
            <FiX size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-300 leading-relaxed">{classification.description}</p>

        {isDanger && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3">
            <p className="text-xs text-red-300">
              Blockchain objects are user-uploaded and unverified. Malicious files can steal wallet keys, install ransomware, or damage your system.
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors font-medium"
            data-testid="file-warning-cancel"
          >
            Go Back
          </button>
          <button
            onClick={onProceed}
            className={`flex-1 px-4 py-2.5 text-sm rounded-lg transition-colors font-medium ${
              isDanger
                ? 'bg-red-900/60 hover:bg-red-800/70 text-red-200 border border-red-700/50'
                : 'bg-orange-900/60 hover:bg-orange-800/70 text-orange-200 border border-orange-700/50'
            }`}
            data-testid="file-warning-proceed"
          >
            {isDanger ? 'I Accept the Risk' : 'Open Anyway'}
          </button>
        </div>
      </div>
    </div>
  );
};
