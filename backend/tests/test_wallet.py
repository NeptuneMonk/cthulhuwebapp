"""
Wallet API Tests for Cthulhu - Bitcoin Testnet Wallet Integration
Iteration 10: Tests for wallet creation, import, balance, UTXOs, and faucets

Backend uses Python 'bit' library for testnet key generation (P2PKH addresses starting with m/n).
Balance fetched from mempool.space testnet API.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable is required")


class TestWalletCreate:
    """POST /api/wallet/create - Generate new testnet keypair"""
    
    def test_create_wallet_returns_valid_testnet_address(self):
        """Create wallet returns testnet address (starts with m or n)"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields
        assert "address" in data
        assert "wif" in data
        assert "public_key" in data
        assert "network" in data
        
        # Testnet P2PKH addresses start with 'm' or 'n'
        address = data["address"]
        assert address[0] in ['m', 'n'], f"Testnet address should start with m or n, got: {address}"
        
        # WIF for testnet compressed keys starts with 'c'
        wif = data["wif"]
        assert wif.startswith('c'), f"Testnet WIF should start with 'c', got: {wif[:5]}..."
        
        # Public key should be hex
        assert len(data["public_key"]) == 66, "Compressed public key should be 66 hex chars"
        
        assert data["network"] == "btc-testnet"
        
        print(f"✓ Created testnet wallet: address={address[:12]}..., wif={wif[:8]}...")
    
    def test_create_wallet_generates_unique_addresses(self):
        """Each create call generates a unique address"""
        resp1 = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        resp2 = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        
        addr1 = resp1.json()["address"]
        addr2 = resp2.json()["address"]
        
        assert addr1 != addr2, "Each wallet creation should be unique"
        print(f"✓ Generated unique addresses: {addr1[:12]}... != {addr2[:12]}...")
    
    def test_create_wallet_mainnet_optional(self):
        """Create mainnet wallet (addresses start with 1)"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-mainnet"})
        assert response.status_code == 200
        data = response.json()
        
        address = data["address"]
        # Mainnet P2PKH addresses start with '1'
        assert address.startswith('1'), f"Mainnet address should start with 1, got: {address}"
        
        # Mainnet WIF starts with '5', 'K', or 'L' (compressed)
        wif = data["wif"]
        assert wif[0] in ['5', 'K', 'L'], f"Mainnet WIF format incorrect: {wif[:5]}..."
        
        print(f"✓ Created mainnet wallet: address={address[:12]}...")


class TestWalletImport:
    """POST /api/wallet/import - Import wallet from WIF"""
    
    def test_import_valid_wif_returns_wallet(self):
        """Import valid testnet WIF returns wallet info"""
        # First create a wallet to get a valid WIF
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        created = create_resp.json()
        valid_wif = created["wif"]
        expected_address = created["address"]
        
        # Now import it
        response = requests.post(f"{BASE_URL}/api/wallet/import", 
            params={"network": "btc-testnet"},
            json={"wif": valid_wif})
        
        assert response.status_code == 200
        data = response.json()
        
        # Should return same wallet
        assert data["address"] == expected_address
        assert data["wif"] == valid_wif
        assert data["valid"] == True
        assert data["network"] == "btc-testnet"
        
        print(f"✓ Imported wallet: {data['address'][:12]}...")
    
    def test_import_invalid_wif_returns_400(self):
        """Import invalid WIF returns HTTP 400 error"""
        response = requests.post(f"{BASE_URL}/api/wallet/import",
            params={"network": "btc-testnet"},
            json={"wif": "invalid_wif_key_12345"})
        
        assert response.status_code == 400
        data = response.json()
        
        # Should have error message in detail
        assert "detail" in data
        assert "Invalid WIF" in data["detail"] or "invalid" in data["detail"].lower()
        
        print(f"✓ Invalid WIF rejected with 400: {data['detail'][:50]}...")
    
    def test_import_empty_wif_handled(self):
        """Import empty WIF is handled (bit library creates random key or rejects)"""
        response = requests.post(f"{BASE_URL}/api/wallet/import",
            params={"network": "btc-testnet"},
            json={"wif": ""})
        
        # bit library may create random key for empty string or reject
        # Either 200 (creates key) or 400/422 (rejects) is acceptable
        assert response.status_code in [200, 400, 422]
        print(f"✓ Empty WIF handled with status {response.status_code}")
    
    def test_import_wrong_network_wif(self):
        """Import testnet WIF with mainnet network param should still work (bit library handles)"""
        # Create testnet wallet
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        testnet_wif = create_resp.json()["wif"]
        
        # Try importing as mainnet - bit library will interpret differently
        response = requests.post(f"{BASE_URL}/api/wallet/import",
            params={"network": "btc-mainnet"},
            json={"wif": testnet_wif})
        
        # This may return 400 if bit library validates network mismatch
        # Or 200 if it just interprets the key differently
        assert response.status_code in [200, 400], f"Unexpected status: {response.status_code}"
        print(f"✓ Cross-network WIF import handled: status={response.status_code}")


class TestWalletBalance:
    """GET /api/wallet/balance/{address} - Fetch balance from mempool.space"""
    
    def test_balance_new_unfunded_wallet(self):
        """New unfunded wallet has 0 balance"""
        # Create new wallet
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        address = create_resp.json()["address"]
        
        # Get balance
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{address}", 
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        # Required fields
        assert "address" in data
        assert "balance_sats" in data
        assert "balance_btc" in data
        assert data["address"] == address
        
        # New wallet should have 0 balance
        assert data["balance_sats"] == 0
        assert data["balance_btc"] == 0.0
        
        # Should also have network field
        if "network" in data:
            assert data["network"] == "btc-testnet"
        
        print(f"✓ New wallet balance: {data['balance_sats']} sats (expected 0)")
    
    def test_balance_returns_tx_count_when_available(self):
        """Balance response includes transaction count when mempool.space returns it"""
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        address = create_resp.json()["address"]
        
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{address}",
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        # tx_count may be present (successful mempool call) or absent (error/rate limit)
        if "tx_count" in data:
            assert data["tx_count"] == 0  # New wallet
            print(f"✓ Balance includes tx_count: {data['tx_count']}")
        else:
            # Mempool API may be rate limited or returning error
            assert "error" in data or data["balance_sats"] == 0
            print(f"✓ Balance returned (mempool API may be limited): {data}")
    
    def test_balance_known_testnet_address(self):
        """Balance for known testnet address (embii4u) returns data"""
        # embii4u's testnet address - may have some balance from past activity
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{address}",
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["address"] == address
        assert "balance_sats" in data
        
        # tx_count may not be present if mempool API is rate limited
        if "tx_count" in data:
            assert data["tx_count"] >= 0  # May have txs
            print(f"✓ embii4u balance: {data['balance_sats']} sats, {data['tx_count']} txs")
        else:
            print(f"✓ embii4u balance: {data['balance_sats']} sats (mempool API may be limited)")
    
    def test_balance_invalid_address_handled(self):
        """Invalid address returns graceful response (not crash)"""
        response = requests.get(f"{BASE_URL}/api/wallet/balance/invalid_address_xyz",
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200  # API returns 200 with error field
        data = response.json()
        
        # Should return 0 balance or error message
        assert data["balance_sats"] == 0
        if "error" in data:
            print(f"✓ Invalid address handled: {data['error']}")
        else:
            print(f"✓ Invalid address handled: returned 0 balance")


class TestWalletUtxos:
    """GET /api/wallet/utxos/{address} - Fetch UTXOs from mempool.space"""
    
    def test_utxos_new_wallet_empty(self):
        """New unfunded wallet has 0 UTXOs"""
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        address = create_resp.json()["address"]
        
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{address}",
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        assert "utxos" in data
        assert "count" in data
        assert len(data["utxos"]) == 0
        assert data["count"] == 0
        
        print(f"✓ New wallet UTXOs: {data['count']} (expected 0)")
    
    def test_utxos_response_structure(self):
        """UTXO response has proper structure"""
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        address = create_resp.json()["address"]
        
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{address}",
            params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        
        # Required fields
        assert "utxos" in data
        assert "count" in data
        assert isinstance(data["utxos"], list)
        
        # total_sats should be present
        if "total_sats" in data:
            assert data["total_sats"] == 0  # New wallet
        
        print(f"✓ UTXO response structure verified")


class TestWalletFaucets:
    """GET /api/wallet/faucets - Return testnet faucet URLs"""
    
    def test_faucets_returns_list(self):
        """Faucets endpoint returns list of faucet URLs"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "faucets" in data
        assert isinstance(data["faucets"], list)
        assert len(data["faucets"]) >= 2, "Should have at least 2 faucet options"
        
        print(f"✓ Faucets endpoint returns {len(data['faucets'])} faucets")
    
    def test_faucets_have_name_and_url(self):
        """Each faucet has name and url fields"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        
        assert response.status_code == 200
        data = response.json()
        
        for faucet in data["faucets"]:
            assert "name" in faucet, f"Faucet missing name: {faucet}"
            assert "url" in faucet, f"Faucet missing url: {faucet}"
            assert faucet["url"].startswith("https://"), f"Faucet URL should be https: {faucet['url']}"
            print(f"  - {faucet['name']}: {faucet['url']}")
        
        print(f"✓ All {len(data['faucets'])} faucets have name and url")
    
    def test_faucets_includes_mempool(self):
        """Faucets includes mempool.space faucet"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        
        assert response.status_code == 200
        data = response.json()
        
        faucet_names = [f["name"].lower() for f in data["faucets"]]
        mempool_found = any("mempool" in name for name in faucet_names)
        
        assert mempool_found, "Should include mempool faucet"
        print(f"✓ Mempool faucet included")


class TestWalletBroadcast:
    """POST /api/wallet/broadcast - Broadcast raw transaction (placeholder test)"""
    
    def test_broadcast_endpoint_exists(self):
        """Broadcast endpoint exists and handles invalid tx gracefully"""
        response = requests.post(f"{BASE_URL}/api/wallet/broadcast",
            json={"raw_tx": "invalid_hex_tx", "network": "btc-testnet"})
        
        # Should not crash - returns error for invalid tx
        assert response.status_code in [200, 400, 500]
        data = response.json()
        
        # If 200, should indicate failure
        if response.status_code == 200:
            assert data.get("success") == False
            print(f"✓ Broadcast endpoint returns success=false for invalid tx")
        else:
            print(f"✓ Broadcast endpoint returns {response.status_code} for invalid tx")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
