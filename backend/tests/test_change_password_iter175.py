"""
Test Change Password Feature - Iteration 175
Tests the new /api/auth/change-password endpoint for regular users.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials - will create a unique user for testing
TEST_URN = f"TEST_changepw_{uuid.uuid4().hex[:8]}"
TEST_PASSWORD = "TestPass123"
TEST_NEW_PASSWORD = "NewPass456"
TEST_ADDRESS = f"tb1q{uuid.uuid4().hex[:32]}"


class TestChangePasswordEndpoint:
    """Tests for POST /api/auth/change-password endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create a test user and get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Create test user via signup
        signup_res = self.session.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": TEST_URN,
            "password": TEST_PASSWORD,
            "address": TEST_ADDRESS,
            "network": "btc-testnet"
        })
        
        if signup_res.status_code == 201 or signup_res.status_code == 200:
            data = signup_res.json()
            self.token = data.get("token")
            self.urn = data.get("urn")
        elif signup_res.status_code == 409:
            # User already exists, try login
            login_res = self.session.post(f"{BASE_URL}/api/auth/login", json={
                "urn": TEST_URN,
                "password": TEST_PASSWORD
            })
            if login_res.status_code == 200:
                data = login_res.json()
                self.token = data.get("token")
                self.urn = data.get("urn")
            else:
                pytest.skip("Could not create or login test user")
        else:
            pytest.skip(f"Signup failed: {signup_res.status_code} - {signup_res.text}")
        
        yield
    
    def test_change_password_requires_auth(self):
        """Test that change-password endpoint requires JWT authentication"""
        # No auth header
        res = self.session.post(f"{BASE_URL}/api/auth/change-password", json={
            "current_password": TEST_PASSWORD,
            "new_password": TEST_NEW_PASSWORD
        })
        assert res.status_code == 401, f"Expected 401 without auth, got {res.status_code}"
        print("PASSED: Change password requires authentication")
    
    def test_change_password_rejects_wrong_current_password(self):
        """Test that wrong current password returns 401"""
        res = self.session.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "current_password": "WrongPassword123",
                "new_password": TEST_NEW_PASSWORD
            }
        )
        assert res.status_code == 401, f"Expected 401 for wrong password, got {res.status_code}"
        data = res.json()
        assert "incorrect" in data.get("detail", "").lower() or "invalid" in data.get("detail", "").lower(), \
            f"Expected error about incorrect password, got: {data}"
        print("PASSED: Change password rejects wrong current password with 401")
    
    def test_change_password_rejects_short_new_password(self):
        """Test that new password < 6 chars returns 400"""
        res = self.session.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "current_password": TEST_PASSWORD,
                "new_password": "abc"  # Too short
            }
        )
        assert res.status_code == 400, f"Expected 400 for short password, got {res.status_code}"
        data = res.json()
        assert "6" in data.get("detail", "") or "character" in data.get("detail", "").lower(), \
            f"Expected error about minimum length, got: {data}"
        print("PASSED: Change password rejects new password < 6 chars with 400")
    
    def test_change_password_success_and_verify(self):
        """Test successful password change and verify old password fails, new works"""
        # Change password
        res = self.session.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {self.token}"},
            json={
                "current_password": TEST_PASSWORD,
                "new_password": TEST_NEW_PASSWORD
            }
        )
        assert res.status_code == 200, f"Expected 200 for successful change, got {res.status_code}: {res.text}"
        data = res.json()
        assert data.get("status") == "ok", f"Expected status 'ok', got: {data}"
        print("PASSED: Change password succeeds with correct credentials")
        
        # Verify old password no longer works
        login_old = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.urn,
            "password": TEST_PASSWORD
        })
        assert login_old.status_code == 401, f"Old password should fail, got {login_old.status_code}"
        print("PASSED: Old password no longer works after change")
        
        # Verify new password works
        login_new = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.urn,
            "password": TEST_NEW_PASSWORD
        })
        assert login_new.status_code == 200, f"New password should work, got {login_new.status_code}: {login_new.text}"
        new_data = login_new.json()
        assert "token" in new_data, "Login with new password should return token"
        print("PASSED: New password works for login after change")


class TestExistingUserChangePassword:
    """Test change password with the existing test user testuser123"""
    
    def test_existing_user_login_and_change_password_flow(self):
        """Test the full flow with existing user testuser123"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Try to login with the existing test user
        # According to the request, testuser123 has password NewPass123
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "testuser123",
            "password": "NewPass123"
        })
        
        if login_res.status_code != 200:
            print(f"INFO: testuser123 login failed with NewPass123: {login_res.status_code}")
            # Try with TestPass123 as fallback
            login_res = session.post(f"{BASE_URL}/api/auth/login", json={
                "urn": "testuser123",
                "password": "TestPass123"
            })
            if login_res.status_code != 200:
                pytest.skip(f"Could not login as testuser123: {login_res.status_code}")
        
        data = login_res.json()
        token = data.get("token")
        assert token, "Should get token on login"
        print(f"PASSED: Logged in as testuser123")
        
        # Test that change-password endpoint is accessible
        # We won't actually change the password to avoid breaking other tests
        # Just verify the endpoint exists and validates properly
        res = session.post(
            f"{BASE_URL}/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_password": "WrongPassword",
                "new_password": "SomeNewPass123"
            }
        )
        # Should get 401 for wrong current password, not 404 or 500
        assert res.status_code == 401, f"Expected 401 for wrong password, got {res.status_code}"
        print("PASSED: Change password endpoint accessible and validates current password")


class TestAuthMeEndpoint:
    """Verify /api/auth/me endpoint works with JWT"""
    
    def test_auth_me_returns_user_info(self):
        """Test that /api/auth/me returns user info when authenticated"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Login first
        login_res = session.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "testuser123",
            "password": "NewPass123"
        })
        
        if login_res.status_code != 200:
            login_res = session.post(f"{BASE_URL}/api/auth/login", json={
                "urn": "testuser123",
                "password": "TestPass123"
            })
            if login_res.status_code != 200:
                pytest.skip("Could not login as testuser123")
        
        token = login_res.json().get("token")
        
        # Call /api/auth/me
        me_res = session.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert me_res.status_code == 200, f"Expected 200, got {me_res.status_code}"
        data = me_res.json()
        assert "urn" in data, "Should return urn"
        assert data["urn"] == "testuser123", f"Expected urn testuser123, got {data['urn']}"
        print(f"PASSED: /api/auth/me returns user info: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
