"""
Test suite for DomainRedirectCard feature and related functionality
Iteration 212 - Testing new Decentralized Domain feature
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDiscoverAddresses:
    """Test wallet discover-addresses endpoint - should return total > 70 for embii4u profile"""
    
    def test_discover_addresses_returns_many_objects(self):
        """GET /api/wallet/discover-addresses/{address} should return total > 70"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(
            f"{BASE_URL}/api/wallet/discover-addresses/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "total" in data, "Response should contain 'total' field"
        assert "addresses" in data, "Response should contain 'addresses' field"
        assert "object_count" in data, "Response should contain 'object_count' field"
        
        # Verify total > 70 as per test requirement
        assert data["total"] > 70, f"Expected total > 70, got {data['total']}"
        print(f"✓ discover-addresses returned {data['total']} addresses (> 70)")
        
        # Verify structure of addresses
        assert isinstance(data["addresses"], list), "addresses should be a list"
        if data["addresses"]:
            first_addr = data["addresses"][0]
            assert "address" in first_addr, "Each address should have 'address' field"
            assert "type" in first_addr, "Each address should have 'type' field"


class TestDomainRedirectObjects:
    """Test object endpoints for domain redirect objects"""
    
    def test_robot_emoji_domain_object(self):
        """🤖🚬 object should have URN as plain text and URI as URL"""
        address = "n2syzkcZL6ciUqzJhZkCeuYS9uyQDNjNRv"
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("name") == "🤖🚬", f"Expected name '🤖🚬', got {data.get('name')}"
        assert data.get("urn") == "🤖🚬", f"Expected URN '🤖🚬', got {data.get('urn')}"
        assert "embii.wtf" in data.get("uri", ""), f"Expected URI containing 'embii.wtf', got {data.get('uri')}"
        print(f"✓ 🤖🚬 object: URN='{data.get('urn')}', URI='{data.get('uri')}'")
    
    def test_embii_domain_object(self):
        """embii domain object should have URN='EMBII' and URI pointing to embii.com"""
        address = "mnFoeouVDTjuwx6j8piAqsZhc2QuEtZBJA"
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("name") == "embii domain", f"Expected name 'embii domain', got {data.get('name')}"
        assert data.get("urn") == "EMBII", f"Expected URN 'EMBII', got {data.get('urn')}"
        assert "embii.com" in data.get("uri", ""), f"Expected URI containing 'embii.com', got {data.get('uri')}"
        print(f"✓ embii domain object: URN='{data.get('urn')}', URI='{data.get('uri')}'")


class TestNonDomainRedirectObjects:
    """Test that non-domain objects have proper URN/URI structure"""
    
    def test_alien_audio_object(self):
        """Alien audio object should have audio file URN, not plain text"""
        address = "mnSog2Aj8q5U7msvKWbs33EWrhpXM8xnWD"
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("name") == "Alien", f"Expected name 'Alien', got {data.get('name')}"
        # URN should be a file reference (BTC:txid/filename), not plain text
        urn = data.get("urn", "")
        assert "BTC:" in urn or ".wav" in urn or ".mp3" in urn, f"Expected audio file URN, got {urn}"
        print(f"✓ Alien audio object: URN='{urn[:60]}...'")
    
    def test_gen2_robot_object(self):
        """GEN2 ROBOT object should have HTML file URN"""
        address = "mty8eoLw2ATs94x5GEeBhC7Z1KwZLYV5Nw"
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("name") == "GEN2 ROBOT", f"Expected name 'GEN2 ROBOT', got {data.get('name')}"
        # URN should be a file reference with .html
        urn = data.get("urn", "")
        assert ".html" in urn.lower() or "MZC:" in urn, f"Expected HTML file URN, got {urn}"
        print(f"✓ GEN2 ROBOT object: URN='{urn[:60]}...'")
    
    def test_stargate_pdf_object(self):
        """STARGATE object should have PDF file URN"""
        address = "myn9cdwx4RtKjbh6YqWwUXqt9KqVYV6h8w"
        response = requests.get(
            f"{BASE_URL}/api/object/addr/{address}",
            params={"network": "btc-testnet"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("name") == "STARGATE", f"Expected name 'STARGATE', got {data.get('name')}"
        # URN should be a file reference with .pdf
        urn = data.get("urn", "")
        assert ".pdf" in urn.lower(), f"Expected PDF file URN, got {urn}"
        print(f"✓ STARGATE object: URN='{urn[:60]}...'")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
