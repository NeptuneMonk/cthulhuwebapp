/**
 * Standalone Mode — Direct P2FK / Mempool / IPFS Adapter
 * ======================================================
 * When REACT_APP_STANDALONE is set (or no backend URL), this module
 * intercepts all /api/* fetch calls and routes them directly to
 * public APIs. Zero changes required to existing components.
 *
 * Architecture (mirrors SUP):
 *  - Blockchain data → p2fk.io
 *  - UTXOs/Broadcasting → mempool.space / blockstream.info
 *  - IPFS read → public gateways (ipfs.io, cf-ipfs)
 *  - IPFS write → local Kubo at localhost:5001 (if running)
 *  - Auth/state → localStorage only
 */

const P2FK = 'https://p2fk.io';
const P2FK_LOCAL = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api/p2fk-local` : null;
const MEMPOOL_TESTNET = 'https://mempool.space/testnet/api';
const MEMPOOL_MAINNET = 'https://mempool.space/api';
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cf-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];
const KUBO_LOCAL = 'http://localhost:5001';

// ─── Formatters (ported from backend/utils/helpers.py) ───

function formatProfile(raw, network) {
  if (!raw) return null;
  const creators = raw.Creators || [];
  return {
    address: creators[0] || '',
    urn: raw.URN || '',
    display_name: raw.DisplayName || null,
    first_name: raw.FirstName || null,
    middle_name: raw.MiddleName || null,
    last_name: raw.LastName || null,
    suffix: raw.Suffix || null,
    bio: raw.Bio || null,
    image: raw.Image || null,
    url: raw.URL || null,
    location: raw.Location || null,
    pkx: raw.PKX || '',
    pky: raw.PKY || '',
    network,
    created_at: raw.CreatedDate || '',
  };
}

function formatMessage(msg, senderProfile, network) {
  const fromAddr = msg.FromAddress || '';
  const toAddr = msg.ToAddress || '';
  const isReply = fromAddr !== toAddr && !!toAddr;
  let content = msg.Message || '';
  if (Array.isArray(content)) content = content.join(' ');
  content = String(content).replace(/<<-?\d+>>.*/s, '').trim();
  content = [...content].filter(c => c.charCodeAt(0) >= 32 || c === '\n' || c === '\t').join('').trim();

  const PROTOCOL_KEYS = new Set(['SIG','GIV','SEC','BRN','BUY','LST','OBJ','PRO','INQ','LNK']);
  const rawFiles = msg.File || {};
  const files = {};
  let isPoll = false;
  if (typeof rawFiles === 'object') {
    for (const [fname, fsize] of Object.entries(rawFiles)) {
      if (fname === 'INQ') isPoll = true;
      else if (!PROTOCOL_KEYS.has(fname)) files[fname] = fsize;
    }
  }

  return {
    id: msg.TransactionId || crypto.randomUUID?.() || Math.random().toString(36),
    from_address: fromAddr,
    to_address: toAddr,
    content,
    transaction_id: msg.TransactionId || '',
    network,
    created_at: msg.BlockDate || '',
    block_time: msg.BlockDate || '',
    is_reply: isReply,
    is_poll: isPoll,
    sender_urn: senderProfile?.URN || null,
    sender_display_name: senderProfile?.DisplayName || null,
    sender_image: senderProfile?.Image || null,
    recipient_urn: null,
    recipient_image: null,
    files: Object.keys(files).length ? files : null,
  };
}

function formatObject(obj) {
  const owners = obj.Owners || {};
  const ownerList = Object.entries(owners).map(([addr, val]) => ({
    address: addr,
    quantity: typeof val === 'object' ? (val.Item1 || 0) : (typeof val === 'number' ? val : 0),
    transfer_txid: typeof val === 'object' ? val.Item2 : null,
  }));

  const creators = obj.Creators || {};
  const creatorList = Object.entries(creators).map(([addr, date]) => ({ address: addr, date }));

  const listings = obj.Listings || {};
  const listingList = Object.entries(listings).map(([addr, l]) => ({
    address: addr, requestor: l.Requestor || '', owner: l.Owner || '',
    quantity: l.Qty || 0, price: l.Value || 0, block_date: l.BlockDate || '',
  }));

  const offers = Array.isArray(obj.Offers) ? obj.Offers.map(o => ({
    requestor: o.Requestor || '', owner: o.Owner || '',
    quantity: o.Qty || 0, price: o.Value || 0, block_date: o.BlockDate || '',
  })) : [];

  const totalSupply = ownerList.reduce((s, o) => s + o.quantity, 0);
  const isListed = listingList.length > 0;
  const minPrice = isListed ? Math.min(...listingList.map(l => l.price)) : 0;

  let image = obj.Image || '';
  const urn = obj.URN || '';
  const imageExts = ['.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp'];
  const chainPrefixes = ['IPFS:','BTC:','LTC:','DOG:','MZC:'];
  if (!image && urn) {
    const urnLower = urn.toLowerCase();
    const isImgUrn = imageExts.some(e => urnLower.endsWith(e));
    if (isImgUrn && (chainPrefixes.some(p => urn.toUpperCase().startsWith(p)) || /^[0-9a-fA-F]{64}/.test(urn))) {
      image = urn;
    }
  }

  let maximum = obj.Maximum || 0;
  if (maximum === 0) maximum = totalSupply;
  const objectAddress = creatorList[0]?.address || '';

  return {
    id: obj.Id || 0, transaction_id: obj.TransactionId || '', object_address: objectAddress,
    urn, uri: obj.URI || null, image, name: obj.Name || 'Unnamed',
    description: obj.Description || '', attributes: obj.Attributes || null,
    license: obj.License || null, maximum, owners: ownerList, owner_count: ownerList.length,
    total_supply: totalSupply, creators: creatorList, listings: listingList,
    is_listed: isListed, min_price: minPrice, offers, offer_count: offers.length,
    royalties: obj.Royalties || {}, created_date: obj.CreatedDate || '',
    change_date: obj.ChangeDate || '', locked_date: obj.LockedDate || '',
  };
}

// ─── p2fk.io Direct Client ───

const _profileCache = new Map(); // Simple in-memory cache

function isMainnet(networkOrQuery) {
  if (typeof networkOrQuery === 'string') return networkOrQuery.toLowerCase().includes('mainnet');
  return false;
}

function parseNetwork(url) {
  const m = url.match(/network=([^&]+)/);
  return m ? m[1] : 'btc-testnet';
}

function mempoolBase(network) {
  return isMainnet(network) ? MEMPOOL_MAINNET : MEMPOOL_TESTNET;
}

async function p2fkGet(path, mainnet = false) {
  const network = mainnet ? 'btc-mainnet' : 'btc-testnet';
  // Try local decoder first when backend is available
  if (P2FK_LOCAL) {
    const localResult = await _tryLocalDecoder(path, network);
    if (localResult) return localResult;
  }
  // Fall back to p2fk.io (showSystemFiles=false: server-side filter for smaller payloads)
  try {
    const r = await fetch(`${P2FK}/${path}?mainnet=${mainnet}&showSystemFiles=false`, { signal: AbortSignal.timeout(15000) });
    if (r.ok) return await r.json();
  } catch (e) { console.warn(`p2fk.io error [${path}]:`, e); }
  return null;
}

/** Map p2fk.io API paths to local decoder endpoints */
async function _tryLocalDecoder(path, network) {
  try {
    // GetRootByTransactionID/{txid}
    if (path.startsWith('GetRootByTransactionID/')) {
      const txid = path.split('/')[1];
      const r = await fetch(`${P2FK_LOCAL}/root/${txid}?network=${network}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const d = await r.json(); if (!d.error) return d; }
    }
    // GetRootsByAddress/{address}
    if (path.startsWith('GetRootsByAddress/')) {
      const addr = path.split('/')[1];
      const r = await fetch(`${P2FK_LOCAL}/roots/${addr}?network=${network}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const d = await r.json(); return d.roots || []; }
    }
    // GetPublicAddressByKeyword/{keyword}
    if (path.startsWith('GetPublicAddressByKeyword/')) {
      const kw = path.split('/')[1];
      const r = await fetch(`${P2FK_LOCAL}/keyword/${kw}?network=${network}`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) { const d = await r.json(); return d.address; }
    }
  } catch {} // Silently fall through to p2fk.io
  return null;
}

async function getProfile(address, network) {
  const mn = isMainnet(network);
  const cacheKey = `${address}:${network}`;
  if (_profileCache.has(cacheKey)) return _profileCache.get(cacheKey);

  let raw = await p2fkGet(`GetProfileByAddress/${address}`, mn);
  if (raw && raw.Id > 0 && raw.URN) {
    const p = formatProfile(raw, network);
    _profileCache.set(cacheKey, p);
    return p;
  }
  raw = await p2fkGet(`GetProfileByURN/${address}`, mn);
  if (raw && raw.Id > 0 && raw.URN) {
    const p = formatProfile(raw, network);
    _profileCache.set(cacheKey, p);
    return p;
  }
  return { address, urn: address, display_name: null, bio: null, image: null, network };
}

// ─── Route Handlers ───

const handlers = {};

// Health check
handlers['/api/health'] = async () => json({ status: 'ok', standalone: true });

// Feed
handlers['/api/feed/'] = async (url) => {
  const parts = url.split('/api/feed/')[1]?.split('?') || [];
  const network = parts[0] || 'btc-testnet';
  const params = new URLSearchParams(parts[1] || '');
  const skip = parseInt(params.get('skip') || '0');
  const limit = parseInt(params.get('limit') || '5');
  const mn = isMainnet(network);

  // Fetch known addresses from local storage or use seed addresses
  const knownAddrs = JSON.parse(localStorage.getItem(`cthulhu_known_${network}`) || '[]');
  const seedAddrs = knownAddrs.length > 0 ? knownAddrs.slice(0, 20) : [];

  if (seedAddrs.length === 0) {
    return json({ feed: [], network, count: 0, total: 0, skip, limit, has_more: false, standalone: true });
  }

  // Fetch messages from top addresses in parallel
  const msgBatches = await Promise.all(
    seedAddrs.slice(0, 10).map(async addr => {
      const roots = await p2fkGet(`GetRootsByAddress/${addr}`, mn);
      if (!Array.isArray(roots)) return [];
      const profile = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
      return roots.slice(0, 20).map(m => formatMessage(m, profile, network));
    })
  );

  let all = msgBatches.flat();
  all.sort((a, b) => (b.block_time || '').localeCompare(a.block_time || ''));
  const total = all.length;
  const page = all.slice(skip, skip + limit);
  return json({ feed: page, network, count: page.length, total, skip, limit, has_more: skip + limit < total, standalone: true });
};

// Profile
handlers['/api/profile/keys/batch'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const addresses = body.addresses || [];
  const network = new URL(url, 'http://x').searchParams.get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const results = {};
  await Promise.all(addresses.map(async addr => {
    const raw = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
    if (raw && raw.PKX && raw.PKY) {
      results[addr] = { pkx: raw.PKX, pky: raw.PKY };
    }
  }));
  return json(results);
};

handlers['/api/profile/keys/'] = async (url) => {
  const parts = url.split('/api/profile/keys/')[1]?.split('?') || [];
  const addr = parts[0];
  const network = new URLSearchParams(parts[1] || '').get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const raw = await p2fkGet(`GetProfileByAddress/${addr}`, mn)
    || await p2fkGet(`GetProfileByURN/${addr}`, mn);
  if (raw?.PKX && raw?.PKY) return json({ address: addr, pkx: raw.PKX, pky: raw.PKY });
  return json({ address: addr, pkx: '', pky: '', error: 'not_found' }, 404);
};

handlers['/api/profile/'] = async (url) => {
  const afterProfile = url.split('/api/profile/')[1] || '';
  const parts = afterProfile.split('?');
  const pathPart = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  const network = params.get('network') || 'btc-testnet';
  const mn = isMainnet(network);

  // /api/profile/{address}/bundle
  if (pathPart.includes('/bundle')) {
    const addr = pathPart.split('/bundle')[0];
    const profile = await getProfile(addr, network);
    const roots = await p2fkGet(`GetRootsByAddress/${addr}`, mn) || [];
    const profileRaw = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
    const msgs = roots.slice(0, 200)
      .filter(m => (m.FromAddress === m.ToAddress) || !m.ToAddress)
      .map(m => formatMessage(m, profileRaw, network));
    msgs.sort((a, b) => (b.block_time || '').localeCompare(a.block_time || ''));
    const page = msgs.slice(0, 5);
    const ownedRaw = await p2fkGet(`GetObjectByAddress/${addr}`, mn) || [];
    return json({
      profile: profile || { address: addr, urn: addr },
      counts: { owned: Array.isArray(ownedRaw) ? ownedRaw.length : 0, created: 0 },
      posts: { posts: page, count: page.length, total: msgs.length, skip: 0, limit: 5, has_more: msgs.length > 5 },
    });
  }

  // /api/profile/{address}/posts
  if (pathPart.includes('/posts')) {
    const addr = pathPart.split('/posts')[0];
    const skip = parseInt(params.get('skip') || '0');
    const limit = parseInt(params.get('limit') || '20');
    const roots = await p2fkGet(`GetRootsByAddress/${addr}`, mn) || [];
    const profile = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
    const msgs = roots.slice(0, 200)
      .filter(m => (m.FromAddress === m.ToAddress) || !m.ToAddress)
      .map(m => formatMessage(m, profile, network));
    msgs.sort((a, b) => (b.block_time || '').localeCompare(a.block_time || ''));
    const page = msgs.slice(skip, skip + limit);
    return json({ posts: page, count: page.length, total: msgs.length, skip, limit, has_more: skip + limit < msgs.length });
  }

  // /api/profile/{address}/replies
  if (pathPart.includes('/replies')) {
    const addr = pathPart.split('/replies')[0];
    const roots = await p2fkGet(`GetRootsByAddress/${addr}`, mn) || [];
    const profile = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
    const msgs = roots.slice(0, 200)
      .filter(m => m.FromAddress !== m.ToAddress && m.ToAddress)
      .map(m => formatMessage(m, profile, network));
    msgs.sort((a, b) => (b.block_time || '').localeCompare(a.block_time || ''));
    return json({ replies: msgs.slice(0, 20), count: msgs.length });
  }

  // /api/profile/{address}/verified_image
  if (pathPart.includes('/verified_image')) {
    return json({ verified: false, reason: 'standalone_mode' });
  }

  // /api/profile/{address}
  const address = pathPart.split('/')[0];
  const profile = await getProfile(address, network);
  return json(profile);
};

// Known users
handlers['/api/known-users/'] = async (url) => {
  const network = url.split('/api/known-users/')[1]?.split('?')[0] || 'btc-testnet';
  const stored = JSON.parse(localStorage.getItem(`cthulhu_known_users_${network}`) || '[]');
  return json(stored);
};

// Resolve
handlers['/api/resolve/batch'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const addresses = body.addresses || [];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const results = {};
  await Promise.all(addresses.map(async addr => {
    const raw = await p2fkGet(`GetProfileByAddress/${addr}`, mn);
    if (raw && raw.URN) {
      results[addr] = { urn: raw.URN, display_name: raw.DisplayName, image: raw.Image };
    }
  }));
  return json(results);
};

handlers['/api/resolve/'] = async (url) => {
  const addr = url.split('/api/resolve/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const profile = await getProfile(addr, network);
  return json(profile);
};

// Thread
handlers['/api/thread/'] = async (url) => {
  const parts = url.split('/api/thread/')[1]?.split('?') || [];
  const txid = parts[0];
  const network = new URLSearchParams(parts[1] || '').get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  // Can't easily reconstruct threads standalone without the keyword address derivation
  // Return minimal data
  return json({ root: null, replies: [], total_replies: 0, standalone: true });
};

// Reply count
handlers['/api/reply-count/'] = async () => json({ count: 0, standalone: true });

// Search
handlers['/api/search'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const query = body.query || '';
  const network = body.network || 'btc-testnet';
  const mn = isMainnet(network);
  const results = { profiles: [], objects: [], posts: [], query };

  // Search objects by keyword
  const objData = await p2fkGet(`GetObjectsByKeyword/${encodeURIComponent(query)}`, mn);
  if (Array.isArray(objData)) {
    results.objects = objData.slice(0, 20).map(formatObject);
  }

  // Search profiles by URN
  const profData = await p2fkGet(`GetProfileByURN/${encodeURIComponent(query)}`, mn);
  if (profData && profData.Id > 0) {
    results.profiles = [formatProfile(profData, network)];
  }

  return json(results);
};

// Conversation/room
handlers['/api/conversation/'] = async (url) => {
  const parts = url.split('/api/conversation/')[1]?.split('?') || [];
  const address = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  const network = params.get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const filter = params.get('filter') || 'messages';
  const skip = parseInt(params.get('skip') || '0');
  const limit = parseInt(params.get('limit') || '20');

  const roots = await p2fkGet(`GetRootsByAddress/${address}`, mn) || [];
  const msgs = [];
  for (const m of roots.slice(0, 100)) {
    const profile = await p2fkGet(`GetProfileByAddress/${m.FromAddress}`, mn);
    msgs.push(formatMessage(m, profile, network));
  }
  msgs.sort((a, b) => (b.block_time || '').localeCompare(a.block_time || ''));
  const page = msgs.slice(skip, skip + limit);
  return json({ messages: page, count: page.length, total: msgs.length, has_more: skip + limit < msgs.length });
};

// Collection
handlers['/api/collection/'] = async (url) => {
  const parts = url.split('/api/collection/')[1]?.split('?') || [];
  const urn = parts[0];
  const network = new URLSearchParams(parts[1] || '').get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const data = await p2fkGet(`GetObjectByURN/${encodeURIComponent(urn)}`, mn);
  if (data && data.Id > 0) return json({ collection: formatObject(data) });
  return json({ collection: null });
};

// Objects
handlers['/api/objects/owned/'] = async (url) => {
  const parts = url.split('/api/objects/owned/')[1]?.split('?') || [];
  const addr = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  const network = params.get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const skip = parseInt(params.get('skip') || '0');
  const limit = parseInt(params.get('limit') || '5');

  const [owned, byAddr] = await Promise.all([
    p2fkGet(`GetObjectsOwnedByAddress/${addr}`, mn),
    p2fkGet(`GetObjectsByAddress/${addr}`, mn),
  ]);
  const objMap = new Map();
  // From GetObjectsOwnedByAddress
  for (const obj of (owned || [])) {
    const oa = Object.keys(obj.Creators || {})[0];
    if (oa && !objMap.has(oa)) {
      objMap.set(oa, formatObject(obj));
    }
  }
  // From GetObjectsByAddress: include if addr is in Owners OR Creators (implicit ownership)
  for (const obj of (byAddr || [])) {
    const creators = obj.Creators || {};
    const owners = obj.Owners || {};
    const isOwner = addr in owners || Object.keys(owners).includes(addr);
    const isCreator = Object.keys(creators).includes(addr);
    if (isOwner || isCreator) {
      const oa = Object.keys(creators)[0];
      if (oa && !objMap.has(oa)) {
        objMap.set(oa, formatObject(obj));
      }
    }
  }
  const all = Array.from(objMap.values());
  const page = all.slice(skip, skip + limit);
  return json({ objects: page, count: page.length, total: all.length, has_more: skip + limit < all.length });
};

handlers['/api/objects/created/'] = async (url) => {
  const parts = url.split('/api/objects/created/')[1]?.split('?') || [];
  const addr = parts[0];
  const params = new URLSearchParams(parts[1] || '');
  const network = params.get('network') || 'btc-testnet';
  const mn = isMainnet(network);
  const skip = parseInt(params.get('skip') || '0');
  const limit = parseInt(params.get('limit') || '5');

  const data = await p2fkGet(`GetObjectsCreatedByAddress/${addr}`, mn);
  const all = Array.isArray(data) ? data.map(formatObject) : [];
  const page = all.slice(skip, skip + limit);
  return json({ objects: page, count: page.length, total: all.length, has_more: skip + limit < all.length });
};

handlers['/api/objects/counts/'] = async (url) => {
  const addr = url.split('/api/objects/counts/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const [owned, created, byAddr] = await Promise.all([
    p2fkGet(`GetObjectsOwnedByAddress/${addr}`, mn),
    p2fkGet(`GetObjectsCreatedByAddress/${addr}`, mn),
    p2fkGet(`GetObjectsByAddress/${addr}`, mn),
  ]);
  // Owned: address in Owners OR Creators (P2FK implicit ownership)
  const ownedSet = new Set();
  for (const obj of (owned || [])) {
    const oa = Object.keys(obj.Creators || {})[0];
    if (oa) ownedSet.add(oa);
  }
  for (const obj of (byAddr || [])) {
    const creators = obj.Creators || {};
    const owners = obj.Owners || {};
    const isOwner = Object.keys(owners).includes(addr);
    const isCreator = Object.keys(creators).includes(addr);
    if (isOwner || isCreator) {
      const oa = Object.keys(creators)[0];
      if (oa) ownedSet.add(oa);
    }
  }
  return json({ owned: ownedSet.size, created: Array.isArray(created) ? created.length : 0, collections: 0 });
};

handlers['/api/objects/collection/'] = async (url) => {
  const addr = url.split('/api/objects/collection/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const data = await p2fkGet(`GetObjectByAddress/${addr}`, mn);
  if (data && data.Id > 0) return json({ object: formatObject(data) });
  return json({ object: null }, 404);
};

// Collections by creator — mirrors SUP OBJ.cs GetObjectCollectionsByAddress
handlers['/api/collections/by-creator/'] = async (url) => {
  const addr = url.split('/api/collections/by-creator/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const data = await p2fkGet(`GetObjectsByAddress/${addr}`, mn);
  if (!Array.isArray(data)) return json({ collections: [], total: 0 });

  // Find unique Creators[1] addresses (collection addresses)
  const seen = new Set();
  const collectionAddrs = [];
  for (const obj of data) {
    const creators = obj.Creators || {};
    const keys = Object.keys(creators);
    if (keys.length >= 3 && keys.includes(addr) && !seen.has(keys[1])) {
      seen.add(keys[1]);
      collectionAddrs.push(keys[1]);
    }
  }

  // Resolve profiles for each collection address
  const collections = [];
  for (const colAddr of collectionAddrs) {
    try {
      const profile = await p2fkGet(`GetProfileByAddress/${colAddr}`, mn);
      if (profile && profile.URN) {
        const colObjects = (data || []).filter(o => {
          const ck = Object.keys(o.Creators || {});
          return ck.length >= 3 && ck[1] === colAddr;
        });
        collections.push({
          urn: profile.URN,
          address: colAddr,
          image: profile.Image || '',
          bio: profile.Bio || '',
          display_name: profile.DisplayName || null,
          object_count: colObjects.length,
        });
      }
    } catch (e) { /* skip */ }
  }
  return json({ collections, total: collections.length });
};

handlers['/api/objects/detail/'] = async (url) => {
  const addr = url.split('/api/objects/detail/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const data = await p2fkGet(`GetObjectByAddress/${addr}`, mn);
  if (data && data.Id > 0) return json({ object: formatObject(data) });
  return json({ object: null }, 404);
};

handlers['/api/objects/history/'] = async (url) => {
  return json({ history: [], count: 0 });
};

handlers['/api/urn/check/'] = async (url) => {
  const urn = url.split('/api/urn/check/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const mn = isMainnet(network);
  const data = await p2fkGet(`GetObjectByURN/${encodeURIComponent(urn)}`, mn);
  const exists = data && data.Id > 0;
  return json({ urn, available: !exists, exists });
};

// Wallet (mempool.space direct)
handlers['/api/wallet/utxos/'] = async (url) => {
  const addr = url.split('/api/wallet/utxos/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const base = mempoolBase(network);
  try {
    const r = await fetch(`${base}/address/${addr}/utxo`);
    const data = await r.json();
    return json({ utxos: data, address: addr });
  } catch (e) {
    return json({ utxos: [], error: e.message }, 500);
  }
};

handlers['/api/wallet/raw-tx/'] = async (url) => {
  const txid = url.split('/api/wallet/raw-tx/')[1]?.split('?')[0];
  const network = parseNetwork(url);
  const base = mempoolBase(network);
  try {
    const r = await fetch(`${base}/tx/${txid}/hex`);
    const hex = await r.text();
    return json({ hex, txid });
  } catch (e) {
    return json({ hex: '', error: e.message }, 500);
  }
};

handlers['/api/wallet/broadcast'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const txHex = body.tx_hex || body.hex || '';
  const network = body.network || 'btc-testnet';
  const base = mempoolBase(network);
  try {
    const r = await fetch(`${base}/tx`, { method: 'POST', body: txHex });
    const txid = await r.text();
    if (r.ok) return json({ success: true, txid: txid.trim() });
    return json({ success: false, error: txid }, r.status);
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
};

// IPFS
handlers['/api/ipfs/cat/'] = async (url) => {
  const cid = url.split('/api/ipfs/cat/')[1]?.split('?')[0];
  // Try local Kubo first, then public gateways
  try {
    const kuboResp = await fetch(`${KUBO_LOCAL}/api/v0/cat?arg=${cid}`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
    });
    if (kuboResp.ok) return kuboResp;
  } catch {} // Kubo not running, try gateways

  for (const gw of IPFS_GATEWAYS) {
    try {
      const r = await fetch(`${gw}${cid}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return r;
    } catch {}
  }
  return new Response('IPFS content not available', { status: 504 });
};

handlers['/api/ipfs/upload'] = async (url, opts) => {
  // Try local Kubo
  try {
    const r = await fetch(`${KUBO_LOCAL}/api/v0/add?pin=true`, {
      method: 'POST', body: opts?.body, signal: AbortSignal.timeout(30000),
    });
    if (r.ok) {
      const data = await r.json();
      return json({ cid: data.Hash, name: data.Name, size: data.Size });
    }
  } catch {}
  return json({ error: 'No IPFS node available. Start Kubo locally to upload files.' }, 503);
};

handlers['/api/ipfs/status'] = async () => {
  try {
    const r = await fetch(`${KUBO_LOCAL}/api/v0/id`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      return json({ online: true, agent: data.AgentVersion || 'kubo', standalone: true });
    }
  } catch {}
  return json({ online: false, standalone: true });
};

handlers['/api/ipfs/pin/'] = async () => json({ ok: true });

handlers['/api/ipfs/restart'] = async () => {
  // In standalone/Electron, Kubo is bundled. Just check if it's alive.
  try {
    const r = await fetch(`${KUBO_LOCAL}/api/v0/id`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (r.ok) return json({ ok: true, message: 'Kubo daemon is running' });
  } catch {}
  return json({ ok: false, message: 'Kubo daemon not reachable. Make sure it is running on localhost:5001.' }, 503);
};

// Reactions (local storage)
handlers['/api/reactions/'] = async (url, opts) => {
  if (opts?.method === 'POST') {
    // Store reaction locally
    return json({ ok: true, standalone: true });
  }
  return json({ reactions: {}, pending: [], standalone: true });
};

// Auth endpoints - return appropriate standalone responses
handlers['/api/auth/'] = async () => json({ standalone: true, message: 'Auth is client-side in standalone mode' });

// Admin endpoints - not available in standalone
handlers['/api/admin/'] = async () => json({ standalone: true, message: 'Admin panel is only available on the hosted version' }, 403);

// Chat/DM - not available standalone
handlers['/api/chat/'] = async () => json({ messages: [], standalone: true });

// Mesh — in standalone mode, connect to a known relay server for P2P signaling
// The relay URL can be configured by the user or default to the hosted Cthulhu instance
handlers['/api/mesh/'] = async (url, opts) => {
  const relayUrl = localStorage.getItem('cthulhu_mesh_relay');
  if (relayUrl) {
    // Forward mesh calls to the configured relay
    try {
      const meshPath = url.split('/api/mesh')[1] || '';
      const relayResp = await fetch(`${relayUrl}/api/mesh${meshPath}`, {
        ...opts,
        signal: AbortSignal.timeout(10000),
      });
      return relayResp;
    } catch {
      return json({ nodes: [], error: 'Relay unreachable' });
    }
  }
  return json({ nodes: [], no_relay: true });
};

// Discover
handlers['/api/discover'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const query = body.query || '';
  const network = body.network || 'btc-testnet';
  const mn = isMainnet(network);
  const results = [];

  const data = await p2fkGet(`GetObjectsByKeyword/${encodeURIComponent(query)}`, mn);
  if (Array.isArray(data)) {
    for (const obj of data.slice(0, 30)) results.push(formatObject(obj));
  }
  return json({ results, count: results.length, query });
};

// Releases
handlers['/api/releases/latest'] = async () => {
  const stored = localStorage.getItem('cthulhu_latest_release');
  if (stored) return json(JSON.parse(stored));
  return json({ available: false });
};

// SUPflix
handlers['/api/supflix/'] = async () => json({ items: [], standalone: true });

// Call settings
handlers['/api/call-settings/'] = async () => json({});

// Vault
handlers['/api/vault/'] = async () => json({ standalone: true });

// Paywall — disabled in standalone
handlers['/api/paywall/'] = async () => json({ paid: true, status: 'paywall_disabled', standalone: true });

// Treasury — in standalone mode, read from bundled config or return defaults
handlers['/api/treasury/info'] = async (url) => {
  const params = new URL(url, 'http://localhost').searchParams;
  const network = params.get('network') || 'btc-testnet';
  // Try loading from bundled config (set during build)
  const configKey = `cthulhu_treasury_${network}`;
  const storedAddr = localStorage.getItem(configKey);
  return json({
    address: storedAddr || null,
    balance_sats: 0,
    balance_btc: 0,
    tax_rate: 0.02,
    faucet_available: false,
    faucet_amount: 0,
    network,
    configured: !!storedAddr,
    standalone: true,
  });
};

// Treasury faucet — not available standalone
handlers['/api/treasury/faucet'] = async () => json({ error: 'Faucet is only available on the hosted version' }, 503);

// Known users — serve from localStorage seed data
handlers['/api/data/known-users'] = async (url) => {
  const params = new URL(url, 'http://localhost').searchParams;
  const network = params.get('network') || 'btc-testnet';
  const seedKey = `cthulhu_seed_users_${network}`;
  try {
    const data = JSON.parse(localStorage.getItem(seedKey) || '[]');
    return json({ users: data });
  } catch {
    return json({ users: [] });
  }
};

// Also handle the /api/known-users/ path pattern
handlers['/api/known-users/'] = async (url) => {
  const network = url.split('/api/known-users/')[1]?.split('?')[0] || 'btc-testnet';
  const seedKey = `cthulhu_seed_users_${network}`;
  try {
    const data = JSON.parse(localStorage.getItem(seedKey) || '[]');
    return json({ users: data });
  } catch {
    return json({ users: [] });
  }
};

// Favorites — stored locally
handlers['/api/favorites'] = async (url, opts) => {
  const key = 'cthulhu_favorites';
  if (opts?.method === 'POST' || opts?.method === 'PUT') {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const favs = JSON.parse(localStorage.getItem(key) || '[]');
    if (body.txid && !favs.includes(body.txid)) favs.push(body.txid);
    localStorage.setItem(key, JSON.stringify(favs));
    return json({ ok: true, favorites: favs });
  }
  if (opts?.method === 'DELETE') {
    const body = opts.body ? JSON.parse(opts.body) : {};
    let favs = JSON.parse(localStorage.getItem(key) || '[]');
    favs = favs.filter(f => f !== body.txid);
    localStorage.setItem(key, JSON.stringify(favs));
    return json({ ok: true, favorites: favs });
  }
  return json({ favorites: JSON.parse(localStorage.getItem(key) || '[]') });
};

// Encryption keys — store locally in standalone mode
handlers['/api/profile/keys/store'] = async (url, opts) => {
  if (opts?.method === 'POST') {
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (body.address && body.pkx) {
      const key = `cthulhu_keys_${body.address}`;
      localStorage.setItem(key, JSON.stringify({ pkx: body.pkx, pky: body.pky || '' }));
    }
    return json({ ok: true });
  }
  return json({ ok: true });
};

// Batch fetch encryption keys
handlers['/api/profile/keys/batch'] = async (url, opts) => {
  const body = opts?.body ? JSON.parse(opts.body) : {};
  const addresses = body.addresses || [];
  const keys = {};
  for (const addr of addresses) {
    const stored = localStorage.getItem(`cthulhu_keys_${addr}`);
    if (stored) keys[addr] = JSON.parse(stored);
  }
  return json({ keys });
};

// Etch/chunk — proxy to local Kubo for on-chain file etching
handlers['/api/etch/chunk'] = async (url, opts) => {
  return json({ error: 'Etching requires a funded wallet. Use the compose/object tools instead.' }, 400);
};

// Reports — not available in standalone
handlers['/api/admin/reports'] = async () => json({ reports: [], standalone: true });
handlers['/api/admin/my-reports/'] = async () => json({ reports: [], standalone: true });

// ─── Helpers ───

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Fetch Interceptor ───

function matchHandler(url) {
  // Strip origin for matching
  let path = url;
  try { path = new URL(url).pathname + new URL(url).search; } catch { /* relative URL */ }

  // Exact matches first
  if (handlers[path]) return handlers[path];

  // Prefix matches (longest first)
  const prefixes = Object.keys(handlers).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) return handlers[prefix];
  }
  return null;
}

let _installed = false;

export function installStandaloneMode() {
  if (_installed) return;
  _installed = true;

  const _originalFetch = window.fetch.bind(window);

  window.fetch = async function standaloneInterceptor(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';

    // Only intercept /api/ calls
    if (typeof url === 'string' && url.includes('/api/')) {
      const handler = matchHandler(url);
      if (handler) {
        try {
          return await handler(url, init);
        } catch (e) {
          console.warn('[Standalone] Handler error:', e);
          return json({ error: e.message, standalone: true }, 500);
        }
      }
      // No handler found — let it through (will likely 404)
      console.warn('[Standalone] No handler for:', url);
    }

    return _originalFetch(input, init);
  };

  console.log('[Cthulhu] Standalone mode active — direct P2FK/Mempool/IPFS');
}

// Also export individual pieces for testing
export { formatProfile, formatMessage, formatObject, p2fkGet, getProfile, handlers };
