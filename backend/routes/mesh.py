"""
P2P Mesh Relay — Node registry, signaling, and health tracking.

Nodes are users who opt-in to relay data (IPFS content, cached API responses)
to other peers via WebRTC data channels. The backend acts only as a matchmaker:
  1. Nodes register and heartbeat their availability
  2. Clients discover active nodes
  3. WebRTC signaling (offer/answer exchange) happens through the backend
  4. Once connected, all data flows peer-to-peer
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime, timezone, timedelta
import logging
import asyncio
import re

from db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mesh")

mesh_nodes_col = db['mesh_nodes']
mesh_stats_col = db['mesh_stats']

NODE_TIMEOUT_SECONDS = 90  # Node considered dead after this
MAX_WS_MESSAGE_SIZE = 65536  # 64KB max per signaling message
MAX_SIGNAL_RATE = 30  # Max signals per 10s window per connection
VALID_SIGNAL_TYPES = {'offer', 'answer', 'ice-candidate', 'ping', 'pong',
                      'call-ring', 'call-answer', 'call-reject', 'call-end',
                      'call-ice', 'call-busy', 'audio-relay', 'snapshot-gossip'}
ADDRESS_PATTERN = re.compile(r'^[a-zA-Z0-9]{20,90}$')


class NodeRegister(BaseModel):
    address: str
    network: str = "btc-testnet"
    urn: Optional[str] = None
    capacity: int = 5        # max peers this node can serve
    bandwidth: str = "normal" # low, normal, high
    services: list = []       # ["ipfs", "api_cache", "feed"]

    @field_validator('address')
    @classmethod
    def validate_address(cls, v):
        if not v or len(v) < 20 or len(v) > 90:
            raise ValueError('Invalid address length')
        if not ADDRESS_PATTERN.match(v):
            raise ValueError('Invalid address format')
        return v

    @field_validator('capacity')
    @classmethod
    def validate_capacity(cls, v):
        return max(1, min(v, 20))  # Clamp 1-20

    @field_validator('bandwidth')
    @classmethod
    def validate_bandwidth(cls, v):
        if v not in ('low', 'normal', 'high'):
            return 'normal'
        return v

    @field_validator('services')
    @classmethod
    def validate_services(cls, v):
        allowed = {'ipfs', 'api_cache', 'feed'}
        return [s for s in v if s in allowed][:5]


class SignalMessage(BaseModel):
    from_address: str
    to_address: str
    signal_type: str   # "offer", "answer", "ice-candidate"
    payload: str       # SDP or ICE candidate JSON


# ─── Node Registry ───

@router.post("/register")
async def register_node(req: NodeRegister):
    """Register or refresh a node's availability."""
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "address": req.address,
        "network": req.network,
        "urn": req.urn,
        "capacity": req.capacity,
        "bandwidth": req.bandwidth,
        "services": req.services or ["ipfs", "api_cache"],
        "active_peers": 0,
        "total_relayed": 0,
        "last_heartbeat": now,
        "registered_at": now,
        "online": True,
    }
    await mesh_nodes_col.update_one(
        {"address": req.address, "network": req.network},
        {"$set": doc, "$setOnInsert": {"first_seen": now}},
        upsert=True,
    )
    # Update global stats
    await mesh_stats_col.update_one(
        {"_id": "global"},
        {"$inc": {"total_registrations": 1}, "$set": {"last_activity": now}},
        upsert=True,
    )
    return {"ok": True, "node_id": req.address}


@router.post("/heartbeat")
async def heartbeat(req: NodeRegister):
    """Node heartbeat — keeps it alive in the registry."""
    now = datetime.now(timezone.utc).isoformat()
    result = await mesh_nodes_col.update_one(
        {"address": req.address, "network": req.network},
        {"$set": {
            "last_heartbeat": now,
            "online": True,
            "capacity": req.capacity,
            "active_peers": 0,  # Will be updated by signaling
        }},
    )
    if result.matched_count == 0:
        # Not registered yet — register
        return await register_node(req)
    return {"ok": True}


@router.post("/deregister")
async def deregister_node(address: str, network: str = "btc-testnet"):
    """Node going offline gracefully."""
    await mesh_nodes_col.update_one(
        {"address": address, "network": network},
        {"$set": {"online": False, "last_heartbeat": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


@router.get("/nodes")
async def get_active_nodes(network: str = "btc-testnet", service: str = ""):
    """Discover active relay nodes. Clients call this to find peers."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=NODE_TIMEOUT_SECONDS)).isoformat()

    query = {"network": network, "online": True, "last_heartbeat": {"$gte": cutoff}}
    if service:
        query["services"] = service

    cursor = mesh_nodes_col.find(query, {"_id": 0}).sort("last_heartbeat", -1).limit(20)
    nodes = []
    async for doc in cursor:
        nodes.append({
            "address": doc["address"],
            "urn": doc.get("urn"),
            "capacity": doc.get("capacity", 5),
            "bandwidth": doc.get("bandwidth", "normal"),
            "services": doc.get("services", []),
            "active_peers": doc.get("active_peers", 0),
            "total_relayed": doc.get("total_relayed", 0),
            "last_heartbeat": doc.get("last_heartbeat"),
        })

    return {"nodes": nodes, "count": len(nodes)}


@router.get("/stats")
async def get_mesh_stats(network: str = "btc-testnet"):
    """Get global mesh network statistics."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=NODE_TIMEOUT_SECONDS)).isoformat()

    online_count = await mesh_nodes_col.count_documents({
        "network": network, "online": True, "last_heartbeat": {"$gte": cutoff}
    })
    total_registered = await mesh_nodes_col.count_documents({"network": network})

    global_stats = await mesh_stats_col.find_one({"_id": "global"})
    total_relayed = 0
    if global_stats:
        total_relayed = global_stats.get("total_bytes_relayed", 0)

    return {
        "online_nodes": online_count,
        "total_registered": total_registered,
        "total_bytes_relayed": total_relayed,
        "network": network,
    }


# ─── WebRTC Signaling via WebSocket ───
# Lightweight signaling server — just forwards offer/answer/ICE between peers

_ws_connections: dict = {}  # address -> WebSocket


@router.websocket("/signal/{address}")
async def websocket_signal(websocket: WebSocket, address: str):
    """WebSocket endpoint for WebRTC signaling between mesh peers.
    
    Security: Rate-limited, message-size-limited, type-validated.
    """
    # Validate address format before accepting
    if not address or not ADDRESS_PATTERN.match(address):
        await websocket.close(code=4001, reason="Invalid address")
        return

    await websocket.accept()

    # Evict stale connections for the same address (prevents impersonation accumulation)
    old_ws = _ws_connections.get(address)
    if old_ws and old_ws != websocket:
        try:
            await old_ws.close(code=4002, reason="Replaced by new connection")
        except Exception:
            pass
    _ws_connections[address] = websocket
    logger.info(f"Mesh signal: {address[:12]}... connected")

    # Rate limiting state
    signal_window = []  # timestamps of recent signals

    # Keepalive ping task to prevent proxy idle-timeout disconnects
    async def _keepalive():
        try:
            while True:
                await asyncio.sleep(15)
                await websocket.send_json({"type": "ping"})
        except Exception:
            pass

    ping_task = asyncio.create_task(_keepalive())

    try:
        while True:
            raw = await websocket.receive_text()

            # Message size guard
            if len(raw) > MAX_WS_MESSAGE_SIZE:
                await websocket.send_json({"type": "error", "message": "Message too large"})
                continue

            try:
                data = __import__('json').loads(raw)
            except Exception:
                continue

            msg_type = data.get("type", "")

            # Respond to client pong / ignore ping messages
            if msg_type in ("pong", "ping"):
                continue

            # Validate signal type
            if msg_type not in VALID_SIGNAL_TYPES:
                await websocket.send_json({"type": "error", "message": f"Unknown signal type: {msg_type}"})
                continue

            # Rate limiting: max MAX_SIGNAL_RATE signals per 10s
            now = asyncio.get_event_loop().time()
            signal_window = [t for t in signal_window if now - t < 10]
            if len(signal_window) >= MAX_SIGNAL_RATE:
                await websocket.send_json({"type": "error", "message": "Rate limited"})
                continue
            signal_window.append(now)

            target = data.get("to", "")

            # Validate target address format
            if target and not ADDRESS_PATTERN.match(target):
                await websocket.send_json({"type": "error", "message": "Invalid target address"})
                continue

            # Limit payload size for SDP/ICE (SDP can be 2-4KB, ICE ~200B each)
            payload = data.get("payload", "")
            if isinstance(payload, str) and len(payload) > 32768:
                await websocket.send_json({"type": "error", "message": "Payload too large"})
                continue

            if target and target in _ws_connections:
                # Forward signal to target peer
                try:
                    await _ws_connections[target].send_json({
                        "from": address,
                        "type": msg_type,
                        "payload": payload,
                    })
                except Exception:
                    # Target connection is dead, clean up
                    _ws_connections.pop(target, None)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Peer {target[:12]}... connection lost",
                    })
            elif target:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Peer {target[:12]}... not connected to signaling",
                })
    except WebSocketDisconnect:
        logger.info(f"Mesh signal: {address[:12]}... disconnected")
    except Exception as e:
        logger.error(f"Mesh signal error for {address[:12]}...: {e}")
    finally:
        ping_task.cancel()
        # Only remove if this is still OUR websocket (not replaced)
        if _ws_connections.get(address) == websocket:
            _ws_connections.pop(address, None)


# ─── Relay stats tracking ───

@router.post("/relay-stat")
async def track_relay(address: str, bytes_relayed: int = 0, network: str = "btc-testnet"):
    """Track bytes relayed by a node (called periodically by nodes)."""
    # Validate inputs to prevent abuse
    if not address or not ADDRESS_PATTERN.match(address):
        return {"ok": False, "error": "Invalid address"}
    # Cap at 100MB per report to prevent stat inflation
    bytes_relayed = max(0, min(bytes_relayed, 100_000_000))
    await mesh_nodes_col.update_one(
        {"address": address, "network": network},
        {"$inc": {"total_relayed": bytes_relayed}},
    )
    await mesh_stats_col.update_one(
        {"_id": "global"},
        {"$inc": {"total_bytes_relayed": bytes_relayed}},
        upsert=True,
    )
    return {"ok": True}



# ─── Phase 4: Node quality / scoring endpoint ───

@router.get("/node-quality")
async def get_node_quality(network: str = "btc-testnet"):
    """Get quality metrics for all nodes — used by smart routing on clients
    and by the admin dashboard for monitoring."""
    # Use same freshness cutoff as stats endpoint for consistency
    _cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    nodes = await mesh_nodes_col.find(
        {"network": network},
        {"_id": 0, "address": 1, "urn": 1, "capacity": 1, "active_peers": 1,
         "online": 1, "total_relayed": 1, "last_heartbeat": 1},
    ).to_list(100)

    now_ts = datetime.now(timezone.utc)
    quality = []
    for n in nodes:
        # Calculate uptime score based on heartbeat freshness
        hb = n.get("last_heartbeat")
        staleness = 999
        if hb:
            try:
                hb_dt = datetime.fromisoformat(hb) if isinstance(hb, str) else hb
                staleness = (now_ts - hb_dt).total_seconds()
            except Exception:
                pass

        # A node is truly online only if it has a fresh heartbeat
        truly_online = n.get("online", False) and hb and staleness < 300

        uptime_score = max(0, 100 - staleness / 6)  # degrades over 10 minutes
        capacity_score = max(0, (n.get("capacity", 5) - n.get("active_peers", 0)) * 20)
        relay_score = min(100, (n.get("total_relayed", 0) or 0) / 10_000_000)  # 10MB = max

        quality.append({
            "address": n["address"],
            "urn": n.get("urn", ""),
            "online": truly_online,
            "capacity_remaining": max(0, n.get("capacity", 5) - n.get("active_peers", 0)),
            "total_relayed_mb": round((n.get("total_relayed", 0) or 0) / 1_048_576, 2),
            "uptime_score": round(uptime_score, 1),
            "capacity_score": round(capacity_score, 1),
            "relay_score": round(relay_score, 1),
            "composite_score": round((uptime_score + capacity_score + relay_score) / 3, 1),
        })

    quality.sort(key=lambda q: q["composite_score"], reverse=True)
    return {"nodes": quality, "count": len(quality)}


# ─── Decentralized Notification Hints ───
# Ephemeral relay for offline users. Mesh nodes POST hints when they can't
# deliver a gossip notification. The recipient fetches & clears on reconnect.

mesh_notifications_col = db['mesh_notifications']


class NotifyHint(BaseModel):
    to: str            # recipient address
    room: str          # room address
    sender: str        # sender address
    sender_urn: str = ""
    network: str = "btc-testnet"
    count: int = 1

    @field_validator('to', 'sender', 'room')
    @classmethod
    def validate_addresses(cls, v):
        if not v or len(v) < 10 or len(v) > 100:
            raise ValueError('Invalid address')
        return v

    @field_validator('count')
    @classmethod
    def validate_count(cls, v):
        return max(1, min(v, 100))

    @field_validator('sender_urn')
    @classmethod
    def validate_urn(cls, v):
        if len(v) > 50:
            return v[:50]
        return v


@router.post("/notify")
async def post_notification(hint: NotifyHint):
    """Store a notification hint for an offline user."""
    now = datetime.now(timezone.utc).isoformat()
    # Upsert: increment count if same room, otherwise insert
    existing = await mesh_notifications_col.find_one(
        {"to": hint.to, "room": hint.room, "network": hint.network}
    )
    if existing:
        await mesh_notifications_col.update_one(
            {"to": hint.to, "room": hint.room, "network": hint.network},
            {"$inc": {"count": hint.count},
             "$set": {"sender": hint.sender, "sender_urn": hint.sender_urn,
                      "updated": now}},
        )
    else:
        await mesh_notifications_col.insert_one({
            "to": hint.to,
            "room": hint.room,
            "sender": hint.sender,
            "sender_urn": hint.sender_urn,
            "network": hint.network,
            "count": hint.count,
            "created": now,
            "updated": now,
        })
    return {"ok": True}


@router.get("/notifications/{address}")
async def get_notifications(address: str, network: str = "btc-testnet"):
    """Fetch and clear all pending notification hints for a user."""
    cursor = mesh_notifications_col.find(
        {"to": address, "network": network}, {"_id": 0}
    )
    hints = await cursor.to_list(100)
    # Clear after reading
    if hints:
        await mesh_notifications_col.delete_many(
            {"to": address, "network": network}
        )
    total = sum(h.get("count", 0) for h in hints)
    return {"hints": hints, "total": total}


# ─── Snapshot Gossip Broadcast ───

async def broadcast_snapshot_gossip(cid: str, network: str, snap_type: str, root_count: int):
    """Broadcast a snapshot CID to ALL connected WebSocket signaling clients.
    This enables instant snapshot discovery for mesh-connected peers
    without waiting for the on-chain announcement cooldown."""
    import json
    msg = json.dumps({
        "type": "snapshot-gossip",
        "cid": cid,
        "network": network,
        "snap_type": snap_type,
        "root_count": root_count,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    sent = 0
    failed = 0
    dead = []
    for addr, ws in list(_ws_connections.items()):
        try:
            await ws.send_text(msg)
            sent += 1
        except Exception:
            dead.append(addr)
            failed += 1
    # Clean up dead connections
    for addr in dead:
        _ws_connections.pop(addr, None)
    logger.info(f"[SnapshotGossip] Broadcast CID {cid[:20]}... to {sent} peers ({failed} failed)")
    return {"sent": sent, "failed": failed}
