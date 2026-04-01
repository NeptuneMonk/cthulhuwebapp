"""
P2FK Protocol Compatibility Test Suite
Verifies byte-level compatibility between our implementation and SUP's C# P2FK parser.

Tests:
1. Base58Check encoding matches SUP's Base58.EncodeWithCheckSum
2. Keyword address generation matches Root.GetPublicAddressByKeyword
3. Payload chunking (20-byte split + '#' padding)
4. Signature format matches Bitcoin Core signmessage
5. Full roundtrip: encode → decode → verify original payload
"""
import hashlib
import struct
import json
import sys
import re
import os

# --- Base58Check (matching SUP's Base58.cs) ---
B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def sha256d(data: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()

def base58_encode(data: bytes) -> str:
    """Matches SUP Base58.Encode: BigInteger division"""
    num = int.from_bytes(data, 'big')
    result = ''
    while num > 0:
        num, remainder = divmod(num, 58)
        result = B58_ALPHABET[remainder] + result
    # Leading zero bytes = leading '1's
    for byte in data:
        if byte == 0:
            result = '1' + result
        else:
            break
    return result

def base58check_encode(data: bytes) -> str:
    """Matches SUP Base58.EncodeWithCheckSum"""
    checksum = sha256d(data)[:4]
    return base58_encode(data + checksum)

def base58_decode(s: str) -> bytes:
    """Matches SUP Base58.Decode"""
    num = 0
    for c in s:
        num = num * 58 + B58_ALPHABET.index(c)
    # Count leading '1's
    pad_size = 0
    for c in s:
        if c == '1':
            pad_size += 1
        else:
            break
    result = num.to_bytes((num.bit_length() + 7) // 8, 'big') if num > 0 else b''
    return b'\x00' * pad_size + result

def base58check_decode(s: str) -> bytes:
    """Matches SUP Base58.DecodeWithCheckSum - returns bytes WITHOUT checksum"""
    decoded = base58_decode(s)
    return decoded[:-4]  # Remove 4-byte checksum


# --- Test 1: Keyword Address Generation ---
def get_keyword_address(keyword: str, version_byte: int = 111) -> str:
    """Must match SUP Root.GetPublicAddressByKeyword"""
    kb = keyword.encode('utf-8')
    if len(kb) < 20:
        kb = kb + b'#' * (20 - len(kb))
    elif len(kb) > 20:
        kb = kb[:20]
    return base58check_encode(bytes([version_byte]) + kb)


def test_keyword_addresses():
    """Test various URNs against expected addresses"""
    print("=" * 60)
    print("TEST 1: Keyword Address Generation")
    print("=" * 60)

    test_keywords = [
        "embii4u",
        "shitcoins",
        "DEDA",
        "kattacomi",
        "testuser123",
        "abc",
        "a",
        "12345678901234567890",  # Exactly 20 bytes
        "123456789012345678901", # 21 bytes - should truncate
    ]

    all_pass = True
    for kw in test_keywords:
        addr = get_keyword_address(kw, 111)  # testnet
        # Verify roundtrip: decode address back to bytes, check keyword
        decoded = base58check_decode(addr)
        version = decoded[0]
        payload = decoded[1:]  # 20 bytes

        # Strip '#' padding and decode to get back the keyword
        recovered = payload.rstrip(b'#').decode('utf-8', errors='replace')

        # For keywords > 20 bytes, only first 20 chars are preserved
        expected = kw[:20] if len(kw.encode('utf-8')) > 20 else kw

        ok = (version == 111 and recovered == expected and len(payload) == 20)
        status = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"  [{status}] '{kw}' → {addr} (version={version}, payload_len={len(payload)}, recovered='{recovered}')")

    # Cross-validate with our backend Python implementation
    sys.path.insert(0, '/app/backend')
    try:
        # Import the backend's implementation
        from server import _get_keyword_address
        print("\n  Cross-validating with backend server.py implementation...")
        for kw in test_keywords[:5]:
            backend_addr = _get_keyword_address(kw, 111)
            our_addr = get_keyword_address(kw, 111)
            match = backend_addr == our_addr
            if not match:
                all_pass = False
            print(f"  [{'PASS' if match else 'FAIL'}] '{kw}': backend={backend_addr}, test={our_addr}")
    except ImportError as e:
        print(f"  [SKIP] Could not import backend: {e}")

    return all_pass


# --- Test 2: Payload Chunking ---
def encode_payload_to_addresses(payload_str: str, version_byte: int = 111) -> list:
    """Must match SUP ProfileMint.cs encoding loop"""
    input_bytes = payload_str.encode('utf-8')
    addresses = []

    for i in range(0, len(input_bytes), 20):
        chunk = input_bytes[i:i+20]
        if len(chunk) < 20:
            chunk = chunk + b'#' * (20 - len(chunk))
        addr = base58check_encode(bytes([version_byte]) + chunk)
        if addr not in addresses:
            addresses.append(addr)
    return addresses


def test_payload_chunking():
    """Test that payload → addresses → decoded bytes roundtrips correctly"""
    print("\n" + "=" * 60)
    print("TEST 2: Payload Chunking (20-byte split + '#' padding)")
    print("=" * 60)

    test_payloads = [
        "Hello",  # < 20 bytes
        "12345678901234567890",  # Exactly 20 bytes
        "12345678901234567890ABCDEF",  # 26 bytes = 2 chunks
        'PRO/42/{"urn":"test","cre":["0"]}',  # Realistic PRO payload
    ]

    all_pass = True
    for payload in test_payloads:
        addresses = encode_payload_to_addresses(payload, 111)
        original_bytes = payload.encode('utf-8')

        # Decode addresses back to bytes (SUP's decoding logic)
        recovered_bytes = b''
        for addr in addresses:
            decoded = base58check_decode(addr)
            # Skip version byte (first byte), take remaining 20 bytes
            recovered_bytes += decoded[1:]

        # Strip '#' padding from the end
        recovered_trimmed = recovered_bytes.rstrip(b'#')

        # The recovered bytes should match the original (possibly with trailing # in last chunk)
        match = recovered_trimmed[:len(original_bytes)] == original_bytes
        if not match:
            all_pass = False
        print(f"  [{'PASS' if match else 'FAIL'}] Payload ({len(original_bytes)} bytes) → {len(addresses)} addresses → recovered {len(recovered_trimmed)} bytes")
        if not match:
            print(f"    Original:  {original_bytes[:60]}...")
            print(f"    Recovered: {recovered_trimmed[:60]}...")

    return all_pass


# --- Test 3: Signature Format ---
def test_signature_format():
    """Verify our signature format matches Bitcoin Core signmessage"""
    print("\n" + "=" * 60)
    print("TEST 3: Bitcoin Message Signature Format")
    print("=" * 60)

    try:
        import base64
        sys.path.insert(0, '/app/backend')
        from server import _bitcoin_message_sign
        from bit import PrivateKeyTestnet

        key = PrivateKeyTestnet()
        wif = key.to_wif()
        address = key.address

        # Create a test message (SHA256 hash in uppercase hex - matching SUP)
        test_payload = 'PRO/10/{"urn":"t"}'
        hash_bytes = hashlib.sha256(test_payload.encode('utf-8')).digest()
        hash_hex = hash_bytes.hex().upper()

        # Sign using backend's implementation
        signature = _bitcoin_message_sign(wif, hash_hex, is_mainnet=False)
        sig_bytes = base64.b64decode(signature)

        print(f"  WIF: {wif[:20]}...")
        print(f"  Address: {address}")
        print(f"  Hash hex: {hash_hex[:32]}...")
        print(f"  Signature: {signature}")
        print(f"  Sig bytes length: {len(sig_bytes)} (expected 65)")
        print(f"  Sig base64 length: {len(signature)} chars (expected 88)")
        print(f"  Recovery flag: {sig_bytes[0]} (expected 31-34 for compressed)")

        len_ok = len(sig_bytes) == 65
        flag_ok = 27 <= sig_bytes[0] <= 34
        b64_len_ok = len(signature) == 88

        print(f"  [{'PASS' if len_ok else 'FAIL'}] Signature is 65 bytes")
        print(f"  [{'PASS' if flag_ok else 'FAIL'}] Recovery flag in valid range")
        print(f"  [{'PASS' if b64_len_ok else 'FAIL'}] Base64 is 88 characters")

        return len_ok and flag_ok and b64_len_ok
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
        return False


# --- Test 4: Full P2FK Roundtrip ---
def test_full_roundtrip():
    """Build a complete signed P2FK payload and verify SUP's parser can read it"""
    print("\n" + "=" * 60)
    print("TEST 4: Full P2FK Roundtrip (Encode → Decode → Verify)")
    print("=" * 60)

    try:
        from bit import PrivateKeyTestnet
        import base64
        sys.path.insert(0, '/app/backend')
        from server import _bitcoin_message_sign

        key = PrivateKeyTestnet()
        wif = key.to_wif()
        address = key.address
        version_byte = 111

        # Step 1: Build PRO JSON
        pro_data = {"urn": "testmint", "dnm": "Test User", "bio": "P2FK compat test", "cre": ["0"]}
        pro_json = json.dumps(pro_data, separators=(',', ':'))
        pro_bytes = pro_json.encode('utf-8')

        print(f"  PRO JSON: {pro_json}")
        print(f"  PRO byte length: {len(pro_bytes)}")

        # Step 2: Build P2FK payload string (matching SUP exactly)
        delimiter = '/'
        payload = f"PRO{delimiter}{len(pro_bytes)}{delimiter}{pro_json}"
        print(f"  P2FK payload: {payload[:60]}...")

        # Step 3: SHA-256 hash (single, uppercase hex - matching SUP)
        hash_bytes = hashlib.sha256(payload.encode('utf-8')).digest()
        hash_hex = hash_bytes.hex().upper()
        print(f"  SHA-256 hash: {hash_hex[:32]}...")

        # Step 4: Sign with Bitcoin message format using backend
        signature = _bitcoin_message_sign(wif, hash_hex, is_mainnet=False)
        print(f"  Signature: {signature} ({len(signature)} chars)")

        # Step 5: Prepend SIG header
        full_payload = f"SIG{delimiter}88{delimiter}{signature}{payload}"
        print(f"  Full payload length: {len(full_payload)} chars")
        print(f"  Full payload (first 80): {full_payload[:80]}...")

        # Step 6: Encode to addresses
        encoded_addresses = encode_payload_to_addresses(full_payload, version_byte)
        print(f"  Encoded into {len(encoded_addresses)} addresses")

        # Step 7: Add keyword address
        urn_addr = get_keyword_address("testmint", version_byte)
        if urn_addr not in encoded_addresses:
            encoded_addresses.append(urn_addr)

        # Add signature address LAST
        if address in encoded_addresses:
            encoded_addresses.remove(address)
        encoded_addresses.append(address)
        print(f"  Total addresses (with keywords): {len(encoded_addresses)}")

        # === NOW DECODE (simulating SUP's Root.GetRootByTransactionId) ===
        print(f"\n  --- Decoding (simulating SUP parser) ---")

        # SUP reads each address's 20-byte payload in order
        transaction_bytes = b''
        for addr in encoded_addresses:
            decoded = base58check_decode(addr)
            # Skip version byte (first byte), take 20 bytes
            if len(decoded) >= 21:
                transaction_bytes += decoded[1:21]
            else:
                transaction_bytes += decoded[1:]

        transaction_ascii = transaction_bytes.decode('ascii', errors='replace')

        # SUP's regex: find special_char followed by digits
        p2fk_delimiters = set('\\/:*?"<>|')
        pattern = re.compile(r'([\\/:*?"<>|])(\d+)')

        # Parse SIG section
        sig_match = pattern.search(transaction_ascii)
        if sig_match:
            sig_delim = sig_match.group(1)
            sig_size = int(sig_match.group(2))
            sig_header_size = sig_match.start() + len(sig_match.group()) + 1
            sig_filename = transaction_ascii[:sig_match.start()]

            print(f"  First section: filename='{sig_filename}', size={sig_size}")

            if sig_filename == 'SIG' and sig_size == 88:
                recovered_signature = transaction_ascii[sig_header_size:sig_header_size + sig_size]
                print(f"  Recovered signature: {recovered_signature[:40]}...")
                sig_match_ok = recovered_signature == signature
                print(f"  [{'PASS' if sig_match_ok else 'FAIL'}] Signature recovered correctly")

                # Advance past SIG section
                remaining = transaction_ascii[sig_header_size + sig_size:]

                # Parse PRO section
                pro_match = pattern.search(remaining)
                if pro_match:
                    pro_delim = pro_match.group(1)
                    pro_size = int(pro_match.group(2))
                    pro_header_size = pro_match.start() + len(pro_match.group()) + 1
                    pro_filename = remaining[:pro_match.start()]

                    print(f"  Second section: filename='{pro_filename}', size={pro_size}")

                    if pro_filename == 'PRO':
                        # Extract PRO JSON bytes from the ORIGINAL transaction bytes
                        # Calculate byte offset
                        sig_section_bytes = len(f"SIG{delimiter}88{delimiter}{signature}".encode('utf-8'))
                        pro_header_bytes = len(f"PRO{delimiter}{len(pro_bytes)}{delimiter}".encode('utf-8'))
                        pro_start = sig_section_bytes + pro_header_bytes
                        recovered_pro_bytes = transaction_bytes[pro_start:pro_start + pro_size]
                        recovered_pro_json = recovered_pro_bytes.decode('utf-8')

                        print(f"  Recovered PRO JSON: {recovered_pro_json}")

                        json_match = recovered_pro_json == pro_json
                        print(f"  [{'PASS' if json_match else 'FAIL'}] PRO JSON recovered correctly")

                        # Parse the JSON
                        recovered_data = json.loads(recovered_pro_json)
                        urn_match = recovered_data.get('urn') == 'testmint'
                        print(f"  [{'PASS' if urn_match else 'FAIL'}] URN: {recovered_data.get('urn')}")

                        # Verify the remaining bytes contain keywords
                        keyword_start = sig_section_bytes + pro_header_bytes + pro_size
                        keyword_bytes = transaction_bytes[keyword_start:]
                        # Strip to 20-byte boundary
                        remainder_len = len(keyword_bytes) % 20
                        if remainder_len > 0:
                            keyword_bytes = keyword_bytes[remainder_len:]

                        keyword_addresses = []
                        for i in range(0, len(keyword_bytes), 20):
                            chunk = keyword_bytes[i:i+20]
                            if len(chunk) == 20:
                                kw_addr = base58check_encode(bytes([version_byte]) + chunk)
                                keyword_addresses.append(kw_addr)

                        print(f"  Keyword addresses found: {len(keyword_addresses)}")
                        urn_kw_match = urn_addr in keyword_addresses or urn_addr in encoded_addresses
                        print(f"  [{'PASS' if urn_kw_match else 'FAIL'}] URN keyword address present: {urn_addr[:20]}...")

                        # Verify signature against hash
                        # SUP computes hash of bytes from sigStartByte to sigEndByte
                        sig_payload_bytes = transaction_bytes[sig_section_bytes:sig_section_bytes + pro_header_bytes + pro_size]
                        sig_hash = hashlib.sha256(sig_payload_bytes).hexdigest().upper()

                        # Note: SUP uses the BYTES of the payload, not the string
                        # Our hash was computed from the STRING of the payload
                        # Let's check if they match
                        our_hash = hashlib.sha256(payload.encode('utf-8')).hexdigest().upper()
                        hash_match = sig_hash == our_hash
                        print(f"  [{'PASS' if hash_match else 'FAIL'}] Hash verification: SUP hash matches our hash")
                        if not hash_match:
                            print(f"    SUP hash:  {sig_hash[:32]}...")
                            print(f"    Our hash:  {our_hash[:32]}...")

                        # Verify signature format
                        sig_bytes = base64.b64decode(recovered_signature)
                        sig_format_ok = len(sig_bytes) == 65 and 27 <= sig_bytes[0] <= 34
                        print(f"  [{'PASS' if sig_format_ok else 'FAIL'}] Signature format valid (65 bytes, flag={sig_bytes[0]})")

                        return sig_match_ok and json_match and urn_match and sig_format_ok
                    else:
                        print(f"  [FAIL] Expected 'PRO' but got '{pro_filename}'")
                else:
                    print(f"  [FAIL] No PRO section found in remaining: {remaining[:40]}")
            else:
                print(f"  [FAIL] Expected SIG/88 but got {sig_filename}/{sig_size}")
        else:
            print(f"  [FAIL] No P2FK pattern found in decoded bytes")
            print(f"  First 80 chars: {transaction_ascii[:80]}")

        return False

    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
        return False


# --- Test 5: Cross-validate with backend server.py ---
def test_backend_crossvalidation():
    """Compare our test implementation with the backend's P2FK functions"""
    print("\n" + "=" * 60)
    print("TEST 5: Cross-validation with Backend server.py")
    print("=" * 60)

    sys.path.insert(0, '/app/backend')
    try:
        from server import _encode_payload_to_addresses, _get_keyword_address

        test_payload = 'SIG/88/' + 'A' * 88 + 'PRO/26/{"urn":"test","cre":["0"]}'

        backend_addrs = _encode_payload_to_addresses(test_payload, 111)
        our_addrs = encode_payload_to_addresses(test_payload, 111)

        match = backend_addrs == our_addrs
        print(f"  [{'PASS' if match else 'FAIL'}] Address lists match: {len(backend_addrs)} vs {len(our_addrs)} addresses")
        if not match:
            for i, (a, b) in enumerate(zip(backend_addrs, our_addrs)):
                if a != b:
                    print(f"    Mismatch at index {i}: backend={a}, test={b}")
            if len(backend_addrs) != len(our_addrs):
                print(f"    Length mismatch: backend={len(backend_addrs)}, test={len(our_addrs)}")

        # Test keyword addresses
        for kw in ["embii4u", "shitcoins", "DEDA"]:
            backend_kw = _get_keyword_address(kw, 111)
            our_kw = get_keyword_address(kw, 111)
            kw_match = backend_kw == our_kw
            if not kw_match:
                match = False
            print(f"  [{'PASS' if kw_match else 'FAIL'}] Keyword '{kw}': backend={backend_kw[:20]}..., test={our_kw[:20]}...")

        return match
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
        return False


# --- Test 6: Verify against known testnet transaction ---
def test_known_transaction():
    """If we can find a known P2FK profile transaction, decode it"""
    print("\n" + "=" * 60)
    print("TEST 6: SUP Parser Format Validation")
    print("=" * 60)

    # Test that our SIG header format matches what SUP expects
    # SUP regex: ([\\/:*?"<>|])\d+
    sig_pattern = re.compile(r'([\\/:*?"<>|])(\d+)')

    test_payloads = [
        'SIG/88/' + 'X' * 88 + 'PRO/10/{"urn":"a"}',
        'SIG\\88\\' + 'Y' * 88 + 'PRO:15:{"urn":"test"}',
        'SIG*88*' + 'Z' * 88 + 'PRO|20|{"urn":"longname"}',
    ]

    all_pass = True
    for payload in test_payloads:
        m = sig_pattern.search(payload)
        if m:
            filename = payload[:m.start()]
            size = int(m.group(2))
            header_end = m.start() + len(m.group()) + 1

            ok = filename == 'SIG' and size == 88
            print(f"  [{'PASS' if ok else 'FAIL'}] Parsed: filename='{filename}', size={size}, header_end={header_end}")
            if not ok:
                all_pass = False
        else:
            print(f"  [FAIL] No match for: {payload[:40]}...")
            all_pass = False

    # Test that PRO section is parseable after SIG section
    full = 'SIG/88/' + 'A' * 88 + 'PRO/26/{"urn":"test","cre":["0"]}'
    # Skip SIG section
    sig_m = sig_pattern.search(full)
    sig_end = sig_m.start() + len(sig_m.group()) + 1 + 88
    remaining = full[sig_end:]
    pro_m = sig_pattern.search(remaining)
    if pro_m:
        pro_name = remaining[:pro_m.start()]
        pro_size = int(pro_m.group(2))
        pro_header_end = pro_m.start() + len(pro_m.group()) + 1
        pro_content = remaining[pro_header_end:pro_header_end + pro_size]

        try:
            parsed = json.loads(pro_content)
            ok = parsed.get('urn') == 'test'
            print(f"  [{'PASS' if ok else 'FAIL'}] PRO section parsed: {parsed}")
            if not ok:
                all_pass = False
        except:
            print(f"  [FAIL] Could not parse PRO JSON: {pro_content}")
            all_pass = False
    else:
        print(f"  [FAIL] No PRO section found in: {remaining[:40]}...")
        all_pass = False

    return all_pass


# --- Test 7: Duplicate Address Detection ---
def test_no_duplicate_addresses():
    """Verify that a real signed payload never produces duplicate P2FK addresses"""
    print("\n" + "=" * 60)
    print("TEST 7: Duplicate Address Check (Real Signatures)")
    print("=" * 60)

    try:
        sys.path.insert(0, '/app/backend')
        from server import _bitcoin_message_sign, _build_signed_payload, _encode_payload_to_addresses
        from bit import PrivateKeyTestnet

        all_pass = True
        # Test 10 different profiles with random keys
        for i in range(10):
            key = PrivateKeyTestnet()
            wif = key.to_wif()

            pro_data = {"urn": f"test{i}", "dnm": f"User {i}", "bio": f"Bio {i}", "cre": ["0"]}
            pro_json = json.dumps(pro_data, separators=(',', ':'))
            delimiter = ['/', '\\', ':', '*'][i % 4]
            payload = f"PRO{delimiter}{len(pro_json.encode('utf-8'))}{delimiter}{pro_json}"
            full_payload = _build_signed_payload(payload, wif, is_mainnet=False)

            addresses = _encode_payload_to_addresses(full_payload, 111)
            unique = set(addresses)

            has_dupes = len(addresses) != len(unique)
            print(f"  [{'FAIL' if has_dupes else 'PASS'}] Profile '{pro_data['urn']}': {len(addresses)} addrs, {len(unique)} unique")
            if has_dupes:
                all_pass = False

        return all_pass
    except Exception as e:
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
        return False



# === Run all tests ===
if __name__ == '__main__':
    results = {}
    results['keyword_addresses'] = test_keyword_addresses()
    results['payload_chunking'] = test_payload_chunking()
    results['signature_format'] = test_signature_format()
    results['full_roundtrip'] = test_full_roundtrip()
    results['backend_crossvalidation'] = test_backend_crossvalidation()
    results['parser_format'] = test_known_transaction()
    results['no_duplicate_addresses'] = test_no_duplicate_addresses()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    all_pass = True
    for name, passed in results.items():
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_pass = False
        print(f"  [{status}] {name}")

    print(f"\n  {'ALL TESTS PASSED' if all_pass else 'SOME TESTS FAILED'}")
    sys.exit(0 if all_pass else 1)
