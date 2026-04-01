"""
Iteration 184: Static-Only ZIP Package Tests
=============================================
Tests for the standalone static web app package:
- ZIP download endpoint
- ZIP contents verification (no Python, no Emergent branding, has standalone adapter)
- Admin build/packages endpoints
- Public releases endpoint
"""
import pytest
import requests
import os
import zipfile
import tempfile

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# ─── Health Check ───
class TestHealthCheck:
    def test_api_health(self):
        """Verify API is running"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") in ["ok", "healthy"]
        print(f"✓ API health check passed: {data.get('status')}")


# ─── Public Download Endpoint ───
class TestPublicDownloadEndpoint:
    """Tests for GET /api/download/{filename} - no auth required"""
    
    def test_01_download_existing_package_status(self):
        """GET /api/download/cthulhu-v1.0.0.zip returns 200"""
        response = requests.get(f"{BASE_URL}/api/download/cthulhu-v1.0.0.zip", stream=True)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ Download endpoint returns 200")
    
    def test_02_download_content_type(self):
        """GET /api/download/cthulhu-v1.0.0.zip returns application/zip"""
        response = requests.get(f"{BASE_URL}/api/download/cthulhu-v1.0.0.zip", stream=True)
        content_type = response.headers.get('content-type', '')
        assert 'application/zip' in content_type or 'application/octet-stream' in content_type, \
            f"Expected application/zip, got {content_type}"
        print(f"✓ Content-Type: {content_type}")
    
    def test_03_download_size_approximately_2_4mb(self):
        """GET /api/download/cthulhu-v1.0.0.zip is approximately 2.4MB"""
        response = requests.get(f"{BASE_URL}/api/download/cthulhu-v1.0.0.zip")
        size_mb = len(response.content) / 1024 / 1024
        assert 2.0 <= size_mb <= 3.0, f"Expected ~2.4MB, got {size_mb:.1f}MB"
        print(f"✓ Package size: {size_mb:.1f} MB")
    
    def test_04_download_nonexistent_returns_404(self):
        """GET /api/download/nonexistent.zip returns 404"""
        response = requests.get(f"{BASE_URL}/api/download/nonexistent.zip")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Nonexistent file returns 404")


# ─── ZIP Contents Verification ───
class TestZipContents:
    """Verify the zip contains correct files and no forbidden content"""
    
    @pytest.fixture(scope="class")
    def zip_contents(self):
        """Download and extract zip for inspection"""
        response = requests.get(f"{BASE_URL}/api/download/cthulhu-v1.0.0.zip")
        assert response.status_code == 200
        
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as f:
            f.write(response.content)
            temp_path = f.name
        
        try:
            with zipfile.ZipFile(temp_path, 'r') as z:
                names = z.namelist()
                js_contents = {}
                for name in names:
                    if name.endswith('.js'):
                        js_contents[name] = z.read(name).decode('utf-8', errors='ignore')
                yield {'names': names, 'js_contents': js_contents}
        finally:
            os.unlink(temp_path)
    
    def test_01_has_index_html_at_root(self, zip_contents):
        """ZIP contains index.html at root level (cthulhu-v1.0.0/index.html)"""
        names = zip_contents['names']
        has_root_index = any(n == 'cthulhu-v1.0.0/index.html' for n in names)
        assert has_root_index, f"Missing cthulhu-v1.0.0/index.html. Files: {names[:10]}"
        print("✓ index.html at root level: cthulhu-v1.0.0/index.html")
    
    def test_02_no_python_files(self, zip_contents):
        """ZIP does NOT contain any .py files"""
        names = zip_contents['names']
        py_files = [n for n in names if n.endswith('.py')]
        assert len(py_files) == 0, f"Found Python files: {py_files}"
        print("✓ No .py files in ZIP (static-only build)")
    
    def test_03_no_emergent_referral_link(self, zip_contents):
        """ZIP JS files do NOT contain 'app.emergent.sh' referral link"""
        js_contents = zip_contents['js_contents']
        files_with_emergent = []
        for name, content in js_contents.items():
            if 'app.emergent.sh' in content:
                files_with_emergent.append(name)
        assert len(files_with_emergent) == 0, f"Found app.emergent.sh in: {files_with_emergent}"
        print("✓ No 'app.emergent.sh' referral link in JS files")
    
    def test_04_has_standalone_adapter(self, zip_contents):
        """ZIP DOES contain installStandaloneMode in JS files"""
        js_contents = zip_contents['js_contents']
        files_with_standalone = []
        for name, content in js_contents.items():
            if 'installStandaloneMode' in content:
                files_with_standalone.append(name)
        assert len(files_with_standalone) > 0, "Missing installStandaloneMode in JS files"
        print(f"✓ installStandaloneMode found in: {files_with_standalone}")
    
    def test_05_has_p2fk_routing(self, zip_contents):
        """ZIP DOES contain direct p2fk.io routing"""
        js_contents = zip_contents['js_contents']
        files_with_p2fk = []
        for name, content in js_contents.items():
            if 'p2fk.io' in content:
                files_with_p2fk.append(name)
        assert len(files_with_p2fk) > 0, "Missing p2fk.io routing in JS files"
        print(f"✓ p2fk.io routing found in: {files_with_p2fk}")
    
    def test_06_has_readme(self, zip_contents):
        """ZIP contains README.md"""
        names = zip_contents['names']
        has_readme = any('README.md' in n for n in names)
        assert has_readme, "Missing README.md"
        print("✓ README.md included")


# ─── Admin Build Endpoint ───
class TestAdminBuildEndpoint:
    """Tests for POST /api/admin/releases/build"""
    
    @pytest.fixture(scope="class")
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Admin login failed")
    
    def test_01_build_requires_auth(self):
        """POST /api/admin/releases/build requires auth"""
        response = requests.post(f"{BASE_URL}/api/admin/releases/build", json={"version": "1.0.0"})
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✓ Build endpoint requires auth")
    
    def test_02_build_already_built_returns_true(self, admin_token):
        """POST /api/admin/releases/build returns already_built=true for v1.0.0"""
        response = requests.post(
            f"{BASE_URL}/api/admin/releases/build",
            json={"version": "1.0.0"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("already_built") == True, f"Expected already_built=true, got {data}"
        assert data.get("success") == True
        assert "cthulhu-v1.0.0.zip" in data.get("filename", "")
        print(f"✓ Build returns already_built=true, filename={data.get('filename')}")


# ─── Admin Packages Endpoint ───
class TestAdminPackagesEndpoint:
    """Tests for GET /api/admin/releases/packages"""
    
    @pytest.fixture(scope="class")
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Admin login failed")
    
    def test_01_packages_requires_auth(self):
        """GET /api/admin/releases/packages requires auth"""
        response = requests.get(f"{BASE_URL}/api/admin/releases/packages")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✓ Packages endpoint requires auth")
    
    def test_02_packages_list_contains_v1_0_0(self, admin_token):
        """GET /api/admin/releases/packages returns list with cthulhu-v1.0.0.zip"""
        response = requests.get(
            f"{BASE_URL}/api/admin/releases/packages",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        packages = data.get("packages", [])
        filenames = [p.get("filename") for p in packages]
        assert "cthulhu-v1.0.0.zip" in filenames, f"Missing cthulhu-v1.0.0.zip in {filenames}"
        
        # Check package has expected fields
        pkg = next((p for p in packages if p.get("filename") == "cthulhu-v1.0.0.zip"), None)
        assert pkg is not None
        assert "size_mb" in pkg
        assert "download_url" in pkg
        print(f"✓ Packages list contains cthulhu-v1.0.0.zip ({pkg.get('size_mb')} MB)")


# ─── Public Releases Endpoint ───
class TestPublicReleasesEndpoint:
    """Tests for GET /api/releases/latest - no auth required"""
    
    def test_01_latest_no_auth_required(self):
        """GET /api/releases/latest works without auth"""
        response = requests.get(f"{BASE_URL}/api/releases/latest")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ /api/releases/latest works without auth")
    
    def test_02_latest_returns_expected_structure(self):
        """GET /api/releases/latest returns expected structure"""
        response = requests.get(f"{BASE_URL}/api/releases/latest")
        assert response.status_code == 200
        data = response.json()
        # Should have 'available' field
        assert "available" in data, f"Missing 'available' field in {data}"
        print(f"✓ /api/releases/latest returns available={data.get('available')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
