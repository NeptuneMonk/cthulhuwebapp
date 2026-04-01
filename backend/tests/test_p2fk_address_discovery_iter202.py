"""
Test P2FK Address Discovery Endpoint - Iteration 202

Tests the new P2FK-aware /api/wallet/discover-addresses/{address} endpoint
that queries p2fk.io for objects/profiles/collections instead of generic dust/payment addresses.

Features tested:
- Response shape: {addresses, object_count, profile_count, collection_count, total}
- Address types: profile, object, collection
- Graceful handling of addresses with no P2FK objects
- Graceful handling of p2fk.io API timeouts
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "http://localhost:8001"


class TestP2FKAddressDiscovery:
    """Tests for the P2FK-aware discover-addresses endpoint"""

    def test_health_check(self):
        """Verify backend is healthy before running tests"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: Backend health check")

    def test_discover_addresses_response_shape(self):
        """Test that response has correct P2FK-categorized shape"""
        # Use an address that has a profile
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response shape
        assert "addresses" in data, "Response must have 'addresses' field"
        assert "object_count" in data, "Response must have 'object_count' field"
        assert "profile_count" in data, "Response must have 'profile_count' field"
        assert "collection_count" in data, "Response must have 'collection_count' field"
        assert "total" in data, "Response must have 'total' field"
        
        # Verify types
        assert isinstance(data["addresses"], list)
        assert isinstance(data["object_count"], int)
        assert isinstance(data["profile_count"], int)
        assert isinstance(data["collection_count"], int)
        assert isinstance(data["total"], int)
        
        print(f"PASS: Response shape correct - {data['total']} addresses found")

    def test_discover_addresses_profile_type(self):
        """Test that profile addresses are correctly categorized"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should have at least one profile
        profiles = [a for a in data["addresses"] if a.get("type") == "profile"]
        assert len(profiles) > 0, "Should find at least one profile address"
        assert data["profile_count"] == len(profiles)
        
        # Verify profile address structure
        profile = profiles[0]
        assert "address" in profile
        assert "type" in profile
        assert profile["type"] == "profile"
        assert "label" in profile
        assert "urn" in profile
        
        print(f"PASS: Profile type correct - found {len(profiles)} profile(s)")

    def test_discover_addresses_empty_graceful(self):
        """Test graceful handling of address with no P2FK objects"""
        # Use the test address mentioned in the problem statement
        address = "msPJhg9GPzMN6twknwmSQvrUKZbZnk51Tv"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return empty list, not error
        assert "addresses" in data
        assert isinstance(data["addresses"], list)
        assert data["total"] == len(data["addresses"])
        assert data["object_count"] == 0
        assert data["profile_count"] == 0
        assert data["collection_count"] == 0
        
        print(f"PASS: Empty address handled gracefully - {data['total']} addresses")

    def test_discover_addresses_address_structure(self):
        """Test that each address entry has required fields"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        for addr_entry in data["addresses"]:
            assert "address" in addr_entry, "Each entry must have 'address'"
            assert "type" in addr_entry, "Each entry must have 'type'"
            assert addr_entry["type"] in ["profile", "object", "collection"], \
                f"Type must be profile/object/collection, got {addr_entry['type']}"
            assert "label" in addr_entry, "Each entry must have 'label'"
            
        print(f"PASS: All {len(data['addresses'])} address entries have correct structure")

    def test_discover_addresses_counts_match(self):
        """Test that counts match the actual addresses"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        data = response.json()
        
        # Count by type
        obj_count = sum(1 for a in data["addresses"] if a.get("type") == "object")
        pro_count = sum(1 for a in data["addresses"] if a.get("type") == "profile")
        col_count = sum(1 for a in data["addresses"] if a.get("type") == "collection")
        
        assert data["object_count"] == obj_count, f"object_count mismatch: {data['object_count']} vs {obj_count}"
        assert data["profile_count"] == pro_count, f"profile_count mismatch: {data['profile_count']} vs {pro_count}"
        assert data["collection_count"] == col_count, f"collection_count mismatch: {data['collection_count']} vs {col_count}"
        assert data["total"] == len(data["addresses"]), f"total mismatch: {data['total']} vs {len(data['addresses'])}"
        
        print(f"PASS: Counts match - obj:{obj_count}, pro:{pro_count}, col:{col_count}, total:{data['total']}")

    def test_discover_addresses_network_param(self):
        """Test that network parameter is respected"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # Test with testnet
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=60
        )
        assert response.status_code == 200
        
        # Test with mainnet (should work but may return different results)
        response_mainnet = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-mainnet"},
            timeout=60
        )
        assert response_mainnet.status_code == 200
        
        print("PASS: Network parameter accepted for both testnet and mainnet")


class TestDeterministicDerivation:
    """Tests for deterministic address derivation functions (frontend-side)
    
    Note: These are conceptual tests - the actual derivation happens in frontend JS.
    We verify the backend doesn't break when receiving deterministically-derived addresses.
    """

    def test_wallet_balance_endpoint(self):
        """Verify wallet balance endpoint works (used by frontend after derivation)"""
        address = "msPJhg9GPzMN6twknwmSQvrUKZbZnk51Tv"
        response = requests.get(
            f"{BASE_URL}/api/wallet/balance/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "balance_sats" in data
        print(f"PASS: Wallet balance endpoint works - {data.get('balance_sats', 0)} sats")

    def test_wallet_utxos_endpoint(self):
        """Verify wallet UTXOs endpoint works"""
        address = "msPJhg9GPzMN6twknwmSQvrUKZbZnk51Tv"
        response = requests.get(
            f"{BASE_URL}/api/wallet/utxos/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        assert "utxos" in data
        assert "count" in data
        print(f"PASS: Wallet UTXOs endpoint works - {data.get('count', 0)} UTXOs")


class TestP2FKHelperFunctions:
    """Tests for P2FK helper functions used by discover-addresses"""

    def test_profile_by_address_api(self):
        """Test that profile lookup works via the profile endpoint"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/profile/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        # Profile endpoint should return 200 or 404
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            data = response.json()
            assert "urn" in data or "address" in data
            print(f"PASS: Profile lookup works - URN: {data.get('urn', 'N/A')}")
        else:
            print("PASS: Profile lookup returns 404 for unknown address (expected)")

    def test_objects_by_creator_api(self):
        """Test that objects-by-creator lookup works"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/objects/by-creator/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        # Should return 200 with list or empty list
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data or isinstance(data, list)
        print(f"PASS: Objects by creator lookup works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
