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
- **P0 Fix: Burned Objects in Storefront** (April 5, 2026) — Burned objects were leaking into storefront and search results. Root causes: (1) Search proxy had zero burn filtering. (2) Storefront "keywords exhausted" code path had no burn filter. (3) Burn filter only applied to new objects, not cached+merged. (4) Burned registry was incomplete. Fix: Added `batch_verify_burns()` that checks `GetRootsByAddress` for BRN roots and verifies via p2fk.io `GetObjectByAddress` (skip_cache). Applied to all 3 storefront paths + search proxy. Added total_supply == 0 frontend safety net. 86 burned objects detected and registered.
- **P0 Fix: Sidechain Objects Missing from Storefront** (April 5, 2026) — Chain filters (DOG, LTC, MZC) showed "No objects found" after storefront refactor. Three root causes: (1) Frontend `isSearchMode` excluded chain filter names, routing them to BTC-only storefront instead of cross-chain search proxy. (2) Local decoder returned `[]` for unmatched searches (treated as valid by `p2fk_get`, blocking p2fk.io fallthrough). Fixed to return `None` for empty results. (3) Chain filter used `_blockchain` field (always "BTC-testnet") instead of URN prefix to detect data repos. Added `getDataRepo()` function that checks URN prefix (DOG:, LTC:, MZC:, IPFS:, BTC:).
- **P0 Fix: Storefront Loading Only Partial Objects** (April 5, 2026) — Storefront showed ~69 objects while p2fk.io has 496. Root causes: (1) Frontend used keyword-by-keyword storefront endpoint (limited to 13 keywords). Switched to always use the cross-chain search proxy backed by `GetKnownObjectsBySearchString` which returns ALL known objects. (2) Burn filter reduced returned count below `qty`, causing frontend `hasMore=false` prematurely. Fixed backend to over-fetch (`qty * 1.5 + 10`) and return exactly `qty` items. Storefront now loads 40+ objects per page with correct infinite scroll.
- **P0 Fix: URN Verification Logic** (April 5, 2026) — Changed from date-based "first claim wins" to `GetProfileByURN`-based verification. The registered profile's `Creators` address is the official one. Objects can have two creators temporarily during trades.
- **P0 Fix: Admin Releases 500 Error** (April 5, 2026) — Release config endpoint returned 500 due to `no such column: key`. The `release_config` SQLite table used `_id` as primary key but code queried `key`. Fixed SQL queries. Also fixed ReleasePanel using wrong token storage (`sessionStorage.admin_token` vs `localStorage.cthulhu_admin_token`).
- **P0 Fix: Profile Objects Showing 0** (April 6, 2026) — embii4u profile showed 0 objects despite p2fk.io listing 46 owned/81 created. Two root causes: (1) Local P2FK decoder (`helpers.py`) was returning partial results for aggregate queries (`GetObjectsOwnedByAddress`, `GetObjectsCreatedByAddress`, `GetObjectsByAddress`) because it only scans recent transactions (max_pages=3). These partial results blocked the p2fk.io fallback. Fix: Skip local decoder entirely for aggregate object queries — they require p2fk.io's full blockchain index. (2) `get_profile_bundle` in `data.py` fired object queries with the raw URN ("embii4u") instead of resolving to the blockchain address first. Fix: Resolve profile→address before querying objects, with a 15s timeout to prevent bundle endpoint from blocking indefinitely.
- **Enhancement: Skeleton Loading States** (April 6, 2026) — Replaced all spinner-only loading states with shimmer skeleton placeholders across 4 pages: ProfileDetailPage, FeedPage, ObjectsPage (Storefront), and UserObjectsPage. Created reusable `SkeletonLoaders.js` component with `ProfileSkeleton`, `FeedSkeleton`, `StorefrontSkeleton`, `UserObjectsSkeleton`, `ObjectGridSkeleton`, and `PostCardSkeleton`. Uses Shadcn's `Skeleton` component with `animate-pulse`.
- **P0 Fix: Storefront Search & MZC Objects Missing** (April 6, 2026) — Same root cause as the profile objects bug: the local P2FK decoder in `helpers.py` intercepted `GetKnownObjectsBySearchString` queries and returned partial results from a tiny local cache (1 item), blocking p2fk.io's full index (20+ items). Fix: Skip local decoder for all search queries. Also fixed `GetRootsByAddress` returning `[]` instead of `None` for empty results, which blocked p2fk.io fallback for feed/roots queries.
- **UX: Node Connection Error Messages** (April 5, 2026) — Improved Bitcoin Core RPC error messages: shows specific errors (connection refused, auth failure, timeout) instead of generic "RPC call returned no data". Added cloud-hosted warning when user enters 127.0.0.1.

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
