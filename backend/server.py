"""Cthulhu API — Entry point.
Assembles all route modules and configures middleware + startup tasks.
"""
from fastapi import FastAPI, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import logging
import asyncio
import time

from db import (
    known_users_col, conversation_cache_col, object_cache_col,
    users_col, first_seen_col, db,
)
from utils.helpers import seed_known_users, p2fk_get, fetch_profile_by_address, register_known_user, get_known_addresses
from utils.stats_tracker import track_route_hit
from utils.http_pool import get_client, close_client

# Import routers
from routes.auth import router as auth_router
from routes.data import router as data_router, get_feed
from routes.objects import router as objects_router
from routes.wallet import router as wallet_router
from routes.ipfs import router as ipfs_router
from routes.onchain import router as onchain_router
from routes.gifs import router as gifs_router
from routes.twofa import router as twofa_router
from routes.dm import router as dm_router
from routes.supflix import router as supflix_router
from routes.paywall import router as paywall_router, init_collections as init_paywall
from routes.ogpreview import router as ogpreview_router
from routes.rooms import router as rooms_router
from routes.treasury import router as treasury_router
from routes.polls import router as polls_router
from routes.p2fk_local import router as p2fk_local_router
from routes.discover import router as discover_router
from routes.emoji import router as emoji_router
from routes.admin import router as admin_router
from routes.calls import router as calls_router
from routes.user_state import router as user_state_router
from routes.favorites import router as favorites_router
from routes.vault import router as vault_router
from routes.room_topics import router as room_topics_router
from routes.mesh import router as mesh_router
from routes.chat_relay import router as chat_relay_router
from routes.etch import router as etch_router
from routes.admin_wallet import router as admin_wallet_router
from routes.auto_checkpoint import router as auto_checkpoint_router, start_auto_checkpoint
from routes.releases import router as releases_router, public_router as releases_public_router

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Rate limiter — per-IP, protects external API quotas
limiter = Limiter(key_func=get_remote_address)

app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Include all routers
app.include_router(auth_router)
app.include_router(data_router)
app.include_router(objects_router)
app.include_router(wallet_router)
app.include_router(ipfs_router)
app.include_router(onchain_router)
app.include_router(gifs_router)
app.include_router(dm_router)
app.include_router(twofa_router)
app.include_router(supflix_router)
app.include_router(ogpreview_router)
app.include_router(rooms_router)
app.include_router(treasury_router)
app.include_router(polls_router)
app.include_router(paywall_router)
app.include_router(discover_router)
app.include_router(emoji_router)
app.include_router(admin_router)
app.include_router(calls_router)
app.include_router(user_state_router)
app.include_router(p2fk_local_router)
app.include_router(favorites_router)
app.include_router(vault_router)
app.include_router(room_topics_router)
app.include_router(mesh_router)
app.include_router(chat_relay_router)
app.include_router(etch_router)
app.include_router(admin_wallet_router)
app.include_router(auto_checkpoint_router)
app.include_router(releases_router)
app.include_router(releases_public_router)


# ─── Download endpoint for desktop packages ───
@app.get("/api/download/{filename}")
async def download_package(filename: str):
    from starlette.responses import FileResponse as FR
    dist_dir = Path(__file__).parent.parent / "dist"
    file_path = dist_dir / filename
    if not file_path.exists() or not file_path.is_file():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Package not found")
    return FR(str(file_path), filename=filename, media_type="application/zip")

# ─── tBTC price endpoint ─────────────────────────────────────────
_tbtc_cache = {"price": None, "btc_usd": None, "ts": 0}
TBTC_RATE = 0.0000022  # 1 tBTC = 0.0000022 BTC (buytestnet.com rate)

@app.get("/api/tbtc-price")
async def get_tbtc_price():
    now = time.time()
    if _tbtc_cache["price"] and now - _tbtc_cache["ts"] < 300:
        return _tbtc_cache
    try:
        client = get_client()
        r = await client.get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", timeout=8.0)
        btc_usd = r.json()["bitcoin"]["usd"]
        tbtc_price = round(btc_usd * TBTC_RATE, 2)
        _tbtc_cache.update({"price": tbtc_price, "btc_usd": btc_usd, "ts": now})
        return _tbtc_cache
    except Exception:
        if _tbtc_cache["price"]:
            return _tbtc_cache
        return {"price": 0.16, "btc_usd": 72727, "ts": now}

# GZip middleware — compress large JSON responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request tracking middleware
@app.middleware("http")
async def track_requests(request, call_next):
    # Normalize path: strip query params, collapse IDs
    path = request.url.path
    # Collapse dynamic segments (addresses, txids, etc.)
    import re as _re
    normalized = _re.sub(r'/[a-fA-F0-9]{20,}', '/{id}', path)
    normalized = _re.sub(r'/[a-zA-Z0-9]{26,40}', '/{addr}', normalized)
    track_route_hit(request.method, normalized)
    response = await call_next(request)
    return response


# Error-catching middleware — logs unhandled exceptions to error_logs_col
from db import error_logs_col

@app.middleware("http")
async def error_logging_middleware(request, call_next):
    from datetime import datetime, timezone
    import traceback as _tb
    try:
        response = await call_next(request)
        # Log 5xx server errors (but not expected 504s from IPFS timeouts)
        if response.status_code >= 500:
            path = str(request.url.path)
            is_expected_timeout = response.status_code == 504 and '/ipfs/cat/' in path
            if not is_expected_timeout:
                await error_logs_col.insert_one({
                    "level": "ERROR",
                    "status_code": response.status_code,
                    "method": request.method,
                    "path": path,
                    "query": str(request.url.query),
                    "client": request.client.host if request.client else "unknown",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": f"Server returned {response.status_code}",
                })
        return response
    except Exception as exc:
        await error_logs_col.insert_one({
            "level": "CRITICAL",
            "method": request.method,
            "path": str(request.url.path),
            "query": str(request.url.query),
            "client": request.client.host if request.client else "unknown",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": str(exc),
            "traceback": _tb.format_exc(),
        })
        raise


# Frontend error reporting endpoint
from pydantic import BaseModel as _BM
from typing import Optional as _Opt
from datetime import datetime as _DT, timezone as _TZ

class FrontendErrorReport(_BM):
    message: str
    stack: _Opt[str] = None
    url: _Opt[str] = None
    user_address: _Opt[str] = None
    component: _Opt[str] = None

@app.post("/api/log-error")
async def log_frontend_error(report: FrontendErrorReport, request: Request):
    await error_logs_col.insert_one({
        "level": "FRONTEND",
        "message": report.message,
        "stack": report.stack,
        "url": report.url,
        "user_address": report.user_address,
        "component": report.component,
        "client": request.client.host if request.client else "unknown",
        "timestamp": _DT.now(_TZ.utc).isoformat(),
    })
    return {"ok": True}


@app.on_event("startup")
async def startup():
    # Core indexes
    await known_users_col.create_index([('address', 1), ('network', 1)], unique=True)
    await conversation_cache_col.create_index('cache_key', unique=True)
    await object_cache_col.create_index('cache_key', unique=True)
    await users_col.create_index('urn_lower', unique=True)
    await first_seen_col.create_index('txid', unique=True)

    # TTL indexes for cache collections — auto-expire stale data
    await db.api_cache.create_index('updated_at', expireAfterSeconds=86400)
    await db.onchain_cache.create_index('timestamp', expireAfterSeconds=604800)
    await db.sidechain_cache.create_index('timestamp', expireAfterSeconds=604800)

    # Query performance indexes
    await db.onchain_cache.create_index('key', unique=True)
    await db.object_index.create_index([('network', 1), ('name', 1)])
    await db.dm_clears.create_index([('user_address', 1), ('partner_address', 1), ('network', 1)])
    await db.pending_reactions.create_index([('target_txid', 1), ('network', 1)])

    # Call settings
    await db.call_settings.create_index([('address', 1), ('network', 1)], unique=True)

    # Chat checkpoints
    await db.chat_checkpoints.create_index([('address', 1), ('network', 1)])

    # Emoji cache index
    from routes.emoji import cached_emojis_col
    await cached_emojis_col.create_index('emoji', unique=True)

    # Initialize paywall collections
    from db import db as _db
    init_paywall(_db)
    await seed_known_users()
    logger.info("Database indexed and known users seeded")

    # Load persisted IPFS uploaded CIDs
    from routes.ipfs import _load_uploaded_cids
    await _load_uploaded_cids()

    # Deep discovery — fetch messages from all known users to discover new ones
    async def deep_discover():
        for net in ['btc-testnet', 'btc-mainnet']:
            try:
                is_mainnet = 'mainnet' in net
                addresses = await get_known_addresses(net)
                logger.info(f"Deep discovery for {net}: {len(addresses)} known addresses")
                discovered = set()
                for addr in addresses[:50]:  # Cap to prevent overload
                    try:
                        messages = await p2fk_get(f"GetRootsByAddress/{addr}", is_mainnet)
                        if isinstance(messages, list):
                            for msg in messages:
                                from_addr = (msg.get('Creators') or {})
                                if isinstance(from_addr, dict):
                                    for a in from_addr.keys():
                                        if a not in discovered:
                                            discovered.add(a)
                    except Exception:
                        continue
                    await asyncio.sleep(0.5)  # Pace deep discovery to avoid p2fk.io rate limits
                # Register newly discovered addresses
                for addr in discovered:
                    try:
                        profile = await fetch_profile_by_address(addr, is_mainnet)
                        urn = profile.get('URN') if profile else None
                        image = profile.get('Image') if profile else None
                        display_name = profile.get('DisplayName') if profile else None
                        await register_known_user(addr, net, urn, image, display_name)
                    except Exception:
                        continue
                    await asyncio.sleep(0.3)  # Pace profile lookups
                total = await get_known_addresses(net)
                logger.info(f"Deep discovery complete for {net}: {len(total)} total known addresses")
            except Exception as e:
                logger.warning(f"Deep discovery failed for {net}: {e}")
    asyncio.create_task(deep_discover())

    # Pre-warm feed cache in background
    async def warm_feed_cache():
        for net in ['btc-testnet', 'btc-mainnet']:
            try:
                cache_key = f"feed:{net}"
                cached = await conversation_cache_col.find_one({'cache_key': cache_key}, {'_id': 0})
                if not cached or not cached.get('messages'):
                    logger.info(f"Pre-warming feed cache for {net}...")
                    await get_feed(net, skip=0, limit=5)
                    logger.info(f"Feed cache warmed for {net}")
            except Exception as e:
                logger.warning(f"Feed cache warm failed for {net}: {e}")
    asyncio.create_task(warm_feed_cache())

    # Start auto-checkpoint background task
    start_auto_checkpoint()

    # Auto-install and start Kubo IPFS daemon
    asyncio.create_task(_ensure_kubo_running())

    # Start periodic IPFS garbage collection (every 6 hours)
    asyncio.create_task(_ipfs_gc_scheduler())


async def _ipfs_gc_scheduler():
    """Run IPFS GC every 6 hours to clean stale pins."""
    from routes.ipfs import _run_gc
    await asyncio.sleep(300)  # Wait 5 min after startup before first GC
    while True:
        try:
            logger.info("Scheduled IPFS GC starting...")
            result = await _run_gc()
            logger.info(f"Scheduled IPFS GC result: {result}")
        except Exception as e:
            logger.warning(f"Scheduled IPFS GC error: {e}")
        await asyncio.sleep(6 * 3600)  # Every 6 hours


async def _ensure_kubo_running():
    """Install Kubo binary if missing, init repo, and start the daemon."""
    import subprocess
    import platform
    import os
    from pathlib import Path

    try:
        # Check if already running
        from utils.http_pool import get_client
        try:
            client = get_client()
            resp = await client.post("http://127.0.0.1:5001/api/v0/id", timeout=3.0)
            if resp.status_code == 200:
                logger.info("Kubo IPFS daemon already running")
                return
        except Exception:
            pass

        # Find writable data path
        ipfs_path = None
        for candidate in ["/data/ipfs", "/tmp/ipfs"]:
            try:
                p = Path(candidate)
                p.mkdir(parents=True, exist_ok=True)
                test = p / ".write_test"
                test.write_text("ok")
                test.unlink()
                ipfs_path = p
                break
            except Exception:
                continue
        if not ipfs_path:
            logger.error("Kubo: no writable data path found")
            return

        env = {"IPFS_PATH": str(ipfs_path), "PATH": "/usr/local/bin:/usr/bin:/bin"}

        # Install binary if missing
        ipfs_bin = Path("/usr/local/bin/ipfs")
        if not ipfs_bin.exists():
            logger.info("Kubo binary missing — downloading v0.33.0...")
            arch = platform.machine()
            goarch = "arm64" if arch in ("aarch64", "arm64") else "amd64"
            dl_url = f"https://dist.ipfs.tech/kubo/v0.33.0/kubo_v0.33.0_linux-{goarch}.tar.gz"
            tarball = "/tmp/kubo.tar.gz"

            downloaded = False
            try:
                dl = subprocess.run(["curl", "-sL", dl_url, "-o", tarball],
                                    capture_output=True, timeout=120)
                if dl.returncode == 0 and os.path.getsize(tarball) > 1000:
                    downloaded = True
            except Exception:
                pass
            if not downloaded:
                try:
                    import urllib.request
                    urllib.request.urlretrieve(dl_url, tarball)
                    downloaded = os.path.getsize(tarball) > 1000
                except Exception:
                    pass
            if not downloaded:
                logger.error("Kubo: could not download binary")
                return

            subprocess.run(["tar", "xzf", tarball, "-C", "/tmp"],
                           capture_output=True, timeout=30)
            for bin_dest in ["/usr/local/bin/ipfs", "/tmp/ipfs_bin"]:
                try:
                    subprocess.run(["cp", "/tmp/kubo/ipfs", bin_dest],
                                   capture_output=True, timeout=10, check=True)
                    subprocess.run(["chmod", "+x", bin_dest], capture_output=True)
                    ipfs_bin = Path(bin_dest)
                    break
                except Exception:
                    continue
            if not ipfs_bin.exists():
                logger.error("Kubo: could not install binary")
                return
            logger.info(f"Kubo binary installed at {ipfs_bin}")

        # Init repo if missing
        if not (ipfs_path / "config").exists():
            subprocess.run([str(ipfs_bin), "init", "--profile=server"],
                           env=env, capture_output=True, timeout=30)
            subprocess.run([str(ipfs_bin), "config", "Addresses.API", "/ip4/127.0.0.1/tcp/5001"],
                           env=env, capture_output=True, timeout=10)
            subprocess.run([str(ipfs_bin), "config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/9797"],
                           env=env, capture_output=True, timeout=10)
            logger.info("Kubo IPFS repo initialized")

        # Kill stale port holders
        subprocess.run(["bash", "-c", "pkill -f 'ipfs daemon' 2>/dev/null; kill $(lsof -t -i :5001) 2>/dev/null; true"],
                        capture_output=True, timeout=5)
        await asyncio.sleep(1)

        # Ensure gateway doesn't conflict with existing services
        subprocess.run([str(ipfs_bin), "config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/9797"],
                        env=env, capture_output=True, timeout=10)

        # Start — supervisor first, then direct subprocess
        started = False
        try:
            r = subprocess.run(["supervisorctl", "start", "ipfs"],
                               capture_output=True, text=True, timeout=15)
            combined = (r.stdout + r.stderr).strip()
            fail_keywords = ["ERROR", "FATAL", "no such file", "refused", "not running", "no such process"]
            if r.returncode == 0 and not any(kw in combined for kw in fail_keywords):
                started = True
                logger.info("Kubo started via supervisor")
        except Exception:
            pass

        if not started:
            subprocess.Popen(
                [str(ipfs_bin), "daemon", "--enable-gc"],
                env=env,
                stdout=open("/tmp/ipfs_stdout.log", "a"),
                stderr=open("/tmp/ipfs_stderr.log", "a"),
                start_new_session=True,
            )
            logger.info("Kubo started as background process")

        # Verify with retries
        await asyncio.sleep(5)
        for attempt in range(3):
            try:
                client = get_client()
                resp = await client.post("http://127.0.0.1:5001/api/v0/id", timeout=5.0)
                if resp.status_code == 200:
                    logger.info("Kubo IPFS daemon verified and running")
                    return
            except Exception:
                pass
            await asyncio.sleep(3)
        logger.warning("Kubo started but verification timed out")

    except Exception as e:
        logger.error(f"Kubo auto-start failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    await close_client()
    logger.info("Shared HTTP client closed")


# ── Static file serving (production mode) ──
# When a frontend build exists, serve it directly from FastAPI.
# This eliminates the Node.js dependency for production deployments.
from pathlib import Path
from starlette.staticfiles import StaticFiles
from starlette.responses import FileResponse

_FRONTEND_BUILD = Path(__file__).parent.parent / "frontend" / "build"

if _FRONTEND_BUILD.exists() and (_FRONTEND_BUILD / "index.html").exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_BUILD / "static")), name="static_assets")

    # SPA fallback: any non-API route returns index.html for client-side routing
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Never intercept API routes — let FastAPI's 404 handler deal with them
        if full_path.startswith("api/") or full_path.startswith("api"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not found"}, status_code=404)
        # Try to serve the exact file first (e.g. favicon.ico, manifest.json)
        file_path = _FRONTEND_BUILD / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        # Otherwise return index.html for client-side routing
        return FileResponse(str(_FRONTEND_BUILD / "index.html"))

    logger.info(f"Serving frontend build from {_FRONTEND_BUILD}")
