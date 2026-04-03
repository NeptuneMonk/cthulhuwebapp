# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform (Cthulhu). 100% client-side signing, SQLite backend cache, local P2FK decoder, IPFS pinning, multi-chain support. "The blockchain is the database. IPFS is the file system. Our server is just a read cache."

## Core Architecture
- **Frontend**: React (CRA with config-overrides for crypto polyfills)
- **Backend**: FastAPI + SQLite (aiosqlite) — NO MongoDB
- **Crypto**: bitcoinjs-lib + @noble/secp256k1 (pure JS, browser-compatible)
- **IPFS**: Local Kubo daemon for uploads, public gateways for reads
- **Auth**: 100% client-side WIF encryption via Web Crypto API

## What's Implemented (Complete)
- Secure Auth Frontend (WIF import, password-encrypted wallet in localStorage)
- Post-Signup Wizard (profile setup, wallet funding, profile minting)
- Client-Side Signing Overhaul (all P2FK ops: PRO, OBJ, GIV, BRN, BUY, MSG, INQ, Vote)
- SUP Protocol Compatibility Verification (byte-for-byte test suite)
- IPFS Architecture Rework (local Kubo daemon on backend)
- Tauri Download Page & Beta Disclaimers
- Poll Voting Cache Invalidation
- Burn Modal Quantity Handling
- Ownership Cascade Transfers (GiveModal sub-topic support)
- Multi-chain auto-delta vacuuming
- WebRTC mesh relay gossip

## Recently Completed (April 2026)
- **P0 Fix: Profile URN Overwrite Bug** — Fixed in MyProfilePage.js, SettingsModal.js, ActivateMessaging.js. PRO transactions now use on-chain profile URN from API, not user.urn placeholder.
- **P1: Full P2FK Payload Audit** — Line-by-line comparison of p2fk.js against embiimob/Sup C# reference. All 8 transaction types verified compatible: PRO, OBJ, GIV, BRN, BUY, MSG, INQ, Vote.

## Audit Findings (P1)
- `dnm` (display name) in PRO: Written by Cthulhu, read by p2fk.io indexer, ignored by SUP client UI. Not a protocol violation.
- `cre/own/roy` in OBJ: Our code uses integer indices; C# uses raw addresses. Both valid per indexer.
- All encoding, signing, and address list construction verified identical.

## Prioritized Backlog
### P0 (Critical)
- None currently

### P1 (High)
- None currently

### P2 (Medium)
- Investigate incorrect object counts for profiles (DEDA, embii4u, kattacomi)
- Re-architecting Venue & Seat Sales / Locked Objects
- "Ink Log" wallet transaction history tab

### P3 (Low)
- "SupFlix" Media Gallery (video/audio objects)
- Evaluate paid blockchain explorer APIs
- IPFS client-side IndexedDB caching (started, not completed)

## Key API Endpoints
- `GET /api/wallet/utxos/{address}` — Fetch UTXOs
- `GET /api/wallet/raw-tx/{txid}` — Fetch raw transaction hex
- `POST /api/wallet/broadcast` — Broadcast signed transaction
- `POST /api/upload` — Upload to local IPFS daemon
- `POST /api/wallet/register-profile` — Register profile URN
- `GET /api/profile/{address}` — Fetch profile data
- `GET /api/object/addr/{address}?fresh=true` — Fetch object with cache bypass
- `GET /api/polls/{network}?fresh=true` — Fetch polls with cache bypass

## DB Schema (SQLite)
- `api_cache`, `known_users`, `object_cache`, `p2fk_snapshot_history`, `burned_objects`

## Credentials
- Test WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- Test PW: `pXk7uHCH8kuu85B`
- On-chain announce keyword: `CTHULHU-SNAPSHOT`
