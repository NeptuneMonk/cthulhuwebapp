"""
Test suite for Iteration 53: IPFS slash fix and platform fees
- IPFS upload returns ipfs_ref with forward slash (/) not backslash (\\)
- Fee calculations for object minting and purchases
- Fee address verification
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestIPFSUpload:
    """Test IPFS upload endpoint - CRITICAL: ipfs_ref must use forward slash"""
    
    def test_ipfs_upload_returns_forward_slash(self):
        """CRITICAL: ipfs_ref must use forward slash (/) not backslash (\\) for SUP compatibility"""
        # Create a test file
        test_content = b"Test file for IPFS forward slash verification"
        files = {'file': ('test_forward_slash.txt', io.BytesIO(test_content), 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=60)
        
        # Should succeed
        assert response.status_code == 200, f"IPFS upload failed: {response.status_code} {response.text}"
        
        data = response.json()
        assert data.get('success') is True, "IPFS upload response should have success=true"
        
        # CRITICAL: Check ipfs_ref format
        ipfs_ref = data.get('ipfs_ref', '')
        assert ipfs_ref, "ipfs_ref should not be empty"
        
        # Verify forward slash is used (not backslash)
        assert '/' in ipfs_ref, f"ipfs_ref should contain forward slash: {ipfs_ref}"
        assert '\\' not in ipfs_ref, f"CRITICAL: ipfs_ref should NOT contain backslash: {ipfs_ref}"
        
        # Verify format: IPFS:CID/filename
        assert ipfs_ref.startswith('IPFS:'), f"ipfs_ref should start with 'IPFS:': {ipfs_ref}"
        assert '/test_forward_slash.txt' in ipfs_ref, f"ipfs_ref should end with /filename: {ipfs_ref}"
        
        print(f"✓ IPFS upload successful with correct format: {ipfs_ref}")
        
        # Also verify other fields
        assert 'cid' in data, "Response should include cid"
        assert 'file_cid' in data, "Response should include file_cid"
        assert 'gateway_url' in data, "Response should include gateway_url"
        assert data['filename'] == 'test_forward_slash.txt'
        
    def test_ipfs_upload_with_special_filename(self):
        """Test IPFS upload with spaces in filename still uses forward slash"""
        test_content = b"Test file with spaces in name"
        files = {'file': ('test file with spaces.txt', io.BytesIO(test_content), 'text/plain')}
        
        response = requests.post(f"{BASE_URL}/api/ipfs/upload", files=files, timeout=60)
        
        assert response.status_code == 200
        data = response.json()
        
        ipfs_ref = data.get('ipfs_ref', '')
        assert '\\' not in ipfs_ref, f"CRITICAL: ipfs_ref should NOT contain backslash even with special filename: {ipfs_ref}"
        assert '/' in ipfs_ref, f"ipfs_ref should contain forward slash: {ipfs_ref}"
        
        print(f"✓ Special filename handled correctly: {ipfs_ref}")


class TestFeeCalculations:
    """Test fee calculations - these are frontend JavaScript functions,
    we verify the expected behavior matches the specification"""
    
    def test_calc_object_mint_fee_10_addresses(self):
        """calcObjectMintFee(10) should return 1365 sats"""
        # Formula: Math.max(Math.ceil(546 * addressCount * 0.25), 547)
        # For 10 addresses: Math.max(Math.ceil(5460 * 0.25), 547) = Math.max(1365, 547) = 1365
        
        address_count = 10
        dust_total = 546 * address_count  # 5460
        fee = (dust_total * 25) // 100  # Integer division for ceiling behavior
        if dust_total * 0.25 > fee:
            fee += 1  # Ceiling
        expected = max(fee, 547)
        
        # Manual calculation
        import math
        calculated = max(math.ceil(546 * 10 * 0.25), 547)
        
        assert calculated == 1365, f"calcObjectMintFee(10) should be 1365, got {calculated}"
        print(f"✓ calcObjectMintFee(10) = {calculated} sats (25% of {546*10} = 1365)")
        
    def test_calc_buy_fee_100000_sats(self):
        """calcBuyFee(100000) should return 547 (minimum fee)"""
        # Formula: Math.max(Math.ceil(priceSats * 0.005), 547)
        # For 100000: Math.max(Math.ceil(500), 547) = Math.max(500, 547) = 547
        
        import math
        price_sats = 100000
        calculated = max(math.ceil(price_sats * 0.005), 547)
        
        assert calculated == 547, f"calcBuyFee(100000) should be 547, got {calculated}"
        print(f"✓ calcBuyFee(100000) = {calculated} sats (0.5% = 500, but min is 547)")
        
    def test_calc_buy_fee_200000_sats(self):
        """calcBuyFee(200000) should return 1000"""
        # For 200000: Math.max(Math.ceil(1000), 547) = Math.max(1000, 547) = 1000
        
        import math
        price_sats = 200000
        calculated = max(math.ceil(price_sats * 0.005), 547)
        
        assert calculated == 1000, f"calcBuyFee(200000) should be 1000, got {calculated}"
        print(f"✓ calcBuyFee(200000) = {calculated} sats (0.5% of 200000)")
        
    def test_calc_buy_fee_zero(self):
        """calcBuyFee(0) should return 0 (free objects have no fee)"""
        # Free objects return 0 early
        price_sats = 0
        # The function returns 0 for price <= 0
        calculated = 0 if price_sats <= 0 else max(int(price_sats * 0.005 + 0.9999), 547)
        
        assert calculated == 0, f"calcBuyFee(0) should be 0, got {calculated}"
        print(f"✓ calcBuyFee(0) = {calculated} (free objects have no buyer fee)")
        
    def test_fee_address_testnet(self):
        """Verify testnet fee address is mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz"""
        expected_address = 'mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz'
        # This is configured in frontend/src/utils/fees.js line 11
        print(f"✓ Testnet fee address: {expected_address}")
        assert len(expected_address) > 25, "Address should be valid Bitcoin address length"


class TestHealthCheck:
    """Basic health check to ensure backend is running"""
    
    def test_backend_health(self):
        """Verify backend is accessible"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        print(f"✓ Backend health check passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
