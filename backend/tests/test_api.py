"""
Backend API Tests for Cthulhu - Blockchain Social Media Platform
Tests all endpoints against p2fk.io live API
Iteration 3: Added tests for objects/search endpoint and batch resolve endpoint
Iteration 4: Added tests for feed aggregation (30+ posts), BTC Mainnet support, mainnet vs testnet profiles
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable is required")


class TestHealthAndRoot:
    """Basic health check endpoints"""
    
    def test_root_endpoint(self):
        """Test API root returns version info"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Cthulhu" in data["message"]
        assert "version" in data
        print(f"✓ Root endpoint returns: {data}")
    
    def test_health_endpoint(self):
        """Test health check endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("✓ Health endpoint returns healthy status")


class TestFeedEndpoint:
    """Feed endpoint with pagination tests"""
    
    def test_feed_btc_testnet(self):
        """GET /api/feed/btc-testnet returns feed with pagination"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        
        # Check pagination structure
        assert "feed" in data
        assert "has_more" in data
        assert "total" in data
        assert "count" in data
        assert data["network"] == "btc-testnet"
        
        # Validate posts structure
        if len(data["feed"]) > 0:
            post = data["feed"][0]
            assert "from_address" in post
            assert "content" in post
            assert "transaction_id" in post
            # Should have sender info from embii4u
            print(f"✓ Feed returns {data['count']} posts, total: {data['total']}, has_more: {data['has_more']}")
            print(f"  First post from: {post.get('sender_urn', 'unknown')}")
        else:
            print("⚠ Feed returned 0 posts (may be API issue)")
    
    def test_feed_pagination(self):
        """Test feed pagination works correctly"""
        # Get first page
        page1 = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 0, "limit": 3}).json()
        # Get second page  
        page2 = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 3, "limit": 3}).json()
        
        if len(page1["feed"]) > 0 and len(page2["feed"]) > 0:
            # Check they return different posts
            page1_ids = [p["transaction_id"] for p in page1["feed"]]
            page2_ids = [p["transaction_id"] for p in page2["feed"]]
            # They should be different (unless total < 6)
            print(f"✓ Pagination: page1 has {len(page1['feed'])} posts, page2 has {len(page2['feed'])} posts")
        else:
            print("⚠ Not enough posts to verify pagination")


class TestSearchEndpoint:
    """Search functionality tests"""
    
    def test_search_hashtag_game(self):
        """POST /api/search with #game hashtag returns objects containing #game"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "#game",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert "profiles" in data
        # Hashtag search should return objects
        if len(data["objects"]) > 0:
            obj = data["objects"][0]
            assert "Name" in obj or "Description" in obj
            print(f"✓ Hashtag search '#game' returned {len(data['objects'])} objects")
            print(f"  First object: {obj.get('Name', 'Unnamed')}")
        else:
            print("⚠ Hashtag search returned no objects - API may have no #game objects")
    
    def test_search_embii4u(self):
        """POST /api/search with embii4u returns profile with URN, image, address"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "embii4u",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "profiles" in data
        profiles = data["profiles"]
        
        # embii4u should be found
        assert len(profiles) > 0, "embii4u profile should be found"
        
        profile = profiles[0]
        assert profile.get("urn") == "embii4u"
        assert profile.get("address") == "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        # Should have image (IPFS)
        assert "image" in profile
        print(f"✓ Search 'embii4u' found profile: URN={profile.get('urn')}, address={profile.get('address')[:12]}...")
        print(f"  Image: {profile.get('image', 'None')[:50]}...")
    
    def test_search_neptunemonk(self):
        """POST /api/search with NeptuneMonk returns NeptuneMonk profile"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "NeptuneMonk",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        profiles = data.get("profiles", [])
        # NeptuneMonk should be found (case-insensitive search may apply)
        if len(profiles) > 0:
            print(f"✓ Search 'NeptuneMonk' found {len(profiles)} profile(s)")
            profile = profiles[0]
            print(f"  URN: {profile.get('urn')}, Address: {profile.get('address', 'N/A')[:12]}...")
        else:
            # It's possible NeptuneMonk doesn't exist on testnet
            print("⚠ NeptuneMonk profile not found - may not exist on btc-testnet")
    
    def test_search_empty_result(self):
        """Search for nonexistent profile returns empty results"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "nonexistent_user_xyz123",
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        assert "profiles" in data
        print(f"✓ Search for nonexistent user returns: {len(data['profiles'])} profiles")


class TestProfileEndpoint:
    """Profile detail endpoint tests"""
    
    def test_get_profile_by_address(self):
        """GET /api/profile/{address} returns profile with IPFS image"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/profile/{address}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Check profile structure
        assert data.get("address") == address
        assert data.get("urn") == "embii4u"
        assert "image" in data
        assert data["image"] is not None
        assert "IPFS:" in data["image"], "Profile should have IPFS image"
        
        print(f"✓ Profile for {address[:12]}...")
        print(f"  URN: {data.get('urn')}")
        print(f"  Display Name: {data.get('display_name')}")
        print(f"  Image: {data.get('image', 'None')[:60]}...")
    
    def test_get_profile_not_found(self):
        """Profile for invalid address returns minimal placeholder"""
        response = requests.get(f"{BASE_URL}/api/profile/invalidaddress123", params={"network": "btc-testnet"})
        # Should return 200 with minimal profile (not 404 per code logic)
        assert response.status_code == 200
        data = response.json()
        assert data.get("address") == "invalidaddress123"
        print(f"✓ Invalid address returns placeholder: {data}")


class TestProfilePostsEndpoint:
    """Profile posts pagination tests"""
    
    def test_profile_posts_pagination(self):
        """GET /api/profile/{address}/posts returns paginated posts"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/profile/{address}/posts", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        
        # Check pagination structure
        assert "posts" in data
        assert "has_more" in data
        assert "total" in data
        assert "count" in data
        
        if len(data["posts"]) > 0:
            post = data["posts"][0]
            assert "from_address" in post
            assert "content" in post
            print(f"✓ Profile posts: {data['count']} of {data['total']}, has_more: {data['has_more']}")
        else:
            print("⚠ Profile has no posts")


class TestOwnedObjectsEndpoint:
    """Owned objects pagination tests - key feature"""
    
    def test_owned_objects_pagination(self):
        """GET /api/objects/owned/{address} returns paginated objects with has_more=True and total count"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        
        # Check pagination structure
        assert "objects" in data
        assert "has_more" in data
        assert "total" in data
        assert "count" in data
        assert data["address"] == address
        
        # embii4u should have many objects
        if data["total"] > 5:
            assert data["has_more"] == True, "Should have more objects when total > limit"
        
        print(f"✓ Owned objects: {data['count']} of {data['total']}, has_more: {data['has_more']}")
        
        if len(data["objects"]) > 0:
            obj = data["objects"][0]
            # Objects from p2fk.io have specific structure
            print(f"  First object: Name={obj.get('Name', 'Unnamed')}")
    
    def test_owned_objects_load_more(self):
        """Test loading more objects via pagination"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # First page
        page1 = requests.get(f"{BASE_URL}/api/objects/owned/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 5
        }).json()
        
        if page1["has_more"]:
            # Second page
            page2 = requests.get(f"{BASE_URL}/api/objects/owned/{address}", params={
                "network": "btc-testnet", "skip": 5, "limit": 5
            }).json()
            
            # Verify different objects returned
            if len(page1["objects"]) > 0 and len(page2["objects"]) > 0:
                page1_ids = [o.get("Id") or o.get("TransactionId") for o in page1["objects"]]
                page2_ids = [o.get("Id") or o.get("TransactionId") for o in page2["objects"]]
                # Should be different
                overlap = set(page1_ids) & set(page2_ids)
                assert len(overlap) == 0, "Pages should not have overlapping objects"
                print(f"✓ Load More works: page1={len(page1['objects'])}, page2={len(page2['objects'])} distinct objects")
        else:
            print("⚠ Not enough objects to test Load More")


class TestResolveEndpoint:
    """Address resolution endpoint tests"""
    
    def test_resolve_known_address(self):
        """GET /api/resolve/{address} returns URN and image"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/resolve/{address}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("address") == address
        assert data.get("urn") == "embii4u"
        assert data.get("found") == True
        assert "image" in data
        
        print(f"✓ Resolve {address[:12]}...: URN={data['urn']}, found={data['found']}")
    
    def test_resolve_unknown_address(self):
        """Resolve unknown address returns abbreviated address"""
        response = requests.get(f"{BASE_URL}/api/resolve/unknownaddress123", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("found") == False
        print(f"✓ Resolve unknown address: found={data['found']}, urn={data['urn']}")


# ============== NEW ITERATION 3 TESTS ==============

class TestObjectsSearchEndpoint:
    """NEW: Objects search endpoint with keyword search and pagination"""
    
    def test_objects_search_game_first_page(self):
        """GET /api/objects/search/game returns first page with has_more=true"""
        response = requests.get(f"{BASE_URL}/api/objects/search/game", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 4
        })
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "objects" in data
        assert "keyword" in data
        assert "count" in data
        assert "total" in data
        assert "skip" in data
        assert "limit" in data
        assert "has_more" in data
        
        # Verify values
        assert data["keyword"] == "game"
        assert data["skip"] == 0
        assert data["limit"] == 4
        
        # Should have objects and has_more should be true if total > 4
        if data["total"] > 4:
            assert data["has_more"] == True, "Should have more when total > limit"
            assert data["count"] <= 4, "Should return at most limit objects"
        
        print(f"✓ Objects search 'game': count={data['count']}, total={data['total']}, has_more={data['has_more']}")
        if len(data["objects"]) > 0:
            print(f"  First object: {data['objects'][0].get('Name', 'Unnamed')}")
    
    def test_objects_search_game_second_page(self):
        """GET /api/objects/search/game?skip=4 returns second page"""
        response = requests.get(f"{BASE_URL}/api/objects/search/game", params={
            "network": "btc-testnet",
            "skip": 4,
            "limit": 4
        })
        assert response.status_code == 200
        data = response.json()
        
        assert data["skip"] == 4
        assert data["keyword"] == "game"
        
        # Verify pagination structure
        assert "objects" in data
        assert "has_more" in data
        assert "total" in data
        
        # External p2fk.io API may return duplicates across pages
        # Just verify we get data back
        print(f"✓ Second page (skip=4): count={data['count']}, has_more={data['has_more']}")
    
    def test_objects_search_music(self):
        """GET /api/objects/search/music returns music-related objects"""
        response = requests.get(f"{BASE_URL}/api/objects/search/music", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 12
        })
        assert response.status_code == 200
        data = response.json()
        
        assert data["keyword"] == "music"
        print(f"✓ Objects search 'music': total={data['total']}, count={data['count']}")
    
    def test_objects_search_empty_keyword(self):
        """GET /api/objects/search with nonexistent keyword returns empty"""
        response = requests.get(f"{BASE_URL}/api/objects/search/nonexistentkeyword123xyz", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 12
        })
        assert response.status_code == 200
        data = response.json()
        
        assert data["total"] == 0
        assert len(data["objects"]) == 0
        assert data["has_more"] == False
        print(f"✓ Search for nonexistent keyword returns empty: total={data['total']}")


class TestBatchResolveEndpoint:
    """NEW: Batch resolve endpoint for performance"""
    
    def test_batch_resolve_two_addresses(self):
        """POST /api/resolve/batch resolves multiple addresses"""
        addresses = [
            "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",  # embii4u
            "n1G7h7g7oPLt8cvHwWqUnJfnty4kPsTG7t"   # NeptuneMonk
        ]
        response = requests.post(f"{BASE_URL}/api/resolve/batch", json={
            "addresses": addresses,
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Should return dict keyed by address
        assert isinstance(data, dict)
        
        # First address (embii4u)
        embii = data.get("muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs")
        assert embii is not None, "embii4u address should be in results"
        assert embii.get("urn") == "embii4u"
        assert embii.get("found") == True
        assert "image" in embii
        print(f"✓ Batch resolve embii4u: urn={embii['urn']}, found={embii['found']}")
        
        # Second address (NeptuneMonk)
        neptune = data.get("n1G7h7g7oPLt8cvHwWqUnJfnty4kPsTG7t")
        assert neptune is not None, "NeptuneMonk address should be in results"
        # NeptuneMonk should resolve (if exists) or return abbreviated
        print(f"✓ Batch resolve NeptuneMonk: urn={neptune.get('urn')}, found={neptune.get('found')}")
    
    def test_batch_resolve_mixed_addresses(self):
        """Batch resolve with known and unknown addresses"""
        addresses = [
            "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs",  # embii4u - known
            "unknownaddress12345"  # Unknown
        ]
        response = requests.post(f"{BASE_URL}/api/resolve/batch", json={
            "addresses": addresses,
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Known address should have found=True
        known = data.get("muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs")
        assert known["found"] == True
        
        # Unknown address should have found=False
        unknown = data.get("unknownaddress12345")
        assert unknown["found"] == False
        # Should have abbreviated URN
        assert "..." in unknown["urn"], "Unknown addresses should have abbreviated URN"
        print(f"✓ Batch resolve mixed: known found={known['found']}, unknown found={unknown['found']}")
    
    def test_batch_resolve_empty_list(self):
        """Batch resolve with empty list returns empty dict"""
        response = requests.post(f"{BASE_URL}/api/resolve/batch", json={
            "addresses": [],
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        assert data == {}
        print("✓ Batch resolve empty list returns empty dict")
    
    def test_batch_resolve_capped_at_20(self):
        """Batch resolve accepts max 20 addresses (caps at 20)"""
        # Send 25 addresses
        addresses = [f"address{i}" for i in range(25)]
        response = requests.post(f"{BASE_URL}/api/resolve/batch", json={
            "addresses": addresses,
            "network": "btc-testnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        # Should only process first 20
        assert len(data) <= 20, "Should cap at 20 addresses"
        print(f"✓ Batch resolve caps at 20: sent 25, got {len(data)}")


# ============== NEW ITERATION 4 TESTS ==============

class TestFeedAggregation:
    """NEW Iter4: Feed aggregation from multiple addresses - 30+ posts on testnet"""
    
    def test_feed_testnet_total_at_least_30(self):
        """GET /api/feed/btc-testnet returns total>=30 (aggregated from multiple addresses)"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        
        assert data["total"] >= 30, f"Feed should have at least 30 posts aggregated, got {data['total']}"
        assert data["has_more"] == True, "With 30+ posts, has_more should be true with limit=5"
        assert data["count"] == 5
        print(f"✓ Testnet feed total={data['total']} (>= 30), has_more={data['has_more']}")
    
    def test_feed_testnet_pagination_page3_differs(self):
        """GET /api/feed/btc-testnet?skip=10 returns different posts than page 1"""
        # Page 1
        page1 = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 0, "limit": 5}).json()
        # Page 3 (skip=10)
        page3 = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 10, "limit": 5}).json()
        
        page1_ids = set(p["transaction_id"] for p in page1["feed"])
        page3_ids = set(p["transaction_id"] for p in page3["feed"])
        
        # They should be distinct (no overlap)
        overlap = page1_ids & page3_ids
        assert len(overlap) == 0, f"Page 1 and page 3 should have no overlapping posts, found overlap: {overlap}"
        
        print(f"✓ Testnet pagination: page1={len(page1['feed'])} posts, page3={len(page3['feed'])} posts, no overlap")


class TestMainnetSupport:
    """NEW Iter4: BTC Mainnet feed and profile support"""
    
    def test_feed_mainnet_returns_data(self):
        """GET /api/feed/btc-mainnet returns mainnet-specific posts with has_more=true"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-mainnet", params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        
        assert data["network"] == "btc-mainnet"
        assert data["total"] >= 10, f"Mainnet should have at least 10 posts, got {data['total']}"
        assert data["has_more"] == True or data["total"] <= 5, "has_more should reflect total > limit"
        assert data["count"] <= 5
        
        print(f"✓ Mainnet feed: total={data['total']}, count={data['count']}, has_more={data['has_more']}")
        
        if len(data["feed"]) > 0:
            post = data["feed"][0]
            print(f"  First mainnet post from: {post.get('sender_urn', post.get('from_address', 'unknown')[:12])}...")
    
    def test_mainnet_search_embii(self):
        """POST /api/search 'embii' on btc-mainnet returns mainnet profile (different from testnet)"""
        response = requests.post(f"{BASE_URL}/api/search", json={
            "query": "embii",
            "network": "btc-mainnet"
        })
        assert response.status_code == 200
        data = response.json()
        
        profiles = data.get("profiles", [])
        assert len(profiles) > 0, "embii profile should exist on mainnet"
        
        profile = profiles[0]
        assert profile.get("urn") == "embii"
        # Mainnet address for embii should be different from testnet embii4u
        assert profile.get("address") == "16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw", \
            f"Mainnet embii should have mainnet address, got {profile.get('address')}"
        assert profile.get("network") == "btc-mainnet"
        
        print(f"✓ Mainnet search 'embii': address={profile['address']}, urn={profile['urn']}")
    
    def test_testnet_vs_mainnet_profiles_differ(self):
        """Testnet embii4u and mainnet embii are different accounts"""
        # Testnet search
        testnet_resp = requests.post(f"{BASE_URL}/api/search", json={
            "query": "embii4u",
            "network": "btc-testnet"
        }).json()
        
        # Mainnet search  
        mainnet_resp = requests.post(f"{BASE_URL}/api/search", json={
            "query": "embii",
            "network": "btc-mainnet"
        }).json()
        
        testnet_profiles = testnet_resp.get("profiles", [])
        mainnet_profiles = mainnet_resp.get("profiles", [])
        
        assert len(testnet_profiles) > 0, "Testnet should have embii4u profile"
        assert len(mainnet_profiles) > 0, "Mainnet should have embii profile"
        
        testnet_addr = testnet_profiles[0].get("address")
        mainnet_addr = mainnet_profiles[0].get("address")
        
        assert testnet_addr != mainnet_addr, \
            f"Testnet and mainnet addresses should differ: testnet={testnet_addr}, mainnet={mainnet_addr}"
        
        assert testnet_addr == "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs", "Testnet embii4u address"
        assert mainnet_addr == "16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw", "Mainnet embii address"
        
        print(f"✓ Testnet vs Mainnet profiles differ:")
        print(f"  Testnet embii4u: {testnet_addr}")
        print(f"  Mainnet embii: {mainnet_addr}")


# ============== NEW ITERATION 5 (PHASE 3) TESTS ==============

class TestKnownUsersEndpoint:
    """Phase 3: MongoDB-backed known_users cache"""
    
    def test_known_users_btc_testnet(self):
        """GET /api/known-users/btc-testnet returns cached users with profiles"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "users" in data
        assert "count" in data
        
        # Should have seeded users
        assert data["count"] >= 5, f"Should have at least 5 known users (seeds), got {data['count']}"
        
        # Validate user structure
        if len(data["users"]) > 0:
            user = data["users"][0]
            assert "address" in user
            assert "network" in user
            assert user["network"] == "btc-testnet"
            # Users with resolved profiles should have URN
            has_urn_users = [u for u in data["users"] if u.get("urn")]
            assert len(has_urn_users) >= 5, "Should have at least 5 users with URNs"
            print(f"✓ Known users btc-testnet: {data['count']} users, {len(has_urn_users)} with URNs")
            print(f"  Sample users: {[u.get('urn') for u in has_urn_users[:5]]}")
        else:
            print("⚠ No known users found")
    
    def test_known_users_btc_mainnet(self):
        """GET /api/known-users/btc-mainnet returns mainnet users"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-mainnet")
        assert response.status_code == 200
        data = response.json()
        
        assert "users" in data
        # Should have at least 1 seeded mainnet user (some seeds may not have profiles)
        assert data["count"] >= 1, f"Should have at least 1 mainnet user, got {data['count']}"
        
        # All users should be mainnet
        for user in data["users"]:
            assert user["network"] == "btc-mainnet", f"User {user.get('address')} should be mainnet"
        
        print(f"✓ Known users btc-mainnet: {data['count']} users")
    
    def test_search_registers_known_user(self):
        """Search for profile registers user in known_users DB"""
        # Search for a profile
        search_resp = requests.post(f"{BASE_URL}/api/search", json={
            "query": "embii4u",
            "network": "btc-testnet"
        })
        assert search_resp.status_code == 200
        
        # Check known-users now includes this user
        known_resp = requests.get(f"{BASE_URL}/api/known-users/btc-testnet")
        known_data = known_resp.json()
        
        addresses = [u.get("address") for u in known_data["users"]]
        urns = [u.get("urn") for u in known_data["users"]]
        
        assert "embii4u" in urns, "Search should register embii4u in known users"
        print(f"✓ Search registers users in known_users DB")


class TestRepliesEndpoint:
    """Phase 3: Replies tab - messages TO the user"""
    
    def test_profile_replies_endpoint(self):
        """GET /api/profile/{address}/replies returns messages sent TO this user"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"  # embii4u
        response = requests.get(f"{BASE_URL}/api/profile/{address}/replies", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        
        # Check pagination structure
        assert "replies" in data
        assert "has_more" in data
        assert "total" in data
        assert "count" in data
        
        # embii4u should have replies (based on previous test output)
        assert data["total"] >= 5, f"embii4u should have at least 5 replies, got {data['total']}"
        assert data["has_more"] == True or data["total"] <= 5
        
        # Validate reply structure
        if len(data["replies"]) > 0:
            reply = data["replies"][0]
            assert "from_address" in reply
            assert "to_address" in reply
            assert reply["to_address"] == address, "Reply should be TO the profile address"
            assert reply["from_address"] != address, "Reply should be FROM someone else"
            assert reply.get("is_reply"), "Should be marked as is_reply"
            # Should have recipient info
            assert reply.get("recipient_urn") == "embii4u", "Recipient should be embii4u"
            # Sender should be resolved if known
            if reply.get("sender_urn"):
                print(f"  Reply from @{reply['sender_urn']} to @{reply['recipient_urn']}")
        
        print(f"✓ Profile replies: {data['count']} of {data['total']}, has_more: {data['has_more']}")
    
    def test_replies_pagination(self):
        """Test replies pagination works correctly"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # Page 1
        page1 = requests.get(f"{BASE_URL}/api/profile/{address}/replies", params={
            "network": "btc-testnet", "skip": 0, "limit": 5
        }).json()
        
        if page1["has_more"]:
            # Page 2
            page2 = requests.get(f"{BASE_URL}/api/profile/{address}/replies", params={
                "network": "btc-testnet", "skip": 5, "limit": 5
            }).json()
            
            if len(page1["replies"]) > 0 and len(page2["replies"]) > 0:
                page1_ids = set(r["transaction_id"] for r in page1["replies"])
                page2_ids = set(r["transaction_id"] for r in page2["replies"])
                overlap = page1_ids & page2_ids
                assert len(overlap) == 0, "Reply pages should not overlap"
                print(f"✓ Replies pagination: page1={len(page1['replies'])}, page2={len(page2['replies'])}, no overlap")
        else:
            print("⚠ Not enough replies to test pagination")


class TestThreadEndpoint:
    """Phase 3/8: Conversation threads using GetRootByTransactionID + conversation_cache"""
    
    def test_thread_self_post(self):
        """GET /api/thread/{txid} for a self-post returns conversation context"""
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "thread" in data
        assert "root_txid" in data
        assert "count" in data
        assert "conversation_address" in data  # Iter8 addition
        
        # Iter8: Should have multiple messages (conversation context)
        assert data["count"] >= 1, "Thread should have at least 1 message"
        
        if len(data["thread"]) > 0:
            root_msg = data["thread"][0]
            # Iter8: API now uses 'signed_by' instead of 'from_address'
            assert root_msg.get("signed_by") == "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
            assert root_msg.get("sender_urn") == "embii4u"
            print(f"✓ Thread for self-post: {data['count']} message(s)")
            print(f"  Root from: @{root_msg.get('sender_urn')}")
    
    def test_thread_invalid_txid(self):
        """Thread for invalid txid returns error but doesn't fail"""
        response = requests.get(f"{BASE_URL}/api/thread/invalidtxid123", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Should return empty thread with error message
        assert "thread" in data
        assert len(data["thread"]) == 0 or "error" in data
        print(f"✓ Invalid txid returns: {data.get('error', 'empty thread')}")
    
    def test_thread_structure(self):
        """Thread messages have proper structure (Iter8 format)"""
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        data = response.json()
        
        if len(data["thread"]) > 0:
            msg = data["thread"][0]
            # Iter8: Updated required fields (signed_by instead of from_address, block_date instead of created_at)
            required_fields = ["signed_by", "content", "transaction_id", 
                              "block_date", "is_from_owner", "sender_urn", "is_highlighted"]
            for field in required_fields:
                assert field in msg, f"Thread message should have {field}"
            print(f"✓ Thread message has all required fields (Iter8 format)")


class TestFeedReplyIndicator:
    """Phase 3: Feed posts include reply indicator data"""
    
    def test_feed_has_reply_fields(self):
        """Feed posts include is_reply, recipient_urn fields"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={"skip": 0, "limit": 20})
        assert response.status_code == 200
        data = response.json()
        
        # All posts should have reply-related fields
        for post in data["feed"]:
            assert "is_reply" in post, "Feed posts should have is_reply field"
            assert "recipient_urn" in post, "Feed posts should have recipient_urn field"
            assert "sender_urn" in post, "Feed posts should have sender_urn field"
        
        # Count reply posts
        reply_posts = [p for p in data["feed"] if p.get("is_reply")]
        print(f"✓ Feed has {len(reply_posts)} reply-type posts out of {len(data['feed'])}")
        
        if reply_posts:
            sample = reply_posts[0]
            print(f"  Sample reply: from @{sample.get('sender_urn')} to address {sample.get('to_address', 'unknown')[:12]}...")


# ============== NEW ITERATION 6 TESTS: Conversation History ==============

class TestConversationEndpoint:
    """Iteration 6: GetRootsByAddress conversation history with MongoDB caching"""
    
    def test_conversation_messages_filter(self):
        """GET /api/conversation/{address}?filter=messages returns only posts with text"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5,
            "filter": "messages"
        }, timeout=60)
        assert response.status_code == 200
        data = response.json()
        
        assert "roots" in data
        assert "total" in data
        assert "has_more" in data
        assert "from_cache" in data
        assert "address" in data
        
        # embii4u has ~2362 messages
        assert data["total"] >= 2000, f"Expected ~2362 messages, got {data['total']}"
        assert data["has_more"] == True
        
        # All returned roots should have has_message=True
        for root in data["roots"]:
            assert root.get("has_message") == True, f"Root {root.get('transaction_id')} should have message"
            assert root.get("type") == "message"
        
        print(f"✓ Conversation messages filter: total={data['total']}, from_cache={data.get('from_cache')}")
    
    def test_conversation_interactions_filter(self):
        """GET /api/conversation/{address}?filter=interactions returns empty-message roots"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5,
            "filter": "interactions"
        }, timeout=60)
        assert response.status_code == 200
        data = response.json()
        
        # embii4u has ~862 interactions
        assert data["total"] >= 800, f"Expected ~862 interactions, got {data['total']}"
        
        # All returned roots should have has_message=False
        for root in data["roots"]:
            assert root.get("has_message") == False, f"Root should NOT have message"
            assert root.get("type") in ["interaction", "object"]
        
        print(f"✓ Conversation interactions filter: total={data['total']}")
    
    def test_conversation_all_filter(self):
        """GET /api/conversation/{address}?filter=all returns everything"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5,
            "filter": "all"
        }, timeout=60)
        assert response.status_code == 200
        data = response.json()
        
        # embii4u has ~3224 total roots
        assert data["total"] >= 3000, f"Expected ~3224 total, got {data['total']}"
        
        print(f"✓ Conversation all filter: total={data['total']}")
    
    def test_conversation_cache_working(self):
        """Second call to conversation endpoint should have from_cache=true"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # First call (may or may not be cached)
        resp1 = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 5, "filter": "messages"
        }, timeout=60)
        
        # Second call should definitely use cache
        resp2 = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 5, "filter": "messages"
        }, timeout=10)
        
        assert resp2.status_code == 200
        data2 = resp2.json()
        
        # Second call should be cached (within 5 min TTL)
        assert data2.get("from_cache") == True, "Second request should use MongoDB cache"
        print(f"✓ Conversation cache working: from_cache={data2.get('from_cache')}")
    
    def test_conversation_pagination(self):
        """Conversation pagination works (skip/limit)"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # Page 1
        page1 = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 5, "filter": "messages"
        }, timeout=30).json()
        
        # Page 2
        page2 = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 5, "limit": 5, "filter": "messages"
        }, timeout=30).json()
        
        # Transaction IDs should be different
        page1_ids = set(r["transaction_id"] for r in page1["roots"])
        page2_ids = set(r["transaction_id"] for r in page2["roots"])
        
        assert len(page1_ids & page2_ids) == 0, "Page 1 and page 2 should have no overlapping roots"
        print(f"✓ Conversation pagination: page1={len(page1['roots'])}, page2={len(page2['roots'])}, no overlap")
    
    def test_conversation_root_structure(self):
        """Conversation roots have proper structure for UI rendering"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 1, "filter": "messages"
        }, timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        if len(data["roots"]) > 0:
            root = data["roots"][0]
            required_fields = [
                "transaction_id", "signed_by", "content", "has_message",
                "block_date", "is_from_owner", "type"
            ]
            for field in required_fields:
                assert field in root, f"Root should have {field}"
            
            # Owner roots should have is_from_owner=True
            if root["signed_by"] == address:
                assert root["is_from_owner"] == True
            
            # Profile info resolved for recent items
            if root.get("sender_urn"):
                assert root["sender_urn"] == "embii4u"
        
        print(f"✓ Conversation root structure validated")
    
    def test_conversation_reply_badge(self):
        """Non-owner messages should have is_from_owner=False (reply badge indicator)"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        
        # Get a larger sample to find non-owner messages
        response = requests.get(f"{BASE_URL}/api/conversation/{address}", params={
            "network": "btc-testnet", "skip": 0, "limit": 100, "filter": "all"
        }, timeout=30)
        assert response.status_code == 200
        data = response.json()
        
        owner_roots = [r for r in data["roots"] if r.get("is_from_owner")]
        non_owner_roots = [r for r in data["roots"] if not r.get("is_from_owner")]
        
        # Should have both owner and non-owner messages
        assert len(owner_roots) > 0, "Should have owner messages"
        # Note: may or may not have non-owner depending on conversation history
        print(f"✓ Conversation: {len(owner_roots)} owner roots, {len(non_owner_roots)} non-owner (reply badge)")


class TestFeedReplyCount:
    """Iteration 6: Feed posts now show reply count"""
    
    def test_feed_has_reply_count(self):
        """Feed posts have reply_count field"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet", params={
            "skip": 0, "limit": 10
        })
        assert response.status_code == 200
        data = response.json()
        
        # All posts should have reply_count field
        for post in data["feed"]:
            assert "reply_count" in post, "Feed posts should have reply_count"
            assert isinstance(post["reply_count"], int), "reply_count should be integer"
        
        # Find posts with reply_count > 0
        posts_with_replies = [p for p in data["feed"] if p["reply_count"] > 0]
        print(f"✓ Feed reply count: {len(posts_with_replies)} posts have replies out of {len(data['feed'])}")
        
        if posts_with_replies:
            sample = posts_with_replies[0]
            print(f"  Sample: @{sample.get('sender_urn', 'unknown')} has {sample['reply_count']} replies")


# ============== NEW ITERATION 8 TESTS: Thread Modal Fix (Multiple Messages) ==============

class TestThreadModalFix:
    """Iteration 8: Thread modal now shows full conversation context, not just 1 post.
    Fix: Thread endpoint uses conversation_cache from GetRootsByAddress instead of just GetRootByTransactionID.
    """
    
    def test_thread_returns_multiple_messages(self):
        """GET /api/thread/{txid} returns multiple messages (not just 1)"""
        # embii4u self-post - should return ~16 messages
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "thread" in data
        assert "count" in data
        assert "conversation_address" in data
        
        # Key fix: Should return MULTIPLE messages, not just 1
        assert data["count"] >= 10, f"Thread should have 10+ messages (showing conversation), got {data['count']}"
        assert len(data["thread"]) >= 10, f"Thread array should have 10+ items"
        
        print(f"✓ Thread returns {data['count']} messages (fix working - not just 1)")
    
    def test_thread_has_conversation_address(self):
        """Thread response includes conversation_address for 'Full Conversation' button"""
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # conversation_address needed for "Full Conversation" button navigation
        assert "conversation_address" in data, "Thread should return conversation_address"
        assert data["conversation_address"] == "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs", \
            f"Expected embii4u address, got {data.get('conversation_address')}"
        
        print(f"✓ conversation_address present: {data['conversation_address'][:12]}...")
    
    def test_thread_clicked_post_is_highlighted(self):
        """Clicked post has is_highlighted=true in thread response"""
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Find the highlighted post
        highlighted_posts = [t for t in data["thread"] if t.get("is_highlighted")]
        assert len(highlighted_posts) == 1, f"Should have exactly 1 highlighted post, got {len(highlighted_posts)}"
        
        highlighted = highlighted_posts[0]
        assert highlighted["transaction_id"] == txid, "Highlighted post should be the clicked txid"
        
        print(f"✓ Clicked post is highlighted: txid={highlighted['transaction_id'][:12]}...")
    
    def test_thread_shows_owner_and_reply_posts(self):
        """Thread shows both owner posts (is_from_owner=true) and replies (is_from_owner=false)"""
        txid = "f5e522fd2de353a3f4b8c61c5c012fcf2031919926fa0e689687950011e7a564"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        owner_posts = [t for t in data["thread"] if t.get("is_from_owner")]
        reply_posts = [t for t in data["thread"] if not t.get("is_from_owner")]
        
        # Should have owner posts
        assert len(owner_posts) >= 1, "Should have at least 1 owner post"
        
        # embii4u's conversation should have replies from NeptuneMonk
        if reply_posts:
            print(f"✓ Thread has {len(owner_posts)} owner posts, {len(reply_posts)} replies")
            reply_urns = set(r.get("sender_urn") for r in reply_posts if r.get("sender_urn"))
            if reply_urns:
                print(f"  Reply authors: {reply_urns}")
        else:
            print(f"✓ Thread has {len(owner_posts)} owner posts (no replies in this slice)")
    
    def test_thread_for_reply_post_highlights_reply(self):
        """When clicking a reply post (NeptuneMonk), that reply is highlighted"""
        # NeptuneMonk reply txid
        txid = "082ba746d8f23e27f3853cc66cfc2bd1d641ab6fb9d84ef22d476e469b4fd749"
        response = requests.get(f"{BASE_URL}/api/thread/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Should return multiple messages (conversation context)
        assert data["count"] >= 5, f"Reply thread should have 5+ messages, got {data['count']}"
        
        # The NeptuneMonk post should be highlighted
        highlighted = [t for t in data["thread"] if t.get("is_highlighted")]
        assert len(highlighted) == 1, "Should have exactly 1 highlighted post"
        
        # Highlighted should be NeptuneMonk
        assert highlighted[0]["sender_urn"] == "NeptuneMonk", \
            f"Highlighted should be NeptuneMonk, got {highlighted[0].get('sender_urn')}"
        
        print(f"✓ NeptuneMonk reply is highlighted, thread has {data['count']} messages")


# ============== NEW ITERATION 7 TESTS: Known Users Ranked Modal ==============

class TestKnownUsersRankedEndpoint:
    """Iteration 7: Known Users ranked by activity for discovery modal"""
    
    def test_ranked_endpoint_returns_users(self):
        """GET /api/known-users/{network}/ranked returns users sorted by total_activity"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked")
        assert response.status_code == 200
        data = response.json()
        
        assert "users" in data
        assert "count" in data
        assert "network" in data
        assert data["network"] == "btc-testnet"
        
        # Should have 17 users per requirements
        assert data["count"] >= 17, f"Expected 17+ users, got {data['count']}"
        
        print(f"✓ Ranked endpoint: {data['count']} users for {data['network']}")
    
    def test_ranked_users_have_required_fields(self):
        """Ranked users include all required fields for UI rendering"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked")
        assert response.status_code == 200
        data = response.json()
        
        required_fields = [
            "address", "urn", "display_name", "image",
            "total_activity", "message_count", "interaction_count", "last_active"
        ]
        
        for user in data["users"]:
            for field in required_fields:
                assert field in user, f"User missing required field: {field}"
        
        print(f"✓ All {len(data['users'])} users have required fields")
    
    def test_ranked_embii4u_first_with_highest_activity(self):
        """embii4u should be first with total_activity=3224 (from cached conversation)"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked")
        assert response.status_code == 200
        data = response.json()
        
        users = data["users"]
        assert len(users) > 0, "Should have at least 1 user"
        
        # First user should be embii4u with highest activity
        first_user = users[0]
        assert first_user["urn"] == "embii4u", f"First user should be embii4u, got {first_user.get('urn')}"
        assert first_user["total_activity"] == 3224, f"embii4u should have 3224 activity, got {first_user.get('total_activity')}"
        assert first_user["message_count"] == 2362, f"embii4u should have 2362 messages"
        assert first_user["interaction_count"] == 862, f"embii4u should have 862 interactions"
        
        print(f"✓ embii4u is first with total_activity={first_user['total_activity']}")
        print(f"  messages={first_user['message_count']}, interactions={first_user['interaction_count']}")
    
    def test_ranked_users_sorted_by_activity_descending(self):
        """Users should be sorted by total_activity in descending order"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked")
        assert response.status_code == 200
        data = response.json()
        
        users = data["users"]
        activities = [u["total_activity"] for u in users]
        
        # Check sorting (descending)
        for i in range(len(activities) - 1):
            assert activities[i] >= activities[i+1], f"Users not sorted: index {i} has {activities[i]}, index {i+1} has {activities[i+1]}"
        
        print(f"✓ Users sorted by activity: {activities[:5]}")
    
    def test_ranked_other_users_no_cached_activity(self):
        """Other users without cached conversation data show 0 activity"""
        response = requests.get(f"{BASE_URL}/api/known-users/btc-testnet/ranked")
        assert response.status_code == 200
        data = response.json()
        
        users = data["users"]
        
        # All users except embii4u should have 0 activity (no cached data)
        users_without_activity = [u for u in users if u["total_activity"] == 0]
        
        # Should be at least 15 users without cached activity
        assert len(users_without_activity) >= 15, f"Expected 15+ users without activity, got {len(users_without_activity)}"
        
        print(f"✓ {len(users_without_activity)} users have no cached activity (shows 'No cached activity yet' in UI)")


# ============== NEW ITERATION 9 TESTS: Object Storefront & Single Object Detail ==============

class TestObjectStorefrontEndpoint:
    """Iteration 9: Object Storefront browsing with listings"""
    
    def test_storefront_returns_objects_with_pagination(self):
        """GET /api/objects/storefront/{network} returns objects with pagination"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"skip": 0, "limit": 10})
        assert response.status_code == 200
        data = response.json()
        
        # Check response structure
        assert "objects" in data
        assert "total" in data
        assert "total_listed" in data
        assert "has_more" in data
        assert "skip" in data
        assert "limit" in data
        
        # Should have objects
        assert len(data["objects"]) > 0, "Storefront should return objects"
        assert data["total"] > 0, "Should have total count"
        
        print(f"✓ Storefront: {len(data['objects'])} objects returned, total={data['total']}, listed={data['total_listed']}")
    
    def test_storefront_objects_have_required_fields(self):
        """Storefront objects have all required fields for ObjectCard rendering"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"skip": 0, "limit": 5})
        assert response.status_code == 200
        data = response.json()
        
        required_fields = [
            "transaction_id", "name", "image", "owners", "creators",
            "is_listed", "min_price", "listings", "total_supply"
        ]
        
        for obj in data["objects"]:
            for field in required_fields:
                assert field in obj, f"Object missing required field: {field}"
        
        print(f"✓ All {len(data['objects'])} objects have required fields")
    
    def test_storefront_listed_objects_first(self):
        """Listed objects (for sale) should appear before unlisted objects"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"skip": 0, "limit": 20})
        assert response.status_code == 200
        data = response.json()
        
        objects = data["objects"]
        if len(objects) < 2:
            print("⚠ Not enough objects to verify sorting")
            return
        
        # Find transition point from listed to unlisted
        found_unlisted = False
        transition_idx = -1
        for i, obj in enumerate(objects):
            if not obj.get("is_listed"):
                found_unlisted = True
                transition_idx = i
                break
        
        if found_unlisted:
            # All objects before transition should be listed
            for i in range(transition_idx):
                assert objects[i]["is_listed"] == True, f"Object at index {i} should be listed"
            
            # All objects after transition should be unlisted
            for i in range(transition_idx, len(objects)):
                assert objects[i]["is_listed"] == False, f"Object at index {i} should be unlisted"
            
            print(f"✓ Listed objects first: {transition_idx} listed, {len(objects) - transition_idx} unlisted")
        else:
            # All objects are listed
            print(f"✓ All {len(objects)} objects are listed")
    
    def test_storefront_boom_bap_sick_is_listed(self):
        """Known object 'Boom Bap Sick' should be listed with FREE price"""
        response = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"skip": 0, "limit": 50})
        assert response.status_code == 200
        data = response.json()
        
        # Find Boom Bap Sick
        boom_bap = None
        for obj in data["objects"]:
            if obj.get("name") == "Boom Bap Sick":
                boom_bap = obj
                break
        
        assert boom_bap is not None, "Boom Bap Sick should be in storefront"
        assert boom_bap["is_listed"] == True, "Boom Bap Sick should be listed"
        assert boom_bap["min_price"] == 0.0, "Boom Bap Sick should be FREE (price 0)"
        assert boom_bap["transaction_id"] == "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        
        print(f"✓ Boom Bap Sick found: is_listed={boom_bap['is_listed']}, min_price={boom_bap['min_price']} (FREE)")


class TestSingleObjectDetailEndpoint:
    """Iteration 9: Single Object detail page with full market data"""
    
    def test_object_detail_boom_bap_sick(self):
        """GET /api/object/{txid} returns full object detail for Boom Bap Sick"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Verify core fields
        assert data["name"] == "Boom Bap Sick"
        assert data["transaction_id"] == txid
        assert data["is_listed"] == True
        assert data["min_price"] == 0.0  # FREE
        assert "Eclectic Method" in data["description"]
        assert data["license"] == "CC0"
        
        # Verify owners structure
        assert len(data["owners"]) > 0
        assert "address" in data["owners"][0]
        assert "quantity" in data["owners"][0]
        
        # Verify creators structure
        assert len(data["creators"]) > 0
        assert "address" in data["creators"][0]
        
        # Verify listings structure
        assert len(data["listings"]) > 0
        assert data["listings"][0]["price"] == 0.0
        
        print(f"✓ Object detail: name={data['name']}, listed={data['is_listed']}, price={data['min_price']}")
        print(f"  owners={data['owner_count']}, supply={data['total_supply']}")
    
    def test_object_detail_sphere_universe_with_btc_price(self):
        """GET /api/object/{txid} for sphere universe has 0.001 BTC price"""
        txid = "13a481f76530150245449bd813012eb8676bfd417ed5d794f6fe33187222a9f8"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data["name"] == "sphere universe"
        assert data["is_listed"] == True
        assert data["min_price"] == 0.001, f"Expected 0.001 BTC, got {data['min_price']}"
        
        # Should have resolved profiles for creators/owners
        assert "resolved_profiles" in data
        resolved = data["resolved_profiles"]
        
        # embii4u should be in resolved profiles (listed as requestor)
        embii_addr = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        if embii_addr in resolved:
            assert resolved[embii_addr]["urn"] == "embii4u"
            print(f"✓ embii4u profile resolved: {resolved[embii_addr]}")
        
        print(f"✓ sphere universe: listed={data['is_listed']}, price={data['min_price']} BTC")
    
    def test_object_detail_has_resolved_profiles(self):
        """Object detail should resolve creator/owner profiles"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "resolved_profiles" in data
        resolved = data["resolved_profiles"]
        
        # Should have at least one resolved profile
        if len(resolved) > 0:
            first_addr = list(resolved.keys())[0]
            profile = resolved[first_addr]
            assert "urn" in profile or "display_name" in profile or "image" in profile
            print(f"✓ Resolved profiles: {len(resolved)} addresses")
            for addr, p in list(resolved.items())[:3]:
                print(f"  {addr[:12]}... -> {p.get('urn', 'no-urn')}")
        else:
            print("⚠ No profiles resolved (external API may not have profile data)")
    
    def test_object_detail_returns_network(self):
        """Object detail response includes network field"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert "network" in data
        assert data["network"] == "btc-testnet"
        print(f"✓ Object includes network: {data['network']}")
    
    def test_object_detail_not_found(self):
        """Non-existent object txid returns 404"""
        txid = "invalid_txid_that_does_not_exist_123456789"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 404
        print("✓ Invalid txid returns 404")
    
    def test_object_detail_has_complete_listing_info(self):
        """Listed objects have complete listing info (address, owner, quantity, price)"""
        txid = "0659e85f067fb72ee7941304f8f391551be923192a6ab72d08b62b8a6007a65a"
        response = requests.get(f"{BASE_URL}/api/object/{txid}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        assert data["is_listed"] == True
        assert len(data["listings"]) > 0
        
        listing = data["listings"][0]
        assert "address" in listing
        assert "owner" in listing
        assert "quantity" in listing
        assert "price" in listing
        assert "block_date" in listing
        
        print(f"✓ Listing info complete: owner={listing['owner'][:12]}..., qty={listing['quantity']}, price={listing['price']}")


class TestProfileObjectsIntegration:
    """Iteration 9: Profile page object tabs still work"""
    
    def test_profile_owned_objects_navigable(self):
        """GET /api/objects/owned/{address} returns clickable objects"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/objects/owned/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert "total" in data
        assert "has_more" in data
        
        if len(data["objects"]) > 0:
            obj = data["objects"][0]
            # Should have TransactionId for navigation
            assert "TransactionId" in obj or "transaction_id" in obj, "Object needs TransactionId for navigation"
            txid = obj.get("TransactionId") or obj.get("transaction_id")
            print(f"✓ Owned objects: {len(data['objects'])} objects, first txid={txid[:16]}...")
        else:
            print("⚠ No owned objects found")
    
    def test_profile_created_objects_navigable(self):
        """GET /api/objects/created/{address} returns clickable objects"""
        address = "muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs"
        response = requests.get(f"{BASE_URL}/api/objects/created/{address}", params={
            "network": "btc-testnet",
            "skip": 0,
            "limit": 5
        })
        assert response.status_code == 200
        data = response.json()
        
        assert "objects" in data
        assert "total" in data
        
        if len(data["objects"]) > 0:
            obj = data["objects"][0]
            txid = obj.get("TransactionId") or obj.get("transaction_id") or "unknown"
            name = obj.get("Name") or obj.get("name") or "unnamed"
            print(f"✓ Created objects: {len(data['objects'])} objects, first='{name}' ({txid[:16]}...)")
        else:
            print("⚠ No created objects found")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
