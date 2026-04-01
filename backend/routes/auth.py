"""Authentication routes — DEPRECATED.

Auth is now 100% client-side (blockchain-as-identity).
The WIF private key is the identity — address derivation, encryption,
and on-chain profile lookup all happen in the browser.

These stub endpoints are kept only to prevent 404s from old clients.
They will be fully removed in a future cleanup.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api")


class DeprecatedRequest(BaseModel):
    pass


@router.post("/auth/signup")
async def auth_signup_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Use client-side WIF import.")


@router.post("/auth/login")
async def auth_login_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Use client-side WIF import.")


@router.post("/auth/import-key")
async def auth_import_key_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Use client-side WIF import.")


@router.get("/auth/me")
async def auth_me_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Identity is on-chain.")


@router.post("/auth/change-password")
async def auth_change_password_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Password is client-side only.")


@router.post("/auth/update-minted")
async def auth_update_minted_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Minted status is on-chain.")


@router.post("/auth/add-network-address")
async def auth_add_network_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. Addresses derived client-side.")


@router.post("/auth/rename-urn")
async def auth_rename_urn_deprecated():
    raise HTTPException(status_code=410, detail="Server auth removed. URN is on-chain.")
