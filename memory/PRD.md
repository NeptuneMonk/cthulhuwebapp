# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based social media platform (Cthulhu) with tokenized object storefront and data vault. Dark theme, mobile-friendly, inspired by Telegram. All blockchain data from p2fk.io API (with local decoder fallback). 100% client-side signing architecture.

## Architecture
- **Frontend:** React + Tailwind + Shadcn UI
- **Backend:** FastAPI + SQLite (NOT MongoDB)
- **Blockchain:** Local P2FK decoder (primary) + p2fk.io (last-resort fallback)
- **IPFS:** Local Kubo daemon (uploads pinned permanently, viewed content auto-pinned w/ 48h GC)
- **Auth:** Client-side WIF encryption (Web Crypto API), never touches server
- **Signing:** 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Local Decoder:** Python P2FK Root decoder + async blockchain explorer client (Blockstream → mempool.space fallback)

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
- **Decoder Health Dashboard** (Admin > Decoder Health — independence score, source breakdown, live event log)
- **IPFS Content Cache Manager** (Settings > Data and Storage — browse/clear/toggle cache, per-item management)

## Session 2 Changes (April 1, 2026)

### Local P2FK Decoder (DONE)
- `p2fk_decoder.py`: Full Python port of SUP C# P2FK Root decoder
- `blockchain_api.py`: Async multi-provider explorer client with custom node RPC
- `routes/p2fk_local.py`: 7+ endpoints replacing p2fk.io, SQLite cache

### p2fk.io → Local Migration (DONE)
- Frontend: Backend is now PRIMARY for all on-chain content (p2fk.io is last-resort fallback)
- Backend: `helpers.py` handles 7+ API paths locally when p2fk.io fails
- Backend: `discover.py` and `objects.py` no longer call p2fk.io directly

### Decoder Health Dashboard (DONE)
- New admin tab with Independence Score meter (% requests served without p2fk.io)
- Source distribution bar (local decoder / cache / p2fk.io)
- Per-source stats: total requests, success rate, average latency
- By API Path table: which source serves each endpoint
- Recent Decoder Events: live scrolling log with timestamps

### IPFS Content Cache Manager (DONE)
- Settings > Data and Storage: full cache management UI
- Shows cached items count and total size
- Toggle to enable/disable IPFS caching
- "Clear All Cache" button
- "Browse Cache" — expandable table showing each CID, filename, size, date, with per-item remove

### Connect Your Node UI (DONE)
- Settings > Network: Auto-Detect + Manual Setup for Bitcoin Core RPC
- Connected state: chain info, block height, sync progress

## Backlog (Prioritized)
### P1
- Rework main feed using local decoder + global search API
- Ownership Cascade Transfers
- Tauri desktop app packaging (full sovereignty with local decoder)

### P2
- Object count discrepancies for profiles
- "Ink Log" wallet transaction history tab
- Venue & Seat Sales / Locked Objects
- Object-based chat rooms

### P3
- "SupFlix" Media Gallery
- Research paid blockchain explorer APIs

## Key Files
- `/app/backend/p2fk_decoder.py` — P2FK Root decoder
- `/app/backend/blockchain_api.py` — Async blockchain explorer client
- `/app/backend/routes/p2fk_local.py` — Local P2FK API routes
- `/app/backend/utils/helpers.py` — p2fk_get with local fallback + decoder tracking
- `/app/backend/utils/stats_tracker.py` — Decoder source tracking
- `/app/frontend/src/pages/AdminDashboard.js` — DecoderHealthPanel
- `/app/frontend/src/components/SettingsModal.js` — IpfsCacheManager, ConnectNodeSection
- `/app/frontend/src/utils/ipfsCache.js` — IndexedDB IPFS cache

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- PW: `pXk7uHCH8kuu85B`
- Network: `btc-testnet`
- Admin: `CthulhuAdmin` / `78UH1%2kC^vH2Gi1MqI@`
