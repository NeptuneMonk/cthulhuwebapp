import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiLayers, FiFileText, FiImage, FiVideo, FiFile, FiPlus, FiSearch, FiArrowLeft, FiUpload, FiLock, FiX, FiSend, FiDownload, FiShield, FiEdit2, FiCheck, FiTrash2, FiRefreshCw, FiAlertTriangle, FiZap } from 'react-icons/fi';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useTheme } from '@/hooks/useTheme';
import FeePicker from '@/components/FeePicker';
import { ECPairFactory } from 'ecpair';
import { ecc } from '@/utils/ecc';
import * as bitcoin from 'bitcoinjs-lib';
import * as secp from '@noble/secp256k1';
import { eciesEncrypt, eciesDecrypt, publicKeyFromPKXY, wrapAsSEC, unwrapSEC } from '@/utils/ecies';
import { PatternLock, derivePatternKey, generateSalt as patternSalt } from '@/components/PatternLock';
import { buildEncryptedMsgTransaction, estimateOnChainCost, stripSigPrefix } from '@/utils/p2fk';
import { buildAndBroadcast } from '@/utils/txBuilder';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const ECPair = ECPairFactory(ecc);
const AUTO_LOCK_MS = 5 * 60 * 1000;
const VAULT_PATTERN_KEY = (addr) => `cthulhu_vault_pattern_${addr}`;
const VAULT_HIDDEN_KEY = (addr) => `cthulhu_vault_hidden_${addr}`;

const CATEGORIES = [
  { id: 'all', label: 'All', icon: FiLayers },
  { id: 'notes', label: 'Notes', icon: FiFileText },
  { id: 'images', label: 'Images', icon: FiImage },
  { id: 'videos', label: 'Videos', icon: FiVideo },
  { id: 'files', label: 'Files', icon: FiFile },
];

function getNetworkObj(network) {
  return (network || '').includes('mainnet') ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

function formatSats(sats) {
  if (sats >= 100000000) return `${(sats / 100000000).toFixed(4)} BTC`;
  if (sats >= 100000) return `${(sats / 100000).toFixed(1)}k sats`;
  return `${sats.toLocaleString()} sats`;
}

/** Compress an image file to JPEG at reduced resolution */
async function compressImage(file, maxWidth = 800, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        resolve(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(null); };
    img.src = URL.createObjectURL(file);
  });
}

function parseVaultEntry(content) {
  if (!content) return { category: 'notes', mime: '', body: content || '', originalName: '' };
  const fileMatch2 = content.match(/^\[file:([^:\]]*):([^\]]*)\]\s*(.*)/s);
  if (fileMatch2) {
    const mime = fileMatch2[1];
    const originalName = fileMatch2[2];
    const body = fileMatch2[3];
    if (mime.startsWith('image/')) return { category: 'images', mime, body, originalName };
    if (mime.startsWith('video/')) return { category: 'videos', mime, body, originalName };
    return { category: 'files', mime, body, originalName };
  }
  const noteMatch = content.match(/^\[note\]\s*(.*)/s);
  if (noteMatch) return { category: 'notes', mime: '', body: noteMatch[1], originalName: '' };
  return { category: 'notes', mime: '', body: content, originalName: '' };
}

export default function VaultPage({ network }) {
  const navigate = useNavigate();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  const { wallet, isConnected: walletConnected } = useWallet();
  const { wallpaperStyle } = useTheme();
  const activeWif = authWif || wallet?.wif;
  const activeAddress = authUser?.address || wallet?.address;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);

  // Pattern lock state (localStorage-backed)
  const [patternState, setPatternState] = useState('loading');
  const [patternSaltVal, setPatternSaltVal] = useState('');
  const [patternHash, setPatternHash] = useState('');
  const [setupPattern, setSetupPattern] = useState(null);
  const [patternError, setPatternError] = useState(false);
  const autoLockRef = useRef(null);

  // Vault items
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [fileCaption, setFileCaption] = useState('');

  // Cost confirmation state
  const [costEstimate, setCostEstimate] = useState(null);
  const [pendingBroadcast, setPendingBroadcast] = useState(null);

  // Hidden items (local hide since on-chain data is permanent)
  const [hiddenTxids, setHiddenTxids] = useState(new Set());

  // Batch select + delete confirmation
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { txids: [...], step: 1|2 }

  const getKeyInfo = useCallback(() => {
    if (!activeWif) return null;
    const networkObj = getNetworkObj(network);
    const keyPair = ECPair.fromWIF(activeWif, networkObj);
    const privKeyBytes = keyPair.privateKey;
    const uncompressed = secp.getPublicKey(privKeyBytes, false);
    const pkx = Array.from(uncompressed.slice(1, 33)).map(b => b.toString(16).padStart(2, '0')).join('');
    const pky = Array.from(uncompressed.slice(33, 65)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { privKeyBytes, pkx, pky, address: activeAddress };
  }, [activeWif, activeAddress, network]);

  // Load pattern from localStorage
  useEffect(() => {
    if (!activeAddress || !isConnected) return;
    try {
      const stored = JSON.parse(localStorage.getItem(VAULT_PATTERN_KEY(activeAddress)) || 'null');
      if (stored?.hash && stored?.salt) {
        setPatternSaltVal(stored.salt);
        setPatternHash(stored.hash);
        setPatternState('locked');
      } else {
        setPatternState('setup');
      }
    } catch { setPatternState('setup'); }
    // Load hidden txids
    try {
      const hidden = JSON.parse(localStorage.getItem(VAULT_HIDDEN_KEY(activeAddress)) || '[]');
      setHiddenTxids(new Set(hidden));
    } catch {}
  }, [activeAddress, isConnected]);

  // Auto-lock timer
  const resetAutoLock = useCallback(() => {
    if (autoLockRef.current) clearTimeout(autoLockRef.current);
    if (patternState === 'unlocked') {
      autoLockRef.current = setTimeout(() => {
        setPatternState('locked');
        setItems([]);
      }, AUTO_LOCK_MS);
    }
  }, [patternState]);

  useEffect(() => {
    resetAutoLock();
    const handler = () => resetAutoLock();
    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);
    return () => {
      if (autoLockRef.current) clearTimeout(autoLockRef.current);
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [resetAutoLock]);

  // Load vault items from blockchain (SEC-encrypted self-messages via GetRootsByAddress)
  const loadVaultItems = useCallback(async () => {
    if (!activeAddress || !activeWif) return;
    setLoading(true);
    try {
      const net = network || 'btc-testnet';
      const res = await fetch(`${API}/dm/vault/${activeAddress}?network=${net}&skip=0&limit=200`);
      if (!res.ok) { setItems([]); setLoading(false); return; }
      const data = await res.json();
      const messages = data.messages || [];

      const vaultItems = messages
        .filter(msg => msg.txid && !hiddenTxids.has(msg.txid))
        .map(msg => ({
          item_id: msg.txid,
          txid: msg.txid,
          encrypted_data: msg.encrypted_data,
          timestamp: msg.first_seen || msg.block_date || '',
          confirmed: msg.confirmed !== false,
        }));

      setItems(vaultItems);
    } catch { setItems([]); }
    setLoading(false);
  }, [activeAddress, activeWif, network, hiddenTxids]);

  useEffect(() => {
    if (patternState === 'unlocked') loadVaultItems();
  }, [patternState, loadVaultItems]);

  // Pattern handlers
  const handleSetupPattern = (pattern) => {
    if (!setupPattern) {
      setSetupPattern(pattern);
      setPatternState('confirm');
    }
  };

  const handleConfirmPattern = async (pattern) => {
    if (pattern.join('-') !== setupPattern.join('-')) {
      setPatternError(true);
      setTimeout(() => setPatternError(false), 800);
      return;
    }
    const salt = patternSalt();
    const { keyHash } = await derivePatternKey(pattern, salt);
    localStorage.setItem(VAULT_PATTERN_KEY(activeAddress), JSON.stringify({ hash: keyHash, salt }));
    setPatternSaltVal(salt);
    setPatternHash(keyHash);
    setPatternState('unlocked');
    setSetupPattern(null);
    toast.success('Pattern lock set!');
  };

  const handleUnlock = async (pattern) => {
    try {
      const { keyHash } = await derivePatternKey(pattern, patternSaltVal);
      if (keyHash !== patternHash) {
        setPatternError(true);
        setTimeout(() => setPatternError(false), 800);
        return;
      }
      setPatternState('unlocked');
      setPatternError(false);
    } catch {
      setPatternError(true);
      setTimeout(() => setPatternError(false), 800);
    }
  };

  // Encrypt content and show cost estimate
  const prepareOnChainNote = async () => {
    if (!noteText.trim() || !activeWif) return;
    const content = `[note] ${noteText.trim()}`;
    const contentBytes = new TextEncoder().encode(content);
    const cost = estimateOnChainCost(contentBytes.length);
    setCostEstimate({ ...cost, type: 'note', label: 'Note', rawBytes: contentBytes.length });
    setPendingBroadcast({ content, contentBytes, isFile: false });
  };

  const prepareOnChainFile = async () => {
    if (!pendingFile || !activeWif) return;
    const file = pendingFile.file;
    let fileBytes = new Uint8Array(await file.arrayBuffer());
    let mimeType = file.type || 'application/octet-stream';
    let fileName = file.name;
    let compressed = false;

    // Compress images
    if (file.type.startsWith('image/') && file.size > 10000) {
      const blob = await compressImage(file, 800, 0.6);
      if (blob && blob.size < file.size) {
        fileBytes = new Uint8Array(await blob.arrayBuffer());
        mimeType = 'image/jpeg';
        fileName = file.name.replace(/\.[^.]+$/, '.jpg');
        compressed = true;
      }
    }

    const caption = fileCaption.trim();
    const meta = `[file:${mimeType}:${fileName}]`;
    const headerStr = caption ? `${meta} ${caption}` : meta;
    const headerBytes = new TextEncoder().encode(headerStr);

    // Combine: header + null separator + file bytes
    const combined = new Uint8Array(headerBytes.length + 1 + fileBytes.length);
    combined.set(headerBytes, 0);
    combined[headerBytes.length] = 0; // null separator
    combined.set(fileBytes, headerBytes.length + 1);

    const cost = estimateOnChainCost(combined.length);
    const category = mimeType.startsWith('image/') ? 'Image' : mimeType.startsWith('video/') ? 'Video' : 'File';
    setCostEstimate({
      ...cost,
      type: 'file',
      label: `${category}: ${fileName}`,
      rawBytes: combined.length,
      originalSize: file.size,
      compressedSize: compressed ? fileBytes.length : null,
      compressed,
    });
    setPendingBroadcast({ contentBytes: combined, isFile: true, fileName });
  };

  // Broadcast the prepared vault entry on-chain
  const broadcastVaultEntry = async () => {
    if (!pendingBroadcast || !activeWif || sending) return;
    setSending(true);
    try {
      const keyInfo = getKeyInfo();
      if (!keyInfo) throw new Error('Wallet not available');

      toast.info('Encrypting...');
      const recipientPubKey = publicKeyFromPKXY(keyInfo.pkx, keyInfo.pky);
      const innerEncrypted = await eciesEncrypt(recipientPubKey, pendingBroadcast.contentBytes);
      const secPayload = wrapAsSEC(innerEncrypted);

      toast.info('Building transaction...');
      const txData = buildEncryptedMsgTransaction(activeWif, secPayload, network || 'btc-testnet');

      toast.info('Broadcasting...');
      const result = await buildAndBroadcast(
        activeWif,
        txData.addresses,
        txData.network,
        [],   // extraOutputs
        0,    // feeRate (auto)
        546,  // dustAmount
        [],   // postPaymentDustAddresses
        txData.taxInsertIndex
      );

      if (result?.txid) {
        toast.success(`Etched to blockchain! TX: ${result.txid.slice(0, 12)}...`);
        setNoteText('');
        setShowCompose(false);
        clearPendingFile();
        setCostEstimate(null);
        setPendingBroadcast(null);
        // Add optimistic entry
        setItems(prev => [{
          item_id: result.txid,
          txid: result.txid,
          timestamp: new Date().toISOString(),
          confirmed: false,
          _optimistic: true,
          _decryptedContent: pendingBroadcast.isFile ? pendingBroadcast.fileName : pendingBroadcast.content?.replace('[note] ', ''),
          _category: pendingBroadcast.isFile ? 'files' : 'notes',
        }, ...prev]);
      }
    } catch (err) {
      toast.error(`Broadcast failed: ${err.message}`);
    }
    setSending(false);
  };

  const cancelCostEstimate = () => {
    setCostEstimate(null);
    setPendingBroadcast(null);
  };

  const clearPendingFile = () => {
    if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    setFileCaption('');
  };

  const handleFileSelect = (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    const previewUrl = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;
    setPendingFile({ file, previewUrl });
    setFileCaption('');
    e.target.value = '';
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const file = (e.dataTransfer?.files || [])[0];
    if (!file) return;
    const previewUrl = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;
    setPendingFile({ file, previewUrl });
    setFileCaption('');
  };

  const hideItem = (txid) => {
    const newHidden = new Set([...hiddenTxids, txid]);
    setHiddenTxids(newHidden);
    setItems(prev => prev.filter(i => i.item_id !== txid));
    localStorage.setItem(VAULT_HIDDEN_KEY(activeAddress), JSON.stringify([...newHidden]));
  };

  // Delete confirmation flow (double verify)
  const requestDelete = (txids) => {
    setDeleteConfirm({ txids, step: 1 });
  };

  const advanceDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.step === 1) {
      setDeleteConfirm({ ...deleteConfirm, step: 2 });
    } else {
      // Execute hide
      deleteConfirm.txids.forEach(txid => hideItem(txid));
      setDeleteConfirm(null);
      setSelectedItems(new Set());
      setSelectMode(false);
      toast.success(`${deleteConfirm.txids.length} item${deleteConfirm.txids.length > 1 ? 's' : ''} hidden`);
    }
  };

  const cancelDelete = () => setDeleteConfirm(null);

  const toggleSelect = (txid) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(txid)) next.delete(txid); else next.add(txid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filtered.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filtered.map(i => i.txid)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedItems(new Set());
  };

  // Filter items
  const filtered = items.filter(e => {
    const cat = e._category || e.category || 'notes';
    if (activeCategory !== 'all' && cat !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (e._decryptedContent || e.label || e.txid || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Not connected
  if (!isConnected || !activeWif) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 px-4">
        <FiLock size={48} className="text-gray-700 mb-4" />
        <h2 className="text-xl font-bold text-gray-300 mb-2" data-testid="vault-locked-title">Data Vault</h2>
        <p className="text-gray-500 text-center">Sign in and unlock your wallet to access your encrypted vault.</p>
      </div>
    );
  }

  if (patternState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mb-4" />
        <p className="text-gray-500 text-sm">Loading vault...</p>
      </div>
    );
  }

  if (patternState === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-10 px-4">
        <FiShield size={36} className="text-teal-400 mb-3" />
        <h2 className="text-lg font-bold text-gray-200 mb-1" data-testid="vault-setup-title">Set Up Vault Pattern</h2>
        <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">
          Draw a pattern to protect your vault. Connect at least 4 dots.
        </p>
        <PatternLock size={240} onComplete={handleSetupPattern} mode="setup" data-testid="vault-pattern-setup" />
        <p className="text-xs text-gray-600 mt-4">Remember this pattern — it cannot be recovered.</p>
      </div>
    );
  }

  if (patternState === 'confirm') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-10 px-4">
        <FiShield size={36} className="text-teal-400 mb-3" />
        <h2 className="text-lg font-bold text-gray-200 mb-1">Confirm Pattern</h2>
        <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">Draw the same pattern again to confirm.</p>
        <PatternLock size={240} onComplete={handleConfirmPattern} error={patternError} data-testid="vault-pattern-confirm" />
        <button onClick={() => { setPatternState('setup'); setSetupPattern(null); }}
          className="mt-4 text-xs text-gray-500 hover:text-gray-300">Start over</button>
      </div>
    );
  }

  if (patternState === 'locked') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-10 px-4">
        <FiLock size={36} className="text-teal-400 mb-3" />
        <h2 className="text-lg font-bold text-gray-200 mb-1" data-testid="vault-unlock-title">Unlock Vault</h2>
        <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">Draw your pattern to unlock the vault.</p>
        <PatternLock size={240} onComplete={handleUnlock} error={patternError} data-testid="vault-pattern-unlock" />
        {patternError && <p className="text-xs text-red-400 mt-2">Wrong pattern. Try again.</p>}
      </div>
    );
  }

  // Cost confirmation overlay
  if (costEstimate) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-10 px-4">
        <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4" data-testid="vault-cost-dialog">
          <div className="flex items-center gap-2 text-amber-400">
            <FiZap size={20} />
            <h3 className="text-base font-bold">On-Chain Cost Estimate</h3>
          </div>
          <p className="text-sm text-gray-300">{costEstimate.label}</p>

          {costEstimate.compressed && (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg p-2.5">
              <FiAlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300">
                Image compressed: {(costEstimate.originalSize / 1024).toFixed(0)} KB &rarr; {(costEstimate.compressedSize / 1024).toFixed(0)} KB (JPEG {'\u2022'} 800px max)
              </p>
            </div>
          )}

          {costEstimate.rawBytes > 50000 && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-lg p-2.5">
              <FiAlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-300">
                Large payload ({(costEstimate.rawBytes / 1024).toFixed(0)} KB). This will be expensive on-chain. Consider if the permanence is worth the cost.
              </p>
            </div>
          )}

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-gray-400">
              <span>Payload</span>
              <span>{(costEstimate.rawBytes / 1024).toFixed(1)} KB</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>P2FK addresses</span>
              <span>{costEstimate.numAddresses}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Dust outputs</span>
              <span>{formatSats(costEstimate.dustCost)}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Est. TX fee</span>
              <span>{formatSats(costEstimate.txFee)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-200 border-t border-gray-700 pt-1.5 mt-1.5">
              <span>Total estimated</span>
              <span className="text-teal-400">{formatSats(costEstimate.totalSats)}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <FeePicker network={network} />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={cancelCostEstimate}
              className="flex-1 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors"
              data-testid="vault-cost-cancel">
              Cancel
            </button>
            <button onClick={broadcastVaultEntry} disabled={sending}
              className="flex-1 px-4 py-2 text-sm bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
              data-testid="vault-cost-confirm">
              <FiZap size={14} />
              {sending ? 'Broadcasting...' : 'Etch On-Chain'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Unlocked — show vault content
  return (
    <div className="flex flex-col h-full" onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-800">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-200 lg:hidden" data-testid="vault-back">
          <FiArrowLeft size={20} />
        </button>
        <FiLayers size={20} className="text-teal-400" />
        <h1 className="text-lg font-bold text-gray-100">Data Vault</h1>
        <span className="text-xs text-gray-600">{items.length} on-chain</span>
        <div className="flex-1" />
        {selectMode ? (
          <>
            <button onClick={toggleSelectAll}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              data-testid="vault-select-all-btn">
              {selectedItems.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
            <button onClick={exitSelectMode}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              data-testid="vault-cancel-select-btn">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setSelectMode(true)} disabled={items.length === 0}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-30"
              title="Select items" data-testid="vault-select-mode-btn">
              <FiCheck size={16} />
            </button>
            <button onClick={loadVaultItems} disabled={loading}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-teal-400 transition-colors disabled:opacity-40"
              title="Refresh from blockchain" data-testid="vault-resync-btn">
              <FiRefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        )}
        <button onClick={() => { setPatternState('locked'); setItems([]); }}
          className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="Lock vault" data-testid="vault-lock-btn">
          <FiLock size={16} />
        </button>
        <button onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="Upload file" data-testid="vault-upload-btn">
          <FiUpload size={16} />
        </button>
        <button onClick={() => { setShowCompose(!showCompose); clearPendingFile(); }}
          className="p-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors"
          title="New note" data-testid="vault-new-note-btn">
          <FiPlus size={16} />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
      </div>

      {/* Category tabs + Search */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/60 overflow-x-auto scrollbar-hide">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          return (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat.id
                  ? 'bg-teal-600/20 text-teal-400 border border-teal-600/40'
                  : 'bg-gray-800/40 text-gray-400 border border-gray-800 hover:border-gray-700'
              }`}
              data-testid={`vault-cat-${cat.id}`}>
              <Icon size={12} /> {cat.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="relative">
          <FiSearch size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..." className="pl-7 pr-3 py-1.5 text-xs bg-gray-800/60 border border-gray-800 rounded-full text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-700 w-36"
            data-testid="vault-search" />
        </div>
      </div>

      {/* File preview + caption */}
      {pendingFile && (
        <div className="p-4 border-b border-gray-800/60 bg-gray-900/40" data-testid="vault-file-preview">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0 flex items-center justify-center">
              {pendingFile.previewUrl && pendingFile.file.type.startsWith('image/') ? (
                <img src={pendingFile.previewUrl} alt="Preview" className="w-full h-full object-cover" />
              ) : <FiFile size={24} className="text-gray-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{pendingFile.file.name}</p>
              <p className="text-[10px] text-gray-500">{(pendingFile.file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={clearPendingFile} className="text-gray-500 hover:text-gray-300 p-1" data-testid="vault-file-cancel">
              <FiX size={16} />
            </button>
          </div>
          <div className="flex gap-2">
            <input type="text" value={fileCaption} onChange={e => setFileCaption(e.target.value)}
              placeholder="Add a label... (optional)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600"
              onKeyDown={e => { if (e.key === 'Enter') prepareOnChainFile(); }}
              data-testid="vault-file-caption" />
            <button onClick={prepareOnChainFile} disabled={sending}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-1.5"
              data-testid="vault-file-send">
              <FiZap size={14} /> Estimate Cost
            </button>
          </div>
        </div>
      )}

      {/* Note composer */}
      {showCompose && !pendingFile && (
        <div className="p-4 border-b border-gray-800/60 bg-gray-900/40">
          <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder="Write a private note..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600 resize-none"
            rows={3} autoFocus data-testid="vault-note-input" />
          <div className="flex justify-between items-center mt-2">
            <span className="text-[10px] text-gray-600">
              ~{formatSats(estimateOnChainCost(new TextEncoder().encode(`[note] ${noteText}`).length).totalSats)} estimated
            </span>
            <div className="flex gap-2">
              <button onClick={() => { setShowCompose(false); setNoteText(''); }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
              <button onClick={prepareOnChainNote} disabled={!noteText.trim() || sending}
                className="px-4 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium flex items-center gap-1"
                data-testid="vault-save-note">
                <FiZap size={11} /> Etch On-Chain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4" style={wallpaperStyle}>
        {loading ? (
          <div className="text-center py-16 text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mx-auto mb-3" />
            Loading from blockchain...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FiLayers size={40} className="mx-auto text-gray-700 mb-3" />
            <p className="text-gray-400 mb-1">{items.length === 0 ? 'Your vault is empty' : 'No matching items'}</p>
            <p className="text-xs text-gray-600">
              {items.length === 0 ? 'Notes and files etched to the blockchain live forever.' : 'Try a different search or category.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => (
              <VaultItemCard
                key={item.item_id}
                item={item}
                privKeyBytes={getKeyInfo()?.privKeyBytes}
                network={network}
                onHide={() => requestDelete([item.txid])}
                selectMode={selectMode}
                selected={selectedItems.has(item.txid)}
                onToggleSelect={() => toggleSelect(item.txid)}
              />
            ))}
          </div>
        )}

        {/* Batch delete bar */}
        {selectMode && selectedItems.size > 0 && (
          <div className="sticky bottom-0 mt-4 flex items-center justify-between bg-gray-900/95 border border-red-800/40 rounded-xl px-4 py-3 backdrop-blur-sm" data-testid="vault-batch-bar">
            <span className="text-sm text-gray-300">{selectedItems.size} selected</span>
            <button
              onClick={() => requestDelete([...selectedItems])}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600/80 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
              data-testid="vault-batch-delete-btn"
            >
              <FiTrash2 size={14} /> Hide Selected
            </button>
          </div>
        )}
      </div>

      {/* Double-confirm delete modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" data-testid="vault-delete-modal">
          <div className="w-full max-w-xs bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            {deleteConfirm.step === 1 ? (
              <>
                <div className="flex items-center gap-2 text-amber-400">
                  <FiAlertTriangle size={20} />
                  <h3 className="text-base font-bold">Hide {deleteConfirm.txids.length > 1 ? `${deleteConfirm.txids.length} Items` : 'Item'}?</h3>
                </div>
                <p className="text-sm text-gray-400">
                  {deleteConfirm.txids.length > 1
                    ? `This will hide ${deleteConfirm.txids.length} items from your vault view.`
                    : 'This will hide this item from your vault view.'}
                </p>
                <p className="text-xs text-gray-600">On-chain data is permanent and cannot be deleted from the blockchain.</p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-red-400">
                  <FiAlertTriangle size={20} />
                  <h3 className="text-base font-bold">Are you sure?</h3>
                </div>
                <p className="text-sm text-gray-400">
                  You won't see {deleteConfirm.txids.length > 1 ? 'these items' : 'this item'} in your vault anymore. You can restore hidden items by clearing vault data in settings.
                </p>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={cancelDelete}
                className="flex-1 px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors"
                data-testid="vault-delete-cancel">
                Cancel
              </button>
              <button onClick={advanceDelete}
                className={`flex-1 px-4 py-2 text-sm text-white rounded-lg font-medium transition-colors ${
                  deleteConfirm.step === 1
                    ? 'bg-amber-600/80 hover:bg-amber-600'
                    : 'bg-red-600/80 hover:bg-red-600'
                }`}
                data-testid="vault-delete-confirm">
                {deleteConfirm.step === 1 ? 'Continue' : 'Yes, Hide Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VaultItemCard({ item, privKeyBytes, network, onHide, selectMode, selected, onToggleSelect }) {
  const [decryptedContent, setDecryptedContent] = useState(item._decryptedContent || null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState('');
  const [blobUrl, setBlobUrl] = useState(null);
  const [category, setCategory] = useState(item._category || 'notes');

  const iconMap = { notes: FiFileText, images: FiImage, videos: FiVideo, files: FiFile };
  const Icon = iconMap[category] || FiFile;

  const decrypt = async () => {
    if (!privKeyBytes) return;
    setDecrypting(true);
    setDecryptError('');
    try {
      let secBytes = null;

      // Fetch raw SEC data from blockchain via backend (preserves binary integrity)
      if (item.txid) {
        try {
          const secResp = await fetch(`${API}/dm/sec-file/${item.txid}?network=${network || 'btc-testnet'}`, { signal: AbortSignal.timeout(30000) });
          if (secResp.ok) {
            const secData = await secResp.json();
            if (secData.encrypted_data) {
              secBytes = Uint8Array.from(atob(secData.encrypted_data), c => c.charCodeAt(0));
            }
          }
        } catch (e) { console.warn('SEC fetch error:', e.message); }
      }

      if (!secBytes) throw new Error('Could not fetch encrypted data from blockchain');

      // Unwrap SEC format → raw ECIES ciphertext
      let cipherBytes;
      if (secBytes[0] === 0x53 && secBytes[1] === 0x45 && secBytes[2] === 0x43) {
        cipherBytes = unwrapSEC(secBytes);
      } else {
        cipherBytes = secBytes;
      }

      // ECIES decrypt with user's private key
      const plainBytes = await eciesDecrypt(privKeyBytes, cipherBytes);

      // Check for file data (null separator between header and file bytes)
      const nullIdx = plainBytes.indexOf(0);
      if (nullIdx > 0 && nullIdx < 500 && nullIdx < plainBytes.length - 1) {
        const headerText = new TextDecoder().decode(plainBytes.slice(0, nullIdx));
        const fileData = plainBytes.slice(nullIdx + 1);
        const parsed = parseVaultEntry(headerText);
        setCategory(parsed.category);
        const blob = new Blob([fileData], { type: parsed.mime || 'application/octet-stream' });
        setBlobUrl(URL.createObjectURL(blob));
        setDecryptedContent(parsed.body || parsed.originalName || headerText);
      } else {
        // Text content — strip SIG prefix and salt
        let plaintext;
        try {
          const msgBytes = stripSigPrefix(plainBytes);
          plaintext = new TextDecoder().decode(msgBytes);
        } catch { plaintext = new TextDecoder().decode(plainBytes); }
        plaintext = plaintext.replace(/<<-?\d+>>$/, '').trim();

        // Strip framing delimiters: <sep><length><sep><content>
        const firstByte = plaintext.charCodeAt(0);
        const seps = new Set([92, 47, 58, 42, 63, 34, 60, 62, 124]);
        if (seps.has(firstByte)) {
          const sep = plaintext[0];
          const secondSepIdx = plaintext.indexOf(sep, 1);
          if (secondSepIdx > 0) {
            plaintext = plaintext.slice(secondSepIdx + 1);
          }
        }

        const parsed = parseVaultEntry(plaintext);
        setCategory(parsed.category);
        setDecryptedContent(parsed.body || plaintext);
      }
    } catch (err) {
      console.error('Vault decrypt error:', err);
      setDecryptError(err.message?.includes('Point.fromHex') ? 'Wrong key' : err.message || 'Decryption failed');
    }
    setDecrypting(false);
  };

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  return (
    <div
      className={`p-3 bg-gray-900/60 border rounded-lg group transition-colors ${
        selected ? 'border-red-600/50 bg-red-900/10' : 'border-gray-800/60'
      }`}
      onClick={selectMode ? onToggleSelect : undefined}
      data-testid={`vault-item-${item.item_id}`}
    >
      <div className="flex items-start gap-3">
        {selectMode ? (
          <div className={`w-5 h-5 mt-1.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
            selected ? 'bg-red-500 border-red-500' : 'border-gray-600 hover:border-gray-400'
          }`} data-testid={`vault-select-${item.item_id}`}>
            {selected && <FiCheck size={12} className="text-white" />}
          </div>
        ) : (
          <div className="w-9 h-9 rounded-lg bg-gray-800/60 flex items-center justify-center flex-shrink-0 mt-0.5">
            {decryptedContent ? <Icon size={16} className="text-teal-400" /> : <FiLock size={16} className="text-gray-600" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] text-gray-600 mb-1">
            {item.txid && <span className="font-mono">{item.txid.slice(0, 10)}...</span>}
            {item.timestamp && <span>{new Date(item.timestamp).toLocaleString()}</span>}
            {item.confirmed === false && <span className="text-amber-400 flex items-center gap-0.5"><FiRefreshCw size={8} className="animate-spin" /> Pending</span>}
            {item._optimistic && <span className="text-amber-400">Unconfirmed</span>}
          </div>

          {decryptedContent && (
            <div className="mt-1.5">
              {blobUrl && category === 'images' && (
                <div className="mb-2">
                  <img src={blobUrl} alt="" className="max-w-full max-h-48 rounded-md object-contain" />
                  <a href={blobUrl} download="vault-image" className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 mt-1">
                    <FiDownload size={11} /> Save
                  </a>
                </div>
              )}
              {blobUrl && category === 'videos' && (
                <div className="mb-2">
                  <video src={blobUrl} controls className="max-w-full max-h-48 rounded-md" />
                  <a href={blobUrl} download="vault-video" className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 mt-1">
                    <FiDownload size={11} /> Save
                  </a>
                </div>
              )}
              {blobUrl && category === 'files' && (
                <a href={blobUrl} download="vault-file"
                  className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 bg-teal-600/10 px-2.5 py-1 rounded-md border border-teal-600/20 mt-1 inline-flex">
                  <FiDownload size={11} /> Download
                </a>
              )}
              {category === 'notes' && (
                <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{decryptedContent}</p>
              )}
            </div>
          )}

          {!decryptedContent && !decrypting && !decryptError && (
            <button onClick={decrypt}
              className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 transition-colors bg-teal-600/10 px-2.5 py-1 rounded-md border border-teal-600/20"
              data-testid="vault-decrypt-btn">
              <FiLock size={11} /> Decrypt & View
            </button>
          )}
          {decrypting && <span className="text-xs text-gray-500 animate-pulse">Decrypting...</span>}
          {decryptError && <span className="text-[10px] text-red-400">{decryptError}</span>}
        </div>

        {!selectMode && (
          <button onClick={onHide}
            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-600 hover:text-red-400 transition-all"
            title="Hide (on-chain data persists)"
            data-testid={`vault-hide-${item.item_id}`}>
            <FiTrash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
