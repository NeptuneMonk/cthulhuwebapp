"""
Treasury Auto-Checkpoint — Periodically bundles off-chain messages into
P2FK-compliant on-chain transactions funded by the treasury.

Flow:
  1. Gather uncheckpointed messages from chat_relay_messages
  2. Bundle into JSON, upload to IPFS (Kubo)
  3. Build a P2FK MSG transaction pointing to the IPFS CID
  4. Sign with treasury WIF, broadcast to the network
  5. Record in ledger and mark messages as checkpointed

SUP clients can then discover these checkpoint posts on-chain and
fetch the full message bundles from IPFS.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging
import json
import os
import asyncio

from db import db
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/checkpoint")

KUBO_API = "http://127.0.0.1:5001/api/v0"

# Default config
DEFAULT_CONFIG = {
    "enabled": False,
    "interval_minutes": 60,
    "min_messages": 10,
    "network": "btc-testnet",
    "last_checkpoint_at": None,
    "last_checkpoint_txid": None,
    "total_checkpoints": 0,
    "total_messages_checkpointed": 0,
}

config_col = db["checkpoint_config"]
checkpoint_col = db["checkpoint_history"]
messages_col = db["chat_relay_messages"]


def _get_admin_verify():
    from routes.admin import _verify_admin
    return _verify_admin


class CheckpointConfig(BaseModel):
    enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None
    min_messages: Optional[int] = None
    network: Optional[str] = None


# ─── Config Endpoints ───

@router.get("/status")
async def get_checkpoint_status(_=Depends(_get_admin_verify())):
    """Get auto-checkpoint config and status."""
    cfg = await config_col.find_one({"_id": "checkpoint_config"}, {"_id": 0})
    merged = dict(DEFAULT_CONFIG)
    if cfg:
        merged.update(cfg)

    # Count pending messages
    pending = await messages_col.count_documents({"checkpointed": False})

    # Recent checkpoints
    recent = await checkpoint_col.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).limit(10).to_list(10)

    return {
        **merged,
        "pending_messages": pending,
        "recent_checkpoints": recent,
    }


@router.post("/config")
async def update_config(body: CheckpointConfig, _=Depends(_get_admin_verify())):
    """Update auto-checkpoint configuration."""
    update = {}
    if body.enabled is not None:
        update["enabled"] = body.enabled
    if body.interval_minutes is not None:
        update["interval_minutes"] = max(5, body.interval_minutes)
    if body.min_messages is not None:
        update["min_messages"] = max(1, body.min_messages)
    if body.network is not None:
        update["network"] = body.network

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")

    await config_col.update_one(
        {"_id": "checkpoint_config"},
        {"$set": update},
        upsert=True,
    )
    return {"success": True, "updated": update}


# ─── Checkpoint Execution ───

async def _execute_checkpoint(network: str = "btc-testnet") -> dict:
    """Core checkpoint logic: bundle → IPFS → P2FK MSG → broadcast."""
    from bit import PrivateKeyTestnet, PrivateKey
    from utils.p2fk import (
        build_signed_payload, build_post_payload,
        encode_payload_to_addresses, get_keyword_address,
    )
    from utils.blockchain import fetch_utxos_mempool, broadcast_raw_tx

    is_mainnet = "mainnet" in network.lower()
    wif = os.environ.get("TREASURY_TESTNET_WIF", "") if not is_mainnet else os.environ.get("TREASURY_MAINNET_WIF", "")
    if not wif:
        raise HTTPException(status_code=503, detail="Treasury WIF not configured")

    # 1. Gather uncheckpointed messages
    cursor = messages_col.find(
        {"checkpointed": False}, {"_id": 0}
    ).sort("timestamp", 1)
    messages = await cursor.to_list(500)

    if not messages:
        return {"success": True, "skipped": True, "reason": "No messages to checkpoint"}

    # 2. Build bundle JSON (grouped by room)
    rooms = {}
    msg_ids = []
    for msg in messages:
        room = msg.get("room", "__unknown__")
        if room not in rooms:
            rooms[room] = []
        rooms[room].append({
            "id": msg.get("msg_id", ""),
            "sender": msg.get("sender", ""),
            "senderUrn": msg.get("senderUrn", ""),
            "content": msg.get("content", ""),
            "timestamp": msg.get("timestamp", ""),
            "encrypted": msg.get("encrypted", False),
        })
        msg_ids.append(msg.get("msg_id", ""))

    bundle = {
        "version": 1,
        "type": "cthulhu_checkpoint",
        "created": datetime.now(timezone.utc).isoformat(),
        "network": network,
        "messageCount": len(messages),
        "roomCount": len(rooms),
        "rooms": rooms,
    }
    bundle_json = json.dumps(bundle, separators=(",", ":"))
    bundle_bytes = bundle_json.encode("utf-8")

    # 3. Upload to IPFS
    client = get_client()
    try:
        resp = await client.post(
            f"{KUBO_API}/add?pin=true",
            files={"file": ("checkpoint.json", bundle_bytes, "application/json")},
            timeout=30.0,
        )
        if resp.status_code != 200:
            raise Exception(f"IPFS upload failed: {resp.text}")
        cid = resp.json().get("Hash", "")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IPFS upload failed: {e}")

    # 4. Build P2FK MSG transaction
    try:
        key = PrivateKeyTestnet(wif) if not is_mainnet else PrivateKey(wif)
        sender_address = key.address
        version_byte = 0 if is_mainnet else 111

        # Post content: references the IPFS bundle
        post_content = f"CTHULHU_CHECKPOINT ipfs://{cid} msgs:{len(messages)} rooms:{len(rooms)}"
        msg_payload = build_post_payload(post_content)
        signed_payload = build_signed_payload(msg_payload, wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(signed_payload, version_byte)

        # Add CTHULHU_CHECKPOINT keyword for discovery
        kw_addr = get_keyword_address("CTHULHU_CHECKPOINT", version_byte)
        full_list = list(encoded_addresses)
        if kw_addr not in full_list:
            full_list.append(kw_addr)

        # Add room keywords for per-room discovery
        for room_addr in list(rooms.keys())[:5]:  # Limit to 5 rooms to keep tx size manageable
            room_kw = get_keyword_address(room_addr[:20], version_byte)
            if room_kw not in full_list:
                full_list.append(room_kw)

        # Sender last (P2FK protocol)
        while sender_address in full_list:
            full_list.remove(sender_address)
        full_list.append(sender_address)

        num_outputs = len(full_list)
        outputs = [(addr, 546, "satoshi") for addr in full_list]

        # Fetch UTXOs
        utxos = await fetch_utxos_mempool(sender_address, is_mainnet=is_mainnet)
        if not utxos:
            raise HTTPException(status_code=400, detail=f"No UTXOs for treasury {sender_address}")
        key._unspents = utxos

        tx_hex = key.create_transaction(outputs)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transaction build failed: {e}")

    # 5. Broadcast
    result = await broadcast_raw_tx(tx_hex, is_mainnet)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown')}")

    txid = result["txid"]
    dust_cost = num_outputs * 546

    # 6. Record and mark messages
    await messages_col.update_many(
        {"msg_id": {"$in": msg_ids}},
        {"$set": {"checkpointed": True, "checkpoint_txid": txid}},
    )

    checkpoint_record = {
        "txid": txid,
        "cid": cid,
        "network": network,
        "message_count": len(messages),
        "room_count": len(rooms),
        "rooms": list(rooms.keys()),
        "bundle_size_bytes": len(bundle_bytes),
        "dust_cost_sats": dust_cost,
        "num_outputs": num_outputs,
        "sender": sender_address,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await checkpoint_col.insert_one(checkpoint_record)
    checkpoint_record.pop("_id", None)

    # Update config stats
    await config_col.update_one(
        {"_id": "checkpoint_config"},
        {"$set": {
            "last_checkpoint_at": checkpoint_record["created_at"],
            "last_checkpoint_txid": txid,
        },
         "$inc": {
             "total_checkpoints": 1,
             "total_messages_checkpointed": len(messages),
         }},
        upsert=True,
    )

    # ─── Post-Checkpoint Cleanup ───
    # Now that messages are on IPFS + blockchain, DELETE them from SQLite.
    # The DB is just a staging buffer — the chain is the permanent record.
    try:
        deleted = await messages_col.delete_many(
            {"msg_id": {"$in": msg_ids}, "checkpointed": True}
        )
        logger.info(f"[AutoCheckpoint] Cleaned up {deleted.deleted_count} checkpointed messages from DB")
    except Exception as cleanup_err:
        logger.warning(f"[AutoCheckpoint] DB cleanup failed (non-critical): {cleanup_err}")

    # Also clean up old unread counters for rooms that have been fully checkpointed
    try:
        for room_addr in rooms.keys():
            remaining = await messages_col.count_documents({"room": room_addr})
            if remaining == 0:
                # All messages for this room are on-chain now
                await db["chat_unread"].delete_many({"room": room_addr})
    except Exception:
        pass

    # Record in treasury ledger
    try:
        from routes.treasury import record_ledger_entry
        await record_ledger_entry(
            "checkpoint_expense", dust_cost, network,
            txid=txid, details=f"Auto-checkpoint: {len(messages)} msgs, {len(rooms)} rooms, CID={cid[:20]}..."
        )
    except Exception as e:
        logger.warning(f"Ledger recording failed: {e}")

    explorer_base = "https://mempool.space" + ("/testnet" if not is_mainnet else "")

    return {
        "success": True,
        "txid": txid,
        "cid": cid,
        "message_count": len(messages),
        "room_count": len(rooms),
        "dust_cost_sats": dust_cost,
        "mempool_url": f"{explorer_base}/tx/{txid}",
        "ipfs_url": f"https://ipfs.io/ipfs/{cid}",
        "checkpoint": checkpoint_record,
    }


@router.post("/trigger")
async def trigger_checkpoint(_=Depends(_get_admin_verify())):
    """Manually trigger a checkpoint."""
    cfg = await config_col.find_one({"_id": "checkpoint_config"}, {"_id": 0})
    network = (cfg or {}).get("network", "btc-testnet")
    return await _execute_checkpoint(network)


@router.get("/history")
async def get_checkpoint_history(
    limit: int = 20, skip: int = 0,
    _=Depends(_get_admin_verify()),
):
    """Get checkpoint transaction history."""
    cursor = checkpoint_col.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit)
    history = await cursor.to_list(limit)
    total = await checkpoint_col.count_documents({})
    return {"checkpoints": history, "total": total}


@router.get("/pending")
async def get_pending_messages(_=Depends(_get_admin_verify())):
    """Get count and preview of messages waiting to be checkpointed."""
    count = await messages_col.count_documents({"checkpointed": False})
    # Get sample messages
    cursor = messages_col.find(
        {"checkpointed": False}, {"_id": 0}
    ).sort("timestamp", -1).limit(5)
    sample = await cursor.to_list(5)
    # Get room breakdown
    all_pending = await messages_col.find(
        {"checkpointed": False}, {"_id": 0, "room": 1}
    ).to_list(1000)
    room_counts = {}
    for m in all_pending:
        r = m.get("room", "unknown")
        room_counts[r] = room_counts.get(r, 0) + 1

    return {
        "total_pending": count,
        "room_breakdown": room_counts,
        "recent_sample": sample,
    }


# ─── Background Auto-Checkpoint Task ───

_checkpoint_task = None


async def _auto_checkpoint_loop():
    """Background loop that checks and triggers checkpoints on schedule."""
    while True:
        try:
            cfg = await config_col.find_one({"_id": "checkpoint_config"}, {"_id": 0})
            if not cfg or not cfg.get("enabled"):
                await asyncio.sleep(60)
                continue

            interval = cfg.get("interval_minutes", 60) * 60
            min_msgs = cfg.get("min_messages", 10)
            network = cfg.get("network", "btc-testnet")

            # Check if enough messages are pending
            pending = await messages_col.count_documents({"checkpointed": False})
            if pending >= min_msgs:
                logger.info(f"[AutoCheckpoint] Triggering: {pending} pending messages (min={min_msgs})")
                try:
                    result = await _execute_checkpoint(network)
                    if result.get("success") and not result.get("skipped"):
                        logger.info(f"[AutoCheckpoint] Success: txid={result.get('txid')}, msgs={result.get('message_count')}")
                except Exception as e:
                    logger.error(f"[AutoCheckpoint] Failed: {e}")

            # ─── Periodic Stale Cache Cleanup ───
            # Keep the DB lightweight — purge caches older than 1 hour.
            # The chain/mesh/IPFS is the permanent store.
            try:
                cutoff = (datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=1)).isoformat()
                # Stale feed caches
                await db["conversation_cache"].delete_many({"timestamp": {"$lt": cutoff}})
                # Stale object/storefront caches
                await db["object_cache"].delete_many({"cached_at": {"$lt": cutoff}})
                # Stale on-chain file caches older than 24h (immutable content, longer TTL)
                onchain_cutoff = (datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=24)).isoformat()
                await db["onchain_cache"].delete_many({"timestamp": {"$lt": onchain_cutoff}, "failed": {"$ne": True}})
                # Purge failed on-chain resolutions older than 1 hour (allow retry)
                await db["onchain_cache"].delete_many({"failed": True, "timestamp": {"$lt": cutoff}})
            except Exception as ce:
                logger.debug(f"[AutoCheckpoint] Cache cleanup: {ce}")

            await asyncio.sleep(interval)

        except Exception as e:
            logger.error(f"[AutoCheckpoint] Loop error: {e}")
            await asyncio.sleep(120)


def start_auto_checkpoint():
    """Start the background auto-checkpoint task.
    Controlled by AUTO_VACUUM_ENABLED env var (shares the vacuum guard)."""
    global _checkpoint_task
    import os
    if os.environ.get("AUTO_VACUUM_ENABLED", "").lower() not in ("true", "1", "yes"):
        logger.info("[AutoCheckpoint] Skipped auto-start (AUTO_VACUUM_ENABLED not set)")
        return
    if _checkpoint_task is None or _checkpoint_task.done():
        _checkpoint_task = asyncio.create_task(_auto_checkpoint_loop())
        logger.info("[AutoCheckpoint] Background task started")


def stop_auto_checkpoint():
    """Stop the background auto-checkpoint task."""
    global _checkpoint_task
    if _checkpoint_task and not _checkpoint_task.done():
        _checkpoint_task.cancel()
        _checkpoint_task = None
        logger.info("[AutoCheckpoint] Background task stopped")
