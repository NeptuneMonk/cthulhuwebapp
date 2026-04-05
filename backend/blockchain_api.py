"""
Blockchain API — Async composite explorer for fetching raw transaction data.

Supports multiple chains with provider fallback:
  BTC mainnet:  Blockstream → mempool.space
  BTC testnet:  Blockstream → mempool.space
  DOGE:         BlockCypher
  LTC:          litecoinspace.org
  Custom Node:  Bitcoin Core RPC (optional, for "Connect Your Node")

All functions are async for non-blocking FastAPI integration.
"""

import time
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

# Shared async client (connection pooling)
_client: Optional[httpx.AsyncClient] = None

# Rate limiting: track last request per domain
_last_request: dict[str, float] = {}
_MIN_INTERVAL = 0.25  # 250ms between requests to same domain

# Optional custom node RPC config (for "Connect Your Node" feature)
_custom_node_url: Optional[str] = None  # e.g. "http://user:pass@127.0.0.1:18332"


def configure_custom_node(rpc_url: Optional[str]):
    """Set a custom Bitcoin Core RPC URL for direct node queries."""
    global _custom_node_url
    _custom_node_url = rpc_url
    if rpc_url:
        logger.info(f"Custom node configured: {rpc_url.split('@')[-1]}")


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


async def _rate_limited_get(url: str, timeout: float = 15.0) -> Optional[httpx.Response]:
    """Async GET with per-domain rate limiting."""
    from urllib.parse import urlparse
    domain = urlparse(url).netloc
    now = time.monotonic()
    last = _last_request.get(domain, 0)
    # Simple rate limit — skip if too frequent (don't block, just warn)
    if (now - last) < _MIN_INTERVAL:
        import asyncio
        await asyncio.sleep(_MIN_INTERVAL - (now - last))
    _last_request[domain] = time.monotonic()

    try:
        client = await _get_client()
        resp = await client.get(url, timeout=timeout)
        return resp
    except httpx.TimeoutException:
        logger.warning(f"Timeout: {url}")
    except Exception as e:
        logger.warning(f"Request failed: {url} — {e}")
    return None


async def _get_json(url: str, timeout: float = 15.0) -> Optional[dict]:
    """GET returning parsed JSON or None."""
    resp = await _rate_limited_get(url, timeout)
    if resp and resp.status_code == 200:
        try:
            return resp.json()
        except Exception:
            pass
    elif resp:
        logger.debug(f"HTTP {resp.status_code} from {url}")
    return None


async def _get_text(url: str, timeout: float = 15.0) -> Optional[str]:
    """GET returning raw text or None."""
    resp = await _rate_limited_get(url, timeout)
    if resp and resp.status_code == 200:
        return resp.text
    return None


# ─── Network Configuration ───────────────────────────────────────────────────

NETWORKS = {
    'btc-mainnet': {
        'version_byte': 0,
        'explorers': [
            {'name': 'mempool', 'base': 'https://mempool.space/api'},
            {'name': 'blockstream', 'base': 'https://blockstream.info/api'},
        ],
    },
    'btc-testnet': {
        'version_byte': 111,
        'explorers': [
            {'name': 'mempool', 'base': 'https://mempool.space/testnet/api'},
            {'name': 'blockstream', 'base': 'https://blockstream.info/testnet/api'},
        ],
    },
    'doge-mainnet': {
        'version_byte': 30,
        'explorers': [
            {'name': 'blockcypher', 'base': 'https://api.blockcypher.com/v1/doge/main'},
        ],
    },
    'ltc-mainnet': {
        'version_byte': 48,
        'explorers': [
            {'name': 'litecoinspace', 'base': 'https://litecoinspace.org/api'},
        ],
    },
}


def get_version_byte(network: str) -> int:
    return NETWORKS.get(network, {}).get('version_byte', 111)


# ─── Custom Node RPC ─────────────────────────────────────────────────────────

async def _rpc_call(method: str, params: list) -> Optional[dict]:
    """Call Bitcoin Core JSON-RPC (for custom node support).
    Returns result dict on success, None on failure. Raises descriptive errors."""
    if not _custom_node_url:
        return None
    try:
        client = await _get_client()
        resp = await client.post(
            _custom_node_url,
            json={"jsonrpc": "1.0", "id": "cthulhu", "method": method, "params": params},
            timeout=10.0,
        )
        if resp.status_code == 401 or resp.status_code == 403:
            raise ConnectionError(f"Authentication failed (HTTP {resp.status_code}). Check rpcuser/rpcpassword in bitcoin.conf")
        if resp.status_code == 200:
            data = resp.json()
            if data.get("error") is not None:
                rpc_err = data["error"]
                raise ConnectionError(f"RPC error: {rpc_err.get('message', rpc_err)}")
            return data.get("result")
        raise ConnectionError(f"Unexpected HTTP {resp.status_code}")
    except ConnectionError:
        raise
    except Exception as e:
        err_str = str(e)
        if "ConnectError" in err_str or "Connection refused" in err_str.lower() or "connect" in type(e).__name__.lower():
            raise ConnectionError(
                "Connection refused. The server cannot reach this host. "
                "If your node is on your local machine, you need the Cthulhu desktop app — "
                "the cloud-hosted version cannot reach 127.0.0.1 on your computer."
            )
        if "timeout" in err_str.lower() or "Timeout" in type(e).__name__:
            raise ConnectionError(f"Connection timed out. Host may be unreachable from this server.")
        logger.debug(f"RPC {method} failed: {e}")
        raise ConnectionError(f"Connection failed: {err_str}")


async def _fetch_tx_from_node(txid: str) -> Optional[dict]:
    """Fetch decoded transaction from a custom Bitcoin Core node."""
    result = await _rpc_call("getrawtransaction", [txid, True])
    if not result:
        return None
    # Normalize to mempool.space format
    vout = []
    for v in result.get('vout', []):
        spk = v.get('scriptPubKey', {})
        addr = ''
        if 'address' in spk:
            addr = spk['address']
        elif 'addresses' in spk and spk['addresses']:
            addr = spk['addresses'][0]
        vout.append({
            'scriptpubkey_address': addr,
            'value': round(v.get('value', 0) * 1e8),  # BTC → sats
        })
    return {
        'txid': result.get('txid', txid),
        'vout': vout,
        'size': result.get('size', 0),
        'status': {
            'confirmed': result.get('confirmations', 0) > 0,
            'block_time': result.get('blocktime', 0),
            'block_height': result.get('blockheight', 0),
        },
    }


# ─── Transaction Fetching ────────────────────────────────────────────────────

def _normalize_blockcypher_tx(data: dict) -> dict:
    """Convert BlockCypher format to mempool.space-like format."""
    vout = []
    for out in data.get('outputs', []):
        addrs = out.get('addresses', [])
        addr = addrs[0] if addrs else ''
        vout.append({
            'scriptpubkey_address': addr,
            'value': out.get('value', 0),
        })

    confirmed = data.get('confirmations', 0) > 0
    block_time = 0
    if data.get('confirmed'):
        try:
            from datetime import datetime as dt
            block_time = int(dt.fromisoformat(data['confirmed'].replace('Z', '+00:00')).timestamp())
        except Exception:
            pass

    return {
        'txid': data.get('hash', ''),
        'vout': vout,
        'size': data.get('size', 0),
        'status': {
            'confirmed': confirmed,
            'block_time': block_time,
            'block_height': data.get('block_height', 0),
        },
    }


async def fetch_transaction(txid: str, network: str = 'btc-testnet') -> Optional[dict]:
    """Fetch a transaction by ID. Tries custom node first, then public explorers."""
    # Try custom node first (if configured)
    if _custom_node_url and network in ('btc-mainnet', 'btc-testnet'):
        node_tx = await _fetch_tx_from_node(txid)
        if node_tx:
            return node_tx

    config = NETWORKS.get(network, NETWORKS['btc-testnet'])

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/tx/{txid}"
            data = await _get_json(url)
            if data:
                data['txid'] = data.get('txid', txid)
                return data

        elif name == 'blockcypher':
            url = f"{base}/txs/{txid}?includeHex=false"
            data = await _get_json(url)
            if data:
                return _normalize_blockcypher_tx(data)

    return None


async def fetch_raw_tx_hex(txid: str, network: str = 'btc-testnet') -> Optional[str]:
    """Fetch raw transaction hex (needed for PSBT construction)."""
    if _custom_node_url and network in ('btc-mainnet', 'btc-testnet'):
        result = await _rpc_call("getrawtransaction", [txid, False])
        if result:
            return result

    config = NETWORKS.get(network, NETWORKS['btc-testnet'])
    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']
        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/tx/{txid}/hex"
            hex_str = await _get_text(url)
            if hex_str and len(hex_str) > 10:
                return hex_str.strip()
    return None


async def fetch_address_transactions(
    address: str,
    network: str = 'btc-testnet',
    after_txid: str = None,
    max_pages: int = 4,
) -> list:
    """Fetch transactions for an address with pagination (max_pages limits depth)."""
    # Custom node
    if _custom_node_url and network in ('btc-mainnet', 'btc-testnet'):
        # Bitcoin Core doesn't have address-based tx listing by default
        # (requires address index). Fall through to public explorers.
        pass

    config = NETWORKS.get(network, NETWORKS['btc-testnet'])
    all_txs = []

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            chain_after = after_txid
            pages = 0
            while pages < max_pages:
                url = f"{base}/address/{address}/txs"
                if chain_after:
                    url += f"/chain/{chain_after}"
                data = await _get_json(url)
                if not data or not isinstance(data, list):
                    break
                for tx in data:
                    tx['txid'] = tx.get('txid', '')
                    all_txs.append(tx)
                pages += 1
                if len(data) < 25:
                    break
                chain_after = data[-1].get('txid', '')
            if all_txs:
                return all_txs

        elif name == 'blockcypher':
            url = f"{base}/addrs/{address}/full?limit=50"
            data = await _get_json(url)
            if data and 'txs' in data:
                for tx in data['txs']:
                    all_txs.append(_normalize_blockcypher_tx(tx))
                return all_txs

    return all_txs


async def fetch_utxos(address: str, network: str = 'btc-testnet') -> list:
    """Fetch unspent transaction outputs for an address."""
    config = NETWORKS.get(network, NETWORKS['btc-testnet'])

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/address/{address}/utxo"
            data = await _get_json(url)
            if data and isinstance(data, list):
                return data

        elif name == 'blockcypher':
            url = f"{base}/addrs/{address}?unspentOnly=true"
            data = await _get_json(url)
            if data and 'txrefs' in data:
                return [
                    {
                        'txid': ref['tx_hash'],
                        'vout': ref['tx_output_n'],
                        'value': ref['value'],
                        'status': {'confirmed': ref.get('confirmations', 0) > 0},
                    }
                    for ref in data['txrefs']
                ]

    return []


async def broadcast_transaction(tx_hex: str, network: str = 'btc-testnet') -> Optional[str]:
    """Broadcast a signed transaction hex, returns txid on success."""
    # Try custom node first
    if _custom_node_url and network in ('btc-mainnet', 'btc-testnet'):
        result = await _rpc_call("sendrawtransaction", [tx_hex])
        if result:
            return result

    config = NETWORKS.get(network, NETWORKS['btc-testnet'])
    client = await _get_client()

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/tx"
            try:
                resp = await client.post(url, content=tx_hex, timeout=15.0)
                if resp.status_code == 200:
                    return resp.text.strip()
            except Exception as e:
                logger.warning(f"Broadcast failed via {name}: {e}")

        elif name == 'blockcypher':
            url = f"{base}/txs/push"
            try:
                resp = await client.post(url, json={"tx": tx_hex}, timeout=15.0)
                if resp.status_code in (200, 201):
                    result = resp.json()
                    return result.get('tx', {}).get('hash', '')
            except Exception as e:
                logger.warning(f"Broadcast failed via {name}: {e}")

    return None


async def test_custom_node() -> dict:
    """Test connectivity to a custom Bitcoin Core node. Returns status info."""
    if not _custom_node_url:
        return {"connected": False, "error": "No custom node configured"}
    try:
        info = await _rpc_call("getblockchaininfo", [])
        if info:
            return {
                "connected": True,
                "chain": info.get("chain", "unknown"),
                "blocks": info.get("blocks", 0),
                "verification_progress": info.get("verificationprogress", 0),
                "pruned": info.get("pruned", False),
            }
        return {"connected": False, "error": "RPC call returned no data — node may not be reachable from this server"}
    except ConnectionError as e:
        return {"connected": False, "error": str(e)}
    except Exception as e:
        return {"connected": False, "error": str(e)}
