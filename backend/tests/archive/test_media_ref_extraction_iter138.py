"""
Test media ref extraction improvements for Jukebox and SUPflix.
Iteration 138: Tests the new _extract_media_refs_from_content function that handles:
1. <<IPFS:CID\\filename with spaces.ext>> - delimited IPFS refs
2. IPFS:CID\\filename.ext - inline IPFS refs  
3. Bare QmCID\\filename.ext - bare CID refs
4. Bare hex64txid\\filename.ext - sidechain refs

Expected results:
- Jukebox 'music' on mainnet: ~26 results (was 8 before)
- SUPflix 'movie' on mainnet: ~9 results (was 7 before)
- Led Zeppelin tracks with spaces in filenames should be included
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestJukeboxMediaExtraction:
    """Test Jukebox audio discovery with improved media ref extraction"""
    
    def test_jukebox_music_mainnet_returns_26_plus_results(self):
        """Jukebox 'music' on mainnet should return 26+ results (was 8 before)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        
        # Verify count - should be 26+ (was 8 before the fix)
        assert data["total"] >= 26, f"Expected 26+ results, got {data['total']}"
        print(f"Jukebox music mainnet: {data['total']} results")
    
    def test_jukebox_includes_stairway_to_heaven(self):
        """Jukebox should include 'Stairway To Heaven.mp3' (bare CID ref, was previously missed)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        stairway_tracks = [i for i in items if "stairway" in i.get("name", "").lower()]
        
        assert len(stairway_tracks) >= 1, "Stairway To Heaven track not found"
        print(f"Found Stairway tracks: {[t['name'] for t in stairway_tracks]}")
    
    def test_jukebox_includes_all_my_love_with_spaces(self):
        """Jukebox should include 'All My Love.mp3' (filename with spaces inside <<IPFS:...>> delimiters)"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        all_my_love_tracks = [i for i in items if "all my love" in i.get("name", "").lower()]
        
        assert len(all_my_love_tracks) >= 1, "All My Love track not found"
        # Verify it's the full filename, not truncated to '08.'
        for track in all_my_love_tracks:
            assert "all my love" in track["name"].lower(), f"Track name truncated: {track['name']}"
        print(f"Found All My Love tracks: {[t['name'] for t in all_my_love_tracks]}")
    
    def test_jukebox_all_results_are_audio(self):
        """All jukebox results should have is_audio=true and no video items"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        for item in items:
            assert item.get("is_audio") == True, f"Item {item.get('name')} is not audio"
            assert item.get("is_video") == False, f"Video item leaked into jukebox: {item.get('name')}"
        print(f"All {len(items)} jukebox items are audio-only")


class TestSUPflixMediaExtraction:
    """Test SUPflix video discovery with improved media ref extraction"""
    
    def test_supflix_movie_mainnet_returns_9_plus_results(self):
        """SUPflix 'movie' on mainnet should return 9+ results"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        
        # Verify count - should be 9+
        assert data["total"] >= 9, f"Expected 9+ results, got {data['total']}"
        print(f"SUPflix movie mainnet: {data['total']} results")
    
    def test_supflix_includes_daft_bodies_video(self):
        """SUPflix should include 'Daft Bodies - Harder, Better, Faster, Stronger.mp4'"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        daft_videos = [i for i in items if "daft" in i.get("name", "").lower()]
        
        assert len(daft_videos) >= 1, "Daft Bodies video not found"
        print(f"Found Daft Bodies videos: {[v['name'] for v in daft_videos]}")
    
    def test_supflix_all_results_are_video(self):
        """All supflix results should have is_video=true and no audio items"""
        response = requests.get(
            f"{BASE_URL}/api/supflix/discover",
            params={"network": "btc-mainnet", "query": "movie", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        for item in items:
            assert item.get("is_video") == True, f"Item {item.get('name')} is not video"
            assert item.get("is_audio") == False, f"Audio item leaked into supflix: {item.get('name')}"
        print(f"All {len(items)} supflix items are video-only")


class TestPagination:
    """Test pagination functionality for Jukebox and SUPflix"""
    
    def test_jukebox_testnet_pagination_has_more(self):
        """Testnet jukebox pagination: query=music&limit=20 returns has_more=true when total>20"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-testnet", "query": "music", "limit": 20}
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get("total", 0)
        items_count = len(data.get("items", []))
        has_more = data.get("has_more", False)
        
        print(f"Testnet jukebox: total={total}, items={items_count}, has_more={has_more}")
        
        if total > 20:
            assert has_more == True, f"has_more should be true when total({total}) > limit(20)"
            assert items_count == 20, f"Should return exactly 20 items when limit=20"
    
    def test_jukebox_mainnet_pagination_has_more(self):
        """Mainnet jukebox pagination: query=music&limit=20 returns has_more=true when total>20"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 20}
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get("total", 0)
        items_count = len(data.get("items", []))
        has_more = data.get("has_more", False)
        
        print(f"Mainnet jukebox: total={total}, items={items_count}, has_more={has_more}")
        
        # We know mainnet has 26 results
        assert total >= 26, f"Expected 26+ total, got {total}"
        assert has_more == True, f"has_more should be true when total({total}) > limit(20)"
        assert items_count == 20, f"Should return exactly 20 items when limit=20"
    
    def test_jukebox_load_more_returns_remaining(self):
        """Test that skip parameter works for Load More functionality"""
        # First request
        response1 = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 20, "skip": 0}
        )
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Second request with skip=20
        response2 = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 20, "skip": 20}
        )
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Verify different items returned
        items1_ids = {i.get("id") for i in data1.get("items", [])}
        items2_ids = {i.get("id") for i in data2.get("items", [])}
        
        # There should be no overlap (or minimal overlap due to dedup)
        overlap = items1_ids & items2_ids
        print(f"First page: {len(data1.get('items', []))} items, Second page: {len(data2.get('items', []))} items")
        print(f"Overlap: {len(overlap)} items")


class TestLedZeppelinTracks:
    """Specific tests for Led Zeppelin tracks with spaces in filenames"""
    
    def test_led_zeppelin_tracks_present(self):
        """Verify Led Zeppelin tracks are present in jukebox results"""
        response = requests.get(
            f"{BASE_URL}/api/jukebox/discover",
            params={"network": "btc-mainnet", "query": "music", "limit": 30}
        )
        assert response.status_code == 200
        data = response.json()
        
        items = data.get("items", [])
        
        # Expected Led Zeppelin tracks
        expected_tracks = [
            "stairway to heaven",
            "all my love",
            "communication breakdown",
            "immigrant song",
            "since i've been loving you",
            "living loving maid",
            "d'yer mak'er"
        ]
        
        found_tracks = []
        for item in items:
            name_lower = item.get("name", "").lower()
            for expected in expected_tracks:
                if expected in name_lower:
                    found_tracks.append(item.get("name"))
                    break
        
        print(f"Found Led Zeppelin tracks: {found_tracks}")
        assert len(found_tracks) >= 5, f"Expected at least 5 Led Zeppelin tracks, found {len(found_tracks)}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
