import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiMessageCircle, FiSearch, FiRadio, FiSettings, FiUser, FiFilm, FiMusic } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { isIOS } from '@/utils/deviceDetect';

const IPFS_GW = 'https://ipfs.io/ipfs/';
function resolveImg(img) {
  if (!img) return null;
  if (img.startsWith('http') || img.startsWith('data:') || img.startsWith('blob:')) return img;
  if (img.startsWith('Qm') || img.startsWith('bafy')) return `${IPFS_GW}${img}`;
  return img;
}

export function BottomNav({ network, dmBadge = 0, walkieActive = false, incomingCall = null, walkieSender = null, onAnswerCall }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isConnected } = useAuth();

  // Track desktop breakpoint — swap tabs via conditional rendering (not CSS hiding)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // iOS: Hide bottom nav when virtual keyboard is open to prevent overlap
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (!isIOS || typeof visualViewport === 'undefined') return;
    const vv = window.visualViewport;
    const onResize = () => setKeyboardOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const path = location.pathname;
  const profilePath = isConnected && user?.address ? `/profile/${user.address}` : '/auth';

  const isChats = path === '/chats' || path === '/feed' || path === '/';
  const isSupflix = path === '/supflix';
  const isJukebox = path === '/jukebox';
  const isContacts = path === '/profiles' || path.startsWith('/search') || path === '/objects';
  const isSettings = path === '/settings';
  const isProfile = isConnected && user?.address && path === `/profile/${user.address}`;
  const isWalkie = path === '/walkie';

  const handleWalkieClick = () => {
    if (incomingCall && onAnswerCall) {
      onAnswerCall(); // Clear the global incoming call state
    }
    navigate('/walkie');
  };

  // iOS: hide bottom nav when keyboard is open so it doesn't block the compose area
  if (keyboardOpen) return null;

  return (
    <nav
      className="flex-shrink-0 border-t border-gray-800/60"
      style={{ backgroundColor: 'rgba(3, 7, 18, 0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
      data-testid="bottom-nav"
    >
      <div className="max-w-3xl mx-auto flex items-end justify-around h-14 px-1" style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
        {/* Mobile: Chats tab | Desktop: SUPflix tab (conditional, not CSS hiding) */}
        {isDesktop ? (
          <TabBtn icon={FiFilm} label="SUPflix" active={isSupflix} onClick={() => navigate('/supflix')} />
        ) : (
          <TabBtn icon={FiMessageCircle} label="Chats" active={isChats} badge={dmBadge} onClick={() => navigate('/chats')} />
        )}

        <TabBtn icon={FiSearch} label="Contacts" active={isContacts} onClick={() => navigate('/profiles')} />

        {/* Walkie Talkie FAB — color = power state, avatar = incoming call/broadcast */}
        <div className="flex flex-col items-center -mt-3 pb-0.5">
          {(() => {
            // Show avatar from incoming call (priority) or walkie broadcast sender
            const avatarSource = incomingCall || walkieSender;
            const isRinging = !!incomingCall;
            return (
              <button
                onClick={handleWalkieClick}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 active:scale-90 overflow-hidden ${
                  isRinging
                    ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-gray-950 shadow-green-500/40'
                    : avatarSource
                      ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-950'
                      : isWalkie
                        ? 'ring-2 ring-offset-2 ring-offset-gray-950'
                        : ''
                }`}
                style={{
                  backgroundColor: isRinging || avatarSource
                    ? '#16a34a'
                    : walkieActive
                      ? '#16a34a'
                      : '#374151',
                  boxShadow: isRinging
                    ? '0 0 20px rgba(34,197,94,0.6), 0 0 40px rgba(34,197,94,0.2)'
                    : avatarSource
                      ? '0 0 16px rgba(34,197,94,0.5)'
                      : walkieActive
                        ? '0 0 12px rgba(34,197,94,0.35)'
                        : '0 4px 6px rgba(0,0,0,0.5)',
                  animation: isRinging ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }}
                data-testid="bottom-nav-walkie-fab"
              >
                {avatarSource?.image ? (
                  <img
                    src={resolveImg(avatarSource.image)}
                    alt={avatarSource.urn || ''}
                    className="w-full h-full object-cover"
                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div
                  className={`w-full h-full items-center justify-center ${avatarSource?.image ? 'hidden' : 'flex'}`}
                >
                  {avatarSource ? (
                    <span className="text-white text-[10px] font-bold font-mono leading-tight text-center px-0.5">
                      {(avatarSource.urn || '?').slice(0, 4)}
                    </span>
                  ) : (
                    <FiRadio size={20} className={walkieActive ? 'text-white' : 'text-gray-400'} />
                  )}
                </div>
              </button>
            );
          })()}
        </div>

        <TabBtn icon={FiSettings} label="Settings" active={isSettings} onClick={() => navigate('/settings')} />

        {/* Profile tab + Jukebox (desktop only, conditional rendering) */}
        <TabBtn icon={FiUser} label="Profile" active={isProfile} onClick={() => navigate(profilePath)} />
        {isDesktop && (
          <TabBtn icon={FiMusic} label="Jukebox" active={isJukebox} onClick={() => navigate('/jukebox')} />
        )}
      </div>
    </nav>
  );
}

function TabBtn({ icon: Icon, label, active, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-end min-w-[48px] pb-1 transition-colors"
      data-testid={`bottom-nav-${label.toLowerCase()}`}
    >
      <div className="relative">
        <Icon
          size={22}
          className={active ? '' : 'text-gray-500'}
          style={active ? { color: 'var(--c-accent, #8b5cf6)' } : {}}
        />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1 leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span
        className={`text-[10px] mt-0.5 leading-tight ${active ? 'font-medium' : 'text-gray-500'}`}
        style={active ? { color: 'var(--c-accent, #8b5cf6)' } : {}}
      >
        {label}
      </span>
    </button>
  );
}
