/**
 * PhoneDialer — Fallout-themed phone overlay for the Walkie-Talkie.
 * Features:
 *   - Contact list from follows/known users (with key status)
 *   - Microphone verification
 *   - Dial/Call button that initiates an encrypted walkie to the selected contact
 *   - Answering machine detection (checks recipient's call-settings before calling)
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FiPhone, FiPhoneOff, FiMic, FiMicOff, FiVideo, FiX, FiSearch, FiLock, FiAlertTriangle, FiVoicemail } from 'react-icons/fi';
import { toast } from 'sonner';
import { startBusyTone, stopBusyTone, playVoicemailBeep, stopAllTones } from '@/utils/callTones';

const API = process.env.REACT_APP_BACKEND_URL;

function resolveImageUrl(ref) {
  if (!ref) return null;
  if (ref.startsWith('http')) return ref;
  const upper = (ref || '').toUpperCase();
  if (upper.startsWith('IPFS:')) {
    const path = ref.slice(5).replace(/\\/g, '/');
    const parts = path.split('/');
    const cid = parts[0];
    if (parts.length > 1) return `https://ipfs.io/ipfs/${cid}/${encodeURIComponent(parts.slice(1).join('/'))}`;
    return `https://ipfs.io/ipfs/${cid}`;
  }
  if (/^Qm[a-zA-Z0-9]{44}/.test(ref) || /^bafy/.test(ref)) return `https://ipfs.io/ipfs/${ref}`;
  return null;
}

export default function PhoneDialer({
  isOpen,
  onClose,
  contacts,       // Array of { address, urn, image, hasKeys }
  userAddress,
  network,
  wif,            // needed for sending voicemail DM
  onCall,          // (contact, callType) => void — triggers the encrypted walkie transmission
  onSendVoicemail, // (contact, blob) => void — send voicemail as encrypted DM
}) {
  const [search, setSearch] = useState('');
  const [micAvailable, setMicAvailable] = useState(null); // null=checking, true/false
  const [selectedContact, setSelectedContact] = useState(null);
  const [calling, setCalling] = useState(false);
  const [callState, setCallState] = useState('idle'); // idle, checking, ringing, connected, busy, answering_machine, vm_greeting, vm_recording, vm_sending, vm_sent
  const [recipientSettings, setRecipientSettings] = useState(null);
  const searchRef = useRef(null);

  // Voicemail recording
  const [vmRecording, setVmRecording] = useState(false);
  const [vmDuration, setVmDuration] = useState(0);
  const vmRecorderRef = useRef(null);
  const vmChunksRef = useRef([]);
  const vmTimerRef = useRef(null);

  // Check microphone on mount
  useEffect(() => {
    if (!isOpen) return;
    setMicAvailable(null);
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        stream.getTracks().forEach(t => t.stop());
        setMicAvailable(true);
      })
      .catch(() => setMicAvailable(false));
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) setTimeout(() => searchRef.current?.focus(), 200);
  }, [isOpen]);

  // Filter contacts
  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      (c.urn || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  // Check recipient's call settings before initiating
  const initiateCall = useCallback(async (contact, callType) => {
    setCallState('checking');
    setCalling(true);

    try {
      const res = await fetch(`${API}/api/call-settings/${contact.address}?network=${network}`);
      const settings = await res.json();
      setRecipientSettings(settings);

      if (!settings.accept_calls) {
        if (settings.answering_machine_enabled && settings.answering_machine_cid) {
          setCallState('answering_machine');
        } else {
          startBusyTone();
          setCallState('busy');
          setTimeout(() => { stopBusyTone(); setCalling(false); setCallState('idle'); setSelectedContact(null); }, 3000);
        }
        return;
      }

      // Recipient accepts calls — proceed
      setCallState('ringing');
      setTimeout(() => {
        setCallState('connected');
        onCall(contact, callType);
      }, 1500);
    } catch {
      // Can't check settings — proceed anyway
      setCallState('ringing');
      setTimeout(() => {
        setCallState('connected');
        onCall(contact, callType);
      }, 1500);
    }
  }, [network, onCall]);

  // Directly initiate call with a specific type from the contact row
  const startCall = useCallback((contact, callType) => {
    if (!micAvailable) { toast.error('Microphone not available'); return; }
    if (!contact.hasKeys) { toast.error('This user hasn\'t activated private messaging yet'); return; }
    setSelectedContact(contact);
    initiateCall(contact, callType);
  }, [micAvailable, initiateCall]);

  const hangUp = useCallback(() => {
    stopAllTones();
    // Stop any active VM recording
    if (vmRecorderRef.current?.state === 'recording') {
      vmRecorderRef.current.stop();
    }
    clearInterval(vmTimerRef.current);
    setCalling(false);
    setCallState('idle');
    setSelectedContact(null);
    setRecipientSettings(null);
    setVmRecording(false);
    setVmDuration(0);
  }, []);

  // Start voicemail recording
  const startVmRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      vmChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) vmChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(vmTimerRef.current);
        const blob = new Blob(vmChunksRef.current, { type: mimeType });
        setVmRecording(false);
        // Upload and send
        setCallState('vm_sending');
        try {
          if (onSendVoicemail && selectedContact) {
            await onSendVoicemail(selectedContact, blob);
          }
          setCallState('vm_sent');
          setTimeout(() => hangUp(), 2500);
        } catch (e) {
          toast.error(`Voicemail failed: ${e.message}`);
          hangUp();
        }
      };
      vmRecorderRef.current = recorder;
      recorder.start(100);
      setCallState('vm_recording');
      setVmRecording(true);
      setVmDuration(0);
      vmTimerRef.current = setInterval(() => setVmDuration(d => d + 1), 1000);

      // Auto-stop after max seconds
      const maxSec = recipientSettings?.answering_machine_max_seconds || 15;
      setTimeout(() => {
        if (vmRecorderRef.current?.state === 'recording') {
          vmRecorderRef.current.stop();
        }
      }, maxSec * 1000);
    } catch {
      toast.error('Microphone access denied');
      hangUp();
    }
  }, [recipientSettings, selectedContact, onSendVoicemail, hangUp]);

  // Stop voicemail recording
  const stopVmRecording = useCallback(() => {
    if (vmRecorderRef.current?.state === 'recording') {
      vmRecorderRef.current.stop();
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
         data-testid="phone-dialer-overlay">
      <div className="w-full max-w-sm mx-4 rounded-lg overflow-hidden"
           style={{
             background: '#0a1a0a',
             border: '2px solid #1a3a1a',
             boxShadow: '0 0 40px rgba(0,255,0,0.05), inset 0 0 60px rgba(0,0,0,0.5)',
           }}>
        {/* Scan lines overlay */}
        <div className="pointer-events-none absolute inset-0 z-10 rounded-lg"
             style={{ background: 'repeating-linear-gradient(0deg,transparent 0px,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)' }} />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-green-900/30">
          <div className="flex items-center gap-2">
            <FiPhone size={14} className="text-green-500" />
            <span className="text-xs font-mono tracking-[0.2em] text-green-400">PHONE</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mic status */}
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono ${
              micAvailable === null ? 'text-amber-500/60' :
              micAvailable ? 'text-green-500/80' : 'text-red-500/80'
            }`} data-testid="phone-mic-status">
              {micAvailable === null ? <FiMic size={10} className="animate-pulse" /> :
               micAvailable ? <FiMic size={10} /> : <FiMicOff size={10} />}
              {micAvailable === null ? 'CHECKING...' : micAvailable ? 'MIC OK' : 'NO MIC'}
            </div>
            <button onClick={onClose} className="text-green-700 hover:text-green-400 transition-colors"
                    data-testid="phone-close-btn">
              <FiX size={16} />
            </button>
          </div>
        </div>

        {/* Active Call State */}
        {calling && selectedContact ? (
          <div className="px-4 py-8 flex flex-col items-center gap-4" data-testid="phone-call-active">
            {/* Contact avatar */}
            <div className={`w-20 h-20 rounded-full overflow-hidden border-2 ${
              callState === 'ringing' ? 'border-green-500 animate-pulse' :
              callState === 'connected' ? 'border-green-400' :
              callState === 'busy' ? 'border-red-500' :
              callState === 'answering_machine' ? 'border-amber-500' :
              'border-green-900/50'
            }`}>
              {resolveImageUrl(selectedContact.image) ? (
                <img src={resolveImageUrl(selectedContact.image)} alt=""
                     className="w-full h-full object-cover"
                     style={{ filter: 'saturate(0.3) brightness(0.9) sepia(0.15)' }}
                     onError={e => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-green-950/50 text-green-600 text-xl font-mono">
                  {(selectedContact.urn || '?')[0].toUpperCase()}
                </div>
              )}
            </div>

            {/* Contact name */}
            <div className="text-center">
              <p className="text-sm font-mono text-green-400">{selectedContact.urn || selectedContact.address?.slice(0, 12)}</p>
              <p className={`text-[10px] font-mono mt-1 tracking-wider ${
                callState === 'checking' ? 'text-amber-500/60 animate-pulse' :
                callState === 'ringing' ? 'text-green-500 animate-pulse' :
                callState === 'connected' ? 'text-green-400' :
                callState === 'busy' ? 'text-red-400' :
                callState === 'answering_machine' ? 'text-amber-400' :
                'text-green-700/50'
              }`}>
                {callState === 'checking' && 'ESTABLISHING CONNECTION...'}
                {callState === 'ringing' && 'RINGING...'}
                {callState === 'connected' && 'HOLD PTT TO TRANSMIT'}
                {callState === 'busy' && 'LINE BUSY — NOT ACCEPTING CALLS'}
                {callState === 'answering_machine' && 'ANSWERING MACHINE'}
              </p>

              {/* Status message from recipient */}
              {recipientSettings?.status_message && callState !== 'idle' && (
                <p className="text-[9px] font-mono text-green-700/60 mt-2 italic max-w-[200px]">
                  "{recipientSettings.status_message}"
                </p>
              )}
            </div>

            {/* Answering machine flow */}
            {callState === 'answering_machine' && (
              <div className="text-center px-4">
                <FiVoicemail size={20} className="text-amber-400 mx-auto mb-2" />
                <p className="text-[9px] font-mono text-amber-500/80 mb-3">
                  ANSWERING MACHINE — MAX {recipientSettings?.answering_machine_max_seconds || 15}s
                </p>
                <button onClick={async () => {
                  // Play greeting from IPFS, then beep, then start recording
                  setCallState('vm_greeting');
                  try {
                    if (recipientSettings?.answering_machine_cid) {
                      const url = `https://ipfs.io/ipfs/${recipientSettings.answering_machine_cid}`;
                      const audio = new Audio(url);
                      audio.onended = () => {
                        playVoicemailBeep();
                        setTimeout(() => startVmRecording(), 600);
                      };
                      audio.onerror = () => {
                        playVoicemailBeep();
                        setTimeout(() => startVmRecording(), 600);
                      };
                      audio.play().catch(() => {
                        playVoicemailBeep();
                        setTimeout(() => startVmRecording(), 600);
                      });
                    } else {
                      playVoicemailBeep();
                      setTimeout(() => startVmRecording(), 600);
                    }
                  } catch {
                    playVoicemailBeep();
                    setTimeout(() => startVmRecording(), 600);
                  }
                }}
                  className="px-4 py-2 rounded border border-amber-600/40 bg-amber-950/30 text-amber-400 text-[10px] font-mono tracking-wider hover:bg-amber-900/30 transition-all"
                  data-testid="phone-leave-message-btn">
                  LEAVE A MESSAGE
                </button>
              </div>
            )}

            {/* Greeting playing */}
            {callState === 'vm_greeting' && (
              <div className="text-center px-4">
                <FiVoicemail size={20} className="text-amber-400 mx-auto mb-2 animate-pulse" />
                <p className="text-[10px] font-mono text-amber-400 animate-pulse">
                  PLAYING GREETING...
                </p>
              </div>
            )}

            {/* Recording voicemail */}
            {callState === 'vm_recording' && (
              <div className="text-center px-4">
                <div className="w-12 h-12 rounded-full bg-red-900/40 border-2 border-red-500/60 mx-auto mb-2 flex items-center justify-center animate-pulse">
                  <FiMic size={20} className="text-red-400" />
                </div>
                <p className="text-lg font-mono text-red-400 tabular-nums mb-1">
                  {String(Math.floor(vmDuration / 60)).padStart(2, '0')}:{String(vmDuration % 60).padStart(2, '0')}
                </p>
                <p className="text-[9px] font-mono text-red-500/60 mb-3">RECORDING...</p>
                <button onClick={stopVmRecording}
                  className="px-4 py-2 rounded border border-green-600/40 bg-green-950/30 text-green-400 text-[10px] font-mono tracking-wider hover:bg-green-900/30 transition-all"
                  data-testid="phone-stop-vm-btn">
                  SEND MESSAGE
                </button>
              </div>
            )}

            {/* Sending voicemail */}
            {callState === 'vm_sending' && (
              <div className="text-center px-4">
                <FiVoicemail size={20} className="text-amber-400 mx-auto mb-2 animate-spin" />
                <p className="text-[10px] font-mono text-amber-400 animate-pulse">
                  SENDING VOICEMAIL...
                </p>
              </div>
            )}

            {/* Voicemail sent */}
            {callState === 'vm_sent' && (
              <div className="text-center px-4">
                <FiVoicemail size={20} className="text-green-400 mx-auto mb-2" />
                <p className="text-[10px] font-mono text-green-400">
                  VOICEMAIL SENT
                </p>
                <p className="text-[8px] font-mono text-green-700/50 mt-1">
                  Message delivered to {selectedContact?.urn || 'contact'}
                </p>
              </div>
            )}

            {/* Hang up button */}
            <button onClick={hangUp}
              className="w-14 h-14 rounded-full bg-red-900/60 border-2 border-red-600/40 flex items-center justify-center hover:bg-red-800/60 transition-all mt-2"
              data-testid="phone-hangup-btn">
              <FiPhoneOff size={20} className="text-red-400" />
            </button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 border-b border-green-900/30 pb-2">
                <FiSearch size={12} className="text-green-700/50" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="SEARCH CONTACTS..."
                  className="flex-1 bg-transparent text-[10px] font-mono text-green-400 placeholder-green-800/40 focus:outline-none"
                  data-testid="phone-search-input"
                />
              </div>
            </div>

            {/* Contact List */}
            <div className="px-2 py-2 overflow-y-auto" style={{ maxHeight: 320 }}
                 data-testid="phone-contact-list">
              {filtered.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-green-800/50 text-[10px] font-mono">
                  {search ? 'NO CONTACTS FOUND' : 'NO CONTACTS WITH ENCRYPTION KEYS'}
                </div>
              ) : (
                filtered.map((contact, i) => (
                  <div
                    key={contact.address || i}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all mb-1 border ${
                      contact.hasKeys && micAvailable
                        ? 'border-green-900/20 hover:border-green-700/30 hover:bg-green-950/30'
                        : 'border-green-900/10 opacity-40'
                    }`}
                    data-testid={`phone-contact-${contact.urn || contact.address?.slice(0, 8)}`}>
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full overflow-hidden border border-green-900/30 flex-shrink-0 bg-black/50">
                      {resolveImageUrl(contact.image) ? (
                        <img src={resolveImageUrl(contact.image)} alt=""
                             className="w-full h-full object-cover"
                             style={{ filter: 'saturate(0.3) brightness(0.9) sepia(0.15)' }}
                             onError={e => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-green-700 text-[10px] font-mono">
                          {(contact.urn || '?')[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-[10px] font-mono text-green-400 truncate">
                        {contact.urn || `${contact.address?.slice(0, 12)}...`}
                      </p>
                      <p className="text-[8px] font-mono text-green-700/50 truncate">
                        {contact.address?.slice(0, 16)}...
                      </p>
                    </div>
                    {/* Call action buttons */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {contact.hasKeys ? (
                        <FiLock size={9} className="text-green-600/40 mr-0.5" />
                      ) : (
                        <FiAlertTriangle size={9} className="text-amber-600/60 mr-0.5" />
                      )}
                      {/* Audio call button */}
                      <button
                        onClick={() => startCall(contact, 'audio')}
                        disabled={!contact.hasKeys || !micAvailable}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${
                          contact.hasKeys && micAvailable
                            ? 'border-green-700/40 bg-green-950/30 hover:bg-green-900/50 hover:border-green-500/50 cursor-pointer'
                            : 'border-green-900/20 bg-transparent cursor-not-allowed'
                        }`}
                        title="Audio Call"
                        data-testid={`phone-audio-${contact.urn || contact.address?.slice(0, 8)}`}>
                        <FiPhone size={13} className={contact.hasKeys ? 'text-green-500' : 'text-green-900/30'} />
                      </button>
                      {/* Video call button */}
                      <button
                        onClick={() => startCall(contact, 'video')}
                        disabled={!contact.hasKeys || !micAvailable}
                        className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${
                          contact.hasKeys && micAvailable
                            ? 'border-green-700/40 bg-green-950/30 hover:bg-green-900/50 hover:border-green-500/50 cursor-pointer'
                            : 'border-green-900/20 bg-transparent cursor-not-allowed'
                        }`}
                        title="Video Call"
                        data-testid={`phone-video-${contact.urn || contact.address?.slice(0, 8)}`}>
                        <FiVideo size={13} className={contact.hasKeys ? 'text-green-500' : 'text-green-900/30'} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-green-900/20">
              <p className="text-[8px] font-mono text-green-800/40 text-center">
                {micAvailable === false
                  ? 'MICROPHONE REQUIRED — GRANT PERMISSION IN BROWSER SETTINGS'
                  : `${filtered.filter(c => c.hasKeys).length} CONTACTS AVAILABLE`
                }
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
