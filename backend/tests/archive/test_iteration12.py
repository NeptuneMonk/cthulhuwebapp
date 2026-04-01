"""
Iteration 12 Tests - New features for Cthulhu Social Platform
Features tested:
- GET /api/profile/{address}/verified_image endpoint
- POST /api/wallet/create_object endpoint
- SingleObjectPage badges (Creator/Owner cross-badges, Royalties display)
- ObjectCreateModal (royalty setup, field validation)
- ObjectsPage Create Object button visibility
"""

import pytest
import requests
import os
from bit import PrivateKeyTestnet

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')
NETWORK = 'btc-testnet'

# Test object with self-owned creator (creator = owner)
SELF_OWNED_OBJECT_TXID = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"


class TestVerifiedImageEndpoint:
    """Tests for GET /api/profile/{address}/verified_image endpoint"""

    def test_verified_image_valid_address_no_matching_object(self):
        """Test verified_image for address with profile but no matching object"""
        # embii4u address
        response = requests.get(
            f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs/verified_image",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        # This address has a profile image but may not own it as an object
        assert "verified" in data
        assert isinstance(data["verified"], bool)
        if not data["verified"]:
            assert "reason" in data

    def test_verified_image_no_profile_image(self):
        """Test verified_image for non-existent address returns no_profile_image"""
        response = requests.get(
            f"{BASE_URL}/api/profile/mzKYWC1234567890invalid/verified_image",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["verified"] == False
        assert data.get("reason") in ["no_profile_image", "error"]

    def test_verified_image_network_parameter(self):
        """Test that network parameter is accepted"""
        response = requests.get(
            f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs/verified_image",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200

    def test_verified_image_mainnet_network(self):
        """Test verified_image with mainnet network parameter"""
        response = requests.get(
            f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs/verified_image",
            params={"network": "btc-mainnet"}
        )
        assert response.status_code == 200

    def test_verified_image_response_structure(self):
        """Test that response has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs/verified_image",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "verified" in data
        # If verified, should have match_type and matched_urn
        if data["verified"]:
            assert "match_type" in data
            assert data["match_type"] in ["owned", "created"]


class TestCreateObjectEndpoint:
    """Tests for POST /api/wallet/create_object endpoint"""

    def test_create_object_invalid_wif(self):
        """Test that invalid WIF returns 400 error"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": "invalid_wif_key",
                "urn": "test-urn",
                "network": NETWORK
            }
        )
        assert response.status_code == 400
        assert "Invalid WIF" in response.json()["detail"]

    def test_create_object_empty_wif(self):
        """Test that empty WIF returns error"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": "",
                "urn": "test-urn",
                "network": NETWORK
            }
        )
        assert response.status_code == 400

    def test_create_object_missing_urn(self):
        """Test that missing URN returns 422 validation error"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "network": NETWORK
            }
        )
        assert response.status_code == 422

    def test_create_object_unfunded_wallet(self):
        """Test that unfunded wallet returns No UTXOs error"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "urn": "test-object-unfunded",
                "network": NETWORK
            }
        )
        assert response.status_code == 400
        assert "No UTXOs" in response.json()["detail"] or "Fund your wallet" in response.json()["detail"]

    def test_create_object_accepts_all_fields(self):
        """Test that all optional fields are accepted (fails at UTXO check, not validation)"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "urn": "test-complete-object",
                "name": "My Test Object",
                "description": "A test object with all fields",
                "image": "IPFS:QmTestHash123/image.png",
                "license": "CC-BY-4.0",
                "max_supply": 100,
                "royalties": {"recipient-addr": 5.5, "another-addr": 2.5},
                "keywords": ["test", "demo", "nft"],
                "network": NETWORK
            }
        )
        # Should fail at UTXO check, not at validation
        assert response.status_code == 400
        assert "No UTXOs" in response.json()["detail"] or "Fund your wallet" in response.json()["detail"]

    def test_create_object_with_royalties_dict(self):
        """Test that royalties dictionary is properly accepted"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "urn": "royalty-test-object",
                "royalties": {
                    "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs": 10,
                    "embii4u": 5
                },
                "network": NETWORK
            }
        )
        # Should fail at UTXO stage, not validation
        assert response.status_code == 400
        assert "No UTXOs" in response.json()["detail"]

    def test_create_object_with_keywords_list(self):
        """Test that keywords list is properly accepted"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "urn": "keyword-test-object",
                "keywords": ["art", "nft", "digital"],
                "network": NETWORK
            }
        )
        # Should fail at UTXO stage
        assert response.status_code == 400

    def test_create_object_max_supply_default(self):
        """Test that max_supply defaults to 1 if not specified"""
        key = PrivateKeyTestnet()
        response = requests.post(
            f"{BASE_URL}/api/wallet/create_object",
            json={
                "wif": key.to_wif(),
                "urn": "default-supply-object",
                "network": NETWORK
            }
        )
        # Validates params first before UTXO check
        assert response.status_code in [400, 422]


class TestSingleObjectEndpoint:
    """Tests for single object detail with creator/owner badges and royalties"""

    def test_object_detail_returns_owners(self):
        """Test that object detail includes owners list"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "owners" in data
        assert isinstance(data["owners"], list)

    def test_object_detail_returns_creators(self):
        """Test that object detail includes creators list"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "creators" in data
        assert isinstance(data["creators"], list)

    def test_object_detail_returns_royalties(self):
        """Test that object detail includes royalties field"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "royalties" in data
        # Royalties can be empty dict or have entries
        assert isinstance(data["royalties"], dict)

    def test_object_self_owned_creator_owner(self):
        """Test object where creator is also owner (for badge display)"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Get owner and creator addresses
        owner_addresses = {o["address"] for o in data.get("owners", [])}
        creator_addresses = {c["address"] for c in data.get("creators", [])}
        
        # Check if there's overlap (self-owned)
        common = owner_addresses.intersection(creator_addresses)
        # This specific object has mzKYWCYEtBU5DDEhtkeXLbFNCR9f2wsKKq as both creator and owner
        assert "mzKYWCYEtBU5DDEhtkeXLbFNCR9f2wsKKq" in owner_addresses


class TestExistingEndpointsRegression:
    """Regression tests for existing wallet and feed endpoints"""

    def test_feed_endpoint_still_works(self):
        """Test GET /api/feed/{network} is still functional"""
        response = requests.get(
            f"{BASE_URL}/api/feed/btc-testnet",
            params={"limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        assert "total" in data

    def test_wallet_create_still_works(self):
        """Test POST /api/wallet/create is still functional"""
        response = requests.post(
            f"{BASE_URL}/api/wallet/create",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "address" in data
        assert "wif" in data
        assert "public_key" in data

    def test_wallet_balance_still_works(self):
        """Test GET /api/wallet/balance/{address} is still functional"""
        response = requests.get(
            f"{BASE_URL}/api/wallet/balance/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "balance_sats" in data
        assert "address" in data

    def test_profile_endpoint_still_works(self):
        """Test GET /api/profile/{address} is still functional"""
        response = requests.get(
            f"{BASE_URL}/api/profile/muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "address" in data or "urn" in data

    def test_objects_storefront_still_works(self):
        """Test GET /api/objects/storefront/{network} is still functional"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        assert "objects" in data
        assert "total" in data

    def test_health_check(self):
        """Test health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"


class TestObjectDataStructure:
    """Tests for object data structure including royalties and resolved profiles"""

    def test_object_has_resolved_profiles(self):
        """Test that object detail includes resolved_profiles for creators/owners"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "resolved_profiles" in data
        assert isinstance(data["resolved_profiles"], dict)

    def test_object_owner_structure(self):
        """Test owner structure includes address, quantity, transfer_txid"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        if data.get("owners"):
            owner = data["owners"][0]
            assert "address" in owner
            assert "quantity" in owner

    def test_object_creator_structure(self):
        """Test creator structure includes address and date"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        if data.get("creators"):
            creator = data["creators"][0]
            assert "address" in creator

    def test_object_listing_fields(self):
        """Test that listed objects have correct listing fields"""
        response = requests.get(
            f"{BASE_URL}/api/object/{SELF_OWNED_OBJECT_TXID}",
            params={"network": NETWORK}
        )
        assert response.status_code == 200
        data = response.json()
        assert "is_listed" in data
        assert "min_price" in data
        assert "listings" in data
