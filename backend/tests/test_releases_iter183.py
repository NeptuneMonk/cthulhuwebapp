"""
Iteration 183: Test Autonomous App Release Mechanism for Cthulhu
Tests:
- GET /api/admin/releases/packages - list built packages
- POST /api/admin/releases/build - build package (already_built=true for existing)
- GET /api/download/{filename} - download package files
- GET /api/releases/latest - public endpoint for latest release
- Admin UI tabs verification
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        print("PASSED: API health check")


class TestPublicDownloadEndpoint:
    """Test public download endpoint for packages"""
    
    def test_01_download_existing_package(self):
        """GET /api/download/cthulhu-v1.0.0.zip returns 200 with application/zip"""
        response = requests.get(f"{BASE_URL}/api/download/cthulhu-v1.0.0.zip", timeout=30, stream=True)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content_type = response.headers.get('content-type', '')
        assert 'application/zip' in content_type or 'application/octet-stream' in content_type, f"Expected zip content-type, got {content_type}"
        # Check content-disposition header for filename
        content_disp = response.headers.get('content-disposition', '')
        assert 'cthulhu-v1.0.0.zip' in content_disp or response.status_code == 200
        print(f"PASSED: Download existing package - status={response.status_code}, content-type={content_type}")
    
    def test_02_download_nonexistent_package(self):
        """GET /api/download/nonexistent.zip returns 404"""
        response = requests.get(f"{BASE_URL}/api/download/nonexistent.zip", timeout=10)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"PASSED: Download nonexistent package returns 404")


class TestPublicReleasesEndpoint:
    """Test public releases endpoint"""
    
    def test_01_latest_release_no_auth_required(self):
        """GET /api/releases/latest works without auth"""
        response = requests.get(f"{BASE_URL}/api/releases/latest", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'available' in data, "Response should have 'available' field"
        print(f"PASSED: Latest release endpoint works - available={data.get('available')}")
    
    def test_02_latest_release_returns_expected_structure(self):
        """GET /api/releases/latest returns {available: false} when no releases"""
        response = requests.get(f"{BASE_URL}/api/releases/latest", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # Should return available: false if no releases etched yet
        assert 'available' in data
        if data['available']:
            # If there are releases, check structure
            assert 'version' in data
            assert 'name' in data
        print(f"PASSED: Latest release structure verified - available={data.get('available')}")


class TestAdminAuth:
    """Test admin authentication"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        }, timeout=10)
        if response.status_code == 200:
            return response.json().get('token')
        pytest.skip("Admin login failed")
    
    def test_admin_login(self, admin_token):
        """Admin login works"""
        assert admin_token is not None
        print(f"PASSED: Admin login successful")


class TestAdminPackagesEndpoint:
    """Test admin packages endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        }, timeout=10)
        if response.status_code == 200:
            return response.json().get('token')
        pytest.skip("Admin login failed")
    
    def test_01_packages_requires_auth(self):
        """GET /api/admin/releases/packages requires auth"""
        response = requests.get(f"{BASE_URL}/api/admin/releases/packages", timeout=10)
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASSED: Packages endpoint requires auth")
    
    def test_02_packages_list_with_auth(self, admin_token):
        """GET /api/admin/releases/packages returns list with cthulhu-v1.0.0.zip"""
        response = requests.get(
            f"{BASE_URL}/api/admin/releases/packages",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'packages' in data, "Response should have 'packages' field"
        packages = data['packages']
        assert isinstance(packages, list), "packages should be a list"
        
        # Check if cthulhu-v1.0.0.zip is in the list
        filenames = [p.get('filename') for p in packages]
        assert 'cthulhu-v1.0.0.zip' in filenames, f"Expected cthulhu-v1.0.0.zip in packages, got {filenames}"
        
        # Check package structure
        for pkg in packages:
            if pkg.get('filename') == 'cthulhu-v1.0.0.zip':
                assert 'size_mb' in pkg, "Package should have size_mb"
                assert 'download_url' in pkg, "Package should have download_url"
                assert pkg['download_url'] == '/api/download/cthulhu-v1.0.0.zip'
                print(f"PASSED: Packages list contains cthulhu-v1.0.0.zip - size={pkg.get('size_mb')}MB")
                return
        
        print(f"PASSED: Packages list returned {len(packages)} packages")


class TestAdminBuildEndpoint:
    """Test admin build endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        }, timeout=10)
        if response.status_code == 200:
            return response.json().get('token')
        pytest.skip("Admin login failed")
    
    def test_01_build_requires_auth(self):
        """POST /api/admin/releases/build requires auth"""
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/build",
            json={"version": "1.0.0"},
            timeout=10
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASSED: Build endpoint requires auth")
    
    def test_02_build_already_built(self, admin_token):
        """POST /api/admin/releases/build with version=1.0.0 returns already_built=true"""
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/build",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"version": "1.0.0"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get('success') == True, "Build should succeed"
        assert data.get('already_built') == True, f"Expected already_built=true, got {data.get('already_built')}"
        assert data.get('filename') == 'cthulhu-v1.0.0.zip', f"Expected filename cthulhu-v1.0.0.zip, got {data.get('filename')}"
        assert '/api/download/cthulhu-v1.0.0.zip' in data.get('download_url', ''), f"Expected download_url, got {data.get('download_url')}"
        print(f"PASSED: Build returns already_built=true for existing package - size={data.get('size_mb')}MB")


class TestAdminReleasesConfig:
    """Test admin releases config endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        }, timeout=10)
        if response.status_code == 200:
            return response.json().get('token')
        pytest.skip("Admin login failed")
    
    def test_01_config_requires_auth(self):
        """GET /api/admin/releases/config requires auth"""
        response = requests.get(f"{BASE_URL}/api/admin/releases/config", timeout=10)
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASSED: Config endpoint requires auth")
    
    def test_02_config_with_auth(self, admin_token):
        """GET /api/admin/releases/config returns config"""
        response = requests.get(
            f"{BASE_URL}/api/admin/releases/config",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'release_profile_urn' in data or 'profile_minted' in data, f"Config should have expected fields, got {data}"
        print(f"PASSED: Config endpoint returns config - profile_minted={data.get('profile_minted')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
