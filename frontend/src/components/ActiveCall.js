/**
 * ActiveCall — Inline WebRTC P2P call component (audio + video).
 * Renders inside the Viewscreen area, not as a modal overlay.
 * Supports video calls with local/remote video streams, fullscreen,
 * and camera/mic toggles. Falls back gracefully to audio-only.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FiPhoneOff, FiMic, FiMicOff, FiVideo, FiVideoOff,
  FiMaximize, FiMinimize, FiWifi, FiAlertTriangle,
} from 'react-icons/fi';
import {
  createMediaConnection,
  createOffer,
  createAnswer,
  applyAnswer,
  broadcastRing,
  broadcastAnswer,
  createCallMonitor,
  decryptCallSignal,
  cleanupCall,
  sdpHasVideo,
} from '@/utils/webrtcPhone';
import { callLog } from '@/utils/callDebugLog';
import { createMeshPhone } from '@/utils/meshPhone';
import {
  startDialingTone, stopDialingTone,
  playConnectedTone, playHangupTone,
  stopAllTones,
} from '@/utils/callTones';
import { startAudioSender, createAudioReceiver } from '@/utils/meshAudioRelay';

function resolveImageUrl(ref) {
  if (!ref) return null;
  if (ref.startsWith('http')) return ref;
  const upper = (ref || '').toUpperCase();
  if (upper.startsWith('IPFS:')) {
    const path = ref.slice(5).replace(/\\/g, '/');
    const parts = path.split('/');
    return `https://ipfs.io/ipfs/${parts[0]}${parts.length > 1 ? '/' + encodeURIComponent(parts.slice(1).join('/')) : ''}`;
  }
  if (/^Qm[a-zA-Z0-9]{44}/.test(ref) || /^bafy/.test(ref)) return `https://ipfs.io/ipfs/${ref}`;
  return null;
}

export default function ActiveCall({
  contact,
  wif,
  userAddress,
  userPKX,
  userPKY,
  userImage,
  network,
  privateKeyBytes,
  onEnd,
  isIncoming,
  incomingSignal,
  callType = 'audio', // 'audio' or 'video'
  pendingIceCandidates, // ref with buffered ICE candidates from page transition
}) {
  const [callState, setCallState] = useState(isIncoming ? 'answering' : 'initiating');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasVideo, setHasVideo] = useState(callType === 'video');
  const [permError, setPermError] = useState(null); // 'mic' | 'camera' | null

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const monitorRef = useRef(null);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const hungUpRef = useRef(false);
  const startedRef = useRef(false);
  const containerRef = useRef(null);
  const meshPhoneRef = useRef(null);
  const viaMeshRef = useRef(false);
  const meshRelaySenderStopRef = useRef(null);
  const meshRelayReceiverRef = useRef(null);
  const answerAppliedRef = useRef(false);
  const [connectionRoute, setConnectionRoute] = useState(''); // visual route indicator

  // Audible tone management based on call state
  useEffect(() => {
    if (callState === 'waiting' || callState === 'broadcasting') {
      startDialingTone();
    } else {
      stopDialingTone();
    }
    if (callState === 'connected' || callState === 'mesh-relay') {
      playConnectedTone();
    }
    if (callState === 'ended') {
      stopAllTones();
      playHangupTone();
    }
    return () => stopAllTones();
  }, [callState]);

  // ── Mesh Relay Fallback ─────────────────────────────────────────
  const startMeshRelayFallback = useCallback(() => {
    const meshPhone = meshPhoneRef.current;
    const localStream = localStreamRef.current;
    const targetAddr = contact.address;

    if (!meshPhone?.isConnected) {
      callLog('ERROR', 'MESH NOT CONNECTED — CANNOT RELAY');
      hangUp();
      return;
    }

    callLog('RELAY', 'SWITCHING TO MESH RELAY MODE...');
    setCallState('mesh-relay');

    // Start sending our audio through mesh
    if (localStream) {
      const stopSender = startAudioSender(localStream, meshPhone, targetAddr, callLog);
      meshRelaySenderStopRef.current = stopSender;
    }

    // Set up receiver for incoming audio chunks
    const receiver = createAudioReceiver(callLog);
    meshRelayReceiverRef.current = receiver;

    meshPhone.setOnAudioRelay(({ chunk, seq }) => {
      if (chunk && receiver) {
        receiver.feedChunk(chunk);
      }
    });

    callLog('RELAY', 'MESH RELAY ACTIVE — AUDIO ROUTED THROUGH RELAY NODE');
    setCallState('connected');
    setConnectionRoute('mesh-relay');
  }, [contact]);

  // Connection state polling — with mesh relay fallback
  useEffect(() => {
    const check = () => {
      const pc = pcRef.current;
      if (!pc || hungUpRef.current) return;
      const state = pc.connectionState;
      if (state === 'connected') {
        setCallState(prev => {
          if (prev !== 'connected') {
            callLog('ICE', 'P2P DIRECT LINK ESTABLISHED');
            setConnectionRoute('direct');
          }
          return 'connected';
        });
      } else if (state === 'failed') {
        // Don't hang up — try mesh relay fallback
        setCallState(prev => {
          if (prev !== 'connected' && prev !== 'mesh-relay') {
            callLog('ICE', 'DIRECT LINK FAILED — ATTEMPTING MESH RELAY...');
            setConnectionRoute('mesh-relay');
            startMeshRelayFallback();
          }
          return prev;
        });
      }
    };
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [startMeshRelayFallback]);

  // Duration timer
  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [callState]);

  // ── Mesh Phone lifecycle ──────────────────────────────────────
  useEffect(() => {
    if (!userAddress || !network) return;

    const phone = createMeshPhone(userAddress, network);

    // Wire up mesh callbacks for receiving signals during a call
    phone.setOnAnswer(({ from, sdp }) => {
      callLog('MESH', `ANSWER VIA MESH FROM ${from?.slice(0, 12)}`);
      if (answerAppliedRef.current) {
        callLog('WARN', 'DUPLICATE MESH ANSWER IGNORED');
        return;
      }
      const pc = pcRef.current;
      if (pc && sdp) {
        answerAppliedRef.current = true;
        applyAnswer(pc, sdp).then(() => {
          callLog('SDP', 'MESH ANSWER APPLIED');
          setCallState('connecting');
        }).catch(e => {
          callLog('ERROR', `MESH ANSWER FAILED: ${e.message}`);
          answerAppliedRef.current = false;
        });
      }
    });

    phone.setOnIce(({ from, candidate }) => {
      const pc = pcRef.current;
      if (pc && candidate) {
        try { pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    phone.setOnDecline(({ from, reason }) => {
      callLog('MESH', `CALL DECLINED BY ${from?.slice(0, 12)}: ${reason || 'no reason'}`);
      hangUp();
    });

    phone.connect();
    meshPhoneRef.current = phone;

    // Replay any ICE candidates buffered during the page transition
    if (pendingIceCandidates?.current?.length > 0) {
      const buffered = pendingIceCandidates.current.splice(0);
      callLog('ICE', `REPLAYING ${buffered.length} BUFFERED ICE CANDIDATES`);
      // Delay replay slightly to ensure PeerConnection is ready
      setTimeout(() => {
        const pc = pcRef.current;
        if (pc) {
          for (const { candidate } of buffered) {
            try { pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
          }
        }
      }, 500);
    }

    return () => { phone.disconnect(); meshPhoneRef.current = null; };
  }, [userAddress, network]);

  // Audio level monitoring
  const startAudioLevel = useCallback((stream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = { ctx, analyser };
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(100, avg * 2));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* AudioContext not available */ }
  }, []);

  // Setup remote stream (audio + video)
  const setupRemoteStream = useCallback((pc) => {
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      callLog('INFO', `REMOTE TRACK: kind=${event.track.kind}`);

      if (event.track.kind === 'video') {
        setHasVideo(true);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
          callLog('INFO', 'REMOTE VIDEO STREAM ATTACHED');
        }
      }
      if (event.track.kind === 'audio') {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
          callLog('INFO', 'REMOTE AUDIO STREAM ATTACHED');
        }
        startAudioLevel(stream);
      }
    };
  }, [startAudioLevel]);

  // Attach local video preview
  const attachLocalVideo = useCallback((stream) => {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(() => {});
    }
  }, []);

  // ── OUTGOING CALL ────────────────────────────────────────────────
  const initiateOutgoingCall = useCallback(async () => {
    const target = contact.urn || contact.address?.slice(0, 12);
    const isVideo = callType === 'video';
    callLog('INFO', '═══════════════════════════════════════');
    callLog('INFO', `OUTGOING ${isVideo ? 'VIDEO' : 'AUDIO'} CALL TO @${target}`, { address: contact.address, network });

    try {
      setCallState('initiating');
      answerAppliedRef.current = false;
      callLog('INFO', `REQUESTING ${isVideo ? 'CAMERA + MICROPHONE' : 'MICROPHONE'} ACCESS...`);
      let pc, localStream;
      try {
        const conn = await createMediaConnection({ video: isVideo });
        pc = conn.pc;
        localStream = conn.localStream;
      } catch (err) {
        const msg = err.message || err.name || '';
        if (msg.includes('Permission denied') || msg.includes('NotAllowedError') || err.name === 'NotAllowedError') {
          setPermError(isVideo ? 'camera' : 'mic');
          callLog('ERROR', `${isVideo ? 'CAMERA/MIC' : 'MICROPHONE'} ACCESS DENIED`);
        } else {
          callLog('ERROR', `MEDIA ERROR: ${msg}`);
        }
        setCallState('ended');
        return;
      }
      pcRef.current = pc;
      localStreamRef.current = localStream;
      setupRemoteStream(pc);
      if (isVideo) attachLocalVideo(localStream);
      callLog('INFO', `MEDIA ACQUIRED — audio:${localStream.getAudioTracks().length} video:${localStream.getVideoTracks().length}`);

      callLog('SDP', 'CREATING SDP OFFER...');
      const offerSDP = await createOffer(pc);
      callLog('SDP', `OFFER READY — ${offerSDP.length} bytes`);

      // Log ICE candidates for debugging
      const candidateCount = (offerSDP.match(/a=candidate/g) || []).length;
      const hasRelay = offerSDP.includes('relay');
      callLog('ICE', `OFFER HAS ${candidateCount} CANDIDATES (relay: ${hasRelay})`);

      // ── MESH-FIRST SIGNALING ────────────────────────────────────
      const meshPhone = meshPhoneRef.current;
      let sentViaMesh = false;

      if (meshPhone) {
        callLog('MESH', 'CHECKING IF TARGET IS ON MESH...');
        const onMesh = await meshPhone.isTargetOnMesh(contact.address);
        if (onMesh) {
          callLog('MESH', 'TARGET ONLINE — SENDING RING VIA MESH (free, instant)');
          sentViaMesh = meshPhone.sendRing(contact.address, offerSDP, {
            urn: contact.callerUrn || userAddress?.slice(0, 12),
            address: userAddress,
            image: userImage || null,
          }, isVideo);
          if (sentViaMesh) {
            viaMeshRef.current = true;
            callLog('MESH', 'RING SENT VIA MESH — WAITING FOR ANSWER...');

            // Also set up trickle ICE over mesh
            pc.onicecandidate = (e) => {
              if (e.candidate && meshPhoneRef.current) {
                meshPhoneRef.current.sendIce(contact.address, e.candidate.toJSON());
              }
            };
          }
        } else {
          callLog('MESH', 'TARGET NOT ON MESH — FALLING BACK TO BLOCKCHAIN');
        }
      }

      // ── BLOCKCHAIN FALLBACK ─────────────────────────────────────
      if (!sentViaMesh) {
        setCallState('broadcasting');
        callLog('TX', 'ENCRYPTING AND BROADCASTING RING VIA BLOCKCHAIN...');
        const ringResult = await broadcastRing(
          contact.address, contact.pkx, contact.pky,
          offerSDP, wif, userAddress, userPKX, userPKY, network
        );
        callLog('TX', 'RING BROADCAST SUCCESS', { txid: ringResult?.txid });

        // Even with blockchain signaling, set up trickle ICE via mesh if available
        if (meshPhone) {
          pc.onicecandidate = (e) => {
            if (e.candidate && meshPhoneRef.current) {
              meshPhoneRef.current.sendIce(contact.address, e.candidate.toJSON());
            }
          };
        }
      }

      setCallState('waiting');

      // ── ANSWER MONITORING ───────────────────────────────────────
      // If via mesh, the meshPhone.setOnAnswer callback (in the useEffect above) handles it.
      // Always also monitor mempool as a dual-path safety net.
      callLog('INFO', `MONITORING FOR ANSWER VIA ${sentViaMesh ? 'MESH + ' : ''}MEMPOOL...`);
      const monitor = createCallMonitor(userAddress, network, async (signal) => {
        const signalAddrs = [signal.from, ...(signal.inputAddresses || [])];
        if (signalAddrs.includes(userAddress)) return;
        if (signal.type === 'ANSW') {
          // Guard: only apply the first answer — ignore duplicates/stale answers
          if (answerAppliedRef.current) {
            callLog('WARN', `DUPLICATE ANSW IGNORED (answer already applied) | txid=${signal.txid?.slice(0, 12)}`);
            return;
          }
          try {
            callLog('RX', 'ANSW DETECTED IN MEMPOOL — DECRYPTING...');
            const decrypted = await decryptCallSignal(signal, privateKeyBytes);
            if (decrypted?.type === 'ANSW') {
              callLog('SDP', `ANSW DECRYPTED — ${decrypted.sdp.length} bytes`);
              answerAppliedRef.current = true;
              await applyAnswer(pc, decrypted.sdp);
              setCallState('connecting');
              callLog('ICE', 'REMOTE SDP APPLIED — ICE IN PROGRESS');
            }
          } catch (e) {
            callLog('ERROR', `ANSW FAILED: ${e.message}`);
            // If apply failed, allow retry with next answer
            answerAppliedRef.current = false;
          }
        }
      });
      monitorRef.current = monitor;
      monitor.connect();

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        callLog('ICE', `CONNECTION: ${s.toUpperCase()}`);
        if (s === 'connected') {
          setCallState('connected');
          setConnectionRoute('direct');
          callLog('INFO', `DIRECT P2P ${isVideo ? 'VIDEO' : 'AUDIO'} LINK ESTABLISHED`);
        }
      };

      pc.oniceconnectionstatechange = () => {
        callLog('ICE', `ICE STATE: ${pc.iceConnectionState}`);
      };

      const thisPC = pc;
      setTimeout(() => {
        if (hungUpRef.current || pcRef.current !== thisPC || thisPC.connectionState === 'connected') return;
        callLog('WARN', 'NO ANSWER AFTER 90 SECONDS');
        hangUp();
      }, 90000);

    } catch (e) {
      callLog('ERROR', `OUTGOING CALL FAILED: ${e.message}`);
      setCallState('ended');
    }
  }, [contact, wif, userAddress, network, privateKeyBytes, callType, setupRemoteStream, attachLocalVideo]);

  // ── INCOMING CALL ────────────────────────────────────────────────
  const answerIncomingCall = useCallback(async () => {
    if (!incomingSignal) return;
    const caller = contact.urn || contact.address?.slice(0, 12);
    const incomingViaMesh = !!incomingSignal.viaMesh;
    callLog('INFO', '═══════════════════════════════════════');
    callLog('INFO', `INCOMING CALL FROM @${caller} VIA ${incomingViaMesh ? 'MESH' : 'BLOCKCHAIN'}`, { address: contact.address, network });

    try {
      setCallState('answering');

      let offerSDP, replyAddress, replyPKX, replyPKY, incomingVideo;

      if (incomingViaMesh) {
        // Mesh call — SDP is already plaintext in the signal
        offerSDP = incomingSignal.sdp;
        if (!offerSDP) { callLog('ERROR', 'NO SDP IN MESH RING'); setCallState('ended'); return; }
        callLog('SDP', `MESH RING SDP — ${offerSDP.length} bytes`);
        incomingVideo = sdpHasVideo(offerSDP);
        replyAddress = incomingSignal.from || contact.address;
        replyPKX = contact.pkx;
        replyPKY = contact.pky;
      } else {
        // Blockchain call — need to decrypt
        callLog('RX', 'DECRYPTING INCOMING RING...');
        const decrypted = await decryptCallSignal(incomingSignal, privateKeyBytes);
        if (!decrypted || decrypted.type !== 'RING') {
          callLog('ERROR', 'INVALID CALL SIGNAL');
          setCallState('ended');
          return;
        }
        callLog('SDP', `RING DECRYPTED — ${decrypted.sdp.length} bytes`);
        offerSDP = decrypted.sdp;
        incomingVideo = sdpHasVideo(decrypted.sdp);
        replyAddress = decrypted.callerAddress || contact.address;
        replyPKX = decrypted.callerPKX || contact.pkx;
        replyPKY = decrypted.callerPKY || contact.pky;
      }

      setHasVideo(incomingVideo);
      callLog('INFO', `CALL TYPE: ${incomingVideo ? 'VIDEO' : 'AUDIO'}`);

      callLog('INFO', `REQUESTING ${incomingVideo ? 'CAMERA + MIC' : 'MIC'} ACCESS...`);
      let pc, localStream;
      try {
        const conn = await createMediaConnection({ video: incomingVideo });
        pc = conn.pc;
        localStream = conn.localStream;
      } catch (err) {
        const msg = err.message || err.name || '';
        if (msg.includes('Permission denied') || msg.includes('NotAllowedError') || err.name === 'NotAllowedError') {
          setPermError(incomingVideo ? 'camera' : 'mic');
          callLog('ERROR', `${incomingVideo ? 'CAMERA/MIC' : 'MIC'} ACCESS DENIED`);
        } else {
          callLog('ERROR', `MEDIA ERROR: ${msg}`);
        }
        setCallState('ended');
        return;
      }
      pcRef.current = pc;
      localStreamRef.current = localStream;
      setupRemoteStream(pc);
      if (incomingVideo) attachLocalVideo(localStream);
      callLog('INFO', `MEDIA ACQUIRED — audio:${localStream.getAudioTracks().length} video:${localStream.getVideoTracks().length}`);

      const answerSDP = await createAnswer(pc, offerSDP);
      callLog('SDP', `ANSWER READY — ${answerSDP.length} bytes`);

      // Log ICE candidates in the SDP for debugging
      const candidateCount = (answerSDP.match(/a=candidate/g) || []).length;
      const hasRelay = answerSDP.includes('relay');
      callLog('ICE', `SDP CONTAINS ${candidateCount} CANDIDATES (relay: ${hasRelay})`);

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        callLog('ICE', `CONNECTION: ${s.toUpperCase()}`);
        if (s === 'connected') {
          setCallState('connected');
          setConnectionRoute('direct');
          callLog('INFO', `DIRECT P2P ${incomingVideo ? 'VIDEO' : 'AUDIO'} LINK ESTABLISHED`);
        }
      };

      pc.oniceconnectionstatechange = () => {
        callLog('ICE', `ICE STATE: ${pc.iceConnectionState}`);
      };

      // ── MESH-FIRST ANSWER ───────────────────────────────────────
      let answeredViaMesh = false;
      if (incomingViaMesh && meshPhoneRef.current) {
        let connected = meshPhoneRef.current.isConnected;
        // If not connected yet (page transition race), wait briefly for WS to open
        if (!connected) {
          callLog('MESH', 'WS NOT READY — WAITING FOR CONNECTION...');
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (hungUpRef.current) return;
            connected = meshPhoneRef.current?.isConnected;
            if (connected) break;
          }
        }
        callLog('MESH', `SENDING ANSWER VIA MESH (connected: ${connected})...`);
        if (connected) {
          answeredViaMesh = meshPhoneRef.current.sendAnswer(replyAddress, answerSDP);
        }
        if (answeredViaMesh) {
          callLog('MESH', 'ANSWER SENT VIA MESH');
          setCallState('connecting');
          // Set up trickle ICE over mesh
          pc.onicecandidate = (e) => {
            if (e.candidate && meshPhoneRef.current) {
              meshPhoneRef.current.sendIce(replyAddress, e.candidate.toJSON());
            }
          };
        } else {
          callLog('MESH', `MESH SEND FAILED (connected: ${connected}) — FALLING BACK TO BLOCKCHAIN`);
        }
      }

      // ── BLOCKCHAIN FALLBACK ─────────────────────────────────────
      if (!answeredViaMesh) {
        if (!replyPKX || !replyPKY) {
          callLog('ERROR', 'NO CALLER KEYS — CANNOT ENCRYPT ANSW');
          setCallState('ended');
          return;
        }
        callLog('TX', 'BROADCASTING ANSW VIA BLOCKCHAIN...');
        try {
          const answResult = await broadcastAnswer(replyAddress, replyPKX, replyPKY, answerSDP, wif, network);
          callLog('TX', 'ANSW BROADCAST SUCCESS', { txid: answResult?.txid });
          setCallState('connecting');
        } catch (e) {
          const msg = e.message || '';
          callLog('ERROR', `ANSW BROADCAST FAILED: ${msg}`);
          if (msg.includes('pending') || msg.includes('fee_too_low') || msg.includes('confirm') || msg.includes('Try again')) {
            callLog('WARN', 'RETRYING IN 3 SECONDS...');
            await new Promise(r => setTimeout(r, 3000));
            if (hungUpRef.current) return;
            const retryResult = await broadcastAnswer(replyAddress, replyPKX, replyPKY, pc.localDescription?.sdp || answerSDP, wif, network);
            callLog('TX', 'ANSW RETRY SUCCESS', { txid: retryResult?.txid });
            setCallState('connecting');
          } else {
            throw e;
          }
        }
        // Even with blockchain answer, set up trickle ICE via mesh if available
        if (meshPhoneRef.current) {
          pc.onicecandidate = (e) => {
            if (e.candidate && meshPhoneRef.current) {
              meshPhoneRef.current.sendIce(replyAddress, e.candidate.toJSON());
            }
          };
        }
      }

      const thisPC = pc;
      setTimeout(() => {
        if (hungUpRef.current || pcRef.current !== thisPC || thisPC.connectionState === 'connected') return;
        callLog('WARN', 'CONNECTION TIMEOUT 90s');
        hangUp();
      }, 90000);

    } catch (e) {
      callLog('ERROR', `INCOMING CALL FAILED: ${e.message}`);
      setCallState('ended');
    }
  }, [incomingSignal, contact, wif, network, privateKeyBytes, setupRemoteStream, attachLocalVideo]);

  // Start call on mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (isIncoming) answerIncomingCall();
    else initiateOutgoingCall();
  }, []);

  // Hang up
  const hangUp = useCallback(() => {
    if (hungUpRef.current) return;
    hungUpRef.current = true;
    callLog('INFO', `HANGUP — ${Math.floor(duration / 60)}m ${duration % 60}s`);
    if (monitorRef.current) monitorRef.current.disconnect();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (analyserRef.current?.ctx) analyserRef.current.ctx.close().catch(() => {});
    // Clean up mesh relay
    if (meshRelaySenderStopRef.current) { meshRelaySenderStopRef.current(); meshRelaySenderStopRef.current = null; }
    if (meshRelayReceiverRef.current) { meshRelayReceiverRef.current.stop(); meshRelayReceiverRef.current = null; }
    cleanupCall(pcRef.current, localStreamRef.current);
    clearInterval(timerRef.current);
    // Exit fullscreen if active
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setCallState('ended');
    setTimeout(() => onEnd(duration), 1000);
  }, [onEnd, duration]);

  // Tab visibility warning
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && callState === 'connected') {
        callLog('WARN', 'TAB IN BACKGROUND — CALL MAY DROP');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [callState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMuted(!track.enabled);
        callLog('INFO', track.enabled ? 'MIC UNMUTED' : 'MIC MUTED');
      }
    }
  }, []);

  // Toggle camera
  const toggleCam = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setCamOff(!track.enabled);
        callLog('INFO', track.enabled ? 'CAMERA ON' : 'CAMERA OFF');
      }
    }
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    }
  }, []);

  // Listen for fullscreen changes (user presses Esc)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const bars = 12;
  const activeBars = Math.floor((audioLevel / 100) * bars);
  const isActuallyConnected = callState === 'connected' ||
    (pcRef.current?.connectionState === 'connected' && callState !== 'ended');

  // Permission error screen
  if (permError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4" data-testid="call-perm-error">
        <div className="w-16 h-16 rounded-full border-2 border-red-600/40 bg-red-950/30 flex items-center justify-center mb-4">
          <FiAlertTriangle size={28} className="text-red-400" />
        </div>
        <p className="text-sm font-mono text-red-400 mb-2 text-center">
          {permError === 'camera' ? 'CAMERA & MICROPHONE' : 'MICROPHONE'} ACCESS DENIED
        </p>
        <p className="text-[9px] font-mono text-red-500/60 text-center max-w-[240px] mb-4">
          Grant {permError === 'camera' ? 'camera and microphone' : 'microphone'} permission in your browser settings and try again.
        </p>
        <button onClick={() => onEnd()}
          className="px-4 py-2 rounded border border-green-900/30 text-green-500 text-[10px] font-mono hover:bg-green-950/30 transition-all"
          data-testid="call-perm-dismiss">
          DISMISS
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef}
         className={`relative flex flex-col ${isFullscreen ? 'bg-black w-full h-full' : ''}`}
         data-testid="active-call-inline">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Video area — shown when call has video */}
      {hasVideo ? (
        <div className="relative bg-black flex-1 min-h-[200px]" data-testid="call-video-area">
          {/* Remote video (full area) */}
          <video ref={remoteVideoRef} autoPlay playsInline
            className="w-full h-full object-contain"
            style={{ minHeight: isFullscreen ? '100vh' : 200, filter: 'brightness(0.95)' }}
            data-testid="call-remote-video" />

          {/* Waiting overlay when not connected */}
          {!isActuallyConnected && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <div className={`w-16 h-16 rounded-full overflow-hidden border-2 mx-auto mb-2 ${
                  callState === 'waiting' || callState === 'answering' ? 'border-green-500 animate-pulse' : 'border-green-900/40'
                }`}>
                  {resolveImageUrl(contact.image) ? (
                    <img src={resolveImageUrl(contact.image)} alt=""
                         className="w-full h-full object-cover"
                         style={{ filter: 'saturate(0.3) brightness(0.8)' }}
                         onError={e => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-green-950/50 text-green-600 text-lg font-mono">
                      {(contact.urn || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-mono text-green-400 animate-pulse">
                  {callState === 'initiating' && 'TUNING FREQUENCY...'}
                  {callState === 'broadcasting' && 'BROADCASTING SIGNAL...'}
                  {callState === 'waiting' && 'SCANNING FOR RESPONSE...'}
                  {callState === 'answering' && 'LOCKING FREQUENCY...'}
                  {callState === 'connecting' && 'ESTABLISHING DIRECT LINK...'}
                  {callState === 'mesh-relay' && 'ROUTING THROUGH MESH...'}
                  {callState === 'ended' && 'SIGNAL LOST'}
                </p>
              </div>
            </div>
          )}

          {/* Local video preview (picture-in-picture) */}
          <div className={`absolute top-2 right-2 w-24 h-18 rounded overflow-hidden border border-green-700/40 bg-black ${camOff ? 'opacity-50' : ''}`}
               data-testid="call-local-video-pip">
            <video ref={localVideoRef} autoPlay playsInline muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }} />
            {camOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <FiVideoOff size={14} className="text-red-400" />
              </div>
            )}
          </div>

          {/* HUD overlay for connected state */}
          {isActuallyConnected && (
            <div className="absolute top-2 left-2 flex items-center gap-2">
              <span className="text-[9px] font-mono text-green-400 bg-black/50 px-1.5 py-0.5 rounded"
                    data-testid="call-duration">
                {formatTime(duration)}
              </span>
              <span className="flex items-center gap-1 text-[8px] font-mono text-green-500/60 bg-black/50 px-1.5 py-0.5 rounded">
                <FiWifi size={8} /> P2P ENCRYPTED
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Audio-only view */
        <div className="flex flex-col items-center py-6 px-4">
          <div className={`w-20 h-20 rounded-full overflow-hidden border-2 mb-3 ${
            callState === 'waiting' || callState === 'answering' ? 'border-green-500 animate-pulse' :
            isActuallyConnected ? 'border-green-400' : 'border-green-900/40'
          }`}>
            {resolveImageUrl(contact.image) ? (
              <img src={resolveImageUrl(contact.image)} alt=""
                   className="w-full h-full object-cover"
                   style={{ filter: 'saturate(0.3) brightness(0.8) sepia(0.2)' }}
                   onError={e => { e.target.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-green-950/50 text-green-600 text-xl font-mono">
                {(contact.urn || '?')[0].toUpperCase()}
              </div>
            )}
          </div>

          <p className="text-sm font-mono text-green-400 mb-1">
            {contact.urn || `${contact.address?.slice(0, 12)}...`}
          </p>

          <p className={`text-[9px] font-mono tracking-[0.2em] mb-2 ${
            isActuallyConnected ? 'text-green-400' :
            callState === 'ended' ? 'text-red-400' :
            callState === 'mesh-relay' ? 'text-amber-400 animate-pulse' :
            'text-amber-400 animate-pulse'
          }`}>
            {isActuallyConnected && connectionRoute === 'mesh-relay' && 'CONNECTED VIA MESH RELAY'}
            {isActuallyConnected && connectionRoute !== 'mesh-relay' && 'CONNECTED — DIRECT P2P'}
            {!isActuallyConnected && callState === 'initiating' && 'TUNING FREQUENCY...'}
            {!isActuallyConnected && callState === 'broadcasting' && 'BROADCASTING SIGNAL...'}
            {!isActuallyConnected && callState === 'waiting' && 'SCANNING FOR RESPONSE...'}
            {!isActuallyConnected && callState === 'answering' && 'LOCKING FREQUENCY...'}
            {!isActuallyConnected && callState === 'connecting' && 'ESTABLISHING DIRECT LINK...'}
            {!isActuallyConnected && callState === 'mesh-relay' && 'ROUTING THROUGH MESH RELAY...'}
            {!isActuallyConnected && callState === 'ended' && 'SIGNAL LOST'}
          </p>

          {/* Route indicator badge */}
          {isActuallyConnected && (
            <div className={`flex items-center gap-1.5 mb-1 ${
              connectionRoute === 'mesh-relay' ? 'text-amber-400/70' : 'text-green-400/70'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                connectionRoute === 'mesh-relay' ? 'bg-amber-400' : 'bg-green-400'
              }`} />
              <span className="text-[8px] font-mono tracking-wider">
                {connectionRoute === 'mesh-relay' ? 'RELAY' : 'P2P'}
              </span>
            </div>
          )}

          {isActuallyConnected && (
            <p className="text-lg font-mono text-green-300 tabular-nums" data-testid="call-duration">
              {formatTime(duration)}
            </p>
          )}

          {isActuallyConnected && (
            <div className="flex items-end gap-0.5 h-6 mt-3" data-testid="call-vu-meter">
              {Array.from({ length: bars }).map((_, i) => (
                <div key={i} className="w-2 rounded-sm transition-all duration-75"
                  style={{
                    height: i < activeBars ? `${Math.max(4, (i + 1) / bars * 24)}px` : '4px',
                    backgroundColor: i < activeBars
                      ? (i < bars * 0.6 ? '#22c55e' : i < bars * 0.8 ? '#eab308' : '#ef4444')
                      : '#1a3a1a',
                  }} />
              ))}
            </div>
          )}

          {isActuallyConnected && (
            <div className="flex items-center gap-1 mt-2 text-[8px] font-mono text-green-600/60">
              <FiWifi size={10} /> P2P ENCRYPTED
            </div>
          )}
        </div>
      )}

      {/* Control bar */}
      <div className="flex items-center justify-center gap-4 py-3 px-4 border-t border-green-900/20 bg-black/40"
           data-testid="call-controls">
        {/* Mic toggle */}
        {isActuallyConnected && (
          <button onClick={toggleMute}
            className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${
              muted ? 'bg-red-900/40 border-red-600/40' : 'bg-green-900/20 border-green-700/30'
            }`}
            data-testid="call-mute-btn"
            title={muted ? 'Unmute microphone' : 'Mute microphone'}>
            {muted ? <FiMicOff size={16} className="text-red-400" /> : <FiMic size={16} className="text-green-400" />}
          </button>
        )}

        {/* Camera toggle — only when video */}
        {isActuallyConnected && hasVideo && (
          <button onClick={toggleCam}
            className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${
              camOff ? 'bg-red-900/40 border-red-600/40' : 'bg-green-900/20 border-green-700/30'
            }`}
            data-testid="call-cam-btn"
            title={camOff ? 'Turn camera on' : 'Turn camera off'}>
            {camOff ? <FiVideoOff size={16} className="text-red-400" /> : <FiVideo size={16} className="text-green-400" />}
          </button>
        )}

        {/* Hang up */}
        <button onClick={hangUp}
          className="w-12 h-12 rounded-full bg-red-900/60 border-2 border-red-600/40 flex items-center justify-center hover:bg-red-800/60 transition-all"
          data-testid="call-hangup-btn">
          <FiPhoneOff size={20} className="text-red-400" />
        </button>

        {/* Fullscreen — only when video */}
        {hasVideo && (
          <button onClick={toggleFullscreen}
            className="w-10 h-10 rounded-full border-2 border-green-700/30 bg-green-900/20 flex items-center justify-center hover:bg-green-900/40 transition-all"
            data-testid="call-fullscreen-btn"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen
              ? <FiMinimize size={16} className="text-green-400" />
              : <FiMaximize size={16} className="text-green-400" />}
          </button>
        )}
      </div>
    </div>
  );
}
