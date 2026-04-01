"""
Vault — Backend-persisted encrypted storage with pattern lock support.
Items are double-encrypted (wallet ECIES + pattern AES) and stored in MongoDB.
The backend never has access to decryption keys.

On-chain vault backups use P2FK posts with keyword CTHULHU_VAULT on testnet.
"""
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter
from pydantic import BaseModel
import logging
from db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vault")
col = db["vault_items"]
pattern_col = db["vault_patterns"]


class SaveItemPayload(BaseModel):
    address: str
    network: str
    encrypted_blob: str  # base64 double-encrypted data
    label: str = ""
    category: str = "notes"  # notes | images | videos | files
    original_name: str = ""
    file_size: int = 0


class UpdateLabelPayload(BaseModel):
    address: str
    network: str
    item_id: str
    label: str


class DeleteItemPayload(BaseModel):
    address: str
    network: str
    item_id: str


class SavePatternPayload(BaseModel):
    address: str
    network: str
    verification_hash: str  # SHA-256 of pattern-derived key
    salt: str  # hex-encoded salt for PBKDF2


class MigrateItemPayload(BaseModel):
    address: str
    network: str
    txid: str  # original on-chain txid
    encrypted_blob: str  # re-encrypted with pattern layer
    label: str = ""
    category: str = "notes"
    original_name: str = ""
    file_size: int = 0
    timestamp: str = ""


def _key(address: str, network: str):
    return {"address": address, "network": network}


@router.get("/items/{address}")
async def get_vault_items(address: str, network: str = "btc-testnet"):
    """Return all vault items (encrypted blobs with labels) for a user."""
    cursor = col.find(
        {**_key(address, network)},
        {"_id": 0}
    ).sort("created_at", -1)
    items = await cursor.to_list(length=1000)
    return {"items": items}


@router.post("/item")
async def save_vault_item(p: SaveItemPayload):
    """Save a new double-encrypted vault item."""
    item = {
        "item_id": str(uuid4()),
        "address": p.address,
        "network": p.network,
        "encrypted_blob": p.encrypted_blob,
        "label": p.label,
        "category": p.category,
        "original_name": p.original_name,
        "file_size": p.file_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await col.insert_one(item)
    # Remove _id before returning
    item.pop("_id", None)
    return {"success": True, "item": item}


@router.post("/item/label")
async def update_item_label(p: UpdateLabelPayload):
    """Update the unencrypted label for a vault item."""
    await col.update_one(
        {**_key(p.address, p.network), "item_id": p.item_id},
        {"$set": {"label": p.label}}
    )
    return {"success": True}


@router.post("/item/delete")
async def delete_vault_item(p: DeleteItemPayload):
    """Delete a vault item."""
    await col.delete_one(
        {**_key(p.address, p.network), "item_id": p.item_id}
    )
    return {"success": True}


@router.get("/pattern/{address}")
async def get_pattern_data(address: str, network: str = "btc-testnet"):
    """Get pattern verification data (hash + salt). Returns null if no pattern set."""
    doc = await pattern_col.find_one(
        _key(address, network),
        {"_id": 0}
    )
    if not doc:
        return {"has_pattern": False}
    return {
        "has_pattern": True,
        "verification_hash": doc.get("verification_hash", ""),
        "salt": doc.get("salt", ""),
    }


@router.post("/pattern")
async def save_pattern(p: SavePatternPayload):
    """Save pattern verification hash and salt."""
    await pattern_col.update_one(
        _key(p.address, p.network),
        {"$set": {
            "verification_hash": p.verification_hash,
            "salt": p.salt,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"success": True}


@router.post("/migrate")
async def migrate_onchain_item(p: MigrateItemPayload):
    """Migrate an on-chain vault item to the persistent backend vault."""
    # Check if already migrated
    existing = await col.find_one(
        {**_key(p.address, p.network), "txid": p.txid}
    )
    if existing:
        return {"success": True, "message": "Already migrated"}

    item = {
        "item_id": str(uuid4()),
        "address": p.address,
        "network": p.network,
        "txid": p.txid,
        "encrypted_blob": p.encrypted_blob,
        "label": p.label,
        "category": p.category,
        "original_name": p.original_name,
        "file_size": p.file_size,
        "created_at": p.timestamp or datetime.now(timezone.utc).isoformat(),
    }
    await col.insert_one(item)
    item.pop("_id", None)
    return {"success": True, "item": item}


# ─── State Backup (no pattern lock required) ───

@router.get("/state-backup/{address}")
async def get_state_backup(address: str, network: str = "btc-testnet"):
    """Return the latest state_backup item for an address. No pattern lock needed."""
    cursor = col.find(
        {**_key(address, network), "category": "state_backup"},
        {"_id": 0}
    ).sort("created_at", -1)
    items = await cursor.to_list(length=1)
    return {"item": items[0] if items else None}


@router.post("/state-backup")
async def save_state_backup(p: SaveItemPayload):
    """Save or replace the user's state backup. Only one exists at a time."""
    now = datetime.now(timezone.utc).isoformat()
    # Delete any previous state backups for this user+network
    await col.delete_many(
        {**_key(p.address, p.network), "category": "state_backup"}
    )
    item = {
        "item_id": str(uuid4()),
        "address": p.address,
        "network": p.network,
        "encrypted_blob": p.encrypted_blob,
        "label": "State Backup",
        "category": "state_backup",
        "original_name": "",
        "file_size": len(p.encrypted_blob),
        "created_at": now,
    }
    await col.insert_one(item)
    item.pop("_id", None)
    return {"success": True, "item": item}



# ─── On-Chain Vault Discovery ───

VAULT_KEYWORD = "CTHULHU_VAULT"
BACKUP_KEYWORD = "CTHULHU_BACKUP"

@router.get("/discover-onchain/{address}")
async def discover_onchain_vault(address: str, network: str = "btc-testnet"):
    """Discover the latest on-chain vault backup for a testnet address.
    Checks two sources:
    1. P2FK posts with keyword CTHULHU_VAULT from this address.
    2. Self-directed private messages (sender == recipient) as vault entries.
    Returns the best (most recent) backup found, and the latest self-PM timestamp
    which serves as a 'notifications seen up to this point' cutoff."""
    from utils.helpers import fetch_keyword_messages, fetch_private_messages_by_address, get_root_by_txid

    vault_backup = None
    latest_self_pm_date = None

    # --- Source 1: CTHULHU_BACKUP keyword posts (v3 inline encrypted) ---
    backup_v3 = None
    try:
        messages_v3 = await fetch_keyword_messages(BACKUP_KEYWORD, mainnet=False, skip=0, qty=20)
        for msg in messages_v3:
            signed_by = msg.get('SignedBy', msg.get('FromAddress', ''))
            if signed_by != address:
                continue
            content = msg.get('Message', '')
            if isinstance(content, list):
                content = ' '.join(content)
            if not content or not content.startswith('BACKUP:v3:'):
                continue
            encrypted_data = content[len('BACKUP:v3:'):]
            if encrypted_data:
                backup_v3 = {
                    "txid": msg.get('TransactionId', ''),
                    "data": encrypted_data,
                    "timestamp": msg.get('Timestamp', msg.get('Date', '')),
                    "source": "keyword_v3",
                }
                break  # First match is newest
    except Exception as e:
        logger.error(f"Chain backup v3 discovery failed: {e}")

    # --- Source 2: Legacy CTHULHU_VAULT keyword posts (v2 IPFS CID) ---
    try:
        messages = await fetch_keyword_messages(VAULT_KEYWORD, mainnet=False, skip=0, qty=50)
        for msg in messages:
            signed_by = msg.get('SignedBy', msg.get('FromAddress', ''))
            if signed_by != address:
                continue
            content = msg.get('Message', '')
            if isinstance(content, list):
                content = ' '.join(content)
            if not content or 'ipfs://' not in content.lower():
                continue
            cid = None
            for part in content.split():
                if part.startswith('ipfs://'):
                    cid = part.replace('ipfs://', '')
                    break
            if not cid:
                continue
            vault_backup = {
                "txid": msg.get('TransactionId', ''),
                "cid": cid,
                "content": content,
                "timestamp": msg.get('Timestamp', msg.get('Date', '')),
                "source": "keyword",
            }
            break  # First match is newest
    except Exception as e:
        logger.error(f"Vault keyword discovery failed: {e}")

    # --- Source 2: Self-directed PMs (vault entries) ---
    try:
        is_mainnet = "mainnet" in network.lower()
        pms = await fetch_private_messages_by_address(address, is_mainnet, skip=0, qty=40)
        for pm in (pms or []):
            txid = pm.get("TransactionId", "")
            block_date = pm.get("BlockDate", "")
            if not txid:
                continue
            # Check if this is a self-directed PM by resolving the root
            try:
                root = await get_root_by_txid(txid, is_mainnet)
                if not isinstance(root, dict):
                    continue
                keywords = root.get("Keyword") or {}
                kw_keys = list(keywords.keys())
                sender = kw_keys[-1] if kw_keys else None
                # Self-directed: sender is the same address
                if sender == address:
                    if not latest_self_pm_date or block_date > latest_self_pm_date:
                        latest_self_pm_date = block_date
                    # Only need the latest one for the timestamp
                    break
            except Exception:
                continue
    except Exception as e:
        logger.error(f"Vault self-PM discovery failed: {e}")

    if not vault_backup and not latest_self_pm_date and not backup_v3:
        return {"found": False, "backup": None, "backup_v3": None, "latest_self_pm": None}

    return {
        "found": vault_backup is not None or backup_v3 is not None,
        "backup": vault_backup,
        "backup_v3": backup_v3,
        "latest_self_pm": latest_self_pm_date,
    }


@router.get("/history/{address}")
async def vault_history(address: str, limit: int = 12):
    """Return the last N backup save points (CTHULHU_BACKUP + legacy CTHULHU_VAULT) with timestamps."""
    from utils.helpers import fetch_keyword_messages

    save_points = []
    # Check v3 backups first
    try:
        messages_v3 = await fetch_keyword_messages(BACKUP_KEYWORD, mainnet=False, skip=0, qty=50)
        for msg in messages_v3:
            signed_by = msg.get('SignedBy', msg.get('FromAddress', ''))
            if signed_by != address:
                continue
            content = msg.get('Message', '')
            if isinstance(content, list):
                content = ' '.join(content)
            if not content or not content.startswith('BACKUP:v3:'):
                continue
            save_points.append({
                "txid": msg.get('TransactionId', ''),
                "version": 3,
                "timestamp": msg.get('Timestamp', msg.get('Date', '')),
                "block_date": msg.get('BlockDate', ''),
            })
            if len(save_points) >= limit:
                break
    except Exception as e:
        logger.error(f"Backup v3 history fetch failed: {e}")

    # Also check legacy v2
    if len(save_points) < limit:
        try:
            messages = await fetch_keyword_messages(VAULT_KEYWORD, mainnet=False, skip=0, qty=100)
            for msg in messages:
                signed_by = msg.get('SignedBy', msg.get('FromAddress', ''))
                if signed_by != address:
                    continue
                content = msg.get('Message', '')
                if isinstance(content, list):
                    content = ' '.join(content)
                if not content or 'ipfs://' not in content.lower():
                    continue
                cid = None
                for part in content.split():
                    if part.startswith('ipfs://'):
                        cid = part.replace('ipfs://', '')
                        break
                if not cid:
                    continue
                save_points.append({
                    "txid": msg.get('TransactionId', ''),
                    "cid": cid,
                    "version": 2,
                    "timestamp": msg.get('Timestamp', msg.get('Date', '')),
                    "block_date": msg.get('BlockDate', ''),
                })
                if len(save_points) >= limit:
                    break
        except Exception as e:
            logger.error(f"Vault v2 history fetch failed: {e}")

    return {"save_points": save_points, "total": len(save_points)}
