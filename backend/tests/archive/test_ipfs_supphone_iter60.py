"""
Iteration 60: IPFS Status/Restart and SUPphone Codec2 Integration Tests

Tests for:
1. GET /api/ipfs/status - Returns {online: true, peer_id, agent} when IPFS daemon is running
2. POST /api/ipfs/restart - Returns {success: true, online: true}
3. Codec2 WASM files accessible at /codec2/c2enc.wasm and /codec2/c2dec.wasm
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIPFSStatus:
    """Tests for IPFS daemon status endpoint"""
    
    def test_ipfs_status_returns_200(self):
        """GET /api/ipfs/status should return 200"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"IPFS status returned 200")
    
    def test_ipfs_status_has_online_field(self):
        """GET /api/ipfs/status should return {online: true/false}"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        data = response.json()
        assert "online" in data, f"Missing 'online' field in response: {data}"
        print(f"IPFS status online field: {data['online']}")
    
    def test_ipfs_status_online_true(self):
        """GET /api/ipfs/status should return online: true when daemon is running"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        data = response.json()
        assert data.get("online") == True, f"Expected online=true, got: {data}"
        print(f"IPFS daemon is online: {data}")
    
    def test_ipfs_status_has_peer_id(self):
        """GET /api/ipfs/status should return peer_id when online"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        data = response.json()
        if data.get("online"):
            assert "peer_id" in data, f"Missing peer_id when online: {data}"
            assert len(data["peer_id"]) > 10, f"peer_id seems invalid: {data['peer_id']}"
            print(f"IPFS peer_id: {data['peer_id']}")
    
    def test_ipfs_status_has_agent(self):
        """GET /api/ipfs/status should return agent when online"""
        response = requests.get(f"{BASE_URL}/api/ipfs/status")
        assert response.status_code == 200
        data = response.json()
        if data.get("online"):
            assert "agent" in data, f"Missing agent when online: {data}"
            assert "kubo" in data["agent"].lower(), f"Expected kubo agent, got: {data['agent']}"
            print(f"IPFS agent: {data['agent']}")


class TestIPFSRestart:
    """Tests for IPFS daemon restart endpoint"""
    
    def test_ipfs_restart_returns_200(self):
        """POST /api/ipfs/restart should return 200"""
        response = requests.post(f"{BASE_URL}/api/ipfs/restart")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        print(f"IPFS restart returned 200")
    
    def test_ipfs_restart_has_success_field(self):
        """POST /api/ipfs/restart should return {success: true}"""
        response = requests.post(f"{BASE_URL}/api/ipfs/restart")
        assert response.status_code == 200
        data = response.json()
        assert "success" in data, f"Missing 'success' field in response: {data}"
        assert data["success"] == True, f"Expected success=true, got: {data}"
        print(f"IPFS restart success: {data}")
    
    def test_ipfs_restart_has_online_field(self):
        """POST /api/ipfs/restart should return {online: true/false}"""
        response = requests.post(f"{BASE_URL}/api/ipfs/restart")
        assert response.status_code == 200
        data = response.json()
        assert "online" in data, f"Missing 'online' field in response: {data}"
        print(f"IPFS restart online status: {data['online']}")


class TestCodec2WASM:
    """Tests for Codec2 WASM file accessibility"""
    
    def test_codec2_encoder_wasm_accessible(self):
        """GET /codec2/c2enc.wasm should be accessible"""
        response = requests.head(f"{BASE_URL}/codec2/c2enc.wasm")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content_type = response.headers.get('content-type', '')
        assert 'wasm' in content_type.lower() or 'octet-stream' in content_type.lower(), \
            f"Expected WASM content-type, got: {content_type}"
        print(f"c2enc.wasm accessible, content-type: {content_type}")
    
    def test_codec2_decoder_wasm_accessible(self):
        """GET /codec2/c2dec.wasm should be accessible"""
        response = requests.head(f"{BASE_URL}/codec2/c2dec.wasm")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        content_type = response.headers.get('content-type', '')
        assert 'wasm' in content_type.lower() or 'octet-stream' in content_type.lower(), \
            f"Expected WASM content-type, got: {content_type}"
        print(f"c2dec.wasm accessible, content-type: {content_type}")
    
    def test_codec2_encoder_js_accessible(self):
        """GET /codec2/c2enc.js should be accessible"""
        response = requests.head(f"{BASE_URL}/codec2/c2enc.js")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"c2enc.js accessible")
    
    def test_codec2_decoder_js_accessible(self):
        """GET /codec2/c2dec.js should be accessible"""
        response = requests.head(f"{BASE_URL}/codec2/c2dec.js")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"c2dec.js accessible")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
