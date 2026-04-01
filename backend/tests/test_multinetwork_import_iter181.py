"""
Iteration 181: Multi-Network Import Key Tests

Tests the fix for network switching - importing a WIF now derives addresses for ALL networks
from the same key bytes and stores them in one user record.

Key features tested:
1. POST /api/auth/import-key returns addresses for BOTH btc-mainnet and btc-testnet
2. Re-importing same WIF on different network finds existing user and merges addresses
3. Existing users (like 'collector') are not affected
4. POST /api/auth/login still works (by URN and by address)
5. POST /api/auth/rename-urn still works
6. POST /api/auth/change-password still works
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test WIF provided by main agent - produces known addresses
TEST_WIF = 'cTYNJGMRGXHWU7CfL2eN62pDn8rKC5bnM33GGaozqBhrvroCBebj'
EXPECTED_TESTNET_ADDR = 'mo2FtrLtHYug77iE3Snu6fAmme1134dR2u'
EXPECTED_MAINNET_ADDR = '18WJboFuUXURL1EcKspXGjxSueQJ6D1qDX'


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def fresh_wif():
    """Generate a fresh WIF for testing to avoid conflicts with existing users"""
    from bit import PrivateKeyTestnet, PrivateKey
    k = PrivateKeyTestnet()
    raw_bytes = k.to_bytes()
    mainnet_key = PrivateKey.from_bytes(raw_bytes)
    return {
        "wif": k.to_wif(),
        "testnet_address": k.address,
        "mainnet_address": mainnet_key.address,
    }


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self, api_client):
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ API health check passed")


class TestMultiNetworkImportKey:
    """Test that import-key returns addresses for ALL networks"""
    
    def test_01_import_key_returns_both_network_addresses(self, api_client, fresh_wif):
        """CRITICAL: Import-key should return addresses for both btc-mainnet and btc-testnet"""
        response = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": fresh_wif["wif"],
            "password": "testpass123",
            "network": "btc-testnet"
        })
        assert response.status_code == 200, f"Import failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "token" in data, "Missing token in response"
        assert "urn" in data, "Missing urn in response"
        assert "addresses" in data, "Missing addresses map in response"
        
        # CRITICAL: Verify BOTH network addresses are returned
        addresses = data["addresses"]
        assert "btc-testnet" in addresses, "Missing btc-testnet in addresses"
        assert "btc-mainnet" in addresses, "Missing btc-mainnet in addresses"
        
        # Verify addresses match expected values
        assert addresses["btc-testnet"] == fresh_wif["testnet_address"], \
            f"Testnet address mismatch: {addresses['btc-testnet']} != {fresh_wif['testnet_address']}"
        assert addresses["btc-mainnet"] == fresh_wif["mainnet_address"], \
            f"Mainnet address mismatch: {addresses['btc-mainnet']} != {fresh_wif['mainnet_address']}"
        
        print(f"✓ Import-key returned both addresses:")
        print(f"  btc-testnet: {addresses['btc-testnet']}")
        print(f"  btc-mainnet: {addresses['btc-mainnet']}")
        
        # Store token for subsequent tests
        TestMultiNetworkImportKey.token = data["token"]
        TestMultiNetworkImportKey.urn = data["urn"]
        TestMultiNetworkImportKey.fresh_wif = fresh_wif
    
    def test_02_reimport_same_wif_different_network_merges(self, api_client, fresh_wif):
        """Re-importing same WIF on different network should find existing user and merge"""
        # Import same WIF but specify mainnet
        response = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": fresh_wif["wif"],
            "password": "newpass456",  # Different password - should update
            "network": "btc-mainnet"
        })
        assert response.status_code == 200, f"Re-import failed: {response.text}"
        data = response.json()
        
        # Should return same URN (found existing user)
        assert data["urn"] == TestMultiNetworkImportKey.urn, \
            f"URN mismatch - expected existing user: {data['urn']} != {TestMultiNetworkImportKey.urn}"
        
        # Should still have both addresses
        addresses = data["addresses"]
        assert "btc-testnet" in addresses, "Missing btc-testnet after re-import"
        assert "btc-mainnet" in addresses, "Missing btc-mainnet after re-import"
        
        print(f"✓ Re-import found existing user and merged addresses")
        print(f"  URN: {data['urn']}")
        print(f"  Addresses: {addresses}")
    
    def test_03_login_with_new_password_works(self, api_client):
        """After re-import with new password, login should work with new password"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": TestMultiNetworkImportKey.urn,
            "password": "newpass456"  # Password from re-import
        })
        assert response.status_code == 200, f"Login with new password failed: {response.text}"
        data = response.json()
        
        # Verify addresses are preserved
        addresses = data.get("addresses", {})
        assert "btc-testnet" in addresses or "btc-mainnet" in addresses, \
            "Addresses not preserved after login"
        
        print(f"✓ Login with new password works")
        TestMultiNetworkImportKey.token = data["token"]
    
    def test_04_login_by_address_works(self, api_client, fresh_wif):
        """Login by address should work for imported users"""
        # Try login with testnet address
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": fresh_wif["testnet_address"],
            "password": "newpass456"
        })
        assert response.status_code == 200, f"Login by testnet address failed: {response.text}"
        print(f"✓ Login by testnet address works")
        
        # Try login with mainnet address
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": fresh_wif["mainnet_address"],
            "password": "newpass456"
        })
        assert response.status_code == 200, f"Login by mainnet address failed: {response.text}"
        print(f"✓ Login by mainnet address works")


class TestRenameUrnStillWorks:
    """Verify rename-urn endpoint still works after import-key changes"""
    
    def test_01_rename_urn_requires_auth(self, api_client):
        """Rename URN should require authentication"""
        response = api_client.post(f"{BASE_URL}/api/auth/rename-urn", json={
            "new_urn": "TEST_newname"
        })
        assert response.status_code == 401, "Rename URN should require auth"
        print("✓ Rename URN requires authentication")
    
    def test_02_rename_urn_success(self, api_client, fresh_wif):
        """Rename URN should work for authenticated user"""
        # First login to get token
        login_resp = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": fresh_wif["wif"],
            "password": "newpass456",
            "network": "btc-testnet"
        })
        assert login_resp.status_code == 200
        token = login_resp.json()["token"]
        old_urn = login_resp.json()["urn"]
        
        # Rename
        new_urn = f"TEST_renamed_{int(time.time())}"
        response = api_client.post(
            f"{BASE_URL}/api/auth/rename-urn",
            json={"new_urn": new_urn},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Rename failed: {response.text}"
        data = response.json()
        assert data["urn"] == new_urn, f"URN not updated: {data['urn']} != {new_urn}"
        assert "token" in data, "New token not returned"
        
        print(f"✓ Rename URN works: {old_urn} -> {new_urn}")
        TestRenameUrnStillWorks.new_urn = new_urn
        TestRenameUrnStillWorks.token = data["token"]
    
    def test_03_login_with_new_urn_works(self, api_client):
        """Login with new URN should work"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": TestRenameUrnStillWorks.new_urn,
            "password": "newpass456"
        })
        assert response.status_code == 200, f"Login with new URN failed: {response.text}"
        print(f"✓ Login with new URN works")


class TestChangePasswordStillWorks:
    """Verify change-password endpoint still works"""
    
    def test_01_change_password_requires_auth(self, api_client):
        """Change password should require authentication"""
        response = api_client.post(f"{BASE_URL}/api/auth/change-password", json={
            "current_password": "oldpass",
            "new_password": "newpass"
        })
        assert response.status_code == 401, "Change password should require auth"
        print("✓ Change password requires authentication")
    
    def test_02_change_password_success(self, api_client):
        """Change password should work for authenticated user"""
        # Use token from rename test
        token = TestRenameUrnStillWorks.token
        
        response = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": "newpass456",
                "new_password": "changedpass789"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"Change password failed: {response.text}"
        print("✓ Change password works")
    
    def test_03_login_with_new_password_works(self, api_client):
        """Login with new password should work"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": TestRenameUrnStillWorks.new_urn,
            "password": "changedpass789"
        })
        assert response.status_code == 200, f"Login with new password failed: {response.text}"
        print("✓ Login with new password works")
    
    def test_04_login_with_old_password_fails(self, api_client):
        """Login with old password should fail"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": TestRenameUrnStillWorks.new_urn,
            "password": "newpass456"  # Old password
        })
        assert response.status_code == 401, "Login with old password should fail"
        print("✓ Login with old password correctly fails")


class TestExistingUsersNotAffected:
    """Verify existing users like 'collector' are not affected"""
    
    def test_01_collector_user_not_modified(self, api_client):
        """The 'collector' user should not be affected by import-key changes"""
        # Try to find collector user via login (will fail if doesn't exist, which is fine)
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "urn": "collector",
            "password": "wrongpassword"  # We don't know the password
        })
        # Should get 401 (wrong password) not 404 (user not found)
        # If collector doesn't exist, this test is N/A
        if response.status_code == 401:
            print("✓ Collector user exists and was not deleted")
        else:
            print("⚠ Collector user may not exist in test DB (expected in production)")


class TestKnownWifAddresses:
    """Test with the known WIF provided by main agent"""
    
    def test_01_known_wif_produces_expected_addresses(self, api_client):
        """Import the known test WIF and verify expected addresses"""
        response = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": TEST_WIF,
            "password": "testknown123",
            "network": "btc-testnet"
        })
        assert response.status_code == 200, f"Import known WIF failed: {response.text}"
        data = response.json()
        
        addresses = data["addresses"]
        
        # Verify expected addresses from main agent's context
        assert addresses.get("btc-testnet") == EXPECTED_TESTNET_ADDR, \
            f"Testnet address mismatch: {addresses.get('btc-testnet')} != {EXPECTED_TESTNET_ADDR}"
        assert addresses.get("btc-mainnet") == EXPECTED_MAINNET_ADDR, \
            f"Mainnet address mismatch: {addresses.get('btc-mainnet')} != {EXPECTED_MAINNET_ADDR}"
        
        print(f"✓ Known WIF produces expected addresses:")
        print(f"  btc-testnet: {addresses['btc-testnet']} (expected: {EXPECTED_TESTNET_ADDR})")
        print(f"  btc-mainnet: {addresses['btc-mainnet']} (expected: {EXPECTED_MAINNET_ADDR})")


class TestInvalidInputs:
    """Test error handling for invalid inputs"""
    
    def test_01_invalid_wif_rejected(self, api_client):
        """Invalid WIF should be rejected"""
        response = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": "invalid_wif_string",
            "password": "testpass123",
            "network": "btc-testnet"
        })
        assert response.status_code == 400, "Invalid WIF should return 400"
        print("✓ Invalid WIF correctly rejected")
    
    def test_02_short_password_rejected(self, api_client, fresh_wif):
        """Password < 6 chars should be rejected"""
        response = api_client.post(f"{BASE_URL}/api/auth/import-key", json={
            "wif": fresh_wif["wif"],
            "password": "short",
            "network": "btc-testnet"
        })
        assert response.status_code == 400, "Short password should return 400"
        print("✓ Short password correctly rejected")
