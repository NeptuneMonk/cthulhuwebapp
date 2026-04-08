"""
Core Wallet JSON-RPC Client for Cthulhu Desktop.

Connects to locally-running Core wallets (Bitcoin, Litecoin, Dogecoin, Maza)
via their standard JSON-RPC interfaces.  This module is used ONLY by the
desktop Tauri build — the web app never touches it.

Each wallet daemon exposes an HTTP JSON-RPC endpoint on localhost.  Credentials
can come from:
  1. Environment variables  (e.g. BTC_RPC_USER / BTC_RPC_PASS)
  2. Cookie file auth       (e.g. ~/.bitcoin/.cookie)
"""

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Default RPC ports per chain ──────────────────────────────────────────────
DEFAULT_RPC_PORTS: Dict[str, Dict[str, int]] = {
    "BTC": {"mainnet": 8332, "testnet": 18332},
    "LTC": {"mainnet": 9332, "testnet": 19332},
    "DOG": {"mainnet": 22555, "testnet": 44555},
    "MZC": {"mainnet": 12832, "testnet": 12832},
}

# Where Core wallets typically store their .cookie file
_HOME = Path.home()
DEFAULT_COOKIE_PATHS: Dict[str, Path] = {
    "BTC": _HOME / ".bitcoin" / ".cookie",
    "LTC": _HOME / ".litecoin" / ".cookie",
    "DOG": _HOME / ".dogecoin" / ".cookie",
    "MZC": _HOME / ".mazacoin" / ".cookie",
}

TESTNET_COOKIE_PATHS: Dict[str, Path] = {
    "BTC": _HOME / ".bitcoin" / "testnet3" / ".cookie",
    "LTC": _HOME / ".litecoin" / "testnet4" / ".cookie",
    "DOG": _HOME / ".dogecoin" / "testnet3" / ".cookie",
}


@dataclass
class WalletConfig:
    """Connection parameters for a single Core wallet."""
    chain: str
    network: str = "mainnet"
    host: str = "127.0.0.1"
    port: int = 0
    user: str = ""
    password: str = ""
    wallet_name: str = ""  # for multi-wallet (-wallet= flag)

    def __post_init__(self):
        if self.port == 0:
            ports = DEFAULT_RPC_PORTS.get(self.chain, {})
            self.port = ports.get(self.network, ports.get("mainnet", 8332))

    @property
    def url(self) -> str:
        base = f"http://{self.host}:{self.port}"
        if self.wallet_name:
            return f"{base}/wallet/{self.wallet_name}"
        return base


class RPCError(Exception):
    """Raised when the wallet daemon returns a JSON-RPC error."""
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"RPC error {code}: {message}")


class CoreWalletRPC:
    """Async JSON-RPC client for a single Core wallet daemon."""

    def __init__(self, config: WalletConfig):
        self.config = config
        self._id_counter = 0
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            auth = self._resolve_auth()
            self._client = httpx.AsyncClient(
                auth=auth,
                timeout=httpx.Timeout(30.0, connect=5.0),
            )
        return self._client

    def _resolve_auth(self) -> Optional[httpx.BasicAuth]:
        """Resolve RPC credentials: env vars first, then cookie file."""
        user = self.config.user
        password = self.config.password

        # Try environment variables
        if not user:
            user = os.environ.get(f"{self.config.chain}_RPC_USER", "")
            password = os.environ.get(f"{self.config.chain}_RPC_PASS", "")

        # Try cookie file
        if not user:
            cookie_path = (
                TESTNET_COOKIE_PATHS.get(self.config.chain)
                if self.config.network == "testnet"
                else DEFAULT_COOKIE_PATHS.get(self.config.chain)
            )
            if cookie_path and cookie_path.exists():
                try:
                    cookie = cookie_path.read_text().strip()
                    user, password = cookie.split(":", 1)
                    logger.info(f"[{self.config.chain}] Using cookie auth from {cookie_path}")
                except Exception as e:
                    logger.warning(f"[{self.config.chain}] Failed to read cookie: {e}")

        if user:
            return httpx.BasicAuth(user, password)
        return None

    async def call(self, method: str, params: Optional[list] = None) -> Any:
        """Execute a JSON-RPC call against the wallet daemon."""
        self._id_counter += 1
        payload = {
            "jsonrpc": "1.0",
            "id": self._id_counter,
            "method": method,
            "params": params or [],
        }
        client = await self._get_client()
        try:
            resp = await client.post(
                self.config.url,
                json=payload,
                headers={"Content-Type": "application/json"},
            )
        except httpx.ConnectError:
            raise ConnectionError(
                f"Cannot connect to {self.config.chain} wallet at {self.config.url}. "
                f"Is {self.config.chain.lower()}-qt / {self.config.chain.lower()}d running?"
            )

        if resp.status_code == 401:
            raise RPCError(-1, "Authentication failed — check RPC credentials")
        if resp.status_code == 403:
            raise RPCError(-1, "RPC forbidden — check rpcallowip in wallet config")

        body = resp.json()
        if body.get("error"):
            err = body["error"]
            raise RPCError(err.get("code", -1), err.get("message", str(err)))

        return body.get("result")

    # ── Convenience methods ──────────────────────────────────────────────

    async def get_blockchain_info(self) -> dict:
        return await self.call("getblockchaininfo")

    async def get_network_info(self) -> dict:
        return await self.call("getnetworkinfo")

    async def get_wallet_info(self) -> dict:
        return await self.call("getwalletinfo")

    async def get_balance(self) -> float:
        return await self.call("getbalance")

    async def get_new_address(self, label: str = "") -> str:
        return await self.call("getnewaddress", [label])

    async def list_unspent(self, min_conf: int = 1, max_conf: int = 9999999) -> list:
        return await self.call("listunspent", [min_conf, max_conf])

    async def get_raw_transaction(self, txid: str, verbose: bool = True) -> Any:
        return await self.call("getrawtransaction", [txid, verbose])

    async def create_raw_transaction(self, inputs: list, outputs: list) -> str:
        return await self.call("createrawtransaction", [inputs, outputs])

    async def sign_raw_transaction(self, hex_string: str) -> dict:
        """Sign using the wallet's keys — no WIF ever leaves the daemon."""
        return await self.call("signrawtransactionwithwallet", [hex_string])

    async def send_raw_transaction(self, hex_string: str) -> str:
        return await self.call("sendrawtransaction", [hex_string])

    async def list_transactions(self, count: int = 50, skip: int = 0) -> list:
        return await self.call("listtransactions", ["*", count, skip])

    async def get_block_count(self) -> int:
        return await self.call("getblockcount")

    async def get_block_hash(self, height: int) -> str:
        return await self.call("getblockhash", [height])

    async def get_block(self, block_hash: str, verbosity: int = 1) -> dict:
        return await self.call("getblock", [block_hash, verbosity])

    async def validate_address(self, address: str) -> dict:
        return await self.call("validateaddress", [address])

    async def estimate_smart_fee(self, conf_target: int = 6) -> dict:
        return await self.call("estimatesmartfee", [conf_target])

    async def list_wallets(self) -> list:
        return await self.call("listwallets")

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None


# ── Wallet Manager: handles multiple chains ──────────────────────────────────

class WalletManager:
    """
    Manages connections to multiple Core wallet daemons.
    Desktop-only — never used by the web app.
    """

    def __init__(self):
        self._wallets: Dict[str, CoreWalletRPC] = {}
        self._status: Dict[str, dict] = {}

    def get(self, chain: str) -> Optional[CoreWalletRPC]:
        return self._wallets.get(chain.upper())

    @property
    def connected_chains(self) -> List[str]:
        return [c for c, s in self._status.items() if s.get("connected")]

    @property
    def status(self) -> Dict[str, dict]:
        return dict(self._status)

    async def probe_wallet(self, chain: str, network: str = "mainnet") -> dict:
        """Try to connect to a wallet daemon and return its status."""
        chain = chain.upper()
        config = WalletConfig(chain=chain, network=network)
        rpc = CoreWalletRPC(config)

        status = {
            "chain": chain,
            "network": network,
            "connected": False,
            "url": config.url,
            "block_height": None,
            "balance": None,
            "version": None,
            "wallet_name": None,
            "error": None,
        }

        try:
            info = await rpc.get_blockchain_info()
            status["connected"] = True
            status["block_height"] = info.get("blocks", 0)
            status["network"] = "testnet" if info.get("chain") == "test" else "mainnet"

            net_info = await rpc.get_network_info()
            status["version"] = net_info.get("subversion", "")

            try:
                wallet_info = await rpc.get_wallet_info()
                status["balance"] = wallet_info.get("balance", 0)
                status["wallet_name"] = wallet_info.get("walletname", "")
            except RPCError:
                # Wallet might not be loaded yet
                status["balance"] = None

            self._wallets[chain] = rpc
            self._status[chain] = status
            logger.info(f"[{chain}] Connected — block {status['block_height']}")

        except ConnectionError as e:
            status["error"] = str(e)
            self._status[chain] = status
            logger.info(f"[{chain}] Not running")
        except RPCError as e:
            status["error"] = e.message
            self._status[chain] = status
            logger.warning(f"[{chain}] RPC error: {e.message}")
        except Exception as e:
            status["error"] = str(e)
            self._status[chain] = status
            logger.warning(f"[{chain}] Unexpected error: {e}")

        return status

    async def scan_all(self, network: str = "mainnet") -> Dict[str, dict]:
        """Probe all supported chains concurrently and return combined status."""
        tasks = [self.probe_wallet(chain, network) for chain in DEFAULT_RPC_PORTS]
        results = await asyncio.gather(*tasks)
        return {r["chain"]: r for r in results}

    async def close_all(self):
        for rpc in self._wallets.values():
            await rpc.close()
        self._wallets.clear()
        self._status.clear()


# ── Module-level singleton ───────────────────────────────────────────────────
wallet_manager = WalletManager()
