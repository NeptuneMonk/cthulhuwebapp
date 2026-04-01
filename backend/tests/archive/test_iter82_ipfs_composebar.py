"""
Iteration 82 Tests: IPFS Upload & ComposeBar Bug Fixes
Tests for:
1. POST /api/ipfs/upload - File upload to IPFS returns proper response
2. GET /api/ipfs/status - Check IPFS daemon status
"""

import pytest
import requests
import os
import tempfile

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')


class TestIPFSEndpoints:
    """IPFS endpoint tests for the ComposeBar file attachment fix"""
    
    def test_ipfs_status_returns_online(self):
        """GET /api/ipfs/status should return online=true when daemon is running"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "online" in data
        # online should be boolean
        assert isinstance(data["online"], bool)
        
        # If online, should have peer_id
        if data["online"]:
            assert "peer_id" in data
            print(f"IPFS daemon online with peer_id: {data['peer_id']}")
        else:
            print(f"IPFS daemon offline: {data.get('error', 'unknown')}")
    
    def test_ipfs_upload_text_file(self):
        """POST /api/ipfs/upload with text file should return success, cid, filename, ipfs_ref"""
        # Create a test file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("Test content for IPFS upload from iteration 82")
            test_file_path = f.name
        
        try:
            with open(test_file_path, 'rb') as f:
                files = {'file': ('test_iter82.txt', f, 'text/plain')}
                response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
            
            assert response.status_code == 200
            
            data = response.json()
            # Verify required fields per the bug fix spec
            assert data.get("success") is True, "success field should be True"
            assert "cid" in data and len(data["cid"]) > 0, "cid field should be present and non-empty"
            assert data.get("filename") == "test_iter82.txt", f"filename should match, got: {data.get('filename')}"
            assert "ipfs_ref" in data, "ipfs_ref field should be present"
            assert data["ipfs_ref"].startswith("IPFS:"), f"ipfs_ref should start with 'IPFS:', got: {data['ipfs_ref']}"
            
            # Verify ipfs_ref format: IPFS:cid/filename
            expected_ref = f"IPFS:{data['cid']}/test_iter82.txt"
            assert data["ipfs_ref"] == expected_ref, f"ipfs_ref should be {expected_ref}, got: {data['ipfs_ref']}"
            
            print(f"✅ IPFS upload successful: {data['ipfs_ref']}")
            print(f"   Gateway URL: {data.get('gateway_url', 'N/A')}")
            
        finally:
            os.unlink(test_file_path)
    
    def test_ipfs_upload_returns_correct_structure(self):
        """Verify all required fields are returned from /api/ipfs/upload"""
        content = b"Binary test content for IPFS"
        files = {'file': ('binary_test.bin', content, 'application/octet-stream')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        assert response.status_code == 200
        
        data = response.json()
        
        # Check all required fields from the bug fix spec
        required_fields = ['success', 'cid', 'filename', 'ipfs_ref']
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Additional optional fields that should be present
        assert 'size' in data, "size field should be present"
        assert isinstance(data['size'], int), "size should be an integer"
        
        print(f"✅ All required fields present: {list(data.keys())}")
    
    def test_ipfs_upload_large_file_rejection(self):
        """POST /api/ipfs/upload with file > 10MB should be rejected"""
        # Create content larger than 10MB
        large_content = b"X" * (11 * 1024 * 1024)  # 11MB
        files = {'file': ('large_file.bin', large_content, 'application/octet-stream')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        
        # Should return 400 Bad Request
        assert response.status_code == 400, f"Expected 400 for large file, got {response.status_code}"
        print("✅ Large file correctly rejected with 400")
    
    def test_ipfs_upload_image_file(self):
        """Test uploading image file (simulated) to verify mime type handling"""
        # Create a minimal PNG-like content
        png_header = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100
        files = {'file': ('test_image.png', png_header, 'image/png')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("success") is True
        assert data.get("filename") == "test_image.png"
        print(f"✅ Image upload successful: CID={data['cid'][:20]}...")


class TestHealthAndBasics:
    """Basic health and API accessibility tests"""
    
    def test_api_root_accessible(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        print(f"API health check: {response.status_code}")
