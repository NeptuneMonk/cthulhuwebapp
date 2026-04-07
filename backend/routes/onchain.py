"""On-chain P2FK file resolver routes."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from datetime import datetime, timezone
import asyncio
import logging
import re
import base64

from db import db
from config import CHAIN_TX_APIS, EXTENSION_MIME, ADDRESS_VERSION_CHAINS
from utils.blockchain import fetch_tx_outputs
from utils.p2fk import base58_decode_check, base58_decode
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# Track in-progress on-chain resolutions
_onchain_resolving = {}


def decode_addresses_to_bytes(addresses: list) -> bytes:
    result = bytearray()
    for addr in addresses:
        try:
            payload = base58_decode_check(addr)
            result.extend(payload)
        except Exception:
            continue
    return bytes(result)


def parse_p2fk_root(raw_bytes: bytes, target_filename: str = None) -> dict:
    ascii_str = raw_bytes.decode('ascii', errors='replace')

    known_exts = r'(?:jpg|jpeg|png|gif|webp|svg|bmp|mp4|mp3|wav|ogg|webm|mov|html|htm|pdf|zip|txt|json|css|js|mcworld)'

    file_pattern = re.compile(
        r'([A-Za-z0-9_\-\. ()]+\.(' + known_exts + r'))'
        r'([\\/:\*\?"<>\|])'
        r'(\d{2,})',
        re.IGNORECASE
    )

    all_files = []
    P2FK_DELIMS = b'\\/:*?"<>|'
    for match in file_pattern.finditer(ascii_str):
        filename = match.group(1).strip()
        ext = match.group(2).lower()
        size_str = match.group(4)
        size_val = int(size_str)

        content_start = match.end()
        # Skip delimiter byte between size and content (P2FK protocol)
        if content_start < len(raw_bytes) and raw_bytes[content_start] in P2FK_DELIMS:
            content_start += 1
        content_bytes = raw_bytes[content_start:content_start + size_val]

        is_valid = True
        if ext in ('jpg', 'jpeg'):
            is_valid = len(content_bytes) > 3 and content_bytes[:2] == b'\xff\xd8'
        elif ext == 'png':
            is_valid = len(content_bytes) > 4 and content_bytes[:4] == b'\x89PNG'
        elif ext == 'gif':
            is_valid = len(content_bytes) > 3 and content_bytes[:3] == b'GIF'

        if is_valid and size_val > 0 and len(content_bytes) > 0:
            all_files.append({
                'filename': filename,
                'size': size_val,
                'content_bytes': content_bytes,
                'is_ledger': False,
            })
            continue

        if size_val > 0 and content_start + 1 < len(raw_bytes):
            content_bytes2 = raw_bytes[content_start + 1:content_start + 1 + size_val]
            is_valid2 = True
            if ext in ('jpg', 'jpeg'):
                is_valid2 = len(content_bytes2) > 3 and content_bytes2[:2] == b'\xff\xd8'
            elif ext == 'png':
                is_valid2 = len(content_bytes2) > 4 and content_bytes2[:4] == b'\x89PNG'
            elif ext == 'gif':
                is_valid2 = len(content_bytes2) > 3 and content_bytes2[:3] == b'GIF'
            if is_valid2 and len(content_bytes2) > 0:
                all_files.append({
                    'filename': filename,
                    'size': size_val,
                    'content_bytes': content_bytes2,
                    'is_ledger': False,
                })

    # If we have files and a target filename, prefer the matching one
    if all_files:
        if target_filename:
            for f in all_files:
                if f['filename'].lower() == target_filename.lower():
                    return f
        return all_files[0]

    ledger_pattern = re.compile(r'([0-9a-f]{64})([\\/:\*\?"<>\|])(\d+)')
    match = ledger_pattern.search(ascii_str)
    if match:
        filename = match.group(1)
        size_val = int(match.group(3))
        content_start = match.end()
        if content_start < len(raw_bytes) and chr(raw_bytes[content_start]) in '\\/: *?"<>|':
            content_start += 1
        content_bytes = raw_bytes[content_start:content_start + size_val]
        return {
            'filename': filename,
            'size': size_val,
            'content_bytes': content_bytes,
            'is_ledger': True,
        }

    magic_patterns = [
        (b'\xff\xd8\xff', '.jpg'),
        (b'\x89PNG', '.png'),
        (b'GIF8', '.gif'),
    ]
    for magic, ext in magic_patterns:
        idx = raw_bytes.find(magic)
        if idx >= 0:
            content = raw_bytes[idx:]
            return {
                'filename': f'file{ext}',
                'size': len(content),
                'content_bytes': content,
                'is_ledger': False,
            }

    delim_chars = b'\\/:*?"<>|'
    if len(raw_bytes) > 3 and raw_bytes[0] in delim_chars:
        i = 1
        size_str = ''
        while i < len(raw_bytes) and chr(raw_bytes[i]).isdigit():
            size_str += chr(raw_bytes[i])
            i += 1
        if size_str and int(size_str) > 0 and i < len(raw_bytes) and raw_bytes[i] in delim_chars:
            size_val = int(size_str)
            content_start = i + 1
            content_bytes = raw_bytes[content_start:content_start + size_val]
            if len(content_bytes) > 0:
                return {
                    'filename': 'data.txt',
                    'size': size_val,
                    'content_bytes': content_bytes,
                    'is_ledger': False,
                }

    return None


async def resolve_onchain_file(txid: str, chain: str = 'BTC', mainnet: bool = True, max_depth: int = 5, target_filename: str = None) -> tuple:
    logger.info(f"Resolving on-chain file: {txid} on {chain} (mainnet={mainnet}, target={target_filename})")

    addresses = await fetch_tx_outputs(txid, chain, mainnet)
    if not addresses:
        raise ValueError(f"No P2FK outputs found in transaction {txid}")

    raw_bytes = decode_addresses_to_bytes(addresses)
    if len(raw_bytes) < 5:
        raise ValueError("Decoded data too small")

    parsed = parse_p2fk_root(raw_bytes, target_filename)
    if not parsed:
        raise ValueError("Could not parse P2FK root header")

    filename = parsed['filename']
    content = parsed['content_bytes']
    declared_size = parsed['size']

    if parsed['is_ledger'] and max_depth > 0:
        return await _resolve_ledger(content, filename, chain, mainnet, max_depth, target_filename)

    result_bytes = bytes(content[:declared_size]) if declared_size > 0 else bytes(content)
    return (filename, result_bytes)


async def _resolve_ledger(ledger_bytes: bytes, filename: str, chain: str, mainnet: bool, max_depth: int, target_filename: str = None) -> tuple:
    ledger_text = ledger_bytes.decode('ascii', errors='replace')
    txid_pattern = re.compile(r'[0-9a-f]{64}')
    child_txids = txid_pattern.findall(ledger_text)

    if not child_txids:
        raise ValueError("Ledger contains no valid transaction IDs")

    logger.info(f"Ledger references {len(child_txids)} child transactions")

    sem = asyncio.Semaphore(8)  # Allow more concurrent fetches (mempool.space handles it well)
    child_results = [None] * len(child_txids)

    async def fetch_child(idx, ctxid):
        async with sem:
            try:
                addrs = await fetch_tx_outputs(ctxid, chain, mainnet)
                raw = decode_addresses_to_bytes(addrs)
                child_results[idx] = raw
                if idx % 40 == 0 or idx == len(child_txids) - 1:
                    logger.info(f"  Child {idx}/{len(child_txids)}: {len(raw)} bytes")
            except Exception as e:
                logger.warning(f"Failed child tx {idx} {ctxid[:16]}...: {e}")
                child_results[idx] = None

    await asyncio.gather(*[fetch_child(i, txid) for i, txid in enumerate(child_txids)])

    combined_bytes = bytearray()
    for raw in child_results:
        if raw:
            combined_bytes.extend(raw)

    logger.info(f"Combined {len(combined_bytes)} bytes from {sum(1 for r in child_results if r)} children")

    if not combined_bytes:
        raise ValueError("No data from child transactions")

    combined_parsed = parse_p2fk_root(bytes(combined_bytes), target_filename)

    if combined_parsed and not combined_parsed['is_ledger']:
        file_size = combined_parsed['size']
        file_bytes = combined_parsed['content_bytes']
        result_bytes = bytes(file_bytes[:file_size]) if file_size > 0 else bytes(file_bytes)
        return (combined_parsed['filename'], result_bytes)

    if combined_parsed and combined_parsed['is_ledger'] and max_depth > 1:
        logger.info(f"Found nested ledger, recursing (depth remaining: {max_depth - 1})")
        return await _resolve_ledger(combined_parsed['content_bytes'], combined_parsed['filename'], chain, mainnet, max_depth - 1, target_filename)

    magic_patterns = [
        (b'\xff\xd8\xff', '.jpg'),
        (b'\x89PNG', '.png'),
        (b'GIF8', '.gif'),
    ]
    for magic, ext in magic_patterns:
        idx = combined_bytes.find(magic)
        if idx >= 0:
            return (f'file{ext}', bytes(combined_bytes[idx:]))

    raise ValueError("Could not parse combined child data")


@router.get("/onchain/file/{txid}/{filename:path}")
async def get_onchain_file(txid: str, filename: str, chain: str = 'BTC', mainnet: bool = True, fresh: bool = False):
    """Serve an on-chain file. Resolution priority:
    1. Already resolving in background → 202
    2. Fresh cache hit (< 7 days) → serve from cache with X-Source header
    3. No cache → start background blockchain reconstruction → 202
    If fresh=true, skip cache and re-resolve from blockchain/p2fk.io.
    """
    try:
        cache_key = f"{chain}:{txid}:{filename}"

        # If already resolving in background, return 202 immediately
        if _onchain_resolving.get(cache_key):
            return JSONResponse(status_code=202, content={"status": "resolving", "key": cache_key})

        # fresh=true: purge stale cache and re-resolve
        if fresh:
            await db.onchain_cache.delete_one({"key": cache_key})
        else:
            cached = await db.onchain_cache.find_one({"key": cache_key}, {"_id": 0})
            if cached and cached.get("data"):
                file_bytes = base64.b64decode(cached["data"])
                ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
                mime = EXTENSION_MIME.get(ext, 'application/octet-stream')
                source_chain = cached.get("chain", chain)
                cache_age = "unknown"
                ts = cached.get("timestamp")
                if ts:
                    try:
                        if isinstance(ts, str):
                            ts = datetime.fromisoformat(ts)
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        cache_age = str(int((datetime.now(timezone.utc) - ts).total_seconds()))
                    except Exception:
                        pass
                return Response(content=file_bytes, media_type=mime,
                              headers={
                                  "Cache-Control": "public, max-age=86400",
                                  "Content-Disposition": f'inline; filename="{filename}"',
                                  "X-Source": f"blockchain-cache ({source_chain})",
                                  "X-Cache-Age": cache_age,
                              })
            if cached and cached.get("failed"):
                ts = cached.get("timestamp")
                try:
                    if isinstance(ts, str):
                        ts = datetime.fromisoformat(ts)
                    if ts and ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except Exception:
                    ts = None
                if ts and (datetime.now(timezone.utc) - ts).total_seconds() < 600:
                    return JSONResponse(status_code=404, content={
                        "status": "failed",
                        "detail": "Could not reconstruct this file from the blockchain. Will retry in a few minutes."
                    })

        # No cache — start blockchain reconstruction
        _onchain_resolving[cache_key] = True
        asyncio.create_task(_resolve_onchain_background(txid, filename, chain, mainnet, cache_key))
        return JSONResponse(status_code=202, content={"status": "resolving", "key": cache_key})

    except Exception as e:
        logger.error(f"On-chain file resolve error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def _resolve_onchain_background(txid: str, filename: str, chain: str, mainnet: bool, cache_key: str):
    """Resolve an on-chain file in the background with cross-chain fallback.

    When the p2fk.io API returns data via getRootByTransactionID, file references
    come WITHOUT chain prefixes. The frontend defaults to chain=BTC, but the actual
    data may live on LTC, DOG, or MZC. This function tries all chains as fallback.
    """
    try:
        # Fast path 1: try p2fk.io root gateway (serves reconstructed files directly)
        for gateway_name, gateway_url in [
            ('p2fk.io', f"https://p2fk.io/root/{txid}/{filename}"),
            ('bitfossil', f"https://bitfossil.com/{txid}/{filename}"),
        ]:
            try:
                client = get_client()
                resp = await client.get(gateway_url, timeout=20.0, follow_redirects=True)
                if resp.status_code == 200 and len(resp.content) > 100:
                    ct = resp.headers.get('content-type', '')
                    is_html = 'text/html' in ct or resp.content[:50].strip().startswith(b'<')
                    # Allow HTML content when the requested filename IS an HTML file
                    filename_is_html = filename.lower().endswith(('.html', '.htm'))
                    if not is_html or filename_is_html:
                        file_bytes = resp.content
                        encoded = base64.b64encode(file_bytes).decode('ascii')
                        await db.onchain_cache.update_one(
                            {"key": cache_key},
                            {"$set": {"key": cache_key, "data": encoded, "filename": filename,
                                      "size": len(file_bytes), "chain": chain,
                                      "timestamp": datetime.now(timezone.utc)}},
                            upsert=True
                        )
                        logger.info(f"On-chain file cached via {gateway_name}: {cache_key} ({len(file_bytes)} bytes)")
                        return
                    else:
                        logger.debug(f"{gateway_name} returned HTML for {cache_key}, skipping")
            except Exception as e:
                logger.debug(f"{gateway_name} gateway miss for {cache_key}: {e}")

        # Slow path: reconstruct from raw transactions with cross-chain fallback
        # Try the specified chain first, then all other chains.
        # This handles the case where getRootByTransactionID returns bare txids
        # without chain prefixes — the chain is identified by address version bytes.
        ALL_CHAINS = ['BTC', 'LTC', 'DOG', 'MZC']
        chain_upper = chain.upper()
        net_key = 'mainnet' if mainnet else 'testnet'
        alt_key = 'testnet' if mainnet else 'mainnet'

        attempts = []
        # 1. Try specified chain (requested network first, then alternate)
        chain_config = CHAIN_TX_APIS.get(chain_upper, {})
        if net_key in chain_config:
            attempts.append((chain_upper, mainnet))
        if alt_key in chain_config:
            attempts.append((chain_upper, not mainnet))

        # 2. Cross-chain fallback: try all other chains (mainnet first for each)
        for other_chain in ALL_CHAINS:
            if other_chain == chain_upper:
                continue
            other_config = CHAIN_TX_APIS.get(other_chain, {})
            if 'mainnet' in other_config:
                attempts.append((other_chain, True))
            if 'testnet' in other_config:
                attempts.append((other_chain, False))

        # If nothing matched at all, add BTC as ultimate fallback
        if not attempts:
            if 'mainnet' in CHAIN_TX_APIS.get('BTC', {}):
                attempts.append(('BTC', True))
            if 'testnet' in CHAIN_TX_APIS.get('BTC', {}):
                attempts.append(('BTC', False))

        file_bytes = None
        resolved_name = None
        resolved_chain = None
        for attempt_chain, attempt_mainnet in attempts:
            try:
                resolved_name, file_bytes = await resolve_onchain_file(txid, attempt_chain, attempt_mainnet, target_filename=filename)
                if file_bytes and len(file_bytes) > 0:
                    resolved_chain = attempt_chain
                    break
            except Exception as e:
                logger.debug(f"On-chain resolve attempt failed ({attempt_chain} {'mainnet' if attempt_mainnet else 'testnet'}): {e}")
                continue

        if file_bytes and len(file_bytes) > 0:
            encoded = base64.b64encode(file_bytes).decode('ascii')
            await db.onchain_cache.update_one(
                {"key": cache_key},
                {"$set": {"key": cache_key, "data": encoded, "filename": resolved_name or filename,
                          "size": len(file_bytes), "chain": resolved_chain,
                          "timestamp": datetime.now(timezone.utc)}},
                upsert=True
            )
            if resolved_chain and resolved_chain != chain_upper:
                logger.info(f"On-chain file cached (cross-chain {chain_upper}->{resolved_chain}): {cache_key} ({len(file_bytes)} bytes)")
            else:
                logger.info(f"On-chain file cached: {cache_key} ({len(file_bytes)} bytes)")
        else:
            logger.warning(f"On-chain resolve failed for {cache_key} (tried {len(attempts)} chain/network combos)")
            # Write a failure marker so the frontend doesn't poll forever
            await db.onchain_cache.update_one(
                {"key": cache_key},
                {"$set": {"key": cache_key, "data": None, "failed": True,
                          "timestamp": datetime.now(timezone.utc)}},
                upsert=True
            )
    except Exception as e:
        logger.error(f"Background on-chain resolve error: {e}")
        try:
            await db.onchain_cache.update_one(
                {"key": cache_key},
                {"$set": {"key": cache_key, "data": None, "failed": True,
                          "error": str(e), "timestamp": datetime.now(timezone.utc)}},
                upsert=True
            )
        except Exception:
            pass
    finally:
        _onchain_resolving[cache_key] = False


@router.get("/onchain/status/{txid}")
async def get_onchain_status(txid: str, chain: str = 'BTC', mainnet: bool = True):
    try:
        chain_upper = chain.upper()
        chain_config = CHAIN_TX_APIS.get(chain_upper, {})
        alt_key = 'testnet' if mainnet else 'mainnet'

        for try_mainnet in ([mainnet, not mainnet] if alt_key in chain_config else [mainnet]):
            try_key = 'mainnet' if try_mainnet else 'testnet'
            if try_key not in chain_config:
                continue
            try:
                addresses = await fetch_tx_outputs(txid, chain_upper, try_mainnet)
                if not addresses:
                    continue
                raw_bytes = decode_addresses_to_bytes(addresses)
                parsed = parse_p2fk_root(raw_bytes)
                if not parsed:
                    return {"resolvable": False, "reason": "Could not parse P2FK header"}
                return {
                    "resolvable": True,
                    "filename": parsed['filename'],
                    "size": parsed['size'],
                    "is_ledger": parsed['is_ledger'],
                    "address_count": len(addresses),
                    "network": "mainnet" if try_mainnet else "testnet",
                }
            except Exception:
                continue

        return {"resolvable": False, "reason": f"Transaction not found on {chain}"}
    except Exception as e:
        return {"resolvable": False, "reason": str(e)}



def detect_chain_from_address(address: str) -> tuple:
    """Detect blockchain and network from an address version byte.
    Returns (chain, is_mainnet) or (None, None) if unknown.
    Implements the SUP reference client's byte mapping approach.
    """
    try:
        raw = base58_decode(address)
        if len(raw) < 2:
            return (None, None)
        version_byte = raw[0]
        return ADDRESS_VERSION_CHAINS.get(version_byte, (None, None))
    except Exception:
        return (None, None)


@router.get("/onchain/detect-chain/{address}")
async def detect_chain_endpoint(address: str):
    """Detect which blockchain an address belongs to using its version byte.
    Useful when p2fk.io returns data without chain identifiers."""
    chain, is_mainnet = detect_chain_from_address(address)
    if chain:
        return {"chain": chain, "mainnet": is_mainnet, "address": address}
    return {"chain": None, "mainnet": None, "address": address}
