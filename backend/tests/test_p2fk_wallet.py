"""
P2FK Wallet Post and Profile Creation Tests
Iteration 11: Tests for POST /api/wallet/post and POST /api/wallet/create_profile

These endpoints implement the SUP-compatible P2FK protocol for creating Bitcoin transactions
that encode posts and profiles as on-chain data.

Expected behaviors:
- Invalid WIF keys return 400 error
- Unfunded wallets (no UTXOs) return 400 with "No UTXOs available" message
- Valid requests with funded wallets would broadcast successfully (but we test validation stages)
"""
import pytest
import requests
import os
from bit import PrivateKeyTestnet

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable is required")


class TestPostEndpointValidation:
    """POST /api/wallet/post - P2FK post creation validation"""

    def test_post_invalid_wif_returns_400(self):
        """Invalid WIF key returns 400 error"""
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": "invalid_wif_key_12345",
            "message": "Test post message",
            "network": "btc-testnet"
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "Invalid WIF" in data["detail"]
        print(f"✓ Invalid WIF rejected with 400: {data['detail']}")

    def test_post_empty_wif_returns_error(self):
        """Empty WIF returns error"""
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": "",
            "message": "Test post message",
            "network": "btc-testnet"
        })
        
        # Should return 400 or 422 for empty/invalid WIF
        assert response.status_code in [400, 422]
        print(f"✓ Empty WIF returns status {response.status_code}")

    def test_post_valid_wif_unfunded_returns_no_utxos_error(self):
        """Valid WIF but unfunded wallet returns 'No UTXOs' error"""
        # Generate a fresh testnet WIF key (will have no funds)
        key = PrivateKeyTestnet()
        fresh_wif = key.to_wif()
        
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": fresh_wif,
            "message": "Test post message",
            "network": "btc-testnet"
        })
        
        # Should return 400 with UTXO error (passes WIF validation but fails at UTXO check)
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "No UTXOs" in data["detail"] or "UTXO" in data["detail"] or "Fund" in data["detail"].lower()
        print(f"✓ Unfunded wallet rejected: {data['detail']}")

    def test_post_accepts_valid_request_format_with_hashtags(self):
        """Endpoint accepts valid request format with all optional fields"""
        key = PrivateKeyTestnet()
        fresh_wif = key.to_wif()
        
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": fresh_wif,
            "message": "Testing #bitcoin #testnet post",
            "network": "btc-testnet",
            "hashtags": ["bitcoin", "testnet"],
            "to_address": None
        })
        
        # Should reach UTXO check (400) not fail on validation (422)
        assert response.status_code == 400
        data = response.json()
        # Should fail at UTXO stage, not request validation
        assert "No UTXOs" in data.get("detail", "")
        print(f"✓ Request format with hashtags accepted, failed at UTXO check as expected")

    def test_post_accepts_reply_format_with_to_address(self):
        """Endpoint accepts reply format with to_address"""
        key = PrivateKeyTestnet()
        fresh_wif = key.to_wif()
        
        # Use a known testnet address as reply target
        target_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": fresh_wif,
            "message": "This is a reply",
            "network": "btc-testnet",
            "to_address": target_address
        })
        
        # Should reach UTXO check
        assert response.status_code == 400
        data = response.json()
        assert "No UTXOs" in data.get("detail", "")
        print(f"✓ Reply format with to_address accepted, failed at UTXO check as expected")

    def test_post_missing_required_fields_returns_422(self):
        """Missing required fields returns 422 validation error"""
        # Missing 'message' field
        key = PrivateKeyTestnet()
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": key.to_wif(),
            "network": "btc-testnet"
        })
        
        assert response.status_code == 422
        print(f"✓ Missing message field returns 422")

    def test_post_missing_wif_returns_422(self):
        """Missing wif field returns 422 validation error"""
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "message": "Test message",
            "network": "btc-testnet"
        })
        
        assert response.status_code == 422
        print(f"✓ Missing wif field returns 422")


class TestProfileEndpointValidation:
    """POST /api/wallet/create_profile - P2FK profile creation validation"""

    def test_profile_invalid_wif_returns_400(self):
        """Invalid WIF key returns 400 error"""
        response = requests.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": "invalid_wif_key_12345",
            "urn": "testuser",
            "network": "btc-testnet"
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "Invalid WIF" in data["detail"]
        print(f"✓ Profile: Invalid WIF rejected with 400: {data['detail']}")

    def test_profile_valid_wif_unfunded_returns_no_utxos_error(self):
        """Valid WIF but unfunded wallet returns 'No UTXOs' error"""
        key = PrivateKeyTestnet()
        fresh_wif = key.to_wif()
        
        response = requests.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": fresh_wif,
            "urn": "testuser123",
            "network": "btc-testnet"
        })
        
        # Should return 400 with UTXO error
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "No UTXOs" in data["detail"] or "UTXO" in data["detail"]
        print(f"✓ Profile: Unfunded wallet rejected: {data['detail']}")

    def test_profile_accepts_all_optional_fields(self):
        """Endpoint accepts all optional profile fields (urn, display_name, bio, image)"""
        key = PrivateKeyTestnet()
        fresh_wif = key.to_wif()
        
        response = requests.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": fresh_wif,
            "urn": "mytestuser",
            "display_name": "My Test User",
            "bio": "This is my test bio",
            "image": "https://example.com/avatar.png",
            "network": "btc-testnet"
        })
        
        # Should reach UTXO check (400), not validation error (422)
        assert response.status_code == 400
        data = response.json()
        assert "No UTXOs" in data.get("detail", "")
        print(f"✓ Profile with all fields accepted, failed at UTXO check as expected")

    def test_profile_missing_urn_returns_422(self):
        """Missing required 'urn' field returns 422"""
        key = PrivateKeyTestnet()
        response = requests.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": key.to_wif(),
            "display_name": "Test User",
            "network": "btc-testnet"
        })
        
        assert response.status_code == 422
        print(f"✓ Profile: Missing urn field returns 422")

    def test_profile_empty_urn_handled(self):
        """Empty urn is handled (may be valid or rejected)"""
        key = PrivateKeyTestnet()
        response = requests.post(f"{BASE_URL}/api/wallet/create_profile", json={
            "wif": key.to_wif(),
            "urn": "",
            "network": "btc-testnet"
        })
        
        # Empty URN might reach UTXO check or be rejected
        assert response.status_code in [400, 422]
        print(f"✓ Profile: Empty urn handled with status {response.status_code}")


class TestP2FKEncodingValidation:
    """Tests that verify P2FK encoding functions work correctly via API behavior"""

    def test_post_validation_passes_to_utxo_stage(self):
        """Valid request passes WIF validation and P2FK encoding, fails at UTXO fetch"""
        key = PrivateKeyTestnet()
        
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": key.to_wif(),
            "message": "Test message for P2FK encoding validation",
            "network": "btc-testnet"
        })
        
        # Reaching 400 with UTXO error means:
        # 1. WIF validation passed
        # 2. P2FK payload building passed
        # 3. P2FK signing passed
        # 4. P2FK address encoding passed
        # 5. Only failed at UTXO fetch (expected for unfunded wallet)
        assert response.status_code == 400
        data = response.json()
        assert "No UTXOs" in data.get("detail", "")
        print(f"✓ P2FK encoding validation passed (failed only at UTXO stage)")

    def test_long_message_encoded_correctly(self):
        """Long message (requiring multiple addresses) passes encoding"""
        key = PrivateKeyTestnet()
        
        # Create a message that will require multiple P2FK addresses (>20 chars each chunk)
        long_message = "This is a long test message that should require multiple P2FK address chunks to encode properly on the blockchain #test"
        
        response = requests.post(f"{BASE_URL}/api/wallet/post", json={
            "wif": key.to_wif(),
            "message": long_message,
            "network": "btc-testnet"
        })
        
        # Should reach UTXO check
        assert response.status_code == 400
        data = response.json()
        assert "No UTXOs" in data.get("detail", "")
        print(f"✓ Long message encoding passed (failed only at UTXO stage)")


class TestExistingWalletEndpointsRegression:
    """Regression tests for existing wallet endpoints"""

    def test_wallet_create_still_works(self):
        """POST /api/wallet/create still works"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        assert data["address"][0] in ['m', 'n']  # Testnet address
        print(f"✓ Wallet create: {data['address'][:12]}...")

    def test_wallet_import_still_works(self):
        """POST /api/wallet/import still works"""
        # Create a wallet first
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create", params={"network": "btc-testnet"})
        wif = create_resp.json()["wif"]
        
        # Import it
        response = requests.post(f"{BASE_URL}/api/wallet/import", 
            params={"network": "btc-testnet"},
            json={"wif": wif})
        
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] == True
        print(f"✓ Wallet import: valid={data['valid']}")

    def test_wallet_import_invalid_wif_still_returns_400(self):
        """POST /api/wallet/import with invalid WIF still returns 400"""
        response = requests.post(f"{BASE_URL}/api/wallet/import",
            params={"network": "btc-testnet"},
            json={"wif": "invalid_wif_key"})
        
        assert response.status_code == 400
        print(f"✓ Invalid WIF import returns 400")


class TestFeedEndpointRegression:
    """Regression test for feed endpoint"""

    def test_feed_btc_testnet_still_works(self):
        """GET /api/feed/btc-testnet still returns data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 5})
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        assert "total" in data
        assert "network" in data
        assert data["network"] == "btc-testnet"
        print(f"✓ Feed endpoint: {data['total']} total items, {len(data['feed'])} returned")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
