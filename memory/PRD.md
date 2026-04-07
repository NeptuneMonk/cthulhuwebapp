# Cthulhu — Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform (Cthulhu). The platform uses a fully client-side signing architecture (WIF encrypted in browser) and interacts with the P2FK protocol. Complete decentralization is required: SQLite (NO MONGODB), Local Kubo IPFS daemon, P2FK Decoder fetching from reliable blockchain explorers.

## Core Architecture
- **Frontend:** React (CRA with config-overrides for crypto polyfills)
- **Backend:** FastAPI + SQLite (aiosqlite, MongoDB-compatible API wrapper)
- **Auth:** 100% client-side WIF signing. Private key encrypted in browser localStorage.
- **Blockchain:** P2FK protocol on BTC, LTC, DOG, MZC chains
- **IPFS:** Local Kubo daemon for uploads, public gateways for reads

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
- **TXID Import in Object Create Modal** (NEW) — paste a TXID to auto-populate URN, name, image, etc. from on-chain P2FK data. Cross-chain support (BTC, LTC, DOG, MZC).
- **Cross-Chain Discover Search** (NEW) — DiscoverPage search fans out to all chains (BTC, LTC, DOG, MZC) in parallel via p2fk.io `GetKnownRootsBySearchString?blockchain={chain}` and `GetKnownObjectsBySearchString`. Finds both claimed objects and unclaimed raw injections.
- **Chat Header Fix** (FIXED Apr 2026) — `/api/object/addr/{address}` now resolves names from the latest/active root instead of the oldest, preventing burned object names from appearing in chat room headers.

## Key API Endpoints
- `GET /api/objects/by-chain/{chain}` — Paginated objects by chain (5min cache)
- `GET /api/onchain/file/{txid}/{filename}` — On-chain file resolution
- `GET /api/wallet/utxos/{address}` — UTXOs for PSBT construction
- `POST /api/wallet/broadcast` — Broadcast signed transaction hex
- `POST /api/upload` — IPFS file upload via local Kubo daemon
- `GET /api/txid/inspect/{txid}` — (NEW) Inspect P2FK root data from a TXID, cross-chain with existing claim check
- `GET /api/p2fk/search/roots` — (UPDATED) Roots search now fans out to BTC/LTC/DOG/MZC in parallel
- `POST /api/objects/discover` — (UPDATED) Discovery search uses per-chain root search + objects search

## Pending Issues
- None active

## Upcoming Tasks
- (P2) WebRTC mesh / TURN server architecture evaluation
- (P2) "Ink Log" wallet transaction history tab

## Future/Backlog
- (P3) "SupFlix" Media Gallery for video/audio objects
- (P3) IPFS client-side IndexedDB caching & settings page
- (P3) Evaluate paid blockchain explorer APIs
- (P3) Fix incorrect object counts for profiles

## Key Technical Decisions
- **No MongoDB** — strictly SQLite via aiosqlite
- **Client-side signing** — user WIF never leaves the browser
- **Cross-chain discovery** — p2fk.io `blockchain` param (BTC/LTC/DOG/MZC) instead of `mainnet` param
- **Fee rates** — dynamic via mempool.space, stored in sessionStorage, enforced minimums (3/7/15 sat/vB)
- **Protocol files** — SIG, LNK, OBJ, PRO, GIV, BRN, BUY, LST, SEC, INQ, ADD, MSG are protocol files, filtered from content display
