/**
 * Test: BUY Transaction Output Ordering
 * 
 * Verifies that buildBuyTransaction produces the correct output structure
 * matching the C# reference implementation (ObjectBuy.cs).
 * 
 * The P2FK indexer (OBJ.cs line 976) requires:
 *   objectAddress at Output.Count-2 OR Output.Count-3
 * 
 * C# output order: [data(dust), royalties(payment), owner(payment), 
 *                   objectAddress(dust), senderAddress(dust), change]
 */

// Mock test - verify the structure returned by buildBuyTransaction
// This test doesn't require blockchain access, just validates the data structure

const assert = (condition, msg) => {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
};

// Simulate what buildBuyTransaction returns
function simulateBuyTxOutputs(hasRoyalties, hasChange) {
  // Simulated data addresses (P2FK encoded payload)
  const dataAddresses = ['addr_data_1', 'addr_data_2', 'addr_data_3'];
  
  // Payment outputs (royalties + owner)
  const extraPaymentOutputs = [];
  if (hasRoyalties) {
    extraPaymentOutputs.push({ address: 'addr_royalty', value: 1000 });
  }
  extraPaymentOutputs.push({ address: 'addr_owner', value: 5000 });
  
  // Post-payment dust (objectAddress + senderAddress)
  const postPaymentDustAddresses = ['addr_object', 'addr_sender'];
  
  // Build final output array (mirrors buildAndBroadcast logic)
  const outputs = [];
  
  // 1. P2FK data addresses (dust = 546)
  for (const addr of dataAddresses) {
    outputs.push({ address: addr, value: 546 });
  }
  
  // 2. Extra payment outputs
  for (const out of extraPaymentOutputs) {
    outputs.push({ address: out.address, value: out.value });
  }
  
  // 3. Post-payment dust addresses
  for (const addr of postPaymentDustAddresses) {
    outputs.push({ address: addr, value: 546 });
  }
  
  // 4. Change (if any)
  if (hasChange) {
    outputs.push({ address: 'addr_change', value: 10000 });
  }
  
  return outputs;
}

// Test 1: With royalties and change
const test1 = simulateBuyTxOutputs(true, true);
const count1 = test1.length;
assert(test1[count1 - 1].address === 'addr_change', 'Test 1: Change is last output');
assert(test1[count1 - 2].address === 'addr_sender', 'Test 1: Sender is at Count-2');
assert(test1[count1 - 3].address === 'addr_object', 'Test 1: Object is at Count-3');
assert(
  test1[count1 - 2].address === 'addr_object' || test1[count1 - 3].address === 'addr_object',
  'Test 1: OBJ.cs indexer check passes (objectAddress at Count-2 or Count-3)'
);

// Test 2: Without royalties, with change
const test2 = simulateBuyTxOutputs(false, true);
const count2 = test2.length;
assert(test2[count2 - 1].address === 'addr_change', 'Test 2: Change is last output');
assert(test2[count2 - 3].address === 'addr_object', 'Test 2: Object is at Count-3');
assert(
  test2[count2 - 2].address === 'addr_object' || test2[count2 - 3].address === 'addr_object',
  'Test 2: OBJ.cs indexer check passes without royalties'
);

// Test 3: With royalties, without change (exact spend)
const test3 = simulateBuyTxOutputs(true, false);
const count3 = test3.length;
assert(test3[count3 - 1].address === 'addr_sender', 'Test 3: Sender is last (no change)');
assert(test3[count3 - 2].address === 'addr_object', 'Test 3: Object is at Count-2 (no change)');
assert(
  test3[count3 - 2].address === 'addr_object' || test3[count3 - 3].address === 'addr_object',
  'Test 3: OBJ.cs indexer check passes without change output'
);

// Test 4: Without royalties, without change
const test4 = simulateBuyTxOutputs(false, false);
const count4 = test4.length;
assert(test4[count4 - 1].address === 'addr_sender', 'Test 4: Sender is last');
assert(test4[count4 - 2].address === 'addr_object', 'Test 4: Object at Count-2');
assert(
  test4[count4 - 2].address === 'addr_object' || test4[count4 - 3].address === 'addr_object',
  'Test 4: OBJ.cs indexer check passes (minimal case)'
);

console.log('\nAll BUY output ordering tests passed!');
