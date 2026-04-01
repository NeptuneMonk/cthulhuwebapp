"""
Iteration 113: Test emoji caching API and theme/wallpaper features
Tests:
- POST /api/emoji/cache - caches emoji with count increment
- GET /api/emoji/popular - returns cached emojis sorted by count
- GET /api/feed/{network} - feed loads correctly
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestEmojiCacheAPI:
    """Test emoji caching endpoints"""
    
    def test_emoji_cache_endpoint_exists(self):
        """POST /api/emoji/cache should accept emoji and address"""
        response = requests.post(
            f"{BASE_URL}/api/emoji/cache",
            json={"emoji": "🎉", "address": "test_iter113"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"✓ POST /api/emoji/cache returned ok=true")
    
    def test_emoji_cache_increments_count(self):
        """Posting same emoji multiple times should increment count"""
        test_emoji = "🚀"
        
        # Post the emoji twice
        for i in range(2):
            response = requests.post(
                f"{BASE_URL}/api/emoji/cache",
                json={"emoji": test_emoji, "address": f"test_iter113_{i}"}
            )
            assert response.status_code == 200
        
        # Check popular endpoint
        response = requests.get(f"{BASE_URL}/api/emoji/popular")
        assert response.status_code == 200
        data = response.json()
        
        emojis = data.get("emojis", [])
        rocket_emoji = next((e for e in emojis if e["emoji"] == test_emoji), None)
        
        # Should exist with count >= 2
        assert rocket_emoji is not None, f"Emoji {test_emoji} not found in popular list"
        assert rocket_emoji["count"] >= 2, f"Expected count >= 2, got {rocket_emoji['count']}"
        print(f"✓ Emoji {test_emoji} has count={rocket_emoji['count']}")
    
    def test_emoji_popular_endpoint_returns_list(self):
        """GET /api/emoji/popular should return list of emojis with count"""
        response = requests.get(f"{BASE_URL}/api/emoji/popular")
        assert response.status_code == 200
        data = response.json()
        
        assert "emojis" in data
        assert isinstance(data["emojis"], list)
        
        if len(data["emojis"]) > 0:
            first = data["emojis"][0]
            assert "emoji" in first
            assert "count" in first
            print(f"✓ Popular emojis: {len(data['emojis'])} items, top: {first['emoji']} (count={first['count']})")
        else:
            print("✓ Popular emojis endpoint works (empty list)")
    
    def test_emoji_popular_sorted_by_count(self):
        """GET /api/emoji/popular should return emojis sorted by count descending"""
        response = requests.get(f"{BASE_URL}/api/emoji/popular")
        assert response.status_code == 200
        data = response.json()
        
        emojis = data.get("emojis", [])
        if len(emojis) >= 2:
            counts = [e["count"] for e in emojis]
            assert counts == sorted(counts, reverse=True), "Emojis not sorted by count descending"
            print(f"✓ Emojis sorted by count: {counts[:5]}")
        else:
            print("✓ Not enough emojis to verify sorting")
    
    def test_emoji_cache_rejects_empty_emoji(self):
        """POST /api/emoji/cache should reject empty emoji"""
        response = requests.post(
            f"{BASE_URL}/api/emoji/cache",
            json={"emoji": "", "address": "test"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == False
        print("✓ Empty emoji rejected with ok=false")
    
    def test_emoji_cache_rejects_long_emoji(self):
        """POST /api/emoji/cache should reject emoji > 20 chars"""
        response = requests.post(
            f"{BASE_URL}/api/emoji/cache",
            json={"emoji": "a" * 25, "address": "test"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == False
        print("✓ Long emoji rejected with ok=false")


class TestFeedAPI:
    """Test feed endpoint loads correctly"""
    
    def test_feed_loads(self):
        """GET /api/feed/btc-testnet should return feed items"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=10")
        assert response.status_code == 200
        data = response.json()
        
        # Feed endpoint returns 'feed' key
        assert "feed" in data
        assert isinstance(data["feed"], list)
        print(f"✓ Feed loaded with {len(data['feed'])} items")
    
    def test_feed_messages_have_required_fields(self):
        """Feed messages should have transaction_id, content, from_address"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?limit=5")
        assert response.status_code == 200
        data = response.json()
        
        messages = data.get("feed", [])
        if len(messages) > 0:
            msg = messages[0]
            assert "transaction_id" in msg or "txid" in msg, "Missing transaction_id"
            assert "content" in msg, "Missing content"
            assert "from_address" in msg, "Missing from_address"
            print(f"✓ Feed message has required fields: txid={msg.get('transaction_id', msg.get('txid', ''))[:12]}...")
        else:
            print("✓ Feed is empty but endpoint works")


class TestOwnedObjectsAPI:
    """Test owned objects endpoint for wallpaper selector"""
    
    def test_owned_objects_endpoint(self):
        """GET /api/objects/owned/{address} should return objects"""
        # Use a known test address
        test_address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{test_address}?network=btc-testnet&limit=10")
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        print(f"✓ Owned objects endpoint returned {len(data.get('objects', []))} objects")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
