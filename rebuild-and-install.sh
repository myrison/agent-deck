#!/bin/bash
# Rebuild and install agent-deck from source
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BINARY_PATH="./build/agent-deck"

# Kill running agent-deck instances before rebuilding
echo "Stopping running agent-deck instances..."
pkill -x "agent-deck" 2>/dev/null && echo "  Killed running instance" || echo "  No running instance found"
sleep 0.5

# Clean up stale lock files
find "$HOME/.agent-deck/profiles" -name ".lock" -type f -delete 2>/dev/null && echo "  Removed stale lock files" || true

echo ""
echo "Building agent-deck from source..."
cd "$REPO_DIR"
make build

# Verify the build succeeded
if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Build failed - binary not found at $BINARY_PATH"
    exit 1
fi

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

echo "Installing to $INSTALL_DIR..."
cp "$BINARY_PATH" "$INSTALL_DIR/agent-deck"
chmod +x "$INSTALL_DIR/agent-deck"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "⚠️  Warning: $INSTALL_DIR is not in your PATH"
    echo "   Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo "✅ Done! Installed version:"
"$INSTALL_DIR/agent-deck" version
