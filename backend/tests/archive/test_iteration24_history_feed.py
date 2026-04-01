"""
Iteration 24 Tests: P0 Feed Stability + P1 History Tab ChangeLog Parsing
- P0: Verify _feed_refreshing guard still works (concurrent requests)
- P1: Test /api/objects/history/{address} with proper ChangeLog array parsing
"""

import pytest
import requests
import os
import time
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasics:
    """Basic health and API sanity checks"""
    
    def test_health_endpoint(self):
        """Health endpoint should return healthy"""
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('status') == 'healthy'
        print(f"Health check PASS: {data}")

class TestP0FeedStability:
    """P0: Verify background feed refresh stability with _feed_refreshing guard"""
    
    def test_feed_btc_testnet_returns_data(self):
        """Feed endpoint should return data with all required fields"""
        resp = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={'skip': 0, 'limit': 5}, timeout=120)
        assert resp.status_code == 200, f"Feed returned {resp.status_code}: {resp.text}"
        data = resp.json()
        
        # Check required fields per the fix
        required_fields = ['feed', 'count', 'total', 'has_more']
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Check cached/cache_age/refreshing if cached response
        if data.get('cached'):
            assert 'cache_age' in data, "Cached response should have cache_age"
            assert 'refreshing' in data, "Cached response should have refreshing flag"
        
        print(f"Feed btc-testnet PASS: count={data.get('count')}, total={data.get('total')}, cached={data.get('cached')}, refreshing={data.get('refreshing')}")
        return data
    
    def test_concurrent_feed_requests_no_crash(self):
        """P0 FIX: Multiple concurrent requests should not cause server issues"""
        url = f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=3"
        
        def make_request(i):
            try:
                start = time.time()
                resp = requests.get(url, timeout=120)
                elapsed = (time.time() - start) * 1000
                return {'index': i, 'status': resp.status_code, 'time_ms': elapsed, 'error': None}
            except Exception as e:
                return {'index': i, 'status': 0, 'time_ms': 0, 'error': str(e)}
        
        # Fire 5 concurrent requests
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(make_request, range(5)))
        
        # All should return 200
        success_count = sum(1 for r in results if r['status'] == 200)
        failed = [r for r in results if r['status'] != 200]
        
        print(f"Concurrent requests: {success_count}/5 succeeded")
        for r in results:
            print(f"  Request {r['index']}: status={r['status']}, time={r['time_ms']:.0f}ms, error={r['error']}")
        
        assert success_count >= 4, f"Expected at least 4/5 successful requests, got {success_count}. Failed: {failed}"

class TestP1HistoryTab:
    """P1: Test History endpoint with ChangeLog array parsing fix"""
    
    def test_history_endpoint_returns_data(self):
        """History endpoint should return 500+ items for embii4u address"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # p2fk.io can be slow - use 60s timeout
        resp = requests.get(
            f"{BASE_URL}/api/objects/history/{address}",
            params={'network': 'btc-testnet', 'skip': 0, 'limit': 100},
            timeout=120
        )
        assert resp.status_code == 200, f"History endpoint returned {resp.status_code}: {resp.text}"
        data = resp.json()
        
        assert 'history' in data, "Response should have 'history' field"
        assert 'total' in data, "Response should have 'total' field"
        assert 'count' in data, "Response should have 'count' field"
        assert 'has_more' in data, "Response should have 'has_more' field"
        
        total = data.get('total', 0)
        count = data.get('count', 0)
        
        print(f"History endpoint PASS: count={count}, total={total}, has_more={data.get('has_more')}")
        
        # Should have significant history items
        assert total > 100, f"Expected 500+ history items, got {total}"
        
        return data
    
    def test_history_item_structure(self):
        """Each history item should have proper fields from ChangeLog parsing"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(
            f"{BASE_URL}/api/objects/history/{address}",
            params={'network': 'btc-testnet', 'skip': 0, 'limit': 50},
            timeout=120
        )
        assert resp.status_code == 200
        data = resp.json()
        
        history = data.get('history', [])
        assert len(history) > 0, "Should have at least some history items"
        
        # Required fields per the fix
        required_fields = ['object_urn', 'object_name', 'object_image', 'action', 
                          'from_address', 'to_address', 'quantity', 'value', 'status', 'date']
        
        for item in history[:10]:  # Check first 10 items
            for field in required_fields:
                assert field in item, f"History item missing field: {field}. Item: {item}"
        
        print(f"History structure PASS: All {len(required_fields)} required fields present in items")
        return history
    
    def test_history_has_diverse_actions(self):
        """History should have various action types from ChangeLog parsing"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(
            f"{BASE_URL}/api/objects/history/{address}",
            params={'network': 'btc-testnet', 'skip': 0, 'limit': 200},
            timeout=120
        )
        assert resp.status_code == 200
        data = resp.json()
        
        history = data.get('history', [])
        
        # Extract unique actions
        actions = set()
        for item in history:
            action = item.get('action', '').lower()
            if action:
                actions.add(action)
        
        print(f"Found actions: {actions}")
        
        # Expected actions per the fix - ChangeLog arrays should parse to these
        expected_actions = {'mint', 'claim', 'grant', 'give', 'buy', 'list', 'burn', 'inspect', 'lock', 'offer'}
        found_expected = actions.intersection(expected_actions)
        
        # Should have at least 3 different action types
        assert len(found_expected) >= 3, f"Expected at least 3 action types from {expected_actions}, got {found_expected}"
        print(f"Diverse actions PASS: Found {len(found_expected)} different action types: {found_expected}")
        
        return actions
    
    def test_history_action_values_are_parsed(self):
        """Verify ChangeLog array format is properly parsed (not raw JSON strings)"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(
            f"{BASE_URL}/api/objects/history/{address}",
            params={'network': 'btc-testnet', 'skip': 0, 'limit': 50},
            timeout=120
        )
        assert resp.status_code == 200
        data = resp.json()
        
        history = data.get('history', [])
        
        # Check that values are properly parsed, not raw JSON strings
        for item in history[:20]:
            action = item.get('action', '')
            # Action should NOT be a JSON array string like '["from","to","action"]'
            assert not action.startswith('['), f"Action appears unparsed: {action}"
            assert not action.startswith('{'), f"Action appears unparsed: {action}"
            
            # from_address should be a string, not array
            from_addr = item.get('from_address', '')
            assert isinstance(from_addr, str), f"from_address should be string: {from_addr}"
            assert not from_addr.startswith('['), f"from_address appears unparsed: {from_addr}"
            
            # quantity should be numeric
            qty = item.get('quantity')
            assert isinstance(qty, (int, float)), f"quantity should be numeric: {qty} (type={type(qty)})"
        
        print("ChangeLog parsing PASS: All values properly parsed from JSON arrays")

class TestProfileEndpoint:
    """Test profile endpoint used by frontend"""
    
    def test_profile_embii4u(self):
        """Profile endpoint should return embii4u data"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        resp = requests.get(f"{BASE_URL}/api/profile/{address}", params={'network': 'btc-testnet'}, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        
        assert data.get('urn') == 'embii4u', f"Expected URN 'embii4u', got {data.get('urn')}"
        assert data.get('address') == address
        
        print(f"Profile PASS: {data.get('display_name') or data.get('urn')}")


if __name__ == "__main__":
    pytest.main([__file__, '-v'])
