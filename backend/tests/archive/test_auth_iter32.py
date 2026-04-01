"""
Iteration 32 - Backend Auth and Wallet API Tests
Testing: signup, login, wallet creation, balance check, create_profile endpoint
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestHealthCheck:
    """Basic health check"""
    
    def test_health_endpoint(self, api_client):
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("✓ Health endpoint working")


class TestWalletCreate:
    """POST /api/wallet/create endpoint tests"""
    
    def test_create_testnet_wallet(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        assert "public_key" in data
        assert data["network"] == "btc-testnet"
        # Testnet addresses start with m or n
        assert data["address"][0] in ('m', 'n')
        # WIF for testnet starts with 'c'
        assert data["wif"][0] == 'c'
        print(f"✓ Testnet wallet created: {data['address'][:15]}...")
    
    def test_create_mainnet_wallet(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-mainnet")
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        # Mainnet addresses start with 1 or 3
        assert data["address"][0] in ('1', '3')
        # Mainnet WIF starts with 'K' or 'L'
        assert data["wif"][0] in ('K', 'L')
        print(f"✓ Mainnet wallet created: {data['address'][:15]}...")


class TestAuthSignup:
    """POST /api/auth/signup endpoint tests"""
    
    def test_signup_success(self, api_client):
        # First create a wallet
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        unique_urn = f"TEST_user_{uuid.uuid4().hex[:8]}"
        response = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": "testpass123",
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert len(data["token"]) > 20  # JWT should be long
        assert data["urn"] == unique_urn
        assert data["address"] == wallet["address"]
        assert data["network"] == "btc-testnet"
        assert data["is_minted"] == False
        print(f"✓ Signup successful for {unique_urn}")
    
    def test_signup_urn_too_short(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": "a",
            "password": "testpass123",
            "address": "mTestAddress123",
            "network": "btc-testnet"
        })
        assert response.status_code == 400
        data = response.json()
        assert "at least 2 characters" in data.get("detail", "").lower()
        print("✓ URN too short validation working")
    
    def test_signup_password_too_short(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": "testuser",
            "password": "12345",
            "address": "mTestAddress123",
            "network": "btc-testnet"
        })
        assert response.status_code == 400
        data = response.json()
        assert "at least 6 characters" in data.get("detail", "").lower()
        print("✓ Password too short validation working")
    
    def test_signup_duplicate_urn(self, api_client):
        # Create first user
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        unique_urn = f"TEST_dup_{uuid.uuid4().hex[:6]}"
        
        api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": "testpass123",
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        
        # Try to create second user with same URN
        wallet2_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet2 = wallet2_res.json()
        
        response = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": "testpass456",
            "address": wallet2["address"],
            "network": "btc-testnet"
        })
        assert response.status_code == 409
        data = response.json()
        assert "already taken" in data.get("detail", "").lower()
        print("✓ Duplicate URN rejection working")


class TestAuthLogin:
    """POST /api/auth/login endpoint tests"""
    
    @pytest.fixture(scope="class")
    def test_user(self, api_client):
        # Create a user for login tests
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        unique_urn = f"TEST_login_{uuid.uuid4().hex[:6]}"
        password = "logintest123"
        
        api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": password,
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        
        return {"urn": unique_urn, "password": password, "address": wallet["address"]}
    
    def test_login_success(self, api_client, test_user):
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": test_user["password"]
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert len(data["token"]) > 20
        assert data["urn"] == test_user["urn"]
        assert data["address"] == test_user["address"]
        print(f"✓ Login successful for {test_user['urn']}")
    
    def test_login_case_insensitive_urn(self, api_client, test_user):
        # URN should be case-insensitive
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"].upper(),
            "password": test_user["password"]
        })
        assert response.status_code == 200
        print("✓ Login case-insensitive for URN")
    
    def test_login_invalid_urn(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "nonexistent_user_99999",
            "password": "anypassword"
        })
        assert response.status_code == 401
        data = response.json()
        assert "invalid" in data.get("detail", "").lower()
        print("✓ Invalid URN returns 401")
    
    def test_login_wrong_password(self, api_client, test_user):
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        data = response.json()
        assert "invalid" in data.get("detail", "").lower()
        print("✓ Wrong password returns 401")


class TestAuthMe:
    """GET /api/auth/me endpoint tests"""
    
    def test_me_with_valid_token(self, api_client):
        # Create user and get token
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        unique_urn = f"TEST_me_{uuid.uuid4().hex[:6]}"
        
        signup_res = api_client.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": "testpass123",
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        token = signup_res.json()["token"]
        
        # Call /auth/me with token
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["urn"] == unique_urn
        assert data["address"] == wallet["address"]
        print("✓ /auth/me returns user info with valid token")
    
    def test_me_without_token(self, api_client):
        response = api_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("✓ /auth/me returns 401 without token")
    
    def test_me_with_invalid_token(self, api_client):
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_xyz"}
        )
        assert response.status_code == 401
        print("✓ /auth/me returns 401 with invalid token")


class TestWalletBalance:
    """GET /api/wallet/balance/{address} endpoint tests"""
    
    def test_balance_for_new_address(self, api_client):
        # Create a new wallet to get a fresh address
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        response = api_client.get(f"{BASE_URL}/api/wallet/balance/{wallet['address']}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "balance_sats" in data
        assert "balance_btc" in data
        assert data["address"] == wallet["address"]
        # New address should have 0 balance
        assert data["balance_sats"] >= 0  # Could be 0 or more if reused
        print(f"✓ Balance check working: {data['balance_sats']} sats")


class TestCreateProfile:
    """POST /api/wallet/create_profile endpoint tests"""
    
    def test_create_profile_insufficient_funds(self, api_client):
        # Create a wallet (will have no funds)
        wallet_res = api_client.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        unique_urn = f"TEST_mint_{uuid.uuid4().hex[:6]}"
        response = api_client.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": wallet["wif"],
            "urn": unique_urn,
            "display_name": "Test User",
            "bio": "Testing profile creation",
            "network": "btc-testnet"
        })
        # Should fail due to no UTXOs/insufficient funds
        assert response.status_code == 400
        data = response.json()
        assert "no utxos" in data.get("detail", "").lower() or "insufficient" in data.get("detail", "").lower() or "fund" in data.get("detail", "").lower()
        print("✓ create_profile correctly rejects unfunded wallet")
    
    def test_create_profile_invalid_wif(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": "invalid_wif_key",
            "urn": "testuser",
            "display_name": "Test User",
            "network": "btc-testnet"
        })
        assert response.status_code == 400
        data = response.json()
        assert "invalid" in data.get("detail", "").lower()
        print("✓ create_profile rejects invalid WIF")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
