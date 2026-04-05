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
- **URN Impersonation Protection (First Claim Wins)** — Three-layer protection: — Added `_local_fetch_objects_for_address()` to reconstruct OBJ metadata directly from raw blockchain transactions. The local decoder is now the primary source for `GetObjectsOwnedByAddress` and `GetObjectsCreatedByAddress`, with p2fk.io as fallback. Fixed OBJ JSON reconstruction (Creators/Owners format normalization to match p2fk.io schema).
  1. Pre-mint check: URN availability verified against on-chain data with real-time feedback (red border + "already claimed by..." error). Blocks minting through Cthulhu.
  2. Unofficial badge: FeedCard shows red "Unofficial" badge for impersonating profiles. ProfileDetailPage shows "NOT OFFICIAL" badge with link to the real profile.
  3. @mention resolution: All @mentions resolve to the official (earliest) URN claimant's profile page.
  4. Backend fix: `/api/urn/verify/{urn}` now correctly verifies on-chain roots instead of blindly trusting `GetPublicAddressByKeyword` (which generates deterministic addresses for any keyword).
- **P0: Admin Vacuum Controls** — Added graceful vacuum stop (kill switch), network selector (testnet/mainnet), and snapshot history export/import for porting between instances (preview → live). Backend: `POST /api/snapshot/vacuum/stop`, `GET /api/snapshot/history/export`, `POST /api/snapshot/history/import`. Frontend: Stop button, network dropdown, Export/Import UI in Admin Dashboard Chain Snapshots tab. (Tested: iteration_238, 100% pass)
- **P0: CID Health & Etch-to-Chain** — Added CID health verification (local pin + public gateway checks), re-pin for lost CIDs, and manual etch-to-chain button. Backend: `POST /api/snapshot/verify-cid`, `POST /api/snapshot/repin-cid`, `POST /api/snapshot/etch-cid`. Frontend: health dots, LOST labels, re-pin/etch buttons, legend. (Tested: iteration_239)
- **P0: Admin Audit — MongoDB→SQLite Cleanup** — Rewrote `/api/admin/system-stats` to use real SQLite table stats (row counts, DB file size) instead of broken MongoDB `collStats` calls. Fixed `/api/health` to check SQLite connectivity instead of MongoDB ping. Frontend now says "SQLite Database" with accurate table/row data.
- **P0: Vacuum Speed + Consume Feedback** — Increased vacuum rate from ~1.5 req/sec to ~4 req/sec. Rewrote consume response to include imported/skipped counts, chain/type/timestamp, roots/profiles/keywords breakdown, and `previous_cid` chain walk indicator. Frontend shows rich success/failure UI with clickable chain walk link to genesis.
- **P0: Unified Treasury Wallet** — Removed separate "Wallet" tab from admin. Treasury is now the single wallet hub for all on-chain operations (etching, releases, snapshot announces). Added WIF import directly in Treasury panel. Updated all UI references. Etch Manager explicitly notes it uses Treasury wallet.
- **P0: Feed Filter & Auto-Checkpoint Guard** — SEC backups, CTHULHU_CHECKPOINT system messages, and blank/binary posts now filtered from main feed via `_is_system_or_encrypted_msg()`. Auto-checkpoint gated by `AUTO_VACUUM_ENABLED` env var (same as vacuum). Neither auto-process runs on preview.
- **P0: Phantom DM Requests Fix** — DM thread sender detection now uses `SignedBy` (the actual signer address) instead of the last keyword-derived address from `root.Keyword`. Keyword addresses are P2FK hashes, not real user addresses — they were showing as phantom message requests from non-existent profiles.
- **P0: Call Duplicate Answer Crash Fix** — Added `answerAppliedRef` guard to prevent processing multiple ANSW signals for the same call. Stale mempool answers from prior call attempts were crashing `setRemoteDescription` with "Called in wrong state: stable", killing ICE negotiation. Guard applies to both blockchain-signaled and mesh-relayed answers.
- **P1: p2fk.io showSystemFiles=false** — Added `showSystemFiles=false` to all p2fk.io API calls (backend `p2fk_get` + frontend `p2fkGet`). Leverages embii's new server-side system file filtering for smaller payloads and ~4x speed improvement on fallback requests.
- **P1: P2P Instant Message Caching & Notifications** — Messages sent while user is offline are now retrievable via `GET /api/chat/inbox/{address}`. On DM page mount, missed messages are fetched from server and merged into local IndexedDB cache. Added `GET /api/chat/unread/{address}` for unread counts per room. DM hook auto-marks rooms as read when opened.
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
- None currently (Admin Wallet Reset fixed April 2026)

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
