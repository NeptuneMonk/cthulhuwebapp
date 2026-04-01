"""GIF API endpoint tests for iteration 59.
Tests the GIF search feature using P2FK protocol integration.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestGifSearchAPI:
    """Tests for GET /api/gifs/search/{keyword} endpoint"""

    def test_gif_search_returns_200(self):
        """Basic health check - endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✓ GIF search endpoint returns 200")

    def test_gif_search_response_structure(self):
        """Verify response has correct JSON structure"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "gifs" in data, "Response missing 'gifs' field"
        assert "keyword" in data, "Response missing 'keyword' field"
        assert "count" in data, "Response missing 'count' field"
        assert isinstance(data["gifs"], list), "'gifs' should be a list"
        assert isinstance(data["count"], int), "'count' should be an integer"
        print(f"✓ Response structure is correct: gifs={len(data['gifs'])}, count={data['count']}")

    def test_gif_keyword_returns_at_least_one_result(self):
        """Keyword 'GIF' should return at least 1 result"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        assert data["count"] >= 1, f"Expected at least 1 GIF for keyword 'GIF', got {data['count']}"
        assert len(data["gifs"]) >= 1, f"Expected at least 1 item in gifs array"
        print(f"✓ Keyword 'GIF' returned {data['count']} result(s)")

    def test_feg_keyword_returns_multiple_results(self):
        """Keyword 'FEG' should return 3 GIFs"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/FEG?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        assert data["count"] == 3, f"Expected 3 GIFs for keyword 'FEG', got {data['count']}"
        assert len(data["gifs"]) == 3, f"Expected 3 items in gifs array"
        print(f"✓ Keyword 'FEG' returned {data['count']} results as expected")

    def test_gif_entry_structure(self):
        """Verify each GIF entry has required fields"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        if data["gifs"]:
            gif = data["gifs"][0]
            assert "ref" in gif, "GIF entry missing 'ref' field"
            assert "url" in gif, "GIF entry missing 'url' field"
            assert "source" in gif, "GIF entry missing 'source' field"
            print(f"✓ GIF entry structure is valid: ref={gif['ref'][:50]}...")
        else:
            pytest.skip("No GIFs returned to verify structure")

    def test_nonexistent_keyword_returns_empty_list(self):
        """Non-existent keyword should return empty list gracefully"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/nonexistentkeyword123xyz?network=btc-testnet", timeout=30)
        assert response.status_code == 200, f"Expected 200 even for empty results, got {response.status_code}"
        data = response.json()
        
        assert "gifs" in data, "Response missing 'gifs' field"
        assert isinstance(data["gifs"], list), "'gifs' should be a list"
        assert len(data["gifs"]) == 0, f"Expected empty list for non-existent keyword, got {len(data['gifs'])} items"
        assert data["count"] == 0, f"Expected count=0 for non-existent keyword, got {data['count']}"
        print(f"✓ Non-existent keyword returns empty list gracefully")

    def test_response_includes_address(self):
        """Successful search should include resolved address"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        if data["count"] > 0:
            assert "address" in data, "Response with results should include 'address' field"
            assert data["address"], "Address should not be empty when results are found"
            print(f"✓ Address resolved: {data['address']}")
        else:
            pytest.skip("No results to verify address")

    def test_ipfs_gif_url_format(self):
        """IPFS-sourced GIFs should have proper URL format"""
        response = requests.get(f"{BASE_URL}/api/gifs/search/GIF?network=btc-testnet", timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        ipfs_gifs = [g for g in data["gifs"] if g.get("source") == "ipfs"]
        if ipfs_gifs:
            gif = ipfs_gifs[0]
            assert gif["url"].startswith("https://ipfs.io/ipfs/"), f"IPFS URL should start with 'https://ipfs.io/ipfs/', got {gif['url']}"
            assert "cid" in gif, "IPFS GIF should have 'cid' field"
            print(f"✓ IPFS GIF URL format is correct: {gif['url'][:60]}...")
        else:
            pytest.skip("No IPFS GIFs in response to verify URL format")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
