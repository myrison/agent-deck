#!/bin/bash
# Rebuild and install RevDen desktop app from source
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$REPO_DIR/cmd/agent-deck-desktop"
APP_NAME="RevDen.app"

echo "Building RevDen desktop app from source..."
cd "$REPO_DIR"
make desktop-build

# Verify the build succeeded
if [ ! -d "$DESKTOP_DIR/build/bin/$APP_NAME" ]; then
    echo "Error: Build failed - app bundle not found at $DESKTOP_DIR/build/bin/$APP_NAME"
    exit 1
fi

echo ""
echo "Installing to /Applications..."
rm -rf "/Applications/$APP_NAME"
cp -r "$DESKTOP_DIR/build/bin/$APP_NAME" "/Applications/"

echo "✅ Done! RevDen installed to /Applications"
