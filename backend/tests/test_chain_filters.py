"""
Test suite for Storefront Chain Filter functionality (P0 bug fix)
Tests the new /api/objects/by-chain/{chain} endpoint that replaced the infinite loading while loop.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')


class TestHealthCheck:
    """Basic health check to ensure API is running"""
    
    def test_health_endpoint(self):
        """Test that the health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed: {data}")


class TestChainFilterEndpoints:
    """Test the new /api/objects/by-chain/{chain} endpoint for each chain"""
    
    def test_mzc_chain_filter(self):
        """Test MZC chain filter returns objects with MZC prefix in URN/URI/Image"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/MZC?network=btc-testnet&skip=0&qty=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert "total" in data
        assert "chain" in data
        assert data["chain"] == "MZC"
        
        # Verify objects have MZC prefix
        objects = data.get("objects", [])
        print(f"✓ MZC filter: {len(objects)} objects returned, total={data.get('total', 0)}")
        
        # Check at least some objects have MZC in URN/URI/Image
        mzc_found = False
        for obj in objects[:5]:
            obj_data = obj.get("object", obj)
            urn = obj_data.get("URN", "") or ""
            uri = obj_data.get("URI", "") or ""
            image = obj_data.get("Image", "") or ""
            if "MZC:" in urn.upper() or "MZC:" in uri.upper() or "MZC:" in image.upper():
                mzc_found = True
                break
        
        assert mzc_found or len(objects) == 0, "MZC objects should have MZC prefix in URN/URI/Image"
    
    def test_dog_chain_filter(self):
        """Test DOG chain filter returns objects with DOG prefix"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/DOG?network=btc-testnet&skip=0&qty=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert data["chain"] == "DOG"
        
        objects = data.get("objects", [])
        print(f"✓ DOG filter: {len(objects)} objects returned, total={data.get('total', 0)}")
        
        # Expected ~11 DOG objects based on API response
        assert data.get("total", 0) >= 10, "Expected at least 10 DOG objects"
    
    def test_ltc_chain_filter(self):
        """Test LTC chain filter returns objects with LTC prefix"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/LTC?network=btc-testnet&skip=0&qty=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert data["chain"] == "LTC"
        
        objects = data.get("objects", [])
        print(f"✓ LTC filter: {len(objects)} objects returned, total={data.get('total', 0)}")
    
    def test_ipfs_chain_filter(self):
        """Test IPFS chain filter returns objects with IPFS prefix"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/IPFS?network=btc-testnet&skip=0&qty=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert data["chain"] == "IPFS"
        
        objects = data.get("objects", [])
        print(f"✓ IPFS filter: {len(objects)} objects returned, total={data.get('total', 0)}")
        
        # IPFS should have the most objects
        assert data.get("total", 0) >= 100, "Expected at least 100 IPFS objects"
    
    def test_btc_chain_filter(self):
        """Test BTC chain filter returns objects with BTC prefix"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/BTC?network=btc-testnet&skip=0&qty=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert data["chain"] == "BTC"
        
        objects = data.get("objects", [])
        print(f"✓ BTC filter: {len(objects)} objects returned, total={data.get('total', 0)}")
    
    def test_invalid_chain_filter(self):
        """Test that invalid chain returns empty results"""
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/INVALID?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("objects") == []
        assert data.get("total") == 0
        print("✓ Invalid chain filter returns empty results")
    
    def test_pagination(self):
        """Test pagination works correctly for chain filter"""
        # Get first page
        response1 = requests.get(f"{BASE_URL}/api/objects/by-chain/IPFS?network=btc-testnet&skip=0&qty=5")
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Get second page
        response2 = requests.get(f"{BASE_URL}/api/objects/by-chain/IPFS?network=btc-testnet&skip=5&qty=5")
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Verify different objects on each page
        page1_urns = set()
        for obj in data1.get("objects", []):
            obj_data = obj.get("object", obj)
            page1_urns.add(obj_data.get("URN", ""))
        
        page2_urns = set()
        for obj in data2.get("objects", []):
            obj_data = obj.get("object", obj)
            page2_urns.add(obj_data.get("URN", ""))
        
        # Pages should have different objects
        overlap = page1_urns.intersection(page2_urns)
        assert len(overlap) == 0, f"Pagination should return different objects, found overlap: {overlap}"
        print("✓ Pagination works correctly")


class TestStorefrontProxy:
    """Test the existing proxy endpoint for 'All' filter"""
    
    def test_proxy_search_objects(self):
        """Test the proxy search endpoint used by 'All' filter"""
        response = requests.get(f"{BASE_URL}/api/p2fk/search/objects?searchString=*&qty=20&skip=0&network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"✓ Proxy search: {len(data)} objects returned")
        
        # Verify objects have expected structure
        if len(data) > 0:
            obj = data[0]
            # Can be wrapped {object: {...}, blockchain: "..."} or flat
            obj_data = obj.get("object", obj)
            assert "Name" in obj_data or "name" in obj_data or "URN" in obj_data


class TestObjectDetail:
    """Test object detail endpoints"""
    
    def test_object_by_address(self):
        """Test fetching object by address"""
        # Use a known object address from MZC filter
        response = requests.get(f"{BASE_URL}/api/objects/by-chain/MZC?network=btc-testnet&skip=0&qty=1")
        if response.status_code == 200:
            data = response.json()
            objects = data.get("objects", [])
            if objects:
                obj = objects[0].get("object", objects[0])
                creators = obj.get("Creators", {})
                if isinstance(creators, dict) and creators:
                    obj_addr = list(creators.keys())[0]
                    
                    # Fetch object by address
                    detail_response = requests.get(f"{BASE_URL}/api/object/addr/{obj_addr}?network=btc-testnet")
                    assert detail_response.status_code == 200
                    detail = detail_response.json()
                    
                    assert "name" in detail or "urn" in detail
                    print(f"✓ Object detail by address: {detail.get('name', 'N/A')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
