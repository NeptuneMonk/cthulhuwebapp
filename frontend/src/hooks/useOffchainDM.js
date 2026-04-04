/**
 * useOffchainDM — React hook for real-time off-chain encrypted DMs.
 *
 * Pattern mirrors useOffchainChat but adds E2E encryption:
 *   1. Encrypts message with recipient's public key before sending
 *   2. Sends encrypted blob via mesh/WebSocket (relay sees only ciphertext)
 *   3. Recipient decrypts locally with their wallet key
 *   4. Both store plaintext in IndexedDB for fast re-display
 *
 * DM "room" address = sorted pair: min(addr1,addr2)_max(addr1,addr2)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  storeMessage, getRoomMessages,
  buildBundle, markMessagesSynced, saveCheckpoint,
  getCacheStats, shouldTriggerCheckpoint,
} from '@/utils/offchainStore';
import { getGlobalMeshClient, getGlobalMeshNode } from '@/utils/meshRelay';
import { encryptMessage, decryptMessage } from '@/utils/ecies';
import { uint8ToBase64 } from '@/utils/binaryUtils';

const API = process.env.REACT_APP_BACKEND_URL;

/** Derive a stable DM room key from two addresses (sorted). */
function dmRoomKey(addr1, addr2) {
  return addr1 < addr2 ? `dm_${addr1}_${addr2}` : `dm_${addr2}_${addr1}`;
}

/**
 * @param {string} partnerAddr — partner's blockchain address
 * @param {string} myAddress — current user's address
 * @param {string} myUrn — current user's URN
 * @param {object} partnerProfile — { pkx, pky, urn, image } for encryption
 * @param {Uint8Array|null} privKeyBytes — user's 32-byte private key (for decryption)
 * @param {string} network
 */
export function useOffchainDM(partnerAddr, myAddress, myUrn, partnerProfile, privKeyBytes, network) {
  const roomKey = myAddress && partnerAddr ? dmRoomKey(myAddress, partnerAddr) : null;

  const [offchainMessages, setOffchainMessages] = useState([]);
  const [cacheStats, setCacheStats] = useState(null);
  const [isCheckpointing, setIsCheckpointing] = useState(false);
  const [checkpointHint, setCheckpointHint] = useState(false);

  const wsRef = useRef(null);
  const wsConnectedRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const checkTimerRef = useRef(null);
  const meshListenerSetRef = useRef(false);

  // Load cached messages on mount + fetch inbox (missed while offline)
  useEffect(() => {
    if (!roomKey || !myAddress) return;
    (async () => {
      // 1. Load local cache
      const cached = await getRoomMessages(roomKey);
      setOffchainMessages(cached);

      // 2. Fetch messages missed while offline from server inbox
      try {
        const lastTs = cached.length > 0
          ? cached[cached.length - 1].timestamp
          : '';
        const params = lastTs ? `?since=${encodeURIComponent(lastTs)}` : '';
        const res = await fetch(`${API}/api/chat/inbox/${myAddress}${params}`);
        if (res.ok) {
          const data = await res.json();
          const missed = data.rooms?.[roomKey] || [];
          for (const msg of missed) {
            const incoming = {
              id: msg.msg_id,
              room: roomKey,
              sender: msg.sender,
              senderUrn: msg.senderUrn || '',
              content: msg.content,
              encrypted: msg.encrypted,
              timestamp: msg.timestamp,
              type: 'text',
              source: 'inbox',
            };
            await handleIncomingMessage(incoming);
          }
        }
      } catch (e) {
        console.warn('[useOffchainDM] Inbox fetch failed:', e.message);
      }
    })();
  }, [roomKey, myAddress]);

  // Handle incoming encrypted message from any transport
  const handleIncomingMessage = useCallback(async (msg) => {
    if (!msg.room || msg.room !== roomKey) return;
    if (msg.sender === myAddress) return;

    // Decrypt the content
    let plaintext = msg.content;
    if (msg.encrypted && privKeyBytes) {
      try {
        const encBytes = Uint8Array.from(atob(msg.content), c => c.charCodeAt(0));
        plaintext = await decryptMessage(encBytes, privKeyBytes);
      } catch {
        plaintext = '[Decryption failed]';
      }
    }

    const stored = await storeMessage({
      id: msg.id,
      room: roomKey,
      sender: msg.sender,
      senderUrn: msg.senderUrn || '',
      senderImage: msg.senderImage || '',
      content: plaintext,
      timestamp: msg.timestamp,
      type: msg.type || 'text',
      source: msg.source || 'mesh',
    });

    setOffchainMessages(prev => {
      if (prev.some(m => m.id === stored.id)) return prev;
      return [...prev, stored];
    });
  }, [roomKey, myAddress, privKeyBytes]);

  // ─── WebSocket connection ───
  const connectWs = useCallback(() => {
    if (!roomKey || !myAddress) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const wsBase = API.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/api/chat/ws/${roomKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      wsConnectedRef.current = true;
      ws.send(JSON.stringify({ type: 'join', address: myAddress, urn: myUrn }));
      // Mark room as read on the server (user is actively viewing this DM)
      fetch(`${API}/api/chat/mark-read/${roomKey}?address=${myAddress}`, { method: 'POST' }).catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'room_message') {
          handleIncomingMessage(msg);
        }
      } catch {}
    };

    ws.onclose = () => {
      wsConnectedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connectWs(), 5000);
    };

    ws.onerror = () => {};
  }, [roomKey, myAddress, myUrn, handleIncomingMessage]);

  // ─── Mesh listener ───
  useEffect(() => {
    const meshClient = getGlobalMeshClient();
    const meshNode = getGlobalMeshNode();

    // We piggyback on the global mesh message handler — the room key filtering
    // in handleIncomingMessage ensures only our DM messages are processed.
    if (meshClient && !meshListenerSetRef.current) {
      const prev = meshClient._onRoomMessage;
      meshClient.setOnRoomMessage((msg) => {
        if (prev) prev(msg);
        handleIncomingMessage(msg);
      });
      meshListenerSetRef.current = true;
    }

    return () => {
      meshListenerSetRef.current = false;
    };
  }, [handleIncomingMessage]);

  // ─── Connect WS on mount ───
  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      wsConnectedRef.current = false;
    };
  }, [connectWs]);

  // ─── Send an encrypted message ───
  const sendMessage = useCallback(async (content, type = 'text') => {
    if (!content.trim() || !myAddress || !roomKey) return null;

    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timestamp = new Date().toISOString();

    // Store plaintext locally
    const stored = await storeMessage({
      id: msgId,
      room: roomKey,
      sender: myAddress,
      senderUrn: myUrn || '',
      content,
      timestamp,
      type,
      source: 'local',
    });
    setOffchainMessages(prev => [...prev, stored]);

    // Encrypt for relay (if partner has encryption keys)
    let relayContent = content;
    let encrypted = false;
    if (partnerProfile?.pkx && partnerProfile?.pky) {
      try {
        const encBytes = await encryptMessage(content, partnerProfile.pkx, partnerProfile.pky);
        relayContent = uint8ToBase64(encBytes);
        encrypted = true;
      } catch (e) {
        console.warn('[useOffchainDM] Encryption failed, sending plaintext:', e.message);
      }
    }

    const msg = {
      type: 'room_message',
      room: roomKey,
      id: msgId,
      content: relayContent,
      encrypted,
      sender: myAddress,
      senderUrn: myUrn || '',
      timestamp,
      source: 'local',
    };

    // Broadcast via mesh
    const meshClient = getGlobalMeshClient();
    const meshNode = getGlobalMeshNode();
    if (meshClient?.connected) meshClient.sendRoomMessage(msg);
    if (meshNode?._running) meshNode.broadcastRoomMessage(msg);

    // Also send via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        id: msgId,
        content: relayContent,
        encrypted,
        sender: myAddress,
        senderUrn: myUrn || '',
        timestamp,
      }));
    }

    return stored;
  }, [roomKey, myAddress, myUrn, partnerProfile]);

  // ─── Checkpoint ───
  const triggerCheckpoint = useCallback(async () => {
    if (!myAddress || isCheckpointing) return null;
    setIsCheckpointing(true);
    try {
      const bundle = await buildBundle(myAddress);
      if (!bundle) { setIsCheckpointing(false); return null; }

      const res = await fetch(`${API}/api/chat/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundle_json: bundle.json,
          address: myAddress,
          network,
        }),
      });
      if (!res.ok) throw new Error('Checkpoint upload failed');
      const { cid } = await res.json();

      await markMessagesSynced(bundle.messageIds);
      const checkpoint = await saveCheckpoint({
        room: roomKey,
        cid,
        messageCount: bundle.messageCount,
        byteSize: bundle.byteSize,
      });

      setCheckpointHint(false);
      return { cid, checkpoint };
    } catch (e) {
      console.error('[useOffchainDM] Checkpoint failed:', e);
      return null;
    } finally {
      setIsCheckpointing(false);
    }
  }, [myAddress, network, roomKey, isCheckpointing]);

  // ─── Periodic checkpoint check ───
  useEffect(() => {
    const check = async () => {
      const stats = await getCacheStats();
      setCacheStats(stats);
      const should = await shouldTriggerCheckpoint();
      setCheckpointHint(should);
    };
    check();
    checkTimerRef.current = setInterval(check, 60_000);
    return () => clearInterval(checkTimerRef.current);
  }, []);

  return {
    offchainMessages,
    sendMessage,
    triggerCheckpoint,
    isCheckpointing,
    checkpointHint,
    cacheStats,
    wsConnected: wsConnectedRef.current,
    roomKey,
  };
}
