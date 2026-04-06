"""
Test suite for Storefront 'All' filter fix - Iteration 243
Tests the new /api/objects/by-chain/{chain} endpoint that fixes the 'All' filter
showing only ~37 objects instead of hundreds.

Key fix: All filters (including 'All') now use GET /api/objects/by-chain/{chain} endpoint.
When chain=ALL, it fetches all objects from p2fk.io via direct HTTP call, deduplicates,
caches for 10 mins, and paginates server-side.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')
NETWORK = 'btc-testnet'


class TestStorefrontChainFilter:
    """Tests for the /api/objects/by-chain/{chain} endpoint"""

    def test_all_chain_returns_many_objects(self):
        """Test 1: GET /api/objects/by-chain/ALL returns ~425 total objects with has_more=true"""
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "objects" in data, "Response should contain 'objects' key"
        assert "total" in data, "Response should contain 'total' key"
        assert "has_more" in data, "Response should contain 'has_more' key"
        
        # Verify we get many objects (the fix should return ~425, not ~37)
        total = data.get("total", 0)
        assert total >= 400, f"Expected at least 400 total objects, got {total}"
        
        # Verify pagination works
        objects_count = len(data.get("objects", []))
        assert objects_count == 40, f"Expected 40 objects in page, got {objects_count}"
        assert data.get("has_more") == True, "has_more should be True for first page"
        
        print(f"✓ ALL chain: total={total}, page_size={objects_count}, has_more={data.get('has_more')}")

    def test_all_chain_page_2(self):
        """Test 2: GET /api/objects/by-chain/ALL page 2 returns different objects"""
        # Get page 1
        response1 = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        assert response1.status_code == 200
        page1_data = response1.json()
        
        # Get page 2
        response2 = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 40},
            timeout=60
        )
        assert response2.status_code == 200
        page2_data = response2.json()
        
        # Verify page 2 has objects
        page2_objects = page2_data.get("objects", [])
        assert len(page2_objects) > 0, "Page 2 should have objects"
        
        # Verify page 2 has different objects than page 1
        page1_txids = set()
        for obj in page1_data.get("objects", []):
            inner = obj.get("object", obj)
            txid = inner.get("TransactionId") or inner.get("transaction_id")
            if txid:
                page1_txids.add(txid)
        
        page2_txids = set()
        for obj in page2_objects:
            inner = obj.get("object", obj)
            txid = inner.get("TransactionId") or inner.get("transaction_id")
            if txid:
                page2_txids.add(txid)
        
        # Pages should have different objects
        overlap = page1_txids & page2_txids
        assert len(overlap) == 0, f"Page 1 and 2 should have different objects, found {len(overlap)} overlapping"
        
        print(f"✓ Page 2: {len(page2_objects)} objects, no overlap with page 1")

    def test_mzc_chain_filter(self):
        """Test 3: GET /api/objects/by-chain/MZC returns ~54 MZC objects"""
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/MZC",
            params={"network": NETWORK, "qty": 100, "skip": 0},
            timeout=60
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        total = data.get("total", 0)
        objects = data.get("objects", [])
        
        # MZC should have around 54 objects
        assert total >= 50, f"Expected at least 50 MZC objects, got {total}"
        assert len(objects) >= 50, f"Expected at least 50 objects in response, got {len(objects)}"
        
        # Verify objects have MZC chain prefix in URN/URI/Image
        mzc_count = 0
        for obj in objects[:10]:  # Check first 10
            inner = obj.get("object", obj)
            urn = inner.get("URN") or inner.get("urn") or ""
            uri = inner.get("URI") or inner.get("uri") or ""
            image = inner.get("Image") or inner.get("image") or ""
            
            has_mzc = any("MZC:" in str(f).upper() for f in [urn, uri, image])
            if has_mzc:
                mzc_count += 1
        
        assert mzc_count > 0, "At least some objects should have MZC prefix"
        print(f"✓ MZC chain: total={total}, verified {mzc_count}/10 have MZC prefix")

    def test_dog_chain_filter(self):
        """Test 4: GET /api/objects/by-chain/DOG returns ~11 DOG objects"""
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/DOG",
            params={"network": NETWORK, "qty": 100, "skip": 0},
            timeout=60
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        total = data.get("total", 0)
        objects = data.get("objects", [])
        
        # DOG should have around 11 objects
        assert total >= 10, f"Expected at least 10 DOG objects, got {total}"
        assert len(objects) >= 10, f"Expected at least 10 objects in response, got {len(objects)}"
        
        # Verify objects have DOG/DOGE chain prefix
        dog_count = 0
        for obj in objects[:10]:
            inner = obj.get("object", obj)
            urn = inner.get("URN") or inner.get("urn") or ""
            uri = inner.get("URI") or inner.get("uri") or ""
            image = inner.get("Image") or inner.get("image") or ""
            
            has_dog = any(("DOG:" in str(f).upper() or "DOGE:" in str(f).upper()) for f in [urn, uri, image])
            if has_dog:
                dog_count += 1
        
        assert dog_count > 0, "At least some objects should have DOG/DOGE prefix"
        print(f"✓ DOG chain: total={total}, verified {dog_count}/10 have DOG prefix")

    def test_invalid_chain_returns_empty(self):
        """Test that invalid chain returns empty result"""
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/INVALID",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("total", 0) == 0, "Invalid chain should return 0 total"
        assert len(data.get("objects", [])) == 0, "Invalid chain should return empty objects"
        print("✓ Invalid chain returns empty result")

    def test_pagination_consistency(self):
        """Test that pagination is consistent (total stays same across pages)"""
        # Get page 1
        response1 = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        total1 = response1.json().get("total", 0)
        
        # Get page 3
        response3 = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 80},
            timeout=60
        )
        total3 = response3.json().get("total", 0)
        
        # Totals should be the same (cached data)
        assert total1 == total3, f"Total should be consistent: page1={total1}, page3={total3}"
        print(f"✓ Pagination consistent: total={total1} across pages")

    def test_response_structure(self):
        """Test that response has correct structure for frontend consumption"""
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 10, "skip": 0},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        
        # Check required fields
        required_fields = ["objects", "chain", "total", "skip", "qty", "has_more"]
        for field in required_fields:
            assert field in data, f"Response missing required field: {field}"
        
        # Check object structure
        if data["objects"]:
            obj = data["objects"][0]
            # Objects can be wrapped in {object: {...}, blockchain: "..."} format
            inner = obj.get("object", obj)
            
            # Should have basic object fields
            has_name = "Name" in inner or "name" in inner
            has_txid = "TransactionId" in inner or "transaction_id" in inner
            assert has_name or has_txid, "Object should have Name or TransactionId"
        
        print(f"✓ Response structure valid: {required_fields}")


class TestStorefrontCaching:
    """Tests for the 10-minute caching behavior"""

    def test_cached_response_is_fast(self):
        """Test that cached responses are fast (< 1 second)"""
        import time
        
        # First request (may be slow if cache miss)
        requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        
        # Second request should be cached and fast
        start = time.time()
        response = requests.get(
            f"{BASE_URL}/api/objects/by-chain/ALL",
            params={"network": NETWORK, "qty": 40, "skip": 0},
            timeout=60
        )
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < 2.0, f"Cached response should be fast, took {elapsed:.2f}s"
        print(f"✓ Cached response time: {elapsed:.3f}s")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
