"""
Iteration 186: Backend API Tests for Standalone Hardening
Tests: IPFS status, Admin login, Feed endpoint, Health check
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

class TestHealthAndIPFS:
    """Health check and IPFS status tests"""
    
    def test_health_endpoint(self):
        """GET /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"Health check passed: {data}")
    
    def test_ipfs_status_endpoint(self):
        """GET /api/ipfs/status returns online status with correct fields"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Key test: verify 'online' field exists (not 'running' or 'status')
        assert "online" in data, f"Expected 'online' field in response, got: {data}"
        print(f"IPFS status: {data}")
        # If online, should have agent info
        if data.get("online"):
            assert "agent" in data or "peer_id" in data, "Online IPFS should have agent or peer_id"


class TestAdminLogin:
    """Admin authentication tests"""
    
    def test_admin_login_valid_credentials(self):
        """POST /api/admin/login with Admin/Password26 returns token"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"},
            timeout=10
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data, f"Expected token in response, got: {data}"
        assert data.get("username") == "Admin"
        print(f"Admin login successful: token={data['token'][:20]}...")
    
    def test_admin_login_invalid_credentials(self):
        """POST /api/admin/login with wrong password returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "WrongPassword"},
            timeout=10
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestFeedEndpoint:
    """Feed endpoint tests"""
    
    def test_feed_returns_posts(self):
        """GET /api/feed/btc-testnet returns feed with posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=5", timeout=15)
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data, f"Expected 'feed' in response, got: {data.keys()}"
        assert isinstance(data["feed"], list)
        print(f"Feed returned {len(data['feed'])} posts, total: {data.get('total', 'N/A')}")


class TestKnownUsersEndpoint:
    """Known users endpoint tests"""
    
    def test_known_users_returns_list(self):
        """GET /api/known-users/btc-testnet returns users list"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Should return a list or object with users
        assert isinstance(data, (list, dict)), f"Expected list or dict, got: {type(data)}"
        print(f"Known users response type: {type(data)}")


class TestTreasuryEndpoint:
    """Treasury info endpoint tests"""
    
    def test_treasury_info(self):
        """GET /api/treasury/info returns treasury data"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Should have address and tax_rate fields
        assert "tax_rate" in data or "address" in data, f"Expected treasury fields, got: {data}"
        print(f"Treasury info: {data}")


class TestPaywallEndpoint:
    """Paywall status endpoint tests"""
    
    def test_paywall_status(self):
        """GET /api/paywall/status/{urn} returns paywall status"""
        response = requests.get(f"{BASE_URL}/api/paywall/status/testuser", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Should have paid or status field
        assert "paid" in data or "status" in data, f"Expected paywall fields, got: {data}"
        print(f"Paywall status: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
