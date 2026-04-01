import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch, FiChevronDown } from 'react-icons/fi';
import { HeaderStatusDots } from './HeaderStatusDots';

export function DesktopHeader({ network, onCreateObject, onOpenWallet, mintedOnNetwork, walkieActive, walkieChannel, pendingTxCount, onShowInkingLog, authConnected }) {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const createRef = useRef(null);

  useEffect(() => {
    if (!showCreate) return;
    const close = (e) => {
      if (createRef.current && !createRef.current.contains(e.target)) setShowCreate(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showCreate]);

  return (
    <header
      className="hidden lg:flex items-center justify-between px-5 h-12 border-b flex-shrink-0 relative z-50"
      style={{ backgroundColor: 'rgba(3, 7, 18, 0.92)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.04)' }}
      data-testid="desktop-header"
    >
      {/* Left: Status indicators */}
      <div className="flex items-center gap-3">
        <HeaderStatusDots walkieActive={walkieActive} walkieChannel={walkieChannel} />
        {pendingTxCount > 0 && (
          <button
            onClick={onShowInkingLog}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors"
            data-testid="header-pending-tx"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {pendingTxCount} inking...
          </button>
        )}
      </div>

      {/* Right: Discover + Create */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/discover')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-white/[0.04] transition-all group"
          data-testid="header-discover-btn"
        >
          <FiSearch size={15} className="group-hover:scale-110 transition-transform" />
          <span className="text-[13px]">Discover</span>
        </button>

        {authConnected && (
          <div className="relative" ref={createRef}>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-[13px] font-medium"
              style={{
                background: showCreate
                  ? 'var(--c-accentMuted)'
                  : 'linear-gradient(135deg, rgba(var(--c-accent-rgb), 0.12), rgba(var(--c-accent-rgb), 0.04))',
                color: 'var(--c-accent)',
                border: '1px solid rgba(var(--c-accent-rgb), 0.18)',
              }}
              data-testid="header-create-btn"
            >
              <InkDropIcon />
              Ink
              <FiChevronDown size={13} className={`transition-transform duration-200 ${showCreate ? 'rotate-180' : ''}`} />
            </button>

            {showCreate && (
              <div
                className="absolute right-0 top-full mt-2 w-60 rounded-xl border shadow-2xl shadow-black/70 py-1.5 z-50 overflow-hidden"
                style={{ backgroundColor: 'rgba(8, 12, 20, 0.98)', backdropFilter: 'blur(24px)', borderColor: 'rgba(255,255,255,0.06)' }}
                data-testid="create-dropdown"
              >
                <CreateItem
                  icon={<ForgeIcon />}
                  label="Forge Artifact"
                  desc="Mint on-chain object"
                  color="#F59E0B"
                  onClick={() => { onCreateObject(); setShowCreate(false); }}
                  testId="create-object-btn"
                />
                <CreateItem
                  icon={<TetherIcon />}
                  label="Summon Tether"
                  desc="Open a chat room"
                  color="#06B6D4"
                  onClick={() => { navigate('/create-tether'); setShowCreate(false); }}
                  testId="create-tether-btn"
                />
                {!mintedOnNetwork && (
                  <CreateItem
                    icon={<IdentityIcon />}
                    label="Ink Identity"
                    desc="Mint your profile"
                    color="#A855F7"
                    onClick={() => { navigate('/setup'); setShowCreate(false); }}
                    testId="create-profile-btn"
                  />
                )}
                <div className="mx-3 my-1 border-t border-white/[0.04]" />
                <CreateItem
                  icon={<TreasuryIcon />}
                  label="Open Treasury"
                  desc="Wallet & funds"
                  color="#10B981"
                  onClick={() => { onOpenWallet(); setShowCreate(false); }}
                  testId="open-wallet-btn"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function CreateItem({ icon, label, desc, color, onClick, testId }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/[0.04] transition-colors group text-left"
      data-testid={testId}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}12`, border: `1px solid ${color}20` }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="text-[13px] font-medium text-gray-200 group-hover:text-white transition-colors">{label}</p>
        <p className="text-[11px] text-gray-500 leading-tight">{desc}</p>
      </div>
    </button>
  );
}

/* Ink drop — the main "Create" button icon */
function InkDropIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" opacity="0.9">
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0L12 2.69z" />
    </svg>
  );
}

/* Forge — hammer for creating objects */
function ForgeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

/* Tether — chain links for rooms */
function TetherIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

/* Identity — ink drop with line for profile minting */
function IdentityIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C12 2 4 10 4 15a8 8 0 0016 0C20 10 12 2 12 2z" />
    </svg>
  );
}

/* Treasury — strongbox for wallet */
function TreasuryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3" />
      <circle cx="12" cy="14" r="2" />
    </svg>
  );
}
