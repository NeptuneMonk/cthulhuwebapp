import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { FiCopy, FiCheck, FiKey, FiRepeat, FiAward, FiBox, FiExternalLink, FiEye, FiEyeOff, FiLock, FiX, FiRefreshCw, FiUser, FiFolder, FiEdit3, FiChevronDown, FiChevronUp, FiArrowDownRight, FiArrowUpRight, FiArchive } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { copyToClipboard } from '@/utils/clipboard';
import { getCachedChangeAddress, getCachedRoyaltiesAddress } from '@/utils/txBuilder';
import { getRoyaltyAddresses } from '@/utils/royaltyAddresses';
import { KeyRevealModal } from '@/components/KeyRevealModal';
import { decryptWIF } from '@/utils/walletCrypto';
import { labelFromUrn } from '@/utils/addressLabels';

const API = process.env.REACT_APP_BACKEND_URL;

const CACHE_KEY = (addr) => `cthulhu_p2fk_addresses_${addr}`;
const LABELS_KEY = 'cthulhu_address_labels';
const ARCHIVED_KEY = 'cthulhu_archived_addresses';

function loadCachedP2FK(mainAddress) {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY(mainAddress)) || '[]'); }
  catch { return []; }
}

function loadCustomLabels() {
  try { return JSON.parse(localStorage.getItem(LABELS_KEY) || '{}'); }
  catch { return {}; }
}

function saveCustomLabel(address, label) {
  const labels = loadCustomLabels();
  if (label.trim()) labels[address] = label.trim();
  else delete labels[address];
  localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

function loadArchivedAddresses() {
  try { return JSON.parse(localStorage.getItem(ARCHIVED_KEY) || '[]'); }
  catch { return []; }
}

function saveArchivedAddresses(list) {
  localStorage.setItem(ARCHIVED_KEY, JSON.stringify(list));
}

export const WalletAddressBook = ({ network }) => {
  const { wallet } = useWallet();
  const { user, wif } = useAuth();
  const [copied, setCopied] = useState('');
  const [filter, setFilter] = useState('all');
  const [showKeyReveal, setShowKeyReveal] = useState(false);
  const [decryptingAddr, setDecryptingAddr] = useState(null);
  const [decryptPassword, setDecryptPassword] = useState('');
  const [decryptedWif, setDecryptedWif] = useState(null);
  const [decryptError, setDecryptError] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [p2fkAddrs, setP2fkAddrs] = useState([]);
  const [editingAddr, setEditingAddr] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [customLabels, setCustomLabels] = useState(loadCustomLabels());
  const [archivedAddrs, setArchivedAddrs] = useState(loadArchivedAddresses());
  const [expandedAddr, setExpandedAddr] = useState(null);
  const [txHistory, setTxHistory] = useState({});
  const [txLoading, setTxLoading] = useState({});

  const mainAddress = user?.address || wallet?.address;
  const activeWif = wif || wallet?.wif;
  const urn = user?.urn || '';
  const isTestnet = network?.includes('testnet');

  const copy = (text, id) => {
    copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  // Fetch P2FK addresses (OBJ, PRO, Collections) from p2fk.io via backend
  const discoverP2FK = useCallback(async (force = false) => {
    if (!mainAddress) return;
    if (!force) {
      const cached = loadCachedP2FK(mainAddress);
      if (cached.length > 0) { setP2fkAddrs(cached); return; }
    }
    setDiscovering(true);
    try {
      const res = await fetch(`${API}/api/wallet/discover-addresses/${mainAddress}?network=${network || 'btc-testnet'}`);
      if (!res.ok) throw new Error('Discovery failed');
      const data = await res.json();
      if (data.addresses?.length > 0) {
        localStorage.setItem(CACHE_KEY(mainAddress), JSON.stringify(data.addresses));
        setP2fkAddrs(data.addresses);
      }
    } catch (err) {
      console.warn('P2FK address discovery failed:', err);
    } finally {
      setDiscovering(false);
    }
  }, [mainAddress, network]);

  useEffect(() => {
    if (mainAddress) {
      const cached = loadCachedP2FK(mainAddress);
      if (cached.length > 0) setP2fkAddrs(cached);
      discoverP2FK();
    }
  }, [mainAddress, discoverP2FK]);

  // Save edited label
  const handleSaveLabel = useCallback((address) => {
    saveCustomLabel(address, editLabel);
    setCustomLabels(loadCustomLabels());
    setEditingAddr(null);
    setEditLabel('');
  }, [editLabel]);

  // Archive an address (hide it)
  const handleArchive = useCallback((address) => {
    const updated = [...archivedAddrs, address];
    setArchivedAddrs(updated);
    saveArchivedAddresses(updated);
  }, [archivedAddrs]);

  // Unarchive all addresses
  const handleUnarchiveAll = useCallback(() => {
    setArchivedAddrs([]);
    saveArchivedAddresses([]);
  }, []);

  // Fetch TX history for an address from mempool.space
  const fetchTxHistory = useCallback(async (address) => {
    if (txHistory[address] || txLoading[address]) return;
    setTxLoading(prev => ({ ...prev, [address]: true }));
    try {
      const base = isTestnet ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
      const resp = await fetch(`${base}/address/${address}/txs`, { signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const data = await resp.json();
        setTxHistory(prev => ({ ...prev, [address]: data.slice(0, 15) }));
      }
    } catch { /* silent */ }
    finally { setTxLoading(prev => ({ ...prev, [address]: false })); }
  }, [txHistory, txLoading, isTestnet]);

  // Toggle TX history panel
  const toggleTxHistory = useCallback((address) => {
    if (expandedAddr === address) {
      setExpandedAddr(null);
    } else {
      setExpandedAddr(address);
      fetchTxHistory(address);
    }
  }, [expandedAddr, fetchTxHistory]);

  // Build the address list: Main, Change, PRO, OBJ, Collections, Royalties
  const allAddresses = useMemo(() => {
    const seen = new Set();
    const addrs = [];
    const add = (entry) => {
      if (seen.has(entry.address)) return;
      seen.add(entry.address);
      addrs.push(entry);
    };

    // Main
    if (mainAddress) {
      add({ address: mainAddress, label: 'Main Address', type: 'main', icon: FiKey, color: 'blue' });
    }

    // Change
    const changeAddr = getCachedChangeAddress(mainAddress);
    if (changeAddr) {
      add({ address: changeAddr, label: 'Change Address', type: 'change', icon: FiRepeat, color: 'amber' });
    }

    // Royalties
    const defaultRoyalty = getCachedRoyaltiesAddress(mainAddress);
    if (defaultRoyalty) {
      add({ address: defaultRoyalty, label: 'Default Royalty', type: 'royalty', icon: FiAward, color: 'purple' });
    }
    const namedRoyalties = getRoyaltyAddresses(urn, network);
    namedRoyalties.forEach(r => {
      if (r.address !== defaultRoyalty) {
        add({ address: r.address, label: r.label || r.tag || 'Named Royalty', type: 'royalty', icon: FiAward, color: 'purple' });
      }
    });

    // Profile addresses (from p2fk.io discovery)
    p2fkAddrs.filter(a => a.type === 'profile').forEach(a => {
      add({ address: a.address, label: a.label || labelFromUrn(a.urn) || 'Profile', type: 'profile', icon: FiUser, color: 'cyan', urn: a.urn, txid: a.txid });
    });

    // Object addresses (from p2fk.io discovery)
    p2fkAddrs.filter(a => a.type === 'object').forEach(a => {
      add({ address: a.address, label: a.label || labelFromUrn(a.urn) || 'Object', type: 'object', icon: FiBox, color: 'teal', urn: a.urn, txid: a.txid });
    });

    // Collection addresses (from p2fk.io discovery)
    p2fkAddrs.filter(a => a.type === 'collection').forEach(a => {
      add({ address: a.address, label: a.label || 'Collection', type: 'collection', icon: FiFolder, color: 'violet', txid: a.txid });
    });

    // Local pending objects (not yet indexed on p2fk.io)
    try {
      const localObjs = JSON.parse(localStorage.getItem(`cthulhu_obj_addresses_${mainAddress}`) || '[]');
      localObjs.forEach(o => {
        if (!seen.has(o.address)) {
          const smartLabel = o.label || labelFromUrn(o.urn) || 'Object';
          add({
            address: o.address,
            label: `${smartLabel} ${o.status === 'pending' ? '(pending)' : ''}`.trim(),
            type: 'object',
            icon: FiBox,
            color: o.status === 'pending' ? 'gray' : 'teal',
            encryptedWif: o.encryptedWif,
            derivationIndex: o.derivationIndex,
          });
        }
      });
    } catch {}

    return addrs;
  }, [mainAddress, urn, network, p2fkAddrs]);

  const filtered = useMemo(() => {
    let list = allAddresses.filter(a => !archivedAddrs.includes(a.address));
    if (filter !== 'all') list = list.filter(a => a.type === filter);
    return list;
  }, [allAddresses, filter, archivedAddrs]);

  const archivedCount = useMemo(() => {
    return allAddresses.filter(a => archivedAddrs.includes(a.address)).length;
  }, [allAddresses, archivedAddrs]);

  const typeCounts = useMemo(() => {
    const counts = { all: allAddresses.length };
    allAddresses.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
    return counts;
  }, [allAddresses]);

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'main', label: 'Main' },
    { key: 'change', label: 'Change' },
    { key: 'profile', label: 'PRO' },
    { key: 'object', label: 'OBJ' },
    { key: 'collection', label: 'COL' },
    { key: 'royalty', label: 'ROY' },
  ].filter(f => typeCounts[f.key] > 0 || f.key === 'all');

  const explorerBase = isTestnet ? 'https://mempool.space/testnet/address/' : 'https://mempool.space/address/';

  const colorMap = {
    blue: { bg: 'bg-blue-500/15', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
    amber: { bg: 'bg-amber-500/15', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300' },
    purple: { bg: 'bg-purple-500/15', text: 'text-purple-400', badge: 'bg-purple-500/20 text-purple-300' },
    teal: { bg: 'bg-teal-500/15', text: 'text-teal-400', badge: 'bg-teal-500/20 text-teal-300' },
    cyan: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', badge: 'bg-cyan-500/20 text-cyan-300' },
    violet: { bg: 'bg-violet-500/15', text: 'text-violet-400', badge: 'bg-violet-500/20 text-violet-300' },
    gray: { bg: 'bg-gray-500/15', text: 'text-gray-400', badge: 'bg-gray-500/20 text-gray-300' },
  };

  const typeLabels = { main: 'MAIN', change: 'CHG', profile: 'PRO', object: 'OBJ', collection: 'COL', royalty: 'ROY' };

  return (
    <div className="space-y-3" data-testid="wallet-addresses-tab">
      {/* Summary */}
      <div className="p-3 rounded-lg border border-gray-800/50 bg-gray-900/60">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-gray-500">Your Addresses</p>
          <button
            onClick={() => discoverP2FK(true)}
            disabled={discovering}
            className="flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300 disabled:text-gray-600 transition-colors"
            data-testid="discover-addresses-btn"
          >
            {discovering ? <FiRefreshCw size={10} className="animate-spin" /> : <FiRefreshCw size={10} />}
            {discovering ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {typeCounts.main > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-blue-500/20 text-blue-300">{typeCounts.main} Main</span>}
          {typeCounts.change > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-300">{typeCounts.change} Change</span>}
          {typeCounts.profile > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-cyan-500/20 text-cyan-300">{typeCounts.profile} PRO</span>}
          {typeCounts.object > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-teal-500/20 text-teal-300">{typeCounts.object} OBJ</span>}
          {typeCounts.collection > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-violet-500/20 text-violet-300">{typeCounts.collection} COL</span>}
          {typeCounts.royalty > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-purple-500/20 text-purple-300">{typeCounts.royalty} ROY</span>}
        </div>
      </div>

      {/* Filter Tabs */}
      {filters.length > 2 && (
        <div className="flex gap-1 p-0.5 bg-gray-800/50 rounded-lg overflow-x-auto">
          {filters.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex-shrink-0 text-xs py-1.5 px-2 rounded-md transition-colors ${filter === f.key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              data-testid={`addr-filter-${f.key}`}
            >
              {f.label} {typeCounts[f.key] > 0 && <span className="text-[9px] ml-0.5 opacity-60">{typeCounts[f.key]}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Address List */}
      <div className="space-y-1 max-h-[450px] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {filtered.map((addr, i) => {
          const c = colorMap[addr.color] || colorMap.gray;
          const displayLabel = customLabels[addr.address] || addr.label;
          const isEditing = editingAddr === addr.address;
          const isExpanded = expandedAddr === addr.address;
          const addrTxs = txHistory[addr.address];
          const isLoadingTx = txLoading[addr.address];

          return (
            <div key={`${addr.address}-${i}`} data-testid={`addr-row-${i}`}>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-800/30 hover:bg-gray-800/50 transition-colors group">
                <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${c.bg} ${c.text}`}>
                  <addr.icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          type="text"
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(addr.address); if (e.key === 'Escape') setEditingAddr(null); }}
                          className="flex-1 min-w-0 px-1.5 py-0.5 bg-gray-900 border border-gray-600 rounded text-[11px] text-gray-200 focus:border-blue-500 focus:outline-none"
                          data-testid={`edit-label-input-${i}`}
                          autoFocus
                        />
                        <button onClick={() => handleSaveLabel(addr.address)} className="p-0.5 text-emerald-400 hover:text-emerald-300" data-testid={`save-label-${i}`}>
                          <FiCheck size={12} />
                        </button>
                        <button onClick={() => setEditingAddr(null)} className="p-0.5 text-gray-500 hover:text-gray-300">
                          <FiX size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-[11px] text-gray-300 truncate">{displayLabel}</span>
                        <span className={`px-1 py-0.5 text-[8px] rounded font-mono ${c.badge}`}>{typeLabels[addr.type] || addr.type}</span>
                        <button
                          onClick={() => { setEditingAddr(addr.address); setEditLabel(displayLabel); }}
                          className="p-0.5 text-gray-600 hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Edit label"
                          data-testid={`edit-label-btn-${i}`}
                        >
                          <FiEdit3 size={10} />
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 font-mono truncate">{addr.address}</p>
                  {addr.urn && <p className="text-[9px] text-gray-600 truncate">{addr.urn}</p>}
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {/* Archive button */}
                  <button
                    onClick={() => handleArchive(addr.address)}
                    className="p-1 rounded text-gray-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Archive (hide) address"
                    data-testid={`archive-addr-${i}`}
                  >
                    <FiEyeOff size={12} />
                  </button>
                  {/* TX History toggle */}
                  <button
                    onClick={() => toggleTxHistory(addr.address)}
                    className={`p-1 rounded transition-colors ${isExpanded ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400 opacity-0 group-hover:opacity-100'}`}
                    title="Transaction history"
                    data-testid={`tx-history-btn-${i}`}
                  >
                    {isExpanded ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
                  </button>
                  {(addr.encryptedWif || addr.type === 'main') && (
                    <button onClick={() => {
                      if (addr.type === 'main') { setShowKeyReveal(true); }
                      else { setDecryptingAddr(addr.address); setDecryptPassword(''); setDecryptedWif(null); setDecryptError(''); }
                    }}
                      className="p-1 rounded text-gray-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100" title="Reveal private key">
                      <FiLock size={12} />
                    </button>
                  )}
                  <button onClick={() => copy(addr.address, `addr-${i}`)} className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors opacity-0 group-hover:opacity-100" data-testid={`copy-addr-${i}`}>
                    {copied === `addr-${i}` ? <FiCheck size={12} className="text-emerald-400" /> : <FiCopy size={12} />}
                  </button>
                  <a href={`${explorerBase}${addr.address}`} target="_blank" rel="noopener noreferrer" className="p-1 rounded text-gray-600 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100">
                    <FiExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Expandable TX History Panel */}
              {isExpanded && (
                <div className="ml-9 mr-2 mb-1 mt-0.5 rounded-lg bg-gray-800/40 border border-gray-700/50 overflow-hidden" data-testid={`tx-panel-${i}`}>
                  {isLoadingTx ? (
                    <div className="flex items-center gap-2 p-3 text-xs text-gray-500">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400" /> Loading transactions...
                    </div>
                  ) : addrTxs && addrTxs.length > 0 ? (
                    <div className="divide-y divide-gray-700/30 max-h-[200px] overflow-y-auto">
                      {addrTxs.map(tx => {
                        const isIncoming = tx.vout?.some(v => v.scriptpubkey_address === addr.address);
                        const isOutgoing = tx.vin?.some(v => v.prevout?.scriptpubkey_address === addr.address);
                        const confirmed = tx.status?.confirmed;
                        const time = tx.status?.block_time ? new Date(tx.status.block_time * 1000) : null;
                        const totalOut = tx.vout?.reduce((s, v) => s + (v.value || 0), 0) || 0;
                        return (
                          <a key={tx.txid} href={`${isTestnet ? 'https://mempool.space/testnet/tx/' : 'https://mempool.space/tx/'}${tx.txid}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700/30 transition-colors"
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                              isOutgoing ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
                            }`}>
                              {isOutgoing ? <FiArrowUpRight size={10} /> : <FiArrowDownRight size={10} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-gray-400 font-mono truncate">{tx.txid.slice(0, 16)}...</p>
                              <p className="text-[9px] text-gray-600">
                                {time ? time.toLocaleDateString() + ' ' + time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unconfirmed'}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`text-[10px] font-mono ${isOutgoing ? 'text-red-400' : 'text-emerald-400'}`}>
                                {isOutgoing ? '-' : '+'}{(totalOut / 100_000_000).toFixed(8)}
                              </p>
                              <span className={`text-[8px] ${confirmed ? 'text-gray-600' : 'text-amber-400'}`}>
                                {confirmed ? 'Confirmed' : 'Pending'}
                              </span>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="p-3 text-xs text-gray-600">No transactions found.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-4">
            {discovering ? 'Scanning p2fk.io for your objects...' : 'No addresses found. Create an object or profile to see addresses here.'}
          </p>
        )}
      </div>

      {/* Unarchive All button */}
      {archivedCount > 0 && (
        <button
          onClick={handleUnarchiveAll}
          className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-amber-400/80 hover:text-amber-300 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 rounded-lg transition-colors"
          data-testid="unarchive-all-btn"
        >
          <FiArchive size={12} />
          Unarchive All ({archivedCount} hidden)
        </button>
      )}

      {/* Object WIF Decrypt Modal */}
      {decryptingAddr && (
        <div className="p-3 rounded-lg border border-amber-600/30 bg-amber-900/10 space-y-2" data-testid="decrypt-obj-wif-modal">
          <div className="flex items-center justify-between">
            <p className="text-xs text-amber-400 font-medium">Reveal Object Key</p>
            <button onClick={() => { setDecryptingAddr(null); setDecryptedWif(null); }} className="text-gray-500 hover:text-gray-300"><FiX size={14} /></button>
          </div>
          <p className="text-[10px] text-gray-400 font-mono break-all">{decryptingAddr}</p>
          {decryptedWif ? (
            <div className="space-y-1">
              <code className="block text-xs text-red-300 font-mono break-all bg-gray-800/60 rounded px-2 py-1.5" data-testid="decrypted-obj-wif">{decryptedWif}</code>
              <button onClick={() => { copy(decryptedWif, 'dec-wif'); }}
                className={`text-xs px-3 py-1 rounded-lg transition-colors ${copied === 'dec-wif' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}
                data-testid="copy-decrypted-wif">
                {copied === 'dec-wif' ? 'Copied!' : 'Copy Private Key'}
              </button>
            </div>
          ) : (
            <>
              <input type="password" value={decryptPassword} onChange={e => { setDecryptPassword(e.target.value); setDecryptError(''); }}
                placeholder="Enter wallet password..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:border-amber-500 focus:outline-none"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && decryptPassword) {
                    try {
                      const addr = allAddresses.find(a => a.address === decryptingAddr);
                      if (!addr?.encryptedWif) throw new Error('No encrypted key found');
                      const w = await decryptWIF(addr.encryptedWif, decryptPassword);
                      setDecryptedWif(w);
                    } catch { setDecryptError('Wrong password or corrupted key'); }
                  }
                }}
                data-testid="decrypt-password-input" autoFocus />
              {decryptError && <p className="text-[10px] text-red-400">{decryptError}</p>}
              <button onClick={async () => {
                try {
                  const addr = allAddresses.find(a => a.address === decryptingAddr);
                  if (!addr?.encryptedWif) throw new Error('No encrypted key found');
                  const w = await decryptWIF(addr.encryptedWif, decryptPassword);
                  setDecryptedWif(w);
                } catch { setDecryptError('Wrong password or corrupted key'); }
              }} disabled={!decryptPassword}
                className="w-full px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/40 disabled:bg-gray-700 disabled:text-gray-500 text-amber-300 text-xs font-medium rounded-lg transition-colors"
                data-testid="decrypt-confirm-btn">Decrypt Key</button>
            </>
          )}
        </div>
      )}

      {/* Private Key Reveal */}
      {user?.urn && (
        <div className="pt-2 border-t border-gray-800/40">
          <button onClick={() => setShowKeyReveal(true)}
            className="flex items-center gap-2 w-full py-2 text-xs text-gray-600 hover:text-gray-400 transition-colors justify-center"
            data-testid="reveal-private-key-btn"
          >
            <FiEye size={12} /> Reveal Private Key (WIF)
          </button>
        </div>
      )}

      {showKeyReveal && (
        <KeyRevealModal wif={activeWif} onClose={() => setShowKeyReveal(false)} />
      )}
    </div>
  );
};
