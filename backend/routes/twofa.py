"""Two-Factor Authentication (TOTP) routes."""
import os
import pyotp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

router = APIRouter(prefix="/api/auth")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


def get_db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


class Enable2FARequest(BaseModel):
    urn: str


class Verify2FARequest(BaseModel):
    urn: str
    code: str


@router.post("/2fa/setup")
async def setup_2fa(req: Enable2FARequest):
    """Generate a new TOTP secret for the user and return the provisioning URI."""
    db = get_db()
    user = await db.users.find_one({"urn": req.urn}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Generate new secret
    secret = pyotp.random_base32()

    # Store (not yet activated — activated after first successful verify)
    await db.users.update_one(
        {"urn": req.urn},
        {"$set": {"totp_secret": secret, "totp_enabled": False}}
    )

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=req.urn, issuer_name="Cthulhu")

    return {
        "secret": secret,
        "uri": provisioning_uri,
    }


@router.post("/2fa/verify")
async def verify_2fa(req: Verify2FARequest):
    """Verify a TOTP code and activate 2FA if it's the first successful verification."""
    db = get_db()
    user = await db.users.find_one({"urn": req.urn}, {"_id": 0, "totp_secret": 1, "totp_enabled": 1})
    if not user or not user.get("totp_secret"):
        raise HTTPException(status_code=400, detail="2FA not set up")

    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(req.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    # If not yet enabled, activate it now
    if not user.get("totp_enabled"):
        await db.users.update_one(
            {"urn": req.urn},
            {"$set": {"totp_enabled": True}}
        )

    return {"verified": True, "enabled": True}


@router.post("/2fa/check")
async def check_2fa(req: Enable2FARequest):
    """Check if 2FA is enabled for a user."""
    db = get_db()
    user = await db.users.find_one({"urn": req.urn}, {"_id": 0, "totp_enabled": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {"enabled": user.get("totp_enabled", False)}


@router.post("/2fa/disable")
async def disable_2fa(req: Verify2FARequest):
    """Disable 2FA (requires valid current code)."""
    db = get_db()
    user = await db.users.find_one({"urn": req.urn}, {"_id": 0, "totp_secret": 1, "totp_enabled": 1})
    if not user or not user.get("totp_secret"):
        raise HTTPException(status_code=400, detail="2FA not set up")

    totp = pyotp.TOTP(user["totp_secret"])
    if not totp.verify(req.code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    await db.users.update_one(
        {"urn": req.urn},
        {"$unset": {"totp_secret": "", "totp_enabled": ""}}
    )

    return {"disabled": True}
