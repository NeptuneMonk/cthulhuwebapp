"""Emoji sticker caching routes."""
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime, timezone

from db import db

router = APIRouter(prefix="/api/emoji", tags=["emoji"])
cached_emojis_col = db["cached_emojis"]


class EmojiCacheRequest(BaseModel):
    emoji: str
    address: str = ""


@router.post("/cache")
async def cache_emoji(req: EmojiCacheRequest):
    emoji = req.emoji.strip()
    if not emoji or len(emoji) > 20:
        return {"ok": False}
    await cached_emojis_col.update_one(
        {"emoji": emoji},
        {
            "$inc": {"count": 1},
            "$set": {"last_used": datetime.now(timezone.utc).isoformat()},
            "$setOnInsert": {"emoji": emoji, "created_at": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
    )
    return {"ok": True}


@router.get("/popular")
async def popular_emojis(limit: int = 20):
    cursor = cached_emojis_col.find({}, {"_id": 0}).sort("count", -1).limit(limit)
    results = await cursor.to_list(length=limit)
    return {"emojis": results}
