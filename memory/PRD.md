# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based social media platform (Cthulhu) with tokenized object storefront and data vault. Dark theme, mobile-friendly, inspired by Telegram. 100% client-side signing. Eliminate dependency on external APIs via local P2FK decoder and IPFS-backed chain snapshots.

## Architecture
- **Frontend:** React + Tailwind + Shadcn UI
- **Backend:** FastAPI + SQLite (NOT MongoDB)
- **Blockchain:** Local P2FK decoder (primary) + p2fk.io (last-resort fallback)
- **IPFS:** Local Kubo daemon + IPFS-backed chain snapshots for decentralized bootstrap
- **Auth:** Client-side WIF encryption (Web Crypto API)
- **Signing:** 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Chain Index:** Vacuum p2fk.io → SQLite → IPFS snapshot → any node bootstraps

## What's Implemented
- Full auth flow (WIF import, encrypt, login)
- Profile minting, Object creation/give/buy/burn (all client-side PSBT)
- Feed with caching, background refresh, hydrated from snapshot data
- Conversation threading (keyword-based), Object storefront, Discover page
- On-chain file reconstruction, IPFS upload/GC/auto-pin
- IPFS Content Cache Manager (Settings > Data and Storage)
- Mesh network (WebRTC), Walkie-talkie phone system
- SEC encrypted state backups, Admin dashboard
- Local P2FK Decoder + Async Blockchain Explorer Client
- p2fk.io → Local Backend Migration Complete
- Connect Your Node UI (custom Bitcoin Core RPC)
- Decoder Health Dashboard (independence score, source tracking)
- **IPFS Chain Snapshots** (vacuum, produce, consume, daisy-chain)
- **Feed Hydration** (extract all signers from cache → register as known users → richer feed)
- **On-Chain Discovery** (CTHULHU-SNAPSHOT keyword address for decentralized bootstrap)
- **Latest CID Public Endpoint** (any node can query for latest snapshot)

## Session 2 Changes (April 1, 2026)

### Local P2FK Decoder (DONE)
### p2fk.io → Local Migration (DONE)
### Decoder Health Dashboard (DONE)
### IPFS Content Cache Manager (DONE)
### Connect Your Node (DONE)

### IPFS Chain Snapshots (DONE)
- Vacuum p2fk.io at 1.5 req/sec, auto-register discovered signers
- Produce: serialize → gzip → pin to IPFS → daisy-chain CIDs
- Consume: fetch CID from IPFS → hydrate SQLite + auto-register users
- Genesis: `QmUokA8vW5NNDddLhPAZKtu3iJetNKYzUwY9fuohHDNG8A` (6,025 roots, 84 profiles)

### Delta Snapshots & Auto-Bootstrap (DONE — April 2, 2026)
- **Delta Snapshots**: `POST /api/snapshot/produce?delta=true` — only new roots since last snapshot. Tracked via `snapshot_txids` table. Full=5MB, Delta=<1KB when no changes.
- **Auto-Bootstrap**: `POST /api/snapshot/auto-bootstrap` — background task walks the IPFS daisy-chain, consumes all snapshots in chronological order, hydrates local cache.
- **Bootstrap Status**: `GET /api/snapshot/bootstrap-status` — polls progress (running, phase, imported, users).
- **Admin UI**: Delta toggle (amber), Auto-Bootstrap button (purple), Tracked TXIDs stat, type badges on snapshot chain (delta=amber, full=emerald).
- **Bug Fix**: Fixed `fetchone()` async bug in snapshot txid tracking. Fixed chain resolution hanging on genesis snapshot with NULL `previous_cid`.
- **502 Fix**: Backend crash during hot-reload resolved (supervisor restart).

### Deep Root Vacuum Crawl (DONE — April 2, 2026)
- New vacuum phase "crawling_deep_roots": crawls `GetRootsByAddress` for ALL discovered addresses (not just seeds)
- Catches roots signed by objects, non-profile addresses, and any entity with a receiving address
- Discovery cap at 500 deep addresses per run to prevent explosion
- Fixed vacuum crash: `SELECT address FROM known_users` → `json_extract(data, '$.address')` (SQLite JSON column)
- Added safety wrapper: vacuum background task now catches all exceptions and logs them instead of hanging silently

### Feed Mode Toggle (DONE — April 2, 2026)
- **Following / Global toggle**: Pill-shaped button bar at top of feed page
- **Persistence**: Stored in `localStorage` key `cthulhu_feed_mode` — survives navigation, page refresh, and logout
- **Backend**: `GET /api/feed/{network}?mode=following&followed=addr1,addr2,...` filters to only followed addresses' posts
- **Empty states**: Distinct messages for "no follows yet" vs "no posts from followed"

### Poll System Refactor — On-Chain Source of Truth (DONE — April 2, 2026)
- **Vote counts**: Now sourced from on-chain data via `GetInquiryByTransactionID` (p2fk.io indexer). Local DB no longer increments fake counters.
- **Local registry**: Demoted to speed cache only. Used for instant feed visibility of unconfirmed polls and "already voted" detection.
- **PollCard**: Fetches live on-chain data on mount, merges with local vote records for optimistic UX.
- **Architecture principle**: "The blockchain is the database. IPFS is the file system. Our server is just a read cache."
- **Local-only data** (acknowledged): follow lists, favorites, playlists, audience chats — these are user preferences, not protocol data.

### IPFS Snapshot in Dependency Gauge (DONE — April 2, 2026)
- Added `ipfs_snapshot` as 5th tracked source in decoder health stats (purple in bar chart)
- Snapshot hydration imports are now tracked in the independence score (counts as independent from p2fk.io)
- Source breakdown grid expanded to 5 columns: Local Decoder, IPFS Snapshot, Fresh Cache, Stale Cache, p2fk.io

### Storefront Speed Optimization (DONE — April 2, 2026)
- Objects page now uses `cachedFetch` (stale-while-revalidate) for all search results
- 5-minute TTL with background refresh — instant loads on back-navigation (0.06s vs 2-3s)
- Session state preservation (objects, scroll position, filters) on unmount/restore

### Feed Hydration (DONE)
- `POST /api/snapshot/hydrate-feed`: extracts all 158 unique signers from cached data
- Registers them as known users → feed now shows ALL discovered content
- Feed grew from 68 known users to 156

### On-Chain Discovery (DONE)
- Well-known keyword address: `CTHULHU-SNAPSHOT` → `mmexXxh54XNFQdaRCjNRL7Hh3dzaEqS3MB` (testnet)
- Admin UI shows keyword, address, latest CID, copy button
- Instructions for publishing CID on-chain via compose
- `GET /api/snapshot/latest-cid`: public endpoint for node bootstrap discovery

## Backlog
### P1
- Ownership Cascade Transfers

### P2
- Scheduled automatic snapshot production
- Object count discrepancies
- "Ink Log" wallet history, Venue & Seat Sales

### P3
- "SupFlix" Media Gallery
- Object-based chat rooms

### Session 3 Changes (April 2, 2026)

#### Surgical Delete/Burn Cache Purge (DONE)
- `_surgical_cache_purge()` in `data.py`: removes ONLY the specific txid from the feed cache, not the entire cache
- Unpins associated IPFS CIDs from local Kubo daemon (best-effort)
- Triggered on both `POST /api/reactions/{txid}` (type=delete) and when `GET /api/reactions/{txid}` discovers a confirmed author-delete
- Frontend: `performDelete` emits `cthulhu-post-deleted` event; FeedPage listens and removes the post from local state instantly

#### Recoverable Clear Chat (DONE)
- DM "Clear Chat" now uses timestamped soft-delete only — no longer destroys IndexedDB caches (sent messages, conversation cache, decrypt cache)
- `setClearedBefore()` now records a clear history (last 10 clears) for auditability
- Added `removeClearedBefore()` function in `dmDb.js` to undo a clear
- "Recover Chat" button added to DM menu — removes the `clearedBefore` filter so messages reappear on next fetch from chain

#### SEC Backup Blocklist Integration (DONE)
- `collectNetworkState()` now includes `blockedUsers` from localStorage
- `restoreNetworkState()` merges restored blocklist with existing local blocklist (deduplicating by address)
- Blocked users survive device changes when SEC backup is restored

#### Storefront Chain Filter Fix (DONE)
- `CHAIN_FILTERS` now has a `match` field for strict blockchain matching
- `fetchObjects()` applies client-side post-filter: `object._blockchain.toUpperCase().includes(chainMatch)`
- Featured (embii) has no chain match — shows all results as before
- BTC/LTC/DOG/MZC/IPFS filters now strictly validate the `_blockchain` field

#### Proactive IPFS Pinning for Feed Posts (DONE — April 2, 2026)
- Root cause of lost images: IPFS content was never pinned when posts were viewed. Public gateways GC'd the content and it was lost forever.
- `_proactive_pin_feed_cids()` in `data.py`: extracts ALL IPFS CIDs from feed messages (post images, profile pics, file attachments) and pins them to local Kubo
- Triggers on: feed page load (current page), background feed refresh (all messages), and feed built from scratch
- Deduplicates pin requests to avoid hammering Kubo
- Result: node went from 1 pin (default) to 33+ pins after a single feed load
- This ensures our node has a local copy of all content it has ever seen — true "pinning node" behavior
- Fixed `ReferenceError: blockList is not defined` in `AppLayout`
- Added `useBlockList(network)` hook to `AppLayout` function
- Changed `blockUser={blockUser} isBlocked={isBlocked}` to `blockUser={blockList.blockUser} isBlocked={blockList.isBlocked}` on ProfileDetailPage route


#### Drag & Drop / Paste File Support in Compose (DONE — April 2, 2026)
- ComposeModal.js (Feed overlay) and ComposeBar.js (Feed inline + Object Chat): Added drag/drop + paste file handlers
- Drop zone overlay appears on drag. Paste catches clipboard files (screenshots, etc.)
- NOT added to DMPage.js (Private Messages) per user instruction
- Large files (>5MB) start background upload immediately via UploadQueue

#### Local Decoder Priority Flip (DONE — April 2, 2026)
- Flipped `p2fk_get()` priority: `cache_fresh → local_decoder → p2fk_io → cache_stale`
- Independence score: 0% → 99.6%

#### Proactive IPFS Pinning for Feed Posts (DONE — April 2, 2026)
- `_proactive_pin_feed_cids()` pins all IPFS CIDs from feed messages to local Kubo on every load
- Node went from 1 pin → 88+ pins after first feed load

#### Auto-Backup Verification (CONFIRMED — April 2, 2026)
- No auto-backup intervals exist. SEC backups are manual only (SettingsModal sign-out flow)

#### Auto-Delta Indexer (DONE — April 2, 2026)
- Background scheduler: vacuum → delta snapshot on configurable interval (5m-24hr, default 15m)
- Skips if 0 new roots found (no wasted IPFS pins)
- Admin endpoints: POST /api/snapshot/auto-delta/start, stop, GET status
- Admin UI: "Auto-Delta Indexer" section with start/stop, interval, stats, live log
## Key Files

#### Storefront: "All" Default Filter (DONE — April 2, 2026)
- Replaced hardcoded "Featured"/"embii" search with "All" (empty search string)
- Objects load chronologically on initial load
- Chain filters (BTC/LTC/DOG/MZC/IPFS) maintained with strict `_blockchain` field validation

#### Impersonation Protection (DONE — April 2, 2026)
- `GET /api/urn/verify/{urn}` endpoint: finds all addresses claiming a URN, resolves `CreatedDate`, returns official (earliest) claimant
- ProfileDetailPage: "NOT OFFICIAL" red badge appears for impersonators, clickable link to official profile
- Single claimants correctly show no badge

#### Tauri Desktop Packaging Prep (DONE — April 2, 2026)
- Created `/app/src-tauri/` project skeleton: `tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `build.rs`, `capabilities/default.json`
- Rust host spawns Python API (PyInstaller sidecar) + Kubo IPFS daemon as child processes
- Created `/app/TAURI_PACKAGING.md` step-by-step guide for building platform-specific installers

#### Burn Detection & Display (DONE — April 2, 2026)
- Backend: Object endpoint now scans P2FK roots for `BRN` (burn) transactions and adds `burn_transactions`, `burn_txids`, `is_burned`, `burn_status` fields
- Frontend: SingleObjectPage shows red burn banner when burns are detected on-chain
- Defensive guards: All `.map()` calls in SingleObjectPage now use `(array || []).map()` to prevent crashes on missing data
- Verified: Object `msBayXP6iCByaHeMteiwmXMbS74x91MmqY` has 7 BRN roots on-chain (6 by owner, 1 by buyer). p2fk.io indexer doesn't reflect burns yet.
- `/app/backend/routes/snapshot.py` — Vacuum, produce (full+delta), consume, hydrate-feed, auto-bootstrap, bootstrap-status, latest-cid
- `/app/backend/p2fk_decoder.py` — P2FK Root decoder
- `/app/backend/blockchain_api.py` — Async blockchain explorer client
- `/app/backend/routes/p2fk_local.py` — Local P2FK API routes
- `/app/backend/utils/helpers.py` — p2fk_get with local fallback + decoder tracking
- `/app/backend/utils/stats_tracker.py` — Decoder source tracking
- `/app/frontend/src/pages/AdminDashboard.js` — DecoderHealthPanel, SnapshotPanel, HydrateFeedSection, OnChainDiscoverySection
- `/app/frontend/src/components/SettingsModal.js` — IpfsCacheManager, ConnectNodeSection

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- Admin: `CthulhuAdmin` / `78UH1%2kC^vH2Gi1MqI@`
- Network: `btc-testnet`
- Genesis Snapshot CID: `QmUokA8vW5NNDddLhPAZKtu3iJetNKYzUwY9fuohHDNG8A`
- Discovery Keyword: `CTHULHU-SNAPSHOT` → `mmexXxh54XNFQdaRCjNRL7Hh3dzaEqS3MB`
