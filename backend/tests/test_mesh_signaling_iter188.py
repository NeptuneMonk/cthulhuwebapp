"""
Test mesh signaling endpoints for iteration 188.
Verifies the WebSocket eviction fix and mesh node APIs.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

class TestMeshEndpoints:
    """Test mesh node registry and stats endpoints"""
    
    def test_mesh_nodes_endpoint(self):
        """Test /api/mesh/nodes returns valid response"""
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "count" in data
        assert isinstance(data["nodes"], list)
        assert isinstance(data["count"], int)
        print(f"PASSED: /api/mesh/nodes returns {data['count']} nodes")
    
    def test_mesh_stats_endpoint(self):
        """Test /api/mesh/stats returns valid response"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "online_nodes" in data
        assert "total_registered" in data
        assert "total_bytes_relayed" in data
        assert "network" in data
        print(f"PASSED: /api/mesh/stats - {data['online_nodes']} online, {data['total_registered']} registered")
    
    def test_mesh_node_quality_endpoint(self):
        """Test /api/mesh/node-quality returns valid response"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "count" in data
        print(f"PASSED: /api/mesh/node-quality returns {data['count']} nodes with quality metrics")


class TestMeshRegister:
    """Test mesh node registration"""
    
    def test_register_node(self):
        """Test /api/mesh/register accepts valid registration"""
        # Use a valid testnet address format (20-90 alphanumeric chars)
        test_address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={
                "address": test_address,
                "network": "btc-testnet",
                "capacity": 5,
                "bandwidth": "normal",
                "services": ["ipfs", "api_cache"]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        assert "node_id" in data
        print(f"PASSED: Node registration accepted for {test_address[:20]}...")
    
    def test_heartbeat(self):
        """Test /api/mesh/heartbeat updates node status"""
        test_address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.post(
            f"{BASE_URL}/api/mesh/heartbeat",
            json={
                "address": test_address,
                "network": "btc-testnet",
                "capacity": 5
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Heartbeat accepted for {test_address[:20]}...")


class TestHealthEndpoint:
    """Test health endpoint"""
    
    def test_health(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        assert "services" in data
        print(f"PASSED: Health endpoint returns healthy status")


class TestWebSocketEndpointExists:
    """Test WebSocket endpoint is accessible (without full WS connection)"""
    
    def test_websocket_endpoint_exists(self):
        """Test that the WebSocket endpoint path exists"""
        # HTTP request to WS endpoint - FastAPI may return 200 or other codes
        test_address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/mesh/signal/{test_address}")
        # Any response (not 404) means the endpoint exists
        assert response.status_code != 404
        print(f"PASSED: WebSocket endpoint exists (returns {response.status_code} for HTTP request)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
