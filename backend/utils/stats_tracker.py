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

# Server start time
_start_time = time.time()


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


def get_stats():
    """Return all collected statistics."""
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
    }


def reset_stats():
    """Reset all counters."""
    _api_calls.clear()
    _api_call_times.clear()
    _route_hits.clear()
    _cache_stats["hits"] = 0
    _cache_stats["misses"] = 0


def _format_uptime(seconds):
    d = int(seconds // 86400)
    h = int((seconds % 86400) // 3600)
    m = int((seconds % 3600) // 60)
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"
