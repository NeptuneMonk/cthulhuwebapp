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
- **Poll feed + vote reconstruction fixes (Apr 18, 2026)**
  - Global feed now merges polls from **three sources**: (a) raw feed items flagged `is_poll` (from `GetKnownRootsBySearchString`) enriched in-line via `GetInquiryByTransactionID`, (b) local `poll_registry_col` (instant visibility for polls created through Cthulhu), (c) `GetInquiriesCreatedByAddress` for every author already in the current feed page (surfaces polls from SUP / other Cthulhu instances)
  - Previously the dead code path `_build_feed_from_scratch` held the merge logic but was never called — polls weren't appearing in `get_feed` at all
  - `polls.py::_format_poll` fallback: rewrote legacy-format normalizer. Numeric dict keys ("0","1") are no longer used as answer addresses/text; malformed entries are dropped rather than rendered as `[{address:"0",answer:"0"}]`
  - **INQ.cs-parity on-chain vote reconstruction**: when p2fk.io's `GetInquiryByTransactionID` returns empty but the poll has known answer addresses (from local cache or recovery), the backend walks `GetRootsByAddress/{answer_addr}` for each answer, dedupes by SignedBy, filters by `Signed` when `RequireSignature=true`, and enforces `MaxBlockHeight` — tallies match SUP's `INQ.cs` lines 302–394 exactly. Result returns with `source: "local_decode"`
  - **Recovery path**: polls with fully corrupted legacy `answers:{"0":{...}}` but valid voter→answer_addr mapping reconstruct answer entries from the `votes` map
  - **PollCard UI**: new subtle pulsing yellow dot badge (`indexing` / `local decode`) when `poll_data.source` is `local_cache` or `local_decode`, so the indexer-lag state is visible at a glance
- **On-chain media prefetch + verified badge (Apr 18, 2026)**
  - Extended `utils/thumbPrefetch.js` to also scan feed posts for `<<txid/filename>>` refs (64-hex txid) and background-prewarm `/api/onchain/file/{txid}/{filename}?chain=...&mainnet=...` — so on-chain images/PDFs/video appear instantly instead of spinning "resolving on-chain..."
  - `OnChainMedia` badges upgraded from hidden-by-default amber hover text to a persistent subtle green `✓ on-chain` indicator once content resolves (image/video/generic file variants)
  - Backend already filters burned objects from all list endpoints (owned/created/storefront/by-chain) — burned-object clutter is handled without a frontend cache layer
- **Thumbnail prefetch — feed scroll smoothing (Apr 18, 2026)**
  - New `utils/thumbPrefetch.js` wired into FeedPage at fresh-fetch, cached-replay, and next-page-preload paths
  - Concurrency-6 low-priority fetches of `/api/ipfs/thumb?cid=...` for every image CID in an incoming page of posts
  - Dedupes across the session so nothing is ever fetched twice
- **Thumbnail endpoint + notification URL fixes (Apr 18, 2026)**
  - Verified `/api/ipfs/thumb?cid=...` end-to-end: 1.5MB JPEG upload → 612-byte 90x68 thumb served (HTTP 200, image/jpeg, Cache-Control 24h)
  - `InlineImage` in `MessageContent.js` already wired to use `${API}/ipfs/thumb?cid=${cid}` as initial src; falls back to full IPFS gateway URL on 404
  - Fixed double `/api/api/chat/unread/...` prefix in `useDMNotifications.js` line 72 → now correctly hits `/api/chat/unread/`
  - Added `&& p.txid` guard in `pendingPosts.js::checkConfirmations` to prevent undefined-txid fetches
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
