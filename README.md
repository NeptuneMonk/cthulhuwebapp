# Cthulhu

**Decentralized social media platform built on the P2FK (Pay-to-Fake-Key) protocol.**

A modern, dark-themed web client for the Satoshi Universal Protocol (SUP) ecosystem — featuring a tokenized object storefront, encrypted messaging, multi-chain support, and media discovery. Think Telegram meets blockchain.

> v5.5.4-beta

---

## What is Cthulhu?

Cthulhu is a web-based client for the [SUP protocol](https://github.com/nicknacks/sup-master), a decentralized social network where posts, profiles, objects, and messages are all stored on-chain across multiple blockchains (BTC, DOGE, LTC, MZC).

**Your keys, your identity.** All blockchain operations are signed client-side — your private key never leaves your browser.

---

## Features

### Social
- Threaded public conversations (keyword-based, fully decentralized)
- End-to-end encrypted direct messages
- Tethered rooms and follow system
- Walkie-Talkie voice broadcast with "Super Chat" tipping

### Object Storefront
- Browse, buy, give, and burn tokenized on-chain objects
- Create objects with royalties, IPFS file uploads, and multi-chain support
- Profile pages with Owned / Created / Collections filters
- Renders on-chain files, IPFS zip apps, images, audio, and video

### Media Discovery
- **SUPflix** — Video discovery and streaming from on-chain references
- **Jukebox** — Audio discovery with persistent MiniPlayer across pages
- **Discover** — Unified search across objects, profiles, and posts
- 5-source hybrid search algorithm combining keyword-to-address and broad text search
- Cover art extraction from posts and objects

### Security
- 100% client-side transaction signing (PSBT via bitcoinjs-lib)
- Wallet encrypted with user password (Web Crypto API), stored in localStorage
- Backend is a "dumb" data provider — zero access to private keys
- SUP protocol compatibility verified with byte-level test suite

### Multi-Chain
- BTC, DOGE, LTC, MZC (mainnet and testnet)
- Cross-chain file resolution with automatic chain detection via address version bytes
- Network selector with strict isolation between mainnet/testnet

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Tailwind CSS, Shadcn/UI |
| Backend | Python, FastAPI |
| Database | MongoDB |
| Blockchain | bitcoinjs-lib, @noble/secp256k1 |
| IPFS | Kubo (go-ipfs) daemon |
| Crypto | Web Crypto API (AES-GCM wallet encryption) |

---

## Architecture

```
frontend/          React SPA (port 3000)
  src/
    components/    UI components (ObjectCard, MiniPlayer, Sidebar, etc.)
    contexts/      Auth, MiniPlayer, Network state
    hooks/         useAuth, useIpfsCache, useFollows, etc.
    pages/         Feed, Jukebox, SUPflix, Discover, Storefront, Settings
    utils/         p2fk.js (payload construction), txBuilder.js (PSBT signing),
                   ecc-adapter.js (pure JS crypto), media.js (IPFS URL parsing)

backend/           FastAPI server (port 8001)
  routes/
    data.py        Feed, profiles, conversations, search
    supflix.py     Media discovery engine (5-source hybrid search)
    onchain.py     On-chain file reconstruction, cross-chain fallback
  utils/
    helpers.py     p2fk.io API client, formatters, MongoDB helpers

sup-master/        SUP reference client (C#) — used for compatibility verification
```

### Key Design Decisions

- **Client-side signing**: Transactions are built as PSBTs on the frontend, signed with the user's key, and only the final hex is sent to the backend for broadcast. This mirrors how hardware wallets work.

- **IPFS URL fallback**: IPFS references in the SUP protocol use `IPFS:CID\filename` format. The CID can be either a file CID or a directory CID. All media components try `CID/filename` first (directory), then `CID`-only (file) on error.

- **Hybrid media search**: Combines SUP's keyword-to-address algorithm with broad text search APIs, running 5 data sources per keyword in parallel for comprehensive discovery.

---

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- MongoDB
- IPFS Kubo daemon (optional, for file uploads)

### Backend
```bash
cd backend
pip install -r requirements.txt
# Set environment variables in .env:
#   MONGO_URL=mongodb://localhost:27017
#   DB_NAME=cthulhu
uvicorn server:app --host 0.0.0.0 --port 8001
```

### Frontend
```bash
cd frontend
yarn install
# Set environment variable in .env:
#   REACT_APP_BACKEND_URL=http://localhost:8001
yarn start
```

---

## External APIs

| Service | Purpose |
|---------|---------|
| [p2fk.io](https://p2fk.io) | P2FK protocol data (profiles, objects, roots) |
| [ipfs.io](https://ipfs.io) | Public IPFS gateway for media |
| mempool.space / Blockstream.info | BTC blockchain data |
| BlockCypher / Blockchair | DOGE blockchain data |
| litecoinspace.org | LTC blockchain data |

---

## Protocol Compatibility

Cthulhu's on-chain data structures are verified compatible with the [SUP reference client](https://github.com/nicknacks/sup-master) through an automated test suite (`backend/tests/verify_sup_compatibility.py`) that performs byte-for-byte comparison of P2FK payloads.

---

## License

This project builds on the open SUP protocol. See `sup-master/LICENSE.txt` for the reference client license.
