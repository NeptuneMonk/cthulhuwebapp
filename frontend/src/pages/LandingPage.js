import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiDownload, FiShield, FiZap, FiLayers, FiMessageCircle, FiRadio, FiBook } from 'react-icons/fi';
import { CthulhuLogo, CTHULHU_SVG } from '@/components/CthulhuLogo';

const HERO_BG = 'https://static.prod-images.emergentagent.com/jobs/e5b98d28-4dd7-46f1-ae5a-d3d5d3df74c0/images/8f2623a8faf8afa5e184a8e67a6ec164d543ef6f9168a977ca199f5ae1cab1b5.png';
const IMG_ARTIFACT = 'https://images.unsplash.com/photo-1718265596340-13147a2c1aa0?w=600&q=80';
const IMG_NETWORK = 'https://images.unsplash.com/photo-1643409471378-cdab0f97d983?w=600&q=80';
const IMG_COSMIC = 'https://images.unsplash.com/photo-1714171056117-f58040d6f5eb?w=600&q=80';
const IMG_ABYSS = 'https://images.unsplash.com/photo-1761937841816-a00b8fffa8fb?w=600&q=80';

const FEATURES = [
  { icon: FiLayers, title: 'On-Chain Objects', desc: 'Mint, trade, and collect tokenized artifacts across Bitcoin, Litecoin, and Dogecoin.' },
  { icon: FiMessageCircle, title: 'Encrypted Messages', desc: 'End-to-end encrypted private messages. Your keys, your words, your sovereignty.' },
  { icon: FiShield, title: 'Client-Side Security', desc: 'Your private key never leaves your device. All transactions signed locally.' },
  { icon: FiRadio, title: 'Walkie-Talkie', desc: 'Push-to-talk voice broadcasts stored permanently on IPFS and the blockchain.' },
  { icon: FiZap, title: 'Multi-Chain', desc: 'BTC, LTC, DOGE — switch networks seamlessly. One protocol, many chains.' },
  { icon: FiBook, title: 'SUP Protocol', desc: 'Built on the Satoshi Universal Protocol. Fully interoperable, fully decentralized.' },
];

function FloatingOrb({ style, delay = 0 }) {
  return (
    <div
      className="absolute rounded-full blur-3xl opacity-20 pointer-events-none"
      style={{
        ...style,
        animation: `float ${8 + delay}s ease-in-out infinite`,
        animationDelay: `${delay}s`,
      }}
    />
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const featuresRef = useRef(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-30px) scale(1.05); }
      }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes glow {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.7; }
      }
      .fade-up { animation: fadeUp 0.8s ease-out forwards; opacity: 0; }
      .fade-up-d1 { animation-delay: 0.15s; }
      .fade-up-d2 { animation-delay: 0.3s; }
      .fade-up-d3 { animation-delay: 0.45s; }
      .fade-up-d4 { animation-delay: 0.6s; }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <div className="min-h-screen bg-[#030608] text-gray-100 overflow-x-hidden" data-testid="landing-page">

      {/* Floating orbs */}
      <FloatingOrb style={{ width: 400, height: 400, top: '10%', left: '-5%', background: 'radial-gradient(circle, #0d9488 0%, transparent 70%)' }} delay={0} />
      <FloatingOrb style={{ width: 300, height: 300, top: '60%', right: '-3%', background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }} delay={2} />
      <FloatingOrb style={{ width: 250, height: 250, bottom: '20%', left: '30%', background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} delay={4} />

      {/* ═══════════════ NAV ═══════════════ */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <CthulhuLogo className="w-10 h-10" />
          <span className="text-lg font-bold tracking-wider text-teal-400">CTHULHU</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/wiki')}
            className="hidden sm:inline-flex text-sm text-gray-400 hover:text-teal-400 transition-colors px-3 py-1.5"
            data-testid="landing-wiki-link"
          >
            Wiki
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="text-sm font-medium px-5 py-2 rounded-full bg-teal-600/20 text-teal-400 border border-teal-600/30 hover:bg-teal-600/30 transition-all"
            data-testid="landing-login-btn"
          >
            Launch App
          </button>
        </div>
      </nav>

      {/* ═══════════════ HERO ═══════════════ */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-12 pb-24 md:pt-20 md:pb-36 max-w-5xl mx-auto">
        {/* Hero background image */}
        <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-15">
          <img src={HERO_BG} alt="" className="w-full h-full object-cover rounded-3xl" loading="lazy" />
        </div>

        <CthulhuLogo
          className="w-28 h-28 md:w-36 md:h-36 mb-8 drop-shadow-[0_0_40px_rgba(13,148,136,0.4)] fade-up"
          alt="Cthulhu Logo"
        />

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight fade-up fade-up-d1">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 via-cyan-300 to-purple-400">
            Speak to the Future
          </span>
        </h1>

        <p className="mt-5 text-base md:text-lg text-gray-400 max-w-2xl leading-relaxed fade-up fade-up-d2">
          In the depths of the blockchain, ancient artifacts await discovery.
          Cthulhu is a decentralized social platform where every message, every object,
          and every identity is etched permanently into the chain — a digital record
          that outlives us all.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 fade-up fade-up-d3">
          <button
            onClick={() => navigate('/auth')}
            className="group flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold text-sm tracking-wide hover:shadow-lg hover:shadow-teal-600/25 transition-all"
            data-testid="landing-cta-launch"
          >
            Launch App
            <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
          </button>
          <button
            className="flex items-center justify-center gap-2 px-8 py-3.5 rounded-full border border-gray-700 text-gray-400 text-sm tracking-wide hover:border-gray-500 hover:text-gray-200 transition-all cursor-default"
            data-testid="landing-cta-download"
            title="Coming soon"
          >
            <FiDownload size={16} />
            Download App
            <span className="text-[10px] uppercase tracking-widest text-gray-600 ml-1">Soon</span>
          </button>
        </div>
      </section>

      {/* ═══════════════ FEATURES ═══════════════ */}
      <section ref={featuresRef} className="relative z-10 px-6 md:px-12 pb-24 max-w-6xl mx-auto">
        <h2 className="text-base md:text-lg font-semibold text-teal-400/80 tracking-widest uppercase text-center mb-12">
          What Lies Beneath
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="group relative p-6 rounded-2xl bg-gray-900/40 border border-gray-800/50 backdrop-blur-sm hover:border-teal-800/40 hover:bg-gray-900/60 transition-all duration-300"
              data-testid={`feature-card-${i}`}
            >
              <div className="w-10 h-10 rounded-xl bg-teal-900/30 flex items-center justify-center mb-4 group-hover:bg-teal-800/40 transition-colors">
                <f.icon className="text-teal-400" size={20} />
              </div>
              <h3 className="text-sm font-semibold text-gray-100 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ VISUAL STRIP ═══════════════ */}
      <section className="relative z-10 px-6 pb-24 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[IMG_ARTIFACT, IMG_NETWORK, IMG_COSMIC, IMG_ABYSS].map((src, i) => (
            <div key={i} className="aspect-square rounded-2xl overflow-hidden border border-gray-800/30 relative group">
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-105 transition-all duration-500"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#030608] via-transparent to-transparent" />
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════ LORE / ABOUT ═══════════════ */}
      <section className="relative z-10 px-6 md:px-12 pb-24 max-w-4xl mx-auto">
        <div className="rounded-3xl border border-gray-800/40 bg-gray-900/20 backdrop-blur-sm p-8 md:p-12">
          <h2 className="text-base md:text-lg font-semibold text-purple-400/80 tracking-widest uppercase mb-6">
            The Ancient Protocol
          </h2>
          <div className="space-y-4 text-sm text-gray-400 leading-relaxed">
            <p>
              Before there were smart contracts, before NFT standards, there was <span className="text-teal-400 font-medium">P2FK</span> —
              Pay to Future Key. A method of encoding arbitrary data into the oldest, most battle-tested blockchains:
              Bitcoin, Litecoin, and Dogecoin.
            </p>
            <p>
              The <span className="text-teal-400 font-medium">Satoshi Universal Protocol (SUP)</span> builds on this primitive
              to create profiles, posts, objects, and encrypted messages — all stored directly in transaction outputs.
              No smart contracts. No oracles. Just pure cryptographic data woven into the fabric of the chain.
            </p>
            <p>
              <span className="text-purple-400 font-medium">Cthulhu</span> is the awakening. A modern interface to this
              ancient protocol — built by <span className="text-gray-300">embii4u</span> and the community of on-chain
              archaeologists who believe that the most valuable data should live forever, immune to censorship,
              owned by those who create it.
            </p>
            <p className="text-gray-500 italic">
              "In the deep, where no server can reach, our words endure."
            </p>
            <p className="text-[11px] text-gray-600 mt-4">
            </p>
          </div>
          <button
            onClick={() => navigate('/wiki')}
            className="mt-8 inline-flex items-center gap-2 text-sm text-teal-400 hover:text-teal-300 transition-colors"
            data-testid="landing-wiki-cta"
          >
            <FiBook size={16} />
            Read the full Wiki
            <FiArrowRight size={14} />
          </button>
        </div>
      </section>

      {/* ═══════════════ CTA BANNER ═══════════════ */}
      <section className="relative z-10 px-6 md:px-12 pb-24 max-w-4xl mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-100 mb-4">
          Ready to dive in?
        </h2>
        <p className="text-sm text-gray-500 mb-8 max-w-lg mx-auto">
          Create your on-chain identity. Mint objects. Send messages that outlast civilizations.
        </p>
        <button
          onClick={() => navigate('/auth')}
          className="group inline-flex items-center gap-2 px-10 py-4 rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold tracking-wide hover:shadow-xl hover:shadow-teal-600/20 transition-all"
          data-testid="landing-cta-bottom"
        >
          Enter Cthulhu
          <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
        </button>
      </section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <footer className="relative z-10 border-t border-gray-800/30 py-8 px-6 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CthulhuLogo className="w-6 h-6 opacity-60" />
            <span className="text-xs text-gray-600">Cthulhu &mdash; Built on SUP / P2FK</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-600">
            <button onClick={() => navigate('/admin')} className="hover:text-gray-400 transition-colors">Admin</button>
            <button onClick={() => navigate('/wiki')} className="hover:text-gray-400 transition-colors">Wiki</button>
            <a href="https://x.com/EMBII4U" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">@EMBII4U</a>
            <a href="https://embii.wtf" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">embii.wtf</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
