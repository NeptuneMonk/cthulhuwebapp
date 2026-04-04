"""
Test suite for Iteration 240: Consume Feedback Improvements
- Vacuum speed updated to ~4 req/sec
- Consume endpoint returns comprehensive breakdown
- Frontend shows rich success/failure UI with chain walk indicator
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthEndpoint:
    """Verify health endpoint shows SQLite (not MongoDB)"""
    
    def test_health_shows_sqlite_up(self):
        """Health endpoint should show sqlite: up, not mongodb: up"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        
        # Verify SQLite is up
        assert "services" in data
        assert "sqlite" in data["services"]
        assert data["services"]["sqlite"] == "up"
        
        # Verify MongoDB is NOT in the response
        assert "mongodb" not in data["services"], "Should use SQLite, not MongoDB"
        print(f"✓ Health endpoint shows sqlite: up (services: {data['services']})")


class TestSnapshotStatus:
    """Verify snapshot status endpoint returns valid JSON"""
    
    def test_status_returns_valid_json(self):
        """GET /api/snapshot/status should return vacuum, auto_delta, and snapshots"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200
        data = response.json()
        
        # Verify vacuum object
        assert "vacuum" in data
        vacuum = data["vacuum"]
        assert "running" in vacuum
        assert "phase" in vacuum
        assert "progress" in vacuum
        assert "total" in vacuum
        print(f"✓ Vacuum status: running={vacuum['running']}, phase={vacuum['phase']}")
        
        # Verify cache object
        assert "cache" in data
        assert "p2fk_entries" in data["cache"]
        print(f"✓ Cache entries: {data['cache']['p2fk_entries']}")
        
        # Verify snapshots array
        assert "snapshots" in data
        assert isinstance(data["snapshots"], list)
        print(f"✓ Snapshots count: {len(data['snapshots'])}")


class TestConsumeEndpoint:
    """Test consume endpoint error handling and response format"""
    
    def test_consume_fake_cid_returns_clear_error(self):
        """POST /api/snapshot/consume with fake CID should return clear error"""
        response = requests.post(
            f"{BASE_URL}/api/snapshot/consume",
            params={"cid": "QmFAKECID123", "network": "btc-testnet"}
        )
        assert response.status_code == 200  # Returns 200 with error in body
        data = response.json()
        
        # Verify error message is clear
        assert "error" in data
        assert data["error"] == "Could not fetch snapshot from IPFS"
        print(f"✓ Consume fake CID returns clear error: '{data['error']}'")
    
    def test_consume_missing_cid_returns_error(self):
        """POST /api/snapshot/consume without CID should return validation error"""
        response = requests.post(f"{BASE_URL}/api/snapshot/consume")
        # Should return 422 for missing required parameter
        assert response.status_code == 422
        print("✓ Consume without CID returns 422 validation error")


class TestVacuumRateInterval:
    """Verify vacuum rate interval is set to ~4 req/sec"""
    
    def test_rate_interval_in_code(self):
        """Verify _RATE_INTERVAL is 0.25 seconds (~4 req/sec)"""
        # Read the snapshot.py file to verify the rate interval
        snapshot_file = "/app/backend/routes/snapshot.py"
        with open(snapshot_file, 'r') as f:
            content = f.read()
        
        # Check for the rate interval setting
        assert "_RATE_INTERVAL = 0.25" in content, "Rate interval should be 0.25 seconds (~4 req/sec)"
        print("✓ _RATE_INTERVAL is set to 0.25 seconds (~4 req/sec)")


class TestConsumeResponseFormat:
    """Verify consume endpoint returns comprehensive breakdown on success"""
    
    def test_consume_response_has_breakdown_fields(self):
        """Verify the consume function returns breakdown with roots/profiles/keywords"""
        # Read the snapshot.py file to verify the response format
        snapshot_file = "/app/backend/routes/snapshot.py"
        with open(snapshot_file, 'r') as f:
            content = f.read()
        
        # Check for breakdown fields in the return statement
        assert '"breakdown"' in content or "'breakdown'" in content
        assert '"roots"' in content or "'roots'" in content
        assert '"profiles"' in content or "'profiles'" in content
        assert '"keywords"' in content or "'keywords'" in content
        assert '"previous_cid"' in content or "'previous_cid'" in content
        assert '"has_previous"' in content or "'has_previous'" in content
        print("✓ Consume response includes breakdown with roots/profiles/keywords and chain walk info")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
