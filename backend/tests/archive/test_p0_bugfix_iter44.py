"""
Backend API tests for P0 Bug Fix iteration 44.
Tests regression for homepage, auth, settings, and setup pages.

P0 Fix context: p2fk.js and txBuilder.js were modified to fix profile minting signature verification.
- p2fk.js: sender address removed from addresses array in all 6 build functions
- txBuilder.js: sender always added as last output with change value
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealthCheck:
    """Health and root endpoint tests"""
    
    def test_api_root(self):
        """Verify API root returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert data["message"] == "Cthulhu API"
        assert "version" in data
        print(f"✓ API root: {data}")
    
    def test_health_endpoint(self):
        """Verify health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"✓ Health check: {data}")


class TestAuthEndpoints:
    """Authentication endpoint tests"""
    
    def test_signup_creates_user(self):
        """Verify signup creates a new user and returns token"""
        import time
        test_urn = f"test_iter44_{int(time.time())}"
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "testpass123",
            "address": "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["urn"] == test_urn
        assert data["address"] == "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        assert data["network"] == "btc-testnet"
        assert data["is_minted"] == False
        print(f"✓ Signup created user: {test_urn}")
        return test_urn, data["token"]
    
    def test_signup_duplicate_urn_fails(self):
        """Verify duplicate URN signup returns 409"""
        # First create a user
        import time
        test_urn = f"test_dup_{int(time.time())}"
        response1 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "testpass123",
            "address": "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        })
        assert response1.status_code == 200
        
        # Try creating again with same URN
        response2 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "differentpass",
            "address": "n1JqMuBrWdMfhNhkzaLPX8cJRjvhw1wN8e"
        })
        assert response2.status_code == 409
        print(f"✓ Duplicate URN correctly rejected")
    
    def test_login_with_valid_credentials(self):
        """Verify login works with correct password"""
        import time
        test_urn = f"test_login_{int(time.time())}"
        # Create user first
        requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "logintest123",
            "address": "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        })
        
        # Now login
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_urn,
            "password": "logintest123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["urn"] == test_urn
        print(f"✓ Login successful for: {test_urn}")
    
    def test_login_with_invalid_password(self):
        """Verify login fails with wrong password"""
        import time
        test_urn = f"test_wrongpw_{int(time.time())}"
        # Create user
        requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "correctpass123",
            "address": "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        })
        
        # Try login with wrong password
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_urn,
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print(f"✓ Invalid password correctly rejected")
    
    def test_auth_me_with_valid_token(self):
        """Verify /auth/me returns user data with valid token"""
        import time
        test_urn = f"test_me_{int(time.time())}"
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_urn,
            "password": "testpass123",
            "address": "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        })
        token = signup_resp.json()["token"]
        
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["urn"] == test_urn
        print(f"✓ Auth me endpoint returned user data")
    
    def test_auth_me_without_token_fails(self):
        """Verify /auth/me fails without token"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print(f"✓ Auth me correctly rejects unauthenticated requests")


class TestFeedAndDataEndpoints:
    """Feed and data retrieval tests"""
    
    def test_feed_endpoint(self):
        """Verify feed returns posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        # Feed returns data under 'feed' key with count
        assert "feed" in data or "posts" in data or isinstance(data, list)
        print(f"✓ Feed endpoint working - {data.get('count', 'N/A')} posts")
    
    def test_known_users_endpoint(self):
        """Verify known users list"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "users" in data or isinstance(data, list)
        print(f"✓ Known users endpoint working")
    
    def test_profile_endpoint(self):
        """Verify profile lookup"""
        response = requests.get(f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs?network=btc-testnet")
        assert response.status_code == 200
        # Profile may or may not exist, just check endpoint works
        print(f"✓ Profile endpoint working")


class TestWalletEndpoints:
    """Wallet-related endpoint tests (needed for profile setup)"""
    
    def test_wallet_balance(self):
        """Verify wallet balance endpoint"""
        response = requests.get(f"{BASE_URL}/api/wallet/balance/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "balance_sats" in data
        print(f"✓ Wallet balance: {data['balance_sats']} sats")
    
    def test_wallet_utxos(self):
        """Verify UTXOs endpoint"""
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        print(f"✓ UTXOs endpoint working")
    
    def test_wallet_faucets(self):
        """Verify faucets list endpoint"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        assert response.status_code == 200
        data = response.json()
        assert "faucets" in data or isinstance(data, list)
        print(f"✓ Faucets endpoint working")


class TestObjectsEndpoints:
    """Object storefront tests"""
    
    def test_storefront(self):
        """Verify storefront loads objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data or isinstance(data, list)
        print(f"✓ Storefront endpoint working")


class TestSearchEndpoint:
    """Search functionality tests"""
    
    def test_search_posts(self):
        """Verify search endpoint works"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "test",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        print(f"✓ Search endpoint working")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
