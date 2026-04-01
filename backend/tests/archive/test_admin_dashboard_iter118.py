"""
Test Admin Dashboard API Endpoints - Iteration 118
Tests for:
- Admin login with correct/incorrect credentials
- Admin settings GET/PUT (faucet_amount=100000, tax_rate=0.02)
- Bug reports submission (public) and retrieval (admin)
- Admin response to bug reports
- Error logs retrieval
- Dashboard stats
- Change password
- Public keys endpoint
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
ADMIN_API = f"{BASE_URL}/api/admin"

# Admin credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"


class TestAdminLogin:
    """Test admin authentication endpoints"""
    
    def test_admin_login_success(self):
        """Test successful admin login with correct credentials"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data, "Response should contain token"
        assert "username" in data, "Response should contain username"
        assert data["username"] == ADMIN_USERNAME
        print(f"✓ Admin login successful, token received")
        return data["token"]
    
    def test_admin_login_invalid_username(self):
        """Test login with invalid username"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": "WrongAdmin",
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Invalid username correctly rejected with 401")
    
    def test_admin_login_invalid_password(self):
        """Test login with invalid password"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": "WrongPassword"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Invalid password correctly rejected with 401")


class TestAdminSettings:
    """Test admin settings endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed - skipping authenticated tests")
        return response.json()["token"]
    
    def test_get_settings_requires_auth(self):
        """Test that settings endpoint requires authentication"""
        response = requests.get(f"{ADMIN_API}/settings")
        assert response.status_code == 403 or response.status_code == 401, \
            f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ Settings endpoint correctly requires authentication")
    
    def test_get_settings_with_auth(self, admin_token):
        """Test getting settings with valid admin token"""
        response = requests.get(f"{ADMIN_API}/settings", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify expected settings structure
        assert "faucet_amount" in data, "Settings should contain faucet_amount"
        assert "tax_rate" in data, "Settings should contain tax_rate"
        assert "treasury_addresses" in data, "Settings should contain treasury_addresses"
        
        # Verify default values as per requirements
        assert data["faucet_amount"] == 100000, f"faucet_amount should be 100000, got {data['faucet_amount']}"
        assert data["tax_rate"] == 0.02, f"tax_rate should be 0.02, got {data['tax_rate']}"
        
        print(f"✓ Settings retrieved: faucet_amount={data['faucet_amount']}, tax_rate={data['tax_rate']}")
    
    def test_update_settings(self, admin_token):
        """Test updating settings"""
        # First get current settings
        get_response = requests.get(f"{ADMIN_API}/settings", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        original_settings = get_response.json()
        
        # Update settings
        new_faucet = 150000
        response = requests.put(f"{ADMIN_API}/settings", 
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"faucet_amount": new_faucet}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["faucet_amount"] == new_faucet, f"faucet_amount should be {new_faucet}"
        
        # Restore original settings
        requests.put(f"{ADMIN_API}/settings",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"faucet_amount": original_settings["faucet_amount"]}
        )
        print(f"✓ Settings update works correctly")


class TestBugReports:
    """Test bug report submission and management"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed - skipping authenticated tests")
        return response.json()["token"]
    
    def test_submit_bug_report_public(self):
        """Test submitting a bug report (public endpoint)"""
        test_subject = f"TEST_Bug_Report_{int(time.time())}"
        test_message = "This is a test bug report for iteration 118 testing"
        test_address = "tb1qtest123456789"
        
        response = requests.post(f"{ADMIN_API}/reports", json={
            "subject": test_subject,
            "message": test_message,
            "user_address": test_address,
            "user_urn": "test_user"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Response should indicate success"
        assert "report_id" in data, "Response should contain report_id"
        print(f"✓ Bug report submitted successfully, ID: {data['report_id']}")
        return data["report_id"]
    
    def test_get_reports_requires_auth(self):
        """Test that getting reports requires admin auth"""
        response = requests.get(f"{ADMIN_API}/reports")
        assert response.status_code in [401, 403], \
            f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ Reports endpoint correctly requires authentication")
    
    def test_get_reports_with_auth(self, admin_token):
        """Test getting reports with admin token"""
        response = requests.get(f"{ADMIN_API}/reports", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "reports" in data, "Response should contain reports array"
        assert "total" in data, "Response should contain total count"
        print(f"✓ Retrieved {len(data['reports'])} reports (total: {data['total']})")
    
    def test_respond_to_report(self, admin_token):
        """Test admin responding to a bug report"""
        # First submit a report
        test_subject = f"TEST_Response_Report_{int(time.time())}"
        submit_response = requests.post(f"{ADMIN_API}/reports", json={
            "subject": test_subject,
            "message": "Test report for response testing",
            "user_address": "tb1qresponsetest"
        })
        report_id = submit_response.json()["report_id"]
        
        # Respond to the report
        admin_response_text = "Thank you for your report. We are looking into it."
        response = requests.put(f"{ADMIN_API}/reports/{report_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "response": admin_response_text,
                "status": "responded"
            }
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("success") == True, "Response should indicate success"
        print(f"✓ Admin response to report {report_id} successful")
    
    def test_get_my_reports(self):
        """Test user getting their own reports"""
        test_address = f"tb1qmyreports{int(time.time())}"
        
        # Submit a report first
        requests.post(f"{ADMIN_API}/reports", json={
            "subject": "My test report",
            "message": "Testing my-reports endpoint",
            "user_address": test_address
        })
        
        # Get my reports
        response = requests.get(f"{ADMIN_API}/my-reports/{test_address}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "reports" in data, "Response should contain reports array"
        print(f"✓ User reports endpoint works, found {len(data['reports'])} reports")


class TestErrorLogs:
    """Test error logs endpoints"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed - skipping authenticated tests")
        return response.json()["token"]
    
    def test_get_errors_requires_auth(self):
        """Test that error logs require authentication"""
        response = requests.get(f"{ADMIN_API}/errors")
        assert response.status_code in [401, 403], \
            f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ Error logs endpoint correctly requires authentication")
    
    def test_get_errors_with_auth(self, admin_token):
        """Test getting error logs with admin token"""
        response = requests.get(f"{ADMIN_API}/errors", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "logs" in data, "Response should contain logs array"
        assert "total" in data, "Response should contain total count"
        print(f"✓ Retrieved {len(data['logs'])} error logs (total: {data['total']})")


class TestDashboardStats:
    """Test dashboard stats endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed - skipping authenticated tests")
        return response.json()["token"]
    
    def test_get_stats_requires_auth(self):
        """Test that stats require authentication"""
        response = requests.get(f"{ADMIN_API}/stats")
        assert response.status_code in [401, 403], \
            f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ Stats endpoint correctly requires authentication")
    
    def test_get_stats_with_auth(self, admin_token):
        """Test getting dashboard stats with admin token"""
        response = requests.get(f"{ADMIN_API}/stats", headers={
            "Authorization": f"Bearer {admin_token}"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify expected stats fields
        assert "users" in data, "Stats should contain users count"
        assert "open_reports" in data, "Stats should contain open_reports count"
        assert "total_reports" in data, "Stats should contain total_reports count"
        assert "error_count" in data, "Stats should contain error_count"
        
        print(f"✓ Dashboard stats: users={data['users']}, open_reports={data['open_reports']}, total_reports={data['total_reports']}, errors={data['error_count']}")


class TestPublicKeys:
    """Test public keys endpoint (no auth required)"""
    
    def test_get_public_keys(self):
        """Test getting admin public keys (public endpoint)"""
        response = requests.get(f"{ADMIN_API}/public-keys")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Keys may be empty but should exist in response
        assert "admin_pkx" in data, "Response should contain admin_pkx"
        assert "admin_pky" in data, "Response should contain admin_pky"
        print(f"✓ Public keys endpoint works, PKX: {data['admin_pkx'][:20] if data['admin_pkx'] else 'empty'}...")


class TestChangePassword:
    """Test change password endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin token for authenticated requests"""
        response = requests.post(f"{ADMIN_API}/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Admin login failed - skipping authenticated tests")
        return response.json()["token"]
    
    def test_change_password_wrong_current(self, admin_token):
        """Test change password with wrong current password"""
        response = requests.post(f"{ADMIN_API}/change-password",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "current_password": "WrongPassword",
                "new_password": "NewPassword123"
            }
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print(f"✓ Change password correctly rejects wrong current password")
    
    def test_change_password_requires_auth(self):
        """Test that change password requires authentication"""
        response = requests.post(f"{ADMIN_API}/change-password", json={
            "current_password": ADMIN_PASSWORD,
            "new_password": "NewPassword123"
        })
        assert response.status_code in [401, 403], \
            f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ Change password endpoint correctly requires authentication")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
