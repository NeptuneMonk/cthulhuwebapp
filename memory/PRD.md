# Cthulhu — Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based decentralized social media platform (Cthulhu). The platform uses a fully client-side signing architecture (WIF encrypted in browser) and interacts with the P2FK protocol. Complete decentralization is required: SQLite (NO MongoDB), Local Kubo IPFS daemon, P2FK Decoder fetching from reliable blockchain explorers, and an Auto-delta daisy-chain IPFS Snapshot system.

## Architecture
- **Frontend:** React (CRA with config-overrides for crypto polyfills)
- **Backend:** FastAPI + SQLite (aiosqlite) — STRICTLY NO MongoDB
- **Blockchain:** Client-side signing via bitcoinjs-lib + @noble/secp256k1
- **IPFS:** Local Kubo daemon for uploads, public gateways for reads
- **Auth:** 100% client-side WIF encryption via Web Crypto API

## Core Requirements (All DONE)
1. 100% Client-Side Authentication via WIF
2. Backend strictly uses SQLite (NO MongoDB)
3. Local P2FK Decoder for blockchain data
4. Decentralized IPFS Snapshot system (vacuum → snapshot → IPFS pin → daisy-chain)
5. Auto-discover and register signers
6. Feed toggle between "Global" and "Following"
7. Display Polls using on-chain data
8. Real Delete transactions (SQLite purge & IPFS unpin)
9. Impersonation protection ("First claim wins" for URNs)
10. Cross-chain content (MZC, DOGE, LTC roots)
11. On-chain HTML/ZIP web app rendering (sandboxed iframes)
12. SUP Protocol compatibility (verified)

## Completed Features
- Secure auth (signup/login with encrypted WIF in localStorage)
- Post-signup wizard (profile setup, wallet funding, minting)
- Client-side P2FK signing for all operations
- Storefront (browse, buy, give, burn objects)
- Object creation with IPFS uploads and royalties
- Profile pages with owned/created/collection filters
- Conversation threading (keyword-based, decentralized)
- On-chain file rendering (HTML, ZIP, cross-chain)
- IPFS Kubo daemon on backend
- Vacuum → Snapshot → IPFS pin → daisy-chain system
- Auto-delta scheduler with on-chain CID announcements
- WebRTC mesh gossip for peer snapshot discovery
- Burn detection and filtering
- Discover page with cross-network search

## Recently Completed (Apr 6, 2026)
- **Vacuum Cache Reset Fix:** Disabled local P2FK decoder for `GetRootsByAddress` to prevent partial results (max_pages=2) from overwriting full p2fk.io cache during vacuum cycles. Same pattern as existing `GetObjectsOwnedByAddress` fix.
- **Local Root Search Index:** Created `root_search_index` SQLite table populated from cached root data. New `GET /api/local-search/roots?q=...` endpoint supplements unreliable p2fk.io search with locally indexed cross-chain roots.
- **Frontend Search Integration:** DiscoverPage.js now queries local search index in parallel with p2fk.io, deduplicating results by txid.
- **Backfill Logic:** Startup task indexes existing cached roots into the search index with proper mainnet/testnet classification.
- **Vacuum Phase 0 Cache Pull:** Added a new first phase to the vacuum that pulls `searchString=*&qty=200` from p2fk.io (their server-side cached query) before any address crawling begins. This immediately indexes all known roots and discovers addresses from the cache, reducing cold queries. Also fixed the keyword search phase to use `qty=200` and `searchString` (was `search` with `qty=50`, missing both the cache and the correct param name).
- **Search Index Health in Decoder Panel:** Added search index stats (total roots, testnet/mainnet breakdown, coverage %) to the existing Decoder Health panel in the admin dashboard.
- **Enhanced On-chain Cards in Discover:** File badges are now color-coded by type (images=blue, code=cyan, text=gray, zip=green) with clickable launchers that open files in new tabs. Message previews expanded to 400 chars showing human-readable descriptions, keywords, and metadata. HTML files still use the "Launch On-chain App" button.
- **Same-Root File Resolution in OnchainAppViewer:** Fixed a major bug where on-chain web apps with CSS, images, and scripts stored in the same root transaction couldn't render. The viewer now: (1) pre-warms all root files to trigger backend resolution, (2) inlines same-root CSS as `<style>` tags with url() rewriting, (3) rewrites image/media src attributes to point to the backend proxy, (4) retries 202 (resolving) responses for CSS files. Cross-transaction references continue to be handled via inlining. Tested against the HPR news article root (69ba5d7f..., 27 files, 581KB) — renders identically to the bitfossil.org reference viewer.

## DB Schema (SQLite)
- `api_cache`: Generic proxy cache for p2fk.io responses
- `known_users`: Registered blockchain addresses
- `conversation_cache`: Feed cache
- `object_cache`: Object data cache
- `snapshots`: Snapshot history (CID, chain, type, root_count)
- `snapshot_txids`: Tracked txids for delta computation
- `burned_objects`: Known burned object addresses
- `root_search_index`: **(NEW)** Local text search index (txid, files_json, message, signed_by, blockchain, block_date)

## Upcoming Tasks
- (P2) WebRTC mesh as TURN server / bootstrap node architecture
- (P2) "Ink Log" wallet transaction history tab

## Future/Backlog
- (P3) "SupFlix" Media Gallery for video/audio objects
- (P3) IPFS client-side IndexedDB caching & settings page
- (P3) Evaluate paid blockchain explorer APIs
- (P3) Object-based chat rooms research

## Key API Endpoints
- `GET /api/local-search/roots?q=...&qty=60&network=btc-testnet` — Local root search
- `GET /api/p2fk/search/roots` — Upstream p2fk.io root search
- `GET /api/p2fk/root/{txid}` — Direct root lookup
- `GET /api/snapshot/status` — Vacuum/cache/search index stats
- `POST /api/snapshot/vacuum` — Start vacuum crawl
- `POST /api/snapshot/produce` — Produce IPFS snapshot
- `POST /api/snapshot/consume` — Hydrate from IPFS snapshot

## Critical Rules
- Client-side signing is law: WIF never leaves the browser
- STRICTLY NO MongoDB
- Iframe backgrounds stay `bg-white` (intentional for on-chain HTML)
- On-chain announce keyword: `CTHULHU-SNAPSHOT`
