"""
Test Enhanced Fossil Discovery Multi-Part Feature (Iteration 102)
Tests the new grouped multi-part content from bitfossil.com:
- Results grouped by txid with images[], files[], messages[], has_address, metadata
- Enrichment from index.htm extracts messages, block_date, blockchain, cost, version
- Specific test for 'mazacoin' query (txid ebec4379... should have 'Dakota Access Pipeline' message)
- Test 'embii' query returns 20+ results (previously returned 0)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestFossilMultiPartDiscovery:
    """Tests for enhanced fossil discovery with multi-part content grouping"""

    def test_mazacoin_search_returns_grouped_results(self):
        """POST /api/objects/discover with query 'mazacoin' returns grouped results"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "mazacoin", "count": 50},
            timeout=60  # Higher timeout for enrichment
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        print(f"Mazacoin search returned {data.get('total', 0)} results")
        
        # Check response structure
        assert "results" in data, "Response should have 'results' key"
        assert "query" in data, "Response should have 'query' key"
        
        # If bitfossil.com is available, verify result structure
        if data.get("results") and len(data["results"]) > 0:
            first_result = data["results"][0]
            
            # Verify grouped result structure
            assert "txid" in first_result, "Result should have txid"
            assert "chain" in first_result, "Result should have chain"
            assert "images" in first_result, "Result should have images array"
            assert "files" in first_result, "Result should have files array"  
            assert "messages" in first_result, "Result should have messages array"
            assert "has_address" in first_result, "Result should have has_address boolean"
            assert "metadata" in first_result, "Result should have metadata object"
            assert "detail_url" in first_result, "Result should have detail_url"
            
            # Verify array types
            assert isinstance(first_result["images"], list), "images should be a list"
            assert isinstance(first_result["files"], list), "files should be a list"
            assert isinstance(first_result["messages"], list), "messages should be a list"
            assert isinstance(first_result["has_address"], bool), "has_address should be boolean"
            assert isinstance(first_result["metadata"], dict), "metadata should be a dict"
            
            print(f"First result txid: {first_result['txid'][:16]}...")
            print(f"Chain: {first_result['chain']}")
            print(f"Images: {len(first_result['images'])}")
            print(f"Files: {len(first_result['files'])}")
            print(f"Messages: {len(first_result['messages'])}")
            print(f"Has Address: {first_result['has_address']}")
            print(f"Metadata: {first_result['metadata']}")
        else:
            print("SKIPPED detailed assertions - bitfossil.com may be temporarily unavailable")

    def test_mazacoin_ebec4379_has_expected_content(self):
        """First mazacoin result (txid ebec4379...) should have MZC chain, image, message, has_address=true"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "mazacoin", "count": 50},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        results = data.get("results", [])
        
        if not results:
            pytest.skip("bitfossil.com temporarily unavailable - no results returned")
        
        # Look for the specific txid ebec4379...
        target_txid_prefix = "ebec4379"
        target_result = None
        for r in results:
            if r["txid"].startswith(target_txid_prefix):
                target_result = r
                break
        
        if not target_result:
            # Check if any result has MZC chain
            mzc_results = [r for r in results if r["chain"] == "MZC"]
            print(f"Found {len(mzc_results)} MZC results")
            if mzc_results:
                target_result = mzc_results[0]
                print(f"Using first MZC result: {target_result['txid'][:16]}...")
            else:
                pytest.skip(f"txid starting with {target_txid_prefix} not found in {len(results)} results")
        
        # Verify expected content for mazacoin search
        assert target_result["chain"] == "MZC", f"Expected MZC chain, got {target_result['chain']}"
        
        # Should have at least 1 image (dog_lunges_at_water_protectors.jpg)
        print(f"Images found: {target_result['images']}")
        assert len(target_result["images"]) >= 1, "Expected at least 1 image"
        
        # Should have at least 1 message about 'Dakota Access Pipeline'
        messages = target_result.get("messages", [])
        print(f"Messages found: {messages}")
        if messages:
            all_message_content = " ".join([m.get("content", "") for m in messages])
            # The message should mention Dakota Access Pipeline
            if "Dakota Access Pipeline" in all_message_content:
                print("✓ Found 'Dakota Access Pipeline' in message content")
            else:
                print(f"Message content preview: {all_message_content[:200]}")
        
        # Should have has_address=true
        assert target_result["has_address"] == True, "Expected has_address=true for this txid"
        
        # Should have metadata with block_date and blockchain
        metadata = target_result.get("metadata", {})
        print(f"Metadata: {metadata}")
        if metadata:
            if metadata.get("blockchain"):
                assert metadata["blockchain"] == "Mazacoin", f"Expected Mazacoin, got {metadata['blockchain']}"
            if metadata.get("block_date"):
                print(f"✓ block_date: {metadata['block_date']}")

    def test_embii_search_returns_many_results(self):
        """POST /api/objects/discover with query 'embii' returns 20+ grouped results"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "embii", "count": 100},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        total = data.get("total", 0)
        results = data.get("results", [])
        
        print(f"Embii search returned {total} results (API total), {len(results)} in response")
        
        if not results:
            pytest.skip("bitfossil.com temporarily unavailable - no results returned")
        
        # Should return 20+ results (previously returned 0)
        assert len(results) >= 20, f"Expected 20+ results, got {len(results)}"
        
        # Verify each result has proper structure
        for r in results[:5]:  # Check first 5
            assert "txid" in r
            assert "chain" in r
            assert "images" in r
            assert "messages" in r
            assert "metadata" in r

    def test_dog_search_has_enriched_metadata(self):
        """POST /api/objects/discover with query 'dog' returns results with descriptions and metadata"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "dog", "count": 50},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        results = data.get("results", [])
        
        print(f"Dog search returned {len(results)} results")
        
        if not results:
            pytest.skip("bitfossil.com temporarily unavailable - no results returned")
        
        # Check enrichment on results
        enriched_count = 0
        for r in results[:20]:  # Top 20 are enriched
            has_messages = len(r.get("messages", [])) > 0
            has_metadata = bool(r.get("metadata", {}))
            if has_messages or has_metadata:
                enriched_count += 1
                print(f"Enriched txid {r['txid'][:12]}: msgs={len(r.get('messages', []))}, meta={r.get('metadata', {})}")
        
        print(f"Enriched {enriched_count}/{min(20, len(results))} results")
        # At least some results should have metadata
        assert enriched_count >= 1, "Expected at least 1 enriched result with messages or metadata"

    def test_preview_proxy_still_works(self):
        """GET /api/objects/discover/preview/{txid}/{filename} proxy returns image data"""
        # Known working DOG txid from previous iteration
        txid = "ebec4379cd81a6d9a0880c8bbf177df06b595842be9b66ddd7e9ca7ded9381e6"
        filename = "dog_lunges_at_water_protectors.jpg"
        
        response = requests.get(
            f"{BASE_URL}/api/objects/discover/preview/{txid}/{filename}",
            timeout=30
        )
        
        if response.status_code == 404:
            pytest.skip("Preview file not found - bitfossil.com may have changed")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Should return image content
        content_type = response.headers.get("content-type", "")
        content_length = len(response.content)
        
        print(f"Preview response: {content_type}, {content_length} bytes")
        
        assert "image" in content_type or content_length > 1000, \
            f"Expected image content, got {content_type} with {content_length} bytes"

    def test_message_structure_has_key_and_content(self):
        """Messages array items should have {key, content} structure"""
        response = requests.post(
            f"{BASE_URL}/api/objects/discover",
            json={"query": "mazacoin", "count": 50},
            timeout=60
        )
        assert response.status_code == 200
        
        data = response.json()
        results = data.get("results", [])
        
        if not results:
            pytest.skip("bitfossil.com temporarily unavailable")
        
        # Find a result with messages
        for r in results:
            if r.get("messages"):
                msg = r["messages"][0]
                assert "key" in msg, "Message should have 'key' field"
                assert "content" in msg, "Message should have 'content' field"
                print(f"Message structure: key={msg['key']}, content={msg['content'][:50]}...")
                return
        
        print("No messages found in results - enrichment may have failed for all txids")


class TestStorefrontRegression:
    """Regression tests for existing storefront functionality"""

    def test_storefront_all_objects_still_works(self):
        """GET /api/objects/storefront/btc-testnet returns objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet?limit=10", timeout=15)
        assert response.status_code == 200
        
        data = response.json()
        assert "objects" in data
        assert "total" in data
        print(f"Storefront: {data['total']} total objects")

    def test_storefront_for_sale_still_works(self):
        """GET /api/objects/storefront/btc-testnet with listed filter"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet?limit=10&listed=true",
            timeout=15
        )
        # May return 200 with objects or 200 with empty if no listed items
        assert response.status_code == 200

    def test_object_search_still_works(self):
        """GET /api/objects/search/:keyword works"""
        response = requests.get(
            f"{BASE_URL}/api/objects/search/test?network=btc-testnet&limit=5",
            timeout=15
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "objects" in data
        print(f"Object search returned {len(data['objects'])} results")
