/**
 * Client-side Bitcoin transaction builder for P2FK protocol.
 * Constructs multi-output transactions (546 sats per address) and signs them locally.
 * The private key NEVER leaves the browser.
 *
 * P2FK indexer rules (from Root.cs):
 *   - Only outputs with "allowed" dust values (e.g. 546 sats) are processed
 *   - The LAST dust output's address becomes SignedBy
 *   - Output.Add(address, value) uses a Dictionary — duplicate addresses crash the parser
 *   - Therefore: sender must be the last dust output, change must go to a DIFFERENT address
 *
 * Uses pure JS crypto (@noble/secp256k1) — no WASM required.
 */
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { ecc } from './ecc';
import { getUTXOs, getRawTx as explorerGetRawTx, broadcast as explorerBroadcast } from './chainExplorer';

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const DUST_AMOUNT = 546; // satoshis per P2FK output

// Both networks — used for network-agnostic WIF parsing
const BOTH_NETWORKS = [bitcoin.networks.bitcoin, bitcoin.networks.testnet];

/**
 * Parse a WIF regardless of its encoded network, then re-derive for the target network.
 * Fixes: mainnet WIF can't be parsed with testnet network param (and vice versa).
 * The private key is the same — only the WIF version byte and address format differ.
 */
function parseWIFForNetwork(wif, targetNetwork) {
  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const cleanWif = wif.split('').filter(c => BASE58.includes(c)).join('');
  // Parse with any network to extract the raw private key
  const parsed = ECPair.fromWIF(cleanWif, BOTH_NETWORKS);
  // Re-create for the target network (same private key, correct address derivation)
  return ECPair.fromPrivateKey(parsed.privateKey, { network: targetNetwork, compressed: parsed.compressed });
}

// ── Treasury / Platform Tax ────────────────────────────────────────
let _treasuryCache = {}; // { network: { address, tax_rate, ts } }

async function getTreasuryAddress(networkName) {
  const cached = _treasuryCache[networkName];
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached;
  try {
    const res = await fetch(`${API}/treasury/info?network=${networkName}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.address) return null;
    const entry = { address: data.address, tax_rate: data.tax_rate || 0.02, ts: Date.now() };
    _treasuryCache[networkName] = entry;
    return entry;
  } catch { return null; }
}

/**
 * Derive a deterministic change address from the main key.
 * SHA256(privateKey || "p2fk-change") → child private key → P2PKH address.
 * This is always recoverable from the main WIF.
 */
function deriveChangeKeyPair(keyPair, network) {
  const tag = Buffer.from('p2fk-change', 'utf-8');
  const seed = Buffer.concat([keyPair.privateKey, tag]);
  // bitcoin.crypto.sha256 returns Uint8Array; wrap in Buffer for ECPair compatibility
  const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));
  return ECPair.fromPrivateKey(childPrivKey, { network, compressed: true });
}

/**
 * Derive the primary address from a WIF key (client-side, no backend needed).
 */
export function getAddressFromWIF(wif, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  return bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
}

/**
 * Generate a brand-new random wallet (client-side, no server).
 * Returns { wif, address } for the given network.
 */
export function generateNewWallet(networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = ECPair.makeRandom({ network });
  const wif = keyPair.toWIF();
  const address = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
  return { wif, address };
}


/**
 * Derive the deterministic change address from a WIF key.
 * Exported so wallet hooks can include it in balance calculations.
 * Also persists the change address in localStorage for balance lookups without WIF.
 */
export function getChangeAddress(wif, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  const mainAddr = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
  const changeKP = deriveChangeKeyPair(keyPair, network);
  const changeAddr = bitcoin.payments.p2pkh({ pubkey: changeKP.publicKey, network }).address;
  // Persist for balance lookups without WIF
  try { localStorage.setItem(`p2fk_change_${mainAddr}`, changeAddr); } catch {}
  return changeAddr;
}

/**
 * Get the cached change address for a given main address (no WIF needed).
 */
export function getCachedChangeAddress(mainAddress) {
  try { return localStorage.getItem(`p2fk_change_${mainAddress}`) || null; } catch { return null; }
}

/**
 * Derive a deterministic royalties address from the main key.
 * SHA256(privateKey || "p2fk-royalties") → child private key → P2PKH address.
 * Only generated on first use of royalties in object creation.
 */
export function getRoyaltiesAddress(wif, networkName = 'btc-testnet') {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  const mainAddr = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address;
  const tag = Buffer.from('p2fk-royalties', 'utf-8');
  const seed = Buffer.concat([keyPair.privateKey, tag]);
  const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));
  const royKP = ECPair.fromPrivateKey(childPrivKey, { network, compressed: true });
  const royAddr = bitcoin.payments.p2pkh({ pubkey: royKP.publicKey, network }).address;
  try { localStorage.setItem(`p2fk_royalties_${mainAddr}`, royAddr); } catch {}
  return royAddr;
}

/**
 * Get the cached royalties address for a given main address (no WIF needed).
 */
export function getCachedRoyaltiesAddress(mainAddress) {
  try { return localStorage.getItem(`p2fk_royalties_${mainAddress}`) || null; } catch { return null; }
}

/**
 * Build and broadcast a simple BTC send (non-P2FK) transaction.
 */
export async function buildAndSend(wif, recipientAddress, amountSats, networkName = 'btc-testnet', feeRate = 0) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });
  const changeKeyPair = deriveChangeKeyPair(keyPair, network);
  const { address: changeAddress } = bitcoin.payments.p2pkh({ pubkey: changeKeyPair.publicKey, network });

  // Use selected fee rate from FeePicker (sessionStorage), fallback to 3
  let effectiveFeeRate = feeRate;
  if (!effectiveFeeRate || effectiveFeeRate <= 0) {
    try {
      const stored = sessionStorage.getItem('cthulhu_fee_rate');
      effectiveFeeRate = stored ? Math.max(parseInt(stored, 10), 3) : 3;
    } catch { effectiveFeeRate = 3; }
  }

  // Platform tax for regular sends
  let sendTaxOutput = null;
  try {
    const treasury = await getTreasuryAddress(networkName);
    if (treasury && treasury.address && treasury.address !== senderAddress
        && treasury.address !== changeAddress && treasury.address !== recipientAddress) {
      const TAX_MIN = 647; // above walkie-talkie channel range (546-646)
      const taxAmt = Math.max(Math.ceil(amountSats * treasury.tax_rate), TAX_MIN);
      sendTaxOutput = { address: treasury.address, value: taxAmt };
    }
  } catch { /* best-effort */ }
  const sendTaxTotal = sendTaxOutput ? sendTaxOutput.value : 0;

  // Derive royalties address for additional UTXO scanning
  const royTag = Buffer.from('p2fk-royalties', 'utf-8');
  const roySeed = Buffer.concat([keyPair.privateKey, royTag]);
  const royPrivKey = Buffer.from(bitcoin.crypto.sha256(roySeed));
  const royKeyPair = ECPair.fromPrivateKey(royPrivKey, { network, compressed: true });
  const { address: royaltiesAddress } = bitcoin.payments.p2pkh({ pubkey: royKeyPair.publicKey, network });

  const [mainUtxos, changeUtxos, royaltyUtxos] = await Promise.all([
    fetchUtxos(senderAddress, networkName),
    fetchUtxos(changeAddress, networkName),
    fetchUtxos(royaltiesAddress, networkName),
  ]);

  const allUtxos = [
    ...mainUtxos.map(u => ({ ...u, source: 'main' })),
    ...changeUtxos.map(u => ({ ...u, source: 'change' })),
    ...royaltyUtxos.map(u => ({ ...u, source: 'royalty' })),
  ];
  if (!allUtxos.length) throw new Error('No UTXOs available.');

  allUtxos.sort((a, b) => {
    const aConf = a.status?.confirmed ? 1 : 0;
    const bConf = b.status?.confirmed ? 1 : 0;
    if (aConf !== bConf) return bConf - aConf;
    return b.value - a.value;
  });

  const totalSendAmount = amountSats + sendTaxTotal;
  const numOutputs = 2 + (sendTaxOutput ? 1 : 0); // recipient + change + optional tax
  const outputVBytes = numOutputs * 34 + 10;

  const selectedUtxos = [];
  let selectedTotal = 0;
  for (const utxo of allUtxos) {
    selectedUtxos.push(utxo);
    selectedTotal += utxo.value;
    const txSize = selectedUtxos.length * 148 + outputVBytes;
    const fee = Math.max(txSize * effectiveFeeRate, 300);
    if (selectedTotal >= totalSendAmount + fee) break;
  }

  const estimatedTxSize = selectedUtxos.length * 148 + outputVBytes;
  const estimatedFee = Math.max(estimatedTxSize * effectiveFeeRate, 300);

  if (selectedTotal < totalSendAmount + estimatedFee) {
    throw new Error(`Insufficient balance. Need ~${totalSendAmount + estimatedFee} sats, have ${selectedTotal} sats.`);
  }

  const psbt = new bitcoin.Psbt({ network });
  const rawTxHexes = await Promise.all(selectedUtxos.map(u => fetchRawTx(u.txid, networkName)));
  for (let i = 0; i < selectedUtxos.length; i++) {
    psbt.addInput({ hash: selectedUtxos[i].txid, index: selectedUtxos[i].vout, nonWitnessUtxo: Buffer.from(rawTxHexes[i], 'hex') });
  }

  psbt.addOutput({ address: recipientAddress, value: BigInt(amountSats) });
  if (sendTaxOutput) {
    psbt.addOutput({ address: sendTaxOutput.address, value: BigInt(sendTaxOutput.value) });
  }
  const change = selectedTotal - totalSendAmount - estimatedFee;
  if (change >= DUST_AMOUNT) {
    psbt.addOutput({ address: changeAddress, value: BigInt(change) });
  }

  for (let i = 0; i < selectedUtxos.length; i++) {
    const src = selectedUtxos[i].source;
    const signingKey = src === 'change' ? changeKeyPair : src === 'royalty' ? royKeyPair : keyPair;
    psbt.signInput(i, signingKey);
  }

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  const result = await broadcastTx(txHex, networkName);
  if (sendTaxTotal > 0 && result.txid) {
    fetch(`${API}/treasury/log-tax`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: result.txid, amount_sats: sendTaxTotal, network: networkName, tx_type: 'send' }),
    }).catch(() => {});
  }
  return result;
}

/**
 * Build and broadcast a send transaction using manually selected UTXOs (coin control).
 * Preserves P2FK sendmany address ordering — no scrambling.
 * Each UTXO carries its ownerAddress so the correct signing key is used.
 */
export async function buildAndSendWithUtxos(wif, recipientAddress, amountSats, selectedUtxos, networkName = 'btc-testnet', feeRate = 0) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });
  const changeKeyPair = deriveChangeKeyPair(keyPair, network);
  const { address: changeAddress } = bitcoin.payments.p2pkh({ pubkey: changeKeyPair.publicKey, network });

  // Use selected fee rate from FeePicker (sessionStorage), fallback to 3
  let effectiveFeeRate = feeRate;
  if (!effectiveFeeRate || effectiveFeeRate <= 0) {
    try {
      const stored = sessionStorage.getItem('cthulhu_fee_rate');
      effectiveFeeRate = stored ? Math.max(parseInt(stored, 10), 3) : 3;
    } catch { effectiveFeeRate = 3; }
  }

  // Derive royalties key for signing royalty UTXOs
  const royTag = Buffer.from('p2fk-royalties', 'utf-8');
  const roySeed = Buffer.concat([keyPair.privateKey, royTag]);
  const royPrivKey = Buffer.from(bitcoin.crypto.sha256(roySeed));
  const royKeyPair = ECPair.fromPrivateKey(royPrivKey, { network, compressed: true });
  const { address: royaltiesAddress } = bitcoin.payments.p2pkh({ pubkey: royKeyPair.publicKey, network });

  if (!selectedUtxos.length) throw new Error('No UTXOs selected.');

  // Platform tax
  let sendTaxOutput = null;
  try {
    const treasury = await getTreasuryAddress(networkName);
    if (treasury && treasury.address && treasury.address !== senderAddress
        && treasury.address !== changeAddress && treasury.address !== recipientAddress) {
      const TAX_MIN = 647;
      const taxAmt = Math.max(Math.ceil(amountSats * treasury.tax_rate), TAX_MIN);
      sendTaxOutput = { address: treasury.address, value: taxAmt };
    }
  } catch {}
  const sendTaxTotal = sendTaxOutput ? sendTaxOutput.value : 0;

  const totalSendAmount = amountSats + sendTaxTotal;
  const numOutputs = 2 + (sendTaxOutput ? 1 : 0);
  const estimatedTxSize = selectedUtxos.length * 148 + numOutputs * 34 + 10;
  const estimatedFee = Math.max(estimatedTxSize * effectiveFeeRate, 300);
  const selectedTotal = selectedUtxos.reduce((sum, u) => sum + u.value, 0);

  if (selectedTotal < totalSendAmount + estimatedFee) {
    throw new Error(`Insufficient selected balance. Need ~${totalSendAmount + estimatedFee} sats, have ${selectedTotal} sats.`);
  }

  // Build PSBT
  const psbt = new bitcoin.Psbt({ network });
  const rawTxHexes = await Promise.all(selectedUtxos.map(u => fetchRawTx(u.txid, networkName)));

  for (let i = 0; i < selectedUtxos.length; i++) {
    psbt.addInput({
      hash: selectedUtxos[i].txid,
      index: selectedUtxos[i].vout,
      nonWitnessUtxo: Buffer.from(rawTxHexes[i], 'hex'),
    });
  }

  // Outputs — preserved ordering (no scrambling)
  psbt.addOutput({ address: recipientAddress, value: BigInt(amountSats) });
  if (sendTaxOutput) {
    psbt.addOutput({ address: sendTaxOutput.address, value: BigInt(sendTaxOutput.value) });
  }
  const change = selectedTotal - totalSendAmount - estimatedFee;
  if (change >= DUST_AMOUNT) {
    psbt.addOutput({ address: changeAddress, value: BigInt(change) });
  }

  // Sign each input with the correct key
  for (let i = 0; i < selectedUtxos.length; i++) {
    const utxo = selectedUtxos[i];
    if (utxo.ownerAddress === changeAddress) {
      psbt.signInput(i, changeKeyPair);
    } else if (utxo.ownerAddress === royaltiesAddress) {
      psbt.signInput(i, royKeyPair);
    } else {
      psbt.signInput(i, keyPair);
    }
  }

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  const result = await broadcastTx(txHex, networkName);
  if (sendTaxTotal > 0 && result.txid) {
    fetch(`${API}/treasury/log-tax`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid: result.txid, amount_sats: sendTaxTotal, network: networkName, tx_type: 'send_utxo' }),
    }).catch(() => {});
  }
  return result;
}


/**
 * Build and broadcast a multi-recipient transaction from the main wallet.
 * Used for UTXO splitting (e.g., loading phone wallet with multiple outputs).
 * @param {string} wif - Main wallet private key
 * @param {{address: string, amount: number}[]} recipients - Array of outputs
 * @param {string} networkName
 * @param {number} feeRate
 */
export async function buildMultiSend(wif, recipients, networkName = 'btc-testnet', feeRate = 2) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const keyPair = parseWIFForNetwork(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });
  const changeKeyPair = deriveChangeKeyPair(keyPair, network);
  const { address: changeAddress } = bitcoin.payments.p2pkh({ pubkey: changeKeyPair.publicKey, network });

  // Derive royalties key for signing royalty UTXOs
  const royTag = Buffer.from('p2fk-royalties', 'utf-8');
  const roySeed = Buffer.concat([keyPair.privateKey, royTag]);
  const royPrivKey = Buffer.from(bitcoin.crypto.sha256(roySeed));
  const royKeyPair = ECPair.fromPrivateKey(royPrivKey, { network, compressed: true });
  const { address: royaltiesAddress } = bitcoin.payments.p2pkh({ pubkey: royKeyPair.publicKey, network });

  const [mainUtxos, changeUtxos, royaltyUtxos] = await Promise.all([
    fetchUtxos(senderAddress, networkName),
    fetchUtxos(changeAddress, networkName),
    fetchUtxos(royaltiesAddress, networkName),
  ]);

  const allUtxos = [
    ...mainUtxos.map(u => ({ ...u, source: 'main' })),
    ...changeUtxos.map(u => ({ ...u, source: 'change' })),
    ...royaltyUtxos.map(u => ({ ...u, source: 'royalty' })),
  ];
  if (!allUtxos.length) throw new Error('No UTXOs available.');

  // Sort: confirmed first, then largest first
  allUtxos.sort((a, b) => {
    const aConf = a.status?.confirmed ? 1 : 0;
    const bConf = b.status?.confirmed ? 1 : 0;
    if (aConf !== bConf) return bConf - aConf;
    return b.value - a.value;
  });

  const totalSend = recipients.reduce((sum, r) => sum + r.amount, 0);
  const outputVBytes = (recipients.length + 1) * 34 + 10;

  // Select minimum UTXOs needed
  const selectedUtxos = [];
  let selectedTotal = 0;
  for (const utxo of allUtxos) {
    selectedUtxos.push(utxo);
    selectedTotal += utxo.value;
    const txSize = selectedUtxos.length * 148 + outputVBytes;
    const fee = Math.max(txSize * feeRate, 300);
    if (selectedTotal >= totalSend + fee) break;
  }

  const estimatedTxSize = selectedUtxos.length * 148 + outputVBytes;
  const estimatedFee = Math.max(estimatedTxSize * feeRate, 300);

  if (selectedTotal < totalSend + estimatedFee) {
    throw new Error(`Insufficient balance. Need ~${totalSend + estimatedFee} sats, have ${selectedTotal} sats.`);
  }

  const psbt = new bitcoin.Psbt({ network });
  const rawTxHexes = await Promise.all(selectedUtxos.map(u => fetchRawTx(u.txid, networkName)));
  for (let i = 0; i < selectedUtxos.length; i++) {
    psbt.addInput({ hash: selectedUtxos[i].txid, index: selectedUtxos[i].vout, nonWitnessUtxo: Buffer.from(rawTxHexes[i], 'hex') });
  }

  for (const { address, amount } of recipients) {
    psbt.addOutput({ address, value: BigInt(amount) });
  }

  const change = selectedTotal - totalSend - estimatedFee;
  if (change >= DUST_AMOUNT) {
    psbt.addOutput({ address: changeAddress, value: BigInt(change) });
  }

  for (let i = 0; i < selectedUtxos.length; i++) {
    const src = selectedUtxos[i].source;
    const signingKey = src === 'change' ? changeKeyPair : src === 'royalty' ? royKeyPair : keyPair;
    psbt.signInput(i, signingKey);
  }

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  return broadcastTx(txHex, networkName);
}

/**
 * Fetch UTXOs for an address via the Smart Composite Explorer (no backend proxy).
 */
export async function fetchUtxos(address, networkName = 'btc-testnet') {
  try {
    const utxos = await getUTXOs(address, networkName);
    // Map to shape expected by consumers: { txid, vout, value, status: { confirmed } }
    return utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      status: { confirmed: u.confirmed },
    }));
  } catch (err) {
    console.warn(`[UTXO] Explorer fetch error for ${address}:`, err.message);
    return [];
  }
}

/**
 * Broadcast a signed raw transaction hex via the Smart Composite Explorer (no backend proxy).
 * Includes error classification for mempool rejection handling.
 */
export async function broadcastTx(txHex, networkName = 'btc-testnet') {
  try {
    const txid = await explorerBroadcast(txHex, networkName);
    // Explorer returns raw txid string — normalize
    const cleanTxid = (txid || '').replace(/"/g, '').trim();
    return { success: true, txid: cleanTxid };
  } catch (err) {
    const msg = err.message || 'Broadcast failed';
    if (msg.includes('too-long-mempool-chain') || msg.includes('too many unconfirmed ancestors')) {
      throw new Error('Too many pending transactions. Wait for a block confirmation (~10 min) before making new transactions.');
    }
    if (msg.includes('insufficient fee') || msg.includes('rejecting replacement')) {
      const retryErr = new Error('fee_too_low');
      retryErr.retryable = true;
      throw retryErr;
    }
    throw new Error(msg);
  }
}

/**
 * Fetch raw transaction hex for PSBT input construction via the Smart Composite Explorer.
 */
async function fetchRawTx(txid, networkName = 'btc-testnet') {
  const hex = await explorerGetRawTx(txid, networkName);
  return typeof hex === 'string' ? hex.trim() : String(hex);
}

/**
 * Build, sign, and broadcast a P2FK transaction entirely client-side.
 *
 * targetAddresses MUST already include the sender as the LAST element.
 * All targetAddresses receive 546-sat dust outputs.
 * Change goes to a deterministic child address (to avoid duplicate output addresses).
 *
 * @param {string} wif - The wallet's private key in WIF format
 * @param {string[]} targetAddresses - P2FK addresses (sender is LAST)
 * @param {string} networkName - 'btc-testnet' or 'btc-mainnet'
 * @param {Array<{address: string, value: number}>} extraOutputs - Additional outputs (e.g. BUY payment)
 * @param {number} feeRate - Fee rate in sat/vB (default: 2)
 * @param {number} dustAmount - Dust amount in satoshis (default: 546)
 * @param {string[]} postPaymentDustAddresses - Dust addresses to add AFTER payment outputs (for BUY tx ordering)
 * @param {number} taxInsertIndex - Position in targetAddresses to insert tax output (-1 = after all targets, before extras)
 * @param {Set<string>} excludeUtxoIds - Set of "txid:vout" strings to skip (for sequential burns)
 * @param {Array} syntheticUtxos - Extra UTXOs not yet in API (e.g. change from prev tx). Each: {txid, vout, value, rawTxHex, source}
 */
export async function buildAndBroadcast(wif, targetAddresses, networkName = 'btc-testnet', extraOutputs = [], feeRate = 0, dustAmount = 546, postPaymentDustAddresses = [], taxInsertIndex = -1, excludeUtxoIds = null, syntheticUtxos = null) {
  const isMainnet = networkName.includes('mainnet');
  const network = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  // Network-agnostic WIF parsing — works even if WIF is mainnet but target is testnet
  const keyPair = parseWIFForNetwork(wif, network);
  const { address: senderAddress } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network });

  // Derive deterministic change address (always recoverable from WIF)
  const changeKeyPair = deriveChangeKeyPair(keyPair, network);
  const { address: changeAddress } = bitcoin.payments.p2pkh({ pubkey: changeKeyPair.publicKey, network });

  // Derive royalties address (another potential source of funds)
  const royTag = Buffer.from('p2fk-royalties', 'utf-8');
  const roySeed = Buffer.concat([keyPair.privateKey, royTag]);
  const royPrivKey = Buffer.from(bitcoin.crypto.sha256(roySeed));
  const royKeyPair = ECPair.fromPrivateKey(royPrivKey, { network, compressed: true });
  const { address: royaltiesAddress } = bitcoin.payments.p2pkh({ pubkey: royKeyPair.publicKey, network });

  // Fetch UTXOs from ALL known addresses (main, change, royalties)
  const [mainUtxos, changeUtxos, royaltyUtxos] = await Promise.all([
    fetchUtxos(senderAddress, networkName),
    fetchUtxos(changeAddress, networkName),
    fetchUtxos(royaltiesAddress, networkName),
  ]);

  console.log(`[UTXO] main(${senderAddress}): ${mainUtxos.length}, change(${changeAddress}): ${changeUtxos.length}, royalty(${royaltiesAddress}): ${royaltyUtxos.length}`);

  // Tag each UTXO with its source for correct signing
  let allUtxos = [
    ...mainUtxos.map(u => ({ ...u, source: 'main' })),
    ...changeUtxos.map(u => ({ ...u, source: 'change' })),
    ...royaltyUtxos.map(u => ({ ...u, source: 'royalty' })),
  ];
  // Filter out previously-spent UTXOs (for sequential batch operations)
  if (excludeUtxoIds && excludeUtxoIds.size > 0) {
    allUtxos = allUtxos.filter(u => !excludeUtxoIds.has(`${u.txid}:${u.vout}`));
  }
  // Add synthetic UTXOs (change outputs from previous sequential transactions)
  if (syntheticUtxos && syntheticUtxos.length > 0) {
    for (const su of syntheticUtxos) {
      allUtxos.push({ txid: su.txid, vout: su.vout, value: su.value, status: { confirmed: false }, source: su.source || 'change', _rawTxHex: su.rawTxHex });
    }
  }

  if (!allUtxos.length) {
    throw new Error(`No UTXOs available across main(${senderAddress}), change(${changeAddress}), royalties(${royaltiesAddress}).`);
  }

  const dustTotal = dustAmount * targetAddresses.length;

  // CRITICAL: Handle address conflicts between dust outputs and extra outputs.
  // The P2FK indexer (Root.cs) uses Dictionary.Add(address, value) which THROWS
  // on duplicate keys. Bitcoin allows multiple outputs to the same address, but
  // the indexer doesn't. So we must merge amounts for duplicate addresses.
  //
  // Strategy: If an extra output's address is already a dust target, it means
  // it's both a P2FK data address AND a payment recipient. In this case, the
  // dust output remains as-is (for P2FK indexing), and the extra payment is
  // kept separately (since P2FK indexer only looks at dust-value outputs for decoding).
  // Extra outputs with value > dustAmount will be ignored by the indexer.
  //
  // BUT: If an extra output happens to be exactly dustAmount (546), it would be
  // treated as a P2FK data output and corrupt the decode. So we ensure all extra
  // outputs are > dustAmount.
  const usedAddresses = new Set([...targetAddresses, changeAddress]);
  const safeExtraOutputs = [];
  for (const out of extraOutputs) {
    if (usedAddresses.has(out.address)) {
      // Address conflict: this address already receives dust.
      // Add the payment as a separate output ONLY if it's above dust threshold.
      // If it equals dustAmount, bump it to dustAmount + 1 to avoid P2FK indexer
      // treating it as a data output.
      const safeValue = out.value === dustAmount ? dustAmount + 1 : out.value;
      if (safeValue > dustAmount) {
        safeExtraOutputs.push({ address: out.address, value: safeValue });
      }
      // If safeValue <= dustAmount (shouldn't happen after the bump), skip it
    } else {
      // No conflict — ensure value is above dust to avoid P2FK indexer confusion
      const safeValue = out.value === dustAmount ? dustAmount + 1 : out.value;
      safeExtraOutputs.push({ address: out.address, value: safeValue });
    }
  }
  const extraTotal = safeExtraOutputs.reduce((sum, o) => sum + o.value, 0);
  // Post-payment dust: addresses added AFTER payment outputs (for BUY tx ordering)
  const postDustTotal = dustAmount * postPaymentDustAddresses.length;

  // ── Platform tax: 2% of total outputs or 647 sats, whichever is greater ──
  // Skip tax for non-standard dust amounts (e.g., Walkie-Talkie channel frequencies)
  // Skip tax entirely when taxInsertIndex === -1 (burns don't have tax per SUP protocol)
  let taxOutput = null;
  if (dustAmount === 546 && taxInsertIndex !== -1) {
    try {
      const treasury = await getTreasuryAddress(networkName);
      if (treasury && treasury.address && treasury.address !== senderAddress && treasury.address !== changeAddress) {
        const totalBeforeTax = dustTotal + extraTotal + postDustTotal;
        const TAX_MIN = 647; // above walkie-talkie channel range (546-646)
        const taxAmount = Math.max(Math.ceil(totalBeforeTax * treasury.tax_rate), TAX_MIN);
        taxOutput = { address: treasury.address, value: taxAmount };
      }
    } catch { /* tax is best-effort, don't block the transaction */ }
  }
  const taxTotal = taxOutput ? taxOutput.value : 0;

  const totalOutputs = dustTotal + extraTotal + postDustTotal + taxTotal;

  // +1 for change, +1 for tax (if applicable)
  const outputCount = targetAddresses.length + safeExtraOutputs.length + postPaymentDustAddresses.length + (taxOutput ? 1 : 0) + 1;
  const outputVBytes = outputCount * 34 + 10;

  // Use provided feeRate, or fetch auto fee, or fallback to 3 (was 2, bumped for RBF safety)
  let effectiveFeeRate = feeRate;
  if (!effectiveFeeRate || effectiveFeeRate <= 0) {
    try {
      const stored = sessionStorage.getItem('cthulhu_fee_rate');
      effectiveFeeRate = stored ? Math.max(parseInt(stored, 10), 3) : 3;
    } catch { effectiveFeeRate = 3; }
  }

  // Sort UTXOs: confirmed first (shorter ancestor chain), then largest first.
  // This ensures we use the most reliable, highest-value UTXOs regardless of
  // which address they sit in (main, change, or royalty).
  allUtxos.sort((a, b) => {
    const aConf = a.status?.confirmed ? 1 : 0;
    const bConf = b.status?.confirmed ? 1 : 0;
    if (aConf !== bConf) return bConf - aConf;
    return b.value - a.value;
  });

  // Select minimum UTXOs needed (avoids consolidating long unconfirmed chains)
  const selectedUtxos = [];
  let selectedTotal = 0;
  for (const utxo of allUtxos) {
    selectedUtxos.push(utxo);
    selectedTotal += utxo.value;
    const txSize = selectedUtxos.length * 148 + outputVBytes;
    const fee = Math.max(txSize * effectiveFeeRate, 300);
    if (selectedTotal >= totalOutputs + fee + DUST_AMOUNT) break;
  }

  const estimatedTxSize = selectedUtxos.length * 148 + outputVBytes;
  const estimatedFee = Math.max(estimatedTxSize * effectiveFeeRate, 300);

  if (selectedTotal < totalOutputs + estimatedFee + DUST_AMOUNT) {
    throw new Error(`Insufficient balance: need ~${totalOutputs + estimatedFee + DUST_AMOUNT} sats, have ${selectedTotal} sats. Fund your wallet and try again.`);
  }

  const psbt = new bitcoin.Psbt({ network });

  // Add inputs — need raw TX hex for each UTXO
  // Synthetic UTXOs already carry their rawTxHex; API UTXOs need to be fetched
  const rawTxHexes = await Promise.all(selectedUtxos.map(u => u._rawTxHex ? Promise.resolve(u._rawTxHex) : fetchRawTx(u.txid, networkName)));
  for (let i = 0; i < selectedUtxos.length; i++) {
    psbt.addInput({
      hash: selectedUtxos[i].txid,
      index: selectedUtxos[i].vout,
      nonWitnessUtxo: Buffer.from(rawTxHexes[i], 'hex'),
      sequence: 0xfffffffd, // Enable BIP125 RBF for fee bumping
    });
  }

  // Add P2FK dust outputs — with tax inserted at the correct position per embii:
  // [encoded data] → [keywords] → [TAX 647] → [object/creator/sender] → [change]
  const effectiveTaxIdx = taxInsertIndex >= 0 ? taxInsertIndex : targetAddresses.length;
  for (let i = 0; i < targetAddresses.length; i++) {
    if (i === effectiveTaxIdx && taxOutput) {
      // Insert platform tax at the "sweet spot" — after keywords, before special addresses
      psbt.addOutput({ address: taxOutput.address, value: BigInt(taxOutput.value) });
    }
    psbt.addOutput({ address: targetAddresses[i], value: BigInt(dustAmount) });
  }
  // If taxInsertIndex == targetAddresses.length, insert after all targets
  if (effectiveTaxIdx >= targetAddresses.length && taxOutput) {
    psbt.addOutput({ address: taxOutput.address, value: BigInt(taxOutput.value) });
  }

  // Add extra outputs (e.g. BUY payment to owner, platform fees)
  // Duplicates already filtered above to avoid crashing the P2FK indexer.
  for (const out of safeExtraOutputs) {
    psbt.addOutput({ address: out.address, value: BigInt(out.value) });
  }

  // Add post-payment dust outputs (BUY tx: objectAddress + senderAddress AFTER payments)
  // This ensures objectAddress lands at Output.Count-2 or Count-3 as required by OBJ.cs
  for (const addr of postPaymentDustAddresses) {
    psbt.addOutput({ address: addr, value: BigInt(dustAmount) });
  }

  // Change goes to the derived change address (NOT the sender — avoids duplicate key in indexer)
  // CRITICAL: Change must NOT be exactly dustAmount (546), or the indexer would treat it
  // as a P2FK data output and corrupt the decode. If change is exactly 546, bump to 547.
  let change = selectedTotal - totalOutputs - estimatedFee;
  if (change === dustAmount) change = dustAmount + 1; // avoid indexer confusion
  if (change > dustAmount) {
    psbt.addOutput({ address: changeAddress, value: BigInt(change) });
  }
  // If change <= dustAmount (and not equal), it becomes extra miner fee

  // Sign all inputs — use source tag to determine which key pair
  for (let i = 0; i < selectedUtxos.length; i++) {
    const src = selectedUtxos[i].source;
    const signingKey = src === 'change' ? changeKeyPair : src === 'royalty' ? royKeyPair : keyPair;
    psbt.signInput(i, signingKey);
  }

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();

  // Broadcast with auto-retry: if mempool rejects due to low fee, rebuild with higher rate
  try {
    const result = await broadcastTx(txHex, networkName);
    // Don't clear fee rate — user's selected rate should persist across transactions
    // Track which UTXOs were consumed for sequential batch operations
    const spentUtxoIds = new Set(selectedUtxos.map(u => `${u.txid}:${u.vout}`));
    // Build change output info for chaining sequential transactions
    let changeUtxo = null;
    if (change > dustAmount) {
      // Count actual outputs to find change vout
      let changeVout = targetAddresses.length + safeExtraOutputs.length + postPaymentDustAddresses.length + (taxOutput ? 1 : 0);
      changeUtxo = { txid: result.txid, vout: changeVout, value: change, rawTxHex: txHex, source: 'change' };
    }
    // Log tax payment to treasury ledger (best-effort, non-blocking)
    if (taxTotal > 0 && result.txid) {
      fetch(`${API}/treasury/log-tax`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: result.txid, amount_sats: taxTotal, network: networkName, tx_type: 'p2fk' }),
      }).catch(() => {});
    }
    return { ...result, addressCount: targetAddresses.length, costSats: totalOutputs, platformFee: taxTotal, spentUtxoIds, changeUtxo };
  } catch (err) {
    if (err.retryable && effectiveFeeRate < 10) {
      // Retry with bumped fee rate (cap at 10 sat/vB — not 20)
      const bumpedRate = Math.min(effectiveFeeRate + 2, 10);
      try { sessionStorage.setItem('cthulhu_fee_rate', String(bumpedRate)); } catch {}
      return buildAndBroadcast(wif, targetAddresses, networkName, extraOutputs, bumpedRate, dustAmount, postPaymentDustAddresses, taxInsertIndex, excludeUtxoIds, syntheticUtxos);
    }
    // Non-retryable or already at max fee — throw with user-friendly message
    if (err.retryable) {
      throw new Error('A previous transaction is still pending. Wait for it to confirm (~10 min), or try again.');
    }
    throw err;
  }
}

// ── Pending Transaction Tracking ──────────────────────────────────────

const PENDING_TX_KEY = 'cthulhu_pending_txs';

/**
 * Save a broadcasted transaction to the pending list.
 * @param {{ txid: string, type: string, label: string, network: string, address?: string }} meta
 */
export function addPendingTx(meta) {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_TX_KEY) || '[]');
    list.push({ ...meta, createdAt: Date.now() });
    // Cap at 50 entries
    if (list.length > 50) list.splice(0, list.length - 50);
    localStorage.setItem(PENDING_TX_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('pending-tx-changed'));
  } catch {}
}

/**
 * Get all pending transactions.
 */
export function getPendingTxs() {
  try { return JSON.parse(localStorage.getItem(PENDING_TX_KEY) || '[]'); } catch { return []; }
}

/**
 * Remove a transaction from the pending list (e.g., after confirmation).
 */
export function removePendingTx(txid) {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_TX_KEY) || '[]');
    const filtered = list.filter(t => t.txid !== txid);
    localStorage.setItem(PENDING_TX_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new Event('pending-tx-changed'));
  } catch {}
}

/**
 * Clear all pending transactions.
 */
export function clearPendingTxs() {
  try {
    localStorage.setItem(PENDING_TX_KEY, '[]');
    window.dispatchEvent(new Event('pending-tx-changed'));
  } catch {}
}
