import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiSearch, FiArrowLeft, FiBox, FiUser, FiFilm, FiMusic, FiImage, FiFile, FiGlobe, FiPlay, FiLayers, FiHash, FiExternalLink, FiClock, FiFileText } from 'react-icons/fi';
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

  // Pattern 1: Delimited <<IPFS:CID\filename with spaces.ext>> (handles spaces)
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
    // Primary: CID/filename (directory CIDs), Fallback: CID-only (file CIDs)
    const url = parts.length > 1
      ? `${IPFS_GW}/${cid}/${encodeURIComponent(parts.slice(1).join('/'))}`
      : `${IPFS_GW}/${cid}`;
    const fallbackUrl = `${IPFS_GW}/${cid}`;
    const type = classifyExt(filename);
    refs.push({ cid, filename, url, fallbackUrl, type });
  }

  // Pattern 2: Inline IPFS:CID\filename (no delimiters, stops at whitespace)
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

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'objects', label: 'Objects' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'media', label: 'Media' },
  { id: 'fossils', label: 'Deep Search' },
];

export default function DiscoverPage({ network }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeTab, setActiveTab] = useState('all');
  const [results, setResults] = useState({ objects: [], profiles: [], media: [], fossils: [] });
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [displayLimits, setDisplayLimits] = useState({ objects: 20, profiles: 20, media: 20, fossils: 20 });
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
    setDisplayLimits({ objects: 20, profiles: 20, media: 20, fossils: 20 });
    setSearchParams({ q: trimmed });

    try {
      const [objectsRes, profilesRes, rootsRes] = await Promise.allSettled([
        fetch(`${API}/api/p2fk/search/objects?searchString=${encodeURIComponent(trimmed)}&qty=60&skip=0&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/p2fk/search/profiles?searchString=${encodeURIComponent(trimmed)}&qty=60&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/p2fk/search/roots?searchString=${encodeURIComponent(trimmed)}&qty=60&network=${network}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : []),
      ]);

      if (!controller.signal.aborted) {
        const rawRoots = rootsRes.status === 'fulfilled' ? (Array.isArray(rootsRes.value) ? rootsRes.value : []) : [];

        // Parse IPFS media from roots
        const mediaItems = [];
        for (const item of rawRoots) {
          const root = item.root || item;
          const { refs, content } = parseIpfsRefs(root.Message || root.message);
          for (const ref of refs) {
            mediaItems.push({
              ...ref,
              txid: root.TransactionId || root.transactionId || '',
              content: content.slice(0, 200),
              blockchain: item.blockchain || '',
              blockDate: root.BlockDate || '',
            });
          }
        }

        // Parse unclaimed fossils from roots (Signed: false only, deduplicated by Hash)
        const fossilItems = [];
        const seenHashes = new Set();
        for (const item of rawRoots) {
          const root = item.root || item;
          if (root.Signed === true) continue;
          const hash = root.Hash || root.TransactionId || '';
          if (hash && seenHashes.has(hash)) continue;
          if (hash) seenHashes.add(hash);
          const files = root.File || {};
          const fileNames = Object.keys(files).filter(f => f !== 'SIG' && f !== 'LNK');
          const keywords = [];
          for (const val of Object.values(root.Keyword || {})) {
            if (typeof val === 'string' && val.startsWith('2')) {
              const tag = val.slice(1).replace(/#+$/g, '').trim();
              if (tag && !tag.includes('\uFFFD') && tag.length > 1) keywords.push(tag);
            }
          }
          const messages = (root.Message || []).filter(m => m && typeof m === 'string' && m.trim());
          fossilItems.push({
            txid: root.TransactionId || '',
            blockchain: item.blockchain || '',
            messages,
            files: fileNames,
            fileSizes: files,
            keywords,
            totalByteSize: root.TotalByteSize || 0,
            blockDate: root.BlockDate || '',
            buildDate: root.BuildDate || '',
            hash,
          });
        }

        setResults({
          objects: Array.isArray(objectsRes.status === 'fulfilled' ? objectsRes.value : [])
            ? (objectsRes.status === 'fulfilled' ? objectsRes.value : []) : [],
          profiles: Array.isArray(profilesRes.status === 'fulfilled' ? profilesRes.value : [])
            ? (profilesRes.status === 'fulfilled' ? profilesRes.value : []) : [],
          media: mediaItems,
          fossils: fossilItems,
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setResults({ objects: [], profiles: [], media: [], fossils: [] });
      }
    }
    setLoading(false);
  }, [setSearchParams]);

  const handleSubmit = (e) => {
    e.preventDefault();
    doSearch(query);
  };

  const show = {
    objects: (activeTab === 'all' || activeTab === 'objects') ? results.objects : [],
    profiles: (activeTab === 'all' || activeTab === 'profiles') ? results.profiles : [],
    media: (activeTab === 'all' || activeTab === 'media') ? results.media : [],
    fossils: (activeTab === 'all' || activeTab === 'fossils') ? results.fossils : [],
  };

  // Sort media: videos first, then images, audio, documents
  const sortedMedia = [...show.media].sort((a, b) => {
    const order = { video: 0, image: 1, audio: 2, document: 3 };
    return (order[a.type] || 4) - (order[b.type] || 4);
  });

  // Apply display limits
  const displayObjects = show.objects.slice(0, displayLimits.objects);
  const displayProfiles = show.profiles.slice(0, displayLimits.profiles);
  const displayMedia = sortedMedia.slice(0, displayLimits.media);
  const displayFossils = show.fossils.slice(0, displayLimits.fossils);

  const totalCount = results.objects.length + results.profiles.length + results.media.length + results.fossils.length;

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
              placeholder="Search objects, profiles, media..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-800/50 text-gray-100 rounded-xl border border-gray-700/40 focus:border-purple-500/50 focus:outline-none text-sm placeholder-gray-600"
              autoFocus
              data-testid="discover-search-input"
            />
          </form>
        </div>

        {hasSearched && (
          <div className="flex gap-1 px-4 pb-2.5">
            {TABS.map(tab => {
              const count = tab.id === 'objects' ? results.objects.length
                : tab.id === 'profiles' ? results.profiles.length
                : tab.id === 'media' ? results.media.length
                : tab.id === 'fossils' ? results.fossils.length : totalCount;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
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
              <p className="text-xs text-gray-600 mt-1">Find objects, profiles, and on-chain media across all chains</p>
            </div>
          </div>
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
              // Creators can be: array of objects [{Address:...}], array of strings, or dict {addr: date}
              const creators = obj.Creators || obj.creators || [];
              let addr = '';
              if (Array.isArray(creators) && creators.length > 0) {
                addr = creators[0]?.Address || creators[0]?.address || (typeof creators[0] === 'string' ? creators[0] : '');
              } else if (typeof creators === 'object' && creators !== null) {
                // P2FK returns Creators as dict: {address: date}
                addr = Object.keys(creators)[0] || '';
              }
              return (
                <button
                  key={`obj-${i}`}
                  onClick={() => addr && navigate(`/object/addr/${addr}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
                  data-testid={`discover-object-${i}`}
                >
                  <ObjImg src={image} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">{name}</p>
                    <p className="text-xs text-gray-500 truncate">{desc || (addr ? `${addr.slice(0, 18)}...` : '')}</p>
                  </div>
                  <ChainBadge chain={chain} />
                </button>
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
              // Address can be: profile.Address, profile.address, or first creator
              let addr = profile.Address || profile.address || '';
              if (!addr) {
                const creators = profile.Creators || profile.creators || [];
                if (Array.isArray(creators) && creators.length > 0) {
                  addr = typeof creators[0] === 'string' ? creators[0] : (creators[0]?.Address || creators[0]?.address || '');
                }
              }
              const chain = item.blockchain || '';
              return (
                <button
                  key={`prof-${i}`}
                  onClick={() => addr && navigate(`/profile/${addr}`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
                  data-testid={`discover-profile-${i}`}
                >
                  <ProfileThumb name={urn || name} image={image ? (parseMediaString(image)?.url || image) : null} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200 truncate">{name}</p>
                    {urn && urn !== name && <p className="text-xs text-purple-400/60 truncate">@{urn}</p>}
                  </div>
                  <ChainBadge chain={chain} />
                </button>
              );
            })}
            <ShowMoreBtn category="profiles" totalCount={show.profiles.length} />
          </Section>
        )}

        {/* Media (parsed from roots) */}
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

        {/* Deep Search: Unclaimed Fossils */}
        {!loading && displayFossils.length > 0 && (
          <Section title="Deep Search" count={show.fossils.length} icon={FiLayers}>
            {displayFossils.map((fossil, i) => {
              const msgPreview = fossil.messages.join(' ').slice(0, 140);
              const hasFiles = fossil.files.length > 0;
              const totalKB = fossil.totalByteSize > 0 ? (fossil.totalByteSize / 1024).toFixed(1) : null;
              const fossilUrl = `https://bitfossil.com/${fossil.txid}/index.htm`;
              const blockDate = fossil.blockDate ? new Date(fossil.blockDate).toLocaleDateString() : '';

              return (
                <a
                  key={`fossil-${i}`}
                  href={fossilUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-start gap-3 px-3 py-3 hover:bg-white/[0.03] transition-colors text-left group"
                  data-testid={`discover-fossil-${i}`}
                >
                  <div className="w-9 h-9 rounded-lg border border-amber-800/20 bg-amber-900/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FiLayers size={14} className="text-amber-500/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Primary info: files or message preview */}
                    {hasFiles ? (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {fossil.files.slice(0, 4).map((f, fi) => (
                          <span key={fi} className="text-xs text-gray-300 bg-gray-800/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                            <FiFileText size={10} className="text-gray-500" />
                            {f.length > 28 ? f.slice(0, 25) + '...' : f}
                          </span>
                        ))}
                        {fossil.files.length > 4 && (
                          <span className="text-[10px] text-gray-600">+{fossil.files.length - 4} more</span>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300 truncate">{fossil.txid.slice(0, 16)}...</p>
                    )}
                    {/* Message preview */}
                    {msgPreview && (
                      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{msgPreview}{fossil.messages.join(' ').length > 140 ? '...' : ''}</p>
                    )}
                    {/* Tags row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {fossil.keywords.slice(0, 5).map((kw, ki) => (
                        <span key={ki} className="text-[10px] text-amber-400/60 bg-amber-900/10 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                          <FiHash size={8} />
                          {kw}
                        </span>
                      ))}
                      {blockDate && (
                        <span className="text-[10px] text-gray-600 inline-flex items-center gap-0.5">
                          <FiClock size={8} />
                          {blockDate}
                        </span>
                      )}
                      {totalKB && (
                        <span className="text-[10px] text-gray-600">{totalKB} KB</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 mt-1">
                    <ChainBadge chain={fossil.blockchain} />
                    <FiExternalLink size={12} className="text-gray-700 group-hover:text-amber-500/50 transition-colors" />
                  </div>
                </a>
              );
            })}
            <ShowMoreBtn category="fossils" totalCount={show.fossils.length} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, icon: Icon, children }) {
  return (
    <div data-testid={`discover-section-${title.toLowerCase()}`}>
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
