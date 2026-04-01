"""
Iteration 43 - Backend API Regression Tests after Modular Router Refactoring

Tests all major API endpoints to ensure the backend refactoring from monolithic
server.py to modular routers maintains full functionality.

Endpoints tested:
- /api/ (root - version)
- /api/health
- /api/known-users/{network}
- /api/known-users/{network}/ranked
- /api/feed/{network}
- /api/profile/{address}
- /api/wallet/utxos/{address}
- /api/wallet/balance/{address}
- /api/wallet/faucets
- /api/objects/storefront/{network}
- /api/search (POST)
- /api/resolve/{address}
- /api/thread/{txid}
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test constants
TEST_NETWORK = 'btc-testnet'
TEST_ADDRESS = 'muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs'
TEST_TXID = '47a3e4f9297f13d0fc06f05f4afc05b77f4c13c3c69a65a82a3cd6b8c7b17285'


class TestCoreEndpoints:
    """Core API endpoint tests - health and version"""
    
    def test_root_endpoint_returns_version(self):
        """Test /api/ returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'version' in data, "Response should contain 'version' field"
        assert 'message' in data, "Response should contain 'message' field"
        assert data['message'] == 'Cthulhu API', f"Expected 'Cthulhu API', got {data['message']}"
        print(f"✓ Root endpoint: version={data['version']}, message={data['message']}")
    
    def test_health_endpoint(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'status' in data, "Response should contain 'status' field"
        assert data['status'] == 'healthy', f"Expected 'healthy', got {data['status']}"
        print(f"✓ Health endpoint: status={data['status']}")


class TestKnownUsersEndpoints:
    """Known users API tests"""
    
    def test_known_users_btc_testnet(self):
        """Test /api/known-users/btc-testnet returns users list"""
        response = requests.get(f"{BASE_URL}/api/known-users/{TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'users' in data, "Response should contain 'users' field"
        assert 'count' in data, "Response should contain 'count' field"
        assert isinstance(data['users'], list), "Users should be a list"
        print(f"✓ Known users: count={data['count']}")
    
    def test_known_users_ranked(self):
        """Test /api/known-users/btc-testnet/ranked returns ranked users"""
        response = requests.get(f"{BASE_URL}/api/known-users/{TEST_NETWORK}/ranked")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'users' in data, "Response should contain 'users' field"
        assert 'count' in data, "Response should contain 'count' field"
        assert 'network' in data, "Response should contain 'network' field"
        assert isinstance(data['users'], list), "Users should be a list"
        print(f"✓ Known users ranked: count={data['count']}, network={data['network']}")


class TestFeedEndpoint:
    """Feed API tests"""
    
    def test_feed_btc_testnet(self):
        """Test /api/feed/btc-testnet returns feed data"""
        response = requests.get(f"{BASE_URL}/api/feed/{TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'feed' in data, "Response should contain 'feed' field"
        assert 'network' in data, "Response should contain 'network' field"
        assert 'total' in data, "Response should contain 'total' field"
        assert isinstance(data['feed'], list), "Feed should be a list"
        assert data['network'] == TEST_NETWORK, f"Expected network {TEST_NETWORK}, got {data['network']}"
        print(f"✓ Feed: count={data.get('count', 0)}, total={data['total']}, has_more={data.get('has_more', False)}")


class TestProfileEndpoint:
    """Profile API tests"""
    
    def test_profile_by_address(self):
        """Test /api/profile/{address} returns profile data"""
        response = requests.get(f"{BASE_URL}/api/profile/{TEST_ADDRESS}?network={TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'address' in data, "Response should contain 'address' field"
        # Profile may or may not have URN depending on if it's registered
        print(f"✓ Profile: address={data.get('address')}, urn={data.get('urn')}, display_name={data.get('display_name')}")


class TestWalletEndpoints:
    """Wallet API tests"""
    
    def test_wallet_utxos(self):
        """Test /api/wallet/utxos/{address} returns UTXOs"""
        response = requests.get(f"{BASE_URL}/api/wallet/utxos/{TEST_ADDRESS}?network={TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'utxos' in data, "Response should contain 'utxos' field"
        assert 'count' in data, "Response should contain 'count' field"
        assert isinstance(data['utxos'], list), "UTXOs should be a list"
        print(f"✓ UTXOs: count={data['count']}, total_sats={data.get('total_sats', 0)}")
    
    def test_wallet_balance(self):
        """Test /api/wallet/balance/{address} returns balance"""
        response = requests.get(f"{BASE_URL}/api/wallet/balance/{TEST_ADDRESS}?network={TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'address' in data, "Response should contain 'address' field"
        assert 'balance_sats' in data, "Response should contain 'balance_sats' field"
        print(f"✓ Balance: address={data['address']}, balance_sats={data['balance_sats']}, balance_btc={data.get('balance_btc', 0)}")
    
    def test_wallet_faucets(self):
        """Test /api/wallet/faucets returns faucets list"""
        response = requests.get(f"{BASE_URL}/api/wallet/faucets")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'faucets' in data, "Response should contain 'faucets' field"
        assert isinstance(data['faucets'], list), "Faucets should be a list"
        assert len(data['faucets']) > 0, "Should have at least one faucet"
        for faucet in data['faucets']:
            assert 'name' in faucet, "Each faucet should have 'name'"
            assert 'url' in faucet, "Each faucet should have 'url'"
        print(f"✓ Faucets: count={len(data['faucets'])}")


class TestObjectsEndpoints:
    """Objects/Storefront API tests"""
    
    def test_storefront(self):
        """Test /api/objects/storefront/{network} returns objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/{TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'objects' in data, "Response should contain 'objects' field"
        assert 'total' in data, "Response should contain 'total' field"
        assert isinstance(data['objects'], list), "Objects should be a list"
        print(f"✓ Storefront: count={len(data['objects'])}, total={data['total']}, total_listed={data.get('total_listed', 0)}")


class TestSearchEndpoint:
    """Search API tests"""
    
    def test_search_post(self):
        """Test /api/search POST with query returns results"""
        response = requests.post(
            f"{BASE_URL}/api/search",
            json={"query": "embii", "network": TEST_NETWORK}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'profiles' in data, "Response should contain 'profiles' field"
        assert 'objects' in data, "Response should contain 'objects' field"
        assert 'query' in data, "Response should contain 'query' field"
        print(f"✓ Search: query={data['query']}, profiles={len(data['profiles'])}, objects={len(data['objects'])}")


class TestResolveEndpoint:
    """Address resolution API tests"""
    
    def test_resolve_address(self):
        """Test /api/resolve/{address} resolves address to URN"""
        response = requests.get(f"{BASE_URL}/api/resolve/{TEST_ADDRESS}?network={TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'address' in data, "Response should contain 'address' field"
        assert 'urn' in data, "Response should contain 'urn' field"
        print(f"✓ Resolve: address={data['address']}, urn={data['urn']}, found={data.get('found', False)}")


class TestThreadEndpoint:
    """Thread API tests"""
    
    def test_thread_by_txid(self):
        """Test /api/thread/{txid} returns thread data"""
        response = requests.get(f"{BASE_URL}/api/thread/{TEST_TXID}?network={TEST_NETWORK}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'thread' in data, "Response should contain 'thread' field"
        assert 'root_txid' in data, "Response should contain 'root_txid' field"
        assert isinstance(data['thread'], list), "Thread should be a list"
        print(f"✓ Thread: root_txid={data['root_txid']}, reply_count={data.get('reply_count', 0)}, count={data.get('count', 0)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
