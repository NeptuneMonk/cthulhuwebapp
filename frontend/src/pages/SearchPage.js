import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FiSearch, FiArrowLeft, FiUser, FiGrid, FiMessageSquare, FiFile, FiLoader } from 'react-icons/fi';
import { ProfileThumb } from '@/components/ProfileThumb';
import { ObjectCard } from '@/components/ObjectCard';
import { FeedCard } from '@/components/FeedCard';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FILTERS = [
  { key: 'all', label: 'All', icon: FiSearch },
  { key: 'users', label: 'Users', icon: FiUser },
  { key: 'objects', label: 'Objects', icon: FiGrid },
  { key: 'posts', label: 'Posts', icon: FiMessageSquare },
  { key: 'files', label: 'Files', icon: FiFile },
];

function isFileObject(obj) {
  const file = obj?.File || obj?.file || '';
  const name = (obj?.Name || obj?.name || '').toLowerCase();
  const ext = file.split('.').pop()?.toLowerCase() || name.split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'zip', 'doc', 'docx', 'txt', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'md'].includes(ext);
}

function postHasFiles(post) {
  const files = post?.files;
  return files && typeof files === 'object' && Object.keys(files).length > 0;
}

export default function SearchPage({ network, follows, toggleFollow, myAddress }) {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const navigate = useNavigate();

  const [results, setResults] = useState({ profiles: [], objects: [], posts: [] });
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(query);
  const [activeFilter, setActiveFilter] = useState('all');
  const [displayLimit, setDisplayLimit] = useState({ profiles: 10, objects: 12, posts: 10 });

  useEffect(() => {
    if (query) {
      setSearchInput(query);
      setDisplayLimit({ profiles: 10, objects: 12, posts: 10 });
      performSearch(query);
    }
  }, [query, network]);

  const performSearch = async (term) => {
    setLoading(true);
    setActiveFilter('all');
    try {
      const res = await axios.post(`${API}/search`, { query: term, network });
      setResults(res.data);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchInput.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchInput.trim())}`);
    }
  };

  // Derive file objects from the objects list
  const fileObjects = useMemo(() =>
    (results.objects || []).filter(isFileObject),
    [results.objects]
  );

  // Posts with file attachments
  const filePosts = useMemo(() =>
    (results.posts || []).filter(postHasFiles),
    [results.posts]
  );

  // Filter counts
  const counts = useMemo(() => ({
    all: (results.profiles?.length || 0) + (results.objects?.length || 0) + (results.posts?.length || 0),
    users: results.profiles?.length || 0,
    objects: results.objects?.length || 0,
    posts: results.posts?.length || 0,
    files: fileObjects.length + filePosts.length,
  }), [results, fileObjects, filePosts]);

  const hasResults = counts.all > 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="search-page">
      {/* Mobile back header */}
      <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="search-back-btn">
          <FiArrowLeft size={20} />
        </button>
        <span className="text-sm font-medium text-gray-300">Discover</span>
      </div>

      <div className="p-4 lg:p-6">
        <div className="max-w-4xl mx-auto">
          {/* Search input */}
          <form onSubmit={handleSubmit} className="relative mb-4">
            <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={16} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search #keyword, username, or address..."
              className="w-full pl-10 pr-4 py-3 bg-gray-800 text-gray-100 rounded-lg border border-gray-700 focus:border-amber-500/60 focus:outline-none text-sm"
              data-testid="search-page-input"
            />
          </form>

          {/* Filter tabs */}
          {query && (
            <div className="flex gap-1.5 mb-5 overflow-x-auto scrollbar-hide pb-1" data-testid="search-filters">
              {FILTERS.map(f => {
                const count = counts[f.key];
                const isActive = activeFilter === f.key;
                const Icon = f.icon;
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    data-testid={`filter-${f.key}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-gray-800/60 text-gray-400 border border-gray-700/50 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <Icon size={12} />
                    {f.label}
                    {count > 0 && (
                      <span className={`min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isActive ? 'bg-amber-500/30 text-amber-300' : 'bg-gray-700 text-gray-400'
                      }`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Results heading */}
          {query && !loading && (
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-base font-semibold text-gray-200" data-testid="search-results-heading">
                {hasResults ? `Results for "${query}"` : `No results for "${query}"`}
              </h2>
              {hasResults && (
                <span className="text-xs text-gray-500">{counts.all} total</span>
              )}
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <FiLoader size={24} className="animate-spin mb-3 text-amber-500/60" />
              <span className="text-sm">Searching blockchain...</span>
            </div>
          )}

          {/* No results */}
          {!loading && !hasResults && query && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3 opacity-30">?</div>
              <p className="text-base font-medium text-gray-400 mb-2">No results found</p>
              <p className="text-sm text-gray-600">Try a different keyword, #hashtag, or address.</p>
              <p className="text-xs text-gray-700 mt-3">
                Tip: Use #keyword to search posts tagged with that keyword on-chain.
              </p>
            </div>
          )}

          {/* Results */}
          {!loading && hasResults && (
            <div className="space-y-6">
              {/* Users section */}
              {(activeFilter === 'all' || activeFilter === 'users') && results.profiles?.length > 0 && (
                <section>
                  {activeFilter === 'all' && (
                    <div className="flex items-center gap-2 mb-3">
                      <FiUser size={14} className="text-blue-400" />
                      <h3 className="text-sm font-semibold text-gray-300">Users</h3>
                      <span className="text-[10px] text-gray-600">{counts.users}</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {results.profiles.slice(0, displayLimit.profiles).map((profile, idx) => (
                      <button
                        key={idx}
                        onClick={() => navigate(`/profile/${profile.address}`)}
                        className="w-full flex items-center gap-3 p-3 bg-gray-900/60 border border-gray-800/60 rounded-lg hover:border-gray-700 transition-colors text-left"
                        data-testid={`search-profile-result-${idx}`}
                      >
                        <ProfileThumb
                          name={profile.display_name || profile.urn}
                          image={profile.image}
                          size="md"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-100 truncate">
                            {profile.display_name || profile.urn}
                          </p>
                          <p className="text-xs text-blue-400/70 truncate">@{profile.urn}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                  {results.profiles.length > displayLimit.profiles && (
                    <button onClick={() => setDisplayLimit(p => ({ ...p, profiles: p.profiles + 10 }))}
                      className="mt-3 w-full py-2 text-xs text-teal-400 hover:text-teal-300 bg-gray-800/40 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors"
                      data-testid="users-load-more">
                      Show more users ({results.profiles.length - displayLimit.profiles} remaining)
                    </button>
                  )}
                </section>
              )}

              {/* Objects section */}
              {(activeFilter === 'all' || activeFilter === 'objects') && results.objects?.length > 0 && (
                <section>
                  {activeFilter === 'all' && (
                    <div className="flex items-center gap-2 mb-3">
                      <FiGrid size={14} className="text-purple-400" />
                      <h3 className="text-sm font-semibold text-gray-300">Objects</h3>
                      <span className="text-[10px] text-gray-600">{counts.objects}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {results.objects.slice(0, displayLimit.objects).map((obj, idx) => (
                      <ObjectCard key={idx} object={obj} network={network} />
                    ))}
                  </div>
                  {results.objects.length > displayLimit.objects && (
                    <button onClick={() => setDisplayLimit(p => ({ ...p, objects: p.objects + 12 }))}
                      className="mt-3 w-full py-2 text-xs text-teal-400 hover:text-teal-300 bg-gray-800/40 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors"
                      data-testid="objects-load-more">
                      Show more objects ({results.objects.length - displayLimit.objects} remaining)
                    </button>
                  )}
                </section>
              )}

              {/* Posts section */}
              {(activeFilter === 'all' || activeFilter === 'posts') && results.posts?.length > 0 && (
                <section>
                  {activeFilter === 'all' && (
                    <div className="flex items-center gap-2 mb-3">
                      <FiMessageSquare size={14} className="text-green-400" />
                      <h3 className="text-sm font-semibold text-gray-300">Posts</h3>
                      <span className="text-[10px] text-gray-600">{counts.posts}</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {results.posts.slice(0, displayLimit.posts).map((post, idx) => (
                      <FeedCard
                        key={post.transaction_id || idx}
                        item={post}
                        network={network}
                        currentUserAddress={myAddress}
                      />
                    ))}
                  </div>
                  {results.posts.length > displayLimit.posts && (
                    <button onClick={() => setDisplayLimit(p => ({ ...p, posts: p.posts + 10 }))}
                      className="mt-3 w-full py-2 text-xs text-teal-400 hover:text-teal-300 bg-gray-800/40 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors"
                      data-testid="posts-load-more">
                      Show more posts ({results.posts.length - displayLimit.posts} remaining)
                    </button>
                  )}
                </section>
              )}

              {/* Files section */}
              {(activeFilter === 'all' || activeFilter === 'files') && (fileObjects.length > 0 || filePosts.length > 0) && (
                <section>
                  {activeFilter === 'all' && (
                    <div className="flex items-center gap-2 mb-3">
                      <FiFile size={14} className="text-amber-400" />
                      <h3 className="text-sm font-semibold text-gray-300">Files</h3>
                      <span className="text-[10px] text-gray-600">{fileObjects.length + filePosts.length}</span>
                    </div>
                  )}
                  {/* File objects */}
                  {fileObjects.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                      {fileObjects.map((obj, idx) => (
                        <ObjectCard key={idx} object={obj} network={network} />
                      ))}
                    </div>
                  )}
                  {/* Posts with file attachments */}
                  {filePosts.length > 0 && (
                    <div className="space-y-2">
                      {filePosts.map((post, idx) => (
                        <FeedCard
                          key={post.transaction_id || `fpost-${idx}`}
                          item={post}
                          network={network}
                          currentUserAddress={myAddress}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Empty filter state */}
              {activeFilter !== 'all' && counts[activeFilter] === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-500">No {FILTERS.find(f => f.key === activeFilter)?.label?.toLowerCase()} found for "{query}"</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`.scrollbar-hide::-webkit-scrollbar{display:none} .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
