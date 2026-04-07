import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiEdit2, FiSave, FiX, FiCopy, FiCheck, FiExternalLink, FiCamera, FiLoader } from 'react-icons/fi';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { ProfileThumb } from '@/components/ProfileThumb';
import { addTransaction } from '@/utils/txHistory';
import { compressImage, formatFileSize } from '@/utils/imageCompress';
import { copyToClipboard } from '@/utils/clipboard';
import { cachedFetch } from '@/utils/apiCache';
import FeePicker from '@/components/FeePicker';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function MyProfilePage({ network }) {
  const navigate = useNavigate();
  const { user, wif, isConnected } = useAuth();
  const { wallet } = useWallet();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Edit form state
  const [form, setForm] = useState({
    displayName: '', firstName: '', middleName: '', lastName: '',
    suffix: '', bio: '', imageRef: '', imagePreview: '',
    url: '', location: '',
  });

  const activeAddress = user?.address || wallet?.address;
  const activeWif = wif || wallet?.wif;
  // Display URN — may be the address placeholder until profile is fetched
  const displayUrn = user?.urn || '';

  // Fetch profile data
  const fetchProfile = useCallback(async () => {
    if (!activeAddress) return;
    setLoading(true);
    try {
      const cacheId = `my_${activeAddress}_${network}`;
      const data = await cachedFetch('profile', cacheId, async () => {
        const res = await fetch(`${API}/profile/${activeAddress}?network=${network}`);
        if (!res.ok) return null;
        return res.json();
      });
      if (data) {
        setProfile(data);
        // Initialize form from profile data
        const urlObj = data.url || {};
        const locObj = data.location || {};
        const urlStr = typeof urlObj === 'object'
          ? Object.entries(urlObj).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
          : (urlObj || '');
        const locStr = typeof locObj === 'object'
          ? Object.entries(locObj).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
          : (locObj || '');

        setForm({
          displayName: data.display_name || '',
          firstName: data.first_name || '',
          middleName: data.middle_name || '',
          lastName: data.last_name || '',
          suffix: data.suffix || '',
          bio: data.bio || '',
          imageRef: data.image || '',
          imagePreview: '',
          url: urlStr,
          location: locStr,
        });
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [activeAddress, network]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!isConnected) navigate('/auth');
  }, [isConnected, navigate]);

  const handleCopy = (text, label) => {
    copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  // Image upload
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const compressed = await compressImage(file);
      if (compressed !== file) {
        console.log(`Image compressed: ${formatFileSize(file.size)} -> ${formatFileSize(compressed.size)}`);
      }
      const reader = new FileReader();
      reader.onload = (ev) => setForm(f => ({ ...f, imagePreview: ev.target.result }));
      reader.readAsDataURL(compressed);

      const formData = new FormData();
      formData.append('file', compressed);
      const res = await fetch(`${API}/ipfs/upload`, { method: 'POST', body: formData });
      if (!res.ok) {
        let msg = 'IPFS upload failed';
        try { const err = await res.json(); msg = err.detail || msg; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.success) throw new Error('Upload returned no CID');
      setForm(f => ({ ...f, imageRef: data.ipfs_ref || '' }));
    } catch (err) {
      setForm(f => ({ ...f, imagePreview: '', imageRef: profile?.image || '' }));
      setUploadError(err.message);
    } finally { setUploading(false); }
  };

  // Save profile — builds and broadcasts a PRO update transaction
  const handleSave = async () => {
    if (!activeWif) return;

    // CRITICAL: Use the on-chain profile URN, NOT user.urn (which may be the address placeholder).
    // The profile state is fetched from the API and contains the real on-chain URN.
    const onChainUrn = profile?.urn || profile?.URN;
    const isRealUrn = onChainUrn && onChainUrn !== activeAddress && onChainUrn !== user?.address;
    if (!isRealUrn) {
      setSaveError('No minted profile found on-chain. Please mint your profile first before updating.');
      return;
    }

    setSaving(true);
    setSaveError('');
    setSaveResult(null);
    try {
      const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const cleanWif = activeWif.split('').filter(c => BASE58.includes(c)).join('');

      const [{ buildProfileTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'),
        import('@/utils/txBuilder'),
      ]);

      // Convert URL/location multi-line strings back to dicts
      const urlDict = {};
      form.url.trim().split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (key && val) urlDict[key] = val;
        } else if (line.trim()) {
          urlDict['website'] = line.trim();
        }
      });
      const locDict = {};
      form.location.trim().split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (key && val) locDict[key] = val;
        } else if (line.trim()) {
          locDict['city'] = line.trim();
        }
      });

      const profileData = {
        urn: onChainUrn,
        displayName: form.displayName || undefined,
        firstName: form.firstName || undefined,
        middleName: form.middleName || undefined,
        lastName: form.lastName || undefined,
        suffix: form.suffix || undefined,
        bio: form.bio || undefined,
        image: form.imageRef || undefined,
        url: Object.keys(urlDict).length > 0 ? urlDict : undefined,
        loc: Object.keys(locDict).length > 0 ? locDict : undefined,
      };

      const result = buildProfileTransaction(cleanWif, profileData, network);
      const txResult = await buildAndBroadcast(cleanWif, result.addresses, network, [], 0, 546, [], result.taxInsertIndex);

      if (!txResult.success) throw new Error(txResult.error || 'Broadcast returned failure');

      setSaveResult(txResult.txid);
      setEditing(false);

      addTransaction(result.senderAddress, {
        txid: txResult.txid, type: 'PRO', network,
        addresses: result.addresses, label: `Profile update: @${onChainUrn}`,
      });

      // Register updated profile on backend
      fetch(`${API}/wallet/register-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: result.senderAddress, network, urn: onChainUrn,
          image: form.imageRef || null,
          display_name: form.displayName || null,
        }),
      }).catch(() => {});

      // Update local profile state
      setProfile(p => ({
        ...p,
        display_name: form.displayName,
        first_name: form.firstName,
        middle_name: form.middleName,
        last_name: form.lastName,
        suffix: form.suffix,
        bio: form.bio,
        image: form.imageRef,
        url: Object.keys(urlDict).length > 0 ? urlDict : null,
        location: Object.keys(locDict).length > 0 ? locDict : null,
      }));
    } catch (err) {
      setSaveError(err.message);
    } finally { setSaving(false); }
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError('');
    setUploadError('');
    // Reset form from profile
    if (profile) {
      const urlObj = profile.url || {};
      const locObj = profile.location || {};
      const urlStr = typeof urlObj === 'object'
        ? Object.entries(urlObj).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
        : (urlObj || '');
      const locStr = typeof locObj === 'object'
        ? Object.entries(locObj).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
        : (locObj || '');
      setForm({
        displayName: profile.display_name || '',
        firstName: profile.first_name || '',
        middleName: profile.middle_name || '',
        lastName: profile.last_name || '',
        suffix: profile.suffix || '',
        bio: profile.bio || '',
        imageRef: profile.image || '',
        imagePreview: '',
        url: urlStr,
        location: locStr,
      });
    }
  };

  // Format "Member Since" date
  const formatMemberSince = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return dateStr; }
  };

  // Resolve image URL from IPFS ref
  const resolveImageUrl = (ref) => {
    if (!ref) return null;
    const raw = ref.replace(/^IPFS:/i, '').replace(/\\/g, '/');
    const parts = raw.split('/');
    return parts.length > 1
      ? `https://ipfs.io/ipfs/${parts[0]}/${encodeURIComponent(parts.slice(1).join('/'))}`
      : `https://ipfs.io/ipfs/${parts[0]}`;
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" data-testid="my-profile-loading">
        <FiLoader className="animate-spin text-gray-500" size={24} />
      </div>
    );
  }

  const imageUrl = form.imagePreview || resolveImageUrl(form.imageRef || profile?.image);
  const creatorAddress = profile?.address || activeAddress;

  return (
    <div className="h-full overflow-y-auto pb-24" data-testid="my-profile-page">
      <div className="w-full max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60" data-testid="my-profile-header">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="my-profile-back">
            <FiArrowLeft size={20} />
          </button>
          <span className="text-base font-semibold text-gray-100">My Profile</span>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="p-2 -mr-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="my-profile-edit-btn">
              <FiEdit2 size={18} />
            </button>
          ) : (
            <button onClick={cancelEdit} className="p-2 -mr-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors" data-testid="my-profile-cancel-btn">
              <FiX size={18} />
            </button>
          )}
        </div>

        {/* Success banner */}
        {saveResult && (
          <div className="mx-4 mt-3 p-3 bg-emerald-900/30 border border-emerald-700/40 rounded-xl" data-testid="my-profile-save-success">
            <p className="text-sm text-emerald-400 font-medium">Profile update broadcast!</p>
            <p className="text-xs text-gray-400 mt-1 break-all">TX: {saveResult}</p>
          </div>
        )}

        {/* Profile Image */}
        <div className="flex flex-col items-center pt-6 pb-4 px-4">
          <div className="relative group" data-testid="my-profile-avatar-section">
            {imageUrl ? (
              <img src={imageUrl} alt={displayUrn} className="w-24 h-24 rounded-full object-cover border-2 border-gray-700" data-testid="my-profile-avatar" />
            ) : (
              <ProfileThumb name={displayUrn || '?'} image={null} size="xl" />
            )}
            {editing && (
              <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" data-testid="my-profile-change-image">
                {uploading ? <FiLoader className="animate-spin text-white" size={20} /> : <FiCamera className="text-white" size={20} />}
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
              </label>
            )}
          </div>
          {uploading && <p className="text-xs text-gray-500 mt-2">Uploading to IPFS...</p>}
          {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
          {editing && form.imageRef && !uploadError && <p className="text-xs text-emerald-400 mt-1 truncate max-w-[250px]">Pinned: {form.imageRef}</p>}

          {/* URN */}
          <h2 className="text-xl font-bold text-gray-100 mt-3" data-testid="my-profile-urn">@{displayUrn}</h2>
          {profile?.display_name && profile.display_name !== displayUrn && (
            <p className="text-sm text-gray-400">{profile.display_name}</p>
          )}

          {/* Member Since */}
          {profile?.created_at && (
            <p className="text-xs text-gray-500 mt-1" data-testid="my-profile-member-since">
              Member since {formatMemberSince(profile.created_at)}
            </p>
          )}
        </div>

        {/* Error */}
        {saveError && (
          <div className="mx-4 mb-3 p-3 bg-red-900/30 border border-red-700/40 rounded-xl" data-testid="my-profile-save-error">
            <p className="text-sm text-red-400">{saveError}</p>
          </div>
        )}

        {/* Fields */}
        <div className="px-4 space-y-1" data-testid="my-profile-fields">
          <FieldRow label="Display Name" value={form.displayName} field="displayName" editing={editing} onChange={(v) => setForm(f => ({ ...f, displayName: v }))} testId="my-profile-display-name" />
          <FieldRow label="First Name" value={form.firstName} field="firstName" editing={editing} onChange={(v) => setForm(f => ({ ...f, firstName: v }))} testId="my-profile-first-name" />
          <FieldRow label="Middle Name" value={form.middleName} field="middleName" editing={editing} onChange={(v) => setForm(f => ({ ...f, middleName: v }))} testId="my-profile-middle-name" />
          <FieldRow label="Last Name" value={form.lastName} field="lastName" editing={editing} onChange={(v) => setForm(f => ({ ...f, lastName: v }))} testId="my-profile-last-name" />
          <FieldRow label="Suffix" value={form.suffix} field="suffix" editing={editing} onChange={(v) => setForm(f => ({ ...f, suffix: v }))} testId="my-profile-suffix" />
          <FieldRow label="Bio" value={form.bio} field="bio" editing={editing} multiline onChange={(v) => setForm(f => ({ ...f, bio: v }))} testId="my-profile-bio" />
          <FieldRow label="URL" value={form.url} field="url" editing={editing} multiline onChange={(v) => setForm(f => ({ ...f, url: v }))} testId="my-profile-url" placeholder="website: https://example.com" />
          <FieldRow label="Location" value={form.location} field="location" editing={editing} multiline onChange={(v) => setForm(f => ({ ...f, location: v }))} testId="my-profile-location" placeholder="city: New York" />

          {/* Read-only fields */}
          <div className="pt-3 border-t border-gray-800/40 mt-3">
            <div className="flex items-center justify-between py-3">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Creator Address</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-300 font-mono truncate max-w-[200px]" data-testid="my-profile-creator-address">{creatorAddress || ''}</span>
                {creatorAddress && (
                  <button onClick={() => handleCopy(creatorAddress, 'addr')} className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors" data-testid="my-profile-copy-address">
                    {copied === 'addr' ? <FiCheck size={14} className="text-emerald-400" /> : <FiCopy size={14} />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* View Public Profile */}
          {creatorAddress && (
            <button
              onClick={() => navigate(`/profile/${creatorAddress}`)}
              className="w-full flex items-center justify-center gap-2 py-3 mt-2 rounded-xl bg-gray-800/50 hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-sm transition-colors border border-gray-700/30"
              data-testid="my-profile-view-public"
            >
              <FiExternalLink size={14} />
              View Public Profile
            </button>
          )}
        </div>

        {/* Save button (edit mode) */}
        {editing && (
          <div className="px-4 pt-4 pb-6 space-y-3">
            <FeePicker network={network} />
            <button
              onClick={handleSave}
              disabled={saving || !activeWif}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(var(--c-accent-rgb, 139,92,246), 0.9), rgba(var(--c-accent-rgb, 139,92,246), 0.7))',
                color: '#fff',
              }}
              data-testid="my-profile-save-btn"
            >
              {saving ? <><FiLoader className="animate-spin" size={16} /> Broadcasting...</> : <><FiSave size={16} /> Save Changes</>}
            </button>
            {!activeWif && (
              <p className="text-xs text-amber-400 text-center mt-2">Wallet must be unlocked to save changes on-chain.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, value, field, editing, multiline, onChange, testId, placeholder }) {
  return (
    <div className="py-3 border-b border-gray-800/30" data-testid={testId}>
      <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">{label}</label>
      {editing ? (
        multiline ? (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600 resize-none"
            rows={3}
            placeholder={placeholder || `Enter ${label.toLowerCase()}...`}
            data-testid={`${testId}-input`}
          />
        ) : (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
            placeholder={placeholder || `Enter ${label.toLowerCase()}...`}
            data-testid={`${testId}-input`}
          />
        )
      ) : (
        <p className={`text-sm whitespace-pre-line ${value ? 'text-gray-200' : 'text-gray-600 italic'}`} data-testid={`${testId}-value`}>
          {value || 'Not set'}
        </p>
      )}
    </div>
  );
}
