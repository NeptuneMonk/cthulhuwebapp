import React, { useState, useEffect, useRef } from 'react';
import { FiX, FiShield, FiEye, FiEyeOff, FiCopy, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/hooks/useAuth';
import { decryptWIF, getStoredWallet } from '@/utils/walletCrypto';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const KeyRevealModal = ({ onClose }) => {
  const { user } = useAuth();
  const [step, setStep] = useState('password'); // 'password' | '2fa' | 'revealed' | 'setup-2fa'
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [revealedWif, setRevealedWif] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [has2FA, setHas2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totpSetupUri, setTotpSetupUri] = useState(null);
  const [totpSetupSecret, setTotpSetupSecret] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const timerRef = useRef(null);

  // Check if user has 2FA enabled
  useEffect(() => {
    if (!user?.urn) return;
    fetch(`${API}/auth/2fa/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urn: user.urn }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHas2FA(data.enabled); })
      .catch(() => {});
  }, [user?.urn]);

  // Auto-hide key after countdown
  useEffect(() => {
    if (step !== 'revealed') return;
    setCountdown(30);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setRevealedWif(null);
          setShowKey(false);
          setStep('password');
          setPassword('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [step]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const stored = getStoredWallet(user.urn, user.network);
      if (!stored?.encryptedWIF) throw new Error('No wallet found on this device');
      const wif = await decryptWIF(stored.encryptedWIF, password);
      if (!wif) throw new Error('Incorrect password');

      if (has2FA) {
        setRevealedWif(wif);
        setStep('2fa');
      } else {
        setRevealedWif(wif);
        setStep('revealed');
      }
    } catch (err) {
      setError(err.message || 'Failed to decrypt wallet');
    } finally { setLoading(false); }
  };

  const handleTotpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: user.urn, code: totpCode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Invalid code');
      }
      setStep('revealed');
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const handleSetup2FA = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: user.urn }),
      });
      if (!res.ok) throw new Error('Failed to setup 2FA');
      const data = await res.json();
      setTotpSetupUri(data.uri);
      setTotpSetupSecret(data.secret);
      setStep('setup-2fa');
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const handleVerifySetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn: user.urn, code: setupCode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Invalid code');
      }
      setHas2FA(true);
      setStep('revealed');
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const copyWif = () => {
    if (!revealedWif) return;
    navigator.clipboard.writeText(revealedWif);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()} data-testid="key-reveal-modal">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <FiShield className="text-amber-400" size={16} />
            <h3 className="text-sm font-bold text-gray-100">
              {step === 'setup-2fa' ? 'Enable 2FA' : 'Private Key Access'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300" data-testid="key-reveal-close"><FiX size={16} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Step 1: Password */}
          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex gap-2">
                <FiAlertTriangle className="text-amber-400 flex-shrink-0 mt-0.5" size={14} />
                <p className="text-xs text-amber-300/80">
                  Re-enter your password to access your private key. Never share your key with anyone.
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password..."
                  autoFocus
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:border-amber-500/50 focus:outline-none"
                  data-testid="key-reveal-password"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={!password || loading}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                data-testid="key-reveal-submit"
              >
                {loading ? 'Verifying...' : has2FA ? 'Next — Enter 2FA Code' : 'Reveal Key'}
              </button>
              {!has2FA && user?.is_minted && (
                <button
                  type="button"
                  onClick={handleSetup2FA}
                  className="w-full py-2 text-xs text-teal-400 hover:text-teal-300 transition-colors"
                  data-testid="setup-2fa-btn"
                >
                  Enable 2FA for extra security
                </button>
              )}
            </form>
          )}

          {/* Step 2: 2FA Code */}
          {step === '2fa' && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              <p className="text-xs text-gray-400">Enter the 6-digit code from your authenticator app.</p>
              <input
                type="text"
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-lg text-center text-lg font-mono text-gray-100 tracking-[0.5em] focus:border-teal-500 focus:outline-none"
                data-testid="key-reveal-2fa-code"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={totpCode.length < 6 || loading}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                data-testid="key-reveal-2fa-submit"
              >
                {loading ? 'Verifying...' : 'Verify & Reveal Key'}
              </button>
            </form>
          )}

          {/* 2FA Setup */}
          {step === 'setup-2fa' && (
            <form onSubmit={handleVerifySetup} className="space-y-4">
              <p className="text-xs text-gray-400">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
              <div className="flex justify-center bg-white rounded-lg p-3">
                {totpSetupUri && <QRCodeSVG value={totpSetupUri} size={160} />}
              </div>
              {totpSetupSecret && (
                <div className="bg-gray-800 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-500 mb-1">Manual key:</p>
                  <code className="text-xs text-gray-300 font-mono break-all select-all">{totpSetupSecret}</code>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Enter code to confirm:</label>
                <input
                  type="text"
                  value={setupCode}
                  onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                  className="w-full px-3 py-3 bg-gray-800 border border-gray-700 rounded-lg text-center text-lg font-mono text-gray-100 tracking-[0.5em] focus:border-teal-500 focus:outline-none"
                  data-testid="setup-2fa-code"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={setupCode.length < 6 || loading}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                data-testid="setup-2fa-verify"
              >
                {loading ? 'Verifying...' : 'Activate 2FA & Reveal Key'}
              </button>
            </form>
          )}

          {/* Revealed Key */}
          {step === 'revealed' && revealedWif && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <FiAlertTriangle size={12} /> Auto-hides in {countdown}s
                </span>
                <button
                  onClick={() => setShowKey(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  data-testid="key-reveal-toggle-visibility"
                >
                  {showKey ? <><FiEyeOff size={12} /> Hide</> : <><FiEye size={12} /> Show</>}
                </button>
              </div>
              <div className="bg-gray-950 border border-amber-500/20 rounded-lg p-3">
                <label className="text-[10px] text-amber-400 block mb-1">Private Key (WIF)</label>
                <code className={`text-sm font-mono break-all select-all ${showKey ? 'text-gray-200' : 'text-gray-200 blur-sm hover:blur-none'}`} data-testid="key-reveal-wif">
                  {showKey ? revealedWif : '••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                </code>
              </div>
              <button
                onClick={copyWif}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
                data-testid="key-reveal-copy"
              >
                {copied ? <><FiCheck size={14} className="text-green-400" /> Copied!</> : <><FiCopy size={14} /> Copy Key</>}
              </button>
              <p className="text-[10px] text-gray-600 text-center">This key will not be shown again without re-authentication.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
