"""
Backend tests for reactions endpoint - Iteration 68
Tests the GET /api/reactions/{txid} endpoint for on-chain reactions (likes, tips, pins)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')


class TestReactionsEndpoint:
    """Tests for /api/reactions/{txid} endpoint"""
    
    def test_health_check(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("✓ Health check passed")
    
    def test_reactions_endpoint_structure(self):
        """Test reactions endpoint returns correct structure for non-existent txid"""
        test_txid = "1234567890abcdef"
        response = requests.get(f"{BASE_URL}/api/reactions/{test_txid}?network=btc-testnet")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "txid" in data, "Response should include txid"
        assert "likes" in data, "Response should include likes count"
        assert "tips" in data, "Response should include tips count"
        assert "pins" in data, "Response should include pins count"
        assert "deletes" in data, "Response should include deletes count"
        assert "like_addrs" in data, "Response should include like_addrs array"
        assert "pin_addrs" in data, "Response should include pin_addrs array"
        
        # Verify types
        assert isinstance(data["likes"], int)
        assert isinstance(data["tips"], int)
        assert isinstance(data["pins"], int)
        assert isinstance(data["deletes"], int)
        assert isinstance(data["like_addrs"], list)
        assert isinstance(data["pin_addrs"], list)
        
        # For non-existent txid, all counts should be 0
        assert data["likes"] == 0
        assert data["tips"] == 0
        assert data["pins"] == 0
        assert data["deletes"] == 0
        
        print(f"✓ Reactions endpoint structure verified for txid: {test_txid}")
    
    def test_reactions_with_real_txid(self):
        """Test reactions endpoint with a real transaction from the feed"""
        # First get a real txid from the feed
        feed_response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=1")
        assert feed_response.status_code == 200
        feed_data = feed_response.json()
        
        if feed_data.get("feed") and len(feed_data["feed"]) > 0:
            real_txid = feed_data["feed"][0].get("transaction_id")
            assert real_txid, "Feed item should have transaction_id"
            
            # Test reactions for this real txid
            response = requests.get(f"{BASE_URL}/api/reactions/{real_txid}?network=btc-testnet")
            assert response.status_code == 200
            data = response.json()
            
            # Verify structure is correct for real txid
            assert data.get("txid") == real_txid
            assert isinstance(data.get("likes"), int)
            assert isinstance(data.get("tips"), int)
            assert isinstance(data.get("pins"), int)
            
            print(f"✓ Reactions for real txid: likes={data['likes']}, tips={data['tips']}, pins={data['pins']}")
        else:
            pytest.skip("No feed items available for testing")
    
    def test_reactions_mainnet_network(self):
        """Test reactions endpoint with mainnet network parameter"""
        test_txid = "abcdef1234567890"
        response = requests.get(f"{BASE_URL}/api/reactions/{test_txid}?network=btc-mainnet")
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("txid") == test_txid
        print("✓ Reactions endpoint works with mainnet network")
    
    def test_reactions_default_network(self):
        """Test reactions endpoint without network parameter (should default to testnet)"""
        test_txid = "test1234567890"
        response = requests.get(f"{BASE_URL}/api/reactions/{test_txid}")
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("txid") == test_txid
        print("✓ Reactions endpoint works with default network")


class TestFeedEndpoint:
    """Tests for feed endpoint to ensure it works with reactions"""
    
    def test_feed_loads(self):
        """Test feed endpoint returns data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        
        assert "feed" in data
        assert "has_more" in data
        assert isinstance(data["feed"], list)
        
        if len(data["feed"]) > 0:
            # Verify feed item structure
            item = data["feed"][0]
            assert "transaction_id" in item
            print(f"✓ Feed loaded with {len(data['feed'])} items")
        else:
            print("✓ Feed endpoint works (empty feed)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
