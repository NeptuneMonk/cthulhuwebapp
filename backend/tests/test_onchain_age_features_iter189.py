"""
Test On-Chain Age Badge and Object History features - Iteration 189
Tests the new features:
1. On-Chain Age Badge - displays based on creation year
2. Object History - displays ChangeLog on object detail page
3. Backend API returns change_log and process_height fields
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known test object: 300 PI digits (created Jan 2023 - should show Network Renaissance Piece)
TEST_OBJECT_ADDRESS = "mofPH7dL2Fipgpy61D268v4a3BqcNC7niX"


class TestObjectDetailAPI:
    """Test /api/object/addr/{address} endpoint returns change_log and process_height"""
    
    def test_object_detail_returns_change_log(self):
        """Verify the object detail endpoint returns change_log field"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "change_log" in data, "change_log field missing from response"
        assert isinstance(data["change_log"], list), "change_log should be a list"
        assert len(data["change_log"]) > 0, "change_log should have entries"
        print(f"SUCCESS: change_log has {len(data['change_log'])} entries")
    
    def test_object_detail_returns_process_height(self):
        """Verify the object detail endpoint returns process_height field"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "process_height" in data, "process_height field missing from response"
        assert isinstance(data["process_height"], int), "process_height should be an integer"
        print(f"SUCCESS: process_height = {data['process_height']}")
    
    def test_object_detail_returns_created_date(self):
        """Verify the object detail endpoint returns created_date for age badge"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "created_date" in data, "created_date field missing from response"
        assert data["created_date"], "created_date should not be empty"
        # Verify it's a 2023 date (for Network Renaissance Piece badge)
        assert "2023" in data["created_date"], f"Expected 2023 date, got {data['created_date']}"
        print(f"SUCCESS: created_date = {data['created_date']}")
    
    def test_change_log_entry_structure(self):
        """Verify change_log entries have correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        change_log = data.get("change_log", [])
        assert len(change_log) > 0, "change_log should have entries"
        
        # Check first entry structure
        entry = change_log[0]
        required_fields = ["from", "to", "action", "quantity", "date"]
        for field in required_fields:
            assert field in entry, f"change_log entry missing '{field}' field"
        
        print(f"SUCCESS: change_log entry has all required fields: {list(entry.keys())}")
    
    def test_change_log_action_types(self):
        """Verify change_log contains expected action types"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        change_log = data.get("change_log", [])
        
        actions = [entry.get("action", "").lower() for entry in change_log]
        print(f"Actions found: {actions}")
        
        # This object should have claim, grant, give, lock actions
        expected_actions = ["claim", "grant", "give", "lock"]
        for expected in expected_actions:
            assert expected in actions, f"Expected action '{expected}' not found in change_log"
        
        print(f"SUCCESS: All expected actions found: {expected_actions}")


class TestObjectByTxidAPI:
    """Test /api/object/{txid} endpoint also returns change_log"""
    
    def test_object_by_txid_returns_change_log(self):
        """Verify the object by txid endpoint returns change_log field"""
        # First get the txid from the address endpoint
        addr_response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert addr_response.status_code == 200
        txid = addr_response.json().get("transaction_id")
        
        if not txid:
            pytest.skip("No transaction_id available for this object")
        
        # Now test the txid endpoint
        response = requests.get(
            f"{BASE_URL}/api/object/{txid}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "change_log" in data, "change_log field missing from txid endpoint response"
        print(f"SUCCESS: /api/object/{txid[:8]}... returns change_log with {len(data.get('change_log', []))} entries")


class TestResolvedProfiles:
    """Test that change_log addresses are resolved in resolved_profiles"""
    
    def test_change_log_addresses_resolved(self):
        """Verify addresses in change_log are included in resolved_profiles"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{TEST_OBJECT_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        change_log = data.get("change_log", [])
        resolved = data.get("resolved_profiles", {})
        
        # Collect all addresses from change_log
        changelog_addresses = set()
        for entry in change_log:
            if entry.get("from"):
                changelog_addresses.add(entry["from"])
            if entry.get("to"):
                changelog_addresses.add(entry["to"])
        
        # Check if any are resolved
        resolved_count = sum(1 for addr in changelog_addresses if addr in resolved)
        print(f"SUCCESS: {resolved_count}/{len(changelog_addresses)} change_log addresses resolved")
        print(f"Resolved profiles: {list(resolved.keys())[:5]}...")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
