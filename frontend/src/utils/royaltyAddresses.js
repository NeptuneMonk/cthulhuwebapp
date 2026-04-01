/**
 * Royalty Address Management
 * Generates, stores, and manages named royalty addresses derived from the user's WIF.
 * Each royalty address is a deterministic child key: SHA256(privateKey || tag) -> P2PKH.
 *
 * SUP Compatible: These are standard P2PKH Bitcoin addresses. The P2FK protocol
 * encodes them as keyword indices in the `roy` field of OBJ transactions.
 */
import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { ecc } from './ecc';

const ECPair = ECPairFactory(ecc);
const STORAGE_PREFIX = 'cthulhu_royalty_addrs_';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function storageKey(urn, network) {
  return STORAGE_PREFIX + (urn || '').toLowerCase() + '_' + network;
}

/** Generate a deterministic royalty address from a WIF and a tag string */
export function deriveRoyaltyAddress(wif, network, tag) {
  const isMainnet = (network || '').includes('mainnet');
  const net = isMainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const cleanWif = wif.split('').filter(c => BASE58.includes(c)).join('');

  const keyPair = ECPair.fromWIF(cleanWif, net);
  const seed = Buffer.concat([keyPair.privateKey, Buffer.from(tag, 'utf-8')]);
  const childPrivKey = Buffer.from(bitcoin.crypto.sha256(seed));
  const royKP = ECPair.fromPrivateKey(childPrivKey, { network: net, compressed: true });
  return bitcoin.payments.p2pkh({ pubkey: royKP.publicKey, network: net }).address;
}

/** Get all stored royalty addresses for a user+network */
export function getRoyaltyAddresses(urn, network) {
  if (!urn || !network) return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey(urn, network))) || [];
  } catch { return []; }
}

/** Store a new royalty address. Returns the updated list. */
export function addRoyaltyAddress(urn, network, { address, tag, label }) {
  const existing = getRoyaltyAddresses(urn, network);
  if (existing.some(r => r.address === address)) return existing;
  const updated = [...existing, { address, tag, label, createdAt: Date.now() }];
  localStorage.setItem(storageKey(urn, network), JSON.stringify(updated));
  return updated;
}

/** Remove a royalty address */
export function removeRoyaltyAddress(urn, network, address) {
  const updated = getRoyaltyAddresses(urn, network).filter(r => r.address !== address);
  localStorage.setItem(storageKey(urn, network), JSON.stringify(updated));
  return updated;
}

/** Update label for a royalty address */
export function updateRoyaltyLabel(urn, network, address, newLabel) {
  const list = getRoyaltyAddresses(urn, network);
  const idx = list.findIndex(r => r.address === address);
  if (idx >= 0) {
    list[idx].label = newLabel;
    localStorage.setItem(storageKey(urn, network), JSON.stringify(list));
  }
  return list;
}

/**
 * Generate and store a new royalty address with a custom name.
 * The tag used for derivation is: `p2fk-royalties-{sanitizedLabel}-{index}`
 */
export function generateAndStoreRoyalty(wif, urn, network, label) {
  const existing = getRoyaltyAddresses(urn, network);
  const sanitized = (label || 'royalty').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const tag = `p2fk-royalties-${sanitized}-${existing.length}`;
  const address = deriveRoyaltyAddress(wif, network, tag);
  return {
    entry: { address, tag, label, createdAt: Date.now() },
    list: addRoyaltyAddress(urn, network, { address, tag, label }),
  };
}
