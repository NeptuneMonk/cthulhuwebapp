"""
Test Display Bug Fixes - Iteration 171
Tests for:
1. Object API returns URN field correctly for multipart objects
2. Spock.jpg and Spock.mp3 objects have different URN values
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestObjectURNFields:
    """Test that object API returns URN fields correctly for multipart objects"""
    
    def test_spock_jpg_object_returns_urn(self):
        """GET /api/object/addr/12Wv1LBNsqq2KiXme6g6UgT9y2p2jGWFGk returns Spock.jpg URN"""
        response = requests.get(f"{BASE_URL}/api/object/addr/12Wv1LBNsqq2KiXme6g6UgT9y2p2jGWFGk?network=mainnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "urn" in data, "Response should contain 'urn' field"
        assert "Spock.jpg" in data["urn"], f"URN should contain 'Spock.jpg', got: {data['urn']}"
        assert data["name"] == "Spock", f"Name should be 'Spock', got: {data['name']}"
        
    def test_spock_mp3_object_returns_urn(self):
        """GET /api/object/addr/1EFHDndNehfRi8TJccAhUfo5gst1MS1U1b returns mp3 URN"""
        response = requests.get(f"{BASE_URL}/api/object/addr/1EFHDndNehfRi8TJccAhUfo5gst1MS1U1b?network=mainnet")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "urn" in data, "Response should contain 'urn' field"
        assert ".mp3" in data["urn"], f"URN should contain '.mp3', got: {data['urn']}"
        assert "Spock_Live_Long_And_Prosper.mp3" in data["urn"], f"URN should contain 'Spock_Live_Long_And_Prosper.mp3', got: {data['urn']}"
        
    def test_spock_objects_have_different_urns(self):
        """The two Spock objects should have different URN values"""
        # Get jpg object
        jpg_response = requests.get(f"{BASE_URL}/api/object/addr/12Wv1LBNsqq2KiXme6g6UgT9y2p2jGWFGk?network=mainnet")
        assert jpg_response.status_code == 200
        jpg_data = jpg_response.json()
        
        # Get mp3 object
        mp3_response = requests.get(f"{BASE_URL}/api/object/addr/1EFHDndNehfRi8TJccAhUfo5gst1MS1U1b?network=mainnet")
        assert mp3_response.status_code == 200
        mp3_data = mp3_response.json()
        
        # URNs should be different
        assert jpg_data["urn"] != mp3_data["urn"], "URNs should be different for jpg and mp3 objects"
        
        # Both should have same Image field (thumbnail)
        assert jpg_data["image"] == mp3_data["image"], "Both objects should have same Image field (thumbnail)"
        
    def test_spock_objects_share_same_cid(self):
        """Both Spock objects share the same on-chain CID but different filenames"""
        jpg_response = requests.get(f"{BASE_URL}/api/object/addr/12Wv1LBNsqq2KiXme6g6UgT9y2p2jGWFGk?network=mainnet")
        mp3_response = requests.get(f"{BASE_URL}/api/object/addr/1EFHDndNehfRi8TJccAhUfo5gst1MS1U1b?network=mainnet")
        
        jpg_urn = jpg_response.json()["urn"]
        mp3_urn = mp3_response.json()["urn"]
        
        # Extract CID (txid) from URN - format is "txid/filename"
        jpg_cid = jpg_urn.split("/")[0]
        mp3_cid = mp3_urn.split("/")[0]
        
        assert jpg_cid == mp3_cid, f"Both objects should share same CID. jpg: {jpg_cid}, mp3: {mp3_cid}"
        
        # But filenames should differ
        jpg_filename = jpg_urn.split("/")[1] if "/" in jpg_urn else ""
        mp3_filename = mp3_urn.split("/")[1] if "/" in mp3_urn else ""
        
        assert jpg_filename != mp3_filename, f"Filenames should differ. jpg: {jpg_filename}, mp3: {mp3_filename}"
        assert jpg_filename.endswith(".jpg"), f"jpg filename should end with .jpg: {jpg_filename}"
        assert mp3_filename.endswith(".mp3"), f"mp3 filename should end with .mp3: {mp3_filename}"


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Health endpoint returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
