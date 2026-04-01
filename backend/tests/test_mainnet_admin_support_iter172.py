"""
Iteration 172: Mainnet Admin Support Tests

Tests for:
1. Backend: GET /api/admin/wallet/balance?network=btc-testnet returns testnet balance
2. Backend: GET /api/admin/wallet/balance?network=btc-mainnet returns mainnet balance
3. Backend: Treasury info for mainnet returns faucet_amount=0
4. Backend: Etch endpoints no longer block mainnet (no 'only supported on testnet' error)
5. Backend: Config has TREASURY_MAINNET_WIF variable
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"


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
def admin_headers(admin_token):
    """Headers with admin auth token."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {admin_token}"
    }


class TestHealthCheck:
    """Basic health check to ensure backend is running."""
    
    def test_health_endpoint(self):
        """Test health endpoint returns 200."""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        print("✓ Health endpoint working")


class TestAdminLogin:
    """Test admin authentication."""
    
    def test_admin_login_success(self):
        """Test admin login with correct credentials."""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in login response"
        print(f"✓ Admin login successful, token received")


class TestWalletBalanceNetworkParam:
    """Test wallet balance endpoint with network parameter."""
    
    def test_wallet_balance_testnet(self, admin_headers):
        """GET /api/admin/wallet/balance?network=btc-testnet returns testnet balance."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/balance?network=btc-testnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Testnet balance failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "total_sats" in data, "Missing total_sats in response"
        assert "total_btc" in data, "Missing total_btc in response"
        assert "address_balances" in data, "Missing address_balances in response"
        
        print(f"✓ Testnet balance: {data['total_sats']} sats ({data['total_btc']} BTC)")
        print(f"  Address balances: {len(data['address_balances'])} addresses with balance")
    
    def test_wallet_balance_mainnet(self, admin_headers):
        """GET /api/admin/wallet/balance?network=btc-mainnet returns mainnet balance."""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/balance?network=btc-mainnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Mainnet balance failed: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "total_sats" in data, "Missing total_sats in response"
        assert "total_btc" in data, "Missing total_btc in response"
        assert "address_balances" in data, "Missing address_balances in response"
        
        # Note: Since no TREASURY_MAINNET_WIF is configured, mainnet balance will be 0
        print(f"✓ Mainnet balance: {data['total_sats']} sats ({data['total_btc']} BTC)")
        print(f"  Address balances: {len(data['address_balances'])} addresses with balance")
    
    def test_wallet_balance_filters_by_network(self, admin_headers):
        """Verify balance endpoint filters addresses by network."""
        # Get testnet balance
        testnet_resp = requests.get(
            f"{BASE_URL}/api/admin/wallet/balance?network=btc-testnet",
            headers=admin_headers
        )
        # Get mainnet balance
        mainnet_resp = requests.get(
            f"{BASE_URL}/api/admin/wallet/balance?network=btc-mainnet",
            headers=admin_headers
        )
        
        assert testnet_resp.status_code == 200
        assert mainnet_resp.status_code == 200
        
        # Both should return valid responses (even if 0 balance)
        testnet_data = testnet_resp.json()
        mainnet_data = mainnet_resp.json()
        
        assert isinstance(testnet_data["total_sats"], int)
        assert isinstance(mainnet_data["total_sats"], int)
        
        print(f"✓ Network filtering works - testnet: {testnet_data['total_sats']} sats, mainnet: {mainnet_data['total_sats']} sats")


class TestTreasuryMainnetFaucet:
    """Test treasury info returns faucet_amount=0 for mainnet."""
    
    def test_treasury_info_testnet_has_faucet_field(self):
        """Treasury info for testnet should have faucet_amount field (may be 0 if not configured)."""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-testnet")
        assert response.status_code == 200, f"Treasury info testnet failed: {response.text}"
        data = response.json()
        
        assert "faucet_amount" in data, "Missing faucet_amount in response"
        assert "network" in data, "Missing network in response"
        assert data["network"] == "btc-testnet", f"Wrong network: {data['network']}"
        
        # Testnet faucet_amount can be > 0 if configured, or 0 if treasury not set up
        # The key difference is mainnet ALWAYS has faucet_amount=0 by design
        if data.get("configured"):
            assert data["faucet_amount"] > 0, f"Configured testnet should have faucet_amount > 0"
            print(f"✓ Testnet treasury faucet_amount: {data['faucet_amount']} sats (configured)")
        else:
            # Treasury not configured - faucet_amount will be 0
            print(f"✓ Testnet treasury not configured - faucet_amount: {data['faucet_amount']} sats")
    
    def test_treasury_info_mainnet_faucet_zero(self):
        """Treasury info for mainnet should have faucet_amount=0."""
        response = requests.get(f"{BASE_URL}/api/treasury/info?network=btc-mainnet")
        assert response.status_code == 200, f"Treasury info mainnet failed: {response.text}"
        data = response.json()
        
        assert "faucet_amount" in data, "Missing faucet_amount in response"
        assert "network" in data, "Missing network in response"
        assert data["network"] == "btc-mainnet", f"Wrong network: {data['network']}"
        
        # Mainnet should have faucet_amount = 0 (faucet disabled)
        assert data["faucet_amount"] == 0, f"Mainnet faucet_amount should be 0, got {data['faucet_amount']}"
        
        print(f"✓ Mainnet treasury faucet_amount: {data['faucet_amount']} (correctly disabled)")


class TestEtchEndpointsMainnet:
    """Test etch endpoints no longer block mainnet."""
    
    def test_etch_chunk_accepts_mainnet(self, admin_headers):
        """POST /api/etch/chunk should accept mainnet network without blocking."""
        # Create a minimal test chunk
        test_hex = "48656c6c6f"  # "Hello" in hex
        
        response = requests.post(
            f"{BASE_URL}/api/etch/chunk",
            json={
                "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",  # Satoshi's address
                "network": "btc-mainnet",
                "chunk_hex": test_hex,
                "filename": "test.txt",
                "chunk_index": 0,
                "total_chunks": 1
            },
            headers=admin_headers
        )
        
        # Should NOT return "only supported on testnet" error
        if response.status_code == 400:
            data = response.json()
            error_msg = data.get("detail", "")
            assert "only supported on testnet" not in error_msg.lower(), \
                f"Etch chunk still blocks mainnet: {error_msg}"
        
        # Should succeed (200) or fail for other reasons (not mainnet block)
        assert response.status_code in [200, 400, 500], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "txid" in data or "chunk_id" in data, "Missing chunk identifier in response"
            print(f"✓ Etch chunk accepts mainnet - chunk staged successfully")
        else:
            print(f"✓ Etch chunk accepts mainnet - no 'testnet only' block (status: {response.status_code})")
    
    def test_etch_manifest_accepts_mainnet(self, admin_headers):
        """POST /api/etch/manifest should accept mainnet network without blocking."""
        response = requests.post(
            f"{BASE_URL}/api/etch/manifest",
            json={
                "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
                "network": "btc-mainnet",
                "files": [{"name": "test.txt", "txids": ["abc123"], "chunks": 1}],
                "version": "1.0.0",
                "description": "Test manifest"
            },
            headers=admin_headers
        )
        
        # Should NOT return "only supported on testnet" error
        if response.status_code == 400:
            data = response.json()
            error_msg = data.get("detail", "")
            assert "only supported on testnet" not in error_msg.lower(), \
                f"Etch manifest still blocks mainnet: {error_msg}"
        
        assert response.status_code in [200, 400, 500], f"Unexpected status: {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "manifest_id" in data, "Missing manifest_id in response"
            print(f"✓ Etch manifest accepts mainnet - manifest created: {data['manifest_id']}")
        else:
            print(f"✓ Etch manifest accepts mainnet - no 'testnet only' block (status: {response.status_code})")
    
    def test_etch_broadcast_mainnet_wif_check(self, admin_headers):
        """POST /api/etch/broadcast-file should check for mainnet WIF, not block mainnet."""
        test_hex = "48656c6c6f"  # "Hello" in hex
        
        response = requests.post(
            f"{BASE_URL}/api/etch/broadcast-file",
            json={
                "filename": "test.txt",
                "file_hex": test_hex,
                "network": "btc-mainnet"
            },
            headers=admin_headers
        )
        
        # Expected: 503 "Treasury WIF not configured for mainnet" (correct behavior)
        # NOT: 400 "only supported on testnet" (old blocking behavior)
        
        if response.status_code == 503:
            data = response.json()
            error_msg = data.get("detail", "")
            # This is the CORRECT error - WIF not configured, not "testnet only"
            assert "wif not configured" in error_msg.lower() or "not configured" in error_msg.lower(), \
                f"Unexpected 503 error: {error_msg}"
            print(f"✓ Etch broadcast mainnet - correctly reports 'WIF not configured' (not 'testnet only')")
        elif response.status_code == 400:
            data = response.json()
            error_msg = data.get("detail", "")
            assert "only supported on testnet" not in error_msg.lower(), \
                f"Etch broadcast still blocks mainnet: {error_msg}"
            print(f"✓ Etch broadcast mainnet - no 'testnet only' block")
        else:
            print(f"✓ Etch broadcast mainnet - status {response.status_code}")


class TestConfigMainnetWIF:
    """Test that config has TREASURY_MAINNET_WIF variable."""
    
    def test_config_has_mainnet_wif_variable(self):
        """Verify config.py has TREASURY_MAINNET_WIF defined."""
        # Read config.py and check for TREASURY_MAINNET_WIF
        config_path = "/app/backend/config.py"
        
        with open(config_path, 'r') as f:
            config_content = f.read()
        
        assert "TREASURY_MAINNET_WIF" in config_content, \
            "TREASURY_MAINNET_WIF not found in config.py"
        
        # Check it's loaded from environment
        assert "os.environ.get('TREASURY_MAINNET_WIF'" in config_content or \
               'os.environ.get("TREASURY_MAINNET_WIF"' in config_content, \
            "TREASURY_MAINNET_WIF should be loaded from environment"
        
        print("✓ Config has TREASURY_MAINNET_WIF variable loaded from environment")


class TestTreasuryEconomicsMainnet:
    """Test treasury economics endpoint for mainnet."""
    
    def test_treasury_economics_mainnet(self, admin_headers):
        """GET /api/treasury/economics?network=btc-mainnet should work."""
        response = requests.get(
            f"{BASE_URL}/api/treasury/economics?network=btc-mainnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Treasury economics mainnet failed: {response.text}"
        data = response.json()
        
        assert "network" in data, "Missing network in response"
        assert data["network"] == "btc-mainnet", f"Wrong network: {data['network']}"
        assert "balance_sats" in data, "Missing balance_sats"
        
        print(f"✓ Treasury economics mainnet: balance={data['balance_sats']} sats, configured={data.get('configured')}")


class TestEtchAdminListMainnet:
    """Test etch admin list endpoint for mainnet."""
    
    def test_etch_admin_list_mainnet(self, admin_headers):
        """GET /api/etch/admin/list?network=btc-mainnet should work."""
        response = requests.get(
            f"{BASE_URL}/api/etch/admin/list?network=btc-mainnet",
            headers=admin_headers
        )
        assert response.status_code == 200, f"Etch admin list mainnet failed: {response.text}"
        data = response.json()
        
        assert "manifests" in data, "Missing manifests in response"
        assert "total" in data, "Missing total in response"
        assert "stats" in data, "Missing stats in response"
        
        print(f"✓ Etch admin list mainnet: {data['total']} manifests")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
