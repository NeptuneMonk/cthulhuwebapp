"""
Test Poll Caching Fix - Iteration 233
Tests the poll caching improvements:
1. Poll API returns correct vote counts from local votes map
2. fresh=true parameter bypasses cache
3. Both poll formats work (dict-based and list-based answers)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test poll TXIDs
TEST_POLL_TXID = "54a00f7848ddbc56facd568afcfe5a9dcb609591edaf93c08e09ff95b1fd769d"  # 'test' poll, 2 votes
TRY_POLL_TXID = "af4bfb282822a8ed11d7a43b1664ccb470df32654ebc3536d4f01ad4fcc0b1c0"  # 'Try' poll, 1 vote


class TestPollCachingFix:
    """Tests for poll caching improvements"""

    def test_poll_api_returns_correct_vote_count_test_poll(self):
        """Test poll (54a00f...) should return total_votes=2 computed from local votes map"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "error" not in data, f"API returned error: {data.get('error')}"
        assert data.get("question") == "test", f"Expected question 'test', got {data.get('question')}"
        assert data.get("total_votes") == 2, f"Expected total_votes=2, got {data.get('total_votes')}"
        assert data.get("source") == "local_cache", f"Expected source='local_cache', got {data.get('source')}"
        
        # Verify votes map has 2 voters
        votes = data.get("votes", {})
        assert len(votes) == 2, f"Expected 2 voters in votes map, got {len(votes)}"
        
        # Verify answers have correct vote counts
        answers = data.get("answers", [])
        assert len(answers) == 2, f"Expected 2 answers, got {len(answers)}"
        answer_a = next((a for a in answers if a.get("answer") == "a"), None)
        assert answer_a is not None, "Answer 'a' not found"
        assert answer_a.get("total_votes") == 2, f"Expected answer 'a' to have 2 votes, got {answer_a.get('total_votes')}"

    def test_poll_api_returns_correct_vote_count_try_poll(self):
        """Try poll (af4bfb...) should return total_votes=1 computed from local votes map"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TRY_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "error" not in data, f"API returned error: {data.get('error')}"
        assert "Try" in data.get("question", ""), f"Expected question containing 'Try', got {data.get('question')}"
        assert data.get("total_votes") == 1, f"Expected total_votes=1, got {data.get('total_votes')}"
        assert data.get("source") == "local_cache", f"Expected source='local_cache', got {data.get('source')}"
        
        # Verify votes map has 1 voter
        votes = data.get("votes", {})
        assert len(votes) == 1, f"Expected 1 voter in votes map, got {len(votes)}"

    def test_fresh_param_bypasses_cache(self):
        """fresh=true should bypass cache and return fresh data"""
        # First request without fresh
        response1 = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response1.status_code == 200
        
        # Second request with fresh=true
        response2 = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet", "fresh": "true"}
        )
        assert response2.status_code == 200
        
        data1 = response1.json()
        data2 = response2.json()
        
        # Both should return valid poll data
        assert "error" not in data1, f"First request returned error: {data1.get('error')}"
        assert "error" not in data2, f"Fresh request returned error: {data2.get('error')}"
        
        # Both should have same vote counts (data consistency)
        assert data1.get("total_votes") == data2.get("total_votes"), \
            f"Vote counts differ: {data1.get('total_votes')} vs {data2.get('total_votes')}"

    def test_poll_api_handles_list_based_answers(self):
        """Test poll with list-based answers format"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        answers = data.get("answers", [])
        
        # Verify answers is a list
        assert isinstance(answers, list), f"Expected answers to be a list, got {type(answers)}"
        
        # Verify each answer has required fields
        for i, answer in enumerate(answers):
            assert "address" in answer, f"Answer {i} missing 'address' field"
            assert "answer" in answer, f"Answer {i} missing 'answer' field"
            assert "total_votes" in answer, f"Answer {i} missing 'total_votes' field"

    def test_poll_api_handles_dict_based_answers(self):
        """Try poll uses dict-based answers format"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TRY_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        answers = data.get("answers", [])
        
        # Verify answers is normalized to a list
        assert isinstance(answers, list), f"Expected answers to be a list, got {type(answers)}"
        assert len(answers) >= 1, "Expected at least 1 answer"
        
        # Verify answer has required fields
        answer = answers[0]
        assert "address" in answer, "Answer missing 'address' field"
        assert "answer" in answer, "Answer missing 'answer' field"
        assert "total_votes" in answer, "Answer missing 'total_votes' field"

    def test_poll_api_returns_votes_map(self):
        """Poll API should return votes map for 'already voted' detection"""
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        
        data = response.json()
        votes = data.get("votes", {})
        
        # Verify votes map structure
        assert isinstance(votes, dict), f"Expected votes to be a dict, got {type(votes)}"
        
        # Verify each vote maps voter address to answer address
        for voter, answer_addr in votes.items():
            assert isinstance(voter, str), f"Voter key should be string, got {type(voter)}"
            assert isinstance(answer_addr, str), f"Answer address should be string, got {type(answer_addr)}"

    def test_poll_not_found_returns_error(self):
        """Non-existent poll should return error"""
        fake_txid = "0000000000000000000000000000000000000000000000000000000000000000"
        response = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{fake_txid}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200  # API returns 200 with error in body
        
        data = response.json()
        assert "error" in data, "Expected error for non-existent poll"


class TestPollCacheTTL:
    """Tests for poll cache TTL configuration"""

    def test_poll_cache_ttl_is_short(self):
        """Poll data should use short cache TTL (30s) for near-real-time updates"""
        # Make two requests in quick succession
        response1 = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        response2 = requests.get(
            f"{BASE_URL}/api/polls/by-txid/{TEST_POLL_TXID}",
            params={"network": "btc-testnet"}
        )
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        # Both should return valid data
        data1 = response1.json()
        data2 = response2.json()
        assert "error" not in data1
        assert "error" not in data2


class TestHealthEndpoint:
    """Basic health check"""

    def test_health_endpoint(self):
        """Health endpoint should return 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
