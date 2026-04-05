"""Wallet routes: create, import, balance, UTXOs, broadcast, raw-tx, P2FK transactions."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging
import json
import random

from bit import PrivateKeyTestnet, PrivateKey

from config import MEMPOOL_TESTNET_API, MEMPOOL_MAINNET_API
from utils.helpers import register_known_user, fetch_profile_by_address, fetch_objects_created_by_address
from utils.blockchain import fetch_utxos_mempool, broadcast_raw_tx
from utils.http_pool import get_client
from utils.p2fk import (
    encode_payload_to_addresses, get_keyword_address,
    build_post_payload, build_signed_payload,
    get_random_delimiter, generate_safe_object_address,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


class WalletImportRequest(BaseModel):
    wif: str


class BroadcastRequest(BaseModel):
    raw_tx: str
    network: str = 'btc-testnet'


class RegisterProfileRequest(BaseModel):
    address: str
    network: str = 'btc-testnet'
    urn: Optional[str] = None
    image: Optional[str] = None
    display_name: Optional[str] = None


class PostRequest(BaseModel):
    wif: str
    message: str
    to_address: Optional[str] = None
    network: str = 'btc-testnet'
    hashtags: Optional[List[str]] = None


class ProfileMintRequest(BaseModel):
    wif: str
    urn: str
    display_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    bio: Optional[str] = None
    image: Optional[str] = None
    url: Optional[dict] = None
    network: str = 'btc-testnet'


class ObjectCreateRequest(BaseModel):
    wif: str
    urn: str
    name: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    uri: Optional[str] = None
    license: Optional[str] = None
    max_supply: int = 1
    royalties: Optional[dict] = None
    keywords: Optional[List[str]] = None
    collection_address: Optional[str] = None
    network: str = 'btc-testnet'


class GiveObjectRequest(BaseModel):
    wif: str
    object_address: str
    recipient_address: str
    quantity: int = 1
    network: str = 'btc-testnet'


class BurnObjectRequest(BaseModel):
    wif: str
    object_address: str
    quantity: int = 1
    network: str = 'btc-testnet'


class BuyObjectRequest(BaseModel):
    wif: str
    object_address: str
    owner_address: str
    quantity: int = 1
    price_sats: int = 0
    network: str = 'btc-testnet'


@router.post("/wallet/create")
async def create_wallet(network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        key = PrivateKey() if is_mainnet else PrivateKeyTestnet()
        return {
            "address": key.address,
            "wif": key.to_wif(),
            "public_key": key.public_key.hex(),
            "network": network,
        }
    except Exception as e:
        logger.error(f"Wallet create error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/import")
async def import_wallet(req: WalletImportRequest, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        return {
            "address": key.address,
            "wif": key.to_wif(),
            "public_key": key.public_key.hex(),
            "network": network,
            "valid": True,
        }
    except Exception as e:
        logger.error(f"Wallet import error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid WIF key: {str(e)}")


@router.get("/wallet/balance/{address}")
async def get_wallet_balance(address: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API

        client = get_client()
        resp = await client.get(f"{base}/address/{address}", timeout=15.0)
        if resp.status_code != 200:
            return {"address": address, "balance_sats": 0, "balance_btc": 0, "error": "Address not found"}

        data = resp.json()
        chain = data.get('chain_stats', {})
        mempool = data.get('mempool_stats', {})

        confirmed = chain.get('funded_txo_sum', 0) - chain.get('spent_txo_sum', 0)
        unconfirmed = mempool.get('funded_txo_sum', 0) - mempool.get('spent_txo_sum', 0)
        total = confirmed + unconfirmed

        return {
            "address": address,
            "balance_sats": total,
            "balance_btc": total / 100_000_000,
            "confirmed_sats": confirmed,
            "unconfirmed_sats": unconfirmed,
            "tx_count": chain.get('tx_count', 0),
            "network": network,
        }
    except Exception as e:
        logger.error(f"Balance error: {e}")
        return {"address": address, "balance_sats": 0, "balance_btc": 0, "error": str(e)}


@router.get("/wallet/utxos/{address}")
async def get_wallet_utxos(address: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API

        client = get_client()
        resp = await client.get(f"{base}/address/{address}/utxo", timeout=15.0)
        if resp.status_code != 200:
            logger.warning(f"UTXO fetch for {address} returned HTTP {resp.status_code}")
            return {"utxos": [], "count": 0, "http_status": resp.status_code}

        utxos = resp.json()
        formatted = [{
            "txid": u.get("txid"),
            "vout": u.get("vout"),
            "value": u.get("value"),
            "status": u.get("status", {}),
        } for u in utxos]

        return {
            "utxos": formatted,
            "count": len(formatted),
            "total_sats": sum(u["value"] for u in formatted),
        }
    except Exception as e:
        logger.error(f"UTXO error: {e}")
        return {"utxos": [], "count": 0, "error": str(e)}


@router.post("/wallet/broadcast")
async def broadcast_transaction(req: BroadcastRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API

        client = get_client()
        resp = await client.post(
            f"{base}/tx",
            content=req.raw_tx,
            headers={"Content-Type": "text/plain"},
            timeout=30.0,
        )
        if resp.status_code == 200:
            txid = resp.text.strip()
            return {"txid": txid, "success": True, "network": req.network}
        else:
            return {"success": False, "error": resp.text, "status": resp.status_code}
    except Exception as e:
        logger.error(f"Broadcast error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wallet/faucets")
async def get_faucets():
    return {
        "faucets": [
            {"name": "Mempool Testnet Faucet", "url": "https://testnet-faucet.mempool.co/"},
            {"name": "Bitcoin Testnet Faucet", "url": "https://bitcoinfaucet.uo1.net/send.php"},
            {"name": "CoilFaucet Testnet", "url": "https://coinfaucet.eu/en/btc-testnet/"},
        ]
    }


@router.get("/wallet/raw-tx/{txid}")
async def get_raw_tx(txid: str, network: str = 'btc-testnet'):
    try:
        is_mainnet = 'mainnet' in network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API

        client = get_client()
        resp = await client.get(f"{base}/tx/{txid}/hex", timeout=15.0)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Transaction not found")
        return {"hex": resp.text.strip(), "txid": txid}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Raw TX fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wallet/fees")
async def get_fee_estimates(network: str = 'btc-testnet'):
    """Fetch recommended fee rates from mempool.space (sat/vB)."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API
        client = get_client()
        resp = await client.get(f"{base}/v1/fees/recommended", timeout=10.0)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "priority": data.get("fastestFee", 20),
                "standard": data.get("halfHourFee", 10),
                "economy": data.get("hourFee", 5),
                "minimum": data.get("minimumFee", 1),
                "network": network,
            }
        return {"priority": 20, "standard": 10, "economy": 5, "minimum": 1, "network": network}
    except Exception as e:
        logger.error(f"Fee estimation error: {e}")
        return {"priority": 20, "standard": 10, "economy": 5, "minimum": 1, "network": network}


@router.get("/wallet/address-txs/{address}")
async def get_address_transactions(address: str, network: str = 'btc-testnet'):
    """Fetch recent transactions for an address from mempool.space (with retry + fallback)."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API
        fallback_base = f"https://blockstream.info{'/' if is_mainnet else '/testnet/'}/api"
        client = get_client()

        txs = None
        # Try mempool.space first, then blockstream fallback
        for api_base in [base, fallback_base]:
            try:
                resp = await client.get(f"{api_base}/address/{address}/txs", timeout=15.0)
                if resp.status_code == 200:
                    txs = resp.json()
                    break
            except Exception:
                continue

        if txs is None:
            return {"transactions": [], "count": 0, "error": "All APIs unavailable"}

        formatted = []
        for tx in txs[:50]:
            is_incoming = not any(
                vin.get("prevout", {}).get("scriptpubkey_address") == address
                for vin in tx.get("vin", [])
            )
            total_received = sum(
                vout.get("value", 0)
                for vout in tx.get("vout", [])
                if vout.get("scriptpubkey_address") == address
            )
            total_sent = sum(
                vin.get("prevout", {}).get("value", 0)
                for vin in tx.get("vin", [])
                if vin.get("prevout", {}).get("scriptpubkey_address") == address
            )
            formatted.append({
                "txid": tx.get("txid"),
                "confirmed": tx.get("status", {}).get("confirmed", False),
                "block_time": tx.get("status", {}).get("block_time"),
                "is_incoming": is_incoming,
                "received_sats": total_received,
                "sent_sats": total_sent,
                "fee": tx.get("fee", 0),
                "size": tx.get("size", 0),
            })
        return {"transactions": formatted, "count": len(formatted)}
    except Exception as e:
        logger.error(f"Address txs error: {e}")
        return {"transactions": [], "count": 0, "error": str(e)}



@router.get("/wallet/discover-addresses/{address}")
async def discover_addresses(address: str, network: str = 'btc-testnet'):
    """Fetch all P2FK object, profile, and collection addresses for this user.
    Queries p2fk.io to find objects/profiles created by the address.
    Returns categorized addresses: profile, object, collection."""
    try:
        is_mainnet = 'mainnet' in network.lower()
        addresses = []
        seen = set()

        # Helper: p2fk.io Creators can be dict {addr: date} or list [addr, ...]
        def _creator_addrs(creators_raw):
            if isinstance(creators_raw, dict):
                return list(creators_raw.keys())
            if isinstance(creators_raw, list):
                return creators_raw
            return []

        # 1. Profile address
        try:
            profile_raw = await fetch_profile_by_address(address, is_mainnet)
            if profile_raw and profile_raw.get('URN'):
                creator_list = _creator_addrs(profile_raw.get('Creators'))
                pro_addr = creator_list[0] if creator_list else address
                if pro_addr not in seen:
                    seen.add(pro_addr)
                    addresses.append({
                        'address': pro_addr,
                        'type': 'profile',
                        'label': profile_raw.get('URN', 'Profile'),
                        'urn': profile_raw.get('URN', ''),
                        'txid': profile_raw.get('TransactionId', ''),
                    })
        except Exception as e:
            logger.warning(f"Profile fetch error: {e}")

        # 2. Object addresses (created by this user)
        try:
            objects = await fetch_objects_created_by_address(address, is_mainnet)
            collection_addrs = set()
            for obj in (objects or []):
                creator_list = _creator_addrs(obj.get('Creators'))
                if not creator_list:
                    continue
                obj_addr = creator_list[0]
                if obj_addr not in seen:
                    seen.add(obj_addr)
                    addresses.append({
                        'address': obj_addr,
                        'type': 'object',
                        'label': obj.get('Name') or obj.get('URN') or 'Object',
                        'urn': obj.get('URN', ''),
                        'txid': obj.get('TransactionId', ''),
                        'image': obj.get('Image', ''),
                    })
                # Track collection addresses (Creators[1] if present)
                if len(creator_list) >= 3:
                    col_addr = creator_list[1]
                    if col_addr and col_addr != address and col_addr not in seen:
                        collection_addrs.add(col_addr)

            # 3. Collection addresses
            for col_addr in collection_addrs:
                seen.add(col_addr)
                addresses.append({
                    'address': col_addr,
                    'type': 'collection',
                    'label': 'Collection',
                    'urn': '',
                    'txid': '',
                })
        except Exception as e:
            logger.warning(f"Objects fetch error: {e}")

        obj_count = sum(1 for a in addresses if a['type'] == 'object')
        pro_count = sum(1 for a in addresses if a['type'] == 'profile')
        col_count = sum(1 for a in addresses if a['type'] == 'collection')

        return {
            'addresses': addresses,
            'object_count': obj_count,
            'profile_count': pro_count,
            'collection_count': col_count,
            'total': len(addresses),
        }
    except Exception as e:
        logger.error(f"Discover P2FK addresses error: {e}")
        return {'addresses': [], 'error': str(e), 'total': 0}



@router.post("/wallet/register-profile")
async def register_profile_known(req: RegisterProfileRequest):
    try:
        await register_known_user(req.address, req.network, req.urn, req.image, req.display_name)

        # Create ephemeral "new profile minted" announcement for the global feed
        from db import db
        from datetime import datetime, timezone

        # Look up the user's actual profile image from known_users
        profile_image = req.image
        try:
            known = await db.known_users.find_one({"address": req.address, "network": req.network})
            if known and known.get("image"):
                profile_image = known["image"]
        except Exception:
            pass

        announcement = {
            "type": "profile_minted",
            "address": req.address,
            "urn": req.urn or req.address[:12],
            "display_name": req.display_name or req.urn or req.address[:12],
            "image": profile_image,
            "network": req.network,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await db.system_announcements.insert_one(announcement)
        logger.info(f"System announcement: @{req.urn} minted profile on {req.network}")

        return {"success": True, "address": req.address, "urn": req.urn}
    except Exception as e:
        logger.error(f"Register profile error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



class AnnounceObjectRequest(BaseModel):
    address: str
    network: str = 'btc-testnet'
    urn: str = ''
    object_name: str = ''
    object_image: str = ''
    txid: str = ''

@router.post("/wallet/announce-object")
async def announce_object_minted(req: AnnounceObjectRequest):
    """Create an ephemeral 'new object minted' announcement for the global feed."""
    try:
        from db import db
        from datetime import datetime, timezone

        # Look up creator's profile for avatar
        profile_image = None
        creator_urn = req.urn or req.address[:12]
        try:
            known = await db.known_users.find_one({"address": req.address, "network": req.network})
            if known:
                profile_image = known.get("image")
                creator_urn = known.get("urn") or creator_urn
        except Exception:
            pass

        announcement = {
            "type": "object_minted",
            "address": req.address,
            "urn": creator_urn,
            "display_name": creator_urn,
            "image": profile_image,  # Creator's profile avatar
            "object_name": req.object_name or "an object",
            "object_image": req.object_image or "",
            "txid": req.txid,
            "network": req.network,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await db.system_announcements.insert_one(announcement)
        logger.info(f"Object announcement: @{creator_urn} minted '{req.object_name}' on {req.network}")
        return {"success": True}
    except Exception as e:
        logger.error(f"Announce object error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# --- P2FK Transaction Endpoints (server-side signing, kept for backward compat) ---

@router.post("/wallet/post")
async def create_post(req: PostRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        sender_address = key.address
        payload = build_post_payload(req.message)
        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        if req.hashtags:
            for tag in req.hashtags:
                clean_tag = tag.lstrip('#')
                if clean_tag:
                    kw_addr = get_keyword_address(clean_tag, version_byte)
                    if kw_addr not in encoded_addresses:
                        encoded_addresses.append(kw_addr)

        to_address = req.to_address or sender_address
        if to_address != sender_address and to_address not in encoded_addresses:
            encoded_addresses.append(to_address)

        if sender_address in encoded_addresses:
            encoded_addresses.remove(sender_address)
        encoded_addresses.append(sender_address)

        dust_amount = 546
        total_output_sats = dust_amount * len(encoded_addresses)

        unspents = await fetch_utxos_mempool(sender_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(encoded_addresses)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]
        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            logger.error(f"Transaction creation error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            await register_known_user(sender_address, req.network)
            if req.to_address and req.to_address != sender_address:
                await register_known_user(req.to_address, req.network)
            return {
                "success": True,
                "txid": result["txid"],
                "from_address": sender_address,
                "to_address": to_address,
                "message": req.message,
                "encoded_addresses_count": len(encoded_addresses),
                "cost_sats": total_output_sats,
                "network": req.network,
            }
        else:
            error_msg = result.get("error", "Unknown broadcast error")
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {error_msg}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Post creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/create_profile")
async def create_profile(req: ProfileMintRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        sender_address = key.address

        pro_data = {}
        if req.urn: pro_data["urn"] = req.urn
        if req.display_name: pro_data["dnm"] = req.display_name
        if req.first_name: pro_data["fnm"] = req.first_name
        if req.last_name: pro_data["lnm"] = req.last_name
        if req.bio: pro_data["bio"] = req.bio
        if req.image: pro_data["img"] = req.image
        if req.url: pro_data["url"] = req.url
        pro_data["cre"] = ["0"]

        pro_json = json.dumps(pro_data, separators=(',', ':'))
        pro_bytes = pro_json.encode('utf-8')

        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload = f"PRO{d1}{len(pro_bytes)}{d2}{pro_json}"

        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        urn_address = get_keyword_address(req.urn, version_byte)
        if urn_address not in encoded_addresses:
            encoded_addresses.append(urn_address)

        if sender_address in encoded_addresses:
            encoded_addresses.remove(sender_address)
        encoded_addresses.append(sender_address)

        dust_amount = 546
        total_output_sats = dust_amount * len(encoded_addresses)

        unspents = await fetch_utxos_mempool(sender_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(encoded_addresses)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]
        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            logger.error(f"Profile TX creation error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            await register_known_user(sender_address, req.network, req.urn, req.image, req.display_name)
            return {
                "success": True,
                "txid": result["txid"],
                "address": sender_address,
                "urn": req.urn,
                "encoded_addresses_count": len(encoded_addresses),
                "cost_sats": total_output_sats,
                "network": req.network,
            }
        else:
            error_msg = result.get("error", "Unknown broadcast error")
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {error_msg}")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Profile creation error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/create_object")
async def create_object(req: ObjectCreateRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        creator_address = key.address
        object_address, _obj_wif = generate_safe_object_address(version_byte)

        obj_data = {"urn": req.urn}
        if req.name: obj_data["nme"] = req.name
        if req.description: obj_data["dsc"] = req.description
        if req.image: obj_data["img"] = req.image
        if req.uri: obj_data["uri"] = req.uri
        if req.license: obj_data["lic"] = req.license
        obj_data["max"] = req.max_supply
        obj_data["cre"] = [creator_address]
        if req.collection_address:
            obj_data["cre"].append(req.collection_address)
        obj_data["own"] = {creator_address: 1}

        if req.royalties:
            roy = {}
            for addr_or_urn, pct in req.royalties.items():
                roy[addr_or_urn] = float(pct)
            if roy:
                obj_data["roy"] = roy

        obj_json = json.dumps(obj_data, separators=(',', ':'))
        obj_bytes = obj_json.encode('utf-8')

        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload = f"OBJ{d1}{len(obj_bytes)}{d2}{obj_json}"

        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        urn_addr = get_keyword_address(req.urn, version_byte)
        if urn_addr not in encoded_addresses:
            encoded_addresses.append(urn_addr)

        if req.keywords:
            for kw in req.keywords:
                clean_kw = kw.lstrip('#')
                if clean_kw:
                    kw_addr = get_keyword_address(clean_kw, version_byte)
                    if kw_addr not in encoded_addresses:
                        encoded_addresses.append(kw_addr)

        if object_address not in encoded_addresses:
            encoded_addresses.append(object_address)

        if creator_address in encoded_addresses:
            encoded_addresses.remove(creator_address)
        encoded_addresses.append(creator_address)

        dust_amount = 546
        total_output_sats = dust_amount * len(encoded_addresses)

        unspents = await fetch_utxos_mempool(creator_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(encoded_addresses)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]
        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            logger.error(f"Object TX creation error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            return {
                "success": True,
                "txid": result["txid"],
                "object_address": object_address,
                "creator_address": creator_address,
                "urn": req.urn,
                "encoded_addresses_count": len(encoded_addresses),
                "cost_sats": total_output_sats,
                "network": req.network,
            }
        else:
            error_msg = result.get("error", "Unknown broadcast error")
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {error_msg}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Object creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/give_object")
async def give_object(req: GiveObjectRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        signer_address = key.address

        salt = -abs(random.randint(1, 99999))
        giv_data = [[2, req.quantity], [0, salt]]
        giv_json = json.dumps(giv_data, separators=(',', ':'))
        giv_bytes = giv_json.encode('utf-8')

        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload = f"GIV{d1}{len(giv_bytes)}{d2}{giv_json}"

        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        if req.recipient_address not in encoded_addresses:
            encoded_addresses.append(req.recipient_address)
        if req.object_address not in encoded_addresses:
            encoded_addresses.append(req.object_address)
        if signer_address in encoded_addresses:
            encoded_addresses.remove(signer_address)
        encoded_addresses.append(signer_address)

        dust_amount = 546
        total_output_sats = dust_amount * len(encoded_addresses)
        unspents = await fetch_utxos_mempool(signer_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(encoded_addresses)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]
        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            return {"success": True, "txid": result["txid"], "type": "GIV", "recipient": req.recipient_address, "quantity": req.quantity, "cost_sats": total_output_sats}
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown error')}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Give object error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/burn_object")
async def burn_object(req: BurnObjectRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        signer_address = key.address

        salt = -abs(random.randint(1, 99999))
        brn_data = [[1, req.quantity], [0, salt]]
        brn_json = json.dumps(brn_data, separators=(',', ':'))
        brn_bytes = brn_json.encode('utf-8')

        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload = f"BRN{d1}{len(brn_bytes)}{d2}{brn_json}"

        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        if req.object_address not in encoded_addresses:
            encoded_addresses.append(req.object_address)
        if signer_address in encoded_addresses:
            encoded_addresses.remove(signer_address)
        encoded_addresses.append(signer_address)

        dust_amount = 546
        total_output_sats = dust_amount * len(encoded_addresses)
        unspents = await fetch_utxos_mempool(signer_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(encoded_addresses)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]
        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            return {"success": True, "txid": result["txid"], "type": "BRN", "quantity": req.quantity, "cost_sats": total_output_sats}
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown error')}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Burn object error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wallet/buy_object")
async def buy_object(req: BuyObjectRequest):
    try:
        is_mainnet = 'mainnet' in req.network.lower()
        version_byte = 0 if is_mainnet else 111

        try:
            key = PrivateKey(req.wif) if is_mainnet else PrivateKeyTestnet(req.wif)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid WIF key")

        signer_address = key.address

        salt = -abs(random.randint(1, 99999))
        buy_data = [[req.owner_address, str(req.quantity)], ["0", str(salt)]]
        buy_json = json.dumps(buy_data, separators=(',', ':'))
        buy_bytes = buy_json.encode('utf-8')

        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload = f"BUY{d1}{len(buy_bytes)}{d2}{buy_json}"

        full_payload = build_signed_payload(payload, req.wif, is_mainnet)
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)

        if req.object_address not in encoded_addresses:
            encoded_addresses.append(req.object_address)
        if signer_address in encoded_addresses:
            encoded_addresses.remove(signer_address)
        encoded_addresses.append(signer_address)

        dust_amount = 546
        outputs = [(addr, dust_amount, 'satoshi') for addr in encoded_addresses]

        if req.price_sats > 0:
            outputs.append((req.owner_address, req.price_sats, 'satoshi'))

        total_output_sats = sum(o[1] for o in outputs)
        unspents = await fetch_utxos_mempool(signer_address, is_mainnet)
        if not unspents:
            raise HTTPException(status_code=400, detail="No UTXOs available. Fund your wallet first.")

        total_available = sum(u.amount for u in unspents)
        estimated_fee = 300 * len(outputs)
        if total_available < total_output_sats + estimated_fee:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need ~{total_output_sats + estimated_fee} sats, have {total_available} sats.")

        try:
            tx_hex = key.create_transaction(outputs, unspents=unspents)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to create transaction: {str(e)}")

        result = await broadcast_raw_tx(tx_hex, is_mainnet)
        if result.get("success"):
            return {"success": True, "txid": result["txid"], "type": "BUY", "quantity": req.quantity, "price_sats": req.price_sats, "cost_sats": total_output_sats}
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown error')}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Buy object error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
