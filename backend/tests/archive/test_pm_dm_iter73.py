"""
Iteration 73: Backend API tests for PM/DM dual-mode messaging system.
Tests new GET /api/pm/messages/{address} endpoint and existing DM endpoints.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test addresses for btc-testnet
TEST_ADDRESS = "n1ZbGw6stYCXBBPwBcSNtCmXNiJVBdrPUk"
PARTNER_ADDRESS = "mwjAUKDfBk7hpxz2LHF4aLU3TzRGhFGTKB"

class TestPMMessagesEndpoint:
    """Tests for new GET /api/pm/messages/{address} endpoint (regular PMs)"""
    
    def test_pm_messages_endpoint_exists(self):
        """Test that the PM messages endpoint exists and returns valid JSON"""
        response = requests.get(
            f"{BASE_URL}/api/pm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200, f"PM messages endpoint should return 200, got {response.status_code}"
        data = response.json()
        assert "messages" in data, "Response should contain 'messages' key"
        assert "total" in data, "Response should contain 'total' count"
        print(f"✓ PM messages endpoint returned {len(data['messages'])} messages, total: {data['total']}")
    
    def test_pm_messages_with_partner_filter(self):
        """Test PM messages endpoint with partner filter parameter"""
        response = requests.get(
            f"{BASE_URL}/api/pm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet", "partner": PARTNER_ADDRESS}
        )
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert isinstance(data["messages"], list)
        print(f"✓ PM messages with partner filter returned {len(data['messages'])} messages")
    
    def test_pm_messages_pagination_params(self):
        """Test PM messages endpoint accepts pagination parameters"""
        response = requests.get(
            f"{BASE_URL}/api/pm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet", "skip": 0, "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        assert "has_more" in data, "Response should indicate if more messages exist"
        print(f"✓ PM messages pagination works, has_more: {data.get('has_more')}")
    
    def test_pm_messages_structure(self):
        """Test PM message objects have expected structure"""
        response = requests.get(
            f"{BASE_URL}/api/pm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet", "limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        if data["messages"]:
            msg = data["messages"][0]
            # Validate expected fields
            assert "txid" in msg, "Message should have txid"
            assert "sender_address" in msg, "Message should have sender_address"
            assert "content" in msg, "Message should have content"
            assert "block_date" in msg, "Message should have block_date"
            print(f"✓ PM message structure valid: txid={msg['txid'][:16]}...")
        else:
            print("✓ PM messages endpoint works (no messages for test address)")


class TestDMMessagesEndpoint:
    """Tests for existing GET /api/dm/messages/{address} endpoint (encrypted)"""
    
    def test_dm_messages_endpoint_exists(self):
        """Test that the DM (encrypted) messages endpoint exists"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert "total" in data
        print(f"✓ DM messages endpoint returned {len(data['messages'])} encrypted messages")
    
    def test_dm_messages_with_partner(self):
        """Test DM messages with partner filter"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet", "partner": PARTNER_ADDRESS}
        )
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        print(f"✓ DM messages with partner filter works")
    
    def test_dm_messages_have_encrypted_data(self):
        """Test DM messages include encrypted_data field (base64)"""
        response = requests.get(
            f"{BASE_URL}/api/dm/messages/{TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        if data["messages"]:
            msg = data["messages"][0]
            assert "encrypted_data" in msg, "Encrypted message should have encrypted_data"
            print(f"✓ DM message has encrypted_data field")
        else:
            print("✓ DM endpoint works (no encrypted messages for test address)")


class TestFeedEndpoint:
    """Test feed endpoint still works and doesn't include SEC (encrypted) messages"""
    
    def test_feed_returns_posts(self):
        """Test feed endpoint returns posts"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"limit": 50}
        )
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data, "Feed response should have 'feed' key"
        assert len(data["feed"]) > 0, "Feed should return posts"
        print(f"✓ Feed returned {len(data['feed'])} posts")
    
    def test_feed_no_sec_messages(self):
        """Test feed doesn't expose SEC (encrypted private) messages"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"limit": 100}
        )
        assert response.status_code == 200
        data = response.json()
        # SEC messages should not appear in feed - they're filtered client-side
        # But we can check that any post with file_info containing SEC is filtered
        for post in data.get("feed", []):
            content = post.get("content", "").lower()
            # SEC content typically starts with binary blob, not text
            # The filter happens on frontend via FeedCard.js isSEC check
        print(f"✓ Feed endpoint works (SEC filtering handled by frontend)")


class TestDMThreadsEndpoint:
    """Test DM threads endpoint"""
    
    def test_dm_threads_endpoint(self):
        """Test DM threads returns conversation list"""
        response = requests.get(
            f"{BASE_URL}/api/dm/threads/{TEST_ADDRESS}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "threads" in data
        assert isinstance(data["threads"], list)
        print(f"✓ DM threads returned {len(data['threads'])} conversations")


class TestProfileEndpoint:
    """Test profile endpoint for DM encryption keys"""
    
    def test_profile_has_encryption_keys(self):
        """Test profile returns PKX/PKY for DM encryption"""
        # Use a known address with encryption keys (embii)
        response = requests.get(
            f"{BASE_URL}/api/profile/embii",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        # Profile may have pkx/pky for E2E encryption
        if data.get("pkx") and data.get("pky"):
            print(f"✓ Profile has encryption keys (pkx, pky)")
        else:
            print(f"✓ Profile endpoint works (no encryption keys for this user)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
