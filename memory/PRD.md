# Cthulhu — Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform (Cthulhu). The platform uses a fully client-side signing architecture (WIF encrypted in browser) and interacts with the P2FK protocol. Complete decentralization is required: SQLite (NO MONGODB), Local Kubo IPFS daemon, P2FK Decoder fetching from reliable blockchain explorers.

**Desktop App (NEW):** Package Cthulhu as a native Tauri desktop application that connects to locally-running Core Wallets (Bitcoin, Litecoin, Dogecoin, Maza) via JSON-RPC. No WIF/login — signing happens inside the Core Wallet daemon. Desktop logic is strictly isolated from web app code.

## Core Architecture
- **Frontend:** React (CRA with config-overrides for crypto polyfills)
- **Backend:** FastAPI + SQLite (aiosqlite, MongoDB-compatible API wrapper)
- **Auth (Web):** 100% client-side WIF signing. Private key encrypted in browser localStorage.
- **Auth (Desktop):** None — relies on locally-running Core Wallet daemons via JSON-RPC
- **Blockchain:** P2FK protocol on BTC, LTC, DOG, MZC chains
- **IPFS:** Local Kubo daemon for uploads, public gateways for reads
- **Desktop Shell:** Tauri (Rust) with PyInstaller-frozen FastAPI + Kubo as sidecars

## What's Implemented
- Full client-side signing (profile minting, posting, object creation, give/buy/burn)
- Secure auth (WIF encrypted with Web Crypto API, stored in localStorage)
- Post-signup wizard (profile setup -> wallet funding -> profile minting)
- SUP protocol compatibility (verified with test suite)
- On-chain file resolution (cross-tx references, HTML apps via srcDoc)
- Generative art support (viewer/genid params injected into HTML iframes)
- Object storefront with chain filters, Listed/All toggle, pagination (200/page)
- Conversation threading (decentralized keyword-based model)
- Network isolation (mainnet/testnet)
- Feed with cached background updates
- Dynamic fee selector (FeePicker) integrated into all transaction modals
- TXID Import in Object Create Modal
- Cross-Chain Discover Search
- Media Embeds (Archive.org, YouTube, Spotify, Vimeo)
- **Desktop Phase 1: Core Wallet RPC Layer (DONE Apr 2026)**
  - `WalletConfig` — per-chain connection config with default ports, cookie auth
  - `CoreWalletRPC` — async JSON-RPC client (getbalance, listunspent, sign, broadcast, blocks, fees)
  - `WalletManager` — multi-chain connection manager with concurrent scan
  - `/api/node/*` routes — fully isolated desktop-only API endpoints

## Key API Endpoints (Web App)
- `GET /api/objects/by-chain/{chain}` — Paginated objects by chain (5min cache)
- `GET /api/onchain/file/{txid}/{filename}` — On-chain file resolution
- `GET /api/wallet/utxos/{address}` — UTXOs for PSBT construction
- `POST /api/wallet/broadcast` — Broadcast signed transaction hex
- `POST /api/upload` — IPFS file upload via local Kubo daemon
- `GET /api/txid/inspect/{txid}` — Inspect P2FK root data from a TXID
- `GET /api/p2fk/search/roots` — Cross-chain root search
- `POST /api/objects/discover` — Discovery search

## Key API Endpoints (Desktop App — NEW)
- `GET /api/node/status` — Connection status for all wallets
- `POST /api/node/scan` — Probe all Core Wallet daemons
- `GET /api/node/wallet/{chain}` — Detailed wallet + blockchain info
- `GET /api/node/address/{chain}` — Get new receiving address
- `GET /api/node/utxos/{chain}` — List unspent outputs from wallet
- `POST /api/node/tx/create` — Create raw unsigned transaction
- `POST /api/node/tx/sign` — Sign via Core Wallet (keys never leave daemon)
- `POST /api/node/tx/broadcast` — Broadcast signed transaction
- `GET /api/node/transactions/{chain}` — Transaction history
- `GET /api/node/tx/{chain}/{txid}` — Transaction details
- `GET /api/node/block/{chain}/{height_or_hash}` — Block data
- `GET /api/node/fee/{chain}` — Fee estimation
- `POST /api/node/rpc` — Generic RPC passthrough

## Desktop App Architecture
```
/app/backend/rpc/
  wallet_rpc.py    — CoreWalletRPC, WalletManager, WalletConfig
/app/backend/routes/
  node.py          — /api/node/* routes (desktop-only)
/app/src-tauri/
  tauri.conf.json  — Tauri build config, sidecar binaries
  src/main.rs      — Sidecar lifecycle management
```

## Pending Issues
- None active

## Desktop App — Phases
- [x] Phase 1: Core Wallet RPC Layer (DONE)
- [ ] Phase 2: Local P2FK Decoder (full chain scan from epoch heights, SQLite index)
- [ ] Phase 3: Desktop Frontend Adaptation (NodeContext.js, no login, wallet status UI)
- [ ] Phase 4: Tauri Packaging (PyInstaller + Kubo sidecar bundling)
- [ ] Phase 5: WebRTC Mesh Integration (desktop peer announcements)

## Upcoming Tasks
- (P0) Desktop Phase 2: Local P2FK Decoder
- (P0) Desktop Phase 3: Desktop Frontend Adaptation
- (P1) Desktop Phase 4: Tauri Packaging
- (P1) Desktop Phase 5: WebRTC Mesh Integration

## Future/Backlog
- (P2) "Ink Log" wallet transaction history tab
- (P3) "SupFlix" Media Gallery for video/audio objects
- (P3) IPFS client-side IndexedDB caching & settings page
- (P3) Evaluate paid blockchain explorer APIs
- (P3) Fix incorrect object counts for profiles

## Key Technical Decisions
- **No MongoDB** — strictly SQLite via aiosqlite
- **Client-side signing (Web)** — user WIF never leaves the browser
- **Core Wallet signing (Desktop)** — keys never leave the daemon, sign via `signrawtransactionwithwallet`
- **Strict isolation** — Desktop code in `/rpc/` and `/routes/node.py`, never touches web app routes
- **Cross-chain discovery** — p2fk.io `blockchain` param (BTC/LTC/DOG/MZC)
- **Fee rates** — dynamic via mempool.space, stored in sessionStorage
- **Protocol files** — SIG, LNK, OBJ, PRO, GIV, BRN, BUY, LST, SEC, INQ, ADD, MSG are protocol files
