"""
Iteration 111: Poll Pending/Mempool Feature Tests
Tests the poll system's ability to:
1. Return poll data from local registry when P2FK API has no data (unconfirmed)
2. Include registered polls in the feed with is_poll=true and poll_data
3. Register polls and inject them into the feed cache
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test txid for the registered poll (from agent context)
TEST_POLL_TXID = "fb8b0caedd9f9c59f37a126f32f467ec84086b2dba6669b9044d13d855beb8ee"
TEST_NETWORK = "btc-testnet"


class TestPollByTxidFallback:
    """Test GET /api/polls/by-txid/{txid} fallback to local registry"""
    
    def test_poll_by_txid_returns_local_registry_data(self):
        """GET /api/polls/by-txid/{txid} should return poll data from local registry for unconfirmed polls"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": TEST_NETWORK},
            timeout=35
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Should NOT have error - should have poll data from local registry
        assert "error" not in data or data.get("question"), f"Expected poll data, got: {data}"
        
        # Verify poll structure
        assert "question" in data, f"Missing 'question' in response: {data}"
        assert "answers" in data, f"Missing 'answers' in response: {data}"
        assert isinstance(data["answers"], list), f"'answers' should be a list: {data}"
        
        # Verify status is 'mempool' for unconfirmed polls
        assert data.get("status") == "mempool", f"Expected status='mempool', got: {data.get('status')}"
        
        # Verify txid matches
        assert data.get("txid") == TEST_POLL_TXID, f"Expected txid={TEST_POLL_TXID}, got: {data.get('txid')}"
        
        print(f"Poll data from local registry: question='{data.get('question')}', status='{data.get('status')}', answers={len(data.get('answers', []))}")
    
    def test_poll_by_txid_has_required_fields(self):
        """Verify poll response has all required fields for frontend rendering"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": TEST_NETWORK},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        
        # Skip if error (poll not found)
        if "error" in data and not data.get("question"):
            pytest.skip(f"Poll not found in registry: {data}")
        
        # Required fields for PollCard rendering
        required_fields = ["txid", "question", "answers", "status"]
        for field in required_fields:
            assert field in data, f"Missing required field '{field}' in response: {data}"
        
        # Optional but expected fields
        optional_fields = ["own_gate", "cre_gate", "total_votes", "total_gated_votes", "votes"]
        for field in optional_fields:
            if field not in data:
                print(f"Note: Optional field '{field}' not present in response")


class TestFeedIncludesPoll:
    """Test GET /api/feed/{network} includes registered polls"""
    
    def test_feed_returns_poll_with_is_poll_flag(self):
        """GET /api/feed/{network} should include registered poll with is_poll=true"""
        response = requests.get(
            f"{BASE_URL}/api/feed/{TEST_NETWORK}",
            params={"skip": 0, "limit": 50},
            timeout=35
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "feed" in data, f"Missing 'feed' in response: {data}"
        feed = data["feed"]
        assert isinstance(feed, list), f"'feed' should be a list: {data}"
        
        # Find the test poll in the feed
        poll_item = None
        for item in feed:
            if item.get("transaction_id") == TEST_POLL_TXID:
                poll_item = item
                break
        
        assert poll_item is not None, f"Test poll {TEST_POLL_TXID} not found in feed (checked {len(feed)} items)"
        
        # Verify is_poll flag
        assert poll_item.get("is_poll") == True, f"Expected is_poll=True, got: {poll_item.get('is_poll')}"
        
        print(f"Found poll in feed: txid={poll_item.get('transaction_id')}, is_poll={poll_item.get('is_poll')}")
    
    def test_feed_poll_has_poll_data(self):
        """GET /api/feed/{network} poll item should have poll_data with question and answers"""
        response = requests.get(
            f"{BASE_URL}/api/feed/{TEST_NETWORK}",
            params={"skip": 0, "limit": 50},
            timeout=35
        )
        assert response.status_code == 200
        data = response.json()
        feed = data.get("feed", [])
        
        # Find the test poll
        poll_item = None
        for item in feed:
            if item.get("transaction_id") == TEST_POLL_TXID:
                poll_item = item
                break
        
        if poll_item is None:
            pytest.skip(f"Test poll {TEST_POLL_TXID} not found in feed")
        
        # Verify poll_data structure
        poll_data = poll_item.get("poll_data")
        assert poll_data is not None, f"Missing 'poll_data' in poll item: {poll_item}"
        assert isinstance(poll_data, dict), f"'poll_data' should be a dict: {poll_data}"
        
        # Verify poll_data has required fields
        assert "question" in poll_data, f"Missing 'question' in poll_data: {poll_data}"
        assert "answers" in poll_data, f"Missing 'answers' in poll_data: {poll_data}"
        assert isinstance(poll_data["answers"], list), f"'answers' should be a list: {poll_data}"
        
        # Verify status is present (could be 'mempool' or 'active' depending on cache state)
        assert poll_data.get("status") in ["mempool", "active"], f"Expected status='mempool' or 'active', got: {poll_data.get('status')}"
        
        print(f"Poll data in feed: question='{poll_data.get('question')}', status='{poll_data.get('status')}', answers={len(poll_data.get('answers', []))}")


class TestPollRegisterEndpoint:
    """Test POST /api/polls/register endpoint"""
    
    def test_poll_register_endpoint_exists(self):
        """POST /api/polls/register should accept poll registration"""
        # Test with a dummy poll (won't actually create, just verify endpoint works)
        test_payload = {
            "txid": "TEST_DUMMY_TXID_FOR_ENDPOINT_CHECK",
            "question": "Test Question?",
            "answers": [
                {"address": "addr1", "answer": "Option A", "total_votes": 0},
                {"address": "addr2", "answer": "Option B", "total_votes": 0}
            ],
            "creator_address": "test_creator_address",
            "network": TEST_NETWORK,
            "own_gate": [],
            "cre_gate": []
        }
        
        response = requests.post(
            f"{BASE_URL}/api/polls/register",
            json=test_payload,
            timeout=15
        )
        
        # Should return 200 with ok: true
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("ok") == True, f"Expected ok=True, got: {data}"
        
        print("Poll register endpoint working correctly")


class TestPollRegisteredEndpoint:
    """Test GET /api/polls/registered endpoint"""
    
    def test_polls_registered_returns_list(self):
        """GET /api/polls/registered should return list of registered polls"""
        response = requests.get(
            f"{BASE_URL}/api/polls/registered",
            params={"network": TEST_NETWORK},
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "polls" in data, f"Missing 'polls' in response: {data}"
        assert isinstance(data["polls"], list), f"'polls' should be a list: {data}"
        
        # Check if our test poll is in the registered list
        test_poll = None
        for poll in data["polls"]:
            if poll.get("txid") == TEST_POLL_TXID:
                test_poll = poll
                break
        
        if test_poll:
            print(f"Found test poll in registered list: question='{test_poll.get('question')}'")
        else:
            print(f"Test poll {TEST_POLL_TXID} not found in registered list (may have been cleaned up)")


class TestHealthCheck:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """GET /api/health should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
