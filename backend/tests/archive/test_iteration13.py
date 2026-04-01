"""
Iteration 13 Tests
===================
Tests for:
1. Objects created endpoint now filters by actual creator (14 not 34 for NeptuneMonk)
2. Collection endpoint
3. History endpoint  
4. IPFS upload endpoint
5. Profile detail page tabs
6. FileViewer component
7. Object creation modal with uri field
8. ObjectsPage "For Sale" filter load more
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

# NeptuneMonk's address - should have 14 created objects (filtered by actual creator)
NEPTUNEMONK_ADDRESS = "n1G7h7g7oPLt8cvHwWqUnJfnty4kPsTG7t"

# Test object with URI field
TEST_OBJECT_TXID = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"


class TestCreatedObjectsFilter:
    """Tests for GET /api/objects/created/{address} - now filters by actual creator"""
    
    def test_created_objects_returns_correct_count(self):
        """NeptuneMonk should have 14 created objects, not 34 (filtered by actual creator)"""
        resp = requests.get(f"{BASE_URL}/api/objects/created/{NEPTUNEMONK_ADDRESS}", 
                           params={"network": "btc-testnet", "limit": 50})
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data
        # The main fix: should be 14, not 34
        assert data["total"] == 14, f"Expected 14 created objects, got {data['total']}"
        print(f"✓ Created objects total: {data['total']} (correct)")
    
    def test_created_objects_has_more_pagination(self):
        """Test pagination with has_more flag"""
        resp = requests.get(f"{BASE_URL}/api/objects/created/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_more"] == True  # 14 total, 5 limit = should have more
        assert data["count"] == 5
        print(f"✓ Pagination working: has_more={data['has_more']}, count={data['count']}")


class TestCollectionEndpoint:
    """Tests for GET /api/objects/collection/{address}"""
    
    def test_collection_endpoint_exists(self):
        """Collection endpoint should return 200 and proper structure"""
        resp = requests.get(f"{BASE_URL}/api/objects/collection/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert "objects" in data
        assert "total" in data
        assert "has_more" in data
        print(f"✓ Collection endpoint working: total={data['total']}")
    
    def test_collection_returns_valid_structure(self):
        """Collection items should have proper object structure"""
        resp = requests.get(f"{BASE_URL}/api/objects/collection/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        # Collection might be empty but structure should be valid
        assert isinstance(data["objects"], list)
        if data["objects"]:
            obj = data["objects"][0]
            # Standard object fields
            assert "URN" in obj or "urn" in obj or "Name" in obj or "name" in obj
        print(f"✓ Collection structure valid, {len(data['objects'])} items returned")


class TestHistoryEndpoint:
    """Tests for GET /api/objects/history/{address}"""
    
    def test_history_endpoint_exists(self):
        """History endpoint should return 200 and proper structure"""
        resp = requests.get(f"{BASE_URL}/api/objects/history/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert "history" in data
        assert "total" in data
        assert "has_more" in data
        print(f"✓ History endpoint working: total={data['total']}")
    
    def test_history_returns_valid_items(self):
        """History items should have action, object info, and date fields"""
        resp = requests.get(f"{BASE_URL}/api/objects/history/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 20})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["history"], list)
        if data["history"]:
            item = data["history"][0]
            # Each history item should have these fields
            assert "action" in item
            assert "object_urn" in item or "object_name" in item
            print(f"✓ First history item: {item.get('action')} - {item.get('object_name', item.get('object_urn', 'N/A'))}")
        print(f"✓ History returned {len(data['history'])} items")


class TestIPFSUpload:
    """Tests for POST /api/ipfs/upload"""
    
    def test_ipfs_upload_accepts_file(self):
        """IPFS upload should accept file and return reference"""
        test_content = b"Test file content for IPFS upload"
        files = {"file": ("test.txt", test_content, "text/plain")}
        resp = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] == True
        assert "cid" in data
        assert "ipfs_ref" in data
        assert data["filename"] == "test.txt"
        print(f"✓ IPFS upload successful: cid={data['cid'][:20]}...")
    
    def test_ipfs_upload_returns_btc_ref_fallback(self):
        """Without IPFS keys, should return BTC: reference (local storage)"""
        test_content = b"Another test file"
        files = {"file": ("test2.txt", test_content, "text/plain")}
        resp = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        assert resp.status_code == 200
        data = resp.json()
        # Should have BTC: prefix since no PINATA_JWT/NFT_STORAGE_KEY configured
        ipfs_ref = data.get("ipfs_ref", "")
        assert ipfs_ref.startswith("BTC:") or ipfs_ref.startswith("IPFS:")
        print(f"✓ IPFS ref format: {ipfs_ref[:40]}...")
    
    def test_ipfs_upload_rejects_large_file(self):
        """Files over 10MB should be rejected"""
        # Create content > 10MB (10 * 1024 * 1024 + 1 bytes)
        large_content = b"x" * (10 * 1024 * 1024 + 1)
        files = {"file": ("large.bin", large_content, "application/octet-stream")}
        resp = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        assert resp.status_code == 400
        print("✓ Large file correctly rejected")


class TestObjectDetail:
    """Tests for GET /api/object/{txid} with URI field"""
    
    def test_object_detail_returns_uri(self):
        """Object detail should return uri field when present"""
        resp = requests.get(f"{BASE_URL}/api/object/{TEST_OBJECT_TXID}",
                           params={"network": "btc-testnet"})
        assert resp.status_code == 200
        data = resp.json()
        # Check object has expected fields
        assert "name" in data
        assert data["name"] == "Boom Bap Sick"
        # URI field should be present (can be null for some objects)
        assert "uri" in data
        print(f"✓ Object detail: name={data['name']}, uri={data.get('uri', 'None')}")


class TestStorefrontPagination:
    """Tests for GET /api/objects/storefront/{network} - For Sale filter"""
    
    def test_storefront_returns_listed_count(self):
        """Storefront should return total_listed count for For Sale filter"""
        resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                           params={"limit": 12})
        assert resp.status_code == 200
        data = resp.json()
        assert "total_listed" in data
        assert "total" in data
        assert data["total_listed"] > 0, "Should have some listed objects"
        print(f"✓ Storefront total_listed: {data['total_listed']}, total: {data['total']}")
    
    def test_storefront_has_more_for_pagination(self):
        """Storefront should have has_more flag for load more button"""
        resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                           params={"limit": 12})
        assert resp.status_code == 200
        data = resp.json()
        assert "has_more" in data
        # With 202 total objects and 12 limit, should have more
        if data["total"] > 12:
            assert data["has_more"] == True
        print(f"✓ Storefront has_more: {data['has_more']}")


class TestWalletCreateObjectWithURI:
    """Tests for POST /api/wallet/create_object with uri field"""
    
    def test_create_object_accepts_uri_field(self):
        """Create object should accept uri field in payload"""
        from bit import PrivateKeyTestnet
        key = PrivateKeyTestnet()
        
        resp = requests.post(f"{BASE_URL}/api/wallet/create_object", json={
            "wif": key.to_wif(),
            "urn": "test-uri-object",
            "name": "Test Object with URI",
            "uri": "IPFS:QmTestHash/file.mp3",
            "network": "btc-testnet"
        })
        # Should fail at UTXO check (unfunded wallet) but accept the payload
        # 400 = No UTXOs, 500 = Other error (but URI field accepted since no validation error)
        assert resp.status_code in [400, 500]
        data = resp.json()
        # Not a 422 validation error means the uri field was accepted
        assert resp.status_code != 422
        print(f"✓ Create object accepts uri field (status={resp.status_code})")
    
    def test_create_object_validation_without_urn(self):
        """Create object should return 422 if URN is missing"""
        from bit import PrivateKeyTestnet
        key = PrivateKeyTestnet()
        
        resp = requests.post(f"{BASE_URL}/api/wallet/create_object", json={
            "wif": key.to_wif(),
            "name": "Test Object",
            "network": "btc-testnet"
        })
        # Should fail with validation error (422)
        assert resp.status_code == 422
        print("✓ Create object correctly validates URN is required")


class TestExistingEndpointsRegression:
    """Regression tests for existing endpoints"""
    
    def test_health_endpoint(self):
        """Health check should return healthy"""
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        print("✓ Health endpoint working")
    
    def test_feed_endpoint(self):
        """Feed should return posts"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert "feed" in data
        assert data["total"] > 0
        print(f"✓ Feed endpoint working: {data['total']} total posts")
    
    def test_profile_endpoint(self):
        """Profile endpoint should return profile data"""
        resp = requests.get(f"{BASE_URL}/api/profile/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet"})
        assert resp.status_code == 200
        data = resp.json()
        assert "address" in data or "urn" in data
        print(f"✓ Profile endpoint working: {data.get('urn', data.get('address', 'N/A'))}")
    
    def test_owned_objects_endpoint(self):
        """Owned objects endpoint should work"""
        resp = requests.get(f"{BASE_URL}/api/objects/owned/{NEPTUNEMONK_ADDRESS}",
                           params={"network": "btc-testnet", "limit": 5})
        assert resp.status_code == 200
        data = resp.json()
        assert "objects" in data
        assert "total" in data
        print(f"✓ Owned objects endpoint working: {data['total']} total")
    
    def test_wallet_create(self):
        """Wallet create should generate new keypair"""
        resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        assert resp.status_code == 200
        data = resp.json()
        assert "address" in data
        assert "wif" in data
        print(f"✓ Wallet create working: {data['address'][:20]}...")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
