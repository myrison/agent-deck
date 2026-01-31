package main

import (
	"context"
	"strings"
	"testing"
)

// =============================================================================
// App Manual Refresh Wails Binding Tests (PR #120)
// =============================================================================
//
// These tests verify the TriggerManualTerminalRefresh() Wails binding that
// exposes manual refresh functionality to the frontend. This is the bridge
// between the Cmd+Option+R keyboard shortcut and the Terminal.TriggerManualRefresh()
// backend method.
//
// Tests focus on behavioral verification: proper terminal lookup, error handling,
// and delegation to the underlying Terminal method.

// TestTriggerManualTerminalRefreshTerminalNotFound verifies error handling when
// the requested terminal/session doesn't exist.
func TestTriggerManualTerminalRefreshTerminalNotFound(t *testing.T) {
	app, err := NewApp()
	if err != nil {
		t.Fatalf("NewApp failed: %v", err)
	}
	// Don't call startup - it tries to use Wails runtime which isn't available in tests
	// Just set a basic context
	app.ctx = context.Background()

	// Request refresh for non-existent session
	err = app.TriggerManualTerminalRefresh("nonexistent-session-id-12345")
	if err == nil {
		t.Error("expected error for non-existent terminal, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected error message to contain 'not found', got: %v", err)
	}
}

// TestTriggerManualTerminalRefreshEmptySessionID verifies error handling for empty session ID.
func TestTriggerManualTerminalRefreshEmptySessionID(t *testing.T) {
	app, err := NewApp()
	if err != nil {
		t.Fatalf("NewApp failed: %v", err)
	}
	app.ctx = context.Background()

	err = app.TriggerManualTerminalRefresh("")
	if err == nil {
		t.Error("expected error for empty session ID, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected error message to contain 'not found', got: %v", err)
	}
}

// TestTriggerManualTerminalRefreshDelegation verifies that the method correctly
// delegates to Terminal.TriggerManualRefresh(). We can't easily test success
// without tmux, but we can verify the delegation happens by checking that
// terminal errors are propagated.
func TestTriggerManualTerminalRefreshDelegation(t *testing.T) {
	app, err := NewApp()
	if err != nil {
		t.Fatalf("NewApp failed: %v", err)
	}
	app.ctx = context.Background()

	// GetOrCreate will create a terminal instance
	sessionID := "test-session-delegation"
	term := app.terminals.GetOrCreate(sessionID)
	term.closed = false
	term.tmuxSession = "" // No session - will fail

	// Call the Wails binding
	err = app.TriggerManualTerminalRefresh(sessionID)
	if err == nil {
		t.Error("expected error when terminal has no tmux session, got nil")
	}

	// Verify the error comes from Terminal.TriggerManualRefresh (not from terminal lookup)
	// The error should mention "tmux session" from the underlying method
	if !strings.Contains(err.Error(), "tmux session") {
		t.Errorf("expected delegated error about tmux session, got: %v", err)
	}
}

// TestTriggerManualTerminalRefreshMultipleTerminals verifies correct terminal
// selection when multiple terminals exist.
func TestTriggerManualTerminalRefreshMultipleTerminals(t *testing.T) {
	app, err := NewApp()
	if err != nil {
		t.Fatalf("NewApp failed: %v", err)
	}
	app.ctx = context.Background()

	// Create multiple terminals via GetOrCreate
	term1 := app.terminals.GetOrCreate("session-1")
	term1.tmuxSession = ""

	term2 := app.terminals.GetOrCreate("session-2")
	term2.closed = true // This one is closed

	// Request refresh for session-2 (the closed one)
	err = app.TriggerManualTerminalRefresh("session-2")
	if err == nil {
		t.Error("expected error for closed terminal, got nil")
	}

	// Should get "terminal closed" error from the specific terminal
	if !strings.Contains(err.Error(), "closed") {
		t.Errorf("expected error about closed terminal, got: %v", err)
	}

	// Request refresh for session-1 (different error - no tmux session)
	err = app.TriggerManualTerminalRefresh("session-1")
	if err == nil {
		t.Error("expected error for terminal without session, got nil")
	}
	if !strings.Contains(err.Error(), "tmux session") {
		t.Errorf("expected error about tmux session, got: %v", err)
	}
}
