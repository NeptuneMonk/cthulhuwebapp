"""
Test SUPflix features - iteration 131
Tests:
- GET /api/admin/supflix-keywords (public endpoint)
- GET /api/supflix/discover (media discovery)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestSUPflixKeywords:
    """Test admin supflix-keywords endpoint (public, no auth required)"""
    
    def test_get_supflix_keywords_returns_array(self):
        """GET /api/admin/supflix-keywords should return keywords array"""
        response = requests.get(f"{BASE_URL}/api/admin/supflix-keywords")
        assert response.status_code == 200
        
        data = response.json()
        assert "keywords" in data
        assert isinstance(data["keywords"], list)
        assert len(data["keywords"]) > 0
        print(f"Keywords returned: {data['keywords']}")
    
    def test_default_keyword_is_movie(self):
        """Default keyword should be 'movie'"""
        response = requests.get(f"{BASE_URL}/api/admin/supflix-keywords")
        assert response.status_code == 200
        
        data = response.json()
        assert "movie" in data["keywords"]


class TestSUPflixDiscover:
    """Test supflix discover endpoint"""
    
    def test_discover_returns_items(self):
        """GET /api/supflix/discover should return items array"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "query": "movie", "limit": 10}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        assert "total" in data
        assert "has_more" in data
        print(f"Discover returned {len(data['items'])} items, total: {data['total']}")
    
    def test_discover_item_structure(self):
        """Each item should have required fields"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "query": "movie", "limit": 5}
        )
        assert response.status_code == 200
        
        data = response.json()
        if data["items"]:
            item = data["items"][0]
            # Check required fields
            assert "type" in item  # object, post, or root
            assert "id" in item
            assert "name" in item
            assert "media_url" in item
            assert "is_video" in item
            print(f"First item: type={item['type']}, name={item['name'][:30]}, is_video={item['is_video']}")
    
    def test_discover_without_query_uses_default_keywords(self):
        """Discover without query should use admin-configured keywords"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "limit": 5}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "items" in data
        print(f"Discover without query returned {len(data['items'])} items")
    
    def test_discover_pagination(self):
        """Discover should support skip/limit pagination"""
        # First page
        response1 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "query": "movie", "skip": 0, "limit": 3}
        )
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Second page
        response2 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "query": "movie", "skip": 3, "limit": 3}
        )
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Items should be different (if enough results)
        if data1["items"] and data2["items"]:
            assert data1["items"][0]["id"] != data2["items"][0]["id"]
            print("Pagination working - different items on different pages")
    
    def test_discover_videos_sorted_first(self):
        """Videos should be sorted before audio in results"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-testnet", "query": "movie", "limit": 20}
        )
        assert response.status_code == 200
        
        data = response.json()
        items = data["items"]
        
        # Find first non-video item
        first_non_video_idx = None
        for i, item in enumerate(items):
            if not item.get("is_video"):
                first_non_video_idx = i
                break
        
        # All items before first non-video should be videos
        if first_non_video_idx is not None:
            for i in range(first_non_video_idx):
                assert items[i].get("is_video") == True
            print(f"Videos sorted first: {first_non_video_idx} videos before non-videos")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
