"""
Test iteration 143: Batch keys endpoint and call settings API tests.

Features tested:
1. POST /api/profile/keys/batch - returns full pkx/pky data (not just boolean)
2. GET /api/call-settings/{address} - returns proper defaults
3. POST /api/call-settings - creates/updates call settings
4. GET /api/call-settings/batch - returns settings for multiple addresses
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

class TestHealthEndpoint:
    """Basic health check to ensure API is running"""
    
    def test_health_endpoint(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") in ["healthy", "degraded"]
        assert "services" in data
        print(f"Health check: {data}")


class TestBatchKeysEndpoint:
    """Test POST /api/profile/keys/batch endpoint returns full pkx/pky data"""
    
    def test_batch_keys_returns_full_data(self):
        """Batch keys endpoint should return has_keys, pkx, pky per address"""
        # Use some test addresses - these may or may not have keys
        test_addresses = [
            "mzYVhGHnQgwXhCCGvJCqYPLxqKvLPcRZ1P",  # Example testnet address
            "n1testaddress123456789012345678901",  # Fake address
        ]
        
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network=btc-testnet",
            json={"addresses": test_addresses},
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "keys" in data
        
        # Verify structure: each address should have has_keys, pkx, pky
        keys_data = data["keys"]
        for addr in test_addresses:
            if addr in keys_data:
                entry = keys_data[addr]
                assert "has_keys" in entry, f"Missing has_keys for {addr}"
                assert "pkx" in entry, f"Missing pkx for {addr}"
                assert "pky" in entry, f"Missing pky for {addr}"
                print(f"Address {addr[:12]}...: has_keys={entry['has_keys']}, pkx={entry['pkx'][:20] if entry['pkx'] else 'None'}...")
    
    def test_batch_keys_empty_addresses(self):
        """Batch keys with empty list should return empty keys dict"""
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network=btc-testnet",
            json={"addresses": []},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "keys" in data
        assert data["keys"] == {}
        print("Empty addresses test passed")
    
    def test_batch_keys_too_many_addresses(self):
        """Batch keys with >100 addresses should return empty (rate limited)"""
        # Generate 101 fake addresses
        test_addresses = [f"n1test{i:040d}" for i in range(101)]
        
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network=btc-testnet",
            json={"addresses": test_addresses},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return empty due to limit check
        assert "keys" in data
        assert data["keys"] == {}
        print("Rate limit test passed (>100 addresses)")


class TestCallSettingsEndpoint:
    """Test call settings CRUD endpoints"""
    
    def test_get_default_settings(self):
        """GET /api/call-settings/{address} returns defaults for unknown address"""
        test_addr = "TEST_iter143_unknown_addr"
        
        response = requests.get(
            f"{BASE_URL}/api/call-settings/{test_addr}?network=btc-testnet",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify default values
        assert data.get("address") == test_addr
        assert data.get("accept_calls") == True
        assert data.get("answering_machine_enabled") == False
        assert data.get("answering_machine_cid") is None
        assert data.get("answering_machine_max_seconds") == 15
        assert data.get("status_message") is None
        print(f"Default settings: {data}")
    
    def test_create_call_settings(self):
        """POST /api/call-settings creates new settings"""
        test_addr = "TEST_iter143_create_addr"
        
        payload = {
            "address": test_addr,
            "network": "btc-testnet",
            "accept_calls": False,
            "answering_machine_enabled": True,
            "answering_machine_cid": "QmTestCID123",
            "answering_machine_max_seconds": 30,
            "status_message": "Leave a message after the beep"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/call-settings",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("accept_calls") == False
        assert data.get("answering_machine_enabled") == True
        assert data.get("answering_machine_cid") == "QmTestCID123"
        print(f"Created settings: {data}")
        
        # Verify by GET
        get_response = requests.get(
            f"{BASE_URL}/api/call-settings/{test_addr}?network=btc-testnet",
            timeout=10
        )
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("accept_calls") == False
        assert get_data.get("answering_machine_enabled") == True
        print("Verified settings persisted correctly")
    
    def test_update_call_settings(self):
        """POST /api/call-settings updates existing settings"""
        test_addr = "TEST_iter143_update_addr"
        
        # Create initial settings
        initial_payload = {
            "address": test_addr,
            "network": "btc-testnet",
            "accept_calls": True,
            "answering_machine_enabled": False,
        }
        requests.post(
            f"{BASE_URL}/api/call-settings",
            json=initial_payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        # Update settings
        update_payload = {
            "address": test_addr,
            "network": "btc-testnet",
            "accept_calls": False,
            "answering_machine_enabled": True,
            "status_message": "Updated status"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/call-settings",
            json=update_payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("accept_calls") == False
        assert data.get("status_message") == "Updated status"
        print(f"Updated settings: {data}")


class TestBatchCallSettings:
    """Test batch call settings endpoint"""
    
    def test_batch_settings_multiple_addresses(self):
        """GET /api/call-settings/batch returns settings for multiple addresses"""
        # Create settings for one address
        test_addr1 = "TEST_iter143_batch_a1"
        test_addr2 = "TEST_iter143_batch_a2"
        
        # Create settings for addr1
        requests.post(
            f"{BASE_URL}/api/call-settings",
            json={
                "address": test_addr1,
                "network": "btc-testnet",
                "accept_calls": False,
                "status_message": "Batch test 1"
            },
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        # Query batch endpoint
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch?addresses={test_addr1},{test_addr2}&network=btc-testnet",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "settings" in data
        
        settings = data["settings"]
        
        # addr1 should have custom settings
        assert test_addr1 in settings
        assert settings[test_addr1].get("accept_calls") == False
        assert settings[test_addr1].get("status_message") == "Batch test 1"
        
        # addr2 should have defaults
        assert test_addr2 in settings
        assert settings[test_addr2].get("accept_calls") == True
        assert settings[test_addr2].get("answering_machine_enabled") == False
        
        print(f"Batch settings: {settings}")
    
    def test_batch_settings_empty_addresses(self):
        """GET /api/call-settings/batch with empty addresses"""
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch?addresses=&network=btc-testnet",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "settings" in data
        # Empty input should return empty settings
        print(f"Empty batch result: {data}")
    
    def test_batch_route_not_matched_as_address(self):
        """Verify /batch route is matched correctly (not as {address} param)"""
        # This tests that the route ordering is correct
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch?addresses=test1,test2&network=btc-testnet",
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return settings dict, not a single address lookup
        assert "settings" in data
        assert isinstance(data["settings"], dict)
        print("Batch route correctly matched")


class TestSingleProfileKeys:
    """Test single profile keys endpoint for comparison"""
    
    def test_single_profile_keys(self):
        """GET /api/profile/keys/{address} returns key data"""
        test_addr = "mzYVhGHnQgwXhCCGvJCqYPLxqKvLPcRZ1P"
        
        response = requests.get(
            f"{BASE_URL}/api/profile/keys/{test_addr}?network=btc-testnet",
            timeout=30
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have has_keys, pkx, pky fields
        assert "has_keys" in data
        assert "pkx" in data
        assert "pky" in data
        print(f"Single profile keys: has_keys={data['has_keys']}, pkx={data['pkx'][:20] if data['pkx'] else 'None'}...")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
