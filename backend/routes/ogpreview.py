"""
OpenGraph URL preview endpoint.
Fetches title, description, image from URLs for rich link previews in posts.
"""
import logging
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Query
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# In-memory cache with TTL (avoid repeated scraping)
_og_cache = {}
CACHE_TTL = 3600  # 1 hour


def _parse_og_tags(html: str, url: str) -> dict:
    """Extract OpenGraph and fallback meta tags from HTML."""
    result = {'url': url, 'title': '', 'description': '', 'image': '', 'site_name': '', 'type': ''}

    # OpenGraph tags
    for prop in ['title', 'description', 'image', 'site_name', 'type']:
        pattern = rf'<meta\s+(?:property|name)=["\']og:{prop}["\']\s+content=["\']([^"\']*)["\']'
        m = re.search(pattern, html, re.IGNORECASE)
        if not m:
            pattern = rf'<meta\s+content=["\']([^"\']*)["\'](?:\s+(?:property|name)=["\']og:{prop}["\'])'
            m = re.search(pattern, html, re.IGNORECASE)
        if m:
            result[prop] = m.group(1).strip()

    # Twitter card fallbacks
    if not result['title']:
        m = re.search(r'<meta\s+(?:name|property)=["\']twitter:title["\']\s+content=["\']([^"\']*)["\']', html, re.IGNORECASE)
        if m:
            result['title'] = m.group(1).strip()
    if not result['description']:
        m = re.search(r'<meta\s+(?:name|property)=["\']twitter:description["\']\s+content=["\']([^"\']*)["\']', html, re.IGNORECASE)
        if m:
            result['description'] = m.group(1).strip()
    if not result['image']:
        m = re.search(r'<meta\s+(?:name|property)=["\']twitter:image["\']\s+content=["\']([^"\']*)["\']', html, re.IGNORECASE)
        if m:
            result['image'] = m.group(1).strip()

    # Fallback to <title>
    if not result['title']:
        m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
        if m:
            result['title'] = m.group(1).strip()

    # Fallback to meta description
    if not result['description']:
        m = re.search(r'<meta\s+name=["\']description["\']\s+content=["\']([^"\']*)["\']', html, re.IGNORECASE)
        if m:
            result['description'] = m.group(1).strip()

    # Resolve relative image URLs
    if result['image'] and not result['image'].startswith('http'):
        from urllib.parse import urljoin
        result['image'] = urljoin(url, result['image'])

    # Extract domain for site_name fallback
    if not result['site_name']:
        from urllib.parse import urlparse
        result['site_name'] = urlparse(url).netloc

    return result


@router.get("/og-preview")
async def get_og_preview(url: str = Query(..., description="URL to fetch OpenGraph data for")):
    """Fetch OpenGraph metadata for a URL."""
    if not url or not url.startswith('http'):
        return {'error': 'Invalid URL'}

    # Check cache
    now = datetime.now(timezone.utc).timestamp()
    if url in _og_cache:
        cached, ts = _og_cache[url]
        if now - ts < CACHE_TTL:
            return cached

    try:
        client = get_client()
        resp = await client.get(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; CthulhuBot/1.0; +https://cthulhu.app)',
            'Accept': 'text/html,application/xhtml+xml',
        }, timeout=5.0, follow_redirects=True)
        if resp.status_code != 200:
            return {'url': url, 'title': '', 'description': '', 'image': '', 'site_name': '', 'error': 'fetch_failed'}

        content_type = resp.headers.get('content-type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            return {'url': url, 'title': '', 'description': '', 'image': '', 'site_name': '', 'type': content_type}

        html = resp.text[:50000]
        result = _parse_og_tags(html, url)
        _og_cache[url] = (result, now)
        return result

    except Exception as e:
        logger.warning(f"OG preview fetch failed for {url}: {e}")
        return {'url': url, 'title': '', 'description': '', 'image': '', 'site_name': '', 'error': str(e)[:100]}
