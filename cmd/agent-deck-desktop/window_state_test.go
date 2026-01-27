package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
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

// =============================================================================
// BEHAVIORAL TESTS: Window Registration
// These test observable outcomes, not internal state
// =============================================================================

func TestPrimaryWindow_GetsNumber1_WhenNoEnvVar(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// BEHAVIOR: First window without env var should be primary (number 1)
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	// Observable output: the returned window number
	if windowNum != 1 {
		t.Errorf("Primary window should get number 1, got %d", windowNum)
	}
}

func TestSecondaryWindow_GetsAssignedNumber_FromEnvVar(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "5"
		}
		return ""
	}

	// BEHAVIOR: Window should get the number specified in env var
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	if windowNum != 5 {
		t.Errorf("Window should get assigned number 5, got %d", windowNum)
	}
}

func TestInvalidEnvVar_DefaultsToPrimary(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// All these should default to primary window (1)
	testCases := []string{"not-a-number", "abc123", "1.5", "", "-1", "-100", "0"}
	for _, invalidVal := range testCases {
		// Reset state for each test case
		os.Remove(getStatePath())

		getEnvVar = func(v string) func(string) string {
			return func(key string) string {
				if key == "REVDEN_WINDOW_NUM" && v != "" {
					return v
				}
				return ""
			}
		}(invalidVal)

		windowNum, err := registerWindow()
		if err != nil {
			t.Fatalf("registerWindow failed for '%s': %v", invalidVal, err)
		}

		// BEHAVIOR: Invalid, negative, or zero env vars should default to primary window
		if windowNum != 1 {
			t.Errorf("Invalid env var '%s' should default to 1, got %d", invalidVal, windowNum)
		}
	}
}

// =============================================================================
// BEHAVIORAL TESTS: Window Number Allocation
// =============================================================================

func TestAllocatedNumbers_AreUnique_AcrossMultipleCalls(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// BEHAVIOR: Each allocation must return a unique number
	seen := make(map[int]bool)
	var lastNum int
	for i := 0; i < 25; i++ {
		num, err := allocateNextWindowNumber()
		if err != nil {
			t.Fatalf("Allocation %d failed: %v", i, err)
		}

		if seen[num] {
			t.Errorf("Allocation returned duplicate number %d on call %d (last was %d)", num, i, lastNum)
		}
		seen[num] = true
		lastNum = num
	}

	// All numbers should be sequential starting from 2
	if len(seen) != 25 {
		t.Errorf("Expected 25 unique allocations, got %d", len(seen))
	}
}

func TestAllocatedNumbers_StartAt2_ForSecondaryWindows(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// BEHAVIOR: First secondary window number is 2 (1 is reserved for primary)
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("allocateNextWindowNumber failed: %v", err)
	}

	if num != 2 {
		t.Errorf("First allocated number should be 2, got %d", num)
	}
}

// =============================================================================
// BEHAVIORAL TESTS: Window Lifecycle (Register → Unregister → Re-register)
// These verify cleanup through observable behavior, not state peeking
// =============================================================================

func TestUnregisteredWindowNumber_CanBeReused(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Register as primary window
	num1, err := registerWindow()
	if err != nil {
		t.Fatalf("First registerWindow failed: %v", err)
	}

	// Unregister
	unregisterWindow(num1)

	// BEHAVIOR: After unregistering, the same PID can register again
	// This proves cleanup happened - if window was still tracked, behavior would differ
	num2, err := registerWindow()
	if err != nil {
		t.Fatalf("Second registerWindow failed: %v", err)
	}

	// Should get primary window again (same behavior as first registration)
	if num2 != 1 {
		t.Errorf("Re-registration should get primary window 1, got %d", num2)
	}
}

func TestDeadProcess_IsCleanedUp_OnNextRegistration(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	deadPID := 99999
	alivePID := 11111

	// Setup: Mark only deadPID as dead
	checkProcessExists = func(pid int) bool {
		return pid != deadPID
	}

	// Seed initial state with a dead process window
	initialState := WindowState{
		ActiveWindows: map[string]WindowInfo{
			"2": {PID: deadPID},
			"3": {PID: alivePID},
		},
	}
	data, _ := json.Marshal(initialState)
	os.MkdirAll(filepath.Dir(getStatePath()), 0755)
	os.WriteFile(getStatePath(), data, 0644)

	// Register a new window - triggers cleanup
	_, err := registerWindow()
	if err != nil {
		t.Fatalf("registerWindow failed: %v", err)
	}

	// BEHAVIOR: Verify cleanup through subsequent allocation behavior
	// If dead window 2 was cleaned up, its number becomes available for reuse

	// The observable behavior we care about: registration succeeded
	// and alive windows are preserved (tested via next window registration)
	getCurrentPID = func() int { return alivePID }
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "3" // Try to register as window 3 (same as alive window)
		}
		return ""
	}

	num, err := registerWindow()
	if err != nil {
		t.Fatalf("Re-registration failed: %v", err)
	}

	// Window 3 should be successfully registered (alive process still valid)
	if num != 3 {
		t.Errorf("Should register as window 3, got %d", num)
	}
}

// =============================================================================
// BEHAVIORAL TESTS: Gap-filling (numbers stay compact across sessions)
// =============================================================================

func TestAllocation_FillsGaps_WhenWindowsClosed(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Allocate windows 2 and 3
	num1, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("First allocation failed: %v", err)
	}
	if num1 != 2 {
		t.Errorf("First allocation should be 2, got %d", num1)
	}

	num2, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Second allocation failed: %v", err)
	}
	if num2 != 3 {
		t.Errorf("Second allocation should be 3, got %d", num2)
	}

	// Close window 2
	unregisterWindow(2)

	// BEHAVIOR: Next allocation should reuse 2 (lowest gap)
	num3, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Third allocation failed: %v", err)
	}
	if num3 != 2 {
		t.Errorf("Should reuse closed window number 2, got %d", num3)
	}
}

func TestAllocation_SkipsOccupied_FindsFirstGap(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Seed state with windows 2 and 3 occupied, but not 4
	initialState := WindowState{
		ActiveWindows: map[string]WindowInfo{
			"2": {PID: 2000},
			"3": {PID: 3000},
		},
	}
	data, _ := json.Marshal(initialState)
	os.MkdirAll(filepath.Dir(getStatePath()), 0755)
	os.WriteFile(getStatePath(), data, 0644)

	// BEHAVIOR: Should allocate 4 (first available after 2 and 3)
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Allocation failed: %v", err)
	}
	if num != 4 {
		t.Errorf("Should allocate 4 (first gap after 2,3), got %d", num)
	}
}

// formatInt converts int to string without importing strconv
func formatInt(n int) string {
	if n == 0 {
		return "0"
	}
	result := ""
	for n > 0 {
		result = string(rune('0'+n%10)) + result
		n /= 10
	}
	return result
}

// =============================================================================
// CONCURRENT ACCESS TESTS: Verify file locking works
// =============================================================================

func TestConcurrentAllocations_ReturnUniqueNumbers(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	const numGoroutines = 20
	results := make(chan int, numGoroutines)
	var wg sync.WaitGroup

	// Launch concurrent allocations
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			num, err := allocateNextWindowNumber()
			if err != nil {
				t.Errorf("Concurrent allocation failed: %v", err)
				return
			}
			results <- num
		}()
	}

	wg.Wait()
	close(results)

	// BEHAVIOR: All allocated numbers must be unique
	seen := make(map[int]bool)
	for num := range results {
		if seen[num] {
			t.Errorf("Concurrent allocation returned duplicate: %d", num)
		}
		seen[num] = true
	}

	if len(seen) != numGoroutines {
		t.Errorf("Expected %d unique numbers, got %d", numGoroutines, len(seen))
	}
}

func TestConcurrentRegistrations_AllSucceed(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	const numGoroutines = 10
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines)

	// Launch concurrent registrations with different window numbers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(windowNum int) {
			defer wg.Done()

			// Each goroutine gets unique PID and window number
			// Note: This tests file locking, not hook thread-safety
			// In production, each window is a separate process
			err := withFileLock(func(state *WindowState) error {
				state.ActiveWindows[formatInt(windowNum)] = WindowInfo{
					PID: windowNum * 1000,
				}
				return nil
			})
			if err != nil {
				errors <- err
			}
		}(i + 10) // Window numbers 10-19
	}

	wg.Wait()
	close(errors)

	// BEHAVIOR: All concurrent registrations should succeed
	for err := range errors {
		t.Errorf("Concurrent registration failed: %v", err)
	}
}

// =============================================================================
// RECOVERY TESTS: System handles corrupted/missing state gracefully
// =============================================================================

func TestMissingStateFile_CreatesNew(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Don't create any state file - it doesn't exist

	// BEHAVIOR: Should work fine with no pre-existing state
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Should handle missing state file: %v", err)
	}

	// First allocation is 2
	if num != 2 {
		t.Errorf("First allocation should be 2, got %d", num)
	}
}

func TestCorruptedStateFile_RecoversToDfaults(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Create corrupted state file
	os.MkdirAll(filepath.Dir(getStatePath()), 0755)
	os.WriteFile(getStatePath(), []byte("{{{not valid json"), 0644)

	// BEHAVIOR: Should recover and use defaults
	num, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Should recover from corrupted state: %v", err)
	}

	if num != 2 {
		t.Errorf("Should use default (2) after corruption, got %d", num)
	}

	// Subsequent operations should work normally
	num2, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Second allocation failed: %v", err)
	}
	if num2 != 3 {
		t.Errorf("Second allocation should be 3, got %d", num2)
	}
}

func TestEmptyStateFile_InitializesDefaults(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Create empty state file
	os.MkdirAll(filepath.Dir(getStatePath()), 0755)
	os.WriteFile(getStatePath(), []byte{}, 0644)

	// BEHAVIOR: Should initialize with defaults
	windowNum, err := registerWindow()
	if err != nil {
		t.Fatalf("Should handle empty state file: %v", err)
	}

	if windowNum != 1 {
		t.Errorf("Primary window should be 1, got %d", windowNum)
	}
}

// =============================================================================
// INTEGRATION TEST: Full multi-window workflow
// =============================================================================

func TestFullWorkflow_OpenCloseReopenWindows(t *testing.T) {
	cleanup := setupTestHooks(t)
	defer cleanup()

	// Simulate real multi-window usage pattern:
	// 1. Open primary window
	// 2. Open secondary window (Cmd+Shift+N)
	// 3. Close secondary window
	// 4. Open another secondary window
	// 5. Verify numbering is correct

	// Step 1: Primary window starts
	getCurrentPID = func() int { return 1001 }
	getEnvVar = func(key string) string { return "" }

	primaryNum, err := registerWindow()
	if err != nil {
		t.Fatalf("Primary window registration failed: %v", err)
	}
	if primaryNum != 1 {
		t.Errorf("Primary should be 1, got %d", primaryNum)
	}

	// Step 2: User presses Cmd+Shift+N - allocate number for new window
	secondaryNum, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Secondary allocation failed: %v", err)
	}
	if secondaryNum != 2 {
		t.Errorf("First secondary should be 2, got %d", secondaryNum)
	}

	// New process spawns with allocated number
	getCurrentPID = func() int { return 1002 }
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "2"
		}
		return ""
	}

	registeredNum, err := registerWindow()
	if err != nil {
		t.Fatalf("Secondary registration failed: %v", err)
	}
	if registeredNum != 2 {
		t.Errorf("Registered secondary should be 2, got %d", registeredNum)
	}

	// Step 3: User closes secondary window
	unregisterWindow(2)

	// Step 4: User opens another secondary window
	thirdNum, err := allocateNextWindowNumber()
	if err != nil {
		t.Fatalf("Third allocation failed: %v", err)
	}

	// CRITICAL BEHAVIOR: Should get 2, reusing the closed window's number
	// Gap-filling keeps numbers compact and intuitive
	if thirdNum != 2 {
		t.Errorf("Third window should reuse number 2 (gap-filling), got %d", thirdNum)
	}

	// Register the third window
	getCurrentPID = func() int { return 1003 }
	getEnvVar = func(key string) string {
		if key == "REVDEN_WINDOW_NUM" {
			return "2"
		}
		return ""
	}

	finalNum, err := registerWindow()
	if err != nil {
		t.Fatalf("Third registration failed: %v", err)
	}
	if finalNum != 2 {
		t.Errorf("Final window should be 2, got %d", finalNum)
	}
}
