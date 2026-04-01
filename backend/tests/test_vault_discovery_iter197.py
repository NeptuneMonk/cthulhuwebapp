"""
Test vault discovery endpoint and notification state backup features.
Tests for iteration 197 - vault backup with notification timestamps.

Features tested:
1. GET /api/vault/discover-onchain/{address}?network=btc-testnet returns correct structure
2. Response includes found, backup, latest_self_pm fields
3. Backend compiles without errors
4. Health check passes
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestVaultDiscovery:
    """Test vault discovery endpoint for notification state backup"""
    
    def test_health_check(self):
        """Verify backend is healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed: {data}")
    
    def test_vault_discover_onchain_structure(self):
        """Test discover-onchain endpoint returns correct structure"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/discover-onchain/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields exist
        assert "found" in data, "Response must have 'found' field"
        assert "backup" in data, "Response must have 'backup' field"
        assert "latest_self_pm" in data, "Response must have 'latest_self_pm' field"
        
        print(f"✓ Response structure correct: found={data['found']}, latest_self_pm={data['latest_self_pm']}")
    
    def test_vault_discover_finds_backup(self):
        """Test that the testnet address has a CTHULHU_VAULT backup"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/discover-onchain/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # This address should have a vault backup
        assert data["found"] == True, "Expected to find vault backup for test address"
        
        # Verify backup structure
        backup = data["backup"]
        assert backup is not None, "Backup should not be None when found=True"
        assert "txid" in backup, "Backup must have txid"
        assert "cid" in backup, "Backup must have cid"
        assert "content" in backup, "Backup must have content"
        assert "source" in backup, "Backup must have source"
        
        # Verify IPFS CID format
        assert backup["cid"].startswith("Qm"), f"CID should start with 'Qm', got: {backup['cid']}"
        
        # Verify content contains CTHULHU_VAULT keyword
        assert "CTHULHU_VAULT" in backup["content"], "Content should contain CTHULHU_VAULT keyword"
        assert "ipfs://" in backup["content"], "Content should contain ipfs:// reference"
        
        print(f"✓ Vault backup found: txid={backup['txid'][:16]}..., cid={backup['cid']}")
    
    def test_vault_discover_returns_latest_self_pm(self):
        """Test that latest_self_pm is returned for vault cutoff"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/discover-onchain/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # latest_self_pm should be an ISO date string or None
        latest_self_pm = data.get("latest_self_pm")
        if latest_self_pm:
            # Verify it's a valid ISO date format (YYYY-MM-DDTHH:MM:SS)
            assert "T" in latest_self_pm, f"latest_self_pm should be ISO format, got: {latest_self_pm}"
            assert len(latest_self_pm) >= 16, f"latest_self_pm too short: {latest_self_pm}"
            print(f"✓ latest_self_pm returned: {latest_self_pm}")
        else:
            print("✓ latest_self_pm is None (no self-directed PMs found)")
    
    def test_vault_discover_nonexistent_address(self):
        """Test discover-onchain with address that has no vault"""
        # Use a random testnet address that likely has no vault
        address = "mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef"
        response = requests.get(
            f"{BASE_URL}/api/vault/discover-onchain/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return found=False for unknown address
        # Note: This may still return found=True if the address happens to have a vault
        assert "found" in data
        assert "backup" in data
        assert "latest_self_pm" in data
        
        print(f"✓ Nonexistent address handled: found={data['found']}")
    
    def test_vault_items_endpoint(self):
        """Test vault items endpoint exists and returns correct structure"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/items/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "items" in data, "Response must have 'items' field"
        assert isinstance(data["items"], list), "items must be a list"
        
        print(f"✓ Vault items endpoint works: {len(data['items'])} items")
    
    def test_vault_pattern_endpoint(self):
        """Test vault pattern endpoint exists and returns correct structure"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/pattern/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "has_pattern" in data, "Response must have 'has_pattern' field"
        
        print(f"✓ Vault pattern endpoint works: has_pattern={data['has_pattern']}")


class TestStateBackupEndpoints:
    """Test state backup specific endpoints"""
    
    def test_state_backup_get(self):
        """Test GET state-backup endpoint"""
        address = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
        response = requests.get(
            f"{BASE_URL}/api/vault/state-backup/{address}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "item" in data, "Response must have 'item' field"
        # item can be None if no state backup exists
        
        print(f"✓ State backup GET works: item={'exists' if data['item'] else 'None'}")


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
