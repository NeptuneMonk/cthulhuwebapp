"""Shared httpx connection pool for all outbound HTTP requests.

Instead of creating a new httpx.AsyncClient per request (which opens/closes TCP+TLS
connections each time), we maintain persistent connection pools per domain.
This dramatically reduces latency and resource usage at scale.

Usage:
    from utils.http_pool import get_client
    client = get_client()
    resp = await client.get("https://p2fk.io/...")
"""
import httpx

# Shared client — initialized lazily at first use, persistent for app lifetime.
# Connection pool limits:
#   max_connections=100 — total connections across all hosts
#   max_keepalive_connections=40 — idle connections kept alive
#   keepalive_expiry=30 — close idle connections after 30s
_pool_limits = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=40,
    keepalive_expiry=30,
)

_shared_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Get the shared httpx.AsyncClient with connection pooling."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            limits=_pool_limits,
            timeout=httpx.Timeout(15.0, connect=5.0),
            headers={"User-Agent": "Cthulhu/2.0"},
            follow_redirects=True,
        )
    return _shared_client


async def close_client():
    """Gracefully close the shared client (call on app shutdown)."""
    global _shared_client
    if _shared_client and not _shared_client.is_closed:
        await _shared_client.aclose()
        _shared_client = None
