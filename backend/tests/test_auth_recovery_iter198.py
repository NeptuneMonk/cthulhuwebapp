"""
Test auth endpoints for iteration 198 - Auth recovery bug fix
Tests:
1. /api/auth/signup - creates new user and returns token
2. /api/auth/login - returns valid JWT token
3. /api/auth/me - validates token and returns user data
4. /api/auth/me - returns 401 for invalid/expired tokens (not 500)
"""
import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthEndpoints:
    """Test auth endpoints for the recovery bug fix"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.test_urn = f"TEST_user_{uuid.uuid4().hex[:8]}"
        self.test_password = "testpass123"
        self.test_address = None
        self.test_token = None
    
    def test_health_check(self):
        """Verify backend is running"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: Health check passed")
    
    def test_signup_creates_user_and_returns_token(self):
        """Test /api/auth/signup creates a new user and returns token"""
        # First create a wallet
        wallet_res = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        assert wallet_res.status_code == 200, f"Wallet creation failed: {wallet_res.text}"
        wallet = wallet_res.json()
        assert "address" in wallet
        assert "wif" in wallet
        
        # Now signup
        signup_data = {
            "urn": self.test_urn,
            "password": self.test_password,
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json=signup_data
        )
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "token" in data, "Response missing token"
        assert "urn" in data, "Response missing urn"
        assert "address" in data, "Response missing address"
        assert "addresses" in data, "Response missing addresses"
        assert "network" in data, "Response missing network"
        
        # Verify values
        assert data["urn"] == self.test_urn
        assert data["address"] == wallet["address"]
        assert data["network"] == "btc-testnet"
        assert isinstance(data["token"], str)
        assert len(data["token"]) > 0
        
        print(f"PASS: Signup created user {self.test_urn} with token")
        return data
    
    def test_login_returns_valid_jwt(self):
        """Test /api/auth/login returns a valid JWT token"""
        # First signup a user
        wallet_res = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        test_urn = f"TEST_login_{uuid.uuid4().hex[:8]}"
        signup_data = {
            "urn": test_urn,
            "password": self.test_password,
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        assert signup_res.status_code == 200, f"Signup failed: {signup_res.text}"
        
        # Now login
        login_data = {
            "urn": test_urn,
            "password": self.test_password
        }
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json=login_data
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "token" in data, "Response missing token"
        assert "urn" in data, "Response missing urn"
        assert "address" in data, "Response missing address"
        assert "addresses" in data, "Response missing addresses"
        
        # Verify token is valid JWT format (3 parts separated by dots)
        token = data["token"]
        assert isinstance(token, str)
        parts = token.split(".")
        assert len(parts) == 3, "Token is not valid JWT format"
        
        print(f"PASS: Login returned valid JWT for {test_urn}")
        return data
    
    def test_auth_me_validates_token(self):
        """Test /api/auth/me validates a token and returns user data"""
        # First signup and get token
        wallet_res = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        test_urn = f"TEST_me_{uuid.uuid4().hex[:8]}"
        signup_data = {
            "urn": test_urn,
            "password": self.test_password,
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        assert signup_res.status_code == 200
        token = signup_res.json()["token"]
        
        # Now call /auth/me with the token
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"/auth/me failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "urn" in data, "Response missing urn"
        assert "address" in data, "Response missing address"
        assert "addresses" in data, "Response missing addresses"
        assert "network" in data, "Response missing network"
        assert "is_minted" in data, "Response missing is_minted"
        
        # Verify values
        assert data["urn"] == test_urn
        assert data["address"] == wallet["address"]
        
        print(f"PASS: /auth/me validated token and returned user data for {test_urn}")
        return data
    
    def test_auth_me_returns_401_for_invalid_token(self):
        """Test /api/auth/me returns 401 for invalid/expired tokens (not 500)"""
        # Test with completely invalid token
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_12345"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}: {response.text}"
        print("PASS: /auth/me returns 401 for invalid token")
        
        # Test with malformed JWT
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature"}
        )
        assert response.status_code == 401, f"Expected 401 for malformed JWT, got {response.status_code}"
        print("PASS: /auth/me returns 401 for malformed JWT")
        
        # Test with no token
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401, f"Expected 401 for no token, got {response.status_code}"
        print("PASS: /auth/me returns 401 for missing token")
    
    def test_auth_me_returns_401_not_500(self):
        """Verify /auth/me never returns 500 for auth failures"""
        test_cases = [
            ("empty bearer", "Bearer "),
            ("random string", "Bearer abc123xyz"),
            ("expired-like token", "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cm4iOiJ0ZXN0IiwiZXhwIjoxfQ.invalid"),
            ("wrong algorithm", "Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1cm4iOiJ0ZXN0In0."),
        ]
        
        for name, auth_header in test_cases:
            response = requests.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": auth_header}
            )
            assert response.status_code != 500, f"Got 500 for {name}: {response.text}"
            assert response.status_code == 401, f"Expected 401 for {name}, got {response.status_code}"
            print(f"PASS: /auth/me returns 401 (not 500) for {name}")
    
    def test_login_invalid_credentials_returns_401(self):
        """Test login with invalid credentials returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": "nonexistent_user_xyz", "password": "wrongpass"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: Login with invalid credentials returns 401")
    
    def test_signup_duplicate_urn_returns_409(self):
        """Test signup with duplicate URN returns 409"""
        # First signup
        wallet_res = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet = wallet_res.json()
        
        test_urn = f"TEST_dup_{uuid.uuid4().hex[:8]}"
        signup_data = {
            "urn": test_urn,
            "password": self.test_password,
            "address": wallet["address"],
            "network": "btc-testnet"
        }
        response1 = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data)
        assert response1.status_code == 200
        
        # Try to signup again with same URN
        wallet_res2 = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        wallet2 = wallet_res2.json()
        signup_data2 = {
            "urn": test_urn,
            "password": self.test_password,
            "address": wallet2["address"],
            "network": "btc-testnet"
        }
        response2 = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_data2)
        assert response2.status_code == 409, f"Expected 409, got {response2.status_code}"
        print("PASS: Duplicate URN signup returns 409")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
