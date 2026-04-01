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

## What's Implemented
- Full auth flow (WIF import, encrypt, login)
- Profile minting (client-side PSBT)
- Object creation, give, buy, burn (all client-side)
- Feed with caching and background refresh
- Conversation threading (keyword-based)
- Object storefront with search
- Discover page (profiles, objects, roots search)
- On-chain file reconstruction
- IPFS upload via local Kubo daemon
- IPFS GC system (48hr stale cleanup for viewed content, permanent pins for uploads)
- IPFS auto-pin on content view (pinning node behavior)
- Uploaded CIDs persisted to SQLite (survive restarts)
- Mesh network (WebRTC P2P content sharing)
- Walkie-talkie phone system (audio + video calls)
- SEC encrypted state backups
- Admin dashboard (env-based credentials, JWT 24h expiry, rate limiting, session invalidation)
- API Call Deduplication (125 → 27 calls on login)
- Desktop/Mobile UI Audit (eliminated all dual-mount clashes)
- Transaction ID resolution via GetRootsByAddress fallback
- INQ Vote Fix — Protocol-Correct Implementation
- **Local P2FK Decoder (Python port of C# SUP Root decoder)**
- **Async Blockchain Explorer Client (Blockstream/mempool.space with fallback)**
- **p2fk.io Migration Complete — Backend is primary data source, p2fk.io is last-resort fallback**
- **Connect Your Node UI (Settings > Network > custom Bitcoin Core RPC)**

## Recent Changes (April 1, 2026 — Session 2)

### Local P2FK Decoder — Complete (DONE)
- `p2fk_decoder.py`: Full Python port of SUP C# P2FK Root decoder
- `blockchain_api.py`: Fully async multi-provider explorer client with custom node RPC support
- `routes/p2fk_local.py`: 7 API endpoints replacing p2fk.io
- SQLite caching with 5-minute TTL

### p2fk.io → Local Backend Migration — Complete (DONE)
- **Frontend `media.js`**: Backend `/api/onchain/file/` is now PRIMARY for on-chain content. p2fk.io/root is fallback only.
- **Frontend `SingleObjectPage.js`**: Same swap — backend primary, p2fk.io fallback.
- **Frontend `standalone.js`**: Added `P2FK_LOCAL` — tries local decoder endpoints first, falls back to p2fk.io.
- **Backend `helpers.py`**: Expanded `_local_p2fk_fallback()` to handle 7+ API paths locally:
  - `GetRootByTransactionID/{txid}`
  - `GetRootsByAddress/{address}`
  - `GetPublicAddressByKeyword/{keyword}`
  - `GetObjectByTransactionId/{txid}`
  - `GetProfileByAddress/{address}`
  - `GetObjectByAddress/{address}`
  - `GetObjectsByAddress/{address}`
- **Backend `discover.py`**: Removed direct `P2FK_API` constant, routed through `p2fk_get()` (has local fallback).
- **Backend `objects.py`**: Replaced direct `client.get("https://p2fk.io/...")` with `p2fk_get()`.

### Connect Your Node UI (DONE)
- Settings > Network tab: Auto-Detect, Manual Setup, Connected state display
- Backend: `/api/p2fk-local/node/status|detect|configure` endpoints

## Backlog (Prioritized)
### P1
- IPFS Client-Side Caching UI (IpfsSettings page + useIpfsCache integration)
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
- `/app/backend/blockchain_api.py` — Async multi-provider blockchain explorer client
- `/app/backend/routes/p2fk_local.py` — Local P2FK API routes
- `/app/backend/utils/helpers.py` — p2fk_get with expanded local fallback
- `/app/backend/routes/discover.py` — Discovery (now via p2fk_get)
- `/app/backend/routes/objects.py` — Objects (now via p2fk_get)
- `/app/frontend/src/utils/media.js` — Media URL resolution (backend primary)
- `/app/frontend/src/utils/standalone.js` — Standalone mode (local decoder first)
- `/app/frontend/src/pages/SingleObjectPage.js` — Object display (backend primary)
- `/app/frontend/src/components/SettingsModal.js` — ConnectNodeSection

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- PW: `pXk7uHCH8kuu85B`
- Network: `btc-testnet`
- Admin: See `backend/.env`
