"""
IPFS Endpoint Tests - Iteration 57
Tests: IPFS status check and upload functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIPFSEndpoints:
    """Test IPFS status and upload endpoints"""
    
    def test_ipfs_status_returns_online(self):
        """Test GET /api/ipfs/status returns online=true with peer_id"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "online" in data, "Response should contain 'online' field"
        assert data["online"] == True, f"IPFS should be online, got online={data.get('online')}"
        assert "peer_id" in data, "Response should contain 'peer_id' field"
        assert len(data["peer_id"]) > 0, "peer_id should not be empty"
        print(f"SUCCESS: IPFS online with peer_id={data['peer_id'][:20]}...")
        
    def test_ipfs_status_returns_agent_version(self):
        """Test GET /api/ipfs/status returns agent version"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200
        
        data = response.json()
        assert "agent" in data, "Response should contain 'agent' field"
        assert "kubo" in data["agent"].lower(), f"Agent should be kubo, got {data['agent']}"
        print(f"SUCCESS: IPFS agent version: {data['agent']}")
    
    def test_ipfs_upload_text_file(self):
        """Test POST /api/ipfs/upload successfully pins a text file"""
        # Create a test file content
        test_content = b"Test IPFS upload content - iteration 57"
        files = {"file": ("test_iter57.txt", test_content, "text/plain")}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=120)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, f"Upload should succeed, got {data}"
        assert "cid" in data, "Response should contain 'cid'"
        assert data["cid"].startswith("Qm"), f"CID should start with Qm, got {data['cid']}"
        assert "ipfs_ref" in data, "Response should contain 'ipfs_ref'"
        assert data["ipfs_ref"].startswith("IPFS:"), f"ipfs_ref should start with IPFS:, got {data['ipfs_ref']}"
        assert "gateway_url" in data, "Response should contain 'gateway_url'"
        assert "ipfs.io/ipfs/" in data["gateway_url"], f"gateway_url should point to ipfs.io gateway"
        print(f"SUCCESS: Uploaded file with CID={data['cid'][:20]}...")
        print(f"SUCCESS: ipfs_ref={data['ipfs_ref']}")
        print(f"SUCCESS: gateway_url={data['gateway_url']}")
    
    def test_ipfs_upload_image_file(self):
        """Test POST /api/ipfs/upload with a small PNG image"""
        # Minimal valid 1x1 red PNG (67 bytes)
        png_data = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # bit depth, color type
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk header
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,  # compressed data
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,  # CRC
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82                     # IEND CRC
        ])
        files = {"file": ("test_image.png", png_data, "image/png")}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=120)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert "cid" in data
        assert data["filename"] == "test_image.png"
        print(f"SUCCESS: Uploaded image with CID={data['cid'][:20]}...")
    
    def test_ipfs_upload_returns_correct_response_structure(self):
        """Test POST /api/ipfs/upload response has all required fields"""
        test_content = b"Structure test file"
        files = {"file": ("structure_test.txt", test_content, "text/plain")}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=120)
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["success", "cid", "file_cid", "filename", "ipfs_ref", "gateway_url", "size"]
        for field in required_fields:
            assert field in data, f"Response missing required field: {field}"
        
        # Verify types
        assert isinstance(data["success"], bool)
        assert isinstance(data["cid"], str)
        assert isinstance(data["filename"], str)
        assert isinstance(data["ipfs_ref"], str)
        assert isinstance(data["gateway_url"], str)
        assert isinstance(data["size"], int)
        assert data["size"] == len(test_content)
        print(f"SUCCESS: Response structure verified with all {len(required_fields)} required fields")
    
    def test_ipfs_upload_rejects_large_files(self):
        """Test POST /api/ipfs/upload rejects files > 10MB"""
        # Create 11MB content
        large_content = b"x" * (11 * 1024 * 1024)  # 11MB
        files = {"file": ("large_file.bin", large_content, "application/octet-stream")}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=120)
        assert response.status_code == 400, f"Expected 400 for large file, got {response.status_code}"
        
        data = response.json()
        assert "detail" in data
        assert "10MB" in data["detail"] or "too large" in data["detail"].lower()
        print(f"SUCCESS: Large file correctly rejected with message: {data['detail']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
