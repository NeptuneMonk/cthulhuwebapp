import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiArrowLeft, FiAlertTriangle, FiMonitor, FiCpu, FiGlobe, FiShield, FiRefreshCw, FiCheck, FiHardDrive, FiWifi, FiBox, FiArrowRight, FiTerminal } from 'react-icons/fi';
import { CthulhuLogo } from '@/components/CthulhuLogo';

const API = process.env.REACT_APP_BACKEND_URL;

// ── Platform Detection ─────────────────────────────────────────────────────

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || '';

  if (ua.includes('win') || platform.includes('win')) {
    return 'windows';
  }
  if (ua.includes('mac') || platform.includes('mac')) {
    // Detect Apple Silicon vs Intel
    // navigator.userAgentData is available in Chromium-based browsers
    if (navigator.userAgentData?.platform === 'macOS') {
      // Use GPU renderer to guess architecture
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();
            if (renderer.includes('apple m') || renderer.includes('apple gpu')) {
              return 'mac_arm';
            }
          }
        }
      } catch {}
    }
    // Check for ARM in UA (Safari includes it)
    if (ua.includes('arm64') || ua.includes('aarch64')) {
      return 'mac_arm';
    }
    return 'mac_intel';
  }
  if (ua.includes('linux') || platform.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

const PLATFORMS = {
  windows: {
    key: 'windows',
    name: 'Windows',
    icon: FiMonitor,
    ext: '.msi',
    desc: 'Windows 10+ (64-bit)',
    color: '#3b82f6',
  },
  mac_arm: {
    key: 'mac_arm',
    name: 'macOS (Apple Silicon)',
    icon: FiCpu,
    ext: '.dmg',
    desc: 'M1/M2/M3/M4 Mac',
    color: '#a78bfa',
  },
  mac_intel: {
    key: 'mac_intel',
    name: 'macOS (Intel)',
    icon: FiCpu,
    ext: '.dmg',
    desc: 'Intel-based Mac',
    color: '#8b5cf6',
  },
  linux: {
    key: 'linux',
    name: 'Linux',
    icon: FiGlobe,
    ext: '.AppImage',
    desc: 'Ubuntu, Fedora, Arch (64-bit)',
    color: '#f59e0b',
  },
};

const DESKTOP_FEATURES = [
  {
    icon: FiHardDrive,
    title: 'Core Wallet Integration',
    desc: 'Connects directly to Bitcoin Core, Litecoin Core, Dogecoin Core, and Mazacoin Core via JSON-RPC. Your keys never leave your wallet daemon.',
  },
  {
    icon: FiBox,
    title: 'Local P2FK Scanner',
    desc: 'Scans the blockchain locally from your own node. No reliance on third-party indexers. Full sovereignty over your data.',
  },
  {
    icon: FiShield,
    title: 'Local IPFS Node',
    desc: 'Built-in Kubo daemon. You pin and serve content directly — full participation in the decentralized file network.',
  },
  {
    icon: FiWifi,
    title: 'Mesh Network Master Node',
    desc: 'Broadcasts as a master node on the P2P mesh. Serves blockchain data, IPFS content, and P2FK index to web app peers.',
  },
];

const SETUP_STEPS = [
  { num: '1', title: 'Download', desc: 'Get the installer for your OS' },
  { num: '2', title: 'Install', desc: 'Run the installer — it bundles everything' },
  { num: '3', title: 'Start a Core Wallet', desc: 'Launch bitcoin-qt, litecoin-qt, etc.' },
  { num: '4', title: 'Open Cthulhu', desc: 'It auto-detects your wallets' },
];

export default function DownloadPage() {
  const navigate = useNavigate();
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);
  const detectedPlatform = useMemo(() => detectPlatform(), []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/releases/latest?network=btc-testnet`);
        if (res.ok) {
          const data = await res.json();
          if (data.available) setRelease(data);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const platformOrder = useMemo(() => {
    // Put detected platform first
    const all = ['windows', 'mac_arm', 'mac_intel', 'linux'];
    if (detectedPlatform && all.includes(detectedPlatform)) {
      return [detectedPlatform, ...all.filter(p => p !== detectedPlatform)];
    }
    return all;
  }, [detectedPlatform]);

  const getDownloadUrl = (platformKey) => {
    if (!release) return null;
    const plat = release.platforms?.[platformKey];
    if (plat?.url) return plat.url;
    // Fallback to generic zip_cid
    if (release.download_url) return release.download_url;
    return null;
  };

  return (
    <div className="min-h-screen bg-[#030608] text-gray-100 overflow-x-hidden" data-testid="download-page">

      {/* Nav */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-teal-400 transition-colors"
          data-testid="download-back-btn"
        >
          <FiArrowLeft size={16} />
          Back
        </button>
        <div className="flex items-center gap-3">
          <CthulhuLogo className="w-8 h-8" />
          <span className="text-lg font-bold tracking-wider text-teal-400">CTHULHU</span>
        </div>
        <button
          onClick={() => navigate('/auth')}
          className="text-sm font-medium px-5 py-2 rounded-full bg-teal-600/20 text-teal-400 border border-teal-600/30 hover:bg-teal-600/30 transition-all"
          data-testid="download-launch-btn"
        >
          Launch Web App
        </button>
      </nav>

      {/* Beta Banner */}
      <div className="max-w-4xl mx-auto px-6 mt-4">
        <div className="bg-amber-900/15 border border-amber-600/30 rounded-xl px-5 py-4" data-testid="experimental-banner">
          <div className="flex items-start gap-3">
            <FiAlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={18} />
            <div>
              <p className="text-sm font-semibold text-amber-400">Experimental Beta</p>
              <p className="text-xs text-amber-400/70 leading-relaxed mt-1">
                Cthulhu Desktop is in active development. The app connects to your local Core Wallet daemons —
                your keys never leave your wallet. As long as you have your Core Wallet, your on-chain identity is always recoverable.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8 text-center">
        <CthulhuLogo className="w-20 h-20 mx-auto mb-6 drop-shadow-[0_0_30px_rgba(13,148,136,0.3)]" />
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-300">
            Download Cthulhu Desktop
          </span>
        </h1>
        <p className="mt-3 text-sm text-gray-500 max-w-xl mx-auto leading-relaxed">
          Run your own node. Connect to your Core Wallets. Scan the blockchain locally.
          The desktop app includes a P2FK chain scanner, IPFS daemon, and mesh networking — no central server required.
        </p>
      </section>

      {/* ═══════ Download Cards ═══════ */}
      <section className="max-w-4xl mx-auto px-6 pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
            <FiRefreshCw className="animate-spin" size={16} />
            <span className="text-sm">Checking for latest release...</span>
          </div>
        ) : release ? (
          <>
            {/* Release Info */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-100">{release.name || 'Cthulhu Desktop'}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Version {release.version}
                  {release.published_at && <> &middot; {new Date(release.published_at).toLocaleDateString()}</>}
                </p>
              </div>
              <span className="px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Beta
              </span>
            </div>

            {release.description && (
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">{release.description}</p>
            )}

            {/* Platform Download Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {platformOrder.map((key, idx) => {
                const plat = PLATFORMS[key];
                if (!plat) return null;
                const Icon = plat.icon;
                const isDetected = key === detectedPlatform;
                const url = getDownloadUrl(key);
                const platData = release.platforms?.[key];

                return (
                  <div
                    key={key}
                    className={`relative rounded-2xl border p-5 transition-all ${
                      isDetected
                        ? 'border-teal-600/40 bg-teal-900/10 ring-1 ring-teal-600/20'
                        : 'border-gray-800/50 bg-gray-900/20 hover:border-gray-700/60'
                    }`}
                    data-testid={`download-card-${key}`}
                  >
                    {isDetected && (
                      <div className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full bg-teal-600 text-[10px] font-bold tracking-wide text-white">
                        RECOMMENDED
                      </div>
                    )}

                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${plat.color}15`, border: `1px solid ${plat.color}25` }}
                      >
                        <Icon size={22} style={{ color: plat.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-100">{plat.name}</h3>
                        <p className="text-[11px] text-gray-500 mt-0.5">{plat.desc}</p>
                        {platData?.size && (
                          <p className="text-[10px] text-gray-600 mt-0.5">{platData.size} &middot; {platData.filename || plat.ext}</p>
                        )}
                      </div>
                    </div>

                    {url ? (
                      <a
                        href={url}
                        download
                        className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isDetected
                            ? 'bg-teal-600 text-white hover:bg-teal-500 shadow-lg shadow-teal-600/20'
                            : 'bg-gray-800/60 text-gray-300 hover:bg-gray-700/60 border border-gray-700/30'
                        }`}
                        data-testid={`download-btn-${key}`}
                      >
                        <FiDownload size={15} />
                        Download {plat.ext}
                      </a>
                    ) : (
                      <div className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm text-gray-600 bg-gray-900/40 border border-gray-800/20">
                        Coming soon
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Changelog */}
            {release.changelog && (
              <div className="bg-gray-950/50 border border-gray-800/30 rounded-lg p-4 mb-6">
                <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Changelog</p>
                <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">{release.changelog}</p>
              </div>
            )}

            {release.zip_cid && (
              <p className="text-[10px] text-gray-600 text-center">
                IPFS CID: <code className="text-gray-500 font-mono">{release.zip_cid}</code>
              </p>
            )}
          </>
        ) : (
          /* No release yet — show coming soon with build-from-source */
          <div className="text-center py-10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-900/40 border border-gray-800/30 flex items-center justify-center">
              <FiDownload className="text-gray-600" size={24} />
            </div>
            <p className="text-sm text-gray-400 font-medium">No release published yet</p>
            <p className="text-xs text-gray-600 mt-2 max-w-md mx-auto">
              The first desktop release is being prepared. You can build from source below,
              or use the <button onClick={() => navigate('/auth')} className="text-teal-400 hover:underline">web app</button> in the meantime.
            </p>
          </div>
        )}
      </section>

      {/* ═══════ How It Works ═══════ */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <h3 className="text-sm font-semibold text-gray-400 tracking-widest uppercase mb-6 text-center">
          Get Running in 4 Steps
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SETUP_STEPS.map((step) => (
            <div key={step.num} className="text-center p-4 rounded-xl bg-gray-900/20 border border-gray-800/30">
              <div className="w-8 h-8 rounded-full bg-teal-600/20 text-teal-400 text-sm font-bold flex items-center justify-center mx-auto mb-3">
                {step.num}
              </div>
              <p className="text-xs font-semibold text-gray-200 mb-1">{step.title}</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ Desktop Features ═══════ */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <h3 className="text-sm font-semibold text-gray-400 tracking-widest uppercase mb-6 text-center">
          Desktop vs. Web
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DESKTOP_FEATURES.map((item, i) => (
            <div key={i} className="p-5 rounded-xl bg-gray-900/20 border border-gray-800/30 hover:border-gray-700/40 transition-colors">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="w-8 h-8 rounded-lg bg-teal-900/30 flex items-center justify-center">
                  <item.icon className="text-teal-400" size={15} />
                </div>
                <p className="text-xs font-semibold text-gray-200">{item.title}</p>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ Core Wallet Requirements ═══════ */}
      <section className="max-w-4xl mx-auto px-6 pb-12">
        <div className="rounded-2xl border border-gray-800/40 bg-gray-900/15 p-6 md:p-8">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Requirements</h3>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Cthulhu Desktop connects to your locally-running Core Wallet daemons via JSON-RPC.
            You need at least one of these wallets installed and running with <code className="px-1.5 py-0.5 rounded bg-gray-800/50 text-teal-400 text-[11px]">server=1</code> in its config file:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { name: 'Bitcoin Core', port: '8332', cmd: 'bitcoin-qt', color: '#f7931a', url: 'https://bitcoincore.org/en/download/' },
              { name: 'Litecoin Core', port: '9332', cmd: 'litecoin-qt', color: '#bfbbbb', url: 'https://litecoin.org' },
              { name: 'Dogecoin Core', port: '22555', cmd: 'dogecoin-qt', color: '#c2a633', url: 'https://dogecoin.com' },
              { name: 'Mazacoin Core', port: '12832', cmd: 'mazacoin-qt', color: '#00aced', url: 'https://mazacoin.org' },
            ].map(w => (
              <a
                key={w.name}
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-3 rounded-xl border border-gray-800/40 bg-gray-900/30 hover:border-gray-600/50 transition-all group text-left"
                data-testid={`wallet-req-${w.cmd}`}
              >
                <p className="text-xs font-semibold group-hover:text-white transition-colors" style={{ color: w.color }}>{w.name}</p>
                <p className="text-[10px] text-gray-600 font-mono mt-0.5">{w.cmd}</p>
                <p className="text-[10px] text-gray-600 mt-0.5">RPC port: {w.port}</p>
              </a>
            ))}
          </div>

          <div className="bg-gray-950/50 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Config Example (~/.bitcoin/bitcoin.conf)</p>
            <div className="font-mono text-xs text-gray-500 space-y-0.5">
              <p><span className="text-teal-500">server</span>=1</p>
              <p><span className="text-teal-500">rpcuser</span>=cthulhu</p>
              <p><span className="text-teal-500">rpcpassword</span>=your_secure_password</p>
              <p className="text-gray-600"># Or use cookie-based auth (default, no config needed)</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ Build from Source ═══════ */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-gray-800/30 bg-gray-900/15 p-6">
          <div className="flex items-center gap-2 mb-3">
            <FiTerminal size={14} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-300">Build from Source</h3>
          </div>
          <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-gray-500 space-y-1 overflow-x-auto">
            <p className="text-gray-600"># Prerequisites: Rust, Node.js 18+, Python 3.10+</p>
            <p><span className="text-teal-500">$</span> git clone &lt;repo&gt; && cd cthulhu</p>
            <p><span className="text-teal-500">$</span> ./scripts/build-desktop.sh</p>
            <p className="text-gray-600"># Installer output: src-tauri/target/release/bundle/</p>
          </div>
          <p className="text-[10px] text-gray-600 mt-3">
            See <code className="text-gray-500">TAURI_PACKAGING.md</code> for detailed build instructions and platform-specific notes.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-800/30 py-6 px-6 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CthulhuLogo className="w-5 h-5 opacity-40" />
            <span className="text-[10px] text-gray-700">The blockchain is the database. Your wallet is your identity.</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-600">
            <button onClick={() => navigate('/')} className="hover:text-gray-400 transition-colors">Home</button>
            <button onClick={() => navigate('/wiki')} className="hover:text-gray-400 transition-colors">Wiki</button>
            <a href="https://x.com/EMBII4U" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">@EMBII4U</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
