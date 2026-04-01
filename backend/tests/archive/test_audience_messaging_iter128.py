"""
Iteration 128: Audience Messaging Tests
Tests for ephemeral tip-based audience messaging feature:
- POST /api/room/{address}/audience - stores audience messages
- GET /api/room/{address}/audience - retrieves messages with is_tip flag
- DELETE /api/room/{address}/audience - clears all messages for room
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
TEST_ROOM_ADDRESS = "testRoomAddr123"
NETWORK = "btc-testnet"


class TestAudienceMessagingEndpoints:
    """Test audience messaging CRUD operations"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Clean up test data before each test"""
        # Clear any existing test messages
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        yield
        # Cleanup after test
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
    
    def test_post_audience_message_regular_555_sats(self):
        """POST /api/room/{address}/audience - 555 sats = regular message (is_tip=false)"""
        unique_txid = f"test_txid_{uuid.uuid4().hex[:8]}"
        payload = {
            "sender_address": "testSenderAddr123",
            "sender_urn": "testuser.btc",
            "content": "Hello from audience!",
            "txid": unique_txid,
            "amount_sats": 555,
            "network": NETWORK
        }
        
        response = requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json=payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert data["status"] == "ok"
        assert data["is_tip"] == False, "555 sats should NOT be a tip"
        assert data["amount_sats"] == 555
    
    def test_post_audience_message_super_chat_tip(self):
        """POST /api/room/{address}/audience - >555 sats = super chat (is_tip=true)"""
        unique_txid = f"test_txid_{uuid.uuid4().hex[:8]}"
        payload = {
            "sender_address": "testSenderAddr456",
            "sender_urn": "tipper.btc",
            "content": "",  # Tips don't have content
            "txid": unique_txid,
            "amount_sats": 10000,  # 10,000 sats = super chat
            "network": NETWORK
        }
        
        response = requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json=payload
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert data["status"] == "ok"
        assert data["is_tip"] == True, ">555 sats should be a tip"
        assert data["amount_sats"] == 10000
    
    def test_get_audience_messages_returns_correct_structure(self):
        """GET /api/room/{address}/audience - returns messages with is_tip flag and min_cost_sats"""
        # First, create a test message
        unique_txid = f"test_txid_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "testSenderAddr789",
                "sender_urn": "viewer.btc",
                "content": "Test message content",
                "txid": unique_txid,
                "amount_sats": 555,
                "network": NETWORK
            }
        )
        
        # Now fetch messages
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "messages" in data
        assert "count" in data
        assert "min_cost_sats" in data
        assert data["min_cost_sats"] == 555, "min_cost_sats should be 555"
        assert data["count"] >= 1
        
        # Verify message structure
        if data["messages"]:
            msg = data["messages"][-1]  # Get the last message (our test message)
            assert "sender_address" in msg
            assert "sender_urn" in msg
            assert "content" in msg
            assert "txid" in msg
            assert "amount_sats" in msg
            assert "is_tip" in msg
            assert "timestamp" in msg
            assert "room_address" in msg
    
    def test_get_audience_messages_shows_is_tip_flag_correctly(self):
        """GET /api/room/{address}/audience - is_tip flag is correct for different amounts"""
        # Create a regular message (555 sats)
        regular_txid = f"test_regular_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "regularSender",
                "sender_urn": "regular.btc",
                "content": "Regular message",
                "txid": regular_txid,
                "amount_sats": 555,
                "network": NETWORK
            }
        )
        
        # Create a tip message (>555 sats)
        tip_txid = f"test_tip_{uuid.uuid4().hex[:8]}"
        requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "tipSender",
                "sender_urn": "tipper.btc",
                "content": "",
                "txid": tip_txid,
                "amount_sats": 5000,
                "network": NETWORK
            }
        )
        
        # Fetch and verify
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Find our messages
        regular_msg = next((m for m in data["messages"] if m["txid"] == regular_txid), None)
        tip_msg = next((m for m in data["messages"] if m["txid"] == tip_txid), None)
        
        assert regular_msg is not None, "Regular message should exist"
        assert tip_msg is not None, "Tip message should exist"
        
        assert regular_msg["is_tip"] == False, "555 sats message should have is_tip=False"
        assert tip_msg["is_tip"] == True, ">555 sats message should have is_tip=True"
    
    def test_delete_audience_messages_clears_all(self):
        """DELETE /api/room/{address}/audience - clears all messages and returns deleted count"""
        # Create multiple test messages
        for i in range(3):
            requests.post(
                f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
                json={
                    "sender_address": f"sender{i}",
                    "sender_urn": f"user{i}.btc",
                    "content": f"Message {i}",
                    "txid": f"txid_{uuid.uuid4().hex[:8]}",
                    "amount_sats": 555,
                    "network": NETWORK
                }
            )
        
        # Verify messages exist
        get_response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        assert get_response.json()["count"] >= 3
        
        # Delete all messages
        delete_response = requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}"
        delete_data = delete_response.json()
        
        # Verify response structure
        assert delete_data["status"] == "ok"
        assert "deleted" in delete_data
        assert delete_data["deleted"] >= 3, f"Should have deleted at least 3 messages, got {delete_data['deleted']}"
        
        # Verify messages are actually deleted
        verify_response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        assert verify_response.json()["count"] == 0, "All messages should be deleted"
    
    def test_audience_messages_stored_in_mongodb(self):
        """Verify audience messages are stored in MongoDB (via API persistence)"""
        unique_txid = f"test_persist_{uuid.uuid4().hex[:8]}"
        
        # Create a message
        post_response = requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "persistTestSender",
                "sender_urn": "persist.btc",
                "content": "Persistence test message",
                "txid": unique_txid,
                "amount_sats": 555,
                "network": NETWORK
            }
        )
        assert post_response.status_code == 200
        
        # Fetch and verify it persisted
        get_response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        data = get_response.json()
        found_msg = next((m for m in data["messages"] if m["txid"] == unique_txid), None)
        
        assert found_msg is not None, "Message should be persisted and retrievable"
        assert found_msg["content"] == "Persistence test message"
        assert found_msg["sender_urn"] == "persist.btc"
    
    def test_audience_message_boundary_556_sats_is_tip(self):
        """POST /api/room/{address}/audience - 556 sats (just above 555) should be is_tip=true"""
        unique_txid = f"test_boundary_{uuid.uuid4().hex[:8]}"
        payload = {
            "sender_address": "boundarySender",
            "sender_urn": "boundary.btc",
            "content": "",
            "txid": unique_txid,
            "amount_sats": 556,  # Just above the threshold
            "network": NETWORK
        }
        
        response = requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json=payload
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["is_tip"] == True, "556 sats (>555) should be a tip"
    
    def test_get_audience_messages_empty_room(self):
        """GET /api/room/{address}/audience - returns empty list for room with no messages"""
        # Use a unique room address that won't have messages
        empty_room = f"emptyRoom_{uuid.uuid4().hex[:8]}"
        
        response = requests.get(
            f"{BASE_URL}/api/room/{empty_room}/audience",
            params={"network": NETWORK}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["messages"] == []
        assert data["count"] == 0
        assert data["min_cost_sats"] == 555


class TestAudienceMessageDataIntegrity:
    """Test data integrity and edge cases"""
    
    def test_message_content_preserved_for_regular_messages(self):
        """Regular messages (555 sats) should preserve content"""
        unique_txid = f"test_content_{uuid.uuid4().hex[:8]}"
        test_content = "This is my audience message with special chars: !@#$%"
        
        # Clear first
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "contentSender",
                "sender_urn": "content.btc",
                "content": test_content,
                "txid": unique_txid,
                "amount_sats": 555,
                "network": NETWORK
            }
        )
        
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        data = response.json()
        found_msg = next((m for m in data["messages"] if m["txid"] == unique_txid), None)
        
        assert found_msg is not None
        assert found_msg["content"] == test_content, "Content should be preserved for regular messages"
        
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
    
    def test_tip_messages_have_empty_content(self):
        """Tip messages (>555 sats) should have empty content (per backend logic)"""
        unique_txid = f"test_tip_content_{uuid.uuid4().hex[:8]}"
        
        # Clear first
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        # Backend sets content to "" for tips
        requests.post(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            json={
                "sender_address": "tipContentSender",
                "sender_urn": "tipcontent.btc",
                "content": "This should be ignored",  # Backend will set to ""
                "txid": unique_txid,
                "amount_sats": 1000,
                "network": NETWORK
            }
        )
        
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
        
        data = response.json()
        found_msg = next((m for m in data["messages"] if m["txid"] == unique_txid), None)
        
        assert found_msg is not None
        assert found_msg["content"] == "", "Tip messages should have empty content"
        
        # Cleanup
        requests.delete(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/audience",
            params={"network": NETWORK}
        )
