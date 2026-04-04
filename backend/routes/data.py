"""Data routes: feed, profiles, conversations, threads, search, known users, resolve."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime, timezone
import asyncio
import logging

from db import known_users_col, conversation_cache_col, first_seen_col, db
from utils.helpers import (
    p2fk_get, fetch_profile_by_urn, fetch_profile_by_address,
    fetch_public_messages, fetch_messages_by_sender, fetch_objects_owned, fetch_objects_by_address,
    fetch_objects_created_by_address, fetch_roots_by_address,
    get_root_by_txid, search_keyword, get_cached_profile,
    register_known_user, get_known_addresses, format_profile,
    format_message, format_object_for_api,
    fetch_keyword_messages,
)
from utils.p2fk import txid_to_reply_address, derive_address_from_pkxy

logger = logging.getLogger(__name__)
import re as _re

# ─── Proactive IPFS Pinning ───
# When feed posts are loaded, extract all IPFS CIDs and pin them
# so this node acts as a pinning node for viewed content.

_pinning_in_progress = set()  # Avoid duplicate pin requests

async def _proactive_pin_feed_cids(messages: list):
    """Extract all IPFS CIDs from feed messages and pin them to local Kubo.
    This ensures our node has a copy of every image/file referenced in posts."""
    cids_to_pin = set()
    for msg in messages:
        content = msg.get('content', '')
        # Extract IPFS:CID from <<IPFS:CID/filename>> patterns
        for match in _re.finditer(r'IPFS:([A-Za-z0-9]{46,})', content):
            cids_to_pin.add(match.group(1))
        # Extract from sender_image field (profile pics)
        sender_img = msg.get('sender_image', '') or ''
        for match in _re.finditer(r'IPFS:([A-Za-z0-9]{46,})', sender_img):
            cids_to_pin.add(match.group(1))
        # Extract from files dict keys
        files = msg.get('files') or {}
        for fname in files:
            if fname.startswith('Qm') or fname.startswith('bafy'):
                cids_to_pin.add(fname.split('/')[0])

    # Deduplicate against in-progress pins
    new_cids = cids_to_pin - _pinning_in_progress
    if not new_cids:
        return

    _pinning_in_progress.update(new_cids)
    logger.info(f"Proactive IPFS pin: queueing {len(new_cids)} CIDs from feed")

    try:
        from utils.http_pool import get_client
        client = get_client()
        for cid in new_cids:
            try:
                # First try to pin (if already in Kubo, this is instant)
                resp = await client.post(
                    f"http://127.0.0.1:5001/api/v0/pin/add?arg={cid}",
                    timeout=120.0
                )
                if resp.status_code == 200:
                    logger.info(f"Proactive pin OK: {cid[:20]}...")
                else:
                    logger.debug(f"Proactive pin skip {cid[:20]}: {resp.status_code}")
            except Exception as e:
                logger.debug(f"Proactive pin failed {cid[:20]}: {e}")
            finally:
                _pinning_in_progress.discard(cid)
    except Exception as e:
        logger.warning(f"Proactive pin batch error: {e}")
        _pinning_in_progress.difference_update(new_cids)
router = APIRouter(prefix="/api")

# Import rate limiter from app
from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)


# In-memory lock to prevent concurrent feed refresh storms per network
_feed_refreshing = {}


async def _apply_first_seen(messages, txid_key='transaction_id'):
    """Look up first_seen timestamps from DB. Set new ones for never-seen txids."""
    txids = [m[txid_key] for m in messages if m.get(txid_key)]
    if not txids:
        return
    existing = {}
    async for doc in first_seen_col.find({'txid': {'$in': txids}}, {'_id': 0}):
        existing[doc['txid']] = doc['first_seen']
    now = datetime.now(timezone.utc).isoformat()
    new_docs = []
    for msg in messages:
        txid = msg.get(txid_key)
        if txid and txid in existing:
            msg['first_seen'] = existing[txid]
        elif txid:
            msg['first_seen'] = now
            new_docs.append({'txid': txid, 'first_seen': now})
    if new_docs:
        try:
            await first_seen_col.insert_many(new_docs, ordered=False)
        except Exception:
            pass


class SearchQuery(BaseModel):
    query: str
    network: str = 'btc-testnet'


class BatchResolveRequest(BaseModel):
    addresses: list
    network: str = 'btc-testnet'


@router.get("/")
async def root():
    return {"message": "Cthulhu API", "version": "0.0.3"}


@router.get("/health")
async def health_check():
    """Real health check — verify SQLite and IPFS daemon connectivity."""
    health = {"status": "healthy", "services": {}}
    try:
        from db_sqlite import get_conn
        conn = await get_conn()
        async with conn.execute("SELECT 1") as cursor:
            await cursor.fetchone()
        health["services"]["sqlite"] = "up"
    except Exception:
        health["services"]["sqlite"] = "down"
        health["status"] = "degraded"
    try:
        from utils.http_pool import get_client
        client = get_client()
        resp = await client.post("http://127.0.0.1:5001/api/v0/id", timeout=3.0)
        health["services"]["ipfs"] = "up" if resp.status_code == 200 else "down"
    except Exception:
        health["services"]["ipfs"] = "down"
    return health


async def _refresh_feed_cache(network: str, is_mainnet: bool, cache_key: str):
    """Incremental feed refresh — only fetches from addresses with recently
    discovered activity (from vacuum). Preserves existing cached messages.
    Falls back to a batched full rebuild if no existing cache."""
    if _feed_refreshing.get(network):
        logger.info(f"Feed refresh already in progress for {network}, skipping")
        return
    _feed_refreshing[network] = True
    try:
        logger.info(f"Background feed refresh started for {network}...")

        # Load existing cached messages
        cached = await conversation_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
        existing_messages = cached.get('messages', []) if cached else []
        existing_txids = {m.get('transaction_id', '') for m in existing_messages if m.get('transaction_id')}

        # Get ALL known addresses but batch them to avoid rate-limit storms
        addresses = await get_known_addresses(network)
        BATCH_SIZE = 30  # Process 30 at a time to avoid overwhelming explorers
        BATCH_DELAY = 2  # Seconds between batches

        async def fetch_addr_msgs(addr):
            return addr, await fetch_public_messages(addr, is_mainnet)

        new_raw = []
        unique_senders = set()
        total_fetched = 0
        batch_num = 0

        for batch_start in range(0, len(addresses), BATCH_SIZE):
            batch = addresses[batch_start:batch_start + BATCH_SIZE]
            batch_num += 1
            results = await asyncio.gather(
                *[fetch_addr_msgs(addr) for addr in batch],
                return_exceptions=True
            )

            batch_msgs = 0
            for result in results:
                if isinstance(result, Exception):
                    continue
                address, msgs = result
                total_fetched += len(msgs)
                for msg in msgs:
                    txid = msg.get('TransactionId', '')
                    if txid and txid in existing_txids:
                        continue  # Already in cache
                    if txid:
                        existing_txids.add(txid)
                    from_addr = msg.get('FromAddress', address)
                    unique_senders.add(from_addr)
                    new_raw.append((from_addr, msg))
                    batch_msgs += 1

            if batch_num <= 3 or batch_msgs > 0:
                logger.info(f"Feed batch {batch_num}: {batch_msgs} new msgs from {len(batch)} addrs (total fetched: {total_fetched})")

            if batch_start + BATCH_SIZE < len(addresses):
                await asyncio.sleep(BATCH_DELAY)

        # Fetch profiles for new senders only
        async def fetch_profile_safe(addr):
            try:
                return addr, await get_cached_profile(addr, is_mainnet)
            except Exception:
                return addr, None

        # Fetch profiles for new senders — batched to avoid rate-limit storms
        profiles = {}
        sender_list = list(unique_senders)
        PROFILE_BATCH = 50
        for pb_start in range(0, len(sender_list), PROFILE_BATCH):
            pb = sender_list[pb_start:pb_start + PROFILE_BATCH]
            profile_results = await asyncio.gather(
                *[fetch_profile_safe(addr) for addr in pb],
                return_exceptions=True
            )
            for pr in profile_results:
                if isinstance(pr, Exception):
                    continue
                addr, profile = pr
                profiles[addr] = profile
            if pb_start + PROFILE_BATCH < len(sender_list):
                await asyncio.sleep(1)

        # Format new messages
        new_messages = []
        for from_addr, msg in new_raw:
            if _is_system_or_encrypted_msg(msg):
                continue

            profile = profiles.get(from_addr)
            formatted = await format_message(msg, profile, network, is_mainnet)
            new_messages.append(formatted)
            if profile and profile.get('URN'):
                await register_known_user(
                    from_addr, network, profile.get('URN'),
                    profile.get('Image'), profile.get('DisplayName')
                )

        # Merge: existing + new, deduplicated
        all_messages = existing_messages + new_messages
        all_messages.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        await _apply_first_seen(all_messages)

        def feed_sort_key(msg):
            created = msg.get('created_at', '')
            first = msg.get('first_seen', '')
            if first and created:
                try:
                    from datetime import datetime, timezone, timedelta
                    fs = datetime.fromisoformat(first.replace('Z', '+00:00'))
                    bd = datetime.fromisoformat(created.replace('Z', '+00:00'))
                    if fs.tzinfo is None:
                        fs = fs.replace(tzinfo=timezone.utc)
                    if bd.tzinfo is None:
                        bd = bd.replace(tzinfo=timezone.utc)
                    now = datetime.now(timezone.utc)
                    if (now - fs) < timedelta(hours=24) and fs > bd:
                        return first
                except Exception:
                    pass
            return created
        all_messages.sort(key=feed_sort_key, reverse=True)
        await conversation_cache_col.update_one(
            {'cache_key': cache_key},
            {'$set': {'cache_key': cache_key, 'messages': all_messages,
                      'timestamp': datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        logger.info(f"Feed cache refreshed for {network}: {len(all_messages)} messages ({len(new_messages)} new, {len(existing_messages)} existing)")
        asyncio.create_task(_proactive_pin_feed_cids(all_messages))
    except Exception as e:
        logger.warning(f"Background feed refresh failed for {network}: {e}")
    finally:
        _feed_refreshing[network] = False


def _is_system_or_encrypted_msg(msg: dict) -> bool:
    """Return True if this P2FK root should be hidden from the public feed.
    Catches: SEC backups, SEC-encrypted DMs, CTHULHU_CHECKPOINT, empty/garbled content."""
    raw_content = msg.get('Message', '')
    content_str = ' '.join(raw_content) if isinstance(raw_content, list) else str(raw_content)
    file_data = msg.get('File') or {}

    # SEC-encrypted DMs (SEC<separator><data>)
    if content_str.startswith('SEC') and len(content_str) > 4 and content_str[3] in '\\//:*?"<>|':
        return True
    # SEC key in File dict
    if isinstance(file_data, dict) and 'SEC' in file_data:
        return True
    # CTHULHU_CHECKPOINT system messages
    if 'CTHULHU_CHECKPOINT' in content_str or 'CTHULHU_SNAPSHOT' in content_str:
        return True
    # Raw SEC backups — encoded as raw bytes, decoded as garbled/binary content.
    # These have no readable text and often contain SIG headers with binary after padding.
    # Detect: content starts with SIG and has non-printable bytes anywhere after the signature.
    if content_str.startswith('SIG') and len(content_str) > 80:
        tail = content_str[80:]
        if any(ord(c) < 32 and c not in '\n\r\t' for c in tail):
            return True
        # Also catch posts that are SIG + only padding/hash marks + hex remnants
        readable_tail = tail.replace('#', '').replace('<', '').replace('>', '').strip()
        if len(readable_tail) < 20:
            return True
    # Completely empty content with no file — blank post
    stripped = content_str.strip().replace('#', '').strip()
    if not stripped and not file_data:
        return True
    return False


async def _build_feed_from_scratch(network: str, is_mainnet: bool) -> list:
    addresses = await get_known_addresses(network)
    BATCH_SIZE = 30
    BATCH_DELAY = 2

    async def fetch_addr_msgs(addr):
        return addr, await fetch_public_messages(addr, is_mainnet)

    all_raw = []
    seen_txids = set()
    unique_senders = set()

    for batch_start in range(0, len(addresses), BATCH_SIZE):
        batch = addresses[batch_start:batch_start + BATCH_SIZE]
        results = await asyncio.gather(
            *[fetch_addr_msgs(addr) for addr in batch],
            return_exceptions=True
        )

        for result in results:
            if isinstance(result, Exception):
                continue
            address, msgs = result
            if not isinstance(msgs, list):
                continue
            for msg in msgs:
                if not isinstance(msg, dict):
                    continue
                txid = msg.get('TransactionId', '')
                if txid and txid in seen_txids:
                    continue
                seen_txids.add(txid)
                from_addr = msg.get('FromAddress', address)
                unique_senders.add(from_addr)
                all_raw.append((from_addr, msg))

        if batch_start + BATCH_SIZE < len(addresses):
            await asyncio.sleep(BATCH_DELAY)

    async def fetch_profile_safe(addr):
        try:
            return addr, await get_cached_profile(addr, is_mainnet)
        except Exception:
            return addr, None

    profile_results = await asyncio.gather(
        *[fetch_profile_safe(addr) for addr in unique_senders],
        return_exceptions=True
    )
    profiles = {}
    for pr in profile_results:
        if isinstance(pr, Exception):
            continue
        addr, profile = pr
        profiles[addr] = profile

    all_messages = []
    for from_addr, msg in all_raw:
        # Filter out SEC, checkpoint, and blank posts from the public feed
        if _is_system_or_encrypted_msg(msg):
            continue

        profile = profiles.get(from_addr)
        formatted = await format_message(msg, profile, network, is_mainnet)
        all_messages.append(formatted)
        if profile and profile.get('URN'):
            await register_known_user(
                from_addr, network, profile.get('URN'),
                profile.get('Image'), profile.get('DisplayName')
            )

    all_messages.sort(key=lambda x: x['created_at'], reverse=True)
    await _apply_first_seen(all_messages)

    # Merge registered polls into the feed
    try:
        from db import poll_registry_col
        poll_cursor = poll_registry_col.find(
            {'network': {'$regex': network, '$options': 'i'}},
            {'_id': 0}
        )
        registered_polls = await poll_cursor.to_list(length=200)
        existing_txids = {m['transaction_id'] for m in all_messages}
        for poll in registered_polls:
            try:
                if poll['txid'] in existing_txids:
                    continue
                creator = poll.get('creator_address', '')
                profile = None
                if creator and len(creator) > 10:
                    profile = await get_cached_profile(creator, is_mainnet)
                all_messages.append({
                    'id': poll['txid'],
                    'from_address': creator,
                    'to_address': '',
                    'content': f"INQ|{poll.get('question', 'Poll')}",
                    'transaction_id': poll['txid'],
                    'network': network,
                    'created_at': poll.get('created_at', ''),
                    'block_time': poll.get('created_at', ''),
                    'is_reply': False,
                    'is_poll': True,
                    'poll_data': {
                        'txid': poll['txid'],
                        'question': poll.get('question', 'Poll'),
                        'answers': poll.get('answers', []),
                        'own_gate': poll.get('own_gate', []),
                        'cre_gate': poll.get('cre_gate', []),
                        'total_votes': poll.get('total_votes', 0),
                        'total_gated_votes': 0,
                        'status': 'active',
                        'votes': poll.get('votes', {}),
                    },
                    'sender_urn': profile.get('URN') if profile else None,
                    'sender_display_name': profile.get('DisplayName') if profile else None,
                    'sender_image': profile.get('Image') if profile else None,
                    'recipient_urn': None,
                    'recipient_image': None,
                    'files': None,
                })
            except Exception as pe:
                logger.warning(f"Failed to merge poll {poll.get('txid', '?')[:16]}: {pe}")
    except Exception as e:
        logger.warning(f"Failed to merge registered polls into feed: {e}")

    # Sort by effective timestamp: created_at (BlockDate) is authoritative for confirmed posts.
    # first_seen only overrides for very recent mempool transactions (within 24h).
    def feed_sort_key(msg):
        created = msg.get('created_at', '')
        first = msg.get('first_seen', '')
        if first and created:
            try:
                from datetime import datetime, timezone, timedelta
                fs = datetime.fromisoformat(first.replace('Z', '+00:00'))
                bd = datetime.fromisoformat(created.replace('Z', '+00:00'))
                if fs.tzinfo is None:
                    fs = fs.replace(tzinfo=timezone.utc)
                if bd.tzinfo is None:
                    bd = bd.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                if (now - fs) < timedelta(hours=24) and fs > bd:
                    return first
            except Exception:
                pass
        return created
    all_messages.sort(key=feed_sort_key, reverse=True)
    return all_messages


@router.get("/feed/{network}")
async def get_feed(network: str, skip: int = 0, limit: int = 5, mode: str = 'global', followed: str = ''):
    try:
        is_mainnet = 'mainnet' in network.lower()
        cache_key = f"feed:{network}"

        cached = await conversation_cache_col.find_one(
            {'cache_key': cache_key}, {'_id': 0}
        )

        if cached and cached.get('messages'):
            cache_age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['timestamp'])).total_seconds()
            all_messages = cached['messages']

            # Filter to followed addresses only
            if mode == 'following' and followed:
                followed_set = set(a.strip() for a in followed.split(',') if a.strip())
                if followed_set:
                    all_messages = [m for m in all_messages if m.get('from_address') in followed_set]

            total = len(all_messages)
            page = all_messages[skip:skip + limit]

            refreshing = _feed_refreshing.get(network, False)
            if cache_age > 300 and not refreshing:
                asyncio.create_task(_refresh_feed_cache(network, is_mainnet, f"feed:{network}"))
                refreshing = True

            # Proactive IPFS pin: pin all CIDs referenced in the feed page
            asyncio.create_task(_proactive_pin_feed_cids(page))

            return {
                "feed": page, "network": network, "count": len(page),
                "total": total, "skip": skip, "limit": limit,
                "has_more": (skip + limit) < total,
                "cached": True, "cache_age": int(cache_age), "refreshing": refreshing,
                "mode": mode,
            }

        # No cache — return empty immediately and build in background
        if not _feed_refreshing.get(network):
            asyncio.create_task(_refresh_feed_cache(network, is_mainnet, cache_key))

        return {
            "feed": [], "network": network, "count": 0,
            "total": 0, "skip": skip, "limit": limit,
            "has_more": False,
            "cached": False, "cache_age": 0, "refreshing": True,
            "mode": mode,
        }
    except Exception as e:
        logger.error(f"Feed error: {e}")
        return {"feed": [], "network": network, "count": 0, "total": 0, "has_more": False}


async def _surgical_cache_purge(txid: str, network: str):
    """Remove a single post (by txid) from the feed cache and unpin its IPFS CIDs.
    This is a SURGICAL delete — only the specific item is removed, not the whole cache."""
    try:
        cache_key = f"feed:{network}"
        cached = await conversation_cache_col.find_one(
            {'cache_key': cache_key}, {'_id': 0}
        )
        if not cached or not cached.get('messages'):
            return

        messages = cached['messages']
        original_count = len(messages)

        # Find the message to extract any IPFS CIDs before removing
        cids_to_unpin = set()
        for msg in messages:
            if msg.get('transaction_id') == txid:
                # Extract IPFS CIDs from the message content and files
                content = msg.get('content', '')
                import re
                ipfs_refs = re.findall(r'IPFS:([A-Za-z0-9]{46,})', content)
                for ref in ipfs_refs:
                    cid = ref.split('/')[0].split('\\')[0]
                    if len(cid) >= 46:
                        cids_to_unpin.add(cid)
                # Check files dict
                files = msg.get('files') or {}
                for fname in files:
                    if fname.startswith('Qm') or fname.startswith('bafy'):
                        cids_to_unpin.add(fname.split('/')[0])

        # Filter out the deleted message
        filtered = [m for m in messages if m.get('transaction_id') != txid]

        if len(filtered) < original_count:
            await conversation_cache_col.update_one(
                {'cache_key': cache_key},
                {'$set': {'messages': filtered}},
            )
            logger.info(f"Surgical delete: removed txid {txid[:16]}... from feed cache ({original_count} → {len(filtered)})")

            # Unpin IPFS CIDs from local Kubo daemon (best-effort)
            if cids_to_unpin:
                try:
                    from utils.http_pool import get_client
                    client = get_client()
                    for cid in cids_to_unpin:
                        try:
                            await client.post(f"http://127.0.0.1:5001/api/v0/pin/rm?arg={cid}", timeout=5.0)
                            logger.info(f"Unpinned IPFS CID: {cid[:16]}...")
                        except Exception as e:
                            logger.debug(f"IPFS unpin skipped for {cid[:16]}: {e}")
                except Exception as e:
                    logger.debug(f"IPFS unpin batch failed: {e}")
        else:
            logger.debug(f"Surgical delete: txid {txid[:16]}... not found in feed cache")

    except Exception as e:
        logger.warning(f"Surgical cache purge error for {txid[:16]}: {e}")


@router.post("/reactions/{txid}")
async def store_pending_reaction(txid: str, network: str = 'btc-testnet', body: dict = {}):
    """Store a pending reaction in MongoDB so it shows across browsers/devices
    before the blockchain indexer picks it up."""
    try:
        reaction_type = body.get("type", "like")  # like, tip, pin, delete
        from_addr = body.get("from_address", "")
        amount = body.get("amount", 0)
        broadcast_txid = body.get("broadcast_txid", "")
        if not from_addr:
            return {"ok": False, "error": "from_address required"}

        doc = {
            "target_txid": txid,
            "network": network,
            "type": reaction_type,
            "from_address": from_addr,
            "amount": amount,
            "broadcast_txid": broadcast_txid,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.pending_reactions.update_one(
            {"target_txid": txid, "from_address": from_addr, "type": reaction_type, "network": network},
            {"$set": doc},
            upsert=True,
        )

        # ── Surgical delete: remove ONLY this specific txid from feed cache ──
        if reaction_type == "delete":
            asyncio.create_task(_surgical_cache_purge(txid, network))

        return {"ok": True}
    except Exception as e:
        logger.error(f"Store reaction error: {e}")
        return {"ok": False, "error": str(e)}


@router.get("/reactions/{txid}")
async def get_reactions(txid: str, network: str = 'btc-testnet'):
    """Fetch reactions for a message txid.
    Merges: on-chain (p2fk.io indexer) + pending (MongoDB)."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        is_testnet = not is_mainnet
        # Get the keyword address for this txid
        reply_addr = txid_to_reply_address(txid, is_testnet)
        # Fetch all roots at this keyword address
        roots = await fetch_roots_by_address(reply_addr, is_mainnet)
        if not isinstance(roots, list):
            roots = []

        likes = []
        tips = []
        pins = []
        deletes = []
        for root in roots:
            if not isinstance(root, dict):
                continue
            msg = ''
            raw_msg = root.get('Message', '')
            if isinstance(raw_msg, list):
                msg = ' '.join(str(m) for m in raw_msg)
            elif isinstance(raw_msg, str):
                msg = raw_msg
            from_addr = root.get('FromAddress', '')
            tx = root.get('TransactionId', '')
            entry = {"from": from_addr, "txid": tx, "confirmed": True}

            if '<<-like>>' in msg:
                likes.append(entry)
            elif '<<-pin>>' in msg:
                pins.append(entry)
            elif '<<-delete>>' in msg:
                deletes.append(entry)
            # else: ignore — don't count plain replies or unknown messages as likes

        # Merge with pending reactions from MongoDB
        chain_addrs = {e["from"] for e in likes + tips + pins + deletes}
        pending_cursor = db.pending_reactions.find(
            {"target_txid": txid, "network": network},
            {"_id": 0}
        )
        async for pdoc in pending_cursor:
            if pdoc["from_address"] in chain_addrs:
                continue  # Already confirmed on-chain, skip pending
            entry = {"from": pdoc["from_address"], "txid": pdoc.get("broadcast_txid", ""), "confirmed": False, "amount": pdoc.get("amount", 0)}
            rtype = pdoc.get("type", "like")
            if rtype == "like":
                likes.append(entry)
            elif rtype == "tip":
                tips.append(entry)
            elif rtype == "pin":
                pins.append(entry)
            elif rtype == "delete":
                deletes.append(entry)

        # Check if any delete was from the original post author
        # First get the original root to find its author
        deleted_by_author = False
        if deletes:
            original_root = await p2fk_get(f"GetRootByTransactionID/{txid}", is_mainnet)
            original_author = ''
            if isinstance(original_root, dict):
                signed_by = original_root.get('SignedBy', '')
                original_author = signed_by if signed_by else ''
            if original_author:
                deleted_by_author = any(d["from"] == original_author for d in deletes)

        # If confirmed delete by author, surgically purge from cache
        if deleted_by_author:
            asyncio.create_task(_surgical_cache_purge(txid, network))

        return {
            "txid": txid,
            "likes": len(likes),
            "tips": len(tips),
            "pins": len(pins),
            "deletes": len(deletes),
            "deleted_by_author": deleted_by_author,
            "like_addrs": [lk["from"] for lk in likes[:10]],
            "pin_addrs": [p["from"] for p in pins[:10]],
            "tip_total": sum(e.get("amount", 0) for e in tips),
            "has_pending": any(not e.get("confirmed", True) for e in likes + tips + pins),
        }
    except Exception as e:
        logger.error(f"Reactions error for {txid}: {e}")
        return {"txid": txid, "likes": 0, "tips": 0, "pins": 0, "deletes": 0, "deleted_by_author": False, "like_addrs": [], "pin_addrs": [], "tip_total": 0, "has_pending": False}


@router.get("/profile/{address}")
async def get_profile(address: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()

        raw = await fetch_profile_by_address(address, is_mainnet)
        if raw and raw.get('URN'):
            profile = format_profile(raw, network)
            await register_known_user(address, network, raw.get('URN'), raw.get('Image'), raw.get('DisplayName'))
            return profile

        raw = await fetch_profile_by_urn(address, is_mainnet)
        if raw and raw.get('URN'):
            profile = format_profile(raw, network)
            creators = raw.get('Creators') or []
            if creators:
                await register_known_user(creators[0], network, raw.get('URN'), raw.get('Image'), raw.get('DisplayName'))
            return profile

        # P2FK returned nothing — fall back to local known_users cache
        known = await known_users_col.find_one(
            {'address': address, 'network': network},
            {'_id': 0}
        )
        if known and known.get('urn') and known.get('urn') != address:
            return {
                "address": address,
                "urn": known.get('urn'),
                "display_name": known.get('display_name'),
                "bio": None,
                "image": known.get('image'),
                "network": network,
                "cached": True,
            }

        return {"address": address, "urn": address, "display_name": None, "bio": None, "image": None, "network": network}
    except Exception as e:
        logger.error(f"Profile error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/profile/{address}/bundle")
async def get_profile_bundle(address: str, network: str = 'btc-testnet'):
    """Combined endpoint: profile + object counts + initial posts in ONE call."""
    is_mainnet = 'mainnet' in network.lower()
    profile_task = get_profile(address, network)
    posts_task = get_profile_posts(address, network, skip=0, limit=5)
    owned_task = fetch_objects_owned(address, is_mainnet)
    created_task = fetch_objects_created_by_address(address, is_mainnet)
    profile, posts, owned_raw, created_raw = await asyncio.gather(
        profile_task, posts_task, owned_task, created_task, return_exceptions=True
    )
    owned_count = len(owned_raw) if isinstance(owned_raw, list) else 0
    created_count = 0
    if isinstance(created_raw, list):
        created_addrs = set()
        for obj in created_raw:
            if isinstance(obj, dict):
                c = obj.get('Creators') or {}
                oa = next(iter(c.keys()), None) if isinstance(c, dict) else None
                if oa:
                    created_addrs.add(oa)
        created_count = len(created_addrs)
    return {
        "profile": profile if not isinstance(profile, Exception) else {"address": address, "urn": address},
        "counts": {"owned": owned_count, "created": created_count},
        "posts": posts if not isinstance(posts, Exception) else {"posts": [], "has_more": False, "total": 0},
    }



@router.get("/profile/{address}/verified_image")
async def check_verified_image_owner(address: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()

        raw = await fetch_profile_by_address(address, is_mainnet)
        if not raw:
            raw = await fetch_profile_by_urn(address, is_mainnet)
        if not raw or not raw.get('Image'):
            return {"verified": False, "reason": "no_profile_image"}

        profile_img = raw.get('Image', '')

        def normalize_ref(ref):
            if not ref:
                return ''
            return ref.lower().replace('ipfs:', '').replace('btc:', '').replace('\\', '/').strip()

        profile_norm = normalize_ref(profile_img)
        if len(profile_norm) < 6:
            return {"verified": False, "reason": "profile_image_too_short"}

        owned = await fetch_objects_owned(address, is_mainnet)
        for obj in (owned if isinstance(owned, list) else []):
            obj_img = normalize_ref(obj.get('Image', ''))
            obj_urn = normalize_ref(obj.get('URN', ''))
            if obj_img and len(obj_img) > 5 and (obj_img == profile_norm or profile_norm in obj_img or obj_img in profile_norm):
                return {"verified": True, "match_type": "owned", "matched_urn": obj.get('URN', '')}
            if obj_urn and len(obj_urn) > 5 and (obj_urn == profile_norm or profile_norm in obj_urn or obj_urn in profile_norm):
                return {"verified": True, "match_type": "owned", "matched_urn": obj.get('URN', '')}

        created = await fetch_objects_by_address(address, is_mainnet)
        for obj in (created if isinstance(created, list) else []):
            obj_img = normalize_ref(obj.get('Image', ''))
            obj_urn = normalize_ref(obj.get('URN', ''))
            if obj_img and len(obj_img) > 5 and (obj_img == profile_norm or profile_norm in obj_img or obj_img in profile_norm):
                return {"verified": True, "match_type": "created", "matched_urn": obj.get('URN', '')}
            if obj_urn and len(obj_urn) > 5 and (obj_urn == profile_norm or profile_norm in obj_urn or obj_urn in profile_norm):
                return {"verified": True, "match_type": "created", "matched_urn": obj.get('URN', '')}

        return {"verified": False, "reason": "no_matching_object"}
    except Exception as e:
        logger.error(f"Verified image check error: {e}")
        return {"verified": False, "reason": "error"}


@router.get("/profile/{address}/posts")
async def get_profile_posts(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 20):
    """Get ORIGINAL posts by this address (not replies to other users)."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        profile = await get_cached_profile(address, is_mainnet)
        all_msgs = await fetch_messages_by_sender(address, is_mainnet)
        known_addrs = set(await get_known_addresses(network))

        seen_txids = set()
        posts = []
        sender_profile_cache = {address: profile}
        for msg in all_msgs:
            txid = msg.get('TransactionId', '')
            if txid and txid in seen_txids:
                continue
            seen_txids.add(txid)
            to_addr = msg.get('ToAddress', '')
            # If ToAddress is a known user, this is a reply — skip it
            if to_addr and to_addr != address and to_addr in known_addrs:
                continue
            # Use the actual sender's profile (not the viewed profile) for @-mentions
            from_addr = msg.get('FromAddress', '')
            if from_addr and from_addr != address:
                if from_addr not in sender_profile_cache:
                    sender_profile_cache[from_addr] = await get_cached_profile(from_addr, is_mainnet)
                msg_profile = sender_profile_cache[from_addr]
            else:
                msg_profile = profile
            posts.append(await format_message(msg, msg_profile, network, is_mainnet))

        posts.sort(key=lambda x: x.get('created_at', ''), reverse=True)

        # Merge locally registered polls by this address
        try:
            from db import poll_registry_col as _prc
            registered = await _prc.find(
                {'creator_address': address, 'network': network},
                {'_id': 0}
            ).to_list(length=50)
            for reg in registered:
                rtxid = reg.get('txid', '')
                if rtxid and rtxid not in seen_txids:
                    poll_profile = profile or {}
                    posts.insert(0, {
                        'transaction_id': rtxid,
                        'content': f"INQ|{reg.get('question', '')}",
                        'from_address': address,
                        'sender_urn': poll_profile.get('URN') or poll_profile.get('urn'),
                        'sender_image': poll_profile.get('Image') or poll_profile.get('image'),
                        'created_at': reg.get('created_at', ''),
                        'is_poll': True,
                        'poll_data': {
                            'txid': rtxid,
                            'question': reg.get('question', ''),
                            'answers': reg.get('answers', []),
                            'own_gate': reg.get('own_gate', []),
                            'cre_gate': reg.get('cre_gate', []),
                            'status': 'active',
                        },
                    })
                    seen_txids.add(rtxid)
        except Exception:
            pass

        total = len(posts)
        page = posts[skip:skip + limit]
        return {"posts": page, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Profile posts error: {e}")
        return {"posts": [], "count": 0, "total": 0, "has_more": False}


@router.get("/profile/{address}/replies")
async def get_profile_replies(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 20):
    """Get posts by this address that are REPLIES to other users."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        profile = await get_cached_profile(address, is_mainnet)
        all_msgs = await fetch_messages_by_sender(address, is_mainnet)
        known_addrs = set(await get_known_addresses(network))

        seen_txids = set()
        replies = []
        for msg in all_msgs:
            txid = msg.get('TransactionId', '')
            if txid and txid in seen_txids:
                continue
            seen_txids.add(txid)
            to_addr = msg.get('ToAddress', '')
            # Only include if ToAddress is a known user (not self, not a keyword)
            if not to_addr or to_addr == address or to_addr not in known_addrs:
                continue
            formatted = await format_message(msg, profile, network, is_mainnet)
            # Add the reply target info
            target_profile = await get_cached_profile(to_addr, is_mainnet)
            formatted['reply_to_address'] = to_addr
            formatted['reply_to_urn'] = target_profile.get('URN') if target_profile else None
            replies.append(formatted)

        replies.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        total = len(replies)
        page = replies[skip:skip + limit]
        return {"replies": page, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Replies error: {e}")
        return {"replies": [], "count": 0, "total": 0, "has_more": False}


@router.get("/profile/{address}/mentions")
async def get_profile_mentions(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 20):
    """Get messages AT this address from OTHER users (mentions)."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        roots = await fetch_public_messages(address, is_mainnet)
        seen_txids = set()
        mentions = []
        for msg in roots:
            from_addr = msg.get('FromAddress', msg.get('SignedBy', ''))
            if from_addr == address:
                continue
            txid = msg.get('TransactionId', '')
            if txid and txid in seen_txids:
                continue
            seen_txids.add(txid)
            sender = await get_cached_profile(from_addr, is_mainnet)
            mentions.append(await format_message(msg, sender, network, is_mainnet))

        mentions.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        total = len(mentions)
        page = mentions[skip:skip + limit]
        return {"mentions": page, "count": len(page), "total": total, "skip": skip, "limit": limit, "has_more": (skip + limit) < total}
    except Exception as e:
        logger.error(f"Mentions error: {e}")
        return {"mentions": [], "count": 0, "total": 0, "has_more": False}


@router.get("/thread/{txid}")
async def get_thread(txid: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        is_testnet = not is_mainnet

        root = await get_root_by_txid(txid, is_mainnet)
        if not root:
            return {"thread": [], "root_txid": txid, "error": "Transaction not found"}

        root_signed_by = root.get('SignedBy', '')
        root_txid = root.get('TransactionId', txid)
        raw_msg = root.get('Message', '')
        content = ' '.join(raw_msg) if isinstance(raw_msg, list) else str(raw_msg)

        root_profile = await get_cached_profile(root_signed_by, is_mainnet)
        original_message = {
            'transaction_id': root_txid,
            'signed_by': root_signed_by,
            'content': content,
            'has_message': bool(content.strip()),
            'block_date': root.get('BlockDate', ''),
            'sender_urn': root_profile.get('URN') if root_profile else None,
            'sender_image': root_profile.get('Image') if root_profile else None,
            'sender_display_name': root_profile.get('DisplayName') if root_profile else None,
            'is_highlighted': True,
            'is_original': True,
            'type': 'message',
        }

        reply_addr = txid_to_reply_address(root_txid, is_testnet)
        reply_roots = await fetch_roots_by_address(reply_addr, is_mainnet)

        replies = []
        for rt in reply_roots:
            rt_signed_by = rt.get('SignedBy', '')
            rt_msg = rt.get('Message', '')
            rt_content = ' '.join(rt_msg) if isinstance(rt_msg, list) else str(rt_msg)
            if not rt_content.strip():
                continue

            rt_profile = await get_cached_profile(rt_signed_by, is_mainnet)
            replies.append({
                'transaction_id': rt.get('TransactionId', ''),
                'signed_by': rt_signed_by,
                'content': rt_content,
                'has_message': True,
                'block_date': rt.get('BlockDate', ''),
                'sender_urn': rt_profile.get('URN') if rt_profile else None,
                'sender_image': rt_profile.get('Image') if rt_profile else None,
                'sender_display_name': rt_profile.get('DisplayName') if rt_profile else None,
                'is_highlighted': False,
                'is_original': False,
                'type': 'reply',
            })

            if rt_profile and rt_profile.get('URN'):
                await register_known_user(
                    rt_signed_by, network, rt_profile.get('URN'),
                    rt_profile.get('Image'), rt_profile.get('DisplayName')
                )

        thread_items = [original_message] + replies

        return {
            "thread": thread_items,
            "root_txid": root_txid,
            "reply_count": len(replies),
            "count": len(thread_items),
        }
    except Exception as e:
        logger.error(f"Thread error: {e}")
        return {"thread": [], "root_txid": txid, "error": str(e)}


@router.get("/reply-count/{txid}")
async def get_reply_count(txid: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        is_testnet = not is_mainnet
        reply_addr = txid_to_reply_address(txid, is_testnet)
        reply_roots = await fetch_roots_by_address(reply_addr, is_mainnet)
        count = sum(1 for r in reply_roots if r.get('Message') and
                    (' '.join(r['Message']) if isinstance(r['Message'], list) else str(r['Message'])).strip())
        return {"txid": txid, "reply_count": count}
    except Exception:
        return {"txid": txid, "reply_count": 0}


@router.get("/conversation/{address}")
async def get_conversation(address: str, network: str = 'btc-testnet', skip: int = 0, limit: int = 20, filter: str = 'messages'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        cache_key = f"{address}:{network}"

        cached = await conversation_cache_col.find_one(
            {'cache_key': cache_key}, {'_id': 0}
        )

        if cached and cached.get('cached_at'):
            cache_age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['cached_at'])).total_seconds()
            if cache_age < 300:
                roots = cached.get('roots', [])
                filtered = _filter_roots(roots, filter)
                total = len(filtered)
                page = filtered[skip:skip + limit]
                return {
                    "roots": page,
                    "address": address,
                    "total": total,
                    "skip": skip,
                    "limit": limit,
                    "has_more": (skip + limit) < total,
                    "from_cache": True,
                }

        raw_roots = await fetch_roots_by_address(address, is_mainnet)
        if not raw_roots:
            return {"roots": [], "address": address, "total": 0, "skip": 0, "limit": limit, "has_more": False}

        formatted = []
        profile_resolve_limit = 100
        raw_roots_reversed = list(reversed(raw_roots))

        for idx, root_item in enumerate(raw_roots_reversed):
            signed_by = root_item.get('SignedBy', '')
            raw_msg = root_item.get('Message', '')
            content = ' '.join(raw_msg) if isinstance(raw_msg, list) else str(raw_msg)
            has_message = bool(content.strip())
            file_data = root_item.get('File', {})
            has_file = bool(file_data) and file_data != {}

            sender_urn = None
            sender_image = None
            sender_display = None
            if idx < profile_resolve_limit and signed_by:
                profile = await get_cached_profile(signed_by, is_mainnet)
                if profile:
                    sender_urn = profile.get('URN')
                    sender_image = profile.get('Image')
                    sender_display = profile.get('DisplayName')

            formatted.append({
                'transaction_id': root_item.get('TransactionId', ''),
                'signed_by': signed_by,
                'content': content,
                'has_message': has_message,
                'has_file': has_file,
                'block_date': root_item.get('BlockDate', ''),
                'sender_urn': sender_urn,
                'sender_image': sender_image,
                'sender_display_name': sender_display,
                'is_from_owner': signed_by == address,
                'type': 'message' if has_message else ('object' if has_file else 'interaction'),
            })

        await conversation_cache_col.update_one(
            {'cache_key': cache_key},
            {'$set': {
                'cache_key': cache_key,
                'address': address,
                'network': network,
                'roots': formatted,
                'total_roots': len(formatted),
                'cached_at': datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True
        )

        filtered = _filter_roots(formatted, filter)
        total = len(filtered)
        page = filtered[skip:skip + limit]

        return {
            "roots": page,
            "address": address,
            "total": total,
            "skip": skip,
            "limit": limit,
            "has_more": (skip + limit) < total,
            "from_cache": False,
        }

    except Exception as e:
        logger.error(f"Conversation error: {e}")
        return {"roots": [], "address": address, "total": 0, "error": str(e), "has_more": False}


def _filter_roots(roots: list, filter_type: str) -> list:
    if filter_type == 'messages':
        return [r for r in roots if r.get('has_message')]
    elif filter_type == 'interactions':
        return [r for r in roots if not r.get('has_message')]
    return roots


@router.post("/search")
@limiter.limit("15/minute")
async def search(request: Request, query: SearchQuery):
    try:
        term = query.query.strip()
        network = query.network
        is_mainnet = 'mainnet' in network.lower()
        results = {"profiles": [], "objects": [], "posts": [], "query": term}

        # Strip # prefix for keyword search — both "#Epstein" and "Epstein" search the same way
        keyword = term[1:] if term.startswith('#') else term
        username = term.lstrip('@')

        # ── Parallel fetches: profiles, objects, and keyword posts ──

        async def fetch_profiles():
            """Find matching profiles via URN lookup, known_users, and keyword search."""
            profiles = []
            seen_addrs = set()

            # Try exact URN match (case variants)
            for variant in [username, username.lower(), username.title(), username.upper()]:
                profile_raw = await fetch_profile_by_urn(variant, is_mainnet)
                if profile_raw and profile_raw.get('URN'):
                    p = format_profile(profile_raw, network)
                    profiles.append(p)
                    if p.get('address'):
                        seen_addrs.add(p['address'])
                    creators = profile_raw.get('Creators') or []
                    if creators:
                        await register_known_user(creators[0], network, profile_raw.get('URN'), profile_raw.get('Image'), profile_raw.get('DisplayName'))
                    break

            # Search local known_users (case-insensitive)
            try:
                regex = {"$regex": f"^{username}$", "$options": "i"}
                async for u in known_users_col.find({"urn": regex, "network": network}, {"_id": 0}):
                    addr = u.get('address', '')
                    if addr and addr not in seen_addrs:
                        p = await fetch_profile_by_address(addr, is_mainnet)
                        if p and p.get('URN'):
                            profiles.append(format_profile(p, network))
                            seen_addrs.add(addr)
            except Exception:
                pass

            # Keyword-address lookup
            addresses = await search_keyword(keyword, is_mainnet)
            for addr in addresses:
                if addr in seen_addrs:
                    continue
                p = await fetch_profile_by_address(addr, is_mainnet)
                if p and p.get('URN'):
                    profiles.append(format_profile(p, network))
                    seen_addrs.add(addr)
                    await register_known_user(addr, network, p.get('URN'), p.get('Image'), p.get('DisplayName'))

            # Also search known_users with partial match
            try:
                partial = {"$regex": keyword, "$options": "i"}
                async for u in known_users_col.find({"urn": partial, "network": network}, {"_id": 0}).limit(10):
                    addr = u.get('address', '')
                    if addr and addr not in seen_addrs:
                        profiles.append({
                            "address": addr,
                            "urn": u.get('urn', ''),
                            "display_name": u.get('display_name', ''),
                            "image": u.get('image'),
                            "bio": '',
                        })
                        seen_addrs.add(addr)
            except Exception:
                pass

            return profiles

        async def fetch_objects_results():
            """Find matching objects via URN lookup and keyword search."""
            objects = []
            seen_urns = set()

            # Exact URN lookup
            try:
                urn_obj = await p2fk_get(f"GetObjectByURN/{term}", is_mainnet)
                if isinstance(urn_obj, dict) and urn_obj.get('URN'):
                    objects.append(urn_obj)
                    seen_urns.add(urn_obj['URN'])
            except Exception:
                pass

            # Keyword search
            obj_data = await p2fk_get(f"GetObjectsByKeyword/{keyword}", is_mainnet)
            if isinstance(obj_data, list):
                for obj in obj_data[:40]:
                    urn_key = obj.get('URN', '')
                    if urn_key and urn_key in seen_urns:
                        continue
                    if urn_key:
                        seen_urns.add(urn_key)
                    objects.append(obj)
                    if len(objects) >= 20:
                        break

            # Address-based object search
            if len(term) > 25 and term[0] in '1mn':
                addr_objects = await fetch_objects_by_address(term, is_mainnet)
                if addr_objects:
                    existing_txids = {o.get('TransactionId') for o in objects}
                    for obj in addr_objects[:20]:
                        if obj.get('TransactionId') not in existing_txids:
                            objects.append(obj)

            return objects

        async def fetch_keyword_posts():
            """Fetch posts at the keyword address using GetPublicMessagesByAddress.
            This is the canonical P2FK API for hashtag/keyword search."""
            posts = []
            seen_txids = set()

            async def process_messages(messages):
                for msg_raw in messages:
                    txid = msg_raw.get('TransactionId', '')
                    if txid in seen_txids:
                        continue
                    seen_txids.add(txid)
                    from_addr = msg_raw.get('SignedBy', msg_raw.get('FromAddress', ''))
                    sender_profile = await get_cached_profile(from_addr, is_mainnet) if from_addr else None
                    # Normalize fields
                    if 'FromAddress' not in msg_raw:
                        msg_raw['FromAddress'] = from_addr
                    msg = await format_message(msg_raw, sender_profile, network, is_mainnet)
                    if msg:
                        posts.append(msg)

            # Primary keyword search — fetch up to 200
            messages = await fetch_keyword_messages(keyword, is_mainnet, skip=0, qty=200)
            await process_messages(messages)

            # Also try case variants
            for variant in [keyword.lower(), keyword.upper(), keyword.title()]:
                if variant == keyword:
                    continue
                extra = await fetch_keyword_messages(variant, is_mainnet, skip=0, qty=100)
                await process_messages(extra)

            return posts

        # Run all searches in parallel
        profiles_res, objects_res, posts_res = await asyncio.gather(
            fetch_profiles(),
            fetch_objects_results(),
            fetch_keyword_posts(),
            return_exceptions=True,
        )

        results["profiles"] = profiles_res if not isinstance(profiles_res, Exception) else []
        results["objects"] = objects_res if not isinstance(objects_res, Exception) else []
        results["posts"] = posts_res if not isinstance(posts_res, Exception) else []

        return results
    except Exception as e:
        logger.error(f"Search error: {e}")
        return {"profiles": [], "objects": [], "posts": [], "error": str(e)}


@router.get("/resolve/{address}")
async def resolve_address(address: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        raw = await fetch_profile_by_address(address, is_mainnet)
        if raw and raw.get('URN'):
            return {"address": address, "urn": raw.get('URN'), "image": raw.get('Image'), "display_name": raw.get('DisplayName'), "found": True}
        return {"address": address, "urn": f"{address[:8]}...{address[-4:]}", "image": None, "display_name": None, "found": False}
    except Exception as e:
        logger.error(f"Resolve error: {e}")
        return {"address": address, "urn": address[:12], "image": None, "found": False}


@router.post("/resolve/batch")
async def resolve_batch(req: BatchResolveRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()

        async def _resolve_one(addr):
            raw = await fetch_profile_by_address(addr, is_mainnet)
            if raw and raw.get('URN'):
                return addr, {"address": addr, "urn": raw.get('URN'), "image": raw.get('Image'), "display_name": raw.get('DisplayName'), "found": True}
            return addr, {"address": addr, "urn": f"{addr[:8]}...{addr[-4:]}", "image": None, "display_name": None, "found": False}

        pairs = await asyncio.gather(*[_resolve_one(a) for a in req.addresses[:20]])
        return {addr: data for addr, data in pairs}
    except Exception as e:
        logger.error(f"Batch resolve error: {e}")
        return {}


@router.get("/known-users/{network}")
async def get_known_users(network: str):
    try:
        users = []
        cursor = known_users_col.find({'network': network, 'urn': {'$ne': None}}, {'_id': 0})
        async for doc in cursor:
            users.append(doc)
        return {"users": users, "count": len(users)}
    except Exception as e:
        logger.error(f"Known users error: {e}")
        return {"users": [], "count": 0}


@router.get("/known-users/{network}/ranked")
async def get_known_users_ranked(network: str):
    try:
        users = []
        cursor = known_users_col.find({'network': network, 'urn': {'$ne': None}}, {'_id': 0})
        async for doc in cursor:
            users.append(doc)

        ranked = []
        for user in users:
            addr = user.get('address', '')
            cache_key = f"{addr}:{network}"

            cached = await conversation_cache_col.find_one(
                {'cache_key': cache_key},
                {'_id': 0, 'total_roots': 1, 'roots': 1, 'cached_at': 1}
            )

            total_activity = 0
            message_count = 0
            interaction_count = 0
            last_active = user.get('updated_at', '')

            if cached:
                total_activity = cached.get('total_roots', 0)
                roots = cached.get('roots', [])
                message_count = sum(1 for r in roots if r.get('has_message'))
                interaction_count = total_activity - message_count
                if roots:
                    last_active = roots[0].get('block_date', last_active)

            ranked.append({
                'address': addr,
                'urn': user.get('urn'),
                'display_name': user.get('display_name'),
                'image': user.get('image'),
                'total_activity': total_activity,
                'message_count': message_count,
                'interaction_count': interaction_count,
                'last_active': last_active,
            })

        ranked.sort(key=lambda x: (x['total_activity'], x['message_count']), reverse=True)

        return {"users": ranked, "count": len(ranked), "network": network}
    except Exception as e:
        logger.error(f"Ranked users error: {e}")
        return {"users": [], "count": 0, "error": str(e)}


@router.get("/profile/keys/{address_or_urn}")
async def get_profile_keys(address_or_urn: str, network: str = 'btc-testnet'):
    """Check if a user has published PKX/PKY encryption keys."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        raw = None
        if len(address_or_urn) > 20:
            raw = await fetch_profile_by_address(address_or_urn, is_mainnet)
        else:
            raw = await fetch_profile_by_urn(address_or_urn, is_mainnet)
        if raw:
            pkx = raw.get('PKX', '') or ''
            pky = raw.get('PKY', '') or ''
            creators = raw.get('Creators') or []
            if pkx and pky:
                return {
                    "has_keys": True,
                    "pkx": pkx,
                    "pky": pky,
                    "urn": raw.get('URN', ''),
                    "address": creators[0] if creators else '',
                }

        # Fallback to local known_users cache for PKX/PKY
        addr = address_or_urn if len(address_or_urn) > 20 else None
        if not addr and raw:
            creators = raw.get('Creators') or []
            addr = creators[0] if creators else None
        if addr:
            known = await known_users_col.find_one({'address': addr, 'network': network}, {'_id': 0})
            if known and known.get('pkx') and known.get('pky'):
                return {
                    "has_keys": True,
                    "pkx": known['pkx'],
                    "pky": known['pky'],
                    "urn": known.get('urn', ''),
                    "address": addr,
                }

        return {"has_keys": False, "pkx": "", "pky": "", "urn": "", "address": ""}
    except Exception as e:
        logger.error(f"Profile keys error: {e}")
        return {"has_keys": False, "pkx": "", "pky": "", "error": str(e)}



@router.post("/profile/keys/store")
async def store_profile_keys(request: dict):
    """Store published PKX/PKY locally so they survive P2FK indexer downtime."""
    address = request.get('address', '')
    pkx = request.get('pkx', '')
    pky = request.get('pky', '')
    network = request.get('network', 'btc-testnet')
    if not address or not pkx or not pky:
        return {"ok": False, "error": "Missing address, pkx, or pky"}
    await known_users_col.update_one(
        {'address': address, 'network': network},
        {'$set': {'pkx': pkx, 'pky': pky}},
        upsert=True
    )
    return {"ok": True}


@router.post("/profile/keys/batch")
async def get_profile_keys_batch(request: dict, network: str = 'btc-testnet'):
    """Batch check PKX/PKY for a list of addresses. Returns full key data per address."""
    try:
        addresses = request.get('addresses', [])
        if not addresses or len(addresses) > 100:
            return {"keys": {}}
        is_mainnet = 'mainnet' in network.lower()
        results = {}
        tasks = []
        for addr in addresses:
            tasks.append(fetch_profile_by_address(addr, is_mainnet))
        profiles = await asyncio.gather(*tasks, return_exceptions=True)
        for addr, prof in zip(addresses, profiles):
            pkx, pky = '', ''
            if not isinstance(prof, Exception) and prof:
                pkx = prof.get('PKX', '') or ''
                pky = prof.get('PKY', '') or ''
            if not pkx or not pky:
                known = await known_users_col.find_one({'address': addr, 'network': network}, {'_id': 0})
                if known and known.get('pkx') and known.get('pky'):
                    pkx, pky = known['pkx'], known['pky']
            results[addr] = {"has_keys": bool(pkx and pky), "pkx": pkx, "pky": pky}
        return {"keys": results}
    except Exception as e:
        logger.error(f"Batch keys error: {e}")
        return {"keys": {}}


@router.get("/collection/{urn}")
async def get_collection_detail(urn: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        is_testnet = not is_mainnet

        collection = await fetch_profile_by_urn(urn, is_mainnet)
        if not collection:
            return {"error": "Collection not found", "urn": urn}

        pkx = collection.get('PKX', '')
        pky = collection.get('PKY', '')
        if not pkx or not pky:
            return {"error": "Collection has no key pair", "urn": urn}

        collection_address = derive_address_from_pkxy(pkx, pky, testnet=is_testnet)

        items = await fetch_objects_created_by_address(collection_address, is_mainnet)
        formatted = [format_object_for_api(obj) for obj in items]

        creator_addresses = collection.get('Creators', [])
        if isinstance(creator_addresses, dict):
            creator_addresses = list(creator_addresses.keys())
        creator_profile = None

        if formatted:
            creator_counts = {}
            for obj in formatted:
                obj_creators = obj.get('creators', [])
                for c in obj_creators:
                    addr = c.get('address', '') if isinstance(c, dict) else c
                    if addr and addr != collection_address:
                        creator_counts[addr] = creator_counts.get(addr, 0) + 1
            if creator_counts:
                likely_creator = max(creator_counts, key=creator_counts.get)
                cp = await fetch_profile_by_address(likely_creator, is_mainnet)
                if cp and cp.get('URN'):
                    creator_profile = {
                        "urn": cp.get('URN', ''),
                        "address": likely_creator,
                        "image": cp.get('Image', ''),
                    }

        if not creator_profile:
            for addr in creator_addresses:
                if addr == collection_address:
                    continue
                cp = await fetch_profile_by_address(addr, is_mainnet)
                if cp and cp.get('URN'):
                    creator_profile = {
                        "urn": cp.get('URN', ''),
                        "address": addr,
                        "image": cp.get('Image', ''),
                    }
                    break

        return {
            "collection": {
                "urn": collection.get('URN', urn),
                "bio": collection.get('Bio', ''),
                "image": collection.get('Image', ''),
                "address": collection_address,
                "created_date": collection.get('CreatedDate', ''),
                "change_date": collection.get('ChangeDate', ''),
                "url": collection.get('URL'),
            },
            "creator": creator_profile,
            "objects": formatted,
            "total": len(formatted),
        }
    except Exception as e:
        logger.error(f"Collection detail error: {e}")
        return {"error": str(e), "urn": urn}



@router.get("/collection-by-address/{address}")
async def get_collection_by_address(address: str, network: str = 'btc-testnet'):
    """Object-based collection detail: fetch all objects created by an address
    that has no profile. Uses object metadata (urn, dsc, img, uri, created_date)."""
    try:
        is_mainnet = 'mainnet' in network.lower()

        items = await fetch_objects_created_by_address(address, is_mainnet)
        if not items:
            return {"error": "No objects found at this address", "address": address}

        formatted = [format_object_for_api(obj) for obj in items]
        first_obj = items[0] if items else {}

        # Try to find the most common co-creator across these objects
        creator_profile = None
        creator_counts = {}
        for obj in formatted:
            obj_creators = obj.get('creators', [])
            for c in obj_creators:
                addr = c.get('address', '') if isinstance(c, dict) else c
                if addr and addr != address:
                    creator_counts[addr] = creator_counts.get(addr, 0) + 1
        if creator_counts:
            likely_creator = max(creator_counts, key=creator_counts.get)
            cp = await fetch_profile_by_address(likely_creator, is_mainnet)
            if cp and cp.get('URN'):
                creator_profile = {
                    "urn": cp.get('URN', ''),
                    "address": likely_creator,
                    "image": cp.get('Image', ''),
                }

        return {
            "collection": {
                "type": "object",
                "urn": first_obj.get('URN', address),
                "description": first_obj.get('Description', ''),
                "image": first_obj.get('Image', ''),
                "uri": first_obj.get('URI', ''),
                "address": address,
                "created_date": first_obj.get('CreatedDate', ''),
            },
            "creator": creator_profile,
            "objects": formatted,
            "total": len(formatted),
        }
    except Exception as e:
        logger.error(f"Collection by address error: {e}")
        return {"error": str(e), "address": address}


# ─── P2FK Proxy Endpoints ───
# Route browser-to-p2fk.io calls through the backend to avoid CORS issues
# (p2fk.io sends duplicate Access-Control-Allow-Origin headers which browsers reject)

@router.get("/p2fk/search/objects")
async def proxy_search_objects(searchString: str = '', qty: int = 20, skip: int = 0, network: str = 'btc-testnet'):
    is_mainnet = 'mainnet' in network.lower()
    data = await p2fk_get("GetKnownObjectsBySearchString", is_mainnet, {
        "searchString": searchString, "qty": str(qty), "skip": str(skip)
    })
    return data if data is not None else []


@router.get("/p2fk/search/profiles")
async def proxy_search_profiles(searchString: str = '', qty: int = 60, network: str = 'btc-testnet'):
    is_mainnet = 'mainnet' in network.lower()
    data = await p2fk_get("GetKnownProfilesBySearchString", is_mainnet, {
        "searchString": searchString, "qty": str(qty)
    })
    return data if data is not None else []


@router.get("/p2fk/search/roots")
async def proxy_search_roots(searchString: str = '', qty: int = 60, network: str = 'btc-testnet'):
    is_mainnet = 'mainnet' in network.lower()
    data = await p2fk_get("GetKnownRootsBySearchString", is_mainnet, {
        "searchString": searchString, "qty": str(qty)
    })
    return data if data is not None else []


@router.get("/p2fk/object-by-address/{address}")
async def proxy_object_by_address(address: str, network: str = 'btc-testnet'):
    is_mainnet = 'mainnet' in network.lower()
    data = await p2fk_get(f"GetObjectByAddress/{address}", is_mainnet)
    return data if data is not None else []


@router.get("/urn/verify/{urn}")
async def verify_urn(urn: str, network: str = 'btc-testnet'):
    """Check if a URN has multiple claimants. Returns the official (earliest) one.
    Impersonation protection: 'first claim wins'."""
    try:
        is_mainnet = 'mainnet' in network.lower()

        # Find all addresses claiming this URN in known_users
        cursor = known_users_col.find({"data": {"$regex": f'"urn"\\s*:\\s*"{urn}"'}})
        addresses = set()
        async for doc in cursor:
            data = doc.get("data", {})
            if isinstance(data, str):
                import json
                data = json.loads(data)
            if data.get("urn") == urn or data.get("URN") == urn:
                addr = data.get("address", data.get("Address", ""))
                if addr:
                    addresses.add(addr)

        # If no known_users, try p2fk.io keyword lookup
        if not addresses:
            result = await p2fk_get(f"GetPublicAddressByKeyword/{urn}", is_mainnet)
            if result:
                addr = result if isinstance(result, str) else result.get("Address", "")
                if addr:
                    addresses.add(addr)

        if len(addresses) <= 1:
            official = list(addresses)[0] if addresses else None
            return {
                "urn": urn,
                "official_address": official,
                "claimants": [{"address": official, "is_official": True}] if official else [],
                "impersonation_detected": False,
            }

        # Multiple claimants — resolve CreatedDate for each
        claimants = []
        for addr in addresses:
            profile = await p2fk_get(f"GetProfileByAddress/{addr}", is_mainnet)
            created = None
            if profile and isinstance(profile, dict):
                created = profile.get("CreatedDate", profile.get("createdDate"))
            claimants.append({"address": addr, "created_date": created})

        # Sort by created_date (earliest first). None dates go last.
        claimants.sort(key=lambda c: c.get("created_date") or "9999-12-31")
        official = claimants[0]["address"]

        for c in claimants:
            c["is_official"] = c["address"] == official

        return {
            "urn": urn,
            "official_address": official,
            "claimants": claimants,
            "impersonation_detected": True,
        }
    except Exception as e:
        logger.error(f"URN verify error for {urn}: {e}")
        return {
            "urn": urn,
            "official_address": None,
            "claimants": [],
            "impersonation_detected": False,
            "error": str(e),
        }
