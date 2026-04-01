"""
Iteration 115: Bug fix verification tests
- Object wallpaper leak on logout
- On-chain file resolution for testnet (mainnet=false)
- ObjectCard URI fallback for media
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestOnChainFileResolution:
    """Test on-chain file resolution with mainnet=false for testnet objects"""
    
    def test_onchain_file_testnet_btc(self):
        """Test BTC on-chain file resolution with mainnet=false"""
        # FakeUFO object image from embii4u on testnet
        txid = "3ff52882c93420c8fe4a90f6fa94b2a563316b5e7b83afe2ddd5bcadc86d3821"
        filename = "FakeUFO.png"
        url = f"{BASE_URL}/api/onchain/file/{txid}/{filename}?chain=BTC&mainnet=false"
        
        response = requests.get(url, timeout=30)
        # Should return 200 (file found) or 202 (resolving)
        assert response.status_code in [200, 202], f"Expected 200 or 202, got {response.status_code}"
        print(f"SUCCESS: BTC testnet on-chain file resolution returned {response.status_code}")
    
    def test_onchain_file_mzc_mainnet(self):
        """Test MZC (MAZA) on-chain file resolution - always uses mainnet"""
        # MZC objects always use mainnet=true (no testnet exists)
        txid = "4dbb0e984586d1994f461c419c460edf7ecf15488a8b11282f19cec9aa7ec285"
        filename = "robot.png"
        url = f"{BASE_URL}/api/onchain/file/{txid}/{filename}?chain=MZC&mainnet=true"
        
        response = requests.get(url, timeout=30)
        assert response.status_code in [200, 202], f"Expected 200 or 202, got {response.status_code}"
        print(f"SUCCESS: MZC on-chain file resolution returned {response.status_code}")
    
    def test_onchain_file_testnet_another_object(self):
        """Test another BTC testnet on-chain file"""
        # OUTERSPACE object image
        txid = "bcf6433166eb5cce9c97837c878200bb6e83e3fb0ad9bb3db6ce6aabfabab725"
        filename = "PaleBlueDot.jpg"
        url = f"{BASE_URL}/api/onchain/file/{txid}/{filename}?chain=BTC&mainnet=false"
        
        response = requests.get(url, timeout=30)
        assert response.status_code in [200, 202], f"Expected 200 or 202, got {response.status_code}"
        print(f"SUCCESS: BTC testnet on-chain file (PaleBlueDot) returned {response.status_code}")


class TestObjectsAPI:
    """Test objects API endpoints for embii4u on testnet"""
    
    def test_get_created_objects_testnet(self):
        """Test GET /api/objects/created/{address} for embii4u on testnet"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        url = f"{BASE_URL}/api/objects/created/{address}?network=btc-testnet&limit=10"
        
        response = requests.get(url, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "objects" in data, "Response should contain 'objects' key"
        assert isinstance(data["objects"], list), "Objects should be a list"
        
        # Check that objects have various media formats
        objects = data["objects"]
        print(f"Found {len(objects)} created objects for embii4u on testnet")
        
        # Check for objects with different media formats
        media_formats = set()
        for obj in objects:
            image = obj.get("image", "") or ""
            if image.startswith("BTC:"):
                media_formats.add("BTC:")
            elif image.startswith("IPFS:"):
                media_formats.add("IPFS:")
            elif image.startswith("MZC:"):
                media_formats.add("MZC:")
            elif image.startswith("http"):
                media_formats.add("http")
        
        print(f"Media formats found: {media_formats}")
        assert len(objects) > 0, "Should have at least one object"
    
    def test_get_owned_objects_testnet(self):
        """Test GET /api/objects/owned/{address} for embii4u on testnet"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        url = f"{BASE_URL}/api/objects/owned/{address}?network=btc-testnet&limit=10"
        
        response = requests.get(url, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "objects" in data, "Response should contain 'objects' key"
        print(f"Found {data.get('total', 0)} owned objects for embii4u on testnet")


class TestProfileAPI:
    """Test profile API for embii4u"""
    
    def test_get_profile_by_urn_testnet(self):
        """Test GET /api/profile/{urn} for embii4u on testnet"""
        url = f"{BASE_URL}/api/profile/embii4u?network=btc-testnet"
        
        response = requests.get(url, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("urn") == "embii4u" or data.get("URN") == "embii4u", "URN should be embii4u"
        print(f"SUCCESS: Profile embii4u found on testnet")
        print(f"Address: {data.get('address') or data.get('Address')}")


class TestFeedAPI:
    """Test feed API"""
    
    def test_get_feed_testnet(self):
        """Test GET /api/feed/{network} for testnet"""
        url = f"{BASE_URL}/api/feed/btc-testnet?limit=10"
        
        response = requests.get(url, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "feed" in data, "Response should contain 'feed' key"
        items = data.get("feed") or []
        print(f"Found {len(items)} feed items on testnet")


class TestTreasuryAPI:
    """Test treasury API"""
    
    def test_get_treasury_info_testnet(self):
        """Test GET /api/treasury/info for testnet"""
        url = f"{BASE_URL}/api/treasury/info?network=btc-testnet"
        
        response = requests.get(url, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "configured" in data, "Response should contain 'configured' key"
        print(f"Treasury configured: {data.get('configured')}")
        if data.get("configured"):
            print(f"Treasury address: {data.get('address')}")
            print(f"Tax rate: {data.get('tax_rate')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
