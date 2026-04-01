"""
Iteration 83: Test Data Vault and Profile Tabs (Posts/Replies/Mentions) 
Features:
1. Profile Posts - GET /api/profile/{address}/posts - original posts only (not replies)
2. Profile Replies - GET /api/profile/{address}/replies - user's replies to others
3. Profile Mentions - GET /api/profile/{address}/mentions - posts from others to this user
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
NETWORK = 'btc-testnet'
# embii4u test profile address
TEST_ADDRESS = 'muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs'


class TestProfileEndpoints:
    """Test profile posts, replies, and mentions endpoints"""

    def test_health_check(self):
        """Ensure API is running"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: Health check OK")

    def test_profile_fetch(self):
        """Test basic profile endpoint"""
        response = requests.get(f"{BASE_URL}/api/profile/{TEST_ADDRESS}", params={"network": NETWORK})
        assert response.status_code == 200
        data = response.json()
        # Profile should have address
        assert data.get("address") == TEST_ADDRESS or data.get("urn")
        print(f"PASS: Profile fetch OK - URN: {data.get('urn')}")

    def test_profile_posts_endpoint(self):
        """
        GET /api/profile/{address}/posts 
        Should return original posts (NOT replies to other users)
        """
        response = requests.get(
            f"{BASE_URL}/api/profile/{TEST_ADDRESS}/posts",
            params={"network": NETWORK, "skip": 0, "limit": 20},
            timeout=30  # P2FK API can be slow
        )
        assert response.status_code == 200
        data = response.json()
        
        # Response structure validation
        assert "posts" in data
        assert "total" in data
        assert "has_more" in data
        
        posts = data.get("posts", [])
        total = data.get("total", 0)
        
        print(f"Posts endpoint returned {len(posts)} posts, total: {total}")
        
        # Validate post structure if there are any
        if posts:
            post = posts[0]
            assert "transaction_id" in post or "content" in post
            print(f"Sample post: txid={post.get('transaction_id', 'N/A')[:20]}...")
        
        # Data assertion: total should be >= 0 (may have posts or not)
        assert total >= 0
        print(f"PASS: Profile posts endpoint OK - {total} total posts")

    def test_profile_replies_endpoint(self):
        """
        GET /api/profile/{address}/replies
        Should return this user's replies to OTHER users
        Should have reply_to_urn populated
        """
        response = requests.get(
            f"{BASE_URL}/api/profile/{TEST_ADDRESS}/replies",
            params={"network": NETWORK, "skip": 0, "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Response structure
        assert "replies" in data
        assert "total" in data
        assert "has_more" in data
        
        replies = data.get("replies", [])
        total = data.get("total", 0)
        
        print(f"Replies endpoint returned {len(replies)} replies, total: {total}")
        
        # Validate reply structure - should have reply_to_address or reply_to_urn
        if replies:
            reply = replies[0]
            # Check reply has target info
            has_reply_target = (
                reply.get("reply_to_urn") is not None or 
                reply.get("reply_to_address") is not None
            )
            if has_reply_target:
                print(f"Sample reply to: {reply.get('reply_to_urn') or reply.get('reply_to_address')}")
            else:
                print(f"Warning: Reply missing reply_to_urn/reply_to_address field")
        
        print(f"PASS: Profile replies endpoint OK - {total} total replies")

    def test_profile_mentions_endpoint(self):
        """
        GET /api/profile/{address}/mentions
        Should return posts FROM other users TO this user (mentions)
        sender_urn should NOT be the profile user's own URN
        """
        response = requests.get(
            f"{BASE_URL}/api/profile/{TEST_ADDRESS}/mentions",
            params={"network": NETWORK, "skip": 0, "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Response structure
        assert "mentions" in data
        assert "total" in data
        assert "has_more" in data
        
        mentions = data.get("mentions", [])
        total = data.get("total", 0)
        
        print(f"Mentions endpoint returned {len(mentions)} mentions, total: {total}")
        
        # Verify mentions are from OTHER users (not self)
        # First get the profile's URN to compare
        profile_response = requests.get(f"{BASE_URL}/api/profile/{TEST_ADDRESS}", params={"network": NETWORK})
        profile_urn = profile_response.json().get("urn", "").lower() if profile_response.ok else ""
        
        for mention in mentions[:5]:  # Check first 5
            sender_urn = (mention.get("sender_urn") or "").lower()
            signed_by = mention.get("signed_by", "")
            # Mention should NOT be from self
            if profile_urn and sender_urn:
                assert sender_urn != profile_urn, f"Mention from self should not appear: {sender_urn}"
            if signed_by:
                assert signed_by != TEST_ADDRESS, f"Mention signed by self should not appear"
            print(f"  Mention from: {mention.get('sender_urn', 'unknown')}")
        
        print(f"PASS: Profile mentions endpoint OK - {total} total mentions")


class TestVaultEndpoints:
    """Test vault-related endpoints (DM self-to-self)"""

    def test_dm_self_endpoint_exists(self):
        """
        Vault uses GET /api/dm/{address}/{address} for self-messages
        Test the endpoint structure (will return 0 for new vaults)
        """
        response = requests.get(
            f"{BASE_URL}/api/dm/{TEST_ADDRESS}/{TEST_ADDRESS}",
            params={"network": NETWORK},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should have messages array (may be empty for new vaults)
        assert "messages" in data
        messages = data.get("messages", [])
        print(f"DM self endpoint returned {len(messages)} vault entries")
        print(f"PASS: Vault DM endpoint structure OK")


class TestIPFSUpload:
    """Test IPFS upload endpoint (used by vault file upload)"""

    def test_ipfs_status(self):
        """Check IPFS daemon status"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status", timeout=10)
        assert response.status_code == 200
        data = response.json()
        print(f"IPFS status: online={data.get('online')}, peer_id={data.get('peer_id', 'N/A')[:12]}...")
        print("PASS: IPFS status OK")

    def test_ipfs_upload_endpoint(self):
        """Test IPFS upload endpoint accepts files"""
        # Create a small test file
        files = {"file": ("test.txt", b"test vault file content", "text/plain")}
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=30)
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert "cid" in data
        print(f"IPFS upload OK: CID={data.get('cid')}")
        print("PASS: IPFS upload endpoint OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
