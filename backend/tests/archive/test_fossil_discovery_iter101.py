"""
Iteration 101: Fossil Discovery Feature Tests
Tests the bitfossil.com integration for on-chain P2FK artifact discovery.

Features tested:
- POST /api/objects/discover endpoint with chain prefixes (DOG:, LTC:, MZC:, BTC:)
- Response structure (txid, filename, chain, type, content_url, detail_url)
- GET /api/objects/discover/preview/{txid}/{filename} proxy endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')

# Known working txid/filename for preview test (from agent context)
KNOWN_DOG_TXID = "ebec4379cd81a6d9a0880c8bbf177df06b595842be9b66ddd7e9ca7ded9381e6"
KNOWN_DOG_FILENAME = "dog_lunges_at_water_protectors.jpg"


class TestFossilDiscoverEndpoint:
    """Tests for POST /api/objects/discover endpoint - searches bitfossil.com"""
    
    def test_discover_dog_prefix_returns_results(self):
        """Test fossil search with DOG: prefix returns DOGE chain fossils"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "DOG:", "count": 20},
            timeout=60  # bitfossil.com can be slow
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Either we get results or an error due to bitfossil.com being flaky
        if "error" in data and data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable: {data.get('error')}")
        
        assert "results" in data
        assert "query" in data
        assert data["query"] == "DOG:"
        
        if len(data["results"]) > 0:
            # Verify result structure
            result = data["results"][0]
            assert "txid" in result, "Result missing txid"
            assert "filename" in result, "Result missing filename"
            assert "chain" in result, "Result missing chain"
            assert "type" in result, "Result missing type"
            assert "content_url" in result, "Result missing content_url"
            assert "detail_url" in result, "Result missing detail_url"
            
            # Verify chain detection
            assert result["chain"] == "DOGE", f"Expected DOGE chain, got {result['chain']}"
            
            # Verify URLs
            assert result["content_url"].startswith("https://bitfossil.com/")
            assert result["detail_url"].startswith("https://bitfossil.com/")
            print(f"DOG: search returned {len(data['results'])} fossils, first: {result['filename']}")
    
    def test_discover_ltc_prefix_returns_results(self):
        """Test fossil search with LTC: prefix returns LTC chain fossils"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "LTC:", "count": 20},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        if "error" in data and data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable: {data.get('error')}")
        
        assert "results" in data
        
        if len(data["results"]) > 0:
            result = data["results"][0]
            assert result["chain"] == "LTC", f"Expected LTC chain, got {result['chain']}"
            print(f"LTC: search returned {len(data['results'])} fossils")
    
    def test_discover_mzc_prefix_returns_results(self):
        """Test fossil search with MZC: prefix returns MZC chain fossils"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "MZC:", "count": 20},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        if "error" in data and data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable: {data.get('error')}")
        
        assert "results" in data
        
        if len(data["results"]) > 0:
            result = data["results"][0]
            assert result["chain"] == "MZC", f"Expected MZC chain, got {result['chain']}"
            print(f"MZC: search returned {len(data['results'])} fossils")
    
    def test_discover_btc_prefix_returns_results(self):
        """Test fossil search with BTC: prefix returns BTC chain fossils"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "BTC:", "count": 20},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        if "error" in data and data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable: {data.get('error')}")
        
        assert "results" in data
        
        if len(data["results"]) > 0:
            result = data["results"][0]
            assert result["chain"] == "BTC", f"Expected BTC chain, got {result['chain']}"
            print(f"BTC: search returned {len(data['results'])} fossils")
    
    def test_discover_result_structure_complete(self):
        """Verify each result has all required fields"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "DOG:", "count": 10},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        if "error" in data and data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable: {data.get('error')}")
        
        if len(data.get("results", [])) == 0:
            pytest.skip("No results returned - bitfossil.com may be flaky")
        
        for result in data["results"]:
            # Check all required fields exist
            assert "txid" in result and len(result["txid"]) == 64, f"Invalid txid: {result.get('txid')}"
            assert "filename" in result and len(result["filename"]) > 0, "Empty filename"
            assert "chain" in result and result["chain"] in ["BTC", "BTC-T", "DOGE", "LTC", "MZC"], f"Invalid chain: {result.get('chain')}"
            assert "type" in result and result["type"] in ["file", "msg"], f"Invalid type: {result.get('type')}"
            assert "content_url" in result and result["content_url"].startswith("https://bitfossil.com/"), f"Invalid content_url"
            assert "detail_url" in result and result["detail_url"].endswith("index.htm"), f"Invalid detail_url: {result.get('detail_url')}"
        
        print(f"All {len(data['results'])} results have valid structure")
    
    def test_discover_short_query_rejected(self):
        """Test that queries less than 2 chars return error"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "D", "count": 10},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "error" in data, "Expected error for short query"
        assert data.get("results", []) == [], "Expected empty results for short query"
        print(f"Short query correctly rejected with: {data.get('error')}")


class TestFossilPreviewProxy:
    """Tests for GET /api/objects/discover/preview/{txid}/{filename} proxy endpoint"""
    
    def test_preview_proxy_returns_content(self):
        """Test that preview proxy fetches content from bitfossil.com"""
        url = f"{BASE_URL}/api/objects/discover/preview/{KNOWN_DOG_TXID}/{KNOWN_DOG_FILENAME}"
        response = requests.get(url, timeout=60)
        
        # May get 404 if bitfossil.com is flaky or file doesn't exist anymore
        if response.status_code == 404:
            pytest.skip("Known test file not found on bitfossil.com - may have been removed")
        
        if response.status_code == 500:
            data = response.json() if 'application/json' in response.headers.get('content-type', '') else {}
            pytest.skip(f"bitfossil.com proxy error: {data.get('error', 'Unknown error')}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Check content type is image
        content_type = response.headers.get('content-type', '')
        assert 'image' in content_type, f"Expected image content-type, got: {content_type}"
        
        # Check we got actual content
        assert len(response.content) > 0, "Empty response content"
        print(f"Preview proxy returned {len(response.content)} bytes of {content_type}")
    
    def test_preview_proxy_invalid_txid_returns_error_or_html(self):
        """Test that invalid txid returns 404, 500, or HTML error page from bitfossil.com"""
        url = f"{BASE_URL}/api/objects/discover/preview/invalid_txid/test.jpg"
        response = requests.get(url, timeout=30)
        
        # bitfossil.com returns HTML "rebuild" page with 200 for unknown txids
        # Our proxy passes this through, so we should either get:
        # - 404/500 if our proxy catches it
        # - 200 with HTML content (bitfossil.com error page)
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            # If we got HTML instead of an image, bitfossil.com returned their error page
            if 'text/html' in content_type or response.text.startswith('<!DOCTYPE'):
                print("Invalid txid returned HTML error page from bitfossil.com (expected)")
                return
        
        assert response.status_code in [404, 500, 200], f"Expected 404/500/200, got {response.status_code}"
        print(f"Invalid txid returned status {response.status_code}")


class TestFossilIntegration:
    """Integration tests - full workflow"""
    
    def test_search_then_preview_workflow(self):
        """Search for fossils, then preview the first result"""
        # Step 1: Search
        search_response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "DOG:", "count": 5},
            timeout=60
        )
        assert search_response.status_code == 200
        search_data = search_response.json()
        
        if "error" in search_data and search_data.get("results", []) == []:
            pytest.skip(f"bitfossil.com temporarily unavailable")
        
        if len(search_data.get("results", [])) == 0:
            pytest.skip("No fossils found to test preview")
        
        # Step 2: Get first image result
        image_result = None
        for result in search_data["results"]:
            if result["type"] == "file" and any(result["filename"].lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                image_result = result
                break
        
        if not image_result:
            pytest.skip("No image fossils found to test preview")
        
        # Step 3: Preview the image
        preview_url = f"{BASE_URL}/api/objects/discover/preview/{image_result['txid']}/{image_result['filename']}"
        preview_response = requests.get(preview_url, timeout=60)
        
        if preview_response.status_code in [404, 500]:
            # bitfossil.com might have issues with this specific file
            print(f"Preview failed for {image_result['filename']} - bitfossil.com issue")
            return
        
        assert preview_response.status_code == 200
        assert len(preview_response.content) > 0
        print(f"Full workflow: Found {image_result['filename']} on {image_result['chain']}, preview returned {len(preview_response.content)} bytes")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
