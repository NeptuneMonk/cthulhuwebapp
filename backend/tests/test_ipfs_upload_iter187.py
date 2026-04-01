"""
Test IPFS upload endpoint for iteration 187.
Verifies that the /api/ipfs/upload endpoint returns:
- cid: The IPFS content identifier
- filename: The original filename
- ipfs_ref: The IPFS reference in format IPFS:cid
"""
import pytest
import requests
import os
import tempfile

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestIPFSUpload:
    """Test IPFS upload endpoint returns correct fields for URN construction"""

    def test_ipfs_upload_returns_cid_and_filename(self):
        """
        Bug fix verification: Upload endpoint must return both 'cid' and 'filename'
        so frontend can construct URN as IPFS:cid/filename
        """
        # Create a test file
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False, mode='w') as f:
            f.write('Test content for IPFS upload verification')
            test_file_path = f.name
            test_filename = os.path.basename(f.name)

        try:
            with open(test_file_path, 'rb') as f:
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files={'file': (test_filename, f, 'text/plain')},
                    timeout=60
                )

            # Status code assertion
            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

            data = response.json()

            # Verify success flag
            assert data.get('success') is True, f"Expected success=True, got {data}"

            # CRITICAL: Verify 'cid' field exists (needed for URN construction)
            assert 'cid' in data, f"Missing 'cid' field in response: {data}"
            assert isinstance(data['cid'], str), f"'cid' should be string, got {type(data['cid'])}"
            assert len(data['cid']) > 0, f"'cid' should not be empty"

            # CRITICAL: Verify 'filename' field exists (needed for URN construction)
            assert 'filename' in data, f"Missing 'filename' field in response: {data}"
            assert isinstance(data['filename'], str), f"'filename' should be string, got {type(data['filename'])}"
            assert len(data['filename']) > 0, f"'filename' should not be empty"

            # Verify 'ipfs_ref' field exists
            assert 'ipfs_ref' in data, f"Missing 'ipfs_ref' field in response: {data}"
            assert data['ipfs_ref'].startswith('IPFS:'), f"'ipfs_ref' should start with 'IPFS:', got {data['ipfs_ref']}"

            # Verify the CID is in the ipfs_ref
            assert data['cid'] in data['ipfs_ref'], f"CID {data['cid']} not found in ipfs_ref {data['ipfs_ref']}"

            print(f"PASSED: Upload returned cid={data['cid'][:20]}..., filename={data['filename']}, ipfs_ref={data['ipfs_ref']}")

        finally:
            os.unlink(test_file_path)

    def test_ipfs_upload_image_returns_correct_fields(self):
        """
        Test image upload returns correct fields for URN construction.
        Frontend constructs URN as: IPFS:cid/filename.jpg
        """
        # Create a minimal valid PNG file (1x1 pixel)
        png_data = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # bit depth, color type
            0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
            0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,  # compressed data
            0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59,
            0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
            0x44, 0xAE, 0x42, 0x60, 0x82
        ])

        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            f.write(png_data)
            test_file_path = f.name

        try:
            with open(test_file_path, 'rb') as f:
                response = requests.post(
                    f"{BASE_URL}/api/ipfs/upload",
                    files={'file': ('test_image.png', f, 'image/png')},
                    timeout=60
                )

            assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

            data = response.json()
            assert data.get('success') is True

            # Verify all required fields for URN construction
            assert 'cid' in data, "Missing 'cid' field"
            assert 'filename' in data, "Missing 'filename' field"
            assert 'ipfs_ref' in data, "Missing 'ipfs_ref' field"

            # Verify filename is preserved
            assert data['filename'] == 'test_image.png', f"Expected filename 'test_image.png', got {data['filename']}"

            # Frontend would construct URN as: IPFS:cid/filename
            expected_urn_format = f"IPFS:{data['cid']}/{data['filename']}"
            print(f"PASSED: Image upload - URN would be constructed as: {expected_urn_format}")

        finally:
            os.unlink(test_file_path)


class TestHealthEndpoint:
    """Basic health check"""

    def test_health_endpoint(self):
        """Verify backend is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print(f"PASSED: Health endpoint returns healthy status")


class TestIPFSStatus:
    """Test IPFS daemon status"""

    def test_ipfs_status_online(self):
        """Verify IPFS daemon is online"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('online') is True, f"IPFS should be online, got {data}"
        print(f"PASSED: IPFS daemon is online, agent={data.get('agent')}")


class TestFeedEndpoint:
    """Test feed endpoint"""

    def test_feed_returns_posts(self):
        """Verify feed endpoint returns posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=5", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert 'feed' in data, f"Missing 'feed' field in response"
        assert isinstance(data['feed'], list), f"'feed' should be a list"
        print(f"PASSED: Feed returns {len(data['feed'])} posts, total={data.get('total')}")
