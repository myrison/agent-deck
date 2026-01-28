package session

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// setupTestAdapter creates a StorageAdapter with a temporary storage directory.
// Returns the adapter and a cleanup function.
func setupTestAdapter(t *testing.T, debounce time.Duration) (*StorageAdapter, func()) {
	t.Helper()

	tmpDir := t.TempDir()
	profileDir := filepath.Join(tmpDir, "profiles", "default")
	if err := os.MkdirAll(profileDir, 0700); err != nil {
		t.Fatalf("failed to create profile dir: %v", err)
	}

	storage := &Storage{
		path:    filepath.Join(profileDir, "sessions.json"),
		profile: "default",
	}

	adapter := NewStorageAdapter(storage, debounce)
	return adapter, func() {
		// Cleanup handled by t.TempDir()
	}
}

func TestStorageAdapterLoadSave(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 100*time.Millisecond)
	defer cleanup()

	// Initially empty
	data, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if len(data.Instances) != 0 {
		t.Errorf("expected 0 instances, got %d", len(data.Instances))
	}

	// Save some data
	data.Instances = []*InstanceData{
		{
			ID:          "test-1",
			Title:       "Test Session",
			ProjectPath: "/test/path",
			GroupPath:   "test-group",
			Tool:        "claude",
			Status:      StatusWaiting,
		},
	}
	data.Groups = []*GroupData{
		{
			Name:     "Test Group",
			Path:     "test-group",
			Expanded: true,
		},
	}

	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Load it back
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if len(loaded.Instances) != 1 {
		t.Errorf("expected 1 instance, got %d", len(loaded.Instances))
	}
	if loaded.Instances[0].ID != "test-1" {
		t.Errorf("expected ID 'test-1', got %q", loaded.Instances[0].ID)
	}
	if len(loaded.Groups) != 1 {
		t.Errorf("expected 1 group, got %d", len(loaded.Groups))
	}
}

func TestStorageAdapterDebouncedUpdates(t *testing.T) {
	debounce := 50 * time.Millisecond
	adapter, cleanup := setupTestAdapter(t, debounce)
	defer cleanup()

	// Create initial data
	data := &StorageData{
		Instances: []*InstanceData{
			{
				ID:          "session-1",
				Title:       "Session 1",
				ProjectPath: "/test/path",
				GroupPath:   "test",
				Tool:        "claude",
				Status:      StatusIdle,
			},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Schedule multiple rapid updates
	status1 := "running"
	adapter.ScheduleUpdate("session-1", FieldUpdate{Status: &status1})

	status2 := "waiting"
	adapter.ScheduleUpdate("session-1", FieldUpdate{Status: &status2})

	// Should have pending updates
	if !adapter.HasPendingUpdates() {
		t.Error("expected pending updates")
	}

	// Wait for debounce to flush
	time.Sleep(debounce + 20*time.Millisecond)

	// Should have no pending updates now
	if adapter.HasPendingUpdates() {
		t.Error("expected no pending updates after debounce")
	}

	// Verify final status is "waiting" (the last update)
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if loaded.Instances[0].Status != StatusWaiting {
		t.Errorf("expected status 'waiting', got %q", loaded.Instances[0].Status)
	}
}

func TestStorageAdapterMergeFieldUpdates(t *testing.T) {
	debounce := 100 * time.Millisecond
	adapter, cleanup := setupTestAdapter(t, debounce)
	defer cleanup()

	// Create initial data
	data := &StorageData{
		Instances: []*InstanceData{
			{
				ID:          "session-1",
				Title:       "Session 1",
				ProjectPath: "/test/path",
				GroupPath:   "test",
				Tool:        "claude",
				Status:      StatusIdle,
			},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Schedule updates to different fields
	status := "waiting"
	now := time.Now()
	label := "My Label"

	adapter.ScheduleUpdate("session-1", FieldUpdate{Status: &status})
	adapter.ScheduleUpdate("session-1", FieldUpdate{WaitingSince: &now})
	adapter.ScheduleUpdate("session-1", FieldUpdate{CustomLabel: &label})

	// Should have 1 pending update (merged)
	if adapter.PendingUpdateCount() != 1 {
		t.Errorf("expected 1 pending update (merged), got %d", adapter.PendingUpdateCount())
	}

	// Flush immediately
	adapter.FlushPendingUpdates()

	// Verify all fields were updated
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	inst := loaded.Instances[0]
	if inst.Status != StatusWaiting {
		t.Errorf("expected status 'waiting', got %q", inst.Status)
	}
	if inst.WaitingSince.IsZero() {
		t.Error("expected WaitingSince to be set")
	}
	if inst.CustomLabel != "My Label" {
		t.Errorf("expected CustomLabel 'My Label', got %q", inst.CustomLabel)
	}
}

func TestStorageAdapterClearWaitingSince(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 50*time.Millisecond)
	defer cleanup()

	// Create initial data with WaitingSince set
	now := time.Now()
	data := &StorageData{
		Instances: []*InstanceData{
			{
				ID:           "session-1",
				Title:        "Session 1",
				ProjectPath:  "/test/path",
				GroupPath:    "test",
				Tool:         "claude",
				Status:       StatusWaiting,
				WaitingSince: now,
			},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Schedule clear
	adapter.ScheduleUpdate("session-1", FieldUpdate{ClearWaitingSince: true})
	adapter.FlushPendingUpdates()

	// Verify WaitingSince is cleared
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if !loaded.Instances[0].WaitingSince.IsZero() {
		t.Error("expected WaitingSince to be cleared")
	}
}

func TestStorageAdapterConcurrentAccess(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 50*time.Millisecond)
	defer cleanup()

	// Create initial data with multiple sessions
	data := &StorageData{
		Instances: []*InstanceData{
			{ID: "session-1", Title: "S1", ProjectPath: "/p1", GroupPath: "g1", Tool: "claude", Status: StatusIdle},
			{ID: "session-2", Title: "S2", ProjectPath: "/p2", GroupPath: "g2", Tool: "claude", Status: StatusIdle},
			{ID: "session-3", Title: "S3", ProjectPath: "/p3", GroupPath: "g3", Tool: "claude", Status: StatusIdle},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Concurrent updates to different sessions
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			sessionID := "session-1"
			if n%3 == 1 {
				sessionID = "session-2"
			} else if n%3 == 2 {
				sessionID = "session-3"
			}
			status := "running"
			if n%2 == 0 {
				status = "waiting"
			}
			adapter.ScheduleUpdate(sessionID, FieldUpdate{Status: &status})
		}(i)
	}
	wg.Wait()

	// Flush and verify no panics or data corruption
	adapter.FlushPendingUpdates()

	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if len(loaded.Instances) != 3 {
		t.Errorf("expected 3 instances, got %d", len(loaded.Instances))
	}
}

func TestStorageAdapterFlushBeforeDebounce(t *testing.T) {
	// Long debounce that we'll flush early
	adapter, cleanup := setupTestAdapter(t, 10*time.Second)
	defer cleanup()

	data := &StorageData{
		Instances: []*InstanceData{
			{ID: "session-1", Title: "S1", ProjectPath: "/p1", GroupPath: "g1", Tool: "claude", Status: StatusIdle},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Schedule update
	status := "running"
	adapter.ScheduleUpdate("session-1", FieldUpdate{Status: &status})

	// Flush immediately (before the 10s debounce)
	adapter.FlushPendingUpdates()

	// Verify update was applied
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if loaded.Instances[0].Status != StatusRunning {
		t.Errorf("expected status 'running', got %q", loaded.Instances[0].Status)
	}
}

// TestStorageAdapterUpdateNonexistentSession verifies that scheduling an update
// for a session ID that doesn't exist is handled gracefully (no crash, no error).
// The update is simply ignored during flush since there's no instance to update.
func TestStorageAdapterUpdateNonexistentSession(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 50*time.Millisecond)
	defer cleanup()

	// Create storage with one session
	data := &StorageData{
		Instances: []*InstanceData{
			{ID: "existing-session", Title: "S1", ProjectPath: "/p1", GroupPath: "g1", Tool: "claude", Status: StatusIdle},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Schedule update for a nonexistent session
	status := "running"
	adapter.ScheduleUpdate("nonexistent-session", FieldUpdate{Status: &status})

	// Flush should not panic or corrupt data
	adapter.FlushPendingUpdates()

	// Verify existing session is unchanged
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if len(loaded.Instances) != 1 {
		t.Errorf("expected 1 instance, got %d", len(loaded.Instances))
	}
	if loaded.Instances[0].Status != StatusIdle {
		t.Errorf("existing session status changed unexpectedly: got %q", loaded.Instances[0].Status)
	}
}

// TestStorageAdapterFlushEmptyPendingUpdates verifies that flushing when there
// are no pending updates is handled gracefully without errors or panics.
func TestStorageAdapterFlushEmptyPendingUpdates(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 50*time.Millisecond)
	defer cleanup()

	// Create initial data
	data := &StorageData{
		Instances: []*InstanceData{
			{ID: "session-1", Title: "S1", ProjectPath: "/p1", GroupPath: "g1", Tool: "claude", Status: StatusIdle},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Verify no pending updates before flush
	if adapter.HasPendingUpdates() {
		t.Fatal("Expected no pending updates before flush")
	}

	// Flush with no pending updates - should not panic or error
	adapter.FlushPendingUpdates()

	// Verify still no pending updates and data intact
	if adapter.HasPendingUpdates() {
		t.Error("Expected no pending updates after flush")
	}
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if len(loaded.Instances) != 1 {
		t.Errorf("expected 1 instance, got %d", len(loaded.Instances))
	}
}

// TestStorageAdapterLastAccessedAtUpdate verifies that the LastAccessedAt field
// can be updated through the debounced update mechanism.
func TestStorageAdapterLastAccessedAtUpdate(t *testing.T) {
	adapter, cleanup := setupTestAdapter(t, 50*time.Millisecond)
	defer cleanup()

	// Create initial data
	data := &StorageData{
		Instances: []*InstanceData{
			{ID: "session-1", Title: "S1", ProjectPath: "/p1", GroupPath: "g1", Tool: "claude", Status: StatusIdle},
		},
	}
	if err := adapter.SaveStorageData(data); err != nil {
		t.Fatalf("SaveStorageData failed: %v", err)
	}

	// Update LastAccessedAt
	accessTime := time.Now()
	adapter.ScheduleUpdate("session-1", FieldUpdate{LastAccessedAt: &accessTime})
	adapter.FlushPendingUpdates()

	// Verify LastAccessedAt was set
	loaded, err := adapter.LoadStorageData()
	if err != nil {
		t.Fatalf("LoadStorageData failed: %v", err)
	}
	if loaded.Instances[0].LastAccessedAt.IsZero() {
		t.Error("expected LastAccessedAt to be set")
	}
	// Allow small time drift
	if loaded.Instances[0].LastAccessedAt.Sub(accessTime) > time.Second {
		t.Errorf("LastAccessedAt differs too much: got %v, want ~%v",
			loaded.Instances[0].LastAccessedAt, accessTime)
	}
}

