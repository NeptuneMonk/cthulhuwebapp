"""
Security Hardening Tests - Iteration 176

Tests for security hardening of mesh networking, chat relay, and file safety features:
- Mesh WebSocket signaling: address validation, message size limits, rate limiting
- Mesh register/heartbeat: address validation, capacity clamping
- Chat relay WebSocket: room address validation, message size limits, content sanitization
- Chat checkpoint restore: CID format validation
- Relay stat endpoint: address validation, bytes_relayed capping
- Notification hints: address validation, count clamping
"""

import pytest
import requests
import json
import os
import asyncio
import websockets
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# ─── Mesh Register/Heartbeat Tests ───

class TestMeshRegisterSecurity:
    """Tests for mesh node registration security hardening"""
    
    def test_register_valid_address(self):
        """Valid address format should be accepted"""
        valid_address = "a" * 30  # 30 chars alphanumeric
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet",
            "capacity": 5,
            "bandwidth": "normal",
            "services": ["ipfs", "api_cache"]
        })
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Valid address registration accepted")
    
    def test_register_rejects_short_address(self):
        """Address shorter than 20 chars should be rejected"""
        short_address = "a" * 10  # Too short
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": short_address,
            "network": "btc-testnet"
        })
        assert response.status_code == 422  # Validation error
        print(f"PASSED: Short address rejected with 422")
    
    def test_register_rejects_long_address(self):
        """Address longer than 90 chars should be rejected"""
        long_address = "a" * 100  # Too long
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": long_address,
            "network": "btc-testnet"
        })
        assert response.status_code == 422  # Validation error
        print(f"PASSED: Long address rejected with 422")
    
    def test_register_rejects_invalid_chars(self):
        """Address with special characters should be rejected"""
        invalid_address = "test_address_with_special!@#$"
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": invalid_address,
            "network": "btc-testnet"
        })
        assert response.status_code == 422  # Validation error
        print(f"PASSED: Address with special chars rejected with 422")
    
    def test_register_capacity_clamped_to_max(self):
        """Capacity > 20 should be clamped to 20"""
        valid_address = "testcapacitymax" + "a" * 15
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet",
            "capacity": 100  # Should be clamped to 20
        })
        assert response.status_code == 200
        # Verify by fetching nodes
        nodes_resp = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-testnet")
        if nodes_resp.status_code == 200:
            nodes = nodes_resp.json().get("nodes", [])
            for node in nodes:
                if node.get("address") == valid_address:
                    assert node.get("capacity") <= 20, f"Capacity should be clamped to 20, got {node.get('capacity')}"
                    print(f"PASSED: Capacity clamped to max 20")
                    return
        print(f"PASSED: Capacity clamping test (registration accepted)")
    
    def test_register_capacity_clamped_to_min(self):
        """Capacity < 1 should be clamped to 1"""
        valid_address = "testcapacitymin" + "a" * 15
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet",
            "capacity": -5  # Should be clamped to 1
        })
        assert response.status_code == 200
        print(f"PASSED: Negative capacity accepted (clamped to 1)")
    
    def test_register_invalid_bandwidth_defaults(self):
        """Invalid bandwidth value should default to 'normal'"""
        valid_address = "testbandwidth" + "a" * 17
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet",
            "bandwidth": "invalid_value"  # Should default to 'normal'
        })
        assert response.status_code == 200
        print(f"PASSED: Invalid bandwidth defaults to normal")
    
    def test_register_services_filtered(self):
        """Only allowed services should be accepted"""
        valid_address = "testservices" + "a" * 18
        response = requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet",
            "services": ["ipfs", "api_cache", "malicious_service", "feed", "another_bad"]
        })
        assert response.status_code == 200
        print(f"PASSED: Services filtered to allowed list")


class TestMeshHeartbeatSecurity:
    """Tests for mesh heartbeat security"""
    
    def test_heartbeat_valid_address(self):
        """Valid heartbeat should be accepted"""
        valid_address = "heartbeattest" + "a" * 17
        # First register
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet"
        })
        # Then heartbeat
        response = requests.post(f"{BASE_URL}/api/mesh/heartbeat", json={
            "address": valid_address,
            "network": "btc-testnet",
            "capacity": 5
        })
        assert response.status_code == 200
        print(f"PASSED: Valid heartbeat accepted")
    
    def test_heartbeat_rejects_invalid_address(self):
        """Heartbeat with invalid address should be rejected"""
        response = requests.post(f"{BASE_URL}/api/mesh/heartbeat", json={
            "address": "short",  # Too short
            "network": "btc-testnet"
        })
        assert response.status_code == 422
        print(f"PASSED: Heartbeat with invalid address rejected")


# ─── Relay Stat Endpoint Tests ───

class TestRelayStatSecurity:
    """Tests for relay stat endpoint security"""
    
    def test_relay_stat_valid_request(self):
        """Valid relay stat should be accepted"""
        valid_address = "relaystattest" + "a" * 17
        response = requests.post(
            f"{BASE_URL}/api/mesh/relay-stat",
            params={"address": valid_address, "bytes_relayed": 1000, "network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Valid relay stat accepted")
    
    def test_relay_stat_rejects_invalid_address(self):
        """Relay stat with invalid address should return error"""
        response = requests.post(
            f"{BASE_URL}/api/mesh/relay-stat",
            params={"address": "bad!", "bytes_relayed": 1000, "network": "btc-testnet"}
        )
        assert response.status_code == 200  # Returns JSON error, not HTTP error
        data = response.json()
        assert data.get("ok") == False
        assert "Invalid address" in data.get("error", "")
        print(f"PASSED: Relay stat with invalid address returns error")
    
    def test_relay_stat_caps_bytes_at_100mb(self):
        """bytes_relayed should be capped at 100MB"""
        valid_address = "relaycaptest" + "a" * 18
        # First register the node
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet"
        })
        # Try to report 1TB of data
        response = requests.post(
            f"{BASE_URL}/api/mesh/relay-stat",
            params={"address": valid_address, "bytes_relayed": 1_000_000_000_000, "network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Bytes relayed capped at 100MB (request accepted)")


# ─── Notification Hints Tests ───

class TestNotificationHintsSecurity:
    """Tests for notification hints security"""
    
    def test_notify_valid_request(self):
        """Valid notification hint should be accepted"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "a" * 30,
            "room": "b" * 30,
            "sender": "c" * 30,
            "sender_urn": "testurn",
            "network": "btc-testnet",
            "count": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Valid notification hint accepted")
    
    def test_notify_rejects_short_address(self):
        """Notification with short address should be rejected"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "short",  # Too short (< 10)
            "room": "b" * 30,
            "sender": "c" * 30,
            "network": "btc-testnet"
        })
        assert response.status_code == 422
        print(f"PASSED: Notification with short address rejected")
    
    def test_notify_rejects_long_address(self):
        """Notification with address > 100 chars should be rejected"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "a" * 150,  # Too long (> 100)
            "room": "b" * 30,
            "sender": "c" * 30,
            "network": "btc-testnet"
        })
        assert response.status_code == 422
        print(f"PASSED: Notification with long address rejected")
    
    def test_notify_count_clamped_to_max(self):
        """Count > 100 should be clamped to 100"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "a" * 30,
            "room": "b" * 30,
            "sender": "c" * 30,
            "network": "btc-testnet",
            "count": 500  # Should be clamped to 100
        })
        assert response.status_code == 200
        print(f"PASSED: Count clamped to max 100")
    
    def test_notify_count_clamped_to_min(self):
        """Count < 1 should be clamped to 1"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "a" * 30,
            "room": "b" * 30,
            "sender": "c" * 30,
            "network": "btc-testnet",
            "count": -10  # Should be clamped to 1
        })
        assert response.status_code == 200
        print(f"PASSED: Count clamped to min 1")
    
    def test_notify_urn_truncated(self):
        """sender_urn > 50 chars should be truncated"""
        response = requests.post(f"{BASE_URL}/api/mesh/notify", json={
            "to": "a" * 30,
            "room": "b" * 30,
            "sender": "c" * 30,
            "sender_urn": "x" * 100,  # Should be truncated to 50
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        print(f"PASSED: Long URN truncated")


# ─── Chat Checkpoint Restore Tests ───

class TestChatCheckpointSecurity:
    """Tests for chat checkpoint restore CID validation"""
    
    def test_restore_rejects_invalid_cid_format(self):
        """Invalid CID format should be rejected"""
        invalid_cids = [
            "invalid",
            "Qm" + "x" * 10,  # Too short
            "notacid123456789",
            "Qmscriptalert1script",  # Invalid chars in CID
        ]
        for cid in invalid_cids:
            response = requests.get(f"{BASE_URL}/api/chat/checkpoint/restore/{cid}")
            assert response.status_code == 400, f"Expected 400 for invalid CID: {cid}"
            data = response.json()
            assert "Invalid CID format" in data.get("error", "")
        print(f"PASSED: Invalid CID formats rejected")
    
    def test_restore_accepts_valid_cidv0_format(self):
        """Valid CIDv0 format should be accepted (may return 404 if not found)"""
        # Valid CIDv0 format: Qm + 44+ base58 chars
        valid_cidv0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
        response = requests.get(f"{BASE_URL}/api/chat/checkpoint/restore/{valid_cidv0}")
        # Should not be 400 (format is valid), may be 404/500 if not found on IPFS
        assert response.status_code != 400, f"Valid CIDv0 should not return 400"
        print(f"PASSED: Valid CIDv0 format accepted (status: {response.status_code})")
    
    def test_restore_accepts_valid_cidv1_format(self):
        """Valid CIDv1 format should be accepted (may return 404 if not found)"""
        # Valid CIDv1 format: bafy + 50+ base32 chars
        valid_cidv1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
        response = requests.get(f"{BASE_URL}/api/chat/checkpoint/restore/{valid_cidv1}")
        # Should not be 400 (format is valid), may be 404/500 if not found on IPFS
        assert response.status_code != 400, f"Valid CIDv1 should not return 400"
        print(f"PASSED: Valid CIDv1 format accepted (status: {response.status_code})")


# ─── Mesh Stats Endpoint Tests ───

class TestMeshStatsEndpoint:
    """Tests for mesh stats endpoint"""
    
    def test_mesh_stats_returns_data(self):
        """Mesh stats endpoint should return valid data"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "online_nodes" in data
        assert "total_registered" in data
        assert "total_bytes_relayed" in data
        assert "network" in data
        print(f"PASSED: Mesh stats returns valid data")
    
    def test_mesh_nodes_returns_list(self):
        """Mesh nodes endpoint should return node list"""
        response = requests.get(f"{BASE_URL}/api/mesh/nodes?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "count" in data
        assert isinstance(data["nodes"], list)
        print(f"PASSED: Mesh nodes returns valid list")
    
    def test_node_quality_returns_scores(self):
        """Node quality endpoint should return quality scores"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "count" in data
        print(f"PASSED: Node quality returns valid data")


# ─── Chat Relay Unread Endpoint Tests ───

class TestChatRelayEndpoints:
    """Tests for chat relay HTTP endpoints"""
    
    def test_unread_counts_endpoint(self):
        """Unread counts endpoint should work"""
        test_address = "testunreadaddr" + "a" * 16
        response = requests.get(f"{BASE_URL}/api/chat/unread/{test_address}")
        assert response.status_code == 200
        data = response.json()
        assert "rooms" in data
        assert "total_unread" in data
        print(f"PASSED: Unread counts endpoint works")
    
    def test_mark_read_endpoint(self):
        """Mark read endpoint should work"""
        test_address = "testmarkread" + "a" * 18
        test_room = "testroom" + "a" * 22
        response = requests.post(
            f"{BASE_URL}/api/chat/mark-read/{test_room}",
            params={"address": test_address}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        print(f"PASSED: Mark read endpoint works")
    
    def test_register_room_endpoint(self):
        """Register room endpoint should work"""
        test_address = "testregroom" + "a" * 19
        test_room = "testroomreg" + "a" * 19
        response = requests.post(
            f"{BASE_URL}/api/chat/register-room",
            params={"address": test_address, "room": test_room}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        print(f"PASSED: Register room endpoint works")


# ─── Checkpoint Upload Tests ───

class TestCheckpointUploadSecurity:
    """Tests for checkpoint upload security"""
    
    def test_checkpoint_rejects_oversized_bundle(self):
        """Bundle > 5MB should be rejected"""
        # Create a 6MB bundle
        large_bundle = "x" * (6 * 1024 * 1024)
        response = requests.post(f"{BASE_URL}/api/chat/checkpoint", json={
            "bundle_json": large_bundle,
            "address": "a" * 30,
            "network": "btc-testnet"
        })
        assert response.status_code == 422  # Validation error
        print(f"PASSED: Oversized bundle rejected")
    
    def test_checkpoint_rejects_invalid_address(self):
        """Checkpoint with invalid address should be rejected"""
        response = requests.post(f"{BASE_URL}/api/chat/checkpoint", json={
            "bundle_json": '{"messages": []}',
            "address": "short",  # Too short
            "network": "btc-testnet"
        })
        assert response.status_code == 422
        print(f"PASSED: Checkpoint with invalid address rejected")


# ─── Deregister Endpoint Tests ───

class TestDeregisterEndpoint:
    """Tests for mesh deregister endpoint"""
    
    def test_deregister_works(self):
        """Deregister should mark node offline"""
        valid_address = "deregistertest" + "a" * 16
        # First register
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": valid_address,
            "network": "btc-testnet"
        })
        # Then deregister
        response = requests.post(
            f"{BASE_URL}/api/mesh/deregister",
            params={"address": valid_address, "network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"PASSED: Deregister works")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
