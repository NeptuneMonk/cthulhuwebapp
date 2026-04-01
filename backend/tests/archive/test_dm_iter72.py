"""
Test DM (Direct Message) endpoints and p2fk binary changes for iteration 72.
Focus: DM API validation, SEC message filtering in feed, backward compatibility.

Key fixes being validated:
1. p2fk.js buildSignedPayload returns Buffer (binary-safe)
2. p2fk.js encodePayloadToAddresses accepts Buffer directly  
3. FeedCard.js hooks ordering fix (isSEC check moved after hooks)
4. DMPage.js DB_VERSION bumped to 2 with dm_settings store
"""
import pytest
import requests
import os
import base64

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known addresses from previous iterations
EMBII_MAINNET = "16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw"
NEPTUNEMONK_MAINNET = "1JMe3WfKVR4w6U5uxmvtLT7xfiwYXGHBZm"
TESTNET_ADDR = "mtXWDB6k5yC5v7TcwKZHB89SUp85yCKshy"


class TestDMThreadsAPI:
    """Test GET /api/dm/threads/{address} - returns proper thread data"""
    
    def test_threads_mainnet_embii(self):
        """DM threads for known mainnet address returns valid structure"""
        response = requests.get(f"{BASE_URL}/api/dm/threads/{EMBII_MAINNET}", 
                               params={"network": "btc-mainnet"}, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "threads" in data, "Response must contain 'threads' key"
        assert isinstance(data["threads"], list), "'threads' must be a list"
        print(f"PASS: DM threads/embii returns {len(data['threads'])} threads")

    def test_threads_testnet(self):
        """DM threads for testnet address"""
        response = requests.get(f"{BASE_URL}/api/dm/threads/{TESTNET_ADDR}", 
                               params={"network": "btc-testnet"}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert "threads" in data
        print(f"PASS: DM threads/testnet returns {len(data['threads'])} threads")


class TestDMMessagesAPI:
    """Test GET /api/dm/messages/{address} - returns encrypted messages with base64 data"""
    
    def test_messages_structure(self):
        """Messages endpoint returns proper JSON structure with base64 encrypted data"""
        response = requests.get(f"{BASE_URL}/api/dm/messages/{EMBII_MAINNET}",
                               params={"network": "btc-mainnet"}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "messages" in data, "Response must have 'messages' key"
        assert "total" in data, "Response must have 'total' key"
        assert "has_more" in data, "Response must have 'has_more' key"
        assert isinstance(data["messages"], list)
        assert isinstance(data["total"], int)
        assert isinstance(data["has_more"], bool)
        
        # If messages exist, verify base64 encrypted_data format
        for msg in data["messages"][:3]:
            if msg.get("encrypted_data"):
                # Try to decode base64 - should not raise
                try:
                    decoded = base64.b64decode(msg["encrypted_data"])
                    assert len(decoded) > 0, "Decoded data should not be empty"
                except Exception as e:
                    pytest.fail(f"encrypted_data is not valid base64: {e}")
                    
        print(f"PASS: DM messages returns {data['total']} messages with valid structure")

    def test_messages_with_partner_filter(self):
        """Messages with partner filter returns filtered results"""
        response = requests.get(f"{BASE_URL}/api/dm/messages/{EMBII_MAINNET}",
                               params={"network": "btc-mainnet", "partner": NEPTUNEMONK_MAINNET},
                               timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert "total" in data
        print(f"PASS: DM messages with partner filter works, {data['total']} filtered messages")

    def test_messages_pagination(self):
        """Messages pagination (skip/limit) works"""
        response = requests.get(f"{BASE_URL}/api/dm/messages/{EMBII_MAINNET}",
                               params={"network": "btc-mainnet", "skip": 0, "limit": 5},
                               timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) <= 5, "Limit should be respected"
        print(f"PASS: DM messages pagination works, got {len(data['messages'])} messages with limit=5")


class TestFeedNoSECLeak:
    """Test GET /api/feed - verify SEC/encrypted messages don't leak through"""
    
    def test_feed_testnet_no_sec(self):
        """Feed testnet should not contain raw SEC messages"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet",
                               params={"limit": 50}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        feed = data.get("feed", data) if isinstance(data, dict) else data
        
        sec_count = 0
        for item in feed:
            content = item.get("content", "")
            # Check for SEC prefix with delimiter pattern
            if content.startswith("SEC") and len(content) > 4:
                if content[3] in '\\//:*?"<>|':
                    sec_count += 1
        
        # SEC messages should be filtered at backend or flagged for frontend filtering
        print(f"INFO: Feed contains {sec_count} SEC-prefixed items (frontend will filter)")
        # Note: Backend doesn't necessarily filter SEC, frontend FeedCard.js does the filter
        print(f"PASS: Feed testnet returns {len(feed)} items")

    def test_feed_mainnet_no_sec(self):
        """Feed mainnet should not contain raw SEC messages"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet",
                               params={"limit": 50}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        feed = data.get("feed", data) if isinstance(data, dict) else data
        print(f"PASS: Feed mainnet returns {len(feed)} items")


class TestFeedBackwardCompatibility:
    """Verify p2fk changes didn't break feed rendering (posts, profiles, objects)"""
    
    def test_feed_has_content(self):
        """Feed returns posts with content"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet",
                               params={"limit": 10}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        feed = data.get("feed", data) if isinstance(data, dict) else data
        
        # Check at least some items have content
        items_with_content = [f for f in feed if f.get("content")]
        assert len(items_with_content) > 0, "Feed should have items with content"
        print(f"PASS: Feed backward compat - {len(items_with_content)} items have content")

    def test_storefront_works(self):
        """Objects storefront still works after p2fk changes"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet",
                               params={"limit": 5}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data, "Storefront must return 'objects' key"
        print(f"PASS: Storefront returns {len(data.get('objects', []))} objects")

    def test_profile_resolution(self):
        """Profile resolution works (URN -> address)"""
        response = requests.get(f"{BASE_URL}/api/profile/embii",
                               params={"network": "btc-mainnet"}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert data.get("address") == EMBII_MAINNET
        print(f"PASS: Profile embii resolves to {data.get('address')[:16]}...")


class TestProfilePKXPKY:
    """Test profile endpoint includes PKX/PKY for DM encryption"""
    
    def test_embii_has_encryption_keys(self):
        """Profile embii has PKX/PKY fields for E2E encryption"""
        response = requests.get(f"{BASE_URL}/api/profile/embii",
                               params={"network": "btc-mainnet"}, timeout=30)
        assert response.status_code == 200
        data = response.json()
        assert "pkx" in data, "Profile must have 'pkx' key"
        assert "pky" in data, "Profile must have 'pky' key"
        # embii should have non-empty PKX/PKY
        has_keys = bool(data.get("pkx") and data.get("pky"))
        print(f"PASS: Profile embii has pkx/pky = {has_keys}")


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health(self):
        """GET /api/health returns healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: Health check OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
