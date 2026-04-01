"""
Iteration 15 Backend API Tests
Testing new wallet endpoints (give_object, burn_object, buy_object) and existing features.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_ADDRESS = 'muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs'  # embii4u testnet address
NETWORK = 'btc-testnet'

# Sample object for testing (Boom Bap Sick object from previous tests)
TEST_OBJECT_TXID = '0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a'


class TestHealthAndBasics:
    """Test health and basic endpoints"""
    
    def test_health_endpoint(self):
        """Health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print("PASS: /api/health returns healthy status")
    
    def test_root_endpoint(self):
        """Root API endpoint returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert 'message' in data
        assert 'Cthulhu' in data['message']
        print(f"PASS: /api/ returns {data}")


class TestFeedEndpoint:
    """Test feed endpoints"""
    
    def test_feed_returns_posts(self):
        """Feed endpoint returns posts with correct structure"""
        response = requests.get(f"{BASE_URL}/api/feed/{NETWORK}", params={'skip': 0, 'limit': 5})
        assert response.status_code == 200
        data = response.json()
        assert 'feed' in data
        assert isinstance(data['feed'], list)
        assert data.get('network') == NETWORK
        if data['feed']:
            post = data['feed'][0]
            assert 'from_address' in post
            assert 'content' in post
            assert 'transaction_id' in post
        print(f"PASS: /api/feed/{NETWORK} returns {data.get('total', 0)} posts")


class TestObjectsStorefront:
    """Test objects storefront endpoint"""
    
    def test_storefront_returns_objects(self):
        """Storefront endpoint returns objects with correct structure"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/{NETWORK}", params={'skip': 0, 'limit': 5})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert isinstance(data['objects'], list)
        assert 'total' in data
        assert 'total_listed' in data
        if data['objects']:
            obj = data['objects'][0]
            # Verify object has required fields
            assert 'name' in obj or 'Name' in obj
            assert 'image' in obj or 'Image' in obj
        print(f"PASS: /api/objects/storefront/{NETWORK} returns {data.get('total', 0)} objects, {data.get('total_listed', 0)} listed")


class TestObjectDetail:
    """Test single object detail endpoint"""
    
    def test_object_detail_returns_full_data(self):
        """Object detail endpoint returns complete object data"""
        response = requests.get(f"{BASE_URL}/api/object/{TEST_OBJECT_TXID}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        # Check required fields
        assert 'name' in data
        assert 'urn' in data
        assert 'owners' in data
        assert 'creators' in data
        assert isinstance(data['owners'], list)
        assert isinstance(data['creators'], list)
        print(f"PASS: /api/object/{TEST_OBJECT_TXID} returns object '{data.get('name')}'")
    
    def test_object_detail_has_listings_info(self):
        """Object detail includes listings information"""
        response = requests.get(f"{BASE_URL}/api/object/{TEST_OBJECT_TXID}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        assert 'is_listed' in data
        assert 'listings' in data
        assert isinstance(data['listings'], list)
        print(f"PASS: Object has is_listed={data.get('is_listed')}, {len(data.get('listings', []))} listings")


class TestObjectsOwnedEndpoint:
    """Test objects owned endpoint"""
    
    def test_objects_owned_returns_list(self):
        """GET /api/objects/owned/{address} returns owned objects"""
        response = requests.get(f"{BASE_URL}/api/objects/owned/{TEST_ADDRESS}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert isinstance(data['objects'], list)
        assert 'total' in data
        assert 'address' in data
        assert data['address'] == TEST_ADDRESS
        print(f"PASS: /api/objects/owned/{TEST_ADDRESS} returns {data.get('total', 0)} owned objects")


class TestObjectsCreatedEndpoint:
    """Test objects created endpoint"""
    
    def test_objects_created_returns_list(self):
        """GET /api/objects/created/{address} returns created objects"""
        response = requests.get(f"{BASE_URL}/api/objects/created/{TEST_ADDRESS}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert isinstance(data['objects'], list)
        assert 'total' in data
        assert 'address' in data
        print(f"PASS: /api/objects/created/{TEST_ADDRESS} returns {data.get('total', 0)} created objects")


class TestObjectHistoryEndpoint:
    """Test object history endpoint"""
    
    def test_object_history_returns_items(self):
        """GET /api/objects/history/{address} returns history items"""
        response = requests.get(f"{BASE_URL}/api/objects/history/{TEST_ADDRESS}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        assert 'history' in data
        assert isinstance(data['history'], list)
        assert 'total' in data
        # Verify history item structure if items exist
        if data['history']:
            item = data['history'][0]
            assert 'object_urn' in item or 'object_name' in item
            assert 'action' in item
            assert 'date' in item or 'txid' in item
        print(f"PASS: /api/objects/history/{TEST_ADDRESS} returns {data.get('total', 0)} history items")
    
    def test_history_items_have_correct_structure(self):
        """History items have the expected fields"""
        response = requests.get(f"{BASE_URL}/api/objects/history/{TEST_ADDRESS}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        if data['history']:
            item = data['history'][0]
            # Validate expected fields from the API
            expected_fields = ['object_urn', 'object_name', 'action', 'from_address', 'date', 'txid']
            present_fields = [f for f in expected_fields if f in item]
            assert len(present_fields) >= 4, f"History item missing fields. Present: {present_fields}"
        print(f"PASS: History items have correct structure")


class TestWalletGiveObjectEndpoint:
    """Test POST /api/wallet/give_object endpoint"""
    
    def test_give_object_endpoint_exists(self):
        """Give object endpoint exists and validates input"""
        # Send request with invalid WIF - should get 400
        response = requests.post(f"{BASE_URL}/api/wallet/give_object", json={
            'wif': 'invalid_wif_key',
            'object_address': TEST_ADDRESS,
            'recipient_address': 'testRecipient123',
            'quantity': 1,
            'network': NETWORK
        })
        # Should return 400 for invalid WIF (not 404 or 500 - meaning endpoint exists)
        assert response.status_code == 400, f"Expected 400 for invalid WIF, got {response.status_code}"
        data = response.json()
        assert 'detail' in data
        # Should mention WIF validation
        assert 'WIF' in data['detail'] or 'wif' in data['detail'].lower() or 'Invalid' in data['detail']
        print(f"PASS: POST /api/wallet/give_object exists and validates WIF - returns: {data['detail']}")
    
    def test_give_object_requires_all_params(self):
        """Give object endpoint requires all parameters"""
        # Missing wif - should get validation error
        response = requests.post(f"{BASE_URL}/api/wallet/give_object", json={
            'object_address': TEST_ADDRESS,
            'recipient_address': 'testRecipient123',
            'quantity': 1,
            'network': NETWORK
        })
        # Should return 422 for missing required field
        assert response.status_code == 422
        print(f"PASS: Give object endpoint validates required fields")


class TestWalletBurnObjectEndpoint:
    """Test POST /api/wallet/burn_object endpoint"""
    
    def test_burn_object_endpoint_exists(self):
        """Burn object endpoint exists and validates input"""
        response = requests.post(f"{BASE_URL}/api/wallet/burn_object", json={
            'wif': 'invalid_wif_key',
            'object_address': TEST_ADDRESS,
            'quantity': 1,
            'network': NETWORK
        })
        # Should return 400 for invalid WIF (endpoint exists)
        assert response.status_code == 400, f"Expected 400 for invalid WIF, got {response.status_code}"
        data = response.json()
        assert 'detail' in data
        print(f"PASS: POST /api/wallet/burn_object exists and validates WIF - returns: {data['detail']}")
    
    def test_burn_object_requires_wif(self):
        """Burn object endpoint requires WIF parameter"""
        response = requests.post(f"{BASE_URL}/api/wallet/burn_object", json={
            'object_address': TEST_ADDRESS,
            'quantity': 1,
            'network': NETWORK
        })
        assert response.status_code == 422
        print(f"PASS: Burn object endpoint validates required wif field")


class TestWalletBuyObjectEndpoint:
    """Test POST /api/wallet/buy_object endpoint"""
    
    def test_buy_object_endpoint_exists(self):
        """Buy object endpoint exists and validates input"""
        response = requests.post(f"{BASE_URL}/api/wallet/buy_object", json={
            'wif': 'invalid_wif_key',
            'object_address': TEST_ADDRESS,
            'owner_address': 'testOwner123',
            'quantity': 1,
            'price_sats': 1000,
            'network': NETWORK
        })
        # Should return 400 for invalid WIF (endpoint exists)
        assert response.status_code == 400, f"Expected 400 for invalid WIF, got {response.status_code}"
        data = response.json()
        assert 'detail' in data
        print(f"PASS: POST /api/wallet/buy_object exists and validates WIF - returns: {data['detail']}")
    
    def test_buy_object_requires_owner_address(self):
        """Buy object endpoint requires owner_address parameter"""
        response = requests.post(f"{BASE_URL}/api/wallet/buy_object", json={
            'wif': 'cSomeValidWifFormatButInvalid123',
            'object_address': TEST_ADDRESS,
            'quantity': 1,
            'price_sats': 1000,
            'network': NETWORK
        })
        # Should fail - either validation error or WIF error
        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print(f"PASS: Buy object endpoint handles missing/invalid parameters")


class TestProfileEndpoint:
    """Test profile endpoint"""
    
    def test_profile_returns_data(self):
        """Profile endpoint returns profile data"""
        response = requests.get(f"{BASE_URL}/api/profile/{TEST_ADDRESS}", params={'network': NETWORK})
        assert response.status_code == 200
        data = response.json()
        assert 'address' in data or 'urn' in data
        print(f"PASS: /api/profile/{TEST_ADDRESS} returns profile data")


class TestSearchEndpoint:
    """Test search endpoint"""
    
    def test_search_returns_results(self):
        """Search endpoint returns profiles and objects"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            'query': 'embii4u',
            'network': NETWORK
        })
        assert response.status_code == 200
        data = response.json()
        assert 'profiles' in data
        assert 'objects' in data
        print(f"PASS: /api/search returns profiles={len(data.get('profiles', []))}, objects={len(data.get('objects', []))}")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
