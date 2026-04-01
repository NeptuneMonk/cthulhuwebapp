"""
Test discover-addresses endpoint fix for p2fk.io Creators dict format.
Bug: p2fk.io returns Creators as dict {address: date} not list [address, ...]
Fix: _creator_addrs helper handles both dict and list formats.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDiscoverAddresses:
    """Test wallet discover-addresses endpoint with dict Creators fix"""
    
    def test_discover_addresses_returns_total_over_70(self):
        """Verify discover-addresses returns >70 addresses for embii4u wallet"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": "btc-testnet"},
            timeout=90
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "total" in data, "Response should contain 'total' field"
        assert "addresses" in data, "Response should contain 'addresses' field"
        assert "object_count" in data, "Response should contain 'object_count' field"
        assert "profile_count" in data, "Response should contain 'profile_count' field"
        assert "collection_count" in data, "Response should contain 'collection_count' field"
        
        # Verify total is >70 (74 objects + 1 profile + 2 collections = 77)
        assert data["total"] > 70, f"Expected total > 70, got {data['total']}"
        assert data["object_count"] >= 70, f"Expected object_count >= 70, got {data['object_count']}"
        assert data["profile_count"] >= 1, f"Expected profile_count >= 1, got {data['profile_count']}"
        
        print(f"PASS: discover-addresses returned {data['total']} addresses")
        print(f"  Objects: {data['object_count']}, Profiles: {data['profile_count']}, Collections: {data['collection_count']}")
    
    def test_discover_addresses_structure(self):
        """Verify each address entry has required fields"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        addresses = data.get("addresses", [])
        assert len(addresses) > 0, "Should have at least one address"
        
        # Check first address has required fields
        first_addr = addresses[0]
        assert "address" in first_addr, "Address entry should have 'address' field"
        assert "type" in first_addr, "Address entry should have 'type' field"
        assert "label" in first_addr, "Address entry should have 'label' field"
        assert first_addr["type"] in ["profile", "object", "collection"], f"Invalid type: {first_addr['type']}"
        
        print(f"PASS: Address structure verified - {len(addresses)} addresses with correct fields")
    
    def test_discover_addresses_profile_type(self):
        """Verify profile address is correctly identified"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        profiles = [a for a in data.get("addresses", []) if a.get("type") == "profile"]
        assert len(profiles) >= 1, "Should have at least one profile address"
        
        # Check profile has embii4u URN
        profile = profiles[0]
        assert profile.get("urn") == "embii4u", f"Expected URN 'embii4u', got {profile.get('urn')}"
        
        print(f"PASS: Profile address verified - URN: {profile.get('urn')}")
    
    def test_discover_addresses_no_error(self):
        """Verify no error field in response (fix for dict Creators crash)"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "error" not in data or data.get("error") is None, f"Unexpected error: {data.get('error')}"
        
        print("PASS: No error in discover-addresses response")


class TestObjectEndpoints:
    """Test object page endpoints for PDF and HTML content"""
    
    def test_stargate_pdf_object(self):
        """Verify STARGATE PDF object loads correctly"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/myn9cdwx4RtKjbh6YqWwUXqt9KqVYV6h8w",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "name" in data, "Object should have 'name' field"
        assert "urn" in data, "Object should have 'urn' field"
        assert ".pdf" in data.get("urn", "").lower(), f"URN should contain .pdf: {data.get('urn')}"
        
        print(f"PASS: STARGATE PDF object loaded - Name: {data.get('name')}")
    
    def test_gen2_robot_image_object(self):
        """Verify GEN2 ROBOT image object (PNG in .html) loads correctly"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/mty8eoLw2ATs94x5GEeBhC7Z1KwZLYV5Nw",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "name" in data, "Object should have 'name' field"
        assert "urn" in data, "Object should have 'urn' field"
        
        print(f"PASS: GEN2 ROBOT image object loaded - Name: {data.get('name')}, URN: {data.get('urn')}")
    
    def test_gen2_robot_html_object(self):
        """Verify GEN2 ROBOT HTML object (actual HTML) loads correctly"""
        response = requests.get(
            f"{BASE_URL}/api/object/addr/mxiw5rjwUxLmXGSqjWZU1mcGX5FihSkiZ6",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "name" in data, "Object should have 'name' field"
        assert "urn" in data, "Object should have 'urn' field"
        
        print(f"PASS: GEN2 ROBOT HTML object loaded - Name: {data.get('name')}, URN: {data.get('urn')}")


class TestStorefrontAndFeed:
    """Test storefront and feed endpoints"""
    
    def test_storefront_loads(self):
        """Verify storefront endpoint returns objects"""
        response = requests.get(
            f"{BASE_URL}/api/storefront",
            params={"network": "btc-testnet", "limit": 10},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "objects" in data or isinstance(data, list), "Storefront should return objects"
        
        objects = data.get("objects", data) if isinstance(data, dict) else data
        print(f"PASS: Storefront loaded - {len(objects)} objects")
    
    def test_feed_loads(self):
        """Verify feed endpoint returns posts"""
        response = requests.get(
            f"{BASE_URL}/api/feed",
            params={"network": "btc-testnet", "limit": 10},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "posts" in data or isinstance(data, list), "Feed should return posts"
        
        posts = data.get("posts", data) if isinstance(data, dict) else data
        print(f"PASS: Feed loaded - {len(posts)} posts")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
