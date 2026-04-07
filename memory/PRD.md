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
- Post-signup wizard (profile setup → wallet funding → profile minting)
- SUP protocol compatibility (verified with test suite)
- On-chain file resolution (cross-tx references, HTML apps via srcDoc)
- Generative art support (viewer/genid params injected into HTML iframes)
- Object storefront with chain filters, Listed/All toggle, pagination (200/page)
- Conversation threading (decentralized keyword-based model)
- Network isolation (mainnet/testnet)
- Feed with cached background updates

## Key API Endpoints
- `GET /api/objects/by-chain/{chain}` — Paginated objects by chain (5min cache)
- `GET /api/onchain/file/{txid}/{filename}` — On-chain file resolution
- `GET /api/wallet/utxos/{address}` — UTXOs for PSBT construction
- `POST /api/wallet/broadcast` — Broadcast signed transaction hex
- `POST /api/upload` — IPFS file upload via local Kubo daemon

## Key Files
- `/app/backend/routes/onchain.py` — P2FK file parser & resolver
- `/app/backend/routes/objects.py` — Object/storefront APIs
- `/app/frontend/src/pages/SingleObjectPage.js` — Object viewer + HtmlViewer
- `/app/frontend/src/pages/ObjectsPage.js` — Storefront UI
- `/app/frontend/src/utils/txBuilder.js` — Client-side PSBT construction
- `/app/frontend/src/utils/p2fk.js` — P2FK payload construction

## Known Issues
- Storefront "Listed" filter uses client-side filtering (scalability risk at 1000+ objects)
- p2fk.io plural endpoints serve stale listing data; use GetObjectByAddress for fresh data

## Backlog (Prioritized)
- P2: "Ink Log" wallet transaction history tab
- P2: WebRTC mesh / TURN server architecture
- P3: "SupFlix" Media Gallery
- P3: IPFS client-side IndexedDB caching
- P3: Evaluate paid blockchain explorer APIs
