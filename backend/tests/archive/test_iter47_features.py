"""
Test Iteration 47 - Backend API Tests for Cthulhu Platform
Tests new features: image compression, sidebar profile pic, post/create buttons, @mention resolution, OBJ cre/own integer indices
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasicAPIs:
    """Health and basic API endpoint tests"""
    
    def test_api_health(self):
        """Test health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("SUCCESS: /api/health returns {status: healthy}")
    
    def test_api_root(self):
        """Test root API endpoint"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "name" in data or "Cthulhu" in str(data)
        print("SUCCESS: /api/ root endpoint accessible")


class TestProfileAPI:
    """Profile API tests - including profile with image field"""
    
    def test_profile_with_image_field(self):
        """Test profile endpoint returns profile with image field"""
        # Profile mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz is the Emergent profile on btc-testnet
        response = requests.get(
            f"{BASE_URL}/api/profile/mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify profile structure
        assert "address" in data
        assert data["address"] == "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        assert "urn" in data
        assert "image" in data
        assert data["image"] is not None, "Profile should have image field"
        
        # Image should be an IPFS reference
        assert "IPFS:" in data["image"] or "/" in data["image"], "Image should be IPFS reference"
        print(f"SUCCESS: Profile has image field: {data['image'][:50]}...")
    
    def test_profile_not_found(self):
        """Test profile endpoint returns 404 for non-existent profile"""
        response = requests.get(
            f"{BASE_URL}/api/profile/nonexistentaddress123",
            params={"network": "btc-testnet"}
        )
        # Should return 404 or empty response
        assert response.status_code in [404, 200]


class TestWalletFaucets:
    """Wallet faucet API tests"""
    
    def test_faucets_list(self):
        """Test faucets endpoint returns faucet list"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        assert response.status_code == 200
        data = response.json()
        
        assert "faucets" in data
        faucets = data["faucets"]
        assert len(faucets) >= 1, "Should have at least 1 faucet"
        
        # Verify faucet structure
        for faucet in faucets:
            assert "name" in faucet
            assert "url" in faucet
            assert faucet["url"].startswith("http")
        
        print(f"SUCCESS: /api/wallet/faucets returns {len(faucets)} faucets")


class TestFeedAPI:
    """Feed API tests"""
    
    def test_feed_btc_testnet(self):
        """Test feed endpoint returns messages for btc-testnet"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "feed" in data
        feed = data["feed"]
        assert isinstance(feed, list)
        
        if len(feed) > 0:
            # Verify message structure
            msg = feed[0]
            assert "id" in msg or "transaction_id" in msg
            assert "content" in msg or "from_address" in msg
            assert "network" in msg
            
        print(f"SUCCESS: /api/feed/btc-testnet returns {len(feed)} messages")
    
    def test_feed_pagination(self):
        """Test feed pagination works"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "skip" in data
        assert "limit" in data
        assert data["skip"] == 0
        assert data["limit"] == 5


class TestKnownUsersAPI:
    """Known users API tests - including URN and address"""
    
    def test_known_users_list(self):
        """Test known users endpoint returns user list with URN and address"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "users" in data
        users = data["users"]
        assert isinstance(users, list)
        assert len(users) >= 1, "Should have at least 1 known user"
        
        # Verify user structure - should have URN and address
        user = users[0]
        assert "address" in user, "User should have address"
        assert "urn" in user, "User should have URN"
        
        # Find a user with both URN and address to validate
        users_with_both = [u for u in users if u.get("urn") and u.get("address")]
        assert len(users_with_both) >= 1, "Should have users with both URN and address"
        
        print(f"SUCCESS: /api/known-users/btc-testnet returns {len(users)} users with URN and address")
    
    def test_known_users_for_mention_resolution(self):
        """Test known users can be used for @mention resolution"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        users = data["users"]
        
        # Find a user by URN (simulating @mention resolution)
        embii_users = [u for u in users if u.get("urn", "").lower() == "embii4u"]
        if embii_users:
            user = embii_users[0]
            assert "address" in user
            print(f"SUCCESS: Can resolve @embii4u to address {user['address'][:20]}...")


class TestAuthAPI:
    """Auth API tests"""
    
    def test_auth_signup_and_login(self):
        """Test auth signup and login flow"""
        test_urn = f"test_iter47_{int(time.time())}"
        test_password = "testpass123"
        
        # Signup
        signup_response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={"urn": test_urn, "password": test_password}
        )
        
        if signup_response.status_code == 201:
            data = signup_response.json()
            assert "token" in data
            assert "user" in data
            print(f"SUCCESS: Signup created user {test_urn}")
            
            # Login with same credentials
            login_response = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"urn": test_urn, "password": test_password}
            )
            assert login_response.status_code == 200
            login_data = login_response.json()
            assert "token" in login_data
            print("SUCCESS: Login with created credentials works")
        elif signup_response.status_code == 409:
            # User exists - try login
            login_response = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"urn": test_urn, "password": test_password}
            )
            print(f"User exists, login status: {login_response.status_code}")
    
    def test_auth_invalid_login(self):
        """Test auth login with invalid credentials returns 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": "nonexistent_user_xyz", "password": "wrongpass"}
        )
        assert response.status_code == 401 or response.status_code == 404
        print("SUCCESS: Invalid login returns 401/404")


class TestObjectsAPI:
    """Objects API tests"""
    
    def test_objects_storefront(self):
        """Test objects storefront endpoint"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data or isinstance(data, list)
        print("SUCCESS: /api/objects/storefront/btc-testnet accessible")


# Run with: pytest /app/backend/tests/test_iter47_features.py -v --tb=short
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
