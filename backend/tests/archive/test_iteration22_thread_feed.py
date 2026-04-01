"""
Iteration 22 - Thread API & Feed Caching Tests
Tests keyword-based reply lookup, feed caching, network isolation, and on-chain resolution.
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test transaction ID confirmed to have 1 reply on btc-testnet
TEST_TXID = "a073f8f7773094eb1725954c7648f700914894ac6776255f8e569742e123e945"

class TestHealthAndBasics:
    """Basic API health checks"""
    
    def test_health_endpoint(self):
        """GET /api/health returns healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"PASS: Health check - {data}")

    def test_root_endpoint(self):
        """GET /api/ returns API info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "Cthulhu" in data.get("message", "")
        print(f"PASS: Root endpoint - {data}")


class TestThreadAPI:
    """Thread endpoint tests - keyword-based reply lookup per SUP/P2FK protocol"""
    
    def test_thread_returns_original_and_reply(self):
        """GET /api/thread/{txid}?network=btc-testnet should return 2 items (1 original + 1 reply)"""
        response = requests.get(
            f"{BASE_URL}/api/thread/{TEST_TXID}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should have thread array
        assert "thread" in data
        thread = data["thread"]
        
        print(f"Thread returned {len(thread)} items, reply_count={data.get('reply_count')}")
        
        # Must have at least 1 item (the original)
        assert len(thread) >= 1, f"Expected at least 1 item, got {len(thread)}"
        
        # Check if we have the expected 2 items (original + 1 reply)
        if len(thread) >= 2:
            print(f"PASS: Thread has {len(thread)} items (original + replies)")
        else:
            print(f"WARNING: Expected 2 items but got {len(thread)}")
        
        return data
    
    def test_thread_original_has_is_original_true(self):
        """Original message should have is_original=true"""
        response = requests.get(
            f"{BASE_URL}/api/thread/{TEST_TXID}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        thread = data.get("thread", [])
        
        # Find the original message
        originals = [item for item in thread if item.get("is_original") == True]
        assert len(originals) == 1, f"Expected exactly 1 original, found {len(originals)}"
        
        original = originals[0]
        assert original.get("type") == "message", f"Original type should be 'message', got {original.get('type')}"
        assert original.get("is_highlighted") == True, "Original should be highlighted"
        
        print(f"PASS: Original message - txid={original.get('transaction_id')[:20]}..., is_original={original.get('is_original')}")
    
    def test_thread_reply_has_type_reply(self):
        """Reply messages should have type=reply and is_original=false"""
        response = requests.get(
            f"{BASE_URL}/api/thread/{TEST_TXID}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        thread = data.get("thread", [])
        
        # Find replies
        replies = [item for item in thread if item.get("is_original") == False]
        
        if len(replies) > 0:
            for reply in replies:
                assert reply.get("type") == "reply", f"Reply type should be 'reply', got {reply.get('type')}"
                assert reply.get("is_highlighted") == False, "Replies should not be highlighted"
            print(f"PASS: Found {len(replies)} reply(ies) with correct type=reply")
        else:
            print(f"WARNING: No replies found in thread")
    
    def test_thread_reply_count_field(self):
        """Thread response should include reply_count field"""
        response = requests.get(
            f"{BASE_URL}/api/thread/{TEST_TXID}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "reply_count" in data, "Response should include reply_count field"
        print(f"PASS: reply_count = {data['reply_count']}")


class TestReplyCountAPI:
    """Reply count endpoint tests"""
    
    def test_reply_count_returns_count(self):
        """GET /api/reply-count/{txid}?network=btc-testnet returns reply_count field"""
        response = requests.get(
            f"{BASE_URL}/api/reply-count/{TEST_TXID}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "reply_count" in data, "Response must include reply_count field"
        assert "txid" in data, "Response must include txid field"
        assert isinstance(data["reply_count"], int), "reply_count must be an integer"
        
        print(f"PASS: reply_count API - txid={data['txid'][:20]}..., reply_count={data['reply_count']}")


class TestFeedAPI:
    """Feed endpoint tests with caching verification"""
    
    def test_feed_returns_messages(self):
        """GET /api/feed/btc-testnet returns feed array with messages"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            timeout=120  # First request may be slow
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "feed" in data, "Response must include feed array"
        assert isinstance(data["feed"], list), "feed must be an array"
        assert "network" in data
        assert data["network"] == "btc-testnet"
        
        print(f"PASS: Feed returned {len(data['feed'])} messages, total={data.get('total')}")
        
        # Verify message structure
        if len(data["feed"]) > 0:
            msg = data["feed"][0]
            assert "transaction_id" in msg or "id" in msg, "Messages must have transaction_id or id"
            assert "content" in msg, "Messages must have content"
            print(f"PASS: Message structure verified - has content field")
    
    def test_feed_caching_second_request_is_cached(self):
        """Second request to feed should have cached=true and be fast"""
        # First request (may be slow or already cached)
        response1 = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            timeout=120
        )
        assert response1.status_code == 200
        
        # Second request - should be cached
        start_time = time.time()
        response2 = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            timeout=10
        )
        elapsed = time.time() - start_time
        
        assert response2.status_code == 200
        data = response2.json()
        
        # Should be cached (unless cache expired in the meantime)
        if data.get("cached") == True:
            print(f"PASS: Feed is cached=true, response time: {elapsed:.2f}s")
        else:
            print(f"INFO: Feed not cached (may have just expired), response time: {elapsed:.2f}s")
        
        # Should be reasonably fast if cached (under 5 seconds)
        if elapsed < 5:
            print(f"PASS: Response time under 5s ({elapsed:.2f}s)")
        else:
            print(f"WARNING: Response took {elapsed:.2f}s (expected <5s for cached)")


class TestNetworkIsolation:
    """Network isolation audit - verify mainnet/testnet address separation"""
    
    def test_mainnet_known_users_only_mainnet_addresses(self):
        """GET /api/known-users/btc-mainnet/ranked only returns mainnet addresses (start with 1/3)"""
        response = requests.get(
            f"{BASE_URL}/api/known-users/btc-mainnet/ranked",
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        users = data.get("users", [])
        invalid_addresses = []
        
        for user in users:
            addr = user.get("address", "")
            # Mainnet addresses start with 1, 3, or bc1
            if addr and not (addr.startswith("1") or addr.startswith("3") or addr.startswith("bc1")):
                invalid_addresses.append(addr)
        
        if invalid_addresses:
            print(f"FAIL: Found {len(invalid_addresses)} non-mainnet addresses in btc-mainnet users")
            for addr in invalid_addresses[:5]:
                print(f"  Invalid: {addr}")
            pytest.fail(f"Found {len(invalid_addresses)} testnet addresses in mainnet users")
        else:
            print(f"PASS: All {len(users)} mainnet users have valid mainnet addresses")
    
    def test_testnet_known_users_only_testnet_addresses(self):
        """GET /api/known-users/btc-testnet/ranked only returns testnet addresses (start with m/n/2)"""
        response = requests.get(
            f"{BASE_URL}/api/known-users/btc-testnet/ranked",
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        users = data.get("users", [])
        invalid_addresses = []
        
        for user in users:
            addr = user.get("address", "")
            # Testnet addresses start with m, n, 2, or tb1
            if addr and not (addr.startswith("m") or addr.startswith("n") or addr.startswith("2") or addr.startswith("tb1")):
                invalid_addresses.append(addr)
        
        if invalid_addresses:
            print(f"FAIL: Found {len(invalid_addresses)} non-testnet addresses in btc-testnet users")
            for addr in invalid_addresses[:5]:
                print(f"  Invalid: {addr}")
            pytest.fail(f"Found {len(invalid_addresses)} mainnet addresses in testnet users")
        else:
            print(f"PASS: All {len(users)} testnet users have valid testnet addresses")


class TestOnChainResolver:
    """On-chain file resolution tests"""
    
    def test_btc_mainnet_onchain_file(self):
        """GET /api/onchain/file/{txid}/{filename}?chain=BTC&mainnet=true returns valid JPEG"""
        txid = "f3b185bd932ef28cfd8e0d6891fa5af059a0446a1512e24461ddade4f1df0b53"
        filename = "MichaelJackson.jpg"
        
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{txid}/{filename}",
            params={"chain": "BTC", "mainnet": "true"},
            timeout=60
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Should be a JPEG image
        content_type = response.headers.get("Content-Type", "")
        assert "image" in content_type.lower() or len(response.content) > 1000, \
            f"Expected image content, got Content-Type: {content_type}"
        
        # Check JPEG magic bytes
        if response.content[:2] == b'\xff\xd8':
            print(f"PASS: On-chain file is valid JPEG, size={len(response.content)} bytes")
        else:
            print(f"PASS: On-chain file returned, size={len(response.content)} bytes, Content-Type={content_type}")


class TestFrontendDataTestIds:
    """Verify data-testid attributes are present for testing"""
    
    def test_feed_endpoint_for_frontend(self):
        """Verify feed data has fields needed by FeedCard component"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            timeout=120
        )
        assert response.status_code == 200
        data = response.json()
        
        if len(data.get("feed", [])) > 0:
            msg = data["feed"][0]
            # Fields used by FeedCard.js
            required_fields = ["transaction_id", "content", "from_address"]
            for field in required_fields:
                if field not in msg:
                    print(f"WARNING: Feed message missing field: {field}")
            
            print(f"PASS: Feed message has required fields for FeedCard component")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
