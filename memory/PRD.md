# Cthulhu - Decentralized Social Media Platform

## Original Problem Statement
Build a modern, responsive frontend for a blockchain-based social media platform (Cthulhu) with tokenized object storefront and data vault. Dark theme, mobile-friendly, inspired by Telegram. All blockchain data from p2fk.io API. 100% client-side signing architecture.

## Architecture
- **Frontend:** React + Tailwind + Shadcn UI
- **Backend:** FastAPI + SQLite (NOT MongoDB)
- **Blockchain:** P2FK protocol via p2fk.io API (rate limited 30/10s)
- **IPFS:** Local Kubo daemon (uploads pinned permanently, viewed content auto-pinned w/ 48h GC)
- **Auth:** Client-side WIF encryption (Web Crypto API), never touches server
- **Signing:** 100% client-side via bitcoinjs-lib + @noble/secp256k1
- **Admin:** Single user, env-based credentials, JWT 24h expiry + rate limiting

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

## Recent Changes (April 1, 2026)

### ComposeModal Attach Menu Fix (DONE)
- Attach popup menu was clipped/cut off at the top of the modal due to `overflow-y-auto` on the modal container
- Moved toolbar to a fixed footer section outside the scrollable content area
- Removed `overflow-y-auto` from outer modal div, kept it only on inner content area
- Popup now renders above toolbar without clipping (z-[60])

### ComposeBar Overflow Fix (DONE)
- Removed `overflow-hidden` from compose container that was clipping the attach popup menu

### ObjectsPage Scroll Preservation Fix (DONE)
- Root cause: when restoring saved state with a different `activeFilter`, the useEffect re-ran and wiped restored data
- Added `skipFetchOnRestoreRef` to skip the next fetch cycle after restoration changes the filter
- Used double `requestAnimationFrame` for reliable scroll restoration after React DOM commit

### MyProfilePage URL Flattening Fix (DONE)
- Profile URL dict (e.g. `{website: "https://...", twitter: "https://..."}`) was flattened to comma-separated string
- Now serialized as `key: value` per line format (preserves dict structure)
- Save logic parses lines back to proper dict (split by first `:`)
- URL and Location fields are now multiline in edit mode

### IPFS Pinning Fixes (DONE)
- Auto-pin viewed IPFS content in background task (every viewer becomes a pinning node)
- Persist uploaded CIDs to SQLite `uploaded_cids` table (previously in-memory, lost on restart)
- GC now correctly preserves uploaded pins (never touches them) while cleaning 48h-stale viewed pins

### Transaction ID Resolution (DONE)
- p2fk.io's `GetObjectsOwnedByAddress` often returns `TransactionId: null`
- Added fallback: query `GetRootsByAddress/{objectAddress}` to find the creation txid
- Fixed `SignedBy` field mapping (was using `Signed By` which doesn't exist in p2fk.io response)
- txid now displays correctly in SingleObjectPage Transaction section

### 3-Creator Object Bug Fix (DONE)
- ObjectCreateModal could mount twice (overlay + route), generating 2 different object addresses
- Fixed: removed overlay modal, navigate to `/create-object` route; added `generatingRef` guard

### Admin Security Lockdown (DONE)
- Credentials in `.env` only (ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_JWT_SECRET)
- 24h JWT token expiry, 5-attempt rate limiting (15min lockout), session invalidation endpoint

### API Call Deduplication (DONE)
- 125 → 27 calls on login (78% reduction)

### Desktop/Mobile UI Audit (DONE)
- Removed all overlay modals, route-only navigation
- Conditional JS rendering instead of CSS hiding in BottomNav
- Dead state cleanup

## Backlog (Prioritized)
### P1
- Rework main feed using `GetKnownRootsBySearchString?searchString=*` API (pending embii)
- Complete IPFS Client-Side Caching UI (IpfsSettings page + useIpfsCache integration)
- Ownership Cascade Transfers

### P2
- SingleObjectPage lazy loading refactor
- Object count discrepancies
- "Ink Log" wallet transaction history tab

### P3
- Tauri desktop app packaging
- Venue & Seat Sales / Locked Objects
- Object-based chat rooms
- "SupFlix" Media Gallery

## Key Files
- `/app/backend/routes/ipfs.py` — IPFS upload/cat/GC (auto-pin, persisted CIDs)
- `/app/backend/routes/objects.py` — Object endpoints (txid resolution fallback)
- `/app/backend/utils/helpers.py` — p2fk API, format_object_for_api
- `/app/backend/routes/admin.py` — Secured admin auth
- `/app/frontend/src/App.js` — Main layout
- `/app/frontend/src/utils/dedupFetch.js` — API deduplication
- `/app/frontend/src/components/ObjectCreateModal.js` — generatingRef guard

## Test Credentials
- WIF: `cPYRpd9zq5mTdoo93NM5V9gTkpPnL26kjS5f6qYExPHLtCFp2gN8`
- PW: `pXk7uHCH8kuu85B`
- Network: `btc-testnet`
- Admin: See `backend/.env`
