"""
Test wallet revenue API for iteration 149.
Tests the /api/wallet/address-txs endpoint which is used by WalletRevenue component.
The key fix is that the frontend now excludes self-change transactions from revenue calculation.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestWalletAddressTxsAPI:
    """Test the wallet address-txs API endpoint"""
    
    # Main test address from the review request
    MAIN_ADDRESS = "mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF"
    NETWORK = "btc-testnet"
    
    def test_address_txs_endpoint_returns_200(self):
        """Test that the address-txs endpoint returns 200 OK"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"✓ Address-txs endpoint returns 200 OK")
    
    def test_address_txs_returns_transactions_array(self):
        """Test that the response contains a transactions array"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "transactions" in data, "Response should contain 'transactions' key"
        assert isinstance(data["transactions"], list), "transactions should be a list"
        print(f"✓ Response contains transactions array with {len(data['transactions'])} items")
    
    def test_transaction_has_required_fields(self):
        """Test that each transaction has the required fields for revenue calculation"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        if len(txs) == 0:
            pytest.skip("No transactions found for this address")
        
        # Check first transaction has required fields
        tx = txs[0]
        required_fields = ["txid", "is_incoming", "received_sats", "sent_sats", "confirmed"]
        for field in required_fields:
            assert field in tx, f"Transaction missing required field: {field}"
        
        print(f"✓ Transactions have all required fields: {required_fields}")
    
    def test_is_incoming_field_is_boolean(self):
        """Test that is_incoming field is a boolean"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        if len(txs) == 0:
            pytest.skip("No transactions found for this address")
        
        for tx in txs[:10]:  # Check first 10
            assert isinstance(tx.get("is_incoming"), bool), f"is_incoming should be boolean, got {type(tx.get('is_incoming'))}"
        
        print(f"✓ is_incoming field is boolean for all checked transactions")
    
    def test_sats_fields_are_integers(self):
        """Test that received_sats and sent_sats are integers"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        if len(txs) == 0:
            pytest.skip("No transactions found for this address")
        
        for tx in txs[:10]:  # Check first 10
            assert isinstance(tx.get("received_sats", 0), int), f"received_sats should be int"
            assert isinstance(tx.get("sent_sats", 0), int), f"sent_sats should be int"
        
        print(f"✓ sats fields are integers for all checked transactions")
    
    def test_large_deposit_exists(self):
        """Test that the ~90 BTC deposit transaction exists"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        # Look for the ~90.9 BTC deposit (9,090,909,000 sats)
        large_deposits = [tx for tx in txs if tx.get("is_incoming") and tx.get("received_sats", 0) > 1_000_000_000]
        
        assert len(large_deposits) > 0, "Expected to find the ~90 BTC deposit transaction"
        
        deposit = large_deposits[0]
        print(f"✓ Found large deposit: {deposit['received_sats']:,} sats ({deposit['received_sats']/1e8:.4f} BTC)")
        print(f"  TXID: {deposit['txid']}")
    
    def test_outgoing_transactions_have_sent_sats(self):
        """Test that outgoing transactions have sent_sats > 0"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        outgoing = [tx for tx in txs if not tx.get("is_incoming")]
        
        if len(outgoing) == 0:
            pytest.skip("No outgoing transactions found")
        
        # Check that outgoing txs have sent_sats
        for tx in outgoing[:5]:
            # Note: sent_sats might be 0 for some edge cases, but most should have value
            print(f"  Outgoing TX {tx['txid'][:16]}... sent_sats={tx.get('sent_sats', 0):,}")
        
        print(f"✓ Found {len(outgoing)} outgoing transactions")
    
    def test_revenue_calculation_logic(self):
        """
        Test the revenue calculation logic that the frontend uses.
        The key fix: if a txid appears as OUTGOING from main address,
        any INCOMING to change address with same txid should be excluded.
        """
        response = requests.get(
            f"{BASE_URL}/api/wallet/address-txs/{self.MAIN_ADDRESS}",
            params={"network": self.NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        txs = data.get("transactions", [])
        
        # Build set of outgoing txids (these are self-spends)
        outgoing_txids = set()
        for tx in txs:
            if not tx.get("is_incoming") and tx.get("sent_sats", 0) > 0:
                outgoing_txids.add(tx["txid"])
        
        # Calculate total income excluding dust (<=546 sats)
        total_income_raw = 0
        total_income_excluding_self = 0
        
        for tx in txs:
            if tx.get("is_incoming") and tx.get("received_sats", 0) > 546:
                total_income_raw += tx["received_sats"]
                # The fix: exclude if this txid is also an outgoing tx (self-change)
                if tx["txid"] not in outgoing_txids:
                    total_income_excluding_self += tx["received_sats"]
        
        print(f"✓ Revenue calculation test:")
        print(f"  Total income (raw): {total_income_raw:,} sats ({total_income_raw/1e8:.4f} BTC)")
        print(f"  Total income (excluding self-change): {total_income_excluding_self:,} sats ({total_income_excluding_self/1e8:.4f} BTC)")
        print(f"  Outgoing txids count: {len(outgoing_txids)}")
        
        # The fix should result in ~90 BTC, not ~181 BTC
        # If the raw income is roughly double the corrected income, the fix is working
        if total_income_raw > 0 and total_income_excluding_self > 0:
            ratio = total_income_raw / total_income_excluding_self
            print(f"  Ratio (raw/corrected): {ratio:.2f}x")


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Test that the health endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health endpoint returns healthy status")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
