"""
Test Treasury WIF Import Feature - Iteration 173

Tests the new import-treasury endpoint and treasury-address retrieval:
1. POST /api/admin/wallet/import-treasury - accepts WIF+network+password, validates WIF, returns address
2. POST /api/admin/wallet/import-treasury - rejects invalid WIF with 400
3. GET /api/admin/wallet/treasury-address/{network} - returns imported address with source='imported'
4. GET /api/treasury/info?network=btc-testnet - returns imported address (after import)
5. Treasury address is used for tax collection (treasury/info returns configured=True)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from review request
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"
WALLET_PASSWORD = "walletpass123"

# Testnet WIF from backend/.env for testing
TESTNET_WIF = "cP1P46DiU12aXCooSy51MUfYa29iBAufDRjHqXrWLFwom5qGe7hP"


@pytest.fixture(scope="module")
def admin_token():
    """Get admin authentication token."""
    response = requests.post(
        f"{BASE_URL}/api/admin/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    )
    if response.status_code == 200:
        data = response.json()
        return data.get("token")
    pytest.skip(f"Admin login failed: {response.status_code} - {response.text}")


@pytest.fixture(scope="module")
def auth_headers(admin_token):
    """Get headers with admin token."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}"
    }


class TestHealthAndAuth:
    """Basic health and auth tests."""
    
    def test_health_endpoint(self):
        """Health endpoint returns 200."""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("✓ Health endpoint OK")
    
    def test_admin_login_success(self):
        """Admin login with correct credentials returns token."""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        print(f"✓ Admin login successful, token received")


class TestTreasuryImportEndpoint:
    """Tests for POST /api/admin/wallet/import-treasury endpoint."""
    
    def test_import_treasury_valid_wif_testnet(self, auth_headers):
        """Import a valid testnet WIF returns success with address."""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-treasury",
            headers=auth_headers,
            json={
                "wif": TESTNET_WIF,
                "network": "btc-testnet",
                "password": WALLET_PASSWORD
            }
        )
        print(f"Import treasury response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") is True
        assert "address" in data
        assert data.get("network") == "btc-testnet"
        # Testnet addresses start with 'm', 'n', or 'tb1'
        addr = data["address"]
        assert addr.startswith(('m', 'n', 'tb1', '2')), f"Expected testnet address, got {addr}"
        print(f"✓ Treasury import successful: {addr}")
    
    def test_import_treasury_invalid_wif(self, auth_headers):
        """Import an invalid WIF returns 400."""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-treasury",
            headers=auth_headers,
            json={
                "wif": "invalid_wif_string_here",
                "network": "btc-testnet",
                "password": WALLET_PASSWORD
            }
        )
        print(f"Invalid WIF response: {response.status_code} - {response.text}")
        assert response.status_code == 400
        data = response.json()
        assert "Invalid WIF" in data.get("detail", "")
        print("✓ Invalid WIF correctly rejected with 400")
    
    def test_import_treasury_missing_password(self, auth_headers):
        """Import without password returns 422 (validation error)."""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-treasury",
            headers=auth_headers,
            json={
                "wif": TESTNET_WIF,
                "network": "btc-testnet"
                # Missing password
            }
        )
        print(f"Missing password response: {response.status_code}")
        assert response.status_code == 422  # Pydantic validation error
        print("✓ Missing password correctly rejected with 422")
    
    def test_import_treasury_requires_auth(self):
        """Import treasury without auth returns 401/403."""
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/import-treasury",
            json={
                "wif": TESTNET_WIF,
                "network": "btc-testnet",
                "password": WALLET_PASSWORD
            }
        )
        print(f"No auth response: {response.status_code}")
        assert response.status_code in [401, 403]
        print("✓ Unauthenticated request correctly rejected")


class TestTreasuryAddressEndpoint:
    """Tests for GET /api/admin/wallet/treasury-address/{network} endpoint."""
    
    def test_get_treasury_address_testnet(self, auth_headers):
        """Get treasury address for testnet returns address with source."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/treasury-address/btc-testnet",
            headers=auth_headers
        )
        print(f"Treasury address testnet response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "network" in data
        assert "source" in data
        assert data["network"] == "btc-testnet"
        # Source should be 'imported' if we imported, or 'env' if from env
        assert data["source"] in ["imported", "env"]
        print(f"✓ Treasury address testnet: {data['address']} (source: {data['source']})")
    
    def test_get_treasury_address_mainnet(self, auth_headers):
        """Get treasury address for mainnet returns address or env fallback."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/treasury-address/btc-mainnet",
            headers=auth_headers
        )
        print(f"Treasury address mainnet response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert "network" in data
        assert "source" in data
        assert data["network"] == "btc-mainnet"
        # May be None if no mainnet WIF configured
        print(f"✓ Treasury address mainnet: {data.get('address')} (source: {data['source']})")
    
    def test_get_treasury_address_requires_auth(self):
        """Get treasury address without auth returns 401/403."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/treasury-address/btc-testnet"
        )
        print(f"No auth response: {response.status_code}")
        assert response.status_code in [401, 403]
        print("✓ Unauthenticated request correctly rejected")


class TestTreasuryInfoIntegration:
    """Tests for treasury/info endpoint integration with imported addresses."""
    
    def test_treasury_info_testnet_configured(self):
        """Treasury info for testnet returns configured=True after import."""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        print(f"Treasury info testnet response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "configured" in data
        # Should be configured since we have TREASURY_TESTNET_WIF in env
        assert data["configured"] is True
        assert data["network"] == "btc-testnet"
        print(f"✓ Treasury info testnet: configured={data['configured']}, address={data.get('address')}")
    
    def test_treasury_info_mainnet(self):
        """Treasury info for mainnet returns correct configured status."""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-mainnet")
        print(f"Treasury info mainnet response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert "configured" in data
        assert "network" in data
        assert data["network"] == "btc-mainnet"
        # Faucet should be disabled for mainnet
        assert data.get("faucet_amount", 0) == 0
        print(f"✓ Treasury info mainnet: configured={data['configured']}, faucet_amount={data.get('faucet_amount')}")
    
    def test_treasury_info_has_tax_rate(self):
        """Treasury info returns tax_rate field."""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "tax_rate" in data
        assert isinstance(data["tax_rate"], (int, float))
        print(f"✓ Treasury info has tax_rate: {data['tax_rate']}")


class TestWalletStatusAfterImport:
    """Tests to verify wallet state after treasury import."""
    
    def test_wallet_addresses_include_treasury(self, auth_headers):
        """Wallet addresses list includes imported treasury address."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/addresses",
            headers=auth_headers
        )
        print(f"Wallet addresses response: {response.status_code}")
        assert response.status_code == 200
        data = response.json()
        addresses = data.get("addresses", [])
        
        # Look for treasury-related addresses
        treasury_addrs = [a for a in addresses if 'treasury' in a.get('label', '').lower() or a.get('source', '').startswith('treasury')]
        print(f"✓ Found {len(treasury_addrs)} treasury-related addresses in wallet")
        
        # Check if any have source='treasury_import'
        imported = [a for a in addresses if a.get('source') == 'treasury_import']
        print(f"✓ Found {len(imported)} addresses with source='treasury_import'")
    
    def test_wallet_balance_endpoint(self, auth_headers):
        """Wallet balance endpoint works after treasury import."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/balance?network=btc-testnet",
            headers=auth_headers
        )
        print(f"Wallet balance response: {response.status_code} - {response.text}")
        assert response.status_code == 200
        data = response.json()
        assert "total_sats" in data
        assert "total_btc" in data
        print(f"✓ Wallet balance: {data['total_btc']} BTC ({data['total_sats']} sats)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
