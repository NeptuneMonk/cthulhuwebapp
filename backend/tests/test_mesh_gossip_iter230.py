"""
Test Mesh Snapshot Gossip and Status Dots - Iteration 230

Tests:
1. GET /api/snapshot/auto-delta/status - enabled=true with networks array and announce sub-object
2. GET /api/snapshot/announce/status - all announcement config fields
3. POST /api/snapshot/announce/config?enabled=false - toggle announcement off
4. POST /api/snapshot/announce/config?enabled=true - toggle announcement back on
5. GET /api/object/addr/msBayXP6iCByaHeMteiwmXMbS74x91MmqY?network=btc-testnet - object data with burn_transactions
6. Verify broadcast_snapshot_gossip function exists and can be imported from mesh.py
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestMeshGossipFeatures:
    """Test mesh snapshot gossip and related features"""
    
    def test_health_endpoint(self):
        """Verify backend is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        data = response.json()
        print(f"Health check: {data}")
        assert "services" in data or "status" in data
    
    def test_auto_delta_status_enabled(self):
        """GET /api/snapshot/auto-delta/status should return enabled=true"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status", timeout=10)
        assert response.status_code == 200, f"Auto-delta status failed: {response.status_code}"
        data = response.json()
        print(f"Auto-delta status: {data}")
        
        # Verify enabled is true (auto-started on boot)
        assert "enabled" in data, "Missing 'enabled' field"
        assert data["enabled"] == True, f"Expected enabled=true, got {data['enabled']}"
    
    def test_auto_delta_status_networks(self):
        """GET /api/snapshot/auto-delta/status should return networks array"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Verify networks array exists
        assert "networks" in data, "Missing 'networks' field"
        assert isinstance(data["networks"], list), f"Expected networks to be list, got {type(data['networks'])}"
        assert len(data["networks"]) > 0, "Networks array is empty"
        print(f"Networks: {data['networks']}")
    
    def test_auto_delta_status_announce_subobject(self):
        """GET /api/snapshot/auto-delta/status should return announce sub-object"""
        response = requests.get(f"{BASE_URL}/api/snapshot/auto-delta/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Verify announce sub-object exists
        assert "announce" in data, "Missing 'announce' sub-object"
        announce = data["announce"]
        assert isinstance(announce, dict), f"Expected announce to be dict, got {type(announce)}"
        assert "enabled" in announce, "Missing 'enabled' in announce sub-object"
        print(f"Announce sub-object: {announce}")
    
    def test_announce_status_endpoint(self):
        """GET /api/snapshot/announce/status should return all config fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/announce/status", timeout=10)
        assert response.status_code == 200, f"Announce status failed: {response.status_code}"
        data = response.json()
        print(f"Announce status: {data}")
        
        # Verify all expected fields
        expected_fields = ["enabled", "min_interval_hours", "last_announced_at", 
                          "last_announced_cid", "last_txid", "total_announcements",
                          "min_treasury_balance_sats"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
    
    def test_announce_config_toggle_off(self):
        """POST /api/snapshot/announce/config?enabled=false should toggle off"""
        response = requests.post(f"{BASE_URL}/api/snapshot/announce/config?enabled=false", timeout=10)
        assert response.status_code == 200, f"Announce config toggle off failed: {response.status_code}"
        data = response.json()
        print(f"Announce config (off): {data}")
        
        assert "updated" in data, "Missing 'updated' field"
        assert data["updated"] == True, "Expected updated=true"
        assert data["enabled"] == False, f"Expected enabled=false, got {data['enabled']}"
    
    def test_announce_config_toggle_on(self):
        """POST /api/snapshot/announce/config?enabled=true should toggle back on"""
        response = requests.post(f"{BASE_URL}/api/snapshot/announce/config?enabled=true", timeout=10)
        assert response.status_code == 200, f"Announce config toggle on failed: {response.status_code}"
        data = response.json()
        print(f"Announce config (on): {data}")
        
        assert "updated" in data, "Missing 'updated' field"
        assert data["updated"] == True, "Expected updated=true"
        assert data["enabled"] == True, f"Expected enabled=true, got {data['enabled']}"
    
    def test_burned_object_endpoint(self):
        """GET /api/object/addr/msBayXP6iCByaHeMteiwmXMbS74x91MmqY should return object data"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/msBayXP6iCByaHeMteiwmXMbS74x91MmqY?network=btc-testnet",
            timeout=30
        )
        # Should NOT be 404 or 502
        assert response.status_code not in [404, 502], f"Unexpected error status: {response.status_code}"
        assert response.status_code == 200, f"Object endpoint failed: {response.status_code}"
        
        data = response.json()
        print(f"Object data keys: {list(data.keys())}")
        
        # Verify burn_transactions field exists
        assert "burn_transactions" in data, "Missing 'burn_transactions' field"
        print(f"burn_transactions: {data['burn_transactions']}")
    
    def test_mesh_nodes_endpoint(self):
        """GET /api/mesh/nodes should return nodes list"""
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-testnet", timeout=10)
        assert response.status_code == 200, f"Mesh nodes failed: {response.status_code}"
        data = response.json()
        print(f"Mesh nodes: {data}")
        
        assert "nodes" in data, "Missing 'nodes' field"
        assert "count" in data, "Missing 'count' field"
    
    def test_mesh_stats_endpoint(self):
        """GET /api/mesh/stats should return mesh statistics"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network=btc-testnet", timeout=10)
        assert response.status_code == 200, f"Mesh stats failed: {response.status_code}"
        data = response.json()
        print(f"Mesh stats: {data}")
        
        expected_fields = ["online_nodes", "total_registered", "total_bytes_relayed", "network"]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"


class TestBroadcastSnapshotGossipFunction:
    """Test that broadcast_snapshot_gossip function exists and is importable"""
    
    def test_broadcast_function_exists(self):
        """Verify broadcast_snapshot_gossip can be imported from mesh.py"""
        import sys
        sys.path.insert(0, '/app/backend')
        
        try:
            from routes.mesh import broadcast_snapshot_gossip
            print(f"broadcast_snapshot_gossip function imported successfully")
            print(f"Function signature: {broadcast_snapshot_gossip.__code__.co_varnames[:4]}")
            assert callable(broadcast_snapshot_gossip), "broadcast_snapshot_gossip is not callable"
        except ImportError as e:
            pytest.fail(f"Could not import broadcast_snapshot_gossip: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
