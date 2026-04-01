"""
Iteration 46 - Comprehensive API Testing
Tests all backend endpoints as specified in the review request.
"""
import pytest
import requests
import time
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://dark-telegram-ui.preview.emergentagent.com"

# Health and Root endpoints
class TestHealthAndRoot:
    """Test /api/health and /api/ endpoints"""
    
    def test_health_endpoint(self):
        """GET /api/health - verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print(f"✓ Health check passed: {data}")
    
    def test_root_endpoint(self):
        """GET /api/ - verify API info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert 'message' in data
        assert 'Cthulhu' in data['message']
        assert 'version' in data
        print(f"✓ Root endpoint passed: {data}")


# Auth endpoints
class TestAuthEndpoints:
    """Test authentication endpoints: signup, login, me"""
    
    @pytest.fixture
    def unique_suffix(self):
        return f"iter46_{int(time.time())}"
    
    def test_signup_success(self, unique_suffix):
        """POST /api/auth/signup - create new account"""
        payload = {
            "urn": f"TEST_signup_{unique_suffix}",
            "password": "testpass123",
            "address": f"mTestAddr{unique_suffix[:8]}",
            "network": "btc-testnet"
        }
        response = requests.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert 'token' in data
        assert data['urn'] == payload['urn']
        assert data['address'] == payload['address']
        assert data['is_minted'] == False
        print(f"✓ Signup success: urn={data['urn']}, has_token={bool(data.get('token'))}")
        return data
    
    def test_signup_duplicate_returns_409(self, unique_suffix):
        """POST /api/auth/signup - duplicate URN returns 409"""
        payload = {
            "urn": f"TEST_dup_{unique_suffix}",
            "password": "testpass123",
            "address": f"mDupAddr{unique_suffix[:8]}",
            "network": "btc-testnet"
        }
        # First signup
        response1 = requests.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert response1.status_code == 200
        
        # Duplicate signup
        payload['address'] = f"mDupAddr2{unique_suffix[:6]}"
        response2 = requests.post(f"{BASE_URL}/api/auth/signup", json=payload)
        assert response2.status_code == 409
        print("✓ Duplicate signup returns 409 as expected")
    
    def test_login_success(self, unique_suffix):
        """POST /api/auth/login - valid credentials"""
        # First create an account
        signup_payload = {
            "urn": f"TEST_login_{unique_suffix}",
            "password": "logintest456",
            "address": f"mLoginAddr{unique_suffix[:8]}",
            "network": "btc-testnet"
        }
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_payload)
        assert signup_res.status_code == 200
        
        # Then login
        login_payload = {
            "urn": f"TEST_login_{unique_suffix}",
            "password": "logintest456"
        }
        response = requests.post(f"{BASE_URL}/api/auth/login", json=login_payload)
        assert response.status_code == 200
        data = response.json()
        assert 'token' in data
        assert data['urn'] == signup_payload['urn']
        print(f"✓ Login success: urn={data['urn']}")
        return data
    
    def test_login_invalid_returns_401(self):
        """POST /api/auth/login - invalid credentials returns 401"""
        payload = {
            "urn": "nonexistent_user_xyz",
            "password": "wrongpassword"
        }
        response = requests.post(f"{BASE_URL}/api/auth/login", json=payload)
        assert response.status_code == 401
        print("✓ Invalid login returns 401 as expected")
    
    def test_me_with_token(self, unique_suffix):
        """GET /api/auth/me - valid token returns user"""
        # Create and login
        signup_payload = {
            "urn": f"TEST_me_{unique_suffix}",
            "password": "metest789",
            "address": f"mMeAddr{unique_suffix[:8]}",
            "network": "btc-testnet"
        }
        signup_res = requests.post(f"{BASE_URL}/api/auth/signup", json=signup_payload)
        token = signup_res.json().get('token')
        
        # Call /me
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data['urn'] == signup_payload['urn']
        assert data['address'] == signup_payload['address']
        print(f"✓ /auth/me success: urn={data['urn']}")
    
    def test_me_without_token_returns_401(self):
        """GET /api/auth/me - no token returns 401"""
        response = requests.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("✓ /auth/me without token returns 401 as expected")


# Feed endpoint
class TestFeedEndpoint:
    """Test feed endpoint"""
    
    def test_feed_btc_testnet(self):
        """GET /api/feed/btc-testnet - returns feed data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'feed' in data
        assert 'network' in data
        assert data['network'] == 'btc-testnet'
        assert isinstance(data['feed'], list)
        assert 'total' in data
        assert 'has_more' in data
        print(f"✓ Feed btc-testnet: {data.get('count', 0)} items, total={data.get('total', 0)}")


# Known Users endpoint
class TestKnownUsersEndpoint:
    """Test known users endpoint"""
    
    def test_known_users_btc_testnet(self):
        """GET /api/known-users/btc-testnet - returns known users"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'users' in data
        assert isinstance(data['users'], list)
        assert 'count' in data
        assert len(data['users']) > 0, "Expected at least some known users"
        # Verify user structure
        sample_user = data['users'][0]
        assert 'address' in sample_user
        assert 'network' in sample_user
        print(f"✓ Known users btc-testnet: {data['count']} users")


# Wallet endpoints
class TestWalletEndpoints:
    """Test wallet-related endpoints"""
    
    def test_wallet_faucets(self):
        """GET /api/wallet/faucets - returns faucet list"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        assert response.status_code == 200
        data = response.json()
        assert 'faucets' in data
        assert isinstance(data['faucets'], list)
        assert len(data['faucets']) > 0
        # Verify faucet structure
        faucet = data['faucets'][0]
        assert 'name' in faucet
        assert 'url' in faucet
        print(f"✓ Wallet faucets: {len(data['faucets'])} faucets available")
    
    def test_wallet_balance(self):
        """GET /api/wallet/balance/<address> - returns balance"""
        # Use a known testnet address
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'address' in data
        assert 'balance_sats' in data
        assert data['address'] == test_address
        print(f"✓ Wallet balance for {test_address[:10]}...: {data.get('balance_sats', 0)} sats")
    
    def test_wallet_utxos(self):
        """GET /api/wallet/utxos/<address> - returns UTXOs"""
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'utxos' in data
        assert 'count' in data
        assert isinstance(data['utxos'], list)
        print(f"✓ Wallet UTXOs for {test_address[:10]}...: {data['count']} UTXOs")


# Objects/Storefront endpoint
class TestStorefrontEndpoint:
    """Test objects storefront endpoint"""
    
    def test_storefront_btc_testnet(self):
        """GET /api/objects/storefront/btc-testnet - returns objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert isinstance(data['objects'], list)
        assert 'total' in data
        assert 'has_more' in data
        print(f"✓ Storefront btc-testnet: {len(data['objects'])} objects, total={data.get('total', 0)}")


# IPFS endpoint
class TestIPFSEndpoint:
    """Test IPFS upload endpoint"""
    
    def test_ipfs_upload(self):
        """POST /api/ipfs/upload - upload file to IPFS"""
        # Create a small test file
        test_content = b"Test content for IPFS upload iteration 46"
        files = {'file': ('test_iter46.txt', test_content, 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files)
        
        # Accept 200 (success), 502 (IPFS daemon busy), or 503 (IPFS daemon not running)
        if response.status_code == 200:
            data = response.json()
            assert data.get('success') == True
            assert 'cid' in data
            print(f"✓ IPFS upload success: cid={data['cid'][:20]}...")
        elif response.status_code in [502, 503]:
            print(f"⚠ IPFS daemon not available (status {response.status_code}) - expected in some environments")
        else:
            pytest.fail(f"Unexpected IPFS upload status: {response.status_code}")


# Profile endpoint
class TestProfileEndpoint:
    """Test profile lookup endpoint"""
    
    def test_profile_by_address(self):
        """GET /api/profile/<address> - returns profile data"""
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"  # embii4u
        response = requests.get(f"{BASE_URL}/api/profile/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert 'address' in data or 'urn' in data
        print(f"✓ Profile lookup: urn={data.get('urn', 'N/A')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
