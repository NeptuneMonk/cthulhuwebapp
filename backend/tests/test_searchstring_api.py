"""
Test SearchString API integration for SUPflix and Jukebox discover endpoints.
Tests the httpx URL fix where extra_params is used instead of embedding query params in path.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestSUPflixDiscover:
    """SUPflix video discovery using SearchString API"""

    def test_supflix_discover_movie_returns_video_results(self):
        """GET /api/supflix/discover with query=movie should return video items"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 5, "skip": 0}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        
        # Verify we got video results
        items = data["items"]
        assert len(items) > 0, "Expected at least one video result for 'movie' search"
        
        # Verify items have required fields
        for item in items:
            assert "name" in item
            assert "media_url" in item
            assert "is_video" in item
            # SUPflix should return video content
            assert item["is_video"] == True, f"Expected video, got: {item['name']}"

    def test_supflix_pagination_returns_different_items(self):
        """Pagination should return different items for skip=0 vs skip=3"""
        # First page
        res1 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 3, "skip": 0}
        )
        assert res1.status_code == 200
        page1_items = [i["name"] for i in res1.json()["items"]]
        
        # Second page
        res2 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 3, "skip": 3}
        )
        assert res2.status_code == 200
        page2_items = [i["name"] for i in res2.json()["items"]]
        
        # Pages should have different items (no overlap)
        overlap = set(page1_items) & set(page2_items)
        assert len(overlap) == 0, f"Pagination failed - overlapping items: {overlap}"


class TestJukeboxDiscover:
    """Jukebox audio discovery using SearchString API"""

    def test_jukebox_discover_music_returns_audio_results(self):
        """GET /api/jukebox/discover with query=music should return audio items"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 5, "skip": 0}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        
        # Verify we got audio results
        items = data["items"]
        assert len(items) > 0, "Expected at least one audio result for 'music' search"
        
        # Verify items have required fields and are audio
        for item in items:
            assert "name" in item
            assert "media_url" in item
            assert "is_audio" in item
            # Jukebox should return audio content
            assert item["is_audio"] == True, f"Expected audio, got: {item['name']}"

    def test_jukebox_radio_search_returns_correct_results(self):
        """GET /api/jukebox/discover with query=radio should NOT return 'GANJA COOKIES'
        
        This tests the httpx URL fix - previously the searchString param was being
        stripped when embedded in the URL path with ?, causing incorrect results.
        """
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "radio", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data["items"]
        assert len(items) > 0, "Expected at least one result for 'radio' search"
        
        # Verify no 'GANJA COOKIES' in results (this was the bug symptom)
        item_names = [i["name"].lower() for i in items]
        assert not any("ganja" in name for name in item_names), \
            f"'radio' search should not return 'GANJA COOKIES'. Got: {item_names}"
        
        # Verify results are actually radio-related
        radio_related = any("radio" in name.lower() for name in item_names)
        assert radio_related, f"Expected radio-related results, got: {item_names}"


class TestResponseStructure:
    """Verify API response structure for frontend compatibility"""

    def test_supflix_response_has_load_more_fields(self):
        """Response should include total and has_more for Load More button"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 3, "skip": 0}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "total" in data, "Response missing 'total' field for Load More"
        assert "has_more" in data, "Response missing 'has_more' field for Load More"
        assert isinstance(data["total"], int)
        assert isinstance(data["has_more"], bool)
        
        # If total > limit, has_more should be True
        if data["total"] > 3:
            assert data["has_more"] == True

    def test_jukebox_response_has_load_more_fields(self):
        """Response should include total and has_more for Load More button"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 3, "skip": 0}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "total" in data, "Response missing 'total' field for Load More"
        assert "has_more" in data, "Response missing 'has_more' field for Load More"
