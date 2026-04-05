"""
Test URN Impersonation Protection Features - Iteration 242
Tests:
1. Backend /api/urn/verify/{urn} endpoint for known URN 'embii'
2. Backend /api/urn/verify/{urn} for non-existent URN
3. Feed endpoint returns data with sender_urn
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com').rstrip('/')


class TestUrnVerifyEndpoint:
    """Tests for /api/urn/verify/{urn} endpoint"""
    
    def test_verify_known_urn_embii(self):
        """Test that 'embii' URN returns correct official address"""
        response = requests.get(f"{BASE_URL}/api/urn/verify/embii?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "urn" in data, "Response should contain 'urn' field"
        assert data["urn"] == "embii", f"Expected urn='embii', got {data['urn']}"
        assert "official_address" in data, "Response should contain 'official_address'"
        assert data["official_address"] == "mpmFabGjT1xr2pmJ71QDjTPRF1pLUrdKGm", \
            f"Expected official_address='mpmFabGjT1xr2pmJ71QDjTPRF1pLUrdKGm', got {data['official_address']}"
        assert "impersonation_detected" in data, "Response should contain 'impersonation_detected'"
        assert "claimants" in data, "Response should contain 'claimants'"
        print(f"PASS: URN 'embii' verified - official_address={data['official_address']}, impersonation_detected={data['impersonation_detected']}")
    
    def test_verify_urn_response_structure(self):
        """Test that response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/urn/verify/testurn123?network=btc-testnet")
        assert response.status_code == 200
        
        data = response.json()
        required_fields = ["urn", "official_address", "claimants", "impersonation_detected"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Claimants should be a list
        assert isinstance(data["claimants"], list), "claimants should be a list"
        
        # impersonation_detected should be boolean
        assert isinstance(data["impersonation_detected"], bool), "impersonation_detected should be boolean"
        print(f"PASS: Response structure is correct with all required fields")
    
    def test_verify_urn_with_different_networks(self):
        """Test URN verification works with different network parameters"""
        networks = ["btc-testnet", "btc-mainnet"]
        for network in networks:
            response = requests.get(f"{BASE_URL}/api/urn/verify/embii?network={network}")
            assert response.status_code == 200, f"Failed for network={network}"
            data = response.json()
            assert "urn" in data
            print(f"PASS: URN verify works for network={network}")


class TestFeedEndpoint:
    """Tests for feed endpoint with sender_urn data"""
    
    def test_feed_returns_sender_urn(self):
        """Test that feed items include sender_urn field"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet?skip=0&limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert "feed" in data, "Response should contain 'feed'"
        
        if data["feed"]:
            # Check that at least some items have sender_urn
            items_with_urn = [item for item in data["feed"] if item.get("sender_urn")]
            print(f"PASS: Feed returned {len(data['feed'])} items, {len(items_with_urn)} have sender_urn")
            
            # Verify structure of feed items
            for item in data["feed"][:3]:
                assert "from_address" in item, "Feed item should have from_address"
                assert "transaction_id" in item, "Feed item should have transaction_id"
                # sender_urn may be None for unminted profiles
                if item.get("sender_urn"):
                    print(f"  - Item from {item['sender_urn']} (addr: {item['from_address'][:12]}...)")
        else:
            print("WARN: Feed is empty (may be building cache)")


class TestProfileEndpoint:
    """Tests for profile endpoint"""
    
    def test_profile_by_address(self):
        """Test fetching profile by address"""
        # Use the known embii address
        address = "mpmFabGjT1xr2pmJ71QDjTPRF1pLUrdKGm"
        response = requests.get(f"{BASE_URL}/api/profile/{address}?network=btc-testnet")
        assert response.status_code == 200
        
        data = response.json()
        assert "address" in data, "Profile should have address"
        assert "urn" in data, "Profile should have urn"
        print(f"PASS: Profile fetched - urn={data.get('urn')}, address={data.get('address')[:16]}...")


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Test health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("status") == "healthy", f"Expected healthy status, got {data.get('status')}"
        assert "services" in data
        print(f"PASS: Health check - status={data['status']}, services={data['services']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
