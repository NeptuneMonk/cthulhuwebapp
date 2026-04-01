"""
Blockchain API — Composite explorer for fetching raw transaction data.

Supports multiple chains and falls back between providers:
  BTC mainnet:  mempool.space → Blockstream.info
  BTC testnet:  mempool.space/testnet → Blockstream.info/testnet
  DOGE:         chain.so → BlockCypher
  LTC:          litecoinspace.org → BlockCypher
  MZC:          (via p2fk.io fallback only)
"""

import time
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

# Rate limiting: track last request per domain
_last_request = {}
_MIN_INTERVAL = 0.3  # 300ms between requests to same domain


def _rate_limit(domain: str):
    now = time.time()
    last = _last_request.get(domain, 0)
    wait = _MIN_INTERVAL - (now - last)
    if wait > 0:
        time.sleep(wait)
    _last_request[domain] = time.time()


def _get(url: str, timeout: float = 15.0) -> Optional[dict]:
    """HTTP GET with rate limiting and error handling."""
    from urllib.parse import urlparse
    domain = urlparse(url).netloc
    _rate_limit(domain)
    try:
        resp = httpx.get(url, timeout=timeout, follow_redirects=True)
        if resp.status_code == 200:
            return resp.json()
        logger.warning(f"HTTP {resp.status_code} from {url}")
    except Exception as e:
        logger.warning(f"Request failed: {url} — {e}")
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


# ─── Transaction Fetching ────────────────────────────────────────────────────

def _normalize_mempool_tx(data: dict) -> dict:
    """mempool.space/Blockstream format is already normalized."""
    return data


def _normalize_blockcypher_tx(data: dict) -> dict:
    """Convert BlockCypher format to mempool.space-like format."""
    vout = []
    for out in data.get('outputs', []):
        addrs = out.get('addresses', [])
        addr = addrs[0] if addrs else ''
        vout.append({
            'scriptpubkey_address': addr,
            'value': out.get('value', 0),  # Already in satoshis
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


def fetch_transaction(txid: str, network: str = 'btc-testnet') -> Optional[dict]:
    """Fetch a raw transaction by ID, trying multiple explorers."""
    config = NETWORKS.get(network, NETWORKS['btc-testnet'])

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/tx/{txid}"
            data = _get(url)
            if data:
                data['txid'] = data.get('txid', txid)
                return _normalize_mempool_tx(data)

        elif name == 'blockcypher':
            url = f"{base}/txs/{txid}?includeHex=false"
            data = _get(url)
            if data:
                return _normalize_blockcypher_tx(data)

    return None


def fetch_address_transactions(
    address: str,
    network: str = 'btc-testnet',
    after_txid: str = None,
) -> list:
    """
    Fetch all transactions for an address.
    Returns list of normalized transaction dicts.
    Handles pagination via after_txid (mempool.space chain pagination).
    """
    config = NETWORKS.get(network, NETWORKS['btc-testnet'])
    all_txs = []

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            # These APIs paginate by last_seen_txid
            chain_after = after_txid
            while True:
                url = f"{base}/address/{address}/txs"
                if chain_after:
                    url += f"/chain/{chain_after}"
                data = _get(url)
                if not data or not isinstance(data, list):
                    break
                for tx in data:
                    tx['txid'] = tx.get('txid', '')
                    all_txs.append(tx)
                if len(data) < 25:  # mempool.space returns max 25 per page
                    break
                chain_after = data[-1].get('txid', '')
            if all_txs:
                return all_txs

        elif name == 'blockcypher':
            url = f"{base}/addrs/{address}/full?limit=50"
            data = _get(url)
            if data and 'txs' in data:
                for tx in data['txs']:
                    all_txs.append(_normalize_blockcypher_tx(tx))
                return all_txs

    return all_txs


def fetch_utxos(address: str, network: str = 'btc-testnet') -> list:
    """Fetch unspent transaction outputs for an address."""
    config = NETWORKS.get(network, NETWORKS['btc-testnet'])

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/address/{address}/utxo"
            data = _get(url)
            if data and isinstance(data, list):
                return data

        elif name == 'blockcypher':
            url = f"{base}/addrs/{address}?unspentOnly=true"
            data = _get(url)
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


def broadcast_transaction(tx_hex: str, network: str = 'btc-testnet') -> Optional[str]:
    """Broadcast a signed transaction hex, returns txid on success."""
    config = NETWORKS.get(network, NETWORKS['btc-testnet'])

    for explorer in config['explorers']:
        name = explorer['name']
        base = explorer['base']

        if name in ('mempool', 'blockstream', 'litecoinspace'):
            url = f"{base}/tx"
            try:
                resp = httpx.post(url, content=tx_hex, timeout=15.0)
                if resp.status_code == 200:
                    return resp.text.strip()
            except Exception as e:
                logger.warning(f"Broadcast failed via {name}: {e}")

        elif name == 'blockcypher':
            url = f"{base}/txs/push"
            try:
                resp = httpx.post(url, json={"tx": tx_hex}, timeout=15.0)
                if resp.status_code in (200, 201):
                    result = resp.json()
                    return result.get('tx', {}).get('hash', '')
            except Exception as e:
                logger.warning(f"Broadcast failed via {name}: {e}")

    return None
