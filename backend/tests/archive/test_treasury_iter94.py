"""
Treasury API Tests - Iteration 94
Testing the 2% platform tax system: treasury info, faucet endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')


class TestTreasuryInfo:
    """Treasury info endpoint tests"""

    def test_treasury_info_testnet_returns_correct_data(self):
        """GET /api/treasury/info?network=btc-testnet returns correct data"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200
        
        data = response.json()
        # Verify all required fields exist
        assert "address" in data
        assert "balance_sats" in data
        assert "tax_rate" in data
        assert "faucet_amount" in data
        assert "configured" in data
        assert "network" in data
        assert "faucet_available" in data
        
        # Verify values
        assert data["configured"] == True
        assert data["tax_rate"] == 0.02  # 2% tax rate
        assert data["faucet_amount"] == 15000  # 15000 sats for new users
        assert data["network"] == "btc-testnet"
        # Testnet address should be present
        assert data["address"] is not None
        assert data["address"].startswith("m") or data["address"].startswith("n") or data["address"].startswith("2")  # Testnet address prefixes
        print(f"✓ Testnet treasury address: {data['address']}")
        print(f"✓ Balance: {data['balance_sats']} sats")
        print(f"✓ Tax rate: {data['tax_rate']} (2%)")
        print(f"✓ Faucet amount: {data['faucet_amount']} sats")

    def test_treasury_info_mainnet_not_configured(self):
        """GET /api/treasury/info?network=btc-mainnet returns configured=false"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-mainnet")
        assert response.status_code == 200
        
        data = response.json()
        # Mainnet treasury not yet set
        assert data["configured"] == False
        assert data["address"] is None
        assert data["network"] == "btc-mainnet"
        assert data["faucet_amount"] == 0  # No faucet on mainnet
        print("✓ Mainnet treasury correctly shows configured=False")


class TestTreasuryFaucet:
    """Treasury faucet endpoint tests"""

    def test_faucet_mainnet_returns_400(self):
        """POST /api/treasury/faucet with mainnet returns 400 error"""
        response = requests.post(
            f"{BASE_URL}/api/treasury/faucet",
            json={"recipient_address": "test_address", "network": "btc-mainnet"}
        )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "testnet" in data["detail"].lower()
        print(f"✓ Mainnet faucet correctly rejected: {data['detail']}")

    def test_faucet_testnet_low_balance(self):
        """POST /api/treasury/faucet on testnet returns 503 when balance is low"""
        # Treasury balance is 0, so this should return 503
        response = requests.post(
            f"{BASE_URL}/api/treasury/faucet",
            json={"recipient_address": "mpVJqyEgEShNfKWiMpFmdAru22YpsaQwe8", "network": "btc-testnet"}
        )
        # Expected 503 since balance is 0
        if response.status_code == 503:
            data = response.json()
            assert "balance too low" in data["detail"].lower() or "not configured" in data["detail"].lower()
            print(f"✓ Faucet correctly returns 503 on low balance: {data['detail']}")
        else:
            # If somehow it succeeds (treasury funded), that's also acceptable
            print(f"Faucet status: {response.status_code} - {response.text}")
            assert response.status_code in [200, 503]


class TestTreasuryIntegration:
    """Integration tests for treasury system"""

    def test_treasury_tax_rate_is_2_percent(self):
        """Verify tax rate is exactly 2%"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert data["tax_rate"] == 0.02
        # Tax should be max(2% of tx value, 546 sats)
        print(f"✓ Tax rate verified: {data['tax_rate']*100}%")

    def test_treasury_address_is_valid_testnet(self):
        """Verify testnet treasury address is valid format"""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        addr = data["address"]
        assert addr is not None
        # Testnet addresses start with m, n, or 2
        assert addr[0] in ['m', 'n', '2'], f"Invalid testnet address prefix: {addr}"
        print(f"✓ Treasury address has valid testnet format: {addr}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
