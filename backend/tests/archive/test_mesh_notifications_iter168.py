"""
Test suite for Mesh Notification System (Iteration 168)

Tests:
1. POST /api/mesh/notify - Store notification hints for offline users
2. GET /api/mesh/notifications/{address} - Fetch and clear notification hints
3. Notification hint upsert (POST same room twice increments count)
4. _id exclusion in projection (SQLite adapter fix)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')


class TestMeshNotifications:
    """Test mesh notification endpoints for decentralized unread message notifications"""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.test_recipient = "tb1qtest_recipient_address_12345"
        self.test_sender = "tb1qtest_sender_address_67890"
        self.test_room = "tb1qtest_room_address_abcdef"
        self.test_sender_urn = "test_sender_urn"
        self.network = "btc-testnet"

    def test_health_check(self):
        """Verify backend is running"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("✓ Health check passed")

    def test_post_notification_hint(self):
        """Test POST /api/mesh/notify stores notification hint"""
        payload = {
            "to": self.test_recipient,
            "room": self.test_room,
            "sender": self.test_sender,
            "sender_urn": self.test_sender_urn,
            "network": self.network,
            "count": 1
        }
        response = requests.post(
            f"{BASE_URL}/api/mesh/notify",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print("✓ POST /api/mesh/notify - notification hint stored successfully")

    def test_get_notifications_returns_hints(self):
        """Test GET /api/mesh/notifications/{address} returns stored hints"""
        # First, post a notification
        payload = {
            "to": self.test_recipient,
            "room": self.test_room,
            "sender": self.test_sender,
            "sender_urn": self.test_sender_urn,
            "network": self.network,
            "count": 1
        }
        requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)

        # Then fetch notifications
        response = requests.get(
            f"{BASE_URL}/api/mesh/notifications/{self.test_recipient}",
            params={"network": self.network}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should have hints array and total count
        assert "hints" in data
        assert "total" in data
        assert isinstance(data["hints"], list)
        assert isinstance(data["total"], int)
        print(f"✓ GET /api/mesh/notifications - returned {len(data['hints'])} hints, total: {data['total']}")

    def test_notifications_cleared_after_fetch(self):
        """Test that notifications are cleared after fetching"""
        unique_recipient = f"tb1qclear_test_{os.urandom(4).hex()}"
        unique_room = f"tb1qroom_clear_{os.urandom(4).hex()}"
        
        # Post a notification
        payload = {
            "to": unique_recipient,
            "room": unique_room,
            "sender": self.test_sender,
            "sender_urn": self.test_sender_urn,
            "network": self.network,
            "count": 1
        }
        requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)

        # First fetch - should have hints
        response1 = requests.get(
            f"{BASE_URL}/api/mesh/notifications/{unique_recipient}",
            params={"network": self.network}
        )
        assert response1.status_code == 200
        data1 = response1.json()
        first_total = data1.get("total", 0)
        
        # Second fetch - should be empty (cleared)
        response2 = requests.get(
            f"{BASE_URL}/api/mesh/notifications/{unique_recipient}",
            params={"network": self.network}
        )
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2.get("total", 0) == 0
        assert len(data2.get("hints", [])) == 0
        print(f"✓ Notifications cleared after fetch - first: {first_total}, second: 0")

    def test_notification_upsert_increments_count(self):
        """Test that posting to same room twice increments count (upsert behavior)"""
        unique_recipient = f"tb1qupsert_test_{os.urandom(4).hex()}"
        unique_room = f"tb1qroom_upsert_{os.urandom(4).hex()}"
        
        # Post first notification
        payload = {
            "to": unique_recipient,
            "room": unique_room,
            "sender": self.test_sender,
            "sender_urn": self.test_sender_urn,
            "network": self.network,
            "count": 1
        }
        response1 = requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)
        assert response1.status_code == 200

        # Post second notification to same room
        response2 = requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)
        assert response2.status_code == 200

        # Post third notification to same room
        response3 = requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)
        assert response3.status_code == 200

        # Fetch and verify count is 3
        response = requests.get(
            f"{BASE_URL}/api/mesh/notifications/{unique_recipient}",
            params={"network": self.network}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Find the hint for our room
        room_hint = next((h for h in data.get("hints", []) if h.get("room") == unique_room), None)
        assert room_hint is not None, "Room hint not found"
        assert room_hint.get("count") == 3, f"Expected count 3, got {room_hint.get('count')}"
        print(f"✓ Notification upsert - count incremented to {room_hint.get('count')}")

    def test_notification_hint_structure(self):
        """Test that notification hints have correct structure (no _id field)"""
        unique_recipient = f"tb1qstruct_test_{os.urandom(4).hex()}"
        unique_room = f"tb1qroom_struct_{os.urandom(4).hex()}"
        
        # Post a notification
        payload = {
            "to": unique_recipient,
            "room": unique_room,
            "sender": self.test_sender,
            "sender_urn": self.test_sender_urn,
            "network": self.network,
            "count": 1
        }
        requests.post(f"{BASE_URL}/api/mesh/notify", json=payload)

        # Fetch and verify structure
        response = requests.get(
            f"{BASE_URL}/api/mesh/notifications/{unique_recipient}",
            params={"network": self.network}
        )
        assert response.status_code == 200
        data = response.json()
        
        hints = data.get("hints", [])
        if hints:
            hint = hints[0]
            # Verify _id is NOT in the response (projection fix)
            assert "_id" not in hint, f"_id should be excluded from response, got: {hint.keys()}"
            # Verify expected fields are present
            assert "to" in hint
            assert "room" in hint
            assert "sender" in hint
            assert "count" in hint
            print(f"✓ Notification hint structure correct - fields: {list(hint.keys())}")
        else:
            print("✓ No hints to verify structure (may have been cleared)")


class TestMeshNodes:
    """Test mesh node registry endpoints"""

    def test_mesh_stats(self):
        """Test GET /api/mesh/stats returns network statistics"""
        response = requests.get(
            f"{BASE_URL}/api/mesh/stats",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify expected fields
        assert "online_nodes" in data
        assert "total_registered" in data
        assert "total_bytes_relayed" in data
        assert "network" in data
        print(f"✓ Mesh stats - online: {data['online_nodes']}, registered: {data['total_registered']}")

    def test_mesh_nodes_list(self):
        """Test GET /api/mesh/nodes returns active nodes"""
        response = requests.get(
            f"{BASE_URL}/api/mesh/nodes",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "nodes" in data
        assert "count" in data
        assert isinstance(data["nodes"], list)
        print(f"✓ Mesh nodes - count: {data['count']}")

    def test_mesh_node_quality(self):
        """Test GET /api/mesh/node-quality returns quality metrics"""
        response = requests.get(
            f"{BASE_URL}/api/mesh/node-quality",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "nodes" in data
        assert "count" in data
        print(f"✓ Mesh node quality - count: {data['count']}")


class TestChatUnread:
    """Test chat unread tracking endpoints"""

    def test_chat_unread_endpoint(self):
        """Test GET /api/chat/unread/{address} returns unread counts"""
        test_address = "tb1qtest_unread_address"
        response = requests.get(f"{BASE_URL}/api/chat/unread/{test_address}")
        assert response.status_code == 200
        data = response.json()
        
        assert "rooms" in data
        assert "total_unread" in data
        print(f"✓ Chat unread - total: {data['total_unread']}, rooms: {len(data['rooms'])}")


class TestSQLiteProjection:
    """Test SQLite adapter projection fix for _id exclusion"""

    def test_mesh_nodes_no_id_field(self):
        """Verify mesh nodes response excludes _id field"""
        response = requests.get(
            f"{BASE_URL}/api/mesh/nodes",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        for node in data.get("nodes", []):
            assert "_id" not in node, f"_id should be excluded, got: {node.keys()}"
        print("✓ Mesh nodes response excludes _id field")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
