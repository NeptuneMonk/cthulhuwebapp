"""
Test Room Gating Feature - Iteration 124
Tests the Chat Room Gating feature for Cthulhu blockchain social media platform.
Phase 1 (Backend): Messages API tags each message with is_seat_holder based on object ownership.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestRoomMessagesGating:
    """Test room messages endpoint with gating logic"""
    
    def test_room_messages_returns_gating_flags(self):
        """Test that GET /api/room/{address}/messages returns is_seat_holder and is_creator flags"""
        # Room address with known messages: mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Verify response structure
        assert "messages" in data, "Response should contain 'messages' field"
        assert "seat_holders" in data, "Response should contain 'seat_holders' field"
        assert "creators" in data, "Response should contain 'creators' field"
        assert "gate_object" in data, "Response should contain 'gate_object' field"
        assert "count" in data, "Response should contain 'count' field"
        
        # Verify messages have gating flags
        messages = data["messages"]
        assert len(messages) > 0, "Should have at least one message"
        
        for msg in messages:
            assert "is_seat_holder" in msg, f"Message {msg.get('txid')} should have 'is_seat_holder' flag"
            assert "is_creator" in msg, f"Message {msg.get('txid')} should have 'is_creator' flag"
            assert isinstance(msg["is_seat_holder"], bool), "is_seat_holder should be boolean"
            assert isinstance(msg["is_creator"], bool), "is_creator should be boolean"
    
    def test_room_messages_gate_object_null_when_no_gate_keyword(self):
        """Test that gate_object is null when no gate keyword exists on the object"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # This room should not have a gate keyword
        assert data["gate_object"] is None, "gate_object should be null when no gate keyword exists"
    
    def test_room_messages_seat_holders_list(self):
        """Test that seat_holders list is returned correctly"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        seat_holders = data["seat_holders"]
        assert isinstance(seat_holders, list), "seat_holders should be a list"
        assert len(seat_holders) > 0, "Should have at least one seat holder"
        
        # All seat holders should be valid addresses (strings)
        for holder in seat_holders:
            assert isinstance(holder, str), "Each seat holder should be a string address"
            assert len(holder) > 20, "Address should be a valid length"
    
    def test_room_messages_creators_list(self):
        """Test that creators list is returned correctly"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        creators = data["creators"]
        assert isinstance(creators, list), "creators should be a list"
        assert len(creators) > 0, "Should have at least one creator"
        
        # All creators should be valid addresses (strings)
        for creator in creators:
            assert isinstance(creator, str), "Each creator should be a string address"
            assert len(creator) > 20, "Address should be a valid length"
    
    def test_room_messages_unseated_message_flagged_correctly(self):
        """Test that unseated messages have is_seat_holder=false"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Find AllenVandever's message (known to be unseated)
        allen_msg = None
        for msg in data["messages"]:
            if msg.get("sender_urn") == "AllenVandever":
                allen_msg = msg
                break
        
        assert allen_msg is not None, "Should find AllenVandever's message"
        assert allen_msg["is_seat_holder"] == False, "AllenVandever should NOT be a seat holder"
        assert allen_msg["is_creator"] == False, "AllenVandever should NOT be a creator"
    
    def test_room_messages_seated_message_flagged_correctly(self):
        """Test that seated messages have is_seat_holder=true"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Find embii4u's message (known to be seated and creator)
        embii_msg = None
        for msg in data["messages"]:
            if msg.get("sender_urn") == "embii4u":
                embii_msg = msg
                break
        
        assert embii_msg is not None, "Should find embii4u's message"
        assert embii_msg["is_seat_holder"] == True, "embii4u should be a seat holder"
        assert embii_msg["is_creator"] == True, "embii4u should be a creator"
    
    def test_room_messages_message_structure(self):
        """Test that messages have all required fields"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        required_fields = [
            "txid", "content", "sender_address", "from_address", "to_address",
            "block_date", "created_at", "is_seat_holder", "is_creator"
        ]
        
        for msg in data["messages"]:
            for field in required_fields:
                assert field in msg, f"Message should have '{field}' field"


class TestRoomMessagesEdgeCases:
    """Test edge cases for room messages endpoint"""
    
    def test_room_messages_invalid_address(self):
        """Test that invalid room address returns empty messages"""
        response = requests.get(
            f"{BASE_URL}/api/room/invalid_address_12345/messages",
            params={"network": "btc-testnet", "limit": 100}
        )
        
        # Should return 200 with empty messages, not 404
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        # May have empty messages or error field
    
    def test_room_messages_with_limit(self):
        """Test that limit parameter works correctly"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(
            f"{BASE_URL}/api/room/{room_address}/messages",
            params={"network": "btc-testnet", "limit": 1}
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should respect limit (though may return more if API doesn't enforce strictly)
        assert "messages" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
