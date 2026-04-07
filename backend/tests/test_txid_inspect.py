"""
Test TXID Inspect Endpoint - Cross-Chain Support
Tests the /api/txid/inspect/{txid} endpoint for BTC, LTC, DOGE, MZC chains.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test TXIDs provided by main agent
BTC_OBJ_TXID = "81704d39260b47a8f990c9a36d7a54d708f68e9443f40666843a039c7022cbef"
LTC_TXID = "02c0c4c4786878deedb6df97788390b99828fd83e23f2c993ada843ed25377fb"
MZC_TXID = "5203523e2cf009b2de716836cb8d28c44876fd22cd5d3cb60d6e9c6212f3c16d"


class TestTxidInspect:
    """Tests for /api/txid/inspect/{txid} endpoint with cross-chain support"""

    def test_btc_obj_txid_returns_found_and_chain_btc(self):
        """BTC OBJ TXID should return found:true, chain:BTC, urn_available:false"""
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/{BTC_OBJ_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify found and chain
        assert data.get("found") is True, f"Expected found=True, got {data.get('found')}"
        assert data.get("chain") == "BTC", f"Expected chain=BTC, got {data.get('chain')}"
        
        # Verify URN availability (should be claimed)
        assert data.get("urn_available") is False, f"Expected urn_available=False, got {data.get('urn_available')}"
        
        # Verify obj_data is present (this is an OBJ transaction)
        assert data.get("obj_data") is not None, "Expected obj_data to be present for OBJ transaction"
        assert "urn" in data.get("obj_data", {}), "Expected urn in obj_data"
        
        # Verify suggested fields
        assert data.get("suggested_urn") is not None, "Expected suggested_urn"
        assert data.get("suggested_name") is not None, "Expected suggested_name"

    def test_ltc_txid_returns_found_and_chain_ltc(self):
        """LTC TXID should return found:true, chain:LTC, existing_claim with name 'Winking Tongue'"""
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/{LTC_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify found and chain
        assert data.get("found") is True, f"Expected found=True, got {data.get('found')}"
        assert data.get("chain") == "LTC", f"Expected chain=LTC, got {data.get('chain')}"
        
        # Verify existing_claim
        existing_claim = data.get("existing_claim")
        assert existing_claim is not None, "Expected existing_claim to be present"
        assert existing_claim.get("name") == "Winking Tongue", f"Expected name='Winking Tongue', got {existing_claim.get('name')}"
        
        # Verify files include the image
        files = data.get("files", [])
        file_names = [f.get("name") for f in files]
        assert "winking_tongue_out.png" in file_names, f"Expected winking_tongue_out.png in files, got {file_names}"
        
        # Verify suggested URN has LTC prefix
        suggested_urn = data.get("suggested_urn", "")
        assert suggested_urn.startswith("LTC:"), f"Expected suggested_urn to start with 'LTC:', got {suggested_urn}"

    def test_mzc_txid_returns_found_and_chain_mzc(self):
        """MZC TXID should return found:true, chain:MZC, files include robot.png"""
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/{MZC_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify found and chain
        assert data.get("found") is True, f"Expected found=True, got {data.get('found')}"
        assert data.get("chain") == "MZC", f"Expected chain=MZC, got {data.get('chain')}"
        
        # Verify files include robot.png
        files = data.get("files", [])
        file_names = [f.get("name") for f in files]
        assert "robot.png" in file_names, f"Expected robot.png in files, got {file_names}"
        
        # Verify suggested URN has MZC prefix
        suggested_urn = data.get("suggested_urn", "")
        assert suggested_urn.startswith("MZC:"), f"Expected suggested_urn to start with 'MZC:', got {suggested_urn}"
        
        # Verify URN is available (unclaimed)
        assert data.get("urn_available") is True, f"Expected urn_available=True, got {data.get('urn_available')}"
        assert data.get("existing_claim") is None, "Expected no existing_claim for unclaimed TXID"

    def test_invalid_txid_returns_not_found(self):
        """Invalid TXID should return found:false with error message"""
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/invalidtxid",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify not found
        assert data.get("found") is False, f"Expected found=False, got {data.get('found')}"
        
        # Verify error message
        assert "error" in data, "Expected error field in response"
        assert "Invalid" in data.get("error", ""), f"Expected 'Invalid' in error message, got {data.get('error')}"

    def test_nonexistent_valid_format_txid(self):
        """Valid format but non-existent TXID should return found:false"""
        fake_txid = "0000000000000000000000000000000000000000000000000000000000000000"
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/{fake_txid}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return not found
        assert data.get("found") is False, f"Expected found=False for non-existent TXID, got {data.get('found')}"

    def test_response_structure_completeness(self):
        """Verify response contains all expected fields"""
        response = requests.get(
            f"{BASE_URL}/api/txid/inspect/{BTC_OBJ_TXID}",
            params={"network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Required fields for found=true response
        required_fields = [
            "found", "txid", "chain", "signed_by", "signed", 
            "block_date", "confirmations", "files", "messages",
            "keywords", "obj_data", "suggested_urn", "suggested_name",
            "urn_available", "urn_claimed_by", "existing_claim"
        ]
        
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
