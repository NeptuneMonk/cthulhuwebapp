/**
 * Unit tests for labelFromUrn function
 * Tests smart label generation from URN strings
 */

import { labelFromUrn } from './addressLabels';

describe('labelFromUrn', () => {
  // Test IPFS URN with filename (backslash separator - SUP protocol format)
  test('extracts filename from IPFS URN with backslash path', () => {
    const result = labelFromUrn('IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4\\sup space.png');
    expect(result).toBe('sup space.png');
  });

  // Test IPFS URN with filename (forward slash separator)
  test('extracts filename from IPFS URN with forward slash path', () => {
    const result = labelFromUrn('IPFS:QmXXX/image.png');
    expect(result).toBe('image.png');
  });

  // Test IPFS URN without filename (just CID)
  test('truncates IPFS CID to 15 chars when no filename', () => {
    const result = labelFromUrn('IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4');
    expect(result).toBe('QmW581VR6Zs4PmK...');
    expect(result.length).toBe(18); // 15 chars + '...'
  });

  // Test short IPFS CID (no truncation needed)
  test('does not truncate short IPFS CID', () => {
    const result = labelFromUrn('IPFS:QmShortCID');
    expect(result).toBe('QmShortCID');
  });

  // Test plain text URN truncation
  test('truncates plain text URN to 15 chars', () => {
    const result = labelFromUrn('my-cool-nft-name');
    expect(result).toBe('my-cool-nft-nam...');
  });

  // Test short plain text URN (no truncation)
  test('does not truncate short plain text URN', () => {
    const result = labelFromUrn('short-name');
    expect(result).toBe('short-name');
  });

  // Test null input
  test('returns null for null input', () => {
    const result = labelFromUrn(null);
    expect(result).toBeNull();
  });

  // Test undefined input
  test('returns null for undefined input', () => {
    const result = labelFromUrn(undefined);
    expect(result).toBeNull();
  });

  // Test empty string input
  test('returns null for empty string', () => {
    const result = labelFromUrn('');
    expect(result).toBeNull();
  });

  // Test chain-prefixed URN (BTC:)
  test('truncates BTC-prefixed URN to 18 chars', () => {
    const result = labelFromUrn('BTC:abc123def456ghi789jkl012mno345');
    expect(result).toBe('BTC:abc123def456gh...');
    expect(result.length).toBe(21); // 18 chars + '...'
  });

  // Test short chain-prefixed URN
  test('does not truncate short chain-prefixed URN', () => {
    const result = labelFromUrn('BTC:short');
    expect(result).toBe('BTC:short');
  });

  // Test case insensitivity for IPFS prefix
  test('handles lowercase ipfs prefix', () => {
    const result = labelFromUrn('ipfs:QmXXX/myfile.jpg');
    expect(result).toBe('myfile.jpg');
  });

  // Test IPFS with multiple path segments
  test('extracts last segment from multi-level IPFS path', () => {
    const result = labelFromUrn('IPFS:QmXXX/folder/subfolder/final.mp4');
    expect(result).toBe('final.mp4');
  });

  // Test IPFS with trailing slash (edge case)
  test('handles IPFS path with empty filename after slash', () => {
    // When path ends with slash, last part is empty, should fall back to CID truncation
    const result = labelFromUrn('IPFS:QmW581VR6Zs4PmKtFSscVqDy5vnVQiXR4TqxTF1As99uQ4/');
    // Empty filename after split, should use CID
    expect(result).toBe('QmW581VR6Zs4PmK...');
  });

  // Test DOG chain prefix
  test('handles DOG-prefixed URN', () => {
    const result = labelFromUrn('DOG:abc123def456ghi789jkl012');
    expect(result).toBe('DOG:abc123def456gh...');
  });

  // Test LTC chain prefix
  test('handles LTC-prefixed URN', () => {
    const result = labelFromUrn('LTC:abc123def456ghi789jkl012');
    expect(result).toBe('LTC:abc123def456gh...');
  });

  // Test exactly 15 char plain text (boundary)
  test('handles exactly 15 char plain text without truncation', () => {
    const result = labelFromUrn('exactly15chars!');
    expect(result).toBe('exactly15chars!');
  });

  // Test 16 char plain text (just over boundary)
  test('truncates 16 char plain text', () => {
    const result = labelFromUrn('exactly16chars!!');
    expect(result).toBe('exactly16chars!...');
  });
});
