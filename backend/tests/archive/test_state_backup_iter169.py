"""
Test State Backup API Endpoints - Iteration 169
Tests the new on-chain state backup feature for follows/tethers via the Vault.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestHealthCheck:
    """Basic health check"""
    
    def test_health_endpoint(self, api_client):
        """Verify API is running"""
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("✓ Health check passed")


class TestStateBackupGet:
    """Test GET /api/vault/state-backup/{address}"""
    
    def test_get_state_backup_no_backup_exists(self, api_client):
        """GET returns null when no backup exists for address"""
        # Use a random address that won't have a backup
        test_address = f"TEST_no_backup_{uuid.uuid4().hex[:8]}"
        response = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        
        assert response.status_code == 200
        data = response.json()
        assert "item" in data
        assert data["item"] is None
        print(f"✓ GET state-backup returns null for non-existent address: {test_address}")
    
    def test_get_state_backup_with_network_param(self, api_client):
        """GET accepts network query parameter"""
        test_address = f"TEST_network_param_{uuid.uuid4().hex[:8]}"
        
        # Test with btc-testnet
        response = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        
        # Test with btc-mainnet
        response = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-mainnet")
        assert response.status_code == 200
        print("✓ GET state-backup accepts network parameter")


class TestStateBackupPost:
    """Test POST /api/vault/state-backup"""
    
    def test_save_state_backup(self, api_client):
        """POST saves encrypted state backup"""
        test_address = f"TEST_save_backup_{uuid.uuid4().hex[:8]}"
        test_blob = "encrypted_test_data_base64_" + uuid.uuid4().hex
        
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": test_blob
        }
        
        response = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True
        assert "item" in data
        
        item = data["item"]
        assert item["address"] == test_address
        assert item["network"] == "btc-testnet"
        assert item["encrypted_blob"] == test_blob
        assert item["category"] == "state_backup"
        assert item["label"] == "State Backup"
        assert "item_id" in item
        assert "created_at" in item
        # Verify no _id field
        assert "_id" not in item
        print(f"✓ POST state-backup saves backup correctly for: {test_address}")
    
    def test_save_state_backup_structure(self, api_client):
        """Verify state backup has correct structure"""
        test_address = f"TEST_structure_{uuid.uuid4().hex[:8]}"
        test_blob = "test_blob_" + uuid.uuid4().hex
        
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": test_blob
        }
        
        response = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload)
        assert response.status_code == 200
        
        item = response.json()["item"]
        
        # Check all required fields
        required_fields = ["item_id", "address", "network", "encrypted_blob", "label", "category", "created_at"]
        for field in required_fields:
            assert field in item, f"Missing required field: {field}"
        
        # Verify field values
        assert item["category"] == "state_backup"
        assert item["label"] == "State Backup"
        assert isinstance(item["item_id"], str)
        assert len(item["item_id"]) > 0
        
        # Verify no MongoDB _id field
        assert "_id" not in item
        print("✓ State backup has correct structure with all required fields")
    
    def test_save_state_backup_replaces_previous(self, api_client):
        """POST replaces previous backup (only one exists at a time)"""
        test_address = f"TEST_replace_{uuid.uuid4().hex[:8]}"
        
        # Save first backup
        first_blob = "first_backup_" + uuid.uuid4().hex
        payload1 = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": first_blob
        }
        response1 = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload1)
        assert response1.status_code == 200
        first_item_id = response1.json()["item"]["item_id"]
        
        # Save second backup (should replace first)
        second_blob = "second_backup_" + uuid.uuid4().hex
        payload2 = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": second_blob
        }
        response2 = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload2)
        assert response2.status_code == 200
        second_item_id = response2.json()["item"]["item_id"]
        
        # Verify item_id changed (new item created)
        assert first_item_id != second_item_id
        
        # GET should return only the second backup
        get_response = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert get_response.status_code == 200
        
        fetched_item = get_response.json()["item"]
        assert fetched_item is not None
        assert fetched_item["encrypted_blob"] == second_blob
        assert fetched_item["item_id"] == second_item_id
        print(f"✓ POST state-backup replaces previous backup (only one exists)")


class TestStateBackupGetAfterSave:
    """Test GET returns the latest backup after save"""
    
    def test_get_returns_latest_backup(self, api_client):
        """GET returns the latest backup after POST"""
        test_address = f"TEST_get_after_save_{uuid.uuid4().hex[:8]}"
        test_blob = "get_after_save_blob_" + uuid.uuid4().hex
        
        # First verify no backup exists
        get_response1 = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert get_response1.status_code == 200
        assert get_response1.json()["item"] is None
        
        # Save a backup
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": test_blob
        }
        post_response = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload)
        assert post_response.status_code == 200
        saved_item = post_response.json()["item"]
        
        # GET should now return the backup
        get_response2 = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert get_response2.status_code == 200
        
        fetched_item = get_response2.json()["item"]
        assert fetched_item is not None
        assert fetched_item["encrypted_blob"] == test_blob
        assert fetched_item["item_id"] == saved_item["item_id"]
        assert fetched_item["address"] == test_address
        assert fetched_item["network"] == "btc-testnet"
        assert fetched_item["category"] == "state_backup"
        
        # Verify no _id in response
        assert "_id" not in fetched_item
        print(f"✓ GET returns latest backup after save for: {test_address}")


class TestStateBackupNetworkIsolation:
    """Test that backups are isolated by network"""
    
    def test_network_isolation(self, api_client):
        """Backups are isolated by network (testnet vs mainnet)"""
        test_address = f"TEST_network_isolation_{uuid.uuid4().hex[:8]}"
        
        # Save backup on testnet
        testnet_blob = "testnet_blob_" + uuid.uuid4().hex
        payload_testnet = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": testnet_blob
        }
        response_testnet = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload_testnet)
        assert response_testnet.status_code == 200
        
        # Save backup on mainnet
        mainnet_blob = "mainnet_blob_" + uuid.uuid4().hex
        payload_mainnet = {
            "address": test_address,
            "network": "btc-mainnet",
            "encrypted_blob": mainnet_blob
        }
        response_mainnet = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload_mainnet)
        assert response_mainnet.status_code == 200
        
        # GET testnet should return testnet blob
        get_testnet = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert get_testnet.status_code == 200
        assert get_testnet.json()["item"]["encrypted_blob"] == testnet_blob
        
        # GET mainnet should return mainnet blob
        get_mainnet = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-mainnet")
        assert get_mainnet.status_code == 200
        assert get_mainnet.json()["item"]["encrypted_blob"] == mainnet_blob
        
        print("✓ State backups are correctly isolated by network")


class TestStateBackupNoIdField:
    """Verify _id field is excluded from responses"""
    
    def test_post_response_no_id(self, api_client):
        """POST response excludes _id field"""
        test_address = f"TEST_no_id_post_{uuid.uuid4().hex[:8]}"
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "test_blob"
        }
        
        response = api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload)
        assert response.status_code == 200
        
        item = response.json()["item"]
        assert "_id" not in item
        print("✓ POST response excludes _id field")
    
    def test_get_response_no_id(self, api_client):
        """GET response excludes _id field"""
        test_address = f"TEST_no_id_get_{uuid.uuid4().hex[:8]}"
        
        # First save a backup
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "test_blob_for_get"
        }
        api_client.post(f"{BASE_URL}/api/vault/state-backup", json=payload)
        
        # GET and verify no _id
        response = api_client.get(f"{BASE_URL}/api/vault/state-backup/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        
        item = response.json()["item"]
        assert item is not None
        assert "_id" not in item
        print("✓ GET response excludes _id field")
