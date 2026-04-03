# Cthulhu - Decentralized Social Objects Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform. The platform uses 100% client-side signing (WIF encrypted in browser), SQLite caching, local IPFS daemon, and the P2FK protocol. Core philosophy: "The blockchain is the database. IPFS is the file system. Our server is just a read cache."

## Architecture
- **Frontend**: React (CRA + config-overrides for crypto polyfills)
- **Backend**: FastAPI + SQLite (aiosqlite) — NO MongoDB
- **IPFS**: Local Kubo daemon for uploads/pins
- **Signing**: 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Mesh**: WebRTC gossip for snapshot propagation
- **Desktop**: Tauri wrapper (skeleton exists in /src-tauri)

## Core Requirements (All COMPLETED)
1. 100% Client-Side Authentication via WIF
2. Backend strictly SQLite
3. Local P2FK Decoder with reliable blockchain explorers
4. Decentralized IPFS Snapshot system (Auto-delta daisy-chain)
5. Auto-discover and register signers
6. Feed toggle between "Global" and "Following"
7. Display Polls using on-chain data
8. Real Delete transactions (SQLite purge & IPFS unpin)
9. Impersonation protection ("First claim wins" for URNs)
10. Client-side signing for all on-chain operations
11. Burned object detection and filtering
12. Chat UX state migrated client-side (IndexedDB)
13. Batched feed fetching (30 addresses at a time)
14. Multi-chain auto-delta vacuum with on-chain CID announcements
15. WebRTC mesh gossip for snapshot propagation

## Completed (April 2026)
- [x] P0: Tauri Download Page (`/download` route) wired into App.js
- [x] P0: Landing page "Download App" button navigates to `/download`
- [x] P0: Auth page "Experimental Beta" warning banner
- [x] P1: Ownership Cascade Transfers — backend endpoint + frontend GiveModal cascade UI
- [x] P1: Auth Migration to Wallet-Only — COMPLETE (all server auth returns 410)
- [x] BUG FIX: Poll vote counts not updating — reduced cache TTL to 30s, cache bypass param, computed vote counts from local registry, auto-refresh
- [x] UX: 2-step Burn modal with quantity confirmation, quick-select buttons (1, half, All), console logging for debugging
- [x] FIX: Nested button warning in AddressLabel component

## Burn Quantity Investigation
The BRN payload format `[[position, qty], [0, salt]]` was verified byte-by-byte against the SUP C# reference client (ObjectBurn.cs). The P2FK indexer OBJ.cs code confirms it reads `burn[1]` as `qtyToBurn` and processes it correctly. If burns still only remove 1 unit, it may be an indexer version issue on p2fk.io. Console logging (`[Cthulhu BRN]`) was added to help diagnose future occurrences.

## Backlog

### P1
- Ownership Cascade Transfers (live testing needed with funded wallet)

### P2
- Investigate incorrect object counts for profiles (DEDA, embii4u, kattacomi)
- Research object-based chat rooms
- Venue & Seat Sales / Locked Objects
- "Ink Log" wallet transaction history tab

### P3
- "SupFlix" Media Gallery (video/audio objects)
- Evaluate paid blockchain explorer APIs

## Key API Endpoints
- `GET /api/polls/by-txid/{txid}?network=&fresh=true` — Poll with real-time vote counts
- `GET /api/rooms/{parent}/owned-subtopics/{owner}?network=` — Cascade transfer discovery
- `GET /api/p2fk/burned` — Burned objects registry
- `POST /api/snapshot/announce/trigger` — Manual CID announcement
- `GET /api/feed/{network}` — Backgrounded feed with instant cache response
- `POST /api/wallet/broadcast` — Broadcast signed TX hex
- `GET /api/wallet/utxos/{address}` — Fetch UTXOs
- `POST /api/upload` — IPFS upload via local Kubo daemon

## Key Files
- `/app/backend/routes/polls.py` — Poll vote count computation from local registry
- `/app/backend/utils/helpers.py` — Cache TTL settings (30s for polls)
- `/app/frontend/src/components/PollCard.js` — Auto-refresh + post-vote re-fetch
- `/app/frontend/src/components/ObjectActionModals.js` — GiveModal cascade + BurnModal 2-step
- `/app/frontend/src/pages/DownloadPage.js` — Tauri download hub
- `/app/frontend/src/hooks/useAuth.js` — Client-side WIF auth
- `/app/frontend/src/utils/p2fk.js` — P2FK payload construction
- `/app/frontend/src/utils/txBuilder.js` — PSBT building/signing

## Treasury Wallet
- Network: BTC Testnet
- Address: `mmexXxh54XNFQdaRCjNRL7Hh3dzaEqS3MB`
- On-chain announce keyword: `CTHULHU-SNAPSHOT`
