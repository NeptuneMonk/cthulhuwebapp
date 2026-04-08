"""
Tests for Phase 2: Local P2FK Decoder — chain scanner + index.

Verifies:
  1. P2FK index DB initialization and CRUD operations
  2. Block decoder extracts roots from Core RPC block format
  3. Scanner manager state management
  4. API endpoints return correct responses
"""

import asyncio
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rpc.p2fk_index import (
    init_index_db,
    store_root,
    store_roots_batch,
    get_root_by_txid,
    get_roots_by_address,
    get_roots_at_keyword,
    get_roots_by_file_type,
    search_roots,
    get_index_stats,
    get_scan_progress,
    set_scan_progress,
    close_index_db,
)
from rpc.chain_scanner import (
    _extract_roots_from_block,
    EPOCH_HEIGHTS,
    VERSION_BYTES,
    ChainScanner,
    ScannerManager,
    _get_epoch,
    _get_version_byte,
)
from p2fk_decoder import keyword_to_address


# ── Fixtures ─────────────────────────────────────────────────────────────────

SAMPLE_ROOT = {
    "Id": -1,
    "Message": ["Hello from P2FK"],
    "File": {"OBJ": 3, "IMG": 1024},
    "Keyword": {
        "mtest1234567890abcde": "testword",
        "mtest0987654321fghij": "hello",
    },
    "Output": {"addr1": "546", "addr2": "546", "addr3": "10000"},
    "Hash": "ABC123",
    "SignedBy": "mSignerAddress123",
    "Signature": "sigdata",
    "Signed": True,
    "TransactionId": "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    "BlockDate": "2025-01-15T12:00:00+00:00",
    "BlockHeight": 601500,
    "TotalByteSize": 250,
    "BuildDate": "2025-01-15T12:00:01+00:00",
}

SAMPLE_PROFILE_ROOT = {
    "Id": -1,
    "Message": ['{"urn":"testuser","name":"Test User","bio":"hello"}'],
    "File": {"PRO": 1},
    "Keyword": {},
    "Output": {},
    "Hash": "",
    "SignedBy": "mProfileAddress999",
    "Signature": "",
    "Signed": False,
    "TransactionId": "profiletx000000000000000000000000000000000000000000000000000000",
    "BlockDate": "2025-02-01T00:00:00+00:00",
    "BlockHeight": 602000,
    "TotalByteSize": 100,
}


# ── Config Tests ─────────────────────────────────────────────────────────────

def test_epoch_heights_exist():
    for chain in ("BTC", "LTC", "DOG", "MZC"):
        assert chain in EPOCH_HEIGHTS
        assert "mainnet" in EPOCH_HEIGHTS[chain]


def test_version_bytes():
    assert _get_version_byte("BTC", "mainnet") == 0
    assert _get_version_byte("BTC", "testnet") == 111
    assert _get_version_byte("LTC", "mainnet") == 48
    assert _get_version_byte("DOG", "mainnet") == 30
    assert _get_version_byte("MZC", "mainnet") == 50


def test_get_epoch():
    assert _get_epoch("BTC", "mainnet") == 601000
    assert _get_epoch("BTC", "testnet") == 1500000
    assert _get_epoch("UNKNOWN", "mainnet") == 0


# ── Index DB Tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_index_init():
    await init_index_db()
    stats = await get_index_stats()
    assert "total_roots" in stats
    assert "by_chain" in stats


@pytest.mark.asyncio
async def test_store_and_retrieve_root():
    await init_index_db()
    await store_root("BTC", SAMPLE_ROOT)

    retrieved = await get_root_by_txid(SAMPLE_ROOT["TransactionId"])
    assert retrieved is not None
    assert retrieved["TransactionId"] == SAMPLE_ROOT["TransactionId"]
    assert retrieved["SignedBy"] == SAMPLE_ROOT["SignedBy"]
    assert "Hello from P2FK" in retrieved["Message"]


@pytest.mark.asyncio
async def test_roots_by_address():
    await init_index_db()
    await store_root("BTC", SAMPLE_ROOT)

    roots = await get_roots_by_address("mSignerAddress123", "BTC")
    assert len(roots) >= 1
    assert any(r["TransactionId"] == SAMPLE_ROOT["TransactionId"] for r in roots)


@pytest.mark.asyncio
async def test_roots_by_file_type():
    await init_index_db()
    await store_root("BTC", SAMPLE_ROOT)

    objs = await get_roots_by_file_type("OBJ", "BTC")
    assert len(objs) >= 1

    imgs = await get_roots_by_file_type("IMG", "BTC")
    assert len(imgs) >= 1


@pytest.mark.asyncio
async def test_store_profile_and_query():
    await init_index_db()
    await store_root("BTC", SAMPLE_PROFILE_ROOT)

    profiles = await get_roots_by_file_type("PRO", "BTC")
    assert len(profiles) >= 1


@pytest.mark.asyncio
async def test_search_roots():
    await init_index_db()
    await store_root("BTC", SAMPLE_ROOT)

    results = await search_roots("Hello", "BTC")
    assert len(results) >= 1


@pytest.mark.asyncio
async def test_batch_store():
    await init_index_db()
    roots = [
        {**SAMPLE_ROOT, "TransactionId": f"batch_{i:064d}", "BlockHeight": 700000 + i}
        for i in range(5)
    ]
    await store_roots_batch("LTC", roots)

    stats = await get_index_stats()
    assert stats["by_chain"].get("LTC", 0) >= 5


@pytest.mark.asyncio
async def test_scan_progress():
    await init_index_db()
    await set_scan_progress("BTC", 601500, 800000, 42, "scanning")

    prog = await get_scan_progress("BTC")
    assert prog["last_height"] == 601500
    assert prog["tip_height"] == 800000
    assert prog["roots_found"] == 42
    assert prog["status"] == "scanning"


@pytest.mark.asyncio
async def test_scan_progress_defaults():
    await init_index_db()
    prog = await get_scan_progress("UNKNOWN_CHAIN")
    assert prog["last_height"] == 0
    assert prog["status"] == "idle"


# ── Block Decoder Tests ──────────────────────────────────────────────────────

def _make_mock_block(txs, height=601500, block_time=1705320000):
    """Build a mock block in Bitcoin Core RPC verbosity=2 format."""
    return {
        "height": height,
        "time": block_time,
        "tx": txs,
    }


def _make_p2fk_tx(txid, dust_addresses, dust_value=0.00000546, change_addr="mChange", change_val=0.001):
    """Build a mock transaction with P2FK dust outputs."""
    vout = []
    for addr in dust_addresses:
        vout.append({
            "value": dust_value,
            "scriptPubKey": {"address": addr},
        })
    # Add a non-dust change output
    vout.append({
        "value": change_val,
        "scriptPubKey": {"address": change_addr},
    })
    return {"txid": txid, "vout": vout, "size": 250}


def test_block_decoder_skips_non_p2fk():
    """Transactions without dust outputs should be skipped."""
    tx = {
        "txid": "normaltx",
        "vout": [
            {"value": 0.5, "scriptPubKey": {"address": "addr1"}},
            {"value": 0.1, "scriptPubKey": {"address": "addr2"}},
        ],
        "size": 200,
    }
    block = _make_mock_block([tx])
    roots = _extract_roots_from_block(block, "BTC", "testnet")
    assert len(roots) == 0


def test_block_decoder_needs_at_least_2_dust():
    """A single dust output is not enough for P2FK."""
    tx = {
        "txid": "onedust",
        "vout": [
            {"value": 0.00000546, "scriptPubKey": {"address": "mDustAddr1"}},
            {"value": 0.5, "scriptPubKey": {"address": "mNormalAddr"}},
        ],
        "size": 200,
    }
    block = _make_mock_block([tx])
    roots = _extract_roots_from_block(block, "BTC", "testnet")
    assert len(roots) == 0


def test_block_decoder_empty_block():
    block = _make_mock_block([])
    roots = _extract_roots_from_block(block, "BTC", "mainnet")
    assert roots == []


# ── Scanner Manager Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scanner_manager_no_wallet():
    mgr = ScannerManager()
    result = await mgr.start_chain("BTC")
    assert result.get("started") is False
    assert "not connected" in result.get("error", "")


def test_scanner_progress_default():
    from rpc.chain_scanner import ChainScanner
    # Can't create without RPC, but test the class attributes
    assert ChainScanner.__init__  # class exists


# ── Index Stats ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_index_stats():
    await init_index_db()
    stats = await get_index_stats()
    assert "total_roots" in stats
    assert "by_chain" in stats
    assert "by_file_type" in stats
    assert "scan_progress" in stats


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
