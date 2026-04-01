# Cthulhu — Changelog

## 2026-03-25 — Mesh Network Bug Fix (Node-to-Node Peering)
- **Root Cause**: When all users enabled "node mode", they all registered as passive listeners but nobody initiated WebRTC connections. The `MeshClient.connect()` logic was skipped in node mode.
- **Fix 1 — Node-to-Node Peering**: `MeshNode._discoverAndPeer()` proactively discovers other nodes via `/api/mesh/nodes` and initiates WebRTC data channels to them via `_connectToPeer()`. Includes tiebreaker for simultaneous offers.
- **Fix 2 — WebSocket Keepalive**: Server sends `{type:"ping"}` every 15s, client responds with `{type:"pong"}` every 15s. Prevents proxy idle-timeout disconnections that caused rapid connect/disconnect cycling.
- **Fix 3 — Heartbeat-Only Offline Detection**: Backend no longer marks node offline on WebSocket disconnect. Only heartbeat timeout (90s) determines offline status.
- **Kubo Reinstalled**: Kubo v0.32.1 (go-ipfs) installed and running on port 5001.
- **Testing**: 100% (15/15 backend, all frontend verified) — iteration 174.

## 2026-03-25 — Mesh Phone Signaling + Walkie UI Overhaul
- **Mesh Phone Signaling (`meshPhone.js`)**: New utility routes call signals (RING/ANSWER/DECLINE/ICE) through the mesh WebSocket instead of blockchain transactions. Instant and free. Falls back to blockchain only if the target isn't on the mesh. Piggybacks on the MeshNode's WS if running, otherwise opens a standalone phone-presence WS.
- **MeshNode integration**: Added `_phoneDispatch` hook to `MeshNode._connectSignaling` — phone call messages (`call-ring`, `call-answer`, etc.) are dispatched to the meshPhone handler without conflicting with mesh peering signals.
- **Global call detection (`useWalkieMonitor`)**: Detects incoming RING signals via mesh while browsing any page. Looks up caller's profile for avatar. Sets `incomingCall` state for BottomNav.
- **BottomNav walkie FAB**: Shows green glow when powered on, gray when off. On incoming call: caller's avatar fills the button with green ring pulse animation. Click to answer → navigates to /walkie.
- **Removed SupFlix tab** from walkie-talkie page (kept the standalone SupFlix page in nav).
- **Message stop + delete**: MessageCard now has stop (square icon) and delete (trash icon) buttons for voicemail/recorded messages.

## 2026-03-25 — Vault Upload Stack Overflow Fix (Critical)
- **Root Cause**: `btoa(String.fromCharCode(...uint8Array))` in 7 files blew the call stack for files >100KB. A 3.4MB image triggers ~3.5M arguments.
- **Fix**: Created `utils/binaryUtils.js` with chunked `uint8ToBase64()` (8KB chunks). Replaced all 7 occurrences across `VaultPage.js` (3), `stateBackup.js` (1), `useOffchainDM.js` (1), `walletCrypto.js` (1), `PatternLock.js` (1).
- **Also fixed**: DM clear persistence (stored `clearedBefore` client-side in IndexedDB), Vault re-sync button.

## 2026-03-25 — Vault Re-sync + DM Clear Persistence
- **Vault Re-sync**: Added a refresh/re-sync button in the vault header that triggers `migrateOnchainItems` — scans the blockchain for VLT/SEC transactions and re-imports them. Fixes vault items disappearing after DB resets.
- **DM Clear Persistence**: `clearConversationCache` now stores a `clearedBefore` timestamp in IndexedDB (client-side) instead of just deleting the cache. New `getClearedBefore()` function. `DMPage.js` now applies a client-side `clearedBefore` filter on decrypted messages — belt-and-suspenders with the backend filter. DMs stay cleared even if the backend DB resets.

## 2026-03-25 — Testnet Faucet Fix + Purchase Warnings + Clear Pin Confirmation + Fetch Vault
- **Faucet Fix**: Backend wasn't loading `.env` file — `TREASURY_TESTNET_WIF` was empty. Added `python-dotenv` to `config.py`. Faucet now working.
- **Pre-flight Balance Warnings**: Added wallet balance fetch and "insufficient funds" warnings to Give, Burn, and List modals (Buy already had it). Buttons disabled when balance is too low.
- **Clear Pin Double-Confirm**: "Clear All" in PinningManager now requires two clicks — first click shows "Confirm Clear?" (auto-resets after 5s), second click actually clears.
- **Fetch from Vault**: Expanded state backup to save/restore ALL user state (follows, rooms, pins, profile URN, object addresses, room avatars, wallpaper, walkie settings, tx history, change address, auto-pin pref). Added "Fetch Vault Backup" button in Settings > Data and Storage. Shows detailed restore summary after fetch. Wallet must be unlocked to decrypt.

- **Global Network Toggle**: Admin dashboard sidebar now has a Testnet/Mainnet toggle (green/orange dot). Persists in localStorage. All panels (Wallet, Treasury, Checkpoints, Etch Manager) sync with it.
- **Etch Manager**: Removed testnet-only blocks. Mainnet etching now works with `TREASURY_MAINNET_WIF`. Both `broadcast-file` and `broadcast-project` endpoints select WIF based on network.
- **Admin Wallet**: Imports BOTH testnet and mainnet treasury WIFs on init. Balance endpoint filters by network param. Address list filtered per network.
- **Treasury**: `_get_mainnet_address()` derives address from mainnet WIF. Faucet remains disabled for mainnet (backend blocks it).
- **Testing**: 100% (13/13 backend, all frontend verified) — iteration 172.

## 2026-03-25 — Display Bug Fixes (Archivist Reports)
- **FundWalletStep**: Network-aware text (BTC/tBTC, mainnet warning/testnet faucet). (iteration 171)
- **ObjectCard URN labels**: Filename label below name + content type badge (MP3/WAV/ZIP) on thumbnail for multipart objects. (iteration 171)

## 2026-03-25 — Treasury Auto-Checkpoint Flow
- Backend: `auto_checkpoint.py` — gathers messages → IPFS → P2FK MSG → treasury-signed broadcast.
- Admin panel: `CheckpointPanel.js` with toggle, stats, config, trigger, history. (iteration 170)

## 2026-03-25 — Vault State Backup for Follows/Tethers
- Auto-save on sign-out, auto-restore on sign-in/WIF unlock. ECIES-only encryption. (iteration 169)

## 2026-03-25 — Decentralized Notification System
- Mesh gossip protocol, backend relay, Web Audio pings, mute toggle, badge fix. (iteration 168)

## 2026-03 — Admin Wallet & Etching Phase
- Admin Wallet, BitFossil-compatible OBJ etching, SQLite migration, WIF Import Key login.
