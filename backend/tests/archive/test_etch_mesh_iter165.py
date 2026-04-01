"""
Iteration 165: Etch-to-Chain + Mesh Visualizer + Pinning Manager Testing

Tests for:
- POST /api/etch/chunk - stage a chunk, returns sha256 chunk_id as txid and size
- POST /api/etch/manifest - save etching manifest
- GET /api/etch/manifest/{address} - get manifests for an address
- GET /api/etch/reconstruct/{chunk_id} - fetch raw bytes of a staged chunk
- GET /api/etch/reconstruct-file/{address}/{filename} - reconstruct file from chunks
- GET /api/mesh/node-quality - returns scored nodes (regression from Phase 4)
"""
import pytest
import requests
import os
import hashlib

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestEtchChunkEndpoint:
    """Tests for POST /api/etch/chunk - stage a chunk"""
    
    def test_etch_chunk_success(self):
        """POST /api/etch/chunk stages a chunk and returns txid (sha256 hash) and size"""
        # Create test data
        test_data = b"Hello, this is test chunk data for etching!"
        chunk_hex = test_data.hex()
        expected_hash = hashlib.sha256(test_data).hexdigest()
        
        response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "TEST_etch_address_165",
            "network": "btc-testnet",
            "chunk_hex": chunk_hex,
            "filename": "test_hello.txt",
            "chunk_index": 0,
            "total_chunks": 1
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "txid" in data, "Response should contain txid"
        assert "size" in data, "Response should contain size"
        assert "index" in data, "Response should contain index"
        
        # Verify values
        assert data["txid"] == expected_hash, f"txid should be sha256 hash of chunk data"
        assert data["size"] == len(test_data), f"size should match chunk length"
        assert data["index"] == 0, "index should match chunk_index"
        
        print(f"✓ Chunk staged successfully: txid={data['txid'][:16]}..., size={data['size']}")
    
    def test_etch_chunk_invalid_hex(self):
        """POST /api/etch/chunk with invalid hex returns 400"""
        response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "TEST_etch_address_165",
            "network": "btc-testnet",
            "chunk_hex": "not_valid_hex_data!@#$",
            "filename": "test.txt",
            "chunk_index": 0,
            "total_chunks": 1
        })
        
        assert response.status_code == 400, f"Expected 400 for invalid hex, got {response.status_code}"
        print("✓ Invalid hex correctly rejected with 400")
    
    def test_etch_chunk_multiple_chunks(self):
        """POST /api/etch/chunk handles multiple chunks for same file"""
        chunks = [b"Chunk 0 data", b"Chunk 1 data", b"Chunk 2 data"]
        txids = []
        
        for i, chunk_data in enumerate(chunks):
            response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
                "address": "TEST_etch_multi_165",
                "network": "btc-testnet",
                "chunk_hex": chunk_data.hex(),
                "filename": "multi_chunk_file.bin",
                "chunk_index": i,
                "total_chunks": len(chunks)
            })
            
            assert response.status_code == 200, f"Chunk {i} failed: {response.text}"
            data = response.json()
            txids.append(data["txid"])
            assert data["index"] == i
        
        # All txids should be unique (different content)
        assert len(set(txids)) == len(txids), "Each chunk should have unique txid"
        print(f"✓ Multiple chunks staged: {len(txids)} unique txids")


class TestEtchManifestEndpoint:
    """Tests for POST /api/etch/manifest and GET /api/etch/manifest/{address}"""
    
    def test_save_manifest_success(self):
        """POST /api/etch/manifest saves manifest and returns manifest_id"""
        response = requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": "TEST_manifest_addr_165",
            "network": "btc-testnet",
            "files": [
                {"name": "test_file.txt", "txids": ["abc123", "def456"], "chunks": 2},
                {"name": "image.png", "txids": ["ghi789"], "chunks": 1}
            ]
        })
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "manifest_id" in data, "Response should contain manifest_id"
        assert "file_count" in data, "Response should contain file_count"
        assert data["file_count"] == 2, "file_count should be 2"
        
        print(f"✓ Manifest saved: id={data['manifest_id']}, files={data['file_count']}")
    
    def test_get_manifests_for_address(self):
        """GET /api/etch/manifest/{address} returns manifests for address"""
        test_address = "TEST_get_manifest_165"
        
        # First create a manifest
        requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": test_address,
            "network": "btc-testnet",
            "files": [{"name": "get_test.txt", "txids": ["xyz123"], "chunks": 1}]
        })
        
        # Now fetch manifests
        response = requests.get(f"{BASE_URL}/api/etch/manifest/{test_address}?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "manifests" in data, "Response should contain manifests array"
        assert isinstance(data["manifests"], list), "manifests should be a list"
        
        # Should have at least one manifest
        assert len(data["manifests"]) >= 1, "Should have at least one manifest"
        
        # Check manifest structure
        manifest = data["manifests"][0]
        assert "address" in manifest
        assert "network" in manifest
        assert "files" in manifest
        assert "created_at" in manifest
        
        print(f"✓ Retrieved {len(data['manifests'])} manifest(s) for address")
    
    def test_get_manifests_empty_address(self):
        """GET /api/etch/manifest/{address} returns empty array for unknown address"""
        response = requests.get(f"{BASE_URL}/api/etch/manifest/NONEXISTENT_ADDRESS_XYZ?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "manifests" in data
        assert data["manifests"] == [], "Should return empty array for unknown address"
        
        print("✓ Empty manifests array returned for unknown address")


class TestEtchReconstructEndpoint:
    """Tests for GET /api/etch/reconstruct/{chunk_id}"""
    
    def test_reconstruct_chunk_success(self):
        """GET /api/etch/reconstruct/{chunk_id} returns raw bytes of staged chunk"""
        # First stage a chunk
        test_data = b"Reconstruct test data 165"
        chunk_hex = test_data.hex()
        
        stage_response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": "TEST_reconstruct_165",
            "network": "btc-testnet",
            "chunk_hex": chunk_hex,
            "filename": "reconstruct_test.txt",
            "chunk_index": 0,
            "total_chunks": 1
        })
        
        assert stage_response.status_code == 200
        chunk_id = stage_response.json()["txid"]
        
        # Now reconstruct
        response = requests.get(f"{BASE_URL}/api/etch/reconstruct/{chunk_id}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.content == test_data, "Reconstructed data should match original"
        assert response.headers.get("Content-Type") == "application/octet-stream"
        assert response.headers.get("X-Chunk-Index") == "0"
        assert response.headers.get("X-Filename") == "reconstruct_test.txt"
        
        print(f"✓ Chunk reconstructed: {len(response.content)} bytes")
    
    def test_reconstruct_chunk_not_found(self):
        """GET /api/etch/reconstruct/{invalid_id} returns 404"""
        response = requests.get(f"{BASE_URL}/api/etch/reconstruct/nonexistent_chunk_id_xyz")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ 404 returned for nonexistent chunk")


class TestEtchReconstructFileEndpoint:
    """Tests for GET /api/etch/reconstruct-file/{address}/{filename}"""
    
    def test_reconstruct_file_success(self):
        """GET /api/etch/reconstruct-file/{address}/{filename} reconstructs full file"""
        test_address = "TEST_file_reconstruct_165"
        test_filename = "hello.txt"
        test_content = b"Hello, this is the full file content for reconstruction test!"
        
        # Stage the chunk
        stage_response = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": test_address,
            "network": "btc-testnet",
            "chunk_hex": test_content.hex(),
            "filename": test_filename,
            "chunk_index": 0,
            "total_chunks": 1
        })
        
        assert stage_response.status_code == 200
        chunk_txid = stage_response.json()["txid"]
        
        # Save manifest with the chunk txid
        manifest_response = requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": test_address,
            "network": "btc-testnet",
            "files": [{"name": test_filename, "txids": [chunk_txid], "chunks": 1}]
        })
        
        assert manifest_response.status_code == 200
        
        # Reconstruct the file
        response = requests.get(f"{BASE_URL}/api/etch/reconstruct-file/{test_address}/{test_filename}?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert response.content == test_content, "Reconstructed file should match original content"
        
        print(f"✓ File reconstructed: {len(response.content)} bytes")
    
    def test_reconstruct_file_no_manifest(self):
        """GET /api/etch/reconstruct-file returns 404 when no manifest exists"""
        response = requests.get(f"{BASE_URL}/api/etch/reconstruct-file/NONEXISTENT_ADDR/file.txt?network=btc-testnet")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ 404 returned for address with no manifest")
    
    def test_reconstruct_file_not_in_manifest(self):
        """GET /api/etch/reconstruct-file returns 404 when file not in manifest"""
        test_address = "TEST_file_not_found_165"
        
        # Create manifest with different file
        requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": test_address,
            "network": "btc-testnet",
            "files": [{"name": "other_file.txt", "txids": ["abc"], "chunks": 1}]
        })
        
        # Try to reconstruct non-existent file
        response = requests.get(f"{BASE_URL}/api/etch/reconstruct-file/{test_address}/missing.txt?network=btc-testnet")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ 404 returned for file not in manifest")


class TestMeshNodeQualityEndpoint:
    """Tests for GET /api/mesh/node-quality - regression from Phase 4"""
    
    def test_node_quality_endpoint_exists(self):
        """GET /api/mesh/node-quality returns 200"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network=btc-testnet")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ /api/mesh/node-quality endpoint accessible")
    
    def test_node_quality_response_structure(self):
        """GET /api/mesh/node-quality returns nodes array with count"""
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network=btc-testnet")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "nodes" in data, "Response should contain nodes array"
        assert "count" in data, "Response should contain count"
        assert isinstance(data["nodes"], list), "nodes should be a list"
        assert isinstance(data["count"], int), "count should be an integer"
        
        print(f"✓ Node quality response: {data['count']} nodes")
    
    def test_node_quality_metrics_fields(self):
        """GET /api/mesh/node-quality nodes have scoring fields"""
        # First register a test node
        requests.post(f"{BASE_URL}/api/mesh/register", json={
            "address": "TEST_quality_node_165",
            "network": "btc-testnet",
            "urn": "test_quality_urn",
            "capacity": 5,
            "bandwidth": "normal",
            "services": ["ipfs"]
        })
        
        response = requests.get(f"{BASE_URL}/api/mesh/node-quality?network=btc-testnet")
        
        assert response.status_code == 200
        data = response.json()
        
        if data["count"] > 0:
            node = data["nodes"][0]
            # Check for scoring fields
            expected_fields = ["address", "composite_score"]
            for field in expected_fields:
                assert field in node, f"Node should have {field} field"
            
            # Score fields may include these
            score_fields = ["uptime_score", "capacity_score", "relay_score", "composite_score"]
            has_scores = any(f in node for f in score_fields)
            assert has_scores, "Node should have at least one score field"
            
            print(f"✓ Node has scoring fields: composite_score={node.get('composite_score', 'N/A')}")
        else:
            print("✓ No nodes registered, but endpoint works correctly")


class TestEtchEndToEndFlow:
    """End-to-end test for the complete etch flow"""
    
    def test_full_etch_and_reconstruct_flow(self):
        """Complete flow: stage chunks -> save manifest -> reconstruct file"""
        test_address = "TEST_e2e_etch_165"
        test_filename = "e2e_test.txt"
        
        # Simulate a file split into 2 chunks
        chunk1 = b"First half of the file content. "
        chunk2 = b"Second half of the file content!"
        full_content = chunk1 + chunk2
        
        # Stage chunk 1
        resp1 = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": test_address,
            "network": "btc-testnet",
            "chunk_hex": chunk1.hex(),
            "filename": test_filename,
            "chunk_index": 0,
            "total_chunks": 2
        })
        assert resp1.status_code == 200
        txid1 = resp1.json()["txid"]
        
        # Stage chunk 2
        resp2 = requests.post(f"{BASE_URL}/api/etch/chunk", json={
            "address": test_address,
            "network": "btc-testnet",
            "chunk_hex": chunk2.hex(),
            "filename": test_filename,
            "chunk_index": 1,
            "total_chunks": 2
        })
        assert resp2.status_code == 200
        txid2 = resp2.json()["txid"]
        
        # Save manifest
        manifest_resp = requests.post(f"{BASE_URL}/api/etch/manifest", json={
            "address": test_address,
            "network": "btc-testnet",
            "files": [{"name": test_filename, "txids": [txid1, txid2], "chunks": 2}]
        })
        assert manifest_resp.status_code == 200
        
        # Reconstruct file
        reconstruct_resp = requests.get(
            f"{BASE_URL}/api/etch/reconstruct-file/{test_address}/{test_filename}?network=btc-testnet"
        )
        
        assert reconstruct_resp.status_code == 200
        assert reconstruct_resp.content == full_content, "Reconstructed content should match original"
        
        print(f"✓ E2E flow complete: {len(full_content)} bytes reconstructed from 2 chunks")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
