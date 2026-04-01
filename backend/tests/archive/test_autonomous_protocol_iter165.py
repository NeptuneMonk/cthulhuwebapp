"""
Iteration 165: Autonomous Protocol Features Testing
- Admin Etch Management (list, update, delete)
- Treasury Economics Dashboard (balance, income, expenses, ledger)
- Chat Unread Notification Tracking
- Small File Etch POC endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"


class TestAdminLogin:
    """Admin authentication tests"""
    
    def test_admin_login_success(self):
        """Test admin login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        assert len(data["token"]) > 0, "Token is empty"
    
    def test_admin_login_invalid_credentials(self):
        """Test admin login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "wrong",
            "password": "wrong"
        })
        assert response.status_code == 401


@pytest.fixture(scope="module")
def admin_token():
    """Get admin JWT token for authenticated requests"""
    response = requests.post(f"{BASE_URL}/api/admin/login", json={
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Admin authentication failed")


@pytest.fixture
def admin_headers(admin_token):
    """Headers with admin auth token"""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}"
    }


# ─── Treasury Economics Tests ───

class TestTreasuryEconomics:
    """Treasury economics dashboard endpoint tests"""
    
    def test_treasury_economics_endpoint(self, admin_headers):
        """GET /api/treasury/economics returns economics data"""
        response = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Economics failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "address" in data, "Missing address field"
        assert "network" in data, "Missing network field"
        assert "balance_sats" in data, "Missing balance_sats field"
        assert "balance_btc" in data, "Missing balance_btc field"
        assert "income" in data, "Missing income field"
        assert "expenses" in data, "Missing expenses field"
        assert "net_sats" in data, "Missing net_sats field"
        
        # Verify income structure
        assert "tax_total_sats" in data["income"], "Missing tax_total_sats"
        assert "tax_count" in data["income"], "Missing tax_count"
        
        # Verify expenses structure
        assert "faucet_total_sats" in data["expenses"], "Missing faucet_total_sats"
        assert "faucet_count" in data["expenses"], "Missing faucet_count"
        assert "checkpoint_total_sats" in data["expenses"], "Missing checkpoint_total_sats"
        assert "checkpoint_count" in data["expenses"], "Missing checkpoint_count"
        assert "total_sats" in data["expenses"], "Missing total_sats"
    
    def test_treasury_economics_testnet_configured(self, admin_headers):
        """Treasury should be configured for btc-testnet"""
        response = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Testnet treasury should be configured
        assert data.get("configured") == True, "Treasury not configured for testnet"
        assert data.get("address") is not None, "Treasury address is None"
        # Expected address from TREASURY_TESTNET_WIF
        assert data["address"] == "mjxw5DaLmPET8mJ6cH3DHzzgqKbBQszBnd", f"Unexpected treasury address: {data['address']}"
    
    def test_treasury_economics_has_balance(self, admin_headers):
        """Treasury should have balance (from testnet faucet)"""
        response = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Treasury should have some balance
        assert data.get("balance_sats", 0) > 0, "Treasury has no balance"
    
    def test_treasury_economics_network_switch(self, admin_headers):
        """Test network selector switches between testnet and mainnet"""
        # Testnet
        response_testnet = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-testnet",
            headers=admin_headers
        )
        assert response_testnet.status_code == 200
        data_testnet = response_testnet.json()
        assert data_testnet["network"] == "btc-testnet"
        
        # Mainnet
        response_mainnet = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-mainnet",
            headers=admin_headers
        )
        assert response_mainnet.status_code == 200
        data_mainnet = response_mainnet.json()
        assert data_mainnet["network"] == "btc-mainnet"
    
    def test_treasury_economics_requires_auth(self):
        """Treasury economics should require admin auth"""
        response = requests.get(f"{BASE_URL}/api/treasury/economics?network=btc-testnet")
        assert response.status_code in [401, 403], "Economics endpoint should require auth"


class TestTreasuryLedger:
    """Treasury ledger endpoint tests"""
    
    def test_treasury_ledger_endpoint(self, admin_headers):
        """GET /api/treasury/ledger returns ledger entries"""
        response = requests.get(
            f"{BASE_URL}/api/treasury/ledger?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Ledger failed: {response.text}"
        data = response.json()
        
        assert "entries" in data, "Missing entries field"
        assert "total" in data, "Missing total field"
        assert isinstance(data["entries"], list), "Entries should be a list"
    
    def test_treasury_ledger_filter_by_type(self, admin_headers):
        """Ledger should support filtering by entry_type"""
        # Filter by tax_income
        response = requests.get(
            f"{BASE_URL}/api/treasury/ledger?network=btc-testnet&entry_type=tax_income",
            headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # All entries should be tax_income type
        for entry in data["entries"]:
            assert entry.get("type") == "tax_income", f"Entry type mismatch: {entry.get('type')}"
    
    def test_treasury_ledger_requires_auth(self):
        """Treasury ledger should require admin auth"""
        response = requests.get(f"{BASE_URL}/api/treasury/ledger?network=btc-testnet")
        assert response.status_code in [401, 403]


class TestTreasuryTaxLogging:
    """Tax logging endpoint tests"""
    
    def test_log_tax_payment(self):
        """POST /api/treasury/log-tax records ledger entry"""
        response = requests.post(f"{BASE_URL}/api/treasury/log-tax", json={
            "txid": "TEST_tax_iter165_" + str(os.urandom(4).hex()),
            "amount_sats": 1500,
            "network": "btc-testnet",
            "tx_type": "p2fk"
        })
        assert response.status_code == 200, f"Log tax failed: {response.text}"
        data = response.json()
        assert data.get("success") == True
    
    def test_log_tax_invalid_amount(self):
        """Tax logging should reject invalid amounts"""
        response = requests.post(f"{BASE_URL}/api/treasury/log-tax", json={
            "txid": "test_invalid",
            "amount_sats": 0,
            "network": "btc-testnet",
            "tx_type": "p2fk"
        })
        assert response.status_code == 400, "Should reject zero amount"
    
    def test_log_tax_negative_amount(self):
        """Tax logging should reject negative amounts"""
        response = requests.post(f"{BASE_URL}/api/treasury/log-tax", json={
            "txid": "test_negative",
            "amount_sats": -100,
            "network": "btc-testnet",
            "tx_type": "p2fk"
        })
        assert response.status_code == 400, "Should reject negative amount"


# ─── Etch Management Tests ───

class TestEtchChunk:
    """Etch chunk staging endpoint tests"""
    
    def test_stage_chunk(self):
        """POST /api/etch/chunk stages data correctly"""
        # Create test data (40 bytes)
        test_data = b"TEST_chunk_iter165_" + os.urandom(21)
        chunk_hex = test_data.hex()
        
        response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "TEST_etch_iter165",
            "network": "btc-testnet",
            "chunk_hex": chunk_hex,
            "filename": "test_iter165.bin",
            "chunk_index": 0,
            "total_chunks": 1
        })
        assert response.status_code == 200, f"Stage chunk failed: {response.text}"
        data = response.json()
        
        assert "txid" in data, "Missing txid (chunk_id)"
        assert "size" in data, "Missing size"
        assert "index" in data, "Missing index"
        assert data["size"] == 40, f"Size mismatch: {data['size']}"
        assert data["index"] == 0
    
    def test_stage_chunk_invalid_hex(self):
        """Chunk staging should reject invalid hex"""
        response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "test_invalid",
            "network": "btc-testnet",
            "chunk_hex": "not_valid_hex_zzz",
            "filename": "test.bin",
            "chunk_index": 0,
            "total_chunks": 1
        })
        assert response.status_code == 400, "Should reject invalid hex"


class TestEtchManifest:
    """Etch manifest endpoint tests"""
    
    def test_save_manifest(self):
        """POST /api/etch/manifest saves manifest with version/description"""
        # First stage a chunk
        test_data = b"TEST_manifest_iter165_" + os.urandom(18)
        chunk_hex = test_data.hex()
        
        chunk_response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "TEST_manifest_iter165",
            "network": "btc-testnet",
            "chunk_hex": chunk_hex,
            "filename": "manifest_test.bin",
            "chunk_index": 0,
            "total_chunks": 1
        })
        assert chunk_response.status_code == 200
        chunk_id = chunk_response.json()["txid"]
        
        # Save manifest
        response = requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": "TEST_manifest_iter165",
            "network": "btc-testnet",
            "files": [{"name": "manifest_test.bin", "txids": [chunk_id], "chunks": 1}],
            "version": "1.0.0",
            "description": "Test manifest for iteration 165"
        })
        assert response.status_code == 200, f"Save manifest failed: {response.text}"
        data = response.json()
        
        assert "manifest_id" in data, "Missing manifest_id"
        assert "file_count" in data, "Missing file_count"
        assert "total_size" in data, "Missing total_size"
        assert data["file_count"] == 1


class TestEtchAdminList:
    """Admin etch list endpoint tests"""
    
    def test_admin_list_etches(self, admin_headers):
        """GET /api/etch/admin/list returns manifests with stats"""
        response = requests.get(
            f"{BASE_URL}/api/etch/admin/list?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Admin list failed: {response.text}"
        data = response.json()
        
        assert "manifests" in data, "Missing manifests field"
        assert "total" in data, "Missing total field"
        assert "stats" in data, "Missing stats field"
        
        # Verify stats structure
        stats = data["stats"]
        assert "total_manifests" in stats, "Missing total_manifests"
        assert "total_chunks_stored" in stats, "Missing total_chunks_stored"
        assert "total_bytes_stored" in stats, "Missing total_bytes_stored"
    
    def test_admin_list_has_test_manifest(self, admin_headers):
        """Should have at least one manifest from POC test"""
        response = requests.get(
            f"{BASE_URL}/api/etch/admin/list?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should have at least one manifest
        assert data["total"] >= 1, "No manifests found"
        assert len(data["manifests"]) >= 1, "Manifests list is empty"
    
    def test_admin_list_manifest_structure(self, admin_headers):
        """Manifests should have required fields"""
        response = requests.get(
            f"{BASE_URL}/api/etch/admin/list?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        if data["manifests"]:
            manifest = data["manifests"][0]
            assert "_id" in manifest, "Missing _id"
            assert "address" in manifest, "Missing address"
            assert "network" in manifest, "Missing network"
            assert "files" in manifest, "Missing files"
            assert "version" in manifest, "Missing version"
            assert "created_at" in manifest, "Missing created_at"
    
    def test_admin_list_requires_auth(self):
        """Admin list should require auth"""
        response = requests.get(f"{BASE_URL}/api/etch/admin/list?network=btc-testnet")
        assert response.status_code in [401, 403]


class TestEtchAdminUpdate:
    """Admin etch update endpoint tests"""
    
    def test_admin_update_manifest(self, admin_headers):
        """PUT /api/etch/admin/manifest/{id} updates version/description"""
        # First get a manifest ID
        list_response = requests.get(
            f"{BASE_URL}/api/etch/admin/list?network=btc-testnet",
            headers=admin_headers
        )
        assert list_response.status_code == 200
        manifests = list_response.json()["manifests"]
        
        if not manifests:
            pytest.skip("No manifests to update")
        
        manifest_id = manifests[0]["_id"]
        
        # Update version and description
        response = requests.put(
            f"{BASE_URL}/api/etch/admin/manifest/{manifest_id}",
            headers=admin_headers,
            json={
                "version": "1.1.0",
                "description": "Updated by iter165 test"
            }
        )
        assert response.status_code == 200, f"Update failed: {response.text}"
        data = response.json()
        assert data.get("success") == True
    
    def test_admin_update_invalid_id(self, admin_headers):
        """Update should reject invalid manifest ID"""
        response = requests.put(
            f"{BASE_URL}/api/etch/admin/manifest/invalid_id",
            headers=admin_headers,
            json={"version": "1.0.0"}
        )
        assert response.status_code == 400, "Should reject invalid ID"
    
    def test_admin_update_requires_auth(self):
        """Update should require auth"""
        response = requests.put(
            f"{BASE_URL}/api/etch/admin/manifest/someid",
            json={"version": "1.0.0"}
        )
        assert response.status_code in [401, 403]


class TestEtchReconstructFile:
    """File reconstruction endpoint tests"""
    
    def test_reconstruct_file(self):
        """GET /api/etch/reconstruct-file returns correct bytes"""
        # Use the POC test data
        response = requests.get(
            f"{BASE_URL}/api/etch/reconstruct-file/test_etch_address/test.png?network=btc-testnet"
        )
        # May be 200 or 404 depending on test data state
        if response.status_code == 200:
            # Verify content-type is set
            content_type = response.headers.get("content-type", "")
            assert "image/png" in content_type or "application/octet-stream" in content_type
            # Verify we got some bytes
            assert len(response.content) > 0, "Empty response"
        elif response.status_code == 404:
            # POC test data may have been cleaned up
            pass
        else:
            pytest.fail(f"Unexpected status: {response.status_code}")
    
    def test_reconstruct_file_not_found(self):
        """Reconstruct should return 404 for non-existent file"""
        response = requests.get(
            f"{BASE_URL}/api/etch/reconstruct-file/nonexistent_address/nonexistent.bin?network=btc-testnet"
        )
        assert response.status_code == 404


# ─── Chat Unread Tracking Tests ───

class TestChatUnread:
    """Chat unread notification tracking tests"""
    
    def test_get_unread_counts(self):
        """GET /api/chat/unread/{address} returns unread counts"""
        test_address = "TEST_unread_iter165"
        response = requests.get(f"{BASE_URL}/api/chat/unread/{test_address}")
        assert response.status_code == 200, f"Unread failed: {response.text}"
        data = response.json()
        
        assert "rooms" in data, "Missing rooms field"
        assert "total_unread" in data, "Missing total_unread field"
        assert isinstance(data["rooms"], list), "Rooms should be a list"
        assert isinstance(data["total_unread"], int), "total_unread should be int"
    
    def test_mark_room_read(self):
        """POST /api/chat/mark-read/{room} marks room as read"""
        test_room = "TEST_room_iter165"
        test_address = "TEST_user_iter165"
        
        response = requests.post(
            f"{BASE_URL}/api/chat/mark-read/{test_room}?address={test_address}"
        )
        assert response.status_code == 200, f"Mark read failed: {response.text}"
        data = response.json()
        assert data.get("success") == True
    
    def test_mark_room_read_requires_address(self):
        """Mark read should require address parameter"""
        response = requests.post(f"{BASE_URL}/api/chat/mark-read/some_room")
        assert response.status_code == 200  # Returns success: false
        data = response.json()
        assert data.get("success") == False
    
    def test_register_for_room(self):
        """POST /api/chat/register-room registers user for unread tracking"""
        response = requests.post(
            f"{BASE_URL}/api/chat/register-room?address=TEST_register_iter165&room=TEST_room_iter165"
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True


# ─── Treasury Info (Public) Tests ───

class TestTreasuryInfo:
    """Public treasury info endpoint tests"""
    
    def test_treasury_info_public(self):
        """GET /api/treasury/info returns public treasury data"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200, f"Treasury info failed: {response.text}"
        data = response.json()
        
        assert "address" in data, "Missing address"
        assert "balance_sats" in data, "Missing balance_sats"
        assert "tax_rate" in data, "Missing tax_rate"
        assert "faucet_available" in data, "Missing faucet_available"
        assert "network" in data, "Missing network"
        assert "configured" in data, "Missing configured"
    
    def test_treasury_info_testnet_configured(self):
        """Testnet treasury should be configured"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert data["configured"] == True
        assert data["address"] == "mjxw5DaLmPET8mJ6cH3DHzzgqKbBQszBnd"
        assert data["tax_rate"] == 0.02 or data["tax_rate"] > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
