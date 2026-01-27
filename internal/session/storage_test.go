package session

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestStorageUpdatedAtTimestamp verifies that SaveWithGroups sets the UpdatedAt timestamp
// and GetUpdatedAt() returns it correctly.
func TestStorageUpdatedAtTimestamp(t *testing.T) {
	// Create temporary directory for test
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "sessions.json")

	// Create storage instance
	s := &Storage{
		path:    storagePath,
		profile: "_test",
	}

	// Create test data
	instances := []*Instance{
		{
			ID:          "test-1",
			Title:       "Test Session",
			ProjectPath: "/tmp/test",
			GroupPath:   "test-group",
			Command:     "claude",
			Tool:        "claude",
			Status:      StatusIdle,
			CreatedAt:   time.Now(),
		},
	}

	// Save data
	beforeSave := time.Now()
	time.Sleep(10 * time.Millisecond) // Small delay to ensure timestamp differs

	err := s.SaveWithGroups(instances, nil)
	if err != nil {
		t.Fatalf("SaveWithGroups failed: %v", err)
	}

	time.Sleep(10 * time.Millisecond) // Small delay to ensure timestamp differs
	afterSave := time.Now()

	// Get the updated timestamp
	updatedAt, err := s.GetUpdatedAt()
	if err != nil {
		t.Fatalf("GetUpdatedAt failed: %v", err)
	}

	// Verify timestamp is within expected range
	if updatedAt.Before(beforeSave) {
		t.Errorf("UpdatedAt %v is before save started %v", updatedAt, beforeSave)
	}
	if updatedAt.After(afterSave) {
		t.Errorf("UpdatedAt %v is after save completed %v", updatedAt, afterSave)
	}

	// Verify timestamp is not zero
	if updatedAt.IsZero() {
		t.Error("UpdatedAt is zero, expected a valid timestamp")
	}

	// Save again and verify timestamp updates
	time.Sleep(50 * time.Millisecond)
	firstUpdatedAt := updatedAt

	err = s.SaveWithGroups(instances, nil)
	if err != nil {
		t.Fatalf("Second SaveWithGroups failed: %v", err)
	}

	secondUpdatedAt, err := s.GetUpdatedAt()
	if err != nil {
		t.Fatalf("Second GetUpdatedAt failed: %v", err)
	}

	// Verify second timestamp is after first
	if !secondUpdatedAt.After(firstUpdatedAt) {
		t.Errorf("Second UpdatedAt %v should be after first %v", secondUpdatedAt, firstUpdatedAt)
	}
}

// TestGetUpdatedAtNoFile verifies behavior when storage file doesn't exist
func TestGetUpdatedAtNoFile(t *testing.T) {
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "nonexistent.json")

	s := &Storage{
		path:    storagePath,
		profile: "_test",
	}

	_, err := s.GetUpdatedAt()
	if err == nil {
		t.Error("Expected error when file doesn't exist, got nil")
	}
	if !os.IsNotExist(err) {
		t.Errorf("Expected IsNotExist error, got: %v", err)
	}
}

// TestStorageSessionLabelPersistence verifies that SessionLabel field survives save/load cycles.
// This tests the behavioral contract: a session's label, once set, should be retrievable after restart.
func TestStorageSessionLabelPersistence(t *testing.T) {
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "sessions.json")

	s := &Storage{
		path:    storagePath,
		profile: "_test",
	}

	// SETUP: Create instance with a session label (simulates what UpdateClaudeSession does)
	original := &Instance{
		ID:           "test-claude-session",
		Title:        "Agent Deck",
		ProjectPath:  "/tmp/agent-deck",
		GroupPath:    "hc-repo",
		Command:      "claude",
		Tool:         "claude",
		Status:       StatusIdle,
		CreatedAt:    time.Now(),
		SessionLabel: "Implementing session label display feature", // The label we want to persist
		LatestPrompt: "Add tests for the new feature",
	}

	// EXECUTE: Save, then load back
	if err := s.SaveWithGroups([]*Instance{original}, nil); err != nil {
		t.Fatalf("SaveWithGroups failed: %v", err)
	}

	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	// VERIFY: The session label survives the round trip
	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	if loaded[0].SessionLabel != original.SessionLabel {
		t.Errorf("SessionLabel not persisted: got %q, want %q", loaded[0].SessionLabel, original.SessionLabel)
	}

	// Also verify LatestPrompt (sibling field) still works
	if loaded[0].LatestPrompt != original.LatestPrompt {
		t.Errorf("LatestPrompt not persisted: got %q, want %q", loaded[0].LatestPrompt, original.LatestPrompt)
	}
}

// TestStorageSessionLabelEmptyDoesNotCorrupt verifies that empty labels don't cause issues.
// Sessions created before the label feature should load without errors.
func TestStorageSessionLabelEmptyDoesNotCorrupt(t *testing.T) {
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "sessions.json")

	s := &Storage{
		path:    storagePath,
		profile: "_test",
	}

	// SETUP: Session without label (like pre-existing sessions)
	noLabel := &Instance{
		ID:          "legacy-session",
		Title:       "Old Session",
		ProjectPath: "/tmp/project",
		GroupPath:   "default",
		Tool:        "claude",
		Status:      StatusIdle,
		CreatedAt:   time.Now(),
		// SessionLabel intentionally omitted
	}

	// EXECUTE
	if err := s.SaveWithGroups([]*Instance{noLabel}, nil); err != nil {
		t.Fatalf("SaveWithGroups failed: %v", err)
	}

	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	// VERIFY: No corruption, empty label stays empty
	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	if loaded[0].SessionLabel != "" {
		t.Errorf("Expected empty SessionLabel, got %q", loaded[0].SessionLabel)
	}
}
