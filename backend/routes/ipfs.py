"""IPFS routes: upload, cat, pin, file serving, daemon management, and garbage collection."""
from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import Response, FileResponse
from pathlib import Path
import logging
import subprocess
import httpx
import time
import asyncio
from utils.http_pool import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

KUBO_API = "http://127.0.0.1:5001/api/v0"

# ─── CID Access Tracking ───
# Track last-access time for CIDs served through this node.
# Uploaded CIDs are permanently pinned (persisted to SQLite).
# Viewed CIDs are auto-pinned on access and GC'd after 48 hours.
_cid_access_log: dict[str, float] = {}  # cid -> last_access_timestamp
_uploaded_cids: set[str] = set()  # CIDs uploaded by our users (always keep)
STALE_THRESHOLD = 48 * 3600  # 48 hours in seconds
_gc_running = False


async def _load_uploaded_cids():
    """Load persisted uploaded CIDs from SQLite on startup."""
    try:
        from db_sqlite import get_conn
        conn = await get_conn()
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_cids (
                cid TEXT PRIMARY KEY,
                uploaded_at REAL
            )
        """)
        await conn.commit()
        cursor = await conn.execute("SELECT cid FROM uploaded_cids")
        rows = await cursor.fetchall()
        for row in rows:
            _uploaded_cids.add(row[0])
        logger.info(f"Loaded {len(_uploaded_cids)} uploaded CIDs from DB")
    except Exception as e:
        logger.warning(f"Could not load uploaded CIDs: {e}")


async def _persist_uploaded_cid(cid: str):
    """Save an uploaded CID to SQLite so it survives restarts."""
    try:
        from db_sqlite import get_conn
        conn = await get_conn()
        await conn.execute(
            "INSERT OR IGNORE INTO uploaded_cids (cid, uploaded_at) VALUES (?, ?)",
            (cid, time.time())
        )
        await conn.commit()
    except Exception as e:
        logger.warning(f"Could not persist uploaded CID {cid[:20]}: {e}")


@router.post("/ipfs/restart")
async def ipfs_restart():
    """Restart the Kubo IPFS daemon. Auto-installs binary if missing.
    Returns detailed diagnostics on each step."""
    import asyncio
    import json
    import platform
    import os

    steps = []

    try:
        # Determine paths — try /data/ipfs first, fall back to /tmp/ipfs
        ipfs_path = None
        for candidate in [Path("/data/ipfs"), Path("/tmp/ipfs")]:
            try:
                candidate.mkdir(parents=True, exist_ok=True)
                test_file = candidate / ".write_test"
                test_file.write_text("ok")
                test_file.unlink()
                ipfs_path = candidate
                break
            except Exception:
                continue
        if not ipfs_path:
            raise Exception("No writable IPFS data path found")
        steps.append(f"Data path: {ipfs_path}")

        env = {"IPFS_PATH": str(ipfs_path), "PATH": "/usr/local/bin:/usr/bin:/bin"}

        # Step 1: Install kubo binary if missing — use BUNDLED binaries first
        ipfs_bin = Path("/usr/local/bin/ipfs")
        if not ipfs_bin.exists():
            arch = platform.machine()
            arch_suffix = "arm64" if arch in ("aarch64", "arm64") else "amd64"
            bundled = Path(__file__).parent.parent / "bin" / f"ipfs-{arch_suffix}"

            installed = False
            if bundled.exists():
                steps.append(f"Installing from bundled binary: {bundled}")
                for bin_dest in ["/usr/local/bin/ipfs", "/tmp/ipfs_bin"]:
                    try:
                        subprocess.run(["cp", str(bundled), bin_dest],
                                       capture_output=True, timeout=10, check=True)
                        subprocess.run(["chmod", "+x", bin_dest], capture_output=True)
                        ipfs_bin = Path(bin_dest)
                        installed = True
                        steps.append(f"Binary installed at {bin_dest}")
                        break
                    except Exception:
                        continue

            if not installed:
                steps.append("Bundled binary not found — downloading from GitHub...")
                goarch = "arm64" if arch in ("aarch64", "arm64") else "amd64"
                dl_url = f"https://github.com/ipfs/kubo/releases/download/v0.33.0/kubo_v0.33.0_linux-{goarch}.tar.gz"
                tarball = "/tmp/kubo.tar.gz"

                downloaded = False
                try:
                    dl = subprocess.run(
                        ["curl", "-sL", dl_url, "-o", tarball],
                        capture_output=True, timeout=120
                    )
                    if dl.returncode == 0 and os.path.getsize(tarball) > 1000:
                        downloaded = True
                        steps.append("Downloaded via curl from GitHub")
                except Exception as e:
                    steps.append(f"curl failed: {e}")

                if not downloaded:
                    try:
                        import urllib.request
                        urllib.request.urlretrieve(dl_url, tarball)
                        if os.path.getsize(tarball) > 1000:
                            downloaded = True
                            steps.append("Downloaded via urllib from GitHub")
                    except Exception as e:
                        steps.append(f"urllib failed: {e}")

                if not downloaded:
                    raise Exception("Could not install Kubo binary (no bundled binary and download failed)")

                subprocess.run(["tar", "xzf", tarball, "-C", "/tmp"],
                               capture_output=True, timeout=30)

                for bin_dest in ["/usr/local/bin/ipfs", "/tmp/ipfs_bin"]:
                    try:
                        subprocess.run(["cp", "/tmp/kubo/ipfs", bin_dest],
                                       capture_output=True, timeout=10, check=True)
                        subprocess.run(["chmod", "+x", bin_dest], capture_output=True)
                        ipfs_bin = Path(bin_dest)
                        steps.append(f"Binary installed at {bin_dest}")
                        break
                    except Exception:
                        continue

            if not ipfs_bin.exists():
                raise Exception("Could not install binary to any path")
        else:
            steps.append(f"Binary exists: {ipfs_bin}")

        # Step 2: Initialize repo if missing
        if not (ipfs_path / "config").exists():
            r = subprocess.run(
                [str(ipfs_bin), "init", "--profile=server"],
                env=env, capture_output=True, text=True, timeout=30
            )
            steps.append(f"Init: {r.stdout.strip() or r.stderr.strip()}")
            subprocess.run(
                [str(ipfs_bin), "config", "Addresses.API", "/ip4/127.0.0.1/tcp/5001"],
                env=env, capture_output=True, timeout=10
            )
            subprocess.run(
                [str(ipfs_bin), "config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/9797"],
                env=env, capture_output=True, timeout=10
            )
            steps.append("Repo initialized")
        else:
            steps.append("Repo already exists")

        # Step 3: Kill any existing daemon / stale port holders
        subprocess.run(
            ["bash", "-c", "pkill -f 'ipfs daemon' 2>/dev/null; kill $(lsof -t -i :5001) 2>/dev/null; true"],
            capture_output=True, timeout=5
        )
        await asyncio.sleep(2)
        steps.append("Killed stale processes")

        # Ensure gateway doesn't conflict — use port 9797 instead of 8080
        subprocess.run(
            [str(ipfs_bin), "config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/9797"],
            env=env, capture_output=True, timeout=10
        )

        # Step 4: Start daemon — try supervisor first, then direct subprocess
        started = False
        try:
            r = subprocess.run(["supervisorctl", "start", "ipfs"],
                               capture_output=True, text=True, timeout=15)
            combined = (r.stdout + r.stderr).strip()
            fail_keywords = ["ERROR", "FATAL", "no such file", "refused", "not running", "no such process"]
            if r.returncode == 0 and not any(kw in combined for kw in fail_keywords):
                started = True
                steps.append(f"Started via supervisor: {combined}")
            else:
                steps.append(f"Supervisor failed: {combined}")
        except Exception as e:
            steps.append(f"Supervisor unavailable: {e}")

        if not started:
            # Direct subprocess fallback
            log_out = "/tmp/ipfs_stdout.log"
            log_err = "/tmp/ipfs_stderr.log"
            proc = subprocess.Popen(
                [str(ipfs_bin), "daemon", "--enable-gc"],
                env=env,
                stdout=open(log_out, "a"),
                stderr=open(log_err, "a"),
                start_new_session=True,
            )
            steps.append(f"Started as subprocess (PID {proc.pid})")

        # Step 5: Wait and verify with retries
        await asyncio.sleep(5)
        for attempt in range(3):
            try:
                client = get_client()
                resp = await client.post(f"{KUBO_API}/id", timeout=5.0)
                if resp.status_code == 200:
                    data = json.loads(resp.text)
                    steps.append(f"Verified online (attempt {attempt + 1})")
                    return {
                        "success": True,
                        "online": True,
                        "peer_id": data.get("ID", ""),
                        "agent": data.get("AgentVersion", ""),
                        "steps": steps,
                    }
            except Exception:
                pass
            await asyncio.sleep(3)

        # If we got here, daemon isn't responding yet
        # Check if process is alive
        ps = subprocess.run(["bash", "-c", "ps aux | grep 'ipfs daemon' | grep -v grep"],
                            capture_output=True, text=True, timeout=5)
        daemon_running = bool(ps.stdout.strip())
        steps.append(f"Daemon process alive: {daemon_running}")

        if not daemon_running:
            # Read error logs
            for log_path in ["/tmp/ipfs_stderr.log", "/var/log/supervisor/ipfs.err.log"]:
                try:
                    with open(log_path, "r") as f:
                        lines = f.readlines()[-10:]
                        if lines:
                            steps.append(f"Log ({log_path}): {''.join(lines[-3:]).strip()}")
                except Exception:
                    pass

        return {
            "success": False,
            "online": False,
            "message": "Daemon started but not responding after 14 seconds",
            "steps": steps,
        }
    except Exception as e:
        logger.error(f"IPFS restart error: {e}")
        steps.append(f"Error: {str(e)}")
        return {
            "success": False,
            "online": False,
            "error": str(e),
            "steps": steps,
        }


async def _pin_background(cid: str):
    """Background task: pin a CID to our local Kubo node."""
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/pin/add?arg={cid}", timeout=120.0)
        if resp.status_code == 200:
            logger.info(f"Pinned {cid[:20]}...")
        else:
            logger.warning(f"Pin failed for {cid[:20]}: {resp.status_code}")
    except Exception as e:
        logger.warning(f"Pin background error for {cid[:20]}: {e}")


@router.get("/ipfs/status")
async def ipfs_status():
    """Check if the local Kubo IPFS daemon is running and responsive."""
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/id", timeout=5.0)
        if resp.status_code == 200:
            import json
            data = json.loads(resp.text)
            return {
                "online": True,
                "peer_id": data.get("ID", ""),
                "agent": data.get("AgentVersion", ""),
            }
        return {"online": False, "error": "Unexpected response"}
    except Exception:
        return {"online": False, "error": "Daemon not reachable"}


@router.post("/ipfs/upload")
async def upload_to_ipfs(file: UploadFile = File(...), bg: BackgroundTasks = None):
    """Upload a file to the local Kubo IPFS daemon. No size limit — IPFS handles any file size."""
    import json
    import tempfile
    import os

    try:
        filename = file.filename or "upload"

        # Stream file to a temp file to avoid holding it all in RAM
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f"_{filename}")
        total_size = 0
        chunk_size = 1024 * 1024  # 1MB chunks
        try:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                tmp.write(chunk)
                total_size += len(chunk)
            tmp.close()
        except Exception as e:
            try:
                tmp.close()
                os.unlink(tmp.name)
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Error reading upload: {e}")

        # Scale timeout with file size: minimum 120s, +60s per 10MB, no upper cap
        timeout_secs = max(120.0, 120.0 + (total_size / (10 * 1024 * 1024)) * 60.0)
        logger.info(f"IPFS upload: {filename} ({total_size / 1024 / 1024:.1f}MB), timeout={timeout_secs:.0f}s")

        try:
            with open(tmp.name, 'rb') as f:
                client = get_client()
                # CRITICAL: wrap-with-directory=false returns the DIRECT file hash
                # SUP expects direct file CIDs, not folder/directory CIDs
                resp = await client.post(
                    f"{KUBO_API}/add?wrap-with-directory=false&chunker=size-1048576",
                    files={"file": (filename, f, file.content_type or "application/octet-stream")},
                    timeout=timeout_secs,
                )
                if resp.status_code == 200:
                    lines = resp.text.strip().split('\n')
                    # With wrap-with-directory=false, we get a single entry: the file itself
                    file_cid = None
                    for line in lines:
                        entry = json.loads(line)
                        if entry.get("Hash"):
                            file_cid = entry["Hash"]

                    cid = file_cid or ""

                    # Explicitly pin (ipfs add already pins, but this ensures it)
                    # Mark as user-uploaded so GC never touches it
                    if cid:
                        _uploaded_cids.add(cid)
                        _cid_access_log[cid] = time.time()
                        # Persist to SQLite so it survives restarts
                        await _persist_uploaded_cid(cid)
                        try:
                            pin_resp = await client.post(
                                f"{KUBO_API}/pin/add?arg={cid}",
                                timeout=30.0,
                            )
                            if pin_resp.status_code == 200:
                                logger.info(f"Pinned uploaded file {cid[:20]}...")
                            else:
                                logger.warning(f"Pin after upload failed for {cid[:20]}: {pin_resp.status_code}")
                        except Exception as e:
                            logger.warning(f"Pin after upload error for {cid[:20]}: {e}")

                        # Full propagation in background: DHT provide + warm gateways
                        if bg:
                            bg.add_task(_propagate_background, cid)

                    return {
                        "success": True,
                        "cid": cid,
                        "file_cid": cid,
                        "filename": filename,
                        "ipfs_ref": f"IPFS:{cid}",
                        "gateway_url": f"https://ipfs.io/ipfs/{cid}",
                        "size": total_size,
                    }
                else:
                    logger.error(f"IPFS daemon error: {resp.status_code} {resp.text}")
                    raise HTTPException(status_code=502, detail="IPFS daemon upload failed")
        finally:
            try:
                os.unlink(tmp.name)
            except Exception:
                pass

    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="IPFS daemon not running. Please start it.")
    except Exception as e:
        logger.error(f"IPFS upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


PUBLIC_IPFS_GATEWAYS = [
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
    "https://w3s.link/ipfs/",
]


@router.get("/ipfs/cat/{cid:path}")
async def ipfs_cat(cid: str, bg: BackgroundTasks = None):
    """Fetch IPFS content via local Kubo first, then public gateways as fallback.
    Auto-pins viewed content so this node becomes a pinning node for viewed content.
    Viewed pins are GC'd after 48 hours; uploaded pins are permanent."""
    content = None
    client = get_client()
    root_cid = cid.split('/')[0] if '/' in cid else cid

    # 1. Try local Kubo daemon (shorter timeout to fail fast)
    try:
        resp = await client.post(f"{KUBO_API}/cat?arg={cid}", timeout=15.0)
        if resp.status_code == 200 and len(resp.content) > 0:
            content = resp.content
            logger.info(f"IPFS cat via Kubo: {cid[:20]}... ({len(content)} bytes)")
    except (httpx.ReadTimeout, httpx.ConnectError) as e:
        logger.info(f"Kubo cat timeout/error for {cid[:20]}...: {e}")
    except Exception as e:
        logger.info(f"Kubo cat failed for {cid[:20]}...: {e}")

    # 2. Fallback: try public IPFS gateways
    if content is None:
        for gw in PUBLIC_IPFS_GATEWAYS:
            try:
                url = f"{gw}{cid}"
                resp = await client.get(url, timeout=12.0, follow_redirects=True)
                if resp.status_code == 200 and len(resp.content) > 0:
                    # Validate it's not an HTML error page
                    peek = resp.content[:20]
                    if b'<!DOCTYPE' not in peek and b'<html' not in peek:
                        content = resp.content
                        logger.info(f"IPFS cat via gateway {gw}: {cid[:20]}... ({len(content)} bytes)")
                        break
            except Exception:
                continue

    if content is None:
        raise HTTPException(
            status_code=504,
            detail="IPFS content retrieval timed out — content may not be available on the network yet"
        )

    # Track access time and auto-pin in background (GC will clean up after 48h)
    _cid_access_log[root_cid] = time.time()
    if bg:
        bg.add_task(_auto_pin_viewed, root_cid)

    return Response(content=content, media_type="application/octet-stream")


async def _auto_pin_viewed(cid: str):
    """Background: pin viewed content so this node becomes a pinning node.
    These pins are subject to 48h GC (unlike uploaded pins which are permanent)."""
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/pin/add?arg={cid}", timeout=60.0)
        if resp.status_code == 200:
            logger.info(f"Auto-pinned viewed CID: {cid[:20]}...")
    except Exception as e:
        logger.debug(f"Auto-pin failed for {cid[:20]}: {e}")


@router.post("/ipfs/pin/{cid:path}")
async def ipfs_pin(cid: str, bg: BackgroundTasks = None):
    """Explicitly pin a CID to our local Kubo node.
    Kicks off pinning in background and returns immediately."""
    if bg:
        bg.add_task(_pin_background, cid)
    return {"success": True, "cid": cid, "pinned": "queued"}


async def _propagate_background(cid: str):
    """Background task: aggressively announce content to the IPFS network.
    1. Pin locally
    2. DHT provide (announce availability)
    3. Warm public gateways (trigger them to fetch and cache)
    """
    client = get_client()
    # Pin locally first
    try:
        resp = await client.post(f"{KUBO_API}/pin/add?arg={cid}", timeout=120.0)
        if resp.status_code == 200:
            logger.info(f"Propagate: pinned {cid[:20]}...")
    except Exception as e:
        logger.warning(f"Propagate: pin failed for {cid[:20]}: {e}")

    # DHT provide — announce to network that we have this content
    try:
        resp = await client.post(f"{KUBO_API}/dht/provide?arg={cid}", timeout=60.0)
        if resp.status_code == 200:
            logger.info(f"Propagate: DHT provide for {cid[:20]}...")
    except Exception as e:
        logger.warning(f"Propagate: DHT provide failed for {cid[:20]}: {e}")

    # Warm public gateways — trigger them to fetch and cache our content
    for gw in PUBLIC_IPFS_GATEWAYS[:2]:  # Only first 2 to avoid excess load
        try:
            resp = await client.head(f"{gw}{cid}", timeout=10.0, follow_redirects=True)
            logger.info(f"Propagate: warmed gateway {gw} for {cid[:20]} (HTTP {resp.status_code})")
        except Exception:
            pass  # Best effort


@router.post("/ipfs/propagate/{cid:path}")
async def ipfs_propagate(cid: str, bg: BackgroundTasks = None):
    """Aggressively propagate a CID: pin, DHT provide, and warm public gateways.
    Call this after uploading important content to ensure network availability."""
    if bg:
        bg.add_task(_propagate_background, cid)
    return {"success": True, "cid": cid, "status": "propagation_queued"}


@router.get("/ipfs/pins")
async def ipfs_list_pins():
    """List all pinned CIDs on our local Kubo node."""
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/pin/ls?type=recursive", timeout=30.0)
        if resp.status_code == 200:
            import json
            data = json.loads(resp.text)
            keys = data.get("Keys", {})
            return {
                "success": True,
                "count": len(keys),
                "uploaded_count": len(_uploaded_cids),
                "pins": list(keys.keys()),
            }
        else:
            return {"success": True, "count": 0, "pins": []}
    except Exception:
        return {"success": True, "count": 0, "pins": []}


# ─── Garbage Collection ───

async def _is_on_public_gateway(cid: str) -> bool:
    """Quick check if a CID is available on a public gateway (HEAD request)."""
    client = get_client()
    for gw in PUBLIC_IPFS_GATEWAYS[:2]:
        try:
            resp = await client.head(f"{gw}{cid}", timeout=8.0, follow_redirects=True)
            if resp.status_code == 200:
                return True
        except Exception:
            continue
    return False


async def _unpin_cid(cid: str) -> bool:
    """Unpin a CID from the local Kubo node."""
    try:
        client = get_client()
        resp = await client.post(f"{KUBO_API}/pin/rm?arg={cid}", timeout=15.0)
        if resp.status_code == 200:
            logger.info(f"GC: unpinned {cid[:20]}...")
            return True
        else:
            logger.warning(f"GC: unpin failed for {cid[:20]}: {resp.status_code}")
            return False
    except Exception as e:
        logger.warning(f"GC: unpin error for {cid[:20]}: {e}")
        return False


async def _run_gc():
    """Run IPFS garbage collection:
    1. Get all pinned CIDs
    2. Skip user-uploaded CIDs (always keep)
    3. Unpin CIDs not accessed in 48h
    4. For recently-accessed CIDs, unpin if available on public gateways
    5. Run Kubo repo GC to reclaim disk space
    """
    global _gc_running
    if _gc_running:
        return {"status": "already_running"}
    _gc_running = True

    try:
        import json
        client = get_client()
        stats = {"checked": 0, "unpinned_stale": 0, "unpinned_gateway": 0, "kept_uploaded": 0, "kept_recent": 0, "errors": 0}

        # Get all pinned CIDs
        try:
            resp = await client.post(f"{KUBO_API}/pin/ls?type=recursive", timeout=30.0)
            if resp.status_code != 200:
                return {"status": "error", "detail": "Could not list pins"}
            data = json.loads(resp.text)
            pinned_cids = list(data.get("Keys", {}).keys())
        except Exception as e:
            return {"status": "error", "detail": str(e)}

        now = time.time()
        logger.info(f"GC: checking {len(pinned_cids)} pinned CIDs...")

        for cid in pinned_cids:
            stats["checked"] += 1

            # Never unpin user uploads
            if cid in _uploaded_cids:
                stats["kept_uploaded"] += 1
                continue

            last_access = _cid_access_log.get(cid, 0)
            age = now - last_access if last_access > 0 else float('inf')

            # Stale: not accessed in 48 hours (or never tracked)
            if age > STALE_THRESHOLD:
                if await _unpin_cid(cid):
                    stats["unpinned_stale"] += 1
                    _cid_access_log.pop(cid, None)
                else:
                    stats["errors"] += 1
                continue

            # Recently accessed but check if public gateways have it
            if await _is_on_public_gateway(cid):
                if await _unpin_cid(cid):
                    stats["unpinned_gateway"] += 1
                    _cid_access_log.pop(cid, None)
                else:
                    stats["errors"] += 1
            else:
                stats["kept_recent"] += 1

        # Run Kubo's internal garbage collection to reclaim disk space
        try:
            resp = await client.post(f"{KUBO_API}/repo/gc", timeout=120.0)
            if resp.status_code == 200:
                logger.info("GC: Kubo repo GC completed")
                stats["repo_gc"] = "completed"
            else:
                stats["repo_gc"] = f"failed ({resp.status_code})"
        except Exception as e:
            stats["repo_gc"] = f"error: {e}"

        logger.info(f"GC complete: {stats}")
        return {"status": "completed", **stats}
    finally:
        _gc_running = False


@router.post("/ipfs/gc")
async def ipfs_garbage_collect(bg: BackgroundTasks = None):
    """Trigger IPFS garbage collection.
    Unpins CIDs not accessed in 48h, and CIDs available on public gateways.
    User uploads are never unpinned."""
    if bg:
        bg.add_task(_run_gc)
        return {"status": "gc_queued", "stale_threshold_hours": STALE_THRESHOLD / 3600}
    result = await _run_gc()
    return result


@router.get("/ipfs/gc/stats")
async def ipfs_gc_stats():
    """Get current GC tracking stats."""
    now = time.time()
    stale_count = sum(1 for t in _cid_access_log.values() if now - t > STALE_THRESHOLD)
    return {
        "tracked_cids": len(_cid_access_log),
        "uploaded_cids": len(_uploaded_cids),
        "stale_cids": stale_count,
        "gc_running": _gc_running,
        "stale_threshold_hours": STALE_THRESHOLD / 3600,
    }


@router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    filepath = Path("/app/backend/uploads") / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)
