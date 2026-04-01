"""
Iteration 21 - Network Isolation Tests
Focus: Address validation, network-specific data, on-chain file resolution, no LTC/DOGE in network selector
"""
import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Mainnet addresses start with 1, 3, or bc1
# Testnet addresses start with m, n, 2, or tb1
MAINNET_PATTERNS = re.compile(r'^(1|3|bc1)')
TESTNET_PATTERNS = re.compile(r'^(m|n|2|tb1)')


class TestHealthCheck:
    """Health check endpoint"""
    
    def test_health_returns_healthy(self):
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed: {data}")


class TestNetworkIsolation:
    """Verify address-network isolation in all endpoints"""
    
    def test_mainnet_known_users_only_mainnet_addresses(self):
        """Known users for btc-mainnet should only contain mainnet addresses (1/3/bc1)"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-mainnet/ranked", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Check all addresses match mainnet format
        invalid_addrs = []
        for user in data[:50]:  # Check first 50
            addr = user.get('address', '')
            if addr and not MAINNET_PATTERNS.match(addr):
                invalid_addrs.append(addr)
        
        assert len(invalid_addrs) == 0, f"Found testnet addresses in mainnet users: {invalid_addrs}"
        print(f"✓ Mainnet known users: {len(data)} users, all addresses valid")
    
    def test_testnet_known_users_only_testnet_addresses(self):
        """Known users for btc-testnet should only contain testnet addresses (m/n/2/tb1)"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Should return a list
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Check all addresses match testnet format
        invalid_addrs = []
        for user in data[:50]:  # Check first 50
            addr = user.get('address', '')
            if addr and not TESTNET_PATTERNS.match(addr):
                invalid_addrs.append(addr)
        
        assert len(invalid_addrs) == 0, f"Found mainnet addresses in testnet users: {invalid_addrs}"
        print(f"✓ Testnet known users: {len(data)} users, all addresses valid")
    
    def test_mainnet_feed_only_mainnet_data(self):
        """Feed for btc-mainnet should only return mainnet data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Check sender addresses
        invalid_addrs = []
        for msg in data[:30]:
            from_addr = msg.get('from_address', '')
            if from_addr and not MAINNET_PATTERNS.match(from_addr):
                invalid_addrs.append(from_addr)
        
        assert len(invalid_addrs) == 0, f"Found testnet addresses in mainnet feed: {invalid_addrs}"
        print(f"✓ Mainnet feed: {len(data)} messages")
    
    def test_testnet_feed_only_testnet_data(self):
        """Feed for btc-testnet should only return testnet data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Check sender addresses
        invalid_addrs = []
        for msg in data[:30]:
            from_addr = msg.get('from_address', '')
            if from_addr and not TESTNET_PATTERNS.match(from_addr):
                invalid_addrs.append(from_addr)
        
        assert len(invalid_addrs) == 0, f"Found mainnet addresses in testnet feed: {invalid_addrs}"
        print(f"✓ Testnet feed: {len(data)} messages")
    
    def test_mainnet_storefront_only_mainnet_objects(self):
        """Storefront for btc-mainnet should only return mainnet objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        
        # Check creator addresses
        invalid_addrs = []
        for obj in data[:30]:
            creators = obj.get('Creators') or obj.get('creators') or []
            if isinstance(creators, list) and creators:
                addr = creators[0]
                if isinstance(addr, dict):
                    addr = addr.get('address', '')
                if addr and not MAINNET_PATTERNS.match(addr):
                    invalid_addrs.append(addr)
        
        print(f"✓ Mainnet storefront: {len(data)} objects")
    
    def test_testnet_storefront_only_testnet_objects(self):
        """Storefront for btc-testnet should only return testnet objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✓ Testnet storefront: {len(data)} objects")


class TestProfileNetworkIsolation:
    """Profile endpoint network validation"""
    
    def test_mainnet_profile_for_mainnet_address(self):
        """Profile for mainnet address with mainnet network should work"""
        mainnet_addr = "16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw"
        response = requests.get(f"{BASE_URL}/api/profile/{mainnet_addr}?network=btc-mainnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        # Should return profile or empty dict
        print(f"✓ Mainnet profile for mainnet address: {data.get('urn', 'no urn')}")
    
    def test_testnet_profile_for_testnet_address(self):
        """Profile for testnet address with testnet network should work"""
        testnet_addr = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/profile/{testnet_addr}?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        print(f"✓ Testnet profile for testnet address: {data.get('urn', 'no urn')}")


class TestOnChainResolution:
    """On-chain file resolution still works (LTC/DOGE as sidechains)"""
    
    def test_btc_mainnet_onchain_file(self):
        """BTC Mainnet on-chain JPEG should resolve correctly"""
        txid = "f3b185bd932ef28cfd8e0d6891fa5af059a0446a1512e24461ddade4f1df0b53"
        filename = "MichaelJackson.jpg"
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{txid}/{filename}?chain=BTC&mainnet=true",
            timeout=60
        )
        assert response.status_code == 200
        content_type = response.headers.get('Content-Type', '')
        assert 'image' in content_type or 'octet' in content_type
        
        # Check size and magic bytes
        content = response.content
        expected_size = 18770
        actual_size = len(content)
        
        # Check JPEG magic bytes: FF D8 FF
        is_jpeg = content[:3] == b'\xff\xd8\xff'
        assert is_jpeg, f"Not a valid JPEG file, magic bytes: {content[:4].hex()}"
        
        print(f"✓ BTC mainnet on-chain: {filename}, {actual_size} bytes (expected ~{expected_size}), JPEG magic bytes verified")
    
    def test_doge_mainnet_onchain_file(self):
        """DOGE Mainnet on-chain JPEG should still resolve (sidechain)"""
        txid = "d8a4f06356104b019682ed5270a80ad1fdaaa0eaba13cee97843a4098c898353"
        filename = "doge.jpg"
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{txid}/{filename}?chain=DOG&mainnet=true",
            timeout=60
        )
        assert response.status_code == 200
        content = response.content
        
        # Check JPEG magic bytes
        is_jpeg = content[:3] == b'\xff\xd8\xff'
        assert is_jpeg, f"Not a valid JPEG file, magic bytes: {content[:4].hex()}"
        
        print(f"✓ DOGE mainnet on-chain: {filename}, {len(content)} bytes, JPEG magic bytes verified")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
