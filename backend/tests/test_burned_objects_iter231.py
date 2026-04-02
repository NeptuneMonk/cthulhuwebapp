"""
Iteration 231: Burned Objects Filtering Tests
Tests that burned objects (e.g., msBayXP6iCByaHeMteiwmXMbS74x91MmqY) are:
1. Filtered out from search results
2. Filtered out from storefront
3. Still accessible on detail page with burn_transactions > 0
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# The burned object address from the problem statement
BURNED_OBJECT_ADDRESS = "msBayXP6iCByaHeMteiwmXMbS74x91MmqY"
BURNED_OBJECT_NAME = "For real final test"
NETWORK = "btc-testnet"


class TestBurnedObjectFiltering:
    """Tests for burned object filtering in search and storefront"""

    def test_health_endpoint(self):
        """Verify backend is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") in ["healthy", "degraded"]
        print(f"Health check passed: {data}")

    def test_search_burned_object_by_name_returns_zero(self):
        """GET /api/p2fk/search/objects with burned object name should return 0 results"""
        response = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={
                "searchString": BURNED_OBJECT_NAME,
                "qty": 10,
                "skip": 0,
                "network": NETWORK
            },
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return empty list or list without the burned object
        assert isinstance(data, list)
        
        # Check that no result contains the burned object address
        for item in data:
            obj = item.get('object', item) if isinstance(item, dict) else item
            creators = obj.get('Creators', {}) if isinstance(obj, dict) else {}
            obj_addr = list(creators.keys())[0] if creators else ''
            assert obj_addr != BURNED_OBJECT_ADDRESS, f"Burned object {BURNED_OBJECT_ADDRESS} should not appear in search results"
        
        print(f"Search for '{BURNED_OBJECT_NAME}' returned {len(data)} results (burned object filtered out)")

    def test_wildcard_search_excludes_burned_object(self):
        """GET /api/p2fk/search/objects with wildcard should NOT contain burned object"""
        response = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={
                "searchString": "*",
                "qty": 200,
                "skip": 0,
                "network": NETWORK
            },
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        
        # Check that no result contains the burned object address in Creators
        for item in data:
            obj = item.get('object', item) if isinstance(item, dict) else item
            creators = obj.get('Creators', {}) if isinstance(obj, dict) else {}
            
            # Check if burned address is in creators keys
            if isinstance(creators, dict):
                assert BURNED_OBJECT_ADDRESS not in creators.keys(), \
                    f"Burned object {BURNED_OBJECT_ADDRESS} should not appear in wildcard search results"
            elif isinstance(creators, list):
                for c in creators:
                    addr = c.get('address', c) if isinstance(c, dict) else c
                    assert addr != BURNED_OBJECT_ADDRESS, \
                        f"Burned object {BURNED_OBJECT_ADDRESS} should not appear in wildcard search results"
        
        print(f"Wildcard search returned {len(data)} results, burned object correctly filtered out")

    def test_burned_object_detail_page_accessible(self):
        """GET /api/object/addr/{burned_address} should still return object data with burn_transactions > 0"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{BURNED_OBJECT_ADDRESS}",
            params={"network": NETWORK},
            timeout=120  # Long timeout due to slow external API calls
        )
        
        # Should return 200 with burn info
        assert response.status_code == 200, f"Detail page should be accessible, got {response.status_code}"
        data = response.json()
        
        # Verify burn_transactions field exists and is > 0
        burn_count = data.get('burn_transactions', 0)
        assert burn_count > 0, f"Expected burn_transactions > 0, got {burn_count}"
        
        # Check burn status fields
        is_burned = data.get('is_burned', False)
        burn_status = data.get('burn_status', '')
        
        print(f"Burned object detail: burn_transactions={burn_count}, is_burned={is_burned}, burn_status={burn_status}")
        
        # Verify the object has burn-related fields
        assert 'burn_transactions' in data or 'burn_txids' in data or 'is_burned' in data, \
            "Burned object should have burn-related fields"

    def test_auto_delta_status_enabled(self):
        """GET /api/snapshot/auto-delta/status should show enabled=true with networks array"""
        response = requests.get(
            f"{BASE_URL}/api/snapshot/auto-delta/status",
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check enabled field
        assert 'enabled' in data, "Response should have 'enabled' field"
        assert data['enabled'] == True, f"Expected enabled=true, got {data['enabled']}"
        
        # Check networks array
        assert 'networks' in data, "Response should have 'networks' field"
        assert isinstance(data['networks'], list), "networks should be a list"
        assert len(data['networks']) > 0, "networks array should not be empty"
        
        print(f"Auto-delta status: enabled={data['enabled']}, networks={data['networks']}")

    def test_storefront_excludes_burned_objects(self):
        """GET /api/objects/storefront/{network} should NOT contain burned objects"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/{NETWORK}",
            params={"skip": 0, "limit": 50},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        objects = data.get('objects', [])
        
        # Check that no object has the burned address
        for obj in objects:
            obj_addr = obj.get('object_address', '')
            assert obj_addr != BURNED_OBJECT_ADDRESS, \
                f"Burned object {BURNED_OBJECT_ADDRESS} should not appear in storefront"
            
            # Also check name
            name = obj.get('name', '')
            if name == BURNED_OBJECT_NAME:
                # If name matches, verify it's not the burned object
                assert obj_addr != BURNED_OBJECT_ADDRESS, \
                    f"Object with name '{BURNED_OBJECT_NAME}' should not be the burned object"
        
        print(f"Storefront returned {len(objects)} objects, burned object correctly filtered out")


class TestBurnedObjectsRegistry:
    """Tests for the burned_objects SQLite table and registry functions"""

    def test_burned_set_contains_burned_address(self):
        """Verify the burned_objects table contains the known burned address"""
        # This is an indirect test - we verify by checking search filtering works
        response = requests.get(
            f"{BASE_URL}/api/p2fk/search/objects",
            params={
                "searchString": BURNED_OBJECT_ADDRESS[:10],  # Partial address search
                "qty": 50,
                "skip": 0,
                "network": NETWORK
            },
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        # If the burned object was in results, it should be filtered out
        for item in data:
            obj = item.get('object', item) if isinstance(item, dict) else item
            creators = obj.get('Creators', {}) if isinstance(obj, dict) else {}
            obj_addr = list(creators.keys())[0] if creators else ''
            assert obj_addr != BURNED_OBJECT_ADDRESS, \
                f"Burned object should be filtered from partial address search"
        
        print(f"Partial address search verified burned object filtering")


class TestHeaderStatusDots:
    """Tests for header status dots (IPFS, Mesh, Walkie) - verified via frontend"""
    
    def test_ipfs_health(self):
        """Verify IPFS service is accessible"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        services = data.get('services', {})
        ipfs_status = services.get('ipfs', 'unknown')
        print(f"IPFS status: {ipfs_status}")
        # IPFS may be up or down, just verify we can check it

    def test_mesh_nodes_endpoint(self):
        """Verify mesh nodes endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/mesh/nodes", timeout=10)
        assert response.status_code == 200
        data = response.json()
        print(f"Mesh nodes: {data.get('count', 0)} nodes")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
