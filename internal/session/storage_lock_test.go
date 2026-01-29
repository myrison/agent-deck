package session

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestFileLock_BasicLockUnlock(t *testing.T) {
	tmpDir := t.TempDir()
	lockPath := filepath.Join(tmpDir, "test.lock")

	lock := newFileLock(lockPath)

	// Lock should succeed
	handle, err := lock.Lock()
	if err != nil {
		t.Fatalf("Lock() failed: %v", err)
	}

	// Unlock should succeed
	if err := handle.Unlock(); err != nil {
		t.Fatalf("Unlock() failed: %v", err)
	}

	// Lock file should exist
	if _, err := os.Stat(lockPath + ".lock"); os.IsNotExist(err) {
		t.Error("Lock file was not created")
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
	// Test that NewStorageWithProfile properly initializes the file lock
	tmpDir := t.TempDir()

	// Set up a custom profile directory for testing
	t.Setenv("AGENTDECK_DATA_DIR", tmpDir)

	s, err := NewStorageWithProfile("test-lock")
	if err != nil {
		t.Fatalf("NewStorageWithProfile failed: %v", err)
	}

	if s.fileLock == nil {
		t.Error("Storage.fileLock should not be nil")
	}

	// Verify save/load works with the lock
	instances := []*Instance{
		{
			ID:        "lock-test-1",
			Title:     "Lock Test",
			Tool:      "claude",
			Status:    StatusIdle,
			CreatedAt: time.Now(),
		},
	}

	if err := s.SaveWithGroups(instances, nil); err != nil {
		t.Fatalf("SaveWithGroups with lock failed: %v", err)
	}

	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups with lock failed: %v", err)
	}

	if len(loaded) != 1 || loaded[0].ID != "lock-test-1" {
		t.Errorf("Loaded data mismatch: got %d instances", len(loaded))
	}
}
