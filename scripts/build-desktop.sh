#!/usr/bin/env bash
#
# Cthulhu Desktop — Full Build Pipeline
#
# Builds the desktop application for the current platform:
#   1. Frontend: builds React app using desktop entry point
#   2. Backend: freezes FastAPI server with PyInstaller
#   3. Kubo: downloads the IPFS daemon binary
#   4. Tauri: builds the final desktop installer
#
# Usage:
#   ./scripts/build-desktop.sh                    # Full build
#   ./scripts/build-desktop.sh --skip-kubo        # Skip Kubo download
#   ./scripts/build-desktop.sh --frontend-only    # Only rebuild frontend
#
# Prerequisites:
#   - Rust toolchain (rustup)
#   - Node.js 18+, Yarn
#   - Python 3.10+, pip
#   - PyInstaller (pip install pyinstaller)
#
# The web app's craco.config.js and index.js are NEVER touched.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
TAURI_DIR="$ROOT_DIR/src-tauri"
BIN_DIR="$TAURI_DIR/bin"

KUBO_VERSION="v0.33.0"
SKIP_KUBO=false
FRONTEND_ONLY=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --skip-kubo)     SKIP_KUBO=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Detect platform ─────────────────────────────────────────────────────
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) echo "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported arch: $(uname -m)"; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

# Tauri sidecar naming convention:
# binary-name-{target_triple}
tauri_triple() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   echo "x86_64-unknown-linux-gnu" ;;
    Linux-aarch64)  echo "aarch64-unknown-linux-gnu" ;;
    Darwin-x86_64)  echo "x86_64-apple-darwin" ;;
    Darwin-arm64)   echo "aarch64-apple-darwin" ;;
    MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) echo "x86_64-pc-windows-msvc" ;;
    *) echo "unknown"; exit 1 ;;
  esac
}

PLATFORM=$(detect_platform)
TRIPLE=$(tauri_triple)
echo "=== Cthulhu Desktop Build ==="
echo "Platform: $PLATFORM"
echo "Triple:   $TRIPLE"
echo ""

mkdir -p "$BIN_DIR"

# ── Step 1: Build Frontend ───────────────────────────────────────────────
echo ">>> Step 1: Building Desktop Frontend..."
cd "$FRONTEND_DIR"

# Use the desktop CRACO config — overrides entry to desktop-index.js
# and defaults REACT_APP_BACKEND_URL to http://localhost:8001
REACT_APP_BACKEND_URL="http://localhost:8001" \
  npx craco build --config craco.desktop.config.js

echo "    Frontend built: $FRONTEND_DIR/build"

if [ "$FRONTEND_ONLY" = true ]; then
  echo "=== Frontend-only build complete ==="
  exit 0
fi

# ── Step 2: Freeze Backend with PyInstaller ──────────────────────────────
echo ""
echo ">>> Step 2: Freezing Backend with PyInstaller..."
cd "$BACKEND_DIR"

# Install PyInstaller if not present
pip install pyinstaller --quiet 2>/dev/null || true

# Run PyInstaller with the spec file
pyinstaller cthulhu-api.spec --noconfirm --clean

# Copy binary to Tauri bin directory with platform suffix
if [ "$(uname -s)" = "MINGW"* ] || [ "$(uname -s)" = "MSYS"* ]; then
  cp "dist/cthulhu-api.exe" "$BIN_DIR/cthulhu-api-${TRIPLE}.exe"
else
  cp "dist/cthulhu-api" "$BIN_DIR/cthulhu-api-${TRIPLE}"
  chmod +x "$BIN_DIR/cthulhu-api-${TRIPLE}"
fi
echo "    Backend binary: $BIN_DIR/cthulhu-api-${TRIPLE}"

# ── Step 3: Download Kubo ────────────────────────────────────────────────
if [ "$SKIP_KUBO" = false ]; then
  echo ""
  echo ">>> Step 3: Downloading Kubo ${KUBO_VERSION}..."

  # Map platform to Kubo download naming
  case "$PLATFORM" in
    linux-amd64)   KUBO_ARCH="linux-amd64" ;;
    linux-arm64)   KUBO_ARCH="linux-arm64" ;;
    darwin-amd64)  KUBO_ARCH="darwin-amd64" ;;
    darwin-arm64)  KUBO_ARCH="darwin-arm64" ;;
    windows-amd64) KUBO_ARCH="windows-amd64" ;;
    *) echo "Cannot download Kubo for $PLATFORM"; exit 1 ;;
  esac

  KUBO_URL="https://dist.ipfs.tech/kubo/${KUBO_VERSION}/kubo_${KUBO_VERSION}_${KUBO_ARCH}.tar.gz"
  KUBO_TMP="/tmp/kubo_download.tar.gz"

  echo "    Downloading from: $KUBO_URL"
  curl -L -o "$KUBO_TMP" "$KUBO_URL"
  tar xzf "$KUBO_TMP" -C /tmp/

  if [ "$KUBO_ARCH" = "windows-amd64" ]; then
    cp "/tmp/kubo/ipfs.exe" "$BIN_DIR/kubo-${TRIPLE}.exe"
  else
    cp "/tmp/kubo/ipfs" "$BIN_DIR/kubo-${TRIPLE}"
    chmod +x "$BIN_DIR/kubo-${TRIPLE}"
  fi
  rm -rf /tmp/kubo "$KUBO_TMP"
  echo "    Kubo binary: $BIN_DIR/kubo-${TRIPLE}"
else
  echo ""
  echo ">>> Step 3: Skipping Kubo download (--skip-kubo)"
fi

# ── Step 4: Build Tauri Desktop App ──────────────────────────────────────
echo ""
echo ">>> Step 4: Building Tauri Desktop App..."
cd "$TAURI_DIR"

# Verify sidecar binaries exist
echo "    Checking sidecar binaries..."
if [ ! -f "$BIN_DIR/cthulhu-api-${TRIPLE}" ] && [ ! -f "$BIN_DIR/cthulhu-api-${TRIPLE}.exe" ]; then
  echo "    ERROR: cthulhu-api binary not found for $TRIPLE"
  exit 1
fi
if [ "$SKIP_KUBO" = false ]; then
  if [ ! -f "$BIN_DIR/kubo-${TRIPLE}" ] && [ ! -f "$BIN_DIR/kubo-${TRIPLE}.exe" ]; then
    echo "    ERROR: kubo binary not found for $TRIPLE"
    exit 1
  fi
fi

echo "    Running cargo tauri build..."
cargo tauri build

echo ""
echo "=== Build Complete ==="
echo ""
echo "Installers are in: $TAURI_DIR/target/release/bundle/"
ls -la "$TAURI_DIR/target/release/bundle/" 2>/dev/null || echo "(Build output directory listing)"
