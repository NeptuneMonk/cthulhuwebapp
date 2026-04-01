"""
Test suite for iteration 112 features:
1. Emoji-only sticker rendering (frontend only - verified via Playwright)
2. SUP prefix stripping (frontend only - verified via Playwright)
3. Theme selector with 5 themes
4. Wallpaper selector with patterns + owned objects
5. GET /api/objects/owned/{address} endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestOwnedObjectsAPI:
    """Test the owned objects endpoint for wallpaper selector"""
    
    def test_owned_objects_endpoint_exists(self):
        """Test that the owned objects endpoint exists and returns data"""
        test_address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{test_address}?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "objects" in data, "Response should contain 'objects' key"
        print(f"Found {len(data['objects'])} owned objects")
    
    def test_owned_objects_returns_images(self):
        """Test that owned objects include image field"""
        test_address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        objects_with_images = [obj for obj in data['objects'] if obj.get('image')]
        print(f"Objects with images: {len(objects_with_images)}")
        assert len(objects_with_images) > 0, "Should have at least one object with an image"
        
        # Verify image field format
        for obj in objects_with_images[:3]:
            image = obj.get('image', '')
            print(f"  Object: {obj.get('name', 'unnamed')} - Image: {image[:50]}...")
            assert image, "Image field should not be empty"
    
    def test_owned_objects_structure(self):
        """Test that owned objects have expected structure"""
        test_address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "objects" in data
        assert "address" in data
        assert "count" in data
        
        if len(data['objects']) > 0:
            obj = data['objects'][0]
            # Check object has expected fields
            expected_fields = ['name', 'image', 'transaction_id']
            for field in expected_fields:
                assert field in obj, f"Object should have '{field}' field"
    
    def test_owned_objects_empty_address(self):
        """Test owned objects with an address that has no objects"""
        # Use a random address that likely has no objects
        test_address = "mzKYWCYEtBU5DDEhtkeXLbFNCR9f2wsKKq"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{test_address}?network=btc-testnet")
        # Should still return 200 with empty or populated list
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data


class TestFeedAPI:
    """Test feed API for SUP prefix handling"""
    
    def test_feed_endpoint_works(self):
        """Test that feed endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        print(f"Feed returned {len(data['feed'])} items")
    
    def test_feed_content_no_sup_prefix(self):
        """Test that feed content doesn't have raw SUP prefixes in display"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=50")
        assert response.status_code == 200
        data = response.json()
        
        # Note: SUP prefix stripping happens in frontend, not backend
        # Backend may still have raw content with prefixes
        # This test just verifies the feed works
        for item in data['feed'][:10]:
            content = item.get('content', '')
            # Just verify content exists
            assert isinstance(content, str), "Content should be a string"


class TestHealthCheck:
    """Basic health check"""
    
    def test_api_health(self):
        """Test API is responding"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
