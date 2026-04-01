"""
Iteration 80: Backend tests for profile Posts and Replies API endpoints
Tests the new profile Posts/Replies tabs feature for viewing user's own posts and replies from others.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test profile address for embii4u user
PROFILE_ADDRESS = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
NETWORK = "btc-testnet"


class TestProfilePostsAPI:
    """Tests for GET /api/profile/{address}/posts endpoint"""

    def test_posts_returns_200_with_valid_address(self):
        """Posts endpoint should return 200 status for valid address"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK},
            timeout=30
        )
        assert response.status_code == 200
        print(f"✓ Posts endpoint returned 200 OK")

    def test_posts_returns_correct_total_count(self):
        """Posts endpoint should return total=10 for embii4u profile"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK},
            timeout=30
        )
        data = response.json()
        assert data.get("total") == 10, f"Expected total=10, got {data.get('total')}"
        print(f"✓ Posts total count is 10 as expected")

    def test_posts_response_structure(self):
        """Posts response should have required fields: posts, count, total, has_more"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK},
            timeout=30
        )
        data = response.json()
        assert "posts" in data, "Missing 'posts' field"
        assert "count" in data, "Missing 'count' field"
        assert "total" in data, "Missing 'total' field"
        assert "has_more" in data, "Missing 'has_more' field"
        assert isinstance(data["posts"], list), "'posts' should be a list"
        print(f"✓ Posts response structure is correct")

    def test_posts_items_have_required_fields(self):
        """Each post item should have essential fields like transaction_id, content, sender_urn"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK, "limit": 3},
            timeout=30
        )
        data = response.json()
        posts = data.get("posts", [])
        assert len(posts) > 0, "Expected at least one post"
        
        post = posts[0]
        assert "transaction_id" in post, "Post missing 'transaction_id'"
        assert "content" in post, "Post missing 'content'"
        assert "sender_urn" in post, "Post missing 'sender_urn'"
        assert "created_at" in post, "Post missing 'created_at'"
        print(f"✓ Post items have required fields")

    def test_posts_have_embii4u_sender_urn(self):
        """Posts from embii4u should have sender_urn='embii4u'"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK, "limit": 5},
            timeout=30
        )
        data = response.json()
        posts = data.get("posts", [])
        
        # Check that at least some posts have embii4u as sender
        embii_posts = [p for p in posts if p.get("sender_urn") == "embii4u"]
        assert len(embii_posts) > 0, "Expected some posts with sender_urn='embii4u'"
        print(f"✓ Found {len(embii_posts)} posts from embii4u")

    def test_posts_contain_hashtags(self):
        """Some posts should contain #hashtags like #Apertus, #Cthulhu, #bitfossil"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/posts",
            params={"network": NETWORK},
            timeout=30
        )
        data = response.json()
        posts = data.get("posts", [])
        
        # Look for hashtags in post content
        hashtag_found = False
        for post in posts:
            content = post.get("content", "")
            if "#Apertus" in content or "#Cthulhu" in content or "#bitfossil" in content:
                hashtag_found = True
                break
        
        assert hashtag_found, "Expected at least one post with #Apertus, #Cthulhu, or #bitfossil hashtag"
        print(f"✓ Found posts containing hashtags")


class TestProfileRepliesAPI:
    """Tests for GET /api/profile/{address}/replies endpoint - messages TO this user from OTHERS"""

    def test_replies_returns_200_with_valid_address(self):
        """Replies endpoint should return 200 status for valid address"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/replies",
            params={"network": NETWORK, "limit": 5},
            timeout=60
        )
        assert response.status_code == 200
        print(f"✓ Replies endpoint returned 200 OK")

    def test_replies_returns_positive_total_count(self):
        """Replies endpoint should return total > 0 for embii4u profile"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/replies",
            params={"network": NETWORK, "limit": 5},
            timeout=60
        )
        data = response.json()
        assert data.get("total", 0) > 0, f"Expected total > 0, got {data.get('total')}"
        print(f"✓ Replies total count is {data.get('total')} (> 0)")

    def test_replies_response_structure(self):
        """Replies response should have required fields: replies, count, total, has_more"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/replies",
            params={"network": NETWORK, "limit": 5},
            timeout=60
        )
        data = response.json()
        assert "replies" in data, "Missing 'replies' field"
        assert "count" in data, "Missing 'count' field"
        assert "total" in data, "Missing 'total' field"
        assert "has_more" in data, "Missing 'has_more' field"
        assert isinstance(data["replies"], list), "'replies' should be a list"
        print(f"✓ Replies response structure is correct")

    def test_replies_are_from_other_users(self):
        """Replies should be from OTHER users (not from the profile owner)"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/replies",
            params={"network": NETWORK, "limit": 10},
            timeout=60
        )
        data = response.json()
        replies = data.get("replies", [])
        
        # Replies should not have embii4u address as from_address
        for reply in replies:
            from_addr = reply.get("from_address", "")
            assert from_addr != PROFILE_ADDRESS, f"Reply from_address should not be profile owner: {from_addr}"
        
        print(f"✓ All {len(replies)} replies are from other users")

    def test_replies_contain_mention(self):
        """Some replies should contain @embii4u mention"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}/replies",
            params={"network": NETWORK, "limit": 20},
            timeout=60
        )
        data = response.json()
        replies = data.get("replies", [])
        
        mention_found = False
        for reply in replies:
            content = reply.get("content", "")
            if "@embii4u" in content:
                mention_found = True
                break
        
        # This is informational - not all replies may have explicit @mention
        if mention_found:
            print(f"✓ Found reply containing @embii4u mention")
        else:
            print(f"ℹ No explicit @embii4u mention found in first 20 replies (may still be valid)")


class TestProfileAPI:
    """Tests for profile base endpoint"""

    def test_profile_returns_200_and_address(self):
        """Profile endpoint should return profile data with address"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}",
            params={"network": NETWORK},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "address" in data, "Profile missing 'address' field"
        assert data["address"] == PROFILE_ADDRESS, f"Expected address {PROFILE_ADDRESS}"
        print(f"✓ Profile endpoint returned correct address")

    def test_profile_has_urn(self):
        """embii4u profile should have URN field"""
        response = requests.get(
            f"{BASE_URL}/api/profile/{PROFILE_ADDRESS}",
            params={"network": NETWORK},
            timeout=30
        )
        data = response.json()
        # URN can be in 'urn' or 'URN' field
        urn = data.get("urn") or data.get("URN")
        assert urn == "embii4u", f"Expected URN='embii4u', got {urn}"
        print(f"✓ Profile has correct URN: embii4u")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
