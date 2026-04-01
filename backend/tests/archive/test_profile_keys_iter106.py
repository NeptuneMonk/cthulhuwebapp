"""
Iteration 106: Test profile keys endpoints for encrypted walkie-talkie messaging
Tests:
1. GET /api/profile/keys/{address_or_urn} - returns has_keys, pkx, pky fields
2. POST /api/profile/keys/batch - returns key status for multiple addresses
3. Edge cases: non-existent users, empty batch requests
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test addresses from the problem statement
TEST_ADDRESSES = {
    'Emergent': 'mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz',  # has keys
    'Emergent2': 'mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF',  # has keys
    'embii4u': 'muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs',  # has keys
}

NETWORK = 'btc-testnet'


class TestProfileKeysEndpoint:
    """Tests for GET /api/profile/keys/{address_or_urn}"""
    
    def test_get_keys_by_address_with_keys(self):
        """Test fetching keys for a user who has published PKX/PKY"""
        address = TEST_ADDRESSES['Emergent']
        response = requests.get(f"{BASE_URL}/api/profile/keys/{address}?network={NETWORK}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Verify response structure
        assert 'has_keys' in data, "Response should contain 'has_keys' field"
        assert 'pkx' in data, "Response should contain 'pkx' field"
        assert 'pky' in data, "Response should contain 'pky' field"
        assert 'urn' in data, "Response should contain 'urn' field"
        assert 'address' in data, "Response should contain 'address' field"
        
        # Verify data types
        assert isinstance(data['has_keys'], bool), "has_keys should be boolean"
        assert isinstance(data['pkx'], str), "pkx should be string"
        assert isinstance(data['pky'], str), "pky should be string"
        
        print(f"User {address}: has_keys={data['has_keys']}, pkx={data['pkx'][:20] if data['pkx'] else 'N/A'}...")
    
    def test_get_keys_by_urn(self):
        """Test fetching keys by URN instead of address"""
        urn = 'Emergent'
        response = requests.get(f"{BASE_URL}/api/profile/keys/{urn}?network={NETWORK}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Verify response structure
        assert 'has_keys' in data, "Response should contain 'has_keys' field"
        assert 'pkx' in data, "Response should contain 'pkx' field"
        assert 'pky' in data, "Response should contain 'pky' field"
        
        print(f"User {urn}: has_keys={data['has_keys']}")
    
    def test_get_keys_nonexistent_user(self):
        """Test fetching keys for a non-existent user returns has_keys: false"""
        fake_address = 'NonExistentUser12345'
        response = requests.get(f"{BASE_URL}/api/profile/keys/{fake_address}?network={NETWORK}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Non-existent user should return has_keys: false
        assert data['has_keys'] == False, "Non-existent user should have has_keys=false"
        assert data['pkx'] == '', "Non-existent user should have empty pkx"
        assert data['pky'] == '', "Non-existent user should have empty pky"
        
        print(f"Non-existent user correctly returns has_keys=false")
    
    def test_get_keys_multiple_users(self):
        """Test fetching keys for multiple known users"""
        for name, address in TEST_ADDRESSES.items():
            response = requests.get(f"{BASE_URL}/api/profile/keys/{address}?network={NETWORK}")
            assert response.status_code == 200, f"Failed for {name}: {response.status_code}"
            data = response.json()
            print(f"{name} ({address[:12]}...): has_keys={data['has_keys']}")


class TestProfileKeysBatchEndpoint:
    """Tests for POST /api/profile/keys/batch"""
    
    def test_batch_keys_multiple_addresses(self):
        """Test batch checking keys for multiple addresses"""
        addresses = list(TEST_ADDRESSES.values())
        
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network={NETWORK}",
            json={'addresses': addresses}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Verify response structure
        assert 'keys' in data, "Response should contain 'keys' field"
        assert isinstance(data['keys'], dict), "keys should be a dictionary"
        
        # Verify each address is in the response
        for address in addresses:
            assert address in data['keys'], f"Address {address} should be in response"
            assert isinstance(data['keys'][address], bool), f"Key status for {address} should be boolean"
        
        print(f"Batch keys response: {data['keys']}")
    
    def test_batch_keys_empty_list(self):
        """Test batch with empty address list"""
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network={NETWORK}",
            json={'addresses': []}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert 'keys' in data, "Response should contain 'keys' field"
        assert data['keys'] == {}, "Empty address list should return empty keys dict"
        
        print("Empty batch correctly returns empty keys dict")
    
    def test_batch_keys_mixed_users(self):
        """Test batch with mix of existing and non-existing users"""
        addresses = [
            TEST_ADDRESSES['Emergent'],
            'FakeAddress12345',
            TEST_ADDRESSES['embii4u'],
        ]
        
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network={NETWORK}",
            json={'addresses': addresses}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert 'keys' in data, "Response should contain 'keys' field"
        
        # Fake address should return false
        assert data['keys'].get('FakeAddress12345') == False, "Fake address should have has_keys=false"
        
        print(f"Mixed batch response: {data['keys']}")
    
    def test_batch_keys_limit(self):
        """Test that batch endpoint respects the 100 address limit"""
        # Create a list of 101 addresses (over the limit)
        addresses = [f"TestAddress{i}" for i in range(101)]
        
        response = requests.post(
            f"{BASE_URL}/api/profile/keys/batch?network={NETWORK}",
            json={'addresses': addresses}
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Should return empty keys dict when over limit
        assert data['keys'] == {}, "Over-limit batch should return empty keys dict"
        
        print("Batch limit correctly enforced")


class TestKnownUsersWithKeys:
    """Test that known-users endpoint works (used by walkie-talkie for dropdown)"""
    
    def test_known_users_endpoint(self):
        """Test fetching known users list"""
        response = requests.get(f"{BASE_URL}/api/known-users/{NETWORK}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert 'users' in data, "Response should contain 'users' field"
        assert 'count' in data, "Response should contain 'count' field"
        assert isinstance(data['users'], list), "users should be a list"
        
        print(f"Known users count: {data['count']}")
        
        # Check that users have expected fields
        if data['users']:
            user = data['users'][0]
            assert 'address' in user, "User should have 'address' field"
            print(f"Sample user: {user.get('urn', 'N/A')} - {user.get('address', 'N/A')[:12]}...")


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
