package session

import (
	"encoding/json"
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

// TestStorageRemoteGroupPathMigration verifies that loading a remote session
// with a flat "remote" GroupPath (from desktop commit 911bdce) gets migrated to
// the hierarchical "remote/<hostname>" format during convertToInstances.
// This is the core migration behavior introduced in PR #69.
func TestStorageRemoteGroupPathMigration(t *testing.T) {
	// SETUP: redirect HOME so LoadUserConfig reads our test config
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	// Write a config.toml with an SSH host that has a group_name
	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configTOML := `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
auto_discover = true
`
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}

	// Force config reload so the test picks up our SSH host definition
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig() // Reset cache after test

	// Write sessions.json with a remote session that has the flat "remote" GroupPath
	// (the pre-fix state from desktop commit 911bdce)
	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-abc123",
				Title:          "Agent Deck",
				ProjectPath:    "/home/jason/agent-deck",
				GroupPath:      "remote", // Flat path — should be migrated
				Tool:           "claude",
				Status:         StatusIdle,
				CreatedAt:      time.Now(),
				RemoteHost:     "jeeves",         // Matches SSH host config
				RemoteTmuxName: "agentdeck_test1",
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}

	// EXECUTE: Load sessions — migration should happen during convertToInstances
	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	// VERIFY: The flat "remote" path should now be "remote/Jeeves"
	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	if loaded[0].GroupPath != "remote/Jeeves" {
		t.Errorf("GroupPath migration failed: got %q, want %q", loaded[0].GroupPath, "remote/Jeeves")
	}
}

// TestStorageRemoteGroupPathNoMigrationWhenCorrect verifies that a remote session
// with an already-correct hierarchical GroupPath (e.g., "remote/Jeeves") is NOT
// modified during loading — only flat paths matching exactly the prefix get migrated.
func TestStorageRemoteGroupPathNoMigrationWhenCorrect(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configTOML := `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
auto_discover = true
`
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-def456",
				Title:          "Another Session",
				ProjectPath:    "/home/jason/project",
				GroupPath:      "remote/Jeeves", // Already correct — should NOT change
				Tool:           "claude",
				Status:         StatusIdle,
				CreatedAt:      time.Now(),
				RemoteHost:     "jeeves",
				RemoteTmuxName: "agentdeck_test2",
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}

	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	// Already-correct path should be preserved
	if loaded[0].GroupPath != "remote/Jeeves" {
		t.Errorf("GroupPath incorrectly modified: got %q, want %q", loaded[0].GroupPath, "remote/Jeeves")
	}
}

// TestStorageRemoteGroupPathMigrationFallbackToHostID verifies that when no SSH
// host config exists (no group_name defined), the migration falls back to using
// the raw hostID as the group name (e.g., "remote/my-server" instead of "remote/Jeeves").
func TestStorageRemoteGroupPathMigrationFallbackToHostID(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	// Write config without any SSH host definitions
	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configTOML := `# empty config — no SSH hosts defined
`
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-ghi789",
				Title:          "Unknown Host Session",
				ProjectPath:    "/home/user/project",
				GroupPath:      "remote", // Flat — should migrate using raw hostID
				Tool:           "claude",
				Status:         StatusIdle,
				CreatedAt:      time.Now(),
				RemoteHost:     "my-server",
				RemoteTmuxName: "agentdeck_test3",
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}

	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	// Without SSH host config, should fall back to raw hostID
	if loaded[0].GroupPath != "remote/my-server" {
		t.Errorf("GroupPath migration with no config: got %q, want %q", loaded[0].GroupPath, "remote/my-server")
	}
}

// TestStorageRemoteTmuxNameBackfill verifies that loading a remote session with
// empty RemoteTmuxName but non-empty TmuxSession backfills RemoteTmuxName.
// This prevents sessions from being unrecognizable on subsequent discovery cycles.
func TestStorageRemoteTmuxNameBackfill(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte("# empty\n"), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-backfill1",
				Title:          "Sebastian",
				ProjectPath:    "/home/jason/workers/sebastian",
				GroupPath:      "remote/Docker",
				Tool:           "claude",
				Status:         StatusWaiting,
				CreatedAt:      time.Now(),
				TmuxSession:    "agentdeck_sebastian_c8e76716", // Has tmux name
				RemoteHost:     "host197",
				RemoteTmuxName: "", // Empty — should be backfilled
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}
	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	if loaded[0].RemoteTmuxName != "agentdeck_sebastian_c8e76716" {
		t.Errorf("RemoteTmuxName backfill failed: got %q, want %q",
			loaded[0].RemoteTmuxName, "agentdeck_sebastian_c8e76716")
	}
}

// TestStorageRemoteDefaultGroupPathMigration verifies that remote sessions stuck
// in the default "my-sessions" group get migrated to the host's root group.
func TestStorageRemoteDefaultGroupPathMigration(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configTOML := `
[ssh_hosts.host197]
host = "192.168.1.197"
group_name = "Docker"
auto_discover = true
`
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-defaultgrp",
				Title:          "Heimdall",
				ProjectPath:    "/home/jason/workers/heimdall",
				GroupPath:      "my-sessions", // Stuck in default — should migrate
				Tool:           "claude",
				Status:         StatusWaiting,
				CreatedAt:      time.Now(),
				TmuxSession:    "agentdeck_heimdall_9e2e692c",
				RemoteHost:     "host197",
				RemoteTmuxName: "agentdeck_heimdall_9e2e692c",
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}
	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	// Should migrate from "my-sessions" to "remote/Docker"
	if loaded[0].GroupPath != "remote/Docker" {
		t.Errorf("GroupPath default migration failed: got %q, want %q",
			loaded[0].GroupPath, "remote/Docker")
	}
}

// TestStorageLocalSessionNotMigratedFromDefault verifies that LOCAL sessions
// in the default group are NOT affected by the remote-only migration.
func TestStorageLocalSessionNotMigratedFromDefault(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte("# empty\n"), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:          "local-session-1",
				Title:       "Local Test",
				ProjectPath: "/tmp/project",
				GroupPath:   "my-sessions", // Default group for a local session
				Tool:        "claude",
				Status:      StatusIdle,
				CreatedAt:   time.Now(),
				// RemoteHost is empty — this is a LOCAL session
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}
	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	// Local session should stay in "my-sessions"
	if loaded[0].GroupPath != "my-sessions" {
		t.Errorf("Local session group path incorrectly changed: got %q, want %q",
			loaded[0].GroupPath, "my-sessions")
	}
}

// TestStorageSavePreservesRemoteTmuxNameWhenTmuxSessionNil verifies that saving
// a remote session whose tmuxSession object is nil (e.g., due to SSH failure)
// still persists the tmux session name by falling back to RemoteTmuxName.
// Without this fix, TmuxSession would be written as "" and the session would
// be unrecoverable on reload.
func TestStorageSavePreservesRemoteTmuxNameWhenTmuxSessionNil(t *testing.T) {
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "sessions.json")

	s := &Storage{path: storagePath, profile: "_test"}

	// SETUP: Remote session where tmuxSession is nil (simulates SSH failure)
	inst := &Instance{
		ID:             "remote-save-fix",
		Title:          "Coordinator",
		ProjectPath:    "/home/jason/coordinator",
		GroupPath:      "remote/Docker",
		Tool:           "claude",
		Status:         StatusError,
		CreatedAt:      time.Now(),
		RemoteHost:     "host197",
		RemoteTmuxName: "agentdeck_coordinator_aabb1122",
		// tmuxSession intentionally nil — the bug scenario
	}

	// EXECUTE: Save the session
	if err := s.SaveWithGroups([]*Instance{inst}, nil); err != nil {
		t.Fatalf("SaveWithGroups failed: %v", err)
	}

	// VERIFY: Read the raw JSON and check that tmux_session was preserved
	jsonData, err := os.ReadFile(storagePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var data StorageData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		t.Fatalf("Failed to unmarshal saved data: %v", err)
	}

	if len(data.Instances) != 1 {
		t.Fatalf("Expected 1 instance in saved data, got %d", len(data.Instances))
	}

	if data.Instances[0].TmuxSession != "agentdeck_coordinator_aabb1122" {
		t.Errorf("TmuxSession not preserved: got %q, want %q",
			data.Instances[0].TmuxSession, "agentdeck_coordinator_aabb1122")
	}
}

// TestStorageSaveDoesNotFallbackForLocalSession verifies that a local session
// with nil tmuxSession does NOT get a spurious TmuxSession value from
// RemoteTmuxName. The fallback only applies when RemoteHost is set.
func TestStorageSaveDoesNotFallbackForLocalSession(t *testing.T) {
	tmpDir := t.TempDir()
	storagePath := filepath.Join(tmpDir, "sessions.json")

	s := &Storage{path: storagePath, profile: "_test"}

	// SETUP: Local session with nil tmuxSession (e.g., session not yet started)
	inst := &Instance{
		ID:          "local-no-tmux",
		Title:       "Local Test",
		ProjectPath: "/tmp/project",
		GroupPath:   "default",
		Tool:        "claude",
		Status:      StatusIdle,
		CreatedAt:   time.Now(),
		// RemoteHost is empty — this is LOCAL
		// tmuxSession is nil
	}

	if err := s.SaveWithGroups([]*Instance{inst}, nil); err != nil {
		t.Fatalf("SaveWithGroups failed: %v", err)
	}

	jsonData, err := os.ReadFile(storagePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}

	var data StorageData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		t.Fatalf("Failed to unmarshal saved data: %v", err)
	}

	if data.Instances[0].TmuxSession != "" {
		t.Errorf("Local session with nil tmuxSession should have empty TmuxSession, got %q",
			data.Instances[0].TmuxSession)
	}
}

// TestStorageLoadFallsBackToRemoteTmuxName verifies that loading a remote
// session from JSON where TmuxSession is empty but RemoteTmuxName is set
// still creates a tmux Session object using the RemoteTmuxName value.
// This is the load-side counterpart to the save-side preservation test.
func TestStorageLoadFallsBackToRemoteTmuxName(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte("# empty\n"), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	// SETUP: JSON with empty TmuxSession but valid RemoteTmuxName
	sessionsData := StorageData{
		Instances: []*InstanceData{
			{
				ID:             "remote-load-fix",
				Title:          "Coordinator",
				ProjectPath:    "/home/jason/coordinator",
				GroupPath:      "remote/Docker",
				Tool:           "claude",
				Status:         StatusError,
				CreatedAt:      time.Now(),
				TmuxSession:    "",                                // Lost due to SSH failure at save time
				RemoteHost:     "host197",
				RemoteTmuxName: "agentdeck_coordinator_aabb1122",
			},
		},
		UpdatedAt: time.Now(),
	}

	jsonData, err := json.MarshalIndent(sessionsData, "", "  ")
	if err != nil {
		t.Fatalf("Failed to marshal sessions data: %v", err)
	}
	if err := os.WriteFile(storagePath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	s := &Storage{path: storagePath, profile: "_test"}
	loaded, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("LoadWithGroups failed: %v", err)
	}

	if len(loaded) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(loaded))
	}

	// VERIFY: A tmux session object was created using RemoteTmuxName
	if loaded[0].GetTmuxSession() == nil {
		t.Fatal("Expected tmux session to be created from RemoteTmuxName fallback, got nil")
	}

	if loaded[0].GetTmuxSession().Name != "agentdeck_coordinator_aabb1122" {
		t.Errorf("Tmux session name: got %q, want %q",
			loaded[0].GetTmuxSession().Name, "agentdeck_coordinator_aabb1122")
	}
}

// TestStorageRemoteTmuxRecoveryMultiCycle verifies that a remote session's
// tmux identity is stable across multiple save/load cycles, even when the
// initial save occurred with a nil tmuxSession. This tests a scenario beyond
// what the individual save and load tests cover: the recovered session is
// re-saved and must still preserve its tmux name on the second cycle.
func TestStorageRemoteTmuxRecoveryMultiCycle(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.toml"), []byte("# empty\n"), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}
	if _, err := ReloadUserConfig(); err != nil {
		t.Fatalf("ReloadUserConfig failed: %v", err)
	}
	defer ReloadUserConfig()

	storageDir := filepath.Join(tmpHome, "test-storage")
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		t.Fatalf("Failed to create storage dir: %v", err)
	}
	storagePath := filepath.Join(storageDir, "sessions.json")

	s := &Storage{path: storagePath, profile: "_test"}

	// CYCLE 1: Save remote session with nil tmuxSession (the failure state)
	original := &Instance{
		ID:             "remote-multicycle",
		Title:          "Jeeves Worker",
		ProjectPath:    "/home/jason/workers/jeeves",
		GroupPath:      "remote/Docker",
		Tool:           "claude",
		Status:         StatusError,
		CreatedAt:      time.Now(),
		RemoteHost:     "host197",
		RemoteTmuxName: "agentdeck_jeeves-worker_deadbeef",
		// tmuxSession is nil — the transient failure state
	}

	if err := s.SaveWithGroups([]*Instance{original}, nil); err != nil {
		t.Fatalf("Cycle 1 save failed: %v", err)
	}

	loaded1, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("Cycle 1 load failed: %v", err)
	}
	if len(loaded1) != 1 {
		t.Fatalf("Cycle 1: expected 1 instance, got %d", len(loaded1))
	}

	// CYCLE 2: Re-save the loaded session (now has a tmuxSession object from recovery)
	// then load again — the tmux name must remain stable
	if err := s.SaveWithGroups(loaded1, nil); err != nil {
		t.Fatalf("Cycle 2 save failed: %v", err)
	}

	loaded2, _, err := s.LoadWithGroups()
	if err != nil {
		t.Fatalf("Cycle 2 load failed: %v", err)
	}
	if len(loaded2) != 1 {
		t.Fatalf("Cycle 2: expected 1 instance, got %d", len(loaded2))
	}

	// VERIFY: After two cycles, the tmux session is still intact
	if loaded2[0].GetTmuxSession() == nil {
		t.Fatal("Cycle 2: tmux session is nil after second load")
	}
	if loaded2[0].GetTmuxSession().Name != "agentdeck_jeeves-worker_deadbeef" {
		t.Errorf("Cycle 2: tmux session name: got %q, want %q",
			loaded2[0].GetTmuxSession().Name, "agentdeck_jeeves-worker_deadbeef")
	}
	if loaded2[0].RemoteTmuxName != "agentdeck_jeeves-worker_deadbeef" {
		t.Errorf("Cycle 2: RemoteTmuxName: got %q, want %q",
			loaded2[0].RemoteTmuxName, "agentdeck_jeeves-worker_deadbeef")
	}

	// VERIFY: Check the raw JSON to confirm TmuxSession field is populated
	jsonData, err := os.ReadFile(storagePath)
	if err != nil {
		t.Fatalf("Failed to read saved file: %v", err)
	}
	var data StorageData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		t.Fatalf("Failed to unmarshal saved data: %v", err)
	}
	if data.Instances[0].TmuxSession != "agentdeck_jeeves-worker_deadbeef" {
		t.Errorf("Cycle 2 JSON: TmuxSession = %q, want %q",
			data.Instances[0].TmuxSession, "agentdeck_jeeves-worker_deadbeef")
	}
}
