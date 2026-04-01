"""
SupFlix & Jukebox — Media discovery endpoints.
SupFlix: Video content. Jukebox: Audio content.
Both search objects, posts, and roots on the SUP protocol using admin-configurable keywords.
Blacklisted IPFS refs (dead pins) are automatically excluded.
"""
import logging
import asyncio
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from utils.helpers import (
    p2fk_get,
    format_object_for_api,
)
from db import ipfs_blacklist_col

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
limiter = Limiter(key_func=get_remote_address)

VIDEO_EXTENSIONS = ('.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.flv')
AUDIO_EXTENSIONS = ('.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a')
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS + AUDIO_EXTENSIONS

# In-memory blacklist cache (refreshed periodically)
_blacklist_cache = {"refs": set(), "last_refresh": 0}
BLACKLIST_CACHE_TTL = 120  # seconds


async def _get_blacklist() -> set:
    """Get the set of blacklisted IPFS refs, with in-memory caching."""
    import time
    now = time.time()
    if now - _blacklist_cache["last_refresh"] < BLACKLIST_CACHE_TTL and _blacklist_cache["refs"]:
        return _blacklist_cache["refs"]
    try:
        docs = await ipfs_blacklist_col.find({}, {"_id": 0, "ref": 1}).to_list(5000)
        refs = {d["ref"] for d in docs if d.get("ref")}
        _blacklist_cache["refs"] = refs
        _blacklist_cache["last_refresh"] = now
        return refs
    except Exception:
        return _blacklist_cache["refs"]


def _is_blacklisted(url_or_ref: str, blacklist: set) -> bool:
    """Check if a URL or IPFS ref is in the blacklist."""
    if not blacklist:
        return False
    for ref in blacklist:
        if ref in url_or_ref:
            return True
    return False


def _is_media_object(obj: dict) -> bool:
    urn = (obj.get('URN') or '').lower()
    return any(ext in urn for ext in MEDIA_EXTENSIONS)


def _is_video_object(obj: dict) -> bool:
    urn = (obj.get('URN') or '').lower()
    return any(ext in urn for ext in VIDEO_EXTENSIONS)


def _is_audio_object(obj: dict) -> bool:
    urn = (obj.get('URN') or '').lower()
    return any(ext in urn for ext in AUDIO_EXTENSIONS)


def _extract_media_url(obj: dict) -> str:
    urn = obj.get('URN') or obj.get('urn') or ''
    if urn.upper().startswith('IPFS:'):
        path = urn[5:].replace('\\', '/')
        cid = path.split('/')[0]
        return f"https://ipfs.io/ipfs/{cid}"
    if urn.startswith('http'):
        return urn
    if len(urn) > 50 and '/' in urn:
        return f"https://ipfs.io/ipfs/{urn}"
    return ''


IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp')


def _ipfs_ref_to_url(raw: str) -> str:
    """Convert a raw IPFS reference string to a gateway URL.
    Handles: IPFS:CID\\filename.ext, IPFS:CID, bare CID
    Returns CID/filename URL (for directory CIDs) with CID-only as fallback.
    """
    if not raw:
        return ''
    s = raw.strip()
    if s.upper().startswith('IPFS:'):
        s = s[5:]
    path = s.replace('\\', '/')
    parts = path.split('/')
    cid = parts[0]
    if not cid:
        return ''
    if len(parts) > 1:
        from urllib.parse import quote
        fname = '/'.join(parts[1:])
        return f"https://ipfs.io/ipfs/{cid}/{quote(fname, safe='')}"
    return f"https://ipfs.io/ipfs/{cid}"


def _ipfs_ref_to_url_pair(raw: str) -> tuple:
    """Return (primary_url, fallback_url) for an IPFS reference."""
    if not raw:
        return ('', '')
    s = raw.strip()
    if s.upper().startswith('IPFS:'):
        s = s[5:]
    path = s.replace('\\', '/')
    parts = path.split('/')
    cid = parts[0]
    if not cid:
        return ('', '')
    cid_only = f"https://ipfs.io/ipfs/{cid}"
    if len(parts) > 1:
        from urllib.parse import quote
        fname = '/'.join(parts[1:])
        return (f"https://ipfs.io/ipfs/{cid}/{quote(fname, safe='')}", cid_only)
    return (cid_only, '')


def _extract_image_refs_from_content(content: str) -> list:
    """Extract image file references from message content for use as covers."""
    images = []
    seen = set()
    # Pattern: <<IPFS:CID\filename.ext>>
    for m in re.finditer(r'<<IPFS:([^>]+)>>', content):
        raw = m.group(1).replace('\\', '/')
        lower = raw.lower()
        if any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS):
            if raw not in seen:
                seen.add(raw)
                url, fallback = _ipfs_ref_to_url_pair(raw)
                images.append({'url': url, 'fallback': fallback, 'ref': raw})
    # Pattern: IPFS:CID\filename.ext (inline)
    for m in re.finditer(r'IPFS:([^\s<>]+)', content):
        raw = m.group(1).replace('\\', '/')
        lower = raw.lower()
        if any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS):
            if raw not in seen:
                seen.add(raw)
                url, fallback = _ipfs_ref_to_url_pair(raw)
                images.append({'url': url, 'fallback': fallback, 'ref': raw})
    return images


def _extract_post_media(content: str) -> list:
    """Extract all media refs from message content using comprehensive pattern matching."""
    return _extract_media_refs_from_content(content)


# Known media file extensions as a regex alternation
_MEDIA_EXT_PATTERN = r'\.(?:mp3|wav|ogg|flac|aac|m4a|wma|mp4|webm|mov|avi|mkv|m4v|flv)'
_AUDIO_EXT_PATTERN = r'\.(?:mp3|wav|ogg|flac|aac|m4a|wma)'
_VIDEO_EXT_PATTERN = r'\.(?:mp4|webm|mov|avi|mkv|m4v|flv)'


def _extract_media_refs_from_content(content: str) -> list:
    """Extract all media file references from a message body.
    Handles:
      1. <<IPFS:CID\\filename with spaces.ext>> — delimited IPFS refs
      2. IPFS:CID\\filename.ext (no spaces) — inline IPFS refs
      3. Bare QmCID\\filename.ext — bare CID refs (may have spaces before ext)
      4. Bare hex64txid\\filename.ext — sidechain refs
    Returns list of {'url', 'ref', 'filename', 'is_video', 'is_audio', 'ref_type'}
    """
    media = []
    seen_refs = set()

    def _add_ref(ref_raw, ref_type='ipfs'):
        ref = ref_raw.replace('\\', '/')
        lower = ref.lower()
        if not any(ext in lower for ext in MEDIA_EXTENSIONS):
            return
        # Normalize: trim trailing whitespace/punctuation that isn't part of extension
        ref = ref.strip().rstrip('>')
        if ref in seen_refs:
            return
        seen_refs.add(ref)
        parts = ref.split('/')
        fname = parts[-1].strip() if len(parts) > 1 else ref.strip()
        cid_or_txid = parts[0]
        # URL-encode filenames (spaces, apostrophes, etc. break browser fetch)
        from urllib.parse import quote
        encoded_fname = quote(fname, safe='')
        if ref_type == 'ipfs':
            # IPFS refs can be either:
            #   a) Directory CID (cover image + audio) — need CID/filename to get audio
            #   b) File CID — CID alone returns the file, CID/filename gives 404
            # Try CID/filename first (handles directories), fall back to CID-only (handles file CIDs).
            if len(parts) > 1:
                url = f"https://ipfs.io/ipfs/{cid_or_txid}/{encoded_fname}"
                url_alt = f"https://ipfs.io/ipfs/{cid_or_txid}"
            else:
                url = f"https://ipfs.io/ipfs/{cid_or_txid}"
                url_alt = None
        else:
            url = f"/api/onchain/file/{cid_or_txid}/{encoded_fname}?chain=BTC&mainnet=true"
            url_alt = None
        media.append({
            'url': url, 'url_alt': url_alt, 'ref': ref, 'filename': fname,
            'is_video': any(ext in lower for ext in VIDEO_EXTENSIONS),
            'is_audio': any(ext in lower for ext in AUDIO_EXTENSIONS),
            'ref_type': ref_type,
        })

    # 1. Delimited IPFS refs: <<IPFS:CID\filename with spaces.ext>>
    #    This is the most reliable pattern — captures filenames with spaces
    for m in re.finditer(r'<<IPFS:([^>]+)>>', content):
        raw = m.group(1)
        _add_ref(raw, 'ipfs')

    # 2. Inline IPFS: refs (filenames ending at a known extension)
    #    Handles: IPFS:QmCID\02. Song Title.mp3
    #    [^<>]+? ensures we don't cross << >> delimiters
    for m in re.finditer(r'IPFS:(Qm[a-zA-Z0-9]{44,}[\\/][^<>]+?' + _MEDIA_EXT_PATTERN + r')', content, re.IGNORECASE):
        _add_ref(m.group(1), 'ipfs')

    # 3. Bare CID refs (no IPFS: prefix): QmCID\filename.ext or QmCID/filename.ext
    for m in re.finditer(r'(?<!:)(Qm[a-zA-Z0-9]{44,}[\\/][^<>]+?' + _MEDIA_EXT_PATTERN + r')', content, re.IGNORECASE):
        _add_ref(m.group(1), 'ipfs')

    # 4. Bare sidechain txid refs: hex64\filename.ext
    for m in re.finditer(r'(?<![a-zA-Z0-9])([a-fA-F0-9]{64}[\\/].+?' + _MEDIA_EXT_PATTERN + r')', content, re.IGNORECASE):
        _add_ref(m.group(1), 'sidechain')

    return media


async def _discover_media(
    network: str, keywords: list, skip: int, limit: int,
    filter_type: str = "all",  # "video", "audio", "all"
):
    """Unified media discovery using 5 parallel data sources per keyword.

    Keyword-based (mirrors SUP reference client):
      1. GetRootsByAddress(keywordAddress) — posts tagged with the keyword
      2. GetObjectsByKeyword(keyword) — objects with this keyword
      3. GetObjectsCreatedByAddress(keywordAddress) — objects by keyword address

    Broad text search (catches items without explicit keywords):
      4. GetKnownObjectsBySearchString — fuzzy object search
      5. GetKnownRootsBySearchString — fuzzy root/post search

    Results from all sources are merged and deduplicated.
    """
    is_mainnet = 'mainnet' in network.lower()
    items = []
    seen_ids = set()
    blacklist = await _get_blacklist()

    # ── Source 1: GetRootsByAddress (keyword-derived address) ──
    async def search_roots_by_keyword_address(kw):
        """Convert keyword to address, get all tagged posts, extract media."""
        results = []
        try:
            # Step 1: Convert keyword to deterministic address (SUP protocol)
            kw_addr = await p2fk_get(f"GetPublicAddressByKeyword/{kw}", is_mainnet)
            if not kw_addr or not isinstance(kw_addr, str) or len(kw_addr) < 20:
                return results

            # Step 2: Get all roots/posts to this keyword address
            roots = await p2fk_get(
                f"GetRootsByAddress/{kw_addr}",
                is_mainnet,
                extra_params={"skip": "0", "qty": "200"},
            )
            if not isinstance(roots, list):
                return results

            for root in roots:
                msg_list = root.get('Message') or []
                content = ' '.join(str(m) for m in msg_list)

                # Extract media from Message body
                media_refs = _extract_media_refs_from_content(content)
                for mref in media_refs:
                    results.append({
                        '_type': 'root', 'ref': mref['ref'], 'url': mref['url'],
                        'url_alt': mref.get('url_alt'),
                        'filename': mref['filename'], 'is_video': mref['is_video'],
                        'is_audio': mref['is_audio'], 'ref_type': mref.get('ref_type', 'ipfs'),
                        'content': content, 'root': root, 'blockchain': '',
                    })

                # Extract media from File.Keys attachments (SUP: TRACK.File.Keys)
                file_info = root.get('File') or {}
                for attachment_name in file_info.keys():
                    if attachment_name in ('SIG', 'OBJ', 'ENC', 'BLK'):
                        continue
                    lower_att = attachment_name.lower()
                    is_audio = any(ext in lower_att for ext in AUDIO_EXTENSIONS)
                    is_video = any(ext in lower_att for ext in VIDEO_EXTENSIONS)
                    if is_audio or is_video:
                        txid = root.get('TransactionId', '')
                        ref = f"{txid}\\{attachment_name}"
                        from urllib.parse import quote
                        encoded = quote(attachment_name, safe='')
                        results.append({
                            '_type': 'root', 'ref': ref,
                            'url': f"/api/onchain/file/{txid}/{encoded}?chain=BTC&mainnet={'true' if is_mainnet else 'false'}",
                            'filename': attachment_name, 'is_video': is_video,
                            'is_audio': is_audio, 'ref_type': 'onchain',
                            'content': content, 'root': root, 'blockchain': '',
                        })
        except Exception as e:
            logger.error(f"Roots-by-keyword-address search error [{kw}]: {e}")
        return results

    # ── Source 2: GetObjectsByKeyword ──
    async def search_objects_by_keyword(kw):
        """Direct keyword match on objects (SUP: GetObjectsByKeyword)."""
        results = []
        try:
            obj_data = await p2fk_get(f"GetObjectsByKeyword/{kw}", is_mainnet)
            if isinstance(obj_data, list):
                for obj in obj_data[:80]:
                    if _is_media_object(obj):
                        results.append(obj)
        except Exception as e:
            logger.error(f"Objects-by-keyword error [{kw}]: {e}")
        return results

    # ── Source 3: GetObjectsCreatedByAddress (keyword address) ──
    async def search_objects_created_by_keyword_address(kw):
        """Objects created at the keyword-derived address (SUP: GetObjectsCreatedByAddress)."""
        results = []
        try:
            kw_addr = await p2fk_get(f"GetPublicAddressByKeyword/{kw}", is_mainnet)
            if not kw_addr or not isinstance(kw_addr, str) or len(kw_addr) < 20:
                return results
            obj_data = await p2fk_get(f"GetObjectsCreatedByAddress/{kw_addr}", is_mainnet)
            if isinstance(obj_data, list):
                for obj in obj_data[:80]:
                    if _is_media_object(obj):
                        results.append(obj)
        except Exception as e:
            logger.error(f"Objects-created-by-keyword-address error [{kw}]: {e}")
        return results

    # ── Source 4: GetKnownObjectsBySearchString for fuzzy matching ──
    async def search_objects_by_searchstring(kw):
        """Broad fuzzy search across all object fields."""
        results = []
        try:
            obj_data = await p2fk_get(
                "GetKnownObjectsBySearchString",
                is_mainnet,
                extra_params={"searchString": kw, "qty": "60", "skip": "0"},
            )
            if isinstance(obj_data, list):
                for item in obj_data:
                    obj = item.get('object', item) if isinstance(item, dict) else item
                    if _is_media_object(obj):
                        results.append(obj)
        except Exception as e:
            logger.error(f"SearchString object search error [{kw}]: {e}")
        return results

    # ── Source 5: GetKnownRootsBySearchString for broad root/post search ──
    async def search_roots_by_searchstring(kw):
        """Broad fuzzy search across all root/post fields. Extracts media same as Source 1."""
        results = []
        try:
            root_data = await p2fk_get(
                "GetKnownRootsBySearchString",
                is_mainnet,
                extra_params={"searchString": kw, "qty": "100", "skip": "0"},
            )
            if not isinstance(root_data, list):
                return results

            for item in root_data:
                root = item.get('root', item) if isinstance(item, dict) else item
                blockchain = item.get('blockchain', '') if isinstance(item, dict) else ''
                msg_list = root.get('Message') or []
                content = ' '.join(str(m) for m in msg_list)

                # Extract media from Message body
                media_refs = _extract_media_refs_from_content(content)
                for mref in media_refs:
                    results.append({
                        '_type': 'root', 'ref': mref['ref'], 'url': mref['url'],
                        'url_alt': mref.get('url_alt'),
                        'filename': mref['filename'], 'is_video': mref['is_video'],
                        'is_audio': mref['is_audio'], 'ref_type': mref.get('ref_type', 'ipfs'),
                        'content': content, 'root': root, 'blockchain': blockchain,
                    })

                # Extract media from File.Keys attachments
                file_info = root.get('File') or {}
                for attachment_name in file_info.keys():
                    if attachment_name in ('SIG', 'OBJ', 'ENC', 'BLK'):
                        continue
                    lower_att = attachment_name.lower()
                    is_audio = any(ext in lower_att for ext in AUDIO_EXTENSIONS)
                    is_video = any(ext in lower_att for ext in VIDEO_EXTENSIONS)
                    if is_audio or is_video:
                        txid = root.get('TransactionId', '')
                        ref = f"{txid}\\{attachment_name}"
                        from urllib.parse import quote
                        encoded = quote(attachment_name, safe='')
                        results.append({
                            '_type': 'root', 'ref': ref,
                            'url': f"/api/onchain/file/{txid}/{encoded}?chain=BTC&mainnet={'true' if is_mainnet else 'false'}",
                            'url_alt': None,
                            'filename': attachment_name, 'is_video': is_video,
                            'is_audio': is_audio, 'ref_type': 'onchain',
                            'content': content, 'root': root, 'blockchain': blockchain,
                        })
        except Exception as e:
            logger.error(f"SearchString roots search error [{kw}]: {e}")
        return results

    # Run all 5 sources in parallel for each keyword
    tasks = []
    for kw in keywords:
        tasks.append(search_roots_by_keyword_address(kw))       # Source 1
        tasks.append(search_objects_by_keyword(kw))              # Source 2
        tasks.append(search_objects_created_by_keyword_address(kw))  # Source 3
        tasks.append(search_objects_by_searchstring(kw))         # Source 4
        tasks.append(search_roots_by_searchstring(kw))           # Source 5
    all_results = await asyncio.gather(*tasks, return_exceptions=True)

    # ── Process all object results (Sources 2, 3, 4) ──
    def _add_object(obj):
        obj_id = obj.get('TransactionId') or obj.get('URN', '')
        if obj_id in seen_ids:
            return
        if filter_type == "video" and not _is_video_object(obj):
            return
        if filter_type == "audio" and not _is_audio_object(obj):
            return
        media_url = _extract_media_url(obj)
        if _is_blacklisted(media_url, blacklist):
            return
        seen_ids.add(obj_id)
        formatted = format_object_for_api(obj)
        obj_name = formatted.get('name', '')
        if not obj_name or obj_name == 'Untitled':
            raw_urn = obj.get('URN') or ''
            path = raw_urn[5:].replace('\\', '/') if raw_urn.upper().startswith('IPFS:') else raw_urn
            obj_name = path.split('/')[-1] if '/' in path else (obj_name or 'Untitled')
        # Resolve raw IPFS image ref to a gateway URL
        raw_image = formatted.get('image', '')
        image_url, image_fallback = _ipfs_ref_to_url_pair(raw_image) if raw_image else ('', '')
        items.append({
            'type': 'object', 'id': obj_id, 'name': obj_name,
            'description': (formatted.get('description') or '')[:200],
            'image': image_url, 'image_fallback': image_fallback,
            'media_url': media_url,
            'is_video': _is_video_object(obj), 'is_audio': _is_audio_object(obj),
            'urn': formatted.get('urn', ''),
            'object_address': formatted.get('object_address', ''),
            'creator_address': formatted['creators'][0]['address'] if formatted.get('creators') else '',
            'created_date': formatted.get('created_date', ''),
            'owner_count': formatted.get('owner_count', 0),
        })

    for i, kw in enumerate(keywords):
        base = i * 5
        # Source 2: objects by keyword
        if not isinstance(all_results[base + 1], Exception):
            for obj in (all_results[base + 1] or []):
                _add_object(obj)
        # Source 3: objects created by keyword address
        if not isinstance(all_results[base + 2], Exception):
            for obj in (all_results[base + 2] or []):
                _add_object(obj)
        # Source 4: objects by search string
        if not isinstance(all_results[base + 3], Exception):
            for obj in (all_results[base + 3] or []):
                _add_object(obj)

    # ── Process all root results (Sources 1 and 5) ──
    def _process_root_item(root_item):
        """Shared logic for processing a root-type media item from any source."""
        if root_item.get('_type') == 'obj_ref':
            _add_object(root_item['object'])
            return

        ref = root_item.get('ref', '')
        root = root_item.get('root', {})
        txid = root.get('TransactionId', '')
        dedup_key = f"{txid}:{ref}"
        if dedup_key in seen_ids or not ref:
            return
        is_video = root_item.get('is_video', False)
        is_audio = root_item.get('is_audio', False)
        if filter_type == "video" and not is_video:
            return
        if filter_type == "audio" and not is_audio:
            return
        media_url = root_item.get('url', '')
        fname = root_item.get('filename', '')
        if _is_blacklisted(media_url, blacklist):
            return
        seen_ids.add(dedup_key)

        # Extract image refs from the same post for use as cover art
        cover_url = ''
        cover_fallback = ''
        content = root_item.get('content', '')
        image_refs = _extract_image_refs_from_content(content)
        if image_refs:
            cover_url = image_refs[0]['url']
            cover_fallback = image_refs[0]['fallback']

        items.append({
            'type': 'root', 'id': dedup_key, 'name': fname,
            'description': content[:150].strip(),
            'image': cover_url, 'image_fallback': cover_fallback,
            'media_url': media_url,
            'media_url_alt': root_item.get('url_alt', ''),
            'is_video': is_video, 'is_audio': is_audio,
            'urn': '', 'object_address': '', 'creator_address': root.get('SignedBy', ''),
            'created_date': root.get('BlockDate', ''), 'owner_count': 0,
            'blockchain': root_item.get('blockchain', ''),
            'ref_type': root_item.get('ref_type', 'ipfs'),
        })

    for i, kw in enumerate(keywords):
        base = i * 5
        # Source 1: roots by keyword address
        if not isinstance(all_results[base], Exception):
            for root_item in (all_results[base] or []):
                _process_root_item(root_item)
        # Source 5: roots by search string
        if not isinstance(all_results[base + 4], Exception):
            for root_item in (all_results[base + 4] or []):
                _process_root_item(root_item)

    # Sort by date (newest first)
    items.sort(key=lambda x: x.get('created_date', ''), reverse=True)
    total = len(items)
    page = items[skip:skip + limit]
    return {'items': page, 'total': total, 'has_more': skip + limit < total}


# ─── SUPflix: Video Discovery ───
@router.get("/supflix/discover")
@limiter.limit("20/minute")
async def supflix_discover(
    request: Request,
    network: str = "btc-testnet",
    query: str = Query(default=None),
    skip: int = 0,
    limit: int = 30,
):
    if query:
        keywords = [query]
    else:
        from db import admin_col as _admin_col
        settings_doc = await _admin_col.find_one({"_id": "settings"})
        keywords = (settings_doc or {}).get("supflix_keywords", ["movie"])
        if not keywords:
            keywords = ["movie"]
    return await _discover_media(network, keywords, skip, limit, filter_type="video")


# ─── Jukebox: Audio Discovery ───
@router.get("/jukebox/discover")
@limiter.limit("20/minute")
async def jukebox_discover(
    request: Request,
    network: str = "btc-testnet",
    query: str = Query(default=None),
    skip: int = 0,
    limit: int = 30,
):
    if query:
        keywords = [query]
    else:
        from db import admin_col as _admin_col
        settings_doc = await _admin_col.find_one({"_id": "settings"})
        keywords = (settings_doc or {}).get("jukebox_keywords", ["music"])
        if not keywords:
            keywords = ["music"]
    return await _discover_media(network, keywords, skip, limit, filter_type="audio")


# ─── IPFS Blacklist Management ───
class BlacklistRequest(BaseModel):
    ref: str
    reason: str = "dead_pin"


@router.post("/ipfs/report-dead")
async def report_dead_ipfs(body: BlacklistRequest):
    """Report an IPFS ref as dead/unavailable. Adds to blacklist."""
    ref = body.ref.strip()
    if not ref:
        return {"ok": False, "error": "Empty ref"}
    await ipfs_blacklist_col.update_one(
        {"ref": ref},
        {"$set": {"ref": ref, "reason": body.reason, "reported_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"report_count": 1}},
        upsert=True,
    )
    # Invalidate cache
    _blacklist_cache["last_refresh"] = 0
    return {"ok": True, "ref": ref}


@router.get("/ipfs/blacklist")
async def get_blacklist(skip: int = 0, limit: int = 100):
    """Get all blacklisted IPFS refs."""
    docs = await ipfs_blacklist_col.find({}, {"_id": 0}).sort("reported_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await ipfs_blacklist_col.count_documents({})
    return {"items": docs, "total": total}


@router.delete("/ipfs/blacklist/{ref_encoded}")
async def remove_from_blacklist(ref_encoded: str):
    """Remove an IPFS ref from blacklist (un-blacklist)."""
    import urllib.parse
    ref = urllib.parse.unquote(ref_encoded)
    await ipfs_blacklist_col.delete_one({"ref": ref})
    _blacklist_cache["last_refresh"] = 0
    return {"ok": True, "ref": ref}
