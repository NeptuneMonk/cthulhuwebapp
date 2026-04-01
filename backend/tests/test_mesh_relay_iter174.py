"""
Iteration 174: P2P Mesh Relay Network Tests

Tests for the mesh relay system including:
- Node registration, heartbeat, deregistration
- Active nodes discovery
- Mesh stats
- Node quality scores
- WebSocket signaling with keepalive pings
- Node NOT marked offline when WS disconnects (only heartbeat timeout)
- IPFS status (Kubo daemon)
"""

import pytest
import requests
import asyncio
import json
import time
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

# Test node addresses for this iteration
TEST_NODE_1 = "test_mesh_node_174_001"
TEST_NODE_2 = "test_mesh_node_174_002"
TEST_NODE_3 = "test_mesh_node_174_003"
NETWORK = "btc-testnet"


class TestMeshRegistration:
    """Tests for mesh node registration and heartbeat"""
    
    def test_register_node_success(self):
        """POST /api/mesh/register registers a node successfully"""
        response = requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={
                "address": TEST_NODE_1,
                "network": NETWORK,
                "urn": "testnode174_1",
                "capacity": 5,
                "bandwidth": "normal",
                "services": ["ipfs", "api_cache"]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert data["node_id"] == TEST_NODE_1
        print(f"✓ Node registered: {TEST_NODE_1}")
    
    def test_heartbeat_keeps_node_alive(self):
        """POST /api/mesh/heartbeat keeps a node alive"""
        # First register
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": TEST_NODE_2, "network": NETWORK, "urn": "testnode174_2", "capacity": 5}
        )
        
        # Then heartbeat
        response = requests.post(
            f"{BASE_URL}/api/mesh/heartbeat",
            json={"address": TEST_NODE_2, "network": NETWORK, "capacity": 4}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        print(f"✓ Heartbeat successful for: {TEST_NODE_2}")
    
    def test_heartbeat_auto_registers_unregistered_node(self):
        """POST /api/mesh/heartbeat auto-registers if node not registered"""
        response = requests.post(
            f"{BASE_URL}/api/mesh/heartbeat",
            json={"address": TEST_NODE_3, "network": NETWORK, "urn": "testnode174_3", "capacity": 5}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        # Verify node is now in the list
        nodes_resp = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}")
        nodes = nodes_resp.json()["nodes"]
        addresses = [n["address"] for n in nodes]
        assert TEST_NODE_3 in addresses
        print(f"✓ Heartbeat auto-registered: {TEST_NODE_3}")


class TestMeshDiscovery:
    """Tests for mesh node discovery"""
    
    def test_get_active_nodes_returns_registered_nodes(self):
        """GET /api/mesh/nodes returns active nodes filtered by network"""
        # Ensure we have a registered node
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": TEST_NODE_1, "network": NETWORK, "urn": "testnode174_1", "capacity": 5}
        )
        
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "count" in data
        assert isinstance(data["nodes"], list)
        
        # Verify node structure
        if data["count"] > 0:
            node = data["nodes"][0]
            assert "address" in node
            assert "capacity" in node
            assert "services" in node
            assert "last_heartbeat" in node
        print(f"✓ Active nodes returned: {data['count']} nodes")
    
    def test_get_active_nodes_filters_by_network(self):
        """GET /api/mesh/nodes filters by network parameter"""
        # Register on testnet
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": "testnet_only_node_174", "network": "btc-testnet", "capacity": 5}
        )
        
        # Query mainnet - should not include testnet node
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-mainnet")
        assert response.status_code == 200
        data = response.json()
        addresses = [n["address"] for n in data["nodes"]]
        assert "testnet_only_node_174" not in addresses
        print("✓ Network filtering works correctly")


class TestMeshStats:
    """Tests for mesh network statistics"""
    
    def test_get_mesh_stats_returns_correct_counts(self):
        """GET /api/mesh/stats returns correct online_nodes count"""
        # Register a fresh node
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": TEST_NODE_1, "network": NETWORK, "capacity": 5}
        )
        
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network={NETWORK}")
        assert response.status_code == 200
        data = response.json()
        
        assert "online_nodes" in data
        assert "total_registered" in data
        assert "total_bytes_relayed" in data
        assert "network" in data
        assert data["network"] == NETWORK
        assert data["online_nodes"] >= 1  # At least our test node
        print(f"✓ Mesh stats: {data['online_nodes']} online, {data['total_registered']} total")


class TestMeshDeregistration:
    """Tests for mesh node deregistration"""
    
    def test_deregister_marks_node_offline(self):
        """POST /api/mesh/deregister marks node offline"""
        # Register first
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": "deregister_test_174", "network": NETWORK, "capacity": 5}
        )
        
        # Verify it's in active nodes
        nodes_before = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}").json()
        addresses_before = [n["address"] for n in nodes_before["nodes"]]
        assert "deregister_test_174" in addresses_before
        
        # Deregister
        response = requests.post(
            f"{BASE_URL}/api/mesh/deregister?address=deregister_test_174&network={NETWORK}"
        )
        assert response.status_code == 200
        assert response.json()["ok"] == True
        
        # Verify it's no longer in active nodes
        nodes_after = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}").json()
        addresses_after = [n["address"] for n in nodes_after["nodes"]]
        assert "deregister_test_174" not in addresses_after
        print("✓ Deregister correctly marks node offline")


class TestNodeQuality:
    """Tests for node quality scoring"""
    
    def test_get_node_quality_returns_scores(self):
        """GET /api/mesh/node-quality returns quality scores"""
        # Register a node first
        requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": TEST_NODE_1, "network": NETWORK, "capacity": 5}
        )
        
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network={NETWORK}")
        assert response.status_code == 200
        data = response.json()
        
        assert "nodes" in data
        assert "count" in data
        
        if data["count"] > 0:
            node = data["nodes"][0]
            assert "address" in node
            assert "online" in node
            assert "capacity_remaining" in node
            assert "uptime_score" in node
            assert "capacity_score" in node
            assert "relay_score" in node
            assert "composite_score" in node
        print(f"✓ Node quality scores returned for {data['count']} nodes")


class TestIPFSStatus:
    """Tests for IPFS daemon status"""
    
    def test_ipfs_status_returns_online(self):
        """GET /api/ipfs/status returns online=true (Kubo daemon running)"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        data = response.json()
        
        assert "online" in data
        assert data["online"] == True
        
        # Should also have peer_id and agent info
        if data["online"]:
            assert "peer_id" in data
            assert "agent" in data
            assert "kubo" in data["agent"].lower()
        print(f"✓ IPFS daemon online: {data.get('agent', 'unknown')}")


class TestWebSocketSignaling:
    """Tests for WebSocket signaling endpoint"""
    
    def test_websocket_accepts_connection(self):
        """WebSocket /api/mesh/signal/{address} accepts connections"""
        import websocket
        
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/api/mesh/signal/ws_test_node_174"
        
        try:
            ws = websocket.create_connection(ws_url, timeout=5)
            assert ws.connected
            print("✓ WebSocket connection established")
            ws.close()
        except Exception as e:
            pytest.fail(f"WebSocket connection failed: {e}")
    
    def test_websocket_receives_keepalive_ping(self):
        """WebSocket keepalive sends ping messages every 25 seconds"""
        import websocket
        
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/api/mesh/signal/ws_ping_test_174"
        
        try:
            ws = websocket.create_connection(ws_url, timeout=30)
            
            # Wait for ping (should come within 25-30 seconds)
            start = time.time()
            received_ping = False
            
            while time.time() - start < 30:
                try:
                    ws.settimeout(5)
                    msg = ws.recv()
                    data = json.loads(msg)
                    if data.get("type") == "ping":
                        received_ping = True
                        print(f"✓ Received keepalive ping after {time.time() - start:.1f}s")
                        break
                except websocket.WebSocketTimeoutException:
                    continue
            
            ws.close()
            assert received_ping, "Did not receive keepalive ping within 30 seconds"
        except Exception as e:
            pytest.fail(f"WebSocket ping test failed: {e}")
    
    def test_websocket_accepts_pong_without_error(self):
        """WebSocket accepts pong messages from clients without error"""
        import websocket
        
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/api/mesh/signal/ws_pong_test_174"
        
        try:
            ws = websocket.create_connection(ws_url, timeout=5)
            
            # Send pong message
            ws.send(json.dumps({"type": "pong"}))
            
            # Should not cause an error - connection should remain open
            time.sleep(1)
            assert ws.connected
            print("✓ WebSocket accepted pong message without error")
            ws.close()
        except Exception as e:
            pytest.fail(f"WebSocket pong test failed: {e}")


class TestNodeNotOfflineOnWSDisconnect:
    """Tests that node is NOT marked offline when WebSocket disconnects"""
    
    def test_node_stays_online_after_ws_disconnect(self):
        """Node is NOT marked offline when WebSocket disconnects (verify via GET /api/mesh/nodes after WS close)"""
        import websocket
        
        test_addr = "ws_disconnect_test_174"
        
        # 1. Register the node
        reg_resp = requests.post(
            f"{BASE_URL}/api/mesh/register",
            json={"address": test_addr, "network": NETWORK, "urn": "wsdisconnect", "capacity": 5}
        )
        assert reg_resp.status_code == 200
        
        # 2. Verify node is in active list
        nodes_before = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}").json()
        addresses_before = [n["address"] for n in nodes_before["nodes"]]
        assert test_addr in addresses_before, "Node should be active after registration"
        
        # 3. Connect WebSocket
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        ws_url = f"{ws_url}/api/mesh/signal/{test_addr}"
        
        ws = websocket.create_connection(ws_url, timeout=5)
        assert ws.connected
        
        # 4. Close WebSocket (simulating disconnect)
        ws.close()
        time.sleep(1)  # Give server time to process disconnect
        
        # 5. Verify node is STILL in active list (not marked offline by WS disconnect)
        nodes_after = requests.get(f"{BASE_URL}/api/mesh/nodes?network={NETWORK}").json()
        addresses_after = [n["address"] for n in nodes_after["nodes"]]
        
        assert test_addr in addresses_after, \
            "Node should STILL be active after WS disconnect (only heartbeat timeout should mark offline)"
        print("✓ Node stays online after WebSocket disconnect (heartbeat timeout decides)")


class TestSignalForwarding:
    """Tests for WebRTC signal forwarding between peers"""
    
    def test_signal_forwarding_between_peers(self):
        """Two WS connections can exchange offer/answer via the signaling server"""
        import websocket
        import threading
        
        peer1_addr = "signal_peer1_174"
        peer2_addr = "signal_peer2_174"
        
        ws_base = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
        
        received_messages = {"peer1": [], "peer2": []}
        
        def peer2_listener(ws2):
            try:
                ws2.settimeout(5)
                while True:
                    msg = ws2.recv()
                    data = json.loads(msg)
                    if data.get("type") != "ping":
                        received_messages["peer2"].append(data)
                        break
            except:
                pass
        
        try:
            # Connect both peers
            ws1 = websocket.create_connection(f"{ws_base}/api/mesh/signal/{peer1_addr}", timeout=5)
            ws2 = websocket.create_connection(f"{ws_base}/api/mesh/signal/{peer2_addr}", timeout=5)
            
            # Start listener for peer2
            listener = threading.Thread(target=peer2_listener, args=(ws2,))
            listener.start()
            
            time.sleep(0.5)  # Let connections settle
            
            # Peer1 sends offer to Peer2
            offer_msg = {
                "to": peer2_addr,
                "type": "offer",
                "payload": json.dumps({"sdp": "test_sdp_offer", "type": "offer"})
            }
            ws1.send(json.dumps(offer_msg))
            
            # Wait for peer2 to receive
            listener.join(timeout=5)
            
            # Verify peer2 received the offer
            assert len(received_messages["peer2"]) > 0, "Peer2 should have received the offer"
            received = received_messages["peer2"][0]
            assert received.get("from") == peer1_addr
            assert received.get("type") == "offer"
            print("✓ Signal forwarding works between peers")
            
            ws1.close()
            ws2.close()
        except Exception as e:
            pytest.fail(f"Signal forwarding test failed: {e}")


class TestCleanup:
    """Cleanup test nodes after tests"""
    
    def test_cleanup_test_nodes(self):
        """Clean up all test nodes created during testing"""
        test_nodes = [
            TEST_NODE_1, TEST_NODE_2, TEST_NODE_3,
            "deregister_test_174", "testnet_only_node_174",
            "ws_test_node_174", "ws_ping_test_174", "ws_pong_test_174",
            "ws_disconnect_test_174", "signal_peer1_174", "signal_peer2_174"
        ]
        
        for node in test_nodes:
            try:
                requests.post(f"{BASE_URL}/api/mesh/deregister?address={node}&network={NETWORK}")
            except:
                pass
        
        print(f"✓ Cleaned up {len(test_nodes)} test nodes")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
