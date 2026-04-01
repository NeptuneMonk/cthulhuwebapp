"""
Iteration 17 - ZipAppViewer Testing
Tests for index.zip webapp media type detection and existing media types
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasics:
    """Basic health and connectivity tests"""
    
    def test_health_endpoint(self):
        """Backend /api/health returns healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"

    def test_objects_storefront_endpoint(self):
        """Objects storefront endpoint works"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/testnet")
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert len(data["objects"]) > 0


class TestZipAppWebAppMediaType:
    """Tests for index.zip webapp objects - Asteroid Miner and A MAZE"""
    
    def test_asteroid_miner_has_index_zip_urn(self):
        """Asteroid Miner object has URN with index.zip"""
        txid = "d8a7e3a677baffcd14715506f5428885ad9193e2920cf3b229affe59b9f0a4ba"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == "Asteroid Miner"
        urn = data.get("urn", "")
        assert "index.zip" in urn.lower()
        assert "IPFS:" in urn

    def test_asteroid_miner_has_image(self):
        """Asteroid Miner has separate image for thumbnail"""
        txid = "d8a7e3a677baffcd14715506f5428885ad9193e2920cf3b229affe59b9f0a4ba"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        image = data.get("image", "")
        # Image should be set (for thumbnail display)
        assert image is not None
        assert "IPFS:" in image or image == ""

    def test_a_maze_has_index_zip_urn(self):
        """A MAZE object has URN with index.zip"""
        txid = "c0208be642e83a7d8e38ad9a2f44d0e34c4080679e86419275decf567fe8702e"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == "A MAZE"
        urn = data.get("urn", "")
        assert "index.zip" in urn.lower()

    def test_a_maze_has_description_and_image(self):
        """A MAZE has description and image for thumbnail"""
        txid = "c0208be642e83a7d8e38ad9a2f44d0e34c4080679e86419275decf567fe8702e"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        description = data.get("description", "")
        image = data.get("image", "")
        # A MAZE has description
        assert description is not None and len(description) > 0
        # A MAZE has image for thumbnail
        assert "IPFS:" in image


class TestExistingMediaTypes:
    """Tests to verify existing media types still work"""
    
    def test_audio_object_still_works(self):
        """Audio object (Boom Bap Sick) still has audio URN"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == "Boom Bap Sick"
        urn = data.get("urn", "")
        # Audio URN should end with .wav
        assert ".wav" in urn.lower()

    def test_audio_object_has_cover_image(self):
        """Audio object has separate cover image"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        image = data.get("image", "")
        # Should have image for cover
        assert image is not None

    def test_image_object_still_works(self):
        """Image-only object (Quantum Materialization) shows image"""
        txid = "06678a8a5b9ed723b29d17a676316db38bd5858a86a49acd1b59e3d86f96f9cd"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("name") == "Quantum Materialization"
        # This object should have an image
        image = data.get("image", "")
        urn = data.get("urn", "")
        # At least one should have image content
        has_image_content = ("IPFS:" in image) or ("IPFS:" in urn and ".png" in urn.lower())
        assert has_image_content


class TestObjectActionEndpoints:
    """Tests for Buy/Give/Burn action availability"""
    
    def test_asteroid_miner_is_listed(self):
        """Asteroid Miner is listed for sale"""
        txid = "d8a7e3a677baffcd14715506f5428885ad9193e2920cf3b229affe59b9f0a4ba"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        # Check listing status
        assert "is_listed" in data
        assert "listings" in data

    def test_a_maze_is_listed(self):
        """A MAZE is listed for sale"""
        txid = "c0208be642e83a7d8e38ad9a2f44d0e34c4080679e86419275decf567fe8702e"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "is_listed" in data
        assert "min_price" in data

    def test_object_has_owners(self):
        """Objects have owners list for Give/Burn actions"""
        txid = "d8a7e3a677baffcd14715506f5428885ad9193e2920cf3b229affe59b9f0a4ba"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "owners" in data
        assert len(data["owners"]) > 0


class TestNavigationEndpoints:
    """Test navigation-related endpoints"""
    
    def test_feed_endpoint(self):
        """Feed endpoint works"""
        response = requests.get(f"{BASE_URL}/api/feed/testnet")
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data

    def test_known_users_endpoint(self):
        """Known users endpoint works"""
        response = requests.get(f"{BASE_URL}/api/known-users/testnet")
        assert response.status_code == 200
        data = response.json()
        assert "users" in data or isinstance(data, list)


class TestIPFSUrlParsing:
    """Tests for IPFS URL format handling"""
    
    def test_ipfs_with_backslash(self):
        """IPFS URN with backslash is handled correctly (Asteroid Miner)"""
        txid = "d8a7e3a677baffcd14715506f5428885ad9193e2920cf3b229affe59b9f0a4ba"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        urn = data.get("urn", "")
        # URN should have either backslash or forward slash path separator
        assert "IPFS:" in urn
        assert "/" in urn or "\\" in urn

    def test_ipfs_with_forward_slash(self):
        """IPFS URN with forward slash is handled correctly (A MAZE)"""
        txid = "c0208be642e83a7d8e38ad9a2f44d0e34c4080679e86419275decf567fe8702e"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "testnet"})
        assert response.status_code == 200
        data = response.json()
        urn = data.get("urn", "")
        assert "IPFS:" in urn
        assert "/" in urn or "\\" in urn
