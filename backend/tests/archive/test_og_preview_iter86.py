"""
Test OG Preview endpoint - Iteration 86
Tests the OpenGraph URL preview endpoint for P2 feature.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestOGPreview:
    """OpenGraph URL preview endpoint tests"""

    def test_og_preview_wikipedia_bitcoin(self):
        """Test OG preview for Wikipedia Bitcoin page - should return title containing 'Bitcoin'"""
        response = requests.get(
            f"{BASE_URL}/api/og-preview",
            params={"url": "https://en.wikipedia.org/wiki/Bitcoin"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "title" in data, "Response should contain 'title' field"
        assert "description" in data, "Response should contain 'description' field"
        assert "image" in data, "Response should contain 'image' field"
        assert "site_name" in data, "Response should contain 'site_name' field"
        assert "url" in data, "Response should contain 'url' field"
        
        # Title should contain 'Bitcoin'
        assert "Bitcoin" in data["title"], f"Title should contain 'Bitcoin', got: {data['title']}"
        print(f"✓ Wikipedia Bitcoin page: title='{data['title']}'")

    def test_og_preview_github(self):
        """Test OG preview for GitHub homepage - should return title containing 'GitHub'"""
        response = requests.get(
            f"{BASE_URL}/api/og-preview",
            params={"url": "https://github.com"},
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "title" in data, "Response should contain 'title' field"
        
        # Title should contain 'GitHub'
        assert "GitHub" in data["title"], f"Title should contain 'GitHub', got: {data['title']}"
        print(f"✓ GitHub page: title='{data['title']}'")

    def test_og_preview_invalid_url(self):
        """Test OG preview with invalid URL - should return error"""
        response = requests.get(
            f"{BASE_URL}/api/og-preview",
            params={"url": "invalid"},
            timeout=10
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "error" in data, "Response should contain 'error' field for invalid URL"
        assert data["error"] == "Invalid URL", f"Expected 'Invalid URL' error, got: {data.get('error')}"
        print(f"✓ Invalid URL properly rejected with error: {data['error']}")

    def test_og_preview_missing_url_param(self):
        """Test OG preview without URL parameter - should return error"""
        response = requests.get(
            f"{BASE_URL}/api/og-preview",
            timeout=10
        )
        # FastAPI should return 422 for missing required query param
        assert response.status_code == 422, f"Expected 422 for missing param, got {response.status_code}"
        print("✓ Missing URL parameter properly rejected with 422")

    def test_og_preview_caching_headers(self):
        """Test that responses have proper structure for caching"""
        response = requests.get(
            f"{BASE_URL}/api/og-preview",
            params={"url": "https://en.wikipedia.org/wiki/Bitcoin"},
            timeout=30
        )
        assert response.status_code == 200
        
        data = response.json()
        # Check all expected fields are present
        expected_fields = ['url', 'title', 'description', 'image', 'site_name']
        for field in expected_fields:
            assert field in data, f"Response should contain '{field}' field"
        print("✓ Response has all expected fields for caching")
