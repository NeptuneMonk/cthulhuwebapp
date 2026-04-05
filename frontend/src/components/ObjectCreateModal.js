import React, { useState, useRef, useEffect, useMemo } from 'react';
import { FiX, FiSend, FiPlus, FiTrash2, FiPercent, FiBox, FiImage, FiUpload, FiShield, FiCheck, FiArrowLeft, FiChevronDown } from 'react-icons/fi';
import { useWallet } from '@/hooks/useWallet';
import { useAuth } from '@/hooks/useAuth';
import { IpfsStatus } from '@/components/IpfsStatus';
import { addTransaction } from '@/utils/txHistory';
import { addOptimisticItem } from '@/utils/optimisticCache';
import { compressImage, formatFileSize, getSizeWarning } from '@/utils/imageCompress';
import {
  getRoyaltyAddresses,
  generateAndStoreRoyalty,
} from '@/utils/royaltyAddresses';
import { getCachedRoyaltiesAddress } from '@/utils/txBuilder';
import { labelFromUrn } from '@/utils/addressLabels';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const ObjectCreateModal = ({ onClose, network, prefillImage, fullPage, tetherRoom }) => {
  const { wallet, isConnected: walletConnected, balance, refreshBalance } = useWallet();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();

  // Prefer auth wallet
  const activeWif = authWif || wallet?.wif;
  const activeAddress = authUser?.address || wallet?.address;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);

  // Draft persistence
  const DRAFT_KEY = 'object-create-draft';
  const savedDraft = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; } })();

  const [urn, setUrn] = useState(savedDraft.urn || '');
  const [name, setName] = useState(savedDraft.name || '');
  const [description, setDescription] = useState(savedDraft.description || '');
  const [image, setImage] = useState(prefillImage || savedDraft.image || '');
  const [uri, setUri] = useState(savedDraft.uri || '');
  const [license, setLicense] = useState(savedDraft.license || '');
  const [maxPerAddress, setMaxPerAddress] = useState(savedDraft.maxPerAddress || '');
  const [supply, setSupply] = useState(savedDraft.supply || 1);
  const [keywords, setKeywords] = useState(savedDraft.keywords || '');
  const [royalties, setRoyalties] = useState(savedDraft.royalties || []);
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(null); // 'cover' or 'file'
  const [uploadProgress, setUploadProgress] = useState(null); // { target, pct, filename }
  const [uploadSuccess, setUploadSuccess] = useState(null); // { target, cid, filename }
  const [collectionAddress, setCollectionAddress] = useState('');
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [newCollImage, setNewCollImage] = useState('');
  const [newCollDesc, setNewCollDesc] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [collectionStep, setCollectionStep] = useState(''); // 'funding' | 'minting' | 'done' | 'error'
  const [collectionError, setCollectionError] = useState('');
  const [urnStatus, setUrnStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [urnClaimedBy, setUrnClaimedBy] = useState(null);
  const [pregenAddress, setPregenAddress] = useState(null); // { address, wif, label }
  const [objKeyPassword, setObjKeyPassword] = useState('');
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [keyEncrypted, setKeyEncrypted] = useState(false);
  const [wifRevealed, setWifRevealed] = useState(false);
  const [wifCopied, setWifCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const generatingRef = useRef(false); // Guard against double address generation
  const urnFileRef = useRef(null);
  const coverFileRef = useRef(null);
  const contentFileRef = useRef(null);
  const urnCheckTimer = useRef(null);

  // Auto-save draft
  useEffect(() => {
    const draft = { urn, name, description, image: prefillImage ? '' : image, uri, license, maxPerAddress, supply, keywords, royalties };
    if (Object.values(draft).some(v => v && (typeof v === 'string' ? v.length > 0 : Array.isArray(v) ? v.length > 0 : v !== 1))) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
  }, [urn, name, description, image, uri, license, maxPerAddress, supply, keywords, royalties, prefillImage, DRAFT_KEY]);

  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  // Fetch artist's existing P2FK collections (Creator[1] addresses with profiles)
  useEffect(() => {
    if (!isConnected || !activeAddress) return;
    setLoadingCollections(true);
    axios.get(`${API}/collections/by-creator/${activeAddress}`, { params: { network } })
      .then(res => {
        const fetched = res.data.collections || [];
        // Merge with any locally-saved collections not yet on-chain
        const localKey = `cthulhu_collections_${network}_${activeAddress}`;
        try {
          const local = JSON.parse(localStorage.getItem(localKey) || '[]');
          const onChainAddrs = new Set(fetched.map(c => c.address));
          const extras = local.filter(c => !onChainAddrs.has(c.address));
          setCollections([...fetched, ...extras.map(c => ({ ...c, local: true }))]);
        } catch {
          setCollections(fetched);
        }
      })
      .catch(() => {
        // Fallback to local-only
        try {
          const localKey = `cthulhu_collections_${network}_${activeAddress}`;
          const local = JSON.parse(localStorage.getItem(localKey) || '[]');
          setCollections(local.map(c => ({ ...c, local: true })));
        } catch { setCollections([]); }
      })
      .finally(() => setLoadingCollections(false));
  }, [isConnected, activeAddress, network]);

  // Create a new P2FK collection: generate keypair → fund → mint profile → save
  const handleCreateCollection = async () => {
    if (!newCollName.trim() || !activeWif) return;
    setCreatingCollection(true);
    setCollectionError('');
    setCollectionStep('funding');
    try {
      const [{ generateObjectAddress, buildProfileTransaction }, { buildAndSend, buildAndBroadcast, fetchUtxos }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      // 1. Generate collection keypair
      const collKP = generateObjectAddress(network || 'btc-testnet');
      const collAddr = collKP.address;
      const collWif = collKP.wif;

      // 2. Fund collection address from user's wallet (~8000 sats covers profile mint + fees)
      const fundingAmount = 8000;
      const fundResult = await buildAndSend(activeWif, collAddr, fundingAmount, network || 'btc-testnet');
      if (!fundResult.success) throw new Error('Failed to fund collection address');

      // 3. Wait for UTXO to appear at collection address (poll mempool)
      setCollectionStep('minting');
      let utxos = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        utxos = await fetchUtxos(collAddr, network || 'btc-testnet');
        if (utxos.length > 0) break;
      }
      if (!utxos.length) throw new Error('Timed out waiting for collection funding UTXO. Try again in a minute.');

      // 4. Build and broadcast profile at collection address
      const profileData = {
        urn: newCollName.trim(),
        bio: newCollDesc.trim() || undefined,
        image: newCollImage.trim() || undefined,
      };
      const proResult = buildProfileTransaction(collWif, profileData, network || 'btc-testnet');
      const txResult = await buildAndBroadcast(collWif, proResult.addresses, network || 'btc-testnet', [], 0, 546, [], proResult.taxInsertIndex);
      if (!txResult.success) throw new Error(txResult.error || 'Failed to mint collection profile');

      // 5. Save locally for immediate use and future reference
      const collEntry = {
        address: collAddr,
        wif: collWif,
        urn: newCollName.trim(),
        name: newCollName.trim(),
        image: newCollImage.trim() || '',
        bio: newCollDesc.trim() || '',
        txid: txResult.txid,
        created_at: new Date().toISOString(),
      };
      const localKey = `cthulhu_collections_${network}_${activeAddress}`;
      try {
        const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
        existing.push(collEntry);
        localStorage.setItem(localKey, JSON.stringify(existing));
      } catch {}

      // 6. Update state and auto-select
      setCollections(prev => [...prev, { ...collEntry, local: true, object_count: 0 }]);
      setCollectionAddress(collAddr);
      setCollectionStep('done');
      setShowNewCollection(false);
      setNewCollName('');
      setNewCollImage('');
      setNewCollDesc('');
    } catch (err) {
      setCollectionError(err.message || 'Failed to create collection');
      setCollectionStep('error');
    } finally {
      setCreatingCollection(false);
    }
  };

  const [sizeWarning, setSizeWarning] = useState(null);

  const handleUpload = async (file, target) => {
    if (!file) return;
    setUploading(target);
    setUploadProgress({ target, pct: 0, filename: file.name });
    setUploadSuccess(null);
    setSizeWarning(null);
    setError(null);
    try {
      // Cover images (thumbnails) get compressed for fast browsing.
      // URN and File content always upload the original — no size cap.
      const toUpload = (target === 'cover' && file.type.startsWith('image/'))
        ? await compressImage(file)
        : file;
      // Show size warning if applicable (advisory only, never blocks upload)
      const warning = getSizeWarning(toUpload.size, target);
      if (warning) setSizeWarning({ target, message: warning, size: formatFileSize(toUpload.size) });
      setUploadProgress({ target, pct: 10, filename: `${file.name} (${formatFileSize(toUpload.size)})` });
      const formData = new FormData();
      formData.append('file', toUpload);
      const res = await axios.post(`${API}/ipfs/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0, // No client-side timeout — IPFS handles any file size
        onUploadProgress: (e) => {
          const pct = Math.min(90, Math.round((e.loaded / (e.total || 1)) * 80) + 10);
          setUploadProgress({ target, pct, filename: `${file.name} (${formatFileSize(toUpload.size)})` });
        },
      });
      setUploadProgress({ target, pct: 100, filename: file.name });
      if (res.data?.success) {
        if (target === 'cover') setImage(res.data.ipfs_ref);
        else if (target === 'urn') {
          // File lookup: upload to IPFS and put the IPFS reference into the URN field
          // URN must include the filename: IPFS:hash\filename.ext (SUP protocol format — uses backslash)
          const urnRef = res.data.filename ? `IPFS:${res.data.cid}\\${res.data.filename}` : res.data.ipfs_ref;
          checkUrn(urnRef);
          // Also set as cover image if the file is an image and no cover is set
          if (file.type.startsWith('image/') && !image) setImage(res.data.ipfs_ref);
        }
        else setUri(res.data.ipfs_ref);
        setUploadSuccess({ target, cid: res.data.cid, filename: res.data.filename });
        // Clear success indicator after 5s
        setTimeout(() => setUploadSuccess(prev => prev?.target === target ? null : prev), 5000);
      }
    } catch (err) {
      const msg = err.response?.data?.detail || 'Upload failed';
      setError(msg.includes('daemon') ? 'IPFS daemon is offline. Cannot upload.' : msg);
    } finally {
      setUploading(null);
      setTimeout(() => setUploadProgress(null), 1500);
    }
  };

  // --- Royalty address helpers ---
  const savedRoyalties = useMemo(() => {
    if (!authUser?.urn) return [];
    return getRoyaltyAddresses(authUser.urn, network);
  }, [authUser?.urn, network, royalties]); // eslint-disable-line

  const defaultRoyaltyAddr = useMemo(() => {
    if (!activeAddress) return null;
    return getCachedRoyaltiesAddress(activeAddress);
  }, [activeAddress]);

  // All available addresses for the dropdown
  const availableRoyaltyAddresses = useMemo(() => {
    const list = [];
    if (defaultRoyaltyAddr) {
      list.push({ address: defaultRoyaltyAddr, label: 'Default Royalty' });
    }
    for (const s of savedRoyalties) {
      if (!list.some(l => l.address === s.address)) {
        list.push({ address: s.address, label: s.label });
      }
    }
    return list;
  }, [defaultRoyaltyAddr, savedRoyalties]);

  const addRoyalty = (mode = 'select') => {
    if (mode === 'generate') {
      // Auto-generate a named royalty address for this object
      if (!activeWif || !authUser?.urn) {
        setRoyalties(prev => [...prev, { address: '', percentage: '', label: '', mode: 'manual' }]);
        return;
      }
      const label = urn.trim() ? `${labelFromUrn(urn.trim()) || 'Object'} Royalties` : `Object Royalties ${royalties.length + 1}`;
      const { entry } = generateAndStoreRoyalty(activeWif, authUser.urn, network, label);
      setRoyalties(prev => [...prev, { address: entry.address, percentage: '', label: entry.label, mode: 'saved' }]);
      return;
    }
    if (mode === 'manual') {
      setRoyalties(prev => [...prev, { address: '', percentage: '', label: '', mode: 'manual' }]);
      return;
    }
    // Default: show selector
    setRoyalties(prev => [...prev, { address: '', percentage: '', label: '', mode: 'select' }]);
  };

  // Generate the object address from URN
  const generateObjAddress = () => {
    const trimmedUrn = urn.trim();
    if (!trimmedUrn) return;
    setShowKeyPrompt(true);
  };

  const confirmGenerateObjAddress = async () => {
    const trimmedUrn = urn.trim();
    if (!trimmedUrn || !objKeyPassword || pregenAddress) return;
    // Prevent concurrent double-generation (desktop/mobile modal clash)
    if (generatingRef.current) return;
    generatingRef.current = true;
    try {
      // Use deterministic derivation from the user's WIF
      const { deriveObjectAddress, getNextObjectIndex } = await import('@/utils/p2fk');
      const { encryptWIF } = await import('@/utils/walletCrypto');
      const netName = network || 'btc-testnet';
      const label = `${labelFromUrn(trimmedUrn) || trimmedUrn.substring(0, 15)} OBJ`;
      const API = process.env.REACT_APP_BACKEND_URL;

      // Loop to find a safe, UNUSED address — mirrors SUP's getnewaddress which always returns a fresh address.
      // Our deterministic derivation can collide if localStorage index was reset, so we verify on-chain.
      let startIdx = getNextObjectIndex(activeAddress);
      let derived, address, wif;
      const MAX_ATTEMPTS = 20;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        derived = deriveObjectAddress(activeWif, startIdx, netName);
        address = derived.address;
        wif = derived.wif;

        // Check if this address already has an object registered on-chain
        try {
          const checkResp = await fetch(`${API}/api/object/addr/${address}?network=${netName}`);
          if (checkResp.ok) {
            const existing = await checkResp.json();
            if (existing && existing.name && !existing.error && !existing.detail) {
              // Address already used — skip to next index
              console.warn(`Object address ${address} already in use (object: "${existing.name}"), bumping index`);
              startIdx = (derived.usedIndex || startIdx) + 1;
              continue;
            }
          }
        } catch {
          // API error or 404 means address is likely unused — safe to proceed
        }
        break; // Found a safe, unused address
      }

      const encryptedWif = await encryptWIF(wif, objKeyPassword);

      // Store the index AFTER the one we used (including any skipped delimiter-unsafe ones)
      const nextIdx = (derived.usedIndex || startIdx) + 1;
      try { localStorage.setItem(`p2fk_obj_idx_${activeAddress}`, String(nextIdx)); } catch {}

      setPregenAddress({ address, wif, label });
      setShowKeyPrompt(false);
      setKeyEncrypted(true);

      // Save to localStorage with encrypted WIF
      if (activeAddress) {
        try {
          const key = `cthulhu_obj_addresses_${activeAddress}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          existing.push({
            address, encryptedWif, label,
            urn: trimmedUrn,
            network: netName,
            created: new Date().toISOString(),
            status: 'pending',
            derivationIndex: derived.usedIndex || startIdx,
          });
          localStorage.setItem(key, JSON.stringify(existing));
        } catch (e) { console.error('Save obj addr:', e); }
      }

    } catch (err) {
      console.error('Failed to generate object address:', err);
      setError(err.message);
    } finally {
      generatingRef.current = false;
    }
  };

  // Debounced URN availability check
  const checkUrn = (value) => {
    setUrn(value);
    setUrnStatus(null);
    setUrnClaimedBy(null);
    setPregenAddress(null); // Reset when URN changes
    if (urnCheckTimer.current) clearTimeout(urnCheckTimer.current);
    if (!value.trim() || value.trim().length < 2) return;
    setUrnStatus('checking');
    urnCheckTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/urn/check/${encodeURIComponent(value.trim())}`, {
          params: { network: network || 'btc-testnet' },
        });
        if (res.data?.available === false) {
          setUrnStatus('taken');
          setUrnClaimedBy(res.data.name || res.data.claimed_by || 'another user');
        } else {
          setUrnStatus('available');
        }
      } catch {
        setUrnStatus(null); // Don't block on errors
      }
    }, 600);
  };

  const removeRoyalty = (idx) => {
    setRoyalties(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRoyalty = (idx, field, value) => {
    setRoyalties(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const handleCreate = async () => {
    if (!urn.trim() || !isConnected || !activeWif) return;
    if (urnStatus === 'taken') {
      setError(`URN "${urn.trim()}" is already claimed by ${urnClaimedBy}. Choose a different URN.`);
      return;
    }
    setSending(true);
    setError(null);

    try {
      const [{ buildObjectTransaction, deriveObjectAddress, getNextObjectIndex, bumpObjectIndex }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      // Auto-derive object address if user didn't explicitly generate one
      let objAddr = pregenAddress;
      if (!objAddr) {
        const netName = network || 'btc-testnet';
        const idx = getNextObjectIndex(activeAddress);
        const derived = deriveObjectAddress(activeWif, idx, netName);
        objAddr = { address: derived.address, wif: derived.wif };
        bumpObjectIndex(activeAddress);
        setPregenAddress(objAddr);
      }

      const royaltyMap = {};
      for (const r of royalties) {
        if (r.address.trim() && r.percentage) {
          royaltyMap[r.address.trim()] = parseFloat(r.percentage);
        }
      }
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);

      const objectData = {
        urn: urn.trim(),
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        image: image.trim() || undefined,
        uri: uri.trim() || undefined,
        license: license.trim() || undefined,
        maxPerAddress: maxPerAddress ? (parseInt(maxPerAddress) || undefined) : undefined,
        quantity: parseInt(supply) || 1,
        royalties: Object.keys(royaltyMap).length > 0 ? royaltyMap : undefined,
        keywords: kws.length > 0 ? kws : undefined,
        collectionAddress: collectionAddress || undefined,
      };

      const { addresses, objectAddress, taxInsertIndex } = buildObjectTransaction(
        activeWif, objectData, network || 'btc-testnet',
        { address: objAddr.address, wif: objAddr.wif }
      );

      // No extra outputs — keep transaction 100% SUP-compatible (no platform fees in P2FK transactions)
      const result = await buildAndBroadcast(activeWif, addresses, network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);

      if (result.success) {
        clearDraft();
        setTxResult({ ...result, object_address: objectAddress });
        addTransaction(activeAddress, {
          txid: result.txid,
          type: 'OBJ',
          network: network || 'btc-testnet',
          addresses: addresses,
          label: `Object: ${urn.trim()}`,
          object_address: objectAddress,
        });
        // Write to optimistic cache for instant UI display
        addOptimisticItem({
          txid: result.txid,
          type: 'OBJ',
          network: network || 'btc-testnet',
          senderAddress: activeAddress,
          objectAddress: objectAddress,
          data: {
            name: name.trim() || urn.trim(),
            urn: urn.trim(),
            description: description.trim() || '',
            image: image.trim() || '',
            uri: uri.trim() || '',
            supply: parseInt(supply) || 1,
            keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
            collectionAddress: collectionAddress || '',
          },
        });
        // Update the pending object address entry with txid (don't create duplicate)
        try {
          const key = `cthulhu_obj_addresses_${activeAddress}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          const idx = existing.findIndex(e => e.address === objectAddress && e.status === 'pending');
          if (idx >= 0) {
            existing[idx] = { ...existing[idx], txid: result.txid, status: 'confirmed' };
          } else {
            // Fallback: entry wasn't saved during generate (shouldn't happen)
            existing.push({
              address: objectAddress,
              label: `${urn.trim()} OBJ`,
              urn: urn.trim(),
              txid: result.txid,
              network: network || 'btc-testnet',
              created: new Date().toISOString(),
            });
          }
          localStorage.setItem(key, JSON.stringify(existing));
        } catch (e) { console.error('Failed to update object address:', e); }
        refreshBalance();
        // Broadcast ink notification to mesh peers for IPFS propagation
        // Extract ALL CIDs from all object fields (image, uri, file) so peers pin everything
        try {
          const { getGlobalMeshNode } = await import('@/utils/meshRelay');
          const meshNode = getGlobalMeshNode();
          if (meshNode) {
            const _extractCids = (...fields) => {
              const cids = [];
              for (const f of fields) {
                if (!f) continue;
                const val = f.trim();
                // IPFS:QmHash/filename or IPFS:QmHash\filename → QmHash
                const m = val.match(/^IPFS:([A-Za-z0-9]+)/i);
                if (m) cids.push(m[1]);
              }
              return [...new Set(cids)];
            };
            meshNode.broadcastInk({
              cids: _extractCids(image, uri, urn),
              objectUrn: urn.trim(),
              objectAddress,
              senderUrn: authUser?.urn || '',
              senderAddress: activeAddress,
              image: image.trim() || '',
              network: network || 'btc-testnet',
            });
          }
        } catch (e) { console.warn('Ink broadcast failed:', e); }
        // Announce object mint to global feed (ephemeral)
        try {
          fetch(`${API}/wallet/announce-object`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address: activeAddress,
              network: network || 'btc-testnet',
              urn: authUser?.urn || '',
              object_name: name.trim() || urn.trim(),
              object_image: image.trim() || '',
              txid: result.txid,
            }),
          }).catch(() => {});
        } catch (e) { console.warn('Announce failed:', e); }
        // Auto-tether if this is a venue/room object
        const licLower = (license || '').toLowerCase();
        if (licLower.startsWith('cthulhu:tether') && tetherRoom) {
          tetherRoom({
            objectAddress,
            name: name.trim() || urn.trim(),
            image: image.trim() || '',
            description: description.trim() || '',
            license: license.trim(),
            uri: uri.trim() || undefined,
            total_supply: parseInt(supply) || 1,
            owner_count: 1,
            owners: [{ address: activeAddress, quantity: parseInt(supply) || 1 }],
            creators: [{ address: activeAddress }],
          });
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to create object');
    } finally {
      setSending(false);
    }
  };

  const totalRoyalty = royalties.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0);

  const headerJsx = (
    <div className="flex items-center justify-between px-4 lg:px-5 py-3 lg:py-4 border-b border-gray-800 bg-gray-900 z-10 flex-shrink-0">
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="object-create-back">
          <FiArrowLeft size={20} />
        </button>
        <h3 className="text-base lg:text-lg font-bold text-gray-100 flex items-center gap-2">
          <FiBox size={18} /> Create Object
        </h3>
      </div>
      <div className="flex items-center gap-3">
        <IpfsStatus compact={false} />
        {!fullPage && (
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 hidden lg:block" data-testid="object-create-close">
            <FiX size={22} />
          </button>
        )}
      </div>
    </div>
  );

  const contentJsx = (
    <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4">
      {txResult ? (
        <div className="py-4 space-y-4" data-testid="object-create-success">
          <div className="text-center">
            <div className="text-3xl mb-3 text-green-400">&#10003;</div>
            <p className="text-green-400 font-medium mb-1">Object created!</p>
            <p className="text-xs text-gray-500 font-mono break-all">TX: {txResult.txid}</p>
            <p className="text-xs text-gray-600 mt-1">{txResult.encoded_addresses_count} addresses &middot; {txResult.cost_sats} sats</p>
          </div>

          {/* DERIVED KEY INFO SECTION */}
          <div className="p-4 bg-gray-800/40 border border-gray-700/50 rounded-xl space-y-3" data-testid="object-key-backup">
            <div className="flex items-center gap-2">
              <FiShield size={16} className="text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-300 font-semibold">Object Address</p>
                <p className="text-[10px] text-gray-500">Deterministically derived from your wallet. Recoverable from your WIF.</p>
              </div>
            </div>

            {/* Object Address */}
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Address</label>
              <div className="flex items-center gap-2 mt-1 bg-gray-800/60 rounded-lg px-3 py-2">
                <code className="text-xs text-purple-300 font-mono flex-1 break-all" data-testid="obj-address-display">{txResult.object_address}</code>
                <button onClick={() => { navigator.clipboard?.writeText(txResult.object_address); setAddrCopied(true); setTimeout(() => setAddrCopied(false), 2000); }}
                  className="text-gray-500 hover:text-white flex-shrink-0 transition-colors" data-testid="copy-obj-address">
                  {addrCopied ? <FiCheck size={14} className="text-emerald-400" /> : <FiPlus size={14} className="rotate-45" />}
                </button>
              </div>
            </div>

            <p className="text-[10px] text-emerald-400/80 flex items-center gap-1"><FiCheck size={10} /> Derived from your wallet key — no separate backup needed</p>
          </div>

          {(urn || image) && (
            <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg text-left" data-testid="verified-owner-prompt">
              <p className="text-xs text-amber-400 font-medium mb-1">Earn the Verified Owner badge</p>
              <p className="text-[11px] text-gray-400 mb-2">Set this object's URN as your profile picture reference.</p>
              <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(urn || image); onClose(); }} className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2" data-testid="copy-image-ref-btn">
                Copy URN ref &amp; go to profile settings
              </button>
            </div>
          )}
          <button onClick={onClose} className="w-full px-5 py-2.5 bg-gray-800 text-gray-300 rounded-lg text-sm hover:bg-gray-700 transition-colors">Done</button>
        </div>
      ) : (
        <>
          {/* URN (required) — the media/content being claimed */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">URN (content/media) *</label>
            <p className="text-[10px] text-gray-600 mb-1.5">The content this object represents — an IPFS file, text, on-chain data, or any media reference.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type="text" value={urn} onChange={e => checkUrn(e.target.value)} placeholder="Type a string or use file lookup"
                  className={`w-full px-3 py-2 bg-gray-800 border rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:outline-none ${urnStatus === 'taken' ? 'border-red-500 focus:border-red-500' : urnStatus === 'available' ? 'border-emerald-500 focus:border-emerald-500' : 'border-gray-700 focus:border-blue-500'}`}
                  data-testid="object-urn-input" />
                {urnStatus === 'checking' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Checking...</span>}
                {urnStatus === 'available' && !pregenAddress && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-400">Available</span>}
                {urnStatus === 'taken' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-400">Taken</span>}
              </div>
              <input type="file" ref={urnFileRef} className="hidden" onChange={e => handleUpload(e.target.files[0], 'urn')} />
              <button onClick={() => urnFileRef.current?.click()} disabled={uploading === 'urn'}
                title="Upload a file to IPFS and use its reference as the URN content"
                className={`px-3 py-2 rounded-lg text-xs transition-all ${uploadSuccess?.target === 'urn' ? 'bg-emerald-600 text-white' : uploading === 'urn' ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                data-testid="urn-file-lookup-btn">
                {uploadSuccess?.target === 'urn' ? <FiCheck size={14} /> : uploading === 'urn' ? <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FiUpload size={14} />}
              </button>
              <button onClick={generateObjAddress} disabled={!urn.trim() || urnStatus === 'taken' || urnStatus === 'checking' || !!pregenAddress}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${pregenAddress ? 'bg-emerald-600/20 text-emerald-400 cursor-default' : 'bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white'}`}
                data-testid="generate-obj-address-btn">
                {pregenAddress ? <FiCheck size={14} /> : 'Generate Address'}
              </button>
            </div>
            {uploadProgress?.target === 'urn' && (
              <div className="mt-1.5 space-y-1" data-testid="urn-upload-progress">
                <div className="h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress.pct}%` }} /></div>
                <p className="text-[10px] text-gray-500">Uploading {uploadProgress.filename} to IPFS... {uploadProgress.pct}%</p>
              </div>
            )}
            {uploadSuccess?.target === 'urn' && !uploadProgress && <p className="mt-1 text-[10px] text-emerald-400" data-testid="urn-upload-success">Pinned to IPFS: {uploadSuccess.cid?.slice(0, 12)}...</p>}
            {sizeWarning?.target === 'urn' && <p className="mt-1 text-[10px] text-amber-400/80" data-testid="urn-size-warning">{sizeWarning.message}</p>}
            {urnStatus === 'taken' && <p className="text-xs text-red-400 mt-1" data-testid="urn-taken-msg">Already claimed by {urnClaimedBy}</p>}
            {pregenAddress && (
              <div className="mt-1.5 bg-gray-800/50 border border-purple-500/30 rounded px-2 py-1.5" data-testid="pregen-address-display">
                <p className="text-[11px] text-purple-400 font-medium">{pregenAddress.label}</p>
                <p className="text-[10px] text-gray-500 font-mono break-all">{pregenAddress.address}</p>
              </div>
            )}
            {/* Password prompt for encrypting the object key */}
            {showKeyPrompt && (
              <div className="mt-2 p-3 bg-gray-800/80 border border-gray-700 rounded-lg space-y-2" data-testid="obj-key-password-prompt">
                <p className="text-xs text-gray-300 font-medium">Enter your wallet password to encrypt this object's key:</p>
                <input type="password" value={objKeyPassword} onChange={e => setObjKeyPassword(e.target.value)}
                  placeholder="Wallet password..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                  onKeyDown={e => e.key === 'Enter' && confirmGenerateObjAddress()}
                  data-testid="obj-key-password-input" autoFocus />
                <div className="flex gap-2">
                  <button onClick={confirmGenerateObjAddress} disabled={!objKeyPassword}
                    className="flex-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium rounded-lg transition-colors"
                    data-testid="obj-key-password-confirm">Generate &amp; Encrypt</button>
                  <button onClick={() => { setShowKeyPrompt(false); setObjKeyPassword(''); }}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Display Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Object"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none" data-testid="object-name-input" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="A short description..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none" data-testid="object-desc-input" />
          </div>

          {/* Cover Image */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5 flex items-center gap-1"><FiImage size={12} /> Cover Image (thumbnail)</label>
            <p className="text-[10px] text-gray-600 mb-1.5">Auto-compressed for fast browsing. Full-size content goes in URN or File field above.</p>
            <div className="flex gap-2">
              <input type="text" value={image} onChange={e => setImage(e.target.value)} placeholder="IPFS:QmHash/file.png or BTC:txid/file.png"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono text-xs" data-testid="object-image-input" />
              <input type="file" ref={coverFileRef} className="hidden" accept="image/*" onChange={e => handleUpload(e.target.files[0], 'cover')} />
              <button onClick={() => coverFileRef.current?.click()} disabled={uploading === 'cover'}
                className={`px-3 py-2 rounded-lg text-xs transition-all ${uploadSuccess?.target === 'cover' ? 'bg-emerald-600 text-white' : uploading === 'cover' ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                data-testid="upload-cover-btn">
                {uploadSuccess?.target === 'cover' ? <FiCheck size={14} /> : uploading === 'cover' ? <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FiUpload size={14} />}
              </button>
            </div>
            {uploadProgress?.target === 'cover' && (
              <div className="mt-1.5 space-y-1" data-testid="cover-upload-progress">
                <div className="h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress.pct}%` }} /></div>
                <p className="text-[10px] text-gray-500">Pinning {uploadProgress.filename}... {uploadProgress.pct}%</p>
              </div>
            )}
            {uploadSuccess?.target === 'cover' && !uploadProgress && <p className="mt-1 text-[10px] text-emerald-400" data-testid="cover-upload-success">Pinned to IPFS: {uploadSuccess.cid.slice(0, 12)}...</p>}
            {sizeWarning?.target === 'cover' && <p className="mt-1 text-[10px] text-amber-400/80" data-testid="cover-size-warning">{sizeWarning.message}</p>}
          </div>

          {/* File / Content URI */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5 flex items-center gap-1"><FiUpload size={12} /> File / Content (music, video, PDF, HTML, zip)</label>
            <div className="flex gap-2">
              <input type="text" value={uri} onChange={e => setUri(e.target.value)} placeholder="IPFS:QmHash/song.mp3 or leave empty"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono text-xs" data-testid="object-uri-input" />
              <input type="file" ref={contentFileRef} className="hidden" onChange={e => handleUpload(e.target.files[0], 'file')} />
              <button onClick={() => contentFileRef.current?.click()} disabled={uploading === 'file'}
                className={`px-3 py-2 rounded-lg text-xs transition-all ${uploadSuccess?.target === 'file' ? 'bg-emerald-600 text-white' : uploading === 'file' ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                data-testid="upload-file-btn">
                {uploadSuccess?.target === 'file' ? <FiCheck size={14} /> : uploading === 'file' ? <span className="inline-block w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <FiUpload size={14} />}
              </button>
            </div>
            {uploadProgress?.target === 'file' && (
              <div className="mt-1.5 space-y-1" data-testid="file-upload-progress">
                <div className="h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress.pct}%` }} /></div>
                <p className="text-[10px] text-gray-500">Pinning {uploadProgress.filename}... {uploadProgress.pct}%</p>
              </div>
            )}
            {uploadSuccess?.target === 'file' && !uploadProgress && <p className="mt-1 text-[10px] text-emerald-400" data-testid="file-upload-success">Pinned to IPFS: {uploadSuccess.cid.slice(0, 12)}...</p>}
            {sizeWarning?.target === 'file' && <p className="mt-1 text-[10px] text-amber-400/80" data-testid="file-size-warning">{sizeWarning.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Supply</label>
              <input type="number" value={supply} onChange={e => setSupply(Math.max(1, parseInt(e.target.value) || 1))} min={1} max={999999999}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none" data-testid="object-supply-input" />
              <p className="text-[10px] text-gray-600 mt-0.5">Total copies to create</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Max Per Address</label>
              <input type="number" value={maxPerAddress} onChange={e => setMaxPerAddress(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))} min={1} placeholder="No limit"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none" data-testid="object-max-per-address-input" />
              <p className="text-[10px] text-gray-600 mt-0.5">Max one address can own</p>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">License</label>
            <input type="text" value={license} onChange={e => setLicense(e.target.value)} placeholder="e.g. CC-BY-4.0"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none" data-testid="object-license-input" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Keywords (comma separated)</label>
            <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="art, nft, digital"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none" data-testid="object-keywords-input" />
          </div>

          {/* Collection Selector — P2FK Creator[1] model */}
          <div className="border border-gray-800 rounded-lg p-4 bg-gray-800/30">
            <label className="block text-xs text-gray-400 font-medium mb-2">Collection (Optional)</label>
            <p className="text-[10px] text-gray-600 mb-2">Group this object into a named collection. Collections are P2FK profiles at shared Creator addresses.</p>
            <select value={collectionAddress} onChange={e => { setCollectionAddress(e.target.value); setShowNewCollection(false); }}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:border-blue-500 focus:outline-none" data-testid="collection-selector">
              <option value="">None (standalone object)</option>
              {loadingCollections && <option disabled>Loading collections...</option>}
              {collections.map(col => (
                <option key={col.address} value={col.address}>
                  {col.display_name || col.name || col.urn}{col.object_count ? ` (${col.object_count} objects)` : ''}{col.local ? ' *' : ''}
                </option>
              ))}
            </select>
            {collectionAddress && (
              <p className="text-[10px] text-gray-500 mt-1 font-mono break-all">Collection address: {collectionAddress}</p>
            )}

            {/* New Collection toggle */}
            {!showNewCollection ? (
              <button onClick={() => setShowNewCollection(true)} className="mt-2 flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 transition-colors" data-testid="new-collection-btn">
                <FiPlus size={11} /> New Collection
              </button>
            ) : (
              <div className="mt-3 border border-gray-700 rounded-lg p-3 bg-gray-900/50 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-teal-400 font-medium">Create New Collection</span>
                  <button onClick={() => { setShowNewCollection(false); setCollectionError(''); }} className="text-gray-500 hover:text-gray-300 p-0.5" data-testid="cancel-new-collection">
                    <FiX size={12} />
                  </button>
                </div>
                <input type="text" value={newCollName} onChange={e => setNewCollName(e.target.value)}
                  placeholder="Collection name (URN)" maxLength={64}
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm placeholder-gray-500 focus:border-teal-500 focus:outline-none" data-testid="new-collection-name" />
                <input type="text" value={newCollImage} onChange={e => setNewCollImage(e.target.value)}
                  placeholder="Image URL (optional)" 
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm placeholder-gray-500 focus:border-teal-500 focus:outline-none" data-testid="new-collection-image" />
                <input type="text" value={newCollDesc} onChange={e => setNewCollDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm placeholder-gray-500 focus:border-teal-500 focus:outline-none" data-testid="new-collection-desc" />
                
                {collectionStep === 'funding' && (
                  <p className="text-[10px] text-yellow-400 animate-pulse">Funding collection address...</p>
                )}
                {collectionStep === 'minting' && (
                  <p className="text-[10px] text-yellow-400 animate-pulse">Minting collection profile on-chain...</p>
                )}
                {collectionStep === 'done' && (
                  <p className="text-[10px] text-green-400">Collection created and selected!</p>
                )}
                {collectionError && (
                  <p className="text-[10px] text-red-400">{collectionError}</p>
                )}

                <button onClick={handleCreateCollection}
                  disabled={!newCollName.trim() || creatingCollection || !isConnected}
                  className="w-full py-1.5 rounded text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors" data-testid="create-collection-btn">
                  {creatingCollection ? 'Creating...' : 'Create Collection (~8000 sats)'}
                </button>
                <p className="text-[10px] text-gray-600">Generates a new address, funds it, and mints a profile there. This costs ~8000 sats from your wallet.</p>
              </div>
            )}
          </div>

          {/* Royalties */}
          <div className="border border-gray-800 rounded-lg p-4 bg-gray-800/30">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs text-gray-400 font-medium flex items-center gap-1.5"><FiPercent size={12} /> Royalties</label>
              <div className="flex items-center gap-1">
                {availableRoyaltyAddresses.length > 0 && (
                  <button onClick={() => addRoyalty('select')} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors px-1.5" data-testid="add-royalty-select-btn">
                    <FiChevronDown size={11} /> Select
                  </button>
                )}
                <button onClick={() => addRoyalty('generate')} className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors px-1.5" data-testid="add-royalty-generate-btn">
                  <FiPlus size={11} /> Generate
                </button>
                <button onClick={() => addRoyalty('manual')} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors px-1.5" data-testid="add-royalty-manual-btn">Paste</button>
              </div>
            </div>
            {royalties.length === 0 && <p className="text-xs text-gray-600">No royalties set.</p>}
            <div className="space-y-2">
              {royalties.map((r, idx) => (
                <div key={idx} className="space-y-1.5" data-testid={`royalty-row-${idx}`}>
                  {r.mode === 'select' && availableRoyaltyAddresses.length > 0 ? (
                    <div>
                      <select value={r.address} onChange={e => { const chosen = availableRoyaltyAddresses.find(a => a.address === e.target.value); updateRoyalty(idx, 'address', e.target.value); if (chosen) updateRoyalty(idx, 'label', chosen.label); }}
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs focus:border-purple-500 focus:outline-none" data-testid={`royalty-select-${idx}`}>
                        <option value="">-- Select royalty address --</option>
                        {availableRoyaltyAddresses.map(a => <option key={a.address} value={a.address}>{a.label} ({a.address.slice(0, 8)}...{a.address.slice(-6)})</option>)}
                      </select>
                      {r.address && <p className="text-[10px] text-gray-500 font-mono mt-0.5 break-all">{r.address}</p>}
                    </div>
                  ) : (
                    <div>
                      {r.label && r.mode === 'saved' && <p className="text-[11px] text-purple-400 font-medium mb-0.5">{r.label}</p>}
                      <input type="text" value={r.address} onChange={e => updateRoyalty(idx, 'address', e.target.value)} placeholder="Paste royalty address" readOnly={r.mode === 'saved'}
                        className={`w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none ${r.mode === 'saved' ? 'text-gray-400 cursor-default' : ''}`}
                        data-testid={`royalty-address-${idx}`} />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-1">
                      <input type="number" value={r.percentage} onChange={e => updateRoyalty(idx, 'percentage', e.target.value)} placeholder="5" min={0} max={100} step={0.1}
                        className="w-20 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs text-right focus:border-blue-500 focus:outline-none" data-testid={`royalty-pct-${idx}`} />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                    <button onClick={() => removeRoyalty(idx)} className="text-red-500 hover:text-red-400 transition-colors p-1" data-testid={`royalty-remove-${idx}`}><FiTrash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
            {totalRoyalty > 0 && <p className={`text-xs mt-2 ${totalRoyalty > 100 ? 'text-red-400' : 'text-gray-500'}`}>Total royalties: {totalRoyalty.toFixed(1)}%{totalRoyalty > 100 && ' (exceeds 100%!)'}</p>}
          </div>

          {error && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="object-create-error">{error}</p>}

          <div className="space-y-2 pt-2">
            <p className="text-xs text-gray-600">
              {urn.trim() ? (() => {
                const estAddresses = Math.ceil((urn.length + (name?.length || 0) + (description?.length || 0) + 150) / 20) + 4;
                const dustCost = estAddresses * 546;
                const fee = Math.max(Math.ceil(dustCost * 0.25), 547);
                return `Est. ~${dustCost + fee + 5000} sats (incl. ${fee} sats platform fee)`;
              })() : ''}
            </p>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-600">25% platform fee helps offset hosting costs</p>
              <button onClick={handleCreate} disabled={!urn.trim() || sending || totalRoyalty > 100 || urnStatus === 'taken' || urnStatus === 'checking' || (balance && balance.balance_sats < 2000)}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-medium text-sm" data-testid="object-create-submit">
                <FiSend size={14} />
                {sending ? 'Creating...' : 'Create Object'}
              </button>
            </div>
          </div>

          {balance && balance.balance_sats < 2000 && (
            <p className="text-xs text-amber-400">
              Insufficient balance. Buy tBTC at <a href="https://buytestnet.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">buytestnet.com</a>
            </p>
          )}
        </>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div className="h-full flex flex-col bg-gray-900" data-testid="object-create-page">
        {headerJsx}
        {contentJsx}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose} data-testid="object-create-overlay">
      <div className="bg-gray-900 w-full h-full lg:h-auto lg:border lg:border-gray-800 lg:rounded-xl lg:w-auto lg:max-w-xl lg:max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()} data-testid="object-create-modal">
        {headerJsx}
        {contentJsx}
      </div>
    </div>
  );
};
