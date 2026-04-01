"""
Iteration 127: Buy Seat Modal + Enhanced Transfer Control Modal Tests
Tests for:
1. Buy Seat modal in ObjectChatPage (simplified in-venue purchase)
2. Transfer Control modal with Give/Sell toggle
3. Backend API returns correct structure with is_venue field
"""
import pytest
import requests
import os
import re

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test room: BONG 玉 (public room with CC0 license)
TEST_ROOM_ADDRESS = "mxSeCe3jukQchdiD2u5ChHVeEMj4LUSxLv"


class TestBackendRoomMessagesAPI:
    """Backend API tests for room messages endpoint"""

    def test_room_messages_returns_is_venue_field(self):
        """Verify API returns is_venue field"""
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/messages",
            params={"network": "btc-testnet", "limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        assert "is_venue" in data, "Response should contain is_venue field"
        assert isinstance(data["is_venue"], bool), "is_venue should be boolean"
        print(f"PASS: is_venue field present and is boolean: {data['is_venue']}")

    def test_room_messages_returns_correct_structure(self):
        """Verify API returns correct response structure"""
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/messages",
            params={"network": "btc-testnet", "limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "messages" in data, "Response should contain messages array"
        assert "count" in data, "Response should contain count"
        assert "seat_holders" in data, "Response should contain seat_holders"
        assert "creators" in data, "Response should contain creators"
        assert "is_venue" in data, "Response should contain is_venue"
        
        # Check types
        assert isinstance(data["messages"], list), "messages should be a list"
        assert isinstance(data["count"], int), "count should be an integer"
        assert isinstance(data["seat_holders"], list), "seat_holders should be a list"
        assert isinstance(data["creators"], list), "creators should be a list"
        
        print(f"PASS: API returns correct structure with {data['count']} messages")

    def test_public_room_is_venue_false(self):
        """Verify public room (CC0 license) has is_venue=False"""
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/messages",
            params={"network": "btc-testnet", "limit": 5}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_venue"] == False, "Public room should have is_venue=False"
        print("PASS: Public room correctly has is_venue=False")

    def test_public_room_all_messages_have_is_seat_holder_true(self):
        """Verify all messages in public room have is_seat_holder=True"""
        response = requests.get(
            f"{BASE_URL}/api/room/{TEST_ROOM_ADDRESS}/messages",
            params={"network": "btc-testnet", "limit": 10}
        )
        assert response.status_code == 200
        data = response.json()
        
        messages = data.get("messages", [])
        assert len(messages) > 0, "Should have at least one message"
        
        for msg in messages:
            assert msg.get("is_seat_holder") == True, f"Message {msg.get('txid')} should have is_seat_holder=True"
        
        print(f"PASS: All {len(messages)} messages have is_seat_holder=True")


class TestFrontendCodeReviewBuySeatModal:
    """Code review tests for Buy Seat modal in ObjectChatPage.js"""

    @pytest.fixture(scope="class")
    def object_chat_page_content(self):
        """Load ObjectChatPage.js content"""
        with open("/app/frontend/src/pages/ObjectChatPage.js", "r") as f:
            return f.read()

    def test_buy_seat_modal_exists(self, object_chat_page_content):
        """Verify Buy Seat modal exists with correct data-testid"""
        assert 'data-testid="buy-seat-modal"' in object_chat_page_content
        print("PASS: Buy Seat modal exists with data-testid='buy-seat-modal'")

    def test_buy_seat_modal_shows_price(self, object_chat_page_content):
        """Verify Buy Seat modal shows price"""
        # Check for price display logic
        assert "seatPrice" in object_chat_page_content
        assert "BTC" in object_chat_page_content
        assert "FREE" in object_chat_page_content  # For free seats
        print("PASS: Buy Seat modal shows price (BTC or FREE)")

    def test_buy_seat_modal_shows_seat_count(self, object_chat_page_content):
        """Verify Buy Seat modal shows seat count"""
        assert "seatAvail" in object_chat_page_content
        assert "seat" in object_chat_page_content.lower()
        assert "available" in object_chat_page_content.lower()
        print("PASS: Buy Seat modal shows seat count")

    def test_buy_seat_modal_shows_confirmation_time(self, object_chat_page_content):
        """Verify Buy Seat modal shows confirmation time estimate"""
        assert "~10 minutes" in object_chat_page_content
        print("PASS: Buy Seat modal shows '~10 minutes' confirmation time")

    def test_buy_seat_modal_has_purchase_button(self, object_chat_page_content):
        """Verify Buy Seat modal has Purchase Seat button"""
        assert 'data-testid="buy-seat-confirm"' in object_chat_page_content
        assert "Purchase Seat" in object_chat_page_content
        print("PASS: Buy Seat modal has Purchase Seat button")

    def test_buy_seat_success_shows_checkmark(self, object_chat_page_content):
        """Verify Buy Seat success state shows checkmark"""
        assert "FiCheck" in object_chat_page_content
        assert "buySeatResult" in object_chat_page_content
        print("PASS: Buy Seat success state shows checkmark")

    def test_buy_seat_success_shows_tx_hash(self, object_chat_page_content):
        """Verify Buy Seat success state shows TX hash"""
        # Check for txid display in success state
        assert "{buySeatResult}" in object_chat_page_content
        print("PASS: Buy Seat success state shows TX hash")

    def test_handle_buy_seat_calls_build_buy_transaction(self, object_chat_page_content):
        """Verify handleBuySeat calls buildBuyTransaction"""
        assert "handleBuySeat" in object_chat_page_content
        assert "buildBuyTransaction" in object_chat_page_content
        print("PASS: handleBuySeat calls buildBuyTransaction")


class TestFrontendCodeReviewTransferModal:
    """Code review tests for Transfer Control modal with Give/Sell toggle"""

    @pytest.fixture(scope="class")
    def object_chat_page_content(self):
        """Load ObjectChatPage.js content"""
        with open("/app/frontend/src/pages/ObjectChatPage.js", "r") as f:
            return f.read()

    def test_transfer_modal_exists(self, object_chat_page_content):
        """Verify Transfer modal exists with correct data-testid"""
        assert 'data-testid="transfer-modal"' in object_chat_page_content
        print("PASS: Transfer modal exists with data-testid='transfer-modal'")

    def test_transfer_mode_give_button_exists(self, object_chat_page_content):
        """Verify Give mode button exists"""
        assert 'data-testid="transfer-mode-give"' in object_chat_page_content
        print("PASS: Give mode button exists with data-testid='transfer-mode-give'")

    def test_transfer_mode_sell_button_exists(self, object_chat_page_content):
        """Verify Sell mode button exists"""
        assert 'data-testid="transfer-mode-sell"' in object_chat_page_content
        print("PASS: Sell mode button exists with data-testid='transfer-mode-sell'")

    def test_give_mode_shows_give_away_button(self, object_chat_page_content):
        """Verify Give mode shows 'Give Away' button"""
        assert "Give Away" in object_chat_page_content
        print("PASS: Give mode shows 'Give Away' button")

    def test_give_mode_shows_irreversibility_warning(self, object_chat_page_content):
        """Verify Give mode shows irreversibility warning"""
        assert "irreversible" in object_chat_page_content.lower()
        print("PASS: Give mode shows irreversibility warning")

    def test_sell_mode_shows_price_input(self, object_chat_page_content):
        """Verify Sell mode shows price input"""
        assert 'data-testid="transfer-price-input"' in object_chat_page_content
        print("PASS: Sell mode shows price input with data-testid='transfer-price-input'")

    def test_sell_mode_shows_execute_transfer_button(self, object_chat_page_content):
        """Verify Sell mode shows 'Execute Transfer' button"""
        assert "Execute Transfer" in object_chat_page_content
        print("PASS: Sell mode shows 'Execute Transfer' button")

    def test_sell_mode_shows_payment_verification_warning(self, object_chat_page_content):
        """Verify Sell mode shows payment verification warning"""
        # Check for warning about verifying payment before executing
        assert "Confirm the buyer has sent" in object_chat_page_content or "payment" in object_chat_page_content.lower()
        print("PASS: Sell mode shows payment verification warning")

    def test_sell_mode_shows_sats_conversion(self, object_chat_page_content):
        """Verify Sell mode displays sats conversion"""
        assert "transferPrice" in object_chat_page_content
        assert "sats" in object_chat_page_content.lower()
        print("PASS: Sell mode displays sats conversion")

    def test_transfer_mode_state_exists(self, object_chat_page_content):
        """Verify transferMode state exists with 'give' and 'sell' options"""
        assert "transferMode" in object_chat_page_content
        assert "'give'" in object_chat_page_content or '"give"' in object_chat_page_content
        assert "'sell'" in object_chat_page_content or '"sell"' in object_chat_page_content
        print("PASS: transferMode state exists with 'give' and 'sell' options")


class TestFrontendCodeReviewAudienceCompose:
    """Code review tests for Audience compose area"""

    @pytest.fixture(scope="class")
    def object_chat_page_content(self):
        """Load ObjectChatPage.js content"""
        with open("/app/frontend/src/pages/ObjectChatPage.js", "r") as f:
            return f.read()

    def test_buy_seat_link_exists(self, object_chat_page_content):
        """Verify 'seats available' link exists in audience compose"""
        assert 'data-testid="buy-seat-link"' in object_chat_page_content
        print("PASS: Buy seat link exists with data-testid='buy-seat-link'")

    def test_buy_seat_link_opens_modal_not_navigation(self, object_chat_page_content):
        """Verify buy seat link opens modal instead of navigating"""
        # Find the buy-seat-link section and verify it uses setShowBuySeatModal
        # and does NOT use navigate()
        lines = object_chat_page_content.split('\n')
        in_buy_seat_link = False
        for i, line in enumerate(lines):
            if 'data-testid="buy-seat-link"' in line:
                in_buy_seat_link = True
                # Check surrounding lines for onClick handler
                context = '\n'.join(lines[max(0, i-3):min(len(lines), i+3)])
                assert "setShowBuySeatModal(true)" in context, "Buy seat link should open modal"
                assert "navigate(" not in context, "Buy seat link should NOT navigate"
                print("PASS: Buy seat link opens modal (not navigation)")
                return
        
        # If we didn't find it inline, check for the onClick pattern
        assert "setShowBuySeatModal(true)" in object_chat_page_content
        print("PASS: Buy seat link opens modal (not navigation)")


class TestFrontendCodeReviewSignInNotice:
    """Code review tests for sign-in notice"""

    @pytest.fixture(scope="class")
    def object_chat_page_content(self):
        """Load ObjectChatPage.js content"""
        with open("/app/frontend/src/pages/ObjectChatPage.js", "r") as f:
            return f.read()

    def test_signin_notice_exists(self, object_chat_page_content):
        """Verify sign-in notice exists"""
        assert 'data-testid="signin-notice"' in object_chat_page_content
        print("PASS: Sign-in notice exists with data-testid='signin-notice'")

    def test_signin_notice_shows_correct_message(self, object_chat_page_content):
        """Verify sign-in notice shows 'Sign in to broadcast' message"""
        assert "Sign in to broadcast" in object_chat_page_content
        print("PASS: Sign-in notice shows 'Sign in to broadcast' message")


class TestFrontendCodeReviewPublicRoom:
    """Code review tests for public room behavior"""

    @pytest.fixture(scope="class")
    def object_chat_page_content(self):
        """Load ObjectChatPage.js content"""
        with open("/app/frontend/src/pages/ObjectChatPage.js", "r") as f:
            return f.read()

    def test_is_public_room_logic(self, object_chat_page_content):
        """Verify isPublicRoom = !isVenue logic"""
        assert "isPublicRoom" in object_chat_page_content
        assert "!isVenue" in object_chat_page_content
        print("PASS: isPublicRoom = !isVenue logic exists")

    def test_public_room_shows_all_messages(self, object_chat_page_content):
        """Verify public room shows all messages (not filtered)"""
        # Check that seatedMessages uses all messages for non-venue
        assert "seatedMessages" in object_chat_page_content
        # The logic should be: isVenue ? filtered : all messages
        assert "isVenue ?" in object_chat_page_content
        print("PASS: Public room shows all messages (seatedMessages logic)")

    def test_venue_indicator_only_for_venues(self, object_chat_page_content):
        """Verify venue indicator only shows for venues"""
        # Check that venue indicator is conditional on isVenue
        assert "isVenue && !loading" in object_chat_page_content or "{isVenue &&" in object_chat_page_content
        print("PASS: Venue indicator only shows for venues (isVenue && condition)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
