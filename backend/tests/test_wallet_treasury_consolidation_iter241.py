"""
Test suite for Wallet/Treasury consolidation - Iteration 241
Verifies:
1. /api/health returns sqlite: up (regression check)
2. /api/snapshot/status returns valid JSON (regression check)
3. Treasury panel backend endpoints work correctly (requires auth)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials
ADMIN_USERNAME = "CthulhuAdmin"
ADMIN_PASSWORD = "78UH1%2kC^vH2Gi1MqI@"

@pytest.fixture(scope="module")
def admin_token():
    """Get admin authentication token"""
    response = requests.post(f"{BASE_URL}/api/admin/login", json={
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Admin authentication failed - skipping authenticated tests")

class TestRegressionChecks:
    """Regression checks for backend APIs"""
    
    def test_health_endpoint_returns_sqlite_up(self):
        """Verify /api/health returns sqlite: up"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health endpoint returned {response.status_code}"
        
        data = response.json()
        assert "services" in data, "Health response missing 'services' key"
        assert "sqlite" in data["services"], "Health response missing 'sqlite' service"
        assert data["services"]["sqlite"] == "up", f"SQLite status is '{data['services']['sqlite']}', expected 'up'"
        
        # Verify mongodb is NOT in the response (we use SQLite now)
        assert "mongodb" not in data.get("services", {}), "Health response should NOT contain 'mongodb' service"
        print(f"✓ Health endpoint returns: {data}")
    
    def test_snapshot_status_returns_valid_json(self):
        """Verify /api/snapshot/status returns valid JSON"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200, f"Snapshot status returned {response.status_code}"
        
        data = response.json()
        # Verify expected keys exist
        assert "vacuum" in data, "Snapshot status missing 'vacuum' key"
        assert "cache" in data, "Snapshot status missing 'cache' key"
        assert "snapshots" in data, "Snapshot status missing 'snapshots' key"
        
        # Verify vacuum structure
        assert "running" in data["vacuum"], "Vacuum missing 'running' key"
        assert "phase" in data["vacuum"], "Vacuum missing 'phase' key"
        
        # Verify cache structure
        assert "p2fk_entries" in data["cache"], "Cache missing 'p2fk_entries' key"
        
        print(f"✓ Snapshot status returns valid JSON with {len(data['snapshots'])} snapshots")


class TestTreasuryEndpoints:
    """Test Treasury-related endpoints (requires admin auth)"""
    
    def test_treasury_economics_endpoint(self, admin_token):
        """Verify /api/treasury/economics returns valid data"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/treasury/economics?network=btc-testnet", headers=headers)
        assert response.status_code == 200, f"Treasury economics returned {response.status_code}"
        
        data = response.json()
        # Verify expected keys
        assert "address" in data, "Treasury economics missing 'address' key"
        assert "balance_sats" in data, "Treasury economics missing 'balance_sats' key"
        
        print(f"✓ Treasury economics returns: address={data.get('address', 'N/A')[:20]}...")
    
    def test_treasury_ledger_endpoint(self, admin_token):
        """Verify /api/treasury/ledger returns valid data"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/treasury/ledger?network=btc-testnet", headers=headers)
        assert response.status_code == 200, f"Treasury ledger returned {response.status_code}"
        
        data = response.json()
        assert "entries" in data, "Treasury ledger missing 'entries' key"
        
        print(f"✓ Treasury ledger returns {len(data.get('entries', []))} entries")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
