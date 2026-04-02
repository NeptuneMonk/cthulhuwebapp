# Cthulhu Desktop Node — Tauri Packaging Guide

## Architecture
```
Tauri Host (Rust) → manages 2 sidecars:
  1. cthulhu-api  (PyInstaller-frozen FastAPI server on :8001)
  2. kubo          (go-ipfs daemon on :5001)
Frontend → built React app served by Tauri WebView
```

## Prerequisites
- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 18+, Yarn
- Python 3.10+, PyInstaller (`pip install pyinstaller`)
- Kubo binary for target platform: https://dist.ipfs.tech/#kubo

## Step-by-Step Build

### 1. Build Frontend
```bash
cd frontend
yarn install
yarn build
```

### 2. Freeze Python Backend with PyInstaller
```bash
cd backend
pip install pyinstaller
pyinstaller --onefile --name cthulhu-api server.py \
  --hidden-import=uvicorn.logging \
  --hidden-import=uvicorn.protocols \
  --hidden-import=aiosqlite \
  --collect-data=uvicorn
```
Copy the output binary to `src-tauri/bin/`:
```bash
# For Linux x86_64:
cp dist/cthulhu-api ../src-tauri/bin/cthulhu-api-x86_64-unknown-linux-gnu
# For macOS ARM:
cp dist/cthulhu-api ../src-tauri/bin/cthulhu-api-aarch64-apple-darwin
# For Windows:
cp dist/cthulhu-api.exe ../src-tauri/bin/cthulhu-api-x86_64-pc-windows-msvc.exe
```

### 3. Download Kubo Binary
```bash
# Example for Linux x86_64
wget https://dist.ipfs.tech/kubo/v0.33.0/kubo_v0.33.0_linux-amd64.tar.gz
tar xzf kubo_*.tar.gz
cp kubo/ipfs ../src-tauri/bin/kubo-x86_64-unknown-linux-gnu
```

### 4. Build Tauri Desktop App
```bash
cd src-tauri
cargo tauri build
```
This produces platform-specific installers in `src-tauri/target/release/bundle/`.

## Data Directories
The desktop app uses the user's app data directory:
- **Linux**: `~/.local/share/com.cthulhu.node/`
- **macOS**: `~/Library/Application Support/com.cthulhu.node/`
- **Windows**: `%APPDATA%/com.cthulhu.node/`

SQLite DB, IPFS repo, and config will live here.

## Environment Variables
The PyInstaller binary reads from `.env` in its working directory.
Tauri sets the working directory to the app data folder before spawning sidecars.

## Key Considerations
1. **SQLite path**: Must be relative or use the app data directory (not hardcoded `/app/backend/`)
2. **IPFS repo**: Set `IPFS_PATH` env var to `{app_data}/ipfs_repo`
3. **Port conflict**: Check if 8001/5001 are free before binding
4. **Graceful shutdown**: Send SIGTERM to both sidecars on app close
