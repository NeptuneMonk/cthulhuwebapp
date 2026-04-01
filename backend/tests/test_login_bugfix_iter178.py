"""
Iteration 178: Test Login Bug Fix and URN File Upload Button
Tests:
1. Login endpoint returns flat response (not wrapped in .user)
2. Signup endpoint returns flat response
3. Response contains all required fields: token, urn, address, addresses, network, is_minted
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestLoginBugFix:
    """Test that login/signup return flat responses without .user wrapper"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create unique test user for each test"""
        self.test_urn = f"TEST_login_fix_{uuid.uuid4().hex[:8]}"
        self.test_password = "TestPass123!"
        self.test_address = f"test_addr_{uuid.uuid4().hex[:8]}"
        self.test_network = "btc-testnet"
    
    def test_signup_returns_flat_response(self):
        """Verify signup returns flat response with all required fields"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.test_urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Verify flat response structure (NOT wrapped in .user)
        assert "user" not in data, "Response should NOT have .user wrapper - this was the bug!"
        
        # Verify all required fields are present at top level
        assert "token" in data, "Missing 'token' field"
        assert "urn" in data, "Missing 'urn' field"
        assert "address" in data, "Missing 'address' field"
        assert "addresses" in data, "Missing 'addresses' field"
        assert "network" in data, "Missing 'network' field"
        assert "is_minted" in data, "Missing 'is_minted' field"
        
        # Verify field values
        assert data["urn"] == self.test_urn
        assert data["address"] == self.test_address
        assert data["network"] == self.test_network
        assert isinstance(data["addresses"], dict)
        assert data["addresses"].get(self.test_network) == self.test_address
        assert isinstance(data["token"], str) and len(data["token"]) > 0
        assert data["is_minted"] == False
        
        print(f"✓ Signup returns flat response with all fields: {list(data.keys())}")
    
    def test_login_returns_flat_response(self):
        """Verify login returns flat response with all required fields"""
        # First create user
        signup_resp = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.test_urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        assert signup_resp.status_code == 200, f"Signup failed: {signup_resp.text}"
        
        # Now test login
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn,
            "password": self.test_password
        })
        
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Verify flat response structure (NOT wrapped in .user)
        assert "user" not in data, "Response should NOT have .user wrapper - this was the bug!"
        
        # Verify all required fields are present at top level
        assert "token" in data, "Missing 'token' field"
        assert "urn" in data, "Missing 'urn' field"
        assert "address" in data, "Missing 'address' field"
        assert "addresses" in data, "Missing 'addresses' field"
        assert "network" in data, "Missing 'network' field"
        assert "is_minted" in data, "Missing 'is_minted' field"
        
        # Verify field values
        assert data["urn"] == self.test_urn
        assert data["address"] == self.test_address
        assert data["network"] == self.test_network
        assert isinstance(data["addresses"], dict)
        assert data["addresses"].get(self.test_network) == self.test_address
        assert isinstance(data["token"], str) and len(data["token"]) > 0
        
        print(f"✓ Login returns flat response with all fields: {list(data.keys())}")
    
    def test_login_invalid_credentials(self):
        """Verify login returns 401 for invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "nonexistent_user_xyz",
            "password": "wrongpassword"
        })
        
        assert response.status_code == 401
        data = response.json()
        assert "detail" in data
        print(f"✓ Login correctly returns 401 for invalid credentials")
    
    def test_frontend_login_function_mapping(self):
        """
        Verify the frontend login function correctly maps the flat response.
        This is a code review test - checking that useAuth.js login() function
        creates user object with: {urn, address, addresses, network, is_minted, token}
        and does NOT reference data.user (which was the bug)
        """
        # Read the useAuth.js file and verify the login function
        auth_file_path = "/app/frontend/src/hooks/useAuth.js"
        with open(auth_file_path, 'r') as f:
            content = f.read()
        
        # Check that login function does NOT reference data.user
        assert "data.user" not in content, "useAuth.js should NOT reference data.user - this was the bug!"
        
        # Check that login function correctly maps flat response fields
        assert "data.urn" in content, "Login should map data.urn"
        assert "data.address" in content or "address:" in content, "Login should map address"
        assert "data.addresses" in content, "Login should map data.addresses"
        assert "data.network" in content, "Login should map data.network"
        assert "data.is_minted" in content, "Login should map data.is_minted"
        assert "data.token" in content, "Login should map data.token"
        
        print("✓ Frontend login function correctly maps flat API response (no data.user reference)")


class TestHealthCheck:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ Health endpoint accessible")
