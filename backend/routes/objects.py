"""Object routes: storefront, detail, owned, created, collection, history, search, URN check."""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import asyncio
import logging
import json
import re

from db import object_cache_col, object_index_col, api_cache_col
from utils.helpers import (
    p2fk_get, fetch_objects_owned, fetch_objects_by_address,
    fetch_objects_created_by_address, fetch_object_by_txid,
    fetch_profile_by_address, get_cached_profile, _profile_cache,
    format_object_for_api, fetch_profile_by_urn,
    batch_verify_burns,
)
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)



def _resolve_profiles_for_object(formatted, is_mainnet):
    """Resolve profile names for all addresses in an object, marking object addr and collection."""
    all_addresses = set()
    for o in formatted.get('owners', []):
        all_addresses.add(o['address'])
    for c in formatted.get('creators', []):
        all_addresses.add(c['address'])
    for addr in (formatted.get('royalties') or {}).keys():
        all_addresses.add(addr)

    creators = formatted.get('creators', [])
    obj_addr = creators[0]['address'] if len(creators) >= 1 else None
    # Collection is Creator[1] when there are 3+ creators (obj, collection, creator)
    collection_addr = creators[1]['address'] if len(creators) >= 3 else None

    resolved = {}
    for addr in all_addresses:
        entry = {}
        cached_profile = _profile_cache.get(f"{addr}:{is_mainnet}")
        if cached_profile and cached_profile.get('URN'):
            entry['urn'] = cached_profile.get('URN')
            entry['display_name'] = cached_profile.get('DisplayName')
            entry['image'] = cached_profile.get('Image')
        if addr == obj_addr:
            entry['is_object'] = True
        if addr == collection_addr:
            entry['is_collection'] = True
            # For collections, also try to fetch profile if not already cached
            if not entry.get('urn'):
                entry['display_name'] = None
                entry['image'] = None
        if entry:
            resolved[addr] = entry
    return resolved



async def index_objects(objects: list, network: str):
    """Upsert objects into the search index for fast text search."""
    for obj in objects:
        oa = obj.get('object_address', '')
        if not oa:
            continue
        doc = {
            'object_address': oa,
            'urn': (obj.get('urn') or '').lower(),
            'name': (obj.get('name') or '').lower(),
            'description': (obj.get('description') or '').lower(),
            'image': obj.get('image', ''),
            'network': network,
            'raw': obj,
            'updated_at': datetime.now(timezone.utc),
        }
        await object_index_col.update_one(
            {'object_address': oa, 'network': network},
            {'$set': doc},
            upsert=True
        )


async def text_search_objects(query: str, network: str, limit: int = 20):
    """Search the local object index by regex on name, description, URN."""
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    cursor = object_index_col.find(
        {
            'network': network,
            '$or': [
                {'urn': pattern},
                {'name': pattern},
                {'description': pattern},
            ]
        },
        {'_id': 0, 'raw': 1}
    ).limit(limit)
    results = []
    async for doc in cursor:
        if doc.get('raw'):
            results.append(doc['raw'])
    return results



@router.get("/urn/check/{urn}")
async def check_urn_availability(urn: str, network: str = 'btc-testnet'):
    """Check if a URN is already claimed on-chain (profile or object).
    Returns { available: bool, claimed_by: str|null, type: 'profile'|'object'|null }
    """
    try:
        is_mainnet = 'mainnet' in network.lower()

        # Check profiles first (faster, more common)
        profile = await fetch_profile_by_urn(urn, is_mainnet)
        if profile and profile.get('URN'):
            claimed_by = profile.get('Address') or profile.get('SignedBy')
            if not claimed_by and profile.get('Creators'):
                creators = profile.get('Creators')
                if isinstance(creators, dict):
                    claimed_by = next(iter(creators.keys()), None)
                elif isinstance(creators, list) and len(creators) > 0:
                    claimed_by = creators[0].get('address') if isinstance(creators[0], dict) else creators[0]
            return {
                "available": False,
                "urn": urn,
                "claimed_by": claimed_by,
                "type": "profile",
                "name": profile.get('DisplayName') or profile.get('URN'),
            }

        # Check objects by keyword (URN is stored as a keyword)
        # Normalize slashes for comparison — SUP uses \ but some entries may use /
        norm_urn = urn.replace('\\', '/').lower()
        # Search with both slash directions since p2fk.io may index either way
        search_variants = {urn}
        if '\\' in urn:
            search_variants.add(urn.replace('\\', '/'))
        if '/' in urn:
            search_variants.add(urn.replace('/', '\\'))

        for search_urn in search_variants:
            objects = await p2fk_get(f"GetObjectsByKeyword/{search_urn}", is_mainnet, {"verbose": "false"})
            if isinstance(objects, list) and len(objects) > 0:
                # Check if any object has this exact URN (slash-normalized)
                for obj in objects:
                    obj_urn = obj.get('URN', '') or ''
                    if obj_urn.replace('\\', '/').lower() == norm_urn:
                        claimed_by = None
                        creators = obj.get('Creators')
                        if isinstance(creators, dict):
                            claimed_by = next(iter(creators.keys()), None)
                        elif isinstance(creators, list) and len(creators) > 0:
                            claimed_by = creators[0].get('address') if isinstance(creators[0], dict) else creators[0]
                        return {
                            "available": False,
                            "urn": urn,
                            "claimed_by": claimed_by,
                            "type": "object",
                            "name": obj.get('Name') or obj.get('URN'),
                        }

        return {"available": True, "urn": urn, "claimed_by": None, "type": None}
    except Exception as e:
        logger.error(f"URN check error: {e}")
        # On error, return available=True to not block the user (they'll get an on-chain rejection if duplicate)
        return {"available": True, "urn": urn, "claimed_by": None, "type": None, "error": str(e)}


@router.get("/objects/owned/{address}")
async def get_owned_objects(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 5, force: bool = False):
    try:
        is_mainnet = 'mainnet' in network.lower()

        # Force-refresh: invalidate backend cache for this address's data
        if force:
            patterns = [
                f"p2fk:GetObjectsOwnedByAddress/{address}:",
                f"p2fk:GetObjectsByAddress/{address}:",
                f"p2fk:GetRootsByAddress/{address}",
            ]
            for pat in patterns:
                # Mark as expired (ts=0) rather than deleting — keeps stale fallback
                await api_cache_col.update_many(
                    {"_id": {"$regex": f"^{pat}"}},
                    {"$set": {"ts": 0}}
                )

        # Fire three fast list endpoints in PARALLEL — no per-object re-verification
        list_task = fetch_objects_owned(address, is_mainnet)
        all_task = fetch_objects_by_address(address, is_mainnet)
        roots_task = p2fk_get(f"GetRootsByAddress/{address}", is_mainnet, {"skip": "0", "qty": "500"})
        owned_raw, all_raw, user_roots = await asyncio.gather(
            list_task, all_task, roots_task, return_exceptions=True
        )

        if isinstance(owned_raw, Exception):
            owned_raw = []
        if isinstance(all_raw, Exception):
            all_raw = []
        if isinstance(user_roots, Exception):
            user_roots = []

        # Collect owned objects from GetObjectsOwnedByAddress
        seen = {}
        for obj in (owned_raw or []):
            creators = obj.get('Creators') or {}
            obj_addr = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
            if not obj_addr:
                continue
            ph = obj.get('ProcessHeight', 0) or 0
            if obj_addr not in seen or ph > (seen[obj_addr].get('ProcessHeight', 0) or 0):
                seen[obj_addr] = obj

        # Also check GetObjectsByAddress for objects with this address in Owners OR Creators
        # In P2FK, creators are implicit owners unless all copies are transferred away.
        # GetObjectsByAddress returns all objects associated with this address.
        for obj in (all_raw or []):
            owners = obj.get('Owners') or {}
            creators = obj.get('Creators') or {}
            is_owner = address in owners
            is_creator = (address in creators) if isinstance(creators, dict) else (address in (creators or []))
            if is_owner or is_creator:
                obj_addr = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
                if obj_addr and obj_addr not in seen:
                    ph = obj.get('ProcessHeight', 0) or 0
                    seen[obj_addr] = obj

        # Discover additional objects from BUY/GIV roots
        extra_addrs = set()
        if user_roots and isinstance(user_roots, list):
            for root in user_roots:
                file_keys = list((root.get('File') or {}).keys())
                if ('BUY' in file_keys or 'GIV' in file_keys) and root.get('Signed'):
                    for kw in list((root.get('Keyword') or {}).keys()):
                        if kw != address and kw not in seen:
                            extra_addrs.add(kw)

        # For BUY/GIV discovered objects only, fetch details in parallel (capped)
        if extra_addrs:
            sem = asyncio.Semaphore(6)
            async def _fetch_extra(obj_addr):
                async with sem:
                    try:
                        fresh = await p2fk_get(f"GetObjectByAddress/{obj_addr}", is_mainnet)
                        if fresh and isinstance(fresh, dict):
                            owners = fresh.get('Owners') or {}
                            if address in owners:
                                return (obj_addr, fresh)
                    except Exception:
                        pass
                    return None

            results = await asyncio.gather(*[_fetch_extra(a) for a in extra_addrs], return_exceptions=True)
            for result in results:
                if isinstance(result, Exception) or result is None:
                    continue
                obj_addr, obj_data = result
                if obj_addr not in seen:
                    seen[obj_addr] = obj_data

        # Build formatted output from the deduplicated `seen` dict (uses ProcessHeight for conflict resolution)
        formatted = [format_object_for_api(obj) for obj in seen.values()]
        formatted = [f for f in formatted if f.get('urn') or f.get('name', 'Unnamed') != 'Unnamed']

        # Filter out burned objects
        try:
            from routes.snapshot import get_burned_set
            burned_addrs = await get_burned_set(network)
            if burned_addrs:
                formatted = [f for f in formatted if f.get('object_address') not in burned_addrs]
        except Exception:
            pass

        # Resolve missing txids from user_roots (we already fetched them above)
        if user_roots and isinstance(user_roots, list):
            # Build a map: object_address -> first txid from roots
            roots_by_keyword = {}
            for root in user_roots:
                txid_val = root.get('TransactionId', '')
                for kw in list((root.get('Keyword') or {}).keys()):
                    if kw not in roots_by_keyword and txid_val:
                        roots_by_keyword[kw] = txid_val
            for obj in formatted:
                if not obj.get('transaction_id') and obj.get('object_address'):
                    obj['transaction_id'] = roots_by_keyword.get(obj['object_address'], '')

        total = len(formatted)
        page = formatted[skip:skip + limit]
        return {"objects": page, "address": address, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Owned objects error: {e}")
        return {"objects": [], "address": address, "count": 0, "total": 0, "has_more": False}


@router.get("/objects/counts/{address}")
async def get_object_counts_fast(address: str, network: str = 'btc-testnet', force: bool = False):
    """Fast object counts using parallel p2fk.io API calls.
    Fires all three lightweight list endpoints simultaneously."""
    try:
        is_mainnet = 'mainnet' in network.lower()

        # Force-refresh: invalidate backend cache
        if force:
            patterns = [
                f"p2fk:GetObjectsOwnedByAddress/{address}:",
                f"p2fk:GetObjectsByAddress/{address}:",
                f"p2fk:GetObjectsCreatedByAddress/{address}:",
            ]
            for pat in patterns:
                # Mark as expired (ts=0) rather than deleting — keeps stale fallback
                await api_cache_col.update_many(
                    {"_id": {"$regex": f"^{pat}"}},
                    {"$set": {"ts": 0}}
                )

        # Fire owned + created list endpoints in parallel
        owned_task = fetch_objects_owned(address, is_mainnet)
        created_task = fetch_objects_created_by_address(address, is_mainnet)
        owned_raw, created_raw = await asyncio.gather(
            owned_task, created_task, return_exceptions=True
        )

        # Trust p2fk.io API — it is the authoritative source of truth.
        # Owned count: count what the API returns, minus burned objects.
        owned_count = 0
        if not isinstance(owned_raw, Exception) and isinstance(owned_raw, list):
            owned_count = len(owned_raw)

        # Created count: deduplicate by object address
        created_addrs = set()
        if not isinstance(created_raw, Exception) and isinstance(created_raw, list):
            for obj in created_raw:
                creators = obj.get('Creators') or {}
                oa = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
                if oa:
                    created_addrs.add(oa)

        # Filter out burned objects from counts
        try:
            from routes.snapshot import get_burned_set
            burned_addrs = await get_burned_set(network)
            if burned_addrs:
                if not isinstance(owned_raw, Exception) and isinstance(owned_raw, list):
                    owned_count = sum(1 for obj in owned_raw
                        if (next(iter((obj.get('Creators') or {}).keys()), None)
                            if isinstance(obj.get('Creators'), dict) else None) not in burned_addrs)
                created_addrs -= burned_addrs
        except Exception:
            pass

        return {"owned": owned_count, "created": len(created_addrs), "address": address}
    except Exception as e:
        logger.error(f"Fast object counts error: {e}")
        return {"owned": 0, "created": 0, "address": address}



@router.get("/objects/created/{address}")
async def get_created_objects(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 5):
    try:
        is_mainnet = 'mainnet' in network.lower()
        created_raw = await fetch_objects_created_by_address(address, is_mainnet)

        # Deduplicate by object address, keep highest ProcessHeight
        seen = {}
        for obj in (created_raw or []):
            creators = obj.get('Creators') or {}
            obj_addr = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
            if not obj_addr:
                continue
            ph = obj.get('ProcessHeight', 0) or 0
            if obj_addr not in seen or ph > (seen[obj_addr].get('ProcessHeight', 0) or 0):
                seen[obj_addr] = obj

        deduped = list(seen.values())
        formatted = [format_object_for_api(obj) for obj in deduped]
        formatted = [f for f in formatted if f.get('urn') or f.get('name', 'Unnamed') != 'Unnamed']

        # Filter out burned objects
        try:
            from routes.snapshot import get_burned_set
            burned_addrs = await get_burned_set(network)
            if burned_addrs:
                formatted = [f for f in formatted if f.get('object_address') not in burned_addrs]
        except Exception:
            pass

        total = len(formatted)
        page = formatted[skip:skip + limit]
        return {"objects": page, "address": address, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Created objects error: {e}")
        return {"objects": [], "address": address, "count": 0, "total": 0, "has_more": False}


@router.get("/objects/collection/{address}")
async def get_collection_objects_by_address(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 20):
    try:
        is_mainnet = 'mainnet' in network.lower()
        items = await fetch_objects_created_by_address(address, is_mainnet)
        formatted = [format_object_for_api(obj) for obj in items]

        # Filter out burned objects
        try:
            from routes.snapshot import get_burned_set
            burned_addrs = await get_burned_set(network)
            if burned_addrs:
                formatted = [f for f in formatted if f.get('object_address') not in burned_addrs]
        except Exception:
            pass

        total = len(formatted)
        page = formatted[skip:skip + limit]
        return {"objects": page, "address": address, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Collection objects error: {e}")
        return {"objects": [], "address": address, "count": 0, "total": 0, "has_more": False}


@router.get("/collections/by-creator/{address}")
async def get_collections_by_creator(address: str, network: str = 'btc-testnet'):
    """Discover collections for an address.

    Uses GetObjectsByAddress (all associations) to find both:
    - Acknowledged: both search address AND cre[1] have real timestamps
    - Unacknowledged: either search address OR cre[1] has 0001-01-01
    """
    EPOCH_ZERO = "0001-01-01"

    def _is_ack(ts):
        return isinstance(ts, str) and not ts.startswith(EPOCH_ZERO)

    try:
        is_mainnet = 'mainnet' in network.lower()
        all_objects = await fetch_objects_by_address(address, is_mainnet)
        if not all_objects:
            return {"collections": [], "unacknowledged": [], "total": 0}

        ack_addrs = set()
        unack_addrs = set()
        for obj in all_objects:
            creators = obj.get('Creators', {})
            if not isinstance(creators, dict) or address not in creators:
                continue
            ckeys = list(creators.keys())
            if len(ckeys) < 3:
                continue
            cre1 = ckeys[1]
            if _is_ack(creators.get(cre1, '')) and _is_ack(creators.get(address, '')):
                ack_addrs.add(cre1)
            else:
                unack_addrs.add(cre1)

        unack_addrs -= ack_addrs  # acknowledged wins if in both

        async def _resolve(addr):
            profile = await fetch_profile_by_address(addr, is_mainnet)
            if profile and profile.get('URN'):
                urn = profile['URN']
                urn_check = await fetch_profile_by_urn(urn, is_mainnet)
                if not urn_check:
                    return None
                col_objects = await fetch_objects_created_by_address(addr, is_mainnet)
                return {"type": "profile", "urn": urn, "address": addr,
                        "image": profile.get('Image', ''), "bio": profile.get('Bio', ''),
                        "url": profile.get('URL', {}),
                        "created_date": profile.get('CreatedDate', ''),
                        "object_count": len(col_objects)}
            col_objects = await fetch_objects_created_by_address(addr, is_mainnet)
            if col_objects and len(col_objects) > 1:
                f = col_objects[0]
                return {"type": "object", "urn": f.get('URN', addr), "address": addr,
                        "image": f.get('Image', ''), "description": f.get('Description', ''),
                        "uri": f.get('URI', ''), "created_date": f.get('CreatedDate', ''),
                        "object_count": len(col_objects)}
            return None

        collections, unacknowledged, seen = [], [], set()
        for addr in ack_addrs:
            try:
                c = await _resolve(addr)
                if c and c['urn'] not in seen:
                    seen.add(c['urn'])
                    collections.append(c)
            except Exception:
                continue
        for addr in unack_addrs:
            try:
                c = await _resolve(addr)
                if c and c['urn'] not in seen:
                    seen.add(c['urn'])
                    unacknowledged.append(c)
            except Exception:
                continue

        return {"collections": collections, "unacknowledged": unacknowledged,
                "total": len(collections) + len(unacknowledged)}
    except Exception as e:
        logger.error(f"Collections by creator error: {e}")
        return {"collections": [], "unacknowledged": [], "total": 0}


def _parse_changelog_entry(entry_str) -> dict:
    try:
        if isinstance(entry_str, str):
            parts = json.loads(entry_str)
        elif isinstance(entry_str, list):
            parts = entry_str
        elif isinstance(entry_str, dict):
            return {
                "from_address": entry_str.get('From', entry_str.get('Sender', '')),
                "to_address": entry_str.get('To', entry_str.get('Receiver', '')),
                "action": entry_str.get('Action', ''),
                "quantity": entry_str.get('Quantity', entry_str.get('Qty', 0)),
                "value": entry_str.get('Value', ''),
                "status": entry_str.get('Status', ''),
                "date": entry_str.get('Date', entry_str.get('TransactionDate', '')),
            }
        else:
            return None
        if isinstance(parts, list) and len(parts) >= 3:
            qty_str = parts[3] if len(parts) > 3 else ''
            qty = 0
            if qty_str:
                try:
                    qty = int(qty_str)
                except (ValueError, TypeError):
                    try:
                        qty = float(qty_str)
                    except (ValueError, TypeError):
                        qty = 0
            return {
                "from_address": parts[0] if len(parts) > 0 else '',
                "to_address": parts[1] if len(parts) > 1 else '',
                "action": parts[2] if len(parts) > 2 else '',
                "quantity": qty,
                "value": parts[4] if len(parts) > 4 else '',
                "status": parts[5] if len(parts) > 5 else '',
                "date": parts[6] if len(parts) > 6 else '',
            }
    except (json.JSONDecodeError, IndexError, TypeError):
        pass
    return None


@router.get("/objects/history/{address}")
async def get_object_history(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 50):
    """Build comprehensive history from GetRootsByAddress — mirrors SUP ObjectBrowser.GetHistoryByAddress.
    Detects operation type from File keys and resolves targets from Keyword addresses.
    Note: p2fk.io API returns byte sizes in File values, NOT actual content."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        all_roots = await p2fk_get(f"GetRootsByAddress/{address}", is_mainnet, extra_params={"skip": "0", "qty": "500"})
        if not isinstance(all_roots, list):
            all_roots = []

        history_items = []
        obj_addrs_to_resolve = set()

        for root in all_roots:
            if not root.get('Signed'):
                continue
            file_data = root.get('File') or {}
            if not isinstance(file_data, dict):
                continue
            signed_by = root.get('SignedBy', '')
            txid = root.get('TransactionId', '')
            block_date = root.get('BlockDate', '')
            keywords = root.get('Keyword') or {}
            kw_keys = list(keywords.keys()) if isinstance(keywords, dict) else []

            file_keys = set(file_data.keys())

            if 'OBJ' in file_keys:
                # Object mint: Keywords = [tableAddr, objectAddr, signerAddr, ...]
                obj_addr = kw_keys[1] if len(kw_keys) > 1 else (kw_keys[0] if kw_keys else '')
                if signed_by == address or address in kw_keys:
                    obj_addrs_to_resolve.add(obj_addr)
                    history_items.append({
                        "action": "MINT", "from_address": signed_by, "to_address": obj_addr,
                        "object_address": obj_addr, "object_name": "", "object_image": "",
                        "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                    })

            elif 'BUY' in file_keys:
                # Buy: Keywords = [objectAddr, signerAddr, ...]
                obj_addr = kw_keys[0] if kw_keys else ''
                if signed_by == address or address in kw_keys:
                    obj_addrs_to_resolve.add(obj_addr)
                    history_items.append({
                        "action": "BUY", "from_address": signed_by, "to_address": obj_addr,
                        "object_address": obj_addr, "object_name": "", "object_image": "",
                        "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                    })

            elif 'BRN' in file_keys:
                # Burn: Keywords = [objectAddr, signerAddr, ...]
                obj_addr = ''
                for kw in kw_keys:
                    if kw != address and kw != signed_by:
                        obj_addr = kw
                        break
                if not obj_addr and kw_keys:
                    obj_addr = kw_keys[0]
                if signed_by == address:
                    obj_addrs_to_resolve.add(obj_addr)
                    history_items.append({
                        "action": "BURN", "from_address": signed_by, "to_address": "",
                        "object_address": obj_addr, "object_name": "", "object_image": "",
                        "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                    })

            elif 'GIV' in file_keys:
                # Give: Keywords contain object address(es) and recipient
                obj_addr = ''
                for kw in kw_keys:
                    if kw != address and kw != signed_by:
                        obj_addr = kw
                        break
                direction = "GIVE_SENT" if signed_by == address else "GIVE_RECEIVED"
                if signed_by == address or address in kw_keys:
                    obj_addrs_to_resolve.add(obj_addr)
                    history_items.append({
                        "action": direction, "from_address": signed_by,
                        "to_address": obj_addr if direction == "GIVE_SENT" else signed_by,
                        "object_address": obj_addr, "object_name": "", "object_image": "",
                        "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                    })

            elif 'LST' in file_keys:
                # List: Keywords = [objectAddr, signerAddr, ...]
                obj_addr = kw_keys[0] if kw_keys else ''
                if signed_by == address or address in kw_keys:
                    obj_addrs_to_resolve.add(obj_addr)
                    history_items.append({
                        "action": "LIST", "from_address": signed_by, "to_address": obj_addr,
                        "object_address": obj_addr, "object_name": "", "object_image": "",
                        "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                    })

            elif 'PRO' in file_keys:
                history_items.append({
                    "action": "PROFILE", "from_address": signed_by,
                    "to_address": kw_keys[0] if kw_keys else "",
                    "object_address": "", "object_name": "Profile Update", "object_image": "",
                    "object_txid": txid, "quantity": 1, "date": block_date, "status": "confirmed",
                })

        # Batch-resolve object addresses to names/images
        # Build map from ALL creator addresses → object info (not just first key)
        obj_name_map = {}
        owned_task = fetch_objects_owned(address, is_mainnet)
        created_task = fetch_objects_created_by_address(address, is_mainnet)
        owned_raw, created_raw = await asyncio.gather(owned_task, created_task, return_exceptions=True)

        for src in [owned_raw, created_raw]:
            if isinstance(src, Exception) or not isinstance(src, list):
                continue
            for obj in src:
                creators = obj.get('Creators') or {}
                name = obj.get('Name', '')
                image = obj.get('Image', '')
                if isinstance(creators, dict):
                    info = {'name': name, 'image': image}
                    for addr in creators.keys():
                        if addr not in obj_name_map:
                            obj_name_map[addr] = info

        # For remaining unresolved addresses, do parallel lookups (capped)
        unresolved = obj_addrs_to_resolve - set(obj_name_map.keys()) - {address, ''}
        if unresolved:
            sem = asyncio.Semaphore(5)
            async def _resolve(addr):
                async with sem:
                    try:
                        data = await p2fk_get(f"GetObjectByAddress/{addr}", is_mainnet)
                        if data and isinstance(data, dict) and data.get('Name'):
                            return (addr, {'name': data.get('Name', ''), 'image': data.get('Image', '')})
                    except Exception:
                        pass
                    return None
            results = await asyncio.gather(*[_resolve(a) for a in list(unresolved)[:15]], return_exceptions=True)
            for r in results:
                if r and not isinstance(r, Exception):
                    obj_name_map[r[0]] = r[1]

        # Apply names/images to history items using ALL keyword addresses
        for item in history_items:
            if item.get('object_name'):
                continue
            oa = item.get('object_address', '')
            # Try the primary object_address first
            if oa and oa in obj_name_map:
                item['object_name'] = obj_name_map[oa].get('name', '')
                item['object_image'] = obj_name_map[oa].get('image', '')
                continue
            # For OBJ roots, try matching any keyword address in the root
            # The keyword addresses include table addr, data addrs, creator addrs
            if oa and oa not in obj_name_map:
                # Find the root that generated this history item by txid
                for root in all_roots:
                    if root.get('TransactionId') == item.get('object_txid'):
                        kws = list((root.get('Keyword') or {}).keys())
                        for kw in kws:
                            if kw in obj_name_map and kw != address:
                                item['object_name'] = obj_name_map[kw].get('name', '')
                                item['object_image'] = obj_name_map[kw].get('image', '')
                                break
                        break

        from datetime import datetime as dt
        def _parse_date(d):
            if not d:
                return dt.min
            for fmt in ('%Y-%m-%dT%H:%M:%S', '%m/%d/%Y %I:%M:%S %p', '%Y-%m-%d'):
                try: return dt.strptime(d, fmt)
                except ValueError: continue
            return dt.min

        history_items.sort(key=lambda x: _parse_date(x.get('date', '')), reverse=True)
        total = len(history_items)
        page = history_items[skip:skip + limit]
        return {"history": page, "address": address, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Object history error: {e}")
        import traceback
        traceback.print_exc()
        return {"history": [], "address": address, "count": 0, "total": 0, "has_more": False}


def _object_matches_chain(obj: dict, chain: str) -> bool:
    """Check if an object belongs to a specific chain by inspecting URN, URI, and Image fields.
    BTC is the default chain — objects with no known prefix in their URN are BTC-native."""
    chain_upper = chain.upper()
    KNOWN_PREFIXES = ('LTC:', 'DOG:', 'DOGE:', 'MZC:', 'IPFS:', 'BTC:')

    if chain_upper == 'BTC':
        # BTC-native objects may have explicit BTC: prefix OR no prefix at all.
        # Check if URN has a known non-BTC prefix — if not, it's BTC.
        urn = obj.get('URN', obj.get('urn', '')) or ''
        if isinstance(urn, str) and urn:
            urn_upper = urn.upper()
            if urn_upper.startswith('BTC:'):
                return True
            # No known prefix = BTC-native
            has_other = any(urn_upper.startswith(p) for p in KNOWN_PREFIXES if not p.startswith('BTC'))
            if not has_other:
                return True
        return False

    # Non-BTC chains: match prefix in URN, URI, Image
    match_prefixes = [chain_upper + ':']
    if chain_upper == 'DOG':
        match_prefixes.append('DOGE:')
    for field_name in ('URN', 'urn', 'URI', 'uri', 'Image', 'image'):
        val = obj.get(field_name, '')
        if val and isinstance(val, str):
            val_upper = val.upper()
            for prefix in match_prefixes:
                if val_upper.startswith(prefix) or f':{prefix}' in val_upper:
                    return True
    return False


async def _fetch_all_known_objects(is_mainnet: bool) -> list:
    """Fetch ALL known objects from p2fk.io via direct HTTP call (bypasses p2fk_get
    rate limiter which chokes on large payloads). Returns raw p2fk.io items."""
    try:
        from config import P2FK_API_BASE
        client = get_client()
        params = {
            "searchString": "*", "qty": "600", "skip": "0",
            "mainnet": str(is_mainnet).lower(),
            "blockchain": "BTC", "showSystemFiles": "true",
        }
        resp = await client.get(
            f"{P2FK_API_BASE}/GetKnownObjectsBySearchString",
            params=params, timeout=30.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data if isinstance(data, list) else []
    except Exception as e:
        logger.warning(f"Direct p2fk.io fetch failed: {e}")
    return []


def _extract_obj_addr(item: dict) -> str:
    """Extract the object address (first Creator key) from a p2fk.io item."""
    obj = item.get('object', item) if isinstance(item, dict) else {}
    creators = obj.get('Creators') or {}
    if isinstance(creators, dict):
        return next(iter(creators.keys()), '')
    if isinstance(creators, list) and creators:
        return creators[0] if isinstance(creators[0], str) else ''
    return ''


@router.get("/objects/by-chain/{chain}")
async def get_objects_by_chain(chain: str, network: str = 'btc-testnet', skip: int = 0, qty: int = 40):
    """Fetch objects filtered by chain prefix (ALL, MZC, DOG, LTC, IPFS, BTC).
    chain=ALL returns every known object (no chain filter).
    Chain detection checks URN, URI, and Image fields for chain-prefixed values.
    Results are cached for 10 minutes."""
    is_mainnet = 'mainnet' in network.lower()
    chain_upper = chain.upper()
    if chain_upper not in ('ALL', 'MZC', 'DOG', 'LTC', 'IPFS', 'BTC'):
        return {"objects": [], "chain": chain, "total": 0, "skip": skip, "qty": qty, "has_more": False}

    # Check MongoDB cache first
    cache_key = f"chain_objects:{chain_upper}:{network}"
    try:
        cached_doc = await api_cache_col.find_one({"_id": cache_key}, {"_id": 0})
        if cached_doc and cached_doc.get("ts"):
            age = datetime.now(timezone.utc).timestamp() - cached_doc["ts"]
            if age < 600:  # 10 minute TTL
                cached_items = cached_doc.get("data", [])
                total = len(cached_items)
                page = cached_items[skip:skip + qty]
                return {"objects": page, "chain": chain_upper, "total": total,
                        "skip": skip, "qty": qty, "has_more": (skip + qty) < total}
    except Exception:
        pass

    # Fetch all known objects from p2fk.io (single direct HTTP call)
    all_raw = await _fetch_all_known_objects(is_mainnet)

    # Deduplicate
    seen_keys = set()
    all_items = []
    for item in all_raw:
        if not isinstance(item, dict):
            continue
        obj = item.get('object', item)
        urn = obj.get('URN', obj.get('urn', ''))
        txid = obj.get('TransactionId', obj.get('transaction_id', ''))
        dedup_key = urn or txid
        if dedup_key and dedup_key in seen_keys:
            continue
        if dedup_key:
            seen_keys.add(dedup_key)
        all_items.append(item)

    # Apply chain filter (skip for ALL)
    if chain_upper != 'ALL':
        filtered = [item for item in all_items
                     if _object_matches_chain(item.get('object', item) if isinstance(item, dict) else {}, chain_upper)]
    else:
        filtered = all_items

    # Apply burn filtering
    try:
        obj_addrs = [_extract_obj_addr(item) for item in filtered]
        valid_addrs = [a for a in obj_addrs if a]
        if valid_addrs:
            burned = await batch_verify_burns(valid_addrs, is_mainnet, network)
            if burned:
                filtered = [item for item, addr in zip(filtered, obj_addrs) if addr not in burned]
    except Exception:
        pass

    # Cache the results
    try:
        await api_cache_col.update_one(
            {"_id": cache_key},
            {"$set": {"data": filtered, "ts": datetime.now(timezone.utc).timestamp(),
                      "updated_at": datetime.now(timezone.utc)}},
            upsert=True
        )
    except Exception:
        pass

    total = len(filtered)
    page = filtered[skip:skip + qty]
    return {"objects": page, "chain": chain_upper, "total": total,
            "skip": skip, "qty": qty, "has_more": (skip + qty) < total}


@router.get("/objects/search/{keyword}")
@limiter.limit("20/minute")
async def search_objects(request: Request, keyword: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 12):
    try:
        is_mainnet = 'mainnet' in network.lower()
        seen_urns = set()
        seen_addrs = set()
        valid_objects = []

        # Build keyword variants for case-insensitive matching
        kw_lower = keyword.lower()

        # Fire ALL p2fk.io calls in parallel for speed

        async def _urn_lookup(kw):
            try:
                return ('urn', await p2fk_get(f"GetObjectByURN/{kw}", is_mainnet, {"verbose": "false"}))
            except Exception:
                return ('urn', None)

        async def _keyword_search(kw):
            try:
                return ('kw', await p2fk_get(f"GetObjectsByKeyword/{kw}", is_mainnet, {"verbose": "false"}))
            except Exception:
                return ('kw', None)

        async def _known_objects_search():
            try:
                return ('known', await p2fk_get("GetKnownObjectsBySearchString",
                    is_mainnet, {"searchString": kw_lower, "qty": 10, "skip": 0}))
            except Exception:
                pass
            return ('known', None)

        # Build task list: URN lookups + keyword searches + known objects
        tasks = [_urn_lookup(keyword), _keyword_search(keyword)]
        if kw_lower != keyword:
            tasks.extend([_urn_lookup(kw_lower), _keyword_search(kw_lower)])
        tasks.append(_known_objects_search())

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception) or not isinstance(result, tuple):
                continue
            kind, data = result
            if data is None:
                continue
            if kind == 'urn' and isinstance(data, dict) and data.get('URN'):
                if data['URN'] not in seen_urns:
                    seen_urns.add(data['URN'])
                    valid_objects.append(data)
            elif kind == 'kw' and isinstance(data, list):
                for obj in data:
                    if not isinstance(obj, dict) or (not obj.get('Name') and not obj.get('URN')):
                        continue
                    urn = obj.get('URN', '')
                    if urn and urn in seen_urns:
                        continue
                    if urn:
                        seen_urns.add(urn)
                    valid_objects.append(obj)
            elif kind == 'known' and isinstance(data, list):
                # GetKnownObjectsBySearchString returns results from ALL blockchains.
                # Filter to only include results matching the user's current network.
                net_filter = 'BTC' if is_mainnet else 'BTC-testnet'
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    item_bc = item.get('blockchain', '')
                    if item_bc and item_bc != net_filter:
                        continue
                    obj = item.get('object', {})
                    if not isinstance(obj, dict) or (not obj.get('Name') and not obj.get('URN')):
                        continue
                    urn = obj.get('URN', '')
                    if urn and urn in seen_urns:
                        continue
                    if urn:
                        seen_urns.add(urn)
                    valid_objects.append(obj)

        # 4. Text search local index for name, description, URN matches
        try:
            formatted_so_far = [format_object_for_api(o) for o in valid_objects]
            seen_addrs = {o.get('object_address') for o in formatted_so_far if o.get('object_address')}
            local_hits = await text_search_objects(keyword, network, limit=20)
            for hit in local_hits:
                addr = hit.get('object_address', '')
                if addr and addr not in seen_addrs:
                    seen_addrs.add(addr)
                    formatted_so_far.append(hit)
        except Exception:
            formatted_so_far = [format_object_for_api(o) for o in valid_objects]

        total = len(formatted_so_far)
        page = formatted_so_far[skip:skip + limit]

        # Index the results in background for future text searches
        try:
            await index_objects(page, network)
        except Exception:
            pass

        return {"objects": page, "keyword": keyword, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Object search error: {e}")
        return {"objects": [], "keyword": keyword, "count": 0, "total": 0, "has_more": False}



@router.get("/p2fk/object/{address}")
async def get_raw_object_by_address(address: str, network: str = 'btc-testnet', fresh: bool = False):
    """Get raw p2fk.io object data by object address. Used for fresh ownership checks.
    Pass fresh=true to bypass cache (e.g., after a burn to verify current count)."""
    is_mainnet = 'mainnet' in network.lower()
    raw = await p2fk_get(f"GetObjectByAddress/{address}", is_mainnet, skip_cache=fresh)
    if raw and isinstance(raw, dict) and raw.get('Name'):
        return raw
    return {"error": "Object not found"}


@router.get("/object/addr/{address}")
async def get_object_by_address(address: str, network: str = 'btc-testnet'):
    """Look up an object by its object address (first Creator key).
    Falls back to GetRootsByAddress if GetObjectByAddress returns empty."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        formatted = None

        # Try 1: Fast call via GetObjectByAddress (verbose=false is fast and includes listings)
        raw = await p2fk_get(f"GetObjectByAddress/{address}", is_mainnet, {"verbose": "false"})
        if raw and isinstance(raw, dict) and raw.get('Name'):
            formatted = format_object_for_api(raw)

        # Try 2: Resolve owner from roots, then fetch via GetObjectsOwnedByAddress
        if not formatted:
            try:
                roots = await p2fk_get(f"GetRootsByAddress/{address}", is_mainnet)
                if isinstance(roots, list) and roots:
                    # Find the OBJ creation root (has OBJ in File keys)
                    for root in roots:
                        file_keys = list((root.get('File') or {}).keys())
                        signed_by = root.get('SignedBy') or ''
                        if signed_by and isinstance(signed_by, str) and 'OBJ' in file_keys:
                            owned = await fetch_objects_owned(signed_by, is_mainnet)
                            for obj in (owned or []):
                                creators = obj.get('Creators') or {}
                                obj_addr = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
                                if obj_addr == address:
                                    formatted = format_object_for_api(obj)
                                    formatted['transaction_id'] = root.get('TransactionId', '')
                                    break
                            if formatted:
                                break
                    # Fallback: try first root's signer
                    if not formatted and roots:
                        signed_by = roots[0].get('SignedBy') or ''
                        if signed_by and isinstance(signed_by, str):
                            owned = await fetch_objects_owned(signed_by, is_mainnet)
                            for obj in (owned or []):
                                creators = obj.get('Creators') or {}
                                obj_addr = next(iter(creators.keys()), None) if isinstance(creators, dict) else None
                                if obj_addr == address:
                                    formatted = format_object_for_api(obj)
                                    formatted['transaction_id'] = roots[0].get('TransactionId', '')
                                    break
            except Exception as e:
                logger.warning(f"Roots-based object lookup failed for {address}: {e}")

        if not formatted:
            # Before returning 404, check if the object was burned (indexer drops fully-burned objects)
            try:
                roots = await p2fk_get(f"GetRootsByAddress/{address}", is_mainnet)
                burn_roots = []
                obj_root = None
                if isinstance(roots, list):
                    for root in roots:
                        file_data = root.get('File') or {}
                        if 'BRN' in file_data:
                            burn_roots.append(root)
                        elif 'OBJ' in file_data and not obj_root:
                            obj_root = root

                if burn_roots:
                    # Object existed but was burned — return synthetic burned response
                    formatted = {
                        'name': obj_root.get('File', {}).get('OBJ', 'Unknown Object') if obj_root else 'Burned Object',
                        'description': 'This object has been burned and removed from the chain index.',
                        'image': '',
                        'owners': [],
                        'creators': [],
                        'transaction_id': obj_root.get('TransactionId', '') if obj_root else '',
                        'burn_transactions': len(burn_roots),
                        'burn_txids': [r.get('TransactionId', '')[:16] for r in burn_roots],
                        'is_burned': True,
                        'burn_status': 'fully_burned',
                        'total_supply': 0,
                        'royalties': {},
                        'on_chain_files': {},
                    }
                    logger.info(f"Object {address} is fully burned ({len(burn_roots)} BRN txs)")
                    # Register in burned objects registry
                    try:
                        from routes.snapshot import _register_burned_object
                        await _register_burned_object(address, burn_roots[0].get('TransactionId', ''), network)
                    except Exception:
                        pass
            except Exception as e:
                logger.debug(f"Burn fallback check failed for {address}: {e}")

        # Also check local burned_objects table if p2fk.io returned nothing
        if not formatted:
            try:
                from routes.snapshot import get_burned_set
                from db_sqlite import get_conn
                burned_addrs = await get_burned_set(network)
                if address in burned_addrs:
                    # Object is in our local burned registry — return synthetic burned response
                    conn = await get_conn()
                    async with conn.execute(
                        "SELECT burn_txid, detected_at FROM burned_objects WHERE object_address = ? AND network = ?",
                        (address, network)
                    ) as cursor:
                        row = await cursor.fetchone()
                    burn_txid = row[0] if row else ''
                    detected_at = row[1] if row else ''
                    formatted = {
                        'name': 'Burned Object',
                        'description': 'This object has been burned and removed from the chain index.',
                        'image': '',
                        'owners': [],
                        'creators': [],
                        'transaction_id': '',
                        'burn_transactions': 1,
                        'burn_txids': [burn_txid[:16]] if burn_txid else [],
                        'is_burned': True,
                        'burn_status': 'fully_burned',
                        'total_supply': 0,
                        'royalties': {},
                        'on_chain_files': {},
                        'detected_at': detected_at,
                    }
                    logger.info(f"Object {address} found in local burned registry")
            except Exception as e:
                logger.debug(f"Local burned registry check failed for {address}: {e}")

        if not formatted:
            raise HTTPException(status_code=404, detail="Object not found")

        formatted['network'] = network
        formatted['object_address'] = address

        # ── Burn detection: check on-chain roots for BRN transactions ──
        if not formatted.get('is_burned'):
            try:
                roots = await p2fk_get(f"GetRootsByAddress/{address}", is_mainnet)
                burn_count = 0
                burn_txids = []
                if isinstance(roots, list):
                    for root in roots:
                        file_data = root.get('File') or {}
                        if 'BRN' in file_data:
                            burn_count += 1
                            burn_txids.append(root.get('TransactionId', '')[:16])
                if burn_count > 0:
                    formatted['burn_transactions'] = burn_count
                    formatted['burn_txids'] = burn_txids
                    total_owned = sum(o.get('quantity', 0) for o in (formatted.get('owners') or []))
                    formatted['is_burned'] = total_owned == 0
                    formatted['burn_status'] = 'fully_burned' if total_owned == 0 else 'partially_burned'
                    # Register in burned objects registry
                    if total_owned == 0:
                        try:
                            from routes.snapshot import _register_burned_object
                            await _register_burned_object(address, burn_txids[0] if burn_txids else '', network)
                        except Exception:
                            pass
            except Exception as e:
                logger.debug(f"Burn check error for {address}: {e}")

        # Resolve missing TransactionId via GetRootsByAddress
        if not formatted.get('transaction_id'):
            try:
                roots = await p2fk_get(f"GetRootsByAddress/{address}", is_mainnet)
                if isinstance(roots, list) and roots:
                    formatted['transaction_id'] = roots[0].get('TransactionId', '')
            except Exception:
                pass

        # Resolve profiles from memory cache only (instant, no API calls)
        resolved = _resolve_profiles_for_object(formatted, is_mainnet)
        formatted['resolved_profiles'] = resolved
        # Index for text search
        try:
            await index_objects([formatted], network)
        except Exception:
            pass
        return formatted
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Object by address error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/object/{txid}")
async def get_object_detail(txid: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        formatted = None

        # Always try fresh verbose fetch first (includes Listings)
        raw = await fetch_object_by_txid(txid, is_mainnet)
        if raw:
            formatted = format_object_for_api(raw)

        # Fallback to storefront cache
        if not formatted:
            cache_key = f"storefront:{network}"
            cached = await object_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
            if cached and cached.get('objects'):
                for obj in cached['objects']:
                    if obj.get('transaction_id') == txid:
                        formatted = dict(obj)
                        break

        if not formatted:
            # Fallback: search the object_index for a cached entry with this txid
            idx_doc = await object_index_col.find_one(
                {'raw.transaction_id': txid}, {'_id': 0, 'raw': 1}
            )
            if idx_doc and idx_doc.get('raw'):
                formatted = idx_doc['raw']
            else:
                # Fallback 2: search SQLite api_cache for GetObjectsOwnedByAddress results
                try:
                    from db_sqlite import get_conn
                    import json as _json
                    conn = await get_conn()
                    async with conn.execute(
                        "SELECT data FROM api_cache WHERE _id LIKE 'p2fk:GetObjectsOwnedByAddress/%' AND data LIKE ?",
                        (f'%{txid}%',)
                    ) as cursor:
                        rows = await cursor.fetchall()
                    for (data_str,) in rows:
                        parsed = _json.loads(data_str)
                        items = parsed.get('data', []) if isinstance(parsed, dict) else []
                        for obj in items:
                            if obj.get('TransactionId') == txid:
                                formatted = format_object_for_api(obj)
                                break
                        if formatted:
                            break
                except Exception as e:
                    logger.debug(f"SQLite fallback error: {e}")

        if not formatted:
            raise HTTPException(status_code=404, detail="Object not found")

        formatted['network'] = network

        # Resolve profile names — ONLY from in-memory cache (instant, no API calls).
        resolved = _resolve_profiles_for_object(formatted, is_mainnet)
        formatted['resolved_profiles'] = resolved
        return formatted
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Object detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/object/{txid}/changelog")
async def get_object_changelog(txid: str, network: str = 'btc-testnet'):
    """Lazy-loaded changelog for object detail. Called by frontend after basic data renders."""
    try:
        is_mainnet = 'mainnet' in network.lower()

        # First find the object address
        obj_addr = None
        cache_key = f"storefront:{network}"
        cached = await object_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
        if cached and cached.get('objects'):
            for obj in cached['objects']:
                if obj.get('transaction_id') == txid:
                    obj_addr = obj.get('object_address')
                    # If this cached entry already has changelog, return it
                    if obj.get('change_log'):
                        return {"change_log": obj['change_log'], "from_cache": True}
                    break

        if not obj_addr:
            raw = await fetch_object_by_txid(txid, is_mainnet)
            if raw:
                creators = raw.get('Creators', [])
                obj_addr = creators[0] if creators else None

        if not obj_addr:
            return {"change_log": [], "error": "Object not found"}

        verbose_data = await p2fk_get(
            f"GetObjectByAddress/{obj_addr}", is_mainnet,
            extra_params={'verbose': 'true'}
        )
        if verbose_data and isinstance(verbose_data, dict):
            verbose_formatted = format_object_for_api(verbose_data)
            return {
                "change_log": verbose_formatted.get('change_log', []),
                "process_height": verbose_formatted.get('process_height', 0),
                "created_date": verbose_formatted.get('created_date', ''),
                "change_date": verbose_formatted.get('change_date', ''),
            }
        return {"change_log": []}
    except Exception as e:
        logger.error(f"Changelog fetch error: {e}")
        return {"change_log": [], "error": str(e)}


@router.get("/objects/storefront/{network}")
async def get_storefront(network: str, skip: int = 0, limit: int = 10, keyword: str = None, data_source: str = None):
    """Lean storefront: 1 API call per keyword, paginated locally from cache.
    
    - Initial load (no keyword): serves from a cached pool built one keyword at a time.
    - With keyword: fetches that specific keyword's objects (1 API call).
    - Skip/limit paginate within the cached result set.
    - 'See more' increments skip; when exhausted, frontend can request next keyword.
    """
    KEYWORDS = ['art', 'game', 'music', 'bitcoin', 'nft', 'token', 'photo', 'video', 'sup', 'embii', 'doge', 'litecoin', 'meme']

    def _detect_data_repo(obj):
        for field in ['urn', 'image']:
            ref = obj.get(field, '') or ''
            upper = ref.upper()
            if upper.startswith('IPFS:'): return 'IPFS'
            if upper.startswith('DOG:'): return 'DOGE'
            if upper.startswith('LTC:'): return 'LTC'
            if upper.startswith('MZC:'): return 'MAZ'
            if upper.startswith('BTC:'): return 'BTC'
            if re.match(r'^[0-9a-fA-F]{64}', ref):
                obj_addr = obj.get('object_address', '')
                if obj_addr:
                    from config import ADDRESS_VERSION_CHAINS
                    from utils.p2fk import base58_decode
                    try:
                        raw = base58_decode(obj_addr)
                        if len(raw) >= 2:
                            chain, _ = ADDRESS_VERSION_CHAINS.get(raw[0], (None, None))
                            if chain == 'DOG': return 'DOGE'
                            if chain == 'LTC': return 'LTC'
                            if chain == 'MZC': return 'MAZ'
                    except Exception:
                        pass
                return 'BTC'
        return 'IPFS'

    try:
        is_mainnet = 'mainnet' in network.lower()
        cache_key = f"storefront:{network}"

        # ── Serve from cache if fresh (< 5 min) ──
        cached = await object_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
        cached_objects = []
        cached_kw_index = 0  # how many keywords have been fetched so far
        cache_fresh = False

        if cached and cached.get('cached_at'):
            cache_age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['cached_at'])).total_seconds()
            cache_fresh = cache_age < 300
            cached_objects = cached.get('objects', [])
            cached_kw_index = cached.get('kw_index', 0)

        # ── If cache can serve this page, return immediately ──
        if cache_fresh and skip + limit <= len(cached_objects):
            all_objects = cached_objects
            # Filter out burned objects — registry + proactive BRN root verification
            try:
                obj_addrs = [o.get('object_address') for o in all_objects if o.get('object_address')]
                burned_addrs = await batch_verify_burns(obj_addrs, is_mainnet, network)
                if burned_addrs:
                    all_objects = [o for o in all_objects if o.get('object_address') not in burned_addrs]
            except Exception:
                pass
            # Also filter objects with 0 total supply (stale data)
            all_objects = [o for o in all_objects if o.get('total_supply', 1) > 0]
            if data_source and data_source != 'ALL':
                all_objects = [o for o in all_objects if _detect_data_repo(o) == data_source]
            page = all_objects[skip:skip + limit]
            return {
                "objects": page,
                "total": len(all_objects),
                "total_listed": len([o for o in all_objects if o.get('is_listed')]),
                "skip": skip, "limit": limit,
                "has_more": (skip + limit) < len(all_objects),
                "from_cache": True,
                "keywords_fetched": cached_kw_index,
                "keywords_total": len(KEYWORDS),
            }

        # ── Need more data: fetch ONE keyword at a time ──
        if keyword:
            # Explicit keyword search — single call
            kw_to_fetch = [keyword]
            kw_index = cached_kw_index
        elif cached_kw_index < len(KEYWORDS):
            # Fetch next unfetched keyword
            kw_to_fetch = [KEYWORDS[cached_kw_index]]
            kw_index = cached_kw_index + 1
        else:
            # All keywords exhausted — serve what we have (with burn filtering)
            all_objects = cached_objects
            try:
                obj_addrs = [o.get('object_address') for o in all_objects if o.get('object_address')]
                burned_addrs = await batch_verify_burns(obj_addrs, is_mainnet, network)
                if burned_addrs:
                    all_objects = [o for o in all_objects if o.get('object_address') not in burned_addrs]
            except Exception:
                pass
            all_objects = [o for o in all_objects if o.get('total_supply', 1) > 0]
            if data_source and data_source != 'ALL':
                all_objects = [o for o in all_objects if _detect_data_repo(o) == data_source]
            page = all_objects[skip:skip + limit]
            return {
                "objects": page,
                "total": len(all_objects),
                "total_listed": len([o for o in all_objects if o.get('is_listed')]),
                "skip": skip, "limit": limit,
                "has_more": False,
                "end_of_results": True,
                "from_cache": True,
                "keywords_fetched": cached_kw_index,
                "keywords_total": len(KEYWORDS),
            }

        # ── Single API call for the keyword ──
        seen_txids = set(o.get('transaction_id', '') for o in cached_objects)
        new_objects = []

        for kw in kw_to_fetch:
            try:
                data = await p2fk_get(f"GetObjectsByKeyword/{kw}", is_mainnet, {"verbose": "false"})
                if isinstance(data, list):
                    for obj in data:
                        txid_val = obj.get('TransactionId', '')
                        if txid_val and txid_val not in seen_txids:
                            seen_txids.add(txid_val)
                            new_objects.append(obj)
            except Exception:
                pass

        # Format and merge with existing cache
        formatted_new = [format_object_for_api(obj) for obj in new_objects]
        formatted_new = [f for f in formatted_new if f.get('urn') or f.get('name', 'Unnamed') != 'Unnamed']

        all_formatted = cached_objects + formatted_new

        # Filter out burned objects from ALL objects (cached + new)
        try:
            obj_addrs = [o.get('object_address') for o in all_formatted if o.get('object_address')]
            burned_addrs = await batch_verify_burns(obj_addrs, is_mainnet, network)
            if burned_addrs:
                all_formatted = [f for f in all_formatted if f.get('object_address') not in burned_addrs]
        except Exception:
            pass
        # Also filter objects with 0 total supply
        all_formatted = [f for f in all_formatted if f.get('total_supply', 1) > 0]

        # Sort: listed first by price, then by change date
        all_formatted.sort(key=lambda x: (
            0 if x.get('is_listed') else 1,
            x.get('min_price', 999999) if x.get('is_listed') else 999999,
            x.get('change_date', '') or '',
        ))

        # Index for text search
        try:
            await index_objects(formatted_new, network)
        except Exception:
            pass

        # Update cache
        await object_cache_col.update_one(
            {'cache_key': cache_key},
            {'$set': {
                'cache_key': cache_key,
                'objects': all_formatted,
                'total': len(all_formatted),
                'kw_index': kw_index if not keyword else cached_kw_index,
                'cached_at': datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True
        )

        all_objects = all_formatted
        if data_source and data_source != 'ALL':
            all_objects = [o for o in all_objects if _detect_data_repo(o) == data_source]

        page = all_objects[skip:skip + limit]

        return {
            "objects": page,
            "total": len(all_objects),
            "total_listed": len([o for o in all_objects if o.get('is_listed')]),
            "skip": skip, "limit": limit,
            "has_more": (skip + limit) < len(all_objects),
            "from_cache": False,
            "keywords_fetched": kw_index if not keyword else cached_kw_index,
            "keywords_total": len(KEYWORDS),
        }
    except Exception as e:
        logger.error(f"Storefront error: {e}")
        return {"objects": [], "total": 0, "total_listed": 0, "has_more": False, "error": str(e)}
