"""
Media library — favorites, playlists, and play tracking.
Persisted in MongoDB so it survives cache clears.
"""
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from db import db

router = APIRouter(prefix="/api/favorites")
col = db["media_library"]


class AddFavoritePayload(BaseModel):
    address: str
    network: str
    url: str
    fallbackUrl: Optional[str] = ""
    name: str
    type: str  # "audio" | "video"
    chain: Optional[str] = ""
    image: Optional[str] = ""
    imageFallback: Optional[str] = ""


class RemoveFavoritePayload(BaseModel):
    address: str
    network: str
    id: str


class RecordPlayPayload(BaseModel):
    address: str
    network: str
    id: str


class PlaylistPayload(BaseModel):
    address: str
    network: str
    id: Optional[str] = None
    name: str
    itemIds: Optional[list] = []


class PlaylistItemPayload(BaseModel):
    address: str
    network: str
    playlistId: str
    itemId: str


class DeletePlaylistPayload(BaseModel):
    address: str
    network: str
    id: str


def _key(address: str, network: str):
    return {"address": address, "network": network}


@router.get("/{address}")
async def get_library(address: str, network: str = "btc-testnet"):
    doc = await col.find_one(_key(address, network), {"_id": 0})
    if not doc:
        return {"address": address, "network": network, "favorites": [], "playlists": []}
    doc.setdefault("favorites", [])
    doc.setdefault("playlists", [])
    return doc


@router.post("/add")
async def add_favorite(p: AddFavoritePayload):
    doc = await col.find_one(_key(p.address, p.network))
    favorites = (doc or {}).get("favorites", [])
    # Deduplicate by URL
    if any(f["url"] == p.url for f in favorites):
        return {"success": True, "message": "Already favorited"}
    item = {
        "id": str(uuid4()),
        "url": p.url,
        "fallbackUrl": p.fallbackUrl or "",
        "name": p.name,
        "type": p.type,
        "chain": p.chain or "",
        "image": p.image or "",
        "imageFallback": p.imageFallback or "",
        "addedAt": datetime.now(timezone.utc).isoformat(),
        "playCount": 0,
        "lastPlayed": None,
    }
    await col.update_one(
        _key(p.address, p.network),
        {"$push": {"favorites": item}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True, "item": item}


@router.post("/remove")
async def remove_favorite(p: RemoveFavoritePayload):
    await col.update_one(
        _key(p.address, p.network),
        {"$pull": {"favorites": {"id": p.id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


@router.post("/play")
async def record_play(p: RecordPlayPayload):
    now = datetime.now(timezone.utc).isoformat()
    await col.update_one(
        {**_key(p.address, p.network), "favorites.id": p.id},
        {"$inc": {"favorites.$.playCount": 1}, "$set": {"favorites.$.lastPlayed": now, "updated_at": now}},
    )
    return {"success": True}


@router.post("/playlist")
async def upsert_playlist(p: PlaylistPayload):
    if p.id:
        # Update existing playlist
        await col.update_one(
            {**_key(p.address, p.network), "playlists.id": p.id},
            {"$set": {"playlists.$.name": p.name, "playlists.$.itemIds": p.itemIds or [], "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"success": True, "id": p.id}
    # Create new
    playlist = {
        "id": str(uuid4()),
        "name": p.name,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "itemIds": p.itemIds or [],
    }
    await col.update_one(
        _key(p.address, p.network),
        {"$push": {"playlists": playlist}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True, "id": playlist["id"]}


@router.post("/playlist/add-item")
async def add_to_playlist(p: PlaylistItemPayload):
    await col.update_one(
        {**_key(p.address, p.network), "playlists.id": p.playlistId},
        {"$addToSet": {"playlists.$.itemIds": p.itemId}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


@router.post("/playlist/remove-item")
async def remove_from_playlist(p: PlaylistItemPayload):
    await col.update_one(
        {**_key(p.address, p.network), "playlists.id": p.playlistId},
        {"$pull": {"playlists.$.itemIds": p.itemId}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}


@router.post("/playlist/delete")
async def delete_playlist(p: DeletePlaylistPayload):
    await col.update_one(
        _key(p.address, p.network),
        {"$pull": {"playlists": {"id": p.id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True}
