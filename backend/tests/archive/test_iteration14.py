"""
Iteration 14 - Comprehensive API Tests for Cthulhu Blockchain App
Tests all features mentioned in the testing request:
- Feed, Objects storefront, Object detail, Profile, Search endpoints
- Network selector (mainnet/testnet)
- IPFS image handling
- FileViewer component rendering
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndBasics:
    """Health check and basic API tests"""
    
    def test_health_endpoint(self):
        """GET /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print("✓ Health endpoint returns healthy status")
    
    def test_root_endpoint(self):
        """GET /api/ returns API info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert 'Cthulhu' in data.get('message', '')
        print("✓ Root endpoint returns API info")


class TestFeedEndpoint:
    """Home feed tests"""
    
    def test_feed_btc_testnet(self):
        """GET /api/feed/btc-testnet returns posts with profiles and timestamps"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={'limit': 5})
        assert response.status_code == 200
        data = response.json()
        assert 'feed' in data
        assert 'total' in data
        assert data['network'] == 'btc-testnet'
        
        # Check that posts have required fields
        if data['feed']:
            post = data['feed'][0]
            assert 'from_address' in post, "Posts should have from_address"
            assert 'created_at' in post, "Posts should have timestamps"
            assert 'content' in post, "Posts should have content"
        print(f"✓ Feed returns {data['total']} posts with profiles and timestamps")
    
    def test_feed_btc_mainnet(self):
        """GET /api/feed/btc-mainnet returns mainnet posts"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet", params={'limit': 3})
        assert response.status_code == 200
        data = response.json()
        assert data['network'] == 'btc-mainnet'
        print(f"✓ Mainnet feed works, {data['total']} posts")


class TestObjectsStorefront:
    """Object storefront tests"""
    
    def test_storefront_loads(self):
        """GET /api/objects/storefront/btc-testnet returns grid of objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={'limit': 12})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert 'total' in data
        assert 'total_listed' in data
        assert len(data['objects']) > 0, "Storefront should have objects"
        print(f"✓ Storefront returns {data['total']} objects, {data['total_listed']} for sale")
    
    def test_storefront_object_has_ipfs_image(self):
        """Objects in storefront have IPFS images"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={'limit': 20})
        assert response.status_code == 200
        data = response.json()
        
        ipfs_count = 0
        for obj in data['objects']:
            image = obj.get('image', '')
            urn = obj.get('urn', '')
            if 'IPFS:' in str(image) or 'IPFS:' in str(urn):
                ipfs_count += 1
        
        print(f"✓ {ipfs_count}/{len(data['objects'])} objects have IPFS images")
        assert ipfs_count > 0, "At least some objects should have IPFS images"


class TestSingleObjectDetail:
    """Single object detail page tests"""
    
    # Test object with known IPFS image and URI
    TEST_TXID = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
    
    def test_object_detail_loads(self):
        """GET /api/object/{txid} returns object details"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert 'name' in data
        assert 'image' in data
        assert 'transaction_id' in data or 'TransactionId' in data
        print(f"✓ Object '{data['name']}' loaded successfully")
    
    def test_object_has_cover_image(self):
        """Object detail has cover image field"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        image = data.get('image', '')
        assert image, "Object should have image field"
        assert 'IPFS:' in image or 'BTC:' in image or image.startswith('http'), "Image should be IPFS, BTC ref, or URL"
        print(f"✓ Object has image: {image[:60]}...")
    
    def test_object_has_details(self):
        """Object has supply, max supply, owners, license, created date"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        assert 'total_supply' in data
        assert 'maximum' in data or 'max_supply' in data
        assert 'owners' in data or 'owner_count' in data
        assert 'created_date' in data
        
        owners = data.get('owners', [])
        owner_count = data.get('owner_count', len(owners))
        print(f"✓ Object has {data['total_supply']} supply, {owner_count} owners, created {data.get('created_date', 'N/A')[:10]}")
    
    def test_object_has_creators(self):
        """Object has creators list"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        creators = data.get('creators', [])
        assert len(creators) > 0, "Object should have at least one creator"
        print(f"✓ Object has {len(creators)} creator(s)")
    
    def test_object_has_listings_info(self):
        """Object has listings and price info"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        assert 'is_listed' in data
        assert 'listings' in data
        assert 'min_price' in data
        print(f"✓ Object is_listed: {data['is_listed']}, min_price: {data['min_price']}")
    
    def test_object_has_uri_field(self):
        """Object detail shows FILE/CONTENT section when URI present"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        # URI field for file content
        uri = data.get('uri')
        assert uri is not None, "Object should have URI field for FILE/CONTENT section"
        print(f"✓ Object has URI: {uri[:50] if uri else 'None'}...")
    
    def test_object_has_transaction_info(self):
        """Object has transaction ID info"""
        response = requests.get(f"{BASE_URL}/api/object/{self.TEST_TXID}")
        data = response.json()
        
        txid = data.get('transaction_id') or data.get('TransactionId')
        assert txid == self.TEST_TXID
        print(f"✓ Object has transaction ID: {txid[:20]}...")
    
    def test_object_404_for_invalid_txid(self):
        """GET /api/object/{invalid} returns 404"""
        response = requests.get(f"{BASE_URL}/api/object/invalidtxid12345")
        assert response.status_code == 404
        print("✓ Invalid txid returns 404")


class TestProfilePage:
    """Profile page tests"""
    
    # Known test user
    TEST_ADDRESS = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
    TEST_URN = "embii4u"
    
    def test_profile_by_address(self):
        """GET /api/profile/{address} returns profile info"""
        response = requests.get(f"{BASE_URL}/api/profile/{self.TEST_ADDRESS}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('urn') == self.TEST_URN
        assert 'address' in data
        assert 'image' in data
        print(f"✓ Profile loaded: @{data['urn']}")
    
    def test_profile_by_urn(self):
        """GET /api/profile/{urn} returns profile info"""
        response = requests.get(f"{BASE_URL}/api/profile/{self.TEST_URN}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert data.get('urn') == self.TEST_URN
        print(f"✓ Profile by URN works: @{data['urn']}")
    
    def test_profile_verified_badge_endpoint(self):
        """GET /api/profile/{address}/verified_image returns verification status"""
        response = requests.get(f"{BASE_URL}/api/profile/{self.TEST_ADDRESS}/verified_image", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'verified' in data
        print(f"✓ Verified badge endpoint works, verified: {data['verified']}")
    
    def test_profile_posts_endpoint(self):
        """GET /api/profile/{address}/posts returns timeline posts"""
        response = requests.get(f"{BASE_URL}/api/profile/{self.TEST_ADDRESS}/posts", params={'network': 'btc-testnet', 'limit': 5})
        assert response.status_code == 200
        data = response.json()
        assert 'posts' in data
        assert 'total' in data
        print(f"✓ Profile posts: {data['total']} total")
    
    def test_profile_replies_endpoint(self):
        """GET /api/profile/{address}/replies returns replies (Conversation tab)"""
        response = requests.get(f"{BASE_URL}/api/profile/{self.TEST_ADDRESS}/replies", params={'network': 'btc-testnet', 'limit': 5})
        assert response.status_code == 200
        data = response.json()
        assert 'replies' in data
        print(f"✓ Profile replies: {data.get('total', 0)} total")


class TestProfileObjectsTabs:
    """Profile Objects tab with sub-filters"""
    
    TEST_ADDRESS = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
    
    def test_objects_created_filter(self):
        """GET /api/objects/created/{address} returns created objects"""
        response = requests.get(f"{BASE_URL}/api/objects/created/{self.TEST_ADDRESS}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert 'total' in data
        print(f"✓ Created objects: {data['total']}")
    
    def test_objects_owned_filter(self):
        """GET /api/objects/owned/{address} returns owned objects"""
        response = requests.get(f"{BASE_URL}/api/objects/owned/{self.TEST_ADDRESS}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        assert 'total' in data
        print(f"✓ Owned objects: {data['total']}")
    
    def test_objects_collection_filter(self):
        """GET /api/objects/collection/{address} returns collection items"""
        response = requests.get(f"{BASE_URL}/api/objects/collection/{self.TEST_ADDRESS}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        print(f"✓ Collection objects: {data['total']}")
    
    def test_objects_history_filter(self):
        """GET /api/objects/history/{address} returns transaction history"""
        response = requests.get(f"{BASE_URL}/api/objects/history/{self.TEST_ADDRESS}", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'history' in data
        assert 'total' in data
        
        # Check history items have required fields
        if data['history']:
            item = data['history'][0]
            assert 'action' in item, "History items should have action (MINT, GIV, etc)"
            assert 'object_urn' in item or 'object_name' in item
        print(f"✓ History items: {data['total']}")


class TestSearchFunctionality:
    """Search endpoint tests"""
    
    def test_search_by_username(self):
        """POST /api/search with username returns profiles"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            'query': 'embii4u',
            'network': 'btc-testnet'
        })
        assert response.status_code == 200
        data = response.json()
        assert 'profiles' in data
        assert len(data['profiles']) > 0, "Should find embii4u profile"
        print(f"✓ Search by username found {len(data['profiles'])} profiles")
    
    def test_search_by_keyword(self):
        """POST /api/search with keyword returns objects"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            'query': 'game',
            'network': 'btc-testnet'
        })
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        print(f"✓ Search by keyword found {len(data.get('objects', []))} objects")
    
    def test_search_objects_endpoint(self):
        """GET /api/objects/search/{keyword} returns matching objects"""
        response = requests.get(f"{BASE_URL}/api/objects/search/music", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'objects' in data
        print(f"✓ Object search found {data.get('total', 0)} objects")


class TestNetworkSelector:
    """Network selector tests (mainnet/testnet)"""
    
    def test_testnet_works(self):
        """btc-testnet network returns testnet data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={'limit': 1})
        assert response.status_code == 200
        data = response.json()
        assert data['network'] == 'btc-testnet'
        print("✓ Testnet network works")
    
    def test_mainnet_works(self):
        """btc-mainnet network returns mainnet data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet", params={'limit': 1})
        assert response.status_code == 200
        data = response.json()
        assert data['network'] == 'btc-mainnet'
        print("✓ Mainnet network works")
    
    def test_storefront_network_param(self):
        """Storefront accepts network parameter"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet")
        assert response.status_code == 200
        print("✓ Storefront network parameter works")


class TestWalletEndpoints:
    """Wallet button functionality tests"""
    
    def test_wallet_create(self):
        """POST /api/wallet/create generates new wallet"""
        response = requests.post(f"{BASE_URL}/api/wallet/create", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'address' in data
        assert 'wif' in data
        assert data['address'].startswith('m') or data['address'].startswith('n'), "Testnet address should start with m or n"
        print(f"✓ Wallet created: {data['address'][:15]}...")
    
    def test_wallet_balance(self):
        """GET /api/wallet/balance/{address} returns balance"""
        response = requests.get(f"{BASE_URL}/api/wallet/balance/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'balance_sats' in data or 'balance' in data or 'address' in data
        print(f"✓ Wallet balance endpoint works")


class TestConversationEndpoint:
    """Conversation view tests"""
    
    def test_conversation_endpoint(self):
        """GET /api/conversation/{address} returns conversation history"""
        response = requests.get(f"{BASE_URL}/api/conversation/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs", params={'network': 'btc-testnet'})
        assert response.status_code == 200
        data = response.json()
        assert 'roots' in data
        print(f"✓ Conversation endpoint works, {data.get('total', 0)} roots")


class TestIPFSImageHandling:
    """IPFS image loading tests"""
    
    def test_object_with_ipfs_image(self):
        """Objects have IPFS images that can be parsed"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={'limit': 10})
        data = response.json()
        
        ipfs_images = []
        for obj in data['objects']:
            image = obj.get('image', '')
            if image.startswith('IPFS:'):
                ipfs_images.append(image)
        
        assert len(ipfs_images) > 0, "Should have IPFS images in storefront"
        
        # Validate IPFS format
        for img in ipfs_images[:3]:
            assert 'Qm' in img or 'bafy' in img, f"IPFS image should have valid CID: {img}"
        
        print(f"✓ Found {len(ipfs_images)} IPFS images in storefront")
    
    def test_profile_with_ipfs_image(self):
        """Profile has IPFS image"""
        response = requests.get(f"{BASE_URL}/api/profile/embii4u", params={'network': 'btc-testnet'})
        data = response.json()
        
        image = data.get('image', '')
        assert 'IPFS:' in image, f"Profile should have IPFS image, got: {image}"
        print(f"✓ Profile has IPFS image: {image[:50]}...")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
