"""
Test cross-chain sidechain data-source filters (DOGE, LTC) on storefront
Iteration 100: Validates bug fix for cross-chain discovery keywords
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known test data from the bug fix context
KNOWN_DOGE_TXID = "73e146c1b4c1ad9c05de733bbc8c9b682b25b69054492b84c090dd9b1cb0c58f"
KNOWN_LTC_TXID = "a1cd166b95cd9960f3e6ad43f743972eee83e60e9b77cf50b5f31100c8f28d50"


class TestCrossChainStorefrontFilters:
    """Tests for DOGE/LTC data-source filters on storefront"""
    
    def test_doge_filter_btc_testnet_returns_objects(self):
        """DOGE data-source filter on storefront returns objects (not zero) on btc-testnet"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", 
                               params={"skip": 0, "limit": 20, "data_source": "DOGE"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert "total" in data
        # Bug fix verification: Should return more than 0 objects with DOGE filter
        assert data["total"] > 0, "DOGE filter should return objects, not zero"
        assert len(data["objects"]) > 0, "DOGE filter objects list should not be empty"
        # Verify objects have DOG: prefix in URN or image
        for obj in data["objects"][:5]:
            urn = obj.get("urn", "") or ""
            image = obj.get("image", "") or ""
            assert "DOG:" in urn.upper() or "DOG:" in image.upper(), f"Object should have DOG: prefix, got urn={urn}, image={image}"
    
    def test_ltc_filter_btc_testnet_returns_objects(self):
        """LTC data-source filter on storefront returns objects (not zero) on btc-testnet"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 20, "data_source": "LTC"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert "total" in data
        # Bug fix verification: Should return more than 0 objects with LTC filter
        assert data["total"] > 0, "LTC filter should return objects, not zero"
        assert len(data["objects"]) > 0, "LTC filter objects list should not be empty"
        # Verify objects have LTC: prefix in URN or image
        for obj in data["objects"][:5]:
            urn = obj.get("urn", "") or ""
            image = obj.get("image", "") or ""
            assert "LTC:" in urn.upper() or "LTC:" in image.upper(), f"Object should have LTC: prefix, got urn={urn}, image={image}"
    
    def test_doge_filter_btc_mainnet_returns_objects(self):
        """DOGE data-source filter on storefront returns objects on btc-mainnet"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet",
                               params={"skip": 0, "limit": 20, "data_source": "DOGE"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "DOGE filter on mainnet should return objects"
    
    def test_ltc_filter_btc_mainnet_returns_objects(self):
        """LTC data-source filter on storefront returns objects on btc-mainnet"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet",
                               params={"skip": 0, "limit": 20, "data_source": "LTC"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "LTC filter on mainnet should return objects"


class TestExistingFiltersStillWork:
    """Verify existing data-source filters still work correctly after the fix"""
    
    def test_btc_filter_still_works(self):
        """BTC data-source filter still works correctly"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 20, "data_source": "BTC"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "BTC filter should return objects"
        # Verify objects have BTC: prefix or raw txid format
        for obj in data["objects"][:3]:
            urn = obj.get("urn", "") or ""
            image = obj.get("image", "") or ""
            combined = (urn + image).upper()
            has_btc_prefix = "BTC:" in combined
            # Also accept raw txid format (64 hex chars at start)
            import re
            has_raw_txid = bool(re.match(r'^[0-9A-F]{64}', urn, re.IGNORECASE))
            assert has_btc_prefix or has_raw_txid, f"BTC object should have BTC: prefix or raw txid"
    
    def test_ipfs_filter_still_works(self):
        """IPFS data-source filter still works correctly"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 20, "data_source": "IPFS"})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "IPFS filter should return objects"
        # IPFS is the default for objects without chain prefix
        # Verify at least some objects have IPFS: prefix
        ipfs_found = False
        for obj in data["objects"][:10]:
            urn = obj.get("urn", "") or ""
            image = obj.get("image", "") or ""
            if "IPFS:" in urn.upper() or "IPFS:" in image.upper():
                ipfs_found = True
                break
        assert ipfs_found, "IPFS filter should return objects with IPFS: prefix"
    
    def test_all_filter_shows_all_objects(self):
        """ALL filter still shows all objects including cross-chain ones"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 100})  # No data_source = ALL
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        all_total = data["total"]
        
        # Get counts for individual filters
        doge_resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                                params={"data_source": "DOGE"})
        ltc_resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"data_source": "LTC"})
        btc_resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"data_source": "BTC"})
        ipfs_resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                                params={"data_source": "IPFS"})
        
        doge_total = doge_resp.json().get("total", 0)
        ltc_total = ltc_resp.json().get("total", 0)
        btc_total = btc_resp.json().get("total", 0)
        ipfs_total = ipfs_resp.json().get("total", 0)
        
        # ALL total should include objects from all chains
        assert all_total >= doge_total, "ALL should include DOGE objects"
        assert all_total >= ltc_total, "ALL should include LTC objects"
        # Note: sum might not equal due to overlap/classification
        print(f"ALL={all_total}, DOGE={doge_total}, LTC={ltc_total}, BTC={btc_total}, IPFS={ipfs_total}")


class TestStorefrontTotalCount:
    """Verify storefront total count increases with cross-chain keywords"""
    
    def test_storefront_has_significant_objects(self):
        """Storefront total count should have more objects now with cross-chain keywords"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        # With keywords ['game', 'art', 'music', 'bitcoin', 'embii', 'nft', 'token', 'photo', 'video', 'sup', 'doge', 'litecoin', 'meme']
        # we should have a good number of objects
        assert data["total"] >= 200, f"Expected at least 200 objects with cross-chain keywords, got {data['total']}"


class TestCrossChainSearch:
    """Test search functionality for cross-chain keywords"""
    
    def test_search_doge_returns_cross_chain_objects(self):
        """Object search for 'doge' returns cross-chain objects"""
        response = requests.get(f"{BASE_URL}/api/objects/search/doge",
                               params={"network": "btc-testnet", "skip": 0, "limit": 20})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "Search for 'doge' should return objects"
        # Verify search results contain DOGE-related objects
        found_doge_related = False
        for obj in data["objects"]:
            name = (obj.get("name", "") or "").lower()
            urn = (obj.get("urn", "") or "").lower()
            description = (obj.get("description", "") or "").lower()
            if "doge" in name or "dog:" in urn or "doge" in description:
                found_doge_related = True
                break
        assert found_doge_related, "Search for 'doge' should find DOGE-related objects"
    
    def test_search_litecoin_returns_cross_chain_objects(self):
        """Object search for 'litecoin' returns cross-chain objects"""
        response = requests.get(f"{BASE_URL}/api/objects/search/litecoin",
                               params={"network": "btc-testnet", "skip": 0, "limit": 20})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert data["total"] > 0, "Search for 'litecoin' should return objects"


class TestOnChainFileResolver:
    """Test on-chain file resolution for DOG and LTC chains"""
    
    def test_onchain_file_dog_chain(self):
        """On-chain file resolution works for DOG chain"""
        # Known DOGE test txid from context
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{KNOWN_DOGE_TXID}/dodge-meme.gif",
            params={"chain": "DOG", "mainnet": "true"}
        )
        # On-chain resolver returns 202 (resolving) first, then 200 on subsequent requests
        assert response.status_code in [200, 202], f"Expected 200 or 202, got {response.status_code}"
        if response.status_code == 200:
            # Verify it's actually a GIF (starts with GIF89a or GIF87a)
            content = response.content
            assert content[:3] == b'GIF', "Should return GIF content"
    
    def test_onchain_file_ltc_chain(self):
        """On-chain file resolution works for LTC chain"""
        # Known LTC test txid from context
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{KNOWN_LTC_TXID}/thumbs_up.png",
            params={"chain": "LTC", "mainnet": "true"}
        )
        # On-chain resolver returns 202 (resolving) first, then 200 on subsequent requests
        assert response.status_code in [200, 202], f"Expected 200 or 202, got {response.status_code}"
        if response.status_code == 200:
            # Verify it's actually a PNG (starts with PNG magic bytes)
            content = response.content
            assert content[:4] == b'\x89PNG', "Should return PNG content"


class TestResponseStructure:
    """Verify response structure includes data_source field"""
    
    def test_storefront_response_includes_data_source(self):
        """Storefront response includes data_source field"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"data_source": "DOGE"})
        assert response.status_code == 200
        data = response.json()
        assert "data_source" in data, "Response should include data_source field"
        assert data["data_source"] == "DOGE", "data_source should match request"
    
    def test_storefront_response_structure(self):
        """Verify complete storefront response structure"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        # Required fields
        assert "objects" in data
        assert "total" in data
        assert "total_listed" in data
        assert "skip" in data
        assert "limit" in data
        assert "has_more" in data
        # Optional fields
        assert "from_cache" in data or True  # May or may not be present


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
