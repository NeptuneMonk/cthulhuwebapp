import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSettings, FiAlertCircle, FiMessageSquare, FiBarChart2, FiLogOut, FiLock, FiSave, FiRefreshCw, FiChevronDown, FiChevronUp, FiSend, FiTrash2, FiKey, FiActivity, FiFilm, FiCpu, FiDatabase, FiGlobe, FiMusic, FiPhone, FiZap, FiDollarSign, FiFile, FiEdit, FiCheck, FiX, FiCopy, FiUpload, FiPlus, FiExternalLink, FiLoader, FiBriefcase, FiPackage } from 'react-icons/fi';
import { getCallLogs, clearCallLogs, exportCallLogs } from '@/utils/callDebugLog';
import AdminWalletPanel from '@/components/admin/AdminWalletPanel';
import CheckpointPanel from '@/components/admin/CheckpointPanel';
import ReleasePanel from '@/components/admin/ReleasePanel';

const API = process.env.REACT_APP_BACKEND_URL + '/api/admin';
const ROOT_API = process.env.REACT_APP_BACKEND_URL + '/api';

// ─── Auth helpers ───
function getToken() { return localStorage.getItem('cthulhu_admin_token'); }
function setToken(t) { localStorage.setItem('cthulhu_admin_token', t); }
function clearToken() { localStorage.removeItem('cthulhu_admin_token'); }

async function adminFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  return res;
}

async function safeJson(res) {
  try { const t = await res.text(); return JSON.parse(t); }
  catch { return { detail: `HTTP ${res.status}` }; }
}

// ─── Login Screen ───
function AdminLogin({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showLoginPw, setShowLoginPw] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await safeJson(res);
      if (res.ok && data.token) {
        setToken(data.token);
        onLogin(data);
      } else {
        setError(data.detail || 'Login failed');
      }
    } catch {
      setError('Connection error');
    }
    setLoading(false);
  };

  if (showRecovery) {
    return <WIFRecoveryFlow onBack={() => setShowRecovery(false)} onRecovered={() => setShowRecovery(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-900/80 border border-gray-800 rounded-2xl p-8 space-y-5" data-testid="admin-login-form">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-red-600/20 flex items-center justify-center">
            <FiLock size={24} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Console</h1>
          <p className="text-xs text-gray-500 mt-1">Cthulhu Platform Administration</p>
        </div>
        {error && <p className="text-xs text-red-400 text-center bg-red-900/20 rounded-lg p-2">{error}</p>}
        <input
          type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)}
          className="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-red-500 focus:outline-none"
          data-testid="admin-username"
        />
        <div className="relative">
          <input
            type={showLoginPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 pr-10 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-red-500 focus:outline-none"
            data-testid="admin-password"
          />
          <button type="button" onClick={() => setShowLoginPw(!showLoginPw)} tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showLoginPw
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
        <button
          type="submit" disabled={loading || !username || !password}
          className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          data-testid="admin-login-btn"
        >
          {loading ? 'Authenticating...' : 'Login'}
        </button>
        <button
          type="button" onClick={() => setShowRecovery(true)}
          className="w-full text-center text-xs text-gray-600 hover:text-amber-400 transition-colors"
          data-testid="recovery-link"
        >
          Forgot credentials? Recover with WIF
        </button>
      </form>
    </div>
  );
}


// ─── WIF Recovery Flow ───
function WIFRecoveryFlow({ onBack, onRecovered }) {
  const [step, setStep] = useState('start'); // start | verify | success
  const [challenge, setChallenge] = useState('');
  const [maskedAddr, setMaskedAddr] = useState('');
  const [wif, setWif] = useState('');
  const [newUser, setNewUser] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordsMatch = newPw && confirmPw && newPw === confirmPw;
  const passwordsMismatch = newPw && confirmPw && newPw !== confirmPw;

  const getChallenge = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/recovery-challenge`);
      if (res.status === 404) {
        setError('No recovery address has been configured. The admin must first set one up from the Credentials panel inside the dashboard.');
        setLoading(false);
        return;
      }
      const data = await safeJson(res);
      if (res.ok) {
        setChallenge(data.challenge);
        setMaskedAddr(data.masked_address);
        setStep('verify');
      } else {
        setError(data.detail || 'Recovery not available');
      }
    } catch { setError('Connection error'); }
    setLoading(false);
  };

  const recover = async () => {
    if (!wif || !newUser || !passwordsMatch) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/recover-with-wif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wif, challenge, signature: '', new_username: newUser, new_password: newPw,
        }),
      });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (res.ok && data.success) {
        setStep('success');
      } else if (res.status === 403) {
        setError(data.detail || 'WIF does not match the recovery address. Make sure you set a public ADDRESS (not a WIF key) as the recovery address.');
      } else if (res.status === 400) {
        setError(data.detail || 'Invalid request — check your WIF key format.');
      } else {
        setError(data.detail || `Recovery failed (HTTP ${res.status})`);
      }
    } catch { setError('Connection error'); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900/80 border border-gray-800 rounded-2xl p-8 space-y-5" data-testid="wif-recovery-form">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-amber-600/20 flex items-center justify-center">
            <FiKey size={24} className="text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Recover Access</h1>
          <p className="text-xs text-gray-500 mt-1">Prove wallet ownership to reset credentials</p>
        </div>

        {error && <p className="text-xs text-red-400 text-center bg-red-900/20 rounded-lg p-2" data-testid="recovery-error">{error}</p>}

        {step === 'start' && (
          <>
            <p className="text-xs text-gray-400 text-center">
              This will verify you own the recovery wallet address configured by the admin.
            </p>
            <button onClick={getChallenge} disabled={loading}
              className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              data-testid="recovery-start-btn">
              {loading ? 'Loading...' : 'Start Recovery'}
            </button>
            <button onClick={onBack} className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Back to Login
            </button>
          </>
        )}

        {step === 'verify' && (
          <>
            <div className="bg-gray-950 rounded-lg p-3 space-y-1">
              <p className="text-[10px] text-gray-500">Recovery address</p>
              <p className="text-xs text-amber-400 font-mono" data-testid="recovery-masked-addr">{maskedAddr}</p>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Enter WIF Private Key</label>
              <div className="relative">
                <input
                  type={showWif ? 'text' : 'password'} value={wif} onChange={e => setWif(e.target.value)}
                  placeholder="5J... or cN..."
                  className="w-full px-3 py-2 pr-10 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                  data-testid="recovery-wif"
                />
                <button type="button" onClick={() => setShowWif(!showWif)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showWif
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">New Username</label>
              <input type="text" value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="Admin"
                className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
                data-testid="recovery-new-username" />
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                  className="w-full px-3 py-2 pr-10 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
                  data-testid="recovery-new-password" />
                <button type="button" onClick={() => setShowNewPw(!showNewPw)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showNewPw
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Confirm Password</label>
              <input
                type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                className={`w-full px-3 py-2 bg-gray-950 border rounded-lg text-sm text-white focus:outline-none ${
                  passwordsMatch ? 'border-emerald-600' : passwordsMismatch ? 'border-red-600' : 'border-gray-700'
                }`}
                data-testid="recovery-confirm-password" />
              {passwordsMatch && <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1"><FiCheck size={10} /> Passwords match</p>}
              {passwordsMismatch && <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1"><FiX size={10} /> Passwords do not match</p>}
            </div>

            <button onClick={recover} disabled={loading || !wif || !newUser || !passwordsMatch}
              className="w-full py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              data-testid="recovery-submit-btn">
              {loading ? 'Verifying...' : 'Reset Credentials'}
            </button>
            <button onClick={onBack} className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Back to Login
            </button>
          </>
        )}

        {step === 'success' && (
          <>
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-600/20 flex items-center justify-center">
                <FiCheck size={20} className="text-emerald-400" />
              </div>
              <p className="text-sm text-emerald-400 font-medium" data-testid="recovery-success">Credentials Reset Successfully</p>
              <p className="text-xs text-gray-500">You can now login with your new credentials.</p>
            </div>
            <button onClick={onRecovered}
              className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
              data-testid="recovery-go-login">
              Go to Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings Panel ───
function SettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch('/settings');
    if (res.ok) setSettings(await safeJson(res));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await adminFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        faucet_amount: settings.faucet_amount,
        tax_rate: settings.tax_rate,
        faucet_amount_mainnet: settings.faucet_amount_mainnet || 0,
        tax_rate_mainnet: settings.tax_rate_mainnet ?? 0.02,
        treasury_btc: settings.treasury_addresses?.btc || '',
        treasury_btc_testnet: settings.treasury_addresses?.btc_testnet || '',
        admin_pkx: settings.admin_pkx || '',
        admin_pky: settings.admin_pky || '',
        supflix_keywords: settings.supflix_keywords || ['movie'],
        jukebox_keywords: settings.jukebox_keywords || ['music'],
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) return <div className="text-gray-500 text-sm">Loading settings...</div>;

  const Field = ({ label, value, onChange, type = 'text', suffix }) => (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type={type} value={value} onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
          className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-red-500 focus:outline-none"
        />
        {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiActivity size={14} /> BTC Testnet Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Faucet Amount (sats)" value={settings.faucet_amount} onChange={v => setSettings(s => ({ ...s, faucet_amount: v }))} type="number" suffix="sats" />
          <Field label="Tax Rate" value={settings.tax_rate} onChange={v => setSettings(s => ({ ...s, tax_rate: v }))} type="number" suffix="(0.02 = 2%)" />
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiActivity size={14} /> BTC Mainnet Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Faucet Amount (sats)" value={settings.faucet_amount_mainnet || 0} onChange={v => setSettings(s => ({ ...s, faucet_amount_mainnet: v }))} type="number" suffix="sats (0 = disabled)" />
          <Field label="Tax Rate" value={settings.tax_rate_mainnet ?? 0.02} onChange={v => setSettings(s => ({ ...s, tax_rate_mainnet: v }))} type="number" suffix="(0.02 = 2%)" />
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiKey size={14} /> Treasury Addresses</h3>
        <p className="text-[11px] text-gray-500">Public receiving addresses. Auto-detected from imported treasury keys in the Wallet panel.</p>
        <div className="space-y-3">
          <Field label="BTC Mainnet Treasury" value={settings.treasury_addresses?.btc || ''} onChange={v => setSettings(s => ({ ...s, treasury_addresses: { ...s.treasury_addresses, btc: v } }))} />
          <Field label="BTC Testnet Treasury" value={settings.treasury_addresses?.btc_testnet || ''} onChange={v => setSettings(s => ({ ...s, treasury_addresses: { ...s.treasury_addresses, btc_testnet: v } }))} />
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiLock size={14} /> Admin Encryption Keys (Public)</h3>
        <p className="text-[11px] text-gray-500">These are displayed to users so they can encrypt bug reports to you.</p>
        <div className="space-y-3">
          <Field label="Admin PKX" value={settings.admin_pkx || ''} onChange={v => setSettings(s => ({ ...s, admin_pkx: v }))} />
          <Field label="Admin PKY" value={settings.admin_pky || ''} onChange={v => setSettings(s => ({ ...s, admin_pky: v }))} />
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiFilm size={14} /> SUPflix Featured Keywords</h3>
        <p className="text-[11px] text-gray-500">Keywords used to find featured media on the SUPflix page. One per line. Default: &ldquo;movie&rdquo;.</p>
        <textarea
          value={(settings.supflix_keywords || ['movie']).join('\n')}
          onChange={e => setSettings(s => ({ ...s, supflix_keywords: e.target.value.split('\n').map(k => k.trim()).filter(Boolean) }))}
          className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-red-500 focus:outline-none resize-none h-24 font-mono"
          placeholder="movie&#10;anime&#10;documentary"
          data-testid="admin-supflix-keywords"
        />
        <div className="flex flex-wrap gap-1.5">
          {(settings.supflix_keywords || ['movie']).map((kw, i) => (
            <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-red-900/20 text-red-400 border border-red-800/20">{kw}</span>
          ))}
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiMusic size={14} /> Jukebox Featured Keywords</h3>
        <p className="text-[11px] text-gray-500">Keywords used to find featured audio on the Jukebox page. One per line. Default: &ldquo;music&rdquo;.</p>
        <textarea
          value={(settings.jukebox_keywords || ['music']).join('\n')}
          onChange={e => setSettings(s => ({ ...s, jukebox_keywords: e.target.value.split('\n').map(k => k.trim()).filter(Boolean) }))}
          className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-purple-500 focus:outline-none resize-none h-24 font-mono"
          placeholder="music&#10;podcast&#10;audio"
          data-testid="admin-jukebox-keywords"
        />
        <div className="flex flex-wrap gap-1.5">
          {(settings.jukebox_keywords || ['music']).map((kw, i) => (
            <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-purple-900/20 text-purple-400 border border-purple-800/20">{kw}</span>
          ))}
        </div>
      </div>

      <button
        onClick={save} disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        data-testid="admin-save-settings"
      >
        <FiSave size={14} /> {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}

// ─── Reports Panel ───
function ReportsPanel() {
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [response, setResponse] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const params = filter === 'all' ? '' : `?status=${filter}`;
    const res = await adminFetch(`/reports${params}`);
    if (res.ok) {
      const d = await safeJson(res);
      setReports(d.reports);
      setTotal(d.total);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const respond = async (id) => {
    if (!response.trim()) return;
    setSending(true);
    await adminFetch(`/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ response: response.trim(), status: 'responded' }),
    });
    setResponse('');
    setSending(false);
    setExpanded(null);
    load();
  };

  const statusColor = (s) => {
    if (s === 'open') return 'text-yellow-400 bg-yellow-900/30';
    if (s === 'responded') return 'text-green-400 bg-green-900/30';
    return 'text-gray-400 bg-gray-800';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-gray-400">Total: {total}</span>
        {['all', 'open', 'responded'].map(f => (
          <button
            key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button onClick={load} className="ml-auto p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400"><FiRefreshCw size={14} /></button>
      </div>

      {reports.length === 0 ? (
        <div className="text-center text-gray-600 py-12 text-sm">No reports found.</div>
      ) : (
        <div className="space-y-2">
          {reports.map(r => (
            <div key={r._id} className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === r._id ? null : r._id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-800/30 transition-colors"
              >
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${statusColor(r.status)}`}>{r.status}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{r.subject}</p>
                  <p className="text-[11px] text-gray-500">{r.user_urn || r.user_address?.slice(0, 12) || 'Anonymous'} &middot; {new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                {expanded === r._id ? <FiChevronUp size={14} className="text-gray-500" /> : <FiChevronDown size={14} className="text-gray-500" />}
              </button>
              {expanded === r._id && (
                <div className="px-4 pb-4 border-t border-gray-800/50 pt-3 space-y-3">
                  <div>
                    <p className="text-[11px] text-gray-500 mb-1">User Address</p>
                    <p className="text-xs text-gray-300 font-mono break-all">{r.user_address || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500 mb-1">Message</p>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap bg-gray-950/50 rounded-lg p-3">{r.message}</p>
                  </div>
                  {r.admin_response && (
                    <div>
                      <p className="text-[11px] text-green-500 mb-1">Admin Response</p>
                      <p className="text-sm text-green-200 bg-green-900/20 rounded-lg p-3">{r.admin_response}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={response} onChange={e => setResponse(e.target.value)} placeholder="Type response..."
                      className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-red-500 focus:outline-none"
                    />
                    <button
                      onClick={() => respond(r._id)} disabled={sending || !response.trim()}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <FiSend size={12} /> Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Error Logs Panel ───
function ErrorLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const res = await adminFetch('/errors');
    if (res.ok) {
      const d = await safeJson(res);
      setLogs(d.logs);
      setTotal(d.total);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    await adminFetch('/errors', { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">{total} errors logged</span>
        <button onClick={load} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400"><FiRefreshCw size={14} /></button>
        {total > 0 && (
          <button onClick={clearAll} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 text-red-400 text-xs hover:bg-red-900/60">
            <FiTrash2 size={12} /> Clear All
          </button>
        )}
      </div>
      {logs.length === 0 ? (
        <div className="text-center text-gray-600 py-12 text-sm">No errors logged. System healthy.</div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {logs.map((log, i) => (
            <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase text-red-400 bg-red-900/30">{log.level || 'ERROR'}</span>
                <span className="text-[11px] text-gray-500">{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Unknown'}</span>
                <span className="text-[11px] text-gray-600 ml-auto">{log.source || ''}</span>
              </div>
              <p className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all">{log.message || JSON.stringify(log)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Change Password Panel ───
function ChangePasswordPanel() {
  const [current, setCurrent] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [newUser, setNewUser] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const passwordsMatch = newPw && confirmPw && newPw === confirmPw;
  const passwordsMismatch = newPw && confirmPw && newPw !== confirmPw;
  const canSave = current && newPw && confirmPw && passwordsMatch && !saving;

  const save = async () => {
    setMsg({ type: '', text: '' });
    if (!canSave) return;
    setSaving(true);
    const res = await adminFetch('/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: current, new_password: newPw, new_username: newUser || null }),
    });
    const data = await safeJson(res);
    if (res.ok) {
      setMsg({ type: 'success', text: 'Credentials updated. Please re-login.' });
      setCurrent(''); setNewPw(''); setConfirmPw(''); setNewUser('');
      setTimeout(() => { clearToken(); window.location.reload(); }, 1500);
    } else {
      setMsg({ type: 'error', text: data.detail || 'Failed' });
    }
    setSaving(false);
  };

  const ToggleEye = ({ show, onToggle, testId }) => (
    <button type="button" onClick={onToggle} tabIndex={-1}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
      data-testid={testId}>
      {show
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      }
    </button>
  );

  return (
    <div className="max-w-md space-y-4" data-testid="change-password-panel">
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiLock size={14} /> Change Credentials</h3>
        {msg.text && (
          <p data-testid="credential-msg" className={`text-xs p-2 rounded-lg ${msg.type === 'error' ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/20'}`}>{msg.text}</p>
        )}

        {/* Current Password */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={current} onChange={e => setCurrent(e.target.value)}
              className="w-full px-3 py-2 pr-10 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white focus:border-red-500 focus:outline-none"
              data-testid="cred-current-password"
            />
            <ToggleEye show={showCurrent} onToggle={() => setShowCurrent(!showCurrent)} testId="toggle-current-pw" />
          </div>
        </div>

        {/* New Username */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">New Username <span className="text-gray-600">(optional)</span></label>
          <input
            type="text" value={newUser} onChange={e => setNewUser(e.target.value)}
            placeholder="Leave empty to keep current"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-red-500 focus:outline-none"
            data-testid="cred-new-username"
          />
        </div>

        {/* New Password */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPw} onChange={e => setNewPw(e.target.value)}
              className={`w-full px-3 py-2 pr-10 bg-gray-950 border rounded-lg text-sm text-white focus:outline-none ${
                newPw && newPw.length < 6 ? 'border-yellow-600 focus:border-yellow-500' : 'border-gray-700 focus:border-red-500'
              }`}
              data-testid="cred-new-password"
            />
            <ToggleEye show={showNew} onToggle={() => setShowNew(!showNew)} testId="toggle-new-pw" />
          </div>
          {newPw && newPw.length < 6 && (
            <p className="text-[10px] text-yellow-500 mt-1">Password should be at least 6 characters</p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Confirm New Password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className={`w-full px-3 py-2 pr-10 bg-gray-950 border rounded-lg text-sm text-white focus:outline-none ${
                passwordsMatch ? 'border-emerald-600 focus:border-emerald-500'
                  : passwordsMismatch ? 'border-red-600 focus:border-red-500'
                  : 'border-gray-700 focus:border-red-500'
              }`}
              data-testid="cred-confirm-password"
            />
            <ToggleEye show={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} testId="toggle-confirm-pw" />
          </div>
          {/* Match indicator */}
          {passwordsMatch && (
            <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1" data-testid="passwords-match">
              <FiCheck size={10} /> Passwords match
            </p>
          )}
          {passwordsMismatch && (
            <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1" data-testid="passwords-mismatch">
              <FiX size={10} /> Passwords do not match
            </p>
          )}
        </div>

        <button
          onClick={save} disabled={!canSave}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40 transition-opacity"
          data-testid="cred-save-btn"
        >
          <FiSave size={14} /> {saving ? 'Saving...' : 'Update Credentials'}
        </button>
      </div>

      {/* Recovery Address */}
      <RecoveryAddressSection />
    </div>
  );
}


// ─── Recovery Address Section ───
function RecoveryAddressSection() {
  const [recoveryAddr, setRecoveryAddr] = useState('');
  const [inputAddr, setInputAddr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await adminFetch('/recovery-address');
      if (res.ok) {
        const data = await safeJson(res);
        setRecoveryAddr(data.recovery_address || '');
        setInputAddr(data.recovery_address || '');
      }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    if (!inputAddr) return;
    setSaving(true); setMsg('');
    const res = await adminFetch('/set-recovery-address', {
      method: 'POST', body: JSON.stringify({ address: inputAddr }),
    });
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (res.ok) {
      setRecoveryAddr(inputAddr);
      setMsg('Recovery address saved');
    } else {
      setMsg(data.detail || 'Failed to save address');
    }
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 space-y-3" data-testid="recovery-address-section">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FiKey size={14} /> WIF Recovery</h3>
      <p className="text-[10px] text-gray-500">
        If you ever forget your admin credentials, you can recover access by proving you own this address's private key (WIF).
        Enter a <strong className="text-amber-400">PUBLIC ADDRESS</strong> from your admin wallet (not the WIF key itself).
      </p>
      <p className="text-[10px] text-gray-600">
        Testnet addresses start with <span className="text-amber-400/70 font-mono">m</span> or <span className="text-amber-400/70 font-mono">n</span>.
        Mainnet addresses start with <span className="text-amber-400/70 font-mono">1</span>, <span className="text-amber-400/70 font-mono">3</span>, or <span className="text-amber-400/70 font-mono">bc1</span>.
      </p>
      {recoveryAddr && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/15 border border-emerald-800/30 rounded-lg">
          <FiCheck size={12} className="text-emerald-400" />
          <span className="text-xs text-emerald-400 font-mono">{recoveryAddr}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={inputAddr} onChange={e => setInputAddr(e.target.value)}
          placeholder="e.g. mXyz... or 1Abc... (public address)"
          className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none"
          data-testid="recovery-address-input"
        />
        <button onClick={save} disabled={saving || !inputAddr || inputAddr === recoveryAddr}
          className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 transition-opacity"
          data-testid="recovery-address-save">
          {saving ? '...' : recoveryAddr ? 'Update' : 'Set'}
        </button>
      </div>
      {msg && <p className={`text-[10px] ${msg.includes('Failed') || msg.includes('private key') || msg.includes('WIF') ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</p>}
    </div>
  );
}

// ─── Stats Overview ───
function StatsOverview() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    adminFetch('/stats').then(r => r.ok ? r.json() : null).then(d => d && setStats(d));
  }, []);
  if (!stats) return null;

  const cards = [
    { label: 'Registered Users', value: stats.users, color: 'text-blue-400', bg: 'bg-blue-900/20' },
    { label: 'Open Reports', value: stats.open_reports, color: 'text-yellow-400', bg: 'bg-yellow-900/20' },
    { label: 'Total Reports', value: stats.total_reports, color: 'text-purple-400', bg: 'bg-purple-900/20' },
    { label: 'Error Logs', value: stats.error_count, color: 'text-red-400', bg: 'bg-red-900/20' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className={`${c.bg} border border-gray-800 rounded-xl p-4`}>
          <p className="text-[11px] text-gray-500 mb-1">{c.label}</p>
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── System Stats Panel ───
function SystemStatsPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/system-stats');
      if (res.ok) {
        setStats(await safeJson(res));
      } else {
        setError('Failed to load stats');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleReset = async () => {
    await adminFetch('/reset-stats', { method: 'POST' });
    fetchStats();
  };

  if (loading) return <div className="text-gray-500 text-sm animate-pulse">Loading system stats...</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!stats) return null;

  const { tracker, mongodb, system } = stats;

  return (
    <div className="space-y-6" data-testid="system-stats-panel">
      {/* System Resources */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2"><FiCpu size={14} className="text-cyan-400" /> System Resources</h3>
          <button onClick={fetchStats} className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1" data-testid="stats-refresh">
            <FiRefreshCw size={10} /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="CPU" value={`${system.cpu_percent}%`} color="text-cyan-400" bg="bg-cyan-900/20" />
          <StatCard label="RAM Used" value={`${system.memory_used_mb}MB`} sub={`${system.memory_percent}% of ${system.memory_total_mb}MB`} color="text-blue-400" bg="bg-blue-900/20" />
          <StatCard label="Process RAM" value={`${system.process_memory_mb}MB`} sub="Backend process" color="text-purple-400" bg="bg-purple-900/20" />
          <StatCard label="Disk" value={`${system.disk_used_gb}GB`} sub={`${system.disk_percent}% of ${system.disk_total_gb}GB`} color="text-amber-400" bg="bg-amber-900/20" />
        </div>
      </div>

      {/* External API Calls */}
      <div>
        <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-3">
          <FiGlobe size={14} className="text-red-400" /> External API Calls
          <span className="text-[10px] text-gray-600 font-normal ml-2">Since server start ({tracker.uptime_human})</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <StatCard label="Total API Calls" value={tracker.total_external_api_calls} color="text-red-400" bg="bg-red-900/20" />
          <StatCard label="Cache Hit Rate" value={`${tracker.cache_hit_rate}%`} sub={`${tracker.cache_hits} hits / ${tracker.cache_misses} misses`} color="text-green-400" bg="bg-green-900/20" />
          <StatCard label="Total Route Hits" value={tracker.total_route_hits} color="text-gray-300" bg="bg-gray-800/50" />
        </div>

        {Object.keys(tracker.external_apis).length > 0 ? (
          <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/50">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Domain</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Calls</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg (ms)</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Calls/min</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Top Endpoints</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(tracker.external_apis).sort((a, b) => b[1].total_calls - a[1].total_calls).map(([domain, data]) => (
                  <tr key={domain} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                    <td className="py-2 px-3 text-gray-200 font-mono">{domain}</td>
                    <td className="py-2 px-3 text-right text-red-400 font-bold">{data.total_calls}</td>
                    <td className="py-2 px-3 text-right text-gray-400">{data.avg_response_ms}</td>
                    <td className="py-2 px-3 text-right text-gray-400">{data.calls_per_minute}</td>
                    <td className="py-2 px-3 text-gray-500">
                      {Object.entries(data.endpoints || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([ep, cnt]) => (
                        <span key={ep} className="inline-block mr-2">
                          <span className="text-gray-400">{ep}</span>
                          <span className="text-gray-600 ml-0.5">({cnt})</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-600 italic p-3 bg-gray-900/40 rounded-lg">No external API calls recorded yet. Stats begin tracking from server start.</div>
        )}
      </div>

      {/* Top Routes */}
      {tracker.top_routes?.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-3"><FiActivity size={14} className="text-orange-400" /> Top Routes by Hit Count</h3>
          <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/50">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Route</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Hits</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {tracker.top_routes.slice(0, 15).map(r => (
                  <tr key={r.route} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                    <td className="py-1.5 px-3 text-gray-300 font-mono">{r.route}</td>
                    <td className="py-1.5 px-3 text-right text-orange-400">{r.hits}</td>
                    <td className="py-1.5 px-3 text-right text-gray-500">{tracker.total_route_hits > 0 ? ((r.hits / tracker.total_route_hits) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MongoDB Collections */}
      <div>
        <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2 mb-3">
          <FiDatabase size={14} className="text-green-400" /> MongoDB Cache
          <span className="text-[10px] text-gray-600 font-normal ml-2">Total: {mongodb.total_data_size_mb}MB across {mongodb.total_documents} docs</span>
        </h3>
        <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/50">
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Collection</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Documents</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Data Size</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Storage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(mongodb.collections || {}).sort((a, b) => b[1].data_size_mb - a[1].data_size_mb).map(([name, col]) => (
                <tr key={name} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                  <td className="py-1.5 px-3 text-gray-300 font-mono">{name}</td>
                  <td className="py-1.5 px-3 text-right text-green-400">{col.documents.toLocaleString()}</td>
                  <td className="py-1.5 px-3 text-right text-gray-400">{col.data_size_mb}MB</td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{col.storage_size_mb}MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={handleReset} className="text-xs text-gray-500 hover:text-red-400 border border-gray-800 rounded-lg px-3 py-2 transition-colors" data-testid="stats-reset">
          Reset API Counters
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color = 'text-gray-200', bg = 'bg-gray-800/50' }) {
  return (
    <div className={`${bg} border border-gray-800 rounded-xl p-3`}>
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[9px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Etch Manager Panel ───
function EtchManagerPanel({ adminNetwork = 'btc-testnet' }) {
  const fileInputRef = useRef(null);
  // ── State: Creation ──
  const [mode, setMode] = useState('list');
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [urn, setUrn] = useState('');
  const [keywords, setKeywords] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastProgress, setBroadcastProgress] = useState(null);
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [createError, setCreateError] = useState(null);

  // ── State: List ──
  const [manifests, setManifests] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editVersion, setEditVersion] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [network, setNetwork] = useState(adminNetwork);

  // Sync with admin network toggle
  useEffect(() => { setNetwork(adminNetwork); }, [adminNetwork]);

  const ROOT_API = process.env.REACT_APP_BACKEND_URL + '/api';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/../../api/etch/admin/list?network=${network}`);
      if (res.ok) { const d = await safeJson(res); setManifests(d.manifests || []); setStats(d.stats || null); }
    } catch {}
    setLoading(false);
  }, [network]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this manifest and all its chunks?')) return;
    const res = await adminFetch(`/../../api/etch/admin/manifest/${id}`, { method: 'DELETE' });
    if (res.ok) load();
  };

  const handleUpdate = async (id) => {
    const body = {};
    if (editVersion.trim()) body.version = editVersion.trim();
    if (editDesc.trim()) body.description = editDesc.trim();
    if (!Object.keys(body).length) return;
    await adminFetch(`/../../api/etch/admin/manifest/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    setEditing(null);
    load();
  };

  const fmt = (b) => { if (!b) return '0 B'; const k = 1024; const s = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(k)); return (b/Math.pow(k,i)).toFixed(1)+' '+s[i]; };

  const extColor = (name) => {
    const e = name.split('.').pop()?.toLowerCase();
    if (['html','htm'].includes(e)) return 'text-orange-400';
    if (['css','scss'].includes(e)) return 'text-blue-400';
    if (['js','jsx','ts','tsx'].includes(e)) return 'text-yellow-400';
    if (['png','jpg','jpeg','gif','svg','webp'].includes(e)) return 'text-green-400';
    if (['json','xml'].includes(e)) return 'text-purple-400';
    return 'text-gray-400';
  };

  // ── File handling ──
  const addFiles = async (fileList) => {
    const nf = [];
    for (const file of fileList) {
      const buf = await file.arrayBuffer();
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
      nf.push({ file, name: file.name, hex, size: file.size });
    }
    setFiles(prev => [...prev, ...nf]);
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_,i) => i !== idx));
  const totalSize = files.reduce((s,f) => s + f.size, 0);

  const estimateCost = () => {
    if (!files.length) return { addresses: 0, sats: 0, txs: 0 };
    let a = 0, t = 0;
    for (const f of files) { const addrs = Math.ceil((f.size + 100) / 20) + 1; a += addrs; t++; }
    return { addresses: a, sats: a * 546 + t * 5000, txs: t };
  };
  const cost = estimateCost();

  // ── Broadcast (OBJ format for bitfossil compatibility) ──
  const handleBroadcast = async () => {
    if (!files.length || !projectName.trim() || !urn.trim()) return;
    setBroadcasting(true); setCreateError(null); setBroadcastResult(null);
    setBroadcastProgress({ current: 0, total: 1, currentFile: 'Uploading to IPFS & creating OBJ...' });
    try {
      const kwArray = keywords.split(',').map(k => k.trim()).filter(Boolean);
      const res = await fetch(`${ROOT_API}/etch/broadcast-obj-etch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_name: projectName.trim(),
          urn: urn.trim(),
          name: projectName.trim(),
          description: description.trim(),
          keywords: kwArray,
          network,
          files_hex: files.map(f => ({ filename: f.name, hex: f.hex })),
        }),
      });
      const data = await safeJson(res);
      if (res.ok) { setBroadcastResult(data); setBroadcastProgress(null); load(); }
      else setCreateError(data.detail || 'Broadcast failed');
    } catch (err) { setCreateError(err.message); }
    finally { setBroadcasting(false); }
  };

  const resetCreate = () => { setFiles([]); setProjectName(''); setUrn(''); setVersion('1.0.0'); setDescription(''); setKeywords(''); setBroadcastResult(null); setBroadcastProgress(null); setCreateError(null); setMode('list'); };

  return (
    <div className="space-y-5" data-testid="etch-manager-panel">
      {/* Header */}
      <div className="flex items-center gap-3">
        {['btc-testnet','btc-mainnet'].map(n => (
          <button key={n} onClick={() => setNetwork(n)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${network === n ? 'bg-amber-600/20 text-amber-400 border border-amber-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`}>{n}</button>
        ))}
        <div className="ml-auto flex gap-2">
          {mode === 'list' ? (
            <button onClick={() => setMode('create')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 border border-amber-700/40 text-xs font-medium hover:bg-amber-600/30" data-testid="etch-new-btn">
              <FiPlus size={12} /> New Etch
            </button>
          ) : (
            <button onClick={resetCreate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs font-medium hover:bg-gray-700">
              <FiX size={12} /> Cancel
            </button>
          )}
          <button onClick={load} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400" data-testid="etch-refresh"><FiRefreshCw size={14} /></button>
        </div>
      </div>

      {/* ═══ CREATE MODE ═══ */}
      {mode === 'create' && !broadcastResult && (
        <div className="space-y-4">
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">OBJ Etch — BitFossil Compatible</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Project Name *</label>
                <input value={projectName} onChange={e => { setProjectName(e.target.value); if (!urn) setUrn(e.target.value.toLowerCase().replace(/\s+/g, '-')); }} placeholder="e.g. Cthulhu Breakout" data-testid="etch-project-name"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">URN (unique ID) *</label>
                <input value={urn} onChange={e => setUrn(e.target.value)} placeholder="e.g. cthulhu-breakout" data-testid="etch-urn"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this etch?" data-testid="etch-description"
                className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Keywords (comma-separated, for discovery)</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="game, breakout, html5" data-testid="etch-keywords"
                className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
            </div>
            <p className="text-[10px] text-gray-600">Files are uploaded to IPFS, then a P2FK OBJ transaction is created on-chain pointing to the IPFS CID. This hybrid format is indexed by bitfossil.com.</p>
          </div>

          {/* Drop zone */}
          <div onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer?.files || [])); }} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700 hover:border-amber-600/50 rounded-xl p-8 text-center cursor-pointer transition-colors group" data-testid="etch-dropzone">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
            <FiUpload size={28} className="mx-auto text-gray-600 group-hover:text-amber-500 transition-colors mb-2" />
            <p className="text-sm text-gray-400">Drop files here or click to browse</p>
            <p className="text-[10px] text-gray-600 mt-1">HTML, CSS, JS, images — uploaded to IPFS, referenced on-chain via OBJ</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
                <span className="text-xs text-gray-400">{files.length} file{files.length !== 1 ? 's' : ''} — {fmt(totalSize)}</span>
                <button onClick={() => setFiles([])} className="text-[10px] text-red-400 hover:text-red-300">Clear all</button>
              </div>
              <div className="max-h-[240px] overflow-y-auto divide-y divide-gray-800/30">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-800/30" data-testid={`etch-file-${i}`}>
                    <FiFile size={14} className={`flex-shrink-0 ${extColor(f.name)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">{f.name}</p>
                      <p className="text-[10px] text-gray-600">{fmt(f.size)}</p>
                    </div>
                    <button onClick={() => removeFile(i)} className="p-1 text-gray-600 hover:text-red-400"><FiTrash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost estimate */}
          {files.length > 0 && (
            <div className="bg-amber-900/10 border border-amber-800/30 rounded-xl p-4">
              <h4 className="text-[10px] text-amber-500 uppercase tracking-wider mb-2">Estimated On-Chain Cost (OBJ Pointer)</h4>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-lg font-bold text-amber-400">1</p><p className="text-[10px] text-gray-500">Transaction</p></div>
                <div><p className="text-lg font-bold text-amber-400">~15</p><p className="text-[10px] text-gray-500">P2FK Outputs</p></div>
                <div><p className="text-lg font-bold text-amber-400">~{(15 * 546 / 1e8).toFixed(6)}</p><p className="text-[10px] text-gray-500">BTC Cost</p></div>
              </div>
              <p className="text-[10px] text-gray-500 mt-2 text-center">Files stored on IPFS — only OBJ metadata goes on-chain (much cheaper)</p>
            </div>
          )}

          {createError && <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-sm text-red-400" data-testid="etch-error">{createError}</div>}

          <button onClick={handleBroadcast} disabled={broadcasting || !files.length || !projectName.trim() || !urn.trim()} data-testid="etch-broadcast-btn"
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:from-amber-500 hover:to-orange-500 flex items-center justify-center gap-2">
            {broadcasting ? (<><FiRefreshCw size={14} className="animate-spin" /> {broadcastProgress?.currentFile || 'Broadcasting...'}</>) : (<><FiZap size={14} /> Etch OBJ to {network}</>)}
          </button>
          <p className="text-[10px] text-gray-600 text-center">Files uploaded to IPFS, OBJ metadata broadcast on-chain. Single transaction = bitfossil indexed.</p>
        </div>
      )}

      {/* ═══ RESULT ═══ */}
      {broadcastResult && (
        <div className="space-y-4">
          <div className="bg-emerald-900/15 border border-emerald-800/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FiCheck size={16} className="text-emerald-400" />
              <h4 className="text-sm font-bold text-emerald-400">{broadcastResult.success ? 'OBJ Etch Complete' : 'Etch Failed'}</h4>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-emerald-400">{broadcastResult.num_outputs || 0}</p>
                <p className="text-[10px] text-gray-500">P2FK Outputs</p>
              </div>
              <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold text-amber-400">{(broadcastResult.dust_cost_sats || 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-500">Sats Used</p>
              </div>
              <div className="bg-gray-900/60 rounded-lg p-2.5 text-center">
                <p className="text-xs font-bold text-gray-300 truncate">{broadcastResult.sender}</p>
                <p className="text-[10px] text-gray-500">Sender</p>
              </div>
            </div>

            {/* TxID */}
            {broadcastResult.txid && (
              <div className="p-3 bg-gray-950/60 rounded-lg border border-gray-800 mb-3">
                <p className="text-[10px] text-gray-500 mb-1">Transaction ID</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-amber-400 font-mono break-all select-all flex-1">{broadcastResult.txid}</p>
                  <button onClick={() => { navigator.clipboard.writeText(broadcastResult.txid); }} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex-shrink-0" title="Copy TxID"><FiCopy size={11} /></button>
                </div>
              </div>
            )}

            {/* Links */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {broadcastResult.bitfossil_url && (
                <a href={broadcastResult.bitfossil_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-purple-900/20 border border-purple-800/30 text-purple-400 text-xs hover:bg-purple-900/30" data-testid="etch-bitfossil-link">
                  <FiExternalLink size={12} /> View on BitFossil
                </a>
              )}
              {broadcastResult.mempool_url && (
                <a href={broadcastResult.mempool_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-900/20 border border-blue-800/30 text-blue-400 text-xs hover:bg-blue-900/30" data-testid="etch-mempool-link">
                  <FiExternalLink size={12} /> View on Mempool
                </a>
              )}
            </div>

            {/* IPFS */}
            {broadcastResult.ipfs_cid && (
              <div className="p-3 bg-gray-950/60 rounded-lg border border-gray-800 mb-3">
                <p className="text-[10px] text-gray-500 mb-1">IPFS Content</p>
                <p className="text-xs text-cyan-400 font-mono break-all select-all">{broadcastResult.ipfs_cid}</p>
                <a href={broadcastResult.ipfs_gateway} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400/60 hover:text-cyan-400 underline">Open on IPFS gateway</a>
              </div>
            )}

            {/* OBJ JSON */}
            {broadcastResult.obj_json && (
              <div className="p-3 bg-gray-950/60 rounded-lg border border-gray-800">
                <p className="text-[10px] text-gray-500 mb-1">OBJ Payload (on-chain)</p>
                <pre className="text-[10px] text-gray-400 font-mono break-all whitespace-pre-wrap">{broadcastResult.obj_json}</pre>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={resetCreate} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium hover:bg-gray-700">Etch Another</button>
            <button onClick={() => { resetCreate(); setMode('list'); }} className="flex-1 py-2 rounded-lg bg-amber-600/20 text-amber-400 text-xs font-medium hover:bg-amber-600/30">View All Etches</button>
          </div>
        </div>
      )}

      {/* ═══ LIST MODE ═══ */}
      {mode === 'list' && (
        <>
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3"><p className="text-[10px] text-gray-500">Manifests</p><p className="text-xl font-bold text-amber-400">{stats.total_manifests}</p></div>
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3"><p className="text-[10px] text-gray-500">Total Chunks</p><p className="text-xl font-bold text-amber-400">{stats.total_chunks_stored}</p></div>
              <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3"><p className="text-[10px] text-gray-500">Total Size</p><p className="text-xl font-bold text-amber-400">{fmt(stats.total_bytes_stored)}</p></div>
            </div>
          )}

          {loading ? (
            <div className="text-gray-500 text-sm animate-pulse py-8 text-center">Loading etches...</div>
          ) : manifests.length === 0 ? (
            <div className="text-center py-12">
              <FiZap size={24} className="mx-auto text-gray-700 mb-2" />
              <p className="text-sm text-gray-600">No etched files found on {network}</p>
              <button onClick={() => setMode('create')} className="mt-3 px-4 py-2 rounded-lg bg-amber-600/20 text-amber-400 text-xs font-medium hover:bg-amber-600/30"><FiPlus size={10} className="inline mr-1" /> Create your first etch</button>
            </div>
          ) : (
            <div className="space-y-3">
              {manifests.map(m => (
                <div key={m._id} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4" data-testid={`etch-manifest-${m._id}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {m.project_name && <span className="text-xs text-gray-200 font-medium">{m.project_name}</span>}
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/30 text-amber-400">v{m.version || '1.0.0'}</span>
                        {m.onchain && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-900/30 text-emerald-400">ON-CHAIN</span>}
                        <span className="text-[10px] text-gray-600">{new Date(m.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono truncate">{m.address}</p>
                      {m.description && <p className="text-xs text-gray-500 mt-1">{m.description}</p>}
                    </div>
                    <div className="flex gap-1.5 ml-3">
                      <button onClick={() => { setEditing(m._id); setEditVersion(m.version || ''); setEditDesc(m.description || ''); }} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400" title="Edit"><FiEdit size={12} /></button>
                      <button onClick={() => handleDelete(m._id)} className="p-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-400" title="Delete"><FiTrash2 size={12} /></button>
                    </div>
                  </div>

                  {editing === m._id && (
                    <div className="mt-3 p-3 bg-gray-950/60 rounded-lg space-y-2 border border-gray-800">
                      <input value={editVersion} onChange={e => setEditVersion(e.target.value)} placeholder="Version (e.g. 1.2.0)" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:border-amber-500 focus:outline-none" />
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:border-amber-500 focus:outline-none" />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(m._id)} className="px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 text-xs hover:bg-amber-600/30"><FiCheck size={10} className="inline mr-1" /> Save</button>
                        <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs hover:bg-gray-700">Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 space-y-1">
                    {(m.files || []).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <FiFile size={10} className={`flex-shrink-0 ${extColor(f.name)}`} />
                        <span className="text-gray-300 truncate">{f.name}</span>
                        <span className="text-gray-600">{f.chunks} chunk{f.chunks !== 1 ? 's' : ''}</span>
                        {f.size > 0 && <span className="text-gray-700">{fmt(f.size)}</span>}
                        {f.onchain_txid && <a href={`https://mempool.space/testnet/tx/${f.onchain_txid}`} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:text-amber-400 ml-auto flex-shrink-0" title="View TX"><FiExternalLink size={10} /></a>}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-600">
                    <span>{m.total_chunks || (m.files || []).reduce((s,f) => s + (f.chunks || 0), 0)} total chunks</span>
                    {m.total_size > 0 && <span>{fmt(m.total_size)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Treasury Economics Panel ───
function TreasuryPanel({ network: adminNetwork = 'btc-testnet' }) {
  const [economics, setEconomics] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [network, setNetwork] = useState(adminNetwork);
  const [ledgerFilter, setLedgerFilter] = useState('');
  const [showLedger, setShowLedger] = useState(false);

  // Sync with admin network toggle
  useEffect(() => { setNetwork(adminNetwork); }, [adminNetwork]);

  const loadEconomics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/../../api/treasury/economics?network=${network}`);
      if (res.ok) setEconomics(await safeJson(res));
    } catch {}
    setLoading(false);
  }, [network]);

  const loadLedger = useCallback(async () => {
    const params = new URLSearchParams({ network });
    if (ledgerFilter) params.set('entry_type', ledgerFilter);
    try {
      const res = await adminFetch(`/../../api/treasury/ledger?${params}`);
      if (res.ok) {
        const d = await safeJson(res);
        setLedger(d.entries || []);
      }
    } catch {}
  }, [network, ledgerFilter]);

  useEffect(() => { loadEconomics(); }, [loadEconomics]);
  useEffect(() => { if (showLedger) loadLedger(); }, [showLedger, loadLedger]);

  const formatSats = (sats) => {
    if (sats >= 100_000_000) return (sats / 100_000_000).toFixed(4) + ' BTC';
    if (sats >= 1_000_000) return (sats / 1_000_000).toFixed(2) + 'M sats';
    if (sats >= 1_000) return (sats / 1_000).toFixed(1) + 'K sats';
    return sats + ' sats';
  };

  const copyAddress = (addr) => {
    navigator.clipboard?.writeText(addr);
  };

  if (loading) return <div className="text-gray-500 text-sm animate-pulse py-8 text-center">Loading treasury economics...</div>;
  if (!economics) return <div className="text-red-400 text-sm py-8 text-center">Failed to load treasury data</div>;

  return (
    <div className="space-y-6" data-testid="treasury-panel">
      {/* Network selector */}
      <div className="flex items-center gap-3">
        {['btc-testnet', 'btc-mainnet'].map(n => (
          <button key={n} onClick={() => setNetwork(n)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              network === n ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'
            }`}>{n}</button>
        ))}
        <button onClick={loadEconomics} className="ml-auto p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400" data-testid="treasury-refresh">
          <FiRefreshCw size={14} />
        </button>
      </div>

      {/* Treasury address */}
      {economics.address ? (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <p className="text-[10px] text-gray-500 mb-1">Treasury Address ({network})</p>
          <div className="flex items-center gap-2">
            <p className="text-sm text-emerald-400 font-mono truncate flex-1">{economics.address}</p>
            <button onClick={() => copyAddress(economics.address)} className="p-1 text-gray-500 hover:text-white" title="Copy">
              <FiCopy size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-4 text-center">
          <p className="text-sm text-red-400">Treasury not configured for {network}</p>
          <p className="text-xs text-gray-600 mt-1">Import a treasury key in the Wallet panel, or set the address in Settings</p>
        </div>
      )}

      {/* Balance + Net cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-emerald-900/15 border border-emerald-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Balance</p>
          <p className="text-xl font-bold text-emerald-400">{formatSats(economics.balance_sats)}</p>
          <p className="text-[9px] text-gray-600">{economics.balance_btc?.toFixed(8)} BTC</p>
        </div>
        <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Tax Income</p>
          <p className="text-xl font-bold text-blue-400">{formatSats(economics.income?.tax_total_sats || 0)}</p>
          <p className="text-[9px] text-gray-600">{economics.income?.tax_count || 0} transactions</p>
        </div>
        <div className="bg-red-900/15 border border-red-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Total Expenses</p>
          <p className="text-xl font-bold text-red-400">{formatSats(economics.expenses?.total_sats || 0)}</p>
          <p className="text-[9px] text-gray-600">Faucet: {economics.expenses?.faucet_count || 0} / Checkpoints: {economics.expenses?.checkpoint_count || 0}</p>
        </div>
        <div className={`${(economics.net_sats || 0) >= 0 ? 'bg-emerald-900/15 border-emerald-800/30' : 'bg-red-900/15 border-red-800/30'} border rounded-xl p-3`}>
          <p className="text-[10px] text-gray-500">Net (Income - Expenses)</p>
          <p className={`text-xl font-bold ${(economics.net_sats || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(economics.net_sats || 0) >= 0 ? '+' : ''}{formatSats(economics.net_sats || 0)}
          </p>
        </div>
      </div>

      {/* Expense breakdown */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-300 mb-3">Expense Breakdown</h4>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Faucet Payouts</span>
            <div className="text-right">
              <span className="text-xs text-red-400 font-medium">{formatSats(economics.expenses?.faucet_total_sats || 0)}</span>
              <span className="text-[10px] text-gray-600 ml-2">({economics.expenses?.faucet_count || 0} claims)</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-400">Checkpoint Costs</span>
            <div className="text-right">
              <span className="text-xs text-red-400 font-medium">{formatSats(economics.expenses?.checkpoint_total_sats || 0)}</span>
              <span className="text-[10px] text-gray-600 ml-2">({economics.expenses?.checkpoint_count || 0} checkpoints)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ledger toggle */}
      <div>
        <button onClick={() => setShowLedger(!showLedger)}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
          data-testid="treasury-toggle-ledger">
          {showLedger ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
          Transaction Ledger
        </button>

        {showLedger && (
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              {['', 'tax_income', 'faucet_expense', 'checkpoint_expense'].map(f => (
                <button key={f} onClick={() => setLedgerFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                    ledgerFilter === f ? 'bg-emerald-600/20 text-emerald-400' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                  }`}>
                  {f === '' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>

            {ledger.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-6">No ledger entries yet</p>
            ) : (
              <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-800/50">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Amount</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Details</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((e, i) => (
                      <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                        <td className="py-1.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            e.type === 'tax_income' ? 'bg-blue-900/30 text-blue-400' :
                            e.type === 'faucet_expense' ? 'bg-red-900/30 text-red-400' :
                            'bg-amber-900/30 text-amber-400'
                          }`}>{e.type?.replace('_', ' ')}</span>
                        </td>
                        <td className={`py-1.5 px-3 text-right font-medium ${
                          e.type?.includes('income') ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {e.type?.includes('income') ? '+' : '-'}{formatSats(e.amount_sats)}
                        </td>
                        <td className="py-1.5 px-3 text-gray-500 truncate max-w-[200px]">{e.details}</td>
                        <td className="py-1.5 px-3 text-gray-600">{e.created_at ? new Date(e.created_at).toLocaleString() : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Call Debug Panel ───
function CallDebugPanel() {
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef(null);

  const refresh = useCallback(() => {
    setLogs(getCallLogs());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 2000); // auto-refresh every 2s
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = () => {
    const text = exportCallLogs();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClear = () => {
    clearCallLogs();
    setLogs([]);
  };

  const levelColor = (level) => {
    switch (level) {
      case 'ERROR': return 'text-red-400';
      case 'WARN': return 'text-amber-400';
      case 'TX': return 'text-blue-400';
      case 'RX': return 'text-purple-400';
      case 'ICE': return 'text-cyan-400';
      case 'SDP': return 'text-teal-400';
      default: return 'text-green-400';
    }
  };

  return (
    <div className="space-y-4" data-testid="call-debug-panel">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{logs.length} entries — auto-refreshes every 2s</p>
        <div className="flex gap-2">
          <button onClick={refresh}
            className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 text-gray-300 transition-colors"
            data-testid="call-debug-refresh">
            <FiRefreshCw size={12} className="inline mr-1" /> Refresh
          </button>
          <button onClick={handleCopy}
            className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
              copied ? 'bg-green-900/30 border-green-700 text-green-400' : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300'
            }`}
            data-testid="call-debug-copy">
            {copied ? 'Copied!' : 'Copy All'}
          </button>
          <button onClick={handleClear}
            className="px-3 py-1.5 text-xs bg-red-900/20 border border-red-800/50 rounded-lg hover:bg-red-900/40 text-red-400 transition-colors"
            data-testid="call-debug-clear">
            <FiTrash2 size={12} className="inline mr-1" /> Clear
          </button>
        </div>
      </div>

      <div ref={scrollRef}
        className="bg-black/80 border border-gray-800 rounded-lg p-3 font-mono text-[11px] leading-5 max-h-[600px] overflow-y-auto"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        data-testid="call-debug-log-container">
        {logs.length === 0 ? (
          <p className="text-gray-600 text-center py-8">No call logs yet. Make a call to see debug output here.</p>
        ) : (
          logs.map((entry, i) => {
            const time = entry.ts?.split('T')[1]?.slice(0, 12) || '';
            return (
              <div key={i} className="hover:bg-gray-900/50 px-1 rounded">
                <span className="text-gray-600">{time}</span>
                {' '}
                <span className={`font-bold ${levelColor(entry.level)}`}>[{entry.level}]</span>
                {' '}
                <span className="text-gray-300">{entry.msg}</span>
                {entry.data && (
                  <span className="text-gray-600 ml-1">| {entry.data}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───
const TABS = [
  { id: 'settings', label: 'Settings', icon: FiSettings },
  { id: 'releases', label: 'Releases', icon: FiPackage },
  { id: 'wallet', label: 'Wallet', icon: FiBriefcase },
  { id: 'treasury', label: 'Treasury', icon: FiDollarSign },
  { id: 'checkpoint', label: 'Checkpoints', icon: FiDatabase },
  { id: 'etches', label: 'Etch Manager', icon: FiZap },
  { id: 'system', label: 'System Stats', icon: FiCpu },
  { id: 'reports', label: 'Bug Reports', icon: FiMessageSquare },
  { id: 'errors', label: 'Error Logs', icon: FiAlertCircle },
  { id: 'calldebug', label: 'Call Debug', icon: FiPhone },
  { id: 'stats', label: 'Overview', icon: FiBarChart2 },
  { id: 'password', label: 'Credentials', icon: FiLock },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState('settings');
  const [adminNetwork, setAdminNetwork] = useState(localStorage.getItem('cthulhu_admin_network') || 'btc-testnet');

  const toggleAdminNetwork = () => {
    const next = adminNetwork === 'btc-testnet' ? 'btc-mainnet' : 'btc-testnet';
    setAdminNetwork(next);
    localStorage.setItem('cthulhu_admin_network', next);
  };

  const handleLogout = () => {
    clearToken();
    setAuthed(false);
  };

  if (!authed) {
    return <AdminLogin onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex" data-testid="admin-dashboard">
      {/* Sidebar */}
      <aside className="w-56 min-h-screen bg-gray-950 border-r border-gray-800 flex flex-col p-4 shrink-0">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center">
            <FiLock size={16} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Admin</p>
            <p className="text-[10px] text-gray-600">Cthulhu Console</p>
          </div>
        </div>

        {/* Network Toggle */}
        <button
          onClick={toggleAdminNetwork}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium mb-4 border transition-colors ${
            adminNetwork === 'btc-mainnet'
              ? 'bg-orange-600/15 border-orange-600/30 text-orange-400'
              : 'bg-gray-800/50 border-gray-700/50 text-gray-400'
          }`}
          data-testid="admin-network-toggle"
        >
          <span>{adminNetwork === 'btc-mainnet' ? 'Mainnet' : 'Testnet'}</span>
          <span className={`w-2 h-2 rounded-full ${adminNetwork === 'btc-mainnet' ? 'bg-orange-400' : 'bg-green-400'}`} />
        </button>

        <nav className="flex-1 space-y-1">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  tab === t.id ? 'bg-red-600/20 text-red-400 font-medium' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
                data-testid={`admin-tab-${t.id}`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 pt-4 border-t border-gray-800">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-gray-800/50 transition-colors"
          >
            Back to Landing
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-900/20 transition-colors"
            data-testid="admin-logout"
          >
            <FiLogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto max-h-screen">
        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          {(() => { const T = TABS.find(t => t.id === tab); const I = T?.icon; return I ? <I size={18} /> : null; })()}
          {TABS.find(t => t.id === tab)?.label}
        </h2>

        {tab === 'stats' && <StatsOverview />}
        {tab === 'system' && <SystemStatsPanel />}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'releases' && <ReleasePanel network={adminNetwork} />}
        {tab === 'wallet' && <AdminWalletPanel network={adminNetwork} />}
        {tab === 'treasury' && <TreasuryPanel network={adminNetwork} />}
        {tab === 'checkpoint' && <CheckpointPanel network={adminNetwork} />}
        {tab === 'etches' && <EtchManagerPanel adminNetwork={adminNetwork} />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'errors' && <ErrorLogsPanel />}
        {tab === 'calldebug' && <CallDebugPanel />}
        {tab === 'password' && <ChangePasswordPanel />}
      </main>
    </div>
  );
}
