/**
 * Cthulhu Platform Fee Configuration
 * 
 * Fees are added as extra outputs in P2FK transactions.
 * They use non-dust amounts so the P2FK indexer ignores them.
 * This is compatible with SUP — fees sit alongside keywords without
 * interfering with the protocol (per embii's recommendation).
 */

// Fee collection address — must NEVER match the sender's address,
// otherwise the duplicate output crashes the P2FK indexer (Root.cs Dictionary.Add).
const FEE_ADDRESS_TESTNET = 'n1rh4rx6j5vXAtLFg4S1dfHyqanTUka3Tm';
const FEE_ADDRESS_MAINNET = ''; // Set a real mainnet address before enabling fees

const DUST_AMOUNT = 546;

/**
 * Get the fee collection address for the current network.
 * Returns empty string on mainnet until a real address is configured.
 */
export function getFeeAddress(networkName = 'btc-testnet') {
  return networkName.includes('mainnet') ? FEE_ADDRESS_MAINNET : FEE_ADDRESS_TESTNET;
}

/**
 * Calculate object minting fee: 25% of the total dust cost.
 * The "minting cost" = number of P2FK dust outputs * 546 sats.
 * Fee is always at least 547 sats (above dust) to avoid P2FK indexer parsing.
 * 
 * @param {number} addressCount - Number of P2FK addresses in the transaction
 * @returns {number} Fee amount in satoshis
 */
export function calcObjectMintFee(addressCount) {
  const dustTotal = DUST_AMOUNT * addressCount;
  const fee = Math.ceil(dustTotal * 0.25);
  return Math.max(fee, 547); // min 547 to stay above dust threshold
}

/**
 * Calculate buyer fee on object purchase: 0.5% of the sale price.
 * Minimum 547 sats. Returns 0 if the object is free.
 * 
 * @param {number} priceSats - Sale price in satoshis
 * @returns {number} Fee amount in satoshis
 */
export function calcBuyFee(priceSats) {
  if (!priceSats || priceSats <= 0) return 0;
  const fee = Math.ceil(priceSats * 0.005);
  return Math.max(fee, 547);
}

/**
 * Profile minting fee schedule (user-count based).
 * Currently free. Will be activated at user milestones.
 * 
 * < 1,000 users:   FREE
 * 1,000 users:     $0.25 equivalent
 * 10,000 users:    $0.50 equivalent
 * 100,000 users:   $0.75 equivalent
 * 1,000,000 users: $1.00 equivalent (remains)
 */
export function calcProfileMintFee() {
  // Currently free for all users
  return 0;
}

/**
 * Build fee extra outputs for a transaction.
 * Returns an array of { address, value } to add to extraOutputs.
 * Returns empty array if fee is 0.
 * 
 * @param {number} feeSats - Fee amount in satoshis
 * @param {string} networkName - Network name
 * @returns {Array<{address: string, value: number}>}
 */
export function buildFeeOutputs(feeSats, networkName = 'btc-testnet') {
  const addr = getFeeAddress(networkName);
  if (!feeSats || feeSats <= 0 || !addr) return [];
  return [{ address: addr, value: feeSats }];
}
