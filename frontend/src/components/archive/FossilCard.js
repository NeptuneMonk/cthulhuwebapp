import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiExternalLink, FiDownload, FiImage, FiFileText, FiMapPin, FiClock, FiLayers, FiChevronDown, FiChevronUp, FiUser, FiGlobe, FiCode } from 'react-icons/fi';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CHAIN_STYLES = {
  'BTC': 'bg-amber-600/20 text-amber-400 border-amber-500/40',
  'BTC-T': 'bg-amber-600/15 text-amber-300 border-amber-400/30',
  'DOGE': 'bg-yellow-600/20 text-yellow-400 border-yellow-500/40',
  'LTC': 'bg-gray-500/20 text-gray-300 border-gray-400/40',
  'MZC': 'bg-green-600/20 text-green-400 border-green-500/40',
};

export const FossilCard = ({ result, compact = false }) => {
  const { txid, chain, images = [], files = [], web_assets = [], messages = [], has_address, has_webapp, metadata = {}, detail_url, ownership } = result;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const chainStyle = CHAIN_STYLES[chain] || CHAIN_STYLES['BTC'];
  const primaryImage = images[0] || null;
  const previewUrl = primaryImage ? `${API}/objects/discover/preview/${txid}/${primaryImage}` : null;
  const hasMultiParts = messages.length > 0 || has_address || files.length > 0 || images.length > 1 || web_assets.length > 0;
  const partCount = images.length + files.length + web_assets.length + messages.length + (has_address ? 1 : 0);

  if (compact) {
    return (
      <a
        href={detail_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center space-x-3 px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
        data-testid={`fossil-compact-${txid.slice(0, 8)}`}
      >
        <div className="w-9 h-9 rounded bg-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {previewUrl && !imgError ? (
            <img src={previewUrl} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
          ) : (
            <FiLayers size={14} className="text-gray-400" />
          )}
        </div>
        <div className="flex-1 text-left overflow-hidden min-w-0 hidden xl:block sb-text">
          <p className="text-sm truncate text-gray-200">{primaryImage || messages[0]?.content?.slice(0, 40) || txid.slice(0, 16)}</p>
          <div className="flex items-center space-x-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${chainStyle}`}>{chain}</span>
            {partCount > 1 && <span className="text-[10px] text-gray-500">{partCount} parts</span>}
            <span className="text-[10px] text-gray-600 truncate">{txid.slice(0, 10)}...</span>
          </div>
        </div>
        <FiExternalLink size={12} className="text-gray-600 group-hover:text-gray-400 flex-shrink-0 hidden xl:block sb-text" />
      </a>
    );
  }

  return (
    <div
      className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden hover:border-gray-600/50 transition-colors"
      data-testid={`fossil-card-${txid.slice(0, 8)}`}
    >
      {/* Image Preview */}
      <div className="aspect-[4/3] bg-gray-900 flex items-center justify-center relative">
        {previewUrl && !imgError ? (
          <>
            {!imgLoaded && <div className="absolute inset-0 bg-gray-800 animate-pulse" />}
            <img
              src={previewUrl}
              alt={primaryImage}
              className={`w-full h-full object-cover transition-opacity ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          </>
        ) : (
          <div className="text-center p-4">
            {has_webapp ? (
              <FiGlobe size={32} className="mx-auto text-cyan-500 mb-2" />
            ) : messages.length > 0 ? (
              <FiFileText size={32} className="mx-auto text-gray-600 mb-2" />
            ) : (
              <FiImage size={32} className="mx-auto text-gray-600 mb-2" />
            )}
            <p className="text-xs text-gray-600 break-all">{has_webapp ? 'On-chain Web App' : primaryImage || files[0] || 'Text artifact'}</p>
          </div>
        )}
        {/* Chain badge */}
        <span className={`absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full border ${chainStyle} backdrop-blur-sm`}>
          {chain}
        </span>
        {/* Web App badge */}
        {has_webapp && (
          <span className="absolute top-2 left-16 text-[10px] px-2 py-0.5 rounded-full bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 backdrop-blur-sm flex items-center gap-1">
            <FiCode size={10} /> Web App
          </span>
        )}
        {/* Parts count badge */}
        {partCount > 1 && (
          <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 backdrop-blur-sm flex items-center gap-1">
            <FiLayers size={10} />
            {partCount}
          </span>
        )}
        {/* Ownership / Fossil status badge */}
        <span className={`absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm ${
          ownership?.claimed
            ? 'bg-red-600/30 text-red-300 border border-red-500/40'
            : 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
        }`} data-testid={`fossil-status-${txid.slice(0, 8)}`}>
          {ownership?.claimed ? 'Claimed' : 'Unclaimed'}
        </span>
      </div>

      {/* Content section */}
      <div className="p-3 space-y-2">
        {/* Primary filename */}
        <p className="text-sm text-gray-200 truncate font-medium" title={primaryImage || files[0] || txid}>
          {primaryImage || files[0] || 'On-chain artifact'}
        </p>

        {/* Message preview (first message, always shown) */}
        {messages.length > 0 && (
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">
              {messages[0].content}
            </p>
            {messages.length > 1 && (
              <p className="text-[10px] text-gray-500 mt-1">+{messages.length - 1} more message{messages.length > 2 ? 's' : ''}</p>
            )}
          </div>
        )}

        {/* Metadata & indicators row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {has_address && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-300 border border-blue-500/30 flex items-center gap-1" data-testid={`fossil-address-${txid.slice(0, 8)}`}>
              <FiMapPin size={9} /> Address
            </span>
          )}
          {metadata.block_date && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 flex items-center gap-1">
              <FiClock size={9} /> {metadata.block_date}
            </span>
          )}
          {metadata.cost && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
              {metadata.cost} {metadata.blockchain || chain}
            </span>
          )}
          {images.length > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
              {images.length} images
            </span>
          )}
          {files.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
              {files.length} file{files.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Owner info — links to their Cthulhu profile */}
        {ownership?.claimed && ownership.owner && (
          <button
            onClick={() => navigate(`/profile/${ownership.owner}`)}
            className="w-full bg-red-900/20 border border-red-800/30 rounded-lg px-2 py-1.5 flex items-center gap-1.5 hover:bg-red-900/30 transition-colors text-left"
            data-testid={`fossil-owner-${txid.slice(0, 8)}`}
          >
            <FiUser size={11} className="text-red-400 flex-shrink-0" />
            <span className="text-[10px] text-red-400 font-medium flex-shrink-0">Owned by</span>
            <span className="text-[10px] text-red-300 font-mono truncate">{ownership.owner.slice(0, 16)}...</span>
            {ownership.name && <span className="text-[10px] text-red-200 flex-shrink-0">({ownership.name})</span>}
          </button>
        )}

        {/* Expandable details */}
        {hasMultiParts && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 py-1 transition-colors"
            data-testid={`fossil-expand-${txid.slice(0, 8)}`}
          >
            {expanded ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
            {expanded ? 'Less' : `${partCount} parts`}
          </button>
        )}

        {expanded && (
          <div className="space-y-2 border-t border-gray-700/40 pt-2" data-testid={`fossil-details-${txid.slice(0, 8)}`}>
            {/* Additional messages */}
            {messages.slice(1).map((m, i) => (
              <div key={m.key} className="bg-gray-900/40 rounded px-2 py-1.5">
                <span className="text-[10px] text-gray-500 uppercase">{m.key}</span>
                <p className="text-xs text-gray-400 leading-relaxed">{m.content}</p>
              </div>
            ))}

            {/* Additional images */}
            {images.slice(1).map(img => (
              <div key={img} className="rounded overflow-hidden border border-gray-700/40">
                <img
                  src={`${API}/objects/discover/preview/${txid}/${img}`}
                  alt={img}
                  className="w-full h-32 object-cover"
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <p className="text-[10px] text-gray-500 px-2 py-1 truncate">{img}</p>
              </div>
            ))}

            {/* Files list */}
            {files.map(f => (
              <a
                key={f}
                href={`https://bitfossil.com/${txid}/${f}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 bg-gray-900/40 rounded"
              >
                <FiFileText size={11} />
                <span className="truncate">{f}</span>
                <FiExternalLink size={10} className="flex-shrink-0 ml-auto" />
              </a>
            ))}

            {/* Web assets (CSS/JS/HTM) */}
            {web_assets.length > 0 && (
              <div className="bg-gray-900/40 rounded px-2 py-1.5">
                <p className="text-[10px] text-gray-500 mb-1 flex items-center gap-1"><FiCode size={9} /> {web_assets.length} web asset{web_assets.length > 1 ? 's' : ''}</p>
                <div className="flex flex-wrap gap-1">
                  {web_assets.slice(0, 8).map(f => (
                    <span key={f} className="text-[9px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded truncate max-w-[120px]">{f}</span>
                  ))}
                  {web_assets.length > 8 && <span className="text-[9px] text-gray-600">+{web_assets.length - 8} more</span>}
                </div>
              </div>
            )}

            {/* TXID */}
            <p className="text-[10px] text-gray-600 font-mono break-all">{txid}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center space-x-2">
          {has_webapp && (
            <a
              href={`https://bitfossil.com/${txid}/index.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center space-x-1 text-[11px] px-2 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 transition-colors border border-cyan-500/30"
              data-testid={`fossil-webapp-${txid.slice(0, 8)}`}
            >
              <FiGlobe size={11} />
              <span>View App</span>
            </a>
          )}
          <a
            href={detail_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center space-x-1 text-[11px] px-2 py-1.5 rounded-lg bg-gray-700/50 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-600/30"
            data-testid={`fossil-detail-${txid.slice(0, 8)}`}
          >
            <FiExternalLink size={11} />
            <span>bitFossil</span>
          </a>
          <a
            href="https://apertus.io"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center space-x-1 text-[11px] px-2 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 transition-colors border border-purple-500/30"
            data-testid={`fossil-claim-${txid.slice(0, 8)}`}
          >
            <FiDownload size={11} />
            <span>Apertus.io</span>
          </a>
        </div>
      </div>
    </div>
  );
};
