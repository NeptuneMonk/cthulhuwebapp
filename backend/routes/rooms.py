"""Room routes: Object-based chat rooms using P2FK public messages + ephemeral audience feed."""
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime, timezone
import logging
import re

from db import audience_messages_col
from utils.helpers import (
    p2fk_get, get_cached_profile, register_known_user,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

_SALT_RE = re.compile(r'<<-?\d+>>.*', re.DOTALL)
_owner_cache = {}

AUDIENCE_MSG_COST = 555  # sats — minimum tip to post an audience message


class AudienceMessageIn(BaseModel):
    sender_address: str
    sender_urn: str = ""
    content: str = ""
    txid: str
    amount_sats: int
    network: str = "btc-testnet"


async def _get_object_owners(address: str, is_mainnet: bool):
    cache_key = f"{address}:{is_mainnet}"
    if cache_key in _owner_cache:
        return _owner_cache[cache_key]
    owners, creators = set(), set()
    try:
        obj_data = await p2fk_get(f"GetObjectByAddress/{address}", is_mainnet)
        if isinstance(obj_data, dict):
            owners_dict = obj_data.get('Owners') or {}
            if isinstance(owners_dict, dict):
                owners = set(owners_dict.keys())
            elif isinstance(owners_dict, list):
                owners = {o.get('address', o) if isinstance(o, dict) else o for o in owners_dict}
            creators_dict = obj_data.get('Creators') or {}
            if isinstance(creators_dict, dict):
                creators = set(creators_dict.keys())
            elif isinstance(creators_dict, list):
                creators = {c.get('address', c) if isinstance(c, dict) else c for c in creators_dict}
    except Exception as e:
        logger.warning(f"Failed to fetch object owners for {address}: {e}")
    result = {"owners": owners, "creators": creators}
    _owner_cache[cache_key] = result
    return result


async def _get_object_license(address: str, is_mainnet: bool) -> str:
    try:
        obj_data = await p2fk_get(f"GetObjectByAddress/{address}", is_mainnet)
        if isinstance(obj_data, dict):
            return (obj_data.get('License') or '').lower()
    except Exception as e:
        logger.warning(f"Failed to fetch object license for {address}: {e}")
    return ''


# ── Seated messages (on-chain P2FK) ────────────────────────────

@router.get("/room/{address}/messages")
async def get_room_messages(address: str, network: str = "btc-testnet", limit: int = 100):
    """On-chain P2FK messages for a room. Venue gating is license-based."""
    is_mainnet = 'testnet' not in network
    try:
        room_license = await _get_object_license(address, is_mainnet)
        is_venue = room_license == 'cthulhu:tether:venue'

        obj_info = await _get_object_owners(address, is_mainnet)
        seat_holders = obj_info["owners"]
        room_creators = obj_info["creators"]
        authorized = seat_holders | room_creators

        data = await p2fk_get(
            f"GetPublicMessagesByAddress/{address}?skip=0&qty={limit}",
            is_mainnet
        )
        if not isinstance(data, list):
            return {
                "messages": [], "count": 0,
                "seat_holders": list(seat_holders),
                "creators": list(room_creators),
                "is_venue": is_venue,
            }

        messages = []
        seen_txids = set()

        for msg in data:
            if not isinstance(msg, dict):
                continue
            raw = msg.get('Message', '')
            content_str = ' '.join(raw) if isinstance(raw, list) else str(raw)
            content_str = _SALT_RE.sub('', content_str).strip()
            content_str = ''.join(c for c in content_str if c.isprintable() or c in '\n\t').strip()
            if content_str.startswith('SEC') and len(content_str) > 4 and content_str[3] in '\\//:*?"<>|':
                continue
            txid = msg.get('TransactionId', '')
            if txid in seen_txids:
                continue
            seen_txids.add(txid)

            sender = msg.get('FromAddress', '')
            profile = await get_cached_profile(sender, is_mainnet) if sender else None
            sender_urn = profile.get('URN') if profile else None
            sender_image = profile.get('Image') if profile else None
            if sender and sender_urn:
                await register_known_user(sender, network, sender_urn, sender_image, profile.get('DisplayName'))

            is_seated = sender in authorized if is_venue else True
            is_creator_msg = sender in room_creators
            messages.append({
                "txid": txid,
                "content": content_str,
                "sender_address": sender,
                "from_address": sender,
                "to_address": msg.get('ToAddress', address),
                "block_date": msg.get('BlockDate', ''),
                "created_at": msg.get('BlockDate', ''),
                "sender_urn": sender_urn,
                "sender_image": sender_image,
                "is_seat_holder": is_seated,
                "is_creator": is_creator_msg,
            })

        messages.sort(key=lambda m: m.get('block_date', ''))
        return {
            "messages": messages,
            "count": len(messages),
            "seat_holders": list(seat_holders),
            "creators": list(room_creators),
            "is_venue": is_venue,
        }
    except Exception as e:
        logger.error(f"Error fetching room messages for {address}: {e}")
        return {"messages": [], "count": 0, "error": str(e)}


# ── Audience feed (ephemeral, off-chain) ───────────────────────

@router.post("/room/{address}/audience")
async def post_audience_message(address: str, body: AudienceMessageIn):
    """Store an ephemeral audience message after a tip TX is broadcast.
    555 sats = text message, larger amounts = super chat (is_tip=True)."""
    is_tip = body.amount_sats > AUDIENCE_MSG_COST
    doc = {
        "room_address": address,
        "sender_address": body.sender_address,
        "sender_urn": body.sender_urn,
        "content": body.content if not is_tip else "",
        "txid": body.txid,
        "amount_sats": body.amount_sats,
        "is_tip": is_tip,
        "network": body.network,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await audience_messages_col.insert_one(doc)
    return {
        "status": "ok",
        "is_tip": is_tip,
        "amount_sats": body.amount_sats,
    }


@router.get("/room/{address}/audience")
async def get_audience_messages(address: str, network: str = "btc-testnet", limit: int = 200):
    """Retrieve ephemeral audience messages for a room."""
    cursor = audience_messages_col.find(
        {"room_address": address, "network": network},
        {"_id": 0}
    ).sort("timestamp", 1).limit(limit)
    messages = await cursor.to_list(length=limit)
    return {"messages": messages, "count": len(messages), "min_cost_sats": AUDIENCE_MSG_COST}


@router.delete("/room/{address}/audience")
async def clear_audience_messages(address: str, network: str = "btc-testnet", creator_address: str = ""):
    """Clear the ephemeral audience cache. Creator-only (verified client-side)."""
    result = await audience_messages_col.delete_many(
        {"room_address": address, "network": network}
    )
    return {"status": "ok", "deleted": result.deleted_count}
