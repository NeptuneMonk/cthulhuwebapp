"""
Test suite for User State Persistence API (Iteration 157)
Tests the new /api/user-state endpoints for follows, pinned_friends, and tethered_rooms persistence.
"""
import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test addresses - unique per test run to avoid conflicts
TEST_ADDRESS_PREFIX = f"TEST_user_state_{int(time.time())}_"


class TestUserStateGetDefault:
    """Test GET /api/user-state/{address} returns default empty state for unknown addresses"""
    
    def test_get_unknown_address_returns_default_state(self):
        """Unknown address should return empty arrays for follows, pinned_friends, tethered_rooms"""
        unknown_addr = f"{TEST_ADDRESS_PREFIX}unknown_{uuid.uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/user-state/{unknown_addr}?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify default structure
        assert data["address"] == unknown_addr, f"Address mismatch: {data}"
        assert data["network"] == "btc-testnet", f"Network mismatch: {data}"
        assert data["follows"] == [], f"Expected empty follows: {data}"
        assert data["pinned_friends"] == [], f"Expected empty pinned_friends: {data}"
        assert data["tethered_rooms"] == [], f"Expected empty tethered_rooms: {data}"
        print(f"✓ GET unknown address returns default state: {data}")
    
    def test_get_with_different_network(self):
        """Test network parameter is respected"""
        unknown_addr = f"{TEST_ADDRESS_PREFIX}mainnet_{uuid.uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/user-state/{unknown_addr}?network=btc-mainnet")
        
        assert response.status_code == 200
        data = response.json()
        assert data["network"] == "btc-mainnet", f"Network should be btc-mainnet: {data}"
        print(f"✓ GET with btc-mainnet network works: {data}")


class TestUserStateSaveAndRetrieve:
    """Test POST /api/user-state saves data and GET retrieves it"""
    
    def test_save_follows_and_retrieve(self):
        """Save follows array and verify it persists"""
        test_addr = f"{TEST_ADDRESS_PREFIX}follows_{uuid.uuid4().hex[:8]}"
        follows_data = [
            {"address": "addr1", "urn": "user1", "image": "img1.png", "display_name": "User One"},
            {"address": "addr2", "urn": "user2", "image": "img2.png", "display_name": "User Two"},
        ]
        
        # POST to save
        save_response = requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": follows_data
        })
        assert save_response.status_code == 200, f"Save failed: {save_response.text}"
        assert save_response.json().get("success") == True, f"Expected success: {save_response.json()}"
        print(f"✓ POST follows saved successfully")
        
        # GET to verify
        get_response = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet")
        assert get_response.status_code == 200
        data = get_response.json()
        
        assert data["follows"] == follows_data, f"Follows mismatch: {data['follows']} != {follows_data}"
        assert data["pinned_friends"] == [], "pinned_friends should be empty"
        assert data["tethered_rooms"] == [], "tethered_rooms should be empty"
        print(f"✓ GET returns saved follows: {len(data['follows'])} entries")
    
    def test_save_pinned_friends_and_retrieve(self):
        """Save pinned_friends array and verify it persists"""
        test_addr = f"{TEST_ADDRESS_PREFIX}pinned_{uuid.uuid4().hex[:8]}"
        pinned_data = ["friend_addr_1", "friend_addr_2", "friend_addr_3"]
        
        # POST to save
        save_response = requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "pinned_friends": pinned_data
        })
        assert save_response.status_code == 200
        print(f"✓ POST pinned_friends saved successfully")
        
        # GET to verify
        get_response = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet")
        data = get_response.json()
        
        assert data["pinned_friends"] == pinned_data, f"pinned_friends mismatch: {data}"
        print(f"✓ GET returns saved pinned_friends: {data['pinned_friends']}")
    
    def test_save_tethered_rooms_and_retrieve(self):
        """Save tethered_rooms array and verify it persists"""
        test_addr = f"{TEST_ADDRESS_PREFIX}rooms_{uuid.uuid4().hex[:8]}"
        rooms_data = [
            {"objectAddress": "room1", "name": "Room One", "image": "room1.png", "description": "First room"},
            {"objectAddress": "room2", "name": "Room Two", "image": "room2.png", "description": "Second room"},
        ]
        
        # POST to save
        save_response = requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "tethered_rooms": rooms_data
        })
        assert save_response.status_code == 200
        print(f"✓ POST tethered_rooms saved successfully")
        
        # GET to verify
        get_response = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet")
        data = get_response.json()
        
        assert data["tethered_rooms"] == rooms_data, f"tethered_rooms mismatch: {data}"
        print(f"✓ GET returns saved tethered_rooms: {len(data['tethered_rooms'])} entries")


class TestUserStatePartialUpdates:
    """Test that partial updates don't overwrite other fields"""
    
    def test_partial_update_follows_preserves_pinned(self):
        """Updating only follows should not overwrite pinned_friends"""
        test_addr = f"{TEST_ADDRESS_PREFIX}partial_{uuid.uuid4().hex[:8]}"
        
        # First, save both follows and pinned_friends
        initial_follows = [{"address": "f1", "urn": "follow1"}]
        initial_pinned = ["pinned1", "pinned2"]
        
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": initial_follows,
            "pinned_friends": initial_pinned
        })
        
        # Verify initial state
        get1 = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert get1["follows"] == initial_follows
        assert get1["pinned_friends"] == initial_pinned
        print(f"✓ Initial state saved: follows={len(get1['follows'])}, pinned={len(get1['pinned_friends'])}")
        
        # Now update ONLY follows
        updated_follows = [{"address": "f1", "urn": "follow1"}, {"address": "f2", "urn": "follow2"}]
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": updated_follows
            # Note: pinned_friends NOT included
        })
        
        # Verify pinned_friends is preserved
        get2 = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert get2["follows"] == updated_follows, f"Follows should be updated: {get2['follows']}"
        assert get2["pinned_friends"] == initial_pinned, f"pinned_friends should be preserved: {get2['pinned_friends']}"
        print(f"✓ Partial update preserved pinned_friends: {get2['pinned_friends']}")
    
    def test_partial_update_pinned_preserves_follows(self):
        """Updating only pinned_friends should not overwrite follows"""
        test_addr = f"{TEST_ADDRESS_PREFIX}partial2_{uuid.uuid4().hex[:8]}"
        
        # First, save both
        initial_follows = [{"address": "f1", "urn": "follow1"}]
        initial_pinned = ["pinned1"]
        
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": initial_follows,
            "pinned_friends": initial_pinned
        })
        
        # Update ONLY pinned_friends
        updated_pinned = ["pinned1", "pinned2", "pinned3"]
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "pinned_friends": updated_pinned
            # Note: follows NOT included
        })
        
        # Verify follows is preserved
        get2 = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert get2["follows"] == initial_follows, f"Follows should be preserved: {get2['follows']}"
        assert get2["pinned_friends"] == updated_pinned, f"pinned_friends should be updated: {get2['pinned_friends']}"
        print(f"✓ Partial update preserved follows: {get2['follows']}")
    
    def test_partial_update_rooms_preserves_others(self):
        """Updating only tethered_rooms should not overwrite follows or pinned_friends"""
        test_addr = f"{TEST_ADDRESS_PREFIX}partial3_{uuid.uuid4().hex[:8]}"
        
        # First, save all three
        initial_follows = [{"address": "f1", "urn": "follow1"}]
        initial_pinned = ["pinned1"]
        initial_rooms = [{"objectAddress": "room1", "name": "Room 1"}]
        
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": initial_follows,
            "pinned_friends": initial_pinned,
            "tethered_rooms": initial_rooms
        })
        
        # Update ONLY tethered_rooms
        updated_rooms = [{"objectAddress": "room1", "name": "Room 1"}, {"objectAddress": "room2", "name": "Room 2"}]
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "tethered_rooms": updated_rooms
        })
        
        # Verify others are preserved
        get2 = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert get2["follows"] == initial_follows, f"Follows should be preserved"
        assert get2["pinned_friends"] == initial_pinned, f"pinned_friends should be preserved"
        assert get2["tethered_rooms"] == updated_rooms, f"tethered_rooms should be updated"
        print(f"✓ Partial update preserved follows and pinned_friends")


class TestUserStateNetworkIsolation:
    """Test that data is isolated per network"""
    
    def test_different_networks_have_separate_state(self):
        """Same address on different networks should have separate state"""
        test_addr = f"{TEST_ADDRESS_PREFIX}network_{uuid.uuid4().hex[:8]}"
        
        # Save to testnet
        testnet_follows = [{"address": "testnet_follow", "urn": "testnet_user"}]
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": testnet_follows
        })
        
        # Save to mainnet
        mainnet_follows = [{"address": "mainnet_follow", "urn": "mainnet_user"}]
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-mainnet",
            "follows": mainnet_follows
        })
        
        # Verify testnet state
        testnet_data = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert testnet_data["follows"] == testnet_follows, f"Testnet follows mismatch"
        
        # Verify mainnet state
        mainnet_data = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-mainnet").json()
        assert mainnet_data["follows"] == mainnet_follows, f"Mainnet follows mismatch"
        
        print(f"✓ Network isolation verified: testnet and mainnet have separate state")


class TestUserStateUpdatedAt:
    """Test that updated_at timestamp is set on save"""
    
    def test_updated_at_is_set(self):
        """Verify updated_at field is set after save"""
        test_addr = f"{TEST_ADDRESS_PREFIX}timestamp_{uuid.uuid4().hex[:8]}"
        
        # Save some data
        requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": [{"address": "f1", "urn": "user1"}]
        })
        
        # GET and check updated_at
        data = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        
        # updated_at should be present (it's set by the backend)
        assert "updated_at" in data, f"updated_at should be present: {data}"
        print(f"✓ updated_at is set: {data.get('updated_at')}")


class TestUserStateEdgeCases:
    """Test edge cases and error handling"""
    
    def test_empty_arrays_are_valid(self):
        """Saving empty arrays should work"""
        test_addr = f"{TEST_ADDRESS_PREFIX}empty_{uuid.uuid4().hex[:8]}"
        
        response = requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": [],
            "pinned_friends": [],
            "tethered_rooms": []
        })
        assert response.status_code == 200
        
        data = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert data["follows"] == []
        assert data["pinned_friends"] == []
        assert data["tethered_rooms"] == []
        print(f"✓ Empty arrays saved and retrieved correctly")
    
    def test_large_follows_list(self):
        """Test saving a large follows list"""
        test_addr = f"{TEST_ADDRESS_PREFIX}large_{uuid.uuid4().hex[:8]}"
        
        # Create 100 follows
        large_follows = [
            {"address": f"addr_{i}", "urn": f"user_{i}", "image": f"img_{i}.png"}
            for i in range(100)
        ]
        
        response = requests.post(f"{BASE_URL}/api/user-state", json={
            "address": test_addr,
            "network": "btc-testnet",
            "follows": large_follows
        })
        assert response.status_code == 200
        
        data = requests.get(f"{BASE_URL}/api/user-state/{test_addr}?network=btc-testnet").json()
        assert len(data["follows"]) == 100, f"Expected 100 follows, got {len(data['follows'])}"
        print(f"✓ Large follows list (100 entries) saved and retrieved correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
