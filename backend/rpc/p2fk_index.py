"""
P2FK Local Index — SQLite storage for decoded roots (Desktop only).

Stores decoded P2FK Root objects from chain scanning in a dedicated SQLite
database separate from the web app's DB.  Provides fast lookups by:
  - TXID
  - SignedBy address
  - Keyword address
  - Block height range
  - File type (OBJ, PRO, MSG, GIV, BRN, BUY, LST, etc.)

Also tracks scan progress (last scanned height) per chain so the scanner
can resume after restart.
"""

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)

# Desktop index lives in its own file, separate from the web app's cthulhu.db
INDEX_DB_PATH = Path(__file__).parent.parent / "p2fk_index.db"

_conn: Optional[aiosqlite.Connection] = None
_ready = False


async def get_index_conn() -> aiosqlite.Connection:
    """Return the shared index DB connection."""
    global _conn
    if _conn is None:
        _conn = await aiosqlite.connect(str(INDEX_DB_PATH))
        await _conn.execute("PRAGMA journal_mode=WAL")
        await _conn.execute("PRAGMA busy_timeout=10000")
        await _conn.execute("PRAGMA synchronous=NORMAL")
        logger.info(f"P2FK index DB opened: {INDEX_DB_PATH}")
    return _conn


async def init_index_db():
    """Create tables and indexes if they don't exist."""
    global _ready
    if _ready:
        return
    conn = await get_index_conn()

    await conn.executescript("""
        CREATE TABLE IF NOT EXISTS roots (
            txid          TEXT PRIMARY KEY,
            chain         TEXT NOT NULL,
            signed_by     TEXT NOT NULL,
            block_height  INTEGER NOT NULL,
            block_date    TEXT,
            messages      TEXT,
            files         TEXT,
            keywords      TEXT,
            outputs       TEXT,
            hash          TEXT,
            signature     TEXT,
            signed        INTEGER DEFAULT 0,
            total_bytes   INTEGER DEFAULT 0,
            raw_json      TEXT NOT NULL,
            indexed_at    REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_roots_chain
            ON roots(chain);
        CREATE INDEX IF NOT EXISTS idx_roots_signed_by
            ON roots(signed_by);
        CREATE INDEX IF NOT EXISTS idx_roots_block_height
            ON roots(chain, block_height);

        CREATE TABLE IF NOT EXISTS root_keywords (
            txid     TEXT NOT NULL,
            chain    TEXT NOT NULL,
            address  TEXT NOT NULL,
            keyword  TEXT NOT NULL,
            PRIMARY KEY (txid, address)
        );

        CREATE INDEX IF NOT EXISTS idx_kw_address
            ON root_keywords(address);
        CREATE INDEX IF NOT EXISTS idx_kw_chain
            ON root_keywords(chain);

        CREATE TABLE IF NOT EXISTS root_files (
            txid      TEXT NOT NULL,
            chain     TEXT NOT NULL,
            filename  TEXT NOT NULL,
            filesize  INTEGER NOT NULL,
            PRIMARY KEY (txid, filename)
        );

        CREATE INDEX IF NOT EXISTS idx_files_type
            ON root_files(filename);
        CREATE INDEX IF NOT EXISTS idx_files_chain
            ON root_files(chain);

        CREATE TABLE IF NOT EXISTS scan_progress (
            chain         TEXT PRIMARY KEY,
            last_height   INTEGER NOT NULL DEFAULT 0,
            tip_height    INTEGER NOT NULL DEFAULT 0,
            roots_found   INTEGER NOT NULL DEFAULT 0,
            updated_at    REAL NOT NULL,
            status        TEXT NOT NULL DEFAULT 'idle'
        );
    """)
    await conn.commit()
    _ready = True
    logger.info("P2FK index tables initialized")


# ── Scan Progress ────────────────────────────────────────────────────────────

async def get_scan_progress(chain: str) -> dict:
    await init_index_db()
    conn = await get_index_conn()
    async with conn.execute(
        "SELECT last_height, tip_height, roots_found, updated_at, status "
        "FROM scan_progress WHERE chain = ?", (chain,)
    ) as cur:
        row = await cur.fetchone()
    if row:
        return {
            "chain": chain,
            "last_height": row[0],
            "tip_height": row[1],
            "roots_found": row[2],
            "updated_at": row[3],
            "status": row[4],
        }
    return {
        "chain": chain,
        "last_height": 0,
        "tip_height": 0,
        "roots_found": 0,
        "updated_at": 0,
        "status": "idle",
    }


async def set_scan_progress(chain: str, last_height: int, tip_height: int,
                            roots_found: int, status: str = "scanning"):
    await init_index_db()
    conn = await get_index_conn()
    await conn.execute(
        "INSERT OR REPLACE INTO scan_progress "
        "(chain, last_height, tip_height, roots_found, updated_at, status) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (chain, last_height, tip_height, roots_found, time.time(), status),
    )
    await conn.commit()


# ── Root Storage ─────────────────────────────────────────────────────────────

async def store_root(chain: str, root_dict: dict):
    """Store a decoded P2FK Root in the index."""
    await init_index_db()
    conn = await get_index_conn()

    txid = root_dict.get("TransactionId", "")
    if not txid:
        return

    files = root_dict.get("File", {})
    keywords = root_dict.get("Keyword", {})

    await conn.execute(
        "INSERT OR IGNORE INTO roots "
        "(txid, chain, signed_by, block_height, block_date, messages, files, "
        " keywords, outputs, hash, signature, signed, total_bytes, raw_json, indexed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            txid,
            chain,
            root_dict.get("SignedBy", ""),
            root_dict.get("BlockHeight", 0),
            root_dict.get("BlockDate", ""),
            json.dumps(root_dict.get("Message", []), default=str),
            json.dumps(files, default=str),
            json.dumps(keywords, default=str),
            json.dumps(root_dict.get("Output", {}), default=str),
            root_dict.get("Hash", ""),
            root_dict.get("Signature", ""),
            1 if root_dict.get("Signed") else 0,
            root_dict.get("TotalByteSize", 0),
            json.dumps(root_dict, default=str),
            time.time(),
        ),
    )

    # Index keywords
    for addr, kw in keywords.items():
        await conn.execute(
            "INSERT OR IGNORE INTO root_keywords (txid, chain, address, keyword) "
            "VALUES (?, ?, ?, ?)",
            (txid, chain, addr, kw),
        )

    # Index files
    for fname, fsize in files.items():
        await conn.execute(
            "INSERT OR IGNORE INTO root_files (txid, chain, filename, filesize) "
            "VALUES (?, ?, ?, ?)",
            (txid, chain, fname, fsize if isinstance(fsize, int) else 0),
        )

    await conn.commit()


async def store_roots_batch(chain: str, roots: list):
    """Store multiple roots efficiently in a single transaction."""
    if not roots:
        return
    await init_index_db()
    conn = await get_index_conn()

    for root_dict in roots:
        txid = root_dict.get("TransactionId", "")
        if not txid:
            continue

        files = root_dict.get("File", {})
        keywords = root_dict.get("Keyword", {})

        await conn.execute(
            "INSERT OR IGNORE INTO roots "
            "(txid, chain, signed_by, block_height, block_date, messages, files, "
            " keywords, outputs, hash, signature, signed, total_bytes, raw_json, indexed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                txid, chain,
                root_dict.get("SignedBy", ""),
                root_dict.get("BlockHeight", 0),
                root_dict.get("BlockDate", ""),
                json.dumps(root_dict.get("Message", []), default=str),
                json.dumps(files, default=str),
                json.dumps(keywords, default=str),
                json.dumps(root_dict.get("Output", {}), default=str),
                root_dict.get("Hash", ""),
                root_dict.get("Signature", ""),
                1 if root_dict.get("Signed") else 0,
                root_dict.get("TotalByteSize", 0),
                json.dumps(root_dict, default=str),
                time.time(),
            ),
        )

        for addr, kw in keywords.items():
            await conn.execute(
                "INSERT OR IGNORE INTO root_keywords (txid, chain, address, keyword) "
                "VALUES (?, ?, ?, ?)",
                (txid, chain, addr, kw),
            )

        for fname, fsize in files.items():
            await conn.execute(
                "INSERT OR IGNORE INTO root_files (txid, chain, filename, filesize) "
                "VALUES (?, ?, ?, ?)",
                (txid, chain, fname, fsize if isinstance(fsize, int) else 0),
            )

    await conn.commit()


# ── Query Methods ────────────────────────────────────────────────────────────

async def get_root_by_txid(txid: str) -> Optional[dict]:
    await init_index_db()
    conn = await get_index_conn()
    async with conn.execute(
        "SELECT raw_json FROM roots WHERE txid = ?", (txid,)
    ) as cur:
        row = await cur.fetchone()
    return json.loads(row[0]) if row else None


async def get_roots_by_address(address: str, chain: str = None) -> list:
    """Get all roots signed by a given address."""
    await init_index_db()
    conn = await get_index_conn()
    if chain:
        sql = "SELECT raw_json FROM roots WHERE signed_by = ? AND chain = ? ORDER BY block_height"
        params = (address, chain)
    else:
        sql = "SELECT raw_json FROM roots WHERE signed_by = ? ORDER BY block_height"
        params = (address,)
    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [json.loads(r[0]) for r in rows]


async def get_roots_at_keyword(keyword_address: str, chain: str = None) -> list:
    """Get all roots that reference a keyword address."""
    await init_index_db()
    conn = await get_index_conn()
    if chain:
        sql = ("SELECT r.raw_json FROM roots r "
               "JOIN root_keywords k ON r.txid = k.txid "
               "WHERE k.address = ? AND k.chain = ? ORDER BY r.block_height")
        params = (keyword_address, chain)
    else:
        sql = ("SELECT r.raw_json FROM roots r "
               "JOIN root_keywords k ON r.txid = k.txid "
               "WHERE k.address = ? ORDER BY r.block_height")
        params = (keyword_address,)
    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [json.loads(r[0]) for r in rows]


async def get_roots_by_file_type(file_type: str, chain: str = None,
                                  limit: int = 100, offset: int = 0) -> list:
    """Get roots containing a specific file type (OBJ, PRO, GIV, etc.)."""
    await init_index_db()
    conn = await get_index_conn()
    if chain:
        sql = ("SELECT r.raw_json FROM roots r "
               "JOIN root_files f ON r.txid = f.txid "
               "WHERE f.filename = ? AND f.chain = ? "
               "ORDER BY r.block_height DESC LIMIT ? OFFSET ?")
        params = (file_type, chain, limit, offset)
    else:
        sql = ("SELECT r.raw_json FROM roots r "
               "JOIN root_files f ON r.txid = f.txid "
               "WHERE f.filename = ? "
               "ORDER BY r.block_height DESC LIMIT ? OFFSET ?")
        params = (file_type, limit, offset)
    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [json.loads(r[0]) for r in rows]


async def search_roots(query: str, chain: str = None, limit: int = 50) -> list:
    """Search roots by message content or keyword text."""
    await init_index_db()
    conn = await get_index_conn()
    like = f"%{query}%"
    if chain:
        sql = ("SELECT raw_json FROM roots "
               "WHERE chain = ? AND (messages LIKE ? OR keywords LIKE ?) "
               "ORDER BY block_height DESC LIMIT ?")
        params = (chain, like, like, limit)
    else:
        sql = ("SELECT raw_json FROM roots "
               "WHERE messages LIKE ? OR keywords LIKE ? "
               "ORDER BY block_height DESC LIMIT ?")
        params = (like, like, limit)
    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()
    return [json.loads(r[0]) for r in rows]


async def get_index_stats() -> dict:
    """Return summary statistics for the index."""
    await init_index_db()
    conn = await get_index_conn()

    stats = {}
    async with conn.execute("SELECT COUNT(*) FROM roots") as cur:
        stats["total_roots"] = (await cur.fetchone())[0]
    async with conn.execute(
        "SELECT chain, COUNT(*) FROM roots GROUP BY chain"
    ) as cur:
        stats["by_chain"] = {r[0]: r[1] for r in await cur.fetchall()}
    async with conn.execute(
        "SELECT filename, COUNT(*) FROM root_files GROUP BY filename ORDER BY COUNT(*) DESC LIMIT 20"
    ) as cur:
        stats["by_file_type"] = {r[0]: r[1] for r in await cur.fetchall()}
    async with conn.execute(
        "SELECT chain, last_height, tip_height, roots_found, status FROM scan_progress"
    ) as cur:
        stats["scan_progress"] = {
            r[0]: {"last_height": r[1], "tip_height": r[2],
                   "roots_found": r[3], "status": r[4]}
            for r in await cur.fetchall()
        }

    return stats


async def close_index_db():
    global _conn, _ready
    if _conn:
        await _conn.close()
        _conn = None
        _ready = False
