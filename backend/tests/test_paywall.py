"""
Paywall API Tests - Testing the crypto paywall feature
Tests cover:
- GET /api/paywall/config - public config endpoint
- GET /api/paywall/status/{urn} - payment status check
- POST /api/paywall/request - payment request creation
- POST /api/paywall/admin/config - admin config update (requires admin)
- POST /api/paywall/admin/pending - list pending payments (requires admin)
- POST /api/paywall/admin/confirm - confirm payment (requires admin)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPaywallPublicEndpoints:
    """Public paywall endpoints - no auth required"""
    
    def test_get_paywall_config_returns_correct_structure(self):
        """GET /api/paywall/config returns default config when paywall disabled"""
        response = requests.get(f"{BASE_URL}/api/paywall/config")
        assert response.status_code == 200
        
        data = response.json()
        # Verify expected fields exist
        assert "enabled" in data
        assert "fee_usd" in data
        assert "treasury_addresses" in data
        
        # Verify default values when paywall is disabled
        assert data["enabled"] == False
        assert data["fee_usd"] == 5.00
        
        # Verify treasury_addresses structure
        assert isinstance(data["treasury_addresses"], dict)
        assert "btc" in data["treasury_addresses"]
        assert "ltc" in data["treasury_addresses"]
        assert "doge" in data["treasury_addresses"]
        
        print(f"✓ Paywall config returned: enabled={data['enabled']}, fee_usd={data['fee_usd']}")
    
    def test_paywall_status_returns_paid_when_disabled(self):
        """GET /api/paywall/status/{urn} returns paid:true when paywall is disabled"""
        test_urn = "test_user_12345"
        response = requests.get(f"{BASE_URL}/api/paywall/status/{test_urn}")
        assert response.status_code == 200
        
        data = response.json()
        assert "paid" in data
        assert "status" in data
        
        # When paywall is disabled, should return paid:true
        assert data["paid"] == True
        assert data["status"] == "paywall_disabled"
        
        print(f"✓ Status for URN '{test_urn}': paid={data['paid']}, status={data['status']}")
    
    def test_payment_request_when_paywall_disabled(self):
        """POST /api/paywall/request returns paywall_disabled when paywall is off"""
        payload = {
            "urn": "test_user_payment",
            "chain": "btc",
            "txid": "",
            "note": "Test payment"
        }
        response = requests.post(
            f"{BASE_URL}/api/paywall/request",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("status") == "paywall_disabled"
        
        print(f"✓ Payment request returned: status={data.get('status')}")


class TestPaywallAdminEndpoints:
    """Admin endpoints - require admin_urn parameter"""
    
    def test_admin_config_returns_403_for_non_admin(self):
        """POST /api/paywall/admin/config returns 403 for non-admin URN"""
        non_admin_urn = "random_non_admin_user"
        payload = {"enabled": True}
        
        response = requests.post(
            f"{BASE_URL}/api/paywall/admin/config?admin_urn={non_admin_urn}",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin config correctly rejected non-admin URN with 403")
    
    def test_admin_pending_returns_403_for_non_admin(self):
        """GET /api/paywall/admin/pending returns 403 for non-admin URN"""
        non_admin_urn = "random_non_admin_user"
        
        response = requests.get(
            f"{BASE_URL}/api/paywall/admin/pending?admin_urn={non_admin_urn}"
        )
        
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin pending correctly rejected non-admin URN with 403")
    
    def test_admin_confirm_returns_403_for_non_admin(self):
        """POST /api/paywall/admin/confirm returns 403 for non-admin URN"""
        non_admin_urn = "random_non_admin_user"
        payload = {"urn": "some_user"}
        
        response = requests.post(
            f"{BASE_URL}/api/paywall/admin/confirm?admin_urn={non_admin_urn}",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin confirm correctly rejected non-admin URN with 403")
    
    def test_admin_reject_returns_403_for_non_admin(self):
        """POST /api/paywall/admin/reject returns 403 for non-admin URN"""
        non_admin_urn = "random_non_admin_user"
        payload = {"urn": "some_user", "reason": "test"}
        
        response = requests.post(
            f"{BASE_URL}/api/paywall/admin/reject?admin_urn={non_admin_urn}",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin reject correctly rejected non-admin URN with 403")
    
    def test_admin_all_returns_403_for_non_admin(self):
        """GET /api/paywall/admin/all returns 403 for non-admin URN"""
        non_admin_urn = "random_non_admin_user"
        
        response = requests.get(
            f"{BASE_URL}/api/paywall/admin/all?admin_urn={non_admin_urn}"
        )
        
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin all payments correctly rejected non-admin URN with 403")
    
    def test_admin_config_without_urn_returns_403(self):
        """POST /api/paywall/admin/config without admin_urn returns 403"""
        payload = {"enabled": True}
        
        response = requests.post(
            f"{BASE_URL}/api/paywall/admin/config",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 403
        data = response.json()
        assert data["detail"] == "Not authorized"
        
        print(f"✓ Admin config correctly rejected missing admin_urn with 403")


class TestPaywallEdgeCases:
    """Edge case testing"""
    
    def test_payment_request_invalid_chain(self):
        """POST /api/paywall/request with invalid chain - verify behavior"""
        # Note: When paywall is disabled, this returns paywall_disabled regardless of chain
        # This test is informative but the 400 only triggers when paywall is enabled
        payload = {
            "urn": "test_user",
            "chain": "invalid_chain",
            "txid": "",
            "note": ""
        }
        response = requests.post(
            f"{BASE_URL}/api/paywall/request",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        # Since paywall is disabled, it returns 200 with paywall_disabled
        if response.status_code == 200:
            data = response.json()
            assert data.get("status") == "paywall_disabled"
            print(f"✓ Invalid chain handling: paywall_disabled (paywall is off)")
        else:
            # If paywall were enabled, it would return 400
            assert response.status_code == 400
            print(f"✓ Invalid chain correctly rejected with 400")
    
    def test_paywall_status_special_characters_in_urn(self):
        """GET /api/paywall/status with special characters in URN"""
        special_urn = "test@user.com"
        response = requests.get(f"{BASE_URL}/api/paywall/status/{special_urn}")
        assert response.status_code == 200
        
        data = response.json()
        assert data["paid"] == True  # Paywall disabled
        
        print(f"✓ Special characters in URN handled correctly")
    
    def test_paywall_config_idempotent(self):
        """GET /api/paywall/config is idempotent"""
        response1 = requests.get(f"{BASE_URL}/api/paywall/config")
        response2 = requests.get(f"{BASE_URL}/api/paywall/config")
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response1.json() == response2.json()
        
        print(f"✓ Paywall config endpoint is idempotent")
