import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FiX, FiSend, FiShield, FiLock, FiSmile, FiMic, FiPaperclip, FiArrowLeft, FiBarChart2, FiCheck } from 'react-icons/fi';
import EmojiPicker from 'emoji-picker-react';
import { GifSelector } from '@/components/GifSelector';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { ProfileThumb } from '@/components/ProfileThumb';
import { addTransaction } from '@/utils/txHistory';
import { addPendingPost } from '@/utils/pendingPosts';
import { addPendingTx } from '@/utils/txBuilder';
import { useUploadQueue } from '@/contexts/UploadQueueContext';
import FeePicker from '@/components/FeePicker';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const ComposeModal = ({ onClose, network, replyTo }) => {
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  const { wallet, profile, isConnected: walletConnected, balance, refreshBalance } = useWallet();
  const uploadQueue = useUploadQueue();

  const [text, setText] = useState('');
  const [attachedGif, setAttachedGif] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [activePanel, setActivePanel] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState('');
  const [txResult, setTxResult] = useState(null);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [attachMenu, setAttachMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef(null);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);
  const dragCountRef = useRef(0);

  const activeWif = authWif || wallet?.wif;
  const activeAddress = authUser?.address || wallet?.address;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);
  const displayName = authUser?.urn || profile?.display_name || profile?.urn || (activeAddress ? activeAddress.substring(0, 12) + '...' : '');

  const buildContent = () => {
    const parts = [];
    if (text.trim()) parts.push(text.trim());
    if (attachedGif) parts.push(`<<${attachedGif.ref}>>`);
    return parts.join('\n');
  };

  const finalContent = buildContent();
  const maxChars = 220;
  const charsUsed = finalContent.length;
  const canPost = (finalContent.trim().length > 0 || attachedFiles.length > 0) && !sending;

  const togglePanel = (panel) => setActivePanel(prev => prev === panel ? null : panel);

  // Close attach menu on outside click
  useEffect(() => {
    if (!attachMenu) return;
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) setAttachMenu(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [attachMenu]);

  // ─── Post ──────────────────────────────────────────────────
  const handlePost = async () => {
    if ((!canPost && attachedFiles.length === 0) || !isConnected || !activeWif || sending) return;
    setSending(true);
    setError(null);

    try {
      // Upload attached files to IPFS first
      let contentParts = [];
      if (text.trim()) contentParts.push(text.trim());
      if (attachedGif) contentParts.push(`<<${attachedGif.ref}>>`);

      if (attachedFiles.length > 0) {
        setSendingStatus('uploading');
        for (let i = 0; i < attachedFiles.length; i++) {
          const f = attachedFiles[i];
          try {
            // If already uploaded via background queue, use the CID directly
            if (f.cid) {
              contentParts.push(`<<IPFS:${f.cid}>>`);
              continue;
            }

            // If still uploading in background, wait for it
            if (f.uploading && f.uploadId && uploadQueue) {
              setSendingStatus(`Waiting for ${f.name} to finish uploading...`);
              // Poll the queue for completion
              const cid = await new Promise((resolve, reject) => {
                const check = () => {
                  const entry = uploadQueue.uploads.find(u => u.id === f.uploadId);
                  if (!entry) { reject(new Error('Upload lost')); return; }
                  if (entry.status === 'done') { resolve(entry.cid); return; }
                  if (entry.status === 'error') { reject(new Error(entry.error)); return; }
                  setTimeout(check, 500);
                };
                check();
              });
              contentParts.push(`<<IPFS:${cid}>>`);
              continue;
            }

            // Small file: upload inline with progress
            const fileBlob = f._file;
            if (!fileBlob) continue;
            const sizeMB = (fileBlob.size / 1024 / 1024).toFixed(1);
            setSendingStatus(attachedFiles.length > 1
              ? `Uploading ${i + 1}/${attachedFiles.length} (${sizeMB}MB)...`
              : `Uploading to IPFS (${sizeMB}MB)...`);

            // Use XMLHttpRequest for upload progress on large files
            const cid = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', `${API}/ipfs/upload`);
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  const pct = Math.round((e.loaded / e.total) * 100);
                  const prefix = attachedFiles.length > 1 ? `File ${i + 1}/${attachedFiles.length}: ` : '';
                  setSendingStatus(`${prefix}Uploading ${pct}% (${sizeMB}MB)`);
                }
              };
              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                    const data = JSON.parse(xhr.responseText);
                    if (data.cid) resolve(data.cid);
                    else reject(new Error('No CID returned'));
                  } catch { reject(new Error('Invalid response')); }
                } else {
                  let detail = 'IPFS upload failed';
                  try { detail = JSON.parse(xhr.responseText).detail || detail; } catch {}
                  reject(new Error(detail));
                }
              };
              xhr.onerror = () => reject(new Error('Network error during upload'));
              xhr.ontimeout = () => reject(new Error('Upload timed out'));
              xhr.timeout = 600000; // 10 min timeout for large files
              const formData = new FormData();
              formData.append('file', fileBlob, f.name);
              xhr.send(formData);
            });

            contentParts.push(`<<IPFS:${cid}>>`);
          } catch (err) {
            setError(`Failed to upload ${f.name}: ${err.message}`);
            setSending(false);
            setSendingStatus('');
            return;
          }
        }
      }

      setSendingStatus('Broadcasting...');
      const postContent = contentParts.join('\n');
      if (!postContent.trim()) { setError('Nothing to post'); setSending(false); setSendingStatus(''); return; }

      const [{ buildPostTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);

      const hashtags = [...postContent.matchAll(/#(\w+)/g)].map(m => m[1]);
      const mentions = [...postContent.matchAll(/@(\w+)/g)].map(m => m[1]);
      let mentionAddress = replyTo?.address || null;
      if (!mentionAddress && mentions.length > 0) {
        try {
          const res = await fetch(`${API}/known-users/${network || 'btc-testnet'}`);
          if (res.ok) {
            const data = await res.json();
            const users = Array.isArray(data) ? data : (data.users || []);
            for (const m of mentions) {
              const found = users.find(u => u.urn?.toLowerCase() === m.toLowerCase());
              if (found?.address) { mentionAddress = found.address; break; }
            }
          }
        } catch { /* silent */ }
      }

      const { addresses, taxInsertIndex } = buildPostTransaction(activeWif, postContent, hashtags, mentionAddress, network || 'btc-testnet');
      const result = await buildAndBroadcast(activeWif, addresses, network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);

      if (result.success) {
        addTransaction(activeAddress, {
          txid: result.txid, type: 'POST', network: network || 'btc-testnet',
          addresses, label: (text.trim() || 'Post').substring(0, 60),
        });
        addPendingPost({
          txid: result.txid, network: network || 'btc-testnet',
          content: postContent, from_address: activeAddress,
          sender_urn: displayName, sender_image: profile?.image || null,
        });
        addPendingTx(result.txid, 'POST', postContent.substring(0, 60));
        refreshBalance();
        setTxResult({ txid: result.txid, addressCount: addresses.length, costSats: addresses.length * 546 + (result.fee || 0) });
      }
    } catch (err) {
      setError(`Post failed: ${err.message}`);
    } finally { setSending(false); setSendingStatus(''); }
  };

  // ─── Mic ───────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const previewUrl = URL.createObjectURL(blob);
        setAttachedFiles(prev => [...prev, {
          name: 'voice.webm', type: mimeType,
          _file: new File([blob], 'voice.webm', { type: mimeType }),
          previewUrl, isVoice: true,
        }]);
      };
      recorderRef.current = mr;
      mr.start(100);
      setRecording(true); setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { setError('Microphone access denied'); }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    clearInterval(timerRef.current); setRecording(false);
  };

  // ─── File attach ────────────────────────────────────────────
  const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map(f => {
      const entry = {
        name: f.name, type: f.type, _file: f,
        previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
        uploadId: null, cid: null, uploading: false,
      };

      // For large files, start uploading immediately in background
      if (f.size >= LARGE_FILE_THRESHOLD && uploadQueue) {
        entry.uploading = true;
        const uploadId = uploadQueue.addUpload(f, (result) => {
          // When upload finishes, store the CID in the file entry
          setAttachedFiles(prev => prev.map(af =>
            af._file === f ? { ...af, cid: result.cid, uploading: false } : af
          ));
          toast.success(`${f.name} uploaded to IPFS`);
        });
        entry.uploadId = uploadId;
      }

      return entry;
    });
    setAttachedFiles(prev => [...prev, ...previews]);
  };

  const removeFile = (idx) => {
    setAttachedFiles(prev => { const n = [...prev]; if (n[idx]?.previewUrl) URL.revokeObjectURL(n[idx].previewUrl); n.splice(idx, 1); return n; });
  };

  useEffect(() => {
    return () => { attachedFiles.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); };
  }, []); // eslint-disable-line

  const onEmojiClick = useCallback((emojiData) => {
    setText(prev => prev + emojiData.emoji);
    textRef.current?.focus();
  }, []);

  // ─── Drag & Drop + Paste ────────────────────────────────────
  const addFilesToAttach = useCallback((files) => {
    const previews = Array.from(files).map(f => {
      const entry = {
        name: f.name, type: f.type, _file: f,
        previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
        uploadId: null, cid: null, uploading: false,
      };
      if (f.size >= LARGE_FILE_THRESHOLD && uploadQueue) {
        entry.uploading = true;
        const uploadId = uploadQueue.addUpload(f, (result) => {
          setAttachedFiles(prev => prev.map(af =>
            af._file === f ? { ...af, cid: result.cid, uploading: false } : af
          ));
          toast.success(`${f.name} uploaded to IPFS`);
        });
        entry.uploadId = uploadId;
      }
      return entry;
    });
    setAttachedFiles(prev => [...prev, ...previews]);
  }, [uploadQueue]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current++;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) { setDragging(false); dragCountRef.current = 0; }
  }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setDragging(false); dragCountRef.current = 0;
    if (e.dataTransfer?.files?.length) addFilesToAttach(e.dataTransfer.files);
  }, [addFilesToAttach]);
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) { e.preventDefault(); addFilesToAttach(files); }
  }, [addFilesToAttach]);

  const hasAttachments = attachedGif || attachedFiles.length > 0;

  return (
    <div className="fixed inset-0 bg-black/70 lg:flex lg:items-center lg:justify-center z-50 lg:p-4" onClick={onClose} data-testid="compose-modal-overlay">
      <div className="bg-gray-900 w-full h-full lg:h-auto lg:border lg:border-gray-800 lg:rounded-xl lg:w-auto lg:max-w-lg lg:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()} data-testid="compose-modal">
        {/* Header */}
        <div className="flex items-center justify-between px-4 lg:px-5 py-3 lg:py-4 border-b border-gray-800 bg-gray-900 z-10 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 -ml-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors lg:hidden" data-testid="compose-back">
              <FiArrowLeft size={20} />
            </button>
            <h3 className="text-base lg:text-lg font-bold text-gray-100">
              {replyTo ? 'Reply' : 'New Post'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1 hidden lg:block" data-testid="compose-close">
            <FiX size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-5"
          onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
        >
          {/* Drop zone overlay */}
          {dragging && (
            <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-400/50 rounded-xl flex items-center justify-center pointer-events-none" data-testid="compose-modal-drop-zone">
              <div className="text-center">
                <FiPaperclip size={32} className="mx-auto text-blue-400 mb-2" />
                <p className="text-blue-400 font-medium text-sm">Drop files here</p>
              </div>
            </div>
          )}
          {txResult ? (
            <div className="text-center py-6" data-testid="compose-success">
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-green-400 font-medium mb-2">
                {replyTo ? 'Reply' : 'Post'} broadcast successfully!
              </p>
              <p className="text-xs text-gray-500 font-mono break-all">TX: {txResult.txid}</p>
              <p className="text-xs text-gray-600 mt-2">{txResult.addressCount} addresses &middot; {txResult.costSats} sats</p>
            </div>
          ) : !isConnected ? (
            <div className="text-center py-8">
              <FiLock size={32} className="mx-auto text-gray-600 mb-3" />
              <p className="text-gray-400 mb-2">Connect your wallet to post</p>
              <p className="text-xs text-gray-600">Sign in or use the wallet button in the sidebar</p>
            </div>
          ) : (
            <>
              {replyTo && (
                <div className="mb-4 p-3 bg-gray-800/50 border-l-2 border-blue-500 rounded-r-lg">
                  <p className="text-xs text-gray-500 mb-1">Replying to</p>
                  <p className="text-sm text-gray-300 truncate">
                    @{replyTo.display_name || replyTo.urn || replyTo.address?.substring(0, 16) + '...'}
                  </p>
                  {replyTo.content && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{replyTo.content}</p>}
                </div>
              )}

              {/* Author */}
              <div className="flex items-center gap-3 mb-4">
                <ProfileThumb name={displayName} image={profile?.image} size="md" />
                <div>
                  <p className="text-sm font-medium text-gray-200">{displayName}</p>
                  <p className="text-xs text-gray-500 font-mono">{activeAddress?.substring(0, 16)}...</p>
                </div>
              </div>

              {/* Attachment previews */}
              {hasAttachments && (
                <div className="flex flex-wrap gap-2 mb-3" data-testid="compose-modal-previews">
                  {attachedGif && (
                    <div className="relative group">
                      <img src={attachedGif.url} alt="" className="h-20 rounded-lg border border-gray-700/40 object-cover" />
                      <button onClick={() => setAttachedGif(null)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors">
                        <FiX size={10} />
                      </button>
                    </div>
                  )}
                  {attachedFiles.map((f, i) => (
                    <div key={i} className="relative group" data-testid={`compose-modal-file-${i}`}>
                      {f.previewUrl && f.type?.startsWith('image/') ? (
                        <img src={f.previewUrl} alt={f.name} className="h-20 rounded-lg border border-gray-700/40 object-cover" />
                      ) : f.previewUrl && f.type?.startsWith('video/') ? (
                        <video src={f.previewUrl} className="h-20 rounded-lg border border-gray-700/40" muted />
                      ) : f.isVoice || f.type?.startsWith('audio/') ? (
                        <div className="h-20 w-44 rounded-lg border border-gray-700/40 bg-gray-800 flex flex-col items-center justify-center px-2 gap-1">
                          <FiMic size={14} className="text-teal-400" />
                          <audio src={f.previewUrl} controls className="w-full h-6" style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.7 }} />
                          <span className="text-[8px] text-gray-500">{f.name}</span>
                        </div>
                      ) : (
                        <div className="h-20 w-20 rounded-lg border border-gray-700/40 bg-gray-800 flex flex-col items-center justify-center px-1">
                          <FiPaperclip size={16} className="text-gray-500 mb-1" />
                          <span className="text-[8px] text-gray-500 truncate w-full text-center">{f.name}</span>
                        </div>
                      )}
                      {/* Upload status badge */}
                      {f.uploading && !f.cid && (
                        <div className="absolute bottom-1 left-1 right-1 bg-black/70 rounded px-1 py-0.5">
                          <div className="h-0.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full transition-all duration-300" style={{ width: `${(uploadQueue?.uploads.find(u => u.id === f.uploadId)?.progress) || 0}%` }} />
                          </div>
                          <span className="text-[8px] text-purple-400 block text-center mt-0.5">Uploading...</span>
                        </div>
                      )}
                      {f.cid && (
                        <div className="absolute bottom-1 left-1 bg-emerald-500/20 rounded px-1.5 py-0.5 flex items-center gap-1">
                          <FiCheck size={8} className="text-emerald-400" />
                          <span className="text-[8px] text-emerald-400">Ready</span>
                        </div>
                      )}
                      <button onClick={() => removeFile(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors">
                        <FiX size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Recording indicator */}
              {recording && (
                <div className="flex items-center gap-2 mb-3" data-testid="compose-modal-recording">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-red-400 font-mono tabular-nums">{recordingTime}s</span>
                  <span className="text-xs text-gray-500">Recording... tap mic to stop</span>
                </div>
              )}

              {/* Compose textarea */}
              <textarea
                ref={textRef}
                value={text}
                onChange={e => setText(e.target.value.slice(0, maxChars))}
                onPaste={handlePaste}
                placeholder={replyTo ? "Write your reply..." : "What's happening on-chain?"}
                rows={attachedGif || attachedFiles.length > 0 ? 2 : 4}
                autoFocus
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
                data-testid="compose-textarea"
              />

              {/* Emoji / GIF combined panel */}
              {(activePanel === 'emoji' || activePanel === 'gif') && (
                <div className="mt-2" data-testid="compose-modal-emoji-gif-panel">
                  <div className="flex items-center gap-1 mb-1.5">
                    <button
                      onClick={() => setActivePanel('emoji')}
                      className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'emoji' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                      data-testid="compose-modal-tab-emoji"
                    >Emoji</button>
                    <button
                      onClick={() => setActivePanel('gif')}
                      className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'gif' ? 'bg-teal-900/50 text-teal-300' : 'text-gray-500 hover:text-gray-300'}`}
                      data-testid="compose-modal-tab-gif"
                    >GIF</button>
                  </div>
                  {activePanel === 'emoji' && (
                    <div className="emoji-compact">
                      <EmojiPicker theme="dark" width="100%" height={160} emojiStyle="native" searchDisabled skinTonesDisabled categoriesDisabled onEmojiClick={onEmojiClick} previewConfig={{ showPreview: false }} lazyLoadEmojis />
                    </div>
                  )}
                  {activePanel === 'gif' && (
                    <GifSelector
                      network={network}
                      onSelect={(gif) => { setAttachedGif(gif); setActivePanel(null); }}
                      onClose={() => setActivePanel(null)}
                    />
                  )}
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 mt-2 bg-red-400/10 border border-red-400/20 rounded px-3 py-2" data-testid="compose-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Toolbar footer — outside scrollable area so popups don't clip */}
        {!txResult && isConnected && (
          <div className="flex-shrink-0 px-4 lg:px-5 pb-4 pt-2 border-t border-gray-800/50 bg-gray-900 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {/* Button 1: Emoji/GIF combined */}
                <ToolBtn active={activePanel === 'emoji' || activePanel === 'gif' || !!attachedGif} onClick={() => togglePanel(activePanel === 'gif' ? 'gif' : 'emoji')} testId="compose-modal-emoji" title="Emoji & GIF">
                  <FiSmile size={16} />
                </ToolBtn>
                {/* Button 2: Attach menu */}
                <div className="relative" ref={attachMenuRef}>
                  <ToolBtn active={attachMenu || recording} onClick={() => { if (recording) { stopRecording(); } else { setAttachMenu(prev => !prev); } }} testId="compose-modal-attach-menu-btn" title="Attach" danger={recording}>
                    {recording ? <FiMic size={16} /> : <FiPaperclip size={16} />}
                  </ToolBtn>
                  {attachMenu && !recording && (
                    <div className="absolute bottom-9 left-0 z-[60] bg-gray-800 border border-gray-700/60 rounded-xl shadow-xl py-1.5 min-w-[140px]" data-testid="compose-modal-attach-popup">
                      <button onClick={() => { setAttachMenu(false); startRecording(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors" data-testid="compose-modal-mic">
                        <FiMic size={14} className="text-teal-400" /><span>Voice</span>
                      </button>
                      <button onClick={() => { setAttachMenu(false); fileInputRef.current?.click(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors" data-testid="compose-modal-attach">
                        <FiPaperclip size={14} className="text-purple-400" /><span>File</span>
                      </button>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.gif,.pdf,.zip,.txt,.doc,.docx" multiple className="hidden" onChange={handleFileSelect} data-testid="compose-modal-file-input" />

                <span className={`text-xs ml-2 ${charsUsed > maxChars * 0.9 ? 'text-amber-400' : 'text-gray-600'}`}>
                  {charsUsed}/{maxChars}
                </span>
                <span className="text-xs text-emerald-600 flex items-center gap-1 ml-2" title="Signed locally — key never leaves browser">
                  <FiShield size={11} /> Local
                </span>
              </div>

              <FeePicker network={network} compact />

              <button
                onClick={handlePost}
                disabled={!canPost || sending || (balance && balance.balance_sats < 1000)}
                className="flex items-center gap-2 px-5 py-2 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors font-medium text-sm btn-accent"
                data-testid="compose-send"
              >
                {sending ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {sendingStatus || 'Signing...'}
                  </>
                ) : (
                  <>
                    <FiSend size={14} />
                    {replyTo ? 'Reply' : 'Post'}
                  </>
                )}
              </button>
            </div>

            {!activePanel && balance && balance.balance_sats < 1000 && (
              <p className="text-xs text-amber-400 mt-2">
                Insufficient balance. Buy tBTC at <a href="https://buytestnet.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">buytestnet.com</a> to post.
              </p>
            )}

            {!activePanel && canPost && (
              <p className="text-xs text-gray-600 mt-2">
                Est. cost: ~{(Math.ceil((finalContent.length + 150) / 20) + 2) * 546 + 3000} sats
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ToolBtn = ({ children, active, onClick, testId, title, accent, danger }) => (
  <button onClick={onClick} title={title}
    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
      danger ? 'bg-red-600/20 text-red-400 ring-1 ring-red-500/50'
        : active ? (accent ? 'bg-accent-muted text-accent' : 'bg-gray-700/50 text-gray-200')
        : accent ? 'text-accent hover:bg-accent-muted' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
    }`}
    data-testid={testId}>
    {children}
  </button>
);
