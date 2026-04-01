"""
Test Vault API endpoints - Iteration 159
Tests pattern lock, vault items CRUD, and migration functionality.
"""
import pytest
import requests
import os
import time
from uuid import uuid4

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test address prefix for cleanup
TEST_PREFIX = f"TEST_vault_{int(time.time())}_"


class TestVaultPatternAPI:
    """Tests for /api/vault/pattern endpoints"""
    
    def test_get_pattern_new_user_returns_has_pattern_false(self):
        """GET /api/vault/pattern/{address} returns has_pattern:false for new users"""
        test_address = f"{TEST_PREFIX}newuser_{uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/vault/pattern/{test_address}?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "has_pattern" in data, "Response should contain 'has_pattern' field"
        assert data["has_pattern"] == False, "New user should have has_pattern=false"
        print(f"✓ GET /api/vault/pattern returns has_pattern=false for new user")
    
    def test_save_pattern_creates_pattern(self):
        """POST /api/vault/pattern saves pattern verification hash and salt"""
        test_address = f"{TEST_PREFIX}savepattern_{uuid4().hex[:8]}"
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "verification_hash": "abc123def456789012345678901234567890123456789012345678901234abcd",
            "salt": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
        }
        
        response = requests.post(f"{BASE_URL}/api/vault/pattern", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Response should have success=true"
        print(f"✓ POST /api/vault/pattern saves pattern successfully")
    
    def test_get_pattern_after_save_returns_has_pattern_true(self):
        """GET /api/vault/pattern/{address} returns has_pattern:true after save"""
        test_address = f"{TEST_PREFIX}getaftersave_{uuid4().hex[:8]}"
        
        # First save a pattern
        save_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "verification_hash": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "salt": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
        }
        save_response = requests.post(f"{BASE_URL}/api/vault/pattern", json=save_payload)
        assert save_response.status_code == 200, f"Save failed: {save_response.text}"
        
        # Then verify it exists
        get_response = requests.get(f"{BASE_URL}/api/vault/pattern/{test_address}?network=btc-testnet")
        
        assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}"
        data = get_response.json()
        assert data.get("has_pattern") == True, "Should have has_pattern=true after save"
        assert data.get("verification_hash") == save_payload["verification_hash"], "Hash should match"
        assert data.get("salt") == save_payload["salt"], "Salt should match"
        print(f"✓ GET /api/vault/pattern returns has_pattern=true and correct data after save")


class TestVaultItemsAPI:
    """Tests for /api/vault/item and /api/vault/items endpoints"""
    
    def test_get_items_empty_for_new_user(self):
        """GET /api/vault/items/{address} returns empty items for new users"""
        test_address = f"{TEST_PREFIX}emptyitems_{uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "items" in data, "Response should contain 'items' field"
        assert isinstance(data["items"], list), "Items should be a list"
        assert len(data["items"]) == 0, "New user should have empty items"
        print(f"✓ GET /api/vault/items returns empty list for new user")
    
    def test_save_item_creates_item(self):
        """POST /api/vault/item saves an encrypted vault item with all fields"""
        test_address = f"{TEST_PREFIX}saveitem_{uuid4().hex[:8]}"
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "base64encodedencrypteddata==",
            "label": "Test Note",
            "category": "notes",
            "original_name": "",
            "file_size": 0
        }
        
        response = requests.post(f"{BASE_URL}/api/vault/item", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Response should have success=true"
        assert "item" in data, "Response should contain 'item' field"
        
        item = data["item"]
        assert "item_id" in item, "Item should have item_id"
        assert item["address"] == test_address, "Address should match"
        assert item["network"] == "btc-testnet", "Network should match"
        assert item["encrypted_blob"] == payload["encrypted_blob"], "Encrypted blob should match"
        assert item["label"] == payload["label"], "Label should match"
        assert item["category"] == payload["category"], "Category should match"
        assert "created_at" in item, "Item should have created_at"
        print(f"✓ POST /api/vault/item saves item with all fields correctly")
    
    def test_save_item_and_verify_persistence(self):
        """POST /api/vault/item then GET verifies data persisted"""
        test_address = f"{TEST_PREFIX}persist_{uuid4().hex[:8]}"
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "persistencetest123==",
            "label": "Persistence Test",
            "category": "files",
            "original_name": "test.txt",
            "file_size": 1024
        }
        
        # Save item
        save_response = requests.post(f"{BASE_URL}/api/vault/item", json=payload)
        assert save_response.status_code == 200, f"Save failed: {save_response.text}"
        saved_item = save_response.json()["item"]
        
        # Verify persistence
        get_response = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        assert get_response.status_code == 200, f"Get failed: {get_response.text}"
        
        items = get_response.json()["items"]
        assert len(items) >= 1, "Should have at least 1 item"
        
        # Find our item
        found = next((i for i in items if i["item_id"] == saved_item["item_id"]), None)
        assert found is not None, "Saved item should be in items list"
        assert found["label"] == payload["label"], "Label should persist"
        assert found["category"] == payload["category"], "Category should persist"
        assert found["original_name"] == payload["original_name"], "Original name should persist"
        assert found["file_size"] == payload["file_size"], "File size should persist"
        print(f"✓ POST /api/vault/item data persists and is retrievable via GET")
    
    def test_update_label(self):
        """POST /api/vault/item/label updates the label on an item"""
        test_address = f"{TEST_PREFIX}updatelabel_{uuid4().hex[:8]}"
        
        # First create an item
        create_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "labeltest==",
            "label": "Original Label",
            "category": "notes"
        }
        create_response = requests.post(f"{BASE_URL}/api/vault/item", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        item_id = create_response.json()["item"]["item_id"]
        
        # Update label
        update_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "item_id": item_id,
            "label": "Updated Label"
        }
        update_response = requests.post(f"{BASE_URL}/api/vault/item/label", json=update_payload)
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        data = update_response.json()
        assert data.get("success") == True, "Response should have success=true"
        
        # Verify update persisted
        get_response = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        items = get_response.json()["items"]
        found = next((i for i in items if i["item_id"] == item_id), None)
        assert found is not None, "Item should exist"
        assert found["label"] == "Updated Label", "Label should be updated"
        print(f"✓ POST /api/vault/item/label updates label correctly")
    
    def test_delete_item(self):
        """POST /api/vault/item/delete removes an item"""
        test_address = f"{TEST_PREFIX}deleteitem_{uuid4().hex[:8]}"
        
        # First create an item
        create_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "deletetest==",
            "label": "To Be Deleted",
            "category": "notes"
        }
        create_response = requests.post(f"{BASE_URL}/api/vault/item", json=create_payload)
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        item_id = create_response.json()["item"]["item_id"]
        
        # Verify item exists
        get_response1 = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        items1 = get_response1.json()["items"]
        assert any(i["item_id"] == item_id for i in items1), "Item should exist before delete"
        
        # Delete item
        delete_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "item_id": item_id
        }
        delete_response = requests.post(f"{BASE_URL}/api/vault/item/delete", json=delete_payload)
        
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        data = delete_response.json()
        assert data.get("success") == True, "Response should have success=true"
        
        # Verify item is gone
        get_response2 = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        items2 = get_response2.json()["items"]
        assert not any(i["item_id"] == item_id for i in items2), "Item should not exist after delete"
        print(f"✓ POST /api/vault/item/delete removes item correctly")


class TestVaultMigrateAPI:
    """Tests for /api/vault/migrate endpoint"""
    
    def test_migrate_creates_item(self):
        """POST /api/vault/migrate creates a migrated item"""
        test_address = f"{TEST_PREFIX}migrate_{uuid4().hex[:8]}"
        test_txid = f"txid_{uuid4().hex}"
        
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "txid": test_txid,
            "encrypted_blob": "migrateddata==",
            "label": "Migrated Item",
            "category": "notes",
            "original_name": "",
            "file_size": 0,
            "timestamp": "2024-01-15T10:30:00Z"
        }
        
        response = requests.post(f"{BASE_URL}/api/vault/migrate", json=payload)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Response should have success=true"
        assert "item" in data, "Response should contain 'item' field"
        
        item = data["item"]
        assert item["txid"] == test_txid, "Txid should match"
        assert item["encrypted_blob"] == payload["encrypted_blob"], "Encrypted blob should match"
        print(f"✓ POST /api/vault/migrate creates migrated item correctly")
    
    def test_migrate_deduplicates_by_txid(self):
        """POST /api/vault/migrate deduplicates by txid"""
        test_address = f"{TEST_PREFIX}dedup_{uuid4().hex[:8]}"
        test_txid = f"txid_dedup_{uuid4().hex}"
        
        payload = {
            "address": test_address,
            "network": "btc-testnet",
            "txid": test_txid,
            "encrypted_blob": "firstmigration==",
            "label": "First Migration",
            "category": "notes"
        }
        
        # First migration
        response1 = requests.post(f"{BASE_URL}/api/vault/migrate", json=payload)
        assert response1.status_code == 200, f"First migrate failed: {response1.text}"
        assert "item" in response1.json(), "First migration should return item"
        
        # Second migration with same txid
        payload["encrypted_blob"] = "secondmigration=="
        payload["label"] = "Second Migration"
        response2 = requests.post(f"{BASE_URL}/api/vault/migrate", json=payload)
        
        assert response2.status_code == 200, f"Expected 200, got {response2.status_code}: {response2.text}"
        data2 = response2.json()
        assert data2.get("success") == True, "Response should have success=true"
        assert data2.get("message") == "Already migrated", "Should return 'Already migrated' message"
        assert "item" not in data2, "Should not return item for duplicate"
        
        # Verify only one item exists
        get_response = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        items = get_response.json()["items"]
        txid_items = [i for i in items if i.get("txid") == test_txid]
        assert len(txid_items) == 1, "Should have exactly 1 item with this txid"
        assert txid_items[0]["label"] == "First Migration", "Should keep first migration's data"
        print(f"✓ POST /api/vault/migrate deduplicates by txid correctly")


class TestVaultNetworkIsolation:
    """Tests for network isolation in vault"""
    
    def test_items_isolated_by_network(self):
        """Items are isolated by network"""
        test_address = f"{TEST_PREFIX}isolation_{uuid4().hex[:8]}"
        
        # Create item on testnet
        testnet_payload = {
            "address": test_address,
            "network": "btc-testnet",
            "encrypted_blob": "testnetdata==",
            "label": "Testnet Item",
            "category": "notes"
        }
        testnet_response = requests.post(f"{BASE_URL}/api/vault/item", json=testnet_payload)
        assert testnet_response.status_code == 200, f"Testnet save failed: {testnet_response.text}"
        
        # Create item on mainnet
        mainnet_payload = {
            "address": test_address,
            "network": "btc-mainnet",
            "encrypted_blob": "mainnetdata==",
            "label": "Mainnet Item",
            "category": "notes"
        }
        mainnet_response = requests.post(f"{BASE_URL}/api/vault/item", json=mainnet_payload)
        assert mainnet_response.status_code == 200, f"Mainnet save failed: {mainnet_response.text}"
        
        # Verify testnet items
        testnet_get = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-testnet")
        testnet_items = testnet_get.json()["items"]
        assert len(testnet_items) == 1, "Should have 1 testnet item"
        assert testnet_items[0]["label"] == "Testnet Item", "Should be testnet item"
        
        # Verify mainnet items
        mainnet_get = requests.get(f"{BASE_URL}/api/vault/items/{test_address}?network=btc-mainnet")
        mainnet_items = mainnet_get.json()["items"]
        assert len(mainnet_items) == 1, "Should have 1 mainnet item"
        assert mainnet_items[0]["label"] == "Mainnet Item", "Should be mainnet item"
        
        print(f"✓ Vault items are correctly isolated by network")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
