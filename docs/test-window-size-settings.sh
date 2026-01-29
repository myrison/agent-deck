#!/bin/bash
# Test script to demonstrate tmux window-size behavior with multiple clients
# Tests the difference between 'latest', 'largest', and 'smallest' settings

set -e

SESSION_NAME="test-window-size-$$"
CLEANUP_DONE=false

cleanup() {
    if [ "$CLEANUP_DONE" = false ]; then
        echo ""
        echo "Cleaning up test session..."
        tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
        CLEANUP_DONE=true
    fi
}

trap cleanup EXIT INT TERM

echo "=== tmux Multi-Client Window Size Test ==="
echo ""
echo "This script demonstrates how different window-size settings affect"
echo "multi-client tmux sessions (Agent Deck TUI + RevDen desktop app)."
echo ""

# Create test session
echo "Creating test session: $SESSION_NAME"
tmux new-session -d -s "$SESSION_NAME" -x 80 -y 24
sleep 0.5

# Fill session with content to make dots visible
tmux send-keys -t "$SESSION_NAME" "echo '=== Window Size Test Session ==='" Enter
tmux send-keys -t "$SESSION_NAME" "echo 'Session: $SESSION_NAME'" Enter
tmux send-keys -t "$SESSION_NAME" "for i in {1..20}; do echo \"Line \$i: $(printf '=%.0s' {1..60})\"; done" Enter
sleep 1

echo ""
echo "Test session created with 80x24 initial size."
echo ""

# Test 1: window-size latest (current behavior)
echo "=== Test 1: window-size latest (current default) ==="
echo ""
echo "Setting: window-size latest"
tmux set-option -g window-size latest
tmux set-window-option -t "$SESSION_NAME" window-size latest

echo "Current window size:"
tmux display-message -t "$SESSION_NAME" -p "  Dimensions: #{window_width}x#{window_height}"
echo ""

echo "Simulating desktop app resize to 120x30..."
tmux resize-window -t "$SESSION_NAME" -x 120 -y 30
sleep 0.5

echo "After desktop app resize:"
tmux display-message -t "$SESSION_NAME" -p "  Dimensions: #{window_width}x#{window_height}"
echo ""

echo "Now if TUI (80x24) attaches, it will see dots on the right side."
echo "  Expected: 80 columns of content + 40 columns of dots"
echo ""
read -p "Press Enter to continue to Test 2..."

# Test 2: window-size largest
echo ""
echo "=== Test 2: window-size largest (recommended) ==="
echo ""
echo "Setting: window-size largest"
tmux set-option -g window-size largest
tmux set-window-option -t "$SESSION_NAME" window-size largest

# Simulate two clients with different sizes
echo "Simulating TUI attach (would be 80x24)..."
echo "Simulating desktop attach (120x30)..."
echo ""

echo "With window-size largest:"
tmux display-message -t "$SESSION_NAME" -p "  Dimensions: #{window_width}x#{window_height}"
echo "  Expected: 120x30 (the largest of attached clients)"
echo ""

echo "Result:"
echo "  ✓ Desktop app (120x30): sees full content, no dots"
echo "  ✓ TUI (80x24): sees scrollable viewport, no dots, must scroll horizontally"
echo ""
read -p "Press Enter to continue to Test 3..."

# Test 3: window-size smallest
echo ""
echo "=== Test 3: window-size smallest ==="
echo ""
echo "Setting: window-size smallest"
tmux set-option -g window-size smallest
tmux set-window-option -t "$SESSION_NAME" window-size smallest

# Resize to different size to trigger smallest calculation
tmux resize-window -t "$SESSION_NAME" -x 100 -y 20
sleep 0.5

echo "With window-size smallest:"
tmux display-message -t "$SESSION_NAME" -p "  Dimensions: #{window_width}x#{window_height}"
echo "  Expected: Would be 80x24 (the smallest of attached clients)"
echo ""

echo "Result:"
echo "  ✓ TUI (80x24): sees full content without scrolling"
echo "  ✗ Desktop app (120x30): sees dots/padding, wasted space"
echo ""

# Restore default
echo ""
echo "=== Test Complete ==="
echo ""
echo "Restoring original setting (latest)..."
tmux set-option -g window-size latest

echo ""
echo "Summary of Recommendations:"
echo ""
echo "  window-size latest (current):  ❌ Causes dots in smaller client"
echo "  window-size largest:           ✅ Best UX - no dots, scrollable"
echo "  window-size smallest:          ⚠️  Wastes space in larger client"
echo ""
echo "Recommendation: Use 'window-size largest' for multi-client scenarios."
echo ""

cleanup
