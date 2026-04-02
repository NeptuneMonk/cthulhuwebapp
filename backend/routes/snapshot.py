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


# ─── Auto-Delta Scheduler ────────────────────────────────────────────────────

_auto_delta_state = {
    "enabled": False,
    "interval_minutes": 15,
    "networks": ["btc-testnet", "btc-mainnet"],  # Multi-chain sweep
    "running": False,
    "last_run": None,
    "last_result": None,
    "runs_total": 0,
    "runs_skipped": 0,  # Skipped because 0 new roots
    "runs_success": 0,
    "log": [],
    "_task": None,
}

# On-chain CID announcement state
_announce_state = {
    "enabled": True,
    "min_interval_hours": 6,
    "last_announced_at": None,
    "last_announced_cid": None,
    "last_txid": None,
    "total_announcements": 0,
    "min_treasury_balance_sats": 50000,  # Don't drain below this
}


def _adlog(msg: str):
    """Append to auto-delta log (keep last 50 entries)."""
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    _auto_delta_state["log"].append(f"[{ts}] {msg}")
    if len(_auto_delta_state["log"]) > 50:
        del _auto_delta_state["log"][:25]
    logger.info(f"AutoDelta: {msg}")


async def _announce_cid_onchain(cid: str, network_indexed: str, snap_type: str, root_count: int):
    """Publish a snapshot CID on-chain via treasury wallet on BTC testnet.
    This allows any desktop app to discover the latest snapshot by reading
    the treasury address's roots for CTHULHU-SNAPSHOT keyword posts."""
    import os
    from bit import PrivateKeyTestnet
    from utils.p2fk import (
        build_signed_payload, build_post_payload,
        encode_payload_to_addresses, get_keyword_address,
    )
    from utils.blockchain import fetch_utxos_mempool, broadcast_raw_tx

    state = _announce_state

    # Check cooldown — max once per min_interval_hours
    if state["last_announced_at"]:
        elapsed_hours = (time.time() - state["last_announced_at"]) / 3600
        if elapsed_hours < state["min_interval_hours"]:
            _adlog(f"CID announce skipped — {elapsed_hours:.1f}h since last (min {state['min_interval_hours']}h)")
            return {"skipped": True, "reason": "cooldown"}

    # Check treasury WIF
    wif = os.environ.get("TREASURY_TESTNET_WIF", "")
    if not wif:
        _adlog("CID announce skipped — no TREASURY_TESTNET_WIF configured")
        return {"skipped": True, "reason": "no_wif"}

    try:
        key = PrivateKeyTestnet(wif)
        treasury_address = key.address

        # Check balance — don't drain the wallet
        from routes.treasury import _fetch_balance
        balance = await _fetch_balance(treasury_address, False)
        if balance < state["min_treasury_balance_sats"]:
            _adlog(f"CID announce skipped — treasury balance too low ({balance} sats < {state['min_treasury_balance_sats']})")
            return {"skipped": True, "reason": "low_balance", "balance": balance}

        # Build P2FK post: the content any node can parse
        post_content = f"CTHULHU_SNAPSHOT cid:{cid} chain:{network_indexed} type:{snap_type} roots:{root_count}"
        msg_payload = build_post_payload(post_content)
        signed_payload = build_signed_payload(msg_payload, wif, is_mainnet=False)
        version_byte = 111  # testnet
        encoded_addresses = encode_payload_to_addresses(signed_payload, version_byte)

        # Add CTHULHU-SNAPSHOT keyword for discovery
        kw_addr = get_keyword_address("CTHULHU-SNAPSHOT", version_byte)
        full_list = list(encoded_addresses)
        if kw_addr not in full_list:
            full_list.append(kw_addr)

        # Sender last (P2FK protocol)
        while treasury_address in full_list:
            full_list.remove(treasury_address)
        full_list.append(treasury_address)

        outputs = [(addr, 546, "satoshi") for addr in full_list]

        # Fetch UTXOs and build tx
        utxos = await fetch_utxos_mempool(treasury_address, is_mainnet=False)
        if not utxos:
            _adlog("CID announce skipped — no UTXOs for treasury")
            return {"skipped": True, "reason": "no_utxos"}
        key._unspents = utxos

        tx_hex = key.create_transaction(outputs)

        # Broadcast
        result = await broadcast_raw_tx(tx_hex, is_mainnet=False)
        if not result.get("success"):
            _adlog(f"CID announce broadcast failed: {result.get('error', 'unknown')}")
            return {"error": result.get("error", "broadcast_failed")}

        txid = result["txid"]
        dust_cost = len(full_list) * 546

        # Record in treasury ledger
        try:
            from routes.treasury import record_ledger_entry
            await record_ledger_entry(
                "snapshot_announce", dust_cost, "btc-testnet",
                txid=txid, details=f"CID announce: {cid[:20]}... chain={network_indexed} type={snap_type}"
            )
        except Exception as e:
            logger.warning(f"Ledger recording failed for CID announce: {e}")

        # Update state
        state["last_announced_at"] = time.time()
        state["last_announced_cid"] = cid
        state["last_txid"] = txid
        state["total_announcements"] += 1

        _adlog(f"CID announced on-chain! txid={txid[:16]}... cid={cid[:20]}... cost={dust_cost} sats")
        return {"success": True, "txid": txid, "cid": cid, "cost_sats": dust_cost}

    except Exception as e:
        _adlog(f"CID announce error: {e}")
        return {"error": str(e)}


async def _auto_delta_loop():
    """Background loop: vacuum → delta snapshot → sleep → repeat.
    Multi-chain: sweeps ALL configured networks each cycle.
    Skips snapshot production if vacuum finds 0 new roots."""
    state = _auto_delta_state
    networks = state["networks"]
    _adlog(f"Started (every {state['interval_minutes']}m, networks: {', '.join(networks)})")

    while state["enabled"]:
        state["running"] = True
        state["runs_total"] += 1
        total_new_roots = 0
        latest_cid = None
        latest_network = None
        latest_type = None
        latest_root_count = 0

        for network in networks:
            try:
                _adlog(f"[{network}] Vacuum: crawling known signers...")
                conn = await get_conn()

                # Count roots before vacuum
                async with conn.execute(
                    "SELECT COUNT(*) FROM api_cache WHERE _id LIKE ?",
                    (f"p2fk:GetRoot%:{('mainnet' in network)}:%",)
                ) as cursor:
                    row = await cursor.fetchone()
                    pre_count = row[0] if row else 0

                await _run_vacuum(network)

                # Wait for vacuum to finish
                while _vacuum_state["running"]:
                    await asyncio.sleep(2)

                # Count roots after vacuum
                async with conn.execute(
                    "SELECT COUNT(*) FROM api_cache WHERE _id LIKE ?",
                    (f"p2fk:GetRoot%:{('mainnet' in network)}:%",)
                ) as cursor:
                    row = await cursor.fetchone()
                    post_count = row[0] if row else 0

                new_roots = post_count - pre_count
                total_new_roots += new_roots

                # Produce delta only if new roots found for this network
                if new_roots > 0:
                    _adlog(f"[{network}] Found {new_roots} new roots → producing delta...")
                    result = await _produce_snapshot(network, delta=True)
                    if result.get("cid"):
                        state["runs_success"] += 1
                        latest_cid = result["cid"]
                        latest_network = network
                        latest_type = result.get("type", "delta")
                        latest_root_count = result.get("total_roots", 0)
                        _adlog(f"[{network}] Delta pinned: {result['cid'][:20]}... ({result.get('total_roots', 0)} roots)")
                    else:
                        _adlog(f"[{network}] Delta failed: {result.get('error', 'unknown')}")
                else:
                    _adlog(f"[{network}] 0 new roots — skipping snapshot")

            except Exception as e:
                _adlog(f"[{network}] Error: {e}")

        if total_new_roots == 0:
            state["runs_skipped"] += 1

        # On-chain CID announcement (on BTC testnet) if we produced a snapshot
        if latest_cid and _announce_state["enabled"]:
            await _announce_cid_onchain(latest_cid, latest_network, latest_type, latest_root_count)

        state["running"] = False
        state["last_run"] = datetime.now(timezone.utc).isoformat()

        # Sleep for interval (check every 10s if still enabled)
        sleep_seconds = state["interval_minutes"] * 60
        slept = 0
        while slept < sleep_seconds and state["enabled"]:
            await asyncio.sleep(10)
            slept += 10

    _adlog("Stopped")


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

    try:
        await _run_vacuum_inner(network)
    except Exception as e:
        _vlog(f"VACUUM CRASHED: {e}")
        _vacuum_state["phase"] = "error"
    finally:
        _vacuum_state["running"] = False


async def _run_vacuum_inner(network: str):
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
    try:
        async with conn.execute("SELECT json_extract(data, '$.address') FROM known_users WHERE json_extract(data, '$.address') IS NOT NULL") as cursor:
            known = [row[0] for row in await cursor.fetchall()]
    except Exception as e:
        _vlog(f"Warning reading known_users: {e}")
        known = []

    for addr in known:
        discovered_addresses.add(addr)

    _vlog(f"Total addresses to crawl: {len(discovered_addresses)} (after adding {len(known)} known users)")

    # Phase 3: Deep root crawl — get roots for ALL discovered addresses (not just seeds)
    # This catches roots signed by objects, non-profile addresses, etc.
    _vacuum_state["phase"] = "crawling_deep_roots"
    disc_for_roots = list(discovered_addresses)
    _vacuum_state["total"] = len(disc_for_roots)
    _vacuum_state["progress"] = 0
    deep_discovered = set()
    roots_found = 0

    for i, addr in enumerate(disc_for_roots):
        _vacuum_state["progress"] = i + 1
        if i % 50 == 0:
            _vlog(f"Deep roots: {i}/{len(disc_for_roots)} (+{len(deep_discovered)} new addresses)")

        try:
            roots = await p2fk_get(f"GetRootsByAddress/{addr}", mainnet)
            if isinstance(roots, list):
                roots_found += len(roots)
                for root in roots:
                    outputs = root.get("Output", {})
                    if isinstance(outputs, dict):
                        for out_addr in outputs.keys():
                            if out_addr not in discovered_addresses and out_addr not in seeds:
                                deep_discovered.add(out_addr)
                    signed_by = root.get("SignedBy", "")
                    if signed_by and signed_by not in discovered_addresses and signed_by not in seeds:
                        deep_discovered.add(signed_by)
        except Exception:
            _vacuum_state["errors"] += 1

        _vacuum_state["crawled"] += 1
        await asyncio.sleep(_RATE_INTERVAL)

    # Merge deep-discovered addresses (cap to prevent explosion)
    MAX_DEEP = 500
    if len(deep_discovered) > MAX_DEEP:
        _vlog(f"Capping deep discovery to {MAX_DEEP} (found {len(deep_discovered)})")
        deep_discovered = set(list(deep_discovered)[:MAX_DEEP])

    discovered_addresses.update(deep_discovered)
    _vlog(f"Deep root crawl complete: {roots_found} roots found, {len(deep_discovered)} new addresses discovered. Total: {len(discovered_addresses)}")

    # Phase 4: Crawl discovered addresses (profiles)
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

    # Phase 5: Crawl objects owned/created by discovered addresses
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

    # Phase 6: Search for common keywords
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

            # Get the snapshot_id we just inserted
            cursor = await conn.execute("SELECT last_insert_rowid()")
            snap_id_row = await cursor.fetchone()
            snap_id_val = snap_id_row[0] if snap_id_row else 0

            if not delta:
                # Full snapshot: replace all tracked txids for this chain
                await conn.execute("DELETE FROM snapshot_txids WHERE chain = ?", (network,))
                all_txids = set()
                for r in roots:
                    txid = r.get("TransactionId", "") if isinstance(r, dict) else ""
                    if txid:
                        all_txids.add(txid)
                for txid in all_txids:
                    await conn.execute(
                        "INSERT OR IGNORE INTO snapshot_txids (txid, chain, snapshot_id) VALUES (?, ?, ?)",
                        (txid, network, snap_id_val),
                    )
            else:
                # Delta snapshot: add the NEW txids so future deltas skip them
                for r in unique_roots:
                    txid = r.get("TransactionId", "") if isinstance(r, dict) else ""
                    if txid:
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
    from utils.stats_tracker import track_decoder_source
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

        # Track snapshot imports in the decoder stats
        for _ in range(imported):
            track_decoder_source("snapshot_hydrate", "ipfs_snapshot", 0, success=True)

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

    # Tracked txids for delta computation
    async with conn.execute("SELECT COUNT(*) FROM snapshot_txids") as cursor:
        tracked_txids = (await cursor.fetchone())[0]

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
            "tracked_txids": tracked_txids,
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



# ─── Auto-Bootstrap: Background task ─────────────────────────────────────────

_bootstrap_state = {
    "running": False,
    "phase": "idle",
    "progress": 0,
    "total": 0,
    "imported": 0,
    "users": 0,
    "error": None,
    "log": [],
}


def _blog(msg: str):
    """Append to bootstrap log."""
    _bootstrap_state["log"].append(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}")
    if len(_bootstrap_state["log"]) > 50:
        del _bootstrap_state["log"][:25]
    logger.info(f"Bootstrap: {msg}")


async def _run_bootstrap(network: str, start_cid: str):
    """Background task: walk the IPFS snapshot chain and hydrate local cache."""
    _bootstrap_state.update({
        "running": True, "phase": "resolving_chain", "progress": 0, "total": 0,
        "imported": 0, "users": 0, "error": None, "log": [],
    })

    try:
        conn = await get_conn()

        # Walk the daisy-chain: collect all CIDs newest → oldest
        chain_cids = []
        current_cid = start_cid
        max_depth = 50

        while current_cid and len(chain_cids) < max_depth:
            chain_cids.append(current_cid)
            _blog(f"Chain link {len(chain_cids)}: {current_cid[:20]}...")

            async with conn.execute(
                "SELECT previous_cid FROM snapshots WHERE cid = ? AND chain = ?", (current_cid, network)
            ) as cursor:
                row = await cursor.fetchone()

            if row is not None:
                # We have this snapshot's metadata locally
                if row[0]:
                    current_cid = row[0]  # Follow the chain
                else:
                    break  # End of chain (no previous_cid)
            else:
                # Unknown snapshot — try consuming to discover previous_cid
                try:
                    result = await _consume_snapshot(current_cid, network)
                    if result.get("previous_cid"):
                        current_cid = result["previous_cid"]
                    else:
                        break
                except Exception:
                    break

        chain_cids.reverse()  # Chronological order (oldest first)
        _bootstrap_state["total"] = len(chain_cids)
        _bootstrap_state["phase"] = "consuming"
        _blog(f"Resolved chain of {len(chain_cids)} snapshots. Consuming...")

        for i, snapshot_cid in enumerate(chain_cids):
            _bootstrap_state["progress"] = i + 1
            _blog(f"Consuming {i+1}/{len(chain_cids)}: {snapshot_cid[:20]}...")
            result = await _consume_snapshot(snapshot_cid, network)
            _bootstrap_state["imported"] += result.get("imported", 0)
            _bootstrap_state["users"] += result.get("users_registered", 0)
            if result.get("error"):
                _blog(f"  Warning: {result['error']}")

        _blog(f"Bootstrap complete. {_bootstrap_state['imported']} entries, {_bootstrap_state['users']} users.")
        _bootstrap_state["phase"] = "complete"
    except Exception as e:
        _bootstrap_state["error"] = str(e)
        _bootstrap_state["phase"] = "error"
        _blog(f"Bootstrap error: {e}")
    finally:
        _bootstrap_state["running"] = False


@router.post("/auto-bootstrap")
async def auto_bootstrap(
    background_tasks: BackgroundTasks,
    network: str = Query("btc-testnet"),
    cid: Optional[str] = Query(None, description="Specific CID to bootstrap from. If omitted, uses latest local snapshot."),
):
    """Start auto-bootstrap as a background task."""
    if _bootstrap_state["running"]:
        return {"error": "Bootstrap already running", "phase": _bootstrap_state["phase"]}

    await _ensure_snapshot_table()
    conn = await get_conn()

    start_cid = cid
    if not start_cid:
        async with conn.execute(
            "SELECT cid FROM snapshots WHERE chain = ? ORDER BY id DESC LIMIT 1", (network,)
        ) as cursor:
            row = await cursor.fetchone()
        if row:
            start_cid = row[0]

    if not start_cid:
        return {"error": "No snapshot CID available. Produce a snapshot first or provide a CID."}

    background_tasks.add_task(_run_bootstrap, network, start_cid)
    return {"started": True, "network": network, "start_cid": start_cid}


@router.get("/bootstrap-status")
async def bootstrap_status():
    """Get current bootstrap progress."""
    return {
        "running": _bootstrap_state["running"],
        "phase": _bootstrap_state["phase"],
        "progress": _bootstrap_state["progress"],
        "total": _bootstrap_state["total"],
        "imported": _bootstrap_state["imported"],
        "users": _bootstrap_state["users"],
        "error": _bootstrap_state["error"],
        "log": _bootstrap_state["log"][-20:],
    }



# ─── Auto-Delta Endpoints ────────────────────────────────────────────────────

@router.post("/auto-delta/start")
async def start_auto_delta(
    interval: int = Query(15, description="Minutes between delta runs"),
    networks: str = Query("btc-testnet,btc-mainnet", description="Comma-separated networks to sweep"),
):
    """Start the auto-delta scheduler. Sweeps ALL networks each cycle. Skips if 0 new roots."""
    if _auto_delta_state["enabled"]:
        return {"error": "Auto-delta already running", "state": _get_auto_delta_status()}

    _auto_delta_state["enabled"] = True
    _auto_delta_state["interval_minutes"] = max(5, min(interval, 1440))  # 5 min to 24 hr
    _auto_delta_state["networks"] = [n.strip() for n in networks.split(",") if n.strip()]
    _auto_delta_state["_task"] = asyncio.create_task(_auto_delta_loop())
    return {"started": True, **_get_auto_delta_status()}


@router.post("/auto-delta/stop")
async def stop_auto_delta():
    """Stop the auto-delta scheduler."""
    _auto_delta_state["enabled"] = False
    task = _auto_delta_state.get("_task")
    if task and not task.done():
        task.cancel()
    _auto_delta_state["_task"] = None
    _adlog("Stopped by user")
    return {"stopped": True, **_get_auto_delta_status()}


@router.get("/auto-delta/status")
async def auto_delta_status():
    """Get auto-delta scheduler state."""
    return _get_auto_delta_status()


@router.get("/announce/status")
async def announce_status():
    """Get on-chain CID announcement state."""
    return {
        "enabled": _announce_state["enabled"],
        "min_interval_hours": _announce_state["min_interval_hours"],
        "last_announced_at": _announce_state["last_announced_at"],
        "last_announced_cid": _announce_state["last_announced_cid"],
        "last_txid": _announce_state["last_txid"],
        "total_announcements": _announce_state["total_announcements"],
        "min_treasury_balance_sats": _announce_state["min_treasury_balance_sats"],
    }


@router.post("/announce/config")
async def configure_announce(
    enabled: Optional[bool] = Query(None),
    min_interval_hours: Optional[int] = Query(None),
    min_treasury_balance_sats: Optional[int] = Query(None),
):
    """Configure on-chain CID announcement settings."""
    if enabled is not None:
        _announce_state["enabled"] = enabled
    if min_interval_hours is not None:
        _announce_state["min_interval_hours"] = max(1, min(min_interval_hours, 168))  # 1h to 1 week
    if min_treasury_balance_sats is not None:
        _announce_state["min_treasury_balance_sats"] = max(10000, min_treasury_balance_sats)
    return {"updated": True, **{k: v for k, v in _announce_state.items()}}


@router.post("/announce/trigger")
async def trigger_announce(
    cid: str = Query(..., description="CID to announce on-chain"),
    network: str = Query("btc-testnet", description="Network the snapshot indexes"),
    snap_type: str = Query("manual", description="Snapshot type (full/delta/manual)"),
    root_count: int = Query(0),
):
    """Manually trigger an on-chain CID announcement via treasury wallet."""
    return await _announce_cid_onchain(cid, network, snap_type, root_count)


def _get_auto_delta_status():
    s = _auto_delta_state
    return {
        "enabled": s["enabled"],
        "interval_minutes": s["interval_minutes"],
        "networks": s["networks"],
        "running": s["running"],
        "last_run": s["last_run"],
        "last_result": s["last_result"],
        "runs_total": s["runs_total"],
        "runs_skipped": s["runs_skipped"],
        "runs_success": s["runs_success"],
        "log": s["log"][-20:],
        "announce": {
            "enabled": _announce_state["enabled"],
            "last_announced_cid": _announce_state["last_announced_cid"],
            "last_txid": _announce_state["last_txid"],
            "total_announcements": _announce_state["total_announcements"],
        },
    }


def start_auto_delta_on_boot():
    """Auto-start the multi-chain delta loop on server boot.
    Desktop apps and standalone servers start sweeping immediately —
    no admin action needed."""
    if _auto_delta_state["enabled"]:
        return  # Already running
    _auto_delta_state["enabled"] = True
    _auto_delta_state["_task"] = asyncio.create_task(_auto_delta_loop())
    logger.info("[AutoDelta] Auto-started on boot (multi-chain, 15m interval)")
