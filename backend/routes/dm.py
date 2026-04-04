"""
Private messaging routes.
The backend fetches PM txids from p2fk.io using GetPrivateMessagesByAddress,
resolves root data for keyword-based partner filtering, and returns paginated results.
Decryption happens client-side.
"""
import logging
import asyncio
import base64
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from utils.helpers import (
    fetch_private_messages_by_address, fetch_roots_by_address, get_root_by_txid,
    fetch_root_file_bytes,
    fetch_profile_by_address, format_profile
)
from db import first_seen_col, dm_clear_col

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.get("/dm/threads/{address}")
async def get_dm_threads(address: str, network: str = "btc-testnet"):
    """
    Get all unique DM conversation partners for a given address.
    Uses GetPrivateMessagesByAddress to fetch PM txids, then resolves roots.
    """
    is_mainnet = "mainnet" in network.lower()

    # Fetch PM txids
    pms = await fetch_private_messages_by_address(address, is_mainnet, skip=0, qty=200)
    if not pms:
        return {"threads": []}

    # Resolve roots in parallel (batches of 10 to avoid rate limits)
    threads = {}
    for i in range(0, len(pms), 10):
        batch = pms[i:i+10]
        tasks = [get_root_by_txid(pm["TransactionId"], is_mainnet) for pm in batch if pm.get("TransactionId")]
        roots = await asyncio.gather(*tasks, return_exceptions=True)

        for pm, root in zip(batch, roots):
            if isinstance(root, Exception) or not isinstance(root, dict):
                continue
            # Only SEC (encrypted) roots
            if "SEC" not in (root.get("File") or {}):
                msg_list = root.get("Message") or []
                if not (msg_list and isinstance(msg_list[0], str) and msg_list[0].startswith("SEC")):
                    continue

            # Use SignedBy as the authoritative sender address.
            # The Keyword field contains keyword-derived addresses (hashes), not real users.
            signed_by = root.get("SignedBy", "")
            sender_addr = signed_by if signed_by and signed_by != address else None

            # Fallback: if SignedBy is us (self-message / vault), mark as vault
            if not sender_addr:
                sender_addr = "__vault__"

            if sender_addr not in threads:
                threads[sender_addr] = {
                    "address": sender_addr,
                    "message_count": 0,
                    "last_date": "",
                    "profile": None
                }
            threads[sender_addr]["message_count"] += 1
            block_date = pm.get("BlockDate", "")
            if block_date > threads[sender_addr]["last_date"]:
                threads[sender_addr]["last_date"] = block_date

    # Resolve profiles
    result = []
    for addr, thread in threads.items():
        if addr != "__vault__":
            try:
                profile_raw = await fetch_profile_by_address(addr, is_mainnet)
                if profile_raw and profile_raw.get("URN"):
                    thread["profile"] = format_profile(profile_raw, network)
            except Exception:
                pass
        result.append(thread)

    result.sort(key=lambda t: t["last_date"], reverse=True)
    return {"threads": result}


@router.get("/dm/messages/{address}")
async def get_dm_messages(
    address: str,
    network: str = "btc-testnet",
    partner: str = Query(default=None, description="Filter by conversation partner address"),
    skip: int = 0,
    limit: int = 20,
    since: str = Query(default=None, description="ISO timestamp — only return messages newer than this"),
):
    """
    Get encrypted private messages for a conversation.
    Uses GetPrivateMessagesByAddress for efficient pre-filtered PM lookup.
    Returns raw encrypted bytes as base64 — decryption happens client-side.
    """
    is_mainnet = "mainnet" in network.lower()

    # Check cleared_before for this conversation
    cleared_before = None
    if partner:
        clear_doc = await dm_clear_col.find_one(
            {"user_address": address, "partner_address": partner, "network": network},
            {"_id": 0}
        )
        if clear_doc and clear_doc.get("cleared_before"):
            cleared_before = clear_doc["cleared_before"]

    # Effective cutoff: max of `since` and `cleared_before`
    effective_cutoff = None
    candidates = [c for c in [since, cleared_before] if c]
    if candidates:
        effective_cutoff = max(candidates)

    # Fetch PM txids from BOTH sides of the conversation
    # My address: PMs sent TO me
    # Partner address: PMs sent TO partner (includes ones I sent)
    fetch_qty = limit + skip + 20  # Fetch extra to account for filtering
    my_pms = await fetch_private_messages_by_address(address, is_mainnet, skip=0, qty=fetch_qty)
    partner_pms = []
    if partner:
        partner_pms = await fetch_private_messages_by_address(partner, is_mainnet, skip=0, qty=fetch_qty)

    # Combine and dedup by TransactionId
    all_pms = []
    seen_txids = set()
    for pm in my_pms + partner_pms:
        txid = pm.get("TransactionId", "")
        if txid and txid not in seen_txids:
            seen_txids.add(txid)
            # Apply cutoff filter early
            block_date = pm.get("BlockDate", "")
            if effective_cutoff and block_date and block_date <= effective_cutoff:
                continue
            all_pms.append(pm)

    # Sort by BlockDate descending (newest first) for pagination
    all_pms.sort(key=lambda p: p.get("BlockDate", ""), reverse=True)

    if not all_pms:
        return {
            "messages": [],
            "total": 0,
            "has_more": False,
            "server_timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # Resolve roots in parallel to get Keywords for partner filtering
    # and to get SEC file info
    messages = []
    pm_batch = all_pms[:fetch_qty]  # Cap to prevent excessive API calls

    for i in range(0, len(pm_batch), 10):
        batch = pm_batch[i:i+10]
        tasks = [get_root_by_txid(pm["TransactionId"], is_mainnet) for pm in batch]
        roots = await asyncio.gather(*tasks, return_exceptions=True)

        for pm, root in zip(batch, roots):
            if isinstance(root, Exception) or not isinstance(root, dict):
                continue

            txid = pm.get("TransactionId", "")

            # Verify it's a SEC (encrypted) message
            is_file_sec = "SEC" in (root.get("File") or {})
            is_msg_sec = False
            msg_list = root.get("Message") or []
            if msg_list and isinstance(msg_list[0], str) and msg_list[0].startswith("SEC"):
                is_msg_sec = True
            if not is_file_sec and not is_msg_sec:
                continue

            # Filter by conversation partner using Keywords
            keywords = root.get("Keyword") or {}
            kw_keys = list(keywords.keys())
            if partner:
                is_vault = partner == address
                if is_vault:
                    sender_addr = kw_keys[-1] if kw_keys else None
                    if sender_addr != address:
                        continue
                elif partner not in kw_keys:
                    continue

            # Determine sender
            my_in_kw = address in kw_keys
            partner_in_kw = (partner in kw_keys) if partner else False
            if my_in_kw and partner_in_kw:
                sender_addr = kw_keys[-1]
            elif my_in_kw and not partner_in_kw:
                sender_addr = address
            elif partner_in_kw and not my_in_kw:
                sender_addr = partner
            else:
                sender_addr = kw_keys[-1] if kw_keys else ""

            # Extract embedded SEC data if present
            encrypted_b64 = None
            file_size = 0
            if is_msg_sec:
                msg_text = msg_list[0]
                try:
                    raw_bytes = msg_text.encode('latin-1')
                except Exception:
                    raw_bytes = msg_text.encode('utf-8', errors='surrogateescape')
                encrypted_b64 = base64.b64encode(raw_bytes).decode()
                file_size = len(raw_bytes)
            else:
                file_size = root.get("File", {}).get("SEC", 0)

            # Apply first_seen timestamp
            first_seen = ""
            try:
                fs_doc = await first_seen_col.find_one({"txid": txid}, {"_id": 0})
                if fs_doc:
                    first_seen = fs_doc.get("first_seen", "")
            except Exception:
                pass

            messages.append({
                "txid": txid,
                "sender_address": sender_addr,
                "block_date": pm.get("BlockDate", ""),
                "first_seen": first_seen or pm.get("BlockDate", ""),
                "encrypted_data": encrypted_b64,
                "file_size": file_size,
            })

    # Sort by timestamp (oldest first for chat display)
    messages.sort(key=lambda m: (m.get("first_seen") or m.get("block_date", ""), m.get("block_date", "")))

    # Paginate
    total = len(messages)
    page = messages[skip:skip + limit]

    return {
        "messages": page,
        "total": total,
        "has_more": skip + limit < total,
        "server_timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/dm/vault/{address}")
async def get_vault_entries(
    address: str,
    network: str = "btc-testnet",
    skip: int = 0,
    limit: int = 50,
):
    """
    Fetch vault entries (encrypted self-messages) from the blockchain.
    Uses GetRootsByAddress to find ALL roots, then filters for SEC roots.
    GetRootsByAddress already returns the full root data including Message/File.
    """
    is_mainnet = "mainnet" in network.lower()

    # GetRootsByAddress returns FULL root data (Message, File, Keyword, SignedBy...)
    all_roots = await fetch_roots_by_address(address, is_mainnet, qty=200)
    if not all_roots:
        return {"messages": [], "total": 0, "has_more": False}

    # Filter for SEC roots — check Message or File for SEC content
    vault_entries = []
    for root in all_roots:
        txid = root.get("TransactionId", "")
        if not txid:
            continue

        # Check for SEC in Message
        is_msg_sec = False
        msg_list = root.get("Message") or []
        if isinstance(msg_list, list) and msg_list and isinstance(msg_list[0], str) and "SEC" in msg_list[0][:10]:
            is_msg_sec = True

        # Check for SEC in File dict
        is_file_sec = isinstance(root.get("File"), dict) and "SEC" in (root.get("File") or {})

        if not is_msg_sec and not is_file_sec:
            continue

        # Estimate file size from available metadata
        file_size = 0
        if is_file_sec:
            file_size = root.get("File", {}).get("SEC", 0)

        # Don't include encrypted_data from JSON — binary data gets corrupted
        # by p2fk.io's JSON serialization. Frontend fetches raw SEC via /dm/sec-file/{txid}
        block_date = root.get("BlockDate", "")
        signed_by = root.get("SignedBy", "")

        vault_entries.append({
            "txid": txid,
            "sender_address": signed_by,
            "block_date": block_date,
            "first_seen": block_date,
            "file_size": file_size,
            "confirmed": True,
        })

    # Sort newest first
    vault_entries.sort(key=lambda e: e.get("block_date", ""), reverse=True)

    total = len(vault_entries)
    page = vault_entries[skip:skip + limit]

    return {
        "messages": page,
        "total": total,
        "has_more": skip + limit < total,
    }


@router.get("/dm/sec-file/{txid}")
async def get_sec_file(txid: str, network: str = "btc-testnet"):
    """
    Fetch raw SEC (encrypted) file bytes for a specific transaction.
    Reconstructs binary data directly from blockchain P2FK addresses,
    avoiding JSON encoding corruption of binary data.
    Returns base64-encoded bytes for client-side decryption.
    """
    raw_bytes = await fetch_root_file_bytes(txid, "SEC", network=network)
    if not raw_bytes:
        raise HTTPException(status_code=404, detail="SEC file not found")
    return {
        "txid": txid,
        "encrypted_data": base64.b64encode(raw_bytes).decode(),
        "size": len(raw_bytes),
    }


class ClearChatRequest(BaseModel):
    partner: str
    network: str = "btc-testnet"


@router.post("/dm/clear/{address}")
async def clear_dm_chat(address: str, body: ClearChatRequest):
    """
    Mark a DM conversation as cleared from a specific timestamp.
    Messages older than cleared_before will be excluded from future fetches.
    """
    now = datetime.now(timezone.utc).isoformat()
    await dm_clear_col.update_one(
        {"user_address": address, "partner_address": body.partner, "network": body.network},
        {"$set": {"cleared_before": now, "updated_at": now}},
        upsert=True,
    )
    return {"ok": True, "cleared_before": now}



@router.get("/pm/messages/{address}")
async def get_pm_messages(
    address: str,
    network: str = "btc-testnet",
    partner: str = Query(default=None, description="Filter by conversation partner address"),
    skip: int = 0,
    limit: int = 50,
):
    """
    Get regular (non-encrypted) direct messages between two users.
    Uses the Message field from P2FK roots (not File keys).
    Filters out non-message roots (PRO, OBJ, SEC, LST, BRN, BUY, GIV).
    """
    is_mainnet = "mainnet" in network.lower()
    # Root types that are NOT plain messages
    SKIP_TYPES = {"SEC", "PRO", "OBJ", "LST", "BRN", "BUY", "GIV"}

    def extract_message(root):
        """Extract clean message text from a P2FK root."""
        file_info = root.get("File") or {}
        # Skip non-message roots
        if any(t in file_info for t in SKIP_TYPES):
            return None
        # Message content is in the Message array
        msg_list = root.get("Message") or []
        if not msg_list or not isinstance(msg_list, list):
            return None
        raw = msg_list[0] if msg_list else ""
        if not raw or not isinstance(raw, str):
            return None
        # Strip salt suffix <<-nnnnn>>
        import re
        clean = re.sub(r'<<-\d+>>', '', raw).strip()
        # Skip empty content or bare reactions
        if not clean or clean.startswith('<<-') or clean == '<<' or len(clean) < 2:
            return None
        # Skip feed replies that mention @username (these are feed posts, not DMs)
        if clean.startswith('@'):
            return None
        # Skip encrypted data that leaked into Message field (should only show in E2E view)
        if clean.startswith('SEC'):
            return None
        # Skip IPFS media content (walkie-talkie audio, images posted to feed)
        if '<<IPFS:' in clean:
            return None
        return clean

    messages = []

    # Fetch roots from BOTH addresses and merge
    my_roots = await fetch_roots_by_address(address, is_mainnet, skip=0, qty=200)
    partner_roots = []
    if partner:
        partner_roots = await fetch_roots_by_address(partner, is_mainnet, skip=0, qty=200)

    # Combine and deduplicate by TransactionId
    all_roots = my_roots + partner_roots
    seen_txids = set()
    unique_roots = []
    for r in all_roots:
        txid = r.get("TransactionId", "")
        if txid and txid not in seen_txids:
            seen_txids.add(txid)
            unique_roots.append(r)

    for root in unique_roots:
        content = extract_message(root)
        if content is None:
            continue

        keywords = root.get("Keyword") or {}
        kw_keys = list(keywords.keys())
        if not kw_keys:
            continue

        # Determine if this message belongs to this conversation
        my_in_kw = address in kw_keys
        partner_in_kw = partner in kw_keys if partner else False

        if partner:
            # Must involve at least one of the two parties
            if not my_in_kw and not partner_in_kw:
                continue
            # Skip feed broadcasts (more than 2 keywords, unless both parties match exactly)
            if len(kw_keys) > 2:
                continue
            # If exactly 2 keywords, both must be the conversation participants
            if len(kw_keys) == 2 and not (my_in_kw and partner_in_kw):
                continue

        # Determine sender: in P2FK DMs, the convention is [recipient, sender]
        # But we can't rely on order. Instead, use logic:
        # If I'm the only keyword, I'm the sender (self-addressed message for this conversation)
        # If both are keywords, the sender is whichever address appears last
        # If partner is the only keyword, I must be the sender (fetched from partner's roots)
        if my_in_kw and partner_in_kw:
            # Both in keywords — sender is last keyword (P2FK convention)
            sender_addr = kw_keys[-1]
        elif my_in_kw and not partner_in_kw:
            # Only my address — I'm the sender
            sender_addr = address
        elif partner_in_kw and not my_in_kw:
            # Only partner's address — partner is the sender
            sender_addr = partner
        else:
            continue

        is_incoming = sender_addr != address

        messages.append({
            "txid": root.get("TransactionId", ""),
            "sender_address": sender_addr,
            "content": content,
            "block_date": root.get("BlockDate", ""),
            "is_incoming": is_incoming,
        })

    # Apply first_seen timestamps before sorting
    await _apply_first_seen_dm(messages)

    # Sort chronologically: first_seen primary, block_date fallback
    messages.sort(key=lambda m: (m.get("first_seen", m.get("block_date", "")), m.get("block_date", "")))
    total = len(messages)
    page = messages[skip:skip + limit]

    return {
        "messages": page,
        "total": total,
        "has_more": skip + limit < total,
    }


async def _apply_first_seen_dm(messages):
    """Look up first_seen timestamps for DM messages."""
    from datetime import datetime, timezone
    txids = [m['txid'] for m in messages if m.get('txid')]
    if not txids:
        return
    existing = {}
    async for doc in first_seen_col.find({'txid': {'$in': txids}}, {'_id': 0}):
        existing[doc['txid']] = doc['first_seen']
    now = datetime.now(timezone.utc).isoformat()
    new_docs = []
    for msg in messages:
        txid = msg.get('txid')
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
