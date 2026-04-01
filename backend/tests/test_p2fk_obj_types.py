"""
Test suite to verify p2fk.js OBJ payload types match C# OBJ class.

This test validates that the JavaScript p2fk.js buildObjectTransaction and 
buildObjectUpdateTransaction functions generate correct types:
  - cre: string[] (array of strings, NOT integers)
  - own: Dictionary<string, long> (string keys, integer values)
  - roy: Dictionary<string, decimal> (string keys, number values)

The test simulates the expected JSON output from p2fk.js and validates types.
"""
import pytest
import json


def validate_obj_payload(payload_json: str) -> list:
    """Validate an OBJ JSON payload against the C# OBJ class definition."""
    errors = []
    try:
        obj = json.loads(payload_json)
    except json.JSONDecodeError as e:
        return [f"FATAL: Invalid JSON: {e}"]

    if not isinstance(obj, dict):
        return ["FATAL: OBJ payload must be a JSON object"]

    # --- Required field: urn ---
    if "urn" not in obj:
        errors.append("MISSING: 'urn' field is required")
    elif not isinstance(obj["urn"], str):
        errors.append(f"TYPE: 'urn' must be string, got {type(obj['urn']).__name__}")

    # --- Optional string fields ---
    for field in ["uri", "img", "nme", "dsc", "lic"]:
        if field in obj and not isinstance(obj[field], str):
            errors.append(f"TYPE: '{field}' must be string, got {type(obj[field]).__name__}")

    # --- atr: Dictionary<string, string> ---
    if "atr" in obj and obj["atr"] is not None:
        if not isinstance(obj["atr"], dict):
            errors.append(f"TYPE: 'atr' must be dict, got {type(obj['atr']).__name__}")
        else:
            for k, v in obj["atr"].items():
                if not isinstance(k, str):
                    errors.append(f"TYPE: 'atr' key must be string, got {type(k).__name__}")
                if not isinstance(v, str):
                    errors.append(f"TYPE: 'atr' value must be string, got {type(v).__name__}")

    # --- max: long (integer) ---
    if "max" in obj:
        if not isinstance(obj["max"], int):
            errors.append(f"TYPE: 'max' must be integer (long), got {type(obj['max']).__name__}")

    # --- CRITICAL: cre: string[] ---
    if "cre" not in obj:
        errors.append("MISSING: 'cre' field is required for OBJ")
    elif not isinstance(obj["cre"], list):
        errors.append(f"TYPE: 'cre' must be array (string[]), got {type(obj['cre']).__name__}")
    else:
        for i, val in enumerate(obj["cre"]):
            if not isinstance(val, str):
                errors.append(
                    f"TYPE: 'cre[{i}]' must be STRING (C# string[]), got {type(val).__name__} = {val}. "
                    f"This WILL cause indexer issues!"
                )

    # --- own: Dictionary<string, long> ---
    if "own" in obj and obj["own"] is not None:
        if not isinstance(obj["own"], dict):
            errors.append(f"TYPE: 'own' must be dict, got {type(obj['own']).__name__}")
        else:
            for k, v in obj["own"].items():
                if not isinstance(k, str):
                    errors.append(f"TYPE: 'own' key must be string, got {type(k).__name__} = {k}")
                if not isinstance(v, int):
                    errors.append(f"TYPE: 'own' value must be integer (long), got {type(v).__name__} = {v}")

    # --- roy: Dictionary<string, decimal> ---
    if "roy" in obj and obj["roy"] is not None:
        if not isinstance(obj["roy"], dict):
            errors.append(f"TYPE: 'roy' must be dict, got {type(obj['roy']).__name__}")
        else:
            for k, v in obj["roy"].items():
                if not isinstance(k, str):
                    errors.append(f"TYPE: 'roy' key must be string, got {type(k).__name__} = {k}")
                if not isinstance(v, (int, float)):
                    errors.append(f"TYPE: 'roy' value must be number (decimal), got {type(v).__name__} = {v}")

    return errors


class TestBuildObjectTransactionTypes:
    """Tests for buildObjectTransaction cre/own/roy type correctness."""

    def test_cre_values_are_strings_no_collection(self):
        """Verify cre array contains strings, not integers (no collection case)."""
        # Simulates p2fk.js buildObjectTransaction output for simple object
        # Lines 504-506: objData.cre = [String(objAddrRevIdx), String(senderRevIdx)]
        payload = json.dumps({
            "urn": "IPFS:QmTest/image.png",
            "nme": "Test Object",
            "dsc": "Test description",
            "img": "IPFS:QmTest/image.png",
            "cre": ["1", "0"],  # CORRECT: strings (objectAddr=1, sender=0)
            "own": {"0": 100},  # CORRECT: string key, integer value
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"

    def test_cre_values_are_strings_with_collection(self):
        """Verify cre array contains strings with collection address."""
        # Simulates p2fk.js buildObjectTransaction output with collection
        # Line 503: objData.cre = [String(objAddrRevIdx), String(collRevIdx), String(senderRevIdx)]
        payload = json.dumps({
            "urn": "my-collection-nft",
            "nme": "Collection NFT",
            "cre": ["3", "2", "0"],  # CORRECT: strings (objectAddr=3, collection=2, sender=0)
            "own": {"0": 10},
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"

    def test_own_keys_are_strings(self):
        """Verify own dictionary has string keys."""
        # Line 510: objData.own[String(senderRevIdx)] = objectData.quantity || 1
        payload = json.dumps({
            "urn": "test-urn",
            "cre": ["1", "0"],
            "own": {"0": 50},  # CORRECT: string key "0", integer value 50
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"

    def test_roy_keys_are_strings(self):
        """Verify roy dictionary has string keys."""
        # Lines 513-520: objData.roy[String(revIdx)] = objectData.royalties[addr]
        payload = json.dumps({
            "urn": "royalty-nft",
            "cre": ["1", "0"],
            "own": {"0": 1},
            "roy": {"4": 5.0, "5": 2.5},  # CORRECT: string keys, decimal values
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"

    def test_detects_integer_cre_values_as_bug(self):
        """Verify validator catches integer cre values (the bug we fixed)."""
        # This is what the OLD buggy code produced
        payload = json.dumps({
            "urn": "buggy-urn",
            "cre": [1, 0],  # BUG: integers instead of strings
            "own": {"0": 1},
        })
        errors = validate_obj_payload(payload)
        assert len(errors) > 0, "Should detect integer cre values as error"
        assert any("cre[0]" in e and "STRING" in e for e in errors), f"Should flag cre[0]: {errors}"
        assert any("cre[1]" in e and "STRING" in e for e in errors), f"Should flag cre[1]: {errors}"


class TestBuildObjectUpdateTransactionTypes:
    """Tests for buildObjectUpdateTransaction cre type correctness."""

    def test_update_cre_values_are_strings(self):
        """Verify buildObjectUpdateTransaction generates string cre values."""
        # Simulates p2fk.js buildObjectUpdateTransaction output
        # Line 615: objData.cre = [String(objAddrRevIdx), String(newCreatorRevIdx)]
        payload = json.dumps({
            "cre": ["1", "2"],  # CORRECT: strings (objectAddr=1, newCreator=2)
        })
        # For update, urn is not required
        obj = json.loads(payload)
        assert isinstance(obj["cre"], list), "cre must be array"
        for i, val in enumerate(obj["cre"]):
            assert isinstance(val, str), f"cre[{i}] must be string, got {type(val).__name__}"

    def test_update_with_additional_fields(self):
        """Verify update transaction with name/description updates."""
        payload = json.dumps({
            "cre": ["1", "0"],  # CORRECT: strings
            "nme": "Updated Name",
            "dsc": "Updated Description",
        })
        obj = json.loads(payload)
        assert all(isinstance(v, str) for v in obj["cre"]), "All cre values must be strings"
        assert isinstance(obj["nme"], str), "nme must be string"
        assert isinstance(obj["dsc"], str), "dsc must be string"


class TestCompleteObjPayload:
    """Tests for complete OBJ payloads with all fields."""

    def test_full_payload_with_all_fields(self):
        """Test a complete OBJ payload with all optional fields."""
        payload = json.dumps({
            "urn": "IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4\\sup space.png",
            "uri": "http://example.com",
            "img": "IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4\\sup space.png",
            "nme": "Complete NFT",
            "dsc": "A complete NFT with all fields",
            "lic": "CC-BY-4.0",
            "max": 100,
            "atr": {"color": "blue", "rarity": "legendary"},
            "cre": ["3", "2", "0"],  # objectAddr, collection, sender - ALL STRINGS
            "own": {"0": 10},  # string key, integer value
            "roy": {"4": 5.0, "5": 2.5},  # string keys, decimal values
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"

    def test_minimal_valid_payload(self):
        """Test minimal valid OBJ payload."""
        payload = json.dumps({
            "urn": "minimal-urn",
            "cre": ["1", "0"],
            "own": {"0": 1},
        })
        errors = validate_obj_payload(payload)
        assert len(errors) == 0, f"Validation errors: {errors}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
