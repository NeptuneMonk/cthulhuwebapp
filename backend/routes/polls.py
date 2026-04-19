"""Poll/INQ routes: Fetch and list on-chain polls (INQ class) from P2FK API."""
from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import List
from datetime import datetime, timezone
import logging

from db import poll_registry_col
from utils.helpers import p2fk_get
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _is_mainnet(network: str) -> bool:
    return 'mainnet' in network.lower()


class PollRegisterRequest(BaseModel):
    txid: str
    question: str
    answers: List[dict]
    creator_address: str
    network: str
    own_gate: List[str] = []
    cre_gate: List[str] = []


class PollVoteRequest(BaseModel):
    txid: str
    answer_address: str
    voter_address: str


@router.post("/polls/register")
async def register_poll(req: PollRegisterRequest):
    """Register a newly created poll for instant feed visibility (speed cache).
    
    The poll transaction is on-chain — this local record exists ONLY so the
    feed can display the poll immediately before the indexer has caught up.
    Once confirmed, on-chain data from GetInquiryByTransactionID takes precedence.
    """
    await poll_registry_col.update_one(
        {'txid': req.txid},
        {'$set': {
            'txid': req.txid,
            'question': req.question,
            'answers': req.answers,
            'creator_address': req.creator_address,
            'network': req.network,
            'own_gate': req.own_gate,
            'cre_gate': req.cre_gate,
            'created_at': datetime.now(timezone.utc).isoformat(),
        },
        '$setOnInsert': {'votes': {}}},
        upsert=True,
    )

    # Inject poll directly into the cached feed for instant visibility
    try:
        from db import conversation_cache_col
        from utils.helpers import get_cached_profile
        cache_key = f"feed:{req.network}"
        cached = await conversation_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
        if cached and cached.get('messages'):
            messages = cached['messages']
            # Check if already in feed
            if not any(m.get('transaction_id') == req.txid for m in messages):
                profile = None
                if req.creator_address:
                    try:
                        is_mainnet = 'mainnet' in req.network.lower()
                        profile = await get_cached_profile(req.creator_address, is_mainnet)
                    except Exception:
                        pass
                poll_entry = {
                    'id': req.txid,
                    'from_address': req.creator_address,
                    'to_address': '',
                    'content': '',
                    'transaction_id': req.txid,
                    'network': req.network,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'first_seen': datetime.now(timezone.utc).isoformat(),
                    'block_time': None,
                    'is_reply': False,
                    'is_poll': True,
                    'poll_data': {
                        'txid': req.txid,
                        'question': req.question,
                        'answers': req.answers,
                        'own_gate': req.own_gate,
                        'cre_gate': req.cre_gate,
                        'total_votes': 0,
                        'total_gated_votes': 0,
                        'status': 'active',
                        'votes': {},
                    },
                    'sender_urn': profile.get('URN') if profile else None,
                    'sender_display_name': profile.get('DisplayName') if profile else None,
                    'sender_image': profile.get('Image') if profile else None,
                    'recipient_urn': None,
                    'recipient_image': None,
                    'files': None,
                }
                messages.insert(0, poll_entry)  # Add to top (newest)
                await conversation_cache_col.update_one(
                    {'cache_key': cache_key},
                    {'$set': {'messages': messages}},
                )
    except Exception as e:
        logger.warning(f"Failed to inject poll into feed cache: {e}")

    return {"ok": True}


@router.post("/polls/vote")
async def record_vote(req: PollVoteRequest):
    """Record a vote locally for 'already voted' detection only.
    
    The ACTUAL vote is the on-chain transaction (broadcast by the client).
    This endpoint is a local cache — vote COUNTS come from the chain via
    GetInquiryByTransactionID, not from this registry.
    """
    # Store only which answer the voter chose (for dedup / "you already voted" UI)
    await poll_registry_col.update_one(
        {'txid': req.txid},
        {'$set': {f'votes.{req.voter_address}': req.answer_address}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/polls/my-vote/{txid}")
async def get_my_vote(txid: str, voter: str = ''):
    """Check if a specific address has voted on a poll."""
    if not voter:
        return {"voted_for": None}
    poll = await poll_registry_col.find_one({'txid': txid}, {'_id': 0, 'votes': 1})
    if not poll:
        return {"voted_for": None}
    voted_for = (poll.get('votes') or {}).get(voter)
    return {"voted_for": voted_for}


@router.get("/polls/registered")
async def get_registered_polls(network: str = 'btc-testnet'):
    """Get all registered polls for a network (for feed inclusion)."""
    cursor = poll_registry_col.find(
        {'network': {'$regex': network, '$options': 'i'}},
        {'_id': 0}
    )
    return {"polls": await cursor.to_list(length=200)}


@router.get("/polls/by-address/{address}")
async def get_poll_by_address(address: str, network: str = 'btc-testnet'):
    """Get a single poll/inquiry by its question address."""
    mainnet = _is_mainnet(network)
    data = await p2fk_get(f"GetInquiryByAddress/{address}", mainnet)
    if not data or not isinstance(data, dict):
        return {"error": "Poll not found or API unavailable"}
    return _format_poll(data)


@router.get("/polls/by-txid/{txid}")
async def get_poll_by_txid(txid: str, network: str = 'btc-testnet', fresh: bool = False):
    """Get a poll/inquiry by transaction ID.
    
    Source of truth: on-chain data via GetInquiryByTransactionID.
    Local registry is ONLY used as a fallback for unconfirmed (mempool) polls
    before the indexer has seen them. Vote counts from the local registry are
    NOT authoritative — only on-chain counts are.
    
    Pass fresh=true to bypass the API cache (used after voting to get updated counts).
    """
    mainnet = _is_mainnet(network)
    data = await p2fk_get(f"GetInquiryByTransactionID/{txid}", mainnet, skip_cache=fresh)
    if data and isinstance(data, dict) and data.get("Question"):
        formatted = _format_poll(data)
        # Merge local "already voted" info for the current user
        local = await poll_registry_col.find_one({'txid': txid}, {'_id': 0, 'votes': 1})
        if local and local.get('votes'):
            formatted['votes'] = local['votes']
        return formatted

    # On-chain data unavailable (unconfirmed or indexer lag) — show local as pending
    local = await poll_registry_col.find_one({'txid': txid}, {'_id': 0})
    if local and local.get('question'):
        poll_status = "mempool"
        try:
            base = "https://mempool.space/api" if mainnet else "https://mempool.space/testnet/api"
            client = get_client()
            resp = await client.get(f"{base}/tx/{txid}/status", timeout=5.0)
            if resp.status_code == 200 and resp.json().get("confirmed"):
                poll_status = "active"
        except Exception:
            pass

        # Compute vote counts from local votes mapping
        votes_map = local.get('votes') or {}
        raw_answers = local.get('answers', [])
        # Count votes per answer address
        vote_counts = {}
        for voter, answer_addr in votes_map.items():
            vote_counts[answer_addr] = vote_counts.get(answer_addr, 0) + 1
        total_votes = sum(vote_counts.values())

        # Normalize answers — can be list of dicts, dict-of-dicts, or legacy format
        enriched_answers = []
        if isinstance(raw_answers, list):
            for a in raw_answers:
                if isinstance(a, dict):
                    addr = a.get('address', '') or a.get('Address', '')
                    enriched_answers.append({
                        'address': addr,
                        'answer': a.get('answer', a.get('Answer', '')),
                        'total_votes': vote_counts.get(addr, a.get('total_votes', a.get('TotalVotes', 0))),
                        'total_value': a.get('total_value', a.get('TotalValue', 0)),
                    })
                elif isinstance(a, str):
                    enriched_answers.append({
                        'address': '',
                        'answer': a,
                        'total_votes': 0,
                        'total_value': 0,
                    })
        elif isinstance(raw_answers, dict):
            # Legacy format: key may be the answer address with a dict value {answer, total_votes},
            # or numeric index ("0","1") with just tally data. Preserve the address only when it
            # looks like a real P2FK address (Base58 ≥ 26 chars). Never use a numeric index as
            # the displayed answer text — that's what caused the `[{address:"0",answer:"0"}]` bug.
            for key, val in raw_answers.items():
                is_addr_key = isinstance(key, str) and len(key) >= 26 and key.isalnum()
                if isinstance(val, dict):
                    answer_text = val.get('answer', val.get('Answer', ''))
                    if not answer_text and not is_addr_key:
                        # Malformed legacy entry with only counts — skip rather than show "0"
                        continue
                    enriched_answers.append({
                        'address': key if is_addr_key else '',
                        'answer': answer_text or '(unnamed)',
                        'total_votes': vote_counts.get(key, val.get('total_votes', val.get('TotalVotes', 0))),
                        'total_value': val.get('total_value', val.get('TotalValue', 0)),
                    })
                elif isinstance(val, str):
                    enriched_answers.append({
                        'address': key if is_addr_key else '',
                        'answer': val,
                        'total_votes': vote_counts.get(key, 0),
                        'total_value': 0,
                    })
            # Use max of computed or embedded counts
            if not total_votes:
                total_votes = sum(a.get('total_votes', 0) for a in enriched_answers)

        # ── Recovery: if answers are unrecoverable (legacy corruption with only
        # numeric index keys) but the votes map contains real answer addresses,
        # synthesize answer entries from those addresses. Gives on-chain
        # reconstruction something to work with below.
        if not any(a.get('address') for a in enriched_answers) and votes_map:
            recovered_addrs = set()
            for _, ans_addr in votes_map.items():
                if isinstance(ans_addr, str) and len(ans_addr) >= 26:
                    recovered_addrs.add(ans_addr)
            if recovered_addrs:
                enriched_answers = [{
                    'address': addr,
                    'answer': '(recovered)',
                    'total_votes': 0,
                    'total_value': 0,
                } for addr in recovered_addrs]

        # ── On-chain vote reconstruction (INQ.cs parity) ──
        # When p2fk.io's INQState endpoint is empty but we know the answer addresses
        # locally, tally votes ourselves by walking GetRootsByAddress for each answer.
        # Dedup SignedBy, filter signed when RequireSignature, enforce MaxBlockHeight.
        require_sig = bool(local.get('require_signature', True))
        max_block = int(local.get('max_block_height', 0) or 0)
        reconstructed = False
        addr_tallies = {a['address']: {'votes': 0, 'value': 0.0} for a in enriched_answers if a.get('address')}
        if addr_tallies:
            has_voted = set()
            for answer in enriched_answers:
                addr = answer.get('address')
                if not addr:
                    continue
                try:
                    roots = await p2fk_get(f"GetRootsByAddress/{addr}", mainnet)
                except Exception:
                    roots = None
                if not isinstance(roots, list):
                    continue
                reconstructed = True
                for r in roots:
                    if not isinstance(r, dict):
                        continue
                    signed_by = r.get('SignedBy') or ''
                    if not signed_by or signed_by in has_voted:
                        continue
                    if require_sig and not r.get('Signed'):
                        continue
                    if max_block > 0 and (r.get('BlockHeight') or 0) > max_block:
                        continue
                    has_voted.add(signed_by)
                    addr_tallies[addr]['votes'] += 1
                    # Sum output value sent to this answer address (in BTC as string)
                    output = r.get('Output') or {}
                    raw_val = output.get(addr, 0)
                    try:
                        addr_tallies[addr]['value'] += float(raw_val or 0)
                    except (ValueError, TypeError):
                        pass

            if reconstructed:
                # Overlay reconstructed counts (authoritative) onto enriched_answers
                new_total = 0
                for ans in enriched_answers:
                    addr = ans.get('address')
                    if addr and addr in addr_tallies:
                        ans['total_votes'] = addr_tallies[addr]['votes']
                        ans['total_value'] = addr_tallies[addr]['value']
                        new_total += addr_tallies[addr]['votes']
                total_votes = new_total

        return {
            "txid": local['txid'],
            "question": local['question'],
            "answers": enriched_answers,
            "own_gate": local.get('own_gate', []),
            "cre_gate": local.get('cre_gate', []),
            "total_votes": total_votes,
            "total_gated_votes": 0,
            "votes": votes_map,
            "status": poll_status,
            "require_signature": require_sig,
            "max_block_height": max_block,
            "created_by": local.get('creator_address'),
            "created_date": local.get('created_at'),
            "source": "local_decode" if reconstructed else "local_cache",
        }

    # Nothing found
    if data and isinstance(data, dict) and data.get("Question"):
        return _format_poll(data)
    return {"error": "Poll not found or API unavailable"}


@router.get("/polls/list/{address}")
async def list_polls(address: str, network: str = 'btc-testnet'):
    """List all polls at an address (e.g., a profile address or keyword address)."""
    mainnet = _is_mainnet(network)
    data = await p2fk_get(f"GetInquiriesByAddress/{address}", mainnet)
    if not data or not isinstance(data, list):
        return {"polls": []}
    # Filter only valid poll dicts (API may return error strings)
    return {"polls": [_format_poll(p) for p in data if isinstance(p, dict) and p.get("URN")]}


@router.get("/polls/created-by/{address}")
async def polls_created_by(address: str, network: str = 'btc-testnet'):
    """List polls created by a specific address."""
    mainnet = _is_mainnet(network)
    data = await p2fk_get(f"GetInquiriesCreatedByAddress/{address}", mainnet)
    if not data or not isinstance(data, list):
        return {"polls": []}
    # Filter only valid poll dicts (API may return error strings)
    return {"polls": [_format_poll(p) for p in data if isinstance(p, dict) and p.get("URN")]}


@router.get("/polls/search")
async def search_polls(q: str = Query(..., min_length=1), network: str = 'btc-testnet'):
    """Search polls by keyword."""
    mainnet = _is_mainnet(network)
    from utils.helpers import get_keyword_address_from_api
    kw_addr = await get_keyword_address_from_api(q, mainnet)
    data = await p2fk_get(f"GetInquiriesByAddress/{kw_addr}", mainnet)
    if not data or not isinstance(data, list):
        return {"polls": []}
    # Filter only valid poll dicts (API may return error strings)
    return {"polls": [_format_poll(p) for p in data if isinstance(p, dict) and p.get("URN")]}


def _format_poll(data: dict) -> dict:
    """Normalize P2FK INQState into a clean JSON response.
    
    Vote counts here come directly from the on-chain indexer — these are
    the authoritative counts (not local DB tallies).
    """
    answers = []
    for a in (data.get("AnswerData") or []):
        answers.append({
            "address": a.get("Address", ""),
            "answer": a.get("Answer", ""),
            "total_votes": a.get("TotalVotes", 0),
            "total_value": a.get("TotalValue", 0),
            "gated_votes": a.get("TotalGatedVotes", 0),
            "gated_value": a.get("TotalGatedValue", 0),
        })

    return {
        "txid": data.get("TransactionId"),
        "urn": data.get("URN"),
        "question": data.get("Question", ""),
        "answers": answers,
        "own_gate": data.get("OwnsObjectGate") or [],
        "cre_gate": data.get("OwnsCreatedByGate") or [],
        "authorized_voters": data.get("AuthorizedByGate") or [],
        "total_votes": data.get("TotalVotes", 0),
        "total_value": data.get("TotalValue", 0),
        "total_gated_votes": data.get("TotalGatedVotes", 0),
        "total_gated_value": data.get("TotalGatedValue", 0),
        "status": data.get("status", "unknown"),
        "max_block_height": data.get("MaxBlockHeight", 0),
        "require_signature": data.get("RequireSignature", True),
        "created_by": data.get("CreatedBy"),
        "created_date": data.get("CreatedDate"),
        "changed_date": data.get("ChangedDate"),
        "source": "on_chain",
    }
