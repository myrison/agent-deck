#!/bin/bash
# Rebuild and install Agent Deck Desktop to /Applications

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Agent Deck.app"
BUILD_PATH="$SCRIPT_DIR/build/bin/RevDen.app"
INSTALL_PATH="/Applications/$APP_NAME"

echo "Building Agent Deck Desktop..."
cd "$SCRIPT_DIR"
wails build

if [ ! -d "$BUILD_PATH" ]; then
    echo "Error: Build failed - $BUILD_PATH not found"
    exit 1
fi

echo "Closing running instances (if any)..."
pkill -f "RevDen" 2>/dev/null || true
pkill -f "Agent Deck" 2>/dev/null || true
# Kill TUI agent-deck process to prevent lock conflicts
pkill -x "agent-deck" 2>/dev/null || true
sleep 1

echo "Cleaning up stale lock files..."
find ~/.agent-deck/profiles -name ".lock" -type f -delete 2>/dev/null || true

echo "Clearing WebKit cache..."
rm -rf ~/Library/WebKit/com.wails.revden* 2>/dev/null || true
rm -rf ~/Library/Caches/com.wails.revden* 2>/dev/null || true

echo "Installing to /Applications..."
rm -rf "$INSTALL_PATH"
cp -R "$BUILD_PATH" "$INSTALL_PATH"

echo "Clearing quarantine attribute..."
xattr -cr "$INSTALL_PATH"

echo "Ad-hoc signing app..."
codesign --force --deep --sign - "$INSTALL_PATH"

echo "Done! Agent Deck installed to $INSTALL_PATH"
echo ""
echo "Launch with: open '/Applications/$APP_NAME'"
