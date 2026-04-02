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
- Tauri desktop app packaging

### P2
- Scheduled automatic snapshot production
- Object count discrepancies
- "Ink Log" wallet history, Venue & Seat Sales

### P3
- "SupFlix" Media Gallery
- Object-based chat rooms

## Key Files
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
