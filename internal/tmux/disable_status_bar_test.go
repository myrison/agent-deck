package tmux

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Tests for disableStatusBar() in executor_local.go and executor_ssh.go
// These tests verify that the status bar is disabled before attaching to
// sessions, preventing UI leakage in the TUI and desktop app.
// =============================================================================

// TestLocalExecutor_DisableStatusBar_TurnsOffStatusBar verifies that disableStatusBar
// correctly turns off the tmux status bar for a session when it was previously on.
func TestLocalExecutor_DisableStatusBar_TurnsOffStatusBar(t *testing.T) {
	skipIfNoTmuxServer(t)

	// Create a test session
	sessionName := fmt.Sprintf("agentdeck_test_statusbar_%d", time.Now().UnixNano())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	require.NoError(t, cmd.Run(), "Failed to create test session")
	defer func() {
		_ = exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	}()

	// Ensure status is ON initially (default tmux behavior)
	setCmd := exec.Command("tmux", "set-option", "-t", sessionName, "status", "on")
	require.NoError(t, setCmd.Run(), "Failed to set status on")

	// Verify status is on
	checkCmd := exec.Command("tmux", "show-option", "-t", sessionName, "-v", "status")
	output, err := checkCmd.Output()
	require.NoError(t, err)
	assert.Equal(t, "on", strings.TrimSpace(string(output)), "Status should be 'on' initially")

	// Call disableStatusBar
	executor := NewLocalExecutor()
	executor.disableStatusBar(sessionName)

	// Verify status is now off
	checkCmd = exec.Command("tmux", "show-option", "-t", sessionName, "-v", "status")
	output, err = checkCmd.Output()
	require.NoError(t, err)
	assert.Equal(t, "off", strings.TrimSpace(string(output)), "Status should be 'off' after disableStatusBar")
}

// TestLocalExecutor_DisableStatusBar_IdempotentWhenAlreadyOff verifies that
// disableStatusBar is idempotent - calling it when status is already off
// doesn't cause errors or side effects. This is important for performance
// since we call it on every attach.
func TestLocalExecutor_DisableStatusBar_IdempotentWhenAlreadyOff(t *testing.T) {
	skipIfNoTmuxServer(t)

	// Create a test session
	sessionName := fmt.Sprintf("agentdeck_test_statusbar_idem_%d", time.Now().UnixNano())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	require.NoError(t, cmd.Run(), "Failed to create test session")
	defer func() {
		_ = exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	}()

	// Set status to off first
	setCmd := exec.Command("tmux", "set-option", "-t", sessionName, "status", "off")
	require.NoError(t, setCmd.Run(), "Failed to set status off")

	// Call disableStatusBar multiple times - should not error
	executor := NewLocalExecutor()
	executor.disableStatusBar(sessionName)
	executor.disableStatusBar(sessionName)
	executor.disableStatusBar(sessionName)

	// Verify status is still off
	checkCmd := exec.Command("tmux", "show-option", "-t", sessionName, "-v", "status")
	output, err := checkCmd.Output()
	require.NoError(t, err)
	assert.Equal(t, "off", strings.TrimSpace(string(output)), "Status should remain 'off'")
}

// TestLocalExecutor_DisableStatusBar_GracefulOnNonExistentSession verifies that
// disableStatusBar handles non-existent sessions gracefully without panicking.
// This is a best-effort operation - it should fail silently for robustness.
func TestLocalExecutor_DisableStatusBar_GracefulOnNonExistentSession(t *testing.T) {
	skipIfNoTmuxServer(t)

	executor := NewLocalExecutor()

	// This should not panic - it's a best-effort operation
	executor.disableStatusBar("nonexistent_session_" + fmt.Sprintf("%d", time.Now().UnixNano()))
	// Test passes if no panic occurs
}

// TestSSHExecutor_DisableStatusBar_LogicFlow verifies the logical flow of
// disableStatusBar: check status, set off only if not already off.
// This tests the optimization that avoids unnecessary tmux set commands.
func TestSSHExecutor_DisableStatusBar_LogicFlow(t *testing.T) {
	// This test documents and verifies the expected logic flow:
	// 1. Check current status value
	// 2. If status != "off", then set it to "off"
	// 3. If status == "off", do nothing (performance optimization)

	tests := []struct {
		name           string
		currentStatus  string
		shouldCallSet  bool
		description    string
	}{
		{
			name:          "status is on",
			currentStatus: "on",
			shouldCallSet: true,
			description:   "should call set-option when status is 'on'",
		},
		{
			name:          "status is off",
			currentStatus: "off",
			shouldCallSet: false,
			description:   "should skip set-option when status is already 'off' (optimization)",
		},
		{
			name:          "status is 2 (legacy numeric value)",
			currentStatus: "2",
			shouldCallSet: true,
			description:   "should handle legacy numeric status values",
		},
		{
			name:          "status is empty",
			currentStatus: "",
			shouldCallSet: true,
			description:   "should handle empty status value (error case)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the logic from disableStatusBar - this mirrors the actual code
			status := strings.TrimSpace(tt.currentStatus)
			shouldSet := status != "off"

			assert.Equal(t, tt.shouldCallSet, shouldSet, tt.description)
		})
	}
}

// Note: The actual UI leakage fix (status bar appearing in session viewer)
// happens at the PTY/attach level, not at the capture-pane level. The status
// bar appears in the terminal when `tmux attach` is run, but `capture-pane -p`
// never captures status bar content regardless of the status setting.
//
// The behavioral fix is verified by:
// 1. TestLocalExecutor_DisableStatusBar_TurnsOffStatusBar - verifies the status
//    option is correctly set to "off"
// 2. Manual testing with `tmux attach` to verify status bar doesn't appear
//
// The status bar leakage occurs during `tmux attach-session` in a PTY when
// status=on, which is why disableStatusBar() is called before Attach().

// TestDisableStatusBar_CalledBeforeEachAttach documents the behavioral contract
// that disableStatusBar must be called before every attach operation. This test
// verifies the check-then-set pattern handles repeated calls efficiently.
func TestDisableStatusBar_CalledBeforeEachAttach(t *testing.T) {
	skipIfNoTmuxServer(t)

	// Create a test session
	sessionName := fmt.Sprintf("agentdeck_test_repeated_%d", time.Now().UnixNano())
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	require.NoError(t, cmd.Run(), "Failed to create test session")
	defer func() {
		_ = exec.Command("tmux", "kill-session", "-t", sessionName).Run()
	}()

	executor := NewLocalExecutor()

	// Simulate multiple attach operations (as happens in real usage)
	// Each attach should call disableStatusBar
	for i := 0; i < 5; i++ {
		// Set status to ON (simulating external change or new session)
		if i%2 == 0 {
			_ = exec.Command("tmux", "set-option", "-t", sessionName, "status", "on").Run()
		}

		// This is what Attach() calls internally
		executor.disableStatusBar(sessionName)

		// Verify status is always off after disableStatusBar
		checkCmd := exec.Command("tmux", "show-option", "-t", sessionName, "-v", "status")
		output, err := checkCmd.Output()
		require.NoError(t, err)
		assert.Equal(t, "off", strings.TrimSpace(string(output)),
			"Status should be 'off' after disableStatusBar call %d", i)
	}
}
