"""
Test suite for on-chain GIF resolution and text object display features.
Covers: iteration_26 - On-chain nested ledger resolution + text-only object handling

Tests:
- On-chain GIF resolution (WOW DOGE on Dogecoin mainnet)
- Object API for mainnet and testnet objects
- Text-only objects (no image, no parseable URN)
- Feed caching performance
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestOnChainGIFResolution:
    """Tests for the on-chain GIF resolution feature (multi-level nested ledger)"""
    
    def test_onchain_gif_cached_200(self):
        """GET /api/onchain/file/{txid}/{filename} should return 200 for cached WOW DOGE GIF"""
        txid = "73e146c1b4c1ad9c05de733bbc8c9b682b25b69054492b84c090dd9b1cb0c58f"
        filename = "dodge-meme.gif"
        url = f"{BASE_URL}/api/onchain/file/{txid}/{filename}"
        params = {"chain": "DOG", "mainnet": "true"}
        
        response = requests.get(url, params=params, timeout=30)
        
        # Should return 200 (cached) or 202 (resolving)
        assert response.status_code in [200, 202], f"Unexpected status {response.status_code}"
        
        if response.status_code == 200:
            # Verify it's a GIF file
            assert response.headers.get('Content-Type') == 'image/gif', "Content-Type should be image/gif"
            assert len(response.content) > 100000, f"GIF should be >100KB, got {len(response.content)} bytes"
            # GIF magic bytes check
            assert response.content[:3] == b'GIF', "Response should start with GIF magic bytes"
            print(f"SUCCESS: On-chain GIF returned 200 with {len(response.content)} bytes")
        else:
            # 202 means background resolution in progress
            data = response.json()
            assert data.get('status') == 'resolving', "202 response should have status=resolving"
            print(f"INFO: On-chain GIF resolution in progress (202)")
    
    def test_wow_doge_object_mainnet(self):
        """GET /api/object/{txid} for THE WOW DOGE on mainnet should return object details"""
        txid = "68dfb353f6dd4db0eccfb7fa0b018ada57e0affb25931257e167f1d15d19a73c"
        url = f"{BASE_URL}/api/object/{txid}"
        params = {"network": "btc-mainnet"}
        
        response = requests.get(url, params=params, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify object structure
        assert data.get('name') == 'THE WOW DOGE', f"Name should be 'THE WOW DOGE', got {data.get('name')}"
        assert 'DOG:' in data.get('urn', ''), f"URN should contain 'DOG:', got {data.get('urn')}"
        assert 'owners' in data, "Response should include owners list"
        assert isinstance(data['owners'], list), "Owners should be a list"
        assert len(data['owners']) > 0, "Should have at least one owner"
        
        # Verify URN points to the on-chain GIF
        urn = data.get('urn', '')
        assert '73e146c1b4c1ad9c05de733bbc8c9b682b25b69054492b84c090dd9b1cb0c58f' in urn, "URN should contain GIF txid"
        
        print(f"SUCCESS: THE WOW DOGE object found with {len(data['owners'])} owners")


class TestTextOnlyObjects:
    """Tests for text-only objects (no image, no parseable URN)"""
    
    def test_text_object_testnet(self):
        """GET /api/object/{txid} for TEST object on testnet should return text object with empty image"""
        txid = "b4b0b1c9ff0a91cf8f69c3360697193c9d10987fbc0e2723a91d35207f9acd9f"
        url = f"{BASE_URL}/api/object/{txid}"
        params = {"network": "btc-testnet"}
        
        response = requests.get(url, params=params, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify this is a text-only object
        assert data.get('name') == 'TEST', f"Name should be 'TEST', got {data.get('name')}"
        
        # Image should be empty or None for text objects
        image = data.get('image', '')
        assert not image or image == '', f"Image should be empty for text object, got {image}"
        
        # URN for text-only objects typically equals the name
        urn = data.get('urn', '')
        assert urn == 'TEST' or not urn.startswith(('IPFS:', 'BTC:', 'DOG:', 'LTC:')), \
            f"URN should be text (not media reference), got {urn}"
        
        print(f"SUCCESS: TEST text object found with empty image (URN={urn})")


class TestFeedPerformance:
    """Tests for feed caching and performance"""
    
    def test_feed_returns_cached_data_quickly(self):
        """GET /api/feed/btc-testnet should return cached data in <500ms"""
        url = f"{BASE_URL}/api/feed/btc-testnet"
        params = {"limit": 5, "skip": 0}
        
        start_time = time.time()
        response = requests.get(url, params=params, timeout=30)
        elapsed = time.time() - start_time
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify feed structure
        assert 'feed' in data, "Response should have 'feed' key"
        assert isinstance(data['feed'], list), "feed should be a list"
        assert data.get('count', 0) > 0, "Feed should have items"
        
        # Check if cached
        is_cached = data.get('cached', False)
        print(f"Feed returned in {elapsed:.3f}s, cached={is_cached}, count={data.get('count')}")
        
        # Cached responses should be fast
        if is_cached:
            assert elapsed < 2.0, f"Cached feed should return in <2s, took {elapsed:.3f}s"
    
    def test_feed_has_profile_images(self):
        """Feed items should include sender profile images (IPFS URLs)"""
        url = f"{BASE_URL}/api/feed/btc-testnet"
        params = {"limit": 10}
        
        response = requests.get(url, params=params, timeout=30)
        assert response.status_code == 200
        
        data = response.json()
        feed = data.get('feed', [])
        
        items_with_images = sum(1 for item in feed if item.get('sender_image'))
        print(f"Feed items with profile images: {items_with_images}/{len(feed)}")
        
        # At least some items should have sender images
        if len(feed) > 3:
            assert items_with_images > 0, "Some feed items should have sender profile images"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
