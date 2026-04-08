# Cthulhu Desktop — Windows Build Guide

## What happens after you build?

You build once. You upload the `.msi` installer to your server. Then **every user** who visits cthulhu.site/download just clicks Download → runs the installer → opens Cthulhu. They never see any of these build steps.

```
YOU (one time)                    EVERYONE ELSE (forever)
─────────────                     ──────────────────────
Build on Windows                  Visit cthulhu.site/download
  ↓                                  ↓
Get Cthulhu-0.1.0.msi             Click "Download .msi"
  ↓                                  ↓
Upload to server                  Double-click installer
  ↓                                  ↓
Done                              Open Cthulhu → wallets auto-detected
```

---

## Step 1: Install Prerequisites

Open PowerShell as Administrator and run these one at a time:

### 1a. Install Rust
```powershell
# Download and run the Rust installer
winget install Rustlang.Rust.MSVC
# OR visit: https://rustup.rs
# After install, restart PowerShell
rustc --version   # Should show rustc 1.xx.x
```

### 1b. Install Node.js
```powershell
winget install OpenJS.NodeJS.LTS
# Restart PowerShell
node --version    # Should show v20.x.x or v22.x.x
npm install -g yarn
```

### 1c. Install Python
```powershell
winget install Python.Python.3.12
# Restart PowerShell
python --version  # Should show Python 3.12.x
pip install pyinstaller
```

### 1d. Install Visual Studio Build Tools (needed by Rust/Tauri)
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
# During install, select "Desktop development with C++"
```

### 1e. Download Kubo (IPFS)
```powershell
# Download from: https://dist.ipfs.tech/kubo/v0.33.0/kubo_v0.33.0_windows-amd64.zip
# Extract ipfs.exe to a known location
```

---

## Step 2: Get the Code

```powershell
# Clone your repo (or download the zip from GitHub)
git clone <your-repo-url> cthulhu
cd cthulhu
```

---

## Step 3: Build the Desktop Frontend

```powershell
cd frontend
yarn install

# Build using the desktop config (NOT the web app config)
$env:REACT_APP_BACKEND_URL = "http://localhost:8001"
npx craco build --config craco.desktop.config.js

# Verify: frontend/build/ directory should exist
dir build
cd ..
```

---

## Step 4: Freeze the Backend with PyInstaller

```powershell
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Run PyInstaller
pyinstaller cthulhu-api.spec --noconfirm --clean

# Copy the binary to the Tauri bin directory
# The filename MUST include the platform triple
copy dist\cthulhu-api.exe ..\src-tauri\bin\cthulhu-api-x86_64-pc-windows-msvc.exe

cd ..
```

---

## Step 5: Place Kubo Binary

```powershell
# Copy the Kubo ipfs.exe you downloaded earlier
copy C:\path\to\ipfs.exe src-tauri\bin\kubo-x86_64-pc-windows-msvc.exe
```

---

## Step 6: Build the Tauri Desktop App

```powershell
cd src-tauri

# Build the release
cargo tauri build

# This takes a few minutes on first run (compiling Rust)
# Output will be at:
#   src-tauri/target/release/bundle/msi/Cthulhu_0.1.0_x64_en-US.msi

dir target\release\bundle\msi
cd ..
```

---

## Step 7: Upload to Your Server

You now have a `.msi` file. Upload it to your live server so the download page can serve it.

### Option A: Via the Admin Panel (Recommended)

```powershell
# 1. First, create a release record (no on-chain etching needed)
curl -X POST "https://cthulhu.site/api/admin/releases/quick-publish" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" `
  -d '{"version": "0.1.0", "name": "Cthulhu Desktop v0.1.0", "description": "First desktop release", "changelog": "Initial release with Core Wallet integration"}'

# 2. Upload the .msi binary
curl -X POST "https://cthulhu.site/api/admin/releases/upload-binary" `
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" `
  -F "platform=windows" `
  -F "version=0.1.0" `
  -F "file=@src-tauri/target/release/bundle/msi/Cthulhu_0.1.0_x64_en-US.msi"
```

That's it. The download page at cthulhu.site/download will now show a Windows download button that serves your `.msi` directly.

### Option B: Manual URL

If you host the file elsewhere (GitHub Releases, IPFS, etc.):
```powershell
curl -X POST "https://cthulhu.site/api/admin/releases/set-platform-urls" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" `
  -d '{"version": "0.1.0", "platforms": {"windows": {"url": "https://your-host.com/Cthulhu-0.1.0.msi", "filename": "Cthulhu-0.1.0.msi", "size": "45MB"}}}'
```

---

## What Users Experience

After you complete the steps above, here's what a regular user sees:

1. Visits **cthulhu.site**
2. Clicks **"Download App"**
3. Their OS is auto-detected → **Windows** card is highlighted with "RECOMMENDED"
4. Clicks **"Download .msi"** → browser downloads the installer
5. Double-clicks the `.msi` → Windows installer runs
6. Opens **Cthulhu Desktop** from Start Menu
7. App auto-scans for running Core Wallets (Bitcoin Core, etc.)
8. If a wallet is found → they're in. Feed, objects, everything works.

No build steps. No command line. No Python. Just click, install, run.

---

## Troubleshooting

### "cargo tauri build" fails
- Make sure Visual Studio Build Tools are installed with C++ workload
- Run `rustup update` to get the latest Rust

### PyInstaller binary crashes
- Run `dist\cthulhu-api.exe` directly from command line to see error messages
- Make sure all Python dependencies are installed: `pip install -r requirements.txt`

### Tauri can't find sidecar
- Binary names MUST match the triple exactly:
  - `cthulhu-api-x86_64-pc-windows-msvc.exe`
  - `kubo-x86_64-pc-windows-msvc.exe`
- They must be in `src-tauri/bin/`

### Upload fails
- Check your admin token is valid
- File size limit: the default should handle up to 100MB
- Check the server logs for errors
