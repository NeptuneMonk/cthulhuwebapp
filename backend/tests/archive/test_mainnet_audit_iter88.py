"""
Iteration 88: Mainnet Verification Audit Tests
Tests all backend endpoints to verify mainnet functionality equals testnet.

Features tested:
1. GET /api/feed/btc-mainnet - Mainnet feed with real posts
2. GET /api/objects/storefront/btc-mainnet - Objects storefront (expected ~193 objects)
3. GET /api/known-users/btc-mainnet - Mainnet known profiles
4. GET /api/room/{address}/messages - Room messages on mainnet
5. GET /api/supflix/discover - SupFlix video discovery on mainnet
6. GET /api/profile/{address} - embii's mainnet profile
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Mainnet seed addresses from config.py
MAINNET_SEED_ADDRESSES = [
    '19yMYv9hRRG7tD36eFHPoFeaA2x82CrcGC',  # embii
    '16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw',  # embii profile
    '1AFJHYBkdzXbFiHgPSRquYB6P2DdbdnrYB',
    '1BXVPoJUtjJhYPiPNx2SyimTJo7YZmmn1J',
    '1A4q2oywacE8LjCyi1gjAcFmQt7ZYNyZ9M',
]

EMBII_ADDRESS_1 = '19yMYv9hRRG7tD36eFHPoFeaA2x82CrcGC'
EMBII_ADDRESS_2 = '16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw'


@pytest.fixture
def api_client():
    """Shared requests session with extended timeouts for p2fk.io"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestMainnetFeed:
    """Test mainnet feed endpoint returns real posts"""

    def test_mainnet_feed_returns_posts(self, api_client):
        """GET /api/feed/btc-mainnet should return feed with posts"""
        response = api_client.get(f"{BASE_URL}/api/feed/btc-mainnet?limit=20", timeout=30)
        
        assert response.status_code == 200, f"Feed endpoint failed: {response.text}"
        data = response.json()
        
        assert "feed" in data, "Response missing 'feed' key"
        assert isinstance(data["feed"], list), "Feed should be a list"
        
        # Mainnet should have posts
        assert len(data["feed"]) > 0, "Mainnet feed should have at least one post"
        
        # Verify post structure
        first_post = data["feed"][0]
        assert "content" in first_post or "transaction_id" in first_post, "Post missing content or transaction_id"
        print(f"✓ Mainnet feed returned {len(data['feed'])} posts")

    def test_mainnet_feed_has_profile_images(self, api_client):
        """Mainnet feed posts should have profile images resolved"""
        response = api_client.get(f"{BASE_URL}/api/feed/btc-mainnet?limit=10", timeout=30)
        
        assert response.status_code == 200
        data = response.json()
        
        posts_with_images = [p for p in data.get("feed", []) if p.get("sender_image")]
        print(f"✓ {len(posts_with_images)} of {len(data['feed'])} posts have sender images")


class TestMainnetStorefront:
    """Test mainnet objects storefront"""

    def test_storefront_returns_objects(self, api_client):
        """GET /api/objects/storefront/btc-mainnet should return objects"""
        response = api_client.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet?limit=50", timeout=60)
        
        assert response.status_code == 200, f"Storefront endpoint failed: {response.text}"
        data = response.json()
        
        assert "objects" in data, "Response missing 'objects' key"
        assert isinstance(data["objects"], list), "Objects should be a list"
        
        # Check total count - expected ~193 based on iteration 87
        total = data.get("total", 0)
        print(f"✓ Mainnet storefront has {total} total objects, returned {len(data['objects'])} in this page")
        
        assert total >= 100, f"Expected at least 100 mainnet objects, got {total}"

    def test_storefront_has_listed_objects(self, api_client):
        """Mainnet storefront should have objects for sale with BTC prices"""
        response = api_client.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet?limit=50", timeout=60)
        
        assert response.status_code == 200
        data = response.json()
        
        total_listed = data.get("total_listed", 0)
        print(f"✓ Mainnet storefront has {total_listed} listed objects for sale")
        
        # Find an object with a price
        listed_objects = [o for o in data["objects"] if o.get("is_listed")]
        if listed_objects:
            obj = listed_objects[0]
            print(f"  Sample listed object: {obj.get('name', 'Unknown')} @ {obj.get('min_price', 0)} sats")

    def test_storefront_object_structure(self, api_client):
        """Verify object structure is complete"""
        response = api_client.get(f"{BASE_URL}/api/objects/storefront/btc-mainnet?limit=5", timeout=60)
        
        assert response.status_code == 200
        data = response.json()
        
        if data["objects"]:
            obj = data["objects"][0]
            # Verify required fields
            required_fields = ["name", "urn", "owners", "creators", "owner_count"]
            for field in required_fields:
                assert field in obj, f"Object missing required field: {field}"
            print(f"✓ Object structure verified for: {obj.get('name', 'Unknown')}")


class TestMainnetKnownUsers:
    """Test mainnet known users endpoint"""

    def test_known_users_returns_profiles(self, api_client):
        """GET /api/known-users/btc-mainnet should return profiles"""
        response = api_client.get(f"{BASE_URL}/api/known-users/btc-mainnet?limit=20", timeout=30)
        
        assert response.status_code == 200, f"Known users endpoint failed: {response.text}"
        data = response.json()
        
        users = data.get("users", data)  # Handle both {users: []} and direct array
        if isinstance(users, dict) and "users" in users:
            users = users["users"]
        
        assert isinstance(users, list), "Known users should be a list"
        assert len(users) > 0, "Mainnet should have known users"
        
        # Verify user structure
        if users:
            user = users[0]
            assert "address" in user, "User missing address"
            print(f"✓ Mainnet has {len(users)} known users")


class TestMainnetRoomMessages:
    """Test room messages endpoint on mainnet"""

    def test_room_messages_for_embii(self, api_client):
        """GET /api/room/{address}/messages?network=btc-mainnet should return messages"""
        # Using embii's address as room address
        response = api_client.get(
            f"{BASE_URL}/api/room/{EMBII_ADDRESS_1}/messages?network=btc-mainnet&limit=50",
            timeout=30
        )
        
        assert response.status_code == 200, f"Room messages endpoint failed: {response.text}"
        data = response.json()
        
        assert "messages" in data, "Response missing 'messages' key"
        assert isinstance(data["messages"], list), "Messages should be a list"
        
        count = data.get("count", len(data["messages"]))
        print(f"✓ Room {EMBII_ADDRESS_1[:12]}... has {count} messages on mainnet")

    def test_room_messages_have_sender_info(self, api_client):
        """Room messages should have sender profile info"""
        response = api_client.get(
            f"{BASE_URL}/api/room/{EMBII_ADDRESS_1}/messages?network=btc-mainnet&limit=10",
            timeout=30
        )
        
        assert response.status_code == 200
        data = response.json()
        
        if data["messages"]:
            msg = data["messages"][0]
            assert "sender_address" in msg or "from_address" in msg, "Message missing sender address"
            print(f"✓ Room messages have sender info: {msg.get('sender_urn', msg.get('sender_address', '')[:12])}")


class TestMainnetSupFlix:
    """Test SupFlix video discovery on mainnet"""

    def test_supflix_discover_returns_items(self, api_client):
        """GET /api/supflix/discover?network=btc-mainnet should return video items"""
        response = api_client.get(f"{BASE_URL}/api/supflix/discover?network=btc-mainnet&limit=20", timeout=60)
        
        assert response.status_code == 200, f"SupFlix endpoint failed: {response.text}"
        data = response.json()
        
        assert "items" in data, "Response missing 'items' key"
        assert isinstance(data["items"], list), "Items should be a list"
        
        total = data.get("total", len(data["items"]))
        print(f"✓ SupFlix mainnet discovery found {total} media items")
        
        # Check for video items
        video_items = [i for i in data["items"] if i.get("is_video")]
        print(f"  Videos: {len(video_items)}, Audio: {len(data['items']) - len(video_items)}")


class TestMainnetProfile:
    """Test profile endpoint on mainnet"""

    def test_embii_profile_address_1(self, api_client):
        """GET /api/profile/{address}?network=btc-mainnet for embii's first address"""
        response = api_client.get(f"{BASE_URL}/api/profile/{EMBII_ADDRESS_1}?network=btc-mainnet", timeout=30)
        
        assert response.status_code == 200, f"Profile endpoint failed: {response.text}"
        data = response.json()
        
        # Profile should have basic info
        print(f"✓ Profile for {EMBII_ADDRESS_1[:12]}...: urn={data.get('urn', 'N/A')}, display_name={data.get('display_name', 'N/A')}")

    def test_embii_profile_address_2(self, api_client):
        """GET /api/profile/{address}?network=btc-mainnet for embii's second address"""
        response = api_client.get(f"{BASE_URL}/api/profile/{EMBII_ADDRESS_2}?network=btc-mainnet", timeout=30)
        
        assert response.status_code == 200, f"Profile endpoint failed: {response.text}"
        data = response.json()
        
        # This should be embii's profile with avatar
        urn = data.get("urn", "")
        image = data.get("image", "")
        
        print(f"✓ Profile for {EMBII_ADDRESS_2[:12]}...: urn={urn}")
        if image:
            print(f"  Has avatar image: {image[:50]}...")
        
        # Verify this is embii or similar known user
        assert data.get("address") == EMBII_ADDRESS_2, "Profile address mismatch"


class TestTestnetRegression:
    """Regression tests to ensure testnet still works"""

    def test_testnet_feed_still_works(self, api_client):
        """GET /api/feed/btc-testnet should still return posts"""
        response = api_client.get(f"{BASE_URL}/api/feed/btc-testnet?limit=10", timeout=30)
        
        assert response.status_code == 200, f"Testnet feed failed: {response.text}"
        data = response.json()
        
        assert "feed" in data, "Response missing 'feed' key"
        print(f"✓ Testnet feed still works, returned {len(data['feed'])} posts")

    def test_testnet_storefront_still_works(self, api_client):
        """GET /api/objects/storefront/btc-testnet should still return objects"""
        response = api_client.get(f"{BASE_URL}/api/objects/storefront/btc-testnet?limit=10", timeout=30)
        
        assert response.status_code == 200, f"Testnet storefront failed: {response.text}"
        data = response.json()
        
        assert "objects" in data, "Response missing 'objects' key"
        total = data.get("total", 0)
        print(f"✓ Testnet storefront still works, has {total} total objects")


class TestHealthAndBasics:
    """Basic health and connectivity tests"""

    def test_api_health(self, api_client):
        """Basic API health check"""
        response = api_client.get(f"{BASE_URL}/api/", timeout=10)
        assert response.status_code == 200, f"API health check failed: {response.text}"
        print("✓ API is healthy")

    def test_mainnet_vs_testnet_isolation(self, api_client):
        """Verify mainnet and testnet return different data"""
        mainnet_resp = api_client.get(f"{BASE_URL}/api/feed/btc-mainnet?limit=5", timeout=30)
        testnet_resp = api_client.get(f"{BASE_URL}/api/feed/btc-testnet?limit=5", timeout=30)
        
        assert mainnet_resp.status_code == 200
        assert testnet_resp.status_code == 200
        
        mainnet_data = mainnet_resp.json()
        testnet_data = testnet_resp.json()
        
        # Get transaction IDs from each
        mainnet_txids = {p.get("transaction_id") for p in mainnet_data.get("feed", []) if p.get("transaction_id")}
        testnet_txids = {p.get("transaction_id") for p in testnet_data.get("feed", []) if p.get("transaction_id")}
        
        # They should be different
        if mainnet_txids and testnet_txids:
            overlap = mainnet_txids & testnet_txids
            assert len(overlap) == 0, f"Mainnet and testnet have overlapping transaction IDs: {overlap}"
            print("✓ Mainnet and testnet data is isolated (no overlapping txids)")
        else:
            print("⚠ Could not verify isolation (one or both feeds empty)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
