"""
Test suite for Jukebox, SUPflix, and IPFS Blacklist features - Iteration 134
Tests: Jukebox audio discovery, SUPflix video discovery, IPFS blacklist management, admin keywords
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')


class TestJukeboxAPI:
    """Jukebox audio discovery endpoint tests"""
    
    def test_jukebox_discover_returns_audio_items(self):
        """GET /api/jukebox/discover returns audio items"""
        response = requests.get(f"{BASE_URL}/api/jukebox/discover", params={
            "network": "btc-testnet",
            "query": "music",
            "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        # Verify items are audio type
        for item in data["items"][:5]:
            assert "is_audio" in item
            assert "media_url" in item
            assert "name" in item
            print(f"Audio item: {item.get('name', 'Untitled')[:50]}")
    
    def test_jukebox_discover_with_custom_query(self):
        """GET /api/jukebox/discover with custom search query"""
        response = requests.get(f"{BASE_URL}/api/jukebox/discover", params={
            "network": "btc-testnet",
            "query": "song",
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data.get("items"), list)
        print(f"Found {len(data['items'])} audio items for 'song' query")
    
    def test_jukebox_keywords_endpoint(self):
        """GET /api/admin/jukebox-keywords returns keywords list"""
        response = requests.get(f"{BASE_URL}/api/admin/jukebox-keywords")
        assert response.status_code == 200
        data = response.json()
        assert "keywords" in data
        assert isinstance(data["keywords"], list)
        assert len(data["keywords"]) > 0
        print(f"Jukebox keywords: {data['keywords']}")


class TestSUPflixAPI:
    """SUPflix video discovery endpoint tests"""
    
    def test_supflix_discover_returns_video_items(self):
        """GET /api/supflix/discover returns video items"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "query": "movie",
            "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "has_more" in data
        # Verify items are video type
        for item in data["items"][:5]:
            assert "is_video" in item
            assert "media_url" in item
            assert "name" in item
            print(f"Video item: {item.get('name', 'Untitled')[:50]}")
    
    def test_supflix_discover_with_custom_query(self):
        """GET /api/supflix/discover with custom search query"""
        response = requests.get(f"{BASE_URL}/api/supflix/discover", params={
            "network": "btc-testnet",
            "query": "anime",
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data.get("items"), list)
        print(f"Found {len(data['items'])} video items for 'anime' query")
    
    def test_supflix_keywords_endpoint(self):
        """GET /api/admin/supflix-keywords returns keywords list"""
        response = requests.get(f"{BASE_URL}/api/admin/supflix-keywords")
        assert response.status_code == 200
        data = response.json()
        assert "keywords" in data
        assert isinstance(data["keywords"], list)
        assert len(data["keywords"]) > 0
        print(f"SUPflix keywords: {data['keywords']}")


class TestIPFSBlacklist:
    """IPFS blacklist management endpoint tests"""
    
    def test_get_blacklist(self):
        """GET /api/ipfs/blacklist returns blacklisted items"""
        response = requests.get(f"{BASE_URL}/api/ipfs/blacklist")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        print(f"Blacklist has {data['total']} items")
    
    def test_report_dead_ipfs_link(self):
        """POST /api/ipfs/report-dead adds ref to blacklist"""
        test_ref = "TEST_dead_link_pytest_134"
        response = requests.post(f"{BASE_URL}/api/ipfs/report-dead", json={
            "ref": test_ref,
            "reason": "pytest_test"
        })
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        assert data.get("ref") == test_ref
        print(f"Reported dead link: {test_ref}")
        
        # Verify it's in the blacklist
        blacklist_response = requests.get(f"{BASE_URL}/api/ipfs/blacklist")
        blacklist_data = blacklist_response.json()
        refs = [item.get("ref") for item in blacklist_data.get("items", [])]
        assert test_ref in refs, "Reported ref should be in blacklist"
        
        # Cleanup: remove the test ref
        delete_response = requests.delete(f"{BASE_URL}/api/ipfs/blacklist/{test_ref}")
        assert delete_response.status_code == 200
        print(f"Cleaned up test ref: {test_ref}")
    
    def test_remove_from_blacklist(self):
        """DELETE /api/ipfs/blacklist/{ref} removes from blacklist"""
        # First add a test ref
        test_ref = "TEST_remove_pytest_134"
        requests.post(f"{BASE_URL}/api/ipfs/report-dead", json={
            "ref": test_ref,
            "reason": "pytest_delete_test"
        })
        
        # Now delete it
        response = requests.delete(f"{BASE_URL}/api/ipfs/blacklist/{test_ref}")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"Removed from blacklist: {test_ref}")
        
        # Verify it's no longer in the blacklist
        blacklist_response = requests.get(f"{BASE_URL}/api/ipfs/blacklist")
        blacklist_data = blacklist_response.json()
        refs = [item.get("ref") for item in blacklist_data.get("items", [])]
        assert test_ref not in refs, "Deleted ref should not be in blacklist"


class TestDiscoverPageAPI:
    """Tests for Discover page related APIs (used by DiscoverPage.js)"""
    
    def test_discover_page_uses_p2fk_api(self):
        """Verify the P2FK API endpoints used by DiscoverPage work"""
        # DiscoverPage.js calls p2fk.io directly, but we can verify the backend
        # doesn't break when similar queries are made
        response = requests.get(f"{BASE_URL}/api/jukebox/discover", params={
            "network": "btc-testnet",
            "query": "test",
            "limit": 5
        })
        assert response.status_code == 200
        print("Discover-related API working")


class TestAdminDashboardKeywords:
    """Tests for admin dashboard keyword management"""
    
    def test_admin_login_required_for_settings(self):
        """GET /api/admin/settings requires authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/settings")
        # Should return 403 or 401 without auth
        assert response.status_code in [401, 403, 422]
        print("Admin settings properly protected")
    
    def test_public_keywords_endpoints_accessible(self):
        """Public keyword endpoints don't require auth"""
        # Jukebox keywords
        jukebox_response = requests.get(f"{BASE_URL}/api/admin/jukebox-keywords")
        assert jukebox_response.status_code == 200
        
        # SUPflix keywords
        supflix_response = requests.get(f"{BASE_URL}/api/admin/supflix-keywords")
        assert supflix_response.status_code == 200
        
        print("Public keyword endpoints accessible without auth")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
