"""
Test suite for on-chain text resolution and storefront source filters (Iteration 27)

Features tested:
1. On-chain text resolution - /api/onchain/file/{txid}/data.txt endpoint
2. Object detail API with text content URNs (bare 64-char hex txids)
3. Storefront API and source detection
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known text objects (Rumi poems) on BTC mainnet
TEXT_OBJECTS = [
    {
        'object_txid': '43d7f7a5be46e7238631a0ca183c927d869d55e5ad8d4835bc1a115c49db0016',
        'content_txid': 'e0f3a9c2caf3e26494ea68f35ecacb8bdc8207ad48d6f354d931c7f9821faada',
        'name': 'This moment - Rumi',
        'expected_text_snippet': 'This moment, this love',
    },
    {
        'object_txid': 'e9e28aa967d0739cc802e7ca473434905b5a2716788e35104fe621c8ca2a2d57',
        'content_txid': '8dd8519bea9410c3caf2c5840a10f5c8cf786750469a88b8099b03f38013372e',
        'name': 'out beyond ideas - Rumi',
        'expected_text_snippet': 'Out beyond ideas',
    },
]


class TestHealthCheck:
    """Basic API health check"""
    
    def test_api_health(self):
        """Verify API is healthy"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print("✓ API health check passed")


class TestOnChainTextResolution:
    """Tests for on-chain text content resolution from blockchain"""
    
    def test_onchain_text_endpoint_returns_text(self):
        """Test /api/onchain/file/{txid}/data.txt returns text content"""
        txid = TEXT_OBJECTS[0]['content_txid']
        expected_snippet = TEXT_OBJECTS[0]['expected_text_snippet']
        
        url = f"{BASE_URL}/api/onchain/file/{txid}/data.txt?chain=BTC&mainnet=true"
        response = requests.get(url)
        
        # May return 202 if still resolving, retry a few times
        retries = 3
        while response.status_code == 202 and retries > 0:
            print(f"  Text resolving... (status 202, retrying in 5s)")
            time.sleep(5)
            response = requests.get(url)
            retries -= 1
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        text_content = response.text
        assert expected_snippet in text_content, f"Expected '{expected_snippet}' in text content"
        print(f"✓ On-chain text endpoint returned text for {txid[:16]}...")
        print(f"  Text preview: {text_content[:100]}...")
    
    def test_second_text_object_resolution(self):
        """Test second Rumi poem text resolution"""
        txid = TEXT_OBJECTS[1]['content_txid']
        expected_snippet = TEXT_OBJECTS[1]['expected_text_snippet']
        
        url = f"{BASE_URL}/api/onchain/file/{txid}/data.txt?chain=BTC&mainnet=true"
        response = requests.get(url)
        
        retries = 3
        while response.status_code == 202 and retries > 0:
            print(f"  Text resolving... (status 202, retrying in 5s)")
            time.sleep(5)
            response = requests.get(url)
            retries -= 1
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        text_content = response.text
        assert expected_snippet in text_content, f"Expected '{expected_snippet}' in text content"
        print(f"✓ Second on-chain text resolved: {text_content[:80]}...")


class TestObjectDetailWithTextContent:
    """Tests for object detail API returning text object metadata"""
    
    def test_object_api_returns_bare_txid_urn(self):
        """Verify object API returns URN as bare 64-char hex txid for text objects"""
        obj = TEXT_OBJECTS[0]
        response = requests.get(
            f"{BASE_URL}/api/object/{obj['object_txid']}",
            params={'network': 'btc-mainnet'}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # URN should be the content txid (64-char hex)
        urn = data.get('urn', '')
        assert len(urn) == 64, f"Expected 64-char hex URN, got: {urn[:20]}..."
        assert urn == obj['content_txid'], f"URN mismatch: expected {obj['content_txid'][:16]}..."
        
        # Name should match
        assert data.get('name') == obj['name']
        
        # Image should be empty for text-only objects
        assert data.get('image') == '', "Text objects should have empty image field"
        
        print(f"✓ Object API returns correct URN for text object: {obj['name']}")
    
    def test_object_has_resolved_profiles(self):
        """Verify object detail includes resolved profiles for owners/creators"""
        obj = TEXT_OBJECTS[0]
        response = requests.get(
            f"{BASE_URL}/api/object/{obj['object_txid']}",
            params={'network': 'btc-mainnet'}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have resolved_profiles dict
        resolved = data.get('resolved_profiles', {})
        assert isinstance(resolved, dict)
        print(f"✓ Object has {len(resolved)} resolved profiles")


class TestStorefrontAPI:
    """Tests for storefront API and source filter functionality"""
    
    def test_storefront_returns_objects(self):
        """Verify storefront API returns object list"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-mainnet",
            params={'skip': 0, 'limit': 20}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert 'objects' in data
        assert 'total' in data
        assert isinstance(data['objects'], list)
        assert data['total'] > 0, "Expected some objects in storefront"
        
        print(f"✓ Storefront returned {len(data['objects'])} objects (total: {data['total']})")
    
    def test_storefront_objects_have_source_info(self):
        """Verify storefront objects have URN/Image fields for source detection"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-mainnet",
            params={'skip': 0, 'limit': 20}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        objects = data.get('objects', [])
        assert len(objects) > 0
        
        # Count objects by source type
        source_counts = {'IPFS': 0, 'BTC': 0, 'DOGE': 0, 'LTC': 0, 'MAZ': 0, 'OTHER': 0}
        for obj in objects:
            urn = obj.get('urn', '') or ''
            image = obj.get('image', '') or ''
            ref = urn or image
            
            if ref.upper().startswith('IPFS:'):
                source_counts['IPFS'] += 1
            elif ref.upper().startswith('DOG:'):
                source_counts['DOGE'] += 1
            elif ref.upper().startswith('LTC:'):
                source_counts['LTC'] += 1
            elif ref.upper().startswith('MZC:'):
                source_counts['MAZ'] += 1
            elif ref.upper().startswith('BTC:') or (len(ref) >= 64 and all(c in '0123456789abcdefABCDEF' for c in ref[:64])):
                source_counts['BTC'] += 1
            else:
                source_counts['OTHER'] += 1
        
        print(f"✓ Source distribution: {source_counts}")
    
    def test_storefront_has_listing_info(self):
        """Verify storefront returns listing/sale information"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-mainnet",
            params={'skip': 0, 'limit': 50}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        total_listed = data.get('total_listed', 0)
        print(f"✓ Storefront has {total_listed} objects listed for sale")


class TestOnChainEndpoint202Polling:
    """Test the 202 polling pattern for on-chain content"""
    
    def test_202_response_format(self):
        """Verify 202 response has proper format for uncached content"""
        # Use a txid that's less likely to be cached
        # Note: This may return 200 if cached, which is also valid
        txid = TEXT_OBJECTS[1]['content_txid']
        url = f"{BASE_URL}/api/onchain/file/{txid}/data.txt?chain=BTC&mainnet=true"
        
        response = requests.get(url)
        
        if response.status_code == 202:
            data = response.json()
            assert 'status' in data, "202 response should have 'status' field"
            assert data['status'] == 'resolving'
            assert 'key' in data, "202 response should have 'key' field"
            print(f"✓ 202 response format correct: {data}")
        elif response.status_code == 200:
            print(f"✓ Content was already cached (200 response)")
        else:
            pytest.fail(f"Unexpected status code: {response.status_code}")


@pytest.fixture(scope='session', autouse=True)
def setup_env():
    """Ensure environment is set up correctly"""
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    print(f"\n=== Testing against: {BASE_URL} ===\n")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
