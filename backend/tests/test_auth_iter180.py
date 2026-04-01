"""
Iteration 180 Backend Tests:
1. Login by URN and by address (new feature)
2. Rename URN endpoint
3. Change password + re-login flow
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestLoginByUrnAndAddress:
    """Test that login works by both URN and address"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create a test user for login tests"""
        self.test_urn = f"TEST_login_{uuid.uuid4().hex[:8]}"
        self.test_password = "testpass123"
        self.test_address = None
        self.token = None
        
        # Signup to create user
        res = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.test_urn,
            "password": self.test_password,
            "address": f"mtest{uuid.uuid4().hex[:20]}",  # Fake testnet address
            "network": "btc-testnet"
        })
        if res.status_code == 201 or res.status_code == 200:
            data = res.json()
            self.test_address = data.get("address")
            self.token = data.get("token")
        yield
        # Cleanup would go here if needed
    
    def test_01_login_by_urn_works(self):
        """Login using URN should succeed"""
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn,
            "password": self.test_password
        })
        assert res.status_code == 200, f"Login by URN failed: {res.text}"
        data = res.json()
        assert data.get("urn") == self.test_urn
        assert "token" in data
        print(f"PASSED: Login by URN works - got token for {self.test_urn}")
    
    def test_02_login_by_address_works(self):
        """Login using address instead of URN should succeed (new feature)"""
        if not self.test_address:
            pytest.skip("No test address available")
        
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_address,  # Using address in URN field
            "password": self.test_password
        })
        assert res.status_code == 200, f"Login by address failed: {res.text}"
        data = res.json()
        # Should return the actual URN, not the address
        assert data.get("urn") == self.test_urn
        assert "token" in data
        print(f"PASSED: Login by address works - address {self.test_address[:12]}... resolved to URN {self.test_urn}")
    
    def test_03_login_case_insensitive_urn(self):
        """Login should be case-insensitive for URN"""
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn.upper(),  # Uppercase
            "password": self.test_password
        })
        assert res.status_code == 200, f"Case-insensitive login failed: {res.text}"
        print(f"PASSED: Case-insensitive URN login works")
    
    def test_04_login_wrong_password_fails(self):
        """Login with wrong password should fail"""
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn,
            "password": "wrongpassword"
        })
        assert res.status_code == 401, f"Expected 401, got {res.status_code}"
        print(f"PASSED: Wrong password correctly rejected")


class TestRenameUrn:
    """Test the rename-urn endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create a test user for rename tests"""
        self.original_urn = f"TEST_rename_{uuid.uuid4().hex[:8]}"
        self.new_urn = f"TEST_renamed_{uuid.uuid4().hex[:8]}"
        self.test_password = "testpass123"
        self.token = None
        
        # Signup to create user
        res = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.original_urn,
            "password": self.test_password,
            "address": f"mtest{uuid.uuid4().hex[:20]}",
            "network": "btc-testnet"
        })
        if res.status_code in [200, 201]:
            self.token = res.json().get("token")
        yield
    
    def test_01_rename_urn_requires_auth(self):
        """Rename URN should require authentication"""
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", json={
            "new_urn": self.new_urn
        })
        assert res.status_code == 401, f"Expected 401 without auth, got {res.status_code}"
        print(f"PASSED: Rename URN requires authentication")
    
    def test_02_rename_urn_success(self):
        """Rename URN should succeed with valid auth"""
        if not self.token:
            pytest.skip("No token available")
        
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", 
            json={"new_urn": self.new_urn},
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert res.status_code == 200, f"Rename failed: {res.text}"
        data = res.json()
        assert data.get("urn") == self.new_urn
        assert "token" in data  # Should return new token
        print(f"PASSED: Renamed URN from {self.original_urn} to {self.new_urn}")
        
        # Store new token for subsequent tests
        self.token = data.get("token")
    
    def test_03_login_with_new_urn_works(self):
        """After rename, login with new URN should work"""
        if not self.token:
            pytest.skip("No token available")
        
        # First rename
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", 
            json={"new_urn": self.new_urn},
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if res.status_code != 200:
            pytest.skip("Rename failed")
        
        # Now login with new URN
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.new_urn,
            "password": self.test_password
        })
        assert res.status_code == 200, f"Login with new URN failed: {res.text}"
        assert res.json().get("urn") == self.new_urn
        print(f"PASSED: Login with new URN {self.new_urn} works")
    
    def test_04_login_with_old_urn_fails(self):
        """After rename, login with old URN should fail"""
        if not self.token:
            pytest.skip("No token available")
        
        # First rename
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", 
            json={"new_urn": self.new_urn},
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if res.status_code != 200:
            pytest.skip("Rename failed")
        
        # Now try login with old URN
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.original_urn,
            "password": self.test_password
        })
        assert res.status_code == 401, f"Expected 401 for old URN, got {res.status_code}"
        print(f"PASSED: Login with old URN {self.original_urn} correctly fails after rename")
    
    def test_05_rename_urn_too_short_fails(self):
        """Rename to URN < 2 chars should fail"""
        if not self.token:
            pytest.skip("No token available")
        
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", 
            json={"new_urn": "X"},
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert res.status_code == 400, f"Expected 400 for short URN, got {res.status_code}"
        print(f"PASSED: Short URN correctly rejected")
    
    def test_06_rename_urn_duplicate_fails(self):
        """Rename to existing URN should fail"""
        if not self.token:
            pytest.skip("No token available")
        
        # Create another user
        other_urn = f"TEST_other_{uuid.uuid4().hex[:8]}"
        res = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": other_urn,
            "password": "testpass123",
            "address": f"mtest{uuid.uuid4().hex[:20]}",
            "network": "btc-testnet"
        })
        if res.status_code not in [200, 201]:
            pytest.skip("Could not create other user")
        
        # Try to rename to that URN
        res = requests.post(f"{BASE_URL}/api/auth/rename-urn", 
            json={"new_urn": other_urn},
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert res.status_code == 409, f"Expected 409 for duplicate URN, got {res.status_code}"
        print(f"PASSED: Duplicate URN correctly rejected")


class TestChangePasswordRelogin:
    """Test full change-password + re-login flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Create a test user"""
        self.test_urn = f"TEST_chpw_{uuid.uuid4().hex[:8]}"
        self.original_password = "original123"
        self.new_password = "newpass456"
        self.token = None
        
        # Signup
        res = requests.post(f"{BASE_URL}/api/auth/signup", json={
            "urn": self.test_urn,
            "password": self.original_password,
            "address": f"mtest{uuid.uuid4().hex[:20]}",
            "network": "btc-testnet"
        })
        if res.status_code in [200, 201]:
            self.token = res.json().get("token")
        yield
    
    def test_01_change_password_success(self):
        """Change password should succeed"""
        if not self.token:
            pytest.skip("No token available")
        
        res = requests.post(f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": self.original_password,
                "new_password": self.new_password
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
        assert res.status_code == 200, f"Change password failed: {res.text}"
        print(f"PASSED: Password changed successfully")
    
    def test_02_login_with_new_password_works(self):
        """After change, login with new password should work"""
        if not self.token:
            pytest.skip("No token available")
        
        # Change password
        res = requests.post(f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": self.original_password,
                "new_password": self.new_password
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if res.status_code != 200:
            pytest.skip("Change password failed")
        
        # Login with new password
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn,
            "password": self.new_password
        })
        assert res.status_code == 200, f"Login with new password failed: {res.text}"
        print(f"PASSED: Login with new password works")
    
    def test_03_login_with_old_password_fails(self):
        """After change, login with old password should fail"""
        if not self.token:
            pytest.skip("No token available")
        
        # Change password
        res = requests.post(f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": self.original_password,
                "new_password": self.new_password
            },
            headers={"Authorization": f"Bearer {self.token}"}
        )
        if res.status_code != 200:
            pytest.skip("Change password failed")
        
        # Try login with old password
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "urn": self.test_urn,
            "password": self.original_password
        })
        assert res.status_code == 401, f"Expected 401 for old password, got {res.status_code}"
        print(f"PASSED: Old password correctly rejected after change")


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        """API should be reachable"""
        res = requests.get(f"{BASE_URL}/api/health")
        assert res.status_code == 200
        print(f"PASSED: API health check")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
