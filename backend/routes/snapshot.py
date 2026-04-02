"""
Snapshot System — IPFS-backed decentralized P2FK chain index.

Vacuum: Systematically crawl p2fk.io to build a complete local index.
Snapshot: Serialize the index → JSON → pin to IPFS → daisy-chain CIDs.
Consume: Fetch a snapshot CID from IPFS → hydrate local SQLite.
Delta: Only new roots since the last snapshot's block height.

Rate limit: ~1.5 req/sec to p2fk.io (15 requests per 10 seconds).
"""

import asyncio
import json
import time
import logging
import gzip
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from pydantic import BaseModel

from config import SEED_ADDRESSES
from db_sqlite import get_conn
from utils.helpers import p2fk_get, register_known_user
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/snapshot", tags=["snapshot"])

# ─── Rate Limiter (1.5 req/sec = 15 per 10s) ────────────────────────────────

_RATE_INTERVAL = 0.67  # seconds between requests (~1.5/sec)

# ─── Vacuum State (in-memory, survives only within process) ──────────────────

_vacuum_state = {
    "running": False,
    "phase": "idle",
    "progress": 0,
    "total": 0,
    "crawled": 0,
    "errors": 0,
    "started_at": None,
    "last_update": None,
    "log": [],
}


def _vlog(msg: str):
    """Append to vacuum log (keep last 100 entries)."""
    _vacuum_state["log"].append(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}")
    if len(_vacuum_state["log"]) > 100:
        del _vacuum_state["log"][:50]
    _vacuum_state["last_update"] = time.time()
    logger.info(f"Vacuum: {msg}")


# ─── Snapshot Schema ─────────────────────────────────────────────────────────

SNAPSHOT_VERSION = 1

async def _ensure_snapshot_table():
    conn = await get_conn()
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cid TEXT NOT NULL,
            block_height INTEGER,
            chain TEXT NOT NULL,
            type TEXT NOT NULL,
            root_count INTEGER,
            size_bytes INTEGER,
            previous_cid TEXT,
            created_at TEXT NOT NULL
        )
    """)
    # Track txids included in the last full snapshot (for delta computation)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshot_txids (
            txid TEXT PRIMARY KEY,
            chain TEXT NOT NULL,
            snapshot_id INTEGER
        )
    """)
    await conn.commit()


# ─── Vacuum: Crawl p2fk.io systematically ───────────────────────────────────

async def _vacuum_crawl_address(address: str, mainnet: bool, network: str):
    """Crawl all roots at an address from p2fk.io."""
    try:
        roots = await p2fk_get(f"GetRootsByAddress/{address}", mainnet)
        if isinstance(roots, list):
            return len(roots)
        return 0
    except Exception as e:
        _vacuum_state["errors"] += 1
        return 0


async def _vacuum_crawl_profiles(addresses: list, mainnet: bool):
    """Crawl profile data for known addresses."""
    for addr in addresses:
        try:
            await p2fk_get(f"GetProfileByAddress/{addr}", mainnet)
            _vacuum_state["crawled"] += 1
        except Exception:
            _vacuum_state["errors"] += 1
        await asyncio.sleep(_RATE_INTERVAL)


async def _vacuum_crawl_objects(addresses: list, mainnet: bool):
    """Crawl object data for known addresses."""
    for addr in addresses:
        try:
            await p2fk_get(f"GetObjectsByAddress/{addr}", mainnet)
            _vacuum_state["crawled"] += 1
        except Exception:
            _vacuum_state["errors"] += 1
        await asyncio.sleep(_RATE_INTERVAL)


async def _run_vacuum(network: str = "btc-testnet"):
    """Full vacuum: crawl all seed addresses + discovered addresses from p2fk.io."""
    _vacuum_state.update({
        "running": True,
        "phase": "starting",
        "progress": 0,
        "total": 0,
        "crawled": 0,
        "errors": 0,
        "started_at": time.time(),
        "log": [],
    })

    mainnet = "mainnet" in network
    seed_key = "btc-mainnet" if mainnet else "btc-testnet"
    seeds = SEED_ADDRESSES.get(seed_key, [])

    _vlog(f"Starting vacuum for {network} with {len(seeds)} seed addresses")

    # Phase 1: Crawl all seed addresses for roots
    _vacuum_state["phase"] = "crawling_seeds"
    _vacuum_state["total"] = len(seeds)
    discovered_addresses = set()

    for i, addr in enumerate(seeds):
        _vacuum_state["progress"] = i + 1
        _vlog(f"Seed {i+1}/{len(seeds)}: {addr[:20]}...")

        roots = await p2fk_get(f"GetRootsByAddress/{addr}", mainnet)
        if isinstance(roots, list):
            _vlog(f"  → {len(roots)} roots found")
            # Discover new addresses from root outputs
            for root in roots:
                outputs = root.get("Output", {})
                if isinstance(outputs, dict):
                    for out_addr in outputs.keys():
                        if out_addr not in seeds:
                            discovered_addresses.add(out_addr)
                signed_by = root.get("SignedBy", "")
                if signed_by and signed_by not in seeds:
                    discovered_addresses.add(signed_by)
        else:
            _vacuum_state["errors"] += 1
            _vlog(f"  → failed or empty")

        _vacuum_state["crawled"] += 1
        await asyncio.sleep(_RATE_INTERVAL)

    _vlog(f"Seed crawl complete. Discovered {len(discovered_addresses)} additional addresses.")

    # Cap discovered addresses to prevent runaway crawls
    MAX_DISCOVER = 500
    if len(discovered_addresses) > MAX_DISCOVER:
        _vlog(f"Capping discovery to {MAX_DISCOVER} addresses (found {len(discovered_addresses)})")
        discovered_addresses = set(list(discovered_addresses)[:MAX_DISCOVER])

    # Phase 2: Crawl known users from our DB
    _vacuum_state["phase"] = "crawling_known_users"
    conn = await get_conn()
    async with conn.execute("SELECT address FROM known_users") as cursor:
        known = [row[0] for row in await cursor.fetchall()]

    for addr in known:
        discovered_addresses.add(addr)

    _vlog(f"Total addresses to crawl: {len(discovered_addresses)} (after adding {len(known)} known users)")

    # Phase 3: Crawl discovered addresses (profiles + roots)
    _vacuum_state["phase"] = "crawling_profiles"
    disc_list = list(discovered_addresses)
    _vacuum_state["total"] = len(disc_list)
    _vacuum_state["progress"] = 0

    for i, addr in enumerate(disc_list):
        _vacuum_state["progress"] = i + 1
        if i % 20 == 0:
            _vlog(f"Profiles: {i}/{len(disc_list)}")

        try:
            profile = await p2fk_get(f"GetProfileByAddress/{addr}", mainnet)
            # Auto-register discovered addresses as known users (populates feed)
            if isinstance(profile, dict):
                urn = profile.get("URN") or profile.get("urn")
                image = profile.get("Image") or profile.get("image")
                display = profile.get("DisplayName") or profile.get("Name")
                await register_known_user(addr, network, urn, image, display)
            else:
                # Register even without profile data (they still have posts)
                await register_known_user(addr, network, None, None, None)
        except Exception:
            _vacuum_state["errors"] += 1

        _vacuum_state["crawled"] += 1
        await asyncio.sleep(_RATE_INTERVAL)

    # Phase 4: Crawl objects owned/created by known users
    _vacuum_state["phase"] = "crawling_objects"
    _vacuum_state["progress"] = 0
    _vacuum_state["total"] = len(disc_list)

    for i, addr in enumerate(disc_list):
        _vacuum_state["progress"] = i + 1
        if i % 20 == 0:
            _vlog(f"Objects: {i}/{len(disc_list)}")

        try:
            await p2fk_get(f"GetObjectsOwnedByAddress/{addr}", mainnet)
        except Exception:
            pass

        _vacuum_state["crawled"] += 1
        await asyncio.sleep(_RATE_INTERVAL)

    # Phase 5: Search for common keywords
    _vacuum_state["phase"] = "crawling_keywords"
    common_keywords = ["SUP", "hello", "test", "music", "art", "nft", "bitcoin", "doge", "gif"]
    _vacuum_state["total"] = len(common_keywords)
    _vacuum_state["progress"] = 0

    for i, kw in enumerate(common_keywords):
        _vacuum_state["progress"] = i + 1
        try:
            await p2fk_get("GetKnownRootsBySearchString", mainnet, {"search": kw, "qty": 50})
        except Exception:
            pass
        _vacuum_state["crawled"] += 1
        await asyncio.sleep(_RATE_INTERVAL)

    elapsed = time.time() - _vacuum_state["started_at"]
    _vlog(f"Vacuum complete in {elapsed:.0f}s. Crawled: {_vacuum_state['crawled']}, Errors: {_vacuum_state['errors']}")
    _vacuum_state["phase"] = "complete"
    _vacuum_state["running"] = False


# ─── Snapshot: Serialize → IPFS ──────────────────────────────────────────────

async def _produce_snapshot(network: str = "btc-testnet", delta: bool = False) -> dict:
    """Serialize the P2FK cache into a snapshot and pin to IPFS.
    delta=True: only include roots NOT in the last full snapshot."""
    mainnet = "mainnet" in network
    conn = await get_conn()
    await _ensure_snapshot_table()

    # For delta mode, get txids from the last full snapshot
    known_txids = set()
    if delta:
        async with conn.execute(
            "SELECT txid FROM snapshot_txids WHERE chain = ?", (network,)
        ) as cursor:
            known_txids = {row[0] for row in await cursor.fetchall()}
        if not known_txids:
            _vlog("No base snapshot found — producing full snapshot instead")
            delta = False

    # Gather all cached roots, profiles, objects
    prefix = "p2fk:"
    async with conn.execute(
        "SELECT _id, data FROM api_cache WHERE _id LIKE ?", (f"{prefix}%",)
    ) as cursor:
        rows = await cursor.fetchall()

    roots = []
    profiles = []
    objects = []
    keywords = {}

    for _id, data_str in rows:
        try:
            data = json.loads(data_str)
            cached = data.get("data", data) if isinstance(data, dict) and "data" in data else data
        except Exception:
            continue

        key = _id.replace(prefix, "")

        if "GetRoot" in key:
            if isinstance(cached, list):
                roots.extend(cached)
            elif isinstance(cached, dict) and cached.get("TransactionId"):
                roots.append(cached)
        elif "GetProfile" in key:
            if isinstance(cached, dict) and (cached.get("URN") or cached.get("urn")):
                profiles.append(cached)
        elif "GetObject" in key:
            if isinstance(cached, list):
                objects.extend(cached)
            elif isinstance(cached, dict) and cached.get("TransactionId"):
                objects.append(cached)
        elif "GetPublicAddressByKeyword" in key:
            kw = key.split("/")[-1].split(":")[0] if "/" in key else ""
            if kw and isinstance(cached, str):
                keywords[kw] = cached

    # Deduplicate roots by TransactionId
    seen_txids = set()
    unique_roots = []
    for r in roots:
        txid = r.get("TransactionId", "") if isinstance(r, dict) else ""
        if txid and txid not in seen_txids:
            seen_txids.add(txid)
            if delta and txid in known_txids:
                continue  # Skip — already in base snapshot
            unique_roots.append(r)

    # Get last snapshot CID for daisy-chain
    async with conn.execute(
        "SELECT id, cid FROM snapshots WHERE chain = ? ORDER BY id DESC LIMIT 1", (network,)
    ) as cursor:
        prev_row = await cursor.fetchone()
    previous_id = prev_row[0] if prev_row else None
    previous_cid = prev_row[1] if prev_row else None

    snap_type = "delta" if delta else "full"

    # For delta: only include new profiles (by address not seen before)
    if delta:
        # Keep all profiles/objects for now in deltas (they're small)
        pass

    snapshot = {
        "version": SNAPSHOT_VERSION,
        "chain": network,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": snap_type,
        "previous_cid": previous_cid,
        "base_snapshot_cid": previous_cid if delta else None,
        "stats": {
            "total_roots": len(unique_roots),
            "total_profiles": len(profiles),
            "total_objects": len(objects),
            "total_keywords": len(keywords),
            "cache_entries": len(rows),
        },
        "roots": unique_roots,
        "profiles": profiles if not delta else [],  # Delta skips profiles (apply from base)
        "objects": objects if not delta else [],      # Delta skips objects
        "keywords": keywords,
    }

    # Compress and pin to IPFS
    snapshot_json = json.dumps(snapshot, default=str, separators=(",", ":"))
    snapshot_gz = gzip.compress(snapshot_json.encode("utf-8"))
    size_bytes = len(snapshot_gz)

    _vlog(f"{snap_type.title()} snapshot: {len(unique_roots)} roots, {size_bytes/1024:.0f}KB compressed")

    # Pin to local Kubo IPFS daemon
    try:
        client = get_client()
        resp = await client.post(
            "http://127.0.0.1:5001/api/v0/add",
            files={"file": (f"cthulhu-{snap_type}-{network}.json.gz", snapshot_gz, "application/gzip")},
            params={"pin": "true"},
            timeout=30.0,
        )
        if resp.status_code == 200:
            result = resp.json()
            cid = result.get("Hash", "")
            _vlog(f"{snap_type.title()} snapshot pinned: {cid} ({size_bytes/1024:.0f}KB)")

            # Record in snapshots table
            await conn.execute(
                """INSERT INTO snapshots (cid, block_height, chain, type, root_count, size_bytes, previous_cid, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (cid, 0, network, snap_type, len(unique_roots), size_bytes, previous_cid, datetime.now(timezone.utc).isoformat()),
            )

            # For full snapshots, update the txid tracking table
            if not delta:
                await conn.execute("DELETE FROM snapshot_txids WHERE chain = ?", (network,))
                # Gather ALL txids (including ones from previous snapshots)
                all_txids = set()
                for r in roots:
                    txid = r.get("TransactionId", "") if isinstance(r, dict) else ""
                    if txid:
                        all_txids.add(txid)
                snap_id = (await conn.execute("SELECT last_insert_rowid()")).fetchone()
                snap_id_val = snap_id[0] if snap_id else 0
                for txid in all_txids:
                    await conn.execute(
                        "INSERT OR IGNORE INTO snapshot_txids (txid, chain, snapshot_id) VALUES (?, ?, ?)",
                        (txid, network, snap_id_val),
                    )

            await conn.commit()

            return {
                "cid": cid,
                "type": snap_type,
                "size_bytes": size_bytes,
                "size_human": f"{size_bytes/1024:.0f}KB",
                "previous_cid": previous_cid,
                **snapshot["stats"],
            }
        else:
            return {"error": f"IPFS pin failed: {resp.status_code}"}
    except Exception as e:
        return {"error": f"IPFS pin error: {str(e)}"}


async def _consume_snapshot(cid: str, network: str = "btc-testnet") -> dict:
    """Fetch a snapshot from IPFS and hydrate the local cache."""
    try:
        client = get_client()
        # Fetch from our local Kubo node (or public gateway)
        resp = await client.post(
            "http://127.0.0.1:5001/api/v0/cat",
            params={"arg": cid},
            timeout=60.0,
        )
        if resp.status_code != 200:
            # Try public gateway
            resp = await client.get(f"https://ipfs.io/ipfs/{cid}", timeout=60.0)
            if resp.status_code != 200:
                return {"error": "Could not fetch snapshot from IPFS"}

        # Decompress
        try:
            snapshot_json = gzip.decompress(resp.content).decode("utf-8")
        except Exception:
            snapshot_json = resp.text
        snapshot = json.loads(snapshot_json)

        if snapshot.get("version") != SNAPSHOT_VERSION:
            return {"error": f"Unsupported snapshot version: {snapshot.get('version')}"}

        # Hydrate cache
        conn = await get_conn()
        mainnet = "mainnet" in network
        imported = 0

        # Import roots
        for root in snapshot.get("roots", []):
            txid = root.get("TransactionId", "")
            if not txid:
                continue
            cache_key = f"p2fk:GetRootByTransactionID/{txid}:{mainnet}:None"
            await conn.execute(
                "INSERT OR IGNORE INTO api_cache (_id, data) VALUES (?, ?)",
                (cache_key, json.dumps({"data": root}, default=str)),
            )
            imported += 1

        # Import profiles
        for profile in snapshot.get("profiles", []):
            addr = profile.get("Address", profile.get("address", ""))
            if not addr:
                continue
            cache_key = f"p2fk:GetProfileByAddress/{addr}:{mainnet}:None"
            await conn.execute(
                "INSERT OR IGNORE INTO api_cache (_id, data) VALUES (?, ?)",
                (cache_key, json.dumps({"data": profile}, default=str)),
            )
            imported += 1

        # Import keywords
        for kw, addr in snapshot.get("keywords", {}).items():
            cache_key = f"p2fk:GetPublicAddressByKeyword/{kw}:{mainnet}:None"
            await conn.execute(
                "INSERT OR IGNORE INTO api_cache (_id, data) VALUES (?, ?)",
                (cache_key, json.dumps({"data": addr}, default=str)),
            )
            imported += 1

        await conn.commit()

        # Auto-register discovered signers as known users (populates feed)
        registered = 0
        seen_signers = set()
        for root in snapshot.get("roots", []):
            signer = root.get("SignedBy", "")
            if signer and signer not in seen_signers:
                seen_signers.add(signer)
                await register_known_user(signer, network, None, None, None)
                registered += 1
        for profile in snapshot.get("profiles", []):
            addr = profile.get("Address", profile.get("address", ""))
            urn = profile.get("URN") or profile.get("urn")
            image = profile.get("Image") or profile.get("image")
            display = profile.get("DisplayName") or profile.get("Name")
            if addr and addr not in seen_signers:
                seen_signers.add(addr)
                await register_known_user(addr, network, urn, image, display)
                registered += 1

        return {
            "success": True,
            "imported": imported,
            "users_registered": registered,
            "snapshot_stats": snapshot.get("stats", {}),
            "chain": snapshot.get("chain"),
            "timestamp": snapshot.get("timestamp"),
            "previous_cid": snapshot.get("previous_cid"),
        }

    except Exception as e:
        return {"error": str(e)}


# ─── API Endpoints ───────────────────────────────────────────────────────────

@router.get("/status")
async def vacuum_status():
    """Get current vacuum/snapshot status."""
    await _ensure_snapshot_table()
    conn = await get_conn()

    # Get snapshot history
    async with conn.execute(
        "SELECT cid, chain, type, root_count, size_bytes, previous_cid, created_at FROM snapshots ORDER BY id DESC LIMIT 10"
    ) as cursor:
        snapshots = [
            {"cid": r[0], "chain": r[1], "type": r[2], "root_count": r[3],
             "size_bytes": r[4], "previous_cid": r[5], "created_at": r[6]}
            for r in await cursor.fetchall()
        ]

    # Cache stats
    async with conn.execute("SELECT COUNT(*) FROM api_cache WHERE _id LIKE 'p2fk:%'") as cursor:
        cache_count = (await cursor.fetchone())[0]

    return {
        "vacuum": {
            "running": _vacuum_state["running"],
            "phase": _vacuum_state["phase"],
            "progress": _vacuum_state["progress"],
            "total": _vacuum_state["total"],
            "crawled": _vacuum_state["crawled"],
            "errors": _vacuum_state["errors"],
            "started_at": _vacuum_state["started_at"],
            "log": _vacuum_state["log"][-20:],
        },
        "cache": {
            "p2fk_entries": cache_count,
        },
        "snapshots": snapshots,
    }


@router.post("/vacuum")
async def start_vacuum(
    background_tasks: BackgroundTasks,
    network: str = Query("btc-testnet"),
):
    """Start a background vacuum crawl of p2fk.io to build the local index."""
    if _vacuum_state["running"]:
        return {"error": "Vacuum already running", "phase": _vacuum_state["phase"]}

    background_tasks.add_task(_run_vacuum, network)
    return {"started": True, "network": network}


@router.post("/produce")
async def produce_snapshot(
    network: str = Query("btc-testnet"),
    delta: bool = Query(False, description="Produce a delta snapshot (only new roots since last full)"),
):
    """Serialize current P2FK cache → compress → pin to IPFS → return CID.
    delta=True: only includes roots not in the last full snapshot (much smaller)."""
    result = await _produce_snapshot(network, delta=delta)
    return result


@router.post("/consume")
async def consume_snapshot(
    cid: str = Query(..., description="IPFS CID of the snapshot to consume"),
    network: str = Query("btc-testnet"),
):
    """Fetch a snapshot from IPFS and hydrate the local cache."""
    result = await _consume_snapshot(cid, network)
    return result


@router.get("/chain")
async def get_snapshot_chain(network: str = Query("btc-testnet")):
    """Get the full daisy-chain of snapshots for a network."""
    await _ensure_snapshot_table()
    conn = await get_conn()
    async with conn.execute(
        "SELECT cid, root_count, size_bytes, previous_cid, created_at FROM snapshots WHERE chain = ? ORDER BY id DESC",
        (network,),
    ) as cursor:
        chain = [
            {"cid": r[0], "root_count": r[1], "size_kb": round(r[2]/1024, 1) if r[2] else 0,
             "previous_cid": r[3], "created_at": r[4]}
            for r in await cursor.fetchall()
        ]
    return {"chain": chain, "length": len(chain), "network": network}


@router.post("/hydrate-feed")
async def hydrate_feed_from_cache(network: str = Query("btc-testnet")):
    """Extract all unique signers from cached P2FK roots and register them as known users.
    This populates the feed with ALL discovered users, not just manually registered ones."""
    mainnet = "mainnet" in network
    conn = await get_conn()

    # Scan all cached roots for unique signers
    prefix = "p2fk:"
    async with conn.execute(
        "SELECT data FROM api_cache WHERE _id LIKE ?", (f"{prefix}%",)
    ) as cursor:
        rows = await cursor.fetchall()

    signers = {}  # address → { urn, image, display_name }
    for row in rows:
        try:
            d = json.loads(row[0])
            cached = d.get("data", d) if isinstance(d, dict) and "data" in d else d
            items = cached if isinstance(cached, list) else [cached]
            for item in items:
                if not isinstance(item, dict):
                    continue
                signer = item.get("SignedBy", "")
                if signer and signer not in signers:
                    signers[signer] = {"urn": None, "image": None, "display": None}
                # Extract profile info if present
                urn = item.get("URN") or item.get("urn")
                addr = item.get("Address") or item.get("address") or signer
                if urn and addr:
                    signers[addr] = {
                        "urn": urn,
                        "image": item.get("Image") or item.get("image"),
                        "display": item.get("DisplayName") or item.get("Name"),
                    }
        except Exception:
            continue

    # Register all discovered signers
    registered = 0
    for addr, info in signers.items():
        if addr:
            await register_known_user(addr, network, info["urn"], info["image"], info["display"])
            registered += 1

    return {
        "registered": registered,
        "network": network,
        "message": f"Registered {registered} users from cached data. Feed will include their posts on next refresh.",
    }


@router.get("/latest-cid")
async def get_latest_snapshot_cid(network: str = Query("btc-testnet")):
    """Get the latest snapshot CID for bootstrapping. This is the public discovery endpoint."""
    await _ensure_snapshot_table()
    conn = await get_conn()
    async with conn.execute(
        "SELECT cid, root_count, size_bytes, created_at FROM snapshots WHERE chain = ? ORDER BY id DESC LIMIT 1",
        (network,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        return {"cid": None, "message": "No snapshots available"}

    return {
        "cid": row[0],
        "root_count": row[1],
        "size_bytes": row[2],
        "created_at": row[3],
        "network": network,
        "ipfs_url": f"https://ipfs.io/ipfs/{row[0]}",
    }

