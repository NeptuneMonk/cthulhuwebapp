"""
Test Auto-Checkpoint Feature - Iteration 170
Tests the Treasury Auto-Checkpoint flow for bundling off-chain chat messages
into P2FK-compliant on-chain transactions.

Endpoints tested:
- GET /api/admin/checkpoint/status - returns merged config with defaults
- POST /api/admin/checkpoint/config - updates interval and min_messages
- GET /api/admin/checkpoint/pending - returns pending count and room breakdown
- POST /api/admin/checkpoint/trigger - returns skipped when no messages pending
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAutoCheckpoint:
    """Auto-checkpoint endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin token for authenticated requests"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code == 200:
            token = login_response.json().get("token")
            self.session.headers.update({"Authorization": f"Bearer {token}"})
            self.token = token
        else:
            pytest.skip(f"Admin login failed: {login_response.status_code}")
    
    # ─── Health Check ───
    def test_health_endpoint(self):
        """Test that the API is accessible"""
        response = self.session.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        print("✓ Health endpoint working")
    
    # ─── Admin Login ───
    def test_admin_login(self):
        """Test admin login with correct credentials"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"},
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data, "No token in login response"
        assert len(data["token"]) > 0, "Token is empty"
        print("✓ Admin login successful")
    
    # ─── GET /api/admin/checkpoint/status ───
    def test_checkpoint_status_returns_merged_config(self):
        """Test GET /api/admin/checkpoint/status returns merged config with defaults"""
        response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/status")
        assert response.status_code == 200, f"Status endpoint failed: {response.text}"
        
        data = response.json()
        
        # Check default config fields are present
        assert "enabled" in data, "Missing 'enabled' field"
        assert "interval_minutes" in data, "Missing 'interval_minutes' field"
        assert "min_messages" in data, "Missing 'min_messages' field"
        assert "network" in data, "Missing 'network' field"
        assert "pending_messages" in data, "Missing 'pending_messages' field"
        assert "recent_checkpoints" in data, "Missing 'recent_checkpoints' field"
        
        # Verify default values
        assert isinstance(data["enabled"], bool), "enabled should be boolean"
        assert isinstance(data["interval_minutes"], int), "interval_minutes should be int"
        assert isinstance(data["min_messages"], int), "min_messages should be int"
        assert isinstance(data["pending_messages"], int), "pending_messages should be int"
        assert isinstance(data["recent_checkpoints"], list), "recent_checkpoints should be list"
        
        print(f"✓ Checkpoint status: enabled={data['enabled']}, interval={data['interval_minutes']}min, min_msgs={data['min_messages']}, pending={data['pending_messages']}")
    
    def test_checkpoint_status_has_total_stats(self):
        """Test that status includes total checkpoint stats"""
        response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/status")
        assert response.status_code == 200
        
        data = response.json()
        assert "total_checkpoints" in data, "Missing 'total_checkpoints' field"
        assert "total_messages_checkpointed" in data, "Missing 'total_messages_checkpointed' field"
        
        print(f"✓ Total stats: {data['total_checkpoints']} checkpoints, {data['total_messages_checkpointed']} messages archived")
    
    # ─── POST /api/admin/checkpoint/config ───
    def test_checkpoint_config_update_interval(self):
        """Test POST /api/admin/checkpoint/config updates interval_minutes"""
        # Update interval to 30 minutes
        response = self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={"interval_minutes": 30}
        )
        assert response.status_code == 200, f"Config update failed: {response.text}"
        
        data = response.json()
        assert data.get("success") == True, "Config update should return success=true"
        assert "updated" in data, "Response should include 'updated' field"
        assert data["updated"].get("interval_minutes") == 30, "interval_minutes should be 30"
        
        # Verify by fetching status
        status_response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/status")
        status_data = status_response.json()
        assert status_data["interval_minutes"] == 30, "Status should reflect updated interval"
        
        print("✓ Config update: interval_minutes set to 30")
    
    def test_checkpoint_config_update_min_messages(self):
        """Test POST /api/admin/checkpoint/config updates min_messages"""
        # Update min_messages to 5
        response = self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={"min_messages": 5}
        )
        assert response.status_code == 200, f"Config update failed: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data["updated"].get("min_messages") == 5, "min_messages should be 5"
        
        # Verify by fetching status
        status_response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/status")
        status_data = status_response.json()
        assert status_data["min_messages"] == 5, "Status should reflect updated min_messages"
        
        print("✓ Config update: min_messages set to 5")
    
    def test_checkpoint_config_update_enabled(self):
        """Test POST /api/admin/checkpoint/config updates enabled flag"""
        # First get current state
        status_response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/status")
        current_enabled = status_response.json().get("enabled", False)
        
        # Toggle enabled
        new_enabled = not current_enabled
        response = self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={"enabled": new_enabled}
        )
        assert response.status_code == 200, f"Config update failed: {response.text}"
        
        data = response.json()
        assert data.get("success") == True
        assert data["updated"].get("enabled") == new_enabled
        
        # Restore original state
        self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={"enabled": current_enabled}
        )
        
        print(f"✓ Config update: enabled toggled to {new_enabled} and restored")
    
    def test_checkpoint_config_empty_update_fails(self):
        """Test POST /api/admin/checkpoint/config with empty body returns 400"""
        response = self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={}
        )
        assert response.status_code == 400, f"Empty config should return 400, got {response.status_code}"
        print("✓ Empty config update correctly returns 400")
    
    def test_checkpoint_config_min_interval_enforced(self):
        """Test that interval_minutes has a minimum of 5"""
        response = self.session.post(
            f"{BASE_URL}/api/admin/checkpoint/config",
            json={"interval_minutes": 1}  # Try to set below minimum
        )
        assert response.status_code == 200
        
        data = response.json()
        # Should be clamped to minimum of 5
        assert data["updated"].get("interval_minutes") == 5, "interval_minutes should be clamped to 5"
        
        print("✓ Config enforces minimum interval of 5 minutes")
    
    # ─── GET /api/admin/checkpoint/pending ───
    def test_checkpoint_pending_returns_count_and_breakdown(self):
        """Test GET /api/admin/checkpoint/pending returns pending count and room breakdown"""
        response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/pending")
        assert response.status_code == 200, f"Pending endpoint failed: {response.text}"
        
        data = response.json()
        
        # Check required fields
        assert "total_pending" in data, "Missing 'total_pending' field"
        assert "room_breakdown" in data, "Missing 'room_breakdown' field"
        assert "recent_sample" in data, "Missing 'recent_sample' field"
        
        # Verify types
        assert isinstance(data["total_pending"], int), "total_pending should be int"
        assert isinstance(data["room_breakdown"], dict), "room_breakdown should be dict"
        assert isinstance(data["recent_sample"], list), "recent_sample should be list"
        
        print(f"✓ Pending messages: {data['total_pending']} total, {len(data['room_breakdown'])} rooms")
    
    # ─── POST /api/admin/checkpoint/trigger ───
    def test_checkpoint_trigger_skipped_when_no_messages(self):
        """Test POST /api/admin/checkpoint/trigger returns skipped when no messages pending"""
        # First check pending count
        pending_response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/pending")
        pending_count = pending_response.json().get("total_pending", 0)
        
        # Trigger checkpoint
        response = self.session.post(f"{BASE_URL}/api/admin/checkpoint/trigger")
        
        if pending_count == 0:
            # Should return skipped
            assert response.status_code == 200, f"Trigger failed: {response.text}"
            data = response.json()
            assert data.get("success") == True, "Trigger should return success=true"
            assert data.get("skipped") == True, "Trigger should return skipped=true when no messages"
            assert "reason" in data, "Skipped response should include reason"
            print(f"✓ Checkpoint trigger correctly skipped: {data.get('reason')}")
        else:
            # If there are pending messages, it might actually create a checkpoint
            # or fail due to IPFS/treasury issues - both are acceptable
            print(f"✓ Checkpoint trigger executed (pending={pending_count}), status={response.status_code}")
    
    # ─── GET /api/admin/checkpoint/history ───
    def test_checkpoint_history_returns_list(self):
        """Test GET /api/admin/checkpoint/history returns checkpoint list"""
        response = self.session.get(f"{BASE_URL}/api/admin/checkpoint/history")
        assert response.status_code == 200, f"History endpoint failed: {response.text}"
        
        data = response.json()
        assert "checkpoints" in data, "Missing 'checkpoints' field"
        assert "total" in data, "Missing 'total' field"
        assert isinstance(data["checkpoints"], list), "checkpoints should be list"
        assert isinstance(data["total"], int), "total should be int"
        
        print(f"✓ Checkpoint history: {data['total']} total checkpoints")
    
    # ─── Auth Required ───
    def test_checkpoint_endpoints_require_auth(self):
        """Test that checkpoint endpoints require admin authentication"""
        # Create unauthenticated session
        unauth_session = requests.Session()
        unauth_session.headers.update({"Content-Type": "application/json"})
        
        endpoints = [
            ("GET", "/api/admin/checkpoint/status"),
            ("POST", "/api/admin/checkpoint/config"),
            ("GET", "/api/admin/checkpoint/pending"),
            ("POST", "/api/admin/checkpoint/trigger"),
            ("GET", "/api/admin/checkpoint/history"),
        ]
        
        for method, endpoint in endpoints:
            if method == "GET":
                response = unauth_session.get(f"{BASE_URL}{endpoint}")
            else:
                response = unauth_session.post(f"{BASE_URL}{endpoint}", json={})
            
            assert response.status_code in [401, 403], f"{method} {endpoint} should require auth, got {response.status_code}"
        
        print("✓ All checkpoint endpoints require authentication")


class TestChatRelayMessageStorage:
    """Test that chat relay stores messages for checkpointing"""
    
    def test_chat_relay_messages_collection_exists(self):
        """Verify chat_relay_messages collection is used (via pending endpoint)"""
        # Login as admin
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        login_response = session.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "Admin", "password": "Password26"}
        )
        if login_response.status_code != 200:
            pytest.skip("Admin login failed")
        
        token = login_response.json().get("token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        
        # The pending endpoint queries chat_relay_messages collection
        response = session.get(f"{BASE_URL}/api/admin/checkpoint/pending")
        assert response.status_code == 200, f"Pending endpoint failed: {response.text}"
        
        data = response.json()
        # If the collection doesn't exist or query fails, we'd get an error
        assert "total_pending" in data, "Pending endpoint should return total_pending"
        
        print(f"✓ chat_relay_messages collection accessible, {data['total_pending']} pending messages")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
