"""
Chat Relay — Real-time WebSocket relay for off-chain messaging.

This is the fallback for when P2P mesh isn't available.
Messages are NOT persisted on the backend — only relayed to connected clients.
Persistence is the client's responsibility (IndexedDB via offchainStore).

Also provides:
  - POST /api/chat/checkpoint — upload a message bundle to IPFS
  - GET /api/chat/unread/{address} — unread message counts per room
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from datetime import datetime, timezone
import logging
import json
import re

from db import db
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat")

KUBO_API = "http://127.0.0.1:5001/api/v0"
MAX_WS_MESSAGE_SIZE = 65536  # 64KB per message
MAX_CONTENT_LENGTH = 10000  # 10K chars max per chat message
MAX_ROOMS_PER_USER = 100
VALID_MSG_TYPES = {'join', 'message', 'ping'}
ADDRESS_RE = re.compile(r'^[a-zA-Z0-9]{10,100}$')

# Room-based WebSocket connections: room_address -> set of (address, websocket)
_room_connections: dict[str, dict[str, WebSocket]] = {}


def _sanitize_str(s, max_len=200):
    """Strip control chars and limit length."""
    if not isinstance(s, str):
        return ""
    # Remove null bytes and control characters (except newline/tab)
    s = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)
    return s[:max_len]


@router.websocket("/ws/{room_address}")
async def chat_ws(websocket: WebSocket, room_address: str):
    """WebSocket endpoint for real-time chat relay within a room."""
    # Validate room address
    if not room_address or len(room_address) < 10 or len(room_address) > 100:
        await websocket.close(code=4001, reason="Invalid room address")
        return

    await websocket.accept()
    client_address = None

    try:
        while True:
            raw = await websocket.receive_text()

            # Message size guard
            if len(raw) > MAX_WS_MESSAGE_SIZE:
                await websocket.send_json({"type": "error", "message": "Message too large"})
                continue

            try:
                data = json.loads(raw)
            except Exception:
                continue

            msg_type = data.get("type", "")

            if msg_type not in VALID_MSG_TYPES:
                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "join":
                client_address = _sanitize_str(data.get("address", ""), 100)
                if not client_address or not ADDRESS_RE.match(client_address):
                    await websocket.send_json({"type": "error", "message": "Invalid address"})
                    continue

                if room_address not in _room_connections:
                    _room_connections[room_address] = {}
                _room_connections[room_address][client_address] = websocket
                peers_in_room = len(_room_connections[room_address])
                logger.info(f"Chat relay: {client_address[:12]}... joined room {room_address[:20]}... ({peers_in_room} peer(s) in room)")

                # Mark room as read for this user on join
                await db.chat_unread.update_one(
                    {"address": client_address, "room": room_address},
                    {"$set": {"last_read": datetime.now(timezone.utc).isoformat(), "unread_count": 0}},
                    upsert=True,
                )

            elif msg_type == "message" and client_address:
                # Sanitize all user-provided fields
                content = _sanitize_str(data.get("content", ""), MAX_CONTENT_LENGTH)
                msg_id = _sanitize_str(data.get("id", ""), 100)
                sender_urn = _sanitize_str(data.get("senderUrn", ""), 50)
                sender_image = _sanitize_str(data.get("senderImage", ""), 200)
                timestamp = data.get("timestamp", datetime.now(timezone.utc).isoformat())
                if not isinstance(timestamp, str) or len(timestamp) > 40:
                    timestamp = datetime.now(timezone.utc).isoformat()

                # Store message for auto-checkpointing
                await db.chat_relay_messages.insert_one({
                    "room": room_address,
                    "msg_id": msg_id,
                    "content": content,
                    "encrypted": bool(data.get("encrypted", False)),
                    "sender": client_address,
                    "senderUrn": sender_urn,
                    "timestamp": timestamp,
                    "checkpointed": False,
                })

                # Update room message counter for unread tracking
                await db.chat_unread.update_many(
                    {"room": room_address, "address": {"$ne": client_address}},
                    {"$inc": {"unread_count": 1}, "$set": {"last_message_at": timestamp}},
                )
                # Also ensure a record exists for users who joined this room before
                # (the $inc above only updates existing records)

                # Broadcast to all other clients in the room
                room = _room_connections.get(room_address, {})
                payload = json.dumps({
                    "type": "room_message",
                    "room": room_address,
                    "id": msg_id,
                    "content": content,
                    "encrypted": bool(data.get("encrypted", False)),
                    "sender": client_address,
                    "senderUrn": sender_urn,
                    "senderImage": sender_image,
                    "timestamp": timestamp,
                    "source": "ws",
                })
                disconnected = []
                for addr, ws in room.items():
                    if addr == client_address:
                        continue
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        disconnected.append(addr)
                for addr in disconnected:
                    room.pop(addr, None)

                # Connected users in room get their count reset
                for addr in room:
                    if addr != client_address:
                        await db.chat_unread.update_one(
                            {"address": addr, "room": room_address},
                            {"$set": {"unread_count": 0, "last_read": timestamp}},
                            upsert=True,
                        )

                # Post mesh notification hints for registered but offline users
                try:
                    registered = db.chat_unread.find(
                        {"room": room_address, "address": {"$ne": client_address}},
                        {"_id": 0, "address": 1},
                    )
                    online_addrs = set(room.keys())
                    async for reg in registered:
                        addr = reg.get("address")
                        if addr and addr not in online_addrs:
                            await db.mesh_notifications.update_one(
                                {"to": addr, "room": room_address, "network": "btc-testnet"},
                                {"$inc": {"count": 1},
                                 "$set": {"sender": client_address,
                                          "sender_urn": sender_urn,
                                          "updated": timestamp}},
                                upsert=True,
                            )
                except Exception as e:
                    logger.debug(f"Mesh hint posting error: {e}")

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Chat relay error: {e}")
    finally:
        if client_address and room_address in _room_connections:
            _room_connections[room_address].pop(client_address, None)
            if not _room_connections[room_address]:
                del _room_connections[room_address]
        logger.info(f"Chat relay: {(client_address or 'unknown')[:12]}... left room {room_address[:12]}...")


# ─── Unread tracking ───

@router.get("/unread/{address}")
async def get_unread_counts(address: str):
    """Get unread message counts for all rooms a user has joined."""
    cursor = db.chat_unread.find(
        {"address": address, "unread_count": {"$gt": 0}},
        {"_id": 0, "room": 1, "unread_count": 1, "last_message_at": 1},
    )
    rooms = await cursor.to_list(100)
    total = sum(r.get("unread_count", 0) for r in rooms)
    return {"rooms": rooms, "total_unread": total}


@router.post("/mark-read/{room_address}")
async def mark_room_read(room_address: str, address: str = ""):
    """Mark a room as read for a specific user."""
    if not address:
        return {"success": False, "detail": "address required"}
    await db.chat_unread.update_one(
        {"address": address, "room": room_address},
        {"$set": {"unread_count": 0, "last_read": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True}


@router.get("/inbox/{address}")
async def get_inbox(address: str, since: str = ""):
    """Return messages sent to rooms this user is registered in while they were away.
    `since` is an ISO timestamp — only returns messages newer than this.
    Messages are returned grouped by room with sender info."""
    if not address or not ADDRESS_RE.match(address):
        return {"rooms": {}, "total": 0}

    # Find all rooms this user is in
    cursor = db.chat_unread.find(
        {"address": address},
        {"_id": 0, "room": 1, "last_read": 1},
    )
    user_rooms = {}
    async for r in cursor:
        user_rooms[r["room"]] = r.get("last_read", "")

    if not user_rooms:
        return {"rooms": {}, "total": 0}

    # For each room, fetch messages newer than last_read (or since param)
    result = {}
    total = 0
    for room, last_read in user_rooms.items():
        cutoff = since if since else last_read
        query = {
            "room": room,
            "sender": {"$ne": address},  # Don't return user's own messages
        }
        if cutoff:
            query["timestamp"] = {"$gt": cutoff}

        msgs_cursor = db.chat_relay_messages.find(
            query,
            {"_id": 0, "room": 1, "msg_id": 1, "content": 1, "encrypted": 1,
             "sender": 1, "senderUrn": 1, "timestamp": 1},
        ).sort("timestamp", 1).limit(200)

        msgs = await msgs_cursor.to_list(200)
        if msgs:
            result[room] = msgs
            total += len(msgs)

    return {"rooms": result, "total": total}


@router.get("/unread/{address}")
async def get_unread_counts(address: str):
    """Return unread message counts per room for an address."""
    if not address or not ADDRESS_RE.match(address):
        return {"rooms": []}

    cursor = db.chat_unread.find(
        {"address": address, "unread_count": {"$gt": 0}},
        {"_id": 0, "room": 1, "unread_count": 1},
    )
    rooms = await cursor.to_list(50)
    return {"rooms": rooms}


@router.post("/register-room")
async def register_for_room(address: str = "", room: str = ""):
    """Register a user for unread tracking in a room (called on first visit)."""
    if not address or not room:
        return {"success": False}
    existing = await db.chat_unread.find_one({"address": address, "room": room})
    if not existing:
        await db.chat_unread.insert_one({
            "address": address,
            "room": room,
            "unread_count": 0,
            "last_read": datetime.now(timezone.utc).isoformat(),
            "last_message_at": None,
        })
    return {"success": True}


# ─── Checkpoint ───

class CheckpointRequest(BaseModel):
    bundle_json: str
    address: str
    network: str = "btc-testnet"

    @field_validator('bundle_json')
    @classmethod
    def validate_bundle(cls, v):
        # Max 5MB checkpoint bundle
        if len(v) > 5_000_000:
            raise ValueError('Bundle too large (max 5MB)')
        return v

    @field_validator('address')
    @classmethod
    def validate_address(cls, v):
        if not v or len(v) < 10 or len(v) > 100:
            raise ValueError('Invalid address')
        return v


@router.post("/checkpoint")
async def create_checkpoint(req: CheckpointRequest):
    """Upload a message bundle to IPFS and return the CID."""
    try:
        client = get_client()
        bundle_bytes = req.bundle_json.encode("utf-8")

        resp = await client.post(
            f"{KUBO_API}/add?pin=true",
            files={"file": ("checkpoint.json", bundle_bytes, "application/json")},
            timeout=30.0,
        )
        if resp.status_code != 200:
            return JSONResponse(
                status_code=502,
                content={"error": "IPFS upload failed", "detail": resp.text},
            )

        result = resp.json()
        cid = result.get("Hash", "")

        await db.chat_checkpoints.insert_one({
            "cid": cid,
            "address": req.address,
            "network": req.network,
            "size_bytes": len(bundle_bytes),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        return {"cid": cid, "size": len(bundle_bytes)}

    except Exception as e:
        logger.error(f"Checkpoint upload error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


CID_PATTERN = re.compile(r'^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z2-7]{50,})$')


@router.get("/checkpoint/restore/{cid}")
async def restore_checkpoint(cid: str):
    """Fetch a checkpoint bundle from IPFS so clients can restore messages."""
    # Validate CID format
    if not cid or not CID_PATTERN.match(cid):
        return JSONResponse(status_code=400, content={"error": "Invalid CID format"})
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/cat?arg={cid}", timeout=30.0)
        if resp.status_code != 200:
            return JSONResponse(status_code=404, content={"error": "Bundle not found on IPFS"})

        # Limit response size to prevent memory exhaustion
        if len(resp.content) > 10_000_000:
            return JSONResponse(status_code=413, content={"error": "Bundle too large"})

        bundle = json.loads(resp.content)
        return {"cid": cid, "bundle": bundle}

    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"error": "Invalid bundle format"})
    except Exception as e:
        logger.error(f"Checkpoint restore error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
