"""
Test P2P Mesh Relay Endpoints - Iteration 161
Tests for mesh node registry, heartbeat, discovery, stats, and relay tracking.
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestMeshEndpoints:
    """Test mesh relay API endpoints"""
    
    # Test node registration
    def test_mesh_register_node(self):
        """POST /api/mesh/register should register a node and return ok:true"""
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_mesh_node_001",
            "network": "btc-testnet",
            "urn": "test_node_urn",
            "capacity": 5,
            "bandwidth": "normal",
            "services": ["ipfs", "api_cache"]
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        assert "node_id" in data, f"Expected node_id in response, got {data}"
        print(f"✓ Register node: {data}")
    
    # Test heartbeat
    def test_mesh_heartbeat(self):
        """POST /api/mesh/heartbeat should keep node alive"""
        # First register
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_mesh_heartbeat_node",
            "network": "btc-testnet",
            "capacity": 5
        })
        
        # Then heartbeat
        response = requests.post(f"{BASE_URL}/api/mesh/heartbeat", json={
            "address": "TEST_mesh_heartbeat_node",
            "network": "btc-testnet",
            "capacity": 4
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Heartbeat: {data}")
    
    # Test heartbeat auto-registers if not registered
    def test_mesh_heartbeat_auto_register(self):
        """POST /api/mesh/heartbeat should auto-register if node not found"""
        unique_addr = f"TEST_mesh_auto_reg_{int(time.time())}"
        response = requests.post(f"{BASE_URL}/api/mesh/heartbeat", json={
            "address": unique_addr,
            "network": "btc-testnet",
            "capacity": 3
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Heartbeat auto-register: {data}")
    
    # Test get active nodes
    def test_mesh_get_nodes(self):
        """GET /api/mesh/nodes should return list of registered nodes"""
        # Register a node first
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_mesh_list_node",
            "network": "btc-testnet",
            "capacity": 5,
            "services": ["ipfs"]
        })
        
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "nodes" in data, f"Expected 'nodes' key in response, got {data}"
        assert "count" in data, f"Expected 'count' key in response, got {data}"
        assert isinstance(data["nodes"], list), f"Expected nodes to be a list, got {type(data['nodes'])}"
        print(f"✓ Get nodes: count={data['count']}, nodes={len(data['nodes'])}")
    
    # Test get mesh stats
    def test_mesh_get_stats(self):
        """GET /api/mesh/stats should return network statistics"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "online_nodes" in data, f"Expected 'online_nodes' in response, got {data}"
        assert "total_registered" in data, f"Expected 'total_registered' in response, got {data}"
        assert "total_bytes_relayed" in data, f"Expected 'total_bytes_relayed' in response, got {data}"
        assert "network" in data, f"Expected 'network' in response, got {data}"
        print(f"✓ Get stats: online={data['online_nodes']}, total={data['total_registered']}, bytes={data['total_bytes_relayed']}")
    
    # Test deregister node
    def test_mesh_deregister_node(self):
        """POST /api/mesh/deregister should mark node offline"""
        # Register first
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_mesh_dereg_node",
            "network": "btc-testnet"
        })
        
        # Deregister
        response = requests.post(f"{BASE_URL}/api/mesh/deregister?address=TEST_mesh_dereg_node&network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Deregister node: {data}")
    
    # Test relay stat tracking
    def test_mesh_relay_stat(self):
        """POST /api/mesh/relay-stat should track bytes relayed"""
        # Register first
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_mesh_relay_stat_node",
            "network": "btc-testnet"
        })
        
        # Track relay stats
        response = requests.post(f"{BASE_URL}/api/mesh/relay-stat?address=TEST_mesh_relay_stat_node&bytes_relayed=1024&network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Relay stat: {data}")


class TestFrontendErrorLogging:
    """Test frontend error logging endpoint"""
    
    def test_log_frontend_error(self):
        """POST /api/log-error should accept frontend error reports"""
        response = requests.post(f"{BASE_URL}/api/log-error", json={
            "message": "TEST_error: Test error message from pytest",
            "stack": "Error: Test error\n    at TestComponent.js:42",
            "url": "https://example.com/test",
            "user_address": "TEST_user_address",
            "component": "TestComponent"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Log frontend error: {data}")
    
    def test_log_frontend_error_minimal(self):
        """POST /api/log-error should work with minimal payload"""
        response = requests.post(f"{BASE_URL}/api/log-error", json={
            "message": "TEST_minimal_error: Minimal error"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok:true, got {data}"
        print(f"✓ Log minimal error: {data}")


class TestAuthGuardRoutes:
    """Test that protected routes redirect unauthenticated users"""
    
    def test_feed_is_public(self):
        """GET /feed should be accessible without login (public route)"""
        response = requests.get(f"{BASE_URL}/feed", allow_redirects=False)
        # Frontend routes return HTML, not 404
        # We just check it doesn't redirect to /auth
        assert response.status_code in [200, 304], f"Expected 200/304, got {response.status_code}"
        print(f"✓ /feed is accessible (status {response.status_code})")
    
    def test_objects_is_public(self):
        """GET /objects should be accessible without login (public route)"""
        response = requests.get(f"{BASE_URL}/objects", allow_redirects=False)
        assert response.status_code in [200, 304], f"Expected 200/304, got {response.status_code}"
        print(f"✓ /objects is accessible (status {response.status_code})")


# Cleanup fixture
@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data():
    """Cleanup TEST_ prefixed data after tests"""
    yield
    # Note: MongoDB cleanup would require direct DB access
    # For now, test data is prefixed with TEST_ for identification
    print("\n[Cleanup] Test data prefixed with TEST_ should be cleaned up manually if needed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
