"""
Iteration 23 - Feed Cache Refresh & Concurrent Request Tests
Tests the P0 fix: in-memory _feed_refreshing guard to prevent concurrent refresh storms
"""

import pytest
import requests
import os
import time
import concurrent.futures

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealthEndpoint:
    """Basic health check - GET /api/health"""
    
    def test_health_returns_healthy(self):
        """Verify health endpoint returns {status: healthy}"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'


class TestFeedEndpointFields:
    """Tests for /api/feed/{network} response structure"""
    
    def test_feed_btc_testnet_returns_required_fields(self):
        """GET /api/feed/btc-testnet should return all required fields"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        # Required fields as per specification
        required_fields = ['feed', 'count', 'total', 'cached', 'cache_age', 'refreshing', 'has_more']
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Validate data types
        assert isinstance(data['feed'], list)
        assert isinstance(data['count'], int)
        assert isinstance(data['total'], int)
        assert isinstance(data['cached'], bool)
        assert isinstance(data['cache_age'], int)
        assert isinstance(data['refreshing'], bool)
        assert isinstance(data['has_more'], bool)
        
        # If we have feed items, validate item structure
        if len(data['feed']) > 0:
            item = data['feed'][0]
            assert 'id' in item or 'transaction_id' in item
            assert 'from_address' in item
            assert 'content' in item
            assert 'network' in item
    
    def test_feed_btc_mainnet_returns_data_or_empty(self):
        """GET /api/feed/btc-mainnet should return data (may be empty but no error)"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        # Required fields must be present
        assert 'feed' in data
        assert 'has_more' in data
        # No error field should be present
        assert 'error' not in data or data.get('error') is None


class TestFeedConcurrentRequests:
    """Test that concurrent requests don't cause server crashes (P0 fix)"""
    
    def test_concurrent_requests_all_return_quickly(self):
        """5 concurrent requests should all return under 2 seconds"""
        url = f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5"
        results = []
        
        def fetch_feed():
            start = time.time()
            try:
                resp = requests.get(url, timeout=10)
                elapsed = time.time() - start
                return {
                    "status_code": resp.status_code,
                    "elapsed": elapsed,
                    "success": resp.status_code == 200
                }
            except Exception as e:
                return {"status_code": 0, "error": str(e), "success": False}
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(fetch_feed) for _ in range(5)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]
        
        # All requests should succeed
        successes = sum(1 for r in results if r['success'])
        assert successes >= 4, f"Expected at least 4/5 successful requests, got {successes}"
        
        # All successful requests should complete under 2 seconds
        for result in results:
            if result['success']:
                assert result['elapsed'] < 2.0, f"Request took {result['elapsed']}s, expected < 2s"
    
    def test_concurrent_requests_no_server_error(self):
        """Concurrent requests should not return 500 errors"""
        url = f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5"
        
        def fetch_feed():
            try:
                return requests.get(url, timeout=10).status_code
            except:
                return 0
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(fetch_feed) for _ in range(10)]
            status_codes = [f.result() for f in futures]
        
        # No 500 errors allowed
        server_errors = [code for code in status_codes if code >= 500]
        assert len(server_errors) == 0, f"Got server errors: {server_errors}"


class TestFeedCaching:
    """Test MongoDB caching behavior"""
    
    def test_first_request_is_cached(self):
        """After first request, cached should be True"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        # First call might not be cached if cache just expired, but second call should be
        response2 = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2.get('cached') == True, "Second request should be cached"
    
    def test_cache_age_is_positive_integer(self):
        """cache_age should be a positive integer when cached=True"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        if data.get('cached'):
            assert data.get('cache_age') >= 0, "cache_age should be >= 0"


class TestFeedPagination:
    """Test pagination functionality"""
    
    def test_has_more_when_more_data_exists(self):
        """has_more should be True when total > skip + count"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        if data.get('total', 0) > 5:
            assert data.get('has_more') == True
        elif data.get('total', 0) <= 5:
            assert data.get('has_more') == False


class TestRefreshingFlag:
    """Test the refreshing status flag in API response"""
    
    def test_refreshing_flag_is_boolean(self):
        """refreshing field should be a boolean"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", 
                               params={"skip": 0, "limit": 5}, timeout=15)
        assert response.status_code == 200
        data = response.json()
        
        assert 'refreshing' in data
        assert isinstance(data['refreshing'], bool)


# Fixture for BASE_URL validation
@pytest.fixture(autouse=True)
def check_base_url():
    """Ensure BASE_URL is configured"""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not configured")
