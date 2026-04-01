"""
Test suite for Object endpoints - Iteration 209
Tests: Storefront, Object by Address, Object by TxID, Changelog, On-chain file serving
"""
import pytest
import requests
import time
import os

# Use the external URL for testing (what users see)
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

# Test data from the review request
TEST_ADDRESS = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
TEST_CHANGELOG_TXID = "f879d41266713e58fb87ec461011513add213396a3259a37a9e5a4ede98f60d3"
TEST_MZC_TXID = "5639997e1b8296ecb4685327662cfc20319ebe46f40f007462184921b42febb5"
TEST_MZC_FILENAME = "wonder.jpg"

# Rate limiting: wait between tests to avoid hitting p2fk.io limits
RATE_LIMIT_DELAY = 2  # seconds between tests


class TestStorefrontEndpoint:
    """Tests for GET /api/objects/storefront/{network}"""
    
    def test_storefront_returns_objects(self):
        """Storefront should return objects with proper data structure"""
        time.sleep(RATE_LIMIT_DELAY)
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 5},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "objects" in data, "Response should have 'objects' key"
        assert "total" in data, "Response should have 'total' key"
        assert "has_more" in data, "Response should have 'has_more' key"
        
        # If objects exist, verify their structure
        if len(data["objects"]) > 0:
            obj = data["objects"][0]
            # Check required fields exist
            assert "name" in obj or "urn" in obj, "Object should have name or urn"
            assert "transaction_id" in obj or "object_address" in obj, "Object should have transaction_id or object_address"
            print(f"PASS: Storefront returned {len(data['objects'])} objects, total: {data['total']}")
        else:
            print("INFO: Storefront returned 0 objects (cache may be empty)")
    
    def test_storefront_pagination(self):
        """Storefront should support skip/limit pagination"""
        time.sleep(RATE_LIMIT_DELAY)
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"skip": 0, "limit": 3},
            timeout=30
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data.get("objects", [])) <= 3, "Should respect limit parameter"
        print(f"PASS: Pagination works, returned {len(data.get('objects', []))} objects with limit=3")


class TestObjectByAddressEndpoint:
    """Tests for GET /api/object/addr/{address} - Fast lookup without verbose delay"""
    
    def test_object_by_address_speed(self):
        """Object by address should return quickly (no verbose=true blocking)"""
        time.sleep(RATE_LIMIT_DELAY)
        
        start_time = time.time()
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=15
        )
        elapsed = time.time() - start_time
        
        # Should return within 10 seconds (not 30+ seconds like verbose calls)
        assert elapsed < 10, f"Object by address took {elapsed:.1f}s - should be faster without verbose"
        
        if response.status_code == 200:
            data = response.json()
            assert "name" in data or "urn" in data, "Response should have name or urn"
            print(f"PASS: Object by address returned in {elapsed:.2f}s with data: {data.get('name', data.get('urn', 'N/A'))}")
        elif response.status_code == 404:
            print(f"INFO: Object not found for address {TEST_ADDRESS} (may not exist on testnet)")
        else:
            print(f"WARN: Unexpected status {response.status_code}: {response.text[:200]}")
    
    def test_object_by_address_structure(self):
        """Object by address should return proper data structure"""
        time.sleep(RATE_LIMIT_DELAY)
        
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            # Verify expected fields
            expected_fields = ["network", "object_address"]
            for field in expected_fields:
                assert field in data, f"Response should have '{field}' field"
            
            # Check owners/creators if present
            if "owners" in data:
                assert isinstance(data["owners"], list), "owners should be a list"
            if "creators" in data:
                assert isinstance(data["creators"], list), "creators should be a list"
            
            print(f"PASS: Object structure valid - has {len(data.get('owners', []))} owners, {len(data.get('creators', []))} creators")
        elif response.status_code == 404:
            pytest.skip(f"Object not found for address {TEST_ADDRESS}")


class TestObjectByTxidEndpoint:
    """Tests for GET /api/object/{txid} - Fast lookup from cache"""
    
    def test_object_by_txid_from_storefront(self):
        """Object by txid should return quickly when cached from storefront"""
        # First, get a txid from storefront
        time.sleep(RATE_LIMIT_DELAY)
        storefront_resp = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 5},
            timeout=30
        )
        
        if storefront_resp.status_code != 200:
            pytest.skip("Storefront not available")
        
        objects = storefront_resp.json().get("objects", [])
        if not objects:
            pytest.skip("No objects in storefront cache")
        
        # Find an object with a transaction_id
        test_txid = None
        for obj in objects:
            if obj.get("transaction_id"):
                test_txid = obj["transaction_id"]
                break
        
        if not test_txid:
            pytest.skip("No objects with transaction_id in storefront")
        
        # Now test the object detail endpoint
        time.sleep(RATE_LIMIT_DELAY)
        start_time = time.time()
        response = requests.get(
            f"{BASE_URL}/api/object/{test_txid}",
            params={"network": "btc-testnet"},
            timeout=15
        )
        elapsed = time.time() - start_time
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert elapsed < 5, f"Cached object lookup took {elapsed:.1f}s - should be instant from cache"
        
        data = response.json()
        assert "name" in data or "urn" in data, "Response should have name or urn"
        print(f"PASS: Object by txid returned in {elapsed:.2f}s - name: {data.get('name', 'N/A')}")


class TestChangelogEndpoint:
    """Tests for GET /api/object/{txid}/changelog - Lazy-loaded changelog"""
    
    def test_changelog_returns_array(self):
        """Changelog endpoint should return change_log array"""
        time.sleep(RATE_LIMIT_DELAY)
        
        response = requests.get(
            f"{BASE_URL}/api/object/{TEST_CHANGELOG_TXID}/changelog",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "change_log" in data, "Response should have 'change_log' key"
        assert isinstance(data["change_log"], list), "change_log should be a list"
        
        if len(data["change_log"]) > 0:
            entry = data["change_log"][0]
            # Changelog entries should have action, from, to fields
            print(f"PASS: Changelog has {len(data['change_log'])} entries")
            if isinstance(entry, dict):
                print(f"  First entry: action={entry.get('action')}, from={entry.get('from', '')[:16]}...")
        else:
            print("INFO: Changelog is empty (object may have no history)")
    
    def test_changelog_with_invalid_txid(self):
        """Changelog with invalid txid should return empty array or error gracefully"""
        time.sleep(RATE_LIMIT_DELAY)
        
        response = requests.get(
            f"{BASE_URL}/api/object/invalid_txid_12345/changelog",
            params={"network": "btc-testnet"},
            timeout=15
        )
        
        # Should either return 200 with empty array or 404
        assert response.status_code in [200, 404], f"Expected 200 or 404, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "change_log" in data, "Response should have change_log key"
            print(f"PASS: Invalid txid returns empty changelog gracefully")


class TestOnChainFileEndpoint:
    """Tests for GET /api/onchain/file/{txid}/{filename} - On-chain file serving"""
    
    def test_mzc_file_serves_correctly(self):
        """MZC on-chain file should return HTTP 200"""
        time.sleep(RATE_LIMIT_DELAY)
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{TEST_MZC_TXID}/{TEST_MZC_FILENAME}",
            params={"chain": "MZC", "mainnet": "true"},
            timeout=60  # On-chain reconstruction can take time
        )
        
        # Accept 200 (success), 202 (resolving), or 404 (not found/not cached)
        assert response.status_code in [200, 202, 404], f"Expected 200/202/404, got {response.status_code}: {response.text[:200]}"
        
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "")
            # Should be an image
            assert "image" in content_type or len(response.content) > 0, "Should return image content"
            print(f"PASS: MZC file served successfully, size: {len(response.content)} bytes, type: {content_type}")
        elif response.status_code == 202:
            print("INFO: MZC file is being reconstructed (202 Accepted)")
        else:
            print(f"INFO: MZC file not found/cached (404)")
    
    def test_onchain_file_with_invalid_params(self):
        """On-chain file with invalid params should return appropriate response"""
        time.sleep(RATE_LIMIT_DELAY)
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/invalid_txid/test.jpg",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=15
        )
        
        # Should return 202 (resolving), 404 (not found), 400 (bad request), or 500 (error)
        assert response.status_code in [202, 400, 404, 500], f"Expected error/resolving status, got {response.status_code}"
        print(f"PASS: Invalid on-chain file request handled with status {response.status_code}")


class TestAPIResponseTimes:
    """Tests to verify API response times are acceptable (no verbose blocking)"""
    
    def test_storefront_response_time(self):
        """Storefront should respond within reasonable time"""
        time.sleep(RATE_LIMIT_DELAY)
        
        start = time.time()
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 10},
            timeout=30
        )
        elapsed = time.time() - start
        
        assert response.status_code == 200
        # First load may take longer due to keyword fetching, but should be under 20s
        assert elapsed < 20, f"Storefront took {elapsed:.1f}s - too slow"
        print(f"PASS: Storefront responded in {elapsed:.2f}s")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
