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
- **Desktop Phase 2: Local P2FK Decoder & Chain Scanner (DONE Apr 2026)**
  - `ChainScanner` — background block walker using Core Wallet RPC `getblock(hash,2)`
  - `ScannerManager` — per-chain scanner lifecycle (start/stop/progress)
  - `p2fk_index.py` — dedicated SQLite index (roots, keywords, files, scan_progress tables)
  - `_extract_roots_from_block()` — pre-filters transactions by dust count, decodes via existing `p2fk_decoder.py`
  - P2FK epoch heights configured for BTC/LTC/DOG/MZC (mainnet + testnet)
  - `/api/node/scanner/*` routes — start/stop/progress for chain scanning
  - `/api/node/index/*` routes — query index by txid, address, keyword, file type, search
- **Desktop Phase 3: Desktop Frontend Adaptation (DONE Apr 2026)**
  - `NodeContext.js` — replaces AuthContext; manages Core Wallet connections via `/api/node/*`
  - `DesktopApp.js` — complete separate app shell with no login/auth
  - `desktop-index.js` — separate entry point for Tauri build (web app's index.js untouched)
  - `WalletStatusBar` — BTC/LTC/DOG/MZC connection indicators with balances
  - `DesktopSidebar` — network picker (BTC mainnet+testnet, LTC/DOG/MZC mainnet), nav, scanner controls
  - `DesktopNodeHeader` — action bar with wallet status and Ink menu
  - `DesktopWalletPanel` — Core Wallet details (balance, UTXOs, transactions, address generation)
  - `ScannerPanel` — per-chain scan progress with start/stop controls
  - `NoWalletsOverlay` — guides user to start Core Wallet daemons
  - Networks: BTC mainnet, BTC testnet, LTC mainnet, DOG mainnet, MZC mainnet
- **Desktop Phase 4: Tauri Packaging (DONE Apr 2026)**
  - `craco.desktop.config.js` — separate webpack config, entry point `desktop-index.js`, `REACT_APP_BACKEND_URL=http://localhost:8001`
  - `cthulhu-api.spec` — PyInstaller spec with all hidden imports (routes, rpc, utils, uvicorn, aiosqlite, etc.)
  - Enhanced `main.rs` — data dir management, env vars for sidecars, graceful shutdown on window close
  - `tauri.conf.json` — CSP for desktop (localhost + blockchain APIs + IPFS gateways), sidecar config, app metadata
  - `scripts/build-desktop.sh` — automated 4-step pipeline (frontend → PyInstaller → Kubo → Tauri), platform detection
  - `TAURI_PACKAGING.md` — complete build guide, architecture docs, environment variable reference
- **Desktop Phase 5: WebRTC Mesh Integration (DONE Apr 2026)**
  - `desktopMeshNode.js` — master node that joins the same mesh as web peers
  - Registers as `node_type: "master"` with services: `ipfs, api_cache, feed, blockchain, p2fk_index, utxo`
  - Serves blockchain data via whitelisted RPC methods (`getblock`, `getrawtransaction`, `estimatesmartfee`, etc.)
  - Serves P2FK index queries (roots, keywords, objects, profiles, search) from local scanner
  - Serves IPFS content from local Kubo daemon
  - Capability announcements (`master_announce`, `master_inventory`) on peer connect
  - `MeshPanel.js` — sidebar UI showing master node status, peers, stats grid (relayed, requests, blockchain queries, index queries, IPFS served)
  - Integrated into DesktopSidebar as collapsible section
- **Download Page with Platform Detection (DONE Apr 2026)**
  - Auto-detects OS (Windows/macOS Intel/macOS ARM/Linux) via UA + GPU renderer hinting
  - Shows per-platform download cards with "RECOMMENDED" badge on detected OS
  - Fetches latest release from `/api/releases/latest` with `platforms` dict
  - Backend updated: `platforms` field in release publish, `set-platform-urls` admin endpoint
  - 4-step setup guide, Desktop vs Web comparison, Core Wallet requirements with config example
  - Build from Source section for developers
- **Server-Hosted Binary Downloads (DONE Apr 2026)**
  - `POST /api/admin/releases/quick-publish` — create release without on-chain etching
  - `POST /api/admin/releases/upload-binary` — upload `.msi`/`.dmg`/`.AppImage` to server
  - `GET /api/releases/download/{filename}` — public download endpoint with proper Content-Type
  - Auto-updates release `platforms` dict when binary is uploaded
  - `WINDOWS_BUILD_GUIDE.md` — step-by-step Windows build guide (Rust, Node, Python, PyInstaller, Tauri)

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
  wallet_rpc.py      — CoreWalletRPC, WalletManager, WalletConfig
  chain_scanner.py   — ChainScanner, ScannerManager, block decoder
  p2fk_index.py      — SQLite index for decoded roots (separate DB)
/app/backend/routes/
  node.py            — /api/node/* routes (wallet RPC proxy)
  node_scan.py       — /api/node/scanner/* + /api/node/index/* routes
/app/frontend/src/
  desktop-index.js   — Separate entry point for Tauri build
  DesktopApp.js      — Desktop app shell (no login, wallet-driven)
  contexts/
    NodeContext.js   — Core Wallet connection manager (replaces AuthContext)
  components/desktop/
    WalletStatusBar.js    — Chain connection indicators
    DesktopSidebar.js     — Network picker, nav, scanner controls
    DesktopNodeHeader.js  — Action bar with Ink menu
    DesktopWalletPanel.js — Wallet details (balance, UTXOs, txs)
    ScannerPanel.js       — Chain scanner progress + controls
/app/src-tauri/
  tauri.conf.json    — Tauri build config, sidecar binaries
  src/main.rs        — Sidecar lifecycle management
```

## Pending Issues
- None active

## Desktop App — Phases
- [x] Phase 1: Core Wallet RPC Layer (DONE)
- [x] Phase 2: Local P2FK Decoder & Chain Scanner (DONE)
- [x] Phase 3: Desktop Frontend Adaptation (DONE)
- [x] Phase 4: Tauri Packaging (DONE)
- [x] Phase 5: WebRTC Mesh Integration (DONE)

## Upcoming Tasks
- (P1) Web app mesh client: teach web MeshNode to prefer desktop master nodes for blockchain/index queries (requires web app changes — deferred per user request)
- (P2) "Ink Log" wallet transaction history tab

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
