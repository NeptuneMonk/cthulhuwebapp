import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDownload, FiArrowLeft, FiAlertTriangle, FiMonitor, FiCpu, FiGlobe, FiShield, FiRefreshCw } from 'react-icons/fi';
import { CthulhuLogo } from '@/components/CthulhuLogo';

const API = process.env.REACT_APP_BACKEND_URL;

export default function DownloadPage() {
  const navigate = useNavigate();
  const [release, setRelease] = useState(null);
  const [loading, setLoading] = useState(true);

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

      {/* Experimental Banner */}
      <div className="max-w-3xl mx-auto px-6 mt-4">
        <div className="bg-amber-900/15 border border-amber-600/30 rounded-xl px-5 py-4" data-testid="experimental-banner">
          <div className="flex items-start gap-3">
            <FiAlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={18} />
            <div>
              <p className="text-sm font-semibold text-amber-400">Experimental Beta</p>
              <p className="text-xs text-amber-400/70 leading-relaxed mt-1">
                Cthulhu is an experimental work in progress. Both the desktop app and web app are in active development.
                There are no guarantees that accounts or data will always be available during this beta phase.
                Your private key (WIF) is your identity — <span className="text-amber-300">back it up</span>. As long as you have your key, you can always recover your on-chain identity.
                We encourage use and welcome suggestions.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-12 pb-8 text-center">
        <CthulhuLogo className="w-20 h-20 mx-auto mb-6 drop-shadow-[0_0_30px_rgba(13,148,136,0.3)]" />
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-300">
            Download Cthulhu
          </span>
        </h1>
        <p className="mt-3 text-sm text-gray-500 max-w-lg mx-auto">
          Run your own node. Own your data. The desktop app includes a local P2FK decoder,
          IPFS daemon, and auto-delta indexer — no central server required.
        </p>
      </section>

      {/* Download Card */}
      <section className="max-w-3xl mx-auto px-6 pb-8">
        <div className="rounded-2xl border border-gray-800/50 bg-gray-900/30 backdrop-blur-sm p-6 md:p-8">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-3 text-gray-500">
              <FiRefreshCw className="animate-spin" size={16} />
              <span className="text-sm">Checking for latest release...</span>
            </div>
          ) : release ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">{release.name || 'Cthulhu Desktop'}</h2>
                  <p className="text-xs text-gray-500 mt-1">Version {release.version} &middot; {new Date(release.published_at).toLocaleDateString()}</p>
                </div>
                <span className="px-3 py-1 text-[10px] uppercase tracking-widest font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  Beta
                </span>
              </div>

              {release.description && (
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">{release.description}</p>
              )}

              {release.changelog && (
                <div className="bg-gray-950/50 border border-gray-800/30 rounded-lg p-4 mb-6">
                  <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Changelog</p>
                  <p className="text-xs text-gray-500 whitespace-pre-wrap">{release.changelog}</p>
                </div>
              )}

              {/* Platform Downloads */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <a
                  href={release.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-teal-600/10 border border-teal-600/20 hover:bg-teal-600/20 transition-colors group"
                  data-testid="download-windows"
                >
                  <FiMonitor className="text-teal-400" size={20} />
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-teal-300 transition-colors">Windows</p>
                    <p className="text-[10px] text-gray-600">.msi installer</p>
                  </div>
                  <FiDownload className="ml-auto text-gray-600 group-hover:text-teal-400 transition-colors" size={14} />
                </a>
                <a
                  href={release.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800/30 border border-gray-800/50 hover:bg-gray-800/50 transition-colors group"
                  data-testid="download-mac"
                >
                  <FiCpu className="text-gray-400" size={20} />
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-gray-100 transition-colors">macOS</p>
                    <p className="text-[10px] text-gray-600">.dmg bundle</p>
                  </div>
                  <FiDownload className="ml-auto text-gray-600 group-hover:text-gray-400 transition-colors" size={14} />
                </a>
                <a
                  href={release.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800/30 border border-gray-800/50 hover:bg-gray-800/50 transition-colors group"
                  data-testid="download-linux"
                >
                  <FiGlobe className="text-gray-400" size={20} />
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-gray-100 transition-colors">Linux</p>
                    <p className="text-[10px] text-gray-600">.AppImage / .deb</p>
                  </div>
                  <FiDownload className="ml-auto text-gray-600 group-hover:text-gray-400 transition-colors" size={14} />
                </a>
              </div>

              <p className="text-[10px] text-gray-600 text-center">
                All downloads are unsigned beta builds. IPFS CID: <code className="text-gray-500 font-mono">{release.zip_cid?.slice(0, 24)}...</code>
              </p>
            </>
          ) : (
            <div className="text-center py-8">
              <FiDownload className="mx-auto text-gray-700 mb-3" size={32} />
              <p className="text-sm text-gray-500">No release published yet.</p>
              <p className="text-xs text-gray-600 mt-2">Check back soon — or build from source below.</p>
            </div>
          )}
        </div>
      </section>

      {/* What's Different */}
      <section className="max-w-3xl mx-auto px-6 pb-8">
        <h3 className="text-sm font-semibold text-gray-400 tracking-widest uppercase mb-4">Desktop vs. Web</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: FiShield, title: 'Wallet-Only Auth', desc: 'No passwords or server accounts. Your WIF key is your identity, stored encrypted on your device.' },
            { icon: FiCpu, title: 'Local IPFS Node', desc: 'Built-in Kubo daemon. You pin and serve content directly — full participation in the decentralized network.' },
            { icon: FiRefreshCw, title: 'Auto-Delta Indexer', desc: 'Automatically sweeps the blockchain every 15 minutes. Stay current even if the central server goes offline.' },
            { icon: FiGlobe, title: 'Mesh Gossip', desc: 'Receives snapshot CIDs from the mesh network for instant sync. No dependency on on-chain announcements.' },
          ].map((item, i) => (
            <div key={i} className="p-4 rounded-xl bg-gray-900/20 border border-gray-800/30">
              <div className="flex items-center gap-2 mb-2">
                <item.icon className="text-teal-500" size={14} />
                <p className="text-xs font-semibold text-gray-300">{item.title}</p>
              </div>
              <p className="text-[11px] text-gray-600 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Build from Source */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <div className="rounded-2xl border border-gray-800/30 bg-gray-900/15 p-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Build from Source</h3>
          <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-gray-500 space-y-1 overflow-x-auto">
            <p className="text-gray-600"># Prerequisites: Rust, Node.js 18+, Tauri CLI</p>
            <p><span className="text-teal-500">$</span> cargo install tauri-cli</p>
            <p><span className="text-teal-500">$</span> git clone &lt;repo&gt; && cd cthulhu</p>
            <p><span className="text-teal-500">$</span> cd frontend && yarn install</p>
            <p><span className="text-teal-500">$</span> cd ../src-tauri && cargo tauri build</p>
          </div>
          <p className="text-[10px] text-gray-600 mt-3">
            See <code className="text-gray-500">TAURI_PACKAGING.md</code> in the repository for detailed instructions.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-800/30 py-6 px-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-center gap-3">
          <CthulhuLogo className="w-5 h-5 opacity-40" />
          <span className="text-[10px] text-gray-700">The blockchain is the database. IPFS is the file system.</span>
        </div>
      </footer>
    </div>
  );
}
