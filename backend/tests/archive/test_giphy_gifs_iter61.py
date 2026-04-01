"""
Iteration 61: Giphy GIF API Integration Tests
Tests the new Giphy GIF endpoints:
- GET /api/gifs/giphy/{keyword} - Search Giphy for GIFs
- GET /api/gifs/giphy/trending - Get trending GIFs
- POST /api/gifs/giphy/pin - Download GIF and pin to IPFS
- GET /api/gifs/search/{keyword} - On-chain P2FK GIF search
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestGiphySearch:
    """Giphy search endpoint tests"""
    
    def test_giphy_search_funny(self):
        """Search Giphy with keyword 'funny' should return GIFs"""
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/funny")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "gifs" in data, "Response should contain 'gifs' key"
        assert "count" in data, "Response should contain 'count' key"
        assert "keyword" in data, "Response should contain 'keyword' key"
        assert data["keyword"] == "funny", "Keyword should be 'funny'"
        
        # Should have results
        assert data["count"] > 0, "Should return at least one GIF"
        assert len(data["gifs"]) > 0, "GIFs array should not be empty"
        
        # Validate GIF structure
        gif = data["gifs"][0]
        assert "ref" in gif, "GIF should have 'ref' field"
        assert "url" in gif, "GIF should have 'url' field"
        assert "source" in gif, "GIF should have 'source' field"
        assert gif["source"] == "giphy", "Source should be 'giphy'"
        assert "giphy_id" in gif, "GIF should have 'giphy_id' field"
        assert "full_url" in gif, "GIF should have 'full_url' for pinning"
        
    def test_giphy_search_reaction(self):
        """Search Giphy with keyword 'reaction' should return GIFs"""
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/reaction")
        assert response.status_code == 200
        
        data = response.json()
        assert data["count"] > 0, "Reaction search should return GIFs"
        assert data["keyword"] == "reaction"
        
    def test_giphy_search_limit_param(self):
        """Giphy search should respect limit parameter"""
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/cat?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert data["count"] <= 5, "Should respect limit parameter"


class TestGiphyTrending:
    """Giphy trending endpoint tests"""
    
    def test_giphy_trending(self):
        """GET /api/gifs/giphy/trending should return trending GIFs"""
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/trending")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "gifs" in data, "Response should contain 'gifs' key"
        assert "count" in data, "Response should contain 'count' key"
        
        # Should have results
        assert data["count"] > 0, "Should return trending GIFs"
        assert len(data["gifs"]) > 0, "GIFs array should not be empty"
        
        # Validate GIF structure
        gif = data["gifs"][0]
        assert gif["source"] == "giphy", "Source should be 'giphy'"
        assert "url" in gif, "GIF should have preview URL"
        assert "full_url" in gif, "GIF should have full URL"
        
    def test_giphy_trending_limit(self):
        """Trending endpoint should respect limit parameter"""
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/trending?limit=3")
        assert response.status_code == 200
        
        data = response.json()
        assert data["count"] <= 3, "Should respect limit parameter"


class TestGiphyPin:
    """Giphy pin to IPFS endpoint tests"""
    
    def test_giphy_pin_success(self):
        """POST /api/gifs/giphy/pin should download and pin GIF to IPFS"""
        # First get a GIF URL from search
        search_resp = requests.get(f"{BASE_URL}/api/gifs/giphy/test")
        assert search_resp.status_code == 200
        
        search_data = search_resp.json()
        if search_data["count"] == 0:
            pytest.skip("No GIFs returned from search")
            
        gif = search_data["gifs"][0]
        gif_url = gif.get("full_url") or gif.get("url")
        giphy_id = gif.get("giphy_id", "test")
        
        # Pin the GIF
        pin_response = requests.post(
            f"{BASE_URL}/api/gifs/giphy/pin",
            json={
                "url": gif_url,
                "filename": f"{giphy_id}.gif"
            }
        )
        assert pin_response.status_code == 200, f"Expected 200, got {pin_response.status_code}"
        
        data = pin_response.json()
        assert "cid" in data, "Response should contain IPFS CID"
        assert "filename" in data, "Response should contain filename"
        assert "ref" in data, "Response should contain IPFS ref"
        
        # Validate IPFS ref format
        assert data["ref"].startswith("IPFS:"), f"Ref should start with 'IPFS:', got {data['ref']}"
        assert len(data["cid"]) > 0, "CID should not be empty"
        
    def test_giphy_pin_no_url(self):
        """POST /api/gifs/giphy/pin with no URL should return error"""
        response = requests.post(
            f"{BASE_URL}/api/gifs/giphy/pin",
            json={}
        )
        assert response.status_code == 200  # Endpoint returns 200 with error in body
        
        data = response.json()
        assert "error" in data, "Should return error when no URL provided"


class TestOnChainGifSearch:
    """On-chain P2FK GIF search tests"""
    
    def test_onchain_gif_search(self):
        """GET /api/gifs/search/{keyword} should search on-chain GIFs"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/gif")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "gifs" in data, "Response should contain 'gifs' key"
        assert "keyword" in data, "Response should contain 'keyword' key"
        assert "count" in data, "Response should contain 'count' key"
        assert data["keyword"] == "gif", "Keyword should be 'gif'"
        
    def test_onchain_gif_search_network_param(self):
        """On-chain search should accept network parameter"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/gif?network=btc-testnet")
        assert response.status_code == 200
        
        data = response.json()
        assert "gifs" in data
        assert "keyword" in data
        
    def test_onchain_gif_search_mainnet(self):
        """On-chain search should work with mainnet network"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/gif?network=btc-mainnet")
        assert response.status_code == 200
        
        data = response.json()
        assert "gifs" in data


class TestGiphyApiKeyPresent:
    """Verify Giphy API is configured correctly"""
    
    def test_api_key_configured(self):
        """Verify that GIPHY_API_KEY is set and working"""
        # If API key is not set, search returns error
        response = requests.get(f"{BASE_URL}/api/gifs/giphy/test")
        assert response.status_code == 200
        
        data = response.json()
        # If error key exists and mentions API key, the key is not configured
        if "error" in data and "API key" in data.get("error", ""):
            pytest.fail("GIPHY_API_KEY is not configured in backend")
        
        # Should return GIFs if API key is working
        assert data["count"] >= 0, "API should return count"
