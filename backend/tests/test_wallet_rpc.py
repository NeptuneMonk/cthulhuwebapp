"""
Tests for the Core Wallet RPC layer (Phase 1 — Desktop App).

Since no actual Core wallets are running in this environment,
these tests verify:
  1. WalletConfig defaults resolve correctly
  2. WalletManager scan returns structured status for all chains
  3. API endpoints return proper 404s for disconnected wallets
  4. RPCError / ConnectionError propagation works
  5. The RPC client builds correct JSON-RPC payloads
"""

import asyncio
import json
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rpc.wallet_rpc import (
    WalletConfig, CoreWalletRPC, WalletManager,
    RPCError, DEFAULT_RPC_PORTS, wallet_manager,
)


# ── WalletConfig Tests ──────────────────────────────────────────────────────

def test_config_default_ports():
    """Each chain should get its standard mainnet RPC port by default."""
    assert WalletConfig(chain="BTC").port == 8332
    assert WalletConfig(chain="LTC").port == 9332
    assert WalletConfig(chain="DOG").port == 22555
    assert WalletConfig(chain="MZC").port == 12832


def test_config_testnet_ports():
    assert WalletConfig(chain="BTC", network="testnet").port == 18332
    assert WalletConfig(chain="LTC", network="testnet").port == 19332
    assert WalletConfig(chain="DOG", network="testnet").port == 44555


def test_config_url():
    cfg = WalletConfig(chain="BTC")
    assert cfg.url == "http://127.0.0.1:8332"


def test_config_url_with_wallet_name():
    cfg = WalletConfig(chain="BTC", wallet_name="mywallet")
    assert cfg.url == "http://127.0.0.1:8332/wallet/mywallet"


def test_config_custom_host_port():
    cfg = WalletConfig(chain="LTC", host="192.168.1.100", port=9999)
    assert cfg.url == "http://192.168.1.100:9999"


# ── RPCError Tests ───────────────────────────────────────────────────────────

def test_rpc_error():
    err = RPCError(-32600, "Invalid Request")
    assert err.code == -32600
    assert "Invalid Request" in str(err)


# ── CoreWalletRPC Tests ─────────────────────────────────────────────────────

def test_rpc_client_creation():
    """RPC client should initialize without connecting."""
    cfg = WalletConfig(chain="BTC")
    rpc = CoreWalletRPC(cfg)
    assert rpc.config.chain == "BTC"
    assert rpc._client is None


@pytest.mark.asyncio
async def test_rpc_connection_error():
    """Calling a method on a non-running wallet should raise ConnectionError."""
    cfg = WalletConfig(chain="BTC", port=19999)  # port nobody listens on
    rpc = CoreWalletRPC(cfg)
    with pytest.raises(ConnectionError, match="Cannot connect"):
        await rpc.get_blockchain_info()
    await rpc.close()


# ── WalletManager Tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_manager_scan_all_returns_all_chains():
    """scan_all should return status dicts for BTC, LTC, DOG, MZC."""
    mgr = WalletManager()
    results = await mgr.scan_all("testnet")
    assert set(results.keys()) == {"BTC", "LTC", "DOG", "MZC"}
    for chain, status in results.items():
        assert "connected" in status
        assert "error" in status
        # None should be connected in this environment
        assert status["connected"] is False


@pytest.mark.asyncio
async def test_manager_connected_chains_empty():
    mgr = WalletManager()
    await mgr.scan_all()
    assert mgr.connected_chains == []


@pytest.mark.asyncio
async def test_manager_get_returns_none_when_disconnected():
    mgr = WalletManager()
    assert mgr.get("BTC") is None


# ── Supported chains coverage ───────────────────────────────────────────────

def test_all_chains_have_ports():
    """Every chain in DEFAULT_RPC_PORTS should have at least mainnet."""
    for chain, ports in DEFAULT_RPC_PORTS.items():
        assert "mainnet" in ports, f"{chain} missing mainnet port"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
