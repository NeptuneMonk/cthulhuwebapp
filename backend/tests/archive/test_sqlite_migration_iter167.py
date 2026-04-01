"""
Backend API Tests for SQLite Migration (Iteration 167)
Tests all critical endpoints after MongoDB to SQLite migration.
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Admin credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"
WALLET_PASSWORD = "walletpass123"


class TestHealthAndBasicEndpoints:
    """Test health check and basic API endpoints"""
    
    def test_health_check(self):
        """Health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"Health check passed: {data}")
    
    def test_feed_btc_testnet(self):
        """Feed endpoint returns data for btc-testnet"""
        response = requests.get(f"{BASE_URL}/api/feed/btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert "feed" in data
        assert "network" in data
        assert data["network"] == "btc-testnet"
        assert isinstance(data["feed"], list)
        print(f"Feed returned {len(data['feed'])} items")
    
    def test_treasury_info(self):
        """Treasury info endpoint works"""
        response = requests.get(f"{BASE_URL}/api/treasury/info")
        assert response.status_code == 200
        data = response.json()
        assert "network" in data
        assert "tax_rate" in data
        print(f"Treasury info: {data}")
    
    def test_profile_endpoint(self):
        """Profile endpoint returns user data"""
        address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/profile/{address}?network=btc-testnet")
        assert response.status_code == 200
        data = response.json()
        assert data.get("address") == address
        assert "urn" in data
        print(f"Profile for {address}: urn={data.get('urn')}")
    
    def test_search_endpoint(self):
        """Search endpoint works"""
        response = requests.post(
            f"{BASE_URL}/api/search",
            json={"query": "test", "network": "btc-testnet"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "profiles" in data or "posts" in data or "objects" in data
        print(f"Search returned profiles: {len(data.get('profiles', []))}, posts: {len(data.get('posts', []))}")


class TestAdminAuth:
    """Test admin authentication"""
    
    def test_admin_login_success(self):
        """Admin login with correct credentials"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data.get("username") == ADMIN_USERNAME
        print(f"Admin login successful, token received")
        return data["token"]
    
    def test_admin_login_wrong_password(self):
        """Admin login fails with wrong password"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": "wrongpassword"}
        )
        assert response.status_code in [401, 403]
        print("Admin login correctly rejected wrong password")


class TestAdminWallet:
    """Test admin wallet endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
        )
        if response.status_code == 200:
            return response.json()["token"]
        pytest.skip("Admin login failed")
    
    def test_wallet_status_requires_auth(self):
        """Wallet status requires authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/status")
        assert response.status_code in [401, 403]
        print("Wallet status correctly requires auth")
    
    def test_wallet_status(self, admin_token):
        """Wallet status endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/status",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        # After SQLite migration, wallet may not be initialized
        assert "initialized" in data
        print(f"Wallet status: initialized={data.get('initialized')}")
    
    def test_wallet_addresses_requires_auth(self):
        """Wallet addresses requires authentication"""
        response = requests.get(f"{BASE_URL}/api/admin/wallet/addresses")
        assert response.status_code in [401, 403]
        print("Wallet addresses correctly requires auth")
    
    def test_wallet_addresses(self, admin_token):
        """Wallet addresses endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/admin/wallet/addresses",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "addresses" in data
        print(f"Wallet has {len(data['addresses'])} addresses")
    
    def test_wallet_init_when_not_initialized(self, admin_token):
        """Test wallet initialization (only if not already initialized)"""
        # First check status
        status_response = requests.get(
            f"{BASE_URL}/api/admin/wallet/status",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        status = status_response.json()
        
        if status.get("initialized"):
            # Already initialized, test that re-init fails
            response = requests.post(
                f"{BASE_URL}/api/admin/wallet/init",
                json={"password": WALLET_PASSWORD, "network": "btc-testnet"},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 400
            print("Wallet already initialized, re-init correctly rejected")
        else:
            # Not initialized, initialize it
            response = requests.post(
                f"{BASE_URL}/api/admin/wallet/init",
                json={"password": WALLET_PASSWORD, "network": "btc-testnet", "import_treasury": True},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            data = response.json()
            assert data.get("success") == True
            assert data.get("address_count") == 50
            print(f"Wallet initialized with {data.get('address_count')} addresses")
    
    def test_wallet_unlock(self, admin_token):
        """Test wallet unlock with correct password"""
        # First check if wallet is initialized
        status_response = requests.get(
            f"{BASE_URL}/api/admin/wallet/status",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if not status_response.json().get("initialized"):
            pytest.skip("Wallet not initialized")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/unlock",
            json={"password": WALLET_PASSWORD},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert "session_id" in data
        print(f"Wallet unlocked, key_count={data.get('key_count')}")
    
    def test_wallet_unlock_wrong_password(self, admin_token):
        """Test wallet unlock with wrong password"""
        status_response = requests.get(
            f"{BASE_URL}/api/admin/wallet/status",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if not status_response.json().get("initialized"):
            pytest.skip("Wallet not initialized")
        
        response = requests.post(
            f"{BASE_URL}/api/admin/wallet/unlock",
            json={"password": "wrongpassword"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 403
        print("Wallet unlock correctly rejected wrong password")


class TestObjEtch:
    """Test OBJ etch endpoint"""
    
    def test_obj_etch_requires_ipfs_cid(self):
        """OBJ etch requires IPFS CID"""
        response = requests.post(
            f"{BASE_URL}/api/etch/broadcast-obj-etch",
            json={
                "urn": "TEST_iter167",
                "name": "Test Object",
                "description": "Test description",
                "network": "btc-testnet"
            }
        )
        # Should fail without ipfs_cid
        assert response.status_code in [400, 422]
        print("OBJ etch correctly requires IPFS CID")


class TestSQLiteSpecific:
    """Tests specific to SQLite migration"""
    
    def test_sqlite_db_exists(self):
        """SQLite database file exists"""
        import os
        db_path = "/app/backend/cthulhu.db"
        assert os.path.exists(db_path), f"SQLite DB not found at {db_path}"
        size = os.path.getsize(db_path)
        print(f"SQLite DB exists, size: {size / 1024 / 1024:.2f} MB")
    
    def test_known_users_populated(self):
        """Known users are populated in SQLite"""
        import sqlite3
        conn = sqlite3.connect("/app/backend/cthulhu.db")
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM known_users")
        count = cursor.fetchone()[0]
        conn.close()
        assert count > 0, "No known users in SQLite"
        print(f"Known users count: {count}")
    
    def test_sqlite_tables_created(self):
        """All required tables exist in SQLite"""
        import sqlite3
        conn = sqlite3.connect("/app/backend/cthulhu.db")
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cursor.fetchall()]
        conn.close()
        
        required_tables = ['known_users', 'users', 'conversation_cache', 'object_cache']
        for table in required_tables:
            assert table in tables, f"Required table {table} not found"
        print(f"All required tables exist: {tables}")


class TestWebSocketEndpoints:
    """Test WebSocket-related endpoints (HTTP parts only)"""
    
    def test_chat_unread(self):
        """Chat unread endpoint works"""
        address = "mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"
        response = requests.get(f"{BASE_URL}/api/chat/unread/{address}")
        assert response.status_code == 200
        print(f"Chat unread endpoint works")
    
    def test_mesh_stats(self):
        """Mesh stats endpoint works"""
        response = requests.get(f"{BASE_URL}/api/mesh/stats?network=btc-testnet")
        assert response.status_code == 200
        print(f"Mesh stats endpoint works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
