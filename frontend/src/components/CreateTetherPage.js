import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiImage, FiHash, FiSend, FiCheck, FiLink, FiUsers, FiMic, FiCopy } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { IpfsStatus } from '@/components/IpfsStatus';
import { addTransaction } from '@/utils/txHistory';
import { compressImage } from '@/utils/imageCompress';
import axios from 'axios';
import FeePicker from '@/components/FeePicker';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function CreateTetherPage({ network, tetherRoom }) {
  const navigate = useNavigate();
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  const { wallet, isConnected: walletConnected, refreshBalance } = useWallet();

  const activeWif = authWif || wallet?.wif;
  const activeAddress = authUser?.address || wallet?.address;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageCid, setImageCid] = useState('');
  const [ipfsRef, setIpfsRef] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [isSubTopic, setIsSubTopic] = useState(false);
  const [parentAddress, setParentAddress] = useState('');
  // Room type: 'public' or 'venue'
  const [roomType, setRoomType] = useState('public');
  const [speakingSlots, setSpeakingSlots] = useState(10);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const localUrl = URL.createObjectURL(file);
      setImagePreview(localUrl);

      const toUpload = file.type.startsWith('image/') ? await compressImage(file) : file;
      setUploadProgress(20);
      const formData = new FormData();
      formData.append('file', toUpload);
      const res = await axios.post(`${API}/ipfs/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
        onUploadProgress: (e) => {
          const pct = Math.round(20 + ((e.loaded / e.total) * 60));
          setUploadProgress(pct);
        },
      });
      const cid = res.data?.cid || res.data?.Hash;
      const ref = res.data?.ipfs_ref;
      const gatewayUrl = res.data?.gateway_url;
      if (cid) {
        setImageCid(cid);
        if (ref) setIpfsRef(ref);
        if (gatewayUrl) setImagePreview(gatewayUrl);
        setUploadProgress(100);
      } else {
        throw new Error('No CID returned');
      }
    } catch (err) {
      setError('Upload failed: ' + (err.message || 'Unknown error'));
      setImagePreview('');
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !isConnected || !activeWif) return;
    setSending(true);
    setError(null);

    try {
      const [{ buildObjectTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      const urn = ipfsRef || ('tether-' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
      const isVenue = roomType === 'venue';
      const license = isSubTopic
        ? 'cthulhu:tether:topic'
        : isVenue
          ? 'cthulhu:tether:venue'
          : 'cthulhu:tether';

      const objectData = {
        urn,
        name: name.trim(),
        description: description.trim() || undefined,
        image: ipfsRef || undefined,
        license,
        uri: isSubTopic && parentAddress.trim() ? parentAddress.trim() : undefined,
        quantity: isVenue ? Math.max(2, speakingSlots) : 1,
      };

      const { addresses, objectAddress, taxInsertIndex } = buildObjectTransaction(
        activeWif, objectData, network || 'btc-testnet'
      );

      const result = await buildAndBroadcast(activeWif, addresses, network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);

      if (result.success) {
        setTxResult({ ...result, objectAddress });
        addTransaction(activeAddress, {
          txid: result.txid,
          type: 'OBJ',
          network: network || 'btc-testnet',
          addresses,
          label: `${isVenue ? 'Venue' : 'Tether'}: ${name.trim()}`,
          object_address: objectAddress,
        });
        try {
          const key = `cthulhu_obj_addresses_${activeAddress}`;
          const existing = JSON.parse(localStorage.getItem(key) || '[]');
          existing.push({
            address: objectAddress,
            label: `${name.trim()} ${isVenue ? 'VENUE' : 'TETHER'}`,
            urn,
            txid: result.txid,
            network: network || 'btc-testnet',
            created: new Date().toISOString(),
          });
          localStorage.setItem(key, JSON.stringify(existing));
        } catch (e) { console.error('Failed to save tether address:', e); }

        if (tetherRoom) {
          tetherRoom({
            objectAddress,
            name: name.trim(),
            image: ipfsRef || imageCid,
            imageUrl: imagePreview,
            description: description.trim(),
            license,
            uri: isSubTopic && parentAddress.trim() ? parentAddress.trim() : undefined,
            tetheredAt: new Date().toISOString(),
          });
        }
        // Register topic on backend so all users can discover it
        if (isSubTopic && parentAddress.trim()) {
          fetch(`${API}/rooms/register-topic`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parent_address: parentAddress.trim(), topic_address: objectAddress,
              network: network || 'btc-testnet', name: name.trim(),
              description: description.trim() || null, image: ipfsRef || imageCid || null,
            }),
          }).catch(() => {});
        }
        refreshBalance();
      }
    } catch (err) {
      setError(err.message || 'Failed to create tether');
    } finally {
      setSending(false);
    }
  };

  // Success screen
  if (txResult) {
    const isVenue = roomType === 'venue';
    return (
      <div className="h-full flex flex-col" data-testid="create-tether-page">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 flex-shrink-0">
          <button onClick={() => navigate('/chats', { replace: true })} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="create-tether-back">
            <FiArrowLeft size={20} />
          </button>
          <h3 className="text-base font-bold text-gray-100">{isVenue ? 'Venue Created' : 'Tether Created'}</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)' }}>
            <FiCheck size={36} className="text-emerald-400" />
          </div>
          <h4 className="text-xl font-bold text-gray-100 mb-2">{name.trim()}</h4>
          <p className="text-xs text-gray-600 font-mono break-all text-center max-w-[300px] mb-2 cursor-pointer hover:text-gray-400 transition-colors inline-flex items-center gap-1"
            onClick={() => { navigator.clipboard?.writeText(txResult.objectAddress); }}
            title="Copy address"
            data-testid="copy-tether-address"
          >{txResult.objectAddress} <FiCopy size={10} className="flex-shrink-0" /></p>
          <p className="text-sm text-gray-500 text-center max-w-[280px] mb-8">
            {isVenue
              ? `Speaking venue with ${speakingSlots} total slots. List seats when you're ready to open them.`
              : 'Transaction broadcast! Your tether is now in the mempool and will be indexed shortly.'}
          </p>
          <button
            onClick={() => navigate(`/room/${txResult.objectAddress}`, { replace: true })}
            className="w-full max-w-[280px] py-3 rounded-xl font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--c-accent, #8b5cf6)' }}
            data-testid="create-tether-open"
          >
            Open {isVenue ? 'Venue' : 'Tether'}
          </button>
          <button
            onClick={() => navigate('/chats', { replace: true })}
            className="mt-3 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Back to Chats
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="create-tether-page">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="create-tether-back">
            <FiArrowLeft size={20} />
          </button>
          <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FiHash size={16} style={{ color: 'var(--c-accent)' }} />
            Create Tether
          </h3>
        </div>
        <IpfsStatus compact />
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Image + Name */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="w-20 h-20 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-dashed border-gray-700 hover:border-gray-500 transition-colors overflow-hidden"
            disabled={uploading}
            data-testid="create-tether-image-btn"
          >
            {imagePreview ? (
              <img src={imagePreview} alt="" className="w-full h-full object-cover" />
            ) : uploading ? (
              <div className="flex flex-col items-center">
                <span className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mb-1" />
                <span className="text-[10px] text-teal-400">{uploadProgress}%</span>
              </div>
            ) : (
              <FiImage size={24} className="text-gray-600" />
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleUpload(e.target.files?.[0])} />
          <div className="flex-1">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Tether name"
              className="w-full bg-transparent border-b border-gray-700 focus:border-gray-500 py-2 text-gray-100 placeholder-gray-600 focus:outline-none text-lg"
              maxLength={64}
              autoFocus
              data-testid="create-tether-name"
            />
          </div>
        </div>

        {/* IPFS Upload Progress */}
        {uploading && (
          <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3 space-y-2" data-testid="ipfs-upload-progress">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-teal-400 font-medium">Pinning to IPFS...</span>
              <span className="text-xs text-gray-500 ml-auto">{uploadProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {/* IPFS Upload Success */}
        {!uploading && imageCid && (
          <div className="bg-emerald-900/10 border border-emerald-800/20 rounded-xl p-3 flex items-center gap-2" data-testid="ipfs-upload-success">
            <FiCheck size={14} className="text-emerald-400 flex-shrink-0" />
            <span className="text-xs text-emerald-400 font-medium">Pinned to IPFS</span>
            <span className="text-[10px] text-gray-500 font-mono truncate">{imageCid.slice(0, 20)}...</span>
          </div>
        )}

        {/* Description */}
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-none"
          rows={3}
          maxLength={256}
          data-testid="create-tether-description"
        />

        {/* Room Type Selector */}
        {!isSubTopic && (
          <div className="space-y-3" data-testid="room-type-selector">
            <label className="block text-xs text-gray-400 font-medium">Room Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setRoomType('public')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  roomType === 'public'
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600'
                }`}
                data-testid="room-type-public"
              >
                <FiUsers size={22} className={roomType === 'public' ? 'text-emerald-400' : 'text-gray-500'} />
                <span className={`text-sm font-medium ${roomType === 'public' ? 'text-emerald-400' : 'text-gray-400'}`}>
                  Public Room
                </span>
                <span className="text-[10px] text-gray-500 text-center leading-snug">
                  Open to everyone
                </span>
              </button>
              <button
                onClick={() => setRoomType('venue')}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  roomType === 'venue'
                    ? 'bg-purple-500/5'
                    : 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600'
                }`}
                style={roomType === 'venue' ? { borderColor: 'rgba(var(--c-accent-rgb), 0.5)' } : {}}
                data-testid="room-type-venue"
              >
                <FiMic size={22} className={roomType === 'venue' ? 'text-purple-400' : 'text-gray-500'} style={roomType === 'venue' ? { color: 'var(--c-accent)' } : {}} />
                <span className={`text-sm font-medium ${roomType === 'venue' ? 'text-purple-400' : 'text-gray-400'}`} style={roomType === 'venue' ? { color: 'var(--c-accent)' } : {}}>
                  Speaking Venue
                </span>
                <span className="text-[10px] text-gray-500 text-center leading-snug">
                  Seat holders speak
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Speaking Slots — only for venue */}
        {roomType === 'venue' && !isSubTopic && (
          <div className="space-y-2" data-testid="speaking-slots-section">
            <label className="block text-xs text-gray-400 font-medium">Total Speaking Slots</label>
            <input
              type="number"
              value={speakingSlots}
              onChange={e => setSpeakingSlots(Math.max(2, parseInt(e.target.value) || 2))}
              min={2}
              className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none"
              style={{ borderColor: 'rgba(var(--c-accent-rgb), 0.3)' }}
              data-testid="speaking-slots-input"
            />
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <p className="text-[11px] text-amber-400/90 leading-relaxed">
                Set the maximum slots you may ever need. You control how many are open at any time by listing them for sale. Only listed seats can be purchased.
              </p>
            </div>
          </div>
        )}

        {/* Sub-topic toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <FiLink size={14} className="text-gray-500" />
            <span className="text-sm text-gray-400">Sub-topic of another tether</span>
          </div>
          <button
            onClick={() => setIsSubTopic(!isSubTopic)}
            className={`w-11 h-6 rounded-full transition-colors relative ${isSubTopic ? '' : 'bg-gray-700'}`}
            style={isSubTopic ? { backgroundColor: 'var(--c-accent, #8b5cf6)' } : {}}
            data-testid="create-tether-subtopic-toggle"
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isSubTopic ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Parent address (if sub-topic) */}
        {isSubTopic && (
          <input
            type="text"
            value={parentAddress}
            onChange={e => setParentAddress(e.target.value)}
            placeholder="Parent tether address"
            className="w-full bg-gray-800/40 border border-gray-700/50 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 font-mono"
            data-testid="create-tether-parent"
          />
        )}

        {/* Info */}
        <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/30">
          <p className="text-xs text-gray-500 leading-relaxed">
            {isSubTopic
              ? 'A sub-topic is linked to a parent tether via the URI field. It uses License: cthulhu:tether:topic'
              : roomType === 'venue'
                ? 'A speaking venue restricts the compose bar to seat holders. The audience can still watch and tip. License: cthulhu:tether:venue'
                : 'A public room is open to everyone. Anyone can join and chat. License: cthulhu:tether'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Not connected */}
        {!isConnected && (
          <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-4">
            <p className="text-xs text-amber-400">Connect your wallet to create a tether. Minting requires a small blockchain transaction fee.</p>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="px-4 py-3 border-t border-gray-800/60 flex-shrink-0 space-y-2">
        <FeePicker network={network} />
        <button
          onClick={handleCreate}
          disabled={!name.trim() || !isConnected || sending || (isSubTopic && !parentAddress.trim())}
          className="w-full py-3 rounded-xl font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
          style={{ backgroundColor: 'var(--c-accent, #8b5cf6)' }}
          data-testid="create-tether-submit"
        >
          {sending ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Minting on-chain...
            </>
          ) : (
            <>
              <FiSend size={16} />
              {roomType === 'venue' ? 'Create Venue' : 'Create Tether'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
