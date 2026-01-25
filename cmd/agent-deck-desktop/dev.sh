#!/bin/bash
# Development mode launcher for RevDen
# Uses wails.dev.json for "RevDen Dev" branding

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

# Run wails dev
wails dev "$@"
