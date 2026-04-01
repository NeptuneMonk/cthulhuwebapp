"""P2FK protocol encoding utilities."""
import hashlib
import struct
import random
import base64
from bit import PrivateKeyTestnet, PrivateKey
import coincurve

from config import P2FK_DELIMITERS, BASE58_DIGITS


def base58_encode(data: bytes) -> str:
    int_data = int.from_bytes(data, 'big')
    result = ''
    while int_data > 0:
        int_data, remainder = divmod(int_data, 58)
        result = BASE58_DIGITS[remainder] + result
    for byte in data:
        if byte == 0:
            result = '1' + result
        else:
            break
    return result


def base58_decode(s: str) -> bytes:
    int_data = 0
    for ch in s:
        idx = BASE58_DIGITS.index(ch)
        int_data = int_data * 58 + idx
    leading_ones = len(s) - len(s.lstrip('1'))
    result = int_data.to_bytes((int_data.bit_length() + 7) // 8, 'big') if int_data else b''
    return b'\x00' * leading_ones + result


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256d(data: bytes) -> bytes:
    return sha256(sha256(data))


def base58check_encode(payload: bytes) -> str:
    checksum = sha256d(payload)[:4]
    return base58_encode(payload + checksum)


def base58_decode_check(address: str) -> bytes:
    raw = base58_decode(address)
    without_checksum = raw[:-4]
    return without_checksum[1:]


def compact_size(n: int) -> bytes:
    if n < 253:
        return struct.pack('<B', n)
    elif n < 0x10000:
        return struct.pack('<BH', 253, n)
    elif n < 0x100000000:
        return struct.pack('<BI', 254, n)
    else:
        return struct.pack('<BQ', 255, n)


def get_random_delimiter() -> str:
    return random.choice(P2FK_DELIMITERS)


def bitcoin_message_sign(wif: str, message: str, is_mainnet: bool = False) -> str:
    if is_mainnet:
        key = PrivateKey(wif)
    else:
        key = PrivateKeyTestnet(wif)

    privkey_bytes = key.to_bytes()

    prefix = b"\x18Bitcoin Signed Message:\n"
    msg_bytes = message.encode('utf-8')
    to_hash = prefix + compact_size(len(msg_bytes)) + msg_bytes
    msg_hash = sha256d(to_hash)

    pk = coincurve.PrivateKey(privkey_bytes)
    sig_recoverable = pk.sign_recoverable(msg_hash, hasher=None)

    sig_bytes = sig_recoverable[:64]
    recovery_id = sig_recoverable[64]

    compressed = len(key.public_key) == 33
    flag = (31 if compressed else 27) + recovery_id
    bitcoin_sig = bytes([flag]) + sig_bytes

    return base64.b64encode(bitcoin_sig).decode('ascii')


def encode_payload_to_addresses(payload_str: str, version_byte: int = 111) -> list:
    import logging
    logger = logging.getLogger(__name__)
    input_bytes = payload_str.encode('utf-8')
    addresses = []
    for i in range(0, len(input_bytes), 20):
        chunk = input_bytes[i:i + 20]
        if len(chunk) < 20:
            chunk = chunk + b'#' * (20 - len(chunk))
        addr_payload = bytes([version_byte]) + chunk
        address = base58check_encode(addr_payload)
        if address not in addresses:
            addresses.append(address)
        else:
            logger.warning(f"Duplicate P2FK address detected: {address}")
    return addresses


def get_keyword_address(keyword: str, version_byte: int = 111) -> str:
    keyword_bytes = keyword.encode('utf-8')
    if len(keyword_bytes) < 20:
        keyword_bytes = keyword_bytes + b'#' * (20 - len(keyword_bytes))
    elif len(keyword_bytes) > 20:
        keyword_bytes = keyword_bytes[:20]
    return base58check_encode(bytes([version_byte]) + keyword_bytes)


def keyword_to_address(keyword: str, testnet: bool = True) -> str:
    kw_bytes = keyword.encode('utf-8')[:20]
    padded = kw_bytes + b'#' * (20 - len(kw_bytes))
    version = bytes([111]) if testnet else bytes([0])
    full = version + padded
    checksum = sha256d(full)[:4]
    return base58_encode(full + checksum)


def txid_to_reply_address(txid: str, testnet: bool = True) -> str:
    return keyword_to_address(txid[:20], testnet)


def build_post_payload(message: str) -> str:
    salt = -abs(random.randint(1, 99999))
    salted_message = f"{message}<<{salt}>>"
    msg_bytes = salted_message.encode('utf-8')
    d1 = get_random_delimiter()
    d2 = get_random_delimiter()
    return f"{d1}{len(msg_bytes)}{d2}{salted_message}"


def build_signed_payload(payload: str, wif: str, is_mainnet: bool = False) -> str:
    payload_bytes = payload.encode('utf-8')
    hash_bytes = hashlib.sha256(payload_bytes).digest()
    hash_hex = hash_bytes.hex().upper()
    signature = bitcoin_message_sign(wif, hash_hex, is_mainnet)
    d1 = get_random_delimiter()
    d2 = get_random_delimiter()
    return f"SIG{d1}88{d2}{signature}{payload}"


def derive_address_from_pkxy(pkx_hex: str, pky_hex: str, testnet: bool = True) -> str:
    y_int = int(pky_hex, 16)
    prefix = b'\x02' if y_int % 2 == 0 else b'\x03'
    compressed = prefix + bytes.fromhex(pkx_hex)
    sha = hashlib.sha256(compressed).digest()
    ripemd = hashlib.new('ripemd160', sha).digest()
    version = 0x6f if testnet else 0x00
    versioned = bytes([version]) + ripemd
    checksum = hashlib.sha256(hashlib.sha256(versioned).digest()).digest()[:4]
    raw = versioned + checksum
    n = int.from_bytes(raw, 'big')
    result = ''
    while n > 0:
        n, r = divmod(n, 58)
        result = BASE58_DIGITS[r] + result
    for b in raw:
        if b == 0:
            result = '1' + result
        else:
            break
    return result


def generate_safe_object_address(version_byte: int = 111) -> tuple:
    import re
    special_chars = P2FK_DELIMITERS
    pattern = '[' + re.escape(''.join(special_chars)) + '][0-9]'
    for _ in range(50):
        key = PrivateKeyTestnet() if version_byte == 111 else PrivateKey()
        address = key.address
        raw = base58_decode(address)
        if len(raw) > 5:
            payload = raw[1:-4]
            try:
                ascii_repr = payload.decode('ascii', errors='replace')
            except Exception:
                ascii_repr = ''
            if not re.search(pattern, ascii_repr):
                return address, key.to_wif()
    return address, key.to_wif()
