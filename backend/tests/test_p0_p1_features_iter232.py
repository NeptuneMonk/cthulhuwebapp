"""
Test P0 and P1 features for iteration 232:
- P0: Download page, Landing page download button, Auth page beta warning
- P1: Owned subtopics endpoint for cascade transfers
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')


class TestHealthAndBasics:
    """Basic health checks"""
    
    def test_health_endpoint(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed: {data}")


class TestOwnedSubtopicsEndpoint:
    """Test GET /api/rooms/{parent}/owned-subtopics/{owner} endpoint"""
    
    def test_owned_subtopics_returns_valid_structure(self):
        """Verify endpoint returns correct JSON structure"""
        # Use test addresses - endpoint should return empty array for non-existent data
        parent_addr = "test-parent-address"
        owner_addr = "test-owner-address"
        
        response = requests.get(
            f"{BASE_URL}/api/rooms/{parent_addr}/owned-subtopics/{owner_addr}",
            params={"network": "btc-testnet"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "subtopics" in data, "Response should have 'subtopics' key"
        assert "count" in data, "Response should have 'count' key"
        assert isinstance(data["subtopics"], list), "subtopics should be a list"
        assert isinstance(data["count"], int), "count should be an integer"
        assert data["count"] == len(data["subtopics"]), "count should match subtopics length"
        
        print(f"✓ Owned subtopics endpoint returns valid structure: {data}")
    
    def test_owned_subtopics_with_real_address(self):
        """Test with a real-ish address format"""
        # Use a valid-looking Bitcoin testnet address format
        parent_addr = "msBayXP6iCByaHeMteiwmXMbS74x91MmqY"
        owner_addr = "n1testaddress123456789012345678901"
        
        response = requests.get(
            f"{BASE_URL}/api/rooms/{parent_addr}/owned-subtopics/{owner_addr}",
            params={"network": "btc-testnet"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "subtopics" in data
        assert "count" in data
        print(f"✓ Owned subtopics with real address format: count={data['count']}")
    
    def test_owned_subtopics_mainnet_network(self):
        """Test endpoint with mainnet network parameter"""
        response = requests.get(
            f"{BASE_URL}/api/rooms/test-parent/owned-subtopics/test-owner",
            params={"network": "btc-mainnet"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "subtopics" in data
        print(f"✓ Owned subtopics mainnet network: {data}")


class TestRoomTopicsEndpoint:
    """Test GET /api/rooms/{parent}/topics endpoint"""
    
    def test_get_topics_returns_valid_structure(self):
        """Verify topics endpoint returns correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/rooms/test-parent/topics",
            params={"network": "btc-testnet"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "topics" in data
        assert "count" in data
        print(f"✓ Topics endpoint returns valid structure: {data}")


class TestReleasesEndpoint:
    """Test releases endpoint for download page"""
    
    def test_latest_release_endpoint(self):
        """Verify /api/releases/latest returns valid structure"""
        response = requests.get(
            f"{BASE_URL}/api/releases/latest",
            params={"network": "btc-testnet"},
            timeout=10
        )
        
        # Endpoint should return 200 even if no release exists
        assert response.status_code == 200
        data = response.json()
        
        # Should have 'available' key
        assert "available" in data, "Response should have 'available' key"
        
        if data.get("available"):
            # If release exists, verify structure
            assert "version" in data or "name" in data
            print(f"✓ Latest release found: {data.get('name', data.get('version', 'unknown'))}")
        else:
            print(f"✓ No release available (expected for test environment): {data}")


class TestFrontendRoutes:
    """Test that frontend routes are accessible"""
    
    def test_download_page_route(self):
        """Verify /download route is accessible"""
        response = requests.get(f"{BASE_URL}/download", timeout=10)
        # Should return 200 (SPA serves index.html for all routes)
        assert response.status_code == 200
        # Should contain HTML
        assert "<!DOCTYPE html>" in response.text or "<html" in response.text.lower()
        print("✓ /download route accessible")
    
    def test_auth_page_route(self):
        """Verify /auth route is accessible"""
        response = requests.get(f"{BASE_URL}/auth", timeout=10)
        assert response.status_code == 200
        assert "<!DOCTYPE html>" in response.text or "<html" in response.text.lower()
        print("✓ /auth route accessible")
    
    def test_landing_page_route(self):
        """Verify / (landing page) route is accessible"""
        response = requests.get(f"{BASE_URL}/", timeout=10)
        assert response.status_code == 200
        assert "<!DOCTYPE html>" in response.text or "<html" in response.text.lower()
        print("✓ / (landing page) route accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
