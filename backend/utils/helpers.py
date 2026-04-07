"""Shared helpers: p2fk API, known users, profile caching, formatters."""
import logging
import uuid
import asyncio
import re
import time
import json
from cachetools import TTLCache
from datetime import datetime, timezone

from db import known_users_col, api_cache_col, db
from config import P2FK_API_BASE, SEED_ADDRESSES
from utils.stats_tracker import track_api_call, track_cache, track_decoder_source
from utils.http_pool import get_client

# Local P2FK decoder imports (fallback when p2fk.io is down)
from p2fk_decoder import decode_root_from_raw_tx, keyword_to_address
from blockchain_api import (
    fetch_transaction as local_fetch_tx,
    fetch_address_transactions as local_fetch_addr_txs,
    get_version_byte,
)

logger = logging.getLogger(__name__)

# TTL for API cache: roots are immutable (1yr), profiles=1hr, default=10min
_CACHE_TTL_ROOT = 31536000  # 1 year — immutable blockchain data (GetRootByTransactionId)
_CACHE_TTL_PROFILE = 3600
_CACHE_TTL_DEFAULT = 600    # 10 minutes per embii's recommendation
_CACHE_TTL_POLL = 30        # 30 seconds — polls need near-real-time vote counts
_CACHE_TTL_OWNERSHIP = 120  # 2 minutes — object ownership changes after GIV/BRN/BUY

# Rate-limit guard: sliding window for p2fk.io
# embii confirmed higher throughput is fine now (bitfossil-level)
_P2FK_MAX_RETRIES = 2
_p2fk_lock = asyncio.Lock()
_p2fk_request_times: list = []  # timestamps of recent requests (sliding window)
_P2FK_WINDOW = 10.0  # seconds
_P2FK_MAX_IN_WINDOW = 30  # increased per embii's guidance
_p2fk_blocked_until = 0.0  # if blocked, don't send until this monotonic time


async def _get_api_cache(cache_key: str, ttl: int):
    """Get cached API response from MongoDB. Returns data or None."""
    try:
        doc = await api_cache_col.find_one({"_id": cache_key}, {"_id": 0})
        if doc and doc.get("ts"):
            age = datetime.now(timezone.utc).timestamp() - doc["ts"]
            if age < ttl:
                return doc.get("data")
            # Return stale data but mark as expired (caller can decide)
            return doc.get("data")  # Still return stale for fallback
    except Exception:
        pass
    return None


async def _is_cache_fresh(cache_key: str, ttl: int):
    """Check if cache entry is within TTL."""
    try:
        doc = await api_cache_col.find_one({"_id": cache_key}, {"_id": 0, "ts": 1})
        if doc and doc.get("ts"):
            return (datetime.now(timezone.utc).timestamp() - doc["ts"]) < ttl
    except Exception:
        pass
    return False


async def _set_api_cache(cache_key: str, data):
    """Store API response in MongoDB cache. Includes datetime for TTL index."""
    try:
        await api_cache_col.update_one(
            {"_id": cache_key},
            {"$set": {
                "data": data,
                "ts": datetime.now(timezone.utc).timestamp(),
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True
        )
    except Exception as e:
        logger.debug(f"Cache write error: {e}")


# --- p2fk.io API helpers ---

def _root_to_p2fk_format(root_dict: dict) -> dict:
    """Convert local decoder Root dict to match p2fk.io response format.
    Main difference: p2fk.io outputs values in BTC (e.g., '0.00000548'),
    our decoder uses satoshi strings (e.g., '548')."""
    out = dict(root_dict)
    # Convert Output values from satoshis to BTC strings
    if 'Output' in out and isinstance(out['Output'], dict):
        converted = {}
        for addr, val in out['Output'].items():
            try:
                sats = int(val)
                converted[addr] = f"{sats / 1e8:.8f}"
            except (ValueError, TypeError):
                converted[addr] = val
        out['Output'] = converted
    return out


async def _local_fetch_objects_for_address(address: str, network: str, version_byte: int):
    """Locally reconstruct objects owned/created by an address.
    Scans all transactions for the address, finds OBJ roots,
    and reconstructs the OBJ JSON metadata from the raw payload."""
    from utils.blockchain import fetch_tx_outputs
    from utils.p2fk import base58_decode_check
    import re

    txs = await local_fetch_addr_txs(address, network, max_pages=3)
    objects = []
    seen_txids = set()

    for tx in txs:
        txid = tx.get('txid', '')
        if not txid or txid in seen_txids:
            continue
        seen_txids.add(txid)

        root = decode_root_from_raw_tx(txid, tx, version_byte)
        if not root or 'OBJ' not in root.files:
            continue
        # Only include objects signed by this address
        if root.signed_by != address:
            continue

        # Reconstruct OBJ file bytes from the transaction outputs
        obj_json = None
        try:
            obj_json = await _try_reconstruct_obj_json(txid, network)
        except Exception as e:
            logger.debug(f"OBJ reconstruction for {txid}: {e}")

        # Build p2fk.io-compatible object dict
        rd = root.to_dict()
        obj_entry = {
            'TransactionId': txid,
            'SignedBy': root.signed_by,
            'Signed': root.signed,
            'BlockDate': rd.get('BlockDate'),
            'BlockHeight': rd.get('BlockHeight'),
            'Confirmations': rd.get('Confirmations', 0),
        }

        if obj_json and isinstance(obj_json, dict):
            # Map standard OBJ fields
            obj_entry['URN'] = obj_json.get('urn', obj_json.get('URN', ''))
            obj_entry['Name'] = obj_json.get('nme', obj_json.get('Name', ''))
            obj_entry['Description'] = obj_json.get('dsc', obj_json.get('Description', ''))
            obj_entry['Image'] = obj_json.get('img', obj_json.get('Image', ''))
            obj_entry['URI'] = obj_json.get('uri', obj_json.get('URI', ''))
            obj_entry['License'] = obj_json.get('lic', obj_json.get('License', ''))
            obj_entry['Attributes'] = obj_json.get('atr', obj_json.get('Attributes', {}))

            # Normalize Creators to p2fk.io format: {address: date_str}
            raw_cre = obj_json.get('cre', obj_json.get('Creators', []))
            if isinstance(raw_cre, list):
                obj_entry['Creators'] = {root.signed_by: "0001-01-01T00:00:00"}
            elif isinstance(raw_cre, dict):
                obj_entry['Creators'] = raw_cre
            else:
                obj_entry['Creators'] = {root.signed_by: "0001-01-01T00:00:00"}

            # Normalize Owners to p2fk.io format: {address: {Item1: qty, Item2: null}}
            raw_own = obj_json.get('own', obj_json.get('Owners', {}))
            if isinstance(raw_own, dict):
                normalized_own = {}
                for k, v in raw_own.items():
                    # Raw format uses index keys; map "0" to signer address
                    owner_addr = root.signed_by if k in ('0', '1') else k
                    qty = v if isinstance(v, int) else 1
                    normalized_own[owner_addr] = {"Item1": qty, "Item2": None}
                obj_entry['Owners'] = normalized_own if normalized_own else {root.signed_by: {"Item1": 1, "Item2": None}}
            else:
                obj_entry['Owners'] = {root.signed_by: {"Item1": 1, "Item2": None}}

            # Maximum supply
            obj_entry['Maximum'] = obj_json.get('max', obj_json.get('Maximum', 0))
        else:
            # Couldn't parse OBJ JSON — use minimal info from root
            obj_entry['URN'] = txid
            obj_entry['Name'] = 'Unknown Object'
            obj_entry['Creators'] = {root.signed_by: "0001-01-01T00:00:00"}
            obj_entry['Owners'] = {root.signed_by: {"Item1": 1, "Item2": None}}

        objects.append(obj_entry)

    # Return None when no local results so p2fk.io gets called as fallback
    return objects if objects else None


async def _local_fetch_objects_by_keyword(keyword: str, network: str, version_byte: int):
    """Fetch objects from the blockchain by keyword.
    Converts keyword → keyword address, fetches all roots there,
    and returns formatted OBJ data."""
    from p2fk_decoder import keyword_to_address

    keyword_addr = keyword_to_address(keyword, version_byte=version_byte)
    if not keyword_addr:
        return None

    txs = await local_fetch_addr_txs(keyword_addr, network, max_pages=2)
    results = []
    seen = set()

    for tx in txs:
        txid = tx.get('txid', '')
        if not txid or txid in seen:
            continue
        seen.add(txid)

        root = decode_root_from_raw_tx(txid, tx, version_byte)
        if not root or 'OBJ' not in root.files:
            continue

        rd = root.to_dict()
        obj_entry = {
            'TransactionId': txid,
            'SignedBy': root.signed_by,
            'Signed': root.signed,
            'BlockDate': rd.get('BlockDate'),
            'BlockHeight': rd.get('BlockHeight'),
            'Confirmations': rd.get('Confirmations', 0),
            'Keyword': keyword,
        }

        # Try to reconstruct OBJ file for metadata
        obj_json = await _try_reconstruct_obj_json(txid, network)
        if obj_json and isinstance(obj_json, dict):
            obj_entry['URN'] = obj_json.get('urn', obj_json.get('URN', ''))
            obj_entry['Name'] = obj_json.get('nme', obj_json.get('Name', keyword))
            obj_entry['Description'] = obj_json.get('dsc', obj_json.get('Description', ''))
            obj_entry['Image'] = obj_json.get('img', obj_json.get('Image', ''))
            obj_entry['URI'] = obj_json.get('uri', obj_json.get('URI', ''))
            obj_entry['License'] = obj_json.get('lic', obj_json.get('License', ''))
            obj_entry['Attributes'] = obj_json.get('atr', obj_json.get('Attributes', {}))
            raw_cre = obj_json.get('cre', [])
            obj_entry['Creators'] = {root.signed_by: "0001-01-01T00:00:00"} if isinstance(raw_cre, list) else raw_cre
            raw_own = obj_json.get('own', {})
            if isinstance(raw_own, dict):
                obj_entry['Owners'] = {
                    (root.signed_by if k in ('0', '1') else k): {"Item1": v if isinstance(v, int) else 1, "Item2": None}
                    for k, v in raw_own.items()
                } or {root.signed_by: {"Item1": 1, "Item2": None}}
            else:
                obj_entry['Owners'] = {root.signed_by: {"Item1": 1, "Item2": None}}
            obj_entry['Maximum'] = obj_json.get('max', 0)
        else:
            obj_entry['URN'] = txid
            obj_entry['Name'] = keyword
            obj_entry['Creators'] = {root.signed_by: "0001-01-01T00:00:00"}
            obj_entry['Owners'] = {root.signed_by: {"Item1": 1, "Item2": None}}

        results.append(obj_entry)

    return results if results else None


async def _local_search_objects(extra_params: dict, network: str, version_byte: int):
    """Search through cached storefront objects AND try the search term as a keyword.
    Returns results in p2fk.io GetKnownObjectsBySearchString format:
    [{object: {...}, blockchain: "BTC-testnet"}, ...]
    Returns None for empty search to allow p2fk.io fallthrough."""
    search_str = (extra_params or {}).get('searchString', '').strip().lower()
    qty = int((extra_params or {}).get('qty', '20'))
    skip = int((extra_params or {}).get('skip', '0'))
    if not search_str:
        return None  # Let p2fk.io handle empty/browse queries

    # Determine blockchain label for wrapping
    bc_label = 'BTC-testnet'
    if 'mainnet' in network:
        bc_label = 'BTC'
    elif 'doge' in network.lower():
        bc_label = 'DOG-testnet' if 'testnet' in network else 'DOG'
    elif 'ltc' in network.lower():
        bc_label = 'LTC-testnet' if 'testnet' in network else 'LTC'

    results = []
    seen_txids = set()

    # 1. Search through cached objects in object_cache
    try:
        cursor = db.object_cache.find({})
        cached_objs = await cursor.to_list(1000)
        for obj_doc in cached_objs:
            obj = obj_doc.get('data', obj_doc)
            searchable = json.dumps(obj, default=str).lower()
            if search_str in searchable:
                txid = obj.get('TransactionId', obj.get('transaction_id', ''))
                if txid and txid not in seen_txids:
                    seen_txids.add(txid)
                    results.append(obj)
    except Exception:
        pass

    # 2. Also try the search term as a keyword (fetches from chain)
    try:
        kw_results = await _local_fetch_objects_by_keyword(search_str, network, version_byte)
        for obj in (kw_results or []):
            txid = obj.get('TransactionId', '')
            if txid and txid not in seen_txids:
                seen_txids.add(txid)
                results.append(obj)
    except Exception:
        pass

    # Apply pagination
    paged = results[skip:skip + qty]

    # If no local results found, return None to let p2fk.io try
    if not paged:
        return None

    # Wrap in p2fk.io GetKnownObjectsBySearchString format
    return [{"object": obj, "blockchain": bc_label} for obj in paged]


async def _try_reconstruct_obj_json(txid: str, network: str):
    """Try to reconstruct the OBJ file JSON from a transaction."""
    import re
    try:
        is_mainnet = 'mainnet' in network
        chain = 'BTC'
        if 'doge' in network.lower():
            chain = 'DOGE'
        elif 'ltc' in network.lower():
            chain = 'LTC'

        from utils.blockchain import fetch_tx_outputs
        from utils.p2fk import base58_decode_check
        outputs = await fetch_tx_outputs(txid, chain=chain, mainnet=is_mainnet)
        if not outputs:
            return None

        raw = bytearray()
        for addr in outputs:
            try:
                payload = base58_decode_check(addr)
                raw.extend(payload)
            except Exception:
                continue

        known_seps = rb'[\\/:\*\?"<>\|]'
        pattern = re.compile(rb'OBJ' + known_seps + rb'(\d+)' + known_seps)
        match = pattern.search(bytes(raw))
        if match:
            size = int(match.group(1))
            content_start = match.end()
            obj_bytes = bytes(raw)[content_start:content_start + size]
            return json.loads(obj_bytes.decode('utf-8', errors='replace'))
    except Exception as e:
        logger.debug(f"OBJ reconstruct for {txid}: {e}")
    return None


async def _local_p2fk_fallback(path: str, mainnet: bool = False, extra_params: dict = None):
    """Try to handle a p2fk.io API path using the local decoder.
    Returns None if the path is not supported locally."""
    try:
        network = 'btc-mainnet' if mainnet else 'btc-testnet'
        version_byte = get_version_byte(network)

        # GetRootByTransactionID/{txid}
        if path.startswith('GetRootByTransactionID/'):
            txid = path.split('/', 1)[1]
            raw_tx = await local_fetch_tx(txid, network)
            if not raw_tx:
                return None
            root = decode_root_from_raw_tx(txid, raw_tx, version_byte)
            return _root_to_p2fk_format(root.to_dict()) if root else None

        # GetRootsByAddress/{address} — SKIP local decoder.
        # The local decoder only scans recent transactions (max_pages=2 ≈ 50 txs)
        # and returns partial results. These partial results overwrite the full
        # p2fk.io cache during vacuum, causing the index to shrink over time.
        # Return None to always use p2fk.io's complete index.
        if path.startswith('GetRootsByAddress/'):
            return None

        # GetPublicAddressByKeyword/{keyword}
        if path.startswith('GetPublicAddressByKeyword/'):
            keyword = path.split('/', 1)[1]
            return keyword_to_address(keyword, version_byte)

        # GetObjectByTransactionId — SKIP local decoder.
        # The local decoder can only return raw P2FK roots (Message, File, Keyword, Output),
        # not resolved objects (Name, URN, Image, Owners, Creators). Cross-chain objects
        # (MZC, DOG, LTC) especially need p2fk.io's full resolution pipeline.
        if path.startswith('GetObjectByTransactionId/'):
            return None

        # GetProfileByAddress/{address} — fetch roots, extract profile-like data
        if path.startswith('GetProfileByAddress/'):
            address = path.split('/', 1)[1]
            txs = await local_fetch_addr_txs(address, network, max_pages=1)
            for tx in txs:
                txid = tx.get('txid', '')
                if not txid:
                    continue
                root = decode_root_from_raw_tx(txid, tx, version_byte)
                if not root or address not in root.outputs:
                    continue
                rd = root.to_dict()
                # Check if this root contains profile data (PRO file or JSON with URN)
                if 'PRO' in rd.get('File', {}):
                    for msg in rd.get('Message', []):
                        try:
                            data = json.loads(msg)
                            data.update({
                                'TransactionId': rd.get('TransactionId', ''),
                                'SignedBy': rd.get('SignedBy', ''),
                                'Signed': rd.get('Signed', False),
                                'BlockDate': rd.get('BlockDate', ''),
                                'Creators': [rd.get('SignedBy', '')],
                            })
                            return data
                        except json.JSONDecodeError:
                            continue
            return None

        # GetObjectByAddress / GetObjectsByAddress — SKIP local decoder for aggregate queries.
        # Single-object lookups could work locally, but the plural form is aggregate.
        # Both are skipped to ensure p2fk.io (authoritative full index) is always used.
        if path.startswith('GetObjectByAddress/') or path.startswith('GetObjectsByAddress/'):
            return None

        # GetObjectsOwnedByAddress / GetObjectsCreatedByAddress — SKIP local decoder.
        # These aggregate queries require a full blockchain index. The local decoder
        # only scans recent transactions (max_pages=3 ≈ 75 txs) and returns partial
        # results, blocking the p2fk.io fallback which has the complete set.
        # Return None to let p2fk_get go straight to p2fk.io.
        if path.startswith('GetObjectsOwnedByAddress/') or path.startswith('GetObjectsCreatedByAddress/'):
            return None

        # GetObjectsByKeyword/{keyword} — objects sent to a keyword address
        if path.startswith('GetObjectsByKeyword/'):
            keyword = path.split('/', 1)[1]
            return await _local_fetch_objects_by_keyword(keyword, network, version_byte)

        # GetKnownObjectsBySearchString — SKIP local decoder for search queries.
        # The local cache only holds a tiny subset of all objects, so local search
        # always returns partial results that block the full p2fk.io index.
        if path == 'GetKnownObjectsBySearchString':
            return None

    except Exception as e:
        logger.debug(f"Local fallback error [{path}]: {e}")
    return None


async def p2fk_get(path: str, mainnet: bool = False, extra_params: dict = None, skip_cache: bool = False):
    """Fetch from p2fk.io with MongoDB cache (serve fresh cache, fallback stale).
    Priority: cache_fresh → local_decoder → p2fk_io → cache_stale.
    Rate-limited to 3 concurrent requests with 429 backoff/retry."""
    cache_key = f"p2fk:{path}:{mainnet}:{extra_params}"
    # GetRootByTransactionId is immutable — cache permanently
    if 'GetRootByTransaction' in path:
        cache_ttl = _CACHE_TTL_ROOT
    elif 'Profile' in path:
        cache_ttl = _CACHE_TTL_PROFILE
    elif 'Inquiry' in path or 'Inquiries' in path:
        cache_ttl = _CACHE_TTL_POLL
    elif 'ObjectsOwned' in path or 'ObjectsByAddress' in path or 'GetObjectByAddress' in path:
        cache_ttl = _CACHE_TTL_OWNERSHIP
    else:
        cache_ttl = _CACHE_TTL_DEFAULT

    # Serve fresh cache immediately (skip network call entirely)
    if not skip_cache and await _is_cache_fresh(cache_key, cache_ttl):
        cached = await _get_api_cache(cache_key, cache_ttl)
        if cached is not None:
            track_cache(hit=True)
            track_decoder_source(path, "cache_fresh", 0)
            return cached

    track_cache(hit=False)

    # ── LOCAL DECODER FIRST ──
    # Try our own P2FK decoder before hitting p2fk.io
    t0_local = time.time()
    local_result = await _local_p2fk_fallback(path, mainnet, extra_params)
    local_ms = (time.time() - t0_local) * 1000
    if local_result is not None:
        logger.info(f"Local decoder served [{path}] in {local_ms:.0f}ms")
        track_decoder_source(path, "local_decoder", local_ms)
        asyncio.create_task(_set_api_cache(cache_key, local_result))
        return local_result
    track_decoder_source(path, "local_decoder", local_ms, success=False)

    # ── FALLBACK: p2fk.io ──
    # showSystemFiles=false: embii's server-side filter — reduces payload, skips system file noise
    params = {"mainnet": str(mainnet).lower(), "showSystemFiles": "false"}
    if extra_params:
        params.update(extra_params)

    for attempt in range(_P2FK_MAX_RETRIES + 1):
        try:
            # Sliding window rate limiter — wait if window is full or if blocked
            async with _p2fk_lock:
                global _p2fk_blocked_until
                now = time.monotonic()

                # If we're in a block period, wait it out
                if now < _p2fk_blocked_until:
                    wait_block = _p2fk_blocked_until - now
                    logger.info(f"p2fk.io blocked — waiting {wait_block:.1f}s [{path}]")
                    await asyncio.sleep(wait_block)
                    now = time.monotonic()

                # Prune old timestamps outside the window
                cutoff = now - _P2FK_WINDOW
                while _p2fk_request_times and _p2fk_request_times[0] < cutoff:
                    _p2fk_request_times.pop(0)

                # If window is full, wait until the oldest request exits the window
                if len(_p2fk_request_times) >= _P2FK_MAX_IN_WINDOW:
                    wait_window = _p2fk_request_times[0] - cutoff
                    if wait_window > 0:
                        await asyncio.sleep(wait_window)
                    _p2fk_request_times.pop(0)

                _p2fk_request_times.append(time.monotonic())

            t0 = time.time()
            client = get_client()
            resp = await client.get(f"{P2FK_API_BASE}/{path}", params=params, timeout=15.0)
            duration_ms = (time.time() - t0) * 1000
            endpoint_short = path.split('/')[0] if '/' in path else path
            track_api_call("p2fk.io", endpoint_short, duration_ms)

            if resp.status_code == 429:
                # We got blocked — stop all requests for 11 seconds
                async with _p2fk_lock:
                    _p2fk_blocked_until = time.monotonic() + 11.0
                    _p2fk_request_times.clear()
                if attempt < _P2FK_MAX_RETRIES:
                    logger.warning(f"p2fk.io 429 [{path}] — IP blocked, pausing 11s (attempt {attempt+1})")
                    await asyncio.sleep(11.0)
                    continue
                else:
                    logger.warning(f"p2fk.io 429 [{path}] — exhausted retries, serving stale cache")
                    break

            if resp.status_code == 200:
                data = resp.json()
                # Don't cache empty/null profile responses from p2fk.io
                is_empty_profile = (
                    isinstance(data, dict)
                    and 'Profile' in path
                    and data.get('Id', 0) == 0
                    and not data.get('URN')
                )
                # Don't cache empty list results (objects, roots) — likely API hiccup
                is_empty_list = isinstance(data, list) and len(data) == 0
                if not is_empty_profile and not is_empty_list:
                    asyncio.create_task(_set_api_cache(cache_key, data))
                    # Index root data for local text search
                    if 'Root' in path or 'GetRootsByAddress' in path:
                        asyncio.create_task(_index_roots_for_search(data, path, mainnet))
                    track_decoder_source(path, "p2fk_io", duration_ms)
                else:
                    # p2fk.io returned garbage — try stale cache instead
                    cached = await _get_api_cache(cache_key, ttl=86400)
                    if cached is not None:
                        logger.info(f"Ignoring empty p2fk.io response, serving stale cache for [{path}]")
                        track_decoder_source(path, "cache_stale", duration_ms)
                        return cached
                return data
            break  # Non-429 error, fall through to stale cache
        except Exception as e:
            logger.error(f"p2fk.io error [{path}]: {e}")
            break

    # API failed or 429 exhausted — serve stale cache (up to 24hr old on failure)
    cached = await _get_api_cache(cache_key, ttl=max(cache_ttl, 86400))
    if cached is not None:
        logger.info(f"Serving stale cache for [{path}]")
        track_decoder_source(path, "cache_stale", 0)
        return cached

    return None


async def _index_roots_for_search(data, path: str, mainnet: bool):
    """Extract searchable fields from root data and insert into root_search_index.
    Called as a fire-and-forget task whenever root data flows through p2fk_get."""
    try:
        from db_sqlite import get_conn
        roots = []
        if isinstance(data, list):
            roots = data
        elif isinstance(data, dict) and data.get('TransactionId'):
            roots = [data]
        else:
            return

        if not roots:
            return

        conn = await get_conn()
        for root in roots:
            if not isinstance(root, dict):
                continue
            txid = root.get('TransactionId', '')
            if not txid:
                continue
            file_data = root.get('File') or {}
            files_str = json.dumps(file_data) if isinstance(file_data, dict) else str(file_data)
            messages = root.get('Message', [])
            msg_str = ' '.join(messages) if isinstance(messages, list) else str(messages)
            signed_by = root.get('SignedBy', '')
            block_date = root.get('BlockDate', '')
            blockchain = 'mainnet' if mainnet else 'testnet'
            await conn.execute(
                "INSERT OR IGNORE INTO root_search_index (txid, files_json, message, signed_by, blockchain, block_date) VALUES (?, ?, ?, ?, ?, ?)",
                (txid, files_str, msg_str, signed_by, blockchain, block_date),
            )
        await conn.commit()
    except Exception as e:
        logger.debug(f"Root search index error: {e}")


async def batch_verify_burns(object_addresses: list, is_mainnet: bool, network: str) -> set:
    """Check multiple object addresses for BRN roots.
    For objects with BRN roots, verify via p2fk.io that total_supply == 0.
    Returns set of fully-burned object addresses."""
    from routes.snapshot import get_burned_set, _register_burned_object

    # Start with known burned objects
    known_burned = await get_burned_set(network)
    newly_burned = set()

    # Only check objects not already known to be burned
    to_check = [a for a in object_addresses if a and a not in known_burned]
    if not to_check:
        return known_burned

    async def _check_one(addr):
        try:
            roots = await p2fk_get(f"GetRootsByAddress/{addr}", is_mainnet)
            if not isinstance(roots, list):
                return
            has_brn = any(
                isinstance(r.get('File'), dict) and 'BRN' in r.get('File', {})
                for r in roots
            )
            if not has_brn:
                return
            # Object has BRN roots — verify current state via p2fk.io
            # Use skip_cache to get fresh data from p2fk.io
            obj_data = await p2fk_get(f"GetObjectByAddress/{addr}", is_mainnet, skip_cache=True)
            if obj_data is None:
                # p2fk.io says it doesn't exist → fully burned
                await _register_burned_object(addr, "", network)
                newly_burned.add(addr)
                return
            owners = obj_data.get('Owners') or {}
            total = sum(
                v.get('Item1', 0) if isinstance(v, dict) else (v if isinstance(v, int) else 0)
                for v in owners.values()
            )
            if total <= 0:
                await _register_burned_object(addr, "", network)
                newly_burned.add(addr)
        except Exception:
            pass

    # Run checks in parallel (max 5 concurrent)
    sem = asyncio.Semaphore(5)
    async def _bounded(addr):
        async with sem:
            await _check_one(addr)

    await asyncio.gather(*[_bounded(a) for a in to_check[:30]], return_exceptions=True)

    return known_burned | newly_burned


async def fetch_profile_by_urn(urn: str, mainnet: bool = False):
    data = await p2fk_get(f"GetProfileByURN/{urn}", mainnet)
    if data and data.get('Id', 0) > 0 and data.get('URN'):
        return data
    return None


async def fetch_profile_by_address(address: str, mainnet: bool = False):
    data = await p2fk_get(f"GetProfileByAddress/{address}", mainnet)
    if isinstance(data, dict) and data.get('Id', 0) > 0:
        return data
    return None


async def fetch_public_messages(address: str, mainnet: bool = False, qty: int = 200):
    """Fetch public messages using GetRootsByAddress (returns ALL posts, not capped at 10).
    Filters out SEC-encrypted messages and non-message roots.
    Normalizes root fields to match the format expected by format_message().
    """
    # Use the same cache key as vacuum (no extra_params) so cached data is reused
    data = await p2fk_get(f"GetRootsByAddress/{address}", mainnet)
    if not isinstance(data, list):
        return []

    public_msgs = []
    for root in data:
        # Skip roots without a message
        msg = root.get('Message')
        if not msg:
            continue

        # Build content string for SEC check
        content_str = ' '.join(msg) if isinstance(msg, list) else str(msg)

        # Skip SEC-encrypted messages
        if content_str.startswith('SEC') and len(content_str) > 4 and content_str[3] in '\\//:*?"<>|':
            continue
        file_data = root.get('File') or {}
        if 'SEC' in file_data:
            continue

        # Normalize to format expected by _build_feed_from_scratch / format_message
        root['FromAddress'] = root.get('SignedBy', address)
        if 'ToAddress' not in root:
            root['ToAddress'] = address
        public_msgs.append(root)

    return public_msgs


async def fetch_objects_owned(address: str, mainnet: bool = False):
    data = await p2fk_get(f"GetObjectsOwnedByAddress/{address}", mainnet, {"verbose": "false"})
    return data if isinstance(data, list) else []


async def fetch_messages_by_sender(address: str, mainnet: bool = False, qty: int = 200):
    """Fetch messages authored BY a given address using GetRootsByAddress.
    Uses GetRootsByAddress instead of GetPublicMessagesByAddress to include
    file attachment data (File field)."""
    # Use the same cache key as vacuum (no extra_params) so cached data is reused
    data = await p2fk_get(f"GetRootsByAddress/{address}", mainnet)
    if not isinstance(data, list):
        return []
    public_msgs = []
    for root in data:
        msg = root.get('Message')
        if not msg:
            continue
        content_str = ' '.join(msg) if isinstance(msg, list) else str(msg)
        if content_str.startswith('SEC') and len(content_str) > 4 and content_str[3] in '\\//:*?"<>|':
            continue
        file_data = root.get('File') or {}
        if 'SEC' in file_data:
            continue
        root['FromAddress'] = root.get('SignedBy', address)
        if 'ToAddress' not in root:
            root['ToAddress'] = address
        public_msgs.append(root)
    return public_msgs


async def fetch_objects_by_address(address: str, mainnet: bool = False):
    data = await p2fk_get(f"GetObjectsByAddress/{address}", mainnet, {"verbose": "false"})
    return data if isinstance(data, list) else []


async def fetch_objects_created_by_address(address: str, mainnet: bool = False):
    data = await p2fk_get(f"GetObjectsCreatedByAddress/{address}", mainnet, {"verbose": "false"})
    return data if isinstance(data, list) else []


async def fetch_object_by_txid(txid: str, mainnet: bool = False):
    # Step 1: Get initial object data to find the object address
    data = await p2fk_get(f"GetObjectByTransactionId/{txid}", mainnet, {"verbose": "true"})
    if not isinstance(data, dict) or not data.get('Name'):
        return None
    # Step 2: Fetch CURRENT state via GetObjectByAddress (returns up-to-date owners/listings)
    creators = data.get('Creators') or {}
    obj_address = list(creators.keys())[0] if creators else None
    if obj_address:
        fresh = await p2fk_get(f"GetObjectByAddress/{obj_address}", mainnet, {"verbose": "true"})
        if isinstance(fresh, dict) and fresh.get('Name'):
            return fresh
    return data


async def fetch_root_file_bytes(txid: str, filename: str = "SEC", network: str = "btc-testnet"):
    """Reconstruct file bytes from a P2FK root transaction by decoding output addresses."""
    from utils.blockchain import fetch_tx_outputs
    from utils.p2fk import base58_decode_check
    import re

    try:
        is_mainnet = 'testnet' not in network
        chain = 'BTC'
        if 'doge' in network.lower():
            chain = 'DOGE'
        elif 'ltc' in network.lower():
            chain = 'LTC'

        outputs = await fetch_tx_outputs(txid, chain=chain, mainnet=is_mainnet)
        if not outputs:
            return None

        # Decode all output addresses to raw bytes
        raw = bytearray()
        for addr in outputs:
            try:
                payload = base58_decode_check(addr)
                raw.extend(payload)
            except Exception:
                continue
        raw = bytes(raw)

        # Find the file pattern: filename + separator + size + separator + content
        known_seps = rb'[\\/:\*\?"<>\|]'
        escaped_name = re.escape(filename.encode('ascii'))
        pattern = re.compile(escaped_name + known_seps + rb'(\d+)' + known_seps)
        match = pattern.search(raw)
        if not match:
            # Also try case-insensitive
            pattern = re.compile(escaped_name + known_seps + rb'(\d+)' + known_seps, re.IGNORECASE)
            match = pattern.search(raw)
        if not match:
            return None

        size = int(match.group(1))
        content_start = match.end()
        # Return the FULL SEC file (header + content) so frontend unwrapSEC works
        full_file = raw[match.start():content_start + size]
        return full_file if len(full_file) > 0 else None
    except Exception as e:
        logger.error(f"P2FK file reconstruction error [{txid}/{filename}]: {e}")
        return None




async def search_keyword(keyword: str, mainnet: bool = False):
    data = await p2fk_get(f"GetPublicAddressByKeyword/{keyword}", mainnet)
    if isinstance(data, str) and data:
        return [data]
    if isinstance(data, list):
        return data[:10]
    return []


async def get_keyword_address_from_api(keyword: str, mainnet: bool = False):
    """Get the P2FK keyword address via the API (canonical)."""
    data = await p2fk_get(f"GetPublicAddressByKeyword/{keyword}", mainnet)
    if isinstance(data, str) and data:
        return data
    return None


async def fetch_keyword_messages(keyword: str, mainnet: bool = False, skip: int = 0, qty: int = 50):
    """Fetch public messages at a keyword address using GetRootsByAddress.
    Uses GetRootsByAddress instead of GetPublicMessagesByAddress to include
    file attachment data (File field) in the returned roots."""
    addr = await get_keyword_address_from_api(keyword, mainnet)
    if not addr:
        return []
    data = await p2fk_get(f"GetRootsByAddress/{addr}", mainnet, extra_params={"skip": str(skip), "qty": str(qty)})
    if not isinstance(data, list):
        return []
    # Filter to only message-bearing roots (same logic as fetch_public_messages_for_feed)
    public_msgs = []
    for root in data:
        msg = root.get('Message')
        if not msg:
            continue
        content_str = ' '.join(msg) if isinstance(msg, list) else str(msg)
        if content_str.startswith('SEC') and len(content_str) > 4 and content_str[3] in '\\//:*?"<>|':
            continue
        file_data = root.get('File') or {}
        if 'SEC' in file_data:
            continue
        root['FromAddress'] = root.get('SignedBy', addr)
        if 'ToAddress' not in root:
            root['ToAddress'] = addr
        public_msgs.append(root)
    return public_msgs


async def get_root_by_txid(txid: str, mainnet: bool = False):
    return await p2fk_get(f"GetRootByTransactionID/{txid}", mainnet)


async def fetch_roots_by_address(address: str, mainnet: bool = False, skip: int = 0, qty: int = 0):
    extra = {"skip": str(skip), "qty": str(qty)} if qty > 0 else None
    data = await p2fk_get(f"GetRootsByAddress/{address}", mainnet, extra_params=extra)
    return data if isinstance(data, list) else []


async def fetch_private_messages_by_address(address: str, mainnet: bool = False, skip: int = 0, qty: int = 20):
    """Fetch private messages using the dedicated GetPrivateMessagesByAddress endpoint.
    Returns only PM txids/dates — much more efficient than GetRootsByAddress for DMs."""
    extra = {"skip": str(skip), "qty": str(qty)}
    data = await p2fk_get(f"GetPrivateMessagesByAddress/{address}", mainnet, extra_params=extra)
    return data if isinstance(data, list) else []


# --- Address validation ---

def address_matches_network(address: str, network: str) -> bool:
    is_mainnet = 'mainnet' in network.lower()
    if not address:
        return False
    if is_mainnet:
        return address[0] in ('1', '3') or address.startswith('bc1')
    else:
        return address[0] in ('m', 'n', '2') or address.startswith('tb1')


# --- Known users DB ---

async def register_known_user(address: str, network: str, urn: str = None, image: str = None, display_name: str = None):
    if not address_matches_network(address, network):
        return
    await known_users_col.update_one(
        {'address': address, 'network': network},
        {'$set': {
            'address': address,
            'network': network,
            'urn': urn,
            'image': image,
            'display_name': display_name,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )


async def get_known_addresses(network: str):
    seed = set(SEED_ADDRESSES.get(network, []))
    cursor = known_users_col.find({'network': network}, {'_id': 0, 'address': 1})
    async for doc in cursor:
        seed.add(doc['address'])
    return list(seed)


async def seed_known_users():
    for network, addresses in SEED_ADDRESSES.items():
        is_mainnet = 'mainnet' in network
        for addr in addresses:
            existing = await known_users_col.find_one({'address': addr, 'network': network})
            if not existing:
                profile = await fetch_profile_by_address(addr, is_mainnet)
                urn = profile.get('URN') if profile else None
                image = profile.get('Image') if profile else None
                display_name = profile.get('DisplayName') if profile else None
                await register_known_user(addr, network, urn, image, display_name)


# --- Profile cache (bounded, TTL-evicted) ---

_profile_cache = TTLCache(maxsize=2000, ttl=60)


async def get_cached_profile(address: str, is_mainnet: bool):
    key = f"{address}:{is_mainnet}"
    cached = _profile_cache.get(key)
    if cached is not None:
        return cached
    result = await fetch_profile_by_address(address, is_mainnet)
    # If P2FK returned nothing, or URN is just the address itself, fall back to known_users
    if not result or not result.get('URN') or result.get('URN') == address:
        try:
            from db import known_users_col
            network = 'btc-mainnet' if is_mainnet else 'btc-testnet'
            known = await known_users_col.find_one(
                {'address': address, 'network': network},
                {'_id': 0}
            )
            if known and known.get('urn') and known.get('urn') != address:
                result = {
                    'URN': known.get('urn'),
                    'Image': known.get('image'),
                    'DisplayName': known.get('display_name'),
                    'Creators': [address],
                }
        except Exception:
            pass
    # When URN is still the address, prefer DisplayName for display purposes
    if result and result.get('URN') == address and result.get('DisplayName'):
        result['URN'] = result['DisplayName']
    _profile_cache[key] = result
    return result


# --- Formatters ---

def format_profile(raw, network: str):
    if not raw:
        return None
    creators = raw.get('Creators') or []
    address = creators[0] if creators else ''
    urn = raw.get('URN')
    # When URN is just the address, prefer DisplayName for display
    if urn and address and urn == address and raw.get('DisplayName'):
        urn = raw.get('DisplayName')
    return {
        'address': address,
        'urn': urn,
        'display_name': raw.get('DisplayName'),
        'first_name': raw.get('FirstName'),
        'middle_name': raw.get('MiddleName'),
        'last_name': raw.get('LastName'),
        'suffix': raw.get('Suffix'),
        'bio': raw.get('Bio'),
        'image': raw.get('Image'),
        'url': raw.get('URL'),
        'location': raw.get('Location'),
        'pkx': raw.get('PKX', ''),
        'pky': raw.get('PKY', ''),
        'network': network,
        'created_at': raw.get('CreatedDate', ''),
    }


async def format_message(msg, sender_profile, network: str, is_mainnet: bool):
    from_addr = msg.get('FromAddress', '')
    to_addr = msg.get('ToAddress', '')
    is_reply = from_addr != to_addr and to_addr
    raw_content = msg.get('Message', '')
    content = ' '.join(raw_content) if isinstance(raw_content, list) else str(raw_content)

    # Strip P2FK protocol noise: salt <<number>> and trailing keyword/address bytes
    content = re.sub(r'<<-?\d+>>.*', '', content, flags=re.DOTALL).strip()
    # Strip non-printable / surrogate characters left from address decoding
    content = ''.join(c for c in content if c.isprintable() or c in '\n\t').strip()

    # Extract real file attachments from the File field (filter out protocol keys)
    _PROTOCOL_KEYS = {"SIG", "GIV", "SEC", "BRN", "BUY", "LST", "OBJ", "PRO", "INQ", "LNK"}
    raw_files = msg.get('File') or {}
    files = {}
    is_poll = False
    if isinstance(raw_files, dict):
        for fname, fsize in raw_files.items():
            if fname == 'INQ':
                is_poll = True
            elif fname not in _PROTOCOL_KEYS:
                files[fname] = fsize

    result = {
        'id': msg.get('TransactionId', str(uuid.uuid4())),
        'from_address': from_addr,
        'to_address': to_addr,
        'content': content,
        'transaction_id': msg.get('TransactionId', ''),
        'network': network,
        'created_at': msg.get('BlockDate', ''),
        'block_time': msg.get('BlockDate', ''),
        'is_reply': is_reply,
        'is_poll': is_poll,
        'sender_urn': sender_profile.get('URN') if sender_profile else None,
        'sender_display_name': sender_profile.get('DisplayName') if sender_profile else None,
        'sender_image': sender_profile.get('Image') if sender_profile else None,
        'recipient_urn': None,
        'recipient_image': None,
        'files': files if files else None,
    }

    if is_reply:
        recipient = await get_cached_profile(to_addr, is_mainnet)
        if recipient and recipient.get('URN'):
            result['recipient_urn'] = recipient.get('URN')
            result['recipient_image'] = recipient.get('Image')
            await register_known_user(
                to_addr, network, recipient.get('URN'),
                recipient.get('Image'), recipient.get('DisplayName')
            )

    return result


def format_object_for_api(obj: dict) -> dict:
    owners = obj.get('Owners') or {}
    owner_list = []
    for addr, val in owners.items():
        qty = val.get('Item1', 0) if isinstance(val, dict) else (val if isinstance(val, int) else 0)
        txid = val.get('Item2') if isinstance(val, dict) else None
        owner_list.append({'address': addr, 'quantity': qty, 'transfer_txid': txid})

    creators = obj.get('Creators') or {}
    creator_list = []
    for addr, date in creators.items():
        creator_list.append({'address': addr, 'date': date})

    listings = obj.get('Listings') or {}
    listing_list = []
    for addr, listing in listings.items():
        listing_list.append({
            'address': addr,
            'requestor': listing.get('Requestor', ''),
            'owner': listing.get('Owner', ''),
            'quantity': listing.get('Qty', 0),
            'price': listing.get('Value', 0),
            'block_date': listing.get('BlockDate', ''),
        })

    offers = obj.get('Offers') or []
    offer_list = []
    if isinstance(offers, list):
        for offer in offers:
            offer_list.append({
                'requestor': offer.get('Requestor', ''),
                'owner': offer.get('Owner', ''),
                'quantity': offer.get('Qty', 0),
                'price': offer.get('Value', 0),
                'block_date': offer.get('BlockDate', ''),
            })

    total_supply = sum(o['quantity'] for o in owner_list)
    is_listed = len(listing_list) > 0
    min_price = min((lst['price'] for lst in listing_list), default=0) if is_listed else 0

    image = obj.get('Image') or ''
    urn = obj.get('URN') or ''
    image_exts = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp')
    _ONCHAIN_PREFIXES = ('IPFS:', 'BTC:', 'LTC:', 'DOG:', 'MZC:')
    if not image and urn:
        urn_lower = urn.lower()
        is_image_urn = any(urn_lower.endswith(ext) for ext in image_exts)
        # Copy URN to image field if it's an IPFS, on-chain chain-prefixed,
        # or bare txid reference that looks like an image file
        if is_image_urn and (
            any(urn.upper().startswith(p) for p in _ONCHAIN_PREFIXES)
            or re.match(r'^[0-9a-fA-F]{64}', urn)
        ):
            image = urn

    maximum = obj.get('Maximum', 0)
    if maximum == 0:
        maximum = total_supply

    # Object address = first key in Creators (P2FK protocol)
    object_address = creator_list[0]['address'] if creator_list else ''

    # Parse ChangeLog if available (from verbose=true fetch)
    change_log_raw = obj.get('ChangeLog') or []
    change_log = []
    for entry_str in change_log_raw:
        try:
            entry = json.loads(entry_str) if isinstance(entry_str, str) else entry_str
            if isinstance(entry, list) and len(entry) >= 6:
                change_log.append({
                    'from': entry[0] if len(entry) > 0 else '',
                    'to': entry[1] if len(entry) > 1 else '',
                    'action': entry[2] if len(entry) > 2 else '',
                    'quantity': entry[3] if len(entry) > 3 else '',
                    'price': entry[4] if len(entry) > 4 else '',
                    'status': entry[5] if len(entry) > 5 else '',
                    'date': entry[6] if len(entry) > 6 else '',
                })
        except Exception:
            pass

    # Resolve TransactionId — p2fk.io often returns None for owned/created objects
    txid = obj.get('TransactionId') or ''

    return {
        'id': obj.get('Id', 0),
        'transaction_id': txid,
        'object_address': object_address,
        'urn': urn,
        'uri': obj.get('URI'),
        'image': image,
        'name': obj.get('Name', 'Unnamed'),
        'description': obj.get('Description', ''),
        'attributes': obj.get('Attributes'),
        'license': obj.get('License'),
        'maximum': maximum,
        'owners': owner_list,
        'owner_count': len(owner_list),
        'total_supply': total_supply,
        'creators': creator_list,
        'listings': listing_list,
        'is_listed': is_listed,
        'min_price': min_price,
        'offers': offer_list,
        'offer_count': len(offer_list),
        'royalties': obj.get('Royalties') or {},
        'created_date': obj.get('CreatedDate', ''),
        'change_date': obj.get('ChangeDate', ''),
        'locked_date': obj.get('LockedDate', ''),
        'change_log': change_log,
        'process_height': obj.get('ProcessHeight', 0),
    }
