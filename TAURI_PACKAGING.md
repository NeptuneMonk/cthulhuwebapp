# Cthulhu Desktop Node — Tauri Packaging Guide

## Architecture
```
Tauri Host (Rust)
  ├── manages 2 sidecars:
  │   1. cthulhu-api  (PyInstaller-frozen FastAPI on :8001)
  │   2. kubo         (go-ipfs daemon on :5001)
  └── serves Desktop Frontend (React WebView)

Data Directory (per-platform):
  ├── data/
  │   ├── cthulhu.db        (SQLite cache)
  │   └── p2fk_index.db     (P2FK chain scan index)
  ├── ipfs_repo/            (Kubo IPFS node data)
  └── logs/
```

## Two Separate Apps

| | Web App | Desktop App |
|---|---------|-------------|
| **Entry** | `index.js` → `App.js` | `desktop-index.js` → `DesktopApp.js` |
| **Auth** | WIF encrypted in localStorage | Core Wallet RPC (no login) |
| **Signing** | Client-side PSBT in browser | `signrawtransactionwithwallet` via daemon |
| **API** | `REACT_APP_BACKEND_URL` (cloud) | `http://localhost:8001` (sidecar) |
| **IPFS** | Public gateways | Local Kubo daemon |
| **Config** | `craco.config.js` | `craco.desktop.config.js` |
| **Networks** | Per-chain toggle | BTC mainnet+testnet, LTC/DOG/MZC mainnet |

The web app's code is **never touched** by the desktop build.

## Prerequisites
- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 18+, Yarn
- Python 3.10+, PyInstaller (`pip install pyinstaller`)
- Kubo binary for target platform: https://dist.ipfs.tech/#kubo

## Quick Build (Automated)
```bash
./scripts/build-desktop.sh
```

This runs all 4 steps below automatically. Flags:
- `--skip-kubo` — skip Kubo download (if already in bin/)
- `--frontend-only` — only rebuild the desktop frontend

## Step-by-Step Build

### 1. Build Desktop Frontend
```bash
cd frontend
REACT_APP_BACKEND_URL=http://localhost:8001 \
  npx craco build --config craco.desktop.config.js
```
This uses `desktop-index.js` as entry (not `index.js`), loading `DesktopApp.js`
with `NodeContext` instead of `AuthContext`.

### 2. Freeze Backend with PyInstaller
```bash
cd backend
pip install pyinstaller
pyinstaller cthulhu-api.spec --noconfirm --clean
```

Copy to Tauri bin/ with platform suffix:
```bash
# Linux x86_64:
cp dist/cthulhu-api ../src-tauri/bin/cthulhu-api-x86_64-unknown-linux-gnu

# macOS ARM:
cp dist/cthulhu-api ../src-tauri/bin/cthulhu-api-aarch64-apple-darwin

# Windows:
cp dist/cthulhu-api.exe ../src-tauri/bin/cthulhu-api-x86_64-pc-windows-msvc.exe
```

### 3. Download Kubo Binary
```bash
# Linux x86_64
wget https://dist.ipfs.tech/kubo/v0.33.0/kubo_v0.33.0_linux-amd64.tar.gz
tar xzf kubo_*.tar.gz
cp kubo/ipfs ../src-tauri/bin/kubo-x86_64-unknown-linux-gnu

# macOS ARM
wget https://dist.ipfs.tech/kubo/v0.33.0/kubo_v0.33.0_darwin-arm64.tar.gz
tar xzf kubo_*.tar.gz
cp kubo/ipfs ../src-tauri/bin/kubo-aarch64-apple-darwin
```

### 4. Build Tauri Desktop App
```bash
cd src-tauri
cargo tauri build
```

Output: `src-tauri/target/release/bundle/`
- `.dmg` (macOS)
- `.AppImage` / `.deb` (Linux)
- `.msi` / `.exe` (Windows)

## Data Directories
The desktop app uses the OS-standard app data directory:
- **Linux**: `~/.local/share/com.cthulhu.node/`
- **macOS**: `~/Library/Application Support/com.cthulhu.node/`
- **Windows**: `%APPDATA%/com.cthulhu.node/`

## Environment Variables (set by Tauri main.rs)
| Variable | Value | Purpose |
|----------|-------|---------|
| `CTHULHU_DB_PATH` | `{data}/data/cthulhu.db` | SQLite database path |
| `CTHULHU_INDEX_DB_PATH` | `{data}/data/p2fk_index.db` | P2FK scan index |
| `IPFS_PATH` | `{data}/ipfs_repo` | Kubo IPFS repository |
| `IPFS_API_URL` | `http://127.0.0.1:5001` | Local IPFS API |
| `CTHULHU_PORT` | `8001` | API server port |
| `CTHULHU_HOST` | `127.0.0.1` | API server bind address |
| `CTHULHU_DESKTOP` | `1` | Desktop mode flag |
| `CORS_ORIGINS` | `tauri://localhost,...` | Allowed origins |

## Core Wallet RPC (Desktop Only)
The desktop app connects to locally-running Core wallets:
| Chain | Mainnet Port | Testnet Port | Daemon |
|-------|-------------|-------------|--------|
| BTC | 8332 | 18332 | bitcoind / bitcoin-qt |
| LTC | 9332 | 19332 | litecoind / litecoin-qt |
| DOG | 22555 | 44555 | dogecoind / dogecoin-qt |
| MZC | 12832 | — | mazacoind / mazacoin-qt |

Ensure `server=1` is set in each wallet's config file (e.g., `~/.bitcoin/bitcoin.conf`).

## Key Considerations
1. **SQLite path**: Uses `CTHULHU_DB_PATH` env var (set by Tauri)
2. **IPFS repo**: Uses `IPFS_PATH` env var (set by Tauri)
3. **Port conflict**: Check if 8001/5001 are free before binding
4. **Graceful shutdown**: Tauri sends SIGTERM to both sidecars on window close
5. **No WIF/login**: Desktop signing via Core Wallet's `signrawtransactionwithwallet`
