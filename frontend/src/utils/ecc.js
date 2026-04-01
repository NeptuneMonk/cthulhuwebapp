/**
 * ECC adapter for bitcoinjs-lib v7 and ecpair.
 * Uses @bitcoin-js/tiny-secp256k1-asmjs (pure ASM.js, no WASM) for maximum
 * cross-browser compatibility including mobile Safari and older devices.
 *
 * This replaces the previous custom adapter built on @noble/secp256k1 which
 * had xOnlyPointAddTweak initialization failures on some mobile browsers.
 */
import * as tinysecp from '@bitcoin-js/tiny-secp256k1-asmjs';

export const ecc = tinysecp;
