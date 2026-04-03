"""
Test suite for iteration 236: On-chain file resolution fixes
Tests the specific fixes for:
1. mempool.space priority in CHAIN_TX_APIS (config.py)
2. mempool.space priority in NETWORKS (blockchain_api.py)
3. TX output cache in utils/blockchain.py
4. Semaphore=8 in onchain.py
5. p2fk.io fast path in onchain.py
6. Backend /api/onchain/file returns 202 for uncached files
"""
import pytest
import requests
import os
import sys

# Add backend to path for direct imports
sys.path.insert(0, '/app/backend')

# Use localhost for faster testing
BASE_URL = 'http://localhost:8001'


class TestBackendHealth:
    """Basic health check tests"""
    
    def test_health_endpoint_returns_200(self):
        """GET /api/health should return 200 with services up"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy", f"Status not healthy: {data}"
        assert "services" in data, "Missing services in health response"
        print(f"✓ Health check passed: {data}")


class TestConfigPriority:
    """Test that mempool.space is prioritized over blockstream.info"""
    
    def test_chain_tx_apis_mempool_first_btc_mainnet(self):
        """CHAIN_TX_APIS should have mempool.space FIRST for BTC mainnet"""
        from config import CHAIN_TX_APIS
        
        btc_mainnet = CHAIN_TX_APIS.get('BTC', {}).get('mainnet', [])
        assert len(btc_mainnet) >= 2, "BTC mainnet should have at least 2 API configs"
        
        first_url = btc_mainnet[0].get('url', '')
        assert 'mempool.space' in first_url, f"First API should be mempool.space, got: {first_url}"
        
        second_url = btc_mainnet[1].get('url', '')
        assert 'blockstream.info' in second_url, f"Second API should be blockstream.info, got: {second_url}"
        print(f"✓ BTC mainnet: mempool.space is FIRST ({first_url})")
    
    def test_chain_tx_apis_mempool_first_btc_testnet(self):
        """CHAIN_TX_APIS should have mempool.space FIRST for BTC testnet"""
        from config import CHAIN_TX_APIS
        
        btc_testnet = CHAIN_TX_APIS.get('BTC', {}).get('testnet', [])
        assert len(btc_testnet) >= 2, "BTC testnet should have at least 2 API configs"
        
        first_url = btc_testnet[0].get('url', '')
        assert 'mempool.space' in first_url, f"First API should be mempool.space, got: {first_url}"
        
        second_url = btc_testnet[1].get('url', '')
        assert 'blockstream.info' in second_url, f"Second API should be blockstream.info, got: {second_url}"
        print(f"✓ BTC testnet: mempool.space is FIRST ({first_url})")


class TestBlockchainApiPriority:
    """Test NETWORKS config in blockchain_api.py"""
    
    def test_networks_mempool_first_btc_mainnet(self):
        """NETWORKS should have mempool FIRST for btc-mainnet explorers"""
        from blockchain_api import NETWORKS
        
        btc_mainnet = NETWORKS.get('btc-mainnet', {})
        explorers = btc_mainnet.get('explorers', [])
        assert len(explorers) >= 2, "btc-mainnet should have at least 2 explorers"
        
        first_name = explorers[0].get('name', '')
        assert first_name == 'mempool', f"First explorer should be 'mempool', got: {first_name}"
        
        second_name = explorers[1].get('name', '')
        assert second_name == 'blockstream', f"Second explorer should be 'blockstream', got: {second_name}"
        print(f"✓ btc-mainnet NETWORKS: mempool is FIRST")
    
    def test_networks_mempool_first_btc_testnet(self):
        """NETWORKS should have mempool FIRST for btc-testnet explorers"""
        from blockchain_api import NETWORKS
        
        btc_testnet = NETWORKS.get('btc-testnet', {})
        explorers = btc_testnet.get('explorers', [])
        assert len(explorers) >= 2, "btc-testnet should have at least 2 explorers"
        
        first_name = explorers[0].get('name', '')
        assert first_name == 'mempool', f"First explorer should be 'mempool', got: {first_name}"
        
        second_name = explorers[1].get('name', '')
        assert second_name == 'blockstream', f"Second explorer should be 'blockstream', got: {second_name}"
        print(f"✓ btc-testnet NETWORKS: mempool is FIRST")


class TestTxOutputCache:
    """Test TX output cache in utils/blockchain.py"""
    
    def test_tx_output_cache_exists(self):
        """_tx_output_cache should exist as a dict"""
        from utils.blockchain import _tx_output_cache
        assert isinstance(_tx_output_cache, dict), "_tx_output_cache should be a dict"
        print(f"✓ _tx_output_cache exists (current size: {len(_tx_output_cache)})")
    
    def test_cache_tx_outputs_function_exists(self):
        """_cache_tx_outputs function should exist"""
        from utils.blockchain import _cache_tx_outputs
        assert callable(_cache_tx_outputs), "_cache_tx_outputs should be callable"
        print("✓ _cache_tx_outputs function exists")
    
    def test_cache_max_constant(self):
        """_TX_CACHE_MAX should be defined"""
        from utils.blockchain import _TX_CACHE_MAX
        assert _TX_CACHE_MAX > 0, "_TX_CACHE_MAX should be positive"
        assert _TX_CACHE_MAX == 5000, f"_TX_CACHE_MAX should be 5000, got: {_TX_CACHE_MAX}"
        print(f"✓ _TX_CACHE_MAX = {_TX_CACHE_MAX}")


class TestOnchainRouteConfig:
    """Test onchain.py configuration"""
    
    def test_semaphore_value_is_8(self):
        """Semaphore in _resolve_ledger should be 8 (not 3)"""
        import inspect
        from routes.onchain import _resolve_ledger
        
        source = inspect.getsource(_resolve_ledger)
        assert 'Semaphore(8)' in source, "Semaphore should be 8 in _resolve_ledger"
        assert 'Semaphore(3)' not in source, "Semaphore should NOT be 3"
        print("✓ Semaphore is 8 in _resolve_ledger")
    
    def test_p2fk_io_fast_path_exists(self):
        """p2fk.io root gateway should be in _resolve_onchain_background"""
        import inspect
        from routes.onchain import _resolve_onchain_background
        
        source = inspect.getsource(_resolve_onchain_background)
        assert 'p2fk.io' in source, "p2fk.io should be in _resolve_onchain_background"
        assert 'p2fk.io/root' in source, "p2fk.io/root gateway should be used"
        print("✓ p2fk.io fast path exists in _resolve_onchain_background")
    
    def test_bitfossil_fast_path_exists(self):
        """bitfossil.com gateway should also be in _resolve_onchain_background"""
        import inspect
        from routes.onchain import _resolve_onchain_background
        
        source = inspect.getsource(_resolve_onchain_background)
        assert 'bitfossil' in source, "bitfossil should be in _resolve_onchain_background"
        print("✓ bitfossil fast path exists in _resolve_onchain_background")


class TestOnchainFileEndpoint:
    """Test /api/onchain/file endpoint behavior"""
    
    def test_onchain_file_returns_202_for_uncached(self):
        """GET /api/onchain/file/{txid}/{filename} should return 202 for uncached files"""
        # Use a random-looking txid that won't be cached
        fake_txid = "0000000000000000000000000000000000000000000000000000000000000001"
        filename = "test.txt"
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{fake_txid}/{filename}",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=15
        )
        
        # Should return 202 (resolving) or 404 (failed after timeout)
        # The key is it should NOT return 500 or hang
        assert response.status_code in [202, 404], f"Expected 202 or 404, got: {response.status_code}"
        
        if response.status_code == 202:
            data = response.json()
            assert data.get("status") == "resolving", f"Expected status=resolving, got: {data}"
            print(f"✓ Uncached file returns 202 with status=resolving")
        else:
            data = response.json()
            assert "failed" in str(data).lower() or "not found" in str(data).lower(), f"404 should indicate failure: {data}"
            print(f"✓ Uncached file returns 404 (failed resolution)")
    
    def test_onchain_status_endpoint(self):
        """GET /api/onchain/status/{txid} should work"""
        # Use a known testnet txid or fake one
        fake_txid = "0000000000000000000000000000000000000000000000000000000000000001"
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/status/{fake_txid}",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=15
        )
        
        # Should return 200 with resolvable status
        assert response.status_code == 200, f"Expected 200, got: {response.status_code}"
        data = response.json()
        assert "resolvable" in data, f"Response should have 'resolvable' field: {data}"
        print(f"✓ /api/onchain/status returns proper response: {data}")


class TestDetectChainEndpoint:
    """Test /api/onchain/detect-chain endpoint"""
    
    def test_detect_chain_btc_mainnet_address(self):
        """Should detect BTC mainnet from address starting with '1'"""
        # BTC mainnet address (version byte 0x00)
        address = "19yMYv9hRRG7tD36eFHPoFeaA2x82CrcGC"
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/detect-chain/{address}",
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got: {response.status_code}"
        data = response.json()
        assert data.get("chain") == "BTC", f"Expected chain=BTC, got: {data}"
        assert data.get("mainnet") == True, f"Expected mainnet=True, got: {data}"
        print(f"✓ Detected BTC mainnet from address: {data}")
    
    def test_detect_chain_btc_testnet_address(self):
        """Should detect BTC testnet from address starting with 'm' or 'n'"""
        # BTC testnet address (version byte 0x6F)
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/detect-chain/{address}",
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got: {response.status_code}"
        data = response.json()
        assert data.get("chain") == "BTC", f"Expected chain=BTC, got: {data}"
        assert data.get("mainnet") == False, f"Expected mainnet=False, got: {data}"
        print(f"✓ Detected BTC testnet from address: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
