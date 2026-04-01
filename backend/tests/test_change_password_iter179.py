"""
Test suite for changePassword bug fix - Iteration 179
Tests the critical fix: changePassword now uses in-memory WIF directly to encrypt with new password

Backend endpoints tested:
- POST /api/auth/signup - Create test user
- POST /api/auth/login - Login and verify flat response
- POST /api/auth/change-password - Change password and verify
- POST /api/auth/login (again) - Verify login works with new password
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestChangePasswordFlow:
    """Test the complete change password flow - the critical bug fix"""
    
    @pytest.fixture(scope="class")
    def test_user(self):
        """Create a unique test user for this test class"""
        unique_id = str(uuid.uuid4())[:8]
        return {
            "urn": f"TEST_changepw_{unique_id}",
            "password": "testpass123",
            "new_password": "newpass456",
            "address": f"tb1q{unique_id}test123456789",
            "network": "btc-testnet"
        }
    
    def test_01_signup_creates_user(self, test_user):
        """Step 1: Create a new test user via signup"""
        response = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": test_user["urn"],
            "password": test_user["password"],
            "address": test_user["address"],
            "network": test_user["network"]
        })
        
        assert response.status_code == 200, f"Signup failed: {response.text}"
        data = response.json()
        
        # Verify flat response structure (no .user wrapper)
        assert "token" in data, "Response should contain token"
        assert "urn" in data, "Response should contain urn at top level"
        assert data["urn"] == test_user["urn"]
        assert "address" in data
        assert "addresses" in data
        assert "network" in data
        assert "is_minted" in data
        
        # Store token for subsequent tests
        test_user["token"] = data["token"]
        print(f"✓ Signup successful for {test_user['urn']}")
    
    def test_02_login_with_original_password(self, test_user):
        """Step 2: Verify login works with original password"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": test_user["password"]
        })
        
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        
        # Verify flat response (the previous bug fix)
        assert "token" in data
        assert "urn" in data
        assert data["urn"] == test_user["urn"]
        assert "address" in data
        assert "addresses" in data
        assert "network" in data
        
        # Update token
        test_user["token"] = data["token"]
        print(f"✓ Login with original password successful")
    
    def test_03_change_password_endpoint(self, test_user):
        """Step 3: Change password via API - the critical endpoint"""
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": test_user["password"],
                "new_password": test_user["new_password"]
            },
            headers={"Authorization": f"Bearer {test_user['token']}"}
        )
        
        assert response.status_code == 200, f"Change password failed: {response.text}"
        data = response.json()
        assert data.get("status") == "ok", "Response should have status: ok"
        print(f"✓ Password changed successfully via API")
    
    def test_04_login_with_new_password(self, test_user):
        """Step 4: CRITICAL - Verify login works with NEW password after change"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": test_user["new_password"]
        })
        
        assert response.status_code == 200, f"Login with new password failed: {response.text}"
        data = response.json()
        
        assert "token" in data
        assert data["urn"] == test_user["urn"]
        print(f"✓ Login with NEW password successful - bug fix verified!")
    
    def test_05_login_with_old_password_fails(self, test_user):
        """Step 5: Verify old password no longer works"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": test_user["urn"],
            "password": test_user["password"]  # Old password
        })
        
        assert response.status_code == 401, "Old password should be rejected"
        print(f"✓ Old password correctly rejected")


class TestChangePasswordValidation:
    """Test change password validation and error handling"""
    
    @pytest.fixture(scope="class")
    def auth_user(self):
        """Create and login a test user"""
        unique_id = str(uuid.uuid4())[:8]
        user = {
            "urn": f"TEST_pwvalid_{unique_id}",
            "password": "validpass123",
            "address": f"tb1q{unique_id}valid123",
            "network": "btc-testnet"
        }
        
        # Signup
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=user)
        if signup_res.status_code == 200:
            user["token"] = signup_res.json()["token"]
        return user
    
    def test_change_password_requires_auth(self):
        """Change password should require authentication"""
        response = requests.post(f"{BASE_URL}/api/auth/change-password", json={
            "current_password": "anypass",
            "new_password": "newpass123"
        })
        
        assert response.status_code == 401, "Should require authentication"
        print("✓ Change password requires authentication")
    
    def test_change_password_wrong_current(self, auth_user):
        """Change password should reject wrong current password"""
        if not auth_user.get("token"):
            pytest.skip("Auth user not created")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": "wrongpassword",
                "new_password": "newpass123"
            },
            headers={"Authorization": f"Bearer {auth_user['token']}"}
        )
        
        assert response.status_code == 401, "Should reject wrong current password"
        print("✓ Wrong current password correctly rejected")
    
    def test_change_password_short_new(self, auth_user):
        """Change password should reject short new password"""
        if not auth_user.get("token"):
            pytest.skip("Auth user not created")
        
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": auth_user["password"],
                "new_password": "short"  # Less than 6 chars
            },
            headers={"Authorization": f"Bearer {auth_user['token']}"}
        )
        
        assert response.status_code == 400, "Should reject short password"
        print("✓ Short new password correctly rejected")


class TestLoginFlatResponse:
    """Verify login returns flat response (previous bug fix)"""
    
    def test_login_response_structure(self):
        """Verify login response is flat, not nested under .user"""
        unique_id = str(uuid.uuid4())[:8]
        user = {
            "urn": f"TEST_flat_{unique_id}",
            "password": "flattest123",
            "address": f"tb1q{unique_id}flat123",
            "network": "btc-testnet"
        }
        
        # Signup first
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=user)
        assert signup_res.status_code == 200
        
        # Login
        login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": user["urn"],
            "password": user["password"]
        })
        
        assert login_res.status_code == 200
        data = login_res.json()
        
        # CRITICAL: Verify NO .user wrapper (the bug was data.user.urn)
        assert "user" not in data, "Response should NOT have .user wrapper"
        
        # Verify flat structure
        assert "token" in data
        assert "urn" in data
        assert "address" in data
        assert "addresses" in data
        assert "network" in data
        assert "is_minted" in data
        
        # Verify values
        assert data["urn"] == user["urn"]
        assert data["network"] == user["network"]
        
        print("✓ Login response is flat (no .user wrapper)")


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ API health check passed")
