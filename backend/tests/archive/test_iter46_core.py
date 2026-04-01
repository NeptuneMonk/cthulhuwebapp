"""
Iteration 46 - Core Functionality Tests
Tests core backend APIs after IPFS daemon reinstall
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasicAPIs:
    """Health check and basic API tests"""
    
    def test_health_endpoint(self):
        """GET /api/health returns healthy"""
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "healthy"
        print(f"PASS: /api/health - {data}")
    
    def test_root_endpoint(self):
        """GET /api/ returns version info"""
        resp = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert "Cthulhu" in data["message"]
        print(f"PASS: /api/ - {data}")


class TestAuthAPIs:
    """Authentication endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup unique test identifier"""
        self.test_id = f"test_iter46_{int(time.time())}"
    
    def test_signup_creates_user(self):
        """POST /api/auth/signup creates user"""
        payload = {
            "urn": f"{self.test_id}_signup",
            "password": "testpass123",
            "address": f"tb1q{self.test_id[:20]}test",
            "network": "btc-testnet"
        }
        resp = requests.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data.get("urn") == payload["urn"]
        assert data.get("address") == payload["address"]
        print(f"PASS: /api/auth/signup - Created user {data.get('urn')}")
        return data["token"]
    
    def test_signup_duplicate_returns_409(self):
        """POST /api/auth/signup with duplicate returns 409"""
        urn = f"{self.test_id}_dup"
        payload = {
            "urn": urn,
            "password": "testpass123",
            "address": f"tb1q{self.test_id[:20]}dup",
            "network": "btc-testnet"
        }
        # First signup
        resp1 = requests.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=10)
        assert resp1.status_code == 200
        # Second signup (duplicate)
        resp2 = requests.post(f"{BASE_URL}/api/auth/signup", json=payload, timeout=10)
        assert resp2.status_code == 409
        print(f"PASS: Duplicate signup returns 409")
    
    def test_login_returns_token(self):
        """POST /api/auth/login returns token for valid credentials"""
        urn = f"{self.test_id}_login"
        password = "testpass123"
        # Create user first
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": password,
            "address": f"tb1q{self.test_id[:20]}login",
            "network": "btc-testnet"
        }, timeout=10)
        assert signup_resp.status_code == 200
        
        # Login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": urn,
            "password": password
        }, timeout=10)
        assert login_resp.status_code == 200
        data = login_resp.json()
        assert "token" in data
        assert data.get("urn") == urn
        print(f"PASS: /api/auth/login - Token received for {urn}")
    
    def test_login_invalid_returns_401(self):
        """POST /api/auth/login with invalid credentials returns 401"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "nonexistent_user_12345",
            "password": "wrongpassword"
        }, timeout=10)
        assert resp.status_code == 401
        print(f"PASS: Invalid login returns 401")
    
    def test_auth_me_with_valid_token(self):
        """GET /api/auth/me with valid token returns user data"""
        urn = f"{self.test_id}_me"
        password = "testpass123"
        address = f"tb1q{self.test_id[:20]}me"
        
        # Create user and get token
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": password,
            "address": address,
            "network": "btc-testnet"
        }, timeout=10)
        assert signup_resp.status_code == 200
        token = signup_resp.json().get("token")
        
        # Call /auth/me with token
        me_resp = requests.get(f"{BASE_URL}/api/auth/me", 
            headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert me_resp.status_code == 200
        data = me_resp.json()
        assert data.get("urn") == urn
        assert data.get("address") == address
        print(f"PASS: /api/auth/me - User data: {data.get('urn')}")
    
    def test_auth_me_without_token_returns_401(self):
        """GET /api/auth/me without token returns 401"""
        resp = requests.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert resp.status_code == 401
        print(f"PASS: /api/auth/me without token returns 401")


class TestFeedAPI:
    """Feed endpoint tests"""
    
    def test_feed_returns_messages_array(self):
        """GET /api/feed/btc-testnet returns messages array"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet", timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert "feed" in data
        assert isinstance(data["feed"], list)
        print(f"PASS: /api/feed/btc-testnet - {data.get('count', 0)} messages, total: {data.get('total', 0)}")


class TestWalletAPI:
    """Wallet endpoint tests"""
    
    def test_faucets_returns_list(self):
        """GET /api/wallet/faucets returns faucet list"""
        resp = requests.get(f"{BASE_URL}/api/wallet/faucets", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "faucets" in data
        assert isinstance(data["faucets"], list)
        assert len(data["faucets"]) > 0
        print(f"PASS: /api/wallet/faucets - {len(data['faucets'])} faucets")
    
    def test_balance_returns_balance_object(self):
        """GET /api/wallet/balance/{address} returns balance object"""
        test_addr = "tb1qtest123456789"
        resp = requests.get(f"{BASE_URL}/api/wallet/balance/{test_addr}", timeout=15)
        assert resp.status_code == 200
        data = resp.json()
        assert "address" in data
        assert "balance_sats" in data or "error" in data  # May return error for invalid address but still 200
        print(f"PASS: /api/wallet/balance - Response: {data}")


class TestObjectsAPI:
    """Objects endpoint tests"""
    
    def test_storefront_returns_objects(self):
        """GET /api/objects/storefront/btc-testnet returns objects"""
        resp = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert "objects" in data
        assert isinstance(data["objects"], list)
        print(f"PASS: /api/objects/storefront - {len(data['objects'])} objects, total: {data.get('total', 0)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
