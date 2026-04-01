"""Admin Wallet — Bitcoin Core-style wallet with address pool, encrypted key storage.

Provides a pool of 50 pre-generated addresses, import key functionality,
transaction history, and balance tracking — all without syncing the blockchain.
Uses mempool.space APIs for balance and UTXO queries.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime, timezone
import logging
import os
import json
import secrets
import base64

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from bit import PrivateKeyTestnet, PrivateKey

from db import db
from utils.blockchain import fetch_utxos_mempool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/wallet")

POOL_SIZE = 50

# In-memory decrypted key cache (session-based, cleared on restart)
_key_cache = {}  # { session_id: { keys: {...}, expires: timestamp } }
CACHE_TTL = 3600  # 1 hour


# ─── Crypto helpers ───

def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100_000)
    return kdf.derive(password.encode('utf-8'))


def _encrypt_keys(keys_json: str, password: str) -> dict:
    salt = secrets.token_bytes(16)
    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)
    nonce = secrets.token_bytes(12)
    ct = aesgcm.encrypt(nonce, keys_json.encode('utf-8'), None)
    return {
        "salt": base64.b64encode(salt).decode(),
        "nonce": base64.b64encode(nonce).decode(),
        "ciphertext": base64.b64encode(ct).decode(),
    }


def _decrypt_keys(enc: dict, password: str) -> str:
    salt = base64.b64decode(enc["salt"])
    nonce = base64.b64decode(enc["nonce"])
    ct = base64.b64decode(enc["ciphertext"])
    key = _derive_key(password, salt)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode('utf-8')


def _get_admin_verify():
    from routes.admin import _verify_admin
    return _verify_admin


# ─── Models ───

class InitWalletRequest(BaseModel):
    password: str
    network: str = "btc-testnet"
    import_treasury: bool = True


class UnlockRequest(BaseModel):
    password: str


class ImportKeyRequest(BaseModel):
    wif: str
    label: str = ""
    password: str
    network: str = ""


class LabelRequest(BaseModel):
    label: str


# ─── Endpoints ───

@router.get("/status")
async def wallet_status(_=Depends(_get_admin_verify())):
    """Check if admin wallet exists and its basic info."""
    wallet = await db.admin_wallet.find_one({"_id": "wallet_config"}, {"_id": 0, "encrypted_keys": 0})
    if not wallet:
        return {"initialized": False}
    addr_count = await db.admin_wallet_addresses.count_documents({})
    return {
        "initialized": True,
        "network": wallet.get("network", "btc-testnet"),
        "address_count": addr_count,
        "created_at": wallet.get("created_at"),
    }


@router.post("/init")
async def init_wallet(req: InitWalletRequest, _=Depends(_get_admin_verify())):
    """Initialize the admin wallet with a pool of addresses."""
    existing = await db.admin_wallet.find_one({"_id": "wallet_config"})
    if existing:
        raise HTTPException(status_code=400, detail="Wallet already initialized. Use import-key to add more keys.")

    is_testnet = "testnet" in req.network
    keys = {}
    addresses = []

    # Import treasury WIF as first address if requested
    if req.import_treasury:
        treasury_wif = os.environ.get("TREASURY_TESTNET_WIF", "")
        if treasury_wif:
            try:
                k = PrivateKeyTestnet(treasury_wif) if is_testnet else PrivateKey(treasury_wif)
                keys[k.address] = treasury_wif
                addresses.append({
                    "address": k.address,
                    "index": 0,
                    "label": "Treasury Testnet (imported)",
                    "source": "treasury_env",
                    "network": "btc-testnet",
                    "used": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.warning(f"Failed to import testnet treasury WIF: {e}")

        # Also import mainnet treasury WIF if available
        mainnet_wif = os.environ.get("TREASURY_MAINNET_WIF", "")
        if mainnet_wif:
            try:
                mk = PrivateKey(mainnet_wif)
                keys[mk.address] = mainnet_wif
                addresses.append({
                    "address": mk.address,
                    "index": len(addresses),
                    "label": "Treasury Mainnet (imported)",
                    "source": "treasury_env",
                    "network": "btc-mainnet",
                    "used": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.warning(f"Failed to import mainnet treasury WIF: {e}")

    # Generate remaining addresses to fill pool
    start_idx = len(addresses)
    for i in range(start_idx, POOL_SIZE):
        k = PrivateKeyTestnet() if is_testnet else PrivateKey()
        keys[k.address] = k.to_wif()
        addresses.append({
            "address": k.address,
            "index": i,
            "label": "",
            "source": "generated",
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Encrypt all keys
    encrypted = _encrypt_keys(json.dumps(keys), req.password)

    # Store wallet config
    await db.admin_wallet.insert_one({
        "_id": "wallet_config",
        "encrypted_keys": encrypted,
        "network": req.network,
        "pool_size": POOL_SIZE,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Store addresses (public, no keys)
    if addresses:
        await db.admin_wallet_addresses.insert_many(addresses)

    return {
        "success": True,
        "address_count": len(addresses),
        "network": req.network,
        "first_address": addresses[0]["address"] if addresses else None,
    }


@router.get("/addresses")
async def list_addresses(_=Depends(_get_admin_verify())):
    """List all wallet addresses with labels."""
    addrs = await db.admin_wallet_addresses.find(
        {}, {"_id": 0}
    ).sort("index", 1).to_list(200)
    return {"addresses": addrs}


@router.get("/next-address")
async def get_next_address(_=Depends(_get_admin_verify())):
    """Get the next unused address from the pool."""
    addr = await db.admin_wallet_addresses.find_one(
        {"used": False}, {"_id": 0}, sort=[("index", 1)]
    )
    if not addr:
        raise HTTPException(status_code=404, detail="No unused addresses. Import more keys.")
    return addr


@router.put("/addresses/{address}/label")
async def update_label(address: str, body: LabelRequest, _=Depends(_get_admin_verify())):
    """Update the label for an address."""
    result = await db.admin_wallet_addresses.update_one(
        {"address": address}, {"$set": {"label": body.label}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Address not found")
    return {"success": True}


@router.put("/addresses/{address}/mark-used")
async def mark_used(address: str, _=Depends(_get_admin_verify())):
    """Mark an address as used."""
    await db.admin_wallet_addresses.update_one(
        {"address": address}, {"$set": {"used": True}}
    )
    return {"success": True}


@router.post("/import-key")
async def import_key(req: ImportKeyRequest, _=Depends(_get_admin_verify())):
    """Import a WIF private key into the wallet."""
    wallet = await db.admin_wallet.find_one({"_id": "wallet_config"})
    if not wallet:
        raise HTTPException(status_code=400, detail="Wallet not initialized")

    # Use request network if provided, otherwise fall back to wallet config
    net = req.network if req.network else wallet.get("network", "btc-testnet")
    is_testnet = "testnet" in net

    # Validate WIF — try specified network first, then try the other
    try:
        k = PrivateKeyTestnet(req.wif) if is_testnet else PrivateKey(req.wif)
        address = k.address
    except Exception:
        # Try opposite network in case user specified wrong one
        try:
            k = PrivateKey(req.wif) if is_testnet else PrivateKeyTestnet(req.wif)
            address = k.address
            net = "btc-testnet" if not is_testnet else "btc-mainnet"
            is_testnet = not is_testnet
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

    # Check if already exists
    existing = await db.admin_wallet_addresses.find_one({"address": address})
    if existing:
        raise HTTPException(status_code=400, detail=f"Address {address} already in wallet")

    # Decrypt existing keys, add new, re-encrypt
    try:
        keys_json = _decrypt_keys(wallet["encrypted_keys"], req.password)
        keys = json.loads(keys_json)
    except Exception:
        raise HTTPException(status_code=403, detail="Wrong password")

    keys[address] = req.wif
    new_encrypted = _encrypt_keys(json.dumps(keys), req.password)

    await db.admin_wallet.update_one(
        {"_id": "wallet_config"},
        {"$set": {"encrypted_keys": new_encrypted}}
    )

    # Get next index
    max_idx = await db.admin_wallet_addresses.find_one(
        {}, {"index": 1}, sort=[("index", -1)]
    )
    next_idx = (max_idx["index"] + 1) if max_idx else 0

    await db.admin_wallet_addresses.insert_one({
        "address": address,
        "index": next_idx,
        "label": req.label or "Imported",
        "source": "imported",
        "network": net,
        "used": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Clear key cache (keys changed)
    _key_cache.clear()

    return {"success": True, "address": address, "index": next_idx}


@router.post("/unlock")
async def unlock_wallet(req: UnlockRequest, _=Depends(_get_admin_verify())):
    """Unlock the wallet by decrypting keys into memory cache."""
    wallet = await db.admin_wallet.find_one({"_id": "wallet_config"})
    if not wallet:
        raise HTTPException(status_code=400, detail="Wallet not initialized")

    try:
        keys_json = _decrypt_keys(wallet["encrypted_keys"], req.password)
        keys = json.loads(keys_json)
    except Exception:
        raise HTTPException(status_code=403, detail="Wrong password — cannot decrypt wallet")

    import time
    session_id = secrets.token_hex(16)
    _key_cache[session_id] = {
        "keys": keys,
        "expires": time.time() + CACHE_TTL,
        "network": wallet.get("network", "btc-testnet"),
    }

    return {"success": True, "session_id": session_id, "key_count": len(keys)}


def get_cached_keys(session_id: str) -> dict:
    """Get decrypted keys from cache. Returns None if expired or not found."""
    import time
    entry = _key_cache.get(session_id)
    if not entry or time.time() > entry["expires"]:
        _key_cache.pop(session_id, None)
        return None
    return entry


@router.get("/balance")
async def get_wallet_balance(network: str = "", _=Depends(_get_admin_verify())):
    """Get total balance across all wallet addresses, optionally filtered by network."""
    # If network specified, filter addresses by it
    query = {}
    if network:
        query["network"] = network
    addrs = await db.admin_wallet_addresses.find(query, {"_id": 0, "address": 1, "network": 1}).to_list(200)
    if not addrs:
        return {"total_sats": 0, "total_btc": "0.00000000", "address_balances": []}

    total = 0
    balances = []

    for a in addrs[:10]:
        addr = a["address"]
        addr_net = a.get("network", "btc-testnet")
        is_testnet = "testnet" in addr_net
        try:
            utxos = await fetch_utxos_mempool(addr, is_mainnet=not is_testnet)
            bal = sum(u.amount for u in utxos)
            total += bal
            if bal > 0:
                balances.append({"address": addr, "balance_sats": bal, "network": addr_net})
        except Exception as e:
            logger.warning(f"Balance check failed for {addr}: {e}")

    return {
        "total_sats": total,
        "total_btc": f"{total / 1e8:.8f}",
        "address_balances": balances,
    }


@router.get("/history")
async def get_wallet_history(limit: int = 50, _=Depends(_get_admin_verify())):
    """Get transaction history from the ledger."""
    # Use treasury ledger as history source
    history = await db.admin_wallet_history.find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)

    return {"transactions": history, "count": len(history)}


@router.post("/record-tx")
async def record_transaction(
    txid: str, tx_type: str, amount_sats: int,
    address: str = "", details: str = "",
    _=Depends(_get_admin_verify())
):
    """Record a transaction in wallet history."""
    await db.admin_wallet_history.insert_one({
        "txid": txid,
        "type": tx_type,
        "amount_sats": amount_sats,
        "address": address,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True}


async def record_wallet_tx(txid: str, tx_type: str, amount_sats: int,
                           address: str = "", details: str = ""):
    """Helper to record transactions from other routes."""
    await db.admin_wallet_history.insert_one({
        "txid": txid,
        "type": tx_type,
        "amount_sats": amount_sats,
        "address": address,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# ─── Import Treasury WIF (per-network, stored encrypted in DB) ───

class ImportTreasuryWIF(BaseModel):
    wif: str
    network: str = "btc-mainnet"
    password: str  # admin wallet password to encrypt


@router.post("/import-treasury")
async def import_treasury_wif(req: ImportTreasuryWIF, _=Depends(_get_admin_verify())):
    """Import a treasury WIF for a specific network. Stored encrypted in DB."""
    from bit import PrivateKeyTestnet, PrivateKey

    is_testnet = "testnet" in req.network.lower()
    try:
        key = PrivateKeyTestnet(req.wif) if is_testnet else PrivateKey(req.wif)
        address = key.address
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid WIF: {e}")

    # Encrypt the WIF
    encrypted = _encrypt_keys(req.wif, req.password)

    # Upsert: one treasury WIF per network
    await db.treasury_keys.update_one(
        {"network": req.network},
        {"$set": {
            "network": req.network,
            "address": address,
            "encrypted_wif": encrypted,
            "imported_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )

    # Also add to wallet addresses if not already there
    existing = await db.admin_wallet_addresses.find_one({"address": address})
    if not existing:
        count = await db.admin_wallet_addresses.count_documents({})
        await db.admin_wallet_addresses.insert_one({
            "address": address,
            "index": count,
            "label": f"Treasury {'Testnet' if is_testnet else 'Mainnet'} (imported)",
            "source": "treasury_import",
            "network": req.network,
            "used": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    return {
        "success": True,
        "address": address,
        "network": req.network,
    }


@router.get("/treasury-address/{network}")
async def get_treasury_address_for_network(network: str, _=Depends(_get_admin_verify())):
    """Get the imported treasury address for a given network."""
    rec = await db.treasury_keys.find_one({"network": network}, {"_id": 0, "address": 1, "network": 1, "imported_at": 1})
    if not rec:
        # Fall back to env-derived address
        from routes.treasury import _get_treasury_address
        addr = _get_treasury_address(network)
        return {"address": addr, "network": network, "source": "env"}
    return {"address": rec["address"], "network": network, "source": "imported", "imported_at": rec.get("imported_at")}


async def get_treasury_wif_for_network(network: str, password: str = None):
    """Helper: get decrypted treasury WIF for a network (DB first, then env)."""
    rec = await db.treasury_keys.find_one({"network": network})
    if rec and rec.get("encrypted_wif") and password:
        try:
            return _decrypt_keys(rec["encrypted_wif"], password)
        except Exception:
            pass
    # Fall back to env
    is_mainnet = "mainnet" in network.lower()
    return os.environ.get("TREASURY_MAINNET_WIF", "") if is_mainnet else os.environ.get("TREASURY_TESTNET_WIF", "")
