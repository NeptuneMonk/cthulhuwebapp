"""
Iteration 87: Test Object-Based Chat Rooms (Tethers) Feature
- GET /api/room/{address}/messages endpoint
- Regression tests for feed, objects storefront, profiles
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestRoomMessages:
    """Test the new room messages endpoint for Object-Based Chat Rooms"""
    
    def test_room_messages_endpoint_returns_messages(self):
        """Test GET /api/room/{address}/messages returns messages array"""
        # Known address with messages from the context
        address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(
            f"{BASE_URL}/api/room/{address}/messages",
            params={"network": "btc-testnet", "limit": 100},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "messages" in data, "Response should contain 'messages' key"
        assert "count" in data, "Response should contain 'count' key"
        assert isinstance(data["messages"], list), "messages should be a list"
        
        # Verify messages have required fields
        if len(data["messages"]) > 0:
            msg = data["messages"][0]
            assert "txid" in msg, "Message should have txid"
            assert "content" in msg, "Message should have content"
            assert "sender_address" in msg or "from_address" in msg, "Message should have sender_address or from_address"
            assert "created_at" in msg or "block_date" in msg, "Message should have timestamp"
    
    def test_room_messages_count_matches(self):
        """Test that count field matches actual message array length"""
        address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(
            f"{BASE_URL}/api/room/{address}/messages",
            params={"network": "btc-testnet", "limit": 100},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["count"] == len(data["messages"]), "count should match messages array length"
    
    def test_room_messages_empty_for_unknown_address(self):
        """Test that unknown address returns empty messages array (not error)"""
        response = requests.get(
            f"{BASE_URL}/api/room/unknownaddress12345/messages",
            params={"network": "btc-testnet"},
            timeout=30
        )
        # Should return 200 with empty messages, not error
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        # Could be empty or have data - just verify structure
        assert isinstance(data["messages"], list)


class TestRegressionFeed:
    """Regression tests: Verify feed still works"""
    
    def test_feed_endpoint_returns_feed(self):
        """Test GET /api/feed/{network} returns feed array"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"limit": 5},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "feed" in data, "Response should contain 'feed' key"
        assert isinstance(data["feed"], list), "feed should be a list"
        
        if len(data["feed"]) > 0:
            post = data["feed"][0]
            assert "content" in post, "Post should have content"
            assert "from_address" in post, "Post should have from_address"


class TestRegressionObjects:
    """Regression tests: Verify objects storefront still works"""
    
    def test_objects_storefront_endpoint(self):
        """Test GET /api/objects/storefront/{network} returns objects"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 5},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        # Response could be list or dict with 'objects' key
        if isinstance(data, list):
            objects = data
        else:
            objects = data.get("objects", data.get("items", []))
        
        assert isinstance(objects, list), "Should return a list of objects"


class TestRegressionProfiles:
    """Regression tests: Verify profile endpoint still works"""
    
    def test_profile_endpoint(self):
        """Test GET /api/profile/{address} returns profile data"""
        address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(
            f"{BASE_URL}/api/profile/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        # Should have some profile fields
        assert "address" in data or "urn" in data or "URN" in data, "Profile should have identifier"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
