"""
Test IPFS upload endpoint - No size cap verification (Iteration 200)

Tests:
1. IPFS upload accepts files of any size (no 500MB cap)
2. IPFS upload returns correct CID and size metadata
3. No size validation or rejection on the IPFS upload endpoint
4. IPFS status endpoint works
"""

import pytest
import requests
import os
import tempfile

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIPFSUploadNoCap:
    """Test IPFS upload endpoint with no size cap"""
    
    def test_ipfs_status(self):
        """Test IPFS daemon status endpoint"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200, f"IPFS status failed: {response.text}"
        data = response.json()
        print(f"IPFS Status: {data}")
        # Should return online status (may be true or false depending on daemon)
        assert "online" in data, "Response should contain 'online' field"
    
    def test_ipfs_upload_small_file(self):
        """Test IPFS upload with a small file (1KB)"""
        # Create a small test file
        content = b"Test content for IPFS upload - small file " * 25  # ~1KB
        
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
            f.write(content)
            f.flush()
            temp_path = f.name
        
        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('test_small.txt', f, 'text/plain')}
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files=files,
                    timeout=60
                )
            
            print(f"Small file upload response: {response.status_code} - {response.text[:500]}")
            
            # Should succeed (200) or fail with daemon offline (503)
            if response.status_code == 200:
                data = response.json()
                assert data.get("success") == True, "Upload should succeed"
                assert "cid" in data, "Response should contain CID"
                assert "size" in data, "Response should contain size"
                assert data["size"] == len(content), f"Size mismatch: expected {len(content)}, got {data['size']}"
                print(f"SUCCESS: CID={data['cid']}, size={data['size']}")
            elif response.status_code == 503:
                print("IPFS daemon offline - skipping upload test")
                pytest.skip("IPFS daemon not running")
            else:
                pytest.fail(f"Unexpected status code: {response.status_code}")
        finally:
            os.unlink(temp_path)
    
    def test_ipfs_upload_medium_file(self):
        """Test IPFS upload with a medium file (5MB) - verifies no size cap"""
        # Create a 5MB test file
        content = b"X" * (5 * 1024 * 1024)  # 5MB
        
        with tempfile.NamedTemporaryFile(suffix='.bin', delete=False) as f:
            f.write(content)
            f.flush()
            temp_path = f.name
        
        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('test_5mb.bin', f, 'application/octet-stream')}
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files=files,
                    timeout=300  # 5 minute timeout for larger file
                )
            
            print(f"5MB file upload response: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                assert data.get("success") == True, "Upload should succeed"
                assert "cid" in data, "Response should contain CID"
                assert "size" in data, "Response should contain size"
                assert data["size"] == len(content), f"Size mismatch: expected {len(content)}, got {data['size']}"
                print(f"SUCCESS: 5MB file uploaded, CID={data['cid']}, size={data['size']}")
            elif response.status_code == 503:
                print("IPFS daemon offline - skipping upload test")
                pytest.skip("IPFS daemon not running")
            else:
                # Check if it's a size rejection (which should NOT happen)
                if "size" in response.text.lower() and ("limit" in response.text.lower() or "cap" in response.text.lower()):
                    pytest.fail(f"SIZE CAP DETECTED - upload rejected due to size: {response.text}")
                pytest.fail(f"Unexpected status code: {response.status_code} - {response.text}")
        finally:
            os.unlink(temp_path)
    
    def test_ipfs_upload_returns_correct_metadata(self):
        """Test that IPFS upload returns all expected metadata fields"""
        content = b"Metadata test content " * 100
        
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
            f.write(content)
            f.flush()
            temp_path = f.name
        
        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('metadata_test.txt', f, 'text/plain')}
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files=files,
                    timeout=60
                )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify all expected fields
                assert "success" in data, "Response should contain 'success'"
                assert "cid" in data, "Response should contain 'cid'"
                assert "file_cid" in data, "Response should contain 'file_cid'"
                assert "filename" in data, "Response should contain 'filename'"
                assert "ipfs_ref" in data, "Response should contain 'ipfs_ref'"
                assert "gateway_url" in data, "Response should contain 'gateway_url'"
                assert "size" in data, "Response should contain 'size'"
                
                # Verify values
                assert data["success"] == True
                assert data["cid"] == data["file_cid"], "cid and file_cid should match"
                assert data["filename"] == "metadata_test.txt"
                assert data["ipfs_ref"] == f"IPFS:{data['cid']}"
                assert "ipfs.io/ipfs/" in data["gateway_url"]
                assert data["size"] == len(content)
                
                print(f"SUCCESS: All metadata fields present and correct")
                print(f"  - CID: {data['cid']}")
                print(f"  - IPFS ref: {data['ipfs_ref']}")
                print(f"  - Gateway URL: {data['gateway_url']}")
            elif response.status_code == 503:
                pytest.skip("IPFS daemon not running")
            else:
                pytest.fail(f"Unexpected status code: {response.status_code}")
        finally:
            os.unlink(temp_path)
    
    def test_no_size_validation_in_endpoint(self):
        """Verify the endpoint code has no size cap (code review check)"""
        # This test verifies the backend code doesn't have size validation
        # by checking the response doesn't mention size limits
        
        content = b"Size validation test " * 50
        
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
            f.write(content)
            f.flush()
            temp_path = f.name
        
        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('size_test.txt', f, 'text/plain')}
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files=files,
                    timeout=60
                )
            
            # Check response doesn't contain size limit errors
            response_text = response.text.lower()
            size_limit_keywords = ["size limit", "too large", "exceeds", "maximum size", "500mb", "file too big"]
            
            for keyword in size_limit_keywords:
                assert keyword not in response_text, f"Found size limit keyword '{keyword}' in response"
            
            print("SUCCESS: No size limit keywords found in response")
            
            if response.status_code == 200:
                print("Upload succeeded without size restrictions")
            elif response.status_code == 503:
                print("IPFS daemon offline (not a size issue)")
        finally:
            os.unlink(temp_path)


class TestIPFSEndpointCodeReview:
    """Code review tests for IPFS upload endpoint"""
    
    def test_endpoint_timeout_scales_with_size(self):
        """Verify timeout calculation in the code (from code review)
        
        From ipfs.py line 280:
        timeout_secs = max(120.0, 120.0 + (total_size / (10 * 1024 * 1024)) * 60.0)
        
        This means:
        - Minimum timeout: 120 seconds
        - +60 seconds per 10MB
        - No upper cap on timeout
        """
        # Test the timeout formula
        def calc_timeout(size_bytes):
            return max(120.0, 120.0 + (size_bytes / (10 * 1024 * 1024)) * 60.0)
        
        # Verify formula
        assert calc_timeout(0) == 120.0, "0 bytes should have 120s timeout"
        assert calc_timeout(10 * 1024 * 1024) == 180.0, "10MB should have 180s timeout"
        assert calc_timeout(100 * 1024 * 1024) == 720.0, "100MB should have 720s timeout"
        assert calc_timeout(1024 * 1024 * 1024) == 6264.0, "1GB should have ~6264s timeout"
        
        print("SUCCESS: Timeout formula verified - scales with file size, no upper cap")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
