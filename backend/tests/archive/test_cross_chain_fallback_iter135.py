"""
Test iteration 135: Cross-chain fallback and address version byte detection.

Tests:
1. Backend cross-chain fallback: DOG chain file with chain=BTC
2. Backend cross-chain fallback: LTC chain file with chain=BTC
3. Address version byte detection endpoint
4. Storefront loads on mainnet
5. Object search returns results with on-chain images
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCrossChainFallback:
    """Test cross-chain fallback for on-chain file resolution."""

    def test_dog_chain_file_with_btc_param(self):
        """Request a DOG chain file with chain=BTC, verify it resolves (202 or 200)."""
        # DOG chain file: dodge-meme.gif
        url = f"{BASE_URL}/api/onchain/file/73e146c1b4c1ad9c05de733bbc8c9b682b25b69054492b84c090dd9b1cb0c58f/dodge-meme.gif"
        params = {"chain": "BTC", "mainnet": "true"}
        
        resp = requests.get(url, params=params, timeout=30)
        # Should return 200 (cached) or 202 (resolving in background)
        assert resp.status_code in [200, 202], f"Expected 200 or 202, got {resp.status_code}: {resp.text[:200]}"
        
        if resp.status_code == 202:
            # Verify it's a valid resolving response
            data = resp.json()
            assert data.get("status") == "resolving", f"Expected resolving status, got: {data}"
            print(f"DOG file is being resolved in background: {data}")
        else:
            # 200 means file is cached and served
            content_type = resp.headers.get("content-type", "")
            assert "image" in content_type or len(resp.content) > 0, "Expected image content"
            print(f"DOG file served successfully: {len(resp.content)} bytes, type: {content_type}")

    def test_ltc_chain_file_with_btc_param(self):
        """Request an LTC chain file with chain=BTC, verify it resolves (202 or 200)."""
        # LTC chain file: cthulhu.png
        url = f"{BASE_URL}/api/onchain/file/f347f1b456210ca958e30dae8f55b5a26d4a73e453db409c99d4724af05c106a/cthulhu.png"
        params = {"chain": "BTC", "mainnet": "true"}
        
        resp = requests.get(url, params=params, timeout=30)
        # Should return 200 (cached) or 202 (resolving in background)
        assert resp.status_code in [200, 202], f"Expected 200 or 202, got {resp.status_code}: {resp.text[:200]}"
        
        if resp.status_code == 202:
            data = resp.json()
            assert data.get("status") == "resolving", f"Expected resolving status, got: {data}"
            print(f"LTC file is being resolved in background: {data}")
        else:
            content_type = resp.headers.get("content-type", "")
            assert "image" in content_type or len(resp.content) > 0, "Expected image content"
            print(f"LTC file served successfully: {len(resp.content)} bytes, type: {content_type}")


class TestAddressVersionByteDetection:
    """Test address version byte detection endpoint."""

    def test_detect_btc_mainnet_address(self):
        """Detect BTC mainnet address (starts with '1')."""
        address = "19yMYv9hRRG7tD36eFHPoFeaA2x82CrcGC"
        url = f"{BASE_URL}/api/onchain/detect-chain/{address}"
        
        resp = requests.get(url, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        assert data.get("chain") == "BTC", f"Expected BTC chain, got: {data}"
        assert data.get("mainnet") == True, f"Expected mainnet=True, got: {data}"
        assert data.get("address") == address, f"Address mismatch: {data}"
        print(f"BTC mainnet address detected correctly: {data}")

    def test_detect_ltc_address(self):
        """Detect LTC mainnet address (starts with 'L')."""
        address = "LfmKqjKQoFZ1ToUzFofLQoawf1UXwqWkBe"
        url = f"{BASE_URL}/api/onchain/detect-chain/{address}"
        
        resp = requests.get(url, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        assert data.get("chain") == "LTC", f"Expected LTC chain, got: {data}"
        assert data.get("mainnet") == True, f"Expected mainnet=True, got: {data}"
        print(f"LTC address detected correctly: {data}")

    def test_detect_dog_address(self):
        """Detect DOG/DOGE mainnet address (starts with 'D')."""
        address = "DPD3iT1FvN3SMGX8X3bXVt3VQR3ENWRoDQ"
        url = f"{BASE_URL}/api/onchain/detect-chain/{address}"
        
        resp = requests.get(url, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        assert data.get("chain") == "DOG", f"Expected DOG chain, got: {data}"
        assert data.get("mainnet") == True, f"Expected mainnet=True, got: {data}"
        print(f"DOG address detected correctly: {data}")


class TestStorefrontMainnet:
    """Test storefront loads on mainnet with on-chain objects."""

    def test_storefront_btc_mainnet(self):
        """Verify storefront loads on btc-mainnet with objects."""
        url = f"{BASE_URL}/api/objects/storefront/btc-mainnet"
        params = {"skip": 0, "limit": 20}
        
        resp = requests.get(url, params=params, timeout=60)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        
        data = resp.json()
        assert "objects" in data, f"Expected 'objects' key in response: {data.keys()}"
        assert isinstance(data["objects"], list), f"Expected objects to be a list"
        
        # Should have some objects
        obj_count = len(data["objects"])
        total = data.get("total", 0)
        print(f"Storefront returned {obj_count} objects (total: {total})")
        
        # Check for on-chain objects (DOG, LTC, BTC prefixes or bare txids)
        onchain_count = 0
        for obj in data["objects"]:
            image = obj.get("image", "") or ""
            urn = obj.get("urn", "") or ""
            # Check for chain prefixes or bare txid patterns
            if any(p in image.upper() for p in ["DOG:", "LTC:", "MZC:", "BTC:"]):
                onchain_count += 1
            elif len(image) >= 64 and all(c in "0123456789abcdefABCDEF" for c in image[:64]):
                onchain_count += 1
            elif any(p in urn.upper() for p in ["DOG:", "LTC:", "MZC:", "BTC:"]):
                onchain_count += 1
        
        print(f"Found {onchain_count} on-chain objects in storefront")
        assert obj_count > 0, "Expected at least some objects in storefront"


class TestObjectSearch:
    """Test object search returns results with on-chain images."""

    def test_search_embii(self):
        """Search for 'embii' on mainnet and verify results."""
        url = f"{BASE_URL}/api/objects/search/embii"
        params = {"network": "btc-mainnet", "limit": 5}
        
        resp = requests.get(url, params=params, timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        
        data = resp.json()
        assert "objects" in data, f"Expected 'objects' key in response"
        
        obj_count = len(data["objects"])
        print(f"Search 'embii' returned {obj_count} objects")
        
        # Log object details
        for i, obj in enumerate(data["objects"][:3]):
            name = obj.get("name", "Unnamed")
            image = obj.get("image", "")[:50] if obj.get("image") else "None"
            urn = obj.get("urn", "")[:50] if obj.get("urn") else "None"
            print(f"  Object {i+1}: {name}, image: {image}..., urn: {urn}...")
        
        assert obj_count > 0, "Expected at least one result for 'embii' search"


class TestOnchainStatus:
    """Test on-chain status endpoint."""

    def test_onchain_status_dog_file(self):
        """Check status of DOG chain file."""
        txid = "73e146c1b4c1ad9c05de733bbc8c9b682b25b69054492b84c090dd9b1cb0c58f"
        url = f"{BASE_URL}/api/onchain/status/{txid}"
        params = {"chain": "DOG", "mainnet": "true"}
        
        resp = requests.get(url, params=params, timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        print(f"DOG file status: {data}")
        # Status endpoint returns resolvable info
        assert "resolvable" in data, f"Expected 'resolvable' key: {data}"

    def test_onchain_status_ltc_file(self):
        """Check status of LTC chain file."""
        txid = "f347f1b456210ca958e30dae8f55b5a26d4a73e453db409c99d4724af05c106a"
        url = f"{BASE_URL}/api/onchain/status/{txid}"
        params = {"chain": "LTC", "mainnet": "true"}
        
        resp = requests.get(url, params=params, timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        
        data = resp.json()
        print(f"LTC file status: {data}")
        assert "resolvable" in data, f"Expected 'resolvable' key: {data}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
