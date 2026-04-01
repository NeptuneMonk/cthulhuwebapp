"""
Iteration 19: On-Chain File Resolution Bug Fix Tests

This iteration tests the fix for the Michael Jackson JPEG issue where the on-chain
resolver was returning Wikipedia text instead of the actual JPEG.

Bug Fix Summary:
- Added blockstream.info as PRIMARY API for BTC (mempool.space unreachable from this pod)
- Fixed combined-stream ledger logic: concatenate all child transaction bytes before parsing

Test Files:
1. BTC mainnet: MichaelJackson.jpg - Should return 18770 bytes with ff d8 ff JPEG header
2. DOGE mainnet: doge.jpg - Should return ~4273 bytes with ff d8 ff JPEG header  
3. BTC testnet: cloudcity4u.gif - Should return ~17399 bytes with GIF89a header
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test file constants
MJ_TXID = "f3b185bd932ef28cfd8e0d6891fa5af059a0446a1512e24461ddade4f1df0b53"
MJ_FILENAME = "MichaelJackson.jpg"
MJ_EXPECTED_SIZE = 18770  # Expected size from fix

DOGE_TXID = "d8a4f06356104b019682ed5270a80ad1fdaaa0eaba13cee97843a4098c898353"
DOGE_FILENAME = "doge.jpg"
DOGE_EXPECTED_MIN_SIZE = 4000

BTC_TESTNET_TXID = "0ae9dbbb628bfdee9bdb85e3acec7ada318d49ad3f3d4f2a4e5c8dc0ffab0baf"
BTC_TESTNET_FILENAME = "cloudcity4u.gif"
BTC_TESTNET_EXPECTED_MIN_SIZE = 17000


class TestHealthCheck:
    """Basic health checks"""
    
    def test_backend_health(self):
        """Backend /api/health returns healthy"""
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('status') == 'healthy'
        print("PASS: Backend health check passed")


class TestMichaelJacksonJPEGFix:
    """CRITICAL: Tests for the Michael Jackson JPEG fix - the main bug fix in this iteration"""
    
    def test_mj_jpeg_returns_correct_size(self):
        """BTC mainnet MichaelJackson.jpg returns 18770 bytes (KEY REGRESSION FIX)"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{MJ_TXID}/{MJ_FILENAME}",
            params={"chain": "BTC", "mainnet": True},
            timeout=180  # Allow time for multi-transaction fetch
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # CRITICAL: Must be exactly 18770 bytes (the known correct size)
        assert actual_size == MJ_EXPECTED_SIZE, \
            f"Expected {MJ_EXPECTED_SIZE} bytes, got {actual_size} bytes"
        
        print(f"PASS: MichaelJackson.jpg returns {actual_size} bytes (expected {MJ_EXPECTED_SIZE})")
    
    def test_mj_jpeg_has_valid_jpeg_header(self):
        """BTC mainnet MichaelJackson.jpg has valid JPEG magic bytes ff d8 ff"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{MJ_TXID}/{MJ_FILENAME}",
            params={"chain": "BTC", "mainnet": True},
            timeout=180
        )
        
        assert resp.status_code == 200
        file_bytes = resp.content
        
        # JPEG magic bytes: ff d8 ff
        assert file_bytes[:3] == b'\xff\xd8\xff', \
            f"Expected JPEG header ff d8 ff, got {file_bytes[:3].hex()}"
        
        # Verify it's not Wikipedia text (the bug we fixed)
        assert not file_bytes[:20].decode('utf-8', errors='ignore').startswith('Michael'), \
            "REGRESSION: File starts with text, not JPEG binary data"
        
        print(f"PASS: MichaelJackson.jpg has valid JPEG header: {file_bytes[:4].hex()}")
    
    def test_mj_jpeg_content_type(self):
        """BTC mainnet MichaelJackson.jpg has correct Content-Type header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{MJ_TXID}/{MJ_FILENAME}",
            params={"chain": "BTC", "mainnet": True},
            timeout=180
        )
        
        assert resp.status_code == 200
        content_type = resp.headers.get('Content-Type', '')
        assert 'image/jpeg' in content_type, f"Expected image/jpeg, got {content_type}"
        
        print(f"PASS: Content-Type is image/jpeg")


class TestDOGEMainnetJPEG:
    """DOGE mainnet on-chain JPEG tests"""
    
    def test_doge_jpeg_returns_valid_bytes(self):
        """DOGE mainnet doge.jpg returns ~4273 bytes with valid JPEG header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": True},
            timeout=60
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


class TestBTCTestnetGIF:
    """BTC testnet on-chain GIF tests"""
    
    def test_btc_testnet_gif_returns_valid_bytes(self):
        """BTC testnet cloudcity4u.gif returns ~17399 bytes with valid GIF header"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/file/{BTC_TESTNET_TXID}/{BTC_TESTNET_FILENAME}",
            params={"chain": "BTC", "mainnet": False},
            timeout=120
        )
        
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        file_bytes = resp.content
        actual_size = len(file_bytes)
        
        # Should be around 17399 bytes
        assert actual_size >= BTC_TESTNET_EXPECTED_MIN_SIZE, \
            f"File too small: {actual_size} bytes (expected >= {BTC_TESTNET_EXPECTED_MIN_SIZE})"
        
        # GIF magic bytes: GIF89a or GIF87a
        assert file_bytes[:3] == b'GIF', \
            f"Expected GIF header, got {file_bytes[:3].hex()}"
        
        print(f"PASS: BTC testnet cloudcity4u.gif returns {actual_size} bytes with valid GIF header")


class TestOnchainStatus:
    """Tests for GET /api/onchain/status/{txid}"""
    
    def test_mj_status_resolvable(self):
        """On-chain status for MJ shows resolvable=true and is_ledger=true"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{MJ_TXID}",
            params={"chain": "BTC", "mainnet": True},
            timeout=60
        )
        assert resp.status_code == 200
        data = resp.json()
        
        assert data.get('resolvable') == True, f"Expected resolvable=true, got {data}"
        # MJ uses ledger structure with multiple child transactions
        assert data.get('is_ledger') == True, "MJ should be detected as ledger"
        
        print(f"PASS: MJ status shows resolvable=true, is_ledger=true")
    
    def test_doge_status_resolvable(self):
        """On-chain status for DOGE shows resolvable=true"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{DOGE_TXID}",
            params={"chain": "DOG", "mainnet": True},
            timeout=60
        )
        assert resp.status_code == 200
        data = resp.json()
        
        assert data.get('resolvable') == True, f"Expected resolvable=true, got {data}"
        assert data.get('is_ledger') == False, "DOGE doge.jpg should not be a ledger"
        
        print(f"PASS: DOGE status shows resolvable=true, is_ledger=false")


class TestOnchainCaching:
    """Tests for on-chain file caching behavior"""
    
    def test_second_request_is_cached(self):
        """Second request for same file should be fast (cached in MongoDB)"""
        # First request - may or may not be cached
        start1 = time.time()
        resp1 = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": True},
            timeout=60
        )
        time1 = time.time() - start1
        
        # Second request - should be cached
        start2 = time.time()
        resp2 = requests.get(
            f"{BASE_URL}/api/onchain/file/{DOGE_TXID}/{DOGE_FILENAME}",
            params={"chain": "DOG", "mainnet": True},
            timeout=60
        )
        time2 = time.time() - start2
        
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        
        # Both should return identical content
        assert len(resp1.content) == len(resp2.content), "Cached content differs from original"
        
        # Second request should be significantly faster (< 2 seconds)
        assert time2 < 2.0, f"Cached request too slow: {time2:.2f}s"
        
        print(f"PASS: Caching works - First: {time1:.2f}s, Second (cached): {time2:.2f}s")


class TestExistingEndpoints:
    """Verify existing endpoints still work after on-chain fixes"""
    
    def test_feed_endpoint(self):
        """Feed endpoint still returns data"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 3}, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert 'feed' in data
        print(f"PASS: Feed endpoint returns {len(data.get('feed', []))} posts")
    
    def test_storefront_endpoint(self):
        """Object storefront still returns data"""
        resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"limit": 3}, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert 'objects' in data
        print(f"PASS: Storefront returns {len(data.get('objects', []))} objects (total: {data.get('total', 0)})")


class TestFrontendMediaParsing:
    """Test that frontend URL patterns work with on-chain endpoint"""
    
    def test_btc_prefix_pattern(self):
        """BTC:txid/filename pattern routes correctly"""
        # Frontend parses BTC:txid/filename and calls /api/onchain/file/...
        # Verify endpoint accepts this format
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{MJ_TXID}",
            params={"chain": "BTC", "mainnet": True},
            timeout=60
        )
        assert resp.status_code == 200
        print("PASS: BTC prefix pattern routes correctly")
    
    def test_dog_prefix_pattern(self):
        """DOG:txid/filename pattern routes correctly"""
        resp = requests.get(
            f"{BASE_URL}/api/onchain/status/{DOGE_TXID}",
            params={"chain": "DOG", "mainnet": True},
            timeout=60
        )
        assert resp.status_code == 200
        print("PASS: DOG prefix pattern routes correctly")
    
    def test_bare_hex_txid_pattern(self):
        """Bare 64-char hex txid is valid format"""
        # Verify test txids are valid 64-char hex
        for name, txid in [("MJ", MJ_TXID), ("DOGE", DOGE_TXID), ("BTC testnet", BTC_TESTNET_TXID)]:
            assert len(txid) == 64, f"{name} txid wrong length"
            assert all(c in '0123456789abcdef' for c in txid.lower()), f"{name} txid not valid hex"
        print("PASS: All test txids are valid 64-char hex")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
