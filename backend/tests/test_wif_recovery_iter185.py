"""
Test WIF Recovery Feature - Iteration 185
Tests the Admin Credential Recovery via WIF feature:
- POST /api/admin/login with credentials Admin/Password26
- POST /api/admin/set-recovery-address (authenticated) - set a recovery BTC testnet address
- GET /api/admin/recovery-address (authenticated) - returns the currently set recovery address
- GET /api/admin/recovery-challenge (public, no auth) - returns a challenge string and masked address
- POST /api/admin/recover-with-wif (public) - accepts WIF + challenge + new credentials
- Verify login works with new credentials after recovery
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_USERNAME = "Admin"
ADMIN_PASSWORD = "Password26"

# Test WIF for BTC testnet
TEST_WIF = "cP2TvvMNpTpfgFMUQdwr2X3bQLdqtxKamWHTXCLSpFfRMTpbaff1"
TEST_ADDRESS = "mmYScpmRkA4DwuTj1kc4mjtLUJpdSZNQm8"


class TestAdminLogin:
    """Test admin login endpoint"""
    
    def test_01_login_with_valid_credentials(self):
        """Test login with Admin/Password26"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        print(f"Login response status: {response.status_code}")
        print(f"Login response: {response.text[:500]}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "token" in data, "Response should contain token"
        assert "username" in data, "Response should contain username"
        assert data["username"] == ADMIN_USERNAME
    
    def test_02_login_with_invalid_credentials(self):
        """Test login with wrong password"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": ADMIN_USERNAME,
            "password": "WrongPassword"
        })
        assert response.status_code == 401


class TestRecoveryAddressEndpoints:
    """Test recovery address management endpoints (authenticated)"""
    
    @pytest.fixture
    def auth_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip(f"Could not login: {response.text}")
        return response.json()["token"]
    
    def test_01_get_recovery_address(self, auth_token):
        """GET /api/admin/recovery-address - should return current recovery address"""
        response = requests.get(
            f"{BASE_URL}/api/admin/recovery-address",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        print(f"Get recovery address status: {response.status_code}")
        print(f"Get recovery address response: {response.text}")
        
        assert response.status_code == 200
        data = response.json()
        assert "recovery_address" in data
        assert "is_set" in data
        # The address should already be set to TEST_ADDRESS per the test context
        if data["is_set"]:
            print(f"Recovery address is set to: {data['recovery_address']}")
    
    def test_02_set_recovery_address(self, auth_token):
        """POST /api/admin/set-recovery-address - set recovery address"""
        response = requests.post(
            f"{BASE_URL}/api/admin/set-recovery-address",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"address": TEST_ADDRESS}
        )
        print(f"Set recovery address status: {response.status_code}")
        print(f"Set recovery address response: {response.text}")
        
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert data.get("recovery_address") == TEST_ADDRESS
    
    def test_03_verify_recovery_address_persisted(self, auth_token):
        """Verify the recovery address was persisted"""
        response = requests.get(
            f"{BASE_URL}/api/admin/recovery-address",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_set"] == True
        assert data["recovery_address"] == TEST_ADDRESS
    
    def test_04_set_recovery_address_requires_auth(self):
        """POST /api/admin/set-recovery-address without auth should fail"""
        response = requests.post(
            f"{BASE_URL}/api/admin/set-recovery-address",
            json={"address": TEST_ADDRESS}
        )
        assert response.status_code in [401, 403]
    
    def test_05_get_recovery_address_requires_auth(self):
        """GET /api/admin/recovery-address without auth should fail"""
        response = requests.get(f"{BASE_URL}/api/admin/recovery-address")
        assert response.status_code in [401, 403]


class TestRecoveryChallengeEndpoint:
    """Test the public recovery challenge endpoint"""
    
    def test_01_get_recovery_challenge_public(self):
        """GET /api/admin/recovery-challenge - public endpoint, no auth required"""
        response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        print(f"Recovery challenge status: {response.status_code}")
        print(f"Recovery challenge response: {response.text}")
        
        # Should return 200 if recovery address is set, 404 if not
        if response.status_code == 404:
            data = response.json()
            assert "No recovery address" in data.get("detail", "")
            pytest.skip("No recovery address configured - expected if not set")
        
        assert response.status_code == 200
        data = response.json()
        assert "challenge" in data, "Response should contain challenge"
        assert "masked_address" in data, "Response should contain masked_address"
        
        # Verify challenge is a hex string
        assert len(data["challenge"]) == 64, "Challenge should be 64 hex chars (32 bytes)"
        
        # Verify masked address format (first 6 chars ... last 6 chars)
        masked = data["masked_address"]
        assert "..." in masked, "Masked address should contain ..."
        print(f"Challenge: {data['challenge'][:20]}...")
        print(f"Masked address: {masked}")


class TestRecoverWithWIF:
    """Test the full WIF recovery flow"""
    
    def test_01_full_recovery_flow(self):
        """Test complete recovery: get challenge -> recover with WIF -> login with new creds"""
        # Step 1: Get challenge
        challenge_response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        print(f"Challenge response status: {challenge_response.status_code}")
        
        if challenge_response.status_code == 404:
            pytest.skip("No recovery address configured")
        
        assert challenge_response.status_code == 200
        challenge_data = challenge_response.json()
        challenge = challenge_data["challenge"]
        print(f"Got challenge: {challenge[:20]}...")
        
        # Step 2: Recover with WIF - use temporary credentials
        temp_username = "TempAdmin"
        temp_password = "TempPassword123"
        
        recover_response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": TEST_WIF,
                "challenge": challenge,
                "signature": "",  # Not used - WIF→address match is sufficient
                "new_username": temp_username,
                "new_password": temp_password
            }
        )
        print(f"Recover response status: {recover_response.status_code}")
        print(f"Recover response: {recover_response.text}")
        
        assert recover_response.status_code == 200, f"Recovery failed: {recover_response.text}"
        recover_data = recover_response.json()
        assert recover_data.get("success") == True
        
        # Step 3: Verify login with new credentials
        login_response = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": temp_username,
            "password": temp_password
        })
        print(f"Login with new creds status: {login_response.status_code}")
        
        assert login_response.status_code == 200, f"Login with new creds failed: {login_response.text}"
        login_data = login_response.json()
        assert "token" in login_data
        assert login_data["username"] == temp_username
        
        # Step 4: Reset credentials back to original (Admin/Password26)
        # Get a new challenge first
        challenge_response2 = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        assert challenge_response2.status_code == 200
        challenge2 = challenge_response2.json()["challenge"]
        
        reset_response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": TEST_WIF,
                "challenge": challenge2,
                "signature": "",
                "new_username": ADMIN_USERNAME,
                "new_password": ADMIN_PASSWORD
            }
        )
        print(f"Reset to original creds status: {reset_response.status_code}")
        assert reset_response.status_code == 200, f"Reset failed: {reset_response.text}"
        
        # Step 5: Verify original credentials work
        final_login = requests.post(f"{BASE_URL}/api/admin/login", json={
            "username": ADMIN_USERNAME,
            "password": ADMIN_PASSWORD
        })
        assert final_login.status_code == 200, "Original credentials should work after reset"
        print("SUCCESS: Full recovery flow completed and credentials reset to original")
    
    def test_02_recover_with_invalid_wif(self):
        """Test recovery with invalid WIF should fail"""
        # Get challenge first
        challenge_response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        if challenge_response.status_code == 404:
            pytest.skip("No recovery address configured")
        
        challenge = challenge_response.json()["challenge"]
        
        # Try with invalid WIF
        response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": "InvalidWIF123",
                "challenge": challenge,
                "signature": "",
                "new_username": "Hacker",
                "new_password": "HackerPass"
            }
        )
        print(f"Invalid WIF response: {response.status_code} - {response.text}")
        assert response.status_code == 400, "Invalid WIF should return 400"
    
    def test_03_recover_with_wrong_wif(self):
        """Test recovery with valid WIF but wrong address should fail"""
        # Get challenge first
        challenge_response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        if challenge_response.status_code == 404:
            pytest.skip("No recovery address configured")
        
        challenge = challenge_response.json()["challenge"]
        
        # Try with a different valid WIF (not matching recovery address)
        # This is a random testnet WIF that doesn't match TEST_ADDRESS
        wrong_wif = "cVkWbHmoCx6jS8AyPNQPvBZfJDKLfBYq3Lz8mWpqVfKvYWqVQABc"
        
        response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": wrong_wif,
                "challenge": challenge,
                "signature": "",
                "new_username": "Hacker",
                "new_password": "HackerPass"
            }
        )
        print(f"Wrong WIF response: {response.status_code} - {response.text}")
        # Should fail with 400 (invalid WIF format) or 403 (WIF doesn't match address)
        assert response.status_code in [400, 403], f"Wrong WIF should fail, got {response.status_code}"
    
    def test_04_recover_with_expired_challenge(self):
        """Test recovery with invalid/expired challenge should fail"""
        response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": TEST_WIF,
                "challenge": "0" * 64,  # Fake challenge
                "signature": "",
                "new_username": "Hacker",
                "new_password": "HackerPass"
            }
        )
        print(f"Expired challenge response: {response.status_code} - {response.text}")
        assert response.status_code == 400, "Invalid challenge should return 400"
    
    def test_05_recover_with_short_username(self):
        """Test recovery with username < 3 chars should fail"""
        # Get challenge first
        challenge_response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        if challenge_response.status_code == 404:
            pytest.skip("No recovery address configured")
        
        challenge = challenge_response.json()["challenge"]
        
        response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": TEST_WIF,
                "challenge": challenge,
                "signature": "",
                "new_username": "AB",  # Too short
                "new_password": "ValidPassword123"
            }
        )
        print(f"Short username response: {response.status_code} - {response.text}")
        assert response.status_code == 400, "Short username should return 400"
    
    def test_06_recover_with_short_password(self):
        """Test recovery with password < 6 chars should fail"""
        # Get challenge first
        challenge_response = requests.get(f"{BASE_URL}/api/admin/recovery-challenge")
        if challenge_response.status_code == 404:
            pytest.skip("No recovery address configured")
        
        challenge = challenge_response.json()["challenge"]
        
        response = requests.post(
            f"{BASE_URL}/api/admin/recover-with-wif",
            json={
                "wif": TEST_WIF,
                "challenge": challenge,
                "signature": "",
                "new_username": "ValidUser",
                "new_password": "12345"  # Too short
            }
        )
        print(f"Short password response: {response.status_code} - {response.text}")
        assert response.status_code == 400, "Short password should return 400"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
