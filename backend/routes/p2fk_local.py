"""
Local P2FK Routes — Replaces p2fk.io dependency with local decoder.

Endpoints:
  GET /api/p2fk-local/root/{txid}          — Decode a single transaction
  GET /api/p2fk-local/roots/{address}      — All Roots at an address
  GET /api/p2fk-local/profile/{address}    — Profile data at address
  GET /api/p2fk-local/objects/{address}    — Object data at address
"""

import json
import time
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Query

from p2fk_decoder import (
    P2FKRoot,
    decode_root_from_raw_tx,
    keyword_to_address,
    address_to_keyword,
)
from blockchain_api import (
    fetch_transaction,
    fetch_address_transactions,
    get_version_byte,
)
from db_sqlite import get_conn

router = APIRouter(prefix="/api/p2fk-local", tags=["p2fk-local"])
logger = logging.getLogger(__name__)

CACHE_TTL = 300  # 5 minutes


# ─── SQLite Cache ────────────────────────────────────────────────────────────

async def _ensure_cache_table():
    conn = await get_conn()
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS p2fk_root_cache (
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp REAL NOT NULL
        )
    """)
    await conn.commit()


async def _cache_get(key: str) -> Optional[dict]:
    await _ensure_cache_table()
    conn = await get_conn()
    async with conn.execute(
        "SELECT data, timestamp FROM p2fk_root_cache WHERE key = ?", (key,)
    ) as cursor:
        row = await cursor.fetchone()
    if row and (time.time() - row[1]) < CACHE_TTL:
        try:
            return json.loads(row[0])
        except Exception:
            pass
    return None


async def _cache_set(key: str, data):
    await _ensure_cache_table()
    conn = await get_conn()
    await conn.execute(
        "INSERT OR REPLACE INTO p2fk_root_cache (key, data, timestamp) VALUES (?, ?, ?)",
        (key, json.dumps(data), time.time()),
    )
    await conn.commit()


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _decode_and_cache(txid: str, network: str) -> Optional[dict]:
    """Fetch, decode, and cache a single P2FK Root."""
    cache_key = f"root:{network}:{txid}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    raw_tx = fetch_transaction(txid, network)
    if not raw_tx:
        return None

    version_byte = get_version_byte(network)
    root = decode_root_from_raw_tx(txid, raw_tx, version_byte)
    if not root:
        return None

    result = root.to_dict()
    await _cache_set(cache_key, result)
    return result


async def _get_roots_at_address(address: str, network: str) -> list:
    """Get all P2FK Roots at a given address."""
    cache_key = f"roots:{network}:{address}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    version_byte = get_version_byte(network)
    txs = fetch_address_transactions(address, network)
    roots = []

    for tx in txs:
        txid = tx.get('txid', '')
        if not txid:
            continue

        root = decode_root_from_raw_tx(txid, tx, version_byte)
        if root:
            # Only include if this address is in the outputs
            if address in root.outputs:
                roots.append(root.to_dict())

    if roots:
        await _cache_set(cache_key, roots)

    return roots


def _extract_profile_from_roots(roots: list) -> Optional[dict]:
    """Extract profile data from the first PRO-type Root at an address."""
    for root in roots:
        files = root.get('File', {})
        # Profile Roots have a "PRO" file or contain profile JSON
        if 'PRO' in files:
            # Find the message that contains the profile JSON
            for msg in root.get('Message', []):
                try:
                    # Try to parse as JSON (profile data)
                    data = json.loads(msg)
                    return {
                        'TransactionId': root.get('TransactionId', ''),
                        'SignedBy': root.get('SignedBy', ''),
                        'Signed': root.get('Signed', False),
                        'BlockDate': root.get('BlockDate', ''),
                        **data,
                    }
                except json.JSONDecodeError:
                    continue
        # Also check if message contains profile-like data
        for msg in root.get('Message', []):
            # Profile messages typically contain URN, Name, Image fields
            if any(k in msg for k in ['"urn"', '"URN"', '"Name"', '"name"']):
                try:
                    data = json.loads(msg)
                    return {
                        'TransactionId': root.get('TransactionId', ''),
                        'SignedBy': root.get('SignedBy', ''),
                        'Signed': root.get('Signed', False),
                        'BlockDate': root.get('BlockDate', ''),
                        **data,
                    }
                except json.JSONDecodeError:
                    continue
    return None


def _extract_object_from_roots(roots: list) -> Optional[dict]:
    """Extract object data from the first OBJ-type Root at an address."""
    for root in roots:
        files = root.get('File', {})
        if 'OBJ' in files:
            for msg in root.get('Message', []):
                try:
                    data = json.loads(msg)
                    return {
                        'TransactionId': root.get('TransactionId', ''),
                        'SignedBy': root.get('SignedBy', ''),
                        'Signed': root.get('Signed', False),
                        'BlockDate': root.get('BlockDate', ''),
                        'Keyword': root.get('Keyword', {}),
                        **data,
                    }
                except json.JSONDecodeError:
                    continue
    return None


# ─── API Endpoints ───────────────────────────────────────────────────────────

@router.get("/root/{txid}")
async def get_root(txid: str, network: str = Query("btc-testnet")):
    """Decode a single P2FK transaction by its ID."""
    result = await _decode_and_cache(txid, network)
    if not result:
        return {"error": "Transaction not found or not a valid P2FK Root", "txid": txid}
    return result


@router.get("/roots/{address}")
async def get_roots_by_address(
    address: str,
    network: str = Query("btc-testnet"),
    skip: int = Query(0),
    qty: int = Query(-1),
):
    """Get all P2FK Roots at an address (equivalent to GetRootsByAddress)."""
    roots = await _get_roots_at_address(address, network)
    total = len(roots)
    if skip > 0:
        roots = roots[skip:]
    if qty > 0:
        roots = roots[:qty]
    return {"address": address, "roots": roots, "total": total}


@router.get("/profile/{address}")
async def get_profile(address: str, network: str = Query("btc-testnet")):
    """Get profile data at an address."""
    roots = await _get_roots_at_address(address, network)
    profile = _extract_profile_from_roots(roots)
    if not profile:
        return {"error": "No profile found", "address": address}
    return profile


@router.get("/objects/{address}")
async def get_objects_by_address(
    address: str,
    network: str = Query("btc-testnet"),
):
    """Get object data at an address."""
    roots = await _get_roots_at_address(address, network)
    obj = _extract_object_from_roots(roots)
    if not obj:
        return {"error": "No object found", "address": address}
    return obj


@router.get("/keyword/{keyword}")
async def get_keyword_address(
    keyword: str,
    network: str = Query("btc-testnet"),
):
    """Convert a keyword to its P2FK address."""
    vb = get_version_byte(network)
    addr = keyword_to_address(keyword, vb)
    return {"keyword": keyword, "address": addr, "network": network}


@router.get("/decode-address/{address}")
async def decode_keyword_address(address: str):
    """Decode a keyword address back to its keyword string."""
    try:
        kw = address_to_keyword(address)
        return {"address": address, "keyword": kw}
    except Exception as e:
        return {"error": str(e), "address": address}
