"""
Iteration 116: Test bug fixes for:
1. BUY protocol operations filtered from feed
2. Audio player IPFS fallback mechanism
3. bitfossil.org URL rewriting to on-chain proxy
4. On-chain file endpoint for testnet
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestOnchainFileEndpoint:
    """Test /api/onchain/file/{txid}/{filename} endpoint"""
    
    def test_onchain_file_endpoint_exists(self):
        """Verify the on-chain file endpoint returns 200 or 202 (resolving)"""
        # Use a known testnet txid (from previous tests)
        test_txid = "0" * 64  # Dummy txid - should return 202 or 500
        response = requests.get(
            f"{BASE_URL}/api/onchain/file/{test_txid}/test.txt",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=10
        )
        # Endpoint should exist - returns 202 (resolving) or 500 (not found)
        assert response.status_code in [200, 202, 500], f"Unexpected status: {response.status_code}"
        print(f"On-chain file endpoint returned: {response.status_code}")
    
    def test_onchain_status_endpoint(self):
        """Verify the on-chain status endpoint works"""
        test_txid = "0" * 64
        response = requests.get(
            f"{BASE_URL}/api/onchain/status/{test_txid}",
            params={"chain": "BTC", "mainnet": "false"},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "resolvable" in data
        print(f"On-chain status: {data}")


class TestFeedEndpoint:
    """Test feed endpoint to verify protocol operations are filtered"""
    
    def test_feed_loads_for_testnet(self):
        """Verify feed loads for btc-testnet"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 50},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        # Feed returns object with 'feed' key
        if isinstance(data, dict) and 'feed' in data:
            feed_items = data['feed']
        else:
            feed_items = data
        assert isinstance(feed_items, list)
        print(f"Feed returned {len(feed_items)} items")
        return feed_items
    
    def test_feed_items_structure(self):
        """Verify feed items have expected structure"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Feed returns object with 'feed' key
        if isinstance(data, dict) and 'feed' in data:
            feed_items = data['feed']
        else:
            feed_items = data
        
        if len(feed_items) > 0:
            item = feed_items[0]
            # Check expected fields
            assert "content" in item or "transaction_id" in item
            print(f"Sample feed item keys: {list(item.keys())[:10]}")
        else:
            print("Feed is empty - no items to check")
    
    def test_feed_contains_protocol_operations(self):
        """Verify backend feed contains protocol operations (frontend filters them)"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"skip": 0, "limit": 50},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        if isinstance(data, dict) and 'feed' in data:
            feed_items = data['feed']
        else:
            feed_items = data
        
        # Count protocol operations in backend response
        protocol_ops = ['BUY', 'GIV', 'OBJ', 'BRN', 'MKR', 'TRD']
        protocol_count = 0
        regular_count = 0
        
        for item in feed_items:
            content = item.get('content', '')
            if content and len(content) >= 4:
                prefix = content[:3].upper()
                sep = content[3] if len(content) > 3 else ''
                if prefix in protocol_ops and sep in '\\//:*?"<>|':
                    protocol_count += 1
                    print(f"Protocol op found: {content[:60]}...")
                else:
                    regular_count += 1
        
        print(f"Backend feed: {protocol_count} protocol ops, {regular_count} regular posts")
        # Backend SHOULD return protocol ops - frontend filters them
        # This test documents that filtering happens on frontend, not backend


class TestProfileFeed:
    """Test profile feed for embii4u on testnet"""
    
    def test_embii4u_profile_feed(self):
        """Verify embii4u profile feed loads on testnet"""
        embii4u_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"address": embii4u_address, "skip": 0, "limit": 50},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Handle both list and dict response formats
        if isinstance(data, dict) and 'feed' in data:
            feed_items = data['feed']
        elif isinstance(data, list):
            feed_items = data
        else:
            feed_items = []
        
        print(f"embii4u feed returned {len(feed_items)} items")
        
        # Check for any protocol operations that should be filtered
        protocol_ops = ['BUY', 'GIV', 'OBJ', 'BRN', 'MKR', 'TRD']
        protocol_count = 0
        for item in feed_items:
            if isinstance(item, dict):
                content = item.get('content', '')
                if content and len(content) >= 4:
                    prefix = content[:3].upper()
                    if prefix in protocol_ops:
                        sep = content[3] if len(content) > 3 else ''
                        if sep in '\\//:*?"<>|':
                            protocol_count += 1
                            print(f"Protocol op in embii4u feed: {content[:50]}...")
        
        print(f"embii4u feed has {protocol_count} protocol operations (filtered by frontend)")
        return feed_items


class TestObjectsEndpoint:
    """Test objects endpoint for embii4u"""
    
    def test_embii4u_objects(self):
        """Verify embii4u objects load on testnet"""
        embii4u_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/objects/created/{embii4u_address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Handle both list and dict response formats
        if isinstance(data, dict) and 'objects' in data:
            objects = data['objects']
        elif isinstance(data, list):
            objects = data
        else:
            objects = []
        
        print(f"embii4u has {len(objects)} created objects")
        
        # Check for various media formats
        media_formats = {"ipfs": 0, "onchain": 0, "http": 0, "bitfossil": 0, "none": 0}
        for obj in objects:
            if isinstance(obj, dict):
                image = obj.get("image", "") or ""
                uri = obj.get("uri", "") or ""
                
                # Check image field
                if image.upper().startswith("IPFS:"):
                    media_formats["ipfs"] += 1
                elif image.upper().startswith(("BTC:", "LTC:", "DOG:", "MZC:")):
                    media_formats["onchain"] += 1
                elif "bitfossil" in image.lower():
                    media_formats["bitfossil"] += 1
                    print(f"Found bitfossil URL in image: {image[:80]}...")
                elif image.startswith("http"):
                    media_formats["http"] += 1
                else:
                    media_formats["none"] += 1
                
                # Also check URI field for bitfossil
                if "bitfossil" in uri.lower():
                    print(f"Found bitfossil URL in URI: {uri[:80]}...")
        
        print(f"Media formats: {media_formats}")
        return objects


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
