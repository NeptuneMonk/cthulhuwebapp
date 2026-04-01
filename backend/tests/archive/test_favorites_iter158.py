"""
Test suite for Media Library (Favorites) API - Iteration 158
Tests: GET /api/favorites/{address}, POST /api/favorites/add, /remove, /play, /playlist, /playlist/add-item, /playlist/remove-item, /playlist/delete
"""
import pytest
import requests
import os
import time
from uuid import uuid4

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_PREFIX = f"TEST_favorites_{int(time.time())}_"


class TestFavoritesAPI:
    """Test suite for /api/favorites endpoints"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.test_address = f"{TEST_PREFIX}addr_{uuid4().hex[:8]}"
        self.network = "btc-testnet"
        yield
        # Cleanup not strictly needed as we use unique addresses

    def test_get_empty_library_for_new_user(self):
        """GET /api/favorites/{address} returns empty favorites and playlists for new users"""
        response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["address"] == self.test_address
        assert data["network"] == self.network
        assert data["favorites"] == []
        assert data["playlists"] == []
        print(f"PASSED: GET empty library returns correct structure")

    def test_add_favorite_creates_item(self):
        """POST /api/favorites/add creates a new favorite with correct fields"""
        payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/test123/audio.mp3",
            "fallbackUrl": "https://ipfs.io/ipfs/test123",
            "name": "Test Audio Track",
            "type": "audio",
            "chain": "BTC-Testnet",
            "image": "https://example.com/image.jpg",
            "imageFallback": "https://example.com/image_fallback.jpg"
        }
        response = requests.post(f"{BASE_URL}/api/favorites/add", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["success"] is True
        assert "item" in data
        item = data["item"]
        assert "id" in item
        assert item["url"] == payload["url"]
        assert item["name"] == payload["name"]
        assert item["type"] == payload["type"]
        assert item["playCount"] == 0
        assert item["lastPlayed"] is None
        assert "addedAt" in item
        print(f"PASSED: Add favorite creates item with correct fields")

    def test_add_favorite_and_verify_persistence(self):
        """POST /api/favorites/add then GET to verify data persisted"""
        payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/persist123/video.mp4",
            "name": "Persistence Test Video",
            "type": "video"
        }
        add_response = requests.post(f"{BASE_URL}/api/favorites/add", json=payload)
        assert add_response.status_code == 200
        item_id = add_response.json()["item"]["id"]

        # Verify with GET
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert len(data["favorites"]) == 1
        assert data["favorites"][0]["id"] == item_id
        assert data["favorites"][0]["url"] == payload["url"]
        print(f"PASSED: Favorite persisted and retrieved correctly")

    def test_duplicate_add_returns_already_favorited(self):
        """POST /api/favorites/add with same URL returns 'Already favorited' message"""
        payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/duplicate123/audio.mp3",
            "name": "Duplicate Test",
            "type": "audio"
        }
        # First add
        response1 = requests.post(f"{BASE_URL}/api/favorites/add", json=payload)
        assert response1.status_code == 200
        assert "item" in response1.json()

        # Second add (duplicate)
        response2 = requests.post(f"{BASE_URL}/api/favorites/add", json=payload)
        assert response2.status_code == 200
        data = response2.json()
        assert data["success"] is True
        assert data.get("message") == "Already favorited"
        assert "item" not in data  # No new item created
        print(f"PASSED: Duplicate add returns 'Already favorited'")

    def test_remove_favorite(self):
        """POST /api/favorites/remove removes a favorite by id"""
        # First add a favorite
        add_payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/remove123/audio.mp3",
            "name": "To Be Removed",
            "type": "audio"
        }
        add_response = requests.post(f"{BASE_URL}/api/favorites/add", json=add_payload)
        assert add_response.status_code == 200
        item_id = add_response.json()["item"]["id"]

        # Remove it
        remove_payload = {
            "address": self.test_address,
            "network": self.network,
            "id": item_id
        }
        remove_response = requests.post(f"{BASE_URL}/api/favorites/remove", json=remove_payload)
        assert remove_response.status_code == 200
        assert remove_response.json()["success"] is True

        # Verify removal
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert len(data["favorites"]) == 0
        print(f"PASSED: Remove favorite works correctly")

    def test_record_play_increments_count(self):
        """POST /api/favorites/play increments playCount and sets lastPlayed"""
        # First add a favorite
        add_payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/play123/audio.mp3",
            "name": "Play Count Test",
            "type": "audio"
        }
        add_response = requests.post(f"{BASE_URL}/api/favorites/add", json=add_payload)
        assert add_response.status_code == 200
        item_id = add_response.json()["item"]["id"]

        # Record play
        play_payload = {
            "address": self.test_address,
            "network": self.network,
            "id": item_id
        }
        play_response = requests.post(f"{BASE_URL}/api/favorites/play", json=play_payload)
        assert play_response.status_code == 200
        assert play_response.json()["success"] is True

        # Verify playCount incremented
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert len(data["favorites"]) == 1
        assert data["favorites"][0]["playCount"] == 1
        assert data["favorites"][0]["lastPlayed"] is not None

        # Record another play
        requests.post(f"{BASE_URL}/api/favorites/play", json=play_payload)
        get_response2 = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response2.json()["favorites"][0]["playCount"] == 2
        print(f"PASSED: Record play increments count and sets lastPlayed")

    def test_create_playlist(self):
        """POST /api/favorites/playlist creates a new playlist"""
        payload = {
            "address": self.test_address,
            "network": self.network,
            "name": "My Test Playlist"
        }
        response = requests.post(f"{BASE_URL}/api/favorites/playlist", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["success"] is True
        assert "id" in data
        print(f"PASSED: Create playlist returns success with id")

    def test_create_playlist_and_verify_persistence(self):
        """POST /api/favorites/playlist then GET to verify persistence"""
        payload = {
            "address": self.test_address,
            "network": self.network,
            "name": "Persistent Playlist"
        }
        create_response = requests.post(f"{BASE_URL}/api/favorites/playlist", json=payload)
        assert create_response.status_code == 200
        playlist_id = create_response.json()["id"]

        # Verify with GET
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert len(data["playlists"]) == 1
        assert data["playlists"][0]["id"] == playlist_id
        assert data["playlists"][0]["name"] == "Persistent Playlist"
        assert data["playlists"][0]["itemIds"] == []
        print(f"PASSED: Playlist persisted and retrieved correctly")

    def test_add_item_to_playlist(self):
        """POST /api/favorites/playlist/add-item adds item to playlist"""
        # Create a favorite first
        fav_payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/playlist123/audio.mp3",
            "name": "Playlist Item",
            "type": "audio"
        }
        fav_response = requests.post(f"{BASE_URL}/api/favorites/add", json=fav_payload)
        assert fav_response.status_code == 200
        item_id = fav_response.json()["item"]["id"]

        # Create a playlist
        pl_payload = {
            "address": self.test_address,
            "network": self.network,
            "name": "Add Item Test Playlist"
        }
        pl_response = requests.post(f"{BASE_URL}/api/favorites/playlist", json=pl_payload)
        assert pl_response.status_code == 200
        playlist_id = pl_response.json()["id"]

        # Add item to playlist
        add_item_payload = {
            "address": self.test_address,
            "network": self.network,
            "playlistId": playlist_id,
            "itemId": item_id
        }
        add_item_response = requests.post(f"{BASE_URL}/api/favorites/playlist/add-item", json=add_item_payload)
        assert add_item_response.status_code == 200
        assert add_item_response.json()["success"] is True

        # Verify item in playlist
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        assert get_response.status_code == 200
        data = get_response.json()
        playlist = next((p for p in data["playlists"] if p["id"] == playlist_id), None)
        assert playlist is not None
        assert item_id in playlist["itemIds"]
        print(f"PASSED: Add item to playlist works correctly")

    def test_remove_item_from_playlist(self):
        """POST /api/favorites/playlist/remove-item removes item from playlist"""
        # Create a favorite
        fav_payload = {
            "address": self.test_address,
            "network": self.network,
            "url": "https://ipfs.io/ipfs/remove_pl123/audio.mp3",
            "name": "Remove From Playlist Item",
            "type": "audio"
        }
        fav_response = requests.post(f"{BASE_URL}/api/favorites/add", json=fav_payload)
        item_id = fav_response.json()["item"]["id"]

        # Create a playlist with the item
        pl_payload = {
            "address": self.test_address,
            "network": self.network,
            "name": "Remove Item Test Playlist",
            "itemIds": [item_id]
        }
        pl_response = requests.post(f"{BASE_URL}/api/favorites/playlist", json=pl_payload)
        playlist_id = pl_response.json()["id"]

        # Add item to playlist first (since itemIds in create might not work)
        add_item_payload = {
            "address": self.test_address,
            "network": self.network,
            "playlistId": playlist_id,
            "itemId": item_id
        }
        requests.post(f"{BASE_URL}/api/favorites/playlist/add-item", json=add_item_payload)

        # Remove item from playlist
        remove_item_payload = {
            "address": self.test_address,
            "network": self.network,
            "playlistId": playlist_id,
            "itemId": item_id
        }
        remove_response = requests.post(f"{BASE_URL}/api/favorites/playlist/remove-item", json=remove_item_payload)
        assert remove_response.status_code == 200
        assert remove_response.json()["success"] is True

        # Verify item removed
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        data = get_response.json()
        playlist = next((p for p in data["playlists"] if p["id"] == playlist_id), None)
        assert playlist is not None
        assert item_id not in playlist["itemIds"]
        print(f"PASSED: Remove item from playlist works correctly")

    def test_delete_playlist(self):
        """POST /api/favorites/playlist/delete deletes a playlist"""
        # Create a playlist
        pl_payload = {
            "address": self.test_address,
            "network": self.network,
            "name": "To Be Deleted Playlist"
        }
        pl_response = requests.post(f"{BASE_URL}/api/favorites/playlist", json=pl_payload)
        playlist_id = pl_response.json()["id"]

        # Delete playlist
        delete_payload = {
            "address": self.test_address,
            "network": self.network,
            "id": playlist_id
        }
        delete_response = requests.post(f"{BASE_URL}/api/favorites/playlist/delete", json=delete_payload)
        assert delete_response.status_code == 200
        assert delete_response.json()["success"] is True

        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network={self.network}")
        data = get_response.json()
        playlist = next((p for p in data["playlists"] if p["id"] == playlist_id), None)
        assert playlist is None
        print(f"PASSED: Delete playlist works correctly")

    def test_network_isolation(self):
        """Different networks have separate favorites"""
        # Add favorite on testnet
        payload_testnet = {
            "address": self.test_address,
            "network": "btc-testnet",
            "url": "https://ipfs.io/ipfs/testnet123/audio.mp3",
            "name": "Testnet Audio",
            "type": "audio"
        }
        requests.post(f"{BASE_URL}/api/favorites/add", json=payload_testnet)

        # Add favorite on mainnet
        payload_mainnet = {
            "address": self.test_address,
            "network": "btc-mainnet",
            "url": "https://ipfs.io/ipfs/mainnet123/audio.mp3",
            "name": "Mainnet Audio",
            "type": "audio"
        }
        requests.post(f"{BASE_URL}/api/favorites/add", json=payload_mainnet)

        # Verify testnet has only testnet favorite
        testnet_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network=btc-testnet")
        testnet_data = testnet_response.json()
        assert len(testnet_data["favorites"]) == 1
        assert testnet_data["favorites"][0]["name"] == "Testnet Audio"

        # Verify mainnet has only mainnet favorite
        mainnet_response = requests.get(f"{BASE_URL}/api/favorites/{self.test_address}?network=btc-mainnet")
        mainnet_data = mainnet_response.json()
        assert len(mainnet_data["favorites"]) == 1
        assert mainnet_data["favorites"][0]["name"] == "Mainnet Audio"
        print(f"PASSED: Network isolation works correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
