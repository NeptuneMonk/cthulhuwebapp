"""
Iteration 33 Backend Tests - Wallet & Auth Endpoints
Tests client-side TX signing infrastructure: UTXOs, raw-tx, broadcast, register-profile
Plus auth flow and error handling for duplicate URN & unfunded wallet
"""
import pytest
import requests
import os
import time
import random
import string

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://dark-telegram-ui.preview.emergentagent.com"


def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))


class TestHealthAndBasics:
    """Basic health checks"""
    
    def test_api_root(self):
        """Test API root returns version"""
        resp = requests.get(f"{BASE_URL}/api/")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("message") == "Cthulhu API"
        print(f"API version: {data.get('version')}")
    
    def test_health_check(self):
        """Test health endpoint"""
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "healthy"


class TestWalletUTXOs:
    """Test GET /api/wallet/utxos/{address}"""
    
    def test_utxos_valid_testnet_address(self):
        """Fetch UTXOs for a known testnet address"""
        # Use a known testnet address from seed data
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(f"{BASE_URL}/api/wallet/utxos/{address}?network=btc-testnet")
        assert resp.status_code == 200
        data = resp.json()
        assert "utxos" in data
        assert "count" in data
        assert isinstance(data["utxos"], list)
        print(f"UTXOs for {address}: {data['count']} UTXOs found")
    
    def test_utxos_empty_for_new_address(self):
        """New address should have 0 UTXOs"""
        # Create a new wallet to get a fresh address
        create_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        if create_resp.status_code == 200:
            new_addr = create_resp.json().get("address")
            resp = requests.get(f"{BASE_URL}/api/wallet/utxos/{new_addr}?network=btc-testnet")
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 0
            assert len(data["utxos"]) == 0
            print(f"New address {new_addr[:15]}... has 0 UTXOs as expected")


class TestWalletRawTx:
    """Test GET /api/wallet/raw-tx/{txid}"""
    
    def test_raw_tx_valid_txid(self):
        """Fetch raw TX hex for a known testnet transaction"""
        # Known testnet txid from the problem statement
        txid = "0a2f31fa9ec30dea449c3d53b999566dbdf3f32a0c71e1d3ba3300873999140b"
        resp = requests.get(f"{BASE_URL}/api/wallet/raw-tx/{txid}?network=btc-testnet")
        assert resp.status_code == 200
        data = resp.json()
        assert "hex" in data
        assert data["txid"] == txid
        assert len(data["hex"]) > 100  # Raw TX hex should be substantial
        print(f"Raw TX hex length: {len(data['hex'])} chars")
    
    def test_raw_tx_invalid_txid(self):
        """Invalid txid should return 404"""
        fake_txid = "0000000000000000000000000000000000000000000000000000000000000000"
        resp = requests.get(f"{BASE_URL}/api/wallet/raw-tx/{fake_txid}?network=btc-testnet")
        assert resp.status_code == 404
        print("Invalid txid correctly returns 404")


class TestWalletBroadcast:
    """Test POST /api/wallet/broadcast"""
    
    def test_broadcast_invalid_tx(self):
        """Broadcast with invalid TX hex should fail gracefully"""
        resp = requests.post(
            f"{BASE_URL}/api/wallet/broadcast",
            json={"raw_tx": "invalid_hex", "network": "btc-testnet"}
        )
        # Should return success=false or error, not crash
        assert resp.status_code in [200, 400, 500]
        data = resp.json()
        if resp.status_code == 200:
            assert data.get("success") == False
        print(f"Invalid broadcast response: {data}")


class TestWalletRegisterProfile:
    """Test POST /api/wallet/register-profile"""
    
    def test_register_profile_success(self):
        """Register a profile address in known_users DB"""
        test_addr = f"TEST_n{random_string(32)}"
        test_urn = f"TEST_REG_{random_string(6)}"
        resp = requests.post(
            f"{BASE_URL}/api/wallet/register-profile",
            json={
                "address": test_addr,
                "network": "btc-testnet",
                "urn": test_urn,
                "image": "ipfs://test_image",
                "display_name": "Test User"
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] == True
        assert data["address"] == test_addr
        assert data["urn"] == test_urn
        print(f"Registered profile: {test_urn}")
    
    def test_register_profile_no_wif(self):
        """Verify register-profile doesn't require WIF (key material)"""
        # This endpoint should work without any private key
        test_urn = f"TEST_NOWIF_{random_string(6)}"
        resp = requests.post(
            f"{BASE_URL}/api/wallet/register-profile",
            json={
                "address": "mtestaddress123",
                "network": "btc-testnet",
                "urn": test_urn
            }
        )
        assert resp.status_code == 200
        print("register-profile works without WIF as expected")


class TestAuthSignup:
    """Test POST /api/auth/signup"""
    
    def test_signup_success(self):
        """Create new user successfully"""
        test_urn = f"TEST_S33_{random_string(6)}"
        # First create a wallet
        wallet_resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        assert wallet_resp.status_code == 200
        wallet = wallet_resp.json()
        
        resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpass123",
                "address": wallet["address"],
                "network": "btc-testnet"
            }
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["urn"] == test_urn
        assert data["address"] == wallet["address"]
        print(f"Signup success: {test_urn}")
        return test_urn
    
    def test_signup_duplicate_urn_returns_409(self):
        """Duplicate URN should return 409, not 500"""
        test_urn = f"TEST_DUP33_{random_string(6)}"
        
        # Create wallet for first signup
        wallet1 = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        
        # First signup should succeed
        resp1 = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpass123",
                "address": wallet1["address"],
                "network": "btc-testnet"
            }
        )
        assert resp1.status_code == 200
        
        # Create wallet for second signup (different address)
        wallet2 = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        
        # Second signup with SAME URN should return 409
        resp2 = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpass456",
                "address": wallet2["address"],
                "network": "btc-testnet"
            }
        )
        assert resp2.status_code == 409, f"Expected 409 for duplicate URN, got {resp2.status_code}: {resp2.text}"
        data = resp2.json()
        assert "already taken" in data.get("detail", "").lower()
        print(f"Duplicate URN correctly returns 409")
    
    def test_signup_short_urn_rejected(self):
        """URN < 2 chars should be rejected"""
        wallet = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": "X",
                "password": "testpass123",
                "address": wallet["address"],
                "network": "btc-testnet"
            }
        )
        assert resp.status_code == 400
        print("Short URN correctly rejected")
    
    def test_signup_short_password_rejected(self):
        """Password < 6 chars should be rejected"""
        wallet = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": f"TEST_PW_{random_string(4)}",
                "password": "12345",
                "address": wallet["address"],
                "network": "btc-testnet"
            }
        )
        assert resp.status_code == 400
        print("Short password correctly rejected")


class TestAuthLogin:
    """Test POST /api/auth/login"""
    
    @pytest.fixture(autouse=True)
    def setup_user(self):
        """Create a user for login tests"""
        self.test_urn = f"TEST_LOGIN33_{random_string(6)}"
        self.test_password = "securepass123"
        wallet = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        self.test_address = wallet["address"]
        
        resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": self.test_urn,
                "password": self.test_password,
                "address": self.test_address,
                "network": "btc-testnet"
            }
        )
        assert resp.status_code in [200, 409]  # 409 if already exists from previous run
    
    def test_login_success(self):
        """Login with valid credentials"""
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": self.test_urn, "password": self.test_password}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["urn"].lower() == self.test_urn.lower()
        print(f"Login success for {self.test_urn}")
    
    def test_login_invalid_urn(self):
        """Login with non-existent URN returns 401"""
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": "NONEXISTENT_USER_XYZ", "password": "anypassword"}
        )
        assert resp.status_code == 401
        print("Invalid URN correctly returns 401")
    
    def test_login_wrong_password(self):
        """Login with wrong password returns 401"""
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"urn": self.test_urn, "password": "wrongpassword"}
        )
        assert resp.status_code == 401
        print("Wrong password correctly returns 401")


class TestAuthMe:
    """Test GET /api/auth/me"""
    
    def test_me_with_token(self):
        """Auth/me with valid token returns user info"""
        # Create user and get token
        test_urn = f"TEST_ME33_{random_string(6)}"
        wallet = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        
        signup_resp = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={
                "urn": test_urn,
                "password": "testpass123",
                "address": wallet["address"],
                "network": "btc-testnet"
            }
        )
        if signup_resp.status_code != 200:
            pytest.skip("Could not create test user")
        
        token = signup_resp.json()["token"]
        
        # Call /me with token
        resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["urn"].lower() == test_urn.lower()
        print(f"Auth/me success for {test_urn}")
    
    def test_me_without_token(self):
        """Auth/me without token returns 401"""
        resp = requests.get(f"{BASE_URL}/api/auth/me")
        assert resp.status_code == 401
        print("Auth/me without token correctly returns 401")
    
    def test_me_with_invalid_token(self):
        """Auth/me with invalid token returns 401"""
        resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer invalid_token_xyz"}
        )
        assert resp.status_code == 401
        print("Auth/me with invalid token correctly returns 401")


class TestWalletCreateProfile:
    """Test POST /api/wallet/create_profile error handling"""
    
    def test_create_profile_unfunded_wallet_returns_400(self):
        """Unfunded wallet should return 400, not 500"""
        # Create a fresh unfunded wallet
        wallet = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet").json()
        
        resp = requests.post(
            f"{BASE_URL}/api/wallet/create_profile",
            json={
                "wif": wallet["wif"],
                "urn": f"TEST_UNFUND_{random_string(6)}",
                "display_name": "Test User",
                "network": "btc-testnet"
            }
        )
        # Should return 400 (unfunded), not 500 (server error)
        assert resp.status_code == 400, f"Expected 400 for unfunded wallet, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "utxo" in data.get("detail", "").lower() or "fund" in data.get("detail", "").lower()
        print(f"Unfunded wallet correctly returns 400: {data.get('detail')}")


class TestFeedAnonymous:
    """Test feed access for anonymous users"""
    
    def test_feed_loads_anonymous(self):
        """Main feed should load for anonymous users"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert "feed" in data
        assert isinstance(data["feed"], list)
        print(f"Feed loaded for anonymous: {data.get('total', len(data['feed']))} total messages")
    
    def test_feed_pagination(self):
        """Feed supports skip/limit pagination"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=2")
        assert resp.status_code == 200
        data = resp.json()
        assert "has_more" in data
        assert data["limit"] == 2
        print(f"Feed pagination works: has_more={data['has_more']}")


class TestWalletCreate:
    """Test POST /api/wallet/create"""
    
    def test_wallet_create_testnet(self):
        """Create testnet wallet returns address, wif, public_key"""
        resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-testnet")
        assert resp.status_code == 200
        data = resp.json()
        assert "address" in data
        assert "wif" in data
        assert "public_key" in data
        # Testnet address should start with m or n
        assert data["address"][0] in ("m", "n", "2"), f"Unexpected testnet address format: {data['address']}"
        print(f"Created testnet wallet: {data['address'][:20]}...")
    
    def test_wallet_create_mainnet(self):
        """Create mainnet wallet returns mainnet address"""
        resp = requests.post(f"{BASE_URL}/api/wallet/create?network=btc-mainnet")
        assert resp.status_code == 200
        data = resp.json()
        assert "address" in data
        # Mainnet address should start with 1 or 3
        assert data["address"][0] in ("1", "3"), f"Unexpected mainnet address format: {data['address']}"
        print(f"Created mainnet wallet: {data['address'][:20]}...")


class TestWalletBalance:
    """Test GET /api/wallet/balance/{address}"""
    
    def test_balance_valid_address(self):
        """Get balance for valid address"""
        # Known testnet address
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(f"{BASE_URL}/api/wallet/balance/{address}?network=btc-testnet")
        assert resp.status_code == 200
        data = resp.json()
        assert "balance_sats" in data
        assert "balance_btc" in data
        print(f"Balance for {address[:15]}...: {data['balance_sats']} sats")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
