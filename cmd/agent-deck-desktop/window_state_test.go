package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// setupTestHooks configures test hooks and returns a cleanup function.
// This isolates tests from real system state and each other.
func setupTestHooks(t *testing.T) func() {
	t.Helper()
	tmpDir := t.TempDir()
	statePath := filepath.Join(tmpDir, "window-state.json")

	// Save original hooks
	origGetStatePath := getStatePath
	origCheckProcessExists := checkProcessExists
	origGetCurrentPID := getCurrentPID
	origGetEnvVar := getEnvVar

	// Install test hooks
	getStatePath = func() string { return statePath }
	checkProcessExists = func(pid int) bool { return true } // Default: all PIDs alive
	getCurrentPID = func() int { return 12345 }             // Consistent test PID
	getEnvVar = func(key string) string { return "" }       // No env vars by default

	return func() {
		getStatePath = origGetStatePath
		checkProcessExists = origCheckProcessExists
		getCurrentPID = origGetCurrentPID
		getEnvVar = origGetEnvVar
	}
}

// readState reads the window state file for test verification.
func readState(t *testing.T) *WindowState {
	t.Helper()
	data, err := os.ReadFile(getStatePath())
	if err != nil {
		t.Fatalf("Failed to read state file: %v", err)
	}
	var state WindowState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("Failed to parse state: %v", err)
	}
	return &state
}

func TestRegisterWindow_PrimaryWindowWithoutEnvVar(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// When no REVDEN_WINDOW_NUM is set, window should be primary (1)
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if windowNum != 1 {
		t.Errorf("Expected primary window number 1, got %d", windowNum)
	}

	// Verify window was registered in state
	state := readState(t)
	if _, exists := state.ActiveWindows["1"]; !exists {
		t.Error("Window 1 should be registered in state")
	}
}

func TestRegisterWindow_SecondaryWindowWithEnvVar(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Simulate a secondary window with REVDEN_WINDOW_NUM=3
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "3"
		}
		return ""
	}

	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if windowNum != 3 {
		t.Errorf("Expected window number 3, got %d", windowNum)
	}

	// Verify window 3 was registered
	state := readState(t)
	if _, exists := state.ActiveWindows["3"]; !exists {
		t.Error("Window 3 should be registered in state")
	}
}

func TestRegisterWindow_InvalidEnvVarDefaultsToPrimary(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Invalid env var value should default to primary window
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "not-a-number"
		}
		return ""
	}

	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if windowNum != 1 {
		t.Errorf("Expected default to primary window 1, got %d", windowNum)
	}
}

func TestAllocateNextWindowNumber_Increments(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// First allocation should return 2 (first secondary window)
	num1, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}
	if num1 != 2 {
		t.Errorf("First allocation should be 2, got %d", num1)
	}

	// Second allocation should return 3
	num2, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}
	if num2 != 3 {
		t.Errorf("Second allocation should be 3, got %d", num2)
	}

	// Third allocation should return 4
	num3, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}
	if num3 != 4 {
		t.Errorf("Third allocation should be 4, got %d", num3)
	}
}

func TestUnregisterWindow_RemovesFromState(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// First register a window
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	// Verify it's there
	state := readState(t)
	if len(state.ActiveWindows) != 1 {
		t.Fatalf("Expected 1 active window, got %d", len(state.ActiveWindows))
	}

	// Unregister it
	unregisterWindow(windowNum)

	// Verify it's gone
	state = readState(t)
	if len(state.ActiveWindows) != 0 {
		t.Errorf("Expected 0 active windows after unregister, got %d", len(state.ActiveWindows))
	}
}

func TestRegisterWindow_CleansUpDeadProcesses(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Manually create state with a "dead" window (PID that checkProcessExists says is dead)
	deadPID := 99999
	checkProcessExists = func(pid int) bool {
		return pid != deadPID // deadPID is "dead", others are alive
	}

	// Write initial state with dead window
	initialState := WindowState{
		NextWindowNumber: 5,
		ActiveWindows: map[string]WindowInfo{
			"2": {PID: deadPID},
			"3": {PID: 11111}, // alive
		},
	}
	data, _ := json.Marshal(initialState)
	if err := os.MkdirAll(filepath.Dir(getStatePath()), 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(getStatePath(), data, 0644); err != nil {
		t.Fatalf("Failed to write initial state: %v", err)
	}

	// Register a new window - this should trigger cleanup
	_, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	// Verify dead window (2) was cleaned up, alive window (3) remains
	state := readState(t)
	if _, exists := state.ActiveWindows["2"]; exists {
		t.Error("Dead window 2 should have been cleaned up")
	}
	if _, exists := state.ActiveWindows["3"]; !exists {
		t.Error("Alive window 3 should still exist")
	}
	// Plus our newly registered window (1)
	if _, exists := state.ActiveWindows["1"]; !exists {
		t.Error("Newly registered window 1 should exist")
	}
}

func TestMultipleWindowsCanCoexist(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Simulate opening multiple windows in sequence

	// Window 1: primary (no env var)
	getCurrentPID = func() int { return 1001 }
	getEnvVar = func(key string) string { return "" }
	num1, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if num1 != 1 {
		t.Errorf("First window should be 1, got %d", num1)
	}

	// Allocate number for window 2
	nextNum, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}
	if nextNum != 2 {
		t.Errorf("Next number should be 2, got %d", nextNum)
	}

	// Window 2: secondary with assigned number
	getCurrentPID = func() int { return 1002 }
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "2"
		}
		return ""
	}
	num2, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if num2 != 2 {
		t.Errorf("Second window should be 2, got %d", num2)
	}

	// Verify both windows are registered
	state := readState(t)
	if len(state.ActiveWindows) != 2 {
		t.Errorf("Expected 2 active windows, got %d", len(state.ActiveWindows))
	}
	if state.ActiveWindows["1"].PID != 1001 {
		t.Errorf("Window 1 should have PID 1001, got %d", state.ActiveWindows["1"].PID)
	}
	if state.ActiveWindows["2"].PID != 1002 {
		t.Errorf("Window 2 should have PID 1002, got %d", state.ActiveWindows["2"].PID)
	}
}

func TestStatePersistsAcrossOperations(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Register window
	_, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	// Allocate some numbers
	_, _ = allocateNextWindowNumber()
	_, _ = allocateNextWindowNumber()

	// Verify NextWindowNumber persisted
	state := readState(t)
	if state.NextWindowNumber != 4 { // Started at 2, incremented twice
		t.Errorf("Expected NextWindowNumber 4, got %d", state.NextWindowNumber)
	}
}

func TestEmptyStateFile_InitializesCorrectly(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Create empty state file
	if err := os.MkdirAll(filepath.Dir(getStatePath()), 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(getStatePath(), []byte{}, 0644); err != nil {
		t.Fatalf("Failed to create empty state file: %v", err)
	}

	// Should still work correctly
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed with empty file: %v", err)
	}
	if num != 2 {
		t.Errorf("Expected 2 from empty file, got %d", num)
	}
}

func TestInvalidJSONStateFile_RecoverGracefully(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Create invalid JSON state file
	if err := os.MkdirAll(filepath.Dir(getStatePath()), 0755); err != nil {
		t.Fatalf("Failed to create directory: %v", err)
	}
	if err := os.WriteFile(getStatePath(), []byte("not valid json{{{"), 0644); err != nil {
		t.Fatalf("Failed to create invalid state file: %v", err)
	}

	// Should recover and use defaults
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed with invalid file: %v", err)
	}
	if num != 2 {
		t.Errorf("Expected 2 (default) from invalid file, got %d", num)
	}
}

func TestRegisterWindow_UpdatesNextWindowNumberMonotonically(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Simulate a window spawned with a high number (e.g., from previous session)
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "10"
		}
		return ""
	}

	// Register window 10
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}
	if windowNum != 10 {
		t.Errorf("Expected window number 10, got %d", windowNum)
	}

	// Verify NextWindowNumber was updated to 11 (not stuck at 2)
	state := readState(t)
	if state.NextWindowNumber != 11 {
		t.Errorf("NextWindowNumber should be 11 after registering window 10, got %d", state.NextWindowNumber)
	}

	// Next allocation should return 11, not 2
	getEnvVar = func(key string) string { return "" } // Reset for allocation
	nextNum, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}
	if nextNum != 11 {
		t.Errorf("Next allocated number should be 11, got %d", nextNum)
	}
}
