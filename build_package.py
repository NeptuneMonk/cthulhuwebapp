#!/usr/bin/env python3
"""Build Cthulhu standalone web app package.

Builds the React frontend in production mode with standalone configuration,
then packages it into a downloadable ZIP. The result can be:
  - Opened directly (index.html) for local use
  - Deployed to any static host
  - Used as the web root for a Tauri desktop wrapper
"""
import subprocess
import os
import sys
import zipfile
import shutil
import argparse
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
DIST = ROOT / "dist"


def build_frontend():
    """Run production build of the React frontend."""
    print("Building frontend (production)...")
    env = os.environ.copy()
    # Set standalone mode so the app doesn't need a backend URL
    env["REACT_APP_STANDALONE"] = "true"
    env["GENERATE_SOURCEMAP"] = "false"
    env["INLINE_RUNTIME_CHUNK"] = "false"
    # Use the current REACT_APP_BACKEND_URL as default server
    if "REACT_APP_BACKEND_URL" not in env:
        env["REACT_APP_BACKEND_URL"] = ""

    result = subprocess.run(
        ["yarn", "build"],
        cwd=str(FRONTEND),
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        print(f"Build STDERR: {result.stderr[-1000:]}")
        raise RuntimeError(f"Frontend build failed: {result.stderr[-500:]}")

    build_dir = FRONTEND / "build"
    if not build_dir.exists():
        raise RuntimeError("Build directory not found after build")

    print(f"Build complete: {build_dir}")
    return build_dir


def create_zip(build_dir: Path, version: str) -> Path:
    """Package the build output into a versioned ZIP."""
    DIST.mkdir(exist_ok=True)
    zip_name = f"cthulhu-v{version}.zip"
    zip_path = DIST / zip_name

    # Remove old zip if exists
    if zip_path.exists():
        zip_path.unlink()

    print(f"Creating {zip_name}...")
    with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(str(build_dir)):
            # Skip unnecessary directories
            dirs[:] = [d for d in dirs if d not in ['__pycache__', '.git']]
            for f in files:
                filepath = Path(root) / f
                arcname = f"cthulhu/{filepath.relative_to(build_dir)}"
                zf.write(str(filepath), arcname)

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print(f"Package created: {zip_path} ({size_mb:.1f} MB)")
    return zip_path


def main():
    parser = argparse.ArgumentParser(description="Build Cthulhu desktop package")
    parser.add_argument("--version", default="1.0.0", help="Version string")
    parser.add_argument("--skip-build", action="store_true", help="Skip frontend build, use existing build/")
    args = parser.parse_args()

    build_dir = FRONTEND / "build"

    if not args.skip_build:
        build_dir = build_frontend()
    elif not build_dir.exists():
        print("ERROR: --skip-build specified but no build/ directory found")
        sys.exit(1)

    zip_path = create_zip(build_dir, args.version)
    print(f"\nDone! Package: {zip_path}")
    print(f"Upload to IPFS and publish via Admin Dashboard > Releases > Etch Release")


if __name__ == "__main__":
    main()
