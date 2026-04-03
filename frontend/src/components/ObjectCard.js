import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiGrid, FiTag } from 'react-icons/fi';
import { parseMediaString, isMainnetNetwork } from '@/utils/media';
import { IPFSMedia, OnChainMedia } from '@/components/MediaRenderers';
import { AddressLabel } from '@/components/AddressLabel';
import { useCachedIPFS } from '@/hooks/useCachedIPFS';
import { getEraInfo } from '@/components/OnChainAgeBadge';

const ShimmerPlaceholder = ({ text }) => (
  <div className="absolute inset-0 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 animate-pulse flex items-center justify-center">
    {text && <span className="text-xs text-gray-500">{text}</span>}
  </div>
);

export const ObjectCard = ({ object, onClick, network, onCrossNetwork }) => {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const imageStr = object.Image || object.image;
  const urnStr = object.URN || object.urn;
  const uriStr = object.URI || object.uri;
  const mediaOpts = { mainnet: isMainnetNetwork(network) };
  const parsed = parseMediaString(imageStr, mediaOpts) || parseMediaString(urnStr, mediaOpts) || parseMediaString(uriStr, mediaOpts);
  const name = object.Name || object.name || 'Unnamed Object';
  const description = object.Description || object.description;

  // Extract content type from URN (the actual payload of the object)
  const urnParsed = urnStr ? parseMediaString(urnStr, mediaOpts) : null;
  const urnFilename = urnParsed?.filename || '';
  const urnExtension = urnParsed?.extension || '';
  // Show content badge when URN tells a different story than the thumbnail
  const showContentBadge = urnExtension && urnExtension !== (parsed?.extension || '');
  const contentLabel = urnFilename || (urnExtension ? urnExtension.toUpperCase() : '');
  const txid = object.TransactionId || object.transaction_id;
  const isOnChain = parsed?.type === 'onchain';
  const isOnChainText = isOnChain && parsed?.extension === 'txt';
  const isIPFS = parsed?.type === 'ipfs';

  // Object address = first Creator key (P2FK protocol canonical identifier)
  const creators = object.Creators || object.creators;
  const objAddr = object.object_address || (creators
    ? (Array.isArray(creators)
      ? (creators[0]?.address || creators[0])
      : (typeof creators === 'object' ? Object.keys(creators)[0] : null))
    : null);

  // Created date & era labeling
  const createdDate = object.CreatedDate || object.created_date || '';
  const eraInfo = getEraInfo(createdDate);
  const formattedDate = createdDate && createdDate !== '0001-01-01T00:00:00'
    ? new Date(createdDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  // URN display label: "text string" when URN is text-only (no actual file), keep real filenames
  const urnDisplayLabel = (() => {
    if (!urnFilename) return '';
    if (urnFilename === 'data.txt') return 'text string';
    return urnFilename;
  })();

  // IPFS caching for thumbnails
  const { url: cachedImgUrl } = useCachedIPFS(isIPFS ? parsed.url : null);
  const imgSrc = isIPFS ? cachedImgUrl : (parsed?.url || null);
  const imgFallbackSrc = parsed?.fallbackUrl || null;
  const [triedImgFallback, setTriedImgFallback] = useState(false);

  // Poll for on-chain images that return 202
  const [resolving, setResolving] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  // For text objects, fetch and display a preview
  const [textPreview, setTextPreview] = useState(null);
  useEffect(() => {
    if (!isOnChain || !parsed?.url) return;
    let cancelled = false;
    let timer = null;
    const check = async () => {
      try {
        const resp = await fetch(parsed.url);
        if (resp.status === 202) {
          setResolving(true);
          timer = setInterval(async () => {
            if (cancelled) return;
            try {
              const r = await fetch(parsed.url);
              if (r.status === 200) {
                clearInterval(timer);
                setResolving(false);
                if (isOnChainText) {
                  const text = await r.text();
                  if (!cancelled) setTextPreview(text);
                } else {
                  setResolvedUrl(parsed.url + (parsed.url.includes('?') ? '&' : '?') + 't=' + Date.now());
                }
              }
            } catch (e) { /* keep polling */ }
          }, 5000);
        } else if (resp.status === 200 && isOnChainText) {
          const text = await resp.text();
          if (!cancelled) setTextPreview(text);
        }
      } catch (e) { /* let img tag handle */ }
    };
    check();
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [isOnChain, isOnChainText, parsed?.url]);

  // Owners
  const owners = object.Owners || object.owners || {};
  const isFormattedOwners = Array.isArray(owners);
  const ownerCount = isFormattedOwners ? owners.length : Object.keys(owners).length;
  const totalSupply = isFormattedOwners
    ? owners.reduce((s, o) => s + (o.quantity || 0), 0)
    : Object.values(owners).reduce((s, v) => s + (typeof v === 'object' ? (v.Item1 || 0) : (typeof v === 'number' ? v : 0)), 0);

  // Listings
  const listings = object.Listings || object.listings;
  const isListed = object.is_listed !== undefined
    ? object.is_listed
    : (listings && typeof listings === 'object' && !Array.isArray(listings) ? Object.keys(listings).length > 0 : (Array.isArray(listings) ? listings.length > 0 : false));

  let minPrice = object.min_price;
  if (minPrice === undefined && listings) {
    if (typeof listings === 'object' && !Array.isArray(listings)) {
      minPrice = Math.min(...Object.values(listings).map(l => l.Value || l.price || 0));
    } else if (Array.isArray(listings)) {
      minPrice = Math.min(...listings.map(l => l.price || l.Value || 0));
    }
  }

  // Creator (for display)
  const firstCreator = objAddr;

  // Cross-network detection
  const objectChain = object._blockchain || '';
  const isTestnet = (network || '').includes('testnet');
  const objectIsTestnet = objectChain.toLowerCase().includes('testnet');
  const isCrossNetwork = objectChain && (isTestnet !== objectIsTestnet);

  // Data chain badges — extract unique chain prefixes from URN, URI, Image
  const dataChains = (() => {
    const chains = new Set();
    [urnStr, uriStr, imageStr].forEach(s => {
      if (s && typeof s === 'string' && s.includes(':')) {
        const prefix = s.split(':')[0].toUpperCase();
        if (['IPFS', 'MZC', 'BTC', 'LTC', 'DOG', 'DOGE'].includes(prefix)) {
          chains.add(prefix === 'DOGE' ? 'DOG' : prefix);
        }
      }
    });
    return [...chains];
  })();

  const CHAIN_COLORS = {
    IPFS: 'bg-blue-600/70 text-blue-200',
    MZC:  'bg-green-600/70 text-green-200',
    BTC:  'bg-amber-600/70 text-amber-200',
    LTC:  'bg-gray-500/70 text-gray-200',
    DOG:  'bg-yellow-600/70 text-yellow-200',
  };

  const handleClick = () => {
    if (onClick) return onClick();
    if (isCrossNetwork && onCrossNetwork) return onCrossNetwork(object);
    // Always pass prefetched data to avoid re-fetch failures when p2fk.io can't look up by txid
    if (txid) navigate(`/object/${txid}`, { state: { prefetchedObject: object } });
    else if (objAddr) navigate(`/object/addr/${objAddr}`, { state: { prefetchedObject: object } });
  };

  // Deterministic background color from name hash
  const textBgColors = [
    'from-indigo-900 to-slate-900',
    'from-emerald-900 to-cyan-950',
    'from-rose-950 to-purple-950',
    'from-amber-900 to-orange-950',
    'from-sky-900 to-blue-950',
    'from-teal-900 to-slate-900',
    'from-fuchsia-950 to-indigo-950',
    'from-lime-900 to-emerald-950',
  ];
  const nameHash = name.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const bgIdx = Math.abs(nameHash) % textBgColors.length;
  const isTextObject = !parsed;

  return (
    <div
      onClick={handleClick}
      className="group bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-purple-500/60 transition-all cursor-pointer hover:shadow-lg hover:shadow-purple-900/10"
      data-testid="object-card"
    >
      <div className="aspect-square bg-gradient-to-br from-purple-900/30 to-blue-900/30 flex items-center justify-center p-4 relative overflow-hidden">
        {isOnChainText ? (
          <div className={`absolute inset-0 bg-gradient-to-br ${textBgColors[bgIdx]} flex items-center justify-center p-5`} data-testid="text-object-card">
            {resolving ? (
              <div className="flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400" />
                <span className="text-xs text-gray-400">Resolving...</span>
              </div>
            ) : textPreview ? (
              <span className="font-serif text-center text-gray-100 leading-snug select-none line-clamp-6 overflow-hidden" style={{
                fontSize: textPreview.length > 200 ? '0.7rem' : textPreview.length > 100 ? '0.8rem' : '0.9rem',
                wordBreak: 'break-word',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                {textPreview}
              </span>
            ) : (
              <span className="font-serif text-center text-gray-100 leading-snug select-none" style={{
                fontSize: name.length > 40 ? '0.85rem' : name.length > 20 ? '1.1rem' : name.length > 10 ? '1.4rem' : '1.8rem',
                wordBreak: 'break-word',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                {name}
              </span>
            )}
          </div>
        ) : parsed?.url ? (
          ['mp4', 'mp3', 'wav', 'ogg', 'aac', 'amr', 'arm'].includes(parsed.extension) ? (
            <div className="w-full"><IPFSMedia url={parsed.url} filename={parsed.filename} extension={parsed.extension} /></div>
          ) : (
            <>
              {(!imgLoaded || resolving) && !imgError && <ShimmerPlaceholder text={resolving ? 'Resolving...' : null} />}
              <img
                src={resolvedUrl || (triedImgFallback ? imgFallbackSrc : imgSrc)}
                alt={name}
                className={`w-full h-full object-cover group-hover:scale-105 transition-all duration-300 ${imgLoaded && !resolving ? 'opacity-100' : 'opacity-0 absolute'}`}
                onLoad={() => { setImgLoaded(true); setResolving(false); }}
                onError={() => {
                  if (!resolving) {
                    if (!triedImgFallback && imgFallbackSrc && imgFallbackSrc !== imgSrc) {
                      setTriedImgFallback(true);
                    } else {
                      setImgError(true); setImgLoaded(true);
                    }
                  }
                }}
              />
              {imgError && !resolving && <FiGrid size={48} className="text-gray-600 absolute" />}
            </>
          )
        ) : isTextObject ? (
          <div className={`absolute inset-0 bg-gradient-to-br ${textBgColors[bgIdx]} flex items-center justify-center p-5`} data-testid="text-object-card">
            <span className="font-serif text-center text-gray-100 leading-snug select-none" style={{
              fontSize: name.length > 40 ? '0.85rem' : name.length > 20 ? '1.1rem' : name.length > 10 ? '1.4rem' : '1.8rem',
              wordBreak: 'break-word',
              textShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}>
              {name}
            </span>
          </div>
        ) : (
          <FiGrid size={48} className="text-gray-600" />
        )}

        {/* Listing Badge */}
        {isListed && (
          <div className="absolute top-3 right-3" data-testid="object-listing-badge">
            <span className="px-2.5 py-1 bg-emerald-600/90 text-white text-xs font-semibold rounded-full backdrop-blur-sm flex items-center gap-1">
              <FiTag size={10} />
              {minPrice === 0 ? 'FREE' : `${minPrice} BTC`}
            </span>
          </div>
        )}

        {/* Ownership Chain Badge (top-right, below listing) */}
        {objectChain && (
          <div className={`absolute ${isListed ? 'top-10' : 'top-3'} right-3`} data-testid="object-network-badge">
            <span className={`px-2 py-0.5 text-[9px] font-bold rounded backdrop-blur-sm ${
              objectIsTestnet ? 'bg-blue-900/70 text-blue-300' : 'bg-orange-900/70 text-orange-300'
            }`}>
              {objectChain}
            </span>
          </div>
        )}

        {/* Data Chain Badges (bottom-left) */}
        {dataChains.length > 0 && (
          <div className="absolute bottom-2 left-2 flex gap-1" data-testid="data-chain-badges">
            {dataChains.map(c => (
              <span key={c} className={`px-1.5 py-0.5 text-[9px] font-bold rounded backdrop-blur-sm ${CHAIN_COLORS[c] || 'bg-gray-600/70 text-gray-200'}`}>
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Content Type Badge — when URN content differs from thumbnail */}
        {showContentBadge && (
          <div className="absolute bottom-2 right-2" data-testid="content-type-badge">
            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded backdrop-blur-sm ${
              ['mp3','wav','ogg','flac','aac','m4a'].includes(urnExtension) ? 'bg-violet-900/80 text-violet-300' :
              ['mp4','webm','mov','avi'].includes(urnExtension) ? 'bg-rose-900/80 text-rose-300' :
              ['zip','rar','7z'].includes(urnExtension) ? 'bg-cyan-900/80 text-cyan-300' :
              'bg-gray-600/70 text-gray-200'
            }`}>
              {urnExtension.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="font-bold text-gray-100 mb-1 truncate text-sm">{name}</h3>
        {/* Content label — real filename or "text string" for text-only URNs */}
        {urnDisplayLabel && (
          <p className="text-[10px] text-purple-400/80 mb-1 truncate" data-testid="object-urn-label" title={urnDisplayLabel}>
            {urnDisplayLabel}
          </p>
        )}
        {/* Created date + era badge */}
        {formattedDate && (
          <p className="text-[10px] mb-1 truncate" data-testid="object-card-date">
            <span className="text-gray-500">{formattedDate}</span>
            {eraInfo && (
              <span className={`ml-1.5 ${eraInfo.text}`}>
                {eraInfo.icon} {eraInfo.era} {eraInfo.years}
              </span>
            )}
          </p>
        )}
        {description && <p className="text-xs text-gray-500 line-clamp-2 mb-3">{description}</p>}

        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="truncate">
            {firstCreator && <AddressLabel address={firstCreator} network={network} className="text-xs text-gray-400" />}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {ownerCount > 0 && <span>{ownerCount} owner{ownerCount > 1 ? 's' : ''}</span>}
            {totalSupply > 0 && <span className="font-mono">{totalSupply > 999999 ? `${(totalSupply / 1000000).toFixed(1)}M` : totalSupply.toLocaleString()}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
