"""
Iteration 30 - Collection Tab and Collection Detail Page Tests
Tests:
1. GET /api/collections/by-creator/{address} - Returns collections for a creator (position-based detection)
2. GET /api/collection/{urn} - Returns collection metadata, creator, and objects
3. Collection tab should show collection CARDS not individual objects
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


class TestCollectionsByCreator:
    """Test collections-by-creator endpoint for position-based collection detection"""
    
    def test_collections_by_creator_returns_two_collections(self):
        """kattacomi's profile should show 2 collections: shitcoins, CLOUDCITY4U"""
        response = requests.get(
            f"{BASE_URL}/api/collections/by-creator/mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return exactly 2 collections
        assert "collections" in data
        assert data["total"] == 2, f"Expected 2 collections, got {data['total']}"
        
        collection_urns = [c["urn"] for c in data["collections"]]
        assert "shitcoins" in collection_urns, "shitcoins collection missing"
        assert "CLOUDCITY4U" in collection_urns, "CLOUDCITY4U collection missing"
    
    def test_collections_by_creator_excludes_embii4u(self):
        """embii4u should NOT be in collections (it's a co-creator user, not a collection)"""
        response = requests.get(
            f"{BASE_URL}/api/collections/by-creator/mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        collection_urns = [c["urn"] for c in data["collections"]]
        assert "embii4u" not in collection_urns, "embii4u should NOT be in collections - it's a user, not a collection"
    
    def test_shitcoins_collection_has_8_objects(self):
        """shitcoins collection should have 8 objects"""
        response = requests.get(
            f"{BASE_URL}/api/collections/by-creator/mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        shitcoins = next((c for c in data["collections"] if c["urn"] == "shitcoins"), None)
        assert shitcoins is not None
        assert shitcoins["object_count"] == 8, f"Expected 8 objects, got {shitcoins['object_count']}"
    
    def test_cloudcity4u_collection_has_2_objects(self):
        """CLOUDCITY4U collection should have 2 objects"""
        response = requests.get(
            f"{BASE_URL}/api/collections/by-creator/mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        cloudcity = next((c for c in data["collections"] if c["urn"] == "CLOUDCITY4U"), None)
        assert cloudcity is not None
        assert cloudcity["object_count"] == 2, f"Expected 2 objects, got {cloudcity['object_count']}"


class TestCollectionDetail:
    """Test collection detail endpoint"""
    
    def test_shitcoins_collection_metadata(self):
        """GET /api/collection/shitcoins should return metadata with creator kattacomi"""
        response = requests.get(
            f"{BASE_URL}/api/collection/shitcoins",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check collection metadata
        assert "collection" in data
        assert data["collection"]["urn"] == "shitcoins"
        assert "bio" in data["collection"]
        
        # Check creator is kattacomi
        assert "creator" in data
        assert data["creator"]["urn"] == "kattacomi"
        assert data["creator"]["address"] == "mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM"
        
        # Check 8 objects
        assert data["total"] == 8
        assert len(data["objects"]) == 8
    
    def test_meditation_collection_metadata(self):
        """GET /api/collection/Meditation should return metadata with creator NeptuneMonk"""
        response = requests.get(
            f"{BASE_URL}/api/collection/Meditation",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check collection metadata
        assert "collection" in data
        assert data["collection"]["urn"] == "Meditation"
        
        # Check creator is NeptuneMonk
        assert "creator" in data
        assert data["creator"]["urn"] == "NeptuneMonk"
        
        # Check 8 objects
        assert data["total"] == 8
        assert len(data["objects"]) == 8
    
    def test_collection_has_creator_image(self):
        """Collection detail should include creator's profile image for link display"""
        response = requests.get(
            f"{BASE_URL}/api/collection/shitcoins",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Creator should have image field
        assert "creator" in data
        assert "image" in data["creator"], "Creator should have image field for profile link display"
        assert data["creator"]["image"] is not None, "Creator image should not be None"


class TestAPIHealth:
    """Basic health check"""
    
    def test_api_health(self):
        """API health check"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
