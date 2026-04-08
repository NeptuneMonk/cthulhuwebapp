"""
Desktop Node Scanner & Index API — /api/node/scan/*

Routes for controlling the background chain scanner and querying the
local P2FK index.  Desktop only — the web app never calls these.

Scanner endpoints:
  POST /api/node/scanner/start/{chain}  — Start scanning a chain
  POST /api/node/scanner/stop/{chain}   — Stop scanning a chain
  POST /api/node/scanner/start-all      — Start all connected chains
  POST /api/node/scanner/stop-all       — Stop all scanners
  GET  /api/node/scanner/progress       — Progress for all scanners

Index query endpoints:
  GET  /api/node/index/root/{txid}           — Single root by TXID
  GET  /api/node/index/roots/{address}       — Roots signed by address
  GET  /api/node/index/keyword/{address}     — Roots at keyword address
  GET  /api/node/index/objects               — All OBJ-type roots
  GET  /api/node/index/profiles              — All PRO-type roots
  GET  /api/node/index/search                — Full-text search
  GET  /api/node/index/stats                 — Index statistics
"""

from fastapi import APIRouter, HTTPException, Query
import logging

from rpc.chain_scanner import scanner_manager, EPOCH_HEIGHTS
from rpc.p2fk_index import (
    get_root_by_txid,
    get_roots_by_address,
    get_roots_at_keyword,
    get_roots_by_file_type,
    search_roots,
    get_index_stats,
    get_scan_progress,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/node", tags=["desktop-scanner"])


# ── Scanner Control ──────────────────────────────────────────────────────────

@router.post("/scanner/start/{chain}")
async def start_scanner(chain: str, network: str = "mainnet"):
    """Start the background P2FK scanner for a chain."""
    result = await scanner_manager.start_chain(chain, network)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.post("/scanner/stop/{chain}")
async def stop_scanner(chain: str):
    """Stop the scanner for a chain (finishes current batch first)."""
    result = await scanner_manager.stop_chain(chain)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.post("/scanner/start-all")
async def start_all_scanners(network: str = "mainnet"):
    """Start scanners for all connected Core Wallets."""
    results = await scanner_manager.start_all_connected(network)
    if not results:
        raise HTTPException(400, "No wallets connected — run /api/node/scan first")
    return {"scanners": results}


@router.post("/scanner/stop-all")
async def stop_all_scanners():
    """Stop all running scanners."""
    await scanner_manager.stop_all()
    return {"stopped": True}


@router.get("/scanner/progress")
async def scanner_progress():
    """Get scan progress for all chains."""
    live = scanner_manager.all_progress

    # Also include persisted progress for chains not currently scanning
    for chain in EPOCH_HEIGHTS:
        if chain not in live:
            live[chain] = await get_scan_progress(chain)

    return {"scanners": live}


@router.get("/scanner/progress/{chain}")
async def scanner_progress_chain(chain: str):
    """Get scan progress for a specific chain."""
    chain = chain.upper()
    scanner = scanner_manager.get(chain)
    if scanner:
        return scanner.progress
    return await get_scan_progress(chain)


# ── Index Queries ────────────────────────────────────────────────────────────

@router.get("/index/root/{txid}")
async def index_get_root(txid: str):
    """Get a decoded P2FK root by transaction ID."""
    root = await get_root_by_txid(txid)
    if not root:
        raise HTTPException(404, "Root not found in local index")
    return root


@router.get("/index/roots/{address}")
async def index_roots_by_address(
    address: str,
    chain: str = Query(None, description="Filter by chain (BTC/LTC/DOG/MZC)"),
):
    """Get all roots signed by a given address."""
    roots = await get_roots_by_address(address, chain)
    return {"address": address, "roots": roots, "total": len(roots)}


@router.get("/index/keyword/{address}")
async def index_roots_at_keyword(
    address: str,
    chain: str = Query(None),
):
    """Get all roots posted to a keyword address."""
    roots = await get_roots_at_keyword(address, chain)
    return {"keyword_address": address, "roots": roots, "total": len(roots)}


@router.get("/index/objects")
async def index_objects(
    chain: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    """Get all OBJ-type roots (claimed objects)."""
    roots = await get_roots_by_file_type("OBJ", chain, limit, offset)
    return {"roots": roots, "total": len(roots)}


@router.get("/index/profiles")
async def index_profiles(
    chain: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    """Get all PRO-type roots (profiles)."""
    roots = await get_roots_by_file_type("PRO", chain, limit, offset)
    return {"roots": roots, "total": len(roots)}


@router.get("/index/by-type/{file_type}")
async def index_by_file_type(
    file_type: str,
    chain: str = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    """Get roots containing a specific file type (GIV, BRN, BUY, LST, MSG, etc.)."""
    roots = await get_roots_by_file_type(file_type.upper(), chain, limit, offset)
    return {"file_type": file_type.upper(), "roots": roots, "total": len(roots)}


@router.get("/index/search")
async def index_search(
    q: str = Query(..., description="Search query"),
    chain: str = Query(None),
    limit: int = Query(50, le=200),
):
    """Search the local index by message content or keyword text."""
    roots = await search_roots(q, chain, limit)
    return {"query": q, "roots": roots, "total": len(roots)}


@router.get("/index/stats")
async def index_statistics():
    """Get summary statistics for the local P2FK index."""
    return await get_index_stats()
