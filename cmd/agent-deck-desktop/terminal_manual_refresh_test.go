package main

import (
	"context"
	"os/exec"
	"strings"
	"testing"
)

// =============================================================================
// Manual Refresh Tests (PR #120)
// =============================================================================
//
// These tests verify the TriggerManualRefresh() method added for Cmd+Option+R
// keyboard shortcut support. The method forces a full terminal refresh to fix
// visual artifacts in polling mode.
//
// Tests focus on behavioral verification: error handling, state reset, and
// invariants rather than testing internal implementation details.

// TestTriggerManualRefreshClosedTerminal verifies error handling when terminal is closed.
// Behavioral test: verifies the method returns an error with "closed" in the message.
func TestTriggerManualRefreshClosedTerminal(t *testing.T) {
	term := NewTerminal("test-session-id")
	term.SetContext(context.Background())
	term.closed = true

	err := term.TriggerManualRefresh()
	if err == nil {
		t.Error("expected error when terminal is closed, got nil")
	}
	if !strings.Contains(err.Error(), "closed") {
		t.Errorf("expected error message to contain 'closed', got: %v", err)
	}
}

// TestTriggerManualRefreshNoTmuxSession verifies error handling when no tmux session is attached.
// Behavioral test: verifies the method returns an error with "tmux session" in the message.
func TestTriggerManualRefreshNoTmuxSession(t *testing.T) {
	term := NewTerminal("test-session-id")
	term.SetContext(context.Background())
	term.closed = false
	term.tmuxSession = "" // No session attached

	err := term.TriggerManualRefresh()
	if err == nil {
		t.Error("expected error when no tmux session attached, got nil")
	}
	if !strings.Contains(err.Error(), "tmux session") {
		t.Errorf("expected error message to contain 'tmux session', got: %v", err)
	}
}

// TestTriggerManualRefreshInvalidSession verifies error handling when tmux session doesn't exist.
// Behavioral test: verifies the method returns an error with "capture-pane" in the message.
// This tests the path where tmux command execution fails.
func TestTriggerManualRefreshInvalidSession(t *testing.T) {
	term := NewTerminal("test-session-id")
	term.SetContext(context.Background())
	term.closed = false
	term.tmuxSession = "nonexistent-session-12345"

	err := term.TriggerManualRefresh()
	if err == nil {
		t.Error("expected error for nonexistent tmux session, got nil")
	}
	// The error should indicate capture-pane failure
	if !strings.Contains(err.Error(), "capture-pane") {
		t.Errorf("expected error message to contain 'capture-pane', got: %v", err)
	}
}

// TestTriggerManualRefreshResetsLineCounter verifies the line counter reset behavior.
// This is critical for idle refresh - the counter must be reset to prevent premature
// idle refreshes after a user-triggered manual refresh.
func TestTriggerManualRefreshResetsLineCounter(t *testing.T) {
	term := NewTerminal("test-session-id")
	term.SetContext(context.Background())
	term.tmuxSession = "fake-session" // Will fail tmux command, but that's OK
	term.linesSinceLastRefresh = 500  // Set to high value

	// Attempt manual refresh - will fail on tmux command but should still reset counter
	// The reset happens AFTER capture but BEFORE return, so even on error the counter
	// gets reset. However, looking at the code, the reset happens in the success path.
	// So we need to set up the state to verify the behavior.

	// For this test, we verify that IF the method succeeds, it resets the counter.
	// We can't easily test this without tmux, so we test the invariant:
	// After setting linesSinceLastRefresh and calling the method, if it returns nil,
	// the counter should be 0.

	// Since we can't make it succeed without tmux, we test the logic path by
	// inspecting what happens in failure mode first.
	err := term.TriggerManualRefresh()
	if err == nil {
		// If somehow it succeeded (shouldn't happen with fake-session), verify reset
		if term.linesSinceLastRefresh != 0 {
			t.Errorf("expected linesSinceLastRefresh to be reset to 0, got %d", term.linesSinceLastRefresh)
		}
	} else {
		// Expected - fake session fails
		// The counter is NOT reset on error (reset happens after successful capture)
		if term.linesSinceLastRefresh != 500 {
			t.Errorf("on error, counter should not be modified, got %d", term.linesSinceLastRefresh)
		}
	}
}

// TestTriggerManualRefreshHistoryTrackerResetLogic verifies the history tracker reset path.
// This tests the logic without requiring an actual tmux session by checking the reset behavior.
func TestTriggerManualRefreshHistoryTrackerResetLogic(t *testing.T) {
	term := NewTerminal("test-session-id")
	term.SetContext(context.Background())
	term.tmuxSession = "fake-session"

	// Create a history tracker with stale state
	term.historyTracker = NewHistoryTracker("fake-session", 24)
	term.historyTracker.lastViewportLines = []string{"stale", "data"}
	term.historyTracker.lastHistoryIndex = 100

	// Attempt refresh - will fail on tmux command
	err := term.TriggerManualRefresh()

	// On failure, tracker should NOT be reset (reset happens after successful capture)
	if err != nil {
		// Expected failure path
		if term.historyTracker == nil {
			t.Error("tracker should not be nil on error")
		}
		if len(term.historyTracker.lastViewportLines) != 2 {
			t.Errorf("on error, tracker state should not change, got %d lines", len(term.historyTracker.lastViewportLines))
		}
	}
}

// TestTriggerManualRefreshNilContext verifies the method handles nil context gracefully.
// The method has a guard `if ctx != nil` before emitting events - this test ensures
// no panic occurs when context is nil (e.g., during shutdown or testing scenarios).
func TestTriggerManualRefreshNilContext(t *testing.T) {
	term := NewTerminal("test-session-id")
	// Deliberately NOT setting context
	term.ctx = nil
	term.closed = false
	term.tmuxSession = "nonexistent-session-nil-ctx"

	// Should not panic, should return error about capture-pane failure
	err := term.TriggerManualRefresh()
	if err == nil {
		t.Error("expected error for nonexistent session, got nil")
	}
	// The error should be about capture-pane, not about nil context
	if !strings.Contains(err.Error(), "capture-pane") {
		t.Errorf("expected capture-pane error, got: %v", err)
	}
}

// TestTriggerManualRefreshIntegration verifies the full success path with a real tmux session.
// This is an integration test that requires tmux to be available on the system.
// It verifies:
// - Successful capture of tmux content
// - Line counter is reset to 0
// - History tracker is reset
// - No error is returned
//
// NOTE: This test runs with nil context because Wails runtime.EventsEmit requires
// a special context that's only available in a running Wails app. The code path
// guards against nil context with `if ctx != nil` before emitting events.
func TestTriggerManualRefreshIntegration(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	// Create a unique test session name
	sessionName := "manual-refresh-test-session"

	// Clean up any existing session first
	exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	// Create a new tmux session with some content
	createCmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-x", "80", "-y", "24")
	if err := createCmd.Run(); err != nil {
		t.Fatalf("failed to create tmux session: %v", err)
	}

	// Ensure cleanup
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	// Send some content to the session
	sendCmd := exec.Command("tmux", "send-keys", "-t", sessionName, "echo 'test content for manual refresh'", "Enter")
	if err := sendCmd.Run(); err != nil {
		t.Fatalf("failed to send keys to tmux session: %v", err)
	}

	// Set up the terminal - NOTE: We use nil context to avoid Wails runtime issues.
	// The code has `if ctx != nil` guard before EventsEmit, so this is safe.
	term := NewTerminal("integration-test-session")
	term.ctx = nil // Deliberately nil to skip event emission in tests
	term.tmuxSession = sessionName
	term.closed = false
	term.linesSinceLastRefresh = 100 // Set to non-zero to verify reset
	term.historyTracker = NewHistoryTracker(sessionName, 24)
	term.historyTracker.lastViewportLines = []string{"old", "viewport", "data"}
	term.historyTracker.lastHistoryIndex = 50

	// Trigger manual refresh
	err := term.TriggerManualRefresh()

	// Verify success
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}

	// Verify line counter was reset
	if term.linesSinceLastRefresh != 0 {
		t.Errorf("expected linesSinceLastRefresh to be 0, got %d", term.linesSinceLastRefresh)
	}

	// Verify history tracker was reset
	if term.historyTracker == nil {
		t.Error("historyTracker should not be nil after refresh")
	} else {
		// After Reset(), lastViewportLines should be empty and lastHistoryIndex should be 0
		if len(term.historyTracker.lastViewportLines) != 0 {
			t.Errorf("expected historyTracker.lastViewportLines to be reset, got %d lines",
				len(term.historyTracker.lastViewportLines))
		}
		if term.historyTracker.lastHistoryIndex != 0 {
			t.Errorf("expected historyTracker.lastHistoryIndex to be 0, got %d",
				term.historyTracker.lastHistoryIndex)
		}
	}
}
