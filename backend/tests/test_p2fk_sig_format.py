"""
Regression test: Verify that buildSignedPayload produces
the correct SUP-compatible SIG format.

SUP C# format:  SIG<d>88<d><88_char_sig><payload>
Wrong format:   SIG<d>88<d><88_char_sig><d><payloadLen><d><payload>

The Root.cs parser extracts fileName from text BEFORE a <delim><digits> match.
If there's an extra <d><len><d> between the signature and the payload,
the parser will see fileName="" and save the content as "MSG" instead of
the correct file name (e.g., "BUY", "GIV", "OBJ").

This test can be run standalone to verify the JS format by examining the
p2fk.js source code directly.
"""

import re
import os
import json

def test_sig_format_in_source():
    """Verify that buildSignedPayload does NOT include the extra wrapper."""
    p2fk_path = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'src', 'utils', 'p2fk.js')
    with open(p2fk_path, 'r') as f:
        source = f.read()
    
    # Find the buildSignedPayload function
    func_match = re.search(r'export function buildSignedPayload\(.*?\{(.*?)\n\}', source, re.DOTALL)
    assert func_match, "buildSignedPayload function not found in p2fk.js"
    func_body = func_match.group(1)
    
    # The prefix should be: SIG${d1}88${d2}${signature}
    # It should NOT contain: ${d3}${payloadBuf.length}${d4} or similar
    assert '${signature}${d3}' not in func_body, \
        "CRITICAL: buildSignedPayload still contains extra delimiter after signature! " \
        "This breaks P2FK indexing for all operations (BUY, GIV, BRN, LST, OBJ, PRO)."
    
    assert '${payloadBuf.length}' not in func_body, \
        "CRITICAL: buildSignedPayload still wraps payload with byte length! " \
        "Root.cs parser will misidentify named files as MSG."
    
    # Verify it ends with just the signature concatenated with payload
    assert 'SIG${d1}88${d2}${signature}`' in func_body or \
           "SIG${d1}88${d2}${signature}`" in func_body, \
        "buildSignedPayload prefix should end with signature, no extra delimiters."
    
    print("PASS: buildSignedPayload format matches SUP C# (SIG<d>88<d><sig><payload>)")


def test_lst_format_uses_strings():
    """Verify that buildListTransaction uses all-string values like SUP C#."""
    p2fk_path = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'src', 'utils', 'p2fk.js')
    with open(p2fk_path, 'r') as f:
        source = f.read()
    
    # Find the buildListTransaction function
    func_match = re.search(r'export function buildListTransaction\(.*?\n\}', source, re.DOTALL)
    assert func_match, "buildListTransaction function not found"
    func_body = func_match.group(0)
    
    # Check that lstData uses String() wrappers for numeric values
    assert 'String(quantity)' in func_body, \
        "LST quantity should be String(quantity) to match SUP C# List<List<string>> format"
    assert 'String(priceEachBtc)' in func_body, \
        "LST price should be String(priceEachBtc) to match SUP C# format"
    assert "formatD5(salt)" in func_body, \
        "LST salt should use formatD5() for D5-padded negative integer string"
    
    print("PASS: buildListTransaction uses all-string format matching SUP C#")


if __name__ == '__main__':
    test_sig_format_in_source()
    test_lst_format_uses_strings()
    print("\nAll P2FK format tests PASSED")
