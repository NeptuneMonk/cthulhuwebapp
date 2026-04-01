"""
Iteration 31 - Auth System Tests
Tests the client-side login system for Cthulhu blockchain social media platform.
Features tested:
- POST /api/auth/signup - creates user with URN, password, address
- POST /api/auth/login - authenticates and returns JWT
- GET /api/auth/me - returns user info with valid token
- POST /api/wallet/create - generates new testnet wallet
- Password validation (min 6 chars)
- URN validation (min 2 chars)
- Duplicate URN returns 409
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


class TestWalletCreate:
    """Test wallet generation endpoint"""

    def test_create_wallet_returns_200(self):
        """POST /api/wallet/create generates a new testnet wallet"""
        response = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "address" in data, "Response missing 'address'"
        assert "wif" in data, "Response missing 'wif'"
        assert "public_key" in data, "Response missing 'public_key'"
        assert data.get("network") == "btc-testnet"
        
        # Verify testnet address format (starts with m or n)
        address = data["address"]
        assert address[0] in ('m', 'n'), f"Testnet address should start with m or n, got: {address}"
        print(f"✓ Wallet created: {address[:15]}...")

    def test_create_wallet_mainnet(self):
        """POST /api/wallet/create generates a mainnet wallet"""
        response = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-mainnet")
        assert response.status_code == 200
        
        data = response.json()
        address = data["address"]
        # Mainnet addresses start with 1, 3, or bc1
        assert address[0] in ('1', '3') or address.startswith('bc1'), f"Invalid mainnet address: {address}"
        print(f"✓ Mainnet wallet created: {address[:15]}...")


class TestAuthSignup:
    """Test user registration endpoint"""

    def test_signup_success(self):
        """POST /api/auth/signup creates user and returns JWT"""
        # Generate unique URN to avoid conflicts
        unique_urn = f"TEST_user_{uuid.uuid4().hex[:8]}"
        
        # First create a wallet
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_resp.json()
        
        signup_payload = {
            "urn": unique_urn,
            "password": "testpass123",
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data, "Response missing 'token'"
        assert data.get("urn") == unique_urn
        assert data.get("address") == wallet["address"]
        assert data.get("network") == "btc-testnet"
        assert "is_minted" in data
        print(f"✓ Signup successful for {unique_urn}")
        
        # Store for cleanup
        return data

    def test_signup_urn_too_short(self):
        """URN validation: minimum 2 characters"""
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_resp.json()
        
        signup_payload = {
            "urn": "a",  # Only 1 character
            "password": "testpass123",
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_payload)
        assert response.status_code == 400, f"Expected 400 for short URN, got {response.status_code}"
        
        data = response.json()
        assert "at least 2 characters" in data.get("detail", "").lower() or "urn" in data.get("detail", "").lower()
        print("✓ URN validation (too short) works")

    def test_signup_password_too_short(self):
        """Password validation: minimum 6 characters"""
        unique_urn = f"TEST_user_{uuid.uuid4().hex[:8]}"
        
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_resp.json()
        
        signup_payload = {
            "urn": unique_urn,
            "password": "12345",  # Only 5 characters
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_payload)
        assert response.status_code == 400, f"Expected 400 for short password, got {response.status_code}"
        
        data = response.json()
        assert "at least 6 characters" in data.get("detail", "").lower() or "password" in data.get("detail", "").lower()
        print("✓ Password validation (too short) works")

    def test_signup_duplicate_urn_returns_409(self):
        """Duplicate URN returns 409 conflict error"""
        # First check if testuser123 exists (mentioned in context)
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": "testuser123",
            "password": "testpass123",
            "address": "mTestAddress12345678901234567890",
            "network": "btc-testnet"
        })
        
        # If first request succeeds, retry to get 409
        if response.status_code == 200:
            response = requests.post(f"{BASE_URL}/api/auth/signup", json={
                "urn": "testuser123",
                "password": "testpass123",
                "address": "mTestAddress12345678901234567890",
                "network": "btc-testnet"
            })
        
        assert response.status_code == 409, f"Expected 409 for duplicate URN, got {response.status_code}"
        
        data = response.json()
        assert "already taken" in data.get("detail", "").lower() or "exists" in data.get("detail", "").lower()
        print("✓ Duplicate URN returns 409")


class TestAuthLogin:
    """Test user authentication endpoint"""

    @pytest.fixture(scope="class")
    def test_user(self):
        """Create a test user for login tests"""
        unique_urn = f"TEST_login_{uuid.uuid4().hex[:8]}"
        password = "testlogin123"
        
        # Create wallet
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_resp.json()
        
        # Signup
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": password,
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        
        if signup_resp.status_code != 200:
            pytest.skip(f"Failed to create test user: {signup_resp.text}")
        
        return {
            "urn": unique_urn,
            "password": password,
            "address": wallet["address"],
            "token": signup_resp.json().get("token")
        }

    def test_login_success(self, test_user):
        """POST /api/auth/login authenticates and returns JWT"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": test_user["password"]
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data, "Response missing 'token'"
        assert data.get("urn") == test_user["urn"]
        assert data.get("address") == test_user["address"]
        print(f"✓ Login successful for {test_user['urn']}")

    def test_login_case_insensitive_urn(self, test_user):
        """Login should be case-insensitive for URN"""
        # Try uppercase URN
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"].upper(),
            "password": test_user["password"]
        })
        
        assert response.status_code == 200, f"Case-insensitive login failed: {response.text}"
        print("✓ Login is case-insensitive for URN")

    def test_login_invalid_urn(self):
        """Login with invalid URN returns 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "nonexistent_user_xyz123",
            "password": "anypassword"
        })
        
        assert response.status_code == 401, f"Expected 401 for invalid URN, got {response.status_code}"
        print("✓ Invalid URN returns 401")

    def test_login_wrong_password(self, test_user):
        """Login with wrong password returns 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": "wrongpassword123"
        })
        
        assert response.status_code == 401, f"Expected 401 for wrong password, got {response.status_code}"
        print("✓ Wrong password returns 401")


class TestAuthMe:
    """Test authenticated user info endpoint"""

    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get a valid auth token"""
        unique_urn = f"TEST_me_{uuid.uuid4().hex[:8]}"
        
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_resp.json()
        
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": unique_urn,
            "password": "testme123",
            "address": wallet["address"],
            "network": "btc-testnet"
        })
        
        if signup_resp.status_code != 200:
            pytest.skip(f"Failed to create test user: {signup_resp.text}")
        
        return signup_resp.json()

    def test_auth_me_with_valid_token(self, auth_token):
        """GET /api/auth/me returns user info with valid token"""
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {auth_token['token']}"}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("urn") == auth_token["urn"]
        assert data.get("address") == auth_token["address"]
        assert "is_minted" in data
        print(f"✓ /auth/me returns user info for {auth_token['urn']}")

    def test_auth_me_without_token(self):
        """GET /api/auth/me returns 401 without token"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        
        assert response.status_code == 401, f"Expected 401 without token, got {response.status_code}"
        print("✓ /auth/me returns 401 without token")

    def test_auth_me_with_invalid_token(self):
        """GET /api/auth/me returns 401 with invalid token"""
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_xyz123"}
        )
        
        assert response.status_code == 401, f"Expected 401 with invalid token, got {response.status_code}"
        print("✓ /auth/me returns 401 with invalid token")


class TestHealthCheck:
    """Verify backend is running"""

    def test_health_check(self):
        """Health endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ Health check passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
