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
- **P0: Admin Vacuum Controls** — Added graceful vacuum stop (kill switch), network selector (testnet/mainnet), and snapshot history export/import for porting between instances (preview → live). Backend: `POST /api/snapshot/vacuum/stop`, `GET /api/snapshot/history/export`, `POST /api/snapshot/history/import`. Frontend: Stop button, network dropdown, Export/Import UI in Admin Dashboard Chain Snapshots tab. (Tested: iteration_238, 100% pass)
- **P0: CID Health & Etch-to-Chain** — Added CID health verification (local pin + public gateway checks), re-pin for lost CIDs, and manual etch-to-chain button. Backend: `POST /api/snapshot/verify-cid`, `POST /api/snapshot/repin-cid`, `POST /api/snapshot/etch-cid`. Frontend: health dots, LOST labels, re-pin/etch buttons, legend. (Tested: iteration_239)
- **P0: Admin Audit — MongoDB→SQLite Cleanup** — Rewrote `/api/admin/system-stats` to use real SQLite table stats (row counts, DB file size) instead of broken MongoDB `collStats` calls. Fixed `/api/health` to check SQLite connectivity instead of MongoDB ping. Frontend now says "SQLite Database" with accurate table/row data.
- **P0: Vacuum Speed + Consume Feedback** — Increased vacuum rate from ~1.5 req/sec to ~4 req/sec. Rewrote consume response to include imported/skipped counts, chain/type/timestamp, roots/profiles/keywords breakdown, and `previous_cid` chain walk indicator. Frontend shows rich success/failure UI with clickable chain walk link to genesis.
- **P0 Fix: IPFS Deployment Failure** — Bundled Kubo IPFS binaries (amd64 + arm64) in `/app/backend/bin/`. Download fallback URL changed from `dist.ipfs.tech` (502) to GitHub releases.
- **P0 Fix: Releases Route MongoDB→SQLite** — Rewrote `routes/releases.py` to use SQLite via `get_conn()` instead of MongoDB. Added migration for existing tables missing columns. Created `build_package.py` script.
- **P0 Fix: "Unnamed" Object View** — Added data validation and self-healing re-fetch to SingleObjectPage.
- **P0 Fix: Burned Objects Still Showing** — Added `get_burned_set()` filtering to owned/created/counts endpoints.
- **P0 Fix: Media Timeouts (.wav/.mp4)** — mempool.space first, in-memory TX cache, semaphore 3→8, p2fk.io fast-path.
- **P0 Fix: Profile URN Overwrite Bug** — Fixed in MyProfilePage.js, SettingsModal.js, ActivateMessaging.js.
- **P1: Full P2FK Payload Audit** — All 8 transaction types verified compatible with SUP reference client.

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
- `POST /api/snapshot/vacuum/stop` — Gracefully stop running vacuum (NEW)
- `GET /api/snapshot/history/export` — Export snapshot history as JSON (NEW)
- `POST /api/snapshot/history/import` — Import snapshot history from JSON (NEW)

## DB Schema (SQLite)
- `api_cache`, `known_users`, `object_cache`, `p2fk_snapshot_history`, `burned_objects`

## Credentials
- Test WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- Test PW: `pXk7uHCH8kuu85B`
- On-chain announce keyword: `CTHULHU-SNAPSHOT`
