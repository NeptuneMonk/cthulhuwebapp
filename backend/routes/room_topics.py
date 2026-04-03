"""Room topics routes: register and fetch topic-parent relationships."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import asyncio
import logging
from db import db
from utils.helpers import get_root_by_txid, p2fk_get, format_object_for_api

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")
room_topics_col = db['room_topics']


class RegisterTopicRequest(BaseModel):
    parent_address: str
    topic_address: str
    network: str = "btc-testnet"
    name: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    creator_address: Optional[str] = None  # Address of the user creating the topic


@router.post("/rooms/register-topic")
async def register_topic(req: RegisterTopicRequest):
    """Register a topic under a parent room. Only the parent's creator can add topics."""
    # Verify the requester is the creator of the parent object
    if req.creator_address and req.parent_address:
        is_mainnet = "mainnet" in req.network.lower()
        try:
            parent_root = await get_root_by_txid(req.parent_address, is_mainnet)
            if isinstance(parent_root, dict):
                keywords = parent_root.get("Keyword") or {}
                kw_keys = list(keywords.keys())
                # In P2FK, the creator is the last keyword key (the signing address)
                parent_creator = kw_keys[-1] if kw_keys else None
                if parent_creator and parent_creator != req.creator_address:
                    raise HTTPException(
                        status_code=403,
                        detail="Only the parent object creator can add topics"
                    )
        except HTTPException:
            raise
        except Exception:
            pass  # If root lookup fails, allow registration (graceful degradation)

    await room_topics_col.update_one(
        {"topic_address": req.topic_address, "network": req.network},
        {"$set": {
            "parent_address": req.parent_address,
            "topic_address": req.topic_address,
            "network": req.network,
            "name": req.name,
            "description": req.description,
            "image": req.image,
            "creator_address": req.creator_address,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$setOnInsert": {
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


@router.get("/rooms/{parent_address}/topics")
async def get_topics(parent_address: str, network: str = "btc-testnet"):
    """Fetch all registered topics for a parent room."""
    docs = await room_topics_col.find(
        {"parent_address": parent_address, "network": network},
        {"_id": 0},
    ).to_list(500)
    return {"topics": docs, "count": len(docs)}


@router.get("/rooms/{parent_address}/owned-subtopics/{owner_address}")
async def get_owned_subtopics(parent_address: str, owner_address: str, network: str = "btc-testnet"):
    """Fetch sub-topics of a parent tether that are owned by a specific address.
    Used for cascade transfer: when giving a parent tether, find all child topics
    that the sender also owns so they can be transferred together."""
    is_mainnet = "mainnet" in network.lower()

    # 1. Get registered topics from local DB
    docs = await room_topics_col.find(
        {"parent_address": parent_address, "network": network},
        {"_id": 0},
    ).to_list(500)

    topic_addresses = [d["topic_address"] for d in docs if d.get("topic_address")]

    if not topic_addresses:
        return {"subtopics": [], "count": 0}

    # 2. Check ownership for each topic (parallel, capped)
    sem = asyncio.Semaphore(5)
    owned_topics = []

    async def _check_ownership(topic_addr, topic_doc):
        async with sem:
            try:
                obj_data = await p2fk_get(f"GetObjectByAddress/{topic_addr}", is_mainnet)
                if not isinstance(obj_data, dict):
                    return
                owners = obj_data.get("Owners") or {}
                if isinstance(owners, dict) and owner_address in owners:
                    qty = owners[owner_address]
                    # Parse quantity (can be int or string)
                    try:
                        qty = int(qty) if not isinstance(qty, int) else qty
                    except (ValueError, TypeError):
                        qty = 0
                    if qty > 0:
                        owned_topics.append({
                            "topic_address": topic_addr,
                            "name": topic_doc.get("name") or obj_data.get("Name", "Sub-topic"),
                            "image": topic_doc.get("image") or obj_data.get("Image", ""),
                            "description": topic_doc.get("description") or obj_data.get("Description", ""),
                            "owned_quantity": qty,
                        })
            except Exception as e:
                logger.debug(f"Ownership check failed for {topic_addr}: {e}")

    topic_doc_map = {d["topic_address"]: d for d in docs if d.get("topic_address")}
    await asyncio.gather(*[
        _check_ownership(addr, topic_doc_map.get(addr, {}))
        for addr in topic_addresses
    ])

    return {"subtopics": owned_topics, "count": len(owned_topics)}
