#!/bin/bash
# Development mode launcher for RevDen
# Uses wails.dev.json for "RevDen (Dev)" branding

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Restore from previous interrupted run if needed
if [ -f wails.json.bak ]; then
    mv wails.json.bak wails.json
fi

# Backup original config
cp wails.json wails.json.bak

# Restore on exit (normal, error, or interrupt)
cleanup() {
    if [ -f wails.json.bak ]; then
        mv wails.json.bak wails.json
    fi
}
trap cleanup EXIT

# Use dev config
cp wails.dev.json wails.json

# Clean build directory to force rebuild with new name
rm -rf build/bin

# Run wails dev
wails dev "$@"
