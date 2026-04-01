"""
Test URN Check Endpoint - P1 Feature for SUP Protocol
Tests the URN duplication check feature that prevents minting already-claimed URNs on-chain.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestURNCheckEndpoint:
    """Tests for GET /api/urn/check/{urn} endpoint"""
    
    def test_urn_check_taken_profile_deda(self):
        """DEDA is a known profile URN - should return available=false, type=profile"""
        response = requests.get(f"{BASE_URL}/api/urn/check/DEDA", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False, "DEDA should be unavailable"
        assert data["type"] == "profile", "DEDA should be a profile"
        assert data["urn"] == "DEDA"
        assert "claimed_by" in data
        print(f"DEDA claimed by: {data.get('claimed_by')}")
    
    def test_urn_check_taken_profile_embii4u(self):
        """embii4u is a known profile URN - should return available=false"""
        response = requests.get(f"{BASE_URL}/api/urn/check/embii4u", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == False, "embii4u should be unavailable"
        assert data["type"] == "profile", "embii4u should be a profile"
        assert data["urn"] == "embii4u"
        print(f"embii4u claimed by: {data.get('claimed_by')}")
    
    def test_urn_check_available_random_urn(self):
        """Random non-existent URN - should return available=true"""
        import uuid
        random_urn = f"test-urn-nonexistent-{uuid.uuid4().hex[:8]}"
        
        response = requests.get(f"{BASE_URL}/api/urn/check/{random_urn}", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == True, f"{random_urn} should be available"
        assert data["type"] is None, "Type should be None for available URN"
        assert data["claimed_by"] is None, "claimed_by should be None for available URN"
    
    def test_urn_check_nonexistent_xyz123(self):
        """Specific nonexistent URN per test spec"""
        response = requests.get(f"{BASE_URL}/api/urn/check/nonexistent-urn-xyz123", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["available"] == True, "nonexistent-urn-xyz123 should be available"
        assert data["urn"] == "nonexistent-urn-xyz123"
    
    def test_urn_check_is_case_sensitive(self):
        """URN check is CASE-SENSITIVE on-chain - DEDA != deda"""
        response_upper = requests.get(f"{BASE_URL}/api/urn/check/DEDA", params={"network": "btc-testnet"})
        response_lower = requests.get(f"{BASE_URL}/api/urn/check/deda", params={"network": "btc-testnet"})
        
        assert response_upper.status_code == 200
        assert response_lower.status_code == 200
        
        data_upper = response_upper.json()
        data_lower = response_lower.json()
        
        # On-chain URNs are case-sensitive: DEDA is claimed, deda is available
        assert data_upper["available"] == False, "DEDA should be unavailable (claimed)"
        assert data_lower["available"] == True, "deda (lowercase) should be available (different URN)"
        print(f"DEDA (upper) available: {data_upper['available']}")
        print(f"deda (lower) available: {data_lower['available']}")
    
    def test_urn_check_returns_response_structure(self):
        """Verify response structure includes all expected fields"""
        response = requests.get(f"{BASE_URL}/api/urn/check/test-structure", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields exist
        assert "available" in data, "Response must have 'available' field"
        assert "urn" in data, "Response must have 'urn' field"
        assert "claimed_by" in data, "Response must have 'claimed_by' field"
        assert "type" in data, "Response must have 'type' field"


class TestHealthAndBasicEndpoints:
    """Basic health and endpoint checks"""
    
    def test_health_endpoint(self):
        """Health endpoint should be accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
    
    def test_storefront_endpoint(self):
        """Storefront endpoint should return objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert "total" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
