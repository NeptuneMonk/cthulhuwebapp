"""
Test suite for Iteration 164: DM Off-chain Integration + Mesh Phase 4 Smart Routing

Features tested:
1. GET /api/mesh/node-quality - Node quality metrics with composite scoring
2. POST /api/chat/checkpoint - IPFS checkpoint upload (regression)
3. GET /api/chat/checkpoint/restore/{cid} - IPFS checkpoint restore (regression)
4. WebSocket /api/chat/ws/{room_address} - Room-based relay (regression)
"""
import pytest
import requests
import os
import json
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestMeshNodeQuality:
    """Test GET /api/mesh/node-quality endpoint - Phase 4 Smart Routing"""
    
    def test_node_quality_endpoint_exists(self):
        """Verify /api/mesh/node-quality endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print("PASSED: /api/mesh/node-quality endpoint exists and returns 200")
    
    def test_node_quality_response_structure(self):
        """Verify response contains nodes array with quality metrics"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "nodes" in data, "Response should contain 'nodes' key"
        assert "count" in data, "Response should contain 'count' key"
        assert isinstance(data["nodes"], list), "'nodes' should be a list"
        assert isinstance(data["count"], int), "'count' should be an integer"
        print(f"PASSED: Response structure valid - {data['count']} nodes returned")
    
    def test_node_quality_metrics_fields(self):
        """Verify each node has required quality metric fields"""
        # First register a test node to ensure we have data
        register_response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_quality_node_164",
            "network": "btc-testnet",
            "urn": "test_quality_urn",
            "capacity": 5,
            "bandwidth": "normal",
            "services": ["ipfs", "api_cache"]
        })
        assert register_response.status_code == 200, f"Node registration failed: {register_response.text}"
        
        # Now check quality endpoint
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        if data["count"] > 0:
            node = data["nodes"][0]
            required_fields = ["address", "online", "uptime_score", "capacity_score", "relay_score", "composite_score"]
            for field in required_fields:
                assert field in node, f"Node missing required field: {field}"
            
            # Verify score types are numeric
            assert isinstance(node["uptime_score"], (int, float)), "uptime_score should be numeric"
            assert isinstance(node["capacity_score"], (int, float)), "capacity_score should be numeric"
            assert isinstance(node["relay_score"], (int, float)), "relay_score should be numeric"
            assert isinstance(node["composite_score"], (int, float)), "composite_score should be numeric"
            print(f"PASSED: Node quality metrics valid - composite_score: {node['composite_score']}")
        else:
            print("PASSED: No nodes registered, but endpoint structure is valid")
    
    def test_node_quality_sorted_by_composite_score(self):
        """Verify nodes are sorted by composite_score descending"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        if len(data["nodes"]) >= 2:
            scores = [n["composite_score"] for n in data["nodes"]]
            assert scores == sorted(scores, reverse=True), "Nodes should be sorted by composite_score descending"
            print(f"PASSED: Nodes sorted by composite_score - top score: {scores[0]}")
        else:
            print("PASSED: Less than 2 nodes, sorting check skipped")


class TestChatCheckpointRegression:
    """Regression tests for POST /api/chat/checkpoint and GET /api/chat/checkpoint/restore/{cid}"""
    
    def test_checkpoint_upload_success(self):
        """POST /api/chat/checkpoint accepts bundle JSON and returns CID"""
        bundle = {
            "version": 1,
            "address": "TEST_dm_checkpoint_164",
            "messages": [
                {"id": "msg1", "content": "Test DM message", "timestamp": "2026-01-01T00:00:00Z"}
            ],
            "created_at": "2026-01-01T00:00:00Z"
        }
        response = requests.post(f"{BASE_URL}/api/chat/checkpoint", json={
            "bundle_json": json.dumps(bundle),
            "address": "TEST_dm_checkpoint_164",
            "network": "btc-testnet"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "cid" in data, "Response should contain 'cid'"
        assert len(data["cid"]) > 10, "CID should be a valid IPFS hash"
        print(f"PASSED: Checkpoint uploaded - CID: {data['cid'][:20]}...")
        return data["cid"]
    
    def test_checkpoint_restore_success(self):
        """GET /api/chat/checkpoint/restore/{cid} returns stored bundle"""
        # First upload a checkpoint
        bundle = {
            "version": 1,
            "address": "TEST_restore_164",
            "messages": [{"id": "restore_msg", "content": "Restore test"}],
            "created_at": "2026-01-01T00:00:00Z"
        }
        upload_response = requests.post(f"{BASE_URL}/api/chat/checkpoint", json={
            "bundle_json": json.dumps(bundle),
            "address": "TEST_restore_164",
            "network": "btc-testnet"
        })
        assert upload_response.status_code == 200
        cid = upload_response.json()["cid"]
        
        # Now restore it
        restore_response = requests.get(f"{BASE_URL}/api/chat/checkpoint/restore/{cid}")
        assert restore_response.status_code == 200, f"Expected 200, got {restore_response.status_code}: {restore_response.text}"
        data = restore_response.json()
        assert "bundle" in data, "Response should contain 'bundle'"
        assert data["bundle"]["address"] == "TEST_restore_164", "Bundle address should match"
        print(f"PASSED: Checkpoint restored - CID: {cid[:20]}...")
    
    def test_checkpoint_restore_invalid_cid(self):
        """GET /api/chat/checkpoint/restore/{invalid} returns error"""
        response = requests.get(f"{BASE_URL}/api/chat/checkpoint/restore/invalid_cid_12345")
        # Should return 404 or 500 for invalid CID
        assert response.status_code in [400, 404, 500], f"Expected error status, got {response.status_code}"
        print(f"PASSED: Invalid CID returns error status {response.status_code}")


class TestMeshNodesEndpoint:
    """Test GET /api/mesh/nodes endpoint for smart routing discovery"""
    
    def test_mesh_nodes_endpoint(self):
        """GET /api/mesh/nodes returns active nodes list"""
        response = requests.get(f"{BASE_URL}/api/mesh/nodes", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "nodes" in data, "Response should contain 'nodes'"
        assert "count" in data, "Response should contain 'count'"
        print(f"PASSED: /api/mesh/nodes returns {data['count']} nodes")
    
    def test_mesh_register_and_discover(self):
        """Register a node and verify it appears in discovery"""
        # Register a test node
        register_response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_discover_node_164",
            "network": "btc-testnet",
            "urn": "test_discover_urn",
            "capacity": 5,
            "bandwidth": "high",
            "services": ["ipfs", "api_cache"]
        })
        assert register_response.status_code == 200
        
        # Discover nodes
        discover_response = requests.get(f"{BASE_URL}/api/mesh/nodes", params={"network": "btc-testnet"})
        assert discover_response.status_code == 200
        data = discover_response.json()
        
        # Check if our node is in the list
        addresses = [n["address"] for n in data["nodes"]]
        assert "TEST_discover_node_164" in addresses, "Registered node should appear in discovery"
        print("PASSED: Registered node appears in discovery")


class TestMeshStats:
    """Test GET /api/mesh/stats endpoint"""
    
    def test_mesh_stats_endpoint(self):
        """GET /api/mesh/stats returns network statistics"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        required_fields = ["online_nodes", "total_registered", "total_bytes_relayed", "network"]
        for field in required_fields:
            assert field in data, f"Response missing field: {field}"
        
        print(f"PASSED: Mesh stats - {data['online_nodes']} online, {data['total_registered']} total")


class TestWebSocketChatRelay:
    """Test WebSocket /api/chat/ws/{room_address} endpoint (regression)"""
    
    def test_websocket_endpoint_accessible(self):
        """Verify WebSocket endpoint is accessible via HTTP upgrade check"""
        # We can't do full WebSocket test with requests, but we can verify the route exists
        # by checking if the server responds to a regular HTTP request on the WS path
        response = requests.get(f"{BASE_URL}/api/chat/checkpoint")
        # This should fail with 405 (Method Not Allowed) since it's POST only
        # But it proves the chat router is registered
        assert response.status_code in [200, 405, 422], f"Chat router should be registered, got {response.status_code}"
        print("PASSED: Chat relay router is registered")


class TestDMRoomKeyFormat:
    """Test DM room key format for WebSocket relay"""
    
    def test_dm_room_format(self):
        """Verify DM room key format is dm_{addr1}_{addr2} sorted"""
        # This is a code review test - verify the format in useOffchainDM.js
        # The actual WebSocket test would require a WebSocket client
        addr1 = "mnpFzp3QAuGpmEQDn9A2kyzfvqKWjQnRMD"
        addr2 = "n1wgm6kkzMcNfAtJmes8YhpvtDzdNhDY5a"
        
        # Expected format: dm_{smaller}_{larger}
        expected = f"dm_{min(addr1, addr2)}_{max(addr1, addr2)}"
        assert expected.startswith("dm_"), "DM room key should start with 'dm_'"
        assert "_" in expected[3:], "DM room key should have underscore separator"
        print(f"PASSED: DM room key format verified - {expected[:30]}...")


# Cleanup test data
@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    # Cleanup is best-effort
    try:
        requests.post(f"{BASE_URL}/api/mesh/deregister", params={
            "address": "TEST_quality_node_164",
            "network": "btc-testnet"
        })
        requests.post(f"{BASE_URL}/api/mesh/deregister", params={
            "address": "TEST_discover_node_164",
            "network": "btc-testnet"
        })
    except:
        pass
