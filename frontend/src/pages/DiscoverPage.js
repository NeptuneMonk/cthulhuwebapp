import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiSearch, FiArrowLeft, FiBox, FiUser, FiFilm, FiMusic, FiImage, FiFile, FiGlobe, FiPlay, FiHash, FiClock, FiFileText, FiMessageSquare, FiCode, FiDatabase, FiCopy, FiCheck } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';
import { parseMediaString } from '@/utils/media';

const API = process.env.REACT_APP_BACKEND_URL;
const IPFS_GW = 'https://ipfs.io/ipfs';

const VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv'];
const AUDIO_EXT = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

function classifyExt(filename) {
  const lower = (filename || '').toLowerCase();
  if (VIDEO_EXT.some(e => lower.endsWith(e))) return 'video';
  if (AUDIO_EXT.some(e => lower.endsWith(e))) return 'audio';
  if (IMAGE_EXT.some(e => lower.endsWith(e))) return 'image';
  return 'document';
}

function parseIpfsRefs(messageArr) {
  const refs = [];
  const content = (messageArr || []).map(m => String(m)).join(' ');
  const seen = new Set();

  const delimited = /<<IPFS:([^>]+)>>/g;
  let match;
  while ((match = delimited.exec(content)) !== null) {
    const raw = match[1].replace(/\\/g, '/');
    const parts = raw.split('/');
    const cid = parts[0];
    const filename = parts.length > 1 ? parts.slice(1).join('/') : cid;
    const key = `${cid}/${filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = parts.length > 1
      ? `${IPFS_GW}/${cid}/${encodeURIComponent(parts.slice(1).join('/'))}`
      : `${IPFS_GW}/${cid}`;
    const fallbackUrl = `${IPFS_GW}/${cid}`;
    const type = classifyExt(filename);
    refs.push({ cid, filename, url, fallbackUrl, type });
  }

  const inline = /IPFS:([^\s<>]+)/g;
  while ((match = inline.exec(content)) !== null) {
    const raw = match[1].replace(/\\/g, '/');
    const parts = raw.split('/');
    const cid = parts[0];
    const filename = parts.length > 1 ? parts.slice(1).join('/') : cid;
    const key = `${cid}/${filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = parts.length > 1
      ? `${IPFS_GW}/${cid}/${encodeURIComponent(parts.slice(1).join('/'))}`
      : `${IPFS_GW}/${cid}`;
    const fallbackUrl = `${IPFS_GW}/${cid}`;
    const type = classifyExt(filename);
    refs.push({ cid, filename, url, fallbackUrl, type });
  }

  return { refs, content };
}

/** Strip IPFS markup and satoshi markers from message text for clean display */
function cleanMessage(messageArr) {
  return (messageArr || [])
    .map(m => String(m))
    .join(' ')
    .replace(/<<IPFS:[^>]+>>/g, '')
    .replace(/<<-?\d+>>/g, '')
    .replace(/IPFS:\S+/g, '')
    .trim();
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'objects', label: 'Objects' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'onchain', label: 'On-chain' },
  { id: 'media', label: 'Media' },
];

export default function DiscoverPage({ network }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeTab, setActiveTab] = useState('all');
  const [results, setResults] = useState({ messages: [], objects: [], profiles: [], onchain: [], media: [] });
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [displayLimits, setDisplayLimits] = useState({ messages: 20, objects: 20, profiles: 20, onchain: 20, media: 20 });
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q && q.trim().length >= 2) {
      setQuery(q);
      doSearch(q);
    }
  }, []); // eslint-disable-line

  const doSearch = useCallback(async (searchQuery) => {
    const trimmed = (searchQuery || '').trim();
    if (trimmed.length < 2) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setHasSearched(true);
    setDisplayLimits({ messages: 20, objects: 20, profiles: 20, onchain: 20, media: 20 });
    setSearchParams({ q: trimmed });

    try {
      // Primary: GetKnownRootsBySearchString — the main discovery source
      // Secondary: GetKnownProfilesBySearchString — dedicated profile results
      // Tertiary: GetKnownObjectsBySearchString — dedicated object results
      const [rootsRes, profilesRes, objectsRes] = await Promise.allSettled([
        fetch(`${API}/api/p2fk/search/roots?searchString=${encodeURIComponent(trimmed)}&qty=200&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/p2fk/search/profiles?searchString=${encodeURIComponent(trimmed)}&qty=60&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/p2fk/search/objects?searchString=${encodeURIComponent(trimmed)}&qty=60&skip=0&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
      ]);

      if (!controller.signal.aborted) {
        const rawRoots = rootsRes.status === 'fulfilled' ? (Array.isArray(rootsRes.value) ? rootsRes.value : []) : [];

        // Categorize roots
        const messages = [];
        const onchainItems = [];
        const mediaItems = [];
        const seenTxids = new Set();

        for (const item of rawRoots) {
          const root = item.root || item;
          const txid = root.TransactionId || root.transactionId || '';
          if (txid && seenTxids.has(txid)) continue;
          if (txid) seenTxids.add(txid);

          const fileKeys = Object.keys(root.File || {}).filter(f => f !== 'SIG' && f !== 'LNK');
          const hasFiles = fileKeys.length > 0;
          const rawMsg = root.Message || [];
          const cleanText = cleanMessage(rawMsg);
          const { refs } = parseIpfsRefs(rawMsg);
          const signedBy = root.SignedBy || '';
          const blockDate = root.BlockDate || '';
          const blockchain = item.blockchain || '';

          // Extract media from IPFS refs
          for (const ref of refs) {
            mediaItems.push({
              ...ref,
              txid,
              signedBy,
              blockchain,
              blockDate,
            });
          }

          // On-chain injections: roots with actual files embedded on-chain
          if (hasFiles) {
            const fileSizes = root.File || {};
            const keywords = [];
            for (const val of Object.values(root.Keyword || {})) {
              if (typeof val === 'string' && val.startsWith('2')) {
                const tag = val.slice(1).replace(/#+$/g, '').trim();
                if (tag && !tag.includes('\uFFFD') && tag.length > 1) keywords.push(tag);
              }
            }
            onchainItems.push({
              txid,
              blockchain,
              signedBy,
              signed: root.Signed || false,
              files: fileKeys,
              fileSizes,
              keywords,
              totalByteSize: root.TotalByteSize || 0,
              blockDate,
              buildDate: root.BuildDate || '',
              messagePreview: cleanText.slice(0, 200),
            });
          }

          // Messages: signed roots with actual text content
          if (root.Signed && cleanText.length > 0) {
            messages.push({
              txid,
              blockchain,
              signedBy,
              text: cleanText,
              hasMedia: refs.length > 0,
              mediaCount: refs.length,
              blockDate,
              blockHeight: root.BlockHeight || 0,
            });
          }
        }

        setResults({
          messages,
          objects: Array.isArray(objectsRes.status === 'fulfilled' ? objectsRes.value : [])
            ? (objectsRes.status === 'fulfilled' ? objectsRes.value : []) : [],
          profiles: Array.isArray(profilesRes.status === 'fulfilled' ? profilesRes.value : [])
            ? (profilesRes.status === 'fulfilled' ? profilesRes.value : []) : [],
          onchain: onchainItems,
          media: mediaItems,
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setResults({ messages: [], objects: [], profiles: [], onchain: [], media: [] });
      }
    }
    setLoading(false);
  }, [setSearchParams, network]);

  const handleSubmit = (e) => {
    e.preventDefault();
    doSearch(query);
  };

  const show = {
    messages: (activeTab === 'all' || activeTab === 'messages') ? results.messages : [],
    objects: (activeTab === 'all' || activeTab === 'objects') ? results.objects : [],
    profiles: (activeTab === 'all' || activeTab === 'profiles') ? results.profiles : [],
    onchain: (activeTab === 'all' || activeTab === 'onchain') ? results.onchain : [],
    media: (activeTab === 'all' || activeTab === 'media') ? results.media : [],
  };

  const sortedMedia = [...show.media].sort((a, b) => {
    const order = { video: 0, image: 1, audio: 2, document: 3 };
    return (order[a.type] || 4) - (order[b.type] || 4);
  });

  const displayMessages = show.messages.slice(0, displayLimits.messages);
  const displayObjects = show.objects.slice(0, displayLimits.objects);
  const displayProfiles = show.profiles.slice(0, displayLimits.profiles);
  const displayOnchain = show.onchain.slice(0, displayLimits.onchain);
  const displayMedia = sortedMedia.slice(0, displayLimits.media);

  const totalCount = results.messages.length + results.objects.length + results.profiles.length + results.onchain.length + results.media.length;

  const ShowMoreBtn = ({ category, totalCount }) => {
    const currentLimit = displayLimits[category];
    if (currentLimit >= totalCount) return null;
    return (
      <button
        onClick={() => setDisplayLimits(prev => ({ ...prev, [category]: prev[category] + 20 }))}
        className="w-full py-2.5 text-xs text-purple-400 hover:text-purple-300 bg-gray-800/30 hover:bg-gray-800/50 rounded-lg transition-colors mt-3"
        data-testid={`discover-show-more-${category}`}
      >
        Show more ({totalCount - currentLimit} remaining)
      </button>
    );
  };

  return (
    <div className="h-full overflow-y-auto pb-20" data-testid="discover-page">
      {/* Sticky Search Header */}
      <div className="sticky top-0 z-10 border-b" style={{ backgroundColor: 'rgba(3, 7, 18, 0.95)', backdropFilter: 'blur(12px)', borderColor: 'rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="discover-back-btn">
            <FiArrowLeft size={18} />
          </button>
          <form onSubmit={handleSubmit} className="flex-1 relative">
            <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the P2FK blockchain..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-800/50 text-gray-100 rounded-xl border border-gray-700/40 focus:border-purple-500/50 focus:outline-none text-sm placeholder-gray-600"
              autoFocus
              data-testid="discover-search-input"
            />
          </form>
        </div>

        {hasSearched && (
          <div className="flex gap-1 px-4 pb-2.5 overflow-x-auto no-scrollbar">
            {TABS.map(tab => {
              const count = tab.id === 'messages' ? results.messages.length
                : tab.id === 'objects' ? results.objects.length
                : tab.id === 'profiles' ? results.profiles.length
                : tab.id === 'onchain' ? results.onchain.length
                : tab.id === 'media' ? results.media.length
                : totalCount;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border'
                      : 'text-gray-500 bg-gray-800/40 hover:text-gray-300'
                  }`}
                  style={activeTab === tab.id ? { backgroundColor: 'var(--c-accentMuted)', borderColor: 'rgba(var(--c-accent-rgb), 0.25)', color: 'var(--c-accent)' } : {}}
                  data-testid={`discover-tab-${tab.id}`}
                >
                  {tab.label}
                  {tab.id !== 'all' && <span className="ml-1 opacity-50">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 max-w-3xl mx-auto space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-transparent" style={{ borderTopColor: 'var(--c-accent)' }} />
          </div>
        )}

        {!loading && hasSearched && totalCount === 0 && (
          <div className="text-center py-16">
            <FiSearch size={28} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">No results for &ldquo;{query}&rdquo;</p>
            <p className="text-xs text-gray-600 mt-1">Try different keywords or check spelling</p>
          </div>
        )}

        {!loading && !hasSearched && (
          <div className="text-center py-20 space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-800/40 border border-gray-700/30 flex items-center justify-center">
              <FiGlobe size={26} className="text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-300 font-medium">Search the P2FK blockchain</p>
              <p className="text-xs text-gray-600 mt-1">Find messages, objects, profiles, and on-chain data across all chains</p>
            </div>
          </div>
        )}

        {/* Messages */}
        {!loading && displayMessages.length > 0 && (
          <Section title="Messages" count={show.messages.length} icon={FiMessageSquare}>
            {displayMessages.map((msg, i) => {
              const date = msg.blockDate ? new Date(msg.blockDate).toLocaleDateString() : '';
              return (
                <button
                  key={`msg-${i}`}
                  onClick={() => msg.signedBy && navigate(`/profile/${msg.signedBy}`)}
                  className="w-full flex items-start gap-3 px-3 py-3 hover:bg-white/[0.03] transition-colors text-left"
                  data-testid={`discover-message-${i}`}
                >
                  <div className="w-9 h-9 rounded-lg border border-teal-800/20 bg-teal-900/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FiMessageSquare size={14} className="text-teal-400/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-200 line-clamp-3 leading-relaxed">{msg.text}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Copyable value={msg.signedBy} label={msg.signedBy?.slice(0, 14) + '...'} className="text-gray-500" />
                      {date && (
                        <span className="text-[10px] text-gray-600 inline-flex items-center gap-0.5">
                          <FiClock size={8} />{date}
                        </span>
                      )}
                      {msg.hasMedia && (
                        <span className="text-[10px] text-blue-400/60 inline-flex items-center gap-0.5">
                          <FiImage size={8} />{msg.mediaCount}
                        </span>
                      )}
                      {msg.txid && (
                        <Copyable value={msg.txid} label={`tx:${msg.txid.slice(0, 10)}...`} className="text-gray-600" />
                      )}
                    </div>
                  </div>
                  <ChainBadge chain={msg.blockchain} />
                </button>
              );
            })}
            <ShowMoreBtn category="messages" totalCount={show.messages.length} />
          </Section>
        )}

        {/* Objects */}
        {!loading && displayObjects.length > 0 && (
          <Section title="Objects" count={show.objects.length} icon={FiBox}>
            {displayObjects.map((item, i) => {
              const obj = item.object || item;
              const name = obj.Name || obj.name || obj.URN || 'Untitled';
              const image = obj.Image || obj.image;
              const desc = obj.Description || obj.description || '';
              const chain = item.blockchain || '';
              const creators = obj.Creators || obj.creators || [];
              let addr = '';
              if (Array.isArray(creators) && creators.length > 0) {
                addr = creators[0]?.Address || creators[0]?.address || (typeof creators[0] === 'string' ? creators[0] : '');
              } else if (typeof creators === 'object' && creators !== null) {
                addr = Object.keys(creators)[0] || '';
              }
              const urn = obj.URN || obj.urn || '';
              return (
                <div
                  key={`obj-${i}`}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left cursor-pointer"
                  onClick={() => addr && navigate(`/object/addr/${addr}`)}
                  data-testid={`discover-object-${i}`}
                >
                  <ObjImg src={image} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">{name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {urn && <Copyable value={urn} label={urn.length > 30 ? urn.slice(0, 28) + '...' : urn} className="text-purple-400/60" />}
                      {addr && <Copyable value={addr} label={addr.slice(0, 14) + '...'} className="text-gray-500" />}
                    </div>
                  </div>
                  <ChainBadge chain={chain} />
                </div>
              );
            })}
            <ShowMoreBtn category="objects" totalCount={show.objects.length} />
          </Section>
        )}

        {/* Profiles */}
        {!loading && displayProfiles.length > 0 && (
          <Section title="Profiles" count={show.profiles.length} icon={FiUser}>
            {displayProfiles.map((item, i) => {
              const profile = item.profile || item;
              const urn = profile.URN || profile.urn || '';
              const name = profile.Name || profile.name || urn;
              const image = profile.Image || profile.image;
              let addr = profile.Address || profile.address || '';
              if (!addr) {
                const creators = profile.Creators || profile.creators || [];
                if (Array.isArray(creators) && creators.length > 0) {
                  addr = typeof creators[0] === 'string' ? creators[0] : (creators[0]?.Address || creators[0]?.address || '');
                }
              }
              const chain = item.blockchain || '';
              return (
                <div
                  key={`prof-${i}`}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left cursor-pointer"
                  onClick={() => addr && navigate(`/profile/${addr}`)}
                  data-testid={`discover-profile-${i}`}
                >
                  <ProfileThumb name={urn || name} image={image ? (parseMediaString(image)?.url || image) : null} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">{name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {urn && <Copyable value={urn} label={`@${urn}`} className="text-purple-400/60" />}
                      {addr && <Copyable value={addr} label={addr.slice(0, 14) + '...'} className="text-gray-500" />}
                    </div>
                  </div>
                  <ChainBadge chain={chain} />
                </div>
              );
            })}
            <ShowMoreBtn category="profiles" totalCount={show.profiles.length} />
          </Section>
        )}

        {/* On-chain Injections */}
        {!loading && displayOnchain.length > 0 && (
          <Section title="On-chain Injections" count={show.onchain.length} icon={FiDatabase}>
            {displayOnchain.map((item, i) => {
              const totalKB = item.totalByteSize > 0 ? (item.totalByteSize / 1024).toFixed(1) : null;
              const date = item.blockDate ? new Date(item.blockDate).toLocaleDateString() : '';
              return (
                <div
                  key={`onchain-${i}`}
                  className="w-full flex items-start gap-3 px-3 py-3 hover:bg-white/[0.03] transition-colors text-left"
                  data-testid={`discover-onchain-${i}`}
                >
                  <div className="w-9 h-9 rounded-lg border border-amber-800/20 bg-amber-900/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FiCode size={14} className="text-amber-500/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* File list */}
                    <div className="flex flex-wrap gap-1 mb-1">
                      {item.files.slice(0, 4).map((f, fi) => (
                        <span key={fi} className="text-xs text-gray-300 bg-gray-800/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                          <FiFileText size={10} className="text-gray-500" />
                          {f.length > 28 ? f.slice(0, 25) + '...' : f}
                        </span>
                      ))}
                      {item.files.length > 4 && (
                        <span className="text-[10px] text-gray-600">+{item.files.length - 4} more</span>
                      )}
                    </div>
                    {/* Message preview */}
                    {item.messagePreview && (
                      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{item.messagePreview}</p>
                    )}
                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {item.signed && item.signedBy && (
                        <Copyable value={item.signedBy} label={item.signedBy.slice(0, 14) + '...'} className="text-teal-400/60 hover:text-teal-300" />
                      )}
                      {item.keywords.slice(0, 5).map((kw, ki) => (
                        <span key={ki} className="text-[10px] text-amber-400/60 bg-amber-900/10 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <FiHash size={8} />{kw}
                        </span>
                      ))}
                      {date && (
                        <span className="text-[10px] text-gray-600 inline-flex items-center gap-0.5">
                          <FiClock size={8} />{date}
                        </span>
                      )}
                      {totalKB && (
                        <span className="text-[10px] text-gray-600">{totalKB} KB</span>
                      )}
                      {item.txid && (
                        <Copyable value={item.txid} label={`tx:${item.txid.slice(0, 12)}...`} className="text-gray-500" />
                      )}
                    </div>
                  </div>
                  <ChainBadge chain={item.blockchain} />
                </div>
              );
            })}
            <ShowMoreBtn category="onchain" totalCount={show.onchain.length} />
          </Section>
        )}

        {/* Media (IPFS references from roots) */}
        {!loading && displayMedia.length > 0 && (
          <Section title="Media" count={sortedMedia.length} icon={FiFilm}>
            {displayMedia.map((item, i) => {
              const TypeIcon = item.type === 'video' ? FiFilm
                : item.type === 'audio' ? FiMusic
                : item.type === 'image' ? FiImage : FiFile;
              const iconColor = item.type === 'video' ? 'text-red-400'
                : item.type === 'audio' ? 'text-purple-400'
                : item.type === 'image' ? 'text-blue-400' : 'text-gray-400';
              const bgColor = item.type === 'video' ? 'bg-red-900/15 border-red-800/15'
                : item.type === 'audio' ? 'bg-purple-900/15 border-purple-800/15'
                : item.type === 'image' ? 'bg-blue-900/15 border-blue-800/15'
                : 'bg-gray-800/40 border-gray-700/20';

              const handleClick = () => {
                if (item.type === 'video') {
                  navigate(`/supflix?play=${encodeURIComponent(item.url)}&fallback=${encodeURIComponent(item.fallbackUrl || '')}&name=${encodeURIComponent(item.filename)}`);
                } else if (item.type === 'image') {
                  window.open(item.url, '_blank');
                } else if (item.type === 'audio') {
                  navigate(`/jukebox?play=${encodeURIComponent(item.url)}&fallback=${encodeURIComponent(item.fallbackUrl || '')}&name=${encodeURIComponent(item.filename)}`);
                } else {
                  window.open(item.url, '_blank');
                }
              };

              return (
                <button
                  key={`media-${i}`}
                  onClick={handleClick}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left group"
                  data-testid={`discover-media-${i}`}
                >
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${bgColor}`}>
                    <TypeIcon size={14} className={iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate group-hover:text-white">{item.filename}</p>
                    <p className="text-[10px] text-gray-600 capitalize">{item.type}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ChainBadge chain={item.blockchain} />
                    {item.type === 'video' && (
                      <div className="w-6 h-6 rounded-full bg-red-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <FiPlay size={10} className="text-red-400 ml-0.5" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            <ShowMoreBtn category="media" totalCount={sortedMedia.length} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, icon: Icon, children }) {
  return (
    <div data-testid={`discover-section-${title.toLowerCase().replace(/[^a-z]/g, '-')}`}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon size={13} className="text-gray-500" />
        <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
        <span className="text-[10px] text-gray-600 bg-gray-800/40 px-1.5 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="rounded-xl border overflow-hidden divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.01)', divideColor: 'rgba(255,255,255,0.03)' }}>
        {children}
      </div>
    </div>
  );
}

function ObjImg({ src }) {
  const parsed = src ? parseMediaString(src) : null;
  const url = parsed?.url || null;
  const fallbackUrl = parsed?.fallbackUrl || null;
  if (!url) return <div className="w-9 h-9 rounded-lg bg-gray-800/60 flex items-center justify-center flex-shrink-0"><FiBox size={14} className="text-gray-600" /></div>;
  return <img src={url} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-800 flex-shrink-0" onError={e => {
    if (fallbackUrl && e.target.src !== fallbackUrl) {
      e.target.src = fallbackUrl;
    } else {
      e.target.src = ''; e.target.className = 'w-9 h-9 rounded-lg bg-gray-800 flex-shrink-0';
    }
  }} />;
}

function ChainBadge({ chain }) {
  if (!chain) return null;
  return <span className="text-[10px] text-gray-600 bg-gray-800/40 px-1.5 py-0.5 rounded flex-shrink-0">{chain}</span>;
}

function Copyable({ value, label, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const display = label || (value.length > 16 ? value.slice(0, 14) + '...' : value);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`inline-flex items-center gap-1 text-[10px] hover:text-gray-300 transition-colors group/copy ${className}`}
      title={`Click to copy: ${value}`}
      data-testid={`copy-${value.slice(0, 8)}`}
    >
      <span className="truncate">{display}</span>
      {copied
        ? <FiCheck size={9} className="text-green-400 flex-shrink-0" />
        : <FiCopy size={9} className="opacity-0 group-hover/copy:opacity-60 flex-shrink-0" />
      }
    </button>
  );
}
