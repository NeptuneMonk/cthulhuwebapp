"""GIF search routes: discover GIF content from P2FK roots + Giphy API."""
import re
import os
import logging
from utils.http_pool import get_client
from fastapi import APIRouter

from utils.helpers import p2fk_get, fetch_roots_by_address

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

GIPHY_API_KEY = os.environ.get('GIPHY_API_KEY', '')
GIPHY_BASE_URL = "https://api.giphy.com/v1/gifs"

GIF_RE = re.compile(r'<<([^>]*?\.gif\s*)>>', re.IGNORECASE)
HTTP_GIF_RE = re.compile(r'(https?://[^\s<>]+\.gif)', re.IGNORECASE)


def _extract_gifs_from_roots(roots: list) -> list[dict]:
    """Scan roots for GIF references in messages and file attachments."""
    seen = set()
    gifs = []

    for root in roots:
        txid = root.get('TransactionId', '')
        messages = root.get('Message', [])
        files = root.get('File', {})

        for msg in messages:
            for match in GIF_RE.findall(msg):
                ref = match.strip()
                if ref not in seen:
                    seen.add(ref)
                    gifs.append(_build_gif_entry(ref, txid))

            for match in HTTP_GIF_RE.findall(msg):
                ref = match.strip()
                if ref not in seen:
                    seen.add(ref)
                    gifs.append({"ref": ref, "url": ref, "source": "url", "txid": txid})

        for fname in files.keys():
            if fname.upper() == 'SIG':
                continue
            if fname.lower().endswith('.gif'):
                ref = f"{txid}\\{fname}"
                if ref not in seen:
                    seen.add(ref)
                    gifs.append(_build_gif_entry(ref, txid))

    gifs.reverse()
    return gifs


def _build_gif_entry(ref: str, txid: str) -> dict:
    """Convert a raw GIF reference string to a display-ready entry."""
    upper = ref.upper()

    if upper.startswith('IPFS:'):
        raw = ref[5:]
        parts = re.split(r'[\\/]', raw)
        cid = parts[0]
        filename = '/'.join(parts[1:]) if len(parts) > 1 else ''
        url = f"https://ipfs.io/ipfs/{cid}/{filename}" if filename else f"https://ipfs.io/ipfs/{cid}"
        return {"ref": ref, "url": url, "source": "ipfs", "cid": cid, "txid": txid}

    for prefix in ('BTC:', 'LTC:', 'MZC:', 'DOG:'):
        if upper.startswith(prefix):
            chain = prefix[:-1]
            rest = ref[4:]
            parts = re.split(r'[\\/]', rest)
            tx = parts[0]
            fname = '/'.join(parts[1:]) if len(parts) > 1 else ''
            return {"ref": ref, "url": f"/api/onchain/file/{tx}/{fname}", "source": "onchain", "chain": chain, "txid": tx}

    if upper.startswith('HTTP'):
        return {"ref": ref, "url": ref, "source": "url", "txid": txid}

    parts = re.split(r'[\\/]', ref)
    if len(parts) >= 2 and len(parts[0]) == 64:
        tx = parts[0]
        fname = '/'.join(parts[1:])
        return {"ref": ref, "url": f"/api/onchain/file/{tx}/{fname}", "source": "onchain", "chain": "BTC", "txid": tx}

    return {"ref": ref, "url": ref, "source": "unknown", "txid": txid}


@router.get("/gifs/search/{keyword}")
async def search_gifs(keyword: str, network: str = 'btc-testnet'):
    """Search for GIFs by keyword using the P2FK protocol."""
    is_mainnet = 'mainnet' in network.lower()

    try:
        addr = keyword if len(keyword) > 20 else None

        if not addr:
            profile = await p2fk_get(f"GetProfileByURN/{keyword}", is_mainnet)
            if profile and isinstance(profile, dict) and profile.get('Creators'):
                addr = profile['Creators'][0]

        if not addr:
            addr_data = await p2fk_get(f"GetPublicAddressByKeyword/{keyword}", is_mainnet)
            if isinstance(addr_data, str) and addr_data:
                addr = addr_data

        if not addr:
            return {"gifs": [], "keyword": keyword, "count": 0}

        roots = await fetch_roots_by_address(addr, is_mainnet)
        gifs = _extract_gifs_from_roots(roots)

        return {"gifs": gifs, "keyword": keyword, "address": addr, "count": len(gifs)}

    except Exception as e:
        logger.error(f"GIF search error for '{keyword}': {e}")
        return {"gifs": [], "keyword": keyword, "count": 0, "error": str(e)}


@router.get("/gifs/giphy/trending")
async def trending_giphy(limit: int = 20):
    """Get trending GIFs from Giphy."""
    if not GIPHY_API_KEY:
        return {"gifs": [], "count": 0, "error": "Giphy API key not configured"}

    try:
        client = get_client()
        resp = await client.get(f"{GIPHY_BASE_URL}/trending", params={
            "api_key": GIPHY_API_KEY,
            "limit": min(limit, 30),
            "rating": "g",
        }, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()

        gifs = []
        for result in data.get("data", []):
            images = result.get("images", {})
            fixed_small = images.get("fixed_height_small", {})
            original = images.get("original", {})
            if original.get("url"):
                gifs.append({
                    "ref": original["url"],
                    "url": fixed_small.get("url") or original["url"],
                    "full_url": original["url"],
                    "source": "giphy",
                    "giphy_id": result.get("id", ""),
                    "title": result.get("title", ""),
                })

        return {"gifs": gifs, "count": len(gifs)}

    except Exception as e:
        logger.error(f"Giphy trending error: {e}")
        return {"gifs": [], "count": 0, "error": str(e)}


@router.get("/gifs/giphy/{keyword}")
async def search_giphy(keyword: str, limit: int = 20):
    """Search Giphy API for GIFs."""
    if not GIPHY_API_KEY:
        return {"gifs": [], "keyword": keyword, "count": 0, "error": "Giphy API key not configured"}

    try:
        client = get_client()
        resp = await client.get(f"{GIPHY_BASE_URL}/search", params={
            "api_key": GIPHY_API_KEY,
            "q": keyword,
            "limit": min(limit, 30),
            "rating": "g",
        }, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()

        gifs = []
        for result in data.get("data", []):
            images = result.get("images", {})
            fixed_small = images.get("fixed_height_small", {})
            original = images.get("original", {})
            if original.get("url"):
                gifs.append({
                    "ref": original["url"],
                    "url": fixed_small.get("url") or original["url"],
                    "full_url": original["url"],
                    "source": "giphy",
                    "giphy_id": result.get("id", ""),
                    "title": result.get("title", ""),
                })

        return {"gifs": gifs, "keyword": keyword, "count": len(gifs)}

    except Exception as e:
        logger.error(f"Giphy search error for '{keyword}': {e}")
        return {"gifs": [], "keyword": keyword, "count": 0, "error": str(e)}


@router.post("/gifs/giphy/pin")
async def pin_giphy_gif(body: dict):
    """Download a Giphy GIF and upload to local IPFS daemon, returning the CID.
    This makes Giphy GIFs discoverable on SUP via IPFS references.
    Body: { "url": "https://media.giphy.com/...", "filename": "funny.gif" }
    """
    url = body.get("url", "")
    filename = body.get("filename", "giphy.gif")
    if not url:
        return {"error": "No URL provided"}

    try:
        client = get_client()
        resp = await client.get(url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        gif_bytes = resp.content

        ipfs_url = os.environ.get("IPFS_API_URL", "http://127.0.0.1:5001")
        files = {"file": (filename, gif_bytes, "image/gif")}
        resp = await client.post(f"{ipfs_url}/api/v0/add", files=files, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
        cid = data.get("Hash", "")

        if not cid:
            return {"error": "IPFS upload failed — no CID returned"}

        return {"cid": cid, "filename": filename, "ref": f"IPFS:{cid}/{filename}"}

    except Exception as e:
        logger.error(f"Giphy pin error: {e}")
        return {"error": str(e)}
