"""
Test Suite for Iteration 28 - Storefront Data Source Filters
Tests server-side filtering by data_source parameter (BTC, IPFS, MAZ, DOGE, LTC)

Expected distribution on btc-testnet:
- IPFS: ~193 objects
- BTC: 7 objects  
- MAZ: 1 object
- DOGE: 0 objects
- LTC: 0 objects
- Total (ALL): ~201 objects
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestStorefrontDataSourceFilters:
    """Test server-side data_source filtering on /api/objects/storefront endpoint"""
    
    def test_health_check(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        print("✓ Health check passed")
    
    def test_storefront_no_filter_returns_all(self):
        """GET /api/objects/storefront/btc-testnet (no filter) should return total ~201"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 200},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        # Expected ~201 total objects
        assert total >= 190, f"Expected at least 190 total objects, got {total}"
        assert total <= 250, f"Expected at most 250 total objects, got {total}"
        
        print(f"✓ Storefront no filter: total={total} objects")
    
    def test_storefront_btc_filter(self):
        """GET /api/objects/storefront/btc-testnet?data_source=BTC should return total=7"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "BTC", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        data_source_returned = data.get('data_source')
        
        # Expected exactly 7 BTC objects
        assert total == 7, f"Expected exactly 7 BTC objects, got {total}"
        assert data_source_returned == 'BTC', f"Expected data_source=BTC in response, got {data_source_returned}"
        
        # Verify objects returned match BTC filter
        objects = data.get('objects', [])
        assert len(objects) == 7, f"Expected 7 objects in response, got {len(objects)}"
        
        print(f"✓ BTC filter: total={total} objects (expected 7)")
    
    def test_storefront_ipfs_filter(self):
        """GET /api/objects/storefront/btc-testnet?data_source=IPFS should return total ~193"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "IPFS", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        data_source_returned = data.get('data_source')
        
        # Expected ~193 IPFS objects
        assert total >= 180, f"Expected at least 180 IPFS objects, got {total}"
        assert total <= 220, f"Expected at most 220 IPFS objects, got {total}"
        assert data_source_returned == 'IPFS', f"Expected data_source=IPFS in response, got {data_source_returned}"
        
        print(f"✓ IPFS filter: total={total} objects (expected ~193)")
    
    def test_storefront_maz_filter(self):
        """GET /api/objects/storefront/btc-testnet?data_source=MAZ should return total=1"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "MAZ", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        data_source_returned = data.get('data_source')
        
        # Expected exactly 1 MAZ object
        assert total == 1, f"Expected exactly 1 MAZ object, got {total}"
        assert data_source_returned == 'MAZ', f"Expected data_source=MAZ in response, got {data_source_returned}"
        
        objects = data.get('objects', [])
        assert len(objects) == 1, f"Expected 1 object in response, got {len(objects)}"
        
        print(f"✓ MAZ filter: total={total} objects (expected 1)")
    
    def test_storefront_doge_filter(self):
        """GET /api/objects/storefront/btc-testnet?data_source=DOGE should return total=0"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "DOGE", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        data_source_returned = data.get('data_source')
        
        # Expected 0 DOGE objects
        assert total == 0, f"Expected 0 DOGE objects, got {total}"
        assert data_source_returned == 'DOGE', f"Expected data_source=DOGE in response, got {data_source_returned}"
        
        objects = data.get('objects', [])
        assert len(objects) == 0, f"Expected 0 objects in response, got {len(objects)}"
        
        print(f"✓ DOGE filter: total={total} objects (expected 0)")
    
    def test_storefront_ltc_filter(self):
        """GET /api/objects/storefront/btc-testnet?data_source=LTC should return total=0"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "LTC", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        data_source_returned = data.get('data_source')
        
        # Expected 0 LTC objects
        assert total == 0, f"Expected 0 LTC objects, got {total}"
        assert data_source_returned == 'LTC', f"Expected data_source=LTC in response, got {data_source_returned}"
        
        objects = data.get('objects', [])
        assert len(objects) == 0, f"Expected 0 objects in response, got {len(objects)}"
        
        print(f"✓ LTC filter: total={total} objects (expected 0)")
    
    def test_storefront_all_filter_explicit(self):
        """GET /api/objects/storefront/btc-testnet?data_source=ALL should return total ~201 (same as no filter)"""
        response = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"data_source": "ALL", "limit": 20},
            timeout=30
        )
        assert response.status_code == 200
        data = response.json()
        
        total = data.get('total', 0)
        
        # Expected ~201 total objects
        assert total >= 190, f"Expected at least 190 total objects with ALL filter, got {total}"
        
        print(f"✓ ALL filter: total={total} objects")

    def test_filter_counts_sum_up(self):
        """Verify sum of individual filters equals total (ALL) count"""
        # Get total
        resp_all = requests.get(
            f"{BASE_URL}/api/objects/storefront/btc-testnet",
            params={"limit": 1},
            timeout=30
        )
        total_all = resp_all.json().get('total', 0)
        
        # Get individual counts
        resp_btc = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "BTC", "limit": 1}, timeout=30)
        resp_ipfs = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "IPFS", "limit": 1}, timeout=30)
        resp_maz = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "MAZ", "limit": 1}, timeout=30)
        resp_doge = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "DOGE", "limit": 1}, timeout=30)
        resp_ltc = requests.get(f"{BASE_URL}/api/objects/storefront/btc-testnet", params={"data_source": "LTC", "limit": 1}, timeout=30)
        
        btc_count = resp_btc.json().get('total', 0)
        ipfs_count = resp_ipfs.json().get('total', 0)
        maz_count = resp_maz.json().get('total', 0)
        doge_count = resp_doge.json().get('total', 0)
        ltc_count = resp_ltc.json().get('total', 0)
        
        sum_filters = btc_count + ipfs_count + maz_count + doge_count + ltc_count
        
        print(f"Counts: BTC={btc_count}, IPFS={ipfs_count}, MAZ={maz_count}, DOGE={doge_count}, LTC={ltc_count}")
        print(f"Sum of filters: {sum_filters}, Total ALL: {total_all}")
        
        # Sum should equal total
        assert sum_filters == total_all, f"Sum of individual filters ({sum_filters}) doesn't match total ({total_all})"
        
        print(f"✓ Filter counts sum up correctly: {sum_filters} == {total_all}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
