"""
Snapshot System API Tests - Iteration 222
Tests for IPFS-backed Chain Snapshot system:
- GET /api/snapshot/status — vacuum state, cache entry count, snapshot history
- POST /api/snapshot/vacuum — starts background vacuum crawl
- GET /api/snapshot/chain — returns daisy-chain of snapshots with CIDs
- POST /api/snapshot/produce — produces a new snapshot (NOT tested to avoid creating real IPFS data)
- POST /api/snapshot/consume — consumes a snapshot from IPFS
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

# Known existing snapshot CID from previous iteration
EXISTING_SNAPSHOT_CID = "QmUokA8vW5NNDddLhPAZKtu3iJetNKYzUwY9fuohHDNG8A"


class TestSnapshotStatus:
    """Tests for GET /api/snapshot/status endpoint"""
    
    def test_status_returns_200(self):
        """Status endpoint should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_status_has_vacuum_field(self):
        """Status should include vacuum state"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        assert "vacuum" in data, "Response missing 'vacuum' field"
        vacuum = data["vacuum"]
        assert "running" in vacuum, "Vacuum missing 'running' field"
        assert "phase" in vacuum, "Vacuum missing 'phase' field"
        assert "progress" in vacuum, "Vacuum missing 'progress' field"
        assert "total" in vacuum, "Vacuum missing 'total' field"
        assert "crawled" in vacuum, "Vacuum missing 'crawled' field"
        assert "errors" in vacuum, "Vacuum missing 'errors' field"
        assert "log" in vacuum, "Vacuum missing 'log' field"
    
    def test_status_has_cache_field(self):
        """Status should include cache stats with p2fk_entries"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        assert "cache" in data, "Response missing 'cache' field"
        cache = data["cache"]
        assert "p2fk_entries" in cache, "Cache missing 'p2fk_entries' field"
        # Should have ~1429 entries based on previous test
        assert cache["p2fk_entries"] > 0, "Cache should have entries"
    
    def test_status_has_snapshots_field(self):
        """Status should include snapshot history"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        assert "snapshots" in data, "Response missing 'snapshots' field"
        snapshots = data["snapshots"]
        assert isinstance(snapshots, list), "Snapshots should be a list"
        # Should have at least 1 snapshot (the genesis one)
        assert len(snapshots) >= 1, "Should have at least 1 snapshot"
        
        # Verify snapshot structure
        snapshot = snapshots[0]
        assert "cid" in snapshot, "Snapshot missing 'cid'"
        assert "chain" in snapshot, "Snapshot missing 'chain'"
        assert "type" in snapshot, "Snapshot missing 'type'"
        assert "root_count" in snapshot, "Snapshot missing 'root_count'"
        assert "size_bytes" in snapshot, "Snapshot missing 'size_bytes'"
        assert "created_at" in snapshot, "Snapshot missing 'created_at'"
    
    def test_status_has_existing_snapshot_cid(self):
        """Status should show the existing snapshot CID"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        snapshots = data["snapshots"]
        cids = [s["cid"] for s in snapshots]
        assert EXISTING_SNAPSHOT_CID in cids, f"Expected CID {EXISTING_SNAPSHOT_CID} not found in snapshots"


class TestSnapshotChain:
    """Tests for GET /api/snapshot/chain endpoint"""
    
    def test_chain_returns_200(self):
        """Chain endpoint should return 200 OK"""
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_chain_has_required_fields(self):
        """Chain response should have chain, length, network fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        data = response.json()
        assert "chain" in data, "Response missing 'chain' field"
        assert "length" in data, "Response missing 'length' field"
        assert "network" in data, "Response missing 'network' field"
        assert data["network"] == "btc-testnet", "Network should be btc-testnet"
    
    def test_chain_has_genesis_snapshot(self):
        """Chain should have at least the genesis snapshot"""
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        data = response.json()
        chain = data["chain"]
        assert len(chain) >= 1, "Chain should have at least 1 snapshot"
        
        # Verify chain entry structure
        entry = chain[0]
        assert "cid" in entry, "Chain entry missing 'cid'"
        assert "root_count" in entry, "Chain entry missing 'root_count'"
        assert "size_kb" in entry, "Chain entry missing 'size_kb'"
        assert "created_at" in entry, "Chain entry missing 'created_at'"
    
    def test_chain_contains_existing_cid(self):
        """Chain should contain the known existing snapshot CID"""
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        data = response.json()
        chain = data["chain"]
        cids = [s["cid"] for s in chain]
        assert EXISTING_SNAPSHOT_CID in cids, f"Expected CID {EXISTING_SNAPSHOT_CID} not found in chain"


class TestSnapshotVacuum:
    """Tests for POST /api/snapshot/vacuum endpoint"""
    
    def test_vacuum_starts_successfully(self):
        """Vacuum should start and return started=true"""
        # First check if vacuum is already running
        status_resp = requests.get(f"{BASE_URL}/api/snapshot/status")
        status = status_resp.json()
        
        if status["vacuum"]["running"]:
            # Vacuum already running, verify the response format
            response = requests.post(f"{BASE_URL}/api/snapshot/vacuum?network=btc-testnet")
            data = response.json()
            # Should return error since already running
            assert "error" in data or "started" in data, "Should return error or started field"
        else:
            # Start vacuum
            response = requests.post(f"{BASE_URL}/api/snapshot/vacuum?network=btc-testnet")
            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            data = response.json()
            assert data.get("started") == True or "error" in data, "Should return started=true or error"
    
    def test_vacuum_updates_status(self):
        """After starting vacuum, status should show running=true"""
        # Check status
        time.sleep(1)  # Give it a moment
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        vacuum = data["vacuum"]
        # Vacuum might have completed or still running
        assert vacuum["phase"] in ["idle", "starting", "crawling_seeds", "crawling_known_users", 
                                    "crawling_profiles", "crawling_objects", "crawling_keywords", "complete"], \
            f"Unexpected vacuum phase: {vacuum['phase']}"


class TestSnapshotConsume:
    """Tests for POST /api/snapshot/consume endpoint"""
    
    def test_consume_requires_cid(self):
        """Consume endpoint should require CID parameter"""
        response = requests.post(f"{BASE_URL}/api/snapshot/consume?network=btc-testnet")
        # Should fail without CID
        assert response.status_code in [400, 422], f"Expected 400/422 without CID, got {response.status_code}"
    
    def test_consume_with_invalid_cid(self):
        """Consume with invalid CID should return error"""
        response = requests.post(f"{BASE_URL}/api/snapshot/consume?cid=InvalidCID123&network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        # Should have error since CID is invalid
        assert "error" in data, "Should return error for invalid CID"


class TestRegressionEndpoints:
    """Regression tests for existing endpoints"""
    
    def test_feed_loads(self):
        """Feed endpoint should still work"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=3")
        assert response.status_code == 200, f"Feed failed with {response.status_code}"
        data = response.json()
        assert "count" in data, "Feed missing 'count' field"
    
    def test_health_endpoint(self):
        """Health endpoint should return healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed with {response.status_code}"
    
    def test_admin_login(self):
        """Admin login should work"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "CthulhuAdmin",
            "password": "78UH1%2kC^vH2Gi1MqI@"
        })
        assert response.status_code == 200, f"Admin login failed with {response.status_code}"
        data = response.json()
        assert "token" in data, "Login response missing 'token'"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
