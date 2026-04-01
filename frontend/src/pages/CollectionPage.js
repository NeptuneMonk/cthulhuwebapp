import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiUser, FiGrid, FiTag, FiClock } from 'react-icons/fi';
import { ObjectCard } from '@/components/ObjectCard';
import { ProfileThumb } from '@/components/ProfileThumb';
import { parseMediaString, getProfileImageUrl, isMainnetNetwork } from '@/utils/media';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function CollectionPage({ network, byAddress }) {
  const { urn, address } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState('objects'); // 'objects' | 'history'

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = byAddress
      ? `${API}/collection-by-address/${address}?network=${network}`
      : `${API}/collection/${encodeURIComponent(urn)}?network=${network}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Failed to load collection'))
      .finally(() => setLoading(false));
  }, [urn, address, network, byAddress]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="collection-loading">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading collection...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-400 mb-2">Collection not found</p>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <button onClick={() => navigate(-1)} className="text-blue-400 hover:underline text-sm">Go back</button>
        </div>
      </div>
    );
  }

  const { collection, creator, objects, total } = data;
  const isObjectCollection = collection.type === 'object';
  const mediaOpts = { mainnet: isMainnetNetwork(network) };
  const collectionImage = parseMediaString(collection.image, mediaOpts);
  const creatorImageUrl = creator ? getProfileImageUrl(creator.image, mediaOpts) : null;

  return (
    <div className="h-full overflow-y-auto" data-testid="collection-page">
      {/* Header */}
      <div className="bg-gradient-to-b from-gray-800/60 to-gray-950 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 pt-5 pb-6">
          {/* Creator link at top */}
          {creator && (
            <button
              onClick={() => navigate(`/profile/${creator.address}`)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-4 transition-colors"
              data-testid="collection-creator-link"
            >
              {creatorImageUrl ? (
                <img src={creatorImageUrl} alt={creator.urn} className="w-6 h-6 rounded-full object-cover border border-gray-600" />
              ) : (
                <ProfileThumb name={creator.urn} size="sm" />
              )}
              <span>@{creator.urn}</span>
              <FiArrowLeft size={12} className="rotate-180" />
            </button>
          )}

          <div className="flex items-start gap-5">
            {/* Collection image */}
            <div className="flex-shrink-0 w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden bg-gray-800 border border-gray-700" data-testid="collection-image">
              {collectionImage?.url ? (
                <img
                  src={collectionImage.url}
                  alt={collection.urn}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  <FiUser size={40} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pt-1">
              {/* Collection name + type badge */}
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-100" data-testid="collection-name">
                  {collection.urn}
                </h1>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${isObjectCollection ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'}`}>
                  {isObjectCollection ? 'Object' : 'Profile'}
                </span>
              </div>

              {/* Bio (profile) or Description (object) */}
              {(collection.bio || collection.description) && (
                <p className="text-sm text-gray-400 mb-3 line-clamp-3" data-testid="collection-bio">
                  {collection.bio || collection.description}
                </p>
              )}

              {/* URL metadata (profile) or URI (object) */}
              {!isObjectCollection && collection.url && typeof collection.url === 'object' && (
                <div className="text-xs text-gray-500 mb-2">
                  {Object.entries(collection.url).map(([k, v]) => (
                    <span key={k} className="mr-3">
                      {k}: <span className="text-blue-400">{v}</span>
                    </span>
                  ))}
                </div>
              )}
              {isObjectCollection && collection.uri && (
                <div className="text-xs text-gray-500 mb-2">
                  URI: <span className="text-blue-400">{collection.uri}</span>
                </div>
              )}

              {/* Created date + object count */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-purple-400 font-medium" data-testid="collection-count">
                  {total} object{total !== 1 ? 's' : ''}
                </span>
                {collection.created_date && (
                  <span className="text-xs text-gray-600">
                    Created {new Date(collection.created_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex items-center gap-4 border-b border-gray-800 pt-2">
          <button
            onClick={() => setActiveFilter('objects')}
            className={`flex items-center gap-2 text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeFilter === 'objects' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
            data-testid="collection-tab-objects"
          >
            <FiGrid size={14} /> Objects ({total})
          </button>
          <button
            onClick={() => setActiveFilter('history')}
            className={`flex items-center gap-2 text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeFilter === 'history' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
            data-testid="collection-tab-history"
          >
            <FiClock size={14} /> History
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeFilter === 'objects' ? (
          objects.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500">No objects in this collection yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5" data-testid="collection-objects-grid">
              {objects.map((obj, idx) => (
                <ObjectCard key={obj.transaction_id || idx} object={obj} network={network} />
              ))}
            </div>
          )
        ) : (
          <CollectionHistory collectionAddress={collection.address} network={network} />
        )}
      </div>
    </div>
  );
}

/** History tab for collection — shows object change history */
function CollectionHistory({ collectionAddress, network }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!collectionAddress) return;
    setLoading(true);
    axios.get(`${API}/profile/${collectionAddress}/history`, { params: { network } })
      .then(res => setHistory(res.data.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [collectionAddress, network]);

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2" />
        Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12">
        <FiClock size={32} className="mx-auto text-gray-700 mb-3" />
        <p className="text-gray-500">No history available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="collection-history">
      {history.map((entry, idx) => (
        <div key={idx} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-purple-400">{entry.type || 'Change'}</span>
            <span className="text-xs text-gray-500">{entry.date}</span>
          </div>
          {entry.details && (
            <div className="text-sm text-gray-300 space-y-1">
              {Object.entries(entry.details).map(([k, v]) => (
                <div key={k}><span className="text-gray-500">{k}:</span> {String(v).substring(0, 100)}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
