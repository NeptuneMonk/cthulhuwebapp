"""
Test License-Based Chat Room Gating for Cthulhu Platform
Iteration 125: Testing the new license-based gating approach

Room types determined by License field:
- 'cthulhu:tether' = Public Room (everyone speaks, all messages have is_seat_holder=True)
- 'cthulhu:tether:venue' = Speaking Venue (only seat holders speak, audience watches + tips)
- Other licenses = Default behavior (messages tagged based on ownership)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test room: BONG 玉 - a public room with CC0 license (NOT a venue)
PUBLIC_ROOM_ADDRESS = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
NETWORK = "btc-testnet"


class TestRoomMessagesAPI:
    """Test GET /api/room/{address}/messages endpoint"""
    
    def test_room_messages_returns_is_venue_field(self):
        """API should return is_venue field in response"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify is_venue field exists
        assert "is_venue" in data, "Response should contain 'is_venue' field"
        assert isinstance(data["is_venue"], bool), "is_venue should be a boolean"
        print(f"✓ is_venue field present: {data['is_venue']}")
    
    def test_public_room_is_venue_false(self):
        """Public room (CC0 license) should have is_venue=False"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        # CC0 license is NOT a venue
        assert data["is_venue"] == False, "CC0 license room should have is_venue=False"
        print(f"✓ Public room (CC0) correctly has is_venue=False")
    
    def test_public_room_all_messages_have_is_seat_holder_true(self):
        """For non-venue rooms, ALL messages should have is_seat_holder=True"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        messages = data.get("messages", [])
        assert len(messages) > 0, "Should have at least one message"
        
        # All messages in a public room should have is_seat_holder=True
        for msg in messages:
            assert msg.get("is_seat_holder") == True, \
                f"Message from {msg.get('sender_address')} should have is_seat_holder=True in public room"
        
        print(f"✓ All {len(messages)} messages have is_seat_holder=True (public room)")
    
    def test_room_messages_returns_seat_holders_array(self):
        """API should return seat_holders array"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "seat_holders" in data, "Response should contain 'seat_holders' field"
        assert isinstance(data["seat_holders"], list), "seat_holders should be a list"
        print(f"✓ seat_holders array present with {len(data['seat_holders'])} holders")
    
    def test_room_messages_returns_creators_array(self):
        """API should return creators array"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "creators" in data, "Response should contain 'creators' field"
        assert isinstance(data["creators"], list), "creators should be a list"
        print(f"✓ creators array present with {len(data['creators'])} creators")
    
    def test_room_messages_returns_message_structure(self):
        """Each message should have required fields"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        messages = data.get("messages", [])
        assert len(messages) > 0, "Should have at least one message"
        
        required_fields = ["txid", "content", "sender_address", "is_seat_holder", "is_creator"]
        for msg in messages:
            for field in required_fields:
                assert field in msg, f"Message should have '{field}' field"
        
        print(f"✓ All messages have required fields: {required_fields}")


class TestObjectAPI:
    """Test object info API to verify license field"""
    
    def test_object_returns_license_field(self):
        """Object API should return license field"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{PUBLIC_ROOM_ADDRESS}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "license" in data, "Object should have 'license' field"
        print(f"✓ Object license: {data.get('license')}")
    
    def test_public_room_has_cc0_license(self):
        """BONG 玉 room should have CC0 license (not cthulhu:tether:venue)"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{PUBLIC_ROOM_ADDRESS}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        
        license_val = data.get("license", "").lower()
        assert license_val == "cc0", f"Expected CC0 license, got: {license_val}"
        assert license_val != "cthulhu:tether:venue", "Should NOT be a venue license"
        print(f"✓ Room has CC0 license (public room, not venue)")


class TestLicenseBasedGatingLogic:
    """Test the license-based gating logic"""
    
    def test_non_venue_license_means_public_room(self):
        """Any license that is NOT 'cthulhu:tether:venue' should be treated as public"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        # is_venue should be False for CC0 license
        assert data["is_venue"] == False
        
        # All messages should have is_seat_holder=True (public room behavior)
        for msg in data.get("messages", []):
            assert msg.get("is_seat_holder") == True
        
        print("✓ Non-venue license correctly treated as public room")
    
    def test_response_count_matches_messages_length(self):
        """Response count should match messages array length"""
        response = requests.get(
            f"{BASE_URL}/api/room/{PUBLIC_ROOM_ADDRESS}/messages",
            params={"network": NETWORK, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["count"] == len(data.get("messages", []))
        print(f"✓ Count ({data['count']}) matches messages length")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
