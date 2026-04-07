import React, { useState } from 'react';
import {
  FiUser, FiArrowLeft, FiCheck, FiLoader, FiShield, FiMapPin, FiLink
} from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import FeePicker from '@/components/FeePicker';

export default function MintStep({ user, form, onMint, minting, mintError, onBack, isUpdate, network }) {
  const { wif, unlockWallet, importWallet } = useAuth();
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [showWifImport, setShowWifImport] = useState(false);
  const [importWif, setImportWif] = useState('');
  const [importPassword, setImportPassword] = useState('');

  // Convert form arrays to display-friendly objects
  const urlDict = (form.urls || []).filter(e => e.key && e.value)
    .reduce((acc, e) => { acc[e.key] = e.value; return acc; }, {});
  const locDict = (form.locEntries || []).filter(e => e.key && e.value)
    .reduce((acc, e) => { acc[e.key] = e.value; return acc; }, {});
  const locStr = Object.values(locDict).filter(Boolean).join(', ');

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-gray-100 mb-1">{isUpdate ? 'Update Your Profile' : 'Mint Your Profile'}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {isUpdate
          ? 'Review your changes and broadcast an update transaction to the blockchain.'
          : 'Review and mint your profile to the blockchain. This creates a SUP-compatible P2FK transaction.'}
      </p>

      {/* Summary */}
      <div className="space-y-3 mb-6">
        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-center gap-3">
          {form.imagePreview ? (
            <img src={form.imagePreview} alt="" className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
              <FiUser size={20} className="text-gray-600" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-200">{form.displayName || user.urn}</p>
            <p className="text-xs text-gray-500">@{user.urn}</p>
            {(form.firstName || form.lastName) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {[form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(' ')}
              </p>
            )}
          </div>
        </div>

        {form.bio && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <label className="text-xs text-gray-500 block mb-1">Bio</label>
            <p className="text-sm text-gray-300">{form.bio}</p>
          </div>
        )}

        {form.imageRef && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <label className="text-xs text-gray-500 block mb-1">Image</label>
            <p className="text-xs text-gray-400 truncate">{form.imageRef}</p>
          </div>
        )}

        {locStr && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-center gap-2">
            <FiMapPin size={14} className="text-gray-500 flex-shrink-0" />
            <p className="text-sm text-gray-300">{locStr}</p>
          </div>
        )}

        {Object.keys(urlDict).length > 0 && (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FiLink size={12} className="text-gray-500" />
              <label className="text-xs text-gray-500">Links</label>
            </div>
            <div className="space-y-1">
              {Object.entries(urlDict).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 capitalize w-16">{k}</span>
                  <a href={v} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                    {v}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
          <label className="text-xs text-gray-500 block mb-1">Estimated Cost</label>
          <p className="text-sm text-gray-300">~10,000 - 15,000 sats + miner fee</p>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex gap-2">
          <FiShield size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-400/80">
            Your private key signs this transaction locally in your browser. It is never sent to any server.
          </p>
        </div>
      </div>

      {/* Unlock / Import Wallet */}
      {!wif && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
          {!showWifImport ? (
            <>
              <p className="text-sm text-amber-400 mb-3">
                Enter your password to unlock your wallet for signing.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError(''); }}
                  placeholder="Your password"
                  className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                  data-testid="unlock-password-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && unlockPassword) {
                      setUnlocking(true);
                      setUnlockError('');
                      unlockWallet(unlockPassword)
                        .catch(err => {
                          if (err.message.includes('No wallet found')) setShowWifImport(true);
                          else setUnlockError(err.message);
                        })
                        .finally(() => setUnlocking(false));
                    }
                  }}
                />
                <button
                  onClick={async () => {
                    setUnlocking(true);
                    setUnlockError('');
                    try { await unlockWallet(unlockPassword); }
                    catch (err) {
                      if (err.message.includes('No wallet found')) setShowWifImport(true);
                      else setUnlockError(err.message);
                    }
                    finally { setUnlocking(false); }
                  }}
                  disabled={unlocking || !unlockPassword}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                  data-testid="unlock-wallet-btn"
                >
                  {unlocking ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
              {unlockError && <p className="text-xs text-red-400 mt-2">{unlockError}</p>}
              <button
                onClick={() => setShowWifImport(true)}
                className="text-xs text-blue-400 hover:underline mt-2"
                data-testid="show-wif-import-btn"
              >
                Wallet not on this device? Import WIF instead
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-amber-400 mb-3">
                Import your private key (WIF) and set a password to encrypt it on this device.
              </p>
              <div className="space-y-2">
                <input
                  type="password"
                  value={importWif}
                  onChange={(e) => { setImportWif(e.target.value); setUnlockError(''); }}
                  placeholder="Your WIF (private key)"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none font-mono"
                  data-testid="import-wif-input"
                />
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => { setImportPassword(e.target.value); setUnlockError(''); }}
                  placeholder="Password to encrypt wallet"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                  data-testid="import-password-input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowWifImport(false); setUnlockError(''); }}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={async () => {
                      setUnlocking(true);
                      setUnlockError('');
                      try {
                        await importWallet(importWif, importPassword);
                        setShowWifImport(false);
                      } catch (err) { setUnlockError(err.message); }
                      finally { setUnlocking(false); }
                    }}
                    disabled={unlocking || !importWif || !importPassword}
                    className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                    data-testid="import-wallet-btn"
                  >
                    {unlocking ? 'Importing...' : 'Import & Unlock'}
                  </button>
                </div>
              </div>
              {unlockError && <p className="text-xs text-red-400 mt-2">{unlockError}</p>}
            </>
          )}
        </div>
      )}

      {mintError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-400" data-testid="mint-error">{mintError}</p>
        </div>
      )}

      <FeePicker network={network} />

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm flex items-center gap-2 transition-colors"
        >
          <FiArrowLeft size={16} /> Back
        </button>
        <button
          onClick={onMint}
          disabled={minting || !wif}
          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          data-testid="confirm-mint-btn"
        >
          {minting ? (
            <><FiLoader size={16} className="animate-spin" /> {isUpdate ? 'Updating...' : 'Minting...'}</>
          ) : (
            <><FiCheck size={16} /> {isUpdate ? 'Confirm & Update' : 'Confirm & Mint Profile'}</>
          )}
        </button>
      </div>
    </div>
  );
}
