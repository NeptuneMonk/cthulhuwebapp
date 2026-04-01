import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { FiX, FiShield, FiLock, FiSmile, FiMic, FiPaperclip, FiSend, FiBarChart2, FiPlus } from 'react-icons/fi';
import EmojiPicker from 'emoji-picker-react';
import { GifSelector } from '@/components/GifSelector';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { ProfileThumb } from '@/components/ProfileThumb';
import { addTransaction } from '@/utils/txHistory';
import { addPendingPost } from '@/utils/pendingPosts';
import PollCreateModal from '@/components/PollCreateModal';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const ComposeBar = ({ network, onPostSuccess, targetAddress, placeholder: customPlaceholder, onBeforeSend, onSendSuccess, onSendError }) => {
  const { user: authUser, wif: authWif, isConnected: authConnected } = useAuth();
  const { wallet, profile, isConnected: walletConnected, balance, refreshBalance } = useWallet();

  const [text, setText] = useState('');
  const [attachedGif, setAttachedGif] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]); // {name, previewUrl, type}
  const [activePanel, setActivePanel] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState(''); // '', 'uploading', 'broadcasting'
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showPollModal, setShowPollModal] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const textRef = useRef(null);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  // @mention autocomplete state
  const [knownUsers, setKnownUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const activeWif = authWif || wallet?.wif;
  const activeAddress = authUser?.address || wallet?.address;
  const isConnected = (authConnected && authWif) || (walletConnected && wallet?.wif);
  const displayName = authUser?.urn || profile?.display_name || profile?.urn || '';

  const buildContent = () => {
    const parts = [];
    if (text.trim()) parts.push(text.trim());
    if (attachedGif) parts.push(`<<${attachedGif.ref}>>`);
    // IPFS file refs are appended during handlePost after upload
    return parts.join('\n');
  };

  const finalContent = buildContent();
  const maxChars = 220;
  const canPost = (finalContent.trim().length > 0 || attachedFiles.length > 0) && !sending;

  const togglePanel = (panel) => setActivePanel(prev => prev === panel ? null : panel);

  // ─── Post ──────────────────────────────────────────────────
  const handlePost = async () => {
    if ((!canPost && attachedFiles.length === 0) || !isConnected || !activeWif || sending) return;
    setSending(true);
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
            const fileBlob = f._file;
            if (!fileBlob) continue;
            setSendingStatus(attachedFiles.length > 1 ? `uploading ${i + 1}/${attachedFiles.length}` : 'uploading');
            const formData = new FormData();
            formData.append('file', fileBlob, f.name);
            const uploadRes = await fetch(`${API}/ipfs/upload`, { method: 'POST', body: formData });
            if (!uploadRes.ok) throw new Error('IPFS upload failed');
            const { cid } = await uploadRes.json();
            contentParts.push(`<<IPFS:${cid}/${f.name}>>`);
          } catch (err) {
            toast.error(`Failed to upload ${f.name}: ${err.message}`);
            setSendingStatus('');
            return;
          }
        }
      }

      setSendingStatus('broadcasting');

      const postContent = contentParts.join('\n');
      if (!postContent.trim()) { toast.error('Nothing to post'); return; }

      const [{ buildPostTransaction }, { buildAndBroadcast }] = await Promise.all([
        import('@/utils/p2fk'), import('@/utils/txBuilder'),
      ]);
      const hashtags = [...postContent.matchAll(/#(\w+)/g)].map(m => m[1]);
      let mentionAddress = targetAddress || null;
      if (!mentionAddress) {
        const mentions = [...postContent.matchAll(/@(\w+)/g)].map(m => m[1]);
        if (mentions.length > 0) {
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
      }
      if (onBeforeSend) onBeforeSend(postContent);
      const { addresses, taxInsertIndex } = buildPostTransaction(activeWif, postContent, hashtags, mentionAddress, network || 'btc-testnet');
      const result = await buildAndBroadcast(activeWif, addresses, network || 'btc-testnet', [], 0, 546, [], taxInsertIndex);
      if (result.success) {
        // Only add to main feed pending if NOT a room/targeted post
        if (!targetAddress) {
          addTransaction(activeAddress, {
            txid: result.txid, type: 'POST', network: network || 'btc-testnet',
            addresses, label: (text.trim() || 'Post').substring(0, 60),
          });
          addPendingPost({
            txid: result.txid,
            network: network || 'btc-testnet',
            content: postContent,
            from_address: activeAddress,
            sender_urn: displayName,
            sender_image: profile?.image || null,
          });
        }
        refreshBalance();
        toast.success('Broadcast successful!');
        setText(''); setAttachedGif(null); setAttachedFiles([]); setActivePanel(null);
        setMentionQuery(null);
        if (onSendSuccess) onSendSuccess(result.txid);
        if (onPostSuccess) onPostSuccess();
      }
    } catch (err) {
      toast.error(`Post failed: ${err.message}`);
      if (onSendError) onSendError(err.message);
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
        // Attach as a file so it gets uploaded on Send
        setAttachedFiles(prev => [...prev, {
          name: 'voice.webm',
          type: mimeType,
          _file: new File([blob], 'voice.webm', { type: mimeType }),
          previewUrl,
          isVoice: true,
        }]);
      };
      recorderRef.current = mr;
      mr.start(100);
      setRecording(true); setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error('Microphone access denied'); }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    clearInterval(timerRef.current); setRecording(false);
  };

  // ─── File attach ────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map(f => ({
      name: f.name,
      type: f.type,
      _file: f, // Keep the actual File object for upload
      previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
    }));
    setAttachedFiles(prev => [...prev, ...previews]);
  };

  const removeFile = (idx) => {
    setAttachedFiles(prev => { const n = [...prev]; if (n[idx]?.previewUrl) URL.revokeObjectURL(n[idx].previewUrl); n.splice(idx, 1); return n; });
  };

  // Clean up URLs on unmount
  useEffect(() => {
    return () => { attachedFiles.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); };
  }, []); // eslint-disable-line

  // Fetch known users for @mention autocomplete
  useEffect(() => {
    if (targetAddress) return; // No @mentions in room mode
    fetch(`${API}/known-users/${network || 'btc-testnet'}`)
      .then(r => r.json())
      .then(d => setKnownUsers(Array.isArray(d) ? d : (d.users || [])))
      .catch(() => {});
  }, [network, targetAddress]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null || targetAddress) return [];
    const q = mentionQuery.toLowerCase();
    return knownUsers
      .filter(u => u.urn && (q === '' || u.urn.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [mentionQuery, knownUsers, targetAddress]);

  const insertMention = useCallback((urn) => {
    const ta = textRef.current;
    const cursor = ta?.selectionStart || text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const match = before.match(/@(\w*)$/);
    if (match) {
      const newBefore = before.slice(0, -match[0].length) + `@${urn} `;
      setText(newBefore + after);
      setMentionQuery(null);
      setTimeout(() => { if (ta) { ta.selectionStart = ta.selectionEnd = newBefore.length; ta.focus(); } }, 0);
    }
  }, [text]);

  const onEmojiClick = useCallback((emojiData) => {
    setText(prev => prev + emojiData.emoji);
    textRef.current?.focus();
  }, []);

  const hasAttachments = attachedGif || attachedFiles.length > 0;

  // ─── Locked states ──────────────────────────────────────────
  if (!authConnected) {
    return (
      <div className="relative flex-shrink-0" data-testid="compose-bar-locked">
        <div className="absolute -top-8 left-0 right-0 h-8 bg-gradient-to-t from-[#0a0e14] to-transparent pointer-events-none" />
        <div className="bg-[#0a0e14] px-4 pt-2 pb-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 text-gray-500 text-sm border border-gray-800/50 rounded-xl py-3 bg-[#0d1219]">
              <FiLock size={14} />
              <span>Sign in to broadcast</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (authConnected && !activeWif) {
    return (
      <div className="relative flex-shrink-0" data-testid="compose-bar-locked-wallet">
        <div className="absolute -top-8 left-0 right-0 h-8 bg-gradient-to-t from-[#0a0e14] to-transparent pointer-events-none" />
        <div className="bg-[#0a0e14] px-4 pt-2 pb-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 text-amber-600/80 text-sm border border-amber-900/30 rounded-xl py-3 bg-[#0d1219]">
              <FiLock size={14} />
              <span>Wallet locked — re-login to unlock</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main compose bar ─────────────────────────────────────
  return (
    <>
    <div className="relative flex-shrink-0" data-testid="compose-bar">
      {/* Gradient fade above compose */}
      <div className="absolute -top-10 left-0 right-0 h-10 bg-gradient-to-t from-[#0a0e14] to-transparent pointer-events-none" />

      {/* Expandable panels — combined Emoji + GIF with tabs */}
      {(activePanel === 'emoji' || activePanel === 'gif') && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActivePanel(null)} data-testid="compose-emoji-backdrop" />
          <div className="relative z-50 bg-[#0d1219] border-t border-gray-800/50" data-testid="compose-emoji-gif-panel">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
                <div className="flex gap-1">
                  <button
                    onClick={() => setActivePanel('emoji')}
                    className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'emoji' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                    data-testid="compose-tab-emoji"
                  >Emoji</button>
                  <button
                    onClick={() => setActivePanel('gif')}
                    className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'gif' ? 'bg-teal-900/50 text-teal-300' : 'text-gray-500 hover:text-gray-300'}`}
                    data-testid="compose-tab-gif"
                  >GIF</button>
                </div>
                <button onClick={() => setActivePanel(null)} className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" data-testid="compose-emoji-close">
                  <FiX size={14} />
                </button>
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
          </div>
        </>
      )}

      {/* Compose area with gradient background */}
      <div className="bg-[#0a0e14] px-4 pb-0 pt-1">
        <div className="max-w-3xl mx-auto">
          {/* The compose container */}
          <div className="border border-gray-700/40 rounded-xl bg-[#111827]" data-testid="compose-container">

            {/* Attachment preview area */}
            {hasAttachments && (
              <div className="px-3 pt-3 flex flex-wrap gap-2" data-testid="compose-preview-area">
                {/* GIF preview */}
                {attachedGif && (
                  <div className="relative group" data-testid="compose-bar-gif-preview">
                    <img src={attachedGif.url} alt="" className="h-20 rounded-lg border border-gray-700/40 object-cover" />
                    <button onClick={() => setAttachedGif(null)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors"
                      data-testid="compose-bar-remove-gif">
                      <FiX size={10} />
                    </button>
                  </div>
                )}
                {/* File previews */}
                {attachedFiles.map((f, i) => (
                  <div key={i} className="relative group" data-testid={`compose-file-preview-${i}`}>
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
              <div className="px-3 pt-3 flex items-center gap-2" data-testid="compose-recording-indicator">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-red-400 font-mono tabular-nums">{recordingTime}s</span>
                <span className="text-xs text-gray-500">Recording... tap mic to stop</span>
              </div>
            )}

            {/* Text input area */}
            <div className="px-3 pt-3 pb-1 relative">
              {/* @mention suggestions */}
              {mentionSuggestions.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-gray-900 border border-gray-700/50 rounded-lg overflow-hidden shadow-xl z-50" data-testid="mention-suggestions">
                  {mentionSuggestions.map((u, i) => (
                    <button key={u.address} onMouseDown={e => { e.preventDefault(); insertMention(u.urn); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${i === mentionIndex ? 'bg-gray-800 text-gray-200' : 'text-gray-400 hover:bg-gray-800/50'}`}
                      data-testid={`mention-suggestion-${i}`}>
                      <span style={{ color: 'var(--c-accent)' }}>@{u.urn}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textRef}
                value={text}
                onChange={e => {
                  const val = e.target.value.slice(0, maxChars);
                  setText(val);
                  const cursor = e.target.selectionStart;
                  const before = val.slice(0, cursor);
                  const match = before.match(/@(\w*)$/);
                  setMentionQuery(match ? match[1] : null);
                  if (match) setMentionIndex(0);
                }}
                placeholder={customPlaceholder || "Broadcast to the chain..."}
                rows={1}
                onKeyDown={e => {
                  if (mentionSuggestions.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIndex].urn); return; }
                    if (e.key === 'Escape') { setMentionQuery(null); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); }
                }}
                className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none resize-none leading-relaxed"
                style={{ minHeight: '36px', maxHeight: '140px' }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
                data-testid="compose-bar-input"
              />
            </div>

            {/* Bottom toolbar — inside the container */}
            <div className="flex items-center px-2 pb-2 pt-0">
              <div className="flex items-center gap-0.5 relative">
                {/* Group 1: Emoji + GIF — single toggle button on mobile */}
                <BarBtn
                  active={activePanel === 'emoji' || activePanel === 'gif' || !!attachedGif}
                  onClick={() => togglePanel(activePanel === 'emoji' ? 'gif' : activePanel === 'gif' ? null : 'emoji')}
                  testId="compose-bar-emoji-gif"
                  title="Emoji & GIF"
                >
                  <FiSmile size={15} />
                </BarBtn>

                {/* Group 2: Attach (File + Audio + Poll) — single button with popup menu */}
                <BarBtn
                  active={attachMenu || recording}
                  onClick={() => { if (recording) { stopRecording(); } else { setAttachMenu(prev => !prev); } }}
                  testId="compose-bar-attach-menu"
                  title="Attach"
                  danger={recording}
                >
                  {recording ? <FiMic size={15} /> : <FiPlus size={15} />}
                </BarBtn>
                {attachMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAttachMenu(false)} />
                    <div className="absolute bottom-8 left-6 z-50 bg-gray-800 border border-gray-700/60 rounded-xl shadow-xl py-1.5 min-w-[140px]" data-testid="compose-bar-attach-popup">
                      <button onClick={() => { setAttachMenu(false); startRecording(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors" data-testid="compose-bar-mic">
                        <FiMic size={14} /> Voice
                      </button>
                      <button onClick={() => { setAttachMenu(false); fileInputRef.current?.click(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors" data-testid="compose-bar-attach">
                        <FiPaperclip size={14} /> File
                      </button>
                      <button onClick={() => { setAttachMenu(false); setShowPollModal(true); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors" data-testid="compose-bar-poll">
                        <FiBarChart2 size={14} /> Poll
                      </button>
                    </div>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.gif,.pdf,.zip,.txt,.doc,.docx" multiple className="hidden" onChange={handleFileSelect} />
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                {/* Sending status indicator */}
                {sending && sendingStatus && (
                  <div className="flex items-center gap-1.5" data-testid="compose-sending-status">
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--c-accent)' }} />
                    <span className="text-[10px] font-medium" style={{ color: 'var(--c-accent)' }}>
                      {sendingStatus === 'uploading' ? 'Uploading to IPFS...'
                        : sendingStatus.startsWith('uploading ') ? `Uploading ${sendingStatus.slice(10)}...`
                        : sendingStatus === 'broadcasting' ? 'Broadcasting...'
                        : sendingStatus}
                    </span>
                  </div>
                )}
                {!sending && text.length > 0 && (
                  <span className={`text-[10px] tabular-nums ${finalContent.length > maxChars * 0.9 ? 'text-amber-400' : 'text-gray-600'}`}>
                    {finalContent.length}/{maxChars}
                  </span>
                )}
                <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--c-accent)', opacity: 0.5 }} title="Signed locally">
                  <FiShield size={9} /> Local
                </span>
                <button
                  onClick={handlePost}
                  disabled={!canPost || sending || !isConnected}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-20 text-white btn-accent"
                  data-testid="compose-bar-send"
                >
                  {sending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <FiSend size={14} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    {showPollModal && <PollCreateModal onClose={() => setShowPollModal(false)} network={network} onCreated={onPostSuccess} />}
    </>
  );
};

const BarBtn = ({ children, active, onClick, testId, title, accent, danger }) => (
  <button onClick={onClick} title={title}
    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
      danger ? 'bg-red-600/20 text-red-400 ring-1 ring-red-500/50'
        : active ? (accent ? 'bg-accent-muted text-accent' : 'bg-gray-700/50 text-gray-200')
        : accent ? 'text-accent hover:bg-accent-muted' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
    }`}
    style={accent && !danger ? { '--tw-text-opacity': 1 } : undefined}
    data-testid={testId}>
    {children}
  </button>
);
