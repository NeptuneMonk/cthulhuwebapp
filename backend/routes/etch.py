"""
Etch-to-Chain — Backend support for on-chain file etching.

Stores chunk data and manifest information. The actual broadcasting
is handled client-side (P2FK signing), but we stage chunks here and
track the manifest for reconstruction.

Also provides admin endpoints for managing etches (list, delete, version).
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging
import hashlib
import os
from dotenv import load_dotenv

load_dotenv()

from db import db
from config import EXTENSION_MIME
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/etch")


class ChunkRequest(BaseModel):
    address: str
    network: str = "btc-testnet"
    chunk_hex: str
    filename: str
    chunk_index: int
    total_chunks: int


class ManifestRequest(BaseModel):
    address: str
    network: str = "btc-testnet"
    files: list  # [{ name, txids, chunks }]
    version: Optional[str] = None
    description: Optional[str] = None


@router.post("/chunk")
async def stage_chunk(req: ChunkRequest):
    """Stage a chunk for etching. Returns a sha256 chunk_id for tracking."""
    try:
        chunk_bytes = bytes.fromhex(req.chunk_hex)
        chunk_size = len(chunk_bytes)
        chunk_hash = hashlib.sha256(chunk_bytes).hexdigest()

        doc = {
            "chunk_id": chunk_hash,
            "address": req.address,
            "network": req.network,
            "filename": req.filename,
            "chunk_index": req.chunk_index,
            "total_chunks": req.total_chunks,
            "size": chunk_size,
            "hex": req.chunk_hex,
            "staged_at": datetime.now(timezone.utc).isoformat(),
            "broadcast": False,
            "txid": None,
        }

        await db.etch_chunks.update_one(
            {"chunk_id": chunk_hash},
            {"$set": doc},
            upsert=True,
        )

        return {"txid": chunk_hash, "size": chunk_size, "index": req.chunk_index}

    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex data")
    except Exception as e:
        logger.error(f"Etch chunk error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/manifest")
async def save_manifest(req: ManifestRequest):
    """Save the etching manifest — the index of all chunks for reconstruction."""
    try:
        total_size = 0
        total_chunks = 0
        for f in req.files:
            total_chunks += f.get("chunks", 0)
            # Calculate size from staged chunks
            for txid in f.get("txids", []):
                chunk = await db.etch_chunks.find_one({"chunk_id": txid}, {"_id": 0, "size": 1})
                if chunk:
                    total_size += chunk.get("size", 0)

        manifest = {
            "address": req.address,
            "network": req.network,
            "files": [{"name": f.get("name", ""), "txids": f.get("txids", []), "chunks": f.get("chunks", 0)} for f in req.files],
            "version": req.version or "1.0.0",
            "description": req.description or "",
            "total_size": total_size,
            "total_chunks": total_chunks,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        result = await db.etch_manifests.insert_one(manifest)
        manifest_id = str(result.inserted_id)

        return {"manifest_id": manifest_id, "file_count": len(req.files), "total_size": total_size}

    except Exception as e:
        logger.error(f"Etch manifest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/manifest/{address}")
async def get_manifests(address: str, network: str = "btc-testnet"):
    """Get all etching manifests for an address."""
    manifests = await db.etch_manifests.find(
        {"address": address, "network": network},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return {"manifests": manifests}


@router.get("/reconstruct/{chunk_id}")
async def reconstruct_chunk(chunk_id: str):
    """Fetch a staged chunk by its ID for reconstruction."""
    doc = await db.etch_chunks.find_one(
        {"chunk_id": chunk_id},
        {"_id": 0, "hex": 1, "filename": 1, "chunk_index": 1, "size": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Chunk not found")

    return Response(
        content=bytes.fromhex(doc["hex"]),
        media_type="application/octet-stream",
        headers={"X-Chunk-Index": str(doc["chunk_index"]), "X-Filename": doc["filename"]},
    )


@router.get("/reconstruct-file/{address}/{filename}")
async def reconstruct_file(address: str, filename: str, network: str = "btc-testnet"):
    """Reconstruct a full file from its etched chunks."""
    manifest = await db.etch_manifests.find_one(
        {"address": address, "network": network},
        {"_id": 0},
    )
    if not manifest:
        raise HTTPException(status_code=404, detail="No manifest found for this address")

    file_entry = next((f for f in manifest.get("files", []) if f["name"] == filename), None)
    if not file_entry:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not in manifest")

    assembled = bytearray()
    for txid in file_entry["txids"]:
        doc = await db.etch_chunks.find_one({"chunk_id": txid}, {"_id": 0, "hex": 1})
        if not doc:
            raise HTTPException(status_code=404, detail=f"Missing chunk: {txid}")
        assembled.extend(bytes.fromhex(doc["hex"]))

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    ct = EXTENSION_MIME.get(ext, "application/octet-stream")

    return Response(content=bytes(assembled), media_type=ct)


@router.get("/serve/{address}/{filename:path}")
async def serve_etched_file(address: str, filename: str, network: str = "btc-testnet"):
    """Serve an etched file with proper paths so relative links (CSS, JS) work.
    
    Usage: /api/etch/serve/{address}/index.html
    The HTML can reference style.css and game.js and they'll resolve to
    /api/etch/serve/{address}/style.css etc.
    """
    manifest = await db.etch_manifests.find_one(
        {"address": address, "network": network},
        {"_id": 0},
    )
    if not manifest:
        raise HTTPException(status_code=404, detail="No manifest found")

    file_entry = next((f for f in manifest.get("files", []) if f["name"] == filename), None)
    if not file_entry:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found in manifest")

    assembled = bytearray()
    for txid in file_entry["txids"]:
        doc = await db.etch_chunks.find_one({"chunk_id": txid}, {"_id": 0, "hex": 1})
        if not doc:
            raise HTTPException(status_code=404, detail=f"Missing chunk: {txid}")
        assembled.extend(bytes.fromhex(doc["hex"]))

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    ct = EXTENSION_MIME.get(ext, "application/octet-stream")

    return Response(content=bytes(assembled), media_type=ct)

class BroadcastFileRequest(BaseModel):
    filename: str
    file_hex: str  # hex-encoded file bytes
    network: str = "btc-testnet"
    keyword: Optional[str] = None  # P2FK keyword for discoverability


@router.post("/broadcast-file")
async def broadcast_file_onchain(req: BroadcastFileRequest):
    """Broadcast a file to the blockchain as a P2FK transaction using the treasury wallet.
    
    The file is encoded into P2PKH addresses (20 bytes per address),
    wrapped with a P2FK SIG header, and broadcast as a real transaction.
    Returns the txid that can be looked up on bitfossil.com or mempool.space.
    """
    from bit import PrivateKeyTestnet, PrivateKey
    from utils.p2fk import (
        build_signed_payload, encode_payload_to_addresses,
        get_keyword_address, get_random_delimiter,
    )
    from utils.blockchain import broadcast_raw_tx

    is_mainnet = 'mainnet' in req.network.lower()
    wif = os.environ.get('TREASURY_MAINNET_WIF', '') if is_mainnet else os.environ.get('TREASURY_TESTNET_WIF', '')
    if not wif:
        raise HTTPException(status_code=503, detail=f"Treasury WIF not configured for {'mainnet' if is_mainnet else 'testnet'}")

    try:
        file_bytes = bytes.fromhex(req.file_hex)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid hex data")

    file_size = len(file_bytes)
    if file_size > 50000:
        raise HTTPException(status_code=400, detail="File too large (max 50KB per transaction)")

    try:
        key = PrivateKey(wif) if is_mainnet else PrivateKeyTestnet(wif)
        sender_address = key.address
        version_byte = 0 if is_mainnet else 111

        # Build P2FK payload: <filename><d><filesize><d><raw_file_content>
        d1 = get_random_delimiter()
        d2 = get_random_delimiter()
        payload_str = f"{req.filename}{d1}{file_size}{d2}"
        # Sign the payload (P2FK SIG format)
        sig_prefix = build_signed_payload(
            payload_str + file_bytes.decode('latin-1'),
            wif, is_mainnet
        )

        # Encode into P2FK addresses
        addresses = encode_payload_to_addresses(sig_prefix, version_byte)

        # Add keyword address if specified (for search/discovery)
        if req.keyword:
            kw_addr = get_keyword_address(req.keyword, version_byte)
            if kw_addr not in addresses:
                addresses.append(kw_addr)

        # Sender address must be LAST (P2FK protocol requirement)
        if sender_address in addresses:
            addresses.remove(sender_address)
        addresses.append(sender_address)

        num_outputs = len(addresses)
        logger.info(f"Etch broadcast: {req.filename} ({file_size}B) → {num_outputs} P2FK outputs")

        # Build transaction: 546 sats (dust) to each P2FK address
        outputs = [(addr, 546, 'satoshi') for addr in addresses]

        # Fetch UTXOs and create transaction using bit library
        key.get_unspents()
        tx_hex = key.create_transaction(outputs)

        # Broadcast via mempool.space
        result = await broadcast_raw_tx(tx_hex, is_mainnet)

        if result.get('success'):
            txid = result['txid']
            logger.info(f"Etch broadcast SUCCESS: {req.filename} → txid={txid}")

            # Record in ledger
            from routes.treasury import record_ledger_entry
            dust_cost = num_outputs * 546
            await record_ledger_entry(
                "etch_expense", dust_cost, req.network,
                txid=txid, details=f"Etch: {req.filename} ({file_size}B, {num_outputs} outputs)"
            )

            # Stage locally too for reconstruction
            chunk_hash = hashlib.sha256(file_bytes).hexdigest()
            await db.etch_chunks.update_one(
                {"chunk_id": chunk_hash},
                {"$set": {
                    "chunk_id": chunk_hash,
                    "address": sender_address,
                    "network": req.network,
                    "filename": req.filename,
                    "chunk_index": 0,
                    "total_chunks": 1,
                    "size": file_size,
                    "hex": req.file_hex,
                    "staged_at": datetime.now(timezone.utc).isoformat(),
                    "broadcast": True,
                    "txid": txid,
                    "num_outputs": num_outputs,
                }},
                upsert=True,
            )

            return {
                "success": True,
                "txid": txid,
                "filename": req.filename,
                "file_size": file_size,
                "num_outputs": num_outputs,
                "dust_cost_sats": dust_cost,
                "sender": sender_address,
                "mempool_url": f"https://mempool.space/testnet/tx/{txid}",
            }
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown')}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Etch broadcast error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class MultiFileBroadcastRequest(BaseModel):
    files: list  # [{ filename, file_hex }]
    network: str = "btc-testnet"
    project_name: str = ""  # e.g. "cthulhu-breakout"
    version: str = "1.0.0"
    description: str = ""


@router.post("/broadcast-project")
async def broadcast_project_onchain(req: MultiFileBroadcastRequest):
    """Broadcast multiple files as separate on-chain P2FK transactions.
    Creates a manifest linking all file txids together.
    """
    from bit import PrivateKeyTestnet, PrivateKey
    from utils.p2fk import (
        build_signed_payload, encode_payload_to_addresses,
        get_keyword_address, get_random_delimiter,
    )
    from utils.blockchain import broadcast_raw_tx
    import asyncio

    is_mainnet = 'mainnet' in req.network.lower()
    wif = os.environ.get('TREASURY_MAINNET_WIF', '') if is_mainnet else os.environ.get('TREASURY_TESTNET_WIF', '')
    if not wif:
        raise HTTPException(status_code=503, detail=f"Treasury WIF not configured for {'mainnet' if is_mainnet else 'testnet'}")

    key = PrivateKey(wif) if is_mainnet else PrivateKeyTestnet(wif)
    sender_address = key.address
    version_byte = 0 if is_mainnet else 111

    results = []
    total_cost = 0
    file_manifest = []

    for fobj in req.files:
        fname = fobj.get("filename", "")
        fhex = fobj.get("file_hex", "")
        if not fname or not fhex:
            continue

        try:
            file_bytes = bytes.fromhex(fhex)
        except ValueError:
            results.append({"filename": fname, "success": False, "error": "Invalid hex"})
            continue

        file_size = len(file_bytes)

        try:
            # Build P2FK payload
            d1 = get_random_delimiter()
            d2 = get_random_delimiter()
            payload_str = f"{fname}{d1}{file_size}{d2}"
            full_payload = build_signed_payload(
                payload_str + file_bytes.decode('latin-1'),
                wif, is_mainnet
            )
            addresses = encode_payload_to_addresses(full_payload, version_byte)

            # Add project keyword for discovery
            if req.project_name:
                kw_addr = get_keyword_address(req.project_name, version_byte)
                if kw_addr not in addresses:
                    addresses.append(kw_addr)

            # Sender last
            if sender_address in addresses:
                addresses.remove(sender_address)
            addresses.append(sender_address)

            num_outputs = len(addresses)
            outputs = [(addr, 546, 'satoshi') for addr in addresses]

            # Refresh UTXOs before each tx (previous tx changes the set)
            key.get_unspents()
            tx_hex = key.create_transaction(outputs)
            result = await broadcast_raw_tx(tx_hex, is_mainnet)

            if result.get('success'):
                txid = result['txid']
                dust_cost = num_outputs * 546
                total_cost += dust_cost

                # Record in treasury ledger
                from routes.treasury import record_ledger_entry
                await record_ledger_entry(
                    "etch_expense", dust_cost, req.network,
                    txid=txid, details=f"Etch: {fname} ({file_size}B)"
                )

                # Stage locally
                chunk_hash = hashlib.sha256(file_bytes).hexdigest()
                await db.etch_chunks.update_one(
                    {"chunk_id": chunk_hash},
                    {"$set": {
                        "chunk_id": chunk_hash,
                        "address": sender_address,
                        "network": req.network,
                        "filename": fname,
                        "chunk_index": 0,
                        "total_chunks": 1,
                        "size": file_size,
                        "hex": fhex,
                        "staged_at": datetime.now(timezone.utc).isoformat(),
                        "broadcast": True,
                        "txid": txid,
                        "num_outputs": num_outputs,
                    }},
                    upsert=True,
                )

                file_manifest.append({
                    "name": fname,
                    "txids": [chunk_hash],
                    "chunks": 1,
                    "onchain_txid": txid,
                    "size": file_size,
                })
                results.append({
                    "filename": fname,
                    "success": True,
                    "txid": txid,
                    "num_outputs": num_outputs,
                    "dust_cost_sats": dust_cost,
                    "mempool_url": f"https://mempool.space/testnet/tx/{txid}",
                })
                logger.info(f"Etch broadcast: {fname} → {txid}")

                # Wait for mempool to settle between broadcasts
                await asyncio.sleep(15)
            else:
                results.append({"filename": fname, "success": False, "error": result.get('error', 'Broadcast failed')})

        except Exception as e:
            logger.error(f"Etch broadcast error for {fname}: {e}", exc_info=True)
            results.append({"filename": fname, "success": False, "error": str(e)})

    # Save manifest
    manifest_id = None
    if file_manifest:
        total_size = sum(f["size"] for f in file_manifest)
        manifest = {
            "address": sender_address,
            "network": req.network,
            "files": file_manifest,
            "version": req.version or "1.0.0",
            "description": req.description or f"On-chain project: {req.project_name}",
            "project_name": req.project_name,
            "total_size": total_size,
            "total_chunks": len(file_manifest),
            "onchain": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        insert_result = await db.etch_manifests.insert_one(manifest)
        manifest_id = str(insert_result.inserted_id)

    return {
        "success": all(r.get("success") for r in results),
        "manifest_id": manifest_id,
        "project_name": req.project_name,
        "files": results,
        "total_dust_cost_sats": total_cost,
        "sender": sender_address,
    }


# ─── OBJ-based Etch (BitFossil Compatible) ───

class ObjEtchRequest(BaseModel):
    """Etch files as a P2FK OBJ transaction — IPFS for delivery, blockchain for record."""
    project_name: str  # e.g. "cthulhu-breakout"
    urn: str           # unique object identifier
    name: str          # display name
    description: str = ""
    keywords: list = []  # e.g. ["game", "breakout"]
    network: str = "btc-testnet"
    # IPFS CIDs (set after uploading files)
    ipfs_dir_cid: str = ""  # CID of the IPFS directory containing the files
    ipfs_image_cid: str = ""  # CID of thumbnail/image
    # For inline etch (small files only)
    files_hex: list = []  # [{ filename, hex }] — for uploading to IPFS from backend
    # Admin wallet session
    wallet_session_id: str = ""
    wallet_address: str = ""  # Which address to sign with


@router.post("/broadcast-obj-etch")
async def broadcast_obj_etch(req: ObjEtchRequest):
    """Broadcast an etch as a standard P2FK OBJ transaction.

    This format IS indexed by bitfossil.com because it uses the standard
    OBJ<d><len><d><json> payload format with a SIG prefix.

    The OBJ points to an IPFS CID for content delivery (hybrid model).
    """
    from bit import PrivateKeyTestnet, PrivateKey
    from utils.p2fk import (
        build_signed_payload, encode_payload_to_addresses,
        get_keyword_address, get_random_delimiter, generate_safe_object_address,
    )
    from utils.blockchain import fetch_utxos_mempool, broadcast_raw_tx
    import json as json_mod

    # Determine signing key
    wif = None
    is_mainnet = 'mainnet' in req.network.lower()

    if req.wallet_session_id:
        from routes.admin_wallet import get_cached_keys
        session = get_cached_keys(req.wallet_session_id)
        if not session:
            raise HTTPException(status_code=403, detail="Wallet session expired. Please unlock again.")
        keys = session["keys"]
        if req.wallet_address and req.wallet_address in keys:
            wif = keys[req.wallet_address]
        else:
            # Use first available key
            wif = list(keys.values())[0] if keys else None

    if not wif:
        # Fallback to treasury WIF based on network
        if is_mainnet:
            wif = os.environ.get('TREASURY_MAINNET_WIF', '')
        else:
            wif = os.environ.get('TREASURY_TESTNET_WIF', '')

    if not wif:
        raise HTTPException(status_code=503, detail="No signing key available")

    try:
        key = PrivateKeyTestnet(wif) if not is_mainnet else PrivateKey(wif)
        sender_address = key.address
        version_byte = 0 if is_mainnet else 111
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signing key: {e}")

    # If files provided, upload to IPFS first
    ipfs_dir_cid = req.ipfs_dir_cid
    ipfs_image_cid = req.ipfs_image_cid

    if req.files_hex and not ipfs_dir_cid:
        ipfs_dir_cid = await _upload_files_to_ipfs(req.files_hex)

    if not ipfs_dir_cid:
        raise HTTPException(status_code=400, detail="No IPFS CID provided and no files to upload")

    # Generate a unique object address
    obj_address, _obj_wif = generate_safe_object_address(version_byte)

    # Build keyword addresses (before object and sender)
    keyword_addresses = []
    # URN keyword
    urn_addr = get_keyword_address(req.urn, version_byte)
    if urn_addr not in keyword_addresses:
        keyword_addresses.append(urn_addr)

    # Extra keywords
    for kw in req.keywords:
        clean = kw.strip().lstrip('#')
        if clean:
            kw_addr = get_keyword_address(clean, version_byte)
            if kw_addr not in keyword_addresses:
                keyword_addresses.append(kw_addr)

    # Calculate reverse indices
    # Final list: [...encoded, ...keywords, objectAddress, senderAddress]
    # Reverse: senderAddress=0, objectAddress=1
    sender_rev_idx = 0
    obj_rev_idx = 1

    # Build OBJ JSON
    obj_data = {"urn": req.urn}
    if req.name:
        obj_data["nme"] = req.name
    if req.description:
        obj_data["dsc"] = req.description
    if ipfs_image_cid:
        obj_data["img"] = f"IPFS:{ipfs_image_cid}" if not ipfs_image_cid.startswith("IPFS:") else ipfs_image_cid
    if ipfs_dir_cid:
        obj_data["uri"] = f"IPFS:{ipfs_dir_cid}" if not ipfs_dir_cid.startswith("IPFS:") else ipfs_dir_cid
    # Creator ordering: cre[0]=objectAddress, cre[1]=senderAddress
    obj_data["cre"] = [obj_rev_idx, sender_rev_idx]
    # Self-owned
    obj_data["own"] = {str(sender_rev_idx): 1}

    obj_json = json_mod.dumps(obj_data, separators=(',', ':'))
    obj_bytes_len = len(obj_json.encode('utf-8'))

    d1 = get_random_delimiter()
    d2 = get_random_delimiter()
    payload = f"OBJ{d1}{obj_bytes_len}{d2}{obj_json}"

    # Sign the payload
    signed_payload = build_signed_payload(payload, wif, is_mainnet)

    # Encode into P2FK addresses
    encoded_addresses = encode_payload_to_addresses(signed_payload, version_byte)

    # Build full address list
    full_list = list(encoded_addresses)
    for kw_addr in keyword_addresses:
        if kw_addr not in full_list:
            full_list.append(kw_addr)

    # CLEANUP: remove obj_address and sender_address, re-add at end
    while obj_address in full_list:
        full_list.remove(obj_address)
    while sender_address in full_list:
        full_list.remove(sender_address)

    full_list.append(obj_address)      # second-to-last
    full_list.append(sender_address)   # LAST

    num_outputs = len(full_list)
    logger.info(f"OBJ Etch: {req.name} (urn={req.urn}) → {num_outputs} P2FK outputs, IPFS={ipfs_dir_cid[:20]}...")

    # Build and broadcast transaction
    try:
        outputs = [(addr, 546, 'satoshi') for addr in full_list]

        # Fetch UTXOs via mempool.space (bit's built-in API is unreliable for testnet)
        from utils.blockchain import fetch_utxos_mempool
        utxos = await fetch_utxos_mempool(sender_address, is_mainnet=is_mainnet)
        if not utxos:
            raise HTTPException(status_code=400, detail=f"No UTXOs found for {sender_address}")
        key._unspents = utxos

        tx_hex = key.create_transaction(outputs)
        result = await broadcast_raw_tx(tx_hex, is_mainnet)

        if result.get('success'):
            txid = result['txid']
            dust_cost = num_outputs * 546
            logger.info(f"OBJ Etch SUCCESS: {req.name} → txid={txid}")

            # Record in treasury ledger
            from routes.treasury import record_ledger_entry
            await record_ledger_entry(
                "etch_expense", dust_cost, req.network,
                txid=txid, details=f"OBJ Etch: {req.name} ({num_outputs} outputs)"
            )

            # Record in wallet history
            try:
                from routes.admin_wallet import record_wallet_tx
                await record_wallet_tx(txid, "etch_obj", dust_cost, sender_address,
                                       f"OBJ Etch: {req.name} (IPFS: {ipfs_dir_cid[:20]}...)")
            except Exception:
                pass

            # Store manifest
            manifest = {
                "address": sender_address,
                "object_address": obj_address,
                "network": req.network,
                "project_name": req.project_name,
                "urn": req.urn,
                "name": req.name,
                "description": req.description,
                "ipfs_dir_cid": ipfs_dir_cid,
                "ipfs_image_cid": ipfs_image_cid,
                "keywords": req.keywords,
                "txid": txid,
                "obj_json": obj_json,
                "num_outputs": num_outputs,
                "dust_cost_sats": dust_cost,
                "format": "obj_p2fk",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.etch_manifests.insert_one(manifest)

            explorer_base = "https://mempool.space" + ("/testnet" if not is_mainnet else "")

            return {
                "success": True,
                "txid": txid,
                "object_address": obj_address,
                "sender": sender_address,
                "ipfs_cid": ipfs_dir_cid,
                "ipfs_gateway": f"https://ipfs.io/ipfs/{ipfs_dir_cid}",
                "bitfossil_url": f"https://bitfossil.com/{txid}/index.htm",
                "mempool_url": f"{explorer_base}/tx/{txid}",
                "num_outputs": num_outputs,
                "dust_cost_sats": dust_cost,
                "obj_json": obj_json,
            }
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown')}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OBJ Etch broadcast error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _upload_files_to_ipfs(files_hex: list) -> str:
    """Upload multiple files to IPFS as a directory. Returns the directory CID."""
    import tempfile

    KUBO_API = "http://127.0.0.1:5001/api/v0"
    client = get_client()

    tmp_files = []
    try:
        # Write hex files to temp
        for fobj in files_hex:
            fname = fobj.get("filename", "file")
            fhex = fobj.get("hex", "")
            if not fhex:
                continue
            file_bytes = bytes.fromhex(fhex)
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{fname}")
            tmp.write(file_bytes)
            tmp.close()
            tmp_files.append({"path": tmp.name, "name": fname})

        if not tmp_files:
            raise HTTPException(status_code=400, detail="No valid files to upload")

        # Upload as wrapped directory
        file_tuples = []
        for tf in tmp_files:
            file_tuples.append(("file", (tf["name"], open(tf["path"], "rb"))))

        resp = await client.post(
            f"{KUBO_API}/add?wrap-with-directory=true",
            files=file_tuples,
            timeout=120.0,
        )

        # Close file handles
        for _, (_, fh) in file_tuples:
            fh.close()

        if resp.status_code == 200:
            lines = resp.text.strip().split('\n')
            dir_cid = None
            for line in lines:
                import json as json_mod
                entry = json_mod.loads(line)
                if entry.get("Name") == "":
                    dir_cid = entry.get("Hash", "")
            return dir_cid or ""
        else:
            raise HTTPException(status_code=502, detail=f"IPFS upload failed: {resp.text}")

    finally:
        for tf in tmp_files:
            try:
                os.unlink(tf["path"])
            except Exception:
                pass


# ─── Admin endpoints ───

def _get_admin_verify():
    """Import admin verification lazily to avoid circular imports."""
    from routes.admin import _verify_admin
    return _verify_admin


@router.get("/admin/list")
async def admin_list_etches(
    network: str = "btc-testnet",
    skip: int = 0,
    limit: int = 50,
    _=Depends(_get_admin_verify()),
):
    """Admin: list all etched manifests with stats."""
    query = {}
    if network:
        query["network"] = network

    cursor = db.etch_manifests.find(query).sort("created_at", -1).skip(skip).limit(limit)
    manifests = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        manifests.append(doc)

    total = await db.etch_manifests.count_documents(query)

    # Aggregate stats
    total_chunks = await db.etch_chunks.count_documents({})
    pipeline = [{"$group": {"_id": None, "total_bytes": {"$sum": "$size"}}}]
    agg = await db.etch_chunks.aggregate(pipeline).to_list(1)
    total_bytes = agg[0]["total_bytes"] if agg else 0

    return {
        "manifests": manifests,
        "total": total,
        "stats": {
            "total_manifests": total,
            "total_chunks_stored": total_chunks,
            "total_bytes_stored": total_bytes,
        },
    }


class VersionUpdate(BaseModel):
    version: Optional[str] = None
    description: Optional[str] = None


@router.put("/admin/manifest/{manifest_id}")
async def admin_update_manifest(
    manifest_id: str,
    body: VersionUpdate,
    _=Depends(_get_admin_verify()),
):
    """Admin: update manifest version/description."""
    from bson import ObjectId
    try:
        oid = ObjectId(manifest_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid manifest ID")

    update = {}
    if body.version is not None:
        update["version"] = body.version
    if body.description is not None:
        update["description"] = body.description

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")

    result = await db.etch_manifests.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Manifest not found")

    return {"success": True}


@router.delete("/admin/manifest/{manifest_id}")
async def admin_delete_manifest(
    manifest_id: str,
    _=Depends(_get_admin_verify()),
):
    """Admin: delete a manifest and all its associated chunks."""
    from bson import ObjectId
    try:
        oid = ObjectId(manifest_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid manifest ID")

    manifest = await db.etch_manifests.find_one({"_id": oid})
    if not manifest:
        raise HTTPException(status_code=404, detail="Manifest not found")

    # Collect all chunk IDs from the manifest
    chunk_ids = []
    for f in manifest.get("files", []):
        chunk_ids.extend(f.get("txids", []))

    # Delete chunks
    if chunk_ids:
        del_result = await db.etch_chunks.delete_many({"chunk_id": {"$in": chunk_ids}})
        deleted_chunks = del_result.deleted_count
    else:
        deleted_chunks = 0

    # Delete manifest
    await db.etch_manifests.delete_one({"_id": oid})

    return {"success": True, "deleted_chunks": deleted_chunks}
