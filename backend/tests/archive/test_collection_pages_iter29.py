"""
Test Collection Pages Feature - Iteration 29

Tests the new collection page endpoints and object creator resolution.
Collections are profile-like entities in P2FK protocol fetched via GetProfileByURN.
Objects belong to a collection when the collection's derived address appears as a co-creator.
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestCollectionEndpoints:
    """Test GET /api/collection/{urn} endpoint for collection metadata and objects"""

    def test_health_check(self):
        """Verify backend is running"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        assert response.json().get("status") == "healthy"
        print("✓ Health check passed")

    def test_shitcoins_collection_metadata(self):
        """Test shitcoins collection returns correct metadata"""
        response = requests.get(f"{BASE_URL}/api/collection/shitcoins", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Verify collection structure exists
        assert "collection" in data, "Response should have 'collection' key"
        assert "creator" in data, "Response should have 'creator' key"
        assert "objects" in data, "Response should have 'objects' key"
        assert "total" in data, "Response should have 'total' key"
        
        # Verify collection metadata
        collection = data["collection"]
        assert collection["urn"] == "shitcoins", f"Collection URN should be 'shitcoins', got {collection['urn']}"
        assert "bio" in collection and collection["bio"], "Collection should have a bio"
        assert "image" in collection and collection["image"], "Collection should have an image"
        
        # Verify image is on-chain BTC (64-char hex txid)
        assert len(collection["image"].split("/")[0]) == 64, "Image should be on-chain BTC format"
        
        print(f"✓ shitcoins collection metadata correct: URN={collection['urn']}, has bio and image")

    def test_shitcoins_collection_creator(self):
        """Test shitcoins collection has kattacomi as creator"""
        response = requests.get(f"{BASE_URL}/api/collection/shitcoins", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        creator = data.get("creator")
        assert creator is not None, "Creator should be resolved"
        assert creator["urn"] == "kattacomi", f"Creator URN should be 'kattacomi', got {creator.get('urn')}"
        assert "address" in creator, "Creator should have an address"
        
        print(f"✓ shitcoins creator is @{creator['urn']}")

    def test_shitcoins_collection_objects_count(self):
        """Test shitcoins collection has 8 objects"""
        response = requests.get(f"{BASE_URL}/api/collection/shitcoins", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data["total"] == 8, f"Expected 8 objects, got {data['total']}"
        assert len(data["objects"]) == 8, f"Expected 8 objects in array, got {len(data['objects'])}"
        
        # Verify expected shitcoin names
        object_names = [obj["name"] for obj in data["objects"]]
        expected_names = ['dogecoin', 'pudgypenguinscoin', 'flokicoin', 'fartcoin', 'bonkcoin', 'brettcoin', 'dogwifhatcoin', 'shitcoin']
        for name in expected_names:
            assert name in object_names, f"Object '{name}' should be in collection"
        
        print(f"✓ shitcoins collection has 8 objects: {object_names}")

    def test_meditation_collection_metadata(self):
        """Test Meditation collection returns correct metadata with IPFS image"""
        response = requests.get(f"{BASE_URL}/api/collection/Meditation", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        collection = data["collection"]
        assert collection["urn"] == "Meditation", f"Collection URN should be 'Meditation', got {collection['urn']}"
        assert "bio" in collection and collection["bio"], "Collection should have a bio"
        
        # Verify image is IPFS format
        assert collection["image"].startswith("IPFS:"), f"Image should be IPFS format, got {collection['image']}"
        
        print(f"✓ Meditation collection metadata correct: URN={collection['urn']}, IPFS image")

    def test_meditation_collection_creator(self):
        """Test Meditation collection has NeptuneMonk as creator"""
        response = requests.get(f"{BASE_URL}/api/collection/Meditation", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        creator = data.get("creator")
        assert creator is not None, "Creator should be resolved"
        assert creator["urn"] == "NeptuneMonk", f"Creator URN should be 'NeptuneMonk', got {creator.get('urn')}"
        
        print(f"✓ Meditation creator is @{creator['urn']}")

    def test_meditation_collection_objects_count(self):
        """Test Meditation collection has 8 objects"""
        response = requests.get(f"{BASE_URL}/api/collection/Meditation", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data["total"] == 8, f"Expected 8 objects, got {data['total']}"
        assert len(data["objects"]) == 8, f"Expected 8 objects in array, got {len(data['objects'])}"
        
        print(f"✓ Meditation collection has 8 objects")

    def test_nonexistent_collection(self):
        """Test that nonexistent collection returns error"""
        response = requests.get(f"{BASE_URL}/api/collection/nonexistent_collection_xyz", params={"network": "btc-testnet"})
        assert response.status_code == 200  # API returns 200 with error field
        data = response.json()
        assert "error" in data, "Response should have error for nonexistent collection"
        
        print("✓ Nonexistent collection returns error correctly")


class TestObjectCreatorResolution:
    """Test object detail page resolves creator profiles for clickable names"""

    def test_object_resolves_collection_and_creator(self):
        """Test dogecoin object resolves both 'shitcoins' collection and 'kattacomi' creator"""
        # dogecoin object from shitcoins collection
        txid = "f6681cb29f4148edbe784dfb1f74356934954deec1f39b4c1054cd3e0b07f366"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "creators" in data, "Object should have creators"
        assert "resolved_profiles" in data, "Object should have resolved_profiles"
        
        resolved = data["resolved_profiles"]
        creator_urns = [resolved.get(c["address"], {}).get("urn") for c in data["creators"]]
        
        # Should have 'shitcoins' (collection) and 'kattacomi' (human creator)
        assert "shitcoins" in creator_urns, f"shitcoins collection should be in creators, got {creator_urns}"
        assert "kattacomi" in creator_urns, f"kattacomi should be in creators, got {creator_urns}"
        
        print(f"✓ dogecoin object resolves creators: {creator_urns}")

    def test_object_profile_type_detection(self):
        """Test resolved profiles include is_object flag for self-reference"""
        txid = "f6681cb29f4148edbe784dfb1f74356934954deec1f39b4c1054cd3e0b07f366"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        resolved = data["resolved_profiles"]
        
        # The object itself (dogecoin) should have is_object=True
        dogecoin_resolved = None
        for addr, profile in resolved.items():
            if profile.get("urn") == "dogecoin":
                dogecoin_resolved = profile
                break
        
        assert dogecoin_resolved is not None, "dogecoin should be in resolved profiles"
        assert dogecoin_resolved.get("is_object") == True, "dogecoin should be marked as is_object=True"
        
        # shitcoins (collection) and kattacomi (user) should NOT have is_object=True
        for addr, profile in resolved.items():
            urn = profile.get("urn")
            if urn in ["shitcoins", "kattacomi"]:
                assert not profile.get("is_object"), f"{urn} should not have is_object=True"
        
        print("✓ Object profile type detection correct (is_object flag)")


class TestStorefrontFilters:
    """Test storefront BTC filter still works (regression test from iter28)"""

    def test_btc_filter_returns_objects(self):
        """Test BTC filter on testnet returns objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "BTC"})
        assert response.status_code == 200
        data = response.json()
        
        # Should have some BTC objects (was 7 in iter28)
        assert data["total"] >= 5, f"Expected at least 5 BTC objects, got {data['total']}"
        
        print(f"✓ BTC filter returns {data['total']} objects")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
