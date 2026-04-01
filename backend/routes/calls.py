"""Call settings routes: manage user preferences for the walkie-talkie phone system."""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import logging
from datetime import datetime, timezone

from db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

call_settings_col = db['call_settings']


class CallSettingsUpdate(BaseModel):
    address: str
    network: str = 'btc-testnet'
    accept_calls: bool = True
    answering_machine_enabled: bool = False
    answering_machine_cid: Optional[str] = None
    answering_machine_max_seconds: int = 15
    status_message: Optional[str] = None


# NOTE: /batch route MUST be defined BEFORE /{address} to avoid FastAPI matching "batch" as an address
@router.get("/call-settings/batch")
async def batch_call_settings(addresses: str, network: str = 'btc-testnet'):
    """Check call settings for multiple addresses at once. Comma-separated."""
    addr_list = [a.strip() for a in addresses.split(',') if a.strip()][:50]
    cursor = call_settings_col.find(
        {"address": {"$in": addr_list}, "network": network},
        {"_id": 0}
    )
    results = {}
    async for doc in cursor:
        results[doc["address"]] = doc
    # Fill defaults for addresses not in DB
    for addr in addr_list:
        if addr not in results:
            results[addr] = {"address": addr, "accept_calls": True, "answering_machine_enabled": False}
    return {"settings": results}


@router.get("/call-settings/{address}")
async def get_call_settings(address: str, network: str = 'btc-testnet'):
    """Get a user's call/phone settings. Returns defaults if none set."""
    doc = await call_settings_col.find_one(
        {"address": address, "network": network},
        {"_id": 0}
    )
    if not doc:
        return {
            "address": address,
            "network": network,
            "accept_calls": True,
            "answering_machine_enabled": False,
            "answering_machine_cid": None,
            "answering_machine_max_seconds": 15,
            "status_message": None,
        }
    return doc


@router.post("/call-settings")
async def update_call_settings(req: CallSettingsUpdate):
    """Update a user's call/phone settings."""
    doc = {
        "address": req.address,
        "network": req.network,
        "accept_calls": req.accept_calls,
        "answering_machine_enabled": req.answering_machine_enabled,
        "answering_machine_cid": req.answering_machine_cid,
        "answering_machine_max_seconds": req.answering_machine_max_seconds,
        "status_message": req.status_message,
        "updated_at": datetime.now(timezone.utc),
    }
    await call_settings_col.update_one(
        {"address": req.address, "network": req.network},
        {"$set": doc},
        upsert=True,
    )
    return {"success": True, **{k: v for k, v in doc.items() if k != "updated_at"}}
