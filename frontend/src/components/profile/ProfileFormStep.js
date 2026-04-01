import React, { useState } from 'react';
import {
  FiImage, FiUpload, FiArrowRight, FiPlus, FiTrash2, FiChevronDown, FiChevronUp
} from 'react-icons/fi';
import { compressImage, formatFileSize } from '@/utils/imageCompress';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const URL_PRESETS = [
  { key: 'website', label: 'Website' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'github', label: 'GitHub' },
  { key: 'discord', label: 'Discord' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'nostr', label: 'Nostr' },
];

const LOC_FIELDS = [
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'country', label: 'Country' },
];

function KeyValueEditor({ entries, onChange, presets, placeholder }) {
  const addEntry = () => onChange([...entries, { key: '', value: '' }]);
  const removeEntry = (i) => onChange(entries.filter((_, idx) => idx !== i));
  const updateEntry = (i, field, val) => {
    const next = [...entries];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-2 items-center">
          {presets ? (
            <select
              value={entry.key}
              onChange={(e) => updateEntry(i, 'key', e.target.value)}
              className="w-32 px-2 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
              data-testid={`kv-key-select-${i}`}
            >
              <option value="">Type</option>
              {presets.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          ) : (
            <input
              type="text"
              value={entry.key}
              onChange={(e) => updateEntry(i, 'key', e.target.value)}
              placeholder="Key"
              className="w-28 px-2 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
              data-testid={`kv-key-input-${i}`}
            />
          )}
          <input
            type="text"
            value={entry.value}
            onChange={(e) => updateEntry(i, 'value', e.target.value)}
            placeholder={placeholder || 'Value'}
            className="flex-1 px-2 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
            data-testid={`kv-value-input-${i}`}
          />
          <button
            type="button"
            onClick={() => removeEntry(i)}
            className="p-2 text-gray-500 hover:text-red-400 transition-colors"
            data-testid={`kv-remove-${i}`}
          >
            <FiTrash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addEntry}
        className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
        data-testid="kv-add-entry"
      >
        <FiPlus size={12} /> Add
      </button>
    </div>
  );
}

export default function ProfileFormStep({ user, form, setForm, onNext, onSkip, isUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(
    // Auto-open if any advanced field is populated
    !!(form.firstName || form.middleName || form.lastName || form.suffix ||
       form.urls?.length > 0 || form.locEntries?.length > 0)
  );

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
      // Show preview immediately
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
      // Clear the broken preview and ref on failure
      setForm(f => ({ ...f, imagePreview: '', imageRef: '' }));
      setUploadError(`${err.message}. Try again or paste an IPFS reference manually.`);
    } finally { setUploading(false); }
  };

  const clearImage = () => {
    setForm(f => ({ ...f, imagePreview: '', imageRef: '' }));
    setUploadError('');
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-xl font-bold text-gray-100 mb-1">{isUpdate ? 'Update Your Profile' : 'Set Up Your Profile'}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {isUpdate
          ? 'Change any fields below and mint an update transaction. Empty fields will be left unchanged.'
          : 'This info will be minted on the blockchain as a SUP profile.'}
      </p>

      {/* URN (read-only) */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1.5">Profile Name (URN)</label>
        <input
          type="text" value={user.urn} disabled
          className="w-full px-4 py-3 bg-gray-950 border border-gray-800 rounded-lg text-gray-400 cursor-not-allowed"
          data-testid="setup-urn-input"
        />
      </div>

      {/* Display Name */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1.5">Display Name</label>
        <input
          type="text" value={form.displayName}
          onChange={(e) => setForm(f => ({ ...f, displayName: e.target.value }))}
          placeholder="Your display name"
          className="w-full px-4 py-3 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 focus:border-purple-500 focus:outline-none"
          data-testid="setup-display-name"
        />
      </div>

      {/* Bio */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1.5">Bio</label>
        <textarea
          value={form.bio}
          onChange={(e) => setForm(f => ({ ...f, bio: e.target.value }))}
          placeholder="Tell the world about yourself..."
          rows={3}
          className="w-full px-4 py-3 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 focus:border-purple-500 focus:outline-none resize-none"
          data-testid="setup-bio"
        />
      </div>

      {/* Profile Image */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1.5">Profile Image</label>
        <div className="flex items-center gap-4">
          {form.imagePreview ? (
            <div className="relative">
              <img src={form.imagePreview} alt="Preview" className="w-16 h-16 rounded-full object-cover border-2 border-purple-500/30" />
              <button
                type="button"
                onClick={clearImage}
                className="absolute -top-1 -right-1 w-5 h-5 bg-gray-900 border border-gray-700 rounded-full flex items-center justify-center text-gray-400 hover:text-red-400 hover:border-red-500 transition-colors"
                title="Remove image"
                data-testid="setup-image-remove"
              >
                <FiTrash2 size={10} />
              </button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center border-2 border-gray-700">
              <FiImage size={20} className="text-gray-600" />
            </div>
          )}
          <div className="flex-1">
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
              <FiUpload size={14} />
              {uploading ? 'Uploading to IPFS...' : form.imageRef ? 'Change Image' : 'Select Image'}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" data-testid="setup-image-upload" />
            </label>
            {uploadError && (
              <div className="mt-1.5 flex items-start gap-2">
                <p className="text-xs text-red-400 flex-1">{uploadError}</p>
                <button
                  type="button"
                  onClick={() => setUploadError('')}
                  className="text-xs text-gray-500 hover:text-gray-300 whitespace-nowrap"
                  data-testid="setup-dismiss-error"
                >
                  Dismiss
                </button>
              </div>
            )}
            {form.imageRef && !uploadError && <p className="text-xs text-emerald-400 mt-1 truncate max-w-[250px]">Pinned to IPFS</p>}
          </div>
        </div>
        <input
          type="text" value={form.imageRef}
          onChange={(e) => setForm(f => ({ ...f, imageRef: e.target.value }))}
          placeholder="Or paste IPFS:hash/file.jpg or BTC:txid/file.jpg"
          className="w-full mt-2 px-4 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-xs focus:border-purple-500 focus:outline-none"
          data-testid="setup-image-ref"
        />
      </div>

      {/* Advanced Fields Toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 mb-4 transition-colors"
        data-testid="toggle-advanced-fields"
      >
        {showAdvanced ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
        {showAdvanced ? 'Hide' : 'Show'} advanced fields
      </button>

      {showAdvanced && (
        <div className="space-y-4 mb-4 border-t border-gray-800 pt-4">
          {/* Name Fields Row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">First Name</label>
              <input
                type="text" value={form.firstName}
                onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
                placeholder="First"
                className="w-full px-3 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                data-testid="setup-first-name"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Middle Name</label>
              <input
                type="text" value={form.middleName}
                onChange={(e) => setForm(f => ({ ...f, middleName: e.target.value }))}
                placeholder="Middle"
                className="w-full px-3 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                data-testid="setup-middle-name"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Last Name</label>
              <input
                type="text" value={form.lastName}
                onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
                placeholder="Last"
                className="w-full px-3 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                data-testid="setup-last-name"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Suffix</label>
              <input
                type="text" value={form.suffix}
                onChange={(e) => setForm(f => ({ ...f, suffix: e.target.value }))}
                placeholder="Jr., Sr., III"
                className="w-full px-3 py-2.5 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                data-testid="setup-suffix"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Location</label>
            <div className="grid grid-cols-3 gap-2">
              {LOC_FIELDS.map(f => (
                <input
                  key={f.key}
                  type="text"
                  value={form.locEntries?.find(e => e.key === f.key)?.value || ''}
                  onChange={(e) => {
                    const existing = form.locEntries || [];
                    const idx = existing.findIndex(x => x.key === f.key);
                    let next;
                    if (idx >= 0) {
                      next = [...existing];
                      next[idx] = { key: f.key, value: e.target.value };
                    } else {
                      next = [...existing, { key: f.key, value: e.target.value }];
                    }
                    setForm(prev => ({ ...prev, locEntries: next }));
                  }}
                  placeholder={f.label}
                  className="px-2 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-100 text-sm focus:border-purple-500 focus:outline-none"
                  data-testid={`setup-loc-${f.key}`}
                />
              ))}
            </div>
          </div>

          {/* URLs */}
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Links</label>
            <KeyValueEditor
              entries={form.urls || []}
              onChange={(urls) => setForm(f => ({ ...f, urls }))}
              presets={URL_PRESETS}
              placeholder="https://..."
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          data-testid="setup-skip-btn"
        >
          Skip for now
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          data-testid="setup-next-btn"
        >
          Next: Fund Wallet <FiArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
