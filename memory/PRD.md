# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based social media platform (Cthulhu) with tokenized object storefront and data vault. Dark theme, mobile-friendly, inspired by Telegram. 100% client-side signing architecture. Eliminate dependency on external APIs by building a local P2FK decoder and IPFS-backed chain snapshots.

## Architecture
- **Frontend:** React + Tailwind + Shadcn UI
- **Backend:** FastAPI + SQLite (NOT MongoDB)
- **Blockchain:** Local P2FK decoder (primary) + p2fk.io (last-resort fallback)
- **IPFS:** Local Kubo daemon for uploads + IPFS-backed chain snapshots
- **Auth:** Client-side WIF encryption (Web Crypto API), never touches server
- **Signing:** 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Chain Index:** Vacuum p2fk.io → local SQLite cache → IPFS snapshot → any node can bootstrap

## What's Implemented (All Features)
- Full auth flow (WIF import, encrypt, login)
- Profile minting (client-side PSBT)
- Object creation, give, buy, burn (all client-side)
- Feed with caching and background refresh
- Conversation threading (keyword-based)
- Object storefront with search
- Discover page (profiles, objects, roots search)
- On-chain file reconstruction
- IPFS upload via local Kubo daemon
- IPFS GC system (48hr stale cleanup, permanent pins for uploads)
- IPFS auto-pin on content view (pinning node behavior)
- IPFS Content Cache Manager (Settings > Data and Storage)
- Uploaded CIDs persisted to SQLite
- Mesh network (WebRTC P2P content sharing)
- Walkie-talkie phone system (audio + video calls)
- SEC encrypted state backups
- Admin dashboard with full system stats
- API Call Deduplication
- Desktop/Mobile UI Audit
- INQ Vote Fix — Protocol-Correct Implementation
- Local P2FK Decoder (Python port of C# SUP Root decoder)
- Async Blockchain Explorer Client (Blockstream/mempool.space with fallback)
- p2fk.io → Local Backend Migration Complete
- Connect Your Node UI (Settings > Network > custom Bitcoin Core RPC)
- Decoder Health Dashboard (Admin > Decoder Health)
- **IPFS Chain Snapshots** (Admin > Chain Snapshots — vacuum, produce, consume, daisy-chain)

## Session 2 Changes (April 1, 2026)

### Local P2FK Decoder (DONE)
- Python port of C# P2FK Root decoder with async blockchain explorer client

### p2fk.io → Local Migration (DONE)  
- Backend as primary, p2fk.io as last-resort fallback for all on-chain content

### Decoder Health Dashboard (DONE)
- Independence Score, source breakdown, per-path stats, live event log

### IPFS Content Cache Manager (DONE)
- Browse/clear/toggle IndexedDB cache, per-item management

### Connect Your Node (DONE)
- Auto-Detect + Manual Setup for Bitcoin Core RPC

### IPFS Chain Snapshots (DONE)
- **Vacuum**: Crawl p2fk.io at 1.5 req/sec to build comprehensive local P2FK index
- **Produce**: Serialize SQLite cache → gzip JSON → pin to IPFS → daisy-chain CIDs
- **Consume**: Fetch snapshot CID from IPFS → hydrate local SQLite cache
- **Chain**: Linked list of snapshot CIDs with `previous_cid` pointers
- **Genesis snapshot**: `QmUokA8vW5NNDddLhPAZKtu3iJetNKYzUwY9fuohHDNG8A` (6,025 roots, 84 profiles, 1,588 objects, 4.5MB)
- **Admin UI**: Full control panel with vacuum progress, produce/consume buttons, snapshot chain visualization

## Backlog (Prioritized)
### P1
- Rework main feed using local decoder + global search API
- Ownership Cascade Transfers
- Tauri desktop app packaging (full sovereignty: local decoder + Kubo + snapshots)

### P2
- Object count discrepancies for profiles
- "Ink Log" wallet transaction history tab
- Venue & Seat Sales / Locked Objects
- Object-based chat rooms

### P3
- "SupFlix" Media Gallery
- Delta snapshots (only new roots since last snapshot)
- Scheduled automatic snapshot production

## Key Files
- `/app/backend/routes/snapshot.py` — Vacuum, produce, consume, chain endpoints
- `/app/backend/p2fk_decoder.py` — P2FK Root decoder
- `/app/backend/blockchain_api.py` — Async blockchain explorer client
- `/app/backend/routes/p2fk_local.py` — Local P2FK API routes
- `/app/backend/utils/helpers.py` — p2fk_get with local fallback
- `/app/backend/utils/stats_tracker.py` — Decoder source tracking
- `/app/frontend/src/pages/AdminDashboard.js` — DecoderHealthPanel, SnapshotPanel
- `/app/frontend/src/components/SettingsModal.js` — IpfsCacheManager, ConnectNodeSection

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- PW: `pXk7uHCH8kuu85B`
- Network: `btc-testnet`
- Admin: `CthulhuAdmin` / `78UH1%2kC^vH2Gi1MqI@`
- Genesis Snapshot CID: `QmUokA8vW5NNDddLhPAZKtu3iJetNKYzUwY9fuohHDNG8A`
