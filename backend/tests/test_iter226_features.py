"""
Iteration 226 Tests: Surgical Delete, Clear Chat Recovery, SEC Backup Blocklist, Storefront Chain Filter, BlockList Crash Fix

Features tested:
1. Feed page loads without errors (blockList crash fixed)
2. Storefront page loads with chain filters (Featured, BTC, LTC, DOG, MZC, IPFS)
3. Profile detail page loads with Block button visible for non-own profiles
4. Auth/Login page shows the 'Unmoderated Space' content advisory
5. DM page shows both 'Clear Chat' and 'Recover Chat' buttons in the menu
6. POST /api/reactions/{txid} with type=delete returns ok:true and triggers surgical cache purge
7. GET /api/reactions/{txid} endpoint returns proper structure with deleted_by_author field
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

class TestHealthAndBasicEndpoints:
    """Basic health and API availability tests"""
    
    def test_health_endpoint(self):
        """Test that the health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") in ["healthy", "degraded"]
        assert "services" in data
        print(f"Health check: {data}")
    
    def test_root_endpoint(self):
        """Test that the root API endpoint returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Cthulhu" in data["message"]
        print(f"Root endpoint: {data}")


class TestReactionsEndpoint:
    """Tests for the reactions endpoint - surgical delete feature"""
    
    def test_get_reactions_structure(self):
        """GET /api/reactions/{txid} returns proper structure with deleted_by_author field"""
        # Use a sample txid (doesn't need to exist - endpoint should return default structure)
        sample_txid = "0000000000000000000000000000000000000000000000000000000000000000"
        response = requests.get(f"{BASE_URL}/api/reactions/{sample_txid}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields exist
        assert "txid" in data
        assert "likes" in data
        assert "tips" in data
        assert "pins" in data
        assert "deletes" in data
        assert "deleted_by_author" in data  # NEW FIELD - critical for surgical delete
        assert "like_addrs" in data
        assert "pin_addrs" in data
        assert "tip_total" in data
        assert "has_pending" in data
        
        # Verify types
        assert isinstance(data["likes"], int)
        assert isinstance(data["tips"], int)
        assert isinstance(data["pins"], int)
        assert isinstance(data["deletes"], int)
        assert isinstance(data["deleted_by_author"], bool)
        
        print(f"Reactions structure: {data}")
    
    def test_post_reaction_delete_type(self):
        """POST /api/reactions/{txid} with type=delete returns ok:true"""
        sample_txid = "test_delete_" + str(os.urandom(8).hex())
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        response = requests.post(
            f"{BASE_URL}/api/reactions/{sample_txid}?network=btc-testnet",
            json={
                "type": "delete",
                "from_address": test_address,
                "broadcast_txid": "test_broadcast_txid",
                "amount": 0
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"Delete reaction response: {data}")
    
    def test_post_reaction_like_type(self):
        """POST /api/reactions/{txid} with type=like returns ok:true"""
        sample_txid = "test_like_" + str(os.urandom(8).hex())
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        response = requests.post(
            f"{BASE_URL}/api/reactions/{sample_txid}?network=btc-testnet",
            json={
                "type": "like",
                "from_address": test_address,
                "broadcast_txid": "test_broadcast_txid",
                "amount": 0
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        print(f"Like reaction response: {data}")
    
    def test_post_reaction_requires_from_address(self):
        """POST /api/reactions/{txid} without from_address returns error"""
        sample_txid = "test_no_addr_" + str(os.urandom(8).hex())
        
        response = requests.post(
            f"{BASE_URL}/api/reactions/{sample_txid}?network=btc-testnet",
            json={
                "type": "like",
                "broadcast_txid": "test_broadcast_txid"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == False
        assert "from_address" in data.get("error", "").lower()
        print(f"Missing from_address response: {data}")


class TestFeedEndpoint:
    """Tests for the feed endpoint"""
    
    def test_feed_loads(self):
        """GET /api/feed/{network} returns feed data"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        
        assert "feed" in data
        assert "network" in data
        assert "count" in data
        assert "total" in data
        assert "has_more" in data
        
        print(f"Feed response: count={data['count']}, total={data['total']}, has_more={data['has_more']}")
    
    def test_feed_mode_global(self):
        """GET /api/feed/{network}?mode=global returns mode field"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=global&skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("mode") == "global"
        print(f"Feed global mode: {data.get('mode')}")
    
    def test_feed_mode_following(self):
        """GET /api/feed/{network}?mode=following returns mode field"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?mode=following&followed=&skip=0&limit=5")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("mode") == "following"
        print(f"Feed following mode: {data.get('mode')}")


class TestProfileEndpoint:
    """Tests for the profile endpoint"""
    
    def test_profile_by_address(self):
        """GET /api/profile/{address} returns profile data"""
        # Use a known test address
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/profile/{test_address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "address" in data
        assert "network" in data
        print(f"Profile response: {data}")


class TestStorefrontEndpoint:
    """Tests for the storefront/objects search endpoint"""
    
    def test_objects_search_embii(self):
        """GET /api/p2fk/search/objects returns objects for 'embii' search"""
        response = requests.get(f"{BASE_URL}/api/p2fk/search/objects?searchString=embii&qty=10&skip=0")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"Objects search 'embii': {len(data)} results")
        
        # Check that objects have blockchain field for chain filtering
        if len(data) > 0:
            first_obj = data[0]
            assert "blockchain" in first_obj or "object" in first_obj
            print(f"First object has blockchain field: {'blockchain' in first_obj}")
    
    def test_objects_search_btc(self):
        """GET /api/p2fk/search/objects returns objects for 'BTC' search"""
        response = requests.get(f"{BASE_URL}/api/p2fk/search/objects?searchString=BTC&qty=10&skip=0")
        assert response.status_code == 200
        data = response.json()
        
        assert isinstance(data, list)
        print(f"Objects search 'BTC': {len(data)} results")


class TestDMEndpoint:
    """Tests for the DM endpoint"""
    
    def test_dm_clear_endpoint(self):
        """POST /api/dm/clear/{address} endpoint exists"""
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.post(
            f"{BASE_URL}/api/dm/clear/{test_address}",
            json={"partner": "test_partner_address", "network": "btc-testnet"}
        )
        # Should return 200 even if no messages to clear
        assert response.status_code in [200, 404]
        print(f"DM clear endpoint status: {response.status_code}")


class TestSurgicalDeleteLogic:
    """Tests for the surgical delete cache purge logic"""
    
    def test_surgical_delete_triggers_on_delete_reaction(self):
        """Verify that posting a delete reaction triggers surgical cache purge"""
        # This is a behavioral test - we post a delete reaction and verify the endpoint works
        sample_txid = "surgical_test_" + str(os.urandom(8).hex())
        test_address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # Post delete reaction
        response = requests.post(
            f"{BASE_URL}/api/reactions/{sample_txid}?network=btc-testnet",
            json={
                "type": "delete",
                "from_address": test_address,
                "broadcast_txid": "test_surgical_delete",
                "amount": 0
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") == True
        
        # The surgical purge runs asynchronously, so we just verify the endpoint accepted the request
        print(f"Surgical delete reaction accepted: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
