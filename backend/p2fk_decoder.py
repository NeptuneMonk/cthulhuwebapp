"""
P2FK Root Decoder — Python port of SUP P2FK/contracts/Root.cs

Decodes P2FK (Peer-to-Folder-Key) protocol transactions from raw Bitcoin
transaction outputs into Root objects containing messages, files, keywords,
and signature data.

Algorithm:
1. Extract 20-byte payloads from each dust-value output address (Base58Check decode)
2. Concatenate all payloads into a single byte stream
3. Parse packets: <filename><delimiter><length><delimiter2><content>
   - SIG → signature
   - Empty name → message (post content)
   - Non-empty name → file (INQ, OBJ, IMG, etc.)
4. Remaining bytes become keyword addresses (20-byte chunks → Base58Check)
5. Last dust output = SignedBy address
"""

import hashlib
import re
import struct
from datetime import datetime, timezone
from typing import Optional

# P2FK delimiter characters (same as C#: \\ / : * ? " < > |)
DELIMITERS = b'\\/:*?"<>|'
DELIMITER_SET = set(DELIMITERS)

# Known P2FK dust values (in satoshis)
DUST_VALUES_SATS = {1, 546, 548, 5480, 550, 5500, 1000, 1000000, 2000000, 100000000}

# Regex: delimiter followed by digits
RE_DELIMITER_NUM = re.compile(rb'([\\/:\*\?"<>\|])(\d+)')

# Regex: 64-char hex (transaction ID)
RE_TXID = re.compile(rb'[0-9a-f]{64}')


# ─── Base58 ──────────────────────────────────────────────────────────────────

B58_ALPHABET = b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
B58_MAP = {c: i for i, c in enumerate(B58_ALPHABET)}


def b58decode(s: str) -> bytes:
    """Decode a Base58-encoded string to bytes."""
    n = 0
    for c in s.encode('ascii'):
        n = n * 58 + B58_MAP[c]
    result = n.to_bytes((n.bit_length() + 7) // 8, 'big') if n else b''
    # Preserve leading zeros
    pad = len(s) - len(s.lstrip('1'))
    return b'\x00' * pad + result


def b58encode(data: bytes) -> str:
    """Encode bytes to a Base58 string."""
    n = int.from_bytes(data, 'big')
    result = []
    while n > 0:
        n, r = divmod(n, 58)
        result.append(B58_ALPHABET[r:r+1])
    # Preserve leading zeros
    for byte in data:
        if byte == 0:
            result.append(b'1')
        else:
            break
    return b''.join(reversed(result)).decode('ascii')


def b58check_decode(address: str) -> bytes:
    """Base58Check decode: returns raw bytes (version + payload)."""
    raw = b58decode(address)
    payload, checksum = raw[:-4], raw[-4:]
    check = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if check != checksum:
        raise ValueError(f"Bad checksum for address {address}")
    return payload  # [version_byte, ...20 payload bytes]


def b58check_encode(data: bytes) -> str:
    """Base58Check encode: data should include version byte."""
    checksum = hashlib.sha256(hashlib.sha256(data).digest()).digest()[:4]
    return b58encode(data + checksum)


def address_to_payload(address: str) -> bytes:
    """Extract the 20-byte payload from a Bitcoin address (skip version byte)."""
    raw = b58check_decode(address)
    return raw[1:]  # Skip version byte, return 20 bytes


def keyword_to_address(keyword: str, version_byte: int = 111) -> str:
    """Convert a keyword string to its P2FK address (matches C# GetPublicAddressByKeyword)."""
    key_bytes = keyword.encode('utf-8')
    if len(key_bytes) < 20:
        key_bytes += b'#' * (20 - len(key_bytes))
    elif len(key_bytes) > 20:
        key_bytes = key_bytes[:20]
    return b58check_encode(bytes([version_byte]) + key_bytes)


def address_to_keyword(address: str, encoding: str = 'utf-8') -> str:
    """Decode a keyword address back to its keyword string."""
    payload = address_to_payload(address)
    return payload.decode(encoding, errors='replace').rstrip('#')


# ─── Root Object ─────────────────────────────────────────────────────────────

class P2FKRoot:
    """Decoded P2FK Root transaction."""

    def __init__(self):
        self.id = -1
        self.messages = []           # List[str] — post text content
        self.files = {}              # Dict[str, int] — filename → byte size
        self.keywords = {}           # Dict[str, str] — address → decoded keyword
        self.outputs = {}            # Dict[str, str] — address → value
        self.hash = ''
        self.signed_by = ''
        self.signature = ''
        self.signed = False
        self.transaction_id = ''
        self.block_date = None
        self.block_height = 0
        self.total_byte_size = 0
        self.confirmations = -1
        self.build_date = datetime.now(timezone.utc)
        self.cached = False

    def to_dict(self):
        return {
            'Id': self.id,
            'Message': self.messages,
            'File': self.files,
            'Keyword': self.keywords,
            'Output': self.outputs,
            'Hash': self.hash,
            'SignedBy': self.signed_by,
            'Signature': self.signature,
            'Signed': self.signed,
            'TransactionId': self.transaction_id,
            'BlockDate': self.block_date.isoformat() if self.block_date else None,
            'BlockHeight': self.block_height,
            'TotalByteSize': self.total_byte_size,
            'Confirmations': self.confirmations,
            'BuildDate': self.build_date.isoformat() if self.build_date else None,
        }


# ─── Core Decoder ────────────────────────────────────────────────────────────

def is_dust_value(value_sats: int) -> bool:
    """Check if a transaction output value is a known P2FK dust amount."""
    return value_sats in DUST_VALUES_SATS


def decode_root_from_outputs(
    txid: str,
    outputs: list,
    version_byte: int = 111,
    block_date: Optional[datetime] = None,
    block_height: int = 0,
    confirmations: int = -1,
    total_size: int = 0,
) -> Optional[P2FKRoot]:
    """
    Decode a P2FK Root from transaction outputs.

    Args:
        txid: Transaction ID (hex string)
        outputs: List of dicts with 'address' and 'value_sats' keys.
                 Outputs must be in vout order.
        version_byte: Network version byte (111=testnet, 0=mainnet)
        block_date: Block timestamp
        block_height: Block height
        confirmations: Number of confirmations
        total_size: Transaction size in bytes

    Returns:
        P2FKRoot object or None if not a valid P2FK transaction
    """
    root = P2FKRoot()
    root.transaction_id = txid
    root.block_date = block_date or datetime.now(timezone.utc)
    root.block_height = block_height
    root.confirmations = confirmations
    root.total_byte_size = total_size

    # Step 1: Extract payload bytes from dust outputs
    tx_bytes = bytearray()
    signature_address = None

    for out in outputs:
        addr = out.get('address', '')
        val = out.get('value_sats', 0)
        if addr:
            root.outputs[addr] = str(val)

        if is_dust_value(val) and addr:
            try:
                payload = address_to_payload(addr)
                tx_bytes.extend(payload)
                signature_address = addr  # Last dust output = SignedBy
            except (ValueError, Exception):
                continue

    if not tx_bytes or not signature_address:
        return None

    root.signed_by = signature_address
    tx_bytes_immutable = bytes(tx_bytes)
    tx_ascii = tx_bytes_immutable.decode('ascii', errors='replace')

    # Step 2: Parse packets using delimiter+number pattern
    messages = []
    files = {}
    signature = ''
    sig_start_byte = 0
    sig_end_byte = 0
    pos = 0

    while pos < len(tx_ascii):
        # Find next delimiter+number pattern
        match = RE_DELIMITER_NUM.search(tx_ascii[pos:].encode('ascii', errors='replace'))
        if not match:
            break

        match_start = pos + match.start()
        delimiter_char = chr(match.group(1)[0])
        packet_size_str = match.group(2).decode('ascii')

        # The delimiter must be the first special char encountered
        first_delim_pos = -1
        for i, c in enumerate(tx_ascii[pos:match_start + 1]):
            if ord(c) in DELIMITER_SET or c.encode('ascii', errors='replace') in DELIMITERS:
                first_delim_pos = pos + i
                break

        if first_delim_pos != match_start:
            break

        try:
            packet_size = int(packet_size_str)
        except ValueError:
            break

        # fileName = text before the delimiter
        file_name = tx_ascii[pos:match_start]

        # Header size = everything up to and including the second delimiter
        header_end = match_start + len(match.group(0))
        # Need to find the second delimiter
        if header_end < len(tx_ascii) and tx_ascii[header_end:header_end+1] in '\\//:*?"<>|':
            header_end += 1
        else:
            header_end = match_start + 1 + len(packet_size_str) + 1

        # Extract file bytes
        content_start = header_end
        content_end = content_start + packet_size

        if content_end > len(tx_ascii):
            break

        file_bytes = tx_bytes_immutable[
            content_start + (len(tx_bytes_immutable) - len(tx_ascii)):
            content_end + (len(tx_bytes_immutable) - len(tx_ascii))
        ] if len(tx_bytes_immutable) != len(tx_ascii) else tx_bytes_immutable[content_start:content_end]

        # Actually, since we're using ASCII representation, let's recalculate
        # The byte offset should be the same as the ASCII offset since we're
        # working with the decoded payload bytes
        file_bytes = tx_bytes_immutable[content_start:content_end]

        # Determine if this is a valid file entry
        is_valid_file = False
        if (len(file_name) > 2 and '.' in file_name) or \
           (len(file_name) == 3 and file_name not in ('BTC', 'LTC', 'DOG', 'MZC', 'IPFS')) or \
           (not '.' in file_name and len(file_name) == 64):
            is_valid_file = True

        if is_valid_file:
            sig_end_byte += packet_size + (content_start - pos)

            if file_name == 'SIG':
                sig_start_byte = sig_end_byte
                signature = tx_ascii[content_start:content_end]
            else:
                files[file_name] = len(file_bytes)

        elif file_name == '' and len(file_bytes) > 1:
            # Empty name = Message content
            sig_end_byte += packet_size + (content_start - pos)
            try:
                msg_text = file_bytes.decode('utf-8', errors='replace')
                messages.append(msg_text)
            except Exception:
                messages.append(file_bytes.decode('ascii', errors='replace'))
        else:
            break

        # Advance position past the processed packet
        pos = content_end

    # If no files or messages found, this isn't a valid P2FK transaction
    if not files and not messages:
        return None

    # Step 3: Extract keywords from remaining bytes
    remaining = tx_ascii[pos:]
    keywords = {}

    if len(remaining) > 20:
        # Align to 20-byte boundary
        remainder = len(remaining) % 20
        remaining = remaining[remainder:]

    for i in range(0, len(remaining), 20):
        chunk = remaining[i:i+20]
        if len(chunk) == 20:
            try:
                chunk_bytes = tx_bytes_immutable[pos + i + (len(tx_bytes_immutable) - len(tx_ascii)):
                                                  pos + i + 20 + (len(tx_bytes_immutable) - len(tx_ascii))]
                if len(chunk_bytes) < 20:
                    chunk_bytes = remaining[i:i+20].encode('ascii', errors='replace')[:20]
                keyword_addr = b58check_encode(bytes([version_byte]) + chunk_bytes[:20])
                keyword_text = chunk_bytes.decode('utf-8', errors='replace').rstrip('#')
                keywords[keyword_addr] = keyword_text
            except Exception:
                pass

    # Step 4: Signature verification
    if sig_start_byte > 0 and signature:
        try:
            sig_bytes = tx_bytes_immutable[sig_start_byte:sig_end_byte]
            hash_hex = hashlib.sha256(sig_bytes).hexdigest().upper()
            root.hash = hash_hex
            root.signature = signature
            # Note: Full signature verification requires bitcoinlib or similar.
            # For now, we mark as signed if SIG packet was present.
            root.signed = True
        except Exception:
            pass

    # Populate Root
    root.messages = messages
    root.files = files
    root.keywords = keywords
    root.build_date = datetime.now(timezone.utc)

    return root


def decode_root_from_raw_tx(
    txid: str,
    raw_tx: dict,
    version_byte: int = 111,
) -> Optional[P2FKRoot]:
    """
    Decode a P2FK Root from a raw transaction dict (as returned by blockchain APIs).

    Supports multiple API formats:
    - mempool.space/Blockstream: vout[].scriptpubkey_address, vout[].value (sats)
    - Bitcoin Core RPC: vout[].scriptPubKey.addresses[0], vout[].value (BTC float)
    """
    outputs = []

    # Parse block metadata
    block_date = None
    block_height = raw_tx.get('block_height', raw_tx.get('blockheight', 0))
    confirmations = raw_tx.get('confirmations', -1)
    total_size = raw_tx.get('size', raw_tx.get('weight', 0))

    if 'status' in raw_tx and isinstance(raw_tx['status'], dict):
        # mempool.space format
        ts = raw_tx['status'].get('block_time', 0)
        if ts:
            block_date = datetime.fromtimestamp(ts, tz=timezone.utc)
        block_height = raw_tx['status'].get('block_height', block_height)
        confirmations = 1 if raw_tx['status'].get('confirmed', False) else 0
    elif 'blocktime' in raw_tx:
        block_date = datetime.fromtimestamp(raw_tx['blocktime'], tz=timezone.utc)

    # Parse outputs
    vout = raw_tx.get('vout', [])
    for v in vout:
        addr = ''
        value_sats = 0

        if 'scriptpubkey_address' in v:
            # mempool.space / Blockstream format
            addr = v['scriptpubkey_address']
            value_sats = v.get('value', 0)  # Already in satoshis
        elif 'scriptPubKey' in v:
            # Bitcoin Core RPC format
            spk = v['scriptPubKey']
            addrs = spk.get('addresses', spk.get('address', []))
            if isinstance(addrs, list) and addrs:
                addr = addrs[0]
            elif isinstance(addrs, str):
                addr = addrs
            # Value is in BTC, convert to sats
            val = v.get('value', 0)
            if isinstance(val, (int, float)):
                value_sats = round(val * 1e8)

        if addr:
            outputs.append({'address': addr, 'value_sats': value_sats})

    if not outputs:
        return None

    return decode_root_from_outputs(
        txid=txid or raw_tx.get('txid', ''),
        outputs=outputs,
        version_byte=version_byte,
        block_date=block_date,
        block_height=block_height,
        confirmations=confirmations,
        total_size=total_size,
    )
