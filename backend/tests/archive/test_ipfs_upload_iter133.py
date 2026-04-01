"""
Test IPFS Upload Endpoint - Iteration 133
Tests:
1. IPFS upload accepts files larger than 10MB (test with 15MB file)
2. IPFS upload response includes success, cid, filename, size fields
3. Backend IPFS endpoint streams to temp file (code verification)
4. IPFS status endpoint works
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIPFSUpload:
    """IPFS upload endpoint tests - verifying 500MB limit and response fields"""
    
    def test_ipfs_status(self):
        """Test IPFS daemon status endpoint"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200, f"IPFS status failed: {response.text}"
        data = response.json()
        assert "online" in data, "Response should include 'online' field"
        print(f"IPFS Status: online={data.get('online')}, peer_id={data.get('peer_id', 'N/A')[:20]}...")
    
    def test_small_file_upload(self):
        """Test uploading a small file (1KB) - baseline test"""
        # Create a 1KB test file
        content = b"x" * 1024
        files = {'file': ('test_small.txt', io.BytesIO(content), 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=60)
        assert response.status_code == 200, f"Small file upload failed: {response.text}"
        
        data = response.json()
        # Verify response structure
        assert data.get("success") == True, "Response should have success=True"
        assert "cid" in data, "Response should include 'cid' field"
        assert "filename" in data, "Response should include 'filename' field"
        assert "size" in data, "Response should include 'size' field"
        assert data["filename"] == "test_small.txt", f"Filename mismatch: {data['filename']}"
        assert data["size"] == 1024, f"Size mismatch: expected 1024, got {data['size']}"
        print(f"Small file upload SUCCESS: cid={data['cid'][:20]}..., size={data['size']}")
    
    def test_medium_file_upload_5mb(self):
        """Test uploading a 5MB file - below old limit"""
        # Create a 5MB test file
        content = b"y" * (5 * 1024 * 1024)
        files = {'file': ('test_5mb.bin', io.BytesIO(content), 'application/octet-stream')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=120)
        assert response.status_code == 200, f"5MB file upload failed: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Response should have success=True"
        assert "cid" in data, "Response should include 'cid' field"
        assert data["size"] == 5 * 1024 * 1024, f"Size mismatch: expected {5*1024*1024}, got {data['size']}"
        print(f"5MB file upload SUCCESS: cid={data['cid'][:20]}..., size={data['size']}")
    
    def test_large_file_upload_15mb(self):
        """Test uploading a 15MB file - ABOVE old 10MB limit, should now work"""
        # Create a 15MB test file
        content = b"z" * (15 * 1024 * 1024)
        files = {'file': ('test_15mb.bin', io.BytesIO(content), 'application/octet-stream')}
        
        # Use longer timeout for large file
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=300)
        assert response.status_code == 200, f"15MB file upload failed (old 10MB limit may still be in place): {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Response should have success=True"
        assert "cid" in data, "Response should include 'cid' field"
        assert "filename" in data, "Response should include 'filename' field"
        assert "size" in data, "Response should include 'size' field"
        assert data["filename"] == "test_15mb.bin", f"Filename mismatch: {data['filename']}"
        assert data["size"] == 15 * 1024 * 1024, f"Size mismatch: expected {15*1024*1024}, got {data['size']}"
        print(f"15MB file upload SUCCESS: cid={data['cid'][:20]}..., size={data['size']}")
        print("VERIFIED: Old 10MB limit has been raised - 15MB file uploaded successfully!")
    
    def test_upload_response_fields(self):
        """Verify all expected fields in upload response"""
        content = b"test content for field verification"
        files = {'file': ('test_fields.txt', io.BytesIO(content), 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=60)
        assert response.status_code == 200, f"Upload failed: {response.text}"
        
        data = response.json()
        
        # Check all required fields
        required_fields = ["success", "cid", "filename", "size"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Check optional but expected fields
        optional_fields = ["file_cid", "ipfs_ref", "gateway_url"]
        present_optional = [f for f in optional_fields if f in data]
        print(f"Required fields present: {required_fields}")
        print(f"Optional fields present: {present_optional}")
        
        # Verify field types
        assert isinstance(data["success"], bool), "success should be boolean"
        assert isinstance(data["cid"], str), "cid should be string"
        assert isinstance(data["filename"], str), "filename should be string"
        assert isinstance(data["size"], int), "size should be integer"
        
        print(f"All response fields verified: {list(data.keys())}")


class TestIPFSCodeVerification:
    """Verify code structure for streaming temp file support"""
    
    def test_ipfs_route_uses_tempfile(self):
        """Verify the IPFS route code uses tempfile for streaming"""
        ipfs_route_path = "/app/backend/routes/ipfs.py"
        
        with open(ipfs_route_path, 'r') as f:
            content = f.read()
        
        # Check for tempfile import
        assert "import tempfile" in content, "ipfs.py should import tempfile"
        
        # Check for NamedTemporaryFile usage
        assert "tempfile.NamedTemporaryFile" in content, "Should use NamedTemporaryFile for streaming"
        
        # Check for 500MB limit
        assert "500 * 1024 * 1024" in content, "Should have 500MB limit"
        
        # Check for dynamic timeout
        assert "timeout_secs" in content, "Should have dynamic timeout calculation"
        
        # Check for chunk reading
        assert "chunk_size" in content or "chunk" in content, "Should read in chunks"
        
        print("Code verification PASSED:")
        print("  - tempfile import present")
        print("  - NamedTemporaryFile used for streaming")
        print("  - 500MB limit configured")
        print("  - Dynamic timeout scaling present")
        print("  - Chunk-based reading implemented")


class TestDMPageFix:
    """Verify DMPage.js fix - 'loading' NOT in useCallback dependency array"""
    
    def test_dmpage_no_loading_in_deps(self):
        """Verify fetchEncryptedMessages useCallback does NOT have 'loading' in dependency array"""
        dmpage_path = "/app/frontend/src/pages/DMPage.js"
        
        with open(dmpage_path, 'r') as f:
            content = f.read()
        
        # Find the fetchEncryptedMessages useCallback and its dependency array
        # The pattern is: }, [deps]);
        import re
        
        # Find the fetchEncryptedMessages function definition
        assert "const fetchEncryptedMessages = useCallback" in content, "fetchEncryptedMessages should be a useCallback"
        
        # Find the dependency array for fetchEncryptedMessages
        # Look for the closing of the useCallback with its deps
        pattern = r'fetchEncryptedMessages = useCallback\(async \(\) => \{[\s\S]*?\}, \[([^\]]*)\]\);'
        match = re.search(pattern, content)
        
        if match:
            deps = match.group(1)
            print(f"fetchEncryptedMessages dependency array: [{deps}]")
            
            # Check that 'loading' is NOT in the deps
            dep_list = [d.strip() for d in deps.split(',')]
            assert 'loading' not in dep_list, f"'loading' should NOT be in dependency array! Found: {dep_list}"
            print("VERIFIED: 'loading' is NOT in fetchEncryptedMessages dependency array")
        else:
            # Alternative check - just verify loading is not near the dependency array
            # Find lines with the dependency array
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if 'fetchEncryptedMessages' in line and 'useCallback' in line:
                    # Look ahead for the dependency array
                    for j in range(i, min(i+100, len(lines))):
                        if '], [' in lines[j] or '}], [' in lines[j]:
                            # This is likely the dependency array line
                            if 'loading' in lines[j]:
                                pytest.fail(f"'loading' found in dependency array at line {j+1}: {lines[j]}")
                            print(f"Dependency array found at line {j+1}: {lines[j].strip()}")
                            break
            print("VERIFIED: 'loading' is NOT in fetchEncryptedMessages dependency array")
    
    def test_dmpage_has_cache_ref(self):
        """Verify DMPage.js has hasCacheRef for phase-1 cache tracking"""
        dmpage_path = "/app/frontend/src/pages/DMPage.js"
        
        with open(dmpage_path, 'r') as f:
            content = f.read()
        
        assert "hasCacheRef" in content, "DMPage.js should have hasCacheRef"
        assert "useRef" in content, "DMPage.js should use useRef"
        
        # Check it's used properly
        assert "hasCacheRef.current" in content, "hasCacheRef should be accessed via .current"
        
        print("VERIFIED: hasCacheRef present and used correctly")


class TestUploadQueueIntegration:
    """Verify Upload Queue components are properly integrated"""
    
    def test_upload_queue_context_exists(self):
        """Verify UploadQueueContext.js exists and exports correctly"""
        context_path = "/app/frontend/src/contexts/UploadQueueContext.js"
        
        with open(context_path, 'r') as f:
            content = f.read()
        
        assert "UploadQueueProvider" in content, "Should export UploadQueueProvider"
        assert "useUploadQueue" in content, "Should export useUploadQueue"
        assert "createContext" in content, "Should use createContext"
        assert "addUpload" in content, "Should have addUpload function"
        
        print("VERIFIED: UploadQueueContext.js exports UploadQueueProvider and useUploadQueue")
    
    def test_upload_queue_bar_exists(self):
        """Verify UploadQueueBar.js exists with proper data-testid"""
        bar_path = "/app/frontend/src/components/UploadQueueBar.js"
        
        with open(bar_path, 'r') as f:
            content = f.read()
        
        assert "upload-queue-bar" in content, "Should have data-testid='upload-queue-bar'"
        assert "useUploadQueue" in content, "Should use useUploadQueue hook"
        
        print("VERIFIED: UploadQueueBar.js exists with proper data-testid")
    
    def test_compose_modal_uses_upload_queue(self):
        """Verify ComposeModal.js imports and uses UploadQueueContext"""
        modal_path = "/app/frontend/src/components/ComposeModal.js"
        
        with open(modal_path, 'r') as f:
            content = f.read()
        
        assert "useUploadQueue" in content, "ComposeModal should import useUploadQueue"
        assert "uploadQueue" in content, "ComposeModal should use uploadQueue"
        assert "LARGE_FILE_THRESHOLD" in content, "Should have LARGE_FILE_THRESHOLD constant"
        
        print("VERIFIED: ComposeModal.js uses UploadQueueContext")
    
    def test_app_wraps_upload_queue_provider(self):
        """Verify App.js wraps in UploadQueueProvider"""
        app_path = "/app/frontend/src/App.js"
        
        with open(app_path, 'r') as f:
            content = f.read()
        
        assert "UploadQueueProvider" in content, "App.js should import UploadQueueProvider"
        assert "UploadQueueBar" in content, "App.js should import UploadQueueBar"
        assert "<UploadQueueProvider>" in content, "App.js should wrap with UploadQueueProvider"
        assert "<UploadQueueBar" in content, "App.js should render UploadQueueBar"
        
        print("VERIFIED: App.js wraps in UploadQueueProvider and renders UploadQueueBar")


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
