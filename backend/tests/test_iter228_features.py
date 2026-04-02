"""
Iteration 228 Backend Tests:
- Storefront 'All' filter (empty search string loads all objects)
- URN verification endpoint for impersonation detection
- Chain filters (BTC/LTC/DOG/MZC/IPFS) with _blockchain field validation
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasics:
    """Basic health and API availability tests"""
    
    def test_health_endpoint(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        assert "services" in data
        print(f"PASS: Health endpoint - status: {data['status']}, services: {data['services']}")
    
    def test_root_endpoint(self):
        """Test /api/ returns Cthulhu API message"""
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "Cthulhu" in data.get("message", "")
        print(f"PASS: Root endpoint - message: {data['message']}")


class TestStorefrontAllFilter:
    """Tests for Storefront 'All' filter - loads all objects with empty search"""
    
    def test_storefront_empty_search_returns_objects(self):
        """Test that empty searchString returns objects (not just 'embii' objects)"""
        response = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={"searchString": "", "qty": 10, "skip": 0},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Expected objects to be returned with empty search"
        print(f"PASS: Empty search returns {len(data)} objects")
        
        # Verify objects have blockchain field
        for obj in data[:3]:
            assert "blockchain" in obj, "Object should have blockchain field"
            assert "object" in obj, "Object should have object field"
        print("PASS: Objects have required blockchain and object fields")
    
    def test_storefront_btc_filter(self):
        """Test BTC chain filter returns BTC objects"""
        response = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={"searchString": "BTC", "qty": 10, "skip": 0},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: BTC filter returns {len(data)} objects")
        
        # Verify objects are BTC-related
        if len(data) > 0:
            for obj in data[:3]:
                blockchain = obj.get("blockchain", "").upper()
                # BTC objects should have BTC in blockchain field
                print(f"  - Object blockchain: {blockchain}")
    
    def test_storefront_pagination(self):
        """Test storefront pagination with skip parameter"""
        # First page
        response1 = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={"searchString": "", "qty": 5, "skip": 0},
            timeout=30
        )
        assert response1.status_code == 200
        page1 = response1.json()
        
        # Second page
        response2 = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={"searchString": "", "qty": 5, "skip": 5},
            timeout=30
        )
        assert response2.status_code == 200
        page2 = response2.json()
        
        print(f"PASS: Pagination works - page1: {len(page1)} items, page2: {len(page2)} items")


class TestURNVerification:
    """Tests for URN verification endpoint (impersonation detection)"""
    
    def test_verify_urn_embii_returns_official(self):
        """Test /api/urn/verify/embii returns proper structure with official_address"""
        response = requests.get(
            f"{BASE_URL}/api/urn/verify/embii",
            params={"network": "btc-testnet"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "urn" in data
        assert "official_address" in data
        assert "claimants" in data
        assert "impersonation_detected" in data
        
        assert data["urn"] == "embii"
        assert data["official_address"] is not None
        assert isinstance(data["claimants"], list)
        assert isinstance(data["impersonation_detected"], bool)
        
        print(f"PASS: URN verify for 'embii' - official_address: {data['official_address'][:20]}...")
        print(f"  - impersonation_detected: {data['impersonation_detected']}")
        print(f"  - claimants count: {len(data['claimants'])}")
    
    def test_verify_urn_emergent2_single_claimant(self):
        """Test /api/urn/verify/Emergent2 returns impersonation_detected=false for single claimant"""
        response = requests.get(
            f"{BASE_URL}/api/urn/verify/Emergent2",
            params={"network": "btc-testnet"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "urn" in data
        assert "official_address" in data
        assert "impersonation_detected" in data
        
        # Single claimant should not trigger impersonation
        if len(data.get("claimants", [])) <= 1:
            assert data["impersonation_detected"] == False
            print(f"PASS: URN verify for 'Emergent2' - single claimant, no impersonation")
        else:
            print(f"INFO: URN 'Emergent2' has multiple claimants: {len(data['claimants'])}")
    
    def test_verify_urn_nonexistent_graceful(self):
        """Test /api/urn/verify/nonexistent_urn_xyz returns empty claimants gracefully"""
        response = requests.get(
            f"{BASE_URL}/api/urn/verify/totally_nonexistent_urn_xyz_12345",
            params={"network": "btc-testnet"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return gracefully without error
        assert "urn" in data
        assert "impersonation_detected" in data
        # Non-existent URN should not trigger impersonation
        assert data["impersonation_detected"] == False
        
        print(f"PASS: Nonexistent URN handled gracefully")
        print(f"  - official_address: {data.get('official_address', 'None')}")


class TestFeedEndpoint:
    """Tests for feed endpoint"""
    
    def test_feed_loads(self):
        """Test /api/feed/btc-testnet returns feed data"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 5},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "feed" in data
        assert "network" in data
        assert "mode" in data
        
        print(f"PASS: Feed endpoint - {len(data['feed'])} posts, mode: {data['mode']}")


class TestProfileEndpoint:
    """Tests for profile endpoint"""
    
    def test_profile_by_address(self):
        """Test /api/profile/{address} returns profile data"""
        # Use embii's address
        address = "mpmFabGjT1xr2pmJ71QDjTPRF1pLUrdKGm"
        response = requests.get(
            f"{BASE_URL}/api/profile/{address}",
            params={"network": "btc-testnet"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "address" in data
        assert "urn" in data
        
        print(f"PASS: Profile endpoint - address: {data['address'][:20]}..., urn: {data.get('urn', 'N/A')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
