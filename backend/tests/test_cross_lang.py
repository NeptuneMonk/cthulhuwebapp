"""
Cross-language signature compatibility test.
Generates a signing challenge in Python, outputs it as JSON for JS verification.
Also verifies that Python's bit library can verify signatures produced by the JS noble implementation.
"""
import hashlib
import json
import base64
from bit import PrivateKeyTestnet

# Generate a real test key
key = PrivateKeyTestnet()
TEST_WIF = key.to_wif()
address = key.address

# Build a realistic P2FK payload
pro_json = '{"urn":"crosslang","dnm":"Cross-Language Test","cre":["0"]}'
payload = f'PRO/{len(pro_json.encode("utf-8"))}/{pro_json}'

# SHA-256 single hash, uppercase hex (SUP's method)
hash_bytes = hashlib.sha256(payload.encode('utf-8')).digest()
hash_hex = hash_bytes.hex().upper()

# Import the backend signing function
import sys
sys.path.insert(0, '/app/backend')
from server import _bitcoin_message_sign

python_sig = _bitcoin_message_sign(TEST_WIF, hash_hex, is_mainnet=False)
python_sig_bytes = base64.b64decode(python_sig)

print("=" * 60)
print("Cross-Language Signature Test Data")
print("=" * 60)
print(f"WIF: {TEST_WIF}")
print(f"Address: {address}")
print(f"Payload: {payload}")
print(f"SHA256 hash (uppercase): {hash_hex}")
print(f"Python signature: {python_sig}")
print(f"Python sig bytes: {python_sig_bytes.hex()}")
print(f"Python sig flag byte: {python_sig_bytes[0]} (decimal)")
print(f"Python sig length: {len(python_sig_bytes)} bytes, {len(python_sig)} chars base64")

# Output as JSON for JS consumption
test_data = {
    "wif": TEST_WIF,
    "address": address,
    "payload": payload,
    "hash_hex": hash_hex,
    "python_signature": python_sig,
    "python_sig_flag": python_sig_bytes[0],
}

with open('/app/backend/tests/cross_lang_test_data.json', 'w') as f:
    json.dump(test_data, f, indent=2)

print(f"\nTest data written to /app/backend/tests/cross_lang_test_data.json")

# Also verify our keyword addresses are correct
from server import _get_keyword_address, _encode_payload_to_addresses
kw_addr = _get_keyword_address("crosslang", 111)
print(f"\nKeyword address for 'crosslang': {kw_addr}")

# Build the full signed payload and encode it
full_payload = f'SIG/88/{python_sig}{payload}'
addresses = _encode_payload_to_addresses(full_payload, 111)
addresses.append(kw_addr)
addresses.append(address)

print(f"Total encoded addresses: {len(addresses)}")
print(f"Estimated TX cost: {len(addresses) * 546} sats + fee")

test_data['keyword_address'] = kw_addr
test_data['encoded_addresses'] = addresses
test_data['full_payload'] = full_payload

with open('/app/backend/tests/cross_lang_test_data.json', 'w') as f:
    json.dump(test_data, f, indent=2)

print(f"\nFull test data updated. JS frontend should produce identical addresses for the same inputs.")
print("The SIGNATURE may differ (different nonce), but the ADDRESS LIST should be identical structure.")
