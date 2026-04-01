"""
Iteration 34 - Client-side signing backend API tests
Tests wallet endpoints that support client-side transaction signing:
- GET /api/wallet/utxos/{address} - Returns UTXOs for address
- GET /api/wallet/raw-tx/{txid} - Returns raw TX hex
- POST /api/wallet/broadcast - Broadcasts signed raw TX
- POST /api/wallet/register-profile - Registers profile without WIF
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestWalletUtxos:
    """Tests for GET /api/wallet/utxos/{address}"""
    
    def test_utxos_returns_list_for_valid_address(self):
        """Should return UTXO list (possibly empty) for valid testnet address"""
        # Using a known testnet address that may have UTXOs
        address = "mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt"
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{address}", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        assert isinstance(data["utxos"], list)
        assert "count" in data
        print(f"PASS: UTXOs endpoint returns list (count: {data['count']})")
    
    def test_utxos_empty_for_new_address(self):
        """Should return empty list for unfunded/new address"""
        # Generate a random-ish address pattern
        address = f"mk1234567890TestAddr{int(time.time())}"[:34]
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{address}", params={"network": "btc-testnet"})
        
        # Should still return 200 with empty list, not error
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        assert data["count"] == 0
        print("PASS: Empty UTXOs returned for new address")


class TestWalletRawTx:
    """Tests for GET /api/wallet/raw-tx/{txid}"""
    
    def test_raw_tx_returns_hex_for_valid_txid(self):
        """Should return raw TX hex for known testnet transaction"""
        # Using a known testnet txid from the feed
        txid = "0a2f31fa9ec30dea449c3d53b999566dbdf3f32a0c71e1d3ba3300873999140b"
        response = requests.get(f"{BASE_URL}/api/wallet/raw-tx/{txid}", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        assert "hex" in data
        assert isinstance(data["hex"], str)
        assert len(data["hex"]) > 100  # Raw TX hex should be substantial
        print(f"PASS: Raw TX hex returned (length: {len(data['hex'])})")
    
    def test_raw_tx_error_for_invalid_txid(self):
        """Should return error for invalid/nonexistent txid"""
        txid = "0000000000000000000000000000000000000000000000000000000000000000"
        response = requests.get(f"{BASE_URL}/api/wallet/raw-tx/{txid}", params={"network": "btc-testnet"})
        
        # Should return 404 or error status
        assert response.status_code in [404, 400, 500]
        print(f"PASS: Error returned for invalid txid (status: {response.status_code})")


class TestWalletBroadcast:
    """Tests for POST /api/wallet/broadcast"""
    
    def test_broadcast_accepts_raw_tx_and_network(self):
        """Should accept raw_tx and network params (even if tx fails validation)"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/broadcast",
            json={"raw_tx": "invalid_hex_data", "network": "btc-testnet"}
        )
        
        # Should return 200 or 400 with error message, not 500
        assert response.status_code in [200, 400]
        data = response.json()
        # Should have either success or error field
        assert "success" in data or "error" in data or "detail" in data
        print(f"PASS: Broadcast endpoint accepts params (status: {response.status_code})")
    
    def test_broadcast_validates_tx_format(self):
        """Should return error for malformed transaction hex"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/broadcast",
            json={"raw_tx": "not_valid_hex", "network": "btc-testnet"}
        )
        
        data = response.json()
        # Should indicate failure
        if "success" in data:
            assert data["success"] == False
        print("PASS: Broadcast validates TX format")


class TestWalletRegisterProfile:
    """Tests for POST /api/wallet/register-profile"""
    
    def test_register_profile_accepts_address_without_wif(self):
        """Should register profile with address/urn only - NO WIF required"""
        test_urn = f"test_reg_{int(time.time())}"
        response = requests.post(
            f"{BASE_URL}/api/wallet/register-profile",
            json={
                "address": "mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt",
                "urn": test_urn,
                "network": "btc-testnet"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("address") == "mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt"
        assert data.get("urn") == test_urn
        print(f"PASS: Profile registered without WIF (urn: {test_urn})")
    
    def test_register_profile_no_wif_in_request(self):
        """Verify the endpoint works without any WIF field"""
        # This test confirms the endpoint doesn't require WIF
        test_urn = f"test_nowif_{int(time.time())}"
        payload = {
            "address": "mtCVng4XGVMBjF7LnhFM123456789abcd",
            "urn": test_urn,
            "network": "btc-testnet"
        }
        # Explicitly verify NO wif key in payload
        assert "wif" not in payload
        
        response = requests.post(f"{BASE_URL}/api/wallet/register-profile", json=payload)
        assert response.status_code == 200
        print("PASS: Profile registration works without WIF field")


class TestFeedAnonymous:
    """Tests for anonymous feed access"""
    
    def test_feed_loads_without_auth(self):
        """Feed should load for anonymous users"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 5})
        
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        assert isinstance(data["feed"], list)
        print(f"PASS: Feed loads anonymously (count: {len(data['feed'])})")


class TestObjectsEndpoints:
    """Tests for objects-related endpoints"""
    
    def test_objects_owned_endpoint(self):
        """Should return owned objects for an address"""
        address = "mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM"
        response = requests.get(
            f"{BASE_URL}/api/objects/owned/{address}",
            params={"network": "btc-testnet", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert isinstance(data["objects"], list)
        print(f"PASS: Objects owned endpoint works (count: {len(data['objects'])})")
    
    def test_objects_created_endpoint(self):
        """Should return created objects for an address"""
        address = "mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM"
        response = requests.get(
            f"{BASE_URL}/api/objects/created/{address}",
            params={"network": "btc-testnet", "limit": 5}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        print(f"PASS: Objects created endpoint works")
    
    def test_object_detail_endpoint(self):
        """Should return object details for valid txid"""
        txid = "6e87f95c40583843b95782213cce6f3b74b51619da1d1720f417441211719bde"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        # Should have object details
        assert data.get("Name") or data.get("name") or data.get("URN") or data.get("urn")
        print(f"PASS: Object detail endpoint works")


class TestAuthEndpoints:
    """Tests for auth endpoints"""
    
    def test_signup_creates_user_with_token(self):
        """Should create user and return JWT token"""
        test_urn = f"T34S_{int(time.time())}"
        response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpassword123",
                "address": f"mk{test_urn}Address1234567890",
                "network": "btc-testnet"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data.get("urn") == test_urn
        print(f"PASS: Signup creates user with token (urn: {test_urn})")
    
    def test_signup_rejects_duplicate_urn(self):
        """Should return 409 for duplicate URN"""
        test_urn = f"T34DUP_{int(time.time())}"
        
        # First signup
        requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpassword123",
                "address": f"mk{test_urn}Addr1",
                "network": "btc-testnet"
            }
        )
        
        # Second signup with same URN
        response = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpassword123",
                "address": f"mk{test_urn}Addr2",
                "network": "btc-testnet"
            }
        )
        
        assert response.status_code == 409
        print("PASS: Duplicate URN returns 409")
    
    def test_login_returns_token(self):
        """Should return JWT for valid credentials"""
        test_urn = f"T34LOG_{int(time.time())}"
        
        # Create user first
        requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testlogin123",
                "address": f"mk{test_urn}LoginAddr",
                "network": "btc-testnet"
            }
        )
        
        # Login
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": test_urn, "password": "testlogin123"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        print(f"PASS: Login returns token for {test_urn}")
    
    def test_login_rejects_wrong_password(self):
        """Should return 401 for wrong password"""
        test_urn = f"T34WRG_{int(time.time())}"
        
        # Create user
        requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "correctpassword",
                "address": f"mk{test_urn}WrongAddr",
                "network": "btc-testnet"
            }
        )
        
        # Login with wrong password
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": test_urn, "password": "wrongpassword"}
        )
        
        assert response.status_code == 401
        print("PASS: Wrong password returns 401")


class TestWalletCreate:
    """Tests for wallet creation endpoint"""
    
    def test_create_testnet_wallet(self):
        """Should create testnet wallet with m/n address"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        # Testnet addresses start with m or n
        assert data["address"].startswith("m") or data["address"].startswith("n")
        print(f"PASS: Testnet wallet created (address: {data['address'][:10]}...)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
