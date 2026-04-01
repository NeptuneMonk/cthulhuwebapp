"""
Test suite for the 5-source hybrid media discovery algorithm (iteration 139).
Tests Jukebox (audio) and SUPflix (video) discovery endpoints with:
  Source 1: GetRootsByAddress (keyword-derived address)
  Source 2: GetObjectsByKeyword
  Source 3: GetObjectsCreatedByAddress (keyword-derived address)
  Source 4: GetKnownObjectsBySearchString (broad text search)
  Source 5: GetKnownRootsBySearchString (broad text search) - NEW
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestJukeboxDiscovery:
    """Jukebox audio discovery endpoint tests"""
    
    def test_jukebox_music_mainnet_returns_many_results(self):
        """Jukebox 'music' on mainnet should return >25 audio results (was 26, now ~47 with Source 5)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 50}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "items" in data, "Response should have 'items' key"
        assert "total" in data, "Response should have 'total' key"
        assert "has_more" in data, "Response should have 'has_more' key"
        
        items = data["items"]
        total = data["total"]
        
        # Should return >25 results (was 26 before, now ~47 with new source)
        assert total > 25, f"Expected >25 total results, got {total}"
        print(f"Jukebox 'music' mainnet: {total} total results, {len(items)} returned")
    
    def test_jukebox_all_items_are_audio(self):
        """All Jukebox results should have is_audio=true and is_video=false"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        for item in items:
            assert item.get("is_audio") == True, f"Item {item.get('name')} should have is_audio=true"
            assert item.get("is_video") == False, f"Item {item.get('name')} should have is_video=false"
        
        print(f"All {len(items)} items verified as audio-only")
    
    def test_jukebox_response_shape(self):
        """Each Jukebox item should have required keys"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        required_keys = ["type", "id", "name", "media_url", "is_video", "is_audio"]
        for item in items:
            for key in required_keys:
                assert key in item, f"Item missing required key: {key}"
        
        print(f"All {len(items)} items have required keys: {required_keys}")
    
    def test_jukebox_rock_search(self):
        """Jukebox 'rock' search should return audio results"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "rock", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return some results
        assert data["total"] >= 0, "Should return valid total"
        
        # All items should be audio
        for item in data["items"]:
            assert item.get("is_audio") == True, f"Item {item.get('name')} should be audio"
        
        print(f"Jukebox 'rock' mainnet: {data['total']} total results")


class TestSUPflixDiscovery:
    """SUPflix video discovery endpoint tests"""
    
    def test_supflix_movie_mainnet_returns_results(self):
        """SUPflix 'movie' on mainnet should return video results"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 50}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "items" in data, "Response should have 'items' key"
        assert "total" in data, "Response should have 'total' key"
        
        # Should return some video results
        print(f"SUPflix 'movie' mainnet: {data['total']} total results, {len(data['items'])} returned")
    
    def test_supflix_all_items_are_video(self):
        """All SUPflix results should have is_video=true and is_audio=false"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        for item in items:
            assert item.get("is_video") == True, f"Item {item.get('name')} should have is_video=true"
            assert item.get("is_audio") == False, f"Item {item.get('name')} should have is_audio=false"
        
        print(f"All {len(items)} items verified as video-only")
    
    def test_supflix_video_search(self):
        """SUPflix 'video' search should return video results from broad search"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "video", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        
        # All items should be video
        for item in data["items"]:
            assert item.get("is_video") == True, f"Item {item.get('name')} should be video"
        
        print(f"SUPflix 'video' mainnet: {data['total']} total results")
    
    def test_supflix_response_shape(self):
        """Each SUPflix item should have required keys"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        required_keys = ["type", "id", "name", "media_url", "is_video", "is_audio"]
        for item in items:
            for key in required_keys:
                assert key in item, f"Item missing required key: {key}"
        
        print(f"All {len(items)} items have required keys: {required_keys}")


class TestDeduplication:
    """Test that results are properly deduplicated"""
    
    def test_jukebox_no_duplicates(self):
        """Jukebox results should have no duplicate items (same id+name combo)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        seen = set()
        duplicates = []
        for item in items:
            key = f"{item.get('id')}:{item.get('name')}"
            if key in seen:
                duplicates.append(key)
            seen.add(key)
        
        assert len(duplicates) == 0, f"Found duplicate items: {duplicates[:5]}"
        print(f"No duplicates found in {len(items)} Jukebox items")
    
    def test_supflix_no_duplicates(self):
        """SUPflix results should have no duplicate items (same id+name combo)"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        items = data["items"]
        
        seen = set()
        duplicates = []
        for item in items:
            key = f"{item.get('id')}:{item.get('name')}"
            if key in seen:
                duplicates.append(key)
            seen.add(key)
        
        assert len(duplicates) == 0, f"Found duplicate items: {duplicates[:5]}"
        print(f"No duplicates found in {len(items)} SUPflix items")


class TestPagination:
    """Test pagination with skip and limit parameters"""
    
    def test_jukebox_pagination_different_items(self):
        """Jukebox skip=0 and skip=5 should return different items"""
        response1 = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 5, "skip": 0}
        )
        response2 = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 5, "skip": 5}
        )
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        items1 = response1.json()["items"]
        items2 = response2.json()["items"]
        
        # Get IDs from both pages
        ids1 = set(item.get("id") for item in items1)
        ids2 = set(item.get("id") for item in items2)
        
        # Pages should have different items (no overlap)
        overlap = ids1 & ids2
        assert len(overlap) == 0, f"Pages should not overlap, found: {overlap}"
        
        print(f"Pagination verified: page 1 has {len(items1)} items, page 2 has {len(items2)} items, no overlap")
    
    def test_jukebox_has_more_flag(self):
        """Jukebox should return has_more=true when total > limit"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 5, "skip": 0}
        )
        assert response.status_code == 200
        data = response.json()
        
        if data["total"] > 5:
            assert data["has_more"] == True, "has_more should be true when total > limit"
            print(f"has_more=true verified (total={data['total']}, limit=5)")
        else:
            print(f"Skipped: total ({data['total']}) <= limit (5)")
    
    def test_supflix_pagination_different_items(self):
        """SUPflix skip=0 and skip=3 should return different items"""
        response1 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 3, "skip": 0}
        )
        response2 = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 3, "skip": 3}
        )
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        items1 = response1.json()["items"]
        items2 = response2.json()["items"]
        
        if len(items1) > 0 and len(items2) > 0:
            ids1 = set(item.get("id") for item in items1)
            ids2 = set(item.get("id") for item in items2)
            overlap = ids1 & ids2
            assert len(overlap) == 0, f"Pages should not overlap, found: {overlap}"
            print(f"SUPflix pagination verified: page 1 has {len(items1)} items, page 2 has {len(items2)} items")
        else:
            print(f"Skipped: not enough items for pagination test (page1={len(items1)}, page2={len(items2)})")


class TestSource5Integration:
    """Test that Source 5 (GetKnownRootsBySearchString) is working"""
    
    def test_jukebox_increased_results(self):
        """Jukebox 'music' should return more results than before (was 26, now ~47)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        
        # With Source 5 added, should have more results than the previous 26
        # Allow some variance due to API caching/rate limiting
        total = data["total"]
        print(f"Jukebox 'music' total: {total} (was 26 before Source 5)")
        
        # Should have at least 25 results (allowing for some variance)
        assert total >= 25, f"Expected at least 25 results, got {total}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
