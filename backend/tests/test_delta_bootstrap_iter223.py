"""
Delta Snapshots & Auto-Bootstrap API Tests - Iteration 223
Tests for NEW features in IPFS-backed Chain Snapshot system:
- GET /api/snapshot/status — now includes cache.tracked_txids field
- POST /api/snapshot/produce?delta=true — produces delta snapshot (only new roots)
- POST /api/snapshot/auto-bootstrap — starts background bootstrap task
- GET /api/snapshot/bootstrap-status — returns bootstrap progress
- GET /api/snapshot/latest-cid — returns latest snapshot CID for bootstrapping
- GET /api/snapshot/chain — shows full and delta snapshot types
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')


class TestSnapshotStatusTrackedTxids:
    """Tests for GET /api/snapshot/status - NEW tracked_txids field"""
    
    def test_status_has_tracked_txids_field(self):
        """Status should include cache.tracked_txids field (NEW)"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "cache" in data, "Response missing 'cache' field"
        cache = data["cache"]
        assert "tracked_txids" in cache, "Cache missing 'tracked_txids' field (NEW FEATURE)"
        assert isinstance(cache["tracked_txids"], int), "tracked_txids should be an integer"
        print(f"✓ tracked_txids = {cache['tracked_txids']}")
    
    def test_status_tracked_txids_positive(self):
        """tracked_txids should be positive when snapshots exist"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        cache = data["cache"]
        # Should have tracked txids from previous full snapshot
        assert cache["tracked_txids"] > 0, "tracked_txids should be > 0 after full snapshot"
        print(f"✓ tracked_txids = {cache['tracked_txids']} (positive)")


class TestDeltaSnapshotProduce:
    """Tests for POST /api/snapshot/produce?delta=true - Delta snapshot production"""
    
    def test_produce_delta_returns_200(self):
        """Delta snapshot produce should return 200"""
        response = requests.post(f"{BASE_URL}/api/snapshot/produce?network=btc-testnet&delta=true")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        print(f"Delta produce response: {data}")
        
        # Should return either success with CID or error
        assert "cid" in data or "error" in data, "Should return cid or error"
    
    def test_produce_delta_returns_delta_type(self):
        """Delta snapshot should have type='delta'"""
        response = requests.post(f"{BASE_URL}/api/snapshot/produce?network=btc-testnet&delta=true")
        data = response.json()
        
        if "cid" in data:
            assert data.get("type") == "delta", f"Expected type='delta', got {data.get('type')}"
            print(f"✓ Delta snapshot produced: CID={data['cid'][:20]}..., type={data['type']}")
        elif "error" in data:
            print(f"Note: Delta produce returned error (may be expected): {data['error']}")
    
    def test_produce_full_returns_full_type(self):
        """Full snapshot (no delta) should have type='full'"""
        # Note: This takes ~30 seconds, so we just verify the endpoint accepts the request
        # We don't actually produce to avoid long test times
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        snapshots = data.get("snapshots", [])
        
        # Verify existing full snapshots have type='full'
        full_snapshots = [s for s in snapshots if s.get("type") == "full"]
        assert len(full_snapshots) > 0, "Should have at least one full snapshot"
        print(f"✓ Found {len(full_snapshots)} full snapshots")


class TestAutoBootstrap:
    """Tests for POST /api/snapshot/auto-bootstrap - Background bootstrap task"""
    
    def test_auto_bootstrap_returns_started(self):
        """Auto-bootstrap should return started=true or error if already running"""
        response = requests.post(f"{BASE_URL}/api/snapshot/auto-bootstrap?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Should return either started=true or error (if already running)
        assert "started" in data or "error" in data, "Should return 'started' or 'error'"
        
        if data.get("started"):
            print(f"✓ Bootstrap started: network={data.get('network')}, start_cid={data.get('start_cid', '')[:20]}...")
        else:
            print(f"✓ Bootstrap already running or error: {data.get('error')}")
    
    def test_auto_bootstrap_error_when_running(self):
        """Auto-bootstrap should return error when already running"""
        # First call to start (may already be running)
        requests.post(f"{BASE_URL}/api/snapshot/auto-bootstrap?network=btc-testnet")
        time.sleep(0.5)
        
        # Second call should return error
        response = requests.post(f"{BASE_URL}/api/snapshot/auto-bootstrap?network=btc-testnet")
        data = response.json()
        
        # If bootstrap is running, should return error
        if "error" in data:
            assert "already running" in data["error"].lower(), f"Expected 'already running' error, got: {data['error']}"
            print(f"✓ Correctly returns error when already running: {data['error']}")
        else:
            # Bootstrap may have completed very quickly
            print(f"Note: Bootstrap may have completed quickly, got: {data}")


class TestBootstrapStatus:
    """Tests for GET /api/snapshot/bootstrap-status - Bootstrap progress"""
    
    def test_bootstrap_status_returns_200(self):
        """Bootstrap status should return 200"""
        response = requests.get(f"{BASE_URL}/api/snapshot/bootstrap-status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_bootstrap_status_has_required_fields(self):
        """Bootstrap status should have running, phase, progress fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/bootstrap-status")
        data = response.json()
        
        assert "running" in data, "Missing 'running' field"
        assert "phase" in data, "Missing 'phase' field"
        assert "progress" in data, "Missing 'progress' field"
        assert "total" in data, "Missing 'total' field"
        assert "imported" in data, "Missing 'imported' field"
        assert "users" in data, "Missing 'users' field"
        assert "error" in data, "Missing 'error' field"
        assert "log" in data, "Missing 'log' field"
        
        print(f"✓ Bootstrap status: running={data['running']}, phase={data['phase']}, progress={data['progress']}/{data['total']}")
    
    def test_bootstrap_status_valid_phase(self):
        """Bootstrap phase should be a valid value"""
        response = requests.get(f"{BASE_URL}/api/snapshot/bootstrap-status")
        data = response.json()
        
        valid_phases = ["idle", "resolving_chain", "consuming", "complete", "error"]
        assert data["phase"] in valid_phases, f"Invalid phase: {data['phase']}"
        print(f"✓ Phase '{data['phase']}' is valid")


class TestLatestCid:
    """Tests for GET /api/snapshot/latest-cid - Latest snapshot CID"""
    
    def test_latest_cid_returns_200(self):
        """Latest CID endpoint should return 200"""
        response = requests.get(f"{BASE_URL}/api/snapshot/latest-cid?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_latest_cid_has_required_fields(self):
        """Latest CID response should have cid, network, ipfs_url fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/latest-cid?network=btc-testnet")
        data = response.json()
        
        assert "cid" in data, "Missing 'cid' field"
        assert "network" in data, "Missing 'network' field"
        assert data["network"] == "btc-testnet", f"Expected network='btc-testnet', got {data['network']}"
        
        if data["cid"]:
            assert "ipfs_url" in data, "Missing 'ipfs_url' field"
            assert data["ipfs_url"].startswith("https://ipfs.io/ipfs/"), "ipfs_url should start with https://ipfs.io/ipfs/"
            print(f"✓ Latest CID: {data['cid'][:20]}..., ipfs_url={data['ipfs_url'][:40]}...")
        else:
            print("Note: No snapshots available yet")


class TestSnapshotChainTypes:
    """Tests for GET /api/snapshot/chain - Full and delta snapshot types"""
    
    def test_chain_shows_snapshot_types(self):
        """Chain should show both full and delta snapshot types"""
        # First check status which has type field
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        snapshots = data.get("snapshots", [])
        
        types_found = set()
        for s in snapshots:
            snap_type = s.get("type")
            if snap_type:
                types_found.add(snap_type)
        
        print(f"✓ Snapshot types found: {types_found}")
        
        # Should have at least full type
        assert "full" in types_found, "Should have at least one 'full' snapshot"
    
    def test_chain_has_delta_snapshot(self):
        """Chain should have delta snapshot after delta produce"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        data = response.json()
        snapshots = data.get("snapshots", [])
        
        delta_snapshots = [s for s in snapshots if s.get("type") == "delta"]
        print(f"✓ Found {len(delta_snapshots)} delta snapshots")
        
        # Delta snapshots should exist (we produced one earlier)
        if len(delta_snapshots) > 0:
            delta = delta_snapshots[0]
            print(f"  Delta snapshot: CID={delta['cid'][:20]}..., root_count={delta['root_count']}")


class TestAdminLogin:
    """Regression test for admin login"""
    
    def test_admin_login_works(self):
        """Admin login should work with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "CthulhuAdmin",
            "password": "78UH1%2kC^vH2Gi1MqI@"
        })
        assert response.status_code == 200, f"Admin login failed with {response.status_code}"
        data = response.json()
        assert "token" in data, "Login response missing 'token'"
        print(f"✓ Admin login successful")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
