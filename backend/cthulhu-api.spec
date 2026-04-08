# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Cthulhu Desktop API server.

Bundles the FastAPI backend into a single executable that Tauri
launches as a sidecar. Run:
    cd backend
    pyinstaller cthulhu-api.spec

Output: dist/cthulhu-api (or dist/cthulhu-api.exe on Windows)
"""

import os
import sys
from pathlib import Path

block_cipher = None
backend_dir = os.path.abspath('.')

# Collect all Python source files from routes/ and rpc/
routes_dir = os.path.join(backend_dir, 'routes')
rpc_dir = os.path.join(backend_dir, 'rpc')
utils_dir = os.path.join(backend_dir, 'utils')

# Data files to bundle (templates, etc.)
datas = []

# Hidden imports that PyInstaller doesn't detect automatically
hiddenimports = [
    # FastAPI / Uvicorn internals
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    'fastapi',
    'starlette',
    'starlette.responses',
    'starlette.routing',
    'starlette.middleware',
    'starlette.middleware.cors',
    'anyio',
    'anyio._backends',
    'anyio._backends._asyncio',

    # Database
    'aiosqlite',
    'sqlite3',

    # HTTP
    'httpx',
    'httpx._transports',

    # Auth
    'passlib',
    'passlib.hash',
    'passlib.handlers',
    'passlib.handlers.bcrypt',
    'jose',
    'jose.jwt',

    # Crypto
    'base58',
    'hashlib',

    # App modules — routes
    'routes',
    'routes.auth',
    'routes.feed',
    'routes.ipfs_routes',
    'routes.objects',
    'routes.p2fk_local',
    'routes.profiles',
    'routes.search',
    'routes.snapshot',
    'routes.supflix',
    'routes.vault',
    'routes.wallet',
    'routes.admin',
    'routes.chat',
    'routes.user_state',
    'routes.node',
    'routes.node_scan',

    # App modules — rpc (desktop-only)
    'rpc',
    'rpc.wallet_rpc',
    'rpc.chain_scanner',
    'rpc.p2fk_index',

    # App modules — utils
    'utils',
    'utils.helpers',

    # App modules — core
    'config',
    'db_sqlite',
    'p2fk_decoder',
    'blockchain_api',
]

a = Analysis(
    ['server.py'],
    pathex=[backend_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'PIL',
        'scipy',
        'numpy',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='cthulhu-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Console output needed for log forwarding to Tauri
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
