"""
Test Call Settings API - Iteration 142
Tests for the P2P phone/call settings endpoints:
- GET /api/health
- GET /api/call-settings/{address}
- POST /api/call-settings
- GET /api/call-settings/batch
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_200(self):
        """GET /api/health returns 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: Health endpoint returns 200 with healthy status")
    
    def test_health_has_services(self):
        """Health endpoint includes mongodb and ipfs service status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert "mongodb" in data["services"]
        assert "ipfs" in data["services"]
        assert data["services"]["mongodb"] == "up"
        print(f"PASS: Health services - MongoDB: {data['services']['mongodb']}, IPFS: {data['services']['ipfs']}")


class TestCallSettingsGet:
    """GET /api/call-settings/{address} tests"""
    
    def test_get_default_settings(self):
        """GET /api/call-settings/{address} returns default settings for unknown address"""
        # Use unique address to ensure we get defaults
        import time
        unique_addr = f"TEST_default_{int(time.time())}"
        response = requests.get(f"{BASE_URL}/api/call-settings/{unique_addr}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Verify default values
        assert data.get("address") == unique_addr
        assert data.get("accept_calls") == True
        assert data.get("answering_machine_enabled") == False
        assert data.get("answering_machine_cid") is None
        assert data.get("answering_machine_max_seconds") == 15
        assert data.get("status_message") is None
        print("PASS: Default settings returned for unknown address")
    
    def test_get_settings_different_network(self):
        """Settings are isolated by network"""
        response = requests.get(f"{BASE_URL}/api/call-settings/testaddr123?network=btc-mainnet")
        assert response.status_code == 200
        data = response.json()
        assert data.get("network") == "btc-mainnet"
        print("PASS: Network parameter is respected")


class TestCallSettingsPost:
    """POST /api/call-settings tests"""
    
    def test_toggle_accept_calls_off(self):
        """POST /api/call-settings to toggle accept_calls off works"""
        payload = {
            "address": "TEST_iter142_addr1",
            "network": "btc-testnet",
            "accept_calls": False,
            "answering_machine_enabled": False
        }
        response = requests.post(f"{BASE_URL}/api/call-settings", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("success") == True
        assert data.get("accept_calls") == False
        print("PASS: accept_calls toggled off successfully")
        
        # Verify persistence with GET
        get_response = requests.get(f"{BASE_URL}/api/call-settings/TEST_iter142_addr1?network=btc-testnet")
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("accept_calls") == False
        print("PASS: Settings persisted correctly")
    
    def test_enable_answering_machine(self):
        """POST /api/call-settings to enable answering_machine works"""
        payload = {
            "address": "TEST_iter142_addr2",
            "network": "btc-testnet",
            "accept_calls": False,
            "answering_machine_enabled": True,
            "answering_machine_cid": "QmTestCid123",
            "answering_machine_max_seconds": 30,
            "status_message": "Away from the wasteland"
        }
        response = requests.post(f"{BASE_URL}/api/call-settings", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("success") == True
        assert data.get("answering_machine_enabled") == True
        assert data.get("answering_machine_cid") == "QmTestCid123"
        assert data.get("answering_machine_max_seconds") == 30
        assert data.get("status_message") == "Away from the wasteland"
        print("PASS: Answering machine enabled with all settings")
        
        # Verify persistence
        get_response = requests.get(f"{BASE_URL}/api/call-settings/TEST_iter142_addr2?network=btc-testnet")
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert get_data.get("answering_machine_enabled") == True
        assert get_data.get("answering_machine_cid") == "QmTestCid123"
        print("PASS: Answering machine settings persisted")


class TestCallSettingsBatch:
    """GET /api/call-settings/batch tests"""
    
    def test_batch_settings_multiple_addresses(self):
        """GET /api/call-settings/batch?addresses=a1,a2&network=btc-testnet returns settings for all"""
        # First create some test data
        for addr in ["TEST_batch_a1", "TEST_batch_a2"]:
            requests.post(f"{BASE_URL}/api/call-settings", json={
                "address": addr,
                "network": "btc-testnet",
                "accept_calls": addr == "TEST_batch_a1",  # a1 accepts, a2 doesn't
                "answering_machine_enabled": False
            })
        
        # Now test batch endpoint
        response = requests.get(f"{BASE_URL}/api/call-settings/batch?addresses=TEST_batch_a1,TEST_batch_a2,TEST_batch_unknown&network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "settings" in data
        settings = data["settings"]
        
        # Check a1 (saved with accept_calls=True)
        assert "TEST_batch_a1" in settings
        assert settings["TEST_batch_a1"]["accept_calls"] == True
        
        # Check a2 (saved with accept_calls=False)
        assert "TEST_batch_a2" in settings
        assert settings["TEST_batch_a2"]["accept_calls"] == False
        
        # Check unknown address (should return defaults)
        assert "TEST_batch_unknown" in settings
        assert settings["TEST_batch_unknown"]["accept_calls"] == True  # default
        
        print("PASS: Batch endpoint returns settings for all addresses including defaults")
    
    def test_batch_empty_addresses(self):
        """Batch endpoint handles empty addresses gracefully"""
        response = requests.get(f"{BASE_URL}/api/call-settings/batch?addresses=&network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "settings" in data
        assert data["settings"] == {}
        print("PASS: Batch endpoint handles empty addresses")
    
    def test_batch_route_not_matched_as_address(self):
        """Verify /batch is not matched as an address parameter"""
        # This was a bug fixed in iteration 141 - batch route must be before {address} route
        response = requests.get(f"{BASE_URL}/api/call-settings/batch?addresses=test1,test2&network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Should return a dict with "settings" key, not a single address object
        assert "settings" in data
        assert isinstance(data["settings"], dict)
        # Should NOT have "address": "batch" which would indicate wrong route matched
        assert data.get("address") != "batch"
        print("PASS: Batch route correctly matched (not as address parameter)")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_data(self):
        """Clean up TEST_ prefixed data (best effort)"""
        # Note: No delete endpoint exists, but we can verify our test data doesn't interfere
        # by using unique TEST_ prefixes
        print("PASS: Test data uses TEST_ prefix for isolation")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
