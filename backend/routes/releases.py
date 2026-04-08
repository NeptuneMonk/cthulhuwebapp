"""Release Management — Mint release profiles and publish app updates as on-chain OBJ objects.

Flow:
1. Admin mints a "cthulhurelease" profile (PRO format, one-time setup)
2. Admin uploads build zip + cover image to IPFS
3. Admin etches a release OBJ on-chain pointing to those IPFS CIDs
4. Public endpoint lets users check for the latest release
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging
import os
import json

from db_sqlite import get_conn
from utils.p2fk import (
    build_signed_payload, encode_payload_to_addresses,
    get_keyword_address, get_random_delimiter, generate_safe_object_address,
)
from utils.blockchain import fetch_utxos_mempool, broadcast_raw_tx

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/releases")


def _get_admin_verify():
    from routes.admin import _verify_admin
    return _verify_admin


# ─── SQLite Table Init ───

async def _ensure_tables():
    conn = await get_conn()
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS release_config (
            key TEXT PRIMARY KEY DEFAULT 'config',
            data TEXT NOT NULL DEFAULT '{}'
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS releases (
            _id TEXT PRIMARY KEY,
            version TEXT DEFAULT '',
            name TEXT DEFAULT '',
            network TEXT DEFAULT '',
            published_at TEXT DEFAULT '',
            data TEXT NOT NULL DEFAULT '{}'
        )
    """)
    # Ensure columns exist (handles migration from older schema)
    for col, col_type in [("version", "TEXT DEFAULT ''"), ("name", "TEXT DEFAULT ''"),
                           ("network", "TEXT DEFAULT ''"), ("published_at", "TEXT DEFAULT ''"),
                           ("data", "TEXT DEFAULT '{}'")]:
        try:
            await conn.execute(f"ALTER TABLE releases ADD COLUMN {col} {col_type}")
        except Exception:
            pass  # Column already exists
    await conn.commit()


async def _get_config() -> dict:
    await _ensure_tables()
    conn = await get_conn()
    async with conn.execute("SELECT data FROM release_config WHERE _id = 'config'") as cur:
        row = await cur.fetchone()
    if row:
        return json.loads(row[0])
    return {"release_profile_urn": "cthulhurelease", "release_address": "", "profile_minted": False}


async def _set_config(updates: dict):
    await _ensure_tables()
    config = await _get_config()
    config.update(updates)
    conn = await get_conn()
    await conn.execute(
        "INSERT OR REPLACE INTO release_config (_id, data) VALUES ('config', ?)",
        (json.dumps(config),)
    )
    await conn.commit()
    return config


async def _insert_release(doc: dict):
    await _ensure_tables()
    import uuid
    rid = uuid.uuid4().hex
    conn = await get_conn()
    await conn.execute(
        "INSERT INTO releases (_id, version, name, network, published_at, data) VALUES (?, ?, ?, ?, ?, ?)",
        (rid, doc.get("version", ""), doc.get("name", ""), doc.get("network", ""),
         doc.get("published_at", ""), json.dumps(doc))
    )
    await conn.commit()


async def _get_releases(network: str = "", limit: int = 20) -> list:
    await _ensure_tables()
    conn = await get_conn()
    if network:
        async with conn.execute(
            "SELECT data FROM releases WHERE network = ? ORDER BY published_at DESC LIMIT ?",
            (network, limit)
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with conn.execute(
            "SELECT data FROM releases ORDER BY published_at DESC LIMIT ?",
            (limit,)
        ) as cur:
            rows = await cur.fetchall()
    return [json.loads(r[0]) for r in rows]


async def _get_latest_release(network: str) -> Optional[dict]:
    await _ensure_tables()
    conn = await get_conn()
    async with conn.execute(
        "SELECT data FROM releases WHERE network = ? ORDER BY published_at DESC LIMIT 1",
        (network,)
    ) as cur:
        row = await cur.fetchone()
    if row:
        return json.loads(row[0])
    return None


# ─── Models ───

class ReleaseConfigUpdate(BaseModel):
    release_profile_urn: Optional[str] = None
    release_address: Optional[str] = None
    release_wif_session_id: Optional[str] = None


class MintProfileRequest(BaseModel):
    urn: str = "cthulhurelease"
    display_name: str = "Cthulhu Releases"
    bio: str = "Official Cthulhu application releases"
    image_cid: str = ""
    wallet_session_id: str = ""
    wallet_address: str = ""
    network: str = "btc-testnet"


class PublishReleaseRequest(BaseModel):
    version: str
    name: str = ""
    description: str = ""
    changelog: str = ""
    zip_cid: str = ""
    image_cid: str = ""
    keywords: list = []
    wallet_session_id: str = ""
    wallet_address: str = ""
    network: str = "btc-testnet"
    platforms: dict = {}  # {"windows": {"url":"...", "filename":"...", "size":"..."}, ...}


class SetPlatformUrlsRequest(BaseModel):
    """Set download URLs for each platform on an existing release."""
    version: str
    platforms: dict  # {"windows": {"url":"...", "filename":"...", "size":"..."}, ...}


# ─── Config ───

@router.get("/config")
async def get_release_config(_=Depends(_get_admin_verify())):
    return await _get_config()


@router.put("/config")
async def update_release_config(body: ReleaseConfigUpdate, _=Depends(_get_admin_verify())):
    update = {}
    if body.release_profile_urn is not None:
        update["release_profile_urn"] = body.release_profile_urn
    if body.release_address is not None:
        update["release_address"] = body.release_address
    if update:
        return await _set_config(update)
    return await _get_config()


# ─── Mint Release Profile (PRO format) ───

@router.post("/mint-profile")
async def mint_release_profile(req: MintProfileRequest, _=Depends(_get_admin_verify())):
    """Mint a P2FK PRO (profile) transaction for the release channel."""
    from bit import PrivateKeyTestnet, PrivateKey
    import coincurve

    is_mainnet = 'mainnet' in req.network.lower()
    version_byte = 0 if is_mainnet else 111

    wif = _resolve_wif(req.wallet_session_id, req.wallet_address, is_mainnet)
    if not wif:
        raise HTTPException(status_code=403, detail="No signing key available. Unlock the admin wallet first.")

    try:
        key = PrivateKey(wif) if is_mainnet else PrivateKeyTestnet(wif)
        sender_address = key.address
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid key: {e}")

    privkey_bytes = key.to_bytes()
    pk = coincurve.PublicKey.from_secret(privkey_bytes)
    uncompressed = pk.format(compressed=False)
    pkx_hex = uncompressed[1:33].hex()
    pky_hex = uncompressed[33:65].hex()

    pro_data = {"urn": req.urn}
    if req.display_name:
        pro_data["dnm"] = req.display_name
    if req.bio:
        pro_data["bio"] = req.bio
    if req.image_cid:
        pro_data["img"] = f"IPFS:{req.image_cid}" if not req.image_cid.startswith("IPFS:") else req.image_cid
    pro_data["pkx"] = pkx_hex
    pro_data["pky"] = pky_hex
    pro_data["cre"] = ["0"]

    pro_json = json.dumps(pro_data, separators=(',', ':'))
    pro_bytes_len = len(pro_json.encode('utf-8'))

    d1 = get_random_delimiter()
    d2 = get_random_delimiter()
    payload = f"PRO{d1}{pro_bytes_len}{d2}{pro_json}"

    signed_payload = build_signed_payload(payload, wif, is_mainnet)
    encoded_addresses = encode_payload_to_addresses(signed_payload, version_byte)

    urn_addr = get_keyword_address(req.urn, version_byte)
    if urn_addr not in encoded_addresses:
        encoded_addresses.append(urn_addr)

    while sender_address in encoded_addresses:
        encoded_addresses.remove(sender_address)
    encoded_addresses.append(sender_address)

    num_outputs = len(encoded_addresses)
    logger.info(f"Release PRO mint: {req.urn} -> {num_outputs} outputs from {sender_address}")

    try:
        outputs = [(addr, 546, 'satoshi') for addr in encoded_addresses]
        utxos = await fetch_utxos_mempool(sender_address, is_mainnet=is_mainnet)
        if not utxos:
            raise HTTPException(status_code=400, detail=f"No UTXOs for {sender_address}. Fund this address first.")
        key._unspents = utxos
        tx_hex = key.create_transaction(outputs)
        result = await broadcast_raw_tx(tx_hex, is_mainnet)

        if result.get('success'):
            txid = result['txid']
            dust_cost = num_outputs * 546
            logger.info(f"Release PRO mint SUCCESS: {req.urn} -> txid={txid}")

            try:
                from routes.treasury import record_ledger_entry
                await record_ledger_entry(
                    "release_profile_mint", dust_cost, req.network,
                    txid=txid, details=f"Release profile: {req.urn}"
                )
            except Exception:
                pass

            await _set_config({
                "release_profile_urn": req.urn,
                "release_address": sender_address,
                "profile_minted": True,
                "profile_txid": txid,
                "profile_network": req.network,
                "minted_at": datetime.now(timezone.utc).isoformat(),
            })

            explorer_base = "https://mempool.space" + ("/testnet" if not is_mainnet else "")
            return {
                "success": True,
                "txid": txid,
                "address": sender_address,
                "urn": req.urn,
                "num_outputs": num_outputs,
                "dust_cost_sats": dust_cost,
                "mempool_url": f"{explorer_base}/tx/{txid}",
                "pro_json": pro_json,
            }
        else:
            raise HTTPException(status_code=500, detail=f"Broadcast failed: {result.get('error', 'Unknown')}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Release PRO mint error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Publish Release (OBJ format) ───

@router.post("/publish")
async def publish_release(req: PublishReleaseRequest, _=Depends(_get_admin_verify())):
    """Publish a release as a P2FK OBJ transaction, owned by the release profile."""
    from bit import PrivateKeyTestnet, PrivateKey

    is_mainnet = 'mainnet' in req.network.lower()
    version_byte = 0 if is_mainnet else 111

    wif = _resolve_wif(req.wallet_session_id, req.wallet_address, is_mainnet)
    if not wif:
        raise HTTPException(status_code=403, detail="No signing key available. Unlock the admin wallet first.")

    try:
        key = PrivateKey(wif) if is_mainnet else PrivateKeyTestnet(wif)
        sender_address = key.address
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid key: {e}")

    if not req.zip_cid and not req.image_cid:
        raise HTTPException(status_code=400, detail="At least a zip CID or image CID is required.")

    config = await _get_config()
    release_urn = config.get("release_profile_urn", "cthulhurelease")

    obj_address, _obj_wif = generate_safe_object_address(version_byte)

    keyword_addresses = []
    release_kw = get_keyword_address(release_urn, version_byte)
    if release_kw not in keyword_addresses:
        keyword_addresses.append(release_kw)

    ver_urn = f"{release_urn}-{req.version}"
    ver_kw = get_keyword_address(ver_urn, version_byte)
    if ver_kw not in keyword_addresses:
        keyword_addresses.append(ver_kw)

    for kw in req.keywords:
        clean = kw.strip().lstrip('#')
        if clean:
            kw_addr = get_keyword_address(clean, version_byte)
            if kw_addr not in keyword_addresses:
                keyword_addresses.append(kw_addr)

    sender_rev_idx = 0
    obj_rev_idx = 1

    obj_data = {"urn": ver_urn}
    release_name = req.name or f"Cthulhu {req.version}"
    obj_data["nme"] = release_name

    desc_parts = []
    if req.description:
        desc_parts.append(req.description)
    if req.changelog:
        desc_parts.append(f"Changelog:\n{req.changelog}")
    if req.zip_cid:
        desc_parts.append(f"Download: IPFS:{req.zip_cid}")
    obj_data["dsc"] = "\n\n".join(desc_parts) if desc_parts else f"Cthulhu release {req.version}"

    if req.image_cid:
        obj_data["img"] = f"IPFS:{req.image_cid}" if not req.image_cid.startswith("IPFS:") else req.image_cid
    if req.zip_cid:
        obj_data["uri"] = f"IPFS:{req.zip_cid}" if not req.zip_cid.startswith("IPFS:") else req.zip_cid

    obj_data["cre"] = [obj_rev_idx, sender_rev_idx]
    obj_data["own"] = {str(sender_rev_idx): 1}

    obj_json = json.dumps(obj_data, separators=(',', ':'))
    obj_bytes_len = len(obj_json.encode('utf-8'))

    d1 = get_random_delimiter()
    d2 = get_random_delimiter()
    payload = f"OBJ{d1}{obj_bytes_len}{d2}{obj_json}"

    signed_payload = build_signed_payload(payload, wif, is_mainnet)
    encoded_addresses = encode_payload_to_addresses(signed_payload, version_byte)

    full_list = list(encoded_addresses)
    for kw_addr in keyword_addresses:
        if kw_addr not in full_list:
            full_list.append(kw_addr)

    while obj_address in full_list:
        full_list.remove(obj_address)
    while sender_address in full_list:
        full_list.remove(sender_address)
    full_list.append(obj_address)
    full_list.append(sender_address)

    num_outputs = len(full_list)
    logger.info(f"Release OBJ: {release_name} (v{req.version}) -> {num_outputs} outputs, zip={req.zip_cid[:20] if req.zip_cid else 'none'}...")

    try:
        outputs = [(addr, 546, 'satoshi') for addr in full_list]
        utxos = await fetch_utxos_mempool(sender_address, is_mainnet=is_mainnet)
        if not utxos:
            raise HTTPException(status_code=400, detail=f"No UTXOs for {sender_address}. Fund this address first.")
        key._unspents = utxos
        tx_hex = key.create_transaction(outputs)
        result = await broadcast_raw_tx(tx_hex, is_mainnet)

        if result.get('success'):
            txid = result['txid']
            dust_cost = num_outputs * 546
            logger.info(f"Release OBJ SUCCESS: {release_name} -> txid={txid}")

            try:
                from routes.treasury import record_ledger_entry
                await record_ledger_entry(
                    "release_etch", dust_cost, req.network,
                    txid=txid, details=f"Release: {release_name} v{req.version}"
                )
            except Exception:
                pass

            release_doc = {
                "version": req.version,
                "name": release_name,
                "description": req.description,
                "changelog": req.changelog,
                "zip_cid": req.zip_cid,
                "image_cid": req.image_cid,
                "txid": txid,
                "object_address": obj_address,
                "sender_address": sender_address,
                "network": req.network,
                "num_outputs": num_outputs,
                "dust_cost_sats": dust_cost,
                "obj_json": obj_json,
                "keywords": req.keywords,
                "platforms": req.platforms,
                "published_at": datetime.now(timezone.utc).isoformat(),
            }
            await _insert_release(release_doc)

            explorer_base = "https://mempool.space" + ("/testnet" if not is_mainnet else "")
            return {
                "success": True,
                "txid": txid,
                "object_address": obj_address,
                "sender": sender_address,
                "version": req.version,
                "name": release_name,
                "zip_cid": req.zip_cid,
                "image_cid": req.image_cid,
                "ipfs_gateway": f"https://ipfs.io/ipfs/{req.zip_cid}" if req.zip_cid else "",
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
        logger.error(f"Release OBJ error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── List & Latest ───

@router.post("/set-platform-urls")
async def set_platform_urls(req: SetPlatformUrlsRequest, _=Depends(_get_admin_verify())):
    """Update per-platform download URLs for an existing release."""
    await _ensure_tables()
    conn = await get_conn()
    async with conn.execute(
        "SELECT data FROM releases WHERE version = ? ORDER BY published_at DESC LIMIT 1",
        (req.version,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, f"Release {req.version} not found")

    release = json.loads(row[0])
    release["platforms"] = req.platforms
    await conn.execute(
        "UPDATE releases SET data = ? WHERE version = ?",
        (json.dumps(release), req.version)
    )
    await conn.commit()
    return {"success": True, "version": req.version, "platforms": req.platforms}


class QuickReleaseRequest(BaseModel):
    """Create a release without on-chain etching — just metadata."""
    version: str
    name: str = ""
    description: str = ""
    changelog: str = ""
    network: str = "btc-testnet"


@router.post("/quick-publish")
async def quick_publish_release(req: QuickReleaseRequest, _=Depends(_get_admin_verify())):
    """
    Create a release record without etching on-chain.
    Use this when you just want to make a desktop binary downloadable.
    Upload the binary with /upload-binary, or set URLs with /set-platform-urls.
    """
    await _ensure_tables()
    release_doc = {
        "version": req.version,
        "name": req.name or f"Cthulhu Desktop v{req.version}",
        "description": req.description,
        "changelog": req.changelog,
        "zip_cid": "",
        "image_cid": "",
        "txid": "",
        "object_address": "",
        "sender_address": "",
        "network": req.network,
        "platforms": {},
        "published_at": datetime.now(timezone.utc).isoformat(),
    }
    await _insert_release(release_doc)
    return {"success": True, "version": req.version, "message": "Release created. Upload binaries with /upload-binary."}


@router.get("")
async def list_releases(network: str = "", limit: int = 20, _=Depends(_get_admin_verify())):
    """Admin: list all published releases."""
    releases = await _get_releases(network, limit)
    return {"releases": releases, "count": len(releases)}


# ─── Public endpoint (no auth required) ───

public_router = APIRouter(prefix="/api/releases")


@public_router.get("/latest")
async def get_latest_release(network: str = "btc-testnet"):
    """Public: get the latest published release for users to check for updates."""
    release = await _get_latest_release(network)
    if not release:
        return {"available": False}
    return {
        "available": True,
        "version": release.get("version"),
        "name": release.get("name"),
        "description": release.get("description"),
        "changelog": release.get("changelog"),
        "zip_cid": release.get("zip_cid"),
        "image_cid": release.get("image_cid"),
        "txid": release.get("txid"),
        "download_url": f"https://ipfs.io/ipfs/{release['zip_cid']}" if release.get("zip_cid") else "",
        "platforms": release.get("platforms", {}),
        "published_at": release.get("published_at"),
    }


# ─── Desktop Binary Upload & Download ───

import shutil
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse

DESKTOP_BUILDS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "desktop_builds")
os.makedirs(DESKTOP_BUILDS_DIR, exist_ok=True)


@router.post("/upload-binary")
async def upload_desktop_binary(
    platform: str = Form(...),
    version: str = Form("0.1.0"),
    file: UploadFile = File(...),
    _=Depends(_get_admin_verify()),
):
    """Upload a built desktop binary (.msi, .dmg, .AppImage) for a platform."""
    valid_platforms = ["windows", "mac_arm", "mac_intel", "linux"]
    if platform not in valid_platforms:
        raise HTTPException(400, f"Invalid platform. Use: {valid_platforms}")

    # Save the file
    filename = file.filename or f"cthulhu-{version}-{platform}"
    dest = os.path.join(DESKTOP_BUILDS_DIR, filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size = os.path.getsize(dest)
    size_str = f"{file_size / (1024*1024):.1f}MB"

    # Auto-update the release platforms with the served URL
    await _ensure_tables()
    release = await _get_latest_release("btc-testnet")
    if release:
        platforms = release.get("platforms", {})
        platforms[platform] = {
            "url": f"/api/releases/download/{filename}",
            "filename": filename,
            "size": size_str,
        }
        release["platforms"] = platforms
        conn = await get_conn()
        await conn.execute(
            "UPDATE releases SET data = ? WHERE version = ?",
            (json.dumps(release), release.get("version", version))
        )
        await conn.commit()

    logger.info(f"Desktop binary uploaded: {filename} ({size_str})")
    return {
        "success": True,
        "platform": platform,
        "filename": filename,
        "size": size_str,
        "download_url": f"/api/releases/download/{filename}",
    }


@public_router.get("/download/{filename}")
async def download_desktop_binary(filename: str):
    """Serve a desktop binary for download."""
    # Sanitize filename
    safe_name = os.path.basename(filename)
    filepath = os.path.join(DESKTOP_BUILDS_DIR, safe_name)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Build not found")

    # Determine content type
    ext = os.path.splitext(safe_name)[1].lower()
    media_types = {
        ".msi": "application/x-msi",
        ".exe": "application/x-msdownload",
        ".dmg": "application/x-apple-diskimage",
        ".appimage": "application/x-executable",
        ".deb": "application/vnd.debian.binary-package",
        ".zip": "application/zip",
        ".tar.gz": "application/gzip",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=safe_name,
        headers={"Content-Disposition": f"attachment; filename={safe_name}"},
    )


# ─── Helper ───

def _resolve_wif(session_id: str, wallet_address: str, is_mainnet: bool) -> str:
    """Resolve a WIF from admin wallet session or treasury env."""
    if session_id:
        from routes.admin_wallet import get_cached_keys
        session = get_cached_keys(session_id)
        if session:
            keys = session["keys"]
            if wallet_address and wallet_address in keys:
                return keys[wallet_address]
            if keys:
                return list(keys.values())[0]
    if is_mainnet:
        return os.environ.get('TREASURY_MAINNET_WIF', '')
    return os.environ.get('TREASURY_TESTNET_WIF', '')


# ─── Build & Package ───

class BuildRequest(BaseModel):
    version: str = "1.0.0"


@router.post("/build")
async def build_package(req: BuildRequest, _=Depends(_get_admin_verify())):
    """Build the desktop package (yarn build + zip). Returns download URL."""
    import subprocess
    version = req.version
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "dist")
    zip_path = os.path.join(dist_dir, f"cthulhu-v{version}.zip")

    if os.path.exists(zip_path):
        size = os.path.getsize(zip_path)
        return {
            "success": True,
            "already_built": True,
            "filename": f"cthulhu-v{version}.zip",
            "size_mb": round(size / 1024 / 1024, 1),
            "download_url": f"/api/download/cthulhu-v{version}.zip",
        }

    build_script = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "build_package.py")
    if not os.path.exists(build_script):
        raise HTTPException(status_code=404, detail="Build script not found")

    try:
        result = subprocess.run(
            ["python3", build_script, "--version", version],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            logger.error(f"Build failed: {result.stderr[-500:]}")
            raise HTTPException(status_code=500, detail=f"Build failed: {result.stderr[-200:]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Build timed out (5 min)")

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=500, detail="Build completed but zip not found")

    size = os.path.getsize(zip_path)
    return {
        "success": True,
        "already_built": False,
        "filename": f"cthulhu-v{version}.zip",
        "size_mb": round(size / 1024 / 1024, 1),
        "download_url": f"/api/download/cthulhu-v{version}.zip",
    }


@router.get("/packages")
async def list_packages(_=Depends(_get_admin_verify())):
    """List available built packages."""
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "dist")
    packages = []
    if os.path.exists(dist_dir):
        for f in sorted(os.listdir(dist_dir), reverse=True):
            if f.endswith('.zip'):
                fp = os.path.join(dist_dir, f)
                packages.append({
                    "filename": f,
                    "size_mb": round(os.path.getsize(fp) / 1024 / 1024, 1),
                    "download_url": f"/api/download/{f}",
                    "created_at": datetime.fromtimestamp(os.path.getmtime(fp), timezone.utc).isoformat(),
                })
    return {"packages": packages}
