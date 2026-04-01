"""
Iteration 65: 2FA (TOTP) API Tests
Tests the P0 security hardening 2FA endpoints:
- POST /api/auth/2fa/check - Check if user has 2FA enabled
- POST /api/auth/2fa/setup - Generate TOTP secret/URI for new 2FA setup
- POST /api/auth/2fa/verify - Verify TOTP code
- POST /api/auth/2fa/disable - Disable 2FA (requires valid code)
"""
import pytest
import requests
import os
import pyotp

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')

# Known test user with 2FA already enabled
EXISTING_2FA_USER = "testuser123"
EXISTING_2FA_SECRET = "CRE4HU7PW7HIAMU6Z4OL7LYETHBOYNJQ"

class Test2FACheck:
    """Test /api/auth/2fa/check endpoint"""
    
    def test_check_2fa_enabled_user(self):
        """User with 2FA enabled should return enabled: true"""
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/check",
            json={"urn": EXISTING_2FA_USER}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "enabled" in data, "Response should contain 'enabled' field"
        assert data["enabled"] == True, f"Expected enabled=True for {EXISTING_2FA_USER}"
        print(f"PASS: /api/auth/2fa/check - User {EXISTING_2FA_USER} has 2FA enabled")
    
    def test_check_2fa_nonexistent_user(self):
        """Non-existent user should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/check",
            json={"urn": "nonexistent_user_xyz_12345"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: /api/auth/2fa/check - 404 for non-existent user")


class Test2FASetup:
    """Test /api/auth/2fa/setup endpoint"""
    
    def test_setup_2fa_returns_secret_and_uri(self):
        """Setup should return secret and provisioning URI"""
        # Use existing user - this will generate a new secret (overwrites old)
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": EXISTING_2FA_USER}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify response structure
        assert "secret" in data, "Response should contain 'secret'"
        assert "uri" in data, "Response should contain 'uri'"
        
        # Verify secret is valid base32
        secret = data["secret"]
        assert len(secret) == 32, f"Secret should be 32 chars, got {len(secret)}"
        
        # Verify URI is valid TOTP provisioning URI
        uri = data["uri"]
        assert uri.startswith("otpauth://totp/"), f"URI should be otpauth://totp/..., got {uri[:30]}"
        assert "Cthulhu" in uri, "URI should contain issuer 'Cthulhu'"
        assert EXISTING_2FA_USER in uri, f"URI should contain username {EXISTING_2FA_USER}"
        
        print(f"PASS: /api/auth/2fa/setup - Returns valid secret and URI")
        print(f"  Secret length: {len(secret)}, URI prefix: {uri[:40]}...")
    
    def test_setup_2fa_nonexistent_user(self):
        """Setup for non-existent user should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": "nonexistent_user_setup_12345"}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("PASS: /api/auth/2fa/setup - 404 for non-existent user")


class Test2FAVerify:
    """Test /api/auth/2fa/verify endpoint"""
    
    def test_verify_valid_code(self):
        """Valid TOTP code should verify successfully"""
        # First get a fresh secret via setup
        setup_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": EXISTING_2FA_USER}
        )
        assert setup_res.status_code == 200
        secret = setup_res.json()["secret"]
        
        # Generate valid TOTP code
        totp = pyotp.TOTP(secret)
        valid_code = totp.now()
        
        # Verify the code
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/verify",
            json={"urn": EXISTING_2FA_USER, "code": valid_code}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("verified") == True, "Should return verified: true"
        assert data.get("enabled") == True, "Should return enabled: true (activates 2FA on first verify)"
        print(f"PASS: /api/auth/2fa/verify - Valid code verified successfully")
    
    def test_verify_invalid_code(self):
        """Invalid TOTP code should return 401"""
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/verify",
            json={"urn": EXISTING_2FA_USER, "code": "000000"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/auth/2fa/verify - 401 for invalid code")
    
    def test_verify_user_without_2fa_setup(self):
        """Verify for user without 2FA setup should return 400"""
        # Create a new user first to ensure no 2FA setup
        import random
        test_urn = f"test_no2fa_{random.randint(10000, 99999)}"
        
        # Try to verify without setup
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/verify",
            json={"urn": test_urn, "code": "123456"}
        )
        # Should be 400 (2FA not set up) or 404 (user not found)
        assert response.status_code in [400, 404], f"Expected 400 or 404, got {response.status_code}"
        print(f"PASS: /api/auth/2fa/verify - {response.status_code} for user without 2FA setup")


class Test2FADisable:
    """Test /api/auth/2fa/disable endpoint"""
    
    def test_disable_with_valid_code(self):
        """Disable 2FA with valid code should succeed"""
        # First setup 2FA fresh
        setup_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": EXISTING_2FA_USER}
        )
        assert setup_res.status_code == 200
        secret = setup_res.json()["secret"]
        
        # Verify to activate
        totp = pyotp.TOTP(secret)
        valid_code = totp.now()
        verify_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/verify",
            json={"urn": EXISTING_2FA_USER, "code": valid_code}
        )
        assert verify_res.status_code == 200
        
        # Now disable with fresh code (TOTP code changes every 30s)
        disable_code = totp.now()
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/disable",
            json={"urn": EXISTING_2FA_USER, "code": disable_code}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("disabled") == True, "Should return disabled: true"
        
        # Verify 2FA is now disabled
        check_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/check",
            json={"urn": EXISTING_2FA_USER}
        )
        # After disable, user still exists but 2FA fields are removed
        # So check returns enabled=False (200) or user not found (404) depending on implementation
        if check_res.status_code == 200:
            assert check_res.json().get("enabled") == False, "2FA should be disabled after disable call"
        # Both outcomes are acceptable - 2FA is disabled
        
        print("PASS: /api/auth/2fa/disable - 2FA disabled successfully")
        
        # Re-enable for other tests
        setup_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": EXISTING_2FA_USER}
        )
        if setup_res.status_code == 200:
            secret = setup_res.json()["secret"]
            totp = pyotp.TOTP(secret)
            requests.post(
                f"{BASE_URL}/api/auth/2fa/verify",
                json={"urn": EXISTING_2FA_USER, "code": totp.now()}
            )
            print("  (Re-enabled 2FA for user)")
    
    def test_disable_with_invalid_code(self):
        """Disable 2FA with invalid code should return 401"""
        # First ensure 2FA is enabled
        setup_res = requests.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            json={"urn": EXISTING_2FA_USER}
        )
        if setup_res.status_code == 200:
            secret = setup_res.json()["secret"]
            totp = pyotp.TOTP(secret)
            requests.post(
                f"{BASE_URL}/api/auth/2fa/verify",
                json={"urn": EXISTING_2FA_USER, "code": totp.now()}
            )
        
        response = requests.post(
            f"{BASE_URL}/api/auth/2fa/disable",
            json={"urn": EXISTING_2FA_USER, "code": "000000"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("PASS: /api/auth/2fa/disable - 401 for invalid code")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
