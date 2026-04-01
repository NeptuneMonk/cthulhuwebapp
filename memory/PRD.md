# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based social media platform (Cthulhu) with tokenized object storefront and data vault. Dark theme, mobile-friendly, inspired by Telegram. All blockchain data from p2fk.io API (with local decoder fallback). 100% client-side signing architecture.

## Architecture
- **Frontend:** React + Tailwind + Shadcn UI
- **Backend:** FastAPI + SQLite (NOT MongoDB)
- **Blockchain:** P2FK protocol via p2fk.io API (with local decoder fallback via blockchain explorers)
- **IPFS:** Local Kubo daemon (uploads pinned permanently, viewed content auto-pinned w/ 48h GC)
- **Auth:** Client-side WIF encryption (Web Crypto API), never touches server
- **Signing:** 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Admin:** Single user, env-based credentials, JWT 24h expiry + rate limiting
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
- Local P2FK Decoder (Python port of C# SUP Root decoder)
- Async Blockchain Explorer Client (Blockstream/mempool.space with fallback)
- Local p2fk.io Fallback (when p2fk.io is down, most common queries served locally)
- Connect Your Node UI (Settings > Network > custom Bitcoin Core RPC)

## Recent Changes (April 1, 2026 — Session 2)

### Local P2FK Decoder — Complete (DONE)
- Built `p2fk_decoder.py`: Full Python port of SUP C# P2FK Root decoder
  - Base58Check encode/decode, keyword↔address conversion
  - Dust value detection, packet parsing (SIG, files, messages, keywords)
  - Handles mempool.space, Blockstream, BlockCypher, litecoinspace formats
- Built `blockchain_api.py`: Fully async multi-provider explorer client
  - BTC mainnet/testnet: Blockstream → mempool.space fallback
  - DOGE: BlockCypher, LTC: litecoinspace.org
  - Custom Bitcoin Core RPC support (for "Connect Your Node")
  - Rate limiting, connection pooling via httpx.AsyncClient
- Built `routes/p2fk_local.py`: API endpoints replacing p2fk.io
  - `/api/p2fk-local/root/{txid}` — decode single transaction
  - `/api/p2fk-local/roots/{address}` — all roots at address
  - `/api/p2fk-local/keyword/{keyword}` — keyword → address
  - `/api/p2fk-local/search?keyword=...` — search by keyword
  - `/api/p2fk-local/node/status|detect|configure` — custom node management
  - SQLite caching with 5-minute TTL
- Updated `helpers.py`: Local decoder fallback when p2fk.io fails
  - Handles `GetRootByTransactionID`, `GetRootsByAddress`, `GetPublicAddressByKeyword`
  - Format compatibility layer (satoshis → BTC strings)

### Connect Your Node UI (DONE)
- Added `ConnectNodeSection` component in Settings > Network tab
- Auto-Detect: scans common Bitcoin Core RPC ports (8332, 18332, 18443, 38332)
- Manual Setup: Host, Port, RPC User, RPC Password form with bitcoin.conf guidance
- Connected state: shows chain info, block height, sync progress
- Disconnect button to revert to public explorers

## Backlog (Prioritized)
### P0
- Migrate frontend p2fk.io direct calls to local decoder (in components like standalone.js, media.js)
- Rework main feed using local decoder + `GetKnownRootsBySearchString` search API

### P1
- Complete IPFS Client-Side Caching UI (IpfsSettings page + useIpfsCache integration)
- Ownership Cascade Transfers
- Tauri desktop app packaging (pairs with local decoder — full sovereignty)

### P2
- Object count discrepancies for profiles
- "Ink Log" wallet transaction history tab
- Venue & Seat Sales / Locked Objects
- Object-based chat rooms

### P3
- "SupFlix" Media Gallery
- Research paid blockchain explorer APIs

## Key Files
- `/app/backend/p2fk_decoder.py` — P2FK Root decoder (Python port of SUP C#)
- `/app/backend/blockchain_api.py` — Async multi-provider blockchain explorer client
- `/app/backend/routes/p2fk_local.py` — Local P2FK API routes
- `/app/backend/utils/helpers.py` — p2fk_get with local fallback
- `/app/backend/routes/ipfs.py` — IPFS upload/cat/GC (auto-pin, persisted CIDs)
- `/app/backend/routes/objects.py` — Object endpoints (txid resolution fallback)
- `/app/frontend/src/components/SettingsModal.js` — ConnectNodeSection component
- `/app/frontend/src/App.js` — Main layout

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- PW: `pXk7uHCH8kuu85B`
- Network: `btc-testnet`
- Admin: See `backend/.env`
