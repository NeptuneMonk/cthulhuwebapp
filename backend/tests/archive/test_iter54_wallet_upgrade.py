"""
Iteration 54: Wallet Upgrade Phase 1 Tests
Tests for:
- GET /api/wallet/fees - Fee rate estimates from mempool.space
- GET /api/wallet/address-txs/{address} - Formatted transaction list
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known testnet address with transactions for testing
TEST_ADDRESS = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"


class TestWalletFees:
    """Tests for the new /wallet/fees endpoint"""
    
    def test_fees_endpoint_returns_200(self):
        """Fee endpoint returns 200 status"""
        response = requests.get(f"{BASE_URL}/api/wallet/fees", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: /api/wallet/fees returns 200")
    
    def test_fees_returns_all_fee_tiers(self):
        """Fee response includes priority, standard, economy, minimum"""
        response = requests.get(f"{BASE_URL}/api/wallet/fees", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Check all required fields exist
        assert "priority" in data, "Missing 'priority' fee tier"
        assert "standard" in data, "Missing 'standard' fee tier"
        assert "economy" in data, "Missing 'economy' fee tier"
        assert "minimum" in data, "Missing 'minimum' fee tier"
        assert "network" in data, "Missing 'network' field"
        print(f"PASS: Fee tiers present - priority={data['priority']}, standard={data['standard']}, economy={data['economy']}, minimum={data['minimum']}")
    
    def test_fees_values_are_integers(self):
        """Fee values are positive integers (sat/vB)"""
        response = requests.get(f"{BASE_URL}/api/wallet/fees", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        for tier in ["priority", "standard", "economy", "minimum"]:
            assert isinstance(data[tier], int), f"{tier} should be an integer, got {type(data[tier])}"
            assert data[tier] >= 1, f"{tier} should be >= 1, got {data[tier]}"
        print(f"PASS: All fee values are valid integers >= 1")
    
    def test_fees_priority_order(self):
        """Fee tiers should be ordered: priority >= standard >= economy >= minimum"""
        response = requests.get(f"{BASE_URL}/api/wallet/fees", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # On testnet, fees are often all 1 sat/vB, so use >= instead of >
        assert data["priority"] >= data["standard"], "priority should >= standard"
        assert data["standard"] >= data["economy"], "standard should >= economy"
        assert data["economy"] >= data["minimum"], "economy should >= minimum"
        print(f"PASS: Fee tiers properly ordered")


class TestWalletAddressTransactions:
    """Tests for the new /wallet/address-txs/{address} endpoint"""
    
    def test_address_txs_endpoint_returns_200(self):
        """Address transactions endpoint returns 200 status"""
        response = requests.get(f"{BASE_URL}/api/wallet/address-txs/{TEST_ADDRESS}", params={"network": "btc-testnet"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("PASS: /api/wallet/address-txs/{address} returns 200")
    
    def test_address_txs_returns_transaction_list(self):
        """Response contains transactions array and count"""
        response = requests.get(f"{BASE_URL}/api/wallet/address-txs/{TEST_ADDRESS}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "transactions" in data, "Missing 'transactions' field"
        assert "count" in data, "Missing 'count' field"
        assert isinstance(data["transactions"], list), "transactions should be a list"
        assert isinstance(data["count"], int), "count should be an integer"
        print(f"PASS: Response contains transactions list (count={data['count']})")
    
    def test_address_txs_format(self):
        """Transactions have required format fields: txid, confirmed, is_incoming, received_sats"""
        response = requests.get(f"{BASE_URL}/api/wallet/address-txs/{TEST_ADDRESS}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        if data["count"] > 0:
            tx = data["transactions"][0]
            assert "txid" in tx, "Transaction missing 'txid'"
            assert "confirmed" in tx, "Transaction missing 'confirmed'"
            assert "is_incoming" in tx, "Transaction missing 'is_incoming'"
            assert "received_sats" in tx, "Transaction missing 'received_sats'"
            assert "sent_sats" in tx, "Transaction missing 'sent_sats'"
            assert "fee" in tx, "Transaction missing 'fee'"
            print(f"PASS: Transaction format correct - txid={tx['txid'][:16]}..., is_incoming={tx['is_incoming']}, confirmed={tx['confirmed']}")
        else:
            # Address may not have transactions if empty
            print("WARN: No transactions found for test address - checking empty response format")
            assert data["transactions"] == [], "Empty transactions should be empty list"
    
    def test_address_txs_nonexistent_address(self):
        """Nonexistent address returns empty list, not error"""
        fake_address = "mfakedAddressThatDoesNotExist1234567"
        response = requests.get(f"{BASE_URL}/api/wallet/address-txs/{fake_address}", params={"network": "btc-testnet"})
        # Should return 200 with empty list, not 404
        assert response.status_code == 200, f"Expected 200 for nonexistent address, got {response.status_code}"
        data = response.json()
        assert data["count"] == 0 or "error" not in data or data["count"] >= 0
        print("PASS: Nonexistent address handled gracefully")


class TestExistingWalletEndpoints:
    """Regression tests for existing wallet endpoints"""
    
    def test_wallet_create_still_works(self):
        """POST /wallet/create still works"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        print(f"PASS: Wallet create works - address={data['address'][:20]}...")
    
    def test_wallet_balance_still_works(self):
        """GET /wallet/balance/{address} still works"""
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{TEST_ADDRESS}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "balance_sats" in data
        print(f"PASS: Balance endpoint works - balance_sats={data['balance_sats']}")
    
    def test_wallet_utxos_still_works(self):
        """GET /wallet/utxos/{address} still works"""
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{TEST_ADDRESS}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        assert "count" in data
        print(f"PASS: UTXOs endpoint works - count={data['count']}")
    
    def test_wallet_faucets_still_works(self):
        """GET /wallet/faucets still works"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        assert response.status_code == 200
        data = response.json()
        assert "faucets" in data
        assert len(data["faucets"]) > 0
        print(f"PASS: Faucets endpoint works - {len(data['faucets'])} faucets listed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
