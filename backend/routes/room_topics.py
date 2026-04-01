"""Room topics routes: register and fetch topic-parent relationships."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from db import db
from utils.helpers import get_root_by_txid

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
