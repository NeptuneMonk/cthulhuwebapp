# Cthulhu — Decentralized Social Media Platform (Web App)

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform (Cthulhu). The platform uses a fully client-side signing architecture (WIF encrypted in browser) and interacts with the P2FK protocol. Complete decentralization is required: SQLite (NO MONGODB), Local Kubo IPFS daemon, P2FK Decoder fetching from reliable blockchain explorers.

**Note:** The desktop app (Tauri + Core Wallet RPC) is developed in a separate fork. This codebase is strictly the web app.

## Core Architecture
- **Frontend:** React (CRA with config-overrides for crypto polyfills)
- **Backend:** FastAPI + SQLite (aiosqlite, MongoDB-compatible API wrapper)
- **Auth:** 100% client-side WIF signing. Private key encrypted in browser localStorage.
- **Blockchain:** P2FK protocol on BTC, LTC, DOG, MZC chains
- **IPFS:** Local Kubo daemon for uploads, public gateways for reads
- **Mesh:** WebRTC peer mesh for real-time gossip, call signaling, and data relay

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
- IPFS auto-pinning (pins newly discovered CIDs, GC after 2+ public gateways confirm)
- Walkie-Talkie (public global broadcast via mempool + IPFS audio)
- WebRTC phone/video calling (mesh signaling + on-chain fallback)
- Download Page (serves desktop app releases with platform auto-detection)

## Key API Endpoints
- `GET /api/objects/by-chain/{chain}` — Paginated objects by chain (5min cache)
- `GET /api/onchain/file/{txid}/{filename}` — On-chain file resolution
- `GET /api/wallet/utxos/{address}` — UTXOs for PSBT construction
- `POST /api/wallet/broadcast` — Broadcast signed transaction hex
- `POST /api/upload` — IPFS file upload via local Kubo daemon
- `GET /api/txid/inspect/{txid}` — Inspect P2FK root data from a TXID
- `GET /api/p2fk/search/roots` — Cross-chain root search
- `POST /api/objects/discover` — Discovery search
- `GET /api/releases/latest` — Latest desktop app release info
- `POST /api/admin/releases/quick-publish` — Create release
- `POST /api/admin/releases/upload-binary` — Upload desktop build

## Pending Issues
- None active

## Recently Completed
- **Walkie-Talkie Simplification (Apr 14, 2026)**
  - Removed all encrypted walkie (SEC) features: "To:" field, encrypted TX path, secData in message log, intruder alarms, digital rain effects, nuclear warning SFX
  - Walkie-talkie is now strictly global broadcast: record -> IPFS -> P2FK to WALKIE address -> mempool monitoring
  - WebRTC phone/video calling retained as-is on the walkie page
  - Fixed DataCloneError in App.js: sanitized `incomingCall` object before passing through `navigate()` state
- **Desktop Code Cleanup (Apr 14, 2026)**
  - Removed all desktop-app-only code (RPC, Tauri, PyInstaller, local chain scanner, desktop UI components)
  - Kept: DownloadPage.js + releases.py (web app serves desktop downloads), DesktopHeader.js (web responsive header)
- **IPFS Auto-Pinning for Discovered CIDs (Apr 8, 2026)**
  - Hooked into `p2fk_get()` to extract `IPFS:CID` strings from all fresh data
  - New CIDs auto-pinned to local Kubo daemon in background
  - GC: CIDs only unpinned after confirmed on 2+ public IPFS gateways

## Upcoming Tasks
- (P2) "Ink Log" wallet transaction history tab

## Future/Backlog
- (P3) IPFS client-side IndexedDB caching & settings page
- (P3) Evaluate paid blockchain explorer APIs
- (P3) Fix incorrect object counts for profiles
- (P3) Encrypted audio messaging via DM

## Key Technical Decisions
- **No MongoDB** — strictly SQLite via aiosqlite
- **Client-side signing** — user WIF never leaves the browser
- **Cross-chain discovery** — p2fk.io `blockchain` param (BTC/LTC/DOG/MZC)
- **Fee rates** — dynamic via mempool.space, stored in sessionStorage
- **Protocol files** — SIG, LNK, OBJ, PRO, GIV, BRN, BUY, LST, SEC, INQ, ADD, MSG are protocol files
