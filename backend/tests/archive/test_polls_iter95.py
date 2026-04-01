"""
Iteration 95: Poll/INQ API Tests
Tests the poll system endpoints that interface with P2FK protocol.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestPollAPIs:
    """Poll/INQ API endpoint tests for iteration 95"""
    
    def test_polls_list_returns_json(self):
        """GET /api/polls/list/{address} should return polls array (even if empty)"""
        response = requests.get(
            f"{BASE_URL}/api/polls/list/test123",
            params={"network": "btc-mainnet"},
            timeout=35
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "polls" in data, "Response should have 'polls' key"
        assert isinstance(data["polls"], list), "'polls' should be a list"
    
    def test_polls_list_testnet(self):
        """GET /api/polls/list/{address} with testnet network"""
        response = requests.get(
            f"{BASE_URL}/api/polls/list/test123",
            params={"network": "btc-testnet"},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        assert "polls" in data
        assert isinstance(data["polls"], list)
    
    def test_polls_by_address_returns_json(self):
        """GET /api/polls/by-address/{address} should return poll or error"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-address/invalid_address",
            params={"network": "btc-testnet"},
            timeout=35
        )
        # Could be 200 with error message or empty response
        assert response.status_code == 200
        data = response.json()
        # Should either have poll data or an error
        assert isinstance(data, dict)
    
    def test_polls_by_txid_returns_json(self):
        """GET /api/polls/by-txid/{txid} should return poll or error"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/0000000000000000000000000000000000000000000000000000000000000000",
            params={"network": "btc-testnet"},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
    
    def test_polls_created_by_returns_json(self):
        """GET /api/polls/created-by/{address} should return polls array"""
        response = requests.get(
            f"{BASE_URL}/api/polls/created-by/test123",
            params={"network": "btc-testnet"},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        assert "polls" in data
        assert isinstance(data["polls"], list)
    
    def test_polls_search_returns_json(self):
        """GET /api/polls/search?q=test should return polls array"""
        response = requests.get(
            f"{BASE_URL}/api/polls/search",
            params={"q": "test", "network": "btc-testnet"},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        assert "polls" in data
        assert isinstance(data["polls"], list)
    
    def test_polls_search_requires_query(self):
        """GET /api/polls/search without q param should return 422"""
        response = requests.get(
            f"{BASE_URL}/api/polls/search",
            params={"network": "btc-testnet"},
            timeout=10
        )
        # FastAPI returns 422 for missing required params
        assert response.status_code == 422


class TestHealthCheck:
    """Basic health check to ensure backend is running"""
    
    def test_health_endpoint(self):
        """GET /api/health should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
