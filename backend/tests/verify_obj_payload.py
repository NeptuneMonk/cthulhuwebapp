"""
Verify that the p2fk.js OBJ payload structure matches the C# OBJ class exactly.

C# OBJ class (from OBJ.cs):
  public string urn { get; set; }
  public string uri { get; set; }
  public string img { get; set; }
  public string nme { get; set; }
  public string dsc { get; set; }
  public Dictionary<string, string> atr { get; set; }
  public string lic { get; set; }
  public long max { get; set; }
  public string[] cre { get; set; }
  public Dictionary<string, long> own { get; set; }
  public Dictionary<string, decimal> roy { get; set; }

This test simulates what p2fk.js would produce and validates the types.
"""
import json
import sys


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


def test_correct_payload():
    """Test a correctly formed OBJ payload (matching C# OBJ class)."""
    print("=" * 60)
    print("TEST 1: Correct OBJ payload (no collection, no royalties)")
    print("=" * 60)
    payload = json.dumps({
        "urn": "IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4\\sup space.png",
        "nme": "Sup 4",
        "dsc": "sup test logo",
        "img": "IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4\\sup space.png",
        "uri": "http://allenvandever.com",
        "cre": ["1", "0"],  # string[] — objectAddr=1, sender=0
        "own": {"0": 100},  # Dict<string, long>
    })
    errors = validate_obj_payload(payload)
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  - {e}")
    else:
        print("PASS: All types match C# OBJ class")
    return len(errors) == 0


def test_incorrect_cre_integers():
    """Test payload with integer cre values (the BUG we're fixing)."""
    print("\n" + "=" * 60)
    print("TEST 2: Incorrect OBJ payload — cre has integers (BUG)")
    print("=" * 60)
    payload = json.dumps({
        "urn": "test-urn",
        "cre": [1, 0],  # BUG: integers instead of strings
        "own": {"0": 1},
    })
    errors = validate_obj_payload(payload)
    if errors:
        print("EXPECTED FAIL (this is the bug we fixed):")
        for e in errors:
            print(f"  - {e}")
    else:
        print("UNEXPECTED PASS — should have caught integer cre values!")
    return len(errors) > 0  # We EXPECT errors here


def test_with_collection_and_royalties():
    """Test a more complex payload with collection and royalties."""
    print("\n" + "=" * 60)
    print("TEST 3: OBJ with collection and royalties")
    print("=" * 60)
    payload = json.dumps({
        "urn": "my-nft",
        "nme": "Cool NFT",
        "dsc": "A cool NFT",
        "img": "IPFS:QmTest/image.png",
        "cre": ["3", "2", "0"],  # objectAddr=3, collection=2, sender=0
        "own": {"0": 10},
        "roy": {"4": 5.0, "5": 2.5},  # royalty addresses at indices 4 and 5
    })
    errors = validate_obj_payload(payload)
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  - {e}")
    else:
        print("PASS: All types match C# OBJ class")
    return len(errors) == 0


def test_with_max_and_attributes():
    """Test payload with max and attributes fields."""
    print("\n" + "=" * 60)
    print("TEST 4: OBJ with max and attributes")
    print("=" * 60)
    payload = json.dumps({
        "urn": "limited-edition",
        "nme": "Limited",
        "max": 100,
        "atr": {"color": "blue", "size": "large"},
        "cre": ["1", "0"],
        "own": {"0": 1},
    })
    errors = validate_obj_payload(payload)
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  - {e}")
    else:
        print("PASS: All types match C# OBJ class")
    return len(errors) == 0


if __name__ == "__main__":
    results = []
    results.append(("Correct payload", test_correct_payload()))
    results.append(("Bug detection (int cre)", test_incorrect_cre_integers()))
    results.append(("Collection + royalties", test_with_collection_and_royalties()))
    results.append(("Max + attributes", test_with_max_and_attributes()))

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    all_passed = True
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\nAll tests passed!")
        sys.exit(0)
    else:
        print("\nSome tests failed!")
        sys.exit(1)
