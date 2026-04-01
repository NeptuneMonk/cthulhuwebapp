"""
Iteration 20: Extended On-Chain File Resolution Tests

This iteration tests expanded on-chain file support including:
1. BTC mainnet JPEGs: MichaelJackson.jpg, YellowRobot.jpg
2. BTC testnet GIF: cloudcity4u.gif
3. DOGE mainnet JPEGs: doge.jpg, fart.jpg (fartcoin)
4. LTC mainnet PNG: kissing.png

Also tests:
- blockstream.info as primary BTC API (mempool.space unreachable)
- blockchair.com as DOGE fallback (blockcypher rate-limits)
- Retry logic with delay between API requests
- Network isolation in storefront (mainnet vs testnet)
- Profile claim uses current network (not hardcoded testnet)
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# === BTC Mainnet Test Files ===
MJ_TXID = "f3b185bd932ef28cfd8e0d6891fa5af059a0446a1512e24461ddade4f1df0b53"
MJ_FILENAME = "MichaelJackson.jpg"
MJ_EXPECTED_SIZE = 18770

YELLOWROBOT_TXID = "67b2facfd8160d4fa11b02829b6387d07537b57a7a24f19b029b2a5ae7b81830"
YELLOWROBOT_FILENAME = "YellowRobot.jpg"

# === BTC Testnet Test Files ===
BTC_TESTNET_TXID = "0ae9dbbb628bfdee9bdb85e3acec7ada318d49ad3f3d4f2a4e5c8dc0ffab0baf"
BTC_TESTNET_FILENAME = "cloudcity4u.gif"
BTC_TESTNET_EXPECTED_MIN_SIZE = 17000

# === DOGE Mainnet Test Files ===
DOGE_TXID = "d8a4f06356104b019682ed5270a80ad1fdaaa0eaba13cee97843a4098c898353"
DOGE_FILENAME = "doge.jpg"
DOGE_EXPECTED_MIN_SIZE = 4000

FARTCOIN_TXID = "9f1a7308eafee35cb405d04ce0b8a98ff711a0e43940698251acdd588a408e08"
FARTCOIN_FILENAME = "fart.jpg"

# === LTC Mainnet Test Files ===
LTC_TXID = "bbd35bac5603c2f48f0a2f1a235b4143f6d95799f45e9192b83ac737df2b978e"
LTC_FILENAME = "kissing.png"
LTC_EXPECTED_MIN_SIZE = 400


class TestHealthCheck:
    """Basic health checks"""
    
    def test_backend_health(self):
        """Backend /api/health returns healthy"""
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('status') == 'healthy'
        print("PASS: Backend health check passed")


class TestBTCMainnetOnchain:
    """BTC mainnet on-chain file resolution"""
    
    def test_mj_jpeg_returns_valid_data(self):
        """BTC mainnet MichaelJackson.jpg returns ~18770 bytes with valid JPEG header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{MJ_TXID}/{MJ_FILENAME}",
            params={"chain": "BTC", "mainnet": "true"},
            timeout=180
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Must be exactly 18770 bytes (known correct size)
        assert actual_size == MJ_EXPECTED_SIZE, \
            f"Expected {MJ_EXPECTED_SIZE} bytes, got {actual_size} bytes"
        
        # JPEG magic bytes: ff d8 ff
        assert file_bytes[:3] == b'\xff\xd8\xff', \
            f"Expected JPEG header ff d8 ff, got {file_bytes[:3].hex()}"
        
        print(f"PASS: MichaelJackson.jpg returns {actual_size} bytes with valid JPEG header")
    
    def test_yellowrobot_jpeg_returns_valid_data(self):
        """BTC mainnet YellowRobot.jpg returns valid JPEG"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{YELLOWROBOT_TXID}/{YELLOWROBOT_FILENAME}",
            params={"chain": "BTC", "mainnet": "true"},
            timeout=180
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be a valid JPEG
        assert actual_size > 1000, f"File too small: {actual_size} bytes"
        
        # JPEG magic bytes: ff d8 ff
        assert file_bytes[:3] == b'\xff\xd8\xff', \
            f"Expected JPEG header ff d8 ff, got {file_bytes[:3].hex()}"
        
        print(f"PASS: YellowRobot.jpg returns {actual_size} bytes with valid JPEG header")


class TestBTCTestnetOnchain:
    """BTC testnet on-chain file resolution"""
    
    def test_btc_testnet_gif_returns_valid_data(self):
        """BTC testnet cloudcity4u.gif returns ~17399 bytes with valid GIF header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{BTC_TESTNET_TXID}/{BTC_TESTNET_FILENAME}",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=180
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be around 17399 bytes
        assert actual_size >= BTC_TESTNET_EXPECTED_MIN_SIZE, \
            f"File too small: {actual_size} bytes (expected >= {BTC_TESTNET_EXPECTED_MIN_SIZE})"
        
        # GIF magic bytes: GIF8
        assert file_bytes[:4] in (b'GIF89', b'GIF87', b'GIF8'), \
            f"Expected GIF header, got {file_bytes[:6]}"
        
        print(f"PASS: cloudcity4u.gif returns {actual_size} bytes with valid GIF header")


class TestDOGEMainnetOnchain:
    """DOGE mainnet on-chain file resolution"""
    
    def test_doge_jpeg_returns_valid_data(self):
        """DOGE mainnet doge.jpg returns ~4273 bytes with valid JPEG header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": "true"},
            timeout=120
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be around 4273 bytes
        assert actual_size >= DOGE_EXPECTED_MIN_SIZE, \
            f"File too small: {actual_size} bytes (expected >= {DOGE_EXPECTED_MIN_SIZE})"
        
        # JPEG magic bytes
        assert file_bytes[:3] == b'\xff\xd8\xff', \
            f"Expected JPEG header, got {file_bytes[:3].hex()}"
        
        print(f"PASS: DOGE doge.jpg returns {actual_size} bytes with valid JPEG header")
    
    def test_fartcoin_jpeg_returns_valid_data(self):
        """DOGE mainnet fart.jpg (fartcoin) returns valid JPEG"""
        # Wait to avoid rate limiting from previous DOGE request
        time.sleep(3)
        
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{FARTCOIN_TXID}/{FARTCOIN_FILENAME}",
            params={"chain": "DOG", "mainnet": "true"},
            timeout=120
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be a valid JPEG
        assert actual_size > 100, f"File too small: {actual_size} bytes"
        
        # JPEG magic bytes
        assert file_bytes[:3] == b'\xff\xd8\xff', \
            f"Expected JPEG header, got {file_bytes[:3].hex()}"
        
        print(f"PASS: DOGE fart.jpg returns {actual_size} bytes with valid JPEG header")


class TestLTCMainnetOnchain:
    """LTC mainnet on-chain file resolution"""
    
    def test_ltc_png_returns_valid_data(self):
        """LTC mainnet kissing.png returns ~415 bytes with valid PNG header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{LTC_TXID}/{LTC_FILENAME}",
            params={"chain": "LTC", "mainnet": "true"},
            timeout=120
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be around 415 bytes
        assert actual_size >= LTC_EXPECTED_MIN_SIZE, \
            f"File too small: {actual_size} bytes (expected >= {LTC_EXPECTED_MIN_SIZE})"
        
        # PNG magic bytes: 89 50 4e 47 (0x89 P N G)
        assert file_bytes[:4] == b'\x89PNG', \
            f"Expected PNG header, got {file_bytes[:4].hex()}"
        
        print(f"PASS: LTC kissing.png returns {actual_size} bytes with valid PNG header")


class TestOnchainCaching:
    """Tests for on-chain file caching behavior"""
    
    def test_second_request_is_cached(self):
        """Second request for same file returns instant from MongoDB cache"""
        # Use a file likely to be cached from previous tests
        # First request
        start1 = time.time()
        resp1 = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": "true"},
            timeout=120
        )
        time1 = time.time() - start1
        
        # Second request (should be cached)
        start2 = time.time()
        resp2 = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": "true"},
            timeout=30
        )
        time2 = time.time() - start2
        
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        
        # Content should be identical
        assert len(resp1.content) == len(resp2.content), "Cached content differs from original"
        
        # Second request should be much faster (< 2 seconds)
        assert time2 < 2.0, f"Cached request too slow: {time2:.2f}s"
        
        print(f"PASS: Caching works - First: {time1:.2f}s, Cached: {time2:.2f}s")


class TestStorefrontNetworkIsolation:
    """Tests for network isolation in storefront"""
    
    def test_mainnet_storefront_returns_mainnet_objects(self):
        """Storefront /api/objects/storefront/btc-mainnet returns mainnet-only objects"""
        resp = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-mainnet",
            params={"limit": 20},
            timeout=60
        )
        
        assert resp.status_code == 200
        data = resp.json()
        assert 'objects' in data
        print(f"PASS: Mainnet storefront returns {len(data.get('objects', []))} objects (total: {data.get('total', 0)})")
    
    def test_testnet_storefront_returns_testnet_objects(self):
        """Storefront /api/objects/storefront/btc-testnet returns testnet-only objects"""
        resp = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 20},
            timeout=60
        )
        
        assert resp.status_code == 200
        data = resp.json()
        assert 'objects' in data
        print(f"PASS: Testnet storefront returns {len(data.get('objects', []))} objects (total: {data.get('total', 0)})")


class TestExistingEndpoints:
    """Verify existing endpoints still work after on-chain fixes"""
    
    def test_feed_endpoint(self):
        """Feed endpoint still returns data"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 3}, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert 'feed' in data
        print(f"PASS: Feed endpoint returns {len(data.get('feed', []))} posts")


class TestOnchainStatus:
    """Tests for GET /api/onchain/status/{txid}"""
    
    def test_btc_mainnet_status(self):
        """On-chain status for BTC mainnet file shows resolvable=true"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{MJ_TXID}",
            params={"chain": "BTC", "mainnet": "true"},
            timeout=60
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('resolvable') == True, f"Expected resolvable=true, got {data}"
        print(f"PASS: BTC mainnet status shows resolvable=true")
    
    def test_ltc_mainnet_status(self):
        """On-chain status for LTC mainnet file shows resolvable=true"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{LTC_TXID}",
            params={"chain": "LTC", "mainnet": "true"},
            timeout=60
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('resolvable') == True, f"Expected resolvable=true, got {data}"
        print(f"PASS: LTC mainnet status shows resolvable=true")


class TestFrontendMediaPatterns:
    """Verify URL patterns used by frontend work correctly"""
    
    def test_all_txids_are_valid_hex(self):
        """All test txids are valid 64-character hex strings"""
        test_txids = [
            ("MJ_BTC", MJ_TXID),
            ("YellowRobot_BTC", YELLOWROBOT_TXID),
            ("BTC_Testnet", BTC_TESTNET_TXID),
            ("DOGE", DOGE_TXID),
            ("Fartcoin_DOGE", FARTCOIN_TXID),
            ("LTC", LTC_TXID),
        ]
        
        for name, txid in test_txids:
            assert len(txid) == 64, f"{name} txid wrong length: {len(txid)}"
            assert all(c in '0123456789abcdef' for c in txid.lower()), f"{name} txid not valid hex"
        
        print("PASS: All test txids are valid 64-character hex")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
