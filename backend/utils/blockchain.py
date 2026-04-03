"""Blockchain API interaction utilities."""
import logging
import asyncio
import time
from bit.network.meta import Unspent

from config import (
    MEMPOOL_TESTNET_API, MEMPOOL_MAINNET_API,
    CHAIN_TX_APIS, P2FK_DUST_VALUES_SAT,
)
from utils.stats_tracker import track_api_call
from utils.http_pool import get_client

logger = logging.getLogger(__name__)

# In-memory LRU cache for transaction outputs (avoids repeated API calls for child TXs)
_tx_output_cache = {}
_TX_CACHE_MAX = 5000


def _cache_tx_outputs(cache_key: str, outputs: list):
    """Store outputs in memory cache with LRU eviction."""
    global _tx_output_cache
    _tx_output_cache[cache_key] = outputs
    if len(_tx_output_cache) > _TX_CACHE_MAX:
        # Evict oldest 20% of entries
        evict_count = _TX_CACHE_MAX // 5
        keys = list(_tx_output_cache.keys())[:evict_count]
        for k in keys:
            _tx_output_cache.pop(k, None)


async def fetch_utxos_mempool(address: str, is_mainnet: bool = False):
    base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API
    t0 = time.time()
    client = get_client()
    resp = await client.get(f"{base}/address/{address}/utxo", timeout=15.0)
    track_api_call("mempool.space", "utxos", (time.time() - t0) * 1000)
    if resp.status_code != 200:
        return []
    utxos = resp.json()
    unspents = []
    for u in utxos:
        unspents.append(Unspent(
            amount=u["value"],
            confirmations=1 if u.get("status", {}).get("confirmed", False) else 0,
            script="",
            txid=u["txid"],
            txindex=u["vout"],
        ))
    return unspents


async def broadcast_raw_tx(raw_tx_hex: str, is_mainnet: bool = False) -> dict:
    base = MEMPOOL_MAINNET_API if is_mainnet else MEMPOOL_TESTNET_API
    t0 = time.time()
    client = get_client()
    resp = await client.post(f"{base}/tx", content=raw_tx_hex, headers={"Content-Type": "text/plain"}, timeout=30.0)
    track_api_call("mempool.space", "broadcast", (time.time() - t0) * 1000)
    if resp.status_code == 200:
        return {"txid": resp.text.strip(), "success": True}
    else:
        return {"success": False, "error": resp.text, "status": resp.status_code}


async def fetch_tx_outputs(txid: str, chain: str = 'BTC', mainnet: bool = True) -> list:
    """Fetch P2FK-encoded outputs from a transaction. Uses in-memory cache."""
    cache_key = f"{chain}:{txid}:{'m' if mainnet else 't'}"

    # Check memory cache first
    cached = _tx_output_cache.get(cache_key)
    if cached:
        return cached

    chain_upper = chain.upper()
    api_configs = CHAIN_TX_APIS.get(chain_upper, {})
    if not api_configs:
        raise ValueError(f"Unsupported chain: {chain}")
    net_key = 'mainnet' if mainnet else 'testnet'
    configs = api_configs.get(net_key)
    if not configs:
        raise ValueError(f"No API for {chain} {net_key}")
    if isinstance(configs, dict):
        configs = [configs]

    last_error = None
    for config in configs:
        url = config['url'].format(txid=txid)
        parser = config['parser']
        for attempt in range(2):
            try:
                t0 = time.time()
                client = get_client()
                resp = await client.get(url, timeout=30.0)
                domain = url.split('/')[2] if '/' in url else parser
                track_api_call(domain, f"tx_outputs/{parser}", (time.time() - t0) * 1000)
                if resp.status_code == 429:
                    wait = 1.5 * (attempt + 1)
                    logger.warning(f"Rate limited by {domain}, waiting {wait}s (attempt {attempt+1})")
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code} from {url}"
                    break
                data = resp.json()

                outputs = []
                if parser == 'mempool':
                    for vout in data.get('vout', []):
                        addr = vout.get('scriptpubkey_address', '')
                        val = vout.get('value', 0)
                        if addr and val in P2FK_DUST_VALUES_SAT:
                            outputs.append(addr)
                elif parser == 'blockcypher':
                    for out in data.get('outputs', []):
                        addrs = out.get('addresses', [])
                        val = out.get('value', 0)
                        if addrs and val in P2FK_DUST_VALUES_SAT:
                            outputs.append(addrs[0])
                elif parser == 'blockchair':
                    tx_data = data.get('data', {}).get(txid, {})
                    decoded = tx_data.get('decoded_raw_transaction', {})
                    for vout in decoded.get('vout', []):
                        val = vout.get('value', 0)
                        addrs = vout.get('scriptPubKey', {}).get('addresses', [])
                        if addrs and val in P2FK_DUST_VALUES_SAT:
                            outputs.append(addrs[0])
                elif parser == 'mazachain':
                    for vout in data.get('vout', []):
                        val_coins = vout.get('value', 0)
                        val_sats = round(val_coins * 1e8)
                        addrs = vout.get('scriptPubKey', {}).get('addresses', [])
                        if addrs and val_sats in P2FK_DUST_VALUES_SAT:
                            outputs.append(addrs[0])

                if outputs:
                    _cache_tx_outputs(cache_key, outputs)
                    return outputs
                last_error = f"No P2FK outputs found via {url}"
                break
            except Exception as e:
                last_error = str(e)
                break

    raise ValueError(f"TX fetch failed for {txid} on {chain}: {last_error}")
