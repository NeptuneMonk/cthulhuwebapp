"""
User state persistence — survives cache clears.
Stores follows, pinned friends, and tethered rooms in MongoDB.
"""
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from db import db

router = APIRouter(prefix="/api")
user_state_col = db["user_state"]


class UserStatePayload(BaseModel):
    address: str
    network: str
    follows: Optional[list] = None
    pinned_friends: Optional[list] = None
    tethered_rooms: Optional[list] = None


@router.get("/user-state/{address}")
async def get_user_state(address: str, network: str = "btc-testnet"):
    doc = await user_state_col.find_one(
        {"address": address, "network": network},
        {"_id": 0}
    )
    if not doc:
        return {"address": address, "network": network, "follows": [], "pinned_friends": [], "tethered_rooms": []}
    # Ensure all fields have defaults even if not set in document
    doc.setdefault("follows", [])
    doc.setdefault("pinned_friends", [])
    doc.setdefault("tethered_rooms", [])
    return doc


@router.post("/user-state")
async def save_user_state(payload: UserStatePayload):
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.follows is not None:
        update["follows"] = payload.follows
    if payload.pinned_friends is not None:
        update["pinned_friends"] = payload.pinned_friends
    if payload.tethered_rooms is not None:
        update["tethered_rooms"] = payload.tethered_rooms

    await user_state_col.update_one(
        {"address": payload.address, "network": payload.network},
        {"$set": update, "$setOnInsert": {"address": payload.address, "network": payload.network}},
        upsert=True
    )
    return {"success": True}
