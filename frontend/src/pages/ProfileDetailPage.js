import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FiSend, FiAward, FiBox, FiUser, FiLayers, FiMessageCircle, FiArrowLeft, FiEdit3, FiCheck, FiPlusSquare, FiMessageSquare, FiTrash2, FiKey, FiCopy, FiSlash } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';
import { CachedImage } from '@/components/CachedImage';
import { FeedCard } from '@/components/FeedCard';
import { BurnTetherModal } from '@/components/BurnTetherModal';
import { BatchBurnModal } from '@/components/BatchBurnModal';
import { MonetizedLikeModal } from '@/components/MonetizedLikeModal';
import { useTheme } from '@/hooks/useTheme';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { cachedFetch } from '@/utils/apiCache';
import { meshFirstFetch } from '@/utils/meshFirstFetch';
import { getBurnedAddresses } from '@/utils/burnBlocklist';
import { ProfileSkeleton } from '@/components/SkeletonLoaders';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ProfileDetailPage({ network, isFollowing, toggleFollow, myAddress, blockUser, isBlocked }) {
  const { address } = useParams();
  const navigate = useNavigate();
  const { wallpaperStyle } = useTheme();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Verified image owner badge
  const [isVerifiedImageOwner, setIsVerifiedImageOwner] = useState(false);

  // Impersonation detection
  const [impersonation, setImpersonation] = useState(null); // { detected, official_address }

  // Burn modal
  const [burnTarget, setBurnTarget] = useState(null);

  // Batch burn modal
  const [showBatchBurn, setShowBatchBurn] = useState(false);
  const [batchBurnObjects, setBatchBurnObjects] = useState([]);

  // Posts state (single column feed)
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsHasMore, setPostsHasMore] = useState(true);
  const [postsTotal, setPostsTotal] = useState(0);
  const postsSkipRef = useRef(0);

  // Tethered rooms
  const [tetheredRooms, setTetheredRooms] = useState([]);

  // Object counts for display
  const [objectCount, setObjectCount] = useState(0);

  // Tip modal
  const [showTip, setShowTip] = useState(false);

  // Resolved blockchain address
  const [resolvedAddr, setResolvedAddr] = useState(null);

  // Public key (PKX/PKY) for this profile
  const [pubKeys, setPubKeys] = useState(null);
  const [pkCopied, setPkCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  // Scroll preservation
  const scrollContainerRef = useRef(null);
  const scrollRestoredRef = useRef(false);

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      const el = scrollContainerRef.current;
      if (el && el.scrollTop > 0) {
        try { sessionStorage.setItem(`profile_scroll_${address}`, String(el.scrollTop)); } catch {}
      }
    };
  }, [address]);

  // Restore scroll position after initial data load
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(`profile_scroll_${address}`);
      if (saved) {
        sessionStorage.removeItem(`profile_scroll_${address}`);
        const scrollY = parseInt(saved, 10);
        if (scrollY > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const el = scrollContainerRef.current;
              if (el) el.scrollTop = scrollY;
            });
          });
        }
      }
    } catch {}
  }, [loading, address]);

  useEffect(() => {
    setProfile(null);
    setResolvedAddr(null);
    setLoading(true);
    setPosts([]);
    postsSkipRef.current = 0;
    setPostsHasMore(true);
    setPostsTotal(0);
    fetchProfile();
  }, [address, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchProfile = async () => {
    try {
      const cacheId = `bundle_${address}_${network}`;
      const bundle = await cachedFetch('profile', cacheId,
        async () => {
          const { data: d } = await meshFirstFetch(`/profile/${address}/bundle`, { network });
          return d;
        },
        (freshData) => {
          if (freshData?.profile) {
            setProfile(freshData.profile);
            setResolvedAddr(freshData.profile?.address || address);
          }
          if (freshData?.counts) setObjectCount(freshData.counts.owned || 0);
          if (freshData?.posts) {
            const items = freshData.posts.posts || [];
            setPosts(items);
            setPostsHasMore(freshData.posts.has_more);
            setPostsTotal(freshData.posts.total || 0);
            postsSkipRef.current = items.length;
          }
        }
      );
      if (bundle?.profile) {
        setProfile(bundle.profile);
        setResolvedAddr(bundle.profile?.address || address);
      }
      if (bundle?.counts) setObjectCount(bundle.counts.owned || 0);
      if (bundle?.posts) {
        const items = bundle.posts.posts || [];
        setPosts(items);
        setPostsHasMore(bundle.posts.has_more);
        setPostsTotal(bundle.posts.total || 0);
        postsSkipRef.current = items.length;
      }
    } catch (err) {
      console.error('Profile error:', err);
      setResolvedAddr(address);
    } finally {
      setLoading(false);
    }
  };

  // Fetch tethered rooms from API (owned + created tether objects for this profile)
  useEffect(() => {
    if (!resolvedAddr) return;
    const fetchTethers = async () => {
      try {
        const [ownedRes, createdRes] = await Promise.all([
          meshFirstFetch(`/objects/owned/${resolvedAddr}`, { network, skip: 0, limit: 50 }),
          meshFirstFetch(`/objects/created/${resolvedAddr}`, { network, skip: 0, limit: 50 }),
        ]);
        const allObjs = [...((ownedRes.data?.objects) || []), ...((createdRes.data?.objects) || [])];
        const tethers = allObjs.filter(o => {
          const lic = (o.license || '').toLowerCase();
          return lic.startsWith('cthulhu:tether') && lic !== 'cthulhu:tether:topic';
        });
        const burned = myAddress === resolvedAddr ? getBurnedAddresses(myAddress, network) : new Set();
        const seen = new Set();
        const deduped = [];
        for (const t of tethers) {
          const addr = t.object_address || t.creators?.[0]?.address;
          if (addr && !seen.has(addr) && !burned.has(addr)) {
            seen.add(addr);
            deduped.push({
              objectAddress: addr,
              name: t.name || t.Name || 'Room',
              image: t.image || t.Image,
              description: t.description,
              total_supply: t.total_supply || t.maximum || 1,
              owner_count: t.owner_count || 0,
              owners: t.owners || [],
              listings: t.listings || [],
              is_listed: t.is_listed || false,
              creators: t.creators || [],
            });
          }
        }
        setTetheredRooms(deduped);
      } catch { setTetheredRooms([]); }
    };
    fetchTethers();
  }, [resolvedAddr, network, myAddress]);

  // Fetch object counts (only if bundle didn't provide them)
  useEffect(() => {
    if (!resolvedAddr || objectCount > 0) return;
    cachedFetch('counts', `${resolvedAddr}_${network}`, async () => {
      const { data: d } = await meshFirstFetch(`/objects/counts/${resolvedAddr}`, { network });
      return d;
    }).then(data => {
      setObjectCount(data.owned || 0);
    }).catch(() => {});
  }, [resolvedAddr, network]);

  // Impersonation check: verify if this address is the official claimant for its URN
  useEffect(() => {
    if (!profile?.urn || profile.urn === profile.address) { setImpersonation(null); return; }
    const checkUrn = async () => {
      try {
        const res = await fetch(`${API}/urn/verify/${encodeURIComponent(profile.urn)}?network=${network}`);
        if (res.ok) {
          const data = await res.json();
          if (data.impersonation_detected && data.official_address !== profile.address) {
            setImpersonation({ detected: true, official_address: data.official_address });
          } else {
            setImpersonation(null);
          }
        }
      } catch { setImpersonation(null); }
    };
    checkUrn();
  }, [profile?.urn, profile?.address, network]);

  // Fetch posts
  const fetchPosts = useCallback(async (skip, isReset = false) => {
    if (!resolvedAddr) return;
    if (postsLoading && !isReset) return;
    setPostsLoading(true);
    try {
      const cacheId = `posts_${resolvedAddr}_${network}_${skip}`;
      const data = await cachedFetch('posts', cacheId, async () => {
        const { data: d } = await meshFirstFetch(`/profile/${resolvedAddr}/posts`, { network, skip, limit: 10 });
        return d;
      });
      const items = data.posts || [];
      setPosts(prev => isReset ? items : [...prev, ...items]);
      setPostsHasMore(data.has_more);
      setPostsTotal(data.total || 0);
      postsSkipRef.current = skip + 10;
    } catch {
      setPostsHasMore(false);
    } finally {
      setPostsLoading(false);
    }
  }, [resolvedAddr, network, postsLoading]);

  // Load posts when profile resolves (only if bundle didn't provide them)
  useEffect(() => {
    if (resolvedAddr && posts.length === 0 && !loading) fetchPosts(0, true);
  }, [resolvedAddr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Verified badge
  useEffect(() => {
    if (!resolvedAddr) return;
    setIsVerifiedImageOwner(false);
    meshFirstFetch(`/profile/${resolvedAddr}/verified_image`, { network })
      .then(({ data }) => { if (data?.verified) setIsVerifiedImageOwner(true); })
      .catch(() => {});
  }, [resolvedAddr, network]);

  // Fetch public keys (PKX/PKY) for encryption
  useEffect(() => {
    if (!resolvedAddr) return;
    setPubKeys(null);
    meshFirstFetch(`/profile/keys/${resolvedAddr}`, { network })
      .then(({ data }) => { if (data?.has_keys) setPubKeys({ pkx: data.pkx, pky: data.pky }); })
      .catch(() => {});
  }, [resolvedAddr, network]);

  const handleCopyPubKeys = () => {
    if (!pubKeys) return;
    const text = `PKX: ${pubKeys.pkx}\nPKY: ${pubKeys.pky}`;
    navigator.clipboard?.writeText(text).then(() => {
      setPkCopied(true);
      setTimeout(() => setPkCopied(false), 2000);
    });
  };

  if (loading) {
    return <ProfileSkeleton />;
  }

  if (!profile) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xl text-gray-400">Profile not found</p>
      </div>
    );
  }

  const isOwnProfile = myAddress && profile.address === myAddress;
  const mediaOpts = { mainnet: isMainnetNetwork(network) };

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto" style={wallpaperStyle} data-testid="profile-page">
      {/* Back header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/80 backdrop-blur-sm border-b border-gray-800/60 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="profile-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <span className="text-sm font-medium text-gray-300 truncate">{(profile?.display_name && profile?.display_name !== profile?.address) ? profile.display_name : profile?.urn || 'Profile'}</span>
      </div>

      {/* Profile Header */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-lg mx-auto px-6 pt-8 pb-6">
          {/* Avatar */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-gray-700/50">
                <ProfileThumb name={profile.urn || profile.address} image={profile.image} size="xl" address={profile.address} />
              </div>
              {isVerifiedImageOwner && (
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center border-2 border-gray-900" title="Owns profile image as on-chain object" data-testid="verified-owner-badge">
                  <FiAward size={14} className="text-gray-900" />
                </div>
              )}
            </div>
          </div>

          {/* Name + URN */}
          <div className="text-center mb-3">
            <h1 className="text-xl font-bold text-gray-100 flex items-center justify-center gap-2" data-testid="profile-name">
              {(profile.display_name && profile.display_name !== profile.address) ? profile.display_name : (profile.urn && profile.urn !== profile.address) ? profile.urn : profile.address?.slice(0, 16) + '...'}
              {isVerifiedImageOwner && (
                <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-semibold rounded-full inline-flex items-center gap-0.5" data-testid="verified-text-badge">
                  <FiAward size={9} /> Verified
                </span>
              )}
            </h1>
            {profile.urn && profile.urn !== profile.address && (
              <div className="flex items-center justify-center gap-2 mt-0.5">
                <p className="text-sm" style={{ color: 'var(--c-accent, #8b5cf6)' }} data-testid="profile-urn">@{profile.urn}</p>
                {impersonation?.detected && (
                  <button
                    onClick={() => navigate(`/profile/${impersonation.official_address}`)}
                    className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-bold rounded-full border border-red-500/30 hover:bg-red-500/30 transition-colors cursor-pointer"
                    title="This is not the original claimant of this URN. Click to see the official profile."
                    data-testid="not-official-badge"
                  >
                    NOT OFFICIAL
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bio */}
          {profile.bio && <p className="text-sm text-gray-400 text-center mb-4 whitespace-pre-wrap max-w-sm mx-auto">{profile.bio}</p>}

          {/* Links */}
          {profile.url && typeof profile.url === 'object' && (
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {Object.entries(profile.url).map(([key, url]) => {
                const strVal = typeof url === 'string' ? url : '';
                const isUrl = strVal.match(/^https?:\/\//i);
                const looksLikeUrl = !isUrl && strVal.match(/^[a-zA-Z0-9][\w.-]+\.[a-zA-Z]{2,}/);
                const href = isUrl ? strVal : looksLikeUrl ? `https://${strVal}` : null;

                // Render clickable link
                if (href) return (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded-full transition-colors" data-testid={`profile-url-${key}`}>
                    {key}
                  </a>
                );

                // Render text with @mention links
                const parts = strVal.split(/(@\w+)/g);
                const hasAtMention = parts.some(p => p.startsWith('@'));
                return (
                  <span key={key} className="px-3 py-1 bg-gray-800 text-xs text-gray-400 rounded-full">
                    {hasAtMention ? parts.map((part, i) =>
                      part.startsWith('@') ? (
                        <a key={i} onClick={async (e) => {
                          e.preventDefault();
                          const urn = part.slice(1);
                          try {
                            const res = await fetch(`${API}/profile/${encodeURIComponent(urn)}?network=${network}`);
                            if (res.ok) {
                              const data = await res.json();
                              navigate(`/profile/${data.address || urn}`);
                            } else { navigate(`/profile/${urn}`); }
                          } catch { navigate(`/profile/${urn}`); }
                        }}
                          className="text-emerald-400 hover:underline cursor-pointer" data-testid={`profile-mention-${part.slice(1)}`}>{part}</a>
                      ) : <span key={i}>{part}</span>
                    ) : `${key}: ${strVal}`}
                  </span>
                );
              })}
            </div>
          )}

          {/* Address + Public Key */}
          {profile.address && (
            <div className="flex items-center justify-center gap-2 mb-5">
              <button
                onClick={() => { navigator.clipboard?.writeText(profile.address); setAddrCopied(true); setTimeout(() => setAddrCopied(false), 1500); }}
                className="flex items-center gap-1.5 group"
                title="Copy address"
                data-testid="copy-profile-address"
              >
                <span className="text-[11px] text-gray-600 font-mono truncate max-w-[200px]">{profile.address.slice(0, 8)}...{profile.address.slice(-6)}</span>
                <span className={`transition-colors ${addrCopied ? 'text-emerald-400' : 'text-gray-600 group-hover:text-gray-300'}`}>
                  {addrCopied ? <FiCheck size={11} /> : <FiCopy size={11} />}
                </span>
              </button>
              {pubKeys && (
                <button
                  onClick={handleCopyPubKeys}
                  className={`p-1 rounded-md transition-colors ${pkCopied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-500 hover:text-gray-300'}`}
                  title="Copy public encryption keys (PKX/PKY)"
                  data-testid="copy-pub-keys-btn"
                >
                  {pkCopied ? <FiCheck size={12} /> : <FiKey size={12} />}
                </button>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-center gap-3 sm:gap-5 flex-wrap">
            {isOwnProfile ? (
              <>
                <ActionBtn icon={FiEdit3} label="Edit" onClick={() => navigate('/profile/edit')} testId="profile-edit-btn" />
                <ActionBtn icon={FiLayers} label="Vault" onClick={() => navigate('/vault')} testId="vault-button" accent />
                <ActionBtn icon={FiPlusSquare} label="Ink Objkt" onClick={() => navigate('/create-object')} testId="ink-objkt-btn" />
                <ActionBtn icon={FiBox} label="Objects" onClick={() => navigate(`/profile/${profile.address}/objects`)} testId="profile-objects-btn" count={objectCount} />
                <ActionBtn icon={FiTrash2} label="Burn" onClick={async () => {
                  try {
                    const res = await axios.get(`${API}/objects/owned/${resolvedAddr}`, { params: { network, skip: 0, limit: 200 } });
                    setBatchBurnObjects(res.data?.objects || []);
                  } catch { setBatchBurnObjects([]); }
                  setShowBatchBurn(true);
                }} testId="profile-batch-burn-btn" />
              </>
            ) : (
              <>
                <ActionBtn
                  icon={isFollowing(profile.address) ? FiCheck : FiUser}
                  label={isFollowing(profile.address) ? 'Following' : 'Follow'}
                  onClick={() => toggleFollow(profile)}
                  active={isFollowing(profile.address)}
                  testId="follow-button"
                />
                <ActionBtn icon={FiMessageCircle} label="Message" onClick={() => navigate(`/dm/${resolvedAddr || profile.address}`)} testId="dm-button" accent />
                <ActionBtn icon={FiSend} label="Tip" onClick={() => setShowTip(true)} testId="tip-button" />
                <ActionBtn icon={FiBox} label="Objects" onClick={() => navigate(`/profile/${profile.address}/objects`)} testId="profile-objects-btn" count={objectCount} />
                <ActionBtn
                  icon={FiSlash}
                  label={isBlocked?.(profile.address) ? 'Blocked' : 'Block'}
                  onClick={() => blockUser?.(profile.address, profile.urn || '')}
                  active={isBlocked?.(profile.address)}
                  testId="block-button"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tethers Section — shows for any profile with tethered rooms */}
      {tetheredRooms.length > 0 && (
        <div className="border-b border-gray-800" data-testid="profile-tethers-section">
          <div className="max-w-lg mx-auto px-4 py-4">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">{isOwnProfile ? 'Your Tethers' : 'Tethers'}</p>
            <div className="space-y-2">
              {tetheredRooms.map(room => {
                const parsed = parseMediaString(room.image, mediaOpts);
                const roomImg = parsed?.url || null;
                const supply = room.total_supply || 1;
                const listedCount = (room.listings || []).length;
                const isPublic = supply <= 1;
                const desc = room.description || '';
                return (
                  <div key={room.objectAddress} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-800/40 hover:bg-gray-800/70 transition-colors group">
                    <button
                      onClick={() => navigate(`/room/${room.objectAddress}`)}
                      className="flex items-center gap-3 flex-1 min-w-0"
                      data-testid={`tether-room-${room.objectAddress}`}
                    >
                      <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-gray-700/50 group-hover:border-purple-500/60 transition-colors bg-gray-800 flex-shrink-0 flex items-center justify-center">
                        {roomImg ? (
                          <CachedImage src={roomImg} alt={room.name} className="w-full h-full object-cover" />
                        ) : (
                          <FiMessageSquare size={16} className="text-gray-500" />
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-sm text-gray-300 font-medium truncate">{room.name || 'Room'}</p>
                        {isPublic ? (
                          <p className="text-[10px] text-gray-500 truncate">Public Room{desc ? ': ' + desc.slice(0, 50) : ''}</p>
                        ) : (
                          <p className="text-[10px] text-gray-500">
                            {listedCount > 0
                              ? <span className="text-green-400">{listedCount} seat{listedCount !== 1 ? 's' : ''} available</span>
                              : 'Gated'
                            }
                          </p>
                        )}
                      </div>
                    </button>
                    {isOwnProfile && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setBurnTarget(room); }}
                        className="p-2 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Burn tether"
                        data-testid={`burn-tether-${room.objectAddress}`}
                      >
                        <FiTrash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Posts Feed — single column */}
      <div className="p-4">
        <div className="max-w-lg mx-auto" data-testid="profile-posts-feed">
          {posts.length === 0 && !postsLoading ? (
            <div className="text-center py-12">
              <FiEdit3 size={32} className="mx-auto text-gray-700 mb-3" />
              <p className="text-lg text-gray-400">No posts yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <FeedCard
                  key={post.transaction_id}
                  item={post}
                  network={network}
                />
              ))}
            </div>
          )}

          {postsHasMore && posts.length > 0 && (
            <div className="mt-6 text-center">
              <button
                onClick={() => fetchPosts(postsSkipRef.current)}
                disabled={postsLoading}
                className="px-8 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
                data-testid="posts-load-more"
              >
                {postsLoading ? 'Loading...' : `Load More (${posts.length} of ${postsTotal})`}
              </button>
            </div>
          )}

          {postsLoading && posts.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mx-auto mb-2" />
              Loading posts...
            </div>
          )}
        </div>
      </div>

      {/* Burn Tether Modal */}
      {burnTarget && (
        <BurnTetherModal
          tether={burnTarget}
          network={network}
          onClose={() => setBurnTarget(null)}
          onBurned={(addr) => {
            setTetheredRooms(prev => prev.filter(r => r.objectAddress !== addr));
            setBurnTarget(null);
          }}
        />
      )}

      {/* Tip Modal */}
      {showTip && (
        <MonetizedLikeModal
          txid={null}
          authorUrn={profile?.urn || profile?.display_name}
          authorAddress={resolvedAddr || profile?.address}
          onClose={() => setShowTip(false)}
          onConfirm={async (sats) => {
            try {
              setShowTip(false);
              alert(`Tip of ${sats} sats would be sent to ${profile?.urn || profile?.address}. Feature coming soon!`);
            } catch (err) {
              console.error('Tip error:', err);
            }
          }}
        />
      )}

      {showBatchBurn && (
        <BatchBurnModal
          ownedObjects={batchBurnObjects}
          network={network}
          onClose={() => setShowBatchBurn(false)}
          onBurned={() => setShowBatchBurn(false)}
        />
      )}
    </div>
  );
}


function ActionBtn({ icon: Icon, label, onClick, accent, active, testId, count }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 min-w-[52px]" data-testid={testId}>
      <div
        className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
        style={accent ? { backgroundColor: 'var(--c-accent, #8b5cf6)' } : active ? {} : { backgroundColor: 'rgba(75, 85, 99, 0.3)' }}
      >
        <Icon size={18} className={accent ? 'text-white' : active ? 'text-gray-200' : 'text-gray-400'} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white px-1 leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </div>
      <span className={`text-[11px] ${accent ? '' : 'text-gray-500'}`} style={accent ? { color: 'var(--c-accent)' } : {}}>{label}</span>
    </button>
  );
}