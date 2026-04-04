"""
Test suite for Iteration 238: Admin Dashboard Vacuum Controls
Tests the new features:
1. POST /api/snapshot/vacuum/stop - Stop a running vacuum
2. GET /api/snapshot/status - Includes stop_requested and network fields
3. GET /api/snapshot/history/export - Export snapshot history as JSON
4. POST /api/snapshot/history/import - Import snapshot history from JSON
"""

import pytest
import requests
import os
import json
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSnapshotStatus:
    """Test GET /api/snapshot/status endpoint"""
    
    def test_status_returns_200(self):
        """Status endpoint should return 200"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✓ GET /api/snapshot/status returns 200")
    
    def test_status_has_vacuum_object(self):
        """Status should include vacuum object with required fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200
        data = response.json()
        
        assert "vacuum" in data, "Response should have 'vacuum' field"
        vacuum = data["vacuum"]
        
        # Check required fields
        assert "running" in vacuum, "vacuum should have 'running' field"
        assert "phase" in vacuum, "vacuum should have 'phase' field"
        assert "stop_requested" in vacuum, "vacuum should have 'stop_requested' field"
        assert "network" in vacuum, "vacuum should have 'network' field"
        
        print(f"✓ Vacuum status has all required fields: running={vacuum['running']}, phase={vacuum['phase']}, stop_requested={vacuum['stop_requested']}, network={vacuum['network']}")
    
    def test_status_has_cache_and_snapshots(self):
        """Status should include cache and snapshots arrays"""
        response = requests.get(f"{BASE_URL}/api/snapshot/status")
        assert response.status_code == 200
        data = response.json()
        
        assert "cache" in data, "Response should have 'cache' field"
        assert "snapshots" in data, "Response should have 'snapshots' field"
        assert isinstance(data["snapshots"], list), "snapshots should be a list"
        
        print(f"✓ Status has cache and snapshots: {len(data['snapshots'])} snapshots, {data['cache'].get('p2fk_entries', 0)} cache entries")


class TestVacuumStop:
    """Test POST /api/snapshot/vacuum/stop endpoint"""
    
    def test_stop_when_not_running(self):
        """Stop should return error when no vacuum is running"""
        # First check if vacuum is running
        status_resp = requests.get(f"{BASE_URL}/api/snapshot/status")
        status = status_resp.json()
        
        if status["vacuum"]["running"]:
            # If vacuum is running, we can test the stop functionality
            response = requests.post(f"{BASE_URL}/api/snapshot/vacuum/stop")
            assert response.status_code == 200
            data = response.json()
            assert "stopping" in data or "error" in data
            print(f"✓ Stop vacuum while running: {data}")
        else:
            # If vacuum is not running, stop should return error
            response = requests.post(f"{BASE_URL}/api/snapshot/vacuum/stop")
            assert response.status_code == 200
            data = response.json()
            assert "error" in data, "Should return error when no vacuum is running"
            assert "No vacuum is currently running" in data["error"] or "not running" in data["error"].lower()
            print(f"✓ Stop vacuum when not running returns error: {data['error']}")
    
    def test_stop_returns_phase(self):
        """Stop endpoint should return current phase"""
        response = requests.post(f"{BASE_URL}/api/snapshot/vacuum/stop")
        assert response.status_code == 200
        data = response.json()
        
        # Should have phase field regardless of whether vacuum is running
        assert "phase" in data, "Response should include 'phase' field"
        print(f"✓ Stop endpoint returns phase: {data['phase']}")


class TestHistoryExport:
    """Test GET /api/snapshot/history/export endpoint"""
    
    def test_export_returns_200(self):
        """Export endpoint should return 200"""
        response = requests.get(f"{BASE_URL}/api/snapshot/history/export")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"✓ GET /api/snapshot/history/export returns 200")
    
    def test_export_has_required_fields(self):
        """Export should return JSON with snapshots and snapshot_txids arrays"""
        response = requests.get(f"{BASE_URL}/api/snapshot/history/export")
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "version" in data, "Export should have 'version' field"
        assert "exported_at" in data, "Export should have 'exported_at' field"
        assert "snapshots" in data, "Export should have 'snapshots' array"
        assert "snapshot_txids" in data, "Export should have 'snapshot_txids' array"
        assert "totals" in data, "Export should have 'totals' field"
        
        assert isinstance(data["snapshots"], list), "snapshots should be a list"
        assert isinstance(data["snapshot_txids"], list), "snapshot_txids should be a list"
        
        print(f"✓ Export has required fields: version={data['version']}, {len(data['snapshots'])} snapshots, {len(data['snapshot_txids'])} txids")
    
    def test_export_snapshot_structure(self):
        """Each snapshot in export should have required fields"""
        response = requests.get(f"{BASE_URL}/api/snapshot/history/export")
        assert response.status_code == 200
        data = response.json()
        
        if len(data["snapshots"]) > 0:
            snapshot = data["snapshots"][0]
            required_fields = ["id", "cid", "chain", "type", "created_at"]
            for field in required_fields:
                assert field in snapshot, f"Snapshot should have '{field}' field"
            print(f"✓ Snapshot structure valid: cid={snapshot['cid'][:20]}..., chain={snapshot['chain']}, type={snapshot['type']}")
        else:
            print("✓ No snapshots to validate structure (empty history)")


class TestHistoryImport:
    """Test POST /api/snapshot/history/import endpoint"""
    
    def test_import_empty_payload(self):
        """Import with empty arrays should succeed"""
        payload = {
            "version": 1,
            "snapshots": [],
            "snapshot_txids": []
        }
        response = requests.post(
            f"{BASE_URL}/api/snapshot/history/import",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert "success" in data, "Response should have 'success' field"
        assert data["success"] == True, "Import should succeed"
        assert "imported_snapshots" in data, "Response should have 'imported_snapshots' count"
        assert "imported_txids" in data, "Response should have 'imported_txids' count"
        
        print(f"✓ Import empty payload succeeds: imported_snapshots={data['imported_snapshots']}, imported_txids={data['imported_txids']}")
    
    def test_import_with_test_snapshot(self):
        """Import with a test snapshot should succeed (INSERT OR IGNORE)"""
        test_snapshot = {
            "cid": "QmTestSnapshot238",
            "block_height": 0,
            "chain": "btc-testnet",
            "type": "test",
            "root_count": 0,
            "size_bytes": 100,
            "previous_cid": None,
            "created_at": "2026-01-01T00:00:00Z"
        }
        payload = {
            "version": 1,
            "snapshots": [test_snapshot],
            "snapshot_txids": []
        }
        response = requests.post(
            f"{BASE_URL}/api/snapshot/history/import",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        assert data["success"] == True, "Import should succeed"
        print(f"✓ Import test snapshot succeeds: imported_snapshots={data['imported_snapshots']}")
    
    def test_import_invalid_payload(self):
        """Import with invalid payload should return 422"""
        payload = {"invalid": "data"}
        response = requests.post(
            f"{BASE_URL}/api/snapshot/history/import",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        # Pydantic validation should return 422
        assert response.status_code == 422, f"Expected 422 for invalid payload, got {response.status_code}"
        print(f"✓ Import invalid payload returns 422 validation error")


class TestVacuumStartWithNetwork:
    """Test POST /api/snapshot/vacuum with network parameter"""
    
    def test_vacuum_start_with_testnet(self):
        """Vacuum start should accept network parameter"""
        # First check if vacuum is already running
        status_resp = requests.get(f"{BASE_URL}/api/snapshot/status")
        status = status_resp.json()
        
        if status["vacuum"]["running"]:
            print(f"⚠ Vacuum already running (phase={status['vacuum']['phase']}), skipping start test")
            pytest.skip("Vacuum already running")
        
        # Start vacuum with testnet
        response = requests.post(f"{BASE_URL}/api/snapshot/vacuum?network=btc-testnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        if "error" in data:
            # Vacuum might have started between our check and start
            print(f"⚠ Vacuum start returned error (likely already running): {data['error']}")
        else:
            assert "started" in data, "Response should have 'started' field"
            assert data["started"] == True, "Vacuum should start"
            assert data.get("network") == "btc-testnet", "Network should be btc-testnet"
            print(f"✓ Vacuum started with network=btc-testnet")
            
            # Wait a moment and verify status shows the network
            time.sleep(1)
            status_resp = requests.get(f"{BASE_URL}/api/snapshot/status")
            status = status_resp.json()
            if status["vacuum"]["running"]:
                assert status["vacuum"]["network"] == "btc-testnet", "Status should show btc-testnet network"
                print(f"✓ Status shows vacuum running on btc-testnet")


class TestIntegrationExportImport:
    """Integration test: Export then Import should work"""
    
    def test_export_import_roundtrip(self):
        """Export history, then import it back (should be idempotent)"""
        # Export
        export_resp = requests.get(f"{BASE_URL}/api/snapshot/history/export")
        assert export_resp.status_code == 200
        export_data = export_resp.json()
        
        # Import the same data back
        import_payload = {
            "version": export_data["version"],
            "snapshots": export_data["snapshots"],
            "snapshot_txids": export_data["snapshot_txids"]
        }
        import_resp = requests.post(
            f"{BASE_URL}/api/snapshot/history/import",
            json=import_payload,
            headers={"Content-Type": "application/json"}
        )
        assert import_resp.status_code == 200
        import_data = import_resp.json()
        
        assert import_data["success"] == True
        # Since we're importing existing data, imported counts might be 0 (INSERT OR IGNORE)
        print(f"✓ Export/Import roundtrip: exported {len(export_data['snapshots'])} snapshots, imported {import_data['imported_snapshots']} new")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
