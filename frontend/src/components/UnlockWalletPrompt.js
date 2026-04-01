import React, { useState } from 'react';
import { FiLock, FiX } from 'react-icons/fi';

export const UnlockWalletPrompt = ({ onUnlock, onClose }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onUnlock(password);
    } catch (err) {
      setError(err.message || 'Wrong password');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70" onClick={onClose} data-testid="unlock-wallet-prompt">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-80 max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FiLock className="text-purple-400" />
            <h3 className="text-sm font-medium text-gray-200">Unlock Wallet</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><FiX size={16} /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Enter your password to unlock your wallet and sign transactions.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm placeholder-gray-600 focus:border-purple-500 focus:outline-none mb-3"
            data-testid="unlock-password-input"
          />
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
            data-testid="unlock-submit-btn"
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
};
