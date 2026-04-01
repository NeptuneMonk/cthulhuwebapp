"""Treasury routes: platform fee info, balance, faucet, ledger, and economics."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import logging

from bit import PrivateKeyTestnet, PrivateKey
from config import (
    TREASURY_TESTNET_WIF, TREASURY_MAINNET_WIF, TREASURY_MAINNET_ADDRESS,
    MEMPOOL_TESTNET_API, MEMPOOL_MAINNET_API,
)
from db import admin_col, db
from datetime import datetime, timezone
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


async def _get_admin_settings():
    """Fetch admin-configurable settings from DB, with defaults."""
    doc = await admin_col.find_one({"_id": "settings"})
    if not doc:
        return {"faucet_amount": 100000, "tax_rate": 0.02,
                "faucet_amount_mainnet": 0, "tax_rate_mainnet": 0.02}
    return doc


def _get_testnet_address():
    if not TREASURY_TESTNET_WIF:
        return None
    try:
        key = PrivateKeyTestnet(TREASURY_TESTNET_WIF)
        return key.address
    except Exception:
        return None


def _get_mainnet_address():
    """Derive mainnet address from WIF, or fall back to env address."""
    if TREASURY_MAINNET_WIF:
        try:
            key = PrivateKey(TREASURY_MAINNET_WIF)
            return key.address
        except Exception:
            pass
    return TREASURY_MAINNET_ADDRESS or None


async def _get_treasury_address_async(network: str):
    """Get treasury address: DB-imported first, then admin settings, then env-derived."""
    # 1. Check DB-imported treasury key (from admin wallet import-treasury)
    rec = await db.treasury_keys.find_one({"network": network}, {"_id": 0, "address": 1})
    if rec and rec.get("address"):
        return rec["address"]
    # 2. Check admin settings treasury addresses
    settings = await admin_col.find_one({"_id": "settings"})
    if settings and settings.get("treasury_addresses"):
        addrs = settings["treasury_addresses"]
        if "mainnet" in network.lower() and addrs.get("btc"):
            return addrs["btc"]
        elif "testnet" in network.lower() and addrs.get("btc_testnet"):
            return addrs["btc_testnet"]
        elif addrs.get("btc"):
            # Legacy: single BTC field used for the active network
            return addrs["btc"] if "mainnet" in network.lower() else None
    # 3. Fall back to env-derived
    return _get_treasury_address(network)


def _get_treasury_address(network: str):
    is_mainnet = 'mainnet' in network.lower()
    if is_mainnet:
        return _get_mainnet_address()
    return _get_testnet_address()


async def _fetch_balance(address: str, is_mainnet: bool):
    base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API
    try:
        client = get_client()
        resp = await client.get(f"{base}/address/{address}", timeout=15.0)
        if resp.status_code != 200:
            return 0
        data = resp.json()
        chain = data.get('chain_stats', {})
        mempool = data.get('mempool_stats', {})
        confirmed = chain.get('funded_txo_sum', 0) - chain.get('spent_txo_sum', 0)
        unconfirmed = mempool.get('funded_txo_sum', 0) - mempool.get('spent_txo_sum', 0)
        return confirmed + unconfirmed
    except Exception as e:
        logger.error(f"Treasury balance fetch error: {e}")
        return 0


# ─── Ledger helpers ───

async def record_ledger_entry(entry_type: str, amount_sats: int, network: str, txid: str = "", details: str = ""):
    """Record a transaction in the treasury ledger."""
    await db.treasury_ledger.insert_one({
        "type": entry_type,  # "tax_income", "faucet_expense", "checkpoint_expense", "manual"
        "amount_sats": amount_sats,
        "network": network,
        "txid": txid,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ─── Public endpoints ───

@router.get("/treasury/info")
async def treasury_info(network: str = 'btc-testnet'):
    """Public endpoint: returns treasury address, balance, tax rate."""
    address = await _get_treasury_address_async(network)
    is_mainnet = 'mainnet' in network.lower()
    settings = await _get_admin_settings()
    tax_rate = settings.get("tax_rate_mainnet" if is_mainnet else "tax_rate", 0.02)
    faucet_amount = settings.get("faucet_amount_mainnet" if is_mainnet else "faucet_amount", 0 if is_mainnet else 100000)

    if not address:
        return {
            "address": None,
            "balance_sats": 0,
            "tax_rate": tax_rate,
            "faucet_available": False,
            "faucet_amount": 0,
            "network": network,
            "configured": False,
        }

    balance = await _fetch_balance(address, is_mainnet)
    faucet_ok = (not is_mainnet) and balance >= faucet_amount

    return {
        "address": address,
        "balance_sats": balance,
        "balance_btc": balance / 100_000_000,
        "tax_rate": tax_rate,
        "faucet_available": faucet_ok,
        "faucet_amount": faucet_amount if not is_mainnet else 0,
        "network": network,
        "configured": True,
    }


class FaucetRequest(BaseModel):
    recipient_address: str
    network: str = 'btc-testnet'


@router.post("/treasury/faucet")
async def treasury_faucet(req: FaucetRequest):
    """Send testnet coins from treasury to a new user for profile minting."""
    if 'mainnet' in req.network.lower():
        raise HTTPException(status_code=400, detail="Faucet is only available on testnet")

    if not TREASURY_TESTNET_WIF:
        raise HTTPException(status_code=503, detail="Treasury not configured")

    settings = await _get_admin_settings()
    faucet_amount = settings.get("faucet_amount", 100000)

    try:
        key = PrivateKeyTestnet(TREASURY_TESTNET_WIF)
        treasury_address = key.address

        balance = await _fetch_balance(treasury_address, False)
        if balance < faucet_amount + 1000:
            raise HTTPException(status_code=503, detail="Treasury balance too low for faucet")

        key.get_unspents()
        tx_hex = key.create_transaction(
            [(req.recipient_address, faucet_amount, 'satoshi')]
        )

        client = get_client()
        resp = await client.post(
            f"{MEMPOOL_TESTNET_API}/tx",
            content=tx_hex,
            headers={"Content-Type": "text/plain"},
            timeout=30.0,
        )
        if resp.status_code == 200:
            txid = resp.text.strip()
            logger.info(f"Faucet sent {faucet_amount} sats to {req.recipient_address} (tx: {txid})")

            # Record in ledger
            await record_ledger_entry(
                "faucet_expense", faucet_amount, req.network,
                txid=txid, details=f"Faucet to {req.recipient_address[:16]}..."
            )

            return {
                "success": True,
                "txid": txid,
                "amount_sats": faucet_amount,
                "from": treasury_address,
                "to": req.recipient_address,
            }
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {resp.text}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Faucet error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Tax logging (called by frontend after successful P2FK tx) ───

class TaxLogRequest(BaseModel):
    txid: str
    amount_sats: int
    network: str = "btc-testnet"
    tx_type: str = "p2fk"  # p2fk, send, buy, etc.


@router.post("/treasury/log-tax")
async def log_tax_payment(req: TaxLogRequest):
    """Frontend reports a successful tax payment for ledger tracking."""
    if req.amount_sats <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")

    await record_ledger_entry(
        "tax_income", req.amount_sats, req.network,
        txid=req.txid, details=f"Platform tax ({req.tx_type})"
    )
    return {"success": True}


# ─── Economics dashboard (admin) ───

def _get_admin_verify():
    from routes.admin import _verify_admin
    return _verify_admin


@router.get("/treasury/economics")
async def treasury_economics(
    network: str = "btc-testnet",
    _=Depends(_get_admin_verify()),
):
    """Admin: full treasury economics — balance, income, expenses, ledger summary."""
    address = await _get_treasury_address_async(network)
    is_mainnet = 'mainnet' in network.lower()
    balance = 0
    if address:
        balance = await _fetch_balance(address, is_mainnet)

    # Aggregate ledger
    income_pipeline = [
        {"$match": {"type": "tax_income", "network": network}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_sats"}, "count": {"$sum": 1}}},
    ]
    faucet_pipeline = [
        {"$match": {"type": "faucet_expense", "network": network}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_sats"}, "count": {"$sum": 1}}},
    ]
    checkpoint_pipeline = [
        {"$match": {"type": "checkpoint_expense", "network": network}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_sats"}, "count": {"$sum": 1}}},
    ]

    income_agg = await db.treasury_ledger.aggregate(income_pipeline).to_list(1)
    faucet_agg = await db.treasury_ledger.aggregate(faucet_pipeline).to_list(1)
    checkpoint_agg = await db.treasury_ledger.aggregate(checkpoint_pipeline).to_list(1)

    income_total = income_agg[0]["total"] if income_agg else 0
    income_count = income_agg[0]["count"] if income_agg else 0
    faucet_total = faucet_agg[0]["total"] if faucet_agg else 0
    faucet_count = faucet_agg[0]["count"] if faucet_agg else 0
    checkpoint_total = checkpoint_agg[0]["total"] if checkpoint_agg else 0
    checkpoint_count = checkpoint_agg[0]["count"] if checkpoint_agg else 0

    expenses_total = faucet_total + checkpoint_total
    net = income_total - expenses_total

    return {
        "address": address,
        "network": network,
        "configured": bool(address),
        "balance_sats": balance,
        "balance_btc": balance / 100_000_000,
        "income": {
            "tax_total_sats": income_total,
            "tax_count": income_count,
        },
        "expenses": {
            "faucet_total_sats": faucet_total,
            "faucet_count": faucet_count,
            "checkpoint_total_sats": checkpoint_total,
            "checkpoint_count": checkpoint_count,
            "total_sats": expenses_total,
        },
        "net_sats": net,
    }


@router.get("/treasury/ledger")
async def treasury_ledger(
    network: str = "btc-testnet",
    skip: int = 0,
    limit: int = 100,
    entry_type: Optional[str] = None,
    _=Depends(_get_admin_verify()),
):
    """Admin: full treasury ledger entries."""
    query = {"network": network}
    if entry_type:
        query["type"] = entry_type

    cursor = db.treasury_ledger.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    entries = await cursor.to_list(limit)
    total = await db.treasury_ledger.count_documents(query)

    return {"entries": entries, "total": total}
