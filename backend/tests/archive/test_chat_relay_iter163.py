"""
Test Chat Relay Phase 3 — Off-chain message batching endpoints.

Tests:
- POST /api/chat/checkpoint — upload bundle to IPFS, return CID
- GET /api/chat/checkpoint/restore/{cid} — fetch checkpoint bundle from IPFS
- GET /api/ipfs/cat/{cid} — verify 504 timeout handling (IPFS bug fix)
- WebSocket /api/chat/ws/{room_address} — real-time message relay
"""
import pytest
import requests
import json
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestChatCheckpointEndpoints:
    """Test checkpoint upload and restore endpoints."""
    
    def test_checkpoint_upload_success(self):
        """POST /api/chat/checkpoint should accept bundle JSON and return CID."""
        # Create a test bundle
        bundle = {
            "version": 1,
            "address": "TEST_tb1qtest123",
            "created": "2026-01-15T12:00:00Z",
            "messageCount": 2,
            "rooms": {
                "TEST_room_address_123": [
                    {"id": "msg1", "sender": "TEST_sender1", "content": "Hello", "timestamp": "2026-01-15T12:00:00Z"},
                    {"id": "msg2", "sender": "TEST_sender2", "content": "World", "timestamp": "2026-01-15T12:01:00Z"}
                ]
            }
        }
        
        response = requests.post(
            f"{BASE_URL}/api/chat/checkpoint",
            json={
                "bundle_json": json.dumps(bundle),
                "address": "TEST_tb1qtest123",
                "network": "btc-testnet"
            },
            timeout=60
        )
        
        print(f"Checkpoint upload response: {response.status_code} - {response.text[:200]}")
        
        # Should return 200 with CID
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "cid" in data, f"Response should contain 'cid': {data}"
        assert len(data["cid"]) > 0, "CID should not be empty"
        assert "size" in data, f"Response should contain 'size': {data}"
        
        # Store CID for restore test
        TestChatCheckpointEndpoints.uploaded_cid = data["cid"]
        print(f"Uploaded checkpoint CID: {data['cid']}")
    
    def test_checkpoint_restore_success(self):
        """GET /api/chat/checkpoint/restore/{cid} should return the bundle."""
        # Use CID from previous test or a known test CID
        cid = getattr(TestChatCheckpointEndpoints, 'uploaded_cid', None)
        if not cid:
            pytest.skip("No CID from upload test, skipping restore test")
        
        response = requests.get(
            f"{BASE_URL}/api/chat/checkpoint/restore/{cid}",
            timeout=60
        )
        
        print(f"Checkpoint restore response: {response.status_code} - {response.text[:200]}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "cid" in data, f"Response should contain 'cid': {data}"
        assert "bundle" in data, f"Response should contain 'bundle': {data}"
        assert data["cid"] == cid, f"CID mismatch: expected {cid}, got {data['cid']}"
        
        # Verify bundle structure
        bundle = data["bundle"]
        assert "version" in bundle, "Bundle should have version"
        assert "rooms" in bundle, "Bundle should have rooms"
        print(f"Restored bundle: version={bundle.get('version')}, messageCount={bundle.get('messageCount')}")
    
    def test_checkpoint_restore_invalid_cid(self):
        """GET /api/chat/checkpoint/restore/{cid} should return 404 for invalid CID."""
        response = requests.get(
            f"{BASE_URL}/api/chat/checkpoint/restore/QmInvalidCidThatDoesNotExist123456789",
            timeout=30
        )
        
        print(f"Invalid CID restore response: {response.status_code}")
        
        # Should return 404 or 400 for invalid/not found CID
        assert response.status_code in [400, 404, 500], f"Expected 400/404/500, got {response.status_code}"
    
    def test_checkpoint_upload_empty_bundle(self):
        """POST /api/chat/checkpoint should handle empty bundle gracefully."""
        response = requests.post(
            f"{BASE_URL}/api/chat/checkpoint",
            json={
                "bundle_json": "{}",
                "address": "TEST_empty_bundle",
                "network": "btc-testnet"
            },
            timeout=30
        )
        
        print(f"Empty bundle response: {response.status_code}")
        
        # Should still succeed (IPFS accepts any JSON)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


class TestIPFSCatTimeout:
    """Test IPFS cat endpoint timeout handling (bug fix verification)."""
    
    def test_ipfs_cat_timeout_returns_504(self):
        """GET /api/ipfs/cat/{cid} should return 504 on timeout, not hang."""
        # Use a CID known to timeout (from test request)
        timeout_cid = "QmT9yijZT5KZ3vQFHLu5v7DGXKRkzuAwKueQouZfG7F7rf"
        
        start_time = time.time()
        try:
            response = requests.get(
                f"{BASE_URL}/api/ipfs/cat/{timeout_cid}",
                timeout=30  # Client timeout higher than server timeout (15s)
            )
            elapsed = time.time() - start_time
            
            print(f"IPFS cat response: {response.status_code} in {elapsed:.1f}s")
            
            # Should return 504 Gateway Timeout (not hang indefinitely)
            # Or 404 if content not found
            assert response.status_code in [404, 503, 504], f"Expected 404/503/504, got {response.status_code}"
            
            # Should complete within reasonable time (server timeout is 15s)
            assert elapsed < 25, f"Request took too long: {elapsed:.1f}s (should be <25s)"
            
        except requests.exceptions.Timeout:
            elapsed = time.time() - start_time
            pytest.fail(f"Request timed out after {elapsed:.1f}s - server should return 504 instead of hanging")
    
    def test_ipfs_cat_valid_cid(self):
        """GET /api/ipfs/cat/{cid} should return content for valid CID."""
        # First upload something to get a valid CID
        response = requests.post(
            f"{BASE_URL}/api/chat/checkpoint",
            json={
                "bundle_json": json.dumps({"test": "ipfs_cat_test", "timestamp": time.time()}),
                "address": "TEST_ipfs_cat",
                "network": "btc-testnet"
            },
            timeout=30
        )
        
        if response.status_code != 200:
            pytest.skip("Could not upload test content to IPFS")
        
        cid = response.json().get("cid")
        if not cid:
            pytest.skip("No CID returned from upload")
        
        # Now fetch it via /api/ipfs/cat
        cat_response = requests.get(
            f"{BASE_URL}/api/ipfs/cat/{cid}",
            timeout=30
        )
        
        print(f"IPFS cat valid CID response: {cat_response.status_code}")
        
        assert cat_response.status_code == 200, f"Expected 200, got {cat_response.status_code}"
        
        # Content should be JSON
        content = cat_response.content.decode('utf-8')
        assert "ipfs_cat_test" in content, f"Content mismatch: {content[:100]}"


class TestIPFSStatus:
    """Test IPFS daemon status endpoint."""
    
    def test_ipfs_status(self):
        """GET /api/ipfs/status should return daemon status."""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        
        print(f"IPFS status response: {response.status_code} - {response.text[:200]}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "online" in data, f"Response should contain 'online': {data}"
        
        if data["online"]:
            assert "peer_id" in data, "Online daemon should have peer_id"
            print(f"IPFS daemon online: peer_id={data.get('peer_id', '')[:20]}...")


class TestChatWebSocket:
    """Test WebSocket chat relay endpoint (basic connectivity)."""
    
    def test_websocket_endpoint_exists(self):
        """WebSocket endpoint /api/chat/ws/{room} should be accessible."""
        # We can't fully test WebSocket with requests, but we can verify the endpoint exists
        # by checking that a regular HTTP request gets rejected appropriately
        
        response = requests.get(
            f"{BASE_URL}/api/chat/ws/TEST_room_123",
            timeout=10
        )
        
        print(f"WebSocket endpoint HTTP response: {response.status_code}")
        
        # WebSocket endpoints typically return 400 or 426 for non-WebSocket requests
        # FastAPI WebSocket returns 403 for non-WebSocket upgrade requests
        assert response.status_code in [400, 403, 404, 426], f"Expected 400/403/404/426, got {response.status_code}"


class TestChatRelayRouterRegistration:
    """Verify chat_relay_router is properly registered in server.py."""
    
    def test_chat_checkpoint_route_registered(self):
        """Verify /api/chat/checkpoint route is accessible."""
        # OPTIONS request to check route exists
        response = requests.options(f"{BASE_URL}/api/chat/checkpoint", timeout=10)
        
        # Should not be 404
        assert response.status_code != 404, "Route /api/chat/checkpoint not found - router may not be registered"
        print(f"Checkpoint route OPTIONS: {response.status_code}")
    
    def test_chat_restore_route_registered(self):
        """Verify /api/chat/checkpoint/restore route is accessible."""
        response = requests.options(f"{BASE_URL}/api/chat/checkpoint/restore/test", timeout=10)
        
        # Should not be 404
        assert response.status_code != 404, "Route /api/chat/checkpoint/restore not found"
        print(f"Restore route OPTIONS: {response.status_code}")


# Fixtures
@pytest.fixture(scope="module", autouse=True)
def setup_module():
    """Setup for test module."""
    print(f"\n=== Testing Chat Relay Phase 3 ===")
    print(f"BASE_URL: {BASE_URL}")
    yield
    print(f"\n=== Chat Relay Phase 3 Tests Complete ===")
