/**
 * CallSettings — Phone/call preferences panel for the settings page.
 * Features:
 *   - Toggle accept incoming calls
 *   - Enable/disable answering machine
 *   - Record answering machine greeting
 *   - Set status message
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiPhone, FiPhoneOff, FiMic, FiPlay, FiSquare, FiTrash2, FiSave } from 'react-icons/fi';
import { toast } from 'sonner';

const API = process.env.REACT_APP_BACKEND_URL;

export default function CallSettings({ userAddress, network }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Recording state for answering machine greeting
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  // Fetch settings
  useEffect(() => {
    if (!userAddress) return;
    setLoading(true);
    fetch(`${API}/api/call-settings/${userAddress}?network=${network}`)
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        setStatusMessage(data.status_message || '');
      })
      .catch(() => setSettings({
        accept_calls: true,
        answering_machine_enabled: false,
        answering_machine_cid: null,
        answering_machine_max_seconds: 15,
        status_message: null,
      }))
      .finally(() => setLoading(false));
  }, [userAddress, network]);

  // Save settings
  const save = useCallback(async (overrides = {}) => {
    if (!userAddress || !settings) return;
    setSaving(true);
    try {
      const body = {
        address: userAddress,
        network,
        accept_calls: settings.accept_calls,
        answering_machine_enabled: settings.answering_machine_enabled,
        answering_machine_cid: settings.answering_machine_cid,
        answering_machine_max_seconds: settings.answering_machine_max_seconds,
        status_message: statusMessage || null,
        ...overrides,
      };
      const res = await fetch(`${API}/api/call-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(prev => ({ ...prev, ...data }));
        toast.success('Call settings saved');
      }
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [userAddress, network, settings, statusMessage]);

  // Toggle accept calls
  const toggleAcceptCalls = useCallback(() => {
    setSettings(prev => {
      const next = { ...prev, accept_calls: !prev.accept_calls };
      // Auto-save
      setTimeout(() => save({ accept_calls: next.accept_calls }), 0);
      return next;
    });
  }, [save]);

  // Toggle answering machine
  const toggleAnsweringMachine = useCallback(() => {
    setSettings(prev => {
      const next = { ...prev, answering_machine_enabled: !prev.answering_machine_enabled };
      setTimeout(() => save({ answering_machine_enabled: next.answering_machine_enabled }), 0);
      return next;
    });
  }, [save]);

  // Record greeting
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach(t => t.stop());
        setRecordingBlob(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);

      // Auto-stop after max seconds
      const maxSec = settings?.answering_machine_max_seconds || 15;
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
        }
      }, maxSec * 1000);
    } catch {
      toast.error('Microphone access denied');
    }
  }, [settings]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  // Play back recording
  const playRecording = useCallback(() => {
    if (!recordingBlob) return;
    const url = URL.createObjectURL(recordingBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { setIsPlaying(false); URL.revokeObjectURL(url); };
    audio.play();
    setIsPlaying(true);
  }, [recordingBlob]);

  // Upload greeting and save CID
  const saveGreeting = useCallback(async () => {
    if (!recordingBlob) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', recordingBlob, 'greeting.webm');
      const uploadRes = await fetch(`${API}/api/ipfs/upload`, { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { cid } = await uploadRes.json();
      await save({ answering_machine_cid: cid });
      setRecordingBlob(null);
      toast.success('Greeting saved to IPFS');
    } catch (e) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [recordingBlob, save]);

  if (loading || !settings) {
    return (
      <div className="text-center py-4 text-green-700/50 text-[10px] font-mono animate-pulse">
        LOADING CALL SETTINGS...
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="call-settings-panel">
      {/* Accept Calls Toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg border border-green-900/20 bg-black/20">
        <div className="flex items-center gap-2">
          {settings.accept_calls
            ? <FiPhone size={14} className="text-green-500" />
            : <FiPhoneOff size={14} className="text-red-500" />
          }
          <div>
            <p className="text-[10px] font-mono text-green-400">INCOMING CALLS</p>
            <p className="text-[8px] font-mono text-green-700/50">
              {settings.accept_calls ? 'Accepting calls from contacts' : 'All incoming calls blocked'}
            </p>
          </div>
        </div>
        <button onClick={toggleAcceptCalls}
          className={`w-12 h-6 rounded-full transition-all relative ${
            settings.accept_calls ? 'bg-green-800/60' : 'bg-red-900/40'
          }`}
          data-testid="call-toggle-accept">
          <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${
            settings.accept_calls
              ? 'left-6 bg-green-400 shadow-green-400/30 shadow-sm'
              : 'left-0.5 bg-red-500 shadow-red-500/30 shadow-sm'
          }`} />
        </button>
      </div>

      {/* Answering Machine Toggle */}
      <div className={`p-3 rounded-lg border transition-all ${
        !settings.accept_calls ? 'border-amber-900/30 bg-amber-950/10' : 'border-green-900/10 bg-black/10 opacity-50'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FiMic size={14} className={settings.answering_machine_enabled && !settings.accept_calls ? 'text-amber-400' : 'text-green-700/40'} />
            <div>
              <p className="text-[10px] font-mono text-green-400">ANSWERING MACHINE</p>
              <p className="text-[8px] font-mono text-green-700/50">
                {settings.accept_calls
                  ? 'Disable incoming calls first'
                  : settings.answering_machine_enabled
                    ? 'Callers can leave a message'
                    : 'Off — callers get busy signal'}
              </p>
            </div>
          </div>
          <button onClick={toggleAnsweringMachine}
            disabled={settings.accept_calls}
            className={`w-12 h-6 rounded-full transition-all relative ${
              settings.answering_machine_enabled && !settings.accept_calls ? 'bg-amber-800/60' : 'bg-green-950/30'
            }`}
            data-testid="call-toggle-answering-machine">
            <div className={`absolute top-0.5 w-5 h-5 rounded-full transition-all ${
              settings.answering_machine_enabled && !settings.accept_calls
                ? 'left-6 bg-amber-400 shadow-amber-400/30 shadow-sm'
                : 'left-0.5 bg-green-700/40'
            }`} />
          </button>
        </div>

        {/* Record Greeting */}
        {settings.answering_machine_enabled && !settings.accept_calls && (
          <div className="mt-3 pt-3 border-t border-amber-900/20">
            <p className="text-[9px] font-mono text-amber-500/60 mb-2">GREETING MESSAGE</p>
            <div className="flex items-center gap-2">
              {isRecording ? (
                <button onClick={stopRecording}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border border-red-600/40 bg-red-950/30 text-red-400 text-[9px] font-mono animate-pulse"
                  data-testid="call-stop-recording">
                  <FiSquare size={10} /> STOP
                </button>
              ) : (
                <button onClick={startRecording}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border border-amber-600/30 bg-amber-950/20 text-amber-400 text-[9px] font-mono hover:bg-amber-900/20 transition-all"
                  data-testid="call-start-recording">
                  <FiMic size={10} /> RECORD
                </button>
              )}
              {recordingBlob && (
                <>
                  <button onClick={playRecording} disabled={isPlaying}
                    className="flex items-center gap-1 px-2 py-1.5 rounded border border-green-900/30 text-green-500 text-[9px] font-mono hover:text-green-400 transition-all"
                    data-testid="call-play-greeting">
                    <FiPlay size={10} /> PLAY
                  </button>
                  <button onClick={saveGreeting} disabled={saving}
                    className="flex items-center gap-1 px-2 py-1.5 rounded border border-green-600/30 bg-green-950/20 text-green-400 text-[9px] font-mono hover:bg-green-900/20 transition-all"
                    data-testid="call-save-greeting">
                    <FiSave size={10} /> {saving ? 'SAVING...' : 'SAVE'}
                  </button>
                  <button onClick={() => setRecordingBlob(null)}
                    className="px-2 py-1.5 rounded text-red-600/60 hover:text-red-400 transition-all"
                    data-testid="call-discard-greeting">
                    <FiTrash2 size={10} />
                  </button>
                </>
              )}
            </div>
            {settings.answering_machine_cid && !recordingBlob && (
              <p className="text-[8px] font-mono text-green-700/40 mt-2">
                GREETING: IPFS:{settings.answering_machine_cid.slice(0, 12)}...
              </p>
            )}
          </div>
        )}
      </div>

      {/* Status Message */}
      <div className="p-3 rounded-lg border border-green-900/20 bg-black/20">
        <p className="text-[10px] font-mono text-green-400 mb-2">STATUS MESSAGE</p>
        <p className="text-[8px] font-mono text-green-700/50 mb-2">Shown to callers when you're unavailable</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={statusMessage}
            onChange={e => setStatusMessage(e.target.value)}
            maxLength={100}
            placeholder="Away from the wasteland..."
            className="flex-1 bg-black/30 border border-green-900/20 rounded px-2 py-1.5 text-[10px] font-mono text-green-400 placeholder-green-800/30 focus:outline-none focus:border-green-700/40"
            data-testid="call-status-message"
          />
          <button onClick={() => save()}
            disabled={saving}
            className="px-3 py-1.5 rounded border border-green-600/30 bg-green-950/20 text-green-400 text-[9px] font-mono hover:bg-green-900/20 transition-all"
            data-testid="call-save-status">
            {saving ? '...' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  );
}
