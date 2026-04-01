"""Admin routes: separate auth, settings management, bug reports, error logs."""
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import logging
import os
import bcrypt
import jwt
import time
import secrets

from db import admin_col, bug_reports_col, error_logs_col, users_col, db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin")

# ─── Security: credentials from .env ONLY (never hardcoded) ───
JWT_SECRET = os.environ["ADMIN_JWT_SECRET"]
ADMIN_USERNAME = os.environ["ADMIN_USERNAME"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = 24
security = HTTPBearer()

# ─── Rate limiting: 5 failed attempts = 15 min lockout ───
_login_attempts = {}  # { ip: { count, locked_until } }
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes

# ─── Session invalidation: bump this to force all tokens to re-auth ───
_session_epoch = int(time.time())

# ─── Default admin settings ───
DEFAULT_SETTINGS = {
    "_id": "settings",
    "faucet_amount": 100000,
    "tax_rate": 0.02,
    "faucet_amount_mainnet": 0,
    "tax_rate_mainnet": 0.02,
    "treasury_addresses": {"btc": "", "btc_testnet": ""},
    "admin_pkx": "",
    "admin_pky": "",
    "supflix_keywords": ["movie"],
    "jukebox_keywords": ["music"],
}


# ─── Helpers ───

async def _get_settings():
    doc = await admin_col.find_one({"_id": "settings"})
    if not doc:
        await admin_col.insert_one({**DEFAULT_SETTINGS})
        doc = {**DEFAULT_SETTINGS}
    doc.pop("_id", None)
    return doc


async def _ensure_admin_user():
    """Create or update admin user from .env credentials (single source of truth)."""
    existing = await admin_col.find_one({"_id": "admin_user"})
    hashed = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
    if not existing:
        await admin_col.insert_one({
            "_id": "admin_user",
            "username": ADMIN_USERNAME,
            "password_hash": hashed,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        # Sync username from .env (password only resets on explicit action)
        if existing.get("username") != ADMIN_USERNAME:
            await admin_col.update_one(
                {"_id": "admin_user"},
                {"$set": {"username": ADMIN_USERNAME, "password_hash": hashed}},
            )


def _create_admin_token(username: str) -> str:
    return jwt.encode(
        {
            "sub": username,
            "role": "admin",
            "iat": int(time.time()),
            "exp": int(time.time()) + (TOKEN_EXPIRY_HOURS * 3600),
            "epoch": _session_epoch,
        },
        JWT_SECRET, algorithm=ALGORITHM,
    )


async def _verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not an admin token")
        # Check session epoch — force re-login if sessions were invalidated
        if payload.get("epoch", 0) < _session_epoch:
            raise HTTPException(status_code=401, detail="Session invalidated — please log in again")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _check_rate_limit(client_ip: str):
    """Check if client IP is rate-limited. Raises 429 if locked out."""
    now = time.time()
    entry = _login_attempts.get(client_ip)
    if entry:
        if entry.get("locked_until", 0) > now:
            remaining = int(entry["locked_until"] - now)
            raise HTTPException(
                status_code=429,
                detail=f"Too many failed attempts. Try again in {remaining} seconds."
            )
        # Reset if lockout expired
        if entry.get("locked_until", 0) <= now and entry.get("count", 0) >= MAX_ATTEMPTS:
            _login_attempts[client_ip] = {"count": 0}


def _record_failed_attempt(client_ip: str):
    """Record a failed login attempt. Lock out after MAX_ATTEMPTS."""
    now = time.time()
    entry = _login_attempts.get(client_ip, {"count": 0})
    entry["count"] = entry.get("count", 0) + 1
    if entry["count"] >= MAX_ATTEMPTS:
        entry["locked_until"] = now + LOCKOUT_SECONDS
        logger.warning(f"Admin login locked out for IP {client_ip} — {MAX_ATTEMPTS} failed attempts")
    _login_attempts[client_ip] = entry


def _clear_attempts(client_ip: str):
    """Clear failed attempts on successful login."""
    _login_attempts.pop(client_ip, None)


# ─── Auth endpoints ───

class AdminLogin(BaseModel):
    username: str
    password: str


@router.post("/login")
async def admin_login(body: AdminLogin, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    await _ensure_admin_user()
    user = await admin_col.find_one({"_id": "admin_user"})
    if not user:
        _record_failed_attempt(client_ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if body.username != user["username"]:
        _record_failed_attempt(client_ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        _record_failed_attempt(client_ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    _clear_attempts(client_ip)
    token = _create_admin_token(body.username)
    return {"token": token, "username": user["username"]}


class ChangePassword(BaseModel):
    current_password: str
    new_password: str
    new_username: Optional[str] = None


@router.post("/change-password")
async def change_password(body: ChangePassword, _=Depends(_verify_admin)):
    user = await admin_col.find_one({"_id": "admin_user"})
    if not user or not bcrypt.checkpw(body.current_password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Current password incorrect")
    update = {"password_hash": bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()}
    if body.new_username:
        update["username"] = body.new_username
    await admin_col.update_one({"_id": "admin_user"}, {"$set": update})
    return {"success": True}


@router.post("/invalidate-sessions")
async def invalidate_all_sessions(_=Depends(_verify_admin)):
    """Force-logout all admin sessions by bumping the session epoch."""
    global _session_epoch
    _session_epoch = int(time.time())
    return {"success": True, "message": "All admin sessions invalidated. Please log in again."}


# ─── WIF Recovery ───

# In-memory challenge store (short-lived)
_recovery_challenges = {}  # { challenge: { address, expires } }


class SetRecoveryAddress(BaseModel):
    address: str


class RecoverWithWIF(BaseModel):
    wif: str
    challenge: str
    signature: str
    new_username: str
    new_password: str


@router.post("/set-recovery-address")
async def set_recovery_address(body: SetRecoveryAddress, _=Depends(_verify_admin)):
    """Set the recovery address (admin wallet address used for credential recovery)."""
    if not body.address or len(body.address) < 20:
        raise HTTPException(status_code=400, detail="Invalid address")
    # Reject WIF keys — user must provide a public ADDRESS, not a private key
    if body.address[0] in ('5', 'K', 'L', 'c') and len(body.address) > 50:
        raise HTTPException(
            status_code=400,
            detail="This looks like a WIF private key, not a public address. Please enter your PUBLIC wallet address (starts with m/n for testnet, or 1/3/bc1 for mainnet)."
        )
    await admin_col.update_one(
        {"_id": "admin_user"},
        {"$set": {"recovery_address": body.address}},
    )
    return {"success": True, "recovery_address": body.address}


@router.get("/recovery-address")
async def get_recovery_address(_=Depends(_verify_admin)):
    """Get the current recovery address."""
    user = await admin_col.find_one({"_id": "admin_user"})
    addr = (user or {}).get("recovery_address", "")
    return {"recovery_address": addr, "is_set": bool(addr)}


@router.get("/recovery-challenge")
async def get_recovery_challenge():
    """Public: get a random challenge string to sign for recovery."""
    user = await admin_col.find_one({"_id": "admin_user"})
    recovery_addr = (user or {}).get("recovery_address", "")
    if not recovery_addr:
        raise HTTPException(status_code=404, detail="No recovery address configured")

    challenge = secrets.token_hex(32)
    _recovery_challenges[challenge] = {
        "address": recovery_addr,
        "expires": time.time() + 300,  # 5 min
    }

    # Clean up expired challenges
    now = time.time()
    expired = [k for k, v in _recovery_challenges.items() if v["expires"] < now]
    for k in expired:
        del _recovery_challenges[k]

    # Return masked address for user to know which WIF to use
    masked = recovery_addr[:6] + "..." + recovery_addr[-6:]
    return {"challenge": challenge, "masked_address": masked}


@router.post("/recover-with-wif")
async def recover_with_wif(body: RecoverWithWIF):
    """Public: verify WIF ownership and reset admin credentials."""
    from bit import PrivateKeyTestnet, PrivateKey

    # Validate challenge
    ch = _recovery_challenges.get(body.challenge)
    if not ch:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge")
    if time.time() > ch["expires"]:
        del _recovery_challenges[body.challenge]
        raise HTTPException(status_code=400, detail="Challenge expired")

    recovery_addr = ch["address"]

    # Verify WIF matches recovery address
    try:
        # Try testnet first, then mainnet
        try:
            key = PrivateKeyTestnet(body.wif)
        except Exception:
            key = PrivateKey(body.wif)

        if key.address != recovery_addr:
            raise HTTPException(status_code=403, detail="WIF does not match the recovery address")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid WIF: {e}")

    # WIF → address match above is sufficient proof of key ownership.
    # No additional signature verification needed.

    # Consume the challenge
    del _recovery_challenges[body.challenge]

    # Validate new credentials
    if not body.new_username or len(body.new_username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if not body.new_password or len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Reset credentials
    new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await admin_col.update_one(
        {"_id": "admin_user"},
        {"$set": {"username": body.new_username, "password_hash": new_hash}},
    )

    logger.info(f"Admin credentials recovered via WIF for address {recovery_addr[:10]}...")
    return {"success": True, "message": "Credentials reset. You can now login with your new credentials."}


# ─── Settings endpoints ───

@router.get("/settings")
async def get_settings(_=Depends(_verify_admin)):
    return await _get_settings()


class UpdateSettings(BaseModel):
    faucet_amount: Optional[int] = None
    tax_rate: Optional[float] = None
    faucet_amount_mainnet: Optional[int] = None
    tax_rate_mainnet: Optional[float] = None
    treasury_btc: Optional[str] = None
    treasury_btc_testnet: Optional[str] = None
    admin_pkx: Optional[str] = None
    admin_pky: Optional[str] = None
    supflix_keywords: Optional[list] = None
    jukebox_keywords: Optional[list] = None


@router.put("/settings")
async def update_settings(body: UpdateSettings, _=Depends(_verify_admin)):
    update = {}
    if body.faucet_amount is not None:
        update["faucet_amount"] = body.faucet_amount
    if body.tax_rate is not None:
        update["tax_rate"] = body.tax_rate
    if body.faucet_amount_mainnet is not None:
        update["faucet_amount_mainnet"] = body.faucet_amount_mainnet
    if body.tax_rate_mainnet is not None:
        update["tax_rate_mainnet"] = body.tax_rate_mainnet
    if body.treasury_btc is not None:
        update["treasury_addresses.btc"] = body.treasury_btc
    if body.treasury_btc_testnet is not None:
        update["treasury_addresses.btc_testnet"] = body.treasury_btc_testnet
    if body.admin_pkx is not None:
        update["admin_pkx"] = body.admin_pkx
    if body.admin_pky is not None:
        update["admin_pky"] = body.admin_pky
    if body.supflix_keywords is not None:
        update["supflix_keywords"] = [kw.strip() for kw in body.supflix_keywords if kw.strip()]
    if body.jukebox_keywords is not None:
        update["jukebox_keywords"] = [kw.strip() for kw in body.jukebox_keywords if kw.strip()]
    if update:
        await admin_col.update_one({"_id": "settings"}, {"$set": update}, upsert=True)
    return await _get_settings()


# Public endpoint: get admin PKX/PKY for users to encrypt reports
@router.get("/public-keys")
async def get_admin_public_keys():
    settings = await _get_settings()
    return {
        "admin_pkx": settings.get("admin_pkx", ""),
        "admin_pky": settings.get("admin_pky", ""),
    }


# Public endpoint: get SUPflix featured keywords
@router.get("/supflix-keywords")
async def get_supflix_keywords():
    settings = await _get_settings()
    keywords = settings.get("supflix_keywords", ["movie"])
    return {"keywords": keywords if keywords else ["movie"]}


@router.get("/jukebox-keywords")
async def get_jukebox_keywords():
    settings = await _get_settings()
    keywords = settings.get("jukebox_keywords", ["music"])
    return {"keywords": keywords if keywords else ["music"]}


# ─── Bug Reports ───

class BugReport(BaseModel):
    subject: str
    message: str
    user_address: Optional[str] = None
    user_urn: Optional[str] = None
    network: Optional[str] = "btc-testnet"


@router.post("/reports")
async def submit_bug_report(body: BugReport):
    """Public endpoint: any user can submit a bug report."""
    report = {
        "subject": body.subject,
        "message": body.message,
        "user_address": body.user_address,
        "user_urn": body.user_urn,
        "network": body.network,
        "status": "open",
        "admin_response": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await bug_reports_col.insert_one(report)
    return {"success": True, "report_id": str(result.inserted_id)}


@router.get("/reports")
async def get_reports(status: Optional[str] = None, skip: int = 0, limit: int = 50, _=Depends(_verify_admin)):
    query = {}
    if status:
        query["status"] = status
    cursor = bug_reports_col.find(query).sort("created_at", -1).skip(skip).limit(limit)
    reports = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        reports.append(doc)
    total = await bug_reports_col.count_documents(query)
    return {"reports": reports, "total": total}


class ReportResponse(BaseModel):
    response: str
    status: Optional[str] = "responded"


@router.put("/reports/{report_id}")
async def respond_to_report(report_id: str, body: ReportResponse, _=Depends(_verify_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid report ID")
    result = await bug_reports_col.update_one(
        {"_id": oid},
        {"$set": {
            "admin_response": body.response,
            "status": body.status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"success": True}


# User endpoint: get their own reports
@router.get("/my-reports/{address}")
async def get_my_reports(address: str):
    cursor = bug_reports_col.find({"user_address": address}).sort("created_at", -1).limit(20)
    reports = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        reports.append(doc)
    return {"reports": reports}


# ─── Error Logs ───

@router.get("/errors")
async def get_error_logs(skip: int = 0, limit: int = 100, level: str = "", _=Depends(_verify_admin)):
    query = {}
    if level:
        query["level"] = level.upper()
    cursor = error_logs_col.find(query, {"_id": 0}).sort("timestamp", -1).skip(skip).limit(limit)
    logs = []
    async for doc in cursor:
        logs.append(doc)
    total = await error_logs_col.count_documents(query)
    # Also grab recent supervisor/backend log lines as a fallback
    import subprocess
    try:
        result = subprocess.run(
            ["tail", "-50", "/var/log/supervisor/backend.err.log"],
            capture_output=True, text=True, timeout=5
        )
        raw_lines = result.stdout.strip().split('\n') if result.stdout.strip() else []
        # Filter to only warning/error lines
        stderr_errors = [l for l in raw_lines if any(k in l.lower() for k in ['error', 'exception', 'traceback', 'fail', 'critical', '500', '429'])]
    except Exception:
        stderr_errors = []
    return {"logs": logs, "total": total, "stderr_tail": stderr_errors[-20:] if stderr_errors else []}


@router.delete("/errors")
async def clear_error_logs(_=Depends(_verify_admin)):
    result = await error_logs_col.delete_many({})
    return {"deleted": result.deleted_count}


# ─── Dashboard Stats ───

@router.get("/stats")
async def get_dashboard_stats(_=Depends(_verify_admin)):
    user_count = await users_col.count_documents({})
    open_reports = await bug_reports_col.count_documents({"status": "open"})
    total_reports = await bug_reports_col.count_documents({})
    error_count = await error_logs_col.count_documents({})
    return {
        "users": user_count,
        "open_reports": open_reports,
        "total_reports": total_reports,
        "error_count": error_count,
    }



@router.get("/system-stats")
async def get_system_stats(_=Depends(_verify_admin)):
    """Full system stats: external API calls, cache metrics, MongoDB sizes, CPU/memory."""
    import psutil
    from utils.stats_tracker import get_stats

    # 1. In-memory call/cache stats
    tracker_stats = get_stats()

    # 2. MongoDB collection sizes
    collection_names = await db.list_collection_names()
    mongo_stats = {}
    total_docs = 0
    total_size_bytes = 0
    for col_name in sorted(collection_names):
        try:
            stats = await db.command("collStats", col_name)
            doc_count = stats.get("count", 0)
            size = stats.get("size", 0)  # data size in bytes
            storage = stats.get("storageSize", 0)
            mongo_stats[col_name] = {
                "documents": doc_count,
                "data_size_mb": round(size / 1024 / 1024, 2),
                "storage_size_mb": round(storage / 1024 / 1024, 2),
            }
            total_docs += doc_count
            total_size_bytes += size
        except Exception:
            mongo_stats[col_name] = {"documents": 0, "data_size_mb": 0, "storage_size_mb": 0}

    # 3. System resources
    cpu_percent = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    process = psutil.Process()
    proc_mem = process.memory_info()

    system = {
        "cpu_percent": cpu_percent,
        "memory_total_mb": round(mem.total / 1024 / 1024),
        "memory_used_mb": round(mem.used / 1024 / 1024),
        "memory_percent": mem.percent,
        "disk_total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
        "disk_used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
        "disk_percent": round(disk.percent, 1),
        "process_memory_mb": round(proc_mem.rss / 1024 / 1024, 1),
    }

    return {
        "tracker": tracker_stats,
        "mongodb": {
            "collections": mongo_stats,
            "total_documents": total_docs,
            "total_data_size_mb": round(total_size_bytes / 1024 / 1024, 2),
        },
        "system": system,
    }


@router.post("/reset-stats")
async def reset_api_stats(_=Depends(_verify_admin)):
    """Reset the in-memory API call counters."""
    from utils.stats_tracker import reset_stats
    reset_stats()
    return {"ok": True, "message": "Stats counters reset"}
