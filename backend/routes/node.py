"""
Desktop Node API routes — /api/node/*

These endpoints are used ONLY by the Tauri desktop build.
They proxy requests to locally-running Core wallet daemons via JSON-RPC.
The web app never calls these routes.

Key principle: the user's wallet keys live inside the Core wallet daemon.
We never handle WIFs here — signing happens via `signrawtransactionwithwallet`.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

from rpc.wallet_rpc import wallet_manager, RPCError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/node", tags=["desktop-node"])


# ── Request models ───────────────────────────────────────────────────────────

class RPCCallRequest(BaseModel):
    chain: str
    method: str
    params: Optional[list] = []


class SignRequest(BaseModel):
    chain: str
    raw_tx_hex: str


class BroadcastRequest(BaseModel):
    chain: str
    signed_tx_hex: str


class CreateTxRequest(BaseModel):
    chain: str
    inputs: list   # [{"txid": "...", "vout": 0}, ...]
    outputs: list  # [{"address": amount}, ...]


# ── Status & Discovery ───────────────────────────────────────────────────────

@router.get("/status")
async def node_status():
    """Return connection status for all supported Core wallets."""
    return {
        "wallets": wallet_manager.status,
        "connected": wallet_manager.connected_chains,
    }


@router.post("/scan")
async def scan_wallets(network: str = "mainnet"):
    """Probe all supported Core wallets and return their status."""
    results = await wallet_manager.scan_all(network)
    return {
        "wallets": results,
        "connected": [c for c, s in results.items() if s.get("connected")],
    }


@router.get("/wallet/{chain}")
async def wallet_info(chain: str):
    """Get detailed info for a specific connected wallet."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")

    try:
        blockchain = await rpc.get_blockchain_info()
        wallet = {}
        try:
            wallet = await rpc.get_wallet_info()
        except RPCError:
            pass

        return {
            "chain": chain.upper(),
            "connected": True,
            "blockchain": {
                "blocks": blockchain.get("blocks"),
                "headers": blockchain.get("headers"),
                "chain": blockchain.get("chain"),
                "verification_progress": blockchain.get("verificationprogress"),
                "synced": blockchain.get("blocks", 0) >= blockchain.get("headers", 1) - 1,
            },
            "wallet": {
                "balance": wallet.get("balance", 0),
                "unconfirmed_balance": wallet.get("unconfirmed_balance", 0),
                "wallet_name": wallet.get("walletname", ""),
                "tx_count": wallet.get("txcount", 0),
            },
        }
    except ConnectionError:
        raise HTTPException(503, f"{chain.upper()} wallet is not reachable")
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Address Management ───────────────────────────────────────────────────────

@router.get("/address/{chain}")
async def get_address(chain: str, label: str = ""):
    """Get a new receiving address from the wallet."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        addr = await rpc.get_new_address(label)
        return {"chain": chain.upper(), "address": addr}
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── UTXOs ────────────────────────────────────────────────────────────────────

@router.get("/utxos/{chain}")
async def list_utxos(chain: str, min_conf: int = 1):
    """List unspent transaction outputs from the wallet."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        utxos = await rpc.list_unspent(min_conf)
        return {"chain": chain.upper(), "utxos": utxos, "count": len(utxos)}
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Transaction Building & Signing ───────────────────────────────────────────

@router.post("/tx/create")
async def create_transaction(req: CreateTxRequest):
    """Create a raw (unsigned) transaction via the wallet daemon."""
    rpc = wallet_manager.get(req.chain.upper())
    if not rpc:
        raise HTTPException(404, f"{req.chain.upper()} wallet not connected")
    try:
        raw_hex = await rpc.create_raw_transaction(req.inputs, req.outputs)
        return {"chain": req.chain.upper(), "raw_tx": raw_hex}
    except RPCError as e:
        raise HTTPException(500, e.message)


@router.post("/tx/sign")
async def sign_transaction(req: SignRequest):
    """
    Sign a raw transaction using the Core wallet's keys.
    The private keys NEVER leave the wallet daemon.
    """
    rpc = wallet_manager.get(req.chain.upper())
    if not rpc:
        raise HTTPException(404, f"{req.chain.upper()} wallet not connected")
    try:
        result = await rpc.sign_raw_transaction(req.raw_tx_hex)
        return {
            "chain": req.chain.upper(),
            "hex": result.get("hex", ""),
            "complete": result.get("complete", False),
            "errors": result.get("errors"),
        }
    except RPCError as e:
        raise HTTPException(500, e.message)


@router.post("/tx/broadcast")
async def broadcast_transaction(req: BroadcastRequest):
    """Broadcast a fully-signed transaction to the network."""
    rpc = wallet_manager.get(req.chain.upper())
    if not rpc:
        raise HTTPException(404, f"{req.chain.upper()} wallet not connected")
    try:
        txid = await rpc.send_raw_transaction(req.signed_tx_hex)
        return {"chain": req.chain.upper(), "txid": txid}
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Transaction History ──────────────────────────────────────────────────────

@router.get("/transactions/{chain}")
async def list_transactions(chain: str, count: int = 50, skip: int = 0):
    """List recent wallet transactions."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        txs = await rpc.list_transactions(min(count, 200), skip)
        return {"chain": chain.upper(), "transactions": txs, "count": len(txs)}
    except RPCError as e:
        raise HTTPException(500, e.message)


@router.get("/tx/{chain}/{txid}")
async def get_transaction(chain: str, txid: str):
    """Get full transaction details by TXID."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        tx = await rpc.get_raw_transaction(txid, verbose=True)
        return {"chain": chain.upper(), "transaction": tx}
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Block Data ───────────────────────────────────────────────────────────────

@router.get("/block/{chain}/{height_or_hash}")
async def get_block(chain: str, height_or_hash: str):
    """Get block by height (integer) or hash."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        # If numeric, treat as height → resolve hash first
        if height_or_hash.isdigit():
            block_hash = await rpc.get_block_hash(int(height_or_hash))
        else:
            block_hash = height_or_hash
        block = await rpc.get_block(block_hash)
        return {"chain": chain.upper(), "block": block}
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Fee Estimation ───────────────────────────────────────────────────────────

@router.get("/fee/{chain}")
async def estimate_fee(chain: str, target: int = 6):
    """Estimate fee rate for confirmation within `target` blocks."""
    rpc = wallet_manager.get(chain.upper())
    if not rpc:
        raise HTTPException(404, f"{chain.upper()} wallet not connected")
    try:
        result = await rpc.estimate_smart_fee(target)
        return {
            "chain": chain.upper(),
            "fee_rate": result.get("feerate"),
            "blocks": result.get("blocks"),
            "errors": result.get("errors"),
        }
    except RPCError as e:
        raise HTTPException(500, e.message)


# ── Generic RPC Passthrough (advanced) ───────────────────────────────────────

@router.post("/rpc")
async def generic_rpc(req: RPCCallRequest):
    """
    Generic RPC passthrough for advanced desktop operations.
    Use specific endpoints above when possible.
    """
    rpc = wallet_manager.get(req.chain.upper())
    if not rpc:
        raise HTTPException(404, f"{req.chain.upper()} wallet not connected")
    try:
        result = await rpc.call(req.method, req.params)
        return {"chain": req.chain.upper(), "method": req.method, "result": result}
    except RPCError as e:
        raise HTTPException(500, e.message)
