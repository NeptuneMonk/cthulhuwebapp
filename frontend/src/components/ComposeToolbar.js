/**
 * ComposeToolbar — Shared toolbar for emoji, GIF, mic recording, and file attachment.
 * Used by ObjectChatPage (rooms), DMPage, and can be dropped into any compose area.
 *
 * Props:
 *   text / setText           — controlled text state from parent
 *   onContentReady(parts)    — async: called with final content parts (text + IPFS refs) when send is triggered
 *   sending                  — external sending state
 *   disabled                 — disable interactions
 *   placeholder              — textarea placeholder
 *   accentColor              — 'purple' | 'emerald' | 'red' | 'teal' (for send button)
 *   testIdPrefix             — prefix for data-testid attributes
 *   network                  — for GIF selector
 *   maxChars                 — optional char limit (0 = no limit)
 *   onKeySubmit              — optional: called on Enter (no shift)
 *   extraToolbarRight        — optional: extra JSX for the right side of toolbar
 *   showCharCount            — show character counter (default false)
 */
import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { FiX, FiSmile, FiMic, FiPaperclip, FiSend, FiBarChart2 } from 'react-icons/fi';
import EmojiPicker from 'emoji-picker-react';
import { GifSelector } from '@/components/GifSelector';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ComposeToolbar = forwardRef(({
  text, setText,
  sending = false,
  disabled = false,
  placeholder = 'Write a message...',
  accentColor = 'purple',
  testIdPrefix = 'compose',
  network,
  maxChars = 0,
  onKeySubmit,
  showCharCount = false,
  onPollCreate,
  textOnly = false,
}, ref) => {
  const [activePanel, setActivePanel] = useState(null); // 'emoji' | 'gif' | null
  const [attachedGif, setAttachedGif] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [attachMenu, setAttachMenu] = useState(false);
  const textRef = useRef(null);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);

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

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    // Upload files to IPFS and return content parts array.
    // IMPORTANT: This uploads files UNENCRYPTED to IPFS. Only use in PUBLIC contexts
    // (feed, rooms, walkie-talkie). For PRIVATE/encrypted contexts (DMs, Vault),
    // files MUST be ECIES-encrypted BEFORE uploading — see VaultPage.uploadFileToVault.
    async getContentParts() {
      const parts = [];
      if (text.trim()) parts.push(text.trim());
      if (attachedGif) parts.push(`<<${attachedGif.ref}>>`);
      for (const f of attachedFiles) {
        if (!f._file) continue;
        const formData = new FormData();
        formData.append('file', f._file, f.name);
        const res = await fetch(`${API}/ipfs/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`IPFS upload failed for ${f.name}`);
        const { cid } = await res.json();
        parts.push(`<<IPFS:${cid}/${f.name}>>`);
      }
      return parts;
    },
    hasAttachments() {
      return !!attachedGif || attachedFiles.length > 0;
    },
    clearAll() {
      setText('');
      setAttachedGif(null);
      setAttachedFiles([]);
      setActivePanel(null);
    },
    focusInput() {
      textRef.current?.focus();
    },
  }));

  // ─── Mic Recording ─────────────────────────────────────────
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
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error('Microphone access denied'); }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    clearInterval(timerRef.current);
    setRecording(false);
  };

  // ─── File Attach ───────────────────────────────────────────
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = files.map(f => ({
      name: f.name, type: f.type, _file: f,
      previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null,
    }));
    setAttachedFiles(prev => [...prev, ...previews]);
    if (e.target) e.target.value = '';
  };

  const removeFile = (idx) => {
    setAttachedFiles(prev => {
      const n = [...prev];
      if (n[idx]?.previewUrl) URL.revokeObjectURL(n[idx].previewUrl);
      n.splice(idx, 1);
      return n;
    });
  };

  useEffect(() => {
    return () => { attachedFiles.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); };
  }, []); // eslint-disable-line

  const onEmojiClick = useCallback((emojiData) => {
    setText(prev => prev + emojiData.emoji);
    textRef.current?.focus();
  }, [setText]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onKeySubmit?.();
    }
  };

  const hasAttachments = !!attachedGif || attachedFiles.length > 0;

  const colorMap = {
    purple: { btn: 'bg-purple-600/80 hover:bg-purple-600', focus: 'focus:border-purple-600/50' },
    emerald: { btn: 'bg-emerald-600/80 hover:bg-emerald-600', focus: 'focus:border-emerald-600/50' },
    red: { btn: 'bg-red-600/80 hover:bg-red-600', focus: 'focus:border-red-600/50' },
    teal: { btn: 'bg-teal-600/80 hover:bg-teal-600', focus: 'focus:border-teal-600/50' },
  };
  const colors = colorMap[accentColor] || colorMap.purple;

  return (
    <div data-testid={`${testIdPrefix}-toolbar-wrapper`}>
      {/* ─── Combined Emoji / GIF Panel ─── */}
      {(activePanel === 'emoji' || activePanel === 'gif') && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setActivePanel(null)} />
          <div className="relative z-50 border-t border-gray-800/50 bg-gray-900/80" data-testid={`${testIdPrefix}-emoji-gif-panel`}>
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
              <div className="flex gap-1">
                <button
                  onClick={() => setActivePanel('emoji')}
                  className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'emoji' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}
                  data-testid={`${testIdPrefix}-tab-emoji`}
                >Emoji</button>
                <button
                  onClick={() => setActivePanel('gif')}
                  className={`px-3 py-1 rounded-full text-[10px] font-semibold transition-colors ${activePanel === 'gif' ? 'bg-teal-900/50 text-teal-300' : 'text-gray-500 hover:text-gray-300'}`}
                  data-testid={`${testIdPrefix}-tab-gif`}
                >GIF</button>
              </div>
              <button onClick={() => setActivePanel(null)} className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
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
        </>
      )}

      {/* ─── Attachment Previews ─── */}
      {hasAttachments && (
        <div className="px-3 py-2 flex flex-wrap gap-2 border-t border-gray-800/30" data-testid={`${testIdPrefix}-preview-area`}>
          {attachedGif && (
            <div className="relative group">
              <img src={attachedGif.url} alt="" className="h-16 rounded-lg border border-gray-700/40 object-cover" />
              <button onClick={() => setAttachedGif(null)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors">
                <FiX size={8} />
              </button>
            </div>
          )}
          {attachedFiles.map((f, i) => (
            <div key={i} className="relative group" data-testid={`${testIdPrefix}-file-preview-${i}`}>
              {f.previewUrl && f.type?.startsWith('image/') ? (
                <img src={f.previewUrl} alt={f.name} className="h-16 rounded-lg border border-gray-700/40 object-cover" />
              ) : f.isVoice || f.type?.startsWith('audio/') ? (
                <div className="h-16 w-36 rounded-lg border border-gray-700/40 bg-gray-800 flex flex-col items-center justify-center px-2 gap-0.5">
                  <FiMic size={12} className="text-teal-400" />
                  <audio src={f.previewUrl} controls className="w-full h-5" style={{ filter: 'invert(1) hue-rotate(180deg)', opacity: 0.7 }} />
                  <span className="text-[7px] text-gray-500">{f.name}</span>
                </div>
              ) : f.previewUrl && f.type?.startsWith('video/') ? (
                <video src={f.previewUrl} className="h-16 rounded-lg border border-gray-700/40" muted />
              ) : (
                <div className="h-16 w-16 rounded-lg border border-gray-700/40 bg-gray-800 flex flex-col items-center justify-center px-1">
                  <FiPaperclip size={14} className="text-gray-500 mb-0.5" />
                  <span className="text-[7px] text-gray-500 truncate w-full text-center">{f.name}</span>
                </div>
              )}
              <button onClick={() => removeFile(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-gray-900 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors">
                <FiX size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─── Recording Indicator ─── */}
      {recording && (
        <div className="px-3 py-1.5 flex items-center gap-2 border-t border-gray-800/30" data-testid={`${testIdPrefix}-recording`}>
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] text-red-400 font-mono tabular-nums">{recordingTime}s</span>
          <span className="text-[10px] text-gray-500">Recording... tap mic to stop</span>
        </div>
      )}

      {/* ─── Input Row ─── */}
      <div className="flex items-end gap-2">
        {/* Toolbar: 2 buttons only */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Button 1: Emoji / GIF (combined) */}
          <TbBtn active={activePanel === 'emoji' || activePanel === 'gif' || !!attachedGif} onClick={() => togglePanel(activePanel === 'gif' ? 'gif' : 'emoji')} testId={`${testIdPrefix}-emoji`} title="Emoji & GIF">
            <FiSmile size={15} />
          </TbBtn>

          {/* Button 2: Attach menu (mic, file, poll) */}
          {!textOnly && (
            <div className="relative" ref={attachMenuRef}>
              <TbBtn active={attachMenu || recording} onClick={() => { if (recording) { stopRecording(); } else { setAttachMenu(prev => !prev); setActivePanel(null); } }} testId={`${testIdPrefix}-attach-menu-btn`} title="Attach" danger={recording}>
                {recording ? <FiMic size={15} /> : <FiPaperclip size={15} />}
              </TbBtn>
              {attachMenu && !recording && (
                <div className="absolute bottom-9 left-0 z-50 bg-gray-800 border border-gray-700/60 rounded-xl shadow-xl py-1.5 min-w-[140px] animate-in fade-in slide-in-from-bottom-2 duration-150" data-testid={`${testIdPrefix}-attach-popup`}>
                  <button
                    onClick={() => { setAttachMenu(false); recording ? stopRecording() : startRecording(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
                    data-testid={`${testIdPrefix}-mic`}
                  >
                    <FiMic size={14} className="text-teal-400" />
                    <span>Voice</span>
                  </button>
                  <button
                    onClick={() => { setAttachMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
                    data-testid={`${testIdPrefix}-attach`}
                  >
                    <FiPaperclip size={14} className="text-purple-400" />
                    <span>File</span>
                  </button>
                  {onPollCreate && (
                    <button
                      onClick={() => { setAttachMenu(false); onPollCreate(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700/50 transition-colors"
                      data-testid={`${testIdPrefix}-poll`}
                    >
                      <FiBarChart2 size={14} className="text-amber-400" />
                      <span>Poll</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!textOnly && <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.gif,.pdf,.zip,.txt,.doc,.docx" multiple className="hidden" onChange={handleFileSelect} data-testid={`${testIdPrefix}-file-input`} />}
        </div>

        {/* Textarea */}
        <textarea
          ref={textRef}
          value={text}
          onChange={e => setText(maxChars ? e.target.value.slice(0, maxChars) : e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || sending}
          className={`flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none ${colors.focus} resize-none max-h-28`}
          style={{ minHeight: '40px' }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 112) + 'px'; }}
          data-testid={`${testIdPrefix}-input`}
        />

        {/* Char count + Send */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {showCharCount && maxChars > 0 && text.length > 0 && (
            <span className={`text-[9px] tabular-nums ${text.length > maxChars * 0.9 ? 'text-amber-400' : 'text-gray-600'}`}>
              {text.length}/{maxChars}
            </span>
          )}
          <button
            onClick={onKeySubmit}
            disabled={(!text.trim() && !hasAttachments) || sending || disabled}
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-white ${colors.btn} transition-colors flex-shrink-0 disabled:opacity-30`}
            data-testid={`${testIdPrefix}-send`}
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <FiSend size={15} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

ComposeToolbar.displayName = 'ComposeToolbar';

const TbBtn = ({ children, active, onClick, testId, title, accent, danger }) => (
  <button onClick={onClick} title={title}
    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
      danger ? 'bg-red-600/20 text-red-400 ring-1 ring-red-500/50'
        : active ? (accent ? 'bg-teal-900/40 text-teal-300' : 'bg-gray-700/50 text-gray-200')
        : accent ? 'text-teal-500 hover:bg-teal-900/20' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
    }`}
    data-testid={testId}>
    {children}
  </button>
);

export default ComposeToolbar;
