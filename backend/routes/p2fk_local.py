"""
Local P2FK Routes — Replaces p2fk.io dependency with local decoder.

Endpoints:
  GET /api/p2fk-local/root/{txid}          — Decode a single transaction
  GET /api/p2fk-local/roots/{address}      — All Roots at an address
  GET /api/p2fk-local/profile/{address}    — Profile data at address
  GET /api/p2fk-local/objects/{address}    — Object data at address
  GET /api/p2fk-local/keyword/{keyword}    — Keyword → address conversion
  GET /api/p2fk-local/decode-address/{addr} — Address → keyword reverse
  GET /api/p2fk-local/search               — Search roots by keyword
  GET /api/p2fk-local/node/status          — Custom node connection status
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
    test_custom_node,
)
from db_sqlite import get_conn

router = APIRouter(prefix="/api/p2fk-local", tags=["p2fk-local"])
logger = logging.getLogger(__name__)

CACHE_TTL = 300  # 5 minutes


# ─── SQLite Cache ────────────────────────────────────────────────────────────

_cache_table_ready = False

async def _ensure_cache_table():
    global _cache_table_ready
    if _cache_table_ready:
        return
    conn = await get_conn()
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS p2fk_root_cache (
            key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            timestamp REAL NOT NULL
        )
    """)
    await conn.commit()
    _cache_table_ready = True


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
        (key, json.dumps(data, default=str), time.time()),
    )
    await conn.commit()


# ─── Helpers ─────────────────────────────────────────────────────────────────

async def _decode_and_cache(txid: str, network: str) -> Optional[dict]:
    """Fetch, decode, and cache a single P2FK Root."""
    cache_key = f"root:{network}:{txid}"
    cached = await _cache_get(cache_key)
    if cached:
        return cached

    raw_tx = await fetch_transaction(txid, network)
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
    txs = await fetch_address_transactions(address, network)
    roots = []

    for tx in txs:
        txid = tx.get('txid', '')
        if not txid:
            continue

        root = decode_root_from_raw_tx(txid, tx, version_byte)
        if root:
            if address in root.outputs:
                roots.append(root.to_dict())

    if roots:
        await _cache_set(cache_key, roots)

    return roots


def _extract_profile_from_roots(roots: list) -> Optional[dict]:
    """Extract profile data from the first PRO-type Root at an address."""
    for root in roots:
        files = root.get('File', {})
        if 'PRO' in files:
            for msg in root.get('Message', []):
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
        for msg in root.get('Message', []):
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


@router.get("/search")
async def search_roots(
    keyword: str = Query(..., description="Keyword to search for"),
    network: str = Query("btc-testnet"),
):
    """Search for P2FK Roots by keyword (converts keyword to address, fetches roots)."""
    vb = get_version_byte(network)
    addr = keyword_to_address(keyword, vb)
    roots = await _get_roots_at_address(addr, network)
    return {"keyword": keyword, "address": addr, "roots": roots, "total": len(roots)}


@router.get("/node/status")
async def node_status():
    """Check custom Bitcoin Core node connection status."""
    from blockchain_api import _custom_node_url
    status = await test_custom_node()
    status["configured"] = bool(_custom_node_url)
    return status


@router.post("/node/configure")
async def configure_node(body: dict):
    """Configure a custom Bitcoin Core RPC endpoint.
    Body: { "rpc_url": "http://user:pass@host:port" } or { "rpc_url": null } to disconnect."""
    from blockchain_api import configure_custom_node
    rpc_url = body.get("rpc_url")
    configure_custom_node(rpc_url if rpc_url else None)

    # Test the connection
    if rpc_url:
        status = await test_custom_node()
        return {"success": status.get("connected", False), **status}
    return {"success": True, "connected": False, "message": "Custom node disconnected"}


@router.get("/node/detect")
async def detect_local_node():
    """Try to detect a locally running Bitcoin Core node on common ports."""
    import httpx
    common_endpoints = [
        ("http://127.0.0.1:8332", "Bitcoin Core (mainnet)"),
        ("http://127.0.0.1:18332", "Bitcoin Core (testnet)"),
        ("http://127.0.0.1:18443", "Bitcoin Core (regtest)"),
        ("http://127.0.0.1:38332", "Bitcoin Core (signet)"),
    ]
    detected = []
    async with httpx.AsyncClient(timeout=2.0) as client:
        for url, label in common_endpoints:
            try:
                resp = await client.post(url, json={
                    "jsonrpc": "1.0", "id": "detect", "method": "getblockchaininfo", "params": []
                })
                if resp.status_code in (200, 401, 403):
                    detected.append({
                        "url": url,
                        "label": label,
                        "auth_required": resp.status_code in (401, 403),
                        "accessible": resp.status_code == 200,
                    })
            except Exception:
                pass
    return {"detected": detected, "count": len(detected)}

