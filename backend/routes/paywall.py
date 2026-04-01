"""
Paywall routes — crypto one-time fee gate for Cthulhu access.
Supports BTC, LTC, DOGE treasury wallets.
Admin manually confirms payments.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import os

router = APIRouter(prefix="/api")

# Will be set by server.py
paywall_config_col = None
payment_requests_col = None
users_col = None


def init_collections(db):
    global paywall_config_col, payment_requests_col, users_col
    paywall_config_col = db.paywall_config
    payment_requests_col = db.payment_requests
    users_col = db.users


DEFAULT_CONFIG = {
    "enabled": False,
    "fee_usd": 5.00,
    "fee_description": "One-time access fee",
    "treasury_addresses": {
        "btc": "",
        "ltc": "",
        "doge": "",
    },
    "admin_urns": [],
}


async def get_config():
    doc = await paywall_config_col.find_one({"_id": "config"}, {"_id": 0})
    if not doc:
        return {**DEFAULT_CONFIG}
    return doc


async def is_admin(urn: str) -> bool:
    config = await get_config()
    admins = [u.lower() for u in config.get("admin_urns", [])]
    # Env var bootstrap: ADMIN_URNS=urn1,urn2
    env_admins = [u.strip().lower() for u in os.environ.get("ADMIN_URNS", "").split(",") if u.strip()]
    return urn.lower() in admins + env_admins


# ---------- Public endpoints ----------

@router.get("/paywall/config")
async def get_paywall_config():
    """Public: returns whether paywall is enabled and fee info."""
    config = await get_config()
    return {
        "enabled": config.get("enabled", False),
        "fee_usd": config.get("fee_usd", 5.00),
        "fee_description": config.get("fee_description", "One-time access fee"),
        "treasury_addresses": config.get("treasury_addresses", {}),
    }


@router.get("/paywall/status/{urn}")
async def get_paywall_status(urn: str):
    """Check if a user has paid or has a pending payment."""
    config = await get_config()
    if not config.get("enabled", False):
        return {"paid": True, "status": "paywall_disabled"}

    user = await users_col.find_one({"urn_lower": urn.lower()}, {"_id": 0, "paid": 1, "urn": 1})
    if not user:
        return {"paid": False, "status": "user_not_found"}

    if user.get("paid", False):
        return {"paid": True, "status": "confirmed"}

    # Check for pending payment request
    pending = await payment_requests_col.find_one(
        {"urn_lower": urn.lower(), "status": "pending"},
        {"_id": 0}
    )
    if pending:
        return {"paid": False, "status": "pending", "chain": pending.get("chain"), "created_at": pending.get("created_at")}

    return {"paid": False, "status": "unpaid"}


class PaymentRequestBody(BaseModel):
    urn: str
    chain: str  # btc | ltc | doge
    txid: Optional[str] = ""
    note: Optional[str] = ""


@router.post("/paywall/request")
async def create_payment_request(body: PaymentRequestBody):
    """User submits that they've sent payment."""
    config = await get_config()
    if not config.get("enabled", False):
        return {"status": "paywall_disabled"}

    if body.chain not in ("btc", "ltc", "doge"):
        raise HTTPException(status_code=400, detail="Invalid chain. Must be btc, ltc, or doge.")

    treasury = config.get("treasury_addresses", {}).get(body.chain, "")
    if not treasury:
        raise HTTPException(status_code=400, detail=f"No treasury address configured for {body.chain}")

    # Upsert: update existing pending or create new
    await payment_requests_col.update_one(
        {"urn_lower": body.urn.lower()},
        {"$set": {
            "urn": body.urn,
            "urn_lower": body.urn.lower(),
            "chain": body.chain,
            "treasury_address": treasury,
            "txid": body.txid or "",
            "note": body.note or "",
            "fee_usd": config.get("fee_usd", 5.00),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"status": "pending", "message": "Payment request submitted. Access will be granted once verified."}


# ---------- Admin endpoints ----------

class AdminConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    fee_usd: Optional[float] = None
    fee_description: Optional[str] = None
    treasury_btc: Optional[str] = None
    treasury_ltc: Optional[str] = None
    treasury_doge: Optional[str] = None
    admin_urns: Optional[list] = None


@router.post("/paywall/admin/config")
async def update_paywall_config(body: AdminConfigUpdate, admin_urn: str = ""):
    """Admin: update paywall configuration."""
    if not admin_urn or not await is_admin(admin_urn):
        raise HTTPException(status_code=403, detail="Not authorized")

    _ = await get_config()  # verify DB access
    update = {}

    if body.enabled is not None:
        update["enabled"] = body.enabled
    if body.fee_usd is not None:
        update["fee_usd"] = body.fee_usd
    if body.fee_description is not None:
        update["fee_description"] = body.fee_description
    if body.treasury_btc is not None:
        update["treasury_addresses.btc"] = body.treasury_btc
    if body.treasury_ltc is not None:
        update["treasury_addresses.ltc"] = body.treasury_ltc
    if body.treasury_doge is not None:
        update["treasury_addresses.doge"] = body.treasury_doge
    if body.admin_urns is not None:
        update["admin_urns"] = body.admin_urns

    if update:
        await paywall_config_col.update_one(
            {"_id": "config"},
            {"$set": update},
            upsert=True,
        )

    return {"status": "ok", "updated": list(update.keys())}


class AdminConfirmPayment(BaseModel):
    urn: str


@router.post("/paywall/admin/confirm")
async def confirm_payment(body: AdminConfirmPayment, admin_urn: str = ""):
    """Admin: confirm a user's payment and grant access."""
    if not admin_urn or not await is_admin(admin_urn):
        raise HTTPException(status_code=403, detail="Not authorized")

    # Mark user as paid
    result = await users_col.update_one(
        {"urn_lower": body.urn.lower()},
        {"$set": {"paid": True, "paid_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # Update payment request status
    await payment_requests_col.update_one(
        {"urn_lower": body.urn.lower()},
        {"$set": {
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "confirmed_by": admin_urn,
        }}
    )

    return {"status": "ok", "message": f"Access granted to {body.urn}"}


class AdminRejectPayment(BaseModel):
    urn: str
    reason: Optional[str] = ""


@router.post("/paywall/admin/reject")
async def reject_payment(body: AdminRejectPayment, admin_urn: str = ""):
    """Admin: reject a payment request."""
    if not admin_urn or not await is_admin(admin_urn):
        raise HTTPException(status_code=403, detail="Not authorized")

    await payment_requests_col.update_one(
        {"urn_lower": body.urn.lower()},
        {"$set": {
            "status": "rejected",
            "rejected_at": datetime.now(timezone.utc).isoformat(),
            "rejected_by": admin_urn,
            "reject_reason": body.reason or "",
        }}
    )
    return {"status": "ok", "message": f"Payment request for {body.urn} rejected"}


@router.get("/paywall/admin/pending")
async def get_pending_payments(admin_urn: str = ""):
    """Admin: list all pending payment requests."""
    if not admin_urn or not await is_admin(admin_urn):
        raise HTTPException(status_code=403, detail="Not authorized")

    cursor = payment_requests_col.find({"status": "pending"}, {"_id": 0})
    pending = await cursor.to_list(length=100)
    return {"pending": pending, "count": len(pending)}


@router.get("/paywall/admin/all")
async def get_all_payments(admin_urn: str = "", skip: int = 0, limit: int = 50):
    """Admin: list all payment requests."""
    if not admin_urn or not await is_admin(admin_urn):
        raise HTTPException(status_code=403, detail="Not authorized")

    cursor = payment_requests_col.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    payments = await cursor.to_list(length=limit)
    return {"payments": payments, "count": len(payments)}
