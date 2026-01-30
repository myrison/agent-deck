package session

import (
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestFileLock_BasicLockUnlock(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock := newFileLock(lockPath)

	// First goroutine acquires lock
	handle1, err := lock.Lock()
	if err != nil {
		t.Fatalf("First Lock() failed: %v", err)
	}

	// Second goroutine should block on Lock() until first releases
	done := make(chan bool)
	go func() {
		handle2, err := lock.Lock()
		if err != nil {
			t.Errorf("Second Lock() failed: %v", err)
			return
		}
		defer func() { _ = handle2.Unlock() }()
		done <- true
	}()

	// Give second goroutine time to block on lock
	time.Sleep(50 * time.Millisecond)

	// Second goroutine should still be blocked
	select {
	case <-done:
		t.Fatal("Second lock acquired while first lock was held - mutual exclusion broken")
	default:
		// Expected: second lock is blocked
	}

	// Release first lock
	if err := handle1.Unlock(); err != nil {
		t.Fatalf("Unlock() failed: %v", err)
	}

	// Now second lock should acquire successfully
	select {
	case <-done:
		// Expected: second lock acquired after first released
	case <-time.After(1 * time.Second):
		t.Fatal("Second lock didn't acquire after first lock released")
	}
}

func TestFileLock_DoubleUnlock(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock := newFileLock(lockPath)

	handle, err := lock.Lock()
	if err != nil {
		t.Fatalf("Lock() failed: %v", err)
	}

	if err := handle.Unlock(); err != nil {
		t.Fatalf("First Unlock() failed: %v", err)
	}

	// Second unlock should be a no-op (file is nil)
	if err := handle.Unlock(); err != nil {
		t.Fatalf("Second Unlock() should be no-op but got: %v", err)
	}
}

func TestFileLock_ConcurrentSaves(t *testing.T) {
	// Test that concurrent saves from the same process don't corrupt data.
	// Each goroutine adds a unique session; all should be preserved.
	tmpDir := t.TempDir()

	// Create storage with the lock
	storagePath := filepath.Join(tmpDir, "sessions.json")
	s := &Storage{
		path:     storagePath,
		profile:  "_test",
		fileLock: newFileLock(storagePath),
	}

	const numGoroutines = 10
	var wg sync.WaitGroup
	var errors []error
	var errorsMu sync.Mutex

	// Run multiple goroutines that each load, append, and save
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			// Load current state
			existing, _, err := s.LoadWithGroups()
			if err != nil {
				errorsMu.Lock()
				errors = append(errors, err)
				errorsMu.Unlock()
				return
			}

			// Add a new session
			newSession := &Instance{
				ID:        "goroutine-" + time.Now().Format(time.RFC3339Nano) + "-" + string(rune('A'+index)),
				Title:     "Concurrent Test",
				Tool:      "claude",
				Status:    StatusIdle,
				CreatedAt: time.Now(),
			}
			existing = append(existing, newSession)

			// Save
			if err := s.SaveWithGroups(existing, nil); err != nil {
				errorsMu.Lock()
				errors = append(errors, err)
				errorsMu.Unlock()
			}
		}(i)
	}

	wg.Wait()

	// Check for errors
	if len(errors) > 0 {
		t.Errorf("Got %d errors during concurrent saves: %v", len(errors), errors)
	}

	// Verify final state - should have at least some sessions
	// (exact count depends on timing, but should be >= 1 and the file should be valid)
	final, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("Failed to load final state: %v", err)
	}

	if len(final) == 0 {
		t.Error("Final state has no sessions - concurrent saves corrupted the file")
	}

	t.Logf("Final state has %d sessions (concurrent saves preserved data)", len(final))
}

func TestStorage_WithFileLock(t *testing.T) {
	// Test that multiple Storage instances targeting the same file
	// don't corrupt each other (cross-instance safety via file locking)
	tmpDir := t.TempDir()
	t.Setenv("AGENTDECK_DATA_DIR", tmpDir)

	// Create two Storage instances for the same profile
	s1, err := NewStorageWithProfile("test-lock")
	if err != nil {
		t.Fatalf("NewStorageWithProfile s1 failed: %v", err)
	}

	s2, err := NewStorageWithProfile("test-lock")
	if err != nil {
		t.Fatalf("NewStorageWithProfile s2 failed: %v", err)
	}

	var wg sync.WaitGroup
	var errors []error
	var errorsMu sync.Mutex

	// Both instances write concurrently
	for i := 0; i < 5; i++ {
		wg.Add(2)

		// Instance 1 writes
		go func(idx int) {
			defer wg.Done()
			instances := []*Instance{
				{ID: "s1-" + string(rune('A'+idx)), Title: "S1", Tool: "claude", Status: StatusIdle, CreatedAt: time.Now()},
			}
			if err := s1.SaveWithGroups(instances, nil); err != nil {
				errorsMu.Lock()
				errors = append(errors, err)
				errorsMu.Unlock()
			}
		}(i)

		// Instance 2 writes
		go func(idx int) {
			defer wg.Done()
			instances := []*Instance{
				{ID: "s2-" + string(rune('A'+idx)), Title: "S2", Tool: "claude", Status: StatusIdle, CreatedAt: time.Now()},
			}
			if err := s2.SaveWithGroups(instances, nil); err != nil {
				errorsMu.Lock()
				errors = append(errors, err)
				errorsMu.Unlock()
			}
		}(i)
	}

	wg.Wait()

	// Check for errors
	if len(errors) > 0 {
		t.Errorf("Got %d errors during concurrent writes: %v", len(errors), errors)
	}

	// Final state should be valid (non-corrupted JSON, valid sessions)
	final, _, err := s1.LoadWithGroups()
	if err != nil {
		t.Fatalf("Failed to load final state (file may be corrupted): %v", err)
	}

	// Should have at least one session from the last write
	if len(final) == 0 {
		t.Error("Final state has no sessions - concurrent writes from different instances corrupted the file")
	}
}

// TestStorage_LockReleaseOnError verifies that locks are released even when save operations fail.
// This prevents deadlocks when errors occur during storage operations.
func TestStorage_LockReleaseOnError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("AGENTDECK_DATA_DIR", tmpDir)

	s, err := NewStorageWithProfile("test-error")
	if err != nil {
		t.Fatalf("NewStorageWithProfile failed: %v", err)
	}

	// Create instances with duplicate IDs (will fail validation)
	instances := []*Instance{
		{ID: "duplicate", Title: "First", Tool: "claude", Status: StatusIdle, CreatedAt: time.Now()},
		{ID: "duplicate", Title: "Second", Tool: "claude", Status: StatusIdle, CreatedAt: time.Now()},
	}

	// Save should fail due to duplicate IDs
	err = s.SaveWithGroups(instances, nil)
	if err == nil {
		t.Fatal("SaveWithGroups should have failed with duplicate IDs")
	}

	// Lock should be released despite the error
	// Try to acquire lock again - should succeed immediately
	handle, err := s.fileLock.Lock()
	if err != nil {
		t.Errorf("Lock should be released after error, but Lock() failed: %v", err)
	}
	defer func() { _ = handle.Unlock() }()

	// If we got here without blocking, lock was properly released
}

// TestStorage_ConcurrentLoadsDuringWrite verifies that loads don't see partial writes.
// Loads should either see the old state or the new state, never corrupted data.
func TestStorage_ConcurrentLoadsDuringWrite(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("AGENTDECK_DATA_DIR", tmpDir)

	s, err := NewStorageWithProfile("test-concurrent-load")
	if err != nil {
		t.Fatalf("NewStorageWithProfile failed: %v", err)
	}

	// Save initial state
	initial := []*Instance{
		{ID: "initial", Title: "Initial", Tool: "claude", Status: StatusIdle, CreatedAt: time.Now()},
	}
	if err := s.SaveWithGroups(initial, nil); err != nil {
		t.Fatalf("Initial save failed: %v", err)
	}

	var wg sync.WaitGroup
	errors := make(chan error, 100)

	// Writer: continuously update storage
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			instances := []*Instance{
				{ID: "writer", Title: "Writer", Tool: "claude", Status: StatusRunning, CreatedAt: time.Now()},
			}
			if err := s.SaveWithGroups(instances, nil); err != nil {
				errors <- err
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()

	// Readers: continuously load storage and validate data integrity
	for r := 0; r < 3; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 20; i++ {
				loaded, _, err := s.LoadWithGroups()
				if err != nil {
					errors <- err
					return
				}

				// Verify data integrity: loaded state must be either valid "initial" or valid "writer"
				if len(loaded) != 1 {
					errors <- err
					return
				}

				// Check that the instance has valid structure
				inst := loaded[0]
				if inst.ID == "" {
					errors <- err
					return
				}
				if inst.Title == "" {
					errors <- err
					return
				}
				if inst.Tool == "" {
					errors <- err
					return
				}

				// Must be exactly one of the two valid states
				isInitialState := inst.ID == "initial" && inst.Title == "Initial" && inst.Status == StatusIdle
				isWriterState := inst.ID == "writer" && inst.Title == "Writer" && inst.Status == StatusRunning

				if !isInitialState && !isWriterState {
					errors <- err
					return
				}

				time.Sleep(2 * time.Millisecond)
			}
		}()
	}

	wg.Wait()
	close(errors)

	// Check for any errors
	var errorList []error
	for err := range errors {
		errorList = append(errorList, err)
	}

	if len(errorList) > 0 {
		t.Errorf("Got %d errors during concurrent read/write: %v", len(errorList), errorList)
	}
}
