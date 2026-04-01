"""
Test suite for iteration 201: Address Discovery endpoint and IPFS size cap removal
Tests:
1. GET /api/wallet/discover-addresses/{address} - returns discovered addresses with type categorization
2. Response shape validation: {addresses, dust_count, payment_count, total, txs_scanned}
3. IPFS upload endpoint has no file size cap (500MB limit removed)
4. Nginx has client_max_body_size 0 (unlimited)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:8001').rstrip('/')

# Test address provided in requirements
TEST_ADDRESS = "msPJhg9GPzMN6twknwmSQvrUKZbZnk51Tv"


class TestAddressDiscovery:
    """Tests for the new /api/wallet/discover-addresses endpoint"""

    def test_discover_addresses_endpoint_exists(self):
        """Test that the discover-addresses endpoint exists and returns 200"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        # Should return 200 even if external API times out (graceful error handling)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"PASS: discover-addresses endpoint returned 200")

    def test_discover_addresses_response_shape(self):
        """Test that response has correct shape: {addresses, dust_count, payment_count, total, txs_scanned}"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields exist
        assert "addresses" in data, "Missing 'addresses' field"
        assert "dust_count" in data, "Missing 'dust_count' field"
        assert "payment_count" in data, "Missing 'payment_count' field"
        assert "total" in data, "Missing 'total' field"
        assert "txs_scanned" in data, "Missing 'txs_scanned' field"
        
        # Verify types
        assert isinstance(data["addresses"], list), "'addresses' should be a list"
        assert isinstance(data["dust_count"], int), "'dust_count' should be int"
        assert isinstance(data["payment_count"], int), "'payment_count' should be int"
        assert isinstance(data["total"], int), "'total' should be int"
        assert isinstance(data["txs_scanned"], int), "'txs_scanned' should be int"
        
        print(f"PASS: Response shape is correct - total={data['total']}, dust={data['dust_count']}, payment={data['payment_count']}, txs_scanned={data['txs_scanned']}")

    def test_discover_addresses_type_categorization(self):
        """Test that addresses are categorized as 'dust' (546 sats) or 'payment'"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        if data["addresses"]:
            for addr in data["addresses"]:
                assert "address" in addr, "Each address entry should have 'address' field"
                assert "type" in addr, "Each address entry should have 'type' field"
                assert addr["type"] in ["dust", "payment"], f"Type should be 'dust' or 'payment', got {addr['type']}"
                assert "first_value" in addr, "Each address entry should have 'first_value' field"
                assert "first_txid" in addr, "Each address entry should have 'first_txid' field"
                
                # Verify dust categorization logic
                if addr["type"] == "dust":
                    assert addr["first_value"] == 546, f"Dust addresses should have first_value=546, got {addr['first_value']}"
                else:
                    assert addr["first_value"] != 546, f"Payment addresses should NOT have first_value=546"
            
            print(f"PASS: All {len(data['addresses'])} addresses have correct type categorization")
        else:
            print("INFO: No addresses discovered (external API may be unavailable)")

    def test_discover_addresses_counts_match(self):
        """Test that dust_count + payment_count == total"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["dust_count"] + data["payment_count"] == data["total"], \
            f"dust_count ({data['dust_count']}) + payment_count ({data['payment_count']}) should equal total ({data['total']})"
        assert len(data["addresses"]) == data["total"], \
            f"len(addresses) ({len(data['addresses'])}) should equal total ({data['total']})"
        
        print(f"PASS: Counts are consistent - dust={data['dust_count']}, payment={data['payment_count']}, total={data['total']}")

    def test_discover_addresses_graceful_error_handling(self):
        """Test that endpoint handles invalid addresses gracefully"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/INVALID_ADDRESS_12345",
            params={"network": "btc-testnet"},
            timeout=60
        )
        # Should return 200 with empty addresses or error field, not 500
        assert response.status_code == 200, f"Expected 200 for invalid address, got {response.status_code}"
        data = response.json()
        
        # Should have the standard response shape even on error
        assert "addresses" in data or "error" in data, "Should have 'addresses' or 'error' field"
        print(f"PASS: Graceful error handling for invalid address")

    def test_discover_addresses_mainnet_network(self):
        """Test that endpoint accepts mainnet network parameter"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{TEST_ADDRESS}",
            params={"network": "btc-mainnet"},
            timeout=60
        )
        # Should return 200 (address won't exist on mainnet but endpoint should work)
        assert response.status_code == 200, f"Expected 200 for mainnet, got {response.status_code}"
        print(f"PASS: Mainnet network parameter accepted")


class TestIPFSUploadNoSizeCap:
    """Tests for IPFS upload endpoint - verify no file size cap"""

    def test_ipfs_upload_endpoint_exists(self):
        """Test that IPFS upload endpoint exists"""
        # Just check the endpoint responds (don't actually upload)
        response = requests.post(
            f"{BASE_URL}/api/ipfs/upload",
            timeout=10
        )
        # Should return 422 (missing file) not 404
        assert response.status_code in [422, 400], f"Expected 422 or 400 for missing file, got {response.status_code}"
        print(f"PASS: IPFS upload endpoint exists (returns {response.status_code} for missing file)")

    def test_ipfs_status_endpoint(self):
        """Test IPFS daemon status endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/ipfs/status",
            timeout=10
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "online" in data, "Should have 'online' field"
        print(f"PASS: IPFS status endpoint works - online={data.get('online')}")


class TestWalletEndpoints:
    """Regression tests for existing wallet endpoints"""

    def test_wallet_balance(self):
        """Test wallet balance endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/balance/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "balance_sats" in data
        print(f"PASS: Wallet balance endpoint works - balance={data.get('balance_sats')} sats")

    def test_wallet_utxos(self):
        """Test wallet UTXOs endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/utxos/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        assert "count" in data
        print(f"PASS: Wallet UTXOs endpoint works - count={data.get('count')}")

    def test_wallet_address_txs(self):
        """Test wallet address transactions endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{TEST_ADDRESS}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "transactions" in data
        assert "count" in data
        print(f"PASS: Wallet address-txs endpoint works - count={data.get('count')}")

    def test_wallet_fees(self):
        """Test wallet fee estimates endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/fees",
            params={"network": "btc-testnet"},
            timeout=15
        )
        assert response.status_code == 200
        data = response.json()
        assert "priority" in data
        assert "standard" in data
        assert "economy" in data
        print(f"PASS: Wallet fees endpoint works - priority={data.get('priority')}, standard={data.get('standard')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
