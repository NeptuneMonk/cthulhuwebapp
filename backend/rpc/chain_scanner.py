"""
Chain Scanner — Walks blocks from Core Wallet RPC, decodes P2FK roots.

Desktop only.  Uses the Phase 1 CoreWalletRPC to:
  1. getblockcount  → current chain tip
  2. getblockhash   → hash for each height
  3. getblock(h, 2) → full block with decoded transactions
  4. For each tx: check outputs for P2FK dust → decode → store in index

Mirrors SUP's scanning approach: iterate blocks from a known epoch height
(the first block that could contain P2FK data on that chain), decode every
P2FK transaction, and build a local SQLite index.

The scanner runs as an asyncio background task per-chain and is fully
resumable — scan progress is persisted in the index DB.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from p2fk_decoder import (
    decode_root_from_outputs,
    is_dust_value,
    DUST_VALUES_SATS,
)
from rpc.wallet_rpc import CoreWalletRPC, WalletManager, RPCError, wallet_manager
from rpc.p2fk_index import (
    get_scan_progress,
    set_scan_progress,
    store_roots_batch,
    init_index_db,
)

logger = logging.getLogger(__name__)

# ── P2FK Epoch Heights ───────────────────────────────────────────────────────
# First block that could contain P2FK data on each chain.
# Scanner starts here on first run.  Configurable per-network.

EPOCH_HEIGHTS = {
    "BTC": {"mainnet": 601000, "testnet": 1500000},
    "LTC": {"mainnet": 1740000, "testnet": 1500000},
    "DOG": {"mainnet": 3400000, "testnet": 2000000},
    "MZC": {"mainnet": 1050000, "testnet": 500000},
}

# Version byte per chain+network for P2FK address encoding
VERSION_BYTES = {
    ("BTC", "mainnet"): 0,
    ("BTC", "testnet"): 111,
    ("LTC", "mainnet"): 48,
    ("LTC", "testnet"): 111,
    ("DOG", "mainnet"): 30,
    ("DOG", "testnet"): 113,
    ("MZC", "mainnet"): 50,
    ("MZC", "testnet"): 111,
}

# How many blocks to process per batch before persisting progress
BATCH_SIZE = 50

# Pause between batches (seconds) to avoid hammering the wallet daemon
BATCH_PAUSE = 0.1


def _get_epoch(chain: str, network: str) -> int:
    return EPOCH_HEIGHTS.get(chain, {}).get(network, 0)


def _get_version_byte(chain: str, network: str) -> int:
    return VERSION_BYTES.get((chain, network), 111)


# ── Single-block decoder ────────────────────────────────────────────────────

def _extract_roots_from_block(block: dict, chain: str, network: str) -> list:
    """
    Given a full block (verbosity=2), find and decode all P2FK transactions.

    A transaction is a P2FK candidate if it has at least 2 outputs with
    values matching known dust amounts.  This is a fast pre-filter before
    running the full decoder.
    """
    version_byte = _get_version_byte(chain, network)
    block_height = block.get("height", 0)
    block_time = block.get("time", 0)
    block_date = datetime.fromtimestamp(block_time, tz=timezone.utc) if block_time else None

    roots = []

    for tx in block.get("tx", []):
        txid = tx.get("txid", "")
        vout_list = tx.get("vout", [])

        # Fast pre-filter: count dust outputs
        dust_count = 0
        for v in vout_list:
            val_btc = v.get("value", 0)
            val_sats = round(val_btc * 1e8) if isinstance(val_btc, float) else val_btc
            if val_sats in DUST_VALUES_SATS:
                dust_count += 1
                if dust_count >= 2:
                    break

        if dust_count < 2:
            continue

        # Build outputs list in the format decode_root_from_outputs expects
        outputs = []
        for v in vout_list:
            spk = v.get("scriptPubKey", {})
            addr = ""
            if "address" in spk:
                addr = spk["address"]
            elif "addresses" in spk:
                addrs = spk["addresses"]
                if isinstance(addrs, list) and addrs:
                    addr = addrs[0]

            val_btc = v.get("value", 0)
            val_sats = round(val_btc * 1e8) if isinstance(val_btc, float) else val_btc

            if addr:
                outputs.append({"address": addr, "value_sats": val_sats})

        if len(outputs) < 2:
            continue

        root = decode_root_from_outputs(
            txid=txid,
            outputs=outputs,
            version_byte=version_byte,
            block_date=block_date,
            block_height=block_height,
            confirmations=0,
            total_size=tx.get("size", tx.get("vsize", 0)),
        )

        if root:
            roots.append(root.to_dict())

    return roots


# ── Scanner State ────────────────────────────────────────────────────────────

class ChainScanner:
    """
    Background scanner for a single chain.
    Walks blocks from epoch (or last checkpoint) to tip, decoding P2FK roots.
    """

    def __init__(self, chain: str, rpc: CoreWalletRPC, network: str = "mainnet"):
        self.chain = chain
        self.rpc = rpc
        self.network = network
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._roots_found = 0
        self._last_height = 0
        self._tip = 0
        self._scanning = False

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def progress(self) -> dict:
        return {
            "chain": self.chain,
            "network": self.network,
            "scanning": self._scanning,
            "last_height": self._last_height,
            "tip_height": self._tip,
            "roots_found": self._roots_found,
            "progress_pct": (
                round(100 * (self._last_height - _get_epoch(self.chain, self.network))
                      / max(1, self._tip - _get_epoch(self.chain, self.network)), 2)
                if self._tip > 0 else 0
            ),
        }

    def start(self):
        """Start the background scan task."""
        if self.is_running:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._scan_loop())
        logger.info(f"[{self.chain}] Scanner started")

    def stop(self):
        """Signal the scanner to stop after the current batch."""
        self._stop_event.set()
        logger.info(f"[{self.chain}] Scanner stop requested")

    async def _scan_loop(self):
        """Main scan loop."""
        self._scanning = True
        try:
            await init_index_db()

            # Resume from last checkpoint or epoch
            progress = await get_scan_progress(self.chain)
            epoch = _get_epoch(self.chain, self.network)
            self._last_height = max(progress["last_height"], epoch)
            self._roots_found = progress["roots_found"]

            # Get chain tip
            self._tip = await self.rpc.get_block_count()
            logger.info(
                f"[{self.chain}] Scanning from {self._last_height} to {self._tip} "
                f"(epoch={epoch}, {self._tip - self._last_height} blocks to scan)"
            )

            await set_scan_progress(
                self.chain, self._last_height, self._tip,
                self._roots_found, "scanning"
            )

            while self._last_height < self._tip:
                if self._stop_event.is_set():
                    break

                # Process a batch of blocks
                batch_end = min(self._last_height + BATCH_SIZE, self._tip)
                batch_roots = []

                for height in range(self._last_height + 1, batch_end + 1):
                    if self._stop_event.is_set():
                        break
                    try:
                        block_hash = await self.rpc.get_block_hash(height)
                        block = await self.rpc.get_block(block_hash, verbosity=2)
                        roots = _extract_roots_from_block(block, self.chain, self.network)
                        if roots:
                            batch_roots.extend(roots)
                            self._roots_found += len(roots)
                    except RPCError as e:
                        logger.warning(f"[{self.chain}] RPC error at height {height}: {e.message}")
                        await asyncio.sleep(1)
                        continue
                    except ConnectionError:
                        logger.error(f"[{self.chain}] Lost connection to wallet")
                        await set_scan_progress(
                            self.chain, self._last_height, self._tip,
                            self._roots_found, "disconnected"
                        )
                        return

                # Persist batch
                if batch_roots:
                    await store_roots_batch(self.chain, batch_roots)
                    logger.info(
                        f"[{self.chain}] Block {self._last_height+1}-{batch_end}: "
                        f"{len(batch_roots)} roots (total: {self._roots_found})"
                    )

                self._last_height = batch_end
                await set_scan_progress(
                    self.chain, self._last_height, self._tip,
                    self._roots_found, "scanning"
                )

                # Refresh tip periodically
                if self._last_height >= self._tip:
                    self._tip = await self.rpc.get_block_count()

                await asyncio.sleep(BATCH_PAUSE)

            final_status = "stopped" if self._stop_event.is_set() else "complete"
            await set_scan_progress(
                self.chain, self._last_height, self._tip,
                self._roots_found, final_status
            )
            logger.info(
                f"[{self.chain}] Scan {final_status}: "
                f"{self._roots_found} total roots indexed"
            )

        except Exception as e:
            logger.exception(f"[{self.chain}] Scanner error: {e}")
            await set_scan_progress(
                self.chain, self._last_height, self._tip,
                self._roots_found, f"error: {str(e)[:100]}"
            )
        finally:
            self._scanning = False


# ── Scanner Manager ──────────────────────────────────────────────────────────

class ScannerManager:
    """Manages per-chain scanners.  Desktop only."""

    def __init__(self):
        self._scanners: dict[str, ChainScanner] = {}

    def get(self, chain: str) -> Optional[ChainScanner]:
        return self._scanners.get(chain.upper())

    @property
    def all_progress(self) -> dict:
        return {c: s.progress for c, s in self._scanners.items()}

    async def start_chain(self, chain: str, network: str = "mainnet") -> dict:
        """Start scanning a chain.  Requires the wallet to be connected."""
        chain = chain.upper()
        rpc = wallet_manager.get(chain)
        if not rpc:
            return {"error": f"{chain} wallet not connected", "started": False}

        if chain in self._scanners and self._scanners[chain].is_running:
            return {"error": f"{chain} scanner already running", "started": False}

        scanner = ChainScanner(chain, rpc, network)
        self._scanners[chain] = scanner
        scanner.start()
        return {"chain": chain, "started": True}

    async def stop_chain(self, chain: str) -> dict:
        chain = chain.upper()
        scanner = self._scanners.get(chain)
        if not scanner or not scanner.is_running:
            return {"error": f"{chain} scanner not running", "stopped": False}
        scanner.stop()
        return {"chain": chain, "stopped": True}

    async def start_all_connected(self, network: str = "mainnet") -> dict:
        """Start scanners for all connected wallets."""
        results = {}
        for chain in wallet_manager.connected_chains:
            results[chain] = await self.start_chain(chain, network)
        return results

    async def stop_all(self):
        for scanner in self._scanners.values():
            if scanner.is_running:
                scanner.stop()


# Module-level singleton
scanner_manager = ScannerManager()
