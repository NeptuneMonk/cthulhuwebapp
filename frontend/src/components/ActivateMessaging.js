import React, { useState } from 'react';
import { FiMessageCircle, FiLock, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { buildProfileTransaction } from '@/utils/p2fk';
import { buildAndBroadcast } from '@/utils/txBuilder';
import FeePicker from '@/components/FeePicker';

/**
 * ActivateMessaging — Friendly one-click prompt to publish encryption keys.
 * Shows when a user tries to use DM/Chat/Call without having published their PKX/PKY.
 * After activation, calls onActivated() so the parent can refresh.
 */
export function ActivateMessaging({ network, onActivated, compact = false }) {
  const { user, wif, unlockWallet } = useAuth();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);

  const activate = async (inputWif) => {
    setError('');
    setActivating(true);
    try {
      let currentWif = inputWif || wif;
      if (!currentWif) {
        setNeedsPassword(true);
        setActivating(false);
        return;
      }

      // Fetch current profile so we don't overwrite existing fields
      const API = process.env.REACT_APP_BACKEND_URL;
      let profileData = {};
      try {
        const { dedupGet } = await import('@/utils/dedupFetch');
        const data = await dedupGet(`${API}/api/profile/${user?.address}?network=${network}`, 15000);
        // Use lowercase keys — format_profile returns {urn, bio, image, display_name}
        const fetchedUrn = data?.URN || data?.urn;
        if (fetchedUrn && fetchedUrn !== user?.address) {
          profileData.urn = fetchedUrn;
        }
        if (data?.Bio || data?.bio) profileData.bio = data.Bio || data.bio;
        if (data?.Image || data?.image) profileData.image = data.Image || data.image;
        if (data?.DisplayName || data?.display_name) profileData.displayName = data.DisplayName || data.display_name;
      } catch {}

      // CRITICAL: Never submit an address as the URN
      if (!profileData.urn || profileData.urn === user?.address) {
        throw new Error('No minted profile found. Mint your profile before activating messaging.');
      }

      const { addresses, taxInsertIndex } = buildProfileTransaction(currentWif, profileData, network);
      await buildAndBroadcast(currentWif, addresses, network, [], 0, 546, [], taxInsertIndex);

      // Store keys locally
      try {
        const { derivePKXPKY } = await import('@/utils/p2fk');
        const { pkx, pky } = derivePKXPKY(currentWif, network);
        await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/profile/keys/store`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: user?.address, pkx, pky, network }),
        });
      } catch {}

      setSuccess(true);
      if (onActivated) setTimeout(onActivated, 1500);
    } catch (err) {
      setError(err.message || 'Activation failed — check wallet balance');
    } finally {
      setActivating(false);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!password) return;
    setError('');
    setActivating(true);
    try {
      const { getStoredWallet, decryptWIF } = await import('@/utils/walletCrypto');
      const stored = getStoredWallet(user?.urn, user?.network);
      if (!stored?.encryptedWIF) throw new Error('No wallet found');
      let decrypted = await decryptWIF(stored.encryptedWIF, password);
      if (!decrypted) throw new Error('Wrong password');
      const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      decrypted = decrypted.split('').filter(c => BASE58.includes(c)).join('');
      await activate(decrypted);
    } catch (err) {
      setError(err.message || 'Wrong password');
      setActivating(false);
    }
  };

  if (success) {
    return (
      <div className={`flex items-center justify-center gap-2 ${compact ? 'py-2' : 'py-6'}`} data-testid="messaging-activated">
        <FiCheck size={16} className="text-emerald-400" />
        <span className="text-sm text-emerald-400">Private messaging activated!</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="px-3 py-2" data-testid="activate-messaging-compact">
        {needsPassword ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="Wallet password"
              className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none"
              autoFocus
              data-testid="activate-password-input"
            />
            <button
              onClick={handlePasswordSubmit}
              disabled={activating || !password}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40 transition-opacity"
              data-testid="activate-password-submit"
            >
              {activating ? '...' : 'Go'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => activate()}
            disabled={activating}
            className="w-full py-2 rounded-lg bg-emerald-600/20 border border-emerald-700/40 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors disabled:opacity-40"
            data-testid="activate-messaging-btn"
          >
            <FiMessageCircle size={12} className="inline mr-1.5 -mt-0.5" />
            {activating ? 'Activating...' : 'Activate Chat to send & receive messages'}
          </button>
        )}
        {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-8 space-y-4" data-testid="activate-messaging-prompt">
      <div className="w-14 h-14 rounded-full bg-emerald-900/30 border border-emerald-700/30 flex items-center justify-center">
        <FiLock size={22} className="text-emerald-400" />
      </div>
      <div>
        <p className="text-sm text-gray-200 font-medium">Activate Private Messaging</p>
        <p className="text-xs text-gray-500 mt-1 max-w-xs">
          This lets other users send you encrypted messages. It's a one-time on-chain transaction.
        </p>
      </div>
      <FeePicker network={network} />
      {needsPassword ? (
        <div className="flex items-center gap-2 w-full max-w-xs">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="Enter wallet password"
            className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none"
            autoFocus
            data-testid="activate-password-input"
          />
          <button
            onClick={handlePasswordSubmit}
            disabled={activating || !password}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-40 transition-opacity"
            data-testid="activate-password-submit"
          >
            {activating ? '...' : 'Activate'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => activate()}
          disabled={activating}
          className="px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2"
          data-testid="activate-messaging-btn"
        >
          <FiMessageCircle size={14} />
          {activating ? 'Activating...' : 'Activate'}
        </button>
      )}
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <FiAlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  );
}
