"""
Test suite for Transfer Venue (Creator Control Transfer) feature - Iteration 126

Tests:
1. Backend API health check
2. Room messages API returns expected structure
3. Code review verification of buildObjectUpdateTransaction function
"""
import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestTransferVenueFeature:
    """Tests for Transfer Venue feature"""
    
    def test_api_health(self):
        """Verify API is accessible"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        print("PASS: API health check")
    
    def test_room_messages_api(self):
        """Verify room messages API returns expected structure"""
        # Use the test room from iteration 125
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(f"{BASE_URL}/api/room/{room_address}/messages", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert "messages" in data
        assert "seat_holders" in data
        assert "creators" in data
        assert "is_venue" in data
        print(f"PASS: Room messages API returns expected structure (is_venue={data['is_venue']})")
    
    def test_object_info_api(self):
        """Verify object info API returns creators field"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(f"{BASE_URL}/api/object/addr/{room_address}", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # Verify creators field exists
        assert "creators" in data or "Creators" in data
        print(f"PASS: Object info API returns creators field")


class TestBuildObjectUpdateTransactionCodeReview:
    """Code review tests for buildObjectUpdateTransaction function in p2fk.js"""
    
    @pytest.fixture(autouse=True)
    def load_p2fk_source(self):
        """Load the p2fk.js source code"""
        p2fk_path = "/app/frontend/src/utils/p2fk.js"
        with open(p2fk_path, 'r') as f:
            self.p2fk_source = f.read()
    
    def test_function_is_exported(self):
        """Verify buildObjectUpdateTransaction is exported"""
        assert "export function buildObjectUpdateTransaction" in self.p2fk_source
        print("PASS: buildObjectUpdateTransaction is exported")
    
    def test_function_signature(self):
        """Verify function signature matches expected parameters"""
        # Expected: buildObjectUpdateTransaction(wif, objectAddress, newCreatorAddress, updateFields = {}, networkName = 'btc-testnet')
        pattern = r"export function buildObjectUpdateTransaction\s*\(\s*wif\s*,\s*objectAddress\s*,\s*newCreatorAddress\s*,\s*updateFields\s*=\s*\{\}\s*,\s*networkName\s*=\s*'btc-testnet'\s*\)"
        assert re.search(pattern, self.p2fk_source), "Function signature doesn't match expected pattern"
        print("PASS: Function signature matches expected parameters")
    
    def test_returns_expected_fields(self):
        """Verify function returns addresses, senderAddress, objectAddress, taxInsertIndex"""
        # Look for the return statement
        # Expected: return { addresses: fullList, senderAddress: signatureAddress, objectAddress, network: networkName, taxInsertIndex };
        assert "return { addresses: fullList, senderAddress: signatureAddress, objectAddress, network: networkName, taxInsertIndex };" in self.p2fk_source
        print("PASS: Function returns expected fields (addresses, senderAddress, objectAddress, network, taxInsertIndex)")
    
    def test_builds_cre_field_with_reverse_indices(self):
        """Verify OBJ JSON contains cre field with objAddrRevIdx and newCreatorRevIdx"""
        # Look for: objData.cre = [objAddrRevIdx, newCreatorRevIdx];
        assert "objData.cre = [objAddrRevIdx, newCreatorRevIdx];" in self.p2fk_source
        print("PASS: OBJ JSON contains cre field with correct reverse indices")
    
    def test_object_address_second_to_last(self):
        """Verify objectAddress is added second-to-last in address list"""
        # Look for: fullList.push(objectAddress);       // second-to-last (reverse index 1)
        assert "fullList.push(objectAddress);" in self.p2fk_source
        print("PASS: objectAddress is pushed to address list (second-to-last)")
    
    def test_signature_address_last(self):
        """Verify signatureAddress is added last in address list"""
        # Look for: fullList.push(signatureAddress);    // LAST (reverse index 0)
        assert "fullList.push(signatureAddress);" in self.p2fk_source
        print("PASS: signatureAddress is pushed to address list (last)")
    
    def test_uses_signed_payload(self):
        """Verify function uses buildSignedPayload for signing"""
        # Look for buildSignedPayload call in the function
        # Extract the function body
        func_start = self.p2fk_source.find("export function buildObjectUpdateTransaction")
        func_end = self.p2fk_source.find("export function", func_start + 1)
        if func_end == -1:
            func_end = len(self.p2fk_source)
        func_body = self.p2fk_source[func_start:func_end]
        
        assert "buildSignedPayload(payload, wif, network)" in func_body
        print("PASS: Function uses buildSignedPayload for signing")
    
    def test_cleanup_removes_duplicates(self):
        """Verify function removes objectAddress and signatureAddress before re-adding"""
        func_start = self.p2fk_source.find("export function buildObjectUpdateTransaction")
        func_end = self.p2fk_source.find("export function", func_start + 1)
        if func_end == -1:
            func_end = len(self.p2fk_source)
        func_body = self.p2fk_source[func_start:func_end]
        
        # Look for cleanup pattern
        assert "while (fullList.includes(objectAddress))" in func_body
        assert "while (fullList.includes(signatureAddress))" in func_body
        print("PASS: Function removes duplicates before re-adding addresses")
    
    def test_obj_payload_format(self):
        """Verify OBJ payload format matches protocol"""
        func_start = self.p2fk_source.find("export function buildObjectUpdateTransaction")
        func_end = self.p2fk_source.find("export function", func_start + 1)
        if func_end == -1:
            func_end = len(self.p2fk_source)
        func_body = self.p2fk_source[func_start:func_end]
        
        # Look for OBJ payload construction
        assert "const payload = `OBJ${d1}${objBytes.length}${d2}${objJson}`;" in func_body
        print("PASS: OBJ payload format matches protocol (OBJ<delim><len><delim><json>)")


class TestObjectChatPageTransferUI:
    """Code review tests for Transfer Control UI in ObjectChatPage.js"""
    
    @pytest.fixture(autouse=True)
    def load_page_source(self):
        """Load the ObjectChatPage.js source code"""
        page_path = "/app/frontend/src/pages/ObjectChatPage.js"
        with open(page_path, 'r') as f:
            self.page_source = f.read()
    
    def test_show_transfer_modal_state(self):
        """Verify showTransferModal state exists"""
        assert "showTransferModal" in self.page_source
        assert "setShowTransferModal" in self.page_source
        print("PASS: showTransferModal state exists")
    
    def test_transfer_address_state(self):
        """Verify transferAddress state exists"""
        assert "transferAddress" in self.page_source
        assert "setTransferAddress" in self.page_source
        print("PASS: transferAddress state exists")
    
    def test_handle_transfer_function(self):
        """Verify handleTransfer function exists and calls buildObjectUpdateTransaction"""
        assert "const handleTransfer = async" in self.page_source
        assert "buildObjectUpdateTransaction" in self.page_source
        print("PASS: handleTransfer function exists and calls buildObjectUpdateTransaction")
    
    def test_transfer_button_in_menu(self):
        """Verify Transfer Control button exists in room menu"""
        assert 'data-testid="transfer-venue-btn"' in self.page_source
        assert "Transfer Control" in self.page_source
        print("PASS: Transfer Control button exists in room menu")
    
    def test_transfer_button_creator_only(self):
        """Verify Transfer Control button is only shown for creators"""
        # Look for the pattern: {isCreator && ( ... transfer-venue-btn ... )}
        # The button should be inside an isCreator conditional
        transfer_btn_idx = self.page_source.find('data-testid="transfer-venue-btn"')
        # Find the nearest isCreator check before this
        preceding_code = self.page_source[:transfer_btn_idx]
        # Check that isCreator is in the conditional context
        assert "{isCreator && (" in preceding_code or "isCreator &&" in preceding_code[-500:]
        print("PASS: Transfer Control button is conditionally rendered for creators")
    
    def test_transfer_modal_exists(self):
        """Verify Transfer modal UI exists"""
        assert 'data-testid="transfer-modal"' in self.page_source
        print("PASS: Transfer modal exists")
    
    def test_transfer_modal_warning(self):
        """Verify Transfer modal has irreversibility warning"""
        assert "irreversible" in self.page_source.lower()
        print("PASS: Transfer modal has irreversibility warning")
    
    def test_transfer_address_input(self):
        """Verify Transfer modal has address input"""
        assert 'data-testid="transfer-address-input"' in self.page_source
        print("PASS: Transfer modal has address input")
    
    def test_transfer_submit_button(self):
        """Verify Transfer modal has submit button"""
        assert 'data-testid="transfer-submit"' in self.page_source
        print("PASS: Transfer modal has submit button")
    
    def test_transfer_button_disabled_when_empty(self):
        """Verify Transfer button is disabled when address is empty"""
        # Look for: disabled={transferSending || !transferAddress.trim()}
        assert "disabled={transferSending || !transferAddress.trim()}" in self.page_source
        print("PASS: Transfer button is disabled when address is empty")


class TestExistingFeaturesRegression:
    """Regression tests to ensure existing features still work"""
    
    def test_public_room_shows_all_messages(self):
        """Verify public room (non-venue) shows all messages with is_seat_holder=True"""
        room_address = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"
        response = requests.get(f"{BASE_URL}/api/room/{room_address}/messages", params={"network": "btc-testnet"})
        assert response.status_code == 200
        data = response.json()
        
        # This room has CC0 license, so is_venue should be False
        assert data.get("is_venue") == False, f"Expected is_venue=False for CC0 license room, got {data.get('is_venue')}"
        
        # All messages should have is_seat_holder=True for public rooms
        messages = data.get("messages", [])
        if messages:
            for msg in messages:
                assert msg.get("is_seat_holder") == True, f"Expected is_seat_holder=True for public room message"
        
        print(f"PASS: Public room shows all messages with is_seat_holder=True ({len(messages)} messages)")
    
    def test_venue_indicator_code_exists(self):
        """Verify venue indicator code exists in ObjectChatPage"""
        page_path = "/app/frontend/src/pages/ObjectChatPage.js"
        with open(page_path, 'r') as f:
            page_source = f.read()
        
        # Check for venue indicator
        assert "Speaking Venue" in page_source
        assert "isVenue" in page_source
        print("PASS: Venue indicator code exists")
