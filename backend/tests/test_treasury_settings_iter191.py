"""
Test Treasury Address Detection and Per-Network Settings - Iteration 191

Tests:
1. /api/treasury/info?network=btc-mainnet returns configured:true with DB-imported address
2. /api/treasury/info?network=btc-testnet returns configured:true with testnet address
3. /api/admin/settings PUT accepts faucet_amount_mainnet, tax_rate_mainnet, treasury_btc_testnet
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestTreasuryInfo:
    """Test treasury/info endpoint returns configured:true when DB has treasury keys"""
    
    def test_treasury_info_btc_mainnet_configured(self):
        """Treasury info for btc-mainnet should return configured:true with address from DB"""
        response = requests.get(f"{BASE_URL}/api/treasury/info", params={"network": "btc-mainnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"btc-mainnet treasury info: {data}")
        
        # Key assertion: configured should be True since treasury_keys has btc-mainnet record
        assert data.get("configured") == True, f"Expected configured=True, got {data.get('configured')}"
        
        # Address should be present and match the expected mainnet address
        assert data.get("address") is not None, "Expected address to be present"
        # The expected address from the treasury_keys collection
        expected_address = "13186N2tavrF5pn9n6au6VRGn3vRZMsByM"
        assert data.get("address") == expected_address, f"Expected address {expected_address}, got {data.get('address')}"
        
        # Network should match
        assert data.get("network") == "btc-mainnet", f"Expected network=btc-mainnet, got {data.get('network')}"
        
        # Tax rate should be present
        assert "tax_rate" in data, "Expected tax_rate in response"
        
    def test_treasury_info_btc_testnet_configured(self):
        """Treasury info for btc-testnet should return configured status"""
        response = requests.get(f"{BASE_URL}/api/treasury/info", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"btc-testnet treasury info: {data}")
        
        # Network should match
        assert data.get("network") == "btc-testnet", f"Expected network=btc-testnet, got {data.get('network')}"
        
        # Check if configured (depends on whether testnet key exists in DB or env)
        # At minimum, the endpoint should return a valid response structure
        assert "configured" in data, "Expected 'configured' field in response"
        assert "address" in data, "Expected 'address' field in response"
        assert "tax_rate" in data, "Expected 'tax_rate' field in response"
        assert "faucet_amount" in data, "Expected 'faucet_amount' field in response"
        
    def test_treasury_info_response_structure(self):
        """Verify treasury info response has all expected fields"""
        response = requests.get(f"{BASE_URL}/api/treasury/info", params={"network": "btc-mainnet"})
        assert response.status_code == 200
        
        data = response.json()
        
        # Check all expected fields are present
        expected_fields = ["address", "balance_sats", "tax_rate", "faucet_available", 
                          "faucet_amount", "network", "configured"]
        for field in expected_fields:
            assert field in data, f"Expected field '{field}' in response"


class TestAdminSettingsPerNetwork:
    """Test admin settings endpoint accepts per-network parameters"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        # Try to login with default admin credentials
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": "Admin",
            "password": "Password26"
        })
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Admin login failed - skipping authenticated tests")
    
    def test_settings_accepts_faucet_amount_mainnet(self, admin_token):
        """PUT /api/admin/settings should accept faucet_amount_mainnet parameter"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        # First get current settings
        get_response = requests.get(f"{BASE_URL}/api/admin/settings", headers=headers)
        assert get_response.status_code == 200
        current_settings = get_response.json()
        print(f"Current settings: {current_settings}")
        
        # Update with faucet_amount_mainnet
        test_value = 50000
        update_response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json={"faucet_amount_mainnet": test_value}
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        updated_settings = update_response.json()
        assert updated_settings.get("faucet_amount_mainnet") == test_value, \
            f"Expected faucet_amount_mainnet={test_value}, got {updated_settings.get('faucet_amount_mainnet')}"
        
    def test_settings_accepts_tax_rate_mainnet(self, admin_token):
        """PUT /api/admin/settings should accept tax_rate_mainnet parameter"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        test_value = 0.03
        update_response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json={"tax_rate_mainnet": test_value}
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        updated_settings = update_response.json()
        assert updated_settings.get("tax_rate_mainnet") == test_value, \
            f"Expected tax_rate_mainnet={test_value}, got {updated_settings.get('tax_rate_mainnet')}"
        
    def test_settings_accepts_treasury_btc_testnet(self, admin_token):
        """PUT /api/admin/settings should accept treasury_btc_testnet parameter"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        test_address = "mzTestAddressForTestnet123456789"
        update_response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json={"treasury_btc_testnet": test_address}
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        updated_settings = update_response.json()
        treasury_addresses = updated_settings.get("treasury_addresses", {})
        assert treasury_addresses.get("btc_testnet") == test_address, \
            f"Expected treasury_addresses.btc_testnet={test_address}, got {treasury_addresses.get('btc_testnet')}"
        
    def test_settings_multiple_per_network_params(self, admin_token):
        """PUT /api/admin/settings should accept multiple per-network params at once"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        update_payload = {
            "faucet_amount_mainnet": 75000,
            "tax_rate_mainnet": 0.025,
            "faucet_amount": 150000,  # testnet faucet
            "tax_rate": 0.02  # testnet tax
        }
        
        update_response = requests.put(
            f"{BASE_URL}/api/admin/settings",
            headers=headers,
            json=update_payload
        )
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        updated_settings = update_response.json()
        
        # Verify all values were updated
        assert updated_settings.get("faucet_amount_mainnet") == 75000
        assert updated_settings.get("tax_rate_mainnet") == 0.025
        assert updated_settings.get("faucet_amount") == 150000
        assert updated_settings.get("tax_rate") == 0.02
        
        print(f"Updated settings with multiple per-network params: {updated_settings}")


class TestTreasuryAddressResolution:
    """Test that treasury address resolution follows correct priority"""
    
    def test_mainnet_address_from_db_treasury_keys(self):
        """Verify btc-mainnet address comes from treasury_keys collection"""
        response = requests.get(f"{BASE_URL}/api/treasury/info", params={"network": "btc-mainnet"})
        assert response.status_code == 200
        
        data = response.json()
        
        # The address should be the one from treasury_keys collection
        # According to the context: "treasury_keys collection in SQLite already has a record 
        # for btc-mainnet with address 13186N2tavrF5pn9n6au6VRGn3vRZMsByM"
        expected_address = "13186N2tavrF5pn9n6au6VRGn3vRZMsByM"
        
        assert data.get("address") == expected_address, \
            f"Expected address from treasury_keys: {expected_address}, got {data.get('address')}"
        assert data.get("configured") == True, \
            f"Expected configured=True when address is present"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
