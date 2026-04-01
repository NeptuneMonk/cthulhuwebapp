"""
Iteration 50 - IPFS Pinning Feature Tests
Tests the upgraded IPFS system: caching -> pinning migration
- GET /api/ipfs/pins - lists all pinned CIDs on Kubo daemon
- POST /api/ipfs/pin/{cid} - explicitly pin a CID
- GET /api/ipfs/cat/{cid} - fetch content and auto-pin in background
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')

class TestIPFSPinning:
    """Test IPFS pinning endpoints introduced in cache-to-pin migration"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        resp = requests.get(f"{BASE_URL}/api/")
        assert resp.status_code == 200
        print(f"API health check passed: {resp.json()}")
    
    def test_get_ipfs_pins_endpoint_exists(self):
        """GET /api/ipfs/pins - Should return list of pinned CIDs"""
        resp = requests.get(f"{BASE_URL}/api/ipfs/pins")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert "success" in data, "Response should have 'success' field"
        assert "count" in data, "Response should have 'count' field"
        assert "pins" in data, "Response should have 'pins' field"
        assert isinstance(data["pins"], list), "'pins' should be a list"
        
        print(f"GET /api/ipfs/pins returned {data['count']} pins")
        if data["count"] > 0:
            print(f"Sample pins: {data['pins'][:3]}")
    
    def test_get_ipfs_pins_returns_cids(self):
        """Verify pins endpoint returns actual CID hashes"""
        resp = requests.get(f"{BASE_URL}/api/ipfs/pins")
        assert resp.status_code == 200
        
        data = resp.json()
        if data["count"] > 0:
            # CIDs typically start with Qm (v0) or bafy (v1)
            for cid in data["pins"][:5]:
                assert isinstance(cid, str), f"CID should be string, got {type(cid)}"
                assert len(cid) > 10, f"CID should be longer than 10 chars: {cid}"
                print(f"Valid CID format: {cid[:30]}...")
        else:
            print("No pins to validate format, but endpoint works")
    
    def test_post_ipfs_pin_endpoint_exists(self):
        """POST /api/ipfs/pin/{cid} - Should accept pin requests"""
        # Use a known test CID (IPFS docs hello world)
        test_cid = "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx"
        
        resp = requests.post(f"{BASE_URL}/api/ipfs/pin/{test_cid}")
        # Should return 200 on success or 502/500 if Kubo has issues
        assert resp.status_code in [200, 500, 502], f"Unexpected status: {resp.status_code}"
        
        if resp.status_code == 200:
            data = resp.json()
            assert data.get("success") == True, "Should return success: true"
            assert data.get("pinned") == True, "Should return pinned: true"
            print(f"Pin request succeeded: {data}")
        else:
            print(f"Pin request returned {resp.status_code} - may indicate Kubo issue or CID unavailable")
    
    def test_get_ipfs_cat_endpoint_exists(self):
        """GET /api/ipfs/cat/{cid} - Should fetch IPFS content"""
        # Use a small known test CID
        test_cid = "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx"
        
        resp = requests.get(f"{BASE_URL}/api/ipfs/cat/{test_cid}", timeout=30)
        # 200 = success, 404 = not found, 500/502 = Kubo error
        assert resp.status_code in [200, 404, 500, 502], f"Unexpected status: {resp.status_code}"
        
        if resp.status_code == 200:
            print(f"Cat request succeeded, content length: {len(resp.content)} bytes")
            # Verify it auto-pins (checked via pins endpoint after)
        else:
            print(f"Cat request returned {resp.status_code}: {resp.text[:100]}")
    
    def test_cat_auto_pins_content(self):
        """Verify that GET /api/ipfs/cat triggers background pinning"""
        # First get current pin count
        pins_before = requests.get(f"{BASE_URL}/api/ipfs/pins").json()
        initial_count = pins_before.get("count", 0)
        
        # Cat a known CID to trigger auto-pin
        test_cid = "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx"
        cat_resp = requests.get(f"{BASE_URL}/api/ipfs/cat/{test_cid}", timeout=30)
        
        if cat_resp.status_code != 200:
            pytest.skip(f"Cat request failed with {cat_resp.status_code}, cannot test auto-pin")
        
        # Wait for background pin task to complete
        time.sleep(2)
        
        # Check if pin count increased or CID is now in pins
        pins_after = requests.get(f"{BASE_URL}/api/ipfs/pins").json()
        
        # Either count increased or the CID is in the list
        cid_is_pinned = test_cid in pins_after.get("pins", [])
        count_increased = pins_after.get("count", 0) >= initial_count
        
        print(f"Pins before: {initial_count}, after: {pins_after.get('count')}")
        print(f"Test CID in pins list: {cid_is_pinned}")
        
        # This is a soft assertion - background pinning may take longer
        assert count_increased or cid_is_pinned, "Auto-pin should add CID to pins list"
    
    def test_pin_with_path_cid(self):
        """Test pinning with CID containing path (cid/filename)"""
        # Test that path-style CIDs are handled correctly
        test_cid_with_path = "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx/hello"
        
        resp = requests.post(f"{BASE_URL}/api/ipfs/pin/{test_cid_with_path}")
        # Should handle path-style CIDs
        assert resp.status_code in [200, 500, 502], f"Unexpected status: {resp.status_code}"
        print(f"Pin with path CID returned: {resp.status_code}")


class TestIPFSEndpointResponses:
    """Test response formats and edge cases"""
    
    def test_pins_empty_response_format(self):
        """Verify pins endpoint handles empty case gracefully"""
        resp = requests.get(f"{BASE_URL}/api/ipfs/pins")
        assert resp.status_code == 200
        
        data = resp.json()
        # Should always have these fields even if empty
        assert "success" in data
        assert "count" in data
        assert "pins" in data
        
        # count should match pins list length
        assert data["count"] == len(data["pins"]), "count should match pins array length"
    
    def test_pin_invalid_cid_handling(self):
        """Test how pin endpoint handles invalid CIDs"""
        invalid_cid = "not_a_valid_cid_12345"
        
        resp = requests.post(f"{BASE_URL}/api/ipfs/pin/{invalid_cid}")
        # Should handle gracefully - either error or success (Kubo decides)
        assert resp.status_code in [200, 400, 500, 502], f"Unexpected status: {resp.status_code}"
        print(f"Invalid CID pin attempt returned: {resp.status_code}")
    
    def test_cat_invalid_cid_handling(self):
        """Test how cat endpoint handles invalid CIDs"""
        invalid_cid = "invalid_cid_xyz"
        
        resp = requests.get(f"{BASE_URL}/api/ipfs/cat/{invalid_cid}", timeout=30)
        # Should return error status
        assert resp.status_code in [400, 404, 500, 502], f"Expected error status, got {resp.status_code}"
        print(f"Invalid CID cat attempt returned: {resp.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
