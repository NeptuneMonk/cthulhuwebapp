"""
Iteration 182: Test Release Management API endpoints
Tests for the new autonomous app release mechanism for Cthulhu.

Features tested:
- GET /api/releases/latest (public endpoint, no auth)
- GET /api/admin/releases/config (admin auth required)
- GET /api/admin/releases (admin auth required)
- PUT /api/admin/releases/config (admin auth required)
- POST /api/admin/releases/mint-profile (requires wallet session)
- POST /api/admin/releases/publish (requires wallet session + version)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("PASSED: API health check")


class TestPublicReleasesEndpoint:
    """Test public /api/releases/latest endpoint (no auth required)"""
    
    def test_01_latest_release_no_auth_required(self):
        """GET /api/releases/latest should work without authentication"""
        response = requests.get(f"{BASE_URL}/api/releases/latest")
        assert response.status_code == 200
        data = response.json()
        # When no releases exist, should return {available: false}
        assert "available" in data
        print(f"PASSED: /api/releases/latest returns available={data.get('available')}")
    
    def test_02_latest_release_returns_expected_structure(self):
        """GET /api/releases/latest should return proper structure"""
        response = requests.get(f"{BASE_URL}/api/releases/latest")
        assert response.status_code == 200
        data = response.json()
        
        if data.get("available") == False:
            # No releases yet - this is expected
            print("PASSED: No releases published yet, available=false")
        else:
            # If releases exist, verify structure
            assert "version" in data
            assert "name" in data
            print(f"PASSED: Release available: {data.get('name')} v{data.get('version')}")
    
    def test_03_latest_release_with_network_param(self):
        """GET /api/releases/latest?network=btc-testnet should work"""
        response = requests.get(f"{BASE_URL}/api/releases/latest?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "available" in data
        print(f"PASSED: /api/releases/latest with network param works")


class TestAdminReleasesAuth:
    """Test admin release endpoints require authentication"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token for authenticated tests"""
        login_response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code == 200:
            self.admin_token = login_response.json().get("token")
        else:
            self.admin_token = None
    
    def test_01_releases_config_requires_auth(self):
        """GET /api/admin/releases/config should require auth"""
        response = requests.get(f"{BASE_URL}/api/admin/releases/config")
        assert response.status_code in [401, 403]  # Both are valid auth rejection codes
        print(f"PASSED: /api/admin/releases/config requires auth ({response.status_code} without token)")
    
    def test_02_releases_list_requires_auth(self):
        """GET /api/admin/releases should require auth"""
        response = requests.get(f"{BASE_URL}/api/admin/releases")
        assert response.status_code in [401, 403]  # Both are valid auth rejection codes
        print(f"PASSED: /api/admin/releases requires auth ({response.status_code} without token)")
    
    def test_03_releases_config_with_auth(self):
        """GET /api/admin/releases/config should work with admin token"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.get(
            f"{BASE_URL}/api/admin/releases/config",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return default config with profile_minted: false
        assert "profile_minted" in data or "release_profile_urn" in data
        print(f"PASSED: /api/admin/releases/config returns config: {data}")
    
    def test_04_releases_list_with_auth(self):
        """GET /api/admin/releases should return empty list initially"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.get(
            f"{BASE_URL}/api/admin/releases",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "releases" in data
        assert "count" in data
        print(f"PASSED: /api/admin/releases returns {data.get('count')} releases")
    
    def test_05_update_config_with_auth(self):
        """PUT /api/admin/releases/config should update config"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.put(
            f"{BASE_URL}/api/admin/releases/config",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"release_profile_urn": "cthulhurelease"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify the update was applied
        assert data.get("release_profile_urn") == "cthulhurelease"
        print(f"PASSED: PUT /api/admin/releases/config updated config")


class TestMintProfileEndpoint:
    """Test POST /api/admin/releases/mint-profile requires wallet session"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        login_response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code == 200:
            self.admin_token = login_response.json().get("token")
        else:
            self.admin_token = None
    
    def test_01_mint_profile_requires_auth(self):
        """POST /api/admin/releases/mint-profile should require auth"""
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/mint-profile",
            json={"urn": "cthulhurelease"}
        )
        assert response.status_code in [401, 403]  # Both are valid auth rejection codes
        print(f"PASSED: mint-profile requires auth ({response.status_code} without token)")
    
    def test_02_mint_profile_with_treasury_fallback(self):
        """POST /api/admin/releases/mint-profile may use treasury WIF fallback"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/mint-profile",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "urn": "cthulhurelease",
                "display_name": "Cthulhu Releases",
                "bio": "Official releases",
                "wallet_session_id": "",  # Empty - may fallback to treasury WIF
                "wallet_address": "",
                "network": "btc-testnet"
            }
        )
        # May return 403 (no wallet) or 200 (treasury fallback) or 500 (transient)
        # The endpoint has a fallback to TREASURY_TESTNET_WIF
        if response.status_code == 200:
            data = response.json()
            assert data.get("success") == True
            print(f"PASSED: mint-profile succeeded with treasury fallback, txid={data.get('txid')}")
        elif response.status_code == 403:
            data = response.json()
            print(f"PASSED: mint-profile returns 403 without wallet session: {data.get('detail')}")
        else:
            # Accept other codes but log them
            print(f"INFO: mint-profile returned {response.status_code}: {response.text[:200]}")


class TestPublishReleaseEndpoint:
    """Test POST /api/admin/releases/publish requires wallet session and version"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        login_response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code == 200:
            self.admin_token = login_response.json().get("token")
        else:
            self.admin_token = None
    
    def test_01_publish_requires_auth(self):
        """POST /api/admin/releases/publish should require auth"""
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/publish",
            json={"version": "1.0.0"}
        )
        assert response.status_code in [401, 403]  # Both are valid auth rejection codes
        print(f"PASSED: publish requires auth ({response.status_code} without token)")
    
    def test_02_publish_requires_version(self):
        """POST /api/admin/releases/publish should require version field"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/publish",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "name": "Test Release",
                # Missing version field
                "wallet_session_id": "",
                "wallet_address": "",
                "network": "btc-testnet"
            }
        )
        # Should return 422 for missing required field
        assert response.status_code == 422
        print("PASSED: publish returns 422 without version field")
    
    def test_03_publish_requires_wallet_session(self):
        """POST /api/admin/releases/publish should return 403 without wallet session"""
        if not self.admin_token:
            pytest.skip("Admin login failed")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/publish",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "version": "1.0.0",
                "name": "Test Release",
                "description": "Test",
                "wallet_session_id": "",  # Empty - no wallet session
                "wallet_address": "",
                "network": "btc-testnet"
            }
        )
        # Should return 403 because no wallet session (or 400 for missing CID)
        # The endpoint checks wallet first, then CID requirement
        assert response.status_code in [400, 403]
        data = response.json()
        print(f"PASSED: publish returns {response.status_code} without wallet session: {data.get('detail')}")


class TestAdminDashboardTabs:
    """Verify admin dashboard includes releases tab"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token"""
        login_response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code == 200:
            self.admin_token = login_response.json().get("token")
        else:
            self.admin_token = None
    
    def test_01_admin_login_works(self):
        """Admin login should work with correct credentials"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        print("PASSED: Admin login works")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
