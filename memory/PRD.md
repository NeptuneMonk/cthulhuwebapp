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
- **P0 Fix: Admin Wallet Reset Lockout** — Fixed broken `POST /api/admin/wallet/reset` endpoint (previous agent inserted reset function inside init_wallet body, breaking both). Restored init_wallet code structure, added reset endpoint properly, and cleared stale wallet_config from SQLite so user can re-initialize with a fresh password from the UI.
- **P0 Fix: Mint Profile URN Defaulting to Address** — URN field in profile setup was read-only and defaulted to the bitcoin address. Now editable for new profiles with placeholder "Choose a unique name". Updates user auth state with chosen URN after successful mint. Read-only for profile updates.
- **Local P2FK Decoder for Objects (DONE)**
- **Ephemeral Feed Announcements (DONE)** — Profile mint (teal) and Object mint (purple) announcements in global feed, 48hr TTL, not on-chain.
- **URN Impersonation Protection (First Claim Wins)** — Three-layer protection.
- **P0: Admin Vacuum Controls** — Graceful vacuum stop, network selector, snapshot history export/import.
- **P0: CID Health & Etch-to-Chain** — CID health verification, re-pin, manual etch-to-chain.
- **P0: Admin Audit — MongoDB to SQLite Cleanup** — Rewrote system stats and health to use SQLite.
- **P0: Vacuum Speed + Consume Feedback** — Increased vacuum rate, rich consume response UI.
- **P0: Unified Treasury Wallet** — Single wallet hub for all on-chain operations.
- **P0: Feed Filter & Auto-Checkpoint Guard** — SEC backups, system messages filtered from feed.
- **P0: Phantom DM Requests Fix** — Uses SignedBy instead of keyword-derived addresses.
- **P0: Call Duplicate Answer Crash Fix** — Guard for multiple ANSW signals.
- **P1: p2fk.io showSystemFiles=false** — Server-side filtering for ~4x speed improvement.
- **P1: P2P Instant Message Caching & Notifications** — Offline message retrieval and unread counts.
- **P0 Fix: IPFS Deployment Failure** — Bundled Kubo binaries.
- **P0 Fix: Releases Route MongoDB to SQLite** — Rewrote releases.py for SQLite.
- **P0 Fix: "Unnamed" Object View** — Self-healing re-fetch.
- **P0 Fix: Burned Objects Still Showing** — Added burned set filtering.
- **P0 Fix: Media Timeouts (.wav/.mp4)** — mempool.space first, in-memory TX cache.
- **P0 Fix: Profile URN Overwrite Bug** — Fixed in MyProfilePage, SettingsModal, ActivateMessaging.
- **P1: Full P2FK Payload Audit** — All 8 transaction types verified SUP-compatible.
- **P0 Fix: Storefront/Search UI Empty** (April 5, 2026) — Fixed critical data format mismatch: local P2FK decoder returned flat objects but frontend expected `{object: {...}, blockchain: "..."}` wrapper format. Three fixes: (1) Backend `_local_search_objects` now wraps results in p2fk.io format and returns `None` for empty search instead of `[]`. (2) Frontend now uses dedicated storefront endpoint for initial browse and search proxy for user searches. (3) Frontend normalization handles both uppercase and lowercase key formats. Also fixed stale closure bug in chain filter switching. Tested: iteration_242, 100% pass rate (8/8 tests).

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
- Evaluate WebRTC mesh as TURN server / bootstrap node architecture
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
- `GET /api/objects/storefront/{network}` — Storefront browse with progressive keyword fetching
- `GET /api/p2fk/search/objects` — Search objects (wraps GetKnownObjectsBySearchString)
- `GET /api/polls/{network}?fresh=true` — Fetch polls with cache bypass

## DB Schema (SQLite)
- `api_cache`, `known_users`, `object_cache`, `p2fk_snapshot_history`, `burned_objects`

## Credentials
- Test WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- Test PW: `pXk7uHCH8kuu85B`
- On-chain announce keyword: `CTHULHU-SNAPSHOT`
