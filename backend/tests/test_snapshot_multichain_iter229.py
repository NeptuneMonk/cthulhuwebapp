"""
Iteration 229: Test multi-chain vacuum, auto-delta on boot, and on-chain CID announcement features.

Features tested:
1. GET /api/snapshot/auto-delta/status - should return enabled=true with networks=[btc-testnet, btc-mainnet] and announce sub-object
2. GET /api/snapshot/announce/status - should return enabled, min_interval_hours, last_announced_at, total_announcements
3. POST /api/snapshot/announce/config?enabled=false - should disable announcements
4. POST /api/snapshot/announce/config?enabled=true - should re-enable announcements
5. POST /api/snapshot/auto-delta/stop - should stop the auto-delta loop
6. POST /api/snapshot/auto-delta/start?interval=15&networks=btc-testnet,btc-mainnet - should restart it
7. GET /api/object/addr/{address}?network=btc-testnet - burned object should return data with burn_transactions > 0 (not 404 or 502)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAutoDeltaStatus:
    """Test auto-delta scheduler status endpoint"""
    
    def test_auto_delta_status_returns_enabled(self):
        """GET /api/snapshot/auto-delta/status should return enabled=true (auto-started on boot)"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "enabled" in data, "Response should contain 'enabled' field"
        assert data["enabled"] == True, "Auto-delta should be enabled (auto-started on boot)"
        
    def test_auto_delta_status_has_networks(self):
        """GET /api/snapshot/auto-delta/status should return networks=[btc-testnet, btc-mainnet]"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "networks" in data, "Response should contain 'networks' field"
        assert isinstance(data["networks"], list), "networks should be a list"
        assert "btc-testnet" in data["networks"], "networks should include btc-testnet"
        assert "btc-mainnet" in data["networks"], "networks should include btc-mainnet"
        
    def test_auto_delta_status_has_announce_subobject(self):
        """GET /api/snapshot/auto-delta/status should return announce sub-object"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "announce" in data, "Response should contain 'announce' sub-object"
        announce = data["announce"]
        assert "enabled" in announce, "announce should have 'enabled' field"
        assert "total_announcements" in announce, "announce should have 'total_announcements' field"
        
    def test_auto_delta_status_has_interval(self):
        """GET /api/snapshot/auto-delta/status should return interval_minutes"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "interval_minutes" in data, "Response should contain 'interval_minutes' field"
        assert isinstance(data["interval_minutes"], int), "interval_minutes should be an integer"
        assert data["interval_minutes"] >= 5, "interval_minutes should be at least 5"


class TestAnnounceStatus:
    """Test on-chain CID announcement status endpoint"""
    
    def test_announce_status_endpoint(self):
        """GET /api/snapshot/announce/status should return announcement state"""
        response = requests.get(f"{BASE_URL}/api/snapshot/announce/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "enabled" in data, "Response should contain 'enabled' field"
        assert "min_interval_hours" in data, "Response should contain 'min_interval_hours' field"
        assert "last_announced_at" in data, "Response should contain 'last_announced_at' field"
        assert "total_announcements" in data, "Response should contain 'total_announcements' field"
        
    def test_announce_status_has_treasury_balance(self):
        """GET /api/snapshot/announce/status should return min_treasury_balance_sats"""
        response = requests.get(f"{BASE_URL}/api/snapshot/announce/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "min_treasury_balance_sats" in data, "Response should contain 'min_treasury_balance_sats' field"
        assert isinstance(data["min_treasury_balance_sats"], int), "min_treasury_balance_sats should be an integer"


class TestAnnounceConfig:
    """Test on-chain CID announcement configuration endpoint"""
    
    def test_disable_announcements(self):
        """POST /api/snapshot/announce/config?enabled=false should disable announcements"""
        response = requests.post(f"{BASE_URL}/api/snapshot/announce/config?enabled=false")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "updated" in data, "Response should contain 'updated' field"
        assert data["updated"] == True, "updated should be True"
        assert data["enabled"] == False, "enabled should be False after disabling"
        
    def test_enable_announcements(self):
        """POST /api/snapshot/announce/config?enabled=true should re-enable announcements"""
        response = requests.post(f"{BASE_URL}/api/snapshot/announce/config?enabled=true")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "updated" in data, "Response should contain 'updated' field"
        assert data["updated"] == True, "updated should be True"
        assert data["enabled"] == True, "enabled should be True after enabling"


class TestAutoDeltaControl:
    """Test auto-delta start/stop control endpoints"""
    
    def test_stop_auto_delta(self):
        """POST /api/snapshot/auto-delta/stop should stop the auto-delta loop"""
        response = requests.post(f"{BASE_URL}/api/snapshot/auto-delta/stop")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "stopped" in data, "Response should contain 'stopped' field"
        assert data["stopped"] == True, "stopped should be True"
        
        # Verify it's actually stopped
        status_response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        status_data = status_response.json()
        assert status_data["enabled"] == False, "Auto-delta should be disabled after stop"
        
    def test_start_auto_delta_with_params(self):
        """POST /api/snapshot/auto-delta/start?interval=15&networks=btc-testnet,btc-mainnet should restart it"""
        response = requests.post(f"{BASE_URL}/api/snapshot/auto-delta/start?interval=15&networks=btc-testnet,btc-mainnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "started" in data, "Response should contain 'started' field"
        assert data["started"] == True, "started should be True"
        
        # Verify it's actually started
        status_response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status")
        status_data = status_response.json()
        assert status_data["enabled"] == True, "Auto-delta should be enabled after start"
        assert "btc-testnet" in status_data["networks"], "networks should include btc-testnet"
        assert "btc-mainnet" in status_data["networks"], "networks should include btc-mainnet"


class TestBurnedObjectFallback:
    """Test burned object fallback - should return data with burn_transactions, not 404 or 502"""
    
    def test_burned_object_returns_data(self):
        """GET /api/object/addr/msBayXP6iCByaHeMteiwmXMbS74x91MmqY?network=btc-testnet should return object data"""
        burned_address = "msBayXP6iCByaHeMteiwmXMbS74x91MmqY"
        response = requests.get(f"{BASE_URL}/api/object/addr/{burned_address}?network=btc-testnet", timeout=30)
        
        # Should NOT return 404 or 502
        assert response.status_code != 404, f"Burned object should not return 404"
        assert response.status_code != 502, f"Burned object should not return 502"
        
        # Should return 200 with burn data
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have burn_transactions field
        assert "burn_transactions" in data, "Response should contain 'burn_transactions' field"
        assert data["burn_transactions"] > 0, "burn_transactions should be > 0 for a burned object"
        
    def test_burned_object_has_burn_status(self):
        """Burned object should have is_burned and burn_status fields"""
        burned_address = "msBayXP6iCByaHeMteiwmXMbS74x91MmqY"
        response = requests.get(f"{BASE_URL}/api/object/addr/{burned_address}?network=btc-testnet", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            # Check for burn-related fields
            if "burn_transactions" in data and data["burn_transactions"] > 0:
                assert "is_burned" in data or "burn_status" in data, "Burned object should have is_burned or burn_status field"


class TestSnapshotStatus:
    """Test general snapshot status endpoint"""
    
    def test_snapshot_status_endpoint(self):
        """GET /api/snapshot/status should return vacuum and cache info"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "vacuum" in data, "Response should contain 'vacuum' field"
        assert "cache" in data, "Response should contain 'cache' field"
        assert "snapshots" in data, "Response should contain 'snapshots' field"


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """GET /api/health should return 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
