"""
Test Admin Wallet and OBJ Etch Features - Iteration 166

Tests:
- Admin wallet status endpoint
- Admin wallet addresses list
- Admin wallet unlock (correct/wrong password)
- Admin wallet balance check
- Admin wallet import key
- OBJ etch endpoint (P2FK format for bitfossil.com)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

# Admin credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"
WALLET_PASSWORD = "walletpass123"


@pytest.fixture(scope="module")
def admin_token():
    """Get admin JWT token for authenticated requests."""
    response = requests.post(
        f"{BASE_URL}/api/admin/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    )
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Admin login failed - skipping authenticated tests")


@pytest.fixture
def auth_headers(admin_token):
    """Headers with admin auth token."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}"
    }


class TestAdminWalletStatus:
    """Test /api/admin/wallet/status endpoint"""
    
    def test_wallet_status_returns_initialized(self, auth_headers):
        """Wallet status should show initialized=True (wallet was created in previous session)"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["initialized"] == True
        assert data["network"] == "btc-testnet"
        assert data["address_count"] == 50
        print(f"Wallet status: initialized={data['initialized']}, network={data['network']}, addresses={data['address_count']}")
    
    def test_wallet_status_requires_auth(self):
        """Wallet status should require admin authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/status")
        assert response.status_code in [401, 403]


class TestAdminWalletAddresses:
    """Test /api/admin/wallet/addresses endpoint"""
    
    def test_addresses_returns_50_addresses(self, auth_headers):
        """Should return 50 addresses in the pool"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "addresses" in data
        assert len(data["addresses"]) == 50
        print(f"Address pool contains {len(data['addresses'])} addresses")
    
    def test_addresses_have_correct_structure(self, auth_headers):
        """Each address should have required fields"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses", headers=auth_headers)
        assert response.status_code == 200
        addresses = response.json()["addresses"]
        
        # Check first address (treasury)
        first = addresses[0]
        assert "address" in first
        assert "index" in first
        assert "label" in first
        assert "source" in first
        assert "used" in first
        assert "created_at" in first
        
        # First address should be treasury
        assert first["source"] == "treasury_env"
        assert first["label"] == "Treasury (imported)"
        assert first["index"] == 0
        print(f"First address: {first['address'][:20]}... (treasury)")
    
    def test_addresses_sorted_by_index(self, auth_headers):
        """Addresses should be sorted by index"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses", headers=auth_headers)
        addresses = response.json()["addresses"]
        indices = [a["index"] for a in addresses]
        assert indices == sorted(indices)
    
    def test_addresses_requires_auth(self):
        """Addresses endpoint should require admin authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses")
        assert response.status_code in [401, 403]


class TestAdminWalletUnlock:
    """Test /api/admin/wallet/unlock endpoint"""
    
    def test_unlock_with_correct_password(self, auth_headers):
        """Unlock should succeed with correct password"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/unlock",
            headers=auth_headers,
            json={"password": WALLET_PASSWORD}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert "session_id" in data
        assert data["key_count"] == 50
        print(f"Wallet unlocked: session_id={data['session_id'][:16]}..., key_count={data['key_count']}")
    
    def test_unlock_with_wrong_password(self, auth_headers):
        """Unlock should fail with wrong password"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/unlock",
            headers=auth_headers,
            json={"password": "wrongpassword123"}
        )
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert "password" in data["detail"].lower() or "decrypt" in data["detail"].lower()
    
    def test_unlock_requires_auth(self):
        """Unlock endpoint should require admin authentication"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/unlock",
            json={"password": WALLET_PASSWORD}
        )
        assert response.status_code in [401, 403]


class TestAdminWalletBalance:
    """Test /api/admin/wallet/balance endpoint"""
    
    def test_balance_returns_structure(self, auth_headers):
        """Balance should return total_sats, total_btc, address_balances"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/balance", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "total_sats" in data
        assert "total_btc" in data
        assert "address_balances" in data
        assert isinstance(data["total_sats"], int)
        assert isinstance(data["address_balances"], list)
        print(f"Wallet balance: {data['total_btc']} BTC ({data['total_sats']} sats)")
    
    def test_balance_requires_auth(self):
        """Balance endpoint should require admin authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/balance")
        assert response.status_code in [401, 403]


class TestAdminWalletHistory:
    """Test /api/admin/wallet/history endpoint"""
    
    def test_history_returns_transactions(self, auth_headers):
        """History should return transactions list"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/history", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "transactions" in data
        assert "count" in data
        assert isinstance(data["transactions"], list)
        print(f"Wallet history: {data['count']} transactions")
    
    def test_history_requires_auth(self):
        """History endpoint should require admin authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/history")
        assert response.status_code in [401, 403]


class TestAdminWalletNextAddress:
    """Test /api/admin/wallet/next-address endpoint"""
    
    def test_next_address_returns_unused(self, auth_headers):
        """Should return the next unused address"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/next-address", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert data["used"] == False
        print(f"Next unused address: {data['address'][:20]}... (index {data['index']})")
    
    def test_next_address_requires_auth(self):
        """Next address endpoint should require admin authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/next-address")
        assert response.status_code in [401, 403]


class TestObjEtchEndpoint:
    """Test /api/etch/broadcast-obj-etch endpoint (P2FK OBJ format)"""
    
    def test_obj_etch_with_ipfs_cid(self):
        """OBJ etch should work with provided IPFS CID (uses treasury WIF as fallback)"""
        response = requests.post(
            f"{BASE_URL}/api/etch/broadcast-obj-etch",
            json={
                "project_name": "TEST_iter166_project",
                "urn": "test-iter166-urn",
                "name": "Test OBJ Etch Iter166",
                "description": "Testing OBJ etch endpoint for iteration 166",
                "keywords": ["test", "iter166"],
                "network": "btc-testnet",
                "ipfs_dir_cid": "QmTestIter166CID"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert "txid" in data
        assert "object_address" in data
        assert "sender" in data
        assert "ipfs_cid" in data
        assert "bitfossil_url" in data
        assert "mempool_url" in data
        assert "num_outputs" in data
        assert "dust_cost_sats" in data
        assert "obj_json" in data
        
        # Verify OBJ JSON structure
        import json
        obj = json.loads(data["obj_json"])
        assert obj["urn"] == "test-iter166-urn"
        assert obj["nme"] == "Test OBJ Etch Iter166"
        assert "cre" in obj
        assert "own" in obj
        
        print(f"OBJ Etch success: txid={data['txid'][:20]}..., outputs={data['num_outputs']}, cost={data['dust_cost_sats']} sats")
    
    def test_obj_etch_requires_ipfs_cid(self):
        """OBJ etch should fail without IPFS CID or files"""
        response = requests.post(
            f"{BASE_URL}/api/etch/broadcast-obj-etch",
            json={
                "project_name": "TEST_no_cid",
                "urn": "test-no-cid",
                "name": "Test No CID",
                "network": "btc-testnet"
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "IPFS" in data["detail"] or "CID" in data["detail"]
    
    def test_obj_etch_requires_urn(self):
        """OBJ etch should require URN field"""
        response = requests.post(
            f"{BASE_URL}/api/etch/broadcast-obj-etch",
            json={
                "project_name": "TEST_no_urn",
                "name": "Test No URN",
                "network": "btc-testnet",
                "ipfs_dir_cid": "QmTestNoUrn"
            }
        )
        # Should fail validation (422) or return error
        assert response.status_code in [400, 422]


class TestWalletInit:
    """Test /api/admin/wallet/init endpoint (wallet already initialized)"""
    
    def test_init_fails_when_already_initialized(self, auth_headers):
        """Init should fail if wallet already exists"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/init",
            headers=auth_headers,
            json={
                "password": "newpassword123",
                "network": "btc-testnet",
                "import_treasury": True
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "already" in data["detail"].lower()
        print(f"Init correctly rejected: {data['detail']}")


class TestWalletImportKey:
    """Test /api/admin/wallet/import-key endpoint"""
    
    def test_import_key_requires_valid_wif(self, auth_headers):
        """Import should reject invalid WIF"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-key",
            headers=auth_headers,
            json={
                "wif": "invalid_wif_key",
                "label": "Test Import",
                "password": WALLET_PASSWORD
            }
        )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "invalid" in data["detail"].lower() or "wif" in data["detail"].lower()
    
    def test_import_key_requires_correct_password(self, auth_headers):
        """Import should require correct wallet password"""
        # Generate a fresh valid testnet WIF using bit library
        from bit import PrivateKeyTestnet
        fresh_key = PrivateKeyTestnet()
        valid_wif = fresh_key.to_wif()
        
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-key",
            headers=auth_headers,
            json={
                "wif": valid_wif,
                "label": "Test Import",
                "password": "wrongpassword"
            }
        )
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert "password" in data["detail"].lower()
    
    def test_import_key_requires_auth(self):
        """Import key endpoint should require admin authentication"""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-key",
            json={
                "wif": "cVpF924EFAy2JakbkCPqBJ8Ysy6WnPpzCHboCqr4shEAPs7XxMNU",
                "label": "Test",
                "password": WALLET_PASSWORD
            }
        )
        assert response.status_code in [401, 403]


class TestWalletLabelUpdate:
    """Test /api/admin/wallet/addresses/{address}/label endpoint"""
    
    def test_update_label(self, auth_headers):
        """Should be able to update address label"""
        # First get an address
        addr_response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses", headers=auth_headers)
        addresses = addr_response.json()["addresses"]
        test_addr = addresses[1]["address"]  # Use second address (not treasury)
        
        # Update label
        response = requests.put(
            f"{BASE_URL}/api/admin/wallet/addresses/{test_addr}/label",
            headers=auth_headers,
            json={"label": "TEST_label_iter166"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        print(f"Label updated for {test_addr[:20]}...")
    
    def test_update_label_nonexistent_address(self, auth_headers):
        """Should return 404 for non-existent address"""
        response = requests.put(
            f"{BASE_URL}/api/admin/wallet/addresses/nonexistent123/label",
            headers=auth_headers,
            json={"label": "Test"}
        )
        assert response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
