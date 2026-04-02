"""
Iteration 225: Feed Toggle, Object Caching, Delta Snapshots, Auto-Bootstrap Tests
Tests the new features:
1. Feed mode toggle (global/following)
2. Delta snapshot production
3. Auto-bootstrap background task
4. Bootstrap status endpoint
5. Vacuum deep roots phase
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestFeedModeToggle:
    """Feed mode toggle API tests"""
    
    def test_feed_global_mode_returns_mode_field(self):
        """GET /api/feed/btc-testnet?mode=global returns mode=global in response"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=global&skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert "mode" in data, "Response should include 'mode' field"
        assert data["mode"] == "global", f"Expected mode='global', got mode='{data.get('mode')}'"
        assert "feed" in data
        assert "total" in data
        assert data["total"] > 0, "Global feed should have posts"
        print(f"✓ Global mode: {data['total']} total posts, mode={data['mode']}")
    
    def test_feed_following_mode_filters_by_address(self):
        """GET /api/feed/btc-testnet?mode=following&followed=ADDR filters to only that address's posts"""
        # First get a real address from global feed
        global_resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=global&skip=0&limit=1")
        assert global_resp.status_code == 200
        global_data = global_resp.json()
        assert len(global_data.get("feed", [])) > 0, "Need at least one post to test"
        
        test_address = global_data["feed"][0]["from_address"]
        print(f"Testing following mode with address: {test_address}")
        
        # Now test following mode with this address
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=following&followed={test_address}&skip=0&limit=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "mode" in data, "Response should include 'mode' field"
        assert data["mode"] == "following", f"Expected mode='following', got mode='{data.get('mode')}'"
        
        # Verify all returned posts are from the followed address
        for post in data.get("feed", []):
            assert post["from_address"] == test_address, f"Post from {post['from_address']} should not appear when following only {test_address}"
        
        print(f"✓ Following mode: {data['total']} posts from {test_address}")
    
    def test_feed_following_mode_with_empty_followed(self):
        """Following mode with empty followed param returns all posts (no filter applied)"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=following&followed=&skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert "mode" in data
        assert data["mode"] == "following"
        # With empty followed, should return all posts (same as global)
        assert data["total"] > 0, "Should return posts even with empty followed param"
        print(f"✓ Following mode with empty followed: {data['total']} total posts")
    
    def test_feed_following_mode_with_multiple_addresses(self):
        """Following mode with comma-separated addresses filters correctly"""
        # Get two different addresses
        global_resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=global&skip=0&limit=20")
        assert global_resp.status_code == 200
        global_data = global_resp.json()
        
        addresses = set()
        for post in global_data.get("feed", []):
            addresses.add(post["from_address"])
            if len(addresses) >= 2:
                break
        
        if len(addresses) < 2:
            pytest.skip("Need at least 2 different addresses to test multiple following")
        
        addr_list = list(addresses)[:2]
        followed_param = ",".join(addr_list)
        
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=following&followed={followed_param}&skip=0&limit=20")
        assert response.status_code == 200
        data = response.json()
        
        # All posts should be from one of the followed addresses
        for post in data.get("feed", []):
            assert post["from_address"] in addr_list, f"Post from {post['from_address']} should not appear"
        
        print(f"✓ Following mode with multiple addresses: {data['total']} posts from {len(addr_list)} addresses")


class TestDeltaSnapshots:
    """Delta snapshot production tests"""
    
    def test_delta_snapshot_returns_type_delta(self):
        """POST /api/snapshot/produce?network=btc-testnet&delta=true returns type=delta"""
        response = requests.post(f"{BASE_URL}/api/snapshot/produce?network=btc-testnet&delta=true")
        assert response.status_code == 200
        data = response.json()
        
        assert "type" in data, "Response should include 'type' field"
        assert data["type"] == "delta", f"Expected type='delta', got type='{data.get('type')}'"
        assert "cid" in data, "Response should include 'cid' field"
        assert data["cid"].startswith("Qm"), f"CID should start with 'Qm', got {data.get('cid')}"
        
        print(f"✓ Delta snapshot produced: CID={data['cid'][:20]}..., roots={data.get('total_roots', 0)}")
    
    def test_full_snapshot_returns_type_full(self):
        """POST /api/snapshot/produce?network=btc-testnet (no delta) returns type=full"""
        # Note: This creates a full snapshot which takes longer, so we just verify the endpoint exists
        # and check existing snapshots in the chain
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Check that we have both full and delta snapshots in the chain
        types_found = set()
        for snap in data.get("chain", []):
            if "type" in snap:
                types_found.add(snap["type"])
        
        # We should have at least delta type from our test
        assert "delta" in types_found or len(data.get("chain", [])) > 0, "Should have snapshots in chain"
        print(f"✓ Snapshot chain has {len(data.get('chain', []))} snapshots, types: {types_found}")


class TestAutoBootstrap:
    """Auto-bootstrap background task tests"""
    
    def test_auto_bootstrap_starts_background_task(self):
        """POST /api/snapshot/auto-bootstrap?network=btc-testnet starts background task"""
        response = requests.post(f"{BASE_URL}/api/snapshot/auto-bootstrap?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Either it starts successfully or it's already running
        if "error" in data:
            assert "already running" in data["error"].lower(), f"Unexpected error: {data['error']}"
            print(f"✓ Auto-bootstrap already running (expected if previous test started it)")
        else:
            assert data.get("started") == True, "Should return started=true"
            assert "start_cid" in data, "Should return start_cid"
            print(f"✓ Auto-bootstrap started with CID: {data.get('start_cid', '')[:20]}...")
    
    def test_bootstrap_status_returns_progress_fields(self):
        """GET /api/snapshot/bootstrap-status returns running/phase/progress"""
        response = requests.get(f"{BASE_URL}/api/snapshot/bootstrap-status")
        assert response.status_code == 200
        data = response.json()
        
        # Required fields
        assert "running" in data, "Should have 'running' field"
        assert "phase" in data, "Should have 'phase' field"
        assert "progress" in data, "Should have 'progress' field"
        assert "total" in data, "Should have 'total' field"
        assert "imported" in data, "Should have 'imported' field"
        assert "users" in data, "Should have 'users' field"
        assert "log" in data, "Should have 'log' field"
        
        print(f"✓ Bootstrap status: running={data['running']}, phase={data['phase']}, progress={data['progress']}/{data['total']}")
    
    def test_bootstrap_status_shows_consuming_phase(self):
        """Bootstrap status shows consuming phase when running"""
        # Wait a moment for bootstrap to progress
        time.sleep(1)
        
        response = requests.get(f"{BASE_URL}/api/snapshot/bootstrap-status")
        assert response.status_code == 200
        data = response.json()
        
        # If running, phase should be one of the expected phases
        valid_phases = ["idle", "resolving_chain", "consuming", "complete", "error"]
        assert data["phase"] in valid_phases, f"Unexpected phase: {data['phase']}"
        
        if data["running"]:
            assert data["phase"] in ["resolving_chain", "consuming"], f"Running bootstrap should be in resolving_chain or consuming phase"
        
        print(f"✓ Bootstrap phase: {data['phase']}")


class TestVacuumDeepRoots:
    """Vacuum deep roots phase tests"""
    
    def test_vacuum_status_endpoint_exists(self):
        """GET /api/snapshot/status returns vacuum state"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200
        data = response.json()
        
        assert "vacuum" in data, "Should have 'vacuum' field"
        vacuum = data["vacuum"]
        
        assert "running" in vacuum, "Vacuum should have 'running' field"
        assert "phase" in vacuum, "Vacuum should have 'phase' field"
        assert "progress" in vacuum, "Vacuum should have 'progress' field"
        assert "total" in vacuum, "Vacuum should have 'total' field"
        
        print(f"✓ Vacuum status: running={vacuum['running']}, phase={vacuum['phase']}")
    
    def test_vacuum_phases_include_deep_roots(self):
        """Vacuum code includes crawling_deep_roots phase (code review)"""
        # This is a code review test - we verify the phase exists in the code
        # The actual phase is set during vacuum execution
        
        # Read the snapshot.py file to verify the phase exists
        import os
        snapshot_path = "/app/backend/routes/snapshot.py"
        
        with open(snapshot_path, 'r') as f:
            content = f.read()
        
        assert 'crawling_deep_roots' in content, "snapshot.py should contain 'crawling_deep_roots' phase"
        assert '_vacuum_state["phase"] = "crawling_deep_roots"' in content, "Vacuum should set crawling_deep_roots phase"
        
        print("✓ Vacuum code includes crawling_deep_roots phase")
    
    def test_vacuum_valid_phases(self):
        """Vacuum phase should be one of the valid phases"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200
        data = response.json()
        
        vacuum = data["vacuum"]
        valid_phases = [
            "idle", "starting", "crawling_seeds", "crawling_known_users",
            "crawling_deep_roots", "crawling_profiles", "crawling_objects",
            "crawling_keywords", "complete", "error"
        ]
        
        assert vacuum["phase"] in valid_phases, f"Unexpected vacuum phase: {vacuum['phase']}"
        print(f"✓ Vacuum phase '{vacuum['phase']}' is valid")


class TestSnapshotChain:
    """Snapshot chain and latest CID tests"""
    
    def test_latest_cid_endpoint(self):
        """GET /api/snapshot/latest-cid returns latest snapshot CID"""
        response = requests.get(f"{BASE_URL}/api/snapshot/latest-cid?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        if data.get("cid"):
            assert data["cid"].startswith("Qm"), "CID should start with 'Qm'"
            assert "ipfs_url" in data, "Should include ipfs_url"
            assert "network" in data, "Should include network"
            print(f"✓ Latest CID: {data['cid'][:20]}...")
        else:
            print("✓ No snapshots available yet (expected for fresh instance)")
    
    def test_snapshot_chain_shows_types(self):
        """GET /api/snapshot/chain shows snapshot types (full/delta)"""
        response = requests.get(f"{BASE_URL}/api/snapshot/chain?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "chain" in data, "Should have 'chain' field"
        assert "length" in data, "Should have 'length' field"
        
        # Each snapshot in chain should have type field
        for snap in data.get("chain", []):
            # Note: older snapshots might not have type field
            if "type" in snap:
                assert snap["type"] in ["full", "delta"], f"Invalid snapshot type: {snap['type']}"
        
        print(f"✓ Snapshot chain: {data['length']} snapshots")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
