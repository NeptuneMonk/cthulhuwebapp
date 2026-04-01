"""Discover endpoint - searches for on-chain P2FK artifacts via p2fk.io API (primary) or bitfossil.com (fallback)."""
import re
import logging
import asyncio
import time
from datetime import datetime, timezone
from fastapi import APIRouter
from fastapi.responses import Response, JSONResponse

from db import object_cache_col
from utils.http_pool import get_client
from utils.helpers import p2fk_get

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

CHAIN_SHORT = {
    'Bitcoin': 'BTC', 'Bitcoin-T': 'BTC-T', 'Litecoin': 'LTC',
    'Dogecoin': 'DOGE', 'Mazacoin': 'MZC', 'Maza': 'MZC',
}

PREFIX_CHAIN = {
    'LTC:': 'LTC', 'DOG:': 'DOGE', 'MZC:': 'MZC', 'BTC:': 'BTC', 'DTC:': 'DTC',
}

IMAGE_EXTS = re.compile(r'\.(jpg|jpeg|png|gif|svg|webp|bmp)$', re.I)


def _do_bitfossil_search(query: str, count: int = 50) -> str:
    """Synchronous POST search to bitfossil.com ASP.NET form.
    Limits requests to be respectful of the server."""
    import requests
    UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    # bitfossil.com only accepts specific count values — cap at 50 to be civil
    valid_counts = [50, 100, 150, 200, 250, 500]
    safe_count = min((c for c in valid_counts if c >= min(count, 50)), default=50)
    for attempt in range(2):
        try:
            s = requests.Session()
            page = s.get("https://bitfossil.com/", timeout=15, headers=UA)
            html = page.text
            vs = re.search(r'name="__VIEWSTATE" id="__VIEWSTATE" value="([^"]+)"', html)
            vsg = re.search(r'name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="([^"]+)"', html)
            ev = re.search(r'name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="([^"]+)"', html)
            if not (vs and vsg and ev):
                raise Exception("Failed to extract ASP.NET form tokens")
            data = {
                "__VIEWSTATE": vs.group(1),
                "__VIEWSTATEGENERATOR": vsg.group(1),
                "__EVENTVALIDATION": ev.group(1),
                "searchEntry": query,
                "lstSearchCount": str(safe_count),
                "searchButton": "Search",
            }
            resp = s.post("https://bitfossil.com/", data=data, timeout=20, headers=UA)
            txids = re.findall(r'[0-9a-f]{64}', resp.text)
            if txids:
                return resp.text
            if attempt < 1:
                time.sleep(2)
        except Exception as e:
            logger.warning(f"bitfossil attempt {attempt+1} failed: {e}")
            if attempt < 1:
                time.sleep(2)
    return ""


def _detect_chain_from_context(html: str, txid: str, query: str) -> str:
    """Detect chain from HTML context around the txid."""
    query_upper = query.upper()
    for prefix, chain in PREFIX_CHAIN.items():
        if query_upper.startswith(prefix):
            return chain
    idx = html.find(txid)
    if idx >= 0:
        context = html[max(0, idx - 500):idx]
        best_chain = 'BTC'
        best_pos = -1
        for chain_name, short in CHAIN_SHORT.items():
            pos = context.rfind(chain_name)
            if pos > best_pos:
                best_pos = pos
                best_chain = short
        if best_pos >= 0:
            return best_chain
    return 'BTC'


FILE_EXTS = re.compile(r'\.(jpg|jpeg|png|gif|svg|webp|bmp|mp3|mp4|wav|ogg|flac|aac|pdf|zip|avi|mov|mkv|doc|docx|txt|csv|html|htm)$', re.I)


def _group_search_results(html: str, query: str) -> dict:
    """Parse bitfossil search HTML and group entries by txid.
    Only includes txids that have at least one real file (image, audio, pdf, etc.)."""
    groups = {}

    all_txid_refs = re.findall(r'([0-9a-f]{64})/([^\"<>\s\)]+)', html)

    # First pass: categorize paths per txid
    txid_paths = {}
    for txid, path in all_txid_refs:
        if path == 'index.htm':
            continue
        txid_paths.setdefault(txid, []).append(path)

    WEB_ASSET_EXTS = re.compile(r'\.(css|js|htm)$', re.I)

    # Second pass: only keep txids that have at least one real file
    for txid, paths in txid_paths.items():
        has_file = any(FILE_EXTS.search(p) for p in paths)
        if not has_file:
            continue
        g = {'txid': txid, 'chain': _detect_chain_from_context(html, txid, query),
             'images': [], 'files': [], 'web_assets': [], 'messages': [], 'has_address': False,
             'has_webapp': False, 'metadata': {}}
        for path in paths:
            if path.startswith('MSG'):
                pass  # Fetched from index.htm during enrichment
            elif path == 'ADD':
                g['has_address'] = True
            elif path.lower() == 'index.html':
                g['has_webapp'] = True
                if path not in g['files']:
                    g['files'].append(path)
            elif IMAGE_EXTS.search(path):
                if path not in g['images']:
                    g['images'].append(path)
            elif WEB_ASSET_EXTS.search(path):
                if path not in g['web_assets']:
                    g['web_assets'].append(path)
            elif FILE_EXTS.search(path):
                if path not in g['files']:
                    g['files'].append(path)
        groups[txid] = g

    return groups


async def _enrich_from_index(txid: str, group: dict) -> dict:
    """Fetch index.htm for a txid and enrich the group with messages and metadata."""
    from bs4 import BeautifulSoup
    try:
        client = get_client()
        resp = await client.get(f"https://bitfossil.com/{txid}/index.htm", timeout=12.0, follow_redirects=True)
        if resp.status_code != 200:
            return group

        soup = BeautifulSoup(resp.text, 'html.parser')

        for i in range(1, 10):
            msg_div = soup.find(id=f'msg{i}')
            if msg_div:
                text = msg_div.get_text(strip=True)
                if text:
                    group['messages'].append({'key': f'MSG{i}', 'content': text})
        msg_div = soup.find(id='msg')
        if msg_div:
            text = msg_div.get_text(strip=True)
            if text and not any(m['content'] == text for m in group['messages']):
                group['messages'].insert(0, {'key': 'MSG', 'content': text})

        for img in soup.find_all('img'):
            src = img.get('src', '')
            if src and not src.startswith('..') and IMAGE_EXTS.search(src):
                fname = src.split('/')[-1]
                if fname not in group['images']:
                    group['images'].append(fname)

        WEB_ASSET_EXTS = re.compile(r'\.(css|js)$', re.I)
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            if href == 'ADD' or href.endswith('/ADD'):
                group['has_address'] = True
            elif href.lower() == 'index.html':
                group['has_webapp'] = True
                if href not in group.get('files', []):
                    group.setdefault('files', []).append(href)
            elif WEB_ASSET_EXTS.search(href) and not href.startswith('http'):
                if href not in group.get('web_assets', []):
                    group.setdefault('web_assets', []).append(href)

        meta = {}
        block_date = soup.find(id='block-date')
        if block_date:
            meta['block_date'] = block_date.get_text(strip=True)
        blockchain = soup.find(id='blockchain')
        if blockchain:
            meta['blockchain'] = blockchain.get_text(strip=True)
        build_date = soup.find(id='build-date')
        if build_date:
            meta['build_date'] = build_date.get_text(strip=True)
        build_machine = soup.find(id='build-machine')
        if build_machine:
            meta['build_machine'] = build_machine.get_text(strip=True)

        table = soup.find('table')
        if table:
            rows = [td.get_text(strip=True) for td in table.find_all('td')]
            for i, cell in enumerate(rows):
                if cell == 'COST' and i + 1 < len(rows):
                    meta['cost'] = rows[i + 1]
                if cell == 'VERSION' and i + 1 < len(rows):
                    meta['version'] = rows[i + 1]

        if meta:
            group['metadata'] = meta

    except Exception as e:
        logger.debug(f"Failed to enrich txid {txid[:16]}...: {e}")

    return group


# --- Chain prefix mapping for URN construction ---
CHAIN_URN_PREFIX = {
    'BTC': '', 'BTC-T': '', 'LTC': 'LTC:', 'DOGE': 'DOG:',
    'MZC': 'MZC:', 'DTC': 'DTC:',
}


async def _check_ownership(txid: str, chain: str, images: list, files: list) -> dict:
    """Check if a fossil has been claimed via GetObjectByURN.
    Returns {'claimed': bool, 'owner': str or None, 'urn': str or None, 'name': str or None}."""
    from urllib.parse import quote
    prefix = CHAIN_URN_PREFIX.get(chain, '')
    candidates = images + files
    if not candidates:
        return {'claimed': False, 'owner': None, 'urn': None, 'name': None}
    for filename in candidates[:2]:
        urn_raw = f"{prefix}{txid}/{filename}"
        urn_encoded = quote(urn_raw, safe=':')
        try:
            client = get_client()
            resp = await client.get(f"{P2FK_API}/GetObjectByURN/{urn_encoded}", params={"mainnet": "true"}, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('URN') and data.get('Owners'):
                    owners = data['Owners']
                    first_owner = list(owners.keys())[0] if isinstance(owners, dict) else None
                    return {'claimed': True, 'owner': first_owner, 'urn': data['URN'], 'name': data.get('Name')}
        except Exception:
            pass
    return {'claimed': False, 'owner': None, 'urn': None, 'name': None}


async def _p2fk_discover(query: str, count: int = 50) -> list:
    """Try p2fk.io GetKnownRootsBySearchString API (via p2fk_get with local fallback)."""
    try:
        data = await p2fk_get("GetKnownRootsBySearchString", False, {
            "search": query, "qty": min(count, 50)
        })
        if not isinstance(data, list) or len(data) == 0:
            return []

        results = []
        for item in data:
            root = item.get('root', {})
            files_dict = root.get('File', {})
            if 'SIG' in files_dict:
                continue
            txid = root.get('TransactionId', '')
            if not txid:
                continue
            images = [f for f in files_dict if IMAGE_EXTS.search(f)]
            real_files = [f for f in files_dict if FILE_EXTS.search(f) and not IMAGE_EXTS.search(f)]
            if not images and not real_files:
                continue
            bc = item.get('blockchain', 'Unknown')
            chain = CHAIN_SHORT.get(bc, 'BTC')
            messages = [{'key': f'MSG{i+1}', 'content': m} for i, m in enumerate(root.get('Message', [])) if m]
            results.append({
                'txid': txid,
                'chain': chain,
                'images': images,
                'files': real_files,
                'messages': messages,
                'has_address': bool(files_dict.get('ADD')),
                'metadata': {k: v for k, v in {
                    'block_date': root.get('BlockDate'),
                    'blockchain': bc,
                    'version': str(root.get('Id', '')),
                }.items() if v and v != '0001-01-01T00:00:00'},
                'detail_url': f"https://bitfossil.com/{txid}/index.htm",
                'ownership': None,
            })

        if results:
            sem = asyncio.Semaphore(3)
            async def _check(r):
                async with sem:
                    result = await _check_ownership(r['txid'], r['chain'], r['images'], r['files'])
                    await asyncio.sleep(0.3)
                    return result
            ownership_results = await asyncio.gather(*[_check(r) for r in results[:8]], return_exceptions=True)
            for i, own in enumerate(ownership_results):
                if isinstance(own, dict):
                    results[i]['ownership'] = own

        return results
    except Exception as e:
        logger.debug(f"p2fk.io GetKnownRoots failed: {e}")
        return []


@router.post("/objects/discover")
async def discover_objects(body: dict):
    """Search for on-chain P2FK artifacts. Tries p2fk.io API first, falls back to bitfossil.com scraping.
    Caches results in MongoDB for 10 minutes to reduce load on external services."""
    query = body.get("query", "").strip()
    count = min(int(body.get("count", 50)), 50)  # Cap at 50 to be civil

    if not query or len(query) < 2:
        return {"results": [], "query": query, "error": "Query too short"}

    # Check cache first (10-minute TTL)
    cache_key = f"discover:{query.lower()}"
    try:
        cached = await object_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
        if cached and cached.get('cached_at'):
            cache_age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['cached_at'])).total_seconds()
            if cache_age < 600:  # 10 minutes
                return {"results": cached.get('results', []), "query": query,
                        "total": cached.get('total', 0), "source": cached.get('source', 'cache'),
                        "from_cache": True}
    except Exception:
        pass

    try:
        # Try p2fk.io API first (faster, more reliable when available)
        p2fk_results = await _p2fk_discover(query, count)
        if len(p2fk_results) >= 3:
            # Cache the results
            await _cache_discover_results(cache_key, p2fk_results, "p2fk")
            return {"results": p2fk_results, "query": query, "total": len(p2fk_results), "source": "p2fk"}

        # Fallback to bitfossil.com scraping — be civil: limit count, throttle enrichment
        html = await asyncio.to_thread(_do_bitfossil_search, query, count)
        if not html:
            return {"results": [], "query": query, "error": "bitfossil.com temporarily unavailable"}

        groups = _group_search_results(html, query)
        if not groups:
            return {"results": [], "query": query, "total": 0}

        # Enrich top 8 results only (reduced from 15) with 1s delays between batches
        sem = asyncio.Semaphore(3)  # Reduced from 5 concurrent
        txids = list(groups.keys())[:8]

        async def _limited_enrich(txid, group):
            async with sem:
                result = await _enrich_from_index(txid, group)
                await asyncio.sleep(0.5)  # Small delay between requests
                return result

        enrichment_tasks = [_limited_enrich(txid, groups[txid]) for txid in txids]
        await asyncio.gather(*enrichment_tasks, return_exceptions=True)

        # Build final results
        blockchain_to_chain = {
            'bitcoin': 'BTC', 'bitcoin-t': 'BTC-T', 'litecoin': 'LTC',
            'dogecoin': 'DOGE', 'mazacoin': 'MZC', 'maza': 'MZC',
        }
        results = []
        for txid in groups:
            g = groups[txid]
            chain = g['chain']
            bc_name = g['metadata'].get('blockchain', '').lower()
            if bc_name in blockchain_to_chain:
                chain = blockchain_to_chain[bc_name]
            g['chain'] = chain
            results.append({
                'txid': g['txid'],
                'chain': chain,
                'images': g['images'],
                'files': g['files'],
                'web_assets': g.get('web_assets', []),
                'messages': g['messages'],
                'has_address': g['has_address'],
                'has_webapp': g.get('has_webapp', False),
                'metadata': g['metadata'],
                'detail_url': f"https://bitfossil.com/{txid}/index.htm",
                'ownership': None,
            })

        # Check ownership for top 8 only (reduced from 10), with throttle
        ownership_sem = asyncio.Semaphore(3)

        async def _limited_ownership(r):
            async with ownership_sem:
                result = await _check_ownership(r['txid'], r['chain'], r['images'], r['files'])
                await asyncio.sleep(0.3)
                return result

        ownership_tasks = [_limited_ownership(r) for r in results[:8]]
        ownership_results = await asyncio.gather(*ownership_tasks, return_exceptions=True)
        for i, own in enumerate(ownership_results):
            if isinstance(own, dict):
                results[i]['ownership'] = own

        # Merge any p2fk.io results that bitfossil missed
        seen_txids = {r['txid'] for r in results}
        for pr in p2fk_results:
            if pr['txid'] not in seen_txids:
                results.append(pr)

        # Cache the results
        await _cache_discover_results(cache_key, results, "bitfossil")

        return {"results": results, "query": query, "total": len(results), "source": "bitfossil"}
    except Exception as e:
        logger.error(f"bitfossil search failed: {e}", exc_info=True)
        return {"results": [], "query": query, "error": str(e)}


async def _cache_discover_results(cache_key: str, results: list, source: str):
    """Cache discover results in MongoDB for 10 minutes."""
    try:
        await object_cache_col.update_one(
            {'cache_key': cache_key},
            {'$set': {
                'cache_key': cache_key,
                'results': results,
                'total': len(results),
                'source': source,
                'cached_at': datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True
        )
    except Exception:
        pass


@router.get("/objects/discover/preview/{txid}/{filename:path}")
async def discover_preview(txid: str, filename: str):
    """Proxy a bitfossil.com file for preview (avoids CORS issues)."""
    try:
        client = get_client()
        resp = await client.get(f"https://bitfossil.com/{txid}/{filename}", timeout=30.0, follow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 0:
            import mimetypes
            content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            return Response(content=resp.content, media_type=content_type)
        return JSONResponse({"error": "Not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
