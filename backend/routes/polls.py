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
    """Register a newly created poll so it appears in the feed."""
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
    """Record a vote locally after on-chain broadcast."""
    # Store vote: votes.{voter_address} = answer_address
    # Also increment the answer's total_votes
    poll = await poll_registry_col.find_one({'txid': req.txid}, {'_id': 0})
    if not poll:
        return {"error": "Poll not found"}

    # Update votes map
    await poll_registry_col.update_one(
        {'txid': req.txid},
        {'$set': {f'votes.{req.voter_address}': req.answer_address}}
    )

    # Increment the matching answer's total_votes
    answers = poll.get('answers', [])
    for i, ans in enumerate(answers):
        if ans.get('address') == req.answer_address:
            await poll_registry_col.update_one(
                {'txid': req.txid},
                {'$inc': {
                    f'answers.{i}.total_votes': 1,
                    'total_votes': 1,
                }}
            )
            break

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
async def get_poll_by_txid(txid: str, network: str = 'btc-testnet'):
    """Get a poll/inquiry by transaction ID.
    Tries P2FK API first, falls back to local registry for unconfirmed polls."""
    mainnet = _is_mainnet(network)
    data = await p2fk_get(f"GetInquiryByTransactionID/{txid}", mainnet)
    if data and isinstance(data, dict) and data.get("Question"):
        return _format_poll(data)

    # P2FK returned no data (unconfirmed or indexer lag) — check local registry
    local = await poll_registry_col.find_one({'txid': txid}, {'_id': 0})
    if local and local.get('question'):
        # Check if the tx is actually confirmed on-chain even though the indexer
        # hasn't processed it yet
        poll_status = "mempool"
        try:
            base = "https://mempool.space/api" if mainnet else "https://mempool.space/testnet/api"
            client = get_client()
            resp = await client.get(f"{base}/tx/{txid}/status", timeout=5.0)
            if resp.status_code == 200 and resp.json().get("confirmed"):
                poll_status = "active"
        except Exception:
            pass
        return {
            "txid": local['txid'],
            "question": local['question'],
            "answers": local.get('answers', []),
            "own_gate": local.get('own_gate', []),
            "cre_gate": local.get('cre_gate', []),
            "total_votes": local.get('total_votes', 0),
            "total_gated_votes": local.get('total_gated_votes', 0),
            "votes": local.get('votes', {}),
            "status": poll_status,
            "require_signature": True,
            "created_by": local.get('creator_address'),
            "created_date": local.get('created_at'),
        }

    # Nothing found
    if data and isinstance(data, dict):
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
    """Normalize P2FK INQState into a clean JSON response."""
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
    }
