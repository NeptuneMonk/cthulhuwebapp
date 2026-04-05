import { useState, useEffect, useCallback, useRef } from 'react';
import { FiPackage, FiUpload, FiCheck, FiX, FiExternalLink, FiRefreshCw, FiImage, FiFile, FiZap, FiCopy, FiLoader, FiChevronDown, FiChevronUp, FiDownload } from 'react-icons/fi';

const API = process.env.REACT_APP_BACKEND_URL + '/api';

function getToken() { return localStorage.getItem('cthulhu_admin_token'); }

async function adminFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}/admin${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  return res;
}

async function safeJson(res) {
  try { const t = await res.text(); return JSON.parse(t); }
  catch { return { detail: `HTTP ${res.status}` }; }
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─── Release Panel ───
export default function ReleasePanel({ network = 'btc-testnet' }) {
  const [config, setConfig] = useState(null);
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState('overview'); // overview | mint | publish
  const [expandedRelease, setExpandedRelease] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, relRes] = await Promise.all([
        adminFetch('/releases/config'),
        adminFetch(`/releases?network=${network}`),
      ]);
      if (cfgRes.ok) setConfig(await safeJson(cfgRes));
      if (relRes.ok) {
        const d = await safeJson(relRes);
        setReleases(d.releases || []);
      }
    } catch {}
    setLoading(false);
  }, [network]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return <div className="text-gray-500 text-sm" data-testid="release-loading">Loading release config...</div>;

  const profileMinted = config?.profile_minted;

  return (
    <div className="space-y-5" data-testid="release-panel">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setSection('overview')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${section === 'overview' ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`} data-testid="release-tab-overview">Overview</button>
        <button onClick={() => setSection('build')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${section === 'build' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`} data-testid="release-tab-build">Build ZIP</button>
        <button onClick={() => setSection('mint')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${section === 'mint' ? 'bg-purple-600/20 text-purple-400 border border-purple-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`} data-testid="release-tab-mint">Mint Profile</button>
        <button onClick={() => setSection('publish')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${section === 'publish' ? 'bg-amber-600/20 text-amber-400 border border-amber-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`} data-testid="release-tab-publish">Etch Release</button>
        <button onClick={loadAll} className="ml-auto p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400" data-testid="release-refresh"><FiRefreshCw size={14} /></button>
      </div>

      {/* Status Banner */}
      <div className={`rounded-xl border p-4 ${profileMinted ? 'bg-emerald-900/10 border-emerald-800/30' : 'bg-yellow-900/10 border-yellow-800/30'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${profileMinted ? 'bg-emerald-600/20' : 'bg-yellow-600/20'}`}>
            <FiPackage size={16} className={profileMinted ? 'text-emerald-400' : 'text-yellow-400'} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              {profileMinted ? `Release Profile: @${config.release_profile_urn}` : 'Release Profile Not Minted'}
            </p>
            <p className="text-[10px] text-gray-500">
              {profileMinted
                ? `Address: ${config.release_address} | ${releases.length} release${releases.length !== 1 ? 's' : ''} published`
                : 'Mint a release profile before publishing updates'}
            </p>
          </div>
          {profileMinted && config.profile_txid && (
            <a href={`https://mempool.space/testnet/tx/${config.profile_txid}`} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-[10px] text-emerald-500 hover:text-emerald-400 flex items-center gap-1">
              <FiExternalLink size={10} /> View TX
            </a>
          )}
        </div>
      </div>

      {section === 'overview' && <ReleaseHistory releases={releases} expanded={expandedRelease} setExpanded={setExpandedRelease} />}
      {section === 'build' && <BuildPackageSection />}
      {section === 'mint' && <MintProfileSection config={config} network={network} onSuccess={loadAll} />}
      {section === 'publish' && <PublishReleaseSection config={config} network={network} onSuccess={() => { loadAll(); setSection('overview'); }} />}
    </div>
  );
}


// ─── Build Package Section ───
function BuildPackageSection() {
  const [version, setVersion] = useState('1.0.0');
  const [building, setBuilding] = useState(false);
  const [packages, setPackages] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const loadPackages = useCallback(async () => {
    try {
      const res = await adminFetch('/releases/packages');
      if (res.ok) {
        const data = await safeJson(res);
        setPackages(data.packages || []);
      }
    } catch {}
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  const handleBuild = async () => {
    setBuilding(true); setError(''); setResult(null);
    try {
      const res = await adminFetch('/releases/build', {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      const data = await safeJson(res);
      if (res.ok && data.success) {
        setResult(data);
        loadPackages();
      } else {
        setError(data.detail || 'Build failed');
      }
    } catch (e) { setError(e.message); }
    setBuilding(false);
  };

  const baseUrl = process.env.REACT_APP_BACKEND_URL;

  return (
    <div className="space-y-4" data-testid="build-section">
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Build Desktop Package</h4>
        <p className="text-[10px] text-gray-500">Runs <code className="text-cyan-500">yarn build</code> (standalone mode, no Emergent branding), packages the static web app into a downloadable zip. Works on any device — just open index.html or host anywhere.</p>
        <div className="flex items-center gap-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Version</label>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" data-testid="build-version"
              className="w-32 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-cyan-500 focus:outline-none" />
          </div>
          <div className="pt-4">
            <button onClick={handleBuild} disabled={building || !version}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 flex items-center gap-2"
              data-testid="build-btn">
              {building ? <><FiLoader size={12} className="animate-spin" /> Building...</> : <><FiPackage size={12} /> Build ZIP</>}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3" data-testid="build-error">{error}</p>}

      {result && (
        <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <FiCheck size={14} className="text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">{result.already_built ? 'Package Ready' : 'Build Complete!'}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{result.filename} ({result.size_mb} MB)</span>
            <a href={`${baseUrl}${result.download_url}`} download
              className="px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-400 border border-cyan-700/40 text-xs font-medium hover:bg-cyan-600/30 transition-colors flex items-center gap-2"
              data-testid="build-download-btn">
              <FiDownload size={12} /> Download
            </a>
          </div>
        </div>
      )}

      {/* Existing Packages */}
      {packages.length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Available Packages</h4>
          {packages.map(p => (
            <div key={p.filename} className="flex items-center justify-between px-3 py-2 bg-gray-950 rounded-lg">
              <div className="flex items-center gap-2">
                <FiFile size={12} className="text-cyan-400" />
                <span className="text-xs text-white font-mono">{p.filename}</span>
                <span className="text-[10px] text-gray-600">{p.size_mb} MB</span>
              </div>
              <a href={`${baseUrl}${p.download_url}`} download
                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1" data-testid={`pkg-download-${p.filename}`}>
                <FiDownload size={11} /> Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Mint Profile Section ───
function MintProfileSection({ config, network, onSuccess }) {
  const [urn, setUrn] = useState(config?.release_profile_urn || 'cthulhurelease');
  const [displayName, setDisplayName] = useState('Cthulhu Releases');
  const [bio, setBio] = useState('Official Cthulhu application releases. Download the latest version here.');
  const [imageCid, setImageCid] = useState('');
  const [walletSessionId, setWalletSessionId] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletPassword, setWalletPassword] = useState('');
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const imageRef = useRef(null);

  const unlockWallet = async () => {
    if (!walletPassword) return;
    setError('');
    try {
      const res = await adminFetch('/wallet/unlock', { method: 'POST', body: JSON.stringify({ password: walletPassword }) });
      const data = await safeJson(res);
      if (res.ok && data.session_id) {
        setWalletSessionId(data.session_id);
        // Get first address
        const addrRes = await adminFetch('/wallet/addresses');
        if (addrRes.ok) {
          const addrData = await safeJson(addrRes);
          const first = (addrData.addresses || [])[0];
          if (first) setWalletAddress(first.address);
        }
      } else {
        setError(data.detail || 'Wallet unlock failed');
      }
    } catch { setError('Connection error'); }
  };

  const uploadImage = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API}/ipfs/upload`, { method: 'POST', body: formData });
      const data = await safeJson(res);
      if (res.ok && data.cid) {
        setImageCid(data.cid);
      } else {
        setError('Image upload failed: ' + (data.detail || ''));
      }
    } catch { setError('Image upload connection error'); }
  };

  const handleMint = async () => {
    if (!walletSessionId || !urn) return;
    setMinting(true); setError(''); setResult(null);
    try {
      const res = await adminFetch('/releases/mint-profile', {
        method: 'POST',
        body: JSON.stringify({
          urn,
          display_name: displayName,
          bio,
          image_cid: imageCid,
          wallet_session_id: walletSessionId,
          wallet_address: walletAddress,
          network,
        }),
      });
      const data = await safeJson(res);
      if (res.ok && data.success) {
        setResult(data);
        onSuccess();
      } else {
        setError(data.detail || 'Mint failed');
      }
    } catch (e) { setError(e.message); }
    setMinting(false);
  };

  if (result) {
    return (
      <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-5 space-y-3" data-testid="mint-result">
        <div className="flex items-center gap-2">
          <FiCheck size={18} className="text-emerald-400" />
          <h4 className="text-sm font-bold text-emerald-400">Profile Minted Successfully</h4>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between"><span className="text-gray-500">URN</span><span className="text-white font-mono">@{result.urn}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Address</span><span className="text-white font-mono text-[10px]">{result.address}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">TX</span>
            <a href={result.mempool_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 font-mono text-[10px] flex items-center gap-1">
              {result.txid?.slice(0, 16)}... <FiExternalLink size={10} />
            </a>
          </div>
          <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="text-amber-400">{result.dust_cost_sats} sats</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="mint-profile-section">
      {config?.profile_minted && (
        <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-xl p-3">
          <p className="text-xs text-yellow-400">Profile already minted as @{config.release_profile_urn}. Minting again will create a new/updated profile transaction.</p>
        </div>
      )}

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Release Profile Details</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Profile URN *</label>
            <input value={urn} onChange={e => setUrn(e.target.value)} placeholder="cthulhurelease" data-testid="release-urn"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-purple-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Display Name</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Cthulhu Releases" data-testid="release-display-name"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Bio</label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2} data-testid="release-bio"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none resize-none" />
        </div>

        {/* Profile Image */}
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Profile Image (optional)</label>
          <div className="flex items-center gap-3">
            {imageCid ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/20 border border-emerald-800/30 rounded-lg">
                <FiImage size={12} className="text-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-mono truncate max-w-[200px]">{imageCid}</span>
                <button onClick={() => setImageCid('')} className="text-gray-500 hover:text-red-400"><FiX size={12} /></button>
              </div>
            ) : (
              <button onClick={() => imageRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400 transition-colors" data-testid="release-upload-image">
                <FiUpload size={12} /> Upload Image
              </button>
            )}
            <input ref={imageRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) uploadImage(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>
      </div>

      {/* Wallet Unlock */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Admin Wallet</h4>
        {walletSessionId ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <FiCheck size={14} /> Wallet unlocked
            {walletAddress && <span className="font-mono text-[10px] text-gray-500 ml-2">{walletAddress}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input type="password" value={walletPassword} onChange={e => setWalletPassword(e.target.value)} placeholder="Admin wallet password"
              className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && unlockWallet()} data-testid="release-wallet-password" />
            <button onClick={unlockWallet} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white" data-testid="release-unlock-wallet">Unlock</button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3" data-testid="release-error">{error}</p>}

      <button onClick={handleMint} disabled={minting || !walletSessionId || !urn}
        className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
        data-testid="release-mint-btn">
        {minting ? <><FiLoader size={14} className="animate-spin" /> Minting Profile...</> : <><FiZap size={14} /> Mint Release Profile</>}
      </button>
    </div>
  );
}


// ─── Publish Release Section ───
function PublishReleaseSection({ config, network, onSuccess }) {
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [changelog, setChangelog] = useState('');
  const [zipCid, setZipCid] = useState('');
  const [imageCid, setImageCid] = useState('');
  const [keywords, setKeywords] = useState('cthulhu,release');
  const [walletSessionId, setWalletSessionId] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletPassword, setWalletPassword] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState('');
  const zipRef = useRef(null);
  const imgRef = useRef(null);

  const unlockWallet = async () => {
    if (!walletPassword) return;
    setError('');
    try {
      const res = await adminFetch('/wallet/unlock', { method: 'POST', body: JSON.stringify({ password: walletPassword }) });
      const data = await safeJson(res);
      if (res.ok && data.session_id) {
        setWalletSessionId(data.session_id);
        const addrRes = await adminFetch('/wallet/addresses');
        if (addrRes.ok) {
          const addrData = await safeJson(addrRes);
          const first = (addrData.addresses || [])[0];
          if (first) setWalletAddress(first.address);
        }
      } else {
        setError(data.detail || 'Wallet unlock failed');
      }
    } catch { setError('Connection error'); }
  };

  const uploadFile = async (file, type) => {
    setUploading(type);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API}/ipfs/upload`, { method: 'POST', body: formData });
      const data = await safeJson(res);
      if (res.ok && data.cid) {
        const cidPath = data.cid;
        if (type === 'zip') setZipCid(cidPath);
        else setImageCid(cidPath);
      } else {
        setError(`${type} upload failed: ${data.detail || ''}`);
      }
    } catch { setError(`${type} upload connection error`); }
    setUploading('');
  };

  const handlePublish = async () => {
    if (!walletSessionId || !version) return;
    setPublishing(true); setError(''); setResult(null);
    try {
      const kwArray = keywords.split(',').map(k => k.trim()).filter(Boolean);
      const res = await adminFetch('/releases/publish', {
        method: 'POST',
        body: JSON.stringify({
          version,
          name: name || `Cthulhu ${version}`,
          description,
          changelog,
          zip_cid: zipCid,
          image_cid: imageCid,
          keywords: kwArray,
          wallet_session_id: walletSessionId,
          wallet_address: walletAddress,
          network,
        }),
      });
      const data = await safeJson(res);
      if (res.ok && data.success) {
        setResult(data);
        onSuccess();
      } else {
        setError(data.detail || 'Publish failed');
      }
    } catch (e) { setError(e.message); }
    setPublishing(false);
  };

  if (!config?.profile_minted) {
    return (
      <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-xl p-5 text-center" data-testid="publish-no-profile">
        <FiPackage size={24} className="mx-auto text-yellow-400 mb-2" />
        <p className="text-sm text-yellow-400 font-medium">Mint a Release Profile First</p>
        <p className="text-[10px] text-gray-500 mt-1">Switch to the "Mint Profile" tab to create the cthulhurelease profile on-chain.</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="bg-emerald-900/10 border border-emerald-800/30 rounded-xl p-5 space-y-3" data-testid="publish-result">
        <div className="flex items-center gap-2">
          <FiCheck size={18} className="text-emerald-400" />
          <h4 className="text-sm font-bold text-emerald-400">Release Published!</h4>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between"><span className="text-gray-500">Version</span><span className="text-white font-bold">{result.version}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Name</span><span className="text-white">{result.name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Object</span><span className="text-white font-mono text-[10px]">{result.object_address}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">TX</span>
            <a href={result.mempool_url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 font-mono text-[10px] flex items-center gap-1">
              {result.txid?.slice(0, 16)}... <FiExternalLink size={10} />
            </a>
          </div>
          {result.zip_cid && (
            <div className="flex justify-between"><span className="text-gray-500">Download</span>
              <a href={result.ipfs_gateway} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 text-[10px] flex items-center gap-1">
                IPFS Gateway <FiExternalLink size={10} />
              </a>
            </div>
          )}
          <div className="flex justify-between"><span className="text-gray-500">Cost</span><span className="text-amber-400">{result.dust_cost_sats} sats</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="publish-section">
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Release Details</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Version *</label>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" data-testid="publish-version"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Release Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Cthulhu 1.0.0" data-testid="publish-name"
              className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Initial release of Cthulhu desktop app" data-testid="publish-description"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Changelog</label>
          <textarea value={changelog} onChange={e => setChangelog(e.target.value)} rows={3} placeholder="- Added feature X&#10;- Fixed bug Y&#10;- Improved Z" data-testid="publish-changelog"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white font-mono placeholder-gray-600 focus:border-amber-500 focus:outline-none resize-none" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Keywords (comma-separated)</label>
          <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="cthulhu,release,desktop" data-testid="publish-keywords"
            className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none" />
        </div>
      </div>

      {/* File Uploads */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">IPFS Assets</h4>

        {/* Build ZIP */}
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Build ZIP (app package)</label>
          {zipCid ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-cyan-900/20 border border-cyan-800/30 rounded-lg">
              <FiFile size={12} className="text-cyan-400" />
              <span className="text-[10px] text-cyan-400 font-mono truncate flex-1">{zipCid}</span>
              <button onClick={() => copyText(zipCid)} className="text-gray-500 hover:text-white"><FiCopy size={10} /></button>
              <button onClick={() => setZipCid('')} className="text-gray-500 hover:text-red-400"><FiX size={12} /></button>
            </div>
          ) : (
            <button onClick={() => zipRef.current?.click()} disabled={uploading === 'zip'}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400 transition-colors disabled:opacity-50" data-testid="publish-upload-zip">
              {uploading === 'zip' ? <><FiLoader size={12} className="animate-spin" /> Uploading ZIP...</> : <><FiUpload size={12} /> Upload Build ZIP</>}
            </button>
          )}
          <input ref={zipRef} type="file" accept=".zip,.tar.gz" className="hidden"
            onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], 'zip'); e.target.value = ''; }} />
        </div>

        {/* Cover Image */}
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Cover Image</label>
          {imageCid ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-900/20 border border-emerald-800/30 rounded-lg">
              <FiImage size={12} className="text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-mono truncate flex-1">{imageCid}</span>
              <button onClick={() => copyText(imageCid)} className="text-gray-500 hover:text-white"><FiCopy size={10} /></button>
              <button onClick={() => setImageCid('')} className="text-gray-500 hover:text-red-400"><FiX size={12} /></button>
            </div>
          ) : (
            <button onClick={() => imgRef.current?.click()} disabled={uploading === 'image'}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400 transition-colors disabled:opacity-50" data-testid="publish-upload-image">
              {uploading === 'image' ? <><FiLoader size={12} className="animate-spin" /> Uploading...</> : <><FiImage size={12} /> Upload Cover Image</>}
            </button>
          )}
          <input ref={imgRef} type="file" accept="image/*" className="hidden"
            onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], 'image'); e.target.value = ''; }} />
        </div>
      </div>

      {/* Wallet Unlock */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Admin Wallet</h4>
        {walletSessionId ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <FiCheck size={14} /> Wallet unlocked
            {walletAddress && <span className="font-mono text-[10px] text-gray-500 ml-2">{walletAddress}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input type="password" value={walletPassword} onChange={e => setWalletPassword(e.target.value)} placeholder="Admin wallet password"
              className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-amber-500 focus:outline-none"
              onKeyDown={e => e.key === 'Enter' && unlockWallet()} data-testid="publish-wallet-password" />
            <button onClick={unlockWallet} className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white" data-testid="publish-unlock-wallet">Unlock</button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 rounded-lg p-3" data-testid="publish-error">{error}</p>}

      <button onClick={handlePublish} disabled={publishing || !walletSessionId || !version}
        className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
        data-testid="publish-etch-btn">
        {publishing ? <><FiLoader size={14} className="animate-spin" /> Etching Release...</> : <><FiZap size={14} /> Etch Release to Chain</>}
      </button>
    </div>
  );
}


// ─── Release History ───
function ReleaseHistory({ releases, expanded, setExpanded }) {
  if (!releases.length) {
    return (
      <div className="text-center py-12" data-testid="release-empty">
        <FiPackage size={32} className="mx-auto text-gray-700 mb-3" />
        <p className="text-sm text-gray-500">No releases published yet</p>
        <p className="text-[10px] text-gray-700 mt-1">Switch to "Publish Release" to etch your first update</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="release-history">
      {releases.map((r, i) => {
        const isExpanded = expanded === i;
        return (
          <div key={r.txid || i} className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
            <button onClick={() => setExpanded(isExpanded ? null : i)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/30 transition-colors text-left">
              <div className="w-8 h-8 rounded-lg bg-amber-600/15 flex items-center justify-center flex-shrink-0">
                <FiPackage size={14} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{r.name || `v${r.version}`}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 font-mono">{r.version}</span>
                </div>
                <p className="text-[10px] text-gray-600">{r.published_at?.slice(0, 10)} | {r.network}</p>
              </div>
              {isExpanded ? <FiChevronUp size={14} className="text-gray-500" /> : <FiChevronDown size={14} className="text-gray-500" />}
            </button>
            {isExpanded && (
              <div className="px-4 pb-4 space-y-2 border-t border-gray-800/50 pt-3">
                {r.description && <p className="text-xs text-gray-400">{r.description}</p>}
                {r.changelog && (
                  <div>
                    <p className="text-[10px] text-gray-600 mb-1">Changelog:</p>
                    <pre className="text-[10px] text-gray-400 font-mono bg-gray-950 rounded-lg p-2 whitespace-pre-wrap">{r.changelog}</pre>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {r.txid && (
                    <div>
                      <span className="text-gray-600">TX: </span>
                      <a href={`https://mempool.space/${r.network?.includes('testnet') ? 'testnet/' : ''}tx/${r.txid}`}
                        target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 font-mono">
                        {r.txid.slice(0, 20)}...
                      </a>
                    </div>
                  )}
                  {r.object_address && (
                    <div>
                      <span className="text-gray-600">Object: </span>
                      <span className="text-white font-mono">{r.object_address.slice(0, 16)}...</span>
                      <button onClick={() => copyText(r.object_address)} className="ml-1 text-gray-600 hover:text-white"><FiCopy size={9} /></button>
                    </div>
                  )}
                  {r.zip_cid && (
                    <div>
                      <span className="text-gray-600">ZIP: </span>
                      <a href={`https://ipfs.io/ipfs/${r.zip_cid}`} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                        Download <FiExternalLink size={9} className="inline" />
                      </a>
                    </div>
                  )}
                  {r.image_cid && (
                    <div>
                      <span className="text-gray-600">Image: </span>
                      <a href={`https://ipfs.io/ipfs/${r.image_cid}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
                        View <FiExternalLink size={9} className="inline" />
                      </a>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-gray-700">Cost: {r.dust_cost_sats} sats | Outputs: {r.num_outputs}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
