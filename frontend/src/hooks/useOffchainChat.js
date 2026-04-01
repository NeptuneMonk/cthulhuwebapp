/**
 * useOffchainChat — React hook for real-time off-chain messaging.
 *
 * Combines three transport layers:
 *   1. P2P mesh relay (WebRTC data channels — free, fastest)
 *   2. WebSocket relay (backend fallback — free, fast)
 *   3. On-chain P2FK (blockchain — expensive, permanent)
 *
 * Messages are stored locally in IndexedDB and merged with on-chain history.
 * Periodically, cached messages can be "checkpointed" — bundled, uploaded
 * to IPFS, and anchored to the chain with a single transaction.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  storeMessage, getRoomMessages, getUnsyncedMessages,
  buildBundle, markMessagesSynced, saveCheckpoint,
  getCacheStats, shouldTriggerCheckpoint, BUNDLE_THRESHOLDS,
} from '@/utils/offchainStore';
import { getGlobalMeshClient, getGlobalMeshNode } from '@/utils/meshRelay';
import { playNotificationSound } from '@/utils/notificationSound';
import { handleGossipNotify } from '@/utils/meshNotifications';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * @param {string} roomAddress — the chat room (object address or DM address)
 * @param {string} myAddress — current user's blockchain address
 * @param {string} myUrn — current user's URN
 * @param {string} myImage — current user's profile image
 * @param {string} network — blockchain network
 */
export function useOffchainChat(roomAddress, myAddress, myUrn, myImage, network) {
  const [offchainMessages, setOffchainMessages] = useState([]);
  const [cacheStats, setCacheStats] = useState(null);
  const [isCheckpointing, setIsCheckpointing] = useState(false);
  const [checkpointHint, setCheckpointHint] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef(null);
  const wsConnectedRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const checkTimerRef = useRef(null);
  const meshListenerSetRef = useRef(false);

  // Load cached messages on mount
  useEffect(() => {
    if (!roomAddress) return;
    getRoomMessages(roomAddress).then(msgs => {
      setOffchainMessages(msgs);
    });
  }, [roomAddress]);

  // Handle incoming message from any transport
  const handleIncomingMessage = useCallback(async (msg) => {
    if (!msg.room || msg.room !== roomAddress) return;
    if (msg.sender === myAddress) return; // Don't double-show own messages

    const stored = await storeMessage({
      id: msg.id,
      room: roomAddress,
      sender: msg.sender,
      senderUrn: msg.senderUrn || '',
      senderImage: msg.senderImage || '',
      content: msg.content,
      timestamp: msg.timestamp,
      type: msg.type || 'text',
      source: msg.source || 'mesh',
    });

    setOffchainMessages(prev => {
      if (prev.some(m => m.id === stored.id)) return prev;
      return [...prev, stored];
    });

    // Play notification sound for incoming messages
    playNotificationSound();
  }, [roomAddress, myAddress]);

  // ─── WebSocket connection ───
  const connectWs = useCallback(() => {
    if (!roomAddress || !myAddress) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const wsBase = API.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/api/chat/ws/${roomAddress}`);
    wsRef.current = ws;

    ws.onopen = () => {
      wsConnectedRef.current = true;
      setWsConnected(true);
      ws.send(JSON.stringify({ type: 'join', address: myAddress, urn: myUrn }));
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
      setWsConnected(false);
      // Reconnect after delay
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connectWs(), 5000);
    };

    ws.onerror = () => {}; // onclose will fire after
  }, [roomAddress, myAddress, myUrn, handleIncomingMessage]);

  // ─── Mesh listener ───
  useEffect(() => {
    const meshClient = getGlobalMeshClient();
    const meshNode = getGlobalMeshNode();

    if (meshClient && !meshListenerSetRef.current) {
      meshClient.setOnRoomMessage(handleIncomingMessage);
      meshListenerSetRef.current = true;
    }
    if (meshNode) {
      meshNode.setOnRoomMessage(handleIncomingMessage);
    }

    return () => {
      if (meshClient) meshClient.setOnRoomMessage(null);
      if (meshNode) meshNode.setOnRoomMessage(null);
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

  // ─── Send a message ───
  const sendMessage = useCallback(async (content, type = 'text') => {
    if (!content.trim() || !myAddress) return null;

    const msgId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timestamp = new Date().toISOString();
    const msg = {
      type: 'room_message',
      room: roomAddress,
      id: msgId,
      content,
      sender: myAddress,
      senderUrn: myUrn || '',
      senderImage: myImage || '',
      timestamp,
      source: 'local',
    };

    // Store locally
    const stored = await storeMessage({
      id: msgId,
      room: roomAddress,
      sender: myAddress,
      senderUrn: myUrn || '',
      senderImage: myImage || '',
      content,
      timestamp,
      type,
      source: 'local',
    });

    setOffchainMessages(prev => [...prev, stored]);

    // Broadcast via mesh (if connected)
    const meshClient = getGlobalMeshClient();
    const meshNode = getGlobalMeshNode();
    let sent = false;
    if (meshClient?.connected) {
      sent = meshClient.sendRoomMessage(msg);
      // Also broadcast a gossip notification for users not in this room
      meshClient.sendGossipNotify({
        room: roomAddress, sender: myAddress, senderUrn: myUrn || '',
        timestamp, count: 1,
      });
    }
    if (meshNode?._running) {
      meshNode.broadcastRoomMessage(msg);
      // Also broadcast a gossip notification
      meshNode.broadcastGossipNotify({
        room: roomAddress, sender: myAddress, senderUrn: myUrn || '',
        timestamp, count: 1,
      });
      sent = true;
    }

    // Also send via WebSocket (always, as guaranteed delivery)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        id: msgId,
        content,
        sender: myAddress,
        senderUrn: myUrn || '',
        senderImage: myImage || '',
        timestamp,
      }));
      sent = true;
    }

    return stored;
  }, [roomAddress, myAddress, myUrn, myImage]);

  // ─── Checkpoint: bundle → IPFS → on-chain ───
  const triggerCheckpoint = useCallback(async () => {
    if (!myAddress || isCheckpointing) return null;
    setIsCheckpointing(true);
    try {
      const bundle = await buildBundle(myAddress);
      if (!bundle) { setIsCheckpointing(false); return null; }

      // Upload to IPFS via backend
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

      // Mark messages as synced
      await markMessagesSynced(bundle.messageIds);

      // Save checkpoint record locally
      const checkpoint = await saveCheckpoint({
        room: roomAddress,
        cid,
        messageCount: bundle.messageCount,
        byteSize: bundle.byteSize,
      });

      setCheckpointHint(false);
      return { cid, checkpoint };
    } catch (e) {
      console.error('[useOffchainChat] Checkpoint failed:', e);
      return null;
    } finally {
      setIsCheckpointing(false);
    }
  }, [myAddress, network, roomAddress, isCheckpointing]);

  // ─── Periodic checkpoint check ───
  useEffect(() => {
    const check = async () => {
      const stats = await getCacheStats();
      setCacheStats(stats);
      const should = await shouldTriggerCheckpoint();
      setCheckpointHint(should);
    };
    check();
    checkTimerRef.current = setInterval(check, 60_000); // check every minute
    return () => clearInterval(checkTimerRef.current);
  }, []);

  return {
    offchainMessages,
    sendMessage,
    triggerCheckpoint,
    isCheckpointing,
    checkpointHint,
    cacheStats,
    wsConnected,
  };
}
