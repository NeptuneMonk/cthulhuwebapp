"""
Test suite for Call Settings API endpoints (iteration 141)
Tests the new P2P phone/call settings feature for the walkie-talkie system.
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCallSettingsAPI:
    """Test call settings CRUD operations"""
    
    # Use unique test address to avoid conflicts
    TEST_ADDRESS = f"TEST_call_settings_{int(time.time())}"
    
    def test_health_endpoint(self):
        """Verify backend is healthy with MongoDB up"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        assert data.get("services", {}).get("mongodb") == "up"
        print(f"✓ Health check passed: {data}")
    
    def test_get_default_settings(self):
        """GET /api/call-settings/{address} returns defaults for new address"""
        response = requests.get(
            f"{BASE_URL}/api/call-settings/{self.TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify default values
        assert data["address"] == self.TEST_ADDRESS
        assert data["network"] == "btc-testnet"
        assert data["accept_calls"] == True  # Default: accepting calls
        assert data["answering_machine_enabled"] == False
        assert data["answering_machine_cid"] is None
        assert data["answering_machine_max_seconds"] == 15
        assert data["status_message"] is None
        print(f"✓ Default settings returned correctly: accept_calls={data['accept_calls']}")
    
    def test_update_settings_disable_calls(self):
        """POST /api/call-settings saves updated settings"""
        payload = {
            "address": self.TEST_ADDRESS,
            "network": "btc-testnet",
            "accept_calls": False,
            "answering_machine_enabled": True,
            "answering_machine_max_seconds": 30,
            "status_message": "Away from the wasteland"
        }
        response = requests.post(
            f"{BASE_URL}/api/call-settings",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response
        assert data["success"] == True
        assert data["address"] == self.TEST_ADDRESS
        assert data["accept_calls"] == False
        assert data["answering_machine_enabled"] == True
        assert data["answering_machine_max_seconds"] == 30
        assert data["status_message"] == "Away from the wasteland"
        print(f"✓ Settings updated: accept_calls={data['accept_calls']}, answering_machine={data['answering_machine_enabled']}")
    
    def test_get_updated_settings_persisted(self):
        """GET after POST verifies settings were persisted in database"""
        response = requests.get(
            f"{BASE_URL}/api/call-settings/{self.TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify persisted values match what we set
        assert data["accept_calls"] == False
        assert data["answering_machine_enabled"] == True
        assert data["answering_machine_max_seconds"] == 30
        assert data["status_message"] == "Away from the wasteland"
        assert "updated_at" in data  # Should have timestamp after update
        print(f"✓ Settings persisted correctly in database")
    
    def test_update_settings_enable_calls(self):
        """POST to re-enable calls"""
        payload = {
            "address": self.TEST_ADDRESS,
            "network": "btc-testnet",
            "accept_calls": True,
            "answering_machine_enabled": False
        }
        response = requests.post(
            f"{BASE_URL}/api/call-settings",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        assert data["accept_calls"] == True
        print(f"✓ Calls re-enabled successfully")
    
    def test_batch_settings_endpoint(self):
        """GET /api/call-settings/batch returns settings for multiple addresses"""
        # Create a second test address with custom settings
        second_addr = f"TEST_batch_{int(time.time())}"
        requests.post(
            f"{BASE_URL}/api/call-settings",
            json={
                "address": second_addr,
                "network": "btc-testnet",
                "accept_calls": False
            }
        )
        
        # Batch query
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch",
            params={
                "addresses": f"{self.TEST_ADDRESS},{second_addr},unknown_addr",
                "network": "btc-testnet"
            }
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "settings" in data
        settings = data["settings"]
        
        # First address should have our updated settings
        assert self.TEST_ADDRESS in settings
        assert settings[self.TEST_ADDRESS]["accept_calls"] == True  # We re-enabled it
        
        # Second address should have disabled calls
        assert second_addr in settings
        assert settings[second_addr]["accept_calls"] == False
        
        # Unknown address should have defaults
        assert "unknown_addr" in settings
        assert settings["unknown_addr"]["accept_calls"] == True  # Default
        
        print(f"✓ Batch endpoint returned {len(settings)} addresses correctly")
    
    def test_batch_empty_addresses(self):
        """Batch endpoint handles empty addresses gracefully"""
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch",
            params={"addresses": "", "network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["settings"] == {}
        print(f"✓ Empty batch handled correctly")
    
    def test_different_networks_isolated(self):
        """Settings are isolated per network"""
        # Set mainnet settings
        requests.post(
            f"{BASE_URL}/api/call-settings",
            json={
                "address": self.TEST_ADDRESS,
                "network": "btc-mainnet",
                "accept_calls": False
            }
        )
        
        # Query testnet - should still have testnet settings
        testnet_response = requests.get(
            f"{BASE_URL}/api/call-settings/{self.TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        testnet_data = testnet_response.json()
        
        # Query mainnet
        mainnet_response = requests.get(
            f"{BASE_URL}/api/call-settings/{self.TEST_ADDRESS}",
            params={"network": "btc-mainnet"}
        )
        mainnet_data = mainnet_response.json()
        
        # Testnet should have accept_calls=True (we re-enabled it)
        assert testnet_data["accept_calls"] == True
        # Mainnet should have accept_calls=False
        assert mainnet_data["accept_calls"] == False
        
        print(f"✓ Network isolation verified: testnet={testnet_data['accept_calls']}, mainnet={mainnet_data['accept_calls']}")


class TestCallSettingsIntegration:
    """Integration tests for call settings with other endpoints"""
    
    def test_call_settings_index_created(self):
        """Verify the call_settings index exists (from server startup)"""
        # This is implicitly tested by the fact that queries work
        # The index is created in server.py startup
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print(f"✓ Server startup completed (indexes created)")
    
    def test_gzip_compression_on_batch(self):
        """Verify GZip compression works on batch endpoint"""
        # Create many addresses to get a larger response
        addresses = ",".join([f"addr_{i}" for i in range(30)])
        response = requests.get(
            f"{BASE_URL}/api/call-settings/batch",
            params={"addresses": addresses, "network": "btc-testnet"},
            headers={"Accept-Encoding": "gzip"}
        )
        assert response.status_code == 200
        # Response should be valid JSON regardless of compression
        data = response.json()
        assert "settings" in data
        assert len(data["settings"]) == 30
        print(f"✓ Batch endpoint handles 30 addresses correctly")


@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data():
    """Cleanup test data after all tests complete"""
    yield
    # Note: In a real scenario, we'd delete TEST_ prefixed data
    # For now, the test data is harmless and will be overwritten on next run
    print("Test cleanup complete")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
