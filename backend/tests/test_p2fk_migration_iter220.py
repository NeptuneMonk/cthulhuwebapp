"""
Test P2FK Migration - Iteration 220
Tests the migration from p2fk.io as primary to backend as primary with p2fk.io as fallback.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

class TestP2FKLocalDecoder:
    """Test P2FK local decoder endpoints still work after migration"""
    
    def test_root_by_txid(self):
        """GET /api/p2fk-local/root/{txid} - decode single P2FK transaction"""
        txid = "00b06bf60897cefdfe2b7237d2510b72c700609833eccff8dabefc75ee29e0c8"
        response = requests.get(f"{BASE_URL}/api/p2fk-local/root/{txid}?network=btc-testnet", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "TransactionId" in data or "error" not in data, "Should return valid root data"
        assert data.get("TransactionId") == txid or "File" in data, "Should contain transaction data"
        print(f"Root decode PASS - TransactionId: {data.get('TransactionId', 'N/A')}")
    
    def test_keyword_to_address(self):
        """GET /api/p2fk-local/keyword/{keyword} - convert keyword to P2FK address"""
        response = requests.get(f"{BASE_URL}/api/p2fk-local/keyword/test?network=btc-testnet", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("keyword") == "test", "Should return keyword"
        assert data.get("address") == "mr8QDF9fSfusDCPeGvsUVi3P3V6RD47uGS", f"Expected address mr8QDF9fSfusDCPeGvsUVi3P3V6RD47uGS, got {data.get('address')}"
        print(f"Keyword to address PASS - {data.get('keyword')} -> {data.get('address')}")
    
    def test_search_roots_by_keyword(self):
        """GET /api/p2fk-local/search?keyword=hello - search roots by keyword"""
        response = requests.get(f"{BASE_URL}/api/p2fk-local/search?keyword=hello&network=btc-testnet", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "roots" in data, "Should return roots array"
        assert "address" in data, "Should return keyword address"
        print(f"Search roots PASS - Found {len(data.get('roots', []))} roots at address {data.get('address')}")


class TestFeedEndpoint:
    """Test feed endpoint still loads correctly"""
    
    def test_feed_loads(self):
        """GET /api/feed/btc-testnet - feed should return posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=5", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "feed" in data, "Should return feed array"
        assert "count" in data, "Should return count"
        assert data.get("count", 0) > 0, "Feed should have posts"
        print(f"Feed PASS - {data.get('count')} posts returned, total: {data.get('total')}")


class TestObjectsEndpoint:
    """Test objects endpoint uses p2fk_get (not direct p2fk.io URLs)"""
    
    def test_object_search(self):
        """GET /api/objects/search/{keyword} - search should work via p2fk_get"""
        response = requests.get(f"{BASE_URL}/api/objects/search/embii?network=btc-testnet&limit=5", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "objects" in data, "Should return objects array"
        print(f"Object search PASS - Found {len(data.get('objects', []))} objects for 'embii'")
    
    def test_storefront(self):
        """GET /api/objects/storefront/{network} - storefront should load"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet?limit=5", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "objects" in data, "Should return objects array"
        print(f"Storefront PASS - {len(data.get('objects', []))} objects, total: {data.get('total')}")


class TestDiscoverEndpoint:
    """Test discover endpoint uses p2fk_get"""
    
    def test_discover_search(self):
        """POST /api/objects/discover - discover should work via p2fk_get"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "embii", "count": 10},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "results" in data, "Should return results array"
        print(f"Discover PASS - Found {len(data.get('results', []))} results for 'embii'")


class TestHealthEndpoint:
    """Test health endpoint"""
    
    def test_health(self):
        """GET /api/health - should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy", "Should be healthy"
        print(f"Health PASS - Status: {data.get('status')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
