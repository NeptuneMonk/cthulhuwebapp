import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiLock, FiEye, FiEyeOff, FiAlertTriangle, FiCopy, FiCheck, FiShield, FiArrowRight, FiKey, FiPlus, FiSearch } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { copyToClipboard } from '@/utils/clipboard';
import { CTHULHU_SVG } from '@/components/CthulhuLogo';

export default function AuthPage() {
  const { importKeyLogin, createNewWallet, unlockWallet, isConnected, isWalletUnlocked, needsUnlock, lookingUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('import'); // 'import' | 'create' | 'backup' | 'unlock'
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [backupWif, setBackupWif] = useState(null);
  const [backupAddress, setBackupAddress] = useState(null);
  const [copied, setCopied] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  // Import WIF state
  const [importWif, setImportWif] = useState('');
  // Network selection
  const [authNetwork, setAuthNetwork] = useState(() => localStorage.getItem('cthulhu_network') || 'btc-testnet');

  // Check if returning user has a stored wallet → show unlock mode
  useEffect(() => {
    if (needsUnlock && !isWalletUnlocked) {
      setMode('unlock');
      return;
    }
    // Also check directly in localStorage (covers post-logout redirect)
    try {
      const recovery = JSON.parse(localStorage.getItem('cthulhu_auth_recovery'));
      if (recovery?.address && !isConnected) {
        // Verify there's actually an encrypted wallet for this recovery
        const walletsRaw = localStorage.getItem(`cthulhu_wallets_${(recovery.urn || recovery.address).toLowerCase()}_${recovery.network}`);
        const wallets = walletsRaw ? JSON.parse(walletsRaw) : [];
        if (wallets.some(w => w.address === recovery.address && w.encryptedWIF)) {
          setMode('unlock');
        }
      }
    } catch {}
  }, [needsUnlock, isWalletUnlocked, isConnected]);

  // If already logged in with unlocked wallet, redirect
  useEffect(() => {
    if (isConnected && isWalletUnlocked && mode !== 'backup') navigate('/feed');
  }, [isConnected, isWalletUnlocked, navigate, mode]);

  const handleImportKey = async (e) => {
    e?.preventDefault();
    setError('');
    if (!importWif.trim()) { setError('Paste your WIF private key'); return; }
    if (!password) { setError('Enter a password to encrypt your wallet'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setSubmitting(true);
    try {
      localStorage.setItem('cthulhu_network', authNetwork);
      await importKeyLogin(importWif.trim(), password, authNetwork);
      navigate('/feed');
    } catch (err) {
      console.error('Import error:', err);
      setError(err.message || 'Import failed — check console for details');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWallet = async (e) => {
    e?.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPw) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      localStorage.setItem('cthulhu_network', authNetwork);
      const result = await createNewWallet(password, authNetwork);
      setBackupWif(result.wif);
      setBackupAddress(result.address);
      setMode('backup');
    } catch (err) {
      console.error('Create wallet error:', err);
      setError(err.message || 'Wallet creation failed — check console for details');
    } finally {
      setSubmitting(false);
    }
  };

  const copyWif = () => {
    copyToClipboard(backupWif);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // "Finding your blob..." overlay
  if (lookingUp) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center">
          <img src={CTHULHU_SVG} alt="Cthulhu" className="h-16 w-auto mx-auto mb-6 animate-pulse" />
          <div className="flex items-center gap-2 text-gray-300 text-lg">
            <FiSearch className="animate-spin" size={20} />
            Finding your blob on-chain...
          </div>
          <p className="text-sm text-gray-600 mt-2">Looking up your profile on the blockchain</p>
        </div>
      </div>
    );
  }

  // Unlock screen — returning user just needs password
  if (mode === 'unlock') {
    const handleUnlock = async (e) => {
      e?.preventDefault();
      if (!password.trim()) { setError('Enter your password'); return; }
      setSubmitting(true);
      setError('');
      try {
        // If user state is gone (post-logout), use importKeyLogin with the stored WIF
        // by first trying unlockWallet, then falling back to recovery-based unlock
        try {
          await unlockWallet(password);
        } catch (unlockErr) {
          // unlockWallet failed (probably because user is null post-logout)
          // Try recovery-based unlock: find stored wallet, decrypt, then importKeyLogin
          const recovery = JSON.parse(localStorage.getItem('cthulhu_auth_recovery') || 'null');
          if (!recovery?.address) throw unlockErr;
          const { decryptWIF } = await import('@/utils/walletCrypto');
          const { getStoredWallet } = await import('@/utils/walletCrypto');
          let stored = getStoredWallet(recovery.urn || recovery.address, recovery.network, recovery.address);
          if (!stored?.encryptedWIF) stored = getStoredWallet(recovery.address, recovery.network, recovery.address);
          if (!stored?.encryptedWIF) throw new Error('No wallet found. Please import your WIF.');
          const wifDecrypted = await decryptWIF(stored.encryptedWIF, password);
          if (!wifDecrypted) throw new Error('Wrong password');
          // Re-import with the decrypted WIF (this sets up full user state)
          await importKeyLogin(wifDecrypted, password, recovery.network);
        }
        navigate('/feed');
      } catch (err) {
        console.error('Unlock error:', err);
        setError(err.message || 'Wrong password');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src={CTHULHU_SVG} alt="Cthulhu" className="h-20 w-auto mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-100">Welcome back</h1>
            <p className="text-sm text-gray-500 mt-1">Enter your password to unlock</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="relative">
              <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full pl-10 pr-10 py-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-100 focus:border-purple-500 focus:outline-none"
                data-testid="unlock-password-input"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPw ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>

            {error && <p className="text-sm text-red-400 text-center" data-testid="unlock-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              data-testid="unlock-submit-btn"
            >
              <FiLock size={16} />
              {submitting ? 'Unlocking...' : 'Unlock Wallet'}
            </button>
          </form>

          <button
            onClick={() => { setMode('import'); setError(''); setPassword(''); }}
            className="w-full mt-4 text-xs text-gray-600 hover:text-gray-400 transition-colors text-center"
            data-testid="switch-to-import-btn"
          >
            Use a different key instead
          </button>

          <button
            onClick={() => navigate('/feed')}
            className="w-full mt-2 flex items-center justify-center gap-2 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            data-testid="browse-guest-btn-unlock"
          >
            Browse as guest <FiArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Backup screen — shown once after wallet creation
  if (mode === 'backup') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <img src={CTHULHU_SVG} alt="Cthulhu" className="h-12 w-auto mx-auto mb-2" />
          </div>
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <FiAlertTriangle size={20} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-100">Back Up Your Private Key</h2>
                <p className="text-xs text-amber-400">This is your ONLY recovery method. Save it now.</p>
              </div>
            </div>

            <p className="text-sm text-gray-400 mb-4">
              Your private key is encrypted on this device. If you ever clear browser data or use a new device, 
              you'll need this key to get back in. The blockchain remembers you — this key proves you're you.
            </p>

            <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 mb-3">
              <label className="text-xs text-gray-500 block mb-1">Your Address</label>
              <code className="text-sm text-blue-400 break-all select-all" data-testid="backup-address">{backupAddress}</code>
            </div>

            <div className="bg-gray-950 border border-amber-500/20 rounded-lg p-4 mb-4">
              <label className="text-xs text-amber-400 block mb-1">Private Key (WIF)</label>
              <code className="text-sm text-gray-200 break-all select-all font-mono" data-testid="backup-wif">{backupWif}</code>
              <button
                onClick={copyWif}
                className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                data-testid="copy-wif-btn"
              >
                {copied ? <><FiCheck size={12} className="text-green-400" /> Copied!</> : <><FiCopy size={12} /> Copy to clipboard</>}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-400 mb-6 cursor-pointer">
              <input
                type="checkbox"
                checked={backedUp}
                onChange={(e) => setBackedUp(e.target.checked)}
                className="rounded border-gray-600"
                data-testid="backup-confirm-checkbox"
              />
              I have safely backed up my private key
            </label>

            <button
              onClick={() => navigate('/feed')}
              disabled={!backedUp}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              data-testid="continue-btn"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <img src={CTHULHU_SVG} alt="Cthulhu" className="h-20 w-auto mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-100">Cthulhu</h1>
          <p className="text-sm text-gray-500 mt-1">Decentralized Social Objects</p>
        </div>

        {/* Experimental Beta Warning */}
        <div className="bg-amber-900/15 border border-amber-600/30 rounded-lg px-4 py-3 mb-4" data-testid="beta-warning-banner">
          <div className="flex items-start gap-2.5">
            <FiAlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={15} />
            <p className="text-[11px] text-amber-400/80 leading-relaxed">
              <strong>Experimental Beta:</strong> Cthulhu is a work in progress. Accounts and data may not persist between updates. Your WIF key is your identity &mdash; <span className="text-amber-300 font-medium">back it up</span>.
            </p>
          </div>
        </div>

        {/* Unmoderated Content Advisory */}
        <div className="bg-amber-900/10 border border-amber-700/20 rounded-lg px-4 py-3 mb-6" data-testid="content-advisory">
          <p className="text-[11px] text-amber-400/80 leading-relaxed">
            <strong>Unmoderated Space:</strong> This is a decentralized, public network. Content is written directly to the blockchain and cannot be censored or removed by any authority. You are responsible for blocking profiles that create content you find unacceptable.
          </p>
        </div>

        {/* Toggle */}
        <div className="flex bg-gray-900 rounded-lg p-1 mb-6">
          <button
            onClick={() => { setMode('import'); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'import' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="auth-import-tab"
          >
            <FiKey size={12} /> Import Key
          </button>
          <button
            onClick={() => { setMode('create'); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              mode === 'create' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
            data-testid="auth-create-tab"
          >
            <FiPlus size={12} /> New Wallet
          </button>
        </div>

        {/* Network Selector */}
        <div className="flex items-center gap-2 mb-4" data-testid="auth-network-selector">
          <span className="text-[11px] text-gray-500">Network:</span>
          <button
            type="button"
            onClick={() => { const n = authNetwork === 'btc-testnet' ? 'btc-mainnet' : 'btc-testnet'; setAuthNetwork(n); localStorage.setItem('cthulhu_network', n); }}
            className={`px-3 py-1 text-[11px] font-mono rounded-full border transition-colors ${
              authNetwork === 'btc-mainnet'
                ? 'bg-orange-600/20 border-orange-500/40 text-orange-400'
                : 'bg-teal-600/20 border-teal-500/40 text-teal-400'
            }`}
            data-testid="auth-network-toggle"
          >
            {authNetwork === 'btc-mainnet' ? 'BTC Mainnet' : 'BTC Testnet'}
          </button>
        </div>

        {/* Import Key Mode */}
        {mode === 'import' && (
          <form onSubmit={handleImportKey} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Private Key (WIF)</label>
              <div className="relative">
                <FiKey className="absolute left-3 top-3.5 text-gray-500" size={16} />
                <textarea
                  value={importWif}
                  onChange={(e) => setImportWif(e.target.value)}
                  placeholder="Paste your WIF private key..."
                  rows={2}
                  className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-100 font-mono text-sm focus:border-blue-500 focus:outline-none resize-none"
                  data-testid="import-wif-input"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Encryption Password</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password to encrypt wallet on this device"
                  className="w-full pl-10 pr-10 py-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-100 focus:border-blue-500 focus:outline-none"
                  data-testid="import-password-input"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPw ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 mt-1">This password encrypts your key locally. You'll use it to unlock on return.</p>
            </div>

            {error && <p className="text-sm text-red-400 text-center" data-testid="auth-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              data-testid="auth-submit-btn"
            >
              <FiShield size={16} />
              {submitting ? 'Encrypting...' : 'Import & Login'}
            </button>
          </form>
        )}

        {/* New Wallet Mode */}
        {mode === 'create' && (
          <form onSubmit={handleCreateWallet} className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-2">
              <FiShield size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-400/80">
                A new wallet will be generated entirely in your browser. 
                Your private key never leaves this device. You'll be shown a backup screen next.
              </p>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Choose Password</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full pl-10 pr-10 py-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-100 focus:border-purple-500 focus:outline-none"
                  data-testid="create-password-input"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPw ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Confirm Password</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full pl-10 pr-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-gray-100 focus:border-purple-500 focus:outline-none"
                  data-testid="create-confirm-password-input"
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-400 text-center" data-testid="auth-error">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              data-testid="auth-submit-btn"
            >
              <FiPlus size={16} />
              {submitting ? 'Generating...' : 'Generate New Wallet'}
            </button>
          </form>
        )}

        {/* Browse as guest */}
        <button
          onClick={() => navigate('/feed')}
          className="w-full mt-6 flex items-center justify-center gap-2 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          data-testid="browse-guest-btn"
        >
          Browse as guest (read-only) <FiArrowRight size={14} />
        </button>
        <p className="text-center text-[9px] text-gray-700 mt-4 select-all" data-testid="build-version">v2026.03.29</p>
      </div>
    </div>
  );
}
