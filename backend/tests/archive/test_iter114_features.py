"""
Iteration 114 Tests: Theme system, Bright Mode, Wallpapers, Emoji Cache
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

class TestEmojiCacheAPI:
    """Test emoji cache endpoints"""
    
    def test_emoji_cache_post(self):
        """POST /api/emoji/cache should accept emoji and return ok"""
        response = requests.post(
            f"{BASE_URL}/api/emoji/cache",
            json={"emoji": "🔥", "address": "test_address_iter114"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"SUCCESS: POST /api/emoji/cache returned ok=true")
    
    def test_emoji_popular_get(self):
        """GET /api/emoji/popular should return list of cached emojis"""
        response = requests.get(f"{BASE_URL}/api/emoji/popular")
        assert response.status_code == 200
        data = response.json()
        assert "emojis" in data
        assert isinstance(data["emojis"], list)
        print(f"SUCCESS: GET /api/emoji/popular returned {len(data['emojis'])} emojis")
        
        # Verify structure of emoji items
        if len(data["emojis"]) > 0:
            emoji_item = data["emojis"][0]
            assert "emoji" in emoji_item
            assert "count" in emoji_item
            print(f"  First emoji: {emoji_item['emoji']} (count: {emoji_item['count']})")


class TestHealthAndBasicEndpoints:
    """Test basic API health"""
    
    def test_health_endpoint(self):
        """Health endpoint should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("SUCCESS: Health endpoint is healthy")
    
    def test_feed_endpoint(self):
        """Feed endpoint should return posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"limit": 5})
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        print(f"SUCCESS: Feed endpoint returned {len(data.get('feed', []))} posts")


class TestKnownUsersEndpoint:
    """Test known users endpoint for theme/wallpaper testing context"""
    
    def test_known_users(self):
        """Known users endpoint should return user list"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        print(f"SUCCESS: Known users endpoint returned {len(data.get('users', []))} users")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
