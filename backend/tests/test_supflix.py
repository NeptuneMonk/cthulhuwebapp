"""
Test suite for SupFlix video discovery endpoint.
Tests: /api/supflix/discover endpoint for video content discovery.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSupflixDiscovery:
    """SupFlix video discovery endpoint tests"""
    
    def test_supflix_discover_returns_items_array(self):
        """Test that /api/supflix/discover returns items array with correct structure"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 5
        })
        
        # Status code assertion
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Data structure assertions
        data = response.json()
        assert "items" in data, "Response should contain 'items' array"
        assert "total" in data, "Response should contain 'total' count"
        assert "has_more" in data, "Response should contain 'has_more' boolean"
        
        # Validate items is a list
        assert isinstance(data["items"], list), "'items' should be a list"
        assert isinstance(data["total"], int), "'total' should be an integer"
        assert isinstance(data["has_more"], bool), "'has_more' should be a boolean"
        
    def test_supflix_discover_item_fields(self):
        """Test that each item has required fields: type, id, name, media_url, is_video, object_address, creator_address"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 5
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Skip if no items returned
        if len(data["items"]) == 0:
            pytest.skip("No items returned from discovery endpoint")
        
        # Check first item has all required fields
        item = data["items"][0]
        required_fields = ["type", "id", "name", "media_url", "is_video", "object_address", "creator_address"]
        
        for field in required_fields:
            assert field in item, f"Item should contain '{field}' field"
        
        # Validate field types
        assert isinstance(item["type"], str), "'type' should be a string"
        assert item["type"] in ["object", "post"], "'type' should be 'object' or 'post'"
        assert isinstance(item["is_video"], bool), "'is_video' should be a boolean"
        
    def test_supflix_discover_keyword_search(self):
        """Test keyword search with query=Circus returns matching items"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "query": "Circus"
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "items" in data, "Response should contain 'items' array"
        assert isinstance(data["items"], list), "'items' should be a list"
        
        # Should return at least one matching item (The Circus movie)
        if len(data["items"]) > 0:
            # Verify at least one item matches the keyword
            found_match = any(
                "circus" in item.get("name", "").lower() or 
                "circus" in item.get("description", "").lower()
                for item in data["items"]
            )
            assert found_match, "Should find items matching 'Circus' keyword"
            
    def test_supflix_discover_videos_first(self):
        """Test that video content is prioritized (is_video=true items first)"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 30
        })
        
        assert response.status_code == 200
        data = response.json()
        
        if len(data["items"]) < 2:
            pytest.skip("Not enough items to test sorting")
        
        # Check that videos come before non-videos
        video_items = [i for i, item in enumerate(data["items"]) if item.get("is_video")]
        non_video_items = [i for i, item in enumerate(data["items"]) if not item.get("is_video")]
        
        if video_items and non_video_items:
            max_video_index = max(video_items)
            min_non_video_index = min(non_video_items)
            assert max_video_index < min_non_video_index, "Videos should appear before non-videos"
            
    def test_supflix_discover_pagination_skip(self):
        """Test pagination with skip parameter"""
        # First request - no skip
        response1 = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 5,
            "skip": 0
        })
        
        assert response1.status_code == 200
        data1 = response1.json()
        
        if data1["total"] <= 5:
            pytest.skip("Not enough items to test pagination")
        
        # Second request - skip first 5
        response2 = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 5,
            "skip": 5
        })
        
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Verify different items returned
        ids1 = [item["id"] for item in data1["items"]]
        ids2 = [item["id"] for item in data2["items"]]
        
        # No overlap between pages
        assert not set(ids1) & set(ids2), "Paginated results should not overlap"
        
    def test_supflix_discover_media_url_format(self):
        """Test that media_url is a valid URL format"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "limit": 10
        })
        
        assert response.status_code == 200
        data = response.json()
        
        for item in data["items"]:
            media_url = item.get("media_url", "")
            if media_url:
                assert media_url.startswith("http"), f"media_url should be an HTTP URL: {media_url}"
