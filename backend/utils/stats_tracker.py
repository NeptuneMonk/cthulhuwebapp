"""
In-memory statistics tracker for API calls, request counts, and cache metrics.
Reset on server restart. Provides real-time visibility into external API usage.
Lock-free: safe in single-process async context (no concurrent mutation).
"""
import time
from collections import defaultdict

# External API call counters: { domain: { endpoint: count } }
_api_calls = defaultdict(lambda: defaultdict(int))
_api_call_times = defaultdict(list)  # { domain: [duration_ms, ...] }

# Route hit counters: { method:path: count }
_route_hits = defaultdict(int)

# Cache stats
_cache_stats = {"hits": 0, "misses": 0}

# Decoder source tracking: which source served each request
_decoder_stats = {
    "local_decoder": {"success": 0, "fail": 0, "total_ms": 0},
    "p2fk_io": {"success": 0, "fail": 0, "total_ms": 0},
    "cache_fresh": {"success": 0, "fail": 0, "total_ms": 0},
    "cache_stale": {"success": 0, "fail": 0, "total_ms": 0},
    "ipfs_snapshot": {"success": 0, "fail": 0, "total_ms": 0},
}
_decoder_path_sources = defaultdict(lambda: defaultdict(int))  # { path_prefix: { source: count } }
_decoder_recent = []  # Last 50 decoder events: [{ path, source, ms, ts }, ...]

# Server start time
_start_time = time.time()

# Search index stats (updated periodically from SQLite)
_search_index_stats = {
    "total_roots": 0,
    "testnet_roots": 0,
    "mainnet_roots": 0,
    "cache_coverage_pct": 0,
}


async def refresh_search_index_stats():
    """Update search index stats from SQLite. Called periodically."""
    try:
        from db_sqlite import get_conn
        conn = await get_conn()
        async with conn.execute("SELECT COUNT(*) FROM root_search_index") as cur:
            total = (await cur.fetchone())[0]
        async with conn.execute("SELECT COUNT(*) FROM root_search_index WHERE blockchain = 'testnet'") as cur:
            testnet = (await cur.fetchone())[0]
        async with conn.execute("SELECT COUNT(*) FROM root_search_index WHERE blockchain = 'mainnet'") as cur:
            mainnet = (await cur.fetchone())[0]
        async with conn.execute("SELECT COUNT(*) FROM snapshot_txids") as cur:
            tracked = (await cur.fetchone())[0]
        _search_index_stats.update({
            "total_roots": total,
            "testnet_roots": testnet,
            "mainnet_roots": mainnet,
            "cache_coverage_pct": round(total / max(1, tracked) * 100, 1),
        })
    except Exception:
        pass


def track_api_call(domain: str, endpoint: str, duration_ms: float = 0):
    """Record an external API call."""
    _api_calls[domain][endpoint] += 1
    _api_call_times[domain].append(duration_ms)
    if len(_api_call_times[domain]) > 1000:
        _api_call_times[domain] = _api_call_times[domain][-500:]


def track_route_hit(method: str, path: str):
    """Record an internal route hit."""
    _route_hits[f"{method} {path}"] += 1


def track_cache(hit: bool):
    """Record a cache hit or miss."""
    if hit:
        _cache_stats["hits"] += 1
    else:
        _cache_stats["misses"] += 1


def track_decoder_source(path: str, source: str, duration_ms: float = 0, success: bool = True):
    """Record which data source served a p2fk API request.
    source: 'local_decoder', 'p2fk_io', 'cache_fresh', 'cache_stale'"""
    if source in _decoder_stats:
        if success:
            _decoder_stats[source]["success"] += 1
        else:
            _decoder_stats[source]["fail"] += 1
        _decoder_stats[source]["total_ms"] += duration_ms

    # Track by path prefix (e.g. 'GetRootByTransactionID')
    prefix = path.split('/')[0] if '/' in path else path
    _decoder_path_sources[prefix][source] += 1

    # Recent events log
    _decoder_recent.append({
        "path": path[:60],
        "source": source,
        "ms": round(duration_ms, 1),
        "ok": success,
        "ts": time.time(),
    })
    if len(_decoder_recent) > 50:
        del _decoder_recent[:25]


def get_stats():
    """Return all collected statistics."""
    # Trigger async search index refresh (fire-and-forget for next call)
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(refresh_search_index_stats())
    except Exception:
        pass

    uptime = time.time() - _start_time

    api_summary = {}
    total_api_calls = 0
    for domain, endpoints in _api_calls.items():
        domain_total = sum(endpoints.values())
        total_api_calls += domain_total
        timings = _api_call_times.get(domain, [])
        avg_ms = sum(timings) / len(timings) if timings else 0
        api_summary[domain] = {
            "total_calls": domain_total,
            "endpoints": dict(endpoints),
            "avg_response_ms": round(avg_ms, 1),
            "calls_per_minute": round(domain_total / (uptime / 60), 2) if uptime > 0 else 0,
        }

    sorted_routes = sorted(_route_hits.items(), key=lambda x: -x[1])

    return {
        "uptime_seconds": round(uptime),
        "uptime_human": _format_uptime(uptime),
        "total_external_api_calls": total_api_calls,
        "external_apis": api_summary,
        "cache_hits": _cache_stats["hits"],
        "cache_misses": _cache_stats["misses"],
        "cache_hit_rate": round(
            _cache_stats["hits"] / max(1, _cache_stats["hits"] + _cache_stats["misses"]) * 100, 1
        ),
        "top_routes": [{"route": r, "hits": c} for r, c in sorted_routes[:30]],
        "total_route_hits": sum(_route_hits.values()),
        "decoder": get_decoder_stats(),
    }


def reset_stats():
    """Reset all counters."""
    _api_calls.clear()
    _api_call_times.clear()
    _route_hits.clear()
    _cache_stats["hits"] = 0
    _cache_stats["misses"] = 0
    for src in _decoder_stats:
        _decoder_stats[src] = {"success": 0, "fail": 0, "total_ms": 0}
    _decoder_path_sources.clear()
    _decoder_recent.clear()


def get_decoder_stats():
    """Return decoder-specific statistics."""
    total_decoder = sum(s["success"] + s["fail"] for s in _decoder_stats.values())
    local_total = _decoder_stats["local_decoder"]["success"] + _decoder_stats["local_decoder"]["fail"]
    p2fk_total = _decoder_stats["p2fk_io"]["success"] + _decoder_stats["p2fk_io"]["fail"]

    # Independence score: % of requests served without p2fk.io
    # local_decoder, cache_fresh, cache_stale, and ipfs_snapshot all count as independent
    non_p2fk = total_decoder - p2fk_total
    independence = round(non_p2fk / max(1, total_decoder) * 100, 1)

    # Per-source averages
    sources = {}
    for src, data in _decoder_stats.items():
        total = data["success"] + data["fail"]
        sources[src] = {
            "total": total,
            "success": data["success"],
            "fail": data["fail"],
            "success_rate": round(data["success"] / max(1, total) * 100, 1),
            "avg_ms": round(data["total_ms"] / max(1, total), 1),
        }

    # Search index stats (from SQLite)
    search_index = _search_index_stats.copy()

    return {
        "total_requests": total_decoder,
        "independence_score": independence,
        "sources": sources,
        "search_index": search_index,
        "by_path": {
            path: dict(srcs) for path, srcs in sorted(
                _decoder_path_sources.items(), key=lambda x: sum(x[1].values()), reverse=True
            )[:15]
        },
        "recent": list(reversed(_decoder_recent[-20:])),
    }


def _format_uptime(seconds):
    d = int(seconds // 86400)
    h = int((seconds % 86400) // 3600)
    m = int((seconds % 3600) // 60)
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"
