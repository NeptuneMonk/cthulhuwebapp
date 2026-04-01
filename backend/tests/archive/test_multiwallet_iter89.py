"""
Iteration 89: Multi-wallet management backend tests.
Tests for auth endpoints: register, login, add-network-address.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthEndpoints:
    """Tests for auth registration, login, and add-network-address endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Generate unique test identifiers"""
        self.test_id = str(uuid.uuid4())[:8]
        self.test_urn = f"TEST_multi_{self.test_id}"
        self.test_password = "testpass123"
        self.test_address = f"tb1q_test_{self.test_id}"
        self.test_network = "btc-testnet"
    
    def test_register_creates_account(self):
        """POST /api/auth/register creates account with urn, password, address, network"""
        # Note: The endpoint is /auth/signup in the code but /auth/register was requested
        # Let's test the actual endpoint /auth/signup
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.test_urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        
        print(f"Register response: {response.status_code}, {response.text[:500] if response.text else 'empty'}")
        
        # Should return 200 for new user
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data, "Response should contain token"
        assert data.get("urn") == self.test_urn, f"URN mismatch: expected {self.test_urn}, got {data.get('urn')}"
        assert data.get("address") == self.test_address, f"Address mismatch"
        assert data.get("network") == self.test_network, f"Network mismatch"
        assert "addresses" in data, "Response should contain addresses map"
        assert data["addresses"].get(self.test_network) == self.test_address, "Addresses map should contain network address"
        assert data.get("is_minted") == False, "New user should not be minted"
        
        print(f"SUCCESS: User {self.test_urn} registered successfully")
    
    def test_register_duplicate_urn_fails(self):
        """POST /api/auth/signup with existing URN returns 409"""
        # First create user
        urn = f"TEST_dup_{self.test_id}"
        response1 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        assert response1.status_code == 200, f"First registration should succeed: {response1.text}"
        
        # Try to register same URN again
        response2 = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": "differentpass",
            "address": "different_address",
            "network": self.test_network
        })
        
        assert response2.status_code == 409, f"Expected 409 for duplicate URN, got {response2.status_code}"
        print("SUCCESS: Duplicate URN registration correctly rejected")
    
    def test_login_returns_token_and_user_data(self):
        """POST /api/auth/login returns token and user data"""
        # First create user
        urn = f"TEST_login_{self.test_id}"
        reg_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        assert reg_response.status_code == 200, f"Registration should succeed: {reg_response.text}"
        
        # Now login
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": urn,
            "password": self.test_password
        })
        
        print(f"Login response: {login_response.status_code}, {login_response.text[:500] if login_response.text else 'empty'}")
        
        assert login_response.status_code == 200, f"Expected 200, got {login_response.status_code}: {login_response.text}"
        
        data = login_response.json()
        assert "token" in data, "Response should contain token"
        assert data.get("urn") == urn, f"URN mismatch"
        assert data.get("address") == self.test_address, f"Address mismatch"
        assert data.get("network") == self.test_network, f"Network mismatch"
        assert "addresses" in data, "Response should contain addresses map"
        assert isinstance(data.get("is_minted"), bool), "is_minted should be boolean"
        
        print(f"SUCCESS: Login for {urn} returned token and user data")
    
    def test_login_invalid_credentials_fails(self):
        """POST /api/auth/login with wrong password returns 401"""
        # First create user
        urn = f"TEST_badlogin_{self.test_id}"
        reg_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": self.test_network
        })
        assert reg_response.status_code == 200
        
        # Try login with wrong password
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": urn,
            "password": "wrongpassword"
        })
        
        assert login_response.status_code == 401, f"Expected 401 for wrong password, got {login_response.status_code}"
        print("SUCCESS: Invalid credentials correctly rejected")
    
    def test_add_network_address(self):
        """POST /api/auth/add-network-address adds address for a network"""
        # First create user and get token
        urn = f"TEST_netaddr_{self.test_id}"
        reg_response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": urn,
            "password": self.test_password,
            "address": self.test_address,
            "network": "btc-testnet"
        })
        assert reg_response.status_code == 200
        token = reg_response.json()["token"]
        
        # Add address for mainnet
        mainnet_address = f"1MainnetAddr_{self.test_id}"
        add_response = requests.post(
            f"{BASE_URL}/api/auth/add-network-address",
            json={"network": "btc-mainnet", "address": mainnet_address},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        print(f"Add network address response: {add_response.status_code}, {add_response.text}")
        
        assert add_response.status_code == 200, f"Expected 200, got {add_response.status_code}: {add_response.text}"
        
        data = add_response.json()
        assert data.get("status") == "ok", "Response should have status ok"
        assert data.get("network") == "btc-mainnet", "Network should match"
        assert data.get("address") == mainnet_address, "Address should match"
        
        # Verify by calling /auth/me
        me_response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert me_response.status_code == 200
        me_data = me_response.json()
        assert me_data.get("addresses", {}).get("btc-mainnet") == mainnet_address, "Mainnet address should be saved"
        
        print("SUCCESS: Add network address worked correctly")
    
    def test_add_network_address_requires_auth(self):
        """POST /api/auth/add-network-address without auth returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/add-network-address",
            json={"network": "btc-mainnet", "address": "someaddress"}
        )
        
        assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"
        print("SUCCESS: add-network-address correctly requires authentication")


class TestRegressionEndpoints:
    """Regression tests for feed and objects endpoints"""
    
    def test_feed_endpoint(self):
        """GET /api/feed/btc-testnet returns posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet")
        
        print(f"Feed response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Feed returns 'feed' key, not 'messages'
        assert "feed" in data, "Response should contain feed"
        assert isinstance(data["feed"], list), "Feed should be a list"
        
        print(f"SUCCESS: Feed returned {len(data['feed'])} posts")
    
    def test_objects_storefront_endpoint(self):
        """GET /api/objects/storefront/{network} returns objects for storefront"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet")
        
        print(f"Objects storefront response: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Objects response has 'objects' key
        assert "objects" in data, "Response should contain objects"
        assert isinstance(data["objects"], list), "Objects should be a list"
        
        print(f"SUCCESS: Objects storefront returned {len(data['objects'])} objects")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
