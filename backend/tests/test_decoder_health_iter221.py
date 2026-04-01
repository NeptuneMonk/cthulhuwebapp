"""
Test suite for Decoder Health Dashboard and IPFS Cache Manager features (Iteration 221)
Tests:
1. Admin login and authentication
2. GET /api/admin/system-stats returns decoder stats
3. Decoder stats structure validation (independence_score, sources, by_path, recent)
4. Feed endpoint regression check
5. P2FK local node status endpoint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://dark-telegram-ui.preview.emergentagent.com')

# Admin credentials
ADMIN_USERNAME = "CthulhuAdmin"
ADMIN_PASSWORD = "78UH1%2kC^vH2Gi1MqI@"


class TestAdminAuth:
    """Admin authentication tests"""
    
    def test_admin_login_success(self):
        """Test admin login returns token"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in response"
        assert "username" in data, "No username in response"
        assert data["username"] == ADMIN_USERNAME
        print(f"✓ Admin login successful, token received")
    
    def test_admin_login_invalid_credentials(self):
        """Test admin login with wrong credentials"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "wrong", "password": "wrong"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Invalid credentials correctly rejected")


class TestDecoderHealthStats:
    """Decoder Health Dashboard API tests"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Admin authentication failed")
    
    def test_system_stats_requires_auth(self):
        """Test system-stats endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/system-stats")
        assert response.status_code == 401, f"Expected 401 without auth, got {response.status_code}"
        print(f"✓ System stats correctly requires authentication")
    
    def test_system_stats_returns_decoder_field(self, admin_token):
        """Test system-stats returns tracker.decoder field"""
        response = requests.get(
            f"{BASE_URL}/api/admin/system-stats",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"System stats failed: {response.text}"
        data = response.json()
        
        # Check top-level structure
        assert "tracker" in data, "No tracker field in response"
        assert "mongodb" in data, "No mongodb field in response"
        assert "system" in data, "No system field in response"
        
        # Check decoder field exists
        tracker = data["tracker"]
        assert "decoder" in tracker, "No decoder field in tracker"
        print(f"✓ System stats returns decoder field")
    
    def test_decoder_stats_structure(self, admin_token):
        """Test decoder stats has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/admin/system-stats",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        decoder = response.json()["tracker"]["decoder"]
        
        # Check required fields
        assert "total_requests" in decoder, "Missing total_requests"
        assert "independence_score" in decoder, "Missing independence_score"
        assert "sources" in decoder, "Missing sources"
        assert "by_path" in decoder, "Missing by_path"
        assert "recent" in decoder, "Missing recent"
        
        # Validate independence_score is a number between 0-100
        score = decoder["independence_score"]
        assert isinstance(score, (int, float)), f"independence_score should be numeric, got {type(score)}"
        assert 0 <= score <= 100, f"independence_score should be 0-100, got {score}"
        
        print(f"✓ Decoder stats structure valid (independence_score: {score}%)")
    
    def test_decoder_sources_structure(self, admin_token):
        """Test decoder sources has all expected source types"""
        response = requests.get(
            f"{BASE_URL}/api/admin/system-stats",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        sources = response.json()["tracker"]["decoder"]["sources"]
        
        # Check all source types exist
        expected_sources = ["local_decoder", "p2fk_io", "cache_fresh", "cache_stale"]
        for src in expected_sources:
            assert src in sources, f"Missing source: {src}"
            src_data = sources[src]
            assert "total" in src_data, f"Missing total in {src}"
            assert "success" in src_data, f"Missing success in {src}"
            assert "fail" in src_data, f"Missing fail in {src}"
            assert "success_rate" in src_data, f"Missing success_rate in {src}"
            assert "avg_ms" in src_data, f"Missing avg_ms in {src}"
        
        print(f"✓ All decoder sources present: {list(sources.keys())}")
    
    def test_decoder_by_path_structure(self, admin_token):
        """Test decoder by_path has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/admin/system-stats",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        by_path = response.json()["tracker"]["decoder"]["by_path"]
        
        # by_path should be a dict
        assert isinstance(by_path, dict), f"by_path should be dict, got {type(by_path)}"
        
        # Each path should have source counts
        for path, sources in by_path.items():
            assert isinstance(sources, dict), f"Path {path} sources should be dict"
            for src, count in sources.items():
                assert isinstance(count, int), f"Count for {path}/{src} should be int"
        
        print(f"✓ Decoder by_path structure valid ({len(by_path)} paths)")
    
    def test_decoder_recent_events(self, admin_token):
        """Test decoder recent events structure"""
        response = requests.get(
            f"{BASE_URL}/api/admin/system-stats",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        recent = response.json()["tracker"]["decoder"]["recent"]
        
        # recent should be a list
        assert isinstance(recent, list), f"recent should be list, got {type(recent)}"
        
        # Check structure of recent events (if any)
        if len(recent) > 0:
            event = recent[0]
            assert "path" in event, "Missing path in recent event"
            assert "source" in event, "Missing source in recent event"
            assert "ms" in event, "Missing ms in recent event"
            assert "ok" in event, "Missing ok in recent event"
            assert "ts" in event, "Missing ts in recent event"
        
        print(f"✓ Decoder recent events valid ({len(recent)} events)")


class TestRegressionChecks:
    """Regression tests for existing functionality"""
    
    def test_feed_endpoint(self):
        """Test feed endpoint still works"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet")
        assert response.status_code == 200, f"Feed failed: {response.text}"
        data = response.json()
        assert "messages" in data or "posts" in data or "count" in data, "Feed response missing expected fields"
        print(f"✓ Feed endpoint working")
    
    def test_p2fk_node_status(self):
        """Test P2FK local node status endpoint"""
        response = requests.get(f"{BASE_URL}/api/p2fk-local/node/status")
        assert response.status_code == 200, f"Node status failed: {response.text}"
        data = response.json()
        assert "connected" in data, "Missing connected field"
        assert "configured" in data, "Missing configured field"
        print(f"✓ P2FK node status endpoint working (connected: {data.get('connected')})")
    
    def test_health_endpoint(self):
        """Test health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        print(f"✓ Health endpoint working")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
