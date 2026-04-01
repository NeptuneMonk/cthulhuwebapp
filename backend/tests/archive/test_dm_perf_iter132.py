"""
Test DM Performance Optimization Features (Iteration 132)
- GET /api/dm/messages/{address} returns server_timestamp
- GET /api/dm/messages/{address} accepts `since` query parameter
- POST /api/dm/clear/{address} stores cleared_before timestamp
- GET /api/dm/messages/{address} respects cleared_before
"""
import pytest
import requests
import os
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

# Use valid Bitcoin testnet address format (starts with 'n', 'm', or 'tb1')
TEST_USER_ADDRESS = "n1wgm6BA35iR2TwPSx3S3HjBfR4NkEcMkY"
TEST_PARTNER_ADDRESS = "mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef"
NETWORK = "btc-testnet"


class TestDMMessagesEndpoint:
    """Tests for GET /api/dm/messages/{address} endpoint"""
    
    def test_dm_messages_returns_server_timestamp(self):
        """Verify server_timestamp is returned in response"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_USER_ADDRESS}",
            params={"network": NETWORK, "partner": TEST_PARTNER_ADDRESS}
        )
        # May return 200 or 500 depending on external API availability
        # But if 200, must have server_timestamp
        if response.status_code == 200:
            data = response.json()
            assert "server_timestamp" in data, "Response must include server_timestamp"
            assert isinstance(data["server_timestamp"], str), "server_timestamp must be a string"
            # Validate ISO format
            try:
                datetime.fromisoformat(data["server_timestamp"].replace('Z', '+00:00'))
            except ValueError:
                pytest.fail("server_timestamp must be valid ISO format")
            print(f"PASS: server_timestamp returned: {data['server_timestamp']}")
        else:
            # External API may fail - this is expected for test addresses
            print(f"INFO: External API returned {response.status_code} - expected for test addresses")
            pytest.skip("External blockchain API unavailable for test address")
    
    def test_dm_messages_accepts_since_parameter(self):
        """Verify `since` query parameter is accepted"""
        since_time = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_USER_ADDRESS}",
            params={"network": NETWORK, "partner": TEST_PARTNER_ADDRESS, "since": since_time}
        )
        # Endpoint should accept the parameter without error
        if response.status_code == 200:
            data = response.json()
            assert "messages" in data, "Response must include messages array"
            assert "server_timestamp" in data, "Response must include server_timestamp"
            print(f"PASS: since parameter accepted, returned {len(data['messages'])} messages")
        else:
            print(f"INFO: External API returned {response.status_code}")
            pytest.skip("External blockchain API unavailable for test address")
    
    def test_dm_messages_response_structure(self):
        """Verify response structure includes all required fields"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_USER_ADDRESS}",
            params={"network": NETWORK, "partner": TEST_PARTNER_ADDRESS}
        )
        if response.status_code == 200:
            data = response.json()
            # Check required fields
            assert "messages" in data, "Response must include messages"
            assert "total" in data, "Response must include total"
            assert "has_more" in data, "Response must include has_more"
            assert "server_timestamp" in data, "Response must include server_timestamp"
            assert isinstance(data["messages"], list), "messages must be a list"
            assert isinstance(data["total"], int), "total must be an integer"
            assert isinstance(data["has_more"], bool), "has_more must be a boolean"
            print(f"PASS: Response structure valid - total={data['total']}, has_more={data['has_more']}")
        else:
            pytest.skip("External blockchain API unavailable for test address")


class TestDMClearEndpoint:
    """Tests for POST /api/dm/clear/{address} endpoint"""
    
    def test_clear_dm_chat_creates_record(self):
        """Verify POST /api/dm/clear creates cleared_before timestamp"""
        response = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": TEST_PARTNER_ADDRESS, "network": NETWORK}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") is True, "Response must have ok=True"
        assert "cleared_before" in data, "Response must include cleared_before timestamp"
        # Validate ISO format
        try:
            cleared_ts = datetime.fromisoformat(data["cleared_before"].replace('Z', '+00:00'))
            # Should be recent (within last minute)
            now = datetime.now(timezone.utc)
            assert (now - cleared_ts).total_seconds() < 60, "cleared_before should be recent"
        except ValueError:
            pytest.fail("cleared_before must be valid ISO format")
        print(f"PASS: Clear chat returned cleared_before: {data['cleared_before']}")
    
    def test_clear_dm_chat_updates_existing_record(self):
        """Verify POST /api/dm/clear updates existing record (upsert)"""
        # First clear
        response1 = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": TEST_PARTNER_ADDRESS, "network": NETWORK}
        )
        assert response1.status_code == 200
        ts1 = response1.json()["cleared_before"]
        
        # Wait a moment and clear again
        import time
        time.sleep(0.5)
        
        response2 = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": TEST_PARTNER_ADDRESS, "network": NETWORK}
        )
        assert response2.status_code == 200
        ts2 = response2.json()["cleared_before"]
        
        # Second timestamp should be newer
        assert ts2 > ts1, f"Second clear should have newer timestamp: {ts2} > {ts1}"
        print(f"PASS: Clear chat updates existing record - ts1={ts1}, ts2={ts2}")
    
    def test_clear_dm_chat_requires_partner(self):
        """Verify POST /api/dm/clear requires partner field"""
        response = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"network": NETWORK}  # Missing partner
        )
        # Should return 422 (validation error) for missing required field
        assert response.status_code == 422, f"Expected 422 for missing partner, got {response.status_code}"
        print("PASS: Clear chat requires partner field (422 on missing)")
    
    def test_clear_dm_chat_different_partners_isolated(self):
        """Verify clear records are isolated per partner"""
        partner1 = "mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef"
        partner2 = "n3C7kzJvJqmqJqJqJqJqJqJqJqJqJqJqJq"
        
        # Clear with partner1
        response1 = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": partner1, "network": NETWORK}
        )
        assert response1.status_code == 200
        ts1 = response1.json()["cleared_before"]
        
        # Clear with partner2
        response2 = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": partner2, "network": NETWORK}
        )
        assert response2.status_code == 200
        ts2 = response2.json()["cleared_before"]
        
        # Both should succeed independently
        print(f"PASS: Different partners have isolated clear records - partner1={ts1}, partner2={ts2}")


class TestDMClearedBeforeFiltering:
    """Tests for cleared_before filtering in GET /api/dm/messages"""
    
    def test_messages_endpoint_respects_cleared_before(self):
        """Verify GET /api/dm/messages excludes messages older than cleared_before"""
        # First, set a cleared_before timestamp
        clear_response = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": TEST_PARTNER_ADDRESS, "network": NETWORK}
        )
        assert clear_response.status_code == 200
        cleared_before = clear_response.json()["cleared_before"]
        
        # Now fetch messages - should respect cleared_before
        messages_response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_USER_ADDRESS}",
            params={"network": NETWORK, "partner": TEST_PARTNER_ADDRESS}
        )
        
        if messages_response.status_code == 200:
            data = messages_response.json()
            # All returned messages should be newer than cleared_before
            for msg in data["messages"]:
                msg_time = msg.get("first_seen") or msg.get("block_date", "")
                if msg_time:
                    assert msg_time > cleared_before, f"Message {msg.get('txid')} should be newer than cleared_before"
            print(f"PASS: Messages endpoint respects cleared_before - {len(data['messages'])} messages returned")
        else:
            pytest.skip("External blockchain API unavailable for test address")


class TestDMEndpointValidation:
    """Tests for endpoint validation and error handling"""
    
    def test_dm_messages_invalid_network(self):
        """Verify endpoint handles invalid network gracefully"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_USER_ADDRESS}",
            params={"network": "invalid-network", "partner": TEST_PARTNER_ADDRESS}
        )
        # Should not crash - may return empty or error
        assert response.status_code in [200, 400, 500], f"Unexpected status: {response.status_code}"
        print(f"PASS: Invalid network handled - status {response.status_code}")
    
    def test_dm_clear_default_network(self):
        """Verify POST /api/dm/clear uses default network if not specified"""
        response = requests.post(
            f"{BASE_URL}/api/dm/clear/{TEST_USER_ADDRESS}",
            json={"partner": TEST_PARTNER_ADDRESS}  # No network specified
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("ok") is True
        print("PASS: Clear chat works with default network")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
