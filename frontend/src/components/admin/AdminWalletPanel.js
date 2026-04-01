import { useState, useEffect, useCallback } from 'react';
import { FiKey, FiCopy, FiRefreshCw, FiPlus, FiLock, FiUnlock, FiDownload, FiCheck, FiX, FiTag, FiEye, FiEyeOff } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL + '/api/admin';

function getToken() { return sessionStorage.getItem('admin_token'); }

async function walletFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}/wallet${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  return res;
}

async function safeJson(res) {
  try {
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return { detail: `HTTP ${res.status}` };
  }
}

function truncAddr(addr) {
  if (!addr) return '';
  return addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;
}

export default function AdminWalletPanel({ network: adminNetwork = 'btc-testnet' }) {
  const [status, setStatus] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  // Init wallet form
  const [showInit, setShowInit] = useState(false);
  const [initPassword, setInitPassword] = useState('');
  const [initNetwork, setInitNetwork] = useState('btc-testnet');
  const [importing, setImporting] = useState(false);

  // Unlock form
  const [unlocked, setUnlocked] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [unlockPw, setUnlockPw] = useState('');

  // Import key form
  const [showImport, setShowImport] = useState(false);
  const [importWif, setImportWif] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importPw, setImportPw] = useState('');
  const [showWif, setShowWif] = useState(false);

  // Import Treasury WIF form
  const [showTreasuryImport, setShowTreasuryImport] = useState(false);
  const [treasuryWif, setTreasuryWif] = useState('');
  const [treasuryPw, setTreasuryPw] = useState('');
  const [treasuryImporting, setTreasuryImporting] = useState(false);
  const [treasuryResult, setTreasuryResult] = useState(null);

  // Label editing
  const [editingLabel, setEditingLabel] = useState(null);
  const [labelText, setLabelText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusRes = await walletFetch('/status');
      const statusData = await safeJson(statusRes);
      setStatus(statusData);

      if (statusData.initialized) {
        const addrRes = await walletFetch('/addresses');
        const addrData = await safeJson(addrRes);
        setAddresses(addrData.addresses || []);

        const histRes = await walletFetch('/history');
        const histData = await safeJson(histRes);
        setHistory(histData.transactions || []);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const [balanceLoading, setBalanceLoading] = useState(false);

  const fetchBalance = async () => {
    setBalanceLoading(true);
    try {
      const res = await walletFetch(`/balance?network=${adminNetwork}`);
      const data = await safeJson(res);
      if (res.ok) setBalance(data);
      else setError(data.detail || 'Balance check failed');
    } catch (e) { setError(e.message); }
    setBalanceLoading(false);
  };

  const handleTreasuryImport = async () => {
    if (!treasuryWif || !treasuryPw) return;
    setTreasuryImporting(true); setTreasuryResult(null); setError('');
    try {
      const res = await walletFetch('/import-treasury', {
        method: 'POST',
        body: JSON.stringify({ wif: treasuryWif, network: adminNetwork, password: treasuryPw }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setTreasuryResult(data);
        setTreasuryWif(''); setTreasuryPw('');
        // Auto-sync treasury address to admin settings
        if (data.address) {
          const settingsKey = adminNetwork.includes('mainnet') ? 'treasury_btc' : 'treasury_btc_testnet';
          try {
            await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/settings`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
              body: JSON.stringify({ [settingsKey]: data.address }),
            });
          } catch {}
        }
        load(); // Refresh addresses
      } else {
        setError(data.detail || 'Import failed');
      }
    } catch (e) { setError(e.message); }
    setTreasuryImporting(false);
  };

  const handleInit = async () => {
    if (!initPassword) return;
    setImporting(true); setError('');
    try {
      const res = await walletFetch('/init', {
        method: 'POST',
        body: JSON.stringify({ password: initPassword, network: initNetwork, import_treasury: true }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setShowInit(false); setInitPassword('');
        load();
      } else {
        setError(data.detail || 'Init failed');
      }
    } catch (e) { setError(e.message); }
    setImporting(false);
  };

  const handleUnlock = async () => {
    if (!unlockPw) return;
    setError('');
    try {
      const res = await walletFetch('/unlock', {
        method: 'POST',
        body: JSON.stringify({ password: unlockPw }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setUnlocked(true);
        setSessionId(data.session_id);
        setUnlockPw('');
      } else {
        setError(data.detail || 'Unlock failed');
      }
    } catch (e) { setError(e.message); }
  };

  const handleImport = async () => {
    if (!importWif || !importPw) return;
    setImporting(true); setError('');
    try {
      const res = await walletFetch('/import-key', {
        method: 'POST',
        body: JSON.stringify({ wif: importWif, label: importLabel, password: importPw, network: adminNetwork }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setShowImport(false); setImportWif(''); setImportLabel(''); setImportPw('');
        load();
      } else {
        setError(data.detail || 'Import failed');
      }
    } catch (e) { setError(e.message); }
    setImporting(false);
  };

  const handleUpdateLabel = async (address) => {
    const res = await walletFetch(`/addresses/${address}/label`, {
      method: 'PUT',
      body: JSON.stringify({ label: labelText }),
    });
    if (res.ok) {
      setEditingLabel(null);
      load();
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  if (loading) return <div className="text-center text-gray-500 py-8" data-testid="wallet-loading">Loading wallet...</div>;

  // Not initialized
  if (!status?.initialized) {
    return (
      <div className="space-y-4" data-testid="wallet-init-panel">
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 text-center">
          <FiKey size={32} className="mx-auto text-amber-400 mb-3" />
          <h3 className="text-lg font-bold text-white mb-2">Initialize Admin Wallet</h3>
          <p className="text-sm text-gray-400 mb-4">Create a new encrypted wallet with a pool of 50 pre-generated addresses. Your treasury WIF will be imported automatically.</p>

          {!showInit ? (
            <button onClick={() => setShowInit(true)}
              className="px-6 py-2.5 rounded-lg bg-amber-600/20 text-amber-400 border border-amber-700/40 font-medium text-sm hover:bg-amber-600/30"
              data-testid="wallet-init-start-btn">
              <FiPlus size={14} className="inline mr-1.5" /> Create Wallet
            </button>
          ) : (
            <div className="max-w-sm mx-auto space-y-3 text-left">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Encryption Password</label>
                <input type="password" value={initPassword} onChange={e => setInitPassword(e.target.value)}
                  placeholder="Choose a strong password" data-testid="wallet-init-password"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Network</label>
                <div className="flex gap-2">
                  {['btc-testnet', 'btc-mainnet'].map(n => (
                    <button key={n} onClick={() => setInitNetwork(n)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium ${
                        initNetwork === n ? 'bg-amber-600/20 text-amber-400 border border-amber-700/40' : 'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}>{n}</button>
                  ))}
                </div>
              </div>
              {error && <p className="text-xs text-red-400" data-testid="wallet-error">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowInit(false)} className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-xs">Cancel</button>
                <button onClick={handleInit} disabled={importing || !initPassword}
                  className="flex-1 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-40"
                  data-testid="wallet-init-confirm-btn">
                  {importing ? 'Creating...' : 'Create Wallet'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Wallet exists - show full panel
  const filteredAddresses = addresses.filter(a => !adminNetwork || (a.network || 'btc-testnet') === adminNetwork);
  const usedAddrs = filteredAddresses.filter(a => a.used).length;
  const freeAddrs = filteredAddresses.filter(a => !a.used).length;

  return (
    <div className="space-y-5" data-testid="admin-wallet-panel">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {unlocked ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/20 border border-emerald-800/40 text-emerald-400 text-xs">
              <FiUnlock size={12} /> Unlocked
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-xs">
              <FiLock size={12} /> Locked
            </span>
          )}
          <span className="text-xs text-gray-500">{status?.network}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 border border-gray-700 text-xs hover:bg-gray-700"
            data-testid="wallet-import-btn">
            <FiDownload size={12} /> Import Key
          </button>
          <button onClick={fetchBalance} disabled={balanceLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 border border-gray-700 text-xs hover:bg-gray-700 disabled:opacity-50"
            data-testid="wallet-balance-btn">
            <FiRefreshCw size={12} className={balanceLoading ? 'animate-spin' : ''} /> {balanceLoading ? 'Checking...' : 'Check Balance'}
          </button>
          <button onClick={load} className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400">
            <FiRefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-sm text-red-400" data-testid="wallet-error">{error}<button onClick={() => setError('')} className="ml-2 text-xs underline">dismiss</button></div>}

      {/* Unlock Bar */}
      {!unlocked && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4" data-testid="wallet-unlock-bar">
          <p className="text-xs text-gray-400 mb-2">Unlock wallet to sign transactions</p>
          <div className="flex gap-2">
            <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="Wallet password"
              className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
              data-testid="wallet-unlock-password"
              onKeyDown={e => e.key === 'Enter' && handleUnlock()} />
            <button onClick={handleUnlock} disabled={!unlockPw}
              className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-amber-500"
              data-testid="wallet-unlock-btn">
              <FiUnlock size={12} className="inline mr-1" /> Unlock
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Total Addresses</p>
          <p className="text-xl font-bold text-amber-400">{filteredAddresses.length}</p>
        </div>
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Used</p>
          <p className="text-xl font-bold text-amber-400">{usedAddrs}</p>
        </div>
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Available</p>
          <p className="text-xl font-bold text-emerald-400">{freeAddrs}</p>
        </div>
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Balance</p>
          <p className="text-xl font-bold text-amber-400">{balance ? balance.total_btc : '—'}</p>
          {balance && <p className="text-[10px] text-gray-500">{balance.total_sats.toLocaleString()} sats</p>}
        </div>
      </div>

      {/* Import Treasury WIF — quick access per-network */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4" data-testid="treasury-import-section">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-semibold text-gray-200">
              Treasury Key ({adminNetwork === 'btc-mainnet' ? 'Mainnet' : 'Testnet'})
            </h4>
            <p className="text-[10px] text-gray-500">
              {adminNetwork === 'btc-mainnet' ? 'Required for mainnet tax collection, etching, and checkpoints' : 'Used for testnet faucet, etching, and checkpoints'}
            </p>
          </div>
          {!showTreasuryImport && (
            <button
              onClick={() => { setShowTreasuryImport(true); setTreasuryResult(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600/20 text-orange-400 border border-orange-700/40 hover:bg-orange-600/30"
              data-testid="treasury-import-btn"
            >
              Import WIF
            </button>
          )}
        </div>

        {treasuryResult?.success && (
          <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-2 text-xs text-emerald-400 mb-2" data-testid="treasury-import-success">
            Treasury imported: <span className="font-mono">{treasuryResult.address}</span>
          </div>
        )}

        {showTreasuryImport && (
          <div className="space-y-2 mt-2">
            <input
              type="password"
              value={treasuryWif}
              onChange={e => setTreasuryWif(e.target.value)}
              placeholder={`${adminNetwork === 'btc-mainnet' ? 'Mainnet' : 'Testnet'} treasury WIF private key`}
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              data-testid="treasury-wif-input"
            />
            <input
              type="password"
              value={treasuryPw}
              onChange={e => setTreasuryPw(e.target.value)}
              placeholder="Wallet password (to encrypt storage)"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-orange-500 focus:outline-none"
              data-testid="treasury-pw-input"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowTreasuryImport(false); setTreasuryWif(''); setTreasuryPw(''); }}
                className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-xs"
              >Cancel</button>
              <button
                onClick={handleTreasuryImport}
                disabled={treasuryImporting || !treasuryWif || !treasuryPw}
                className="flex-1 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-orange-500"
                data-testid="treasury-import-confirm-btn"
              >
                {treasuryImporting ? 'Importing...' : `Import ${adminNetwork === 'btc-mainnet' ? 'Mainnet' : 'Testnet'} Treasury`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import Key Modal */}
      {showImport && (
        <div className="bg-gray-900/80 border border-amber-800/30 rounded-xl p-4 space-y-3" data-testid="wallet-import-modal">
          <h4 className="text-sm font-semibold text-amber-400">Import Private Key (WIF)</h4>
          <div className="relative">
            <input type={showWif ? 'text' : 'password'} value={importWif} onChange={e => setImportWif(e.target.value)}
              placeholder="WIF private key (e.g. cP1P46D...)" data-testid="wallet-import-wif"
              className="w-full px-3 py-2 pr-8 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
            <button onClick={() => setShowWif(!showWif)} className="absolute right-2 top-2 text-gray-500 hover:text-white">
              {showWif ? <FiEyeOff size={14} /> : <FiEye size={14} />}
            </button>
          </div>
          <input value={importLabel} onChange={e => setImportLabel(e.target.value)} placeholder="Label (optional)"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            data-testid="wallet-import-label" />
          <input type="password" value={importPw} onChange={e => setImportPw(e.target.value)} placeholder="Wallet password (to re-encrypt)"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            data-testid="wallet-import-password" />
          <div className="flex gap-2">
            <button onClick={() => { setShowImport(false); setImportWif(''); setImportPw(''); }}
              className="flex-1 py-2 rounded-lg bg-gray-800 text-gray-400 text-xs">Cancel</button>
            <button onClick={handleImport} disabled={importing || !importWif || !importPw}
              className="flex-1 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold disabled:opacity-40"
              data-testid="wallet-import-confirm-btn">
              {importing ? 'Importing...' : 'Import Key'}
            </button>
          </div>
        </div>
      )}

      {/* Address List */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden" data-testid="wallet-address-list">
        <div className="px-4 py-2.5 border-b border-gray-800/50">
          <span className="text-xs text-gray-400 font-medium">Address Pool</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-800/30">
          {filteredAddresses.slice(0, 50).map((a, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-2 hover:bg-gray-800/30 ${a.used ? '' : 'opacity-60'}`}
              data-testid={`wallet-addr-${i}`}>
              <span className={`w-6 text-center text-[10px] font-mono ${a.used ? 'text-amber-400' : 'text-gray-600'}`}>{a.index}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-200 font-mono truncate">{a.address}</span>
                  <button onClick={() => copyToClipboard(a.address, `addr-${i}`)}
                    className="text-gray-600 hover:text-white flex-shrink-0">
                    {copied === `addr-${i}` ? <FiCheck size={10} className="text-emerald-400" /> : <FiCopy size={10} />}
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {editingLabel === a.address ? (
                    <div className="flex items-center gap-1">
                      <input value={labelText} onChange={e => setLabelText(e.target.value)}
                        className="px-1.5 py-0.5 bg-gray-950 border border-gray-600 rounded text-[10px] text-white w-32 focus:outline-none"
                        autoFocus onKeyDown={e => e.key === 'Enter' && handleUpdateLabel(a.address)} />
                      <button onClick={() => handleUpdateLabel(a.address)} className="text-emerald-400"><FiCheck size={10} /></button>
                      <button onClick={() => setEditingLabel(null)} className="text-gray-500"><FiX size={10} /></button>
                    </div>
                  ) : (
                    <>
                      {a.label && <span className="text-[10px] text-amber-400/60 bg-amber-900/20 px-1.5 py-0.5 rounded">{a.label}</span>}
                      <button onClick={() => { setEditingLabel(a.address); setLabelText(a.label || ''); }}
                        className="text-gray-600 hover:text-gray-400"><FiTag size={9} /></button>
                    </>
                  )}
                  {a.source === 'imported' && <span className="text-[10px] text-blue-400/50">imported</span>}
                  {a.source === 'treasury_env' && <span className="text-[10px] text-emerald-400/50">treasury</span>}
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${a.used ? 'bg-amber-900/20 text-amber-400' : 'bg-gray-800 text-gray-600'}`}>
                {a.used ? 'used' : 'free'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden" data-testid="wallet-history">
        <div className="px-4 py-2.5 border-b border-gray-800/50">
          <span className="text-xs text-gray-400 font-medium">Transaction History</span>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-6">No transactions recorded yet</p>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-800/50">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">TxID</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Amount</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Details</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((tx, i) => (
                  <tr key={i} className="border-b border-gray-800/30 hover:bg-gray-800/30">
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        tx.type === 'etch_obj' ? 'bg-amber-900/30 text-amber-400' :
                        tx.type === 'etch_raw' ? 'bg-orange-900/30 text-orange-400' :
                        'bg-blue-900/30 text-blue-400'
                      }`}>{tx.type?.replace('_', ' ')}</span>
                    </td>
                    <td className="py-1.5 px-3 text-gray-400 font-mono">
                      <span className="truncate max-w-[120px] inline-block">{truncAddr(tx.txid)}</span>
                    </td>
                    <td className="py-1.5 px-3 text-right text-red-400 font-medium">-{tx.amount_sats?.toLocaleString()} sats</td>
                    <td className="py-1.5 px-3 text-gray-500 truncate max-w-[200px]">{tx.details}</td>
                    <td className="py-1.5 px-3 text-gray-600">{tx.timestamp ? new Date(tx.timestamp).toLocaleString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
