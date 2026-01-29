package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/asheshgoplani/agent-deck/internal/session"
)

// TestRegisterSession_Basic tests basic session registration round-trip:
// create instance → save to storage → reload → verify all fields persisted
func TestRegisterSession_Basic(t *testing.T) {
	// Create a temporary profile directory
	tmpDir := t.TempDir()
	profileDir := filepath.Join(tmpDir, ".agent-deck", "profiles", "test")
	if err := os.MkdirAll(profileDir, 0755); err != nil {
		t.Fatalf("Failed to create profile dir: %v", err)
	}

	// Set up environment for storage
	oldHome := os.Getenv("HOME")
	if err := os.Setenv("HOME", tmpDir); err != nil {
		t.Fatalf("Failed to set HOME: %v", err)
	}
	defer func() { _ = os.Setenv("HOME", oldHome) }()

	// Create storage for the test profile
	storage, err := session.NewStorageWithProfile("test")
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	// Load initial state (should be empty)
	instances, groups, err := storage.LoadWithGroups()
	if err != nil {
		t.Fatalf("Failed to load sessions: %v", err)
	}

	if len(instances) != 0 {
		t.Fatalf("Expected 0 initial sessions, got %d", len(instances))
	}

	// Create a new registered instance
	newInstance := session.NewRegisteredInstance(
		"Test Project",
		"/home/user/test-project",
		"", // Empty group = auto-compute
		"claude",
		"agentdeck_1234567890",
	)

	// Add to instances
	instances = append(instances, newInstance)

	// Save
	groupTree := session.NewGroupTreeWithGroups(instances, groups)
	if newInstance.GroupPath != "" {
		groupTree.CreateGroup(newInstance.GroupPath)
	}

	if err := storage.SaveWithGroups(instances, groupTree); err != nil {
		t.Fatalf("Failed to save: %v", err)
	}

	// Reload and verify
	instances2, _, err := storage.LoadWithGroups()
	if err != nil {
		t.Fatalf("Failed to reload: %v", err)
	}

	if len(instances2) != 1 {
		t.Fatalf("Expected 1 session after save, got %d", len(instances2))
	}

	saved := instances2[0]
	if saved.Title != "Test Project" {
		t.Errorf("Title mismatch: got %q, want %q", saved.Title, "Test Project")
	}
	if saved.ProjectPath != "/home/user/test-project" {
		t.Errorf("ProjectPath mismatch: got %q, want %q", saved.ProjectPath, "/home/user/test-project")
	}
	if saved.Tool != "claude" {
		t.Errorf("Tool mismatch: got %q, want %q", saved.Tool, "claude")
	}
	// Group should be auto-computed from path
	if saved.GroupPath == "" {
		t.Errorf("GroupPath should not be empty, should be auto-computed")
	}
}

// TestRegisterSession_GroupPathComputation tests that ExtractGroupPath computes
// sensible group paths from project directory paths. The function:
// - Skips "Users", "home", and hidden directories
// - Returns the parent of the project folder (not the folder itself)
// - Edge case: trailing slash changes behavior (returns the leaf folder)
func TestRegisterSession_GroupPathComputation(t *testing.T) {
	tests := []struct {
		name        string
		projectPath string
		wantGroup   string
	}{
		{
			name:        "standard path returns parent",
			projectPath: "/home/user/projects/my-app",
			wantGroup:   "projects", // parent of "my-app"
		},
		{
			name:        "macOS user path skips Users",
			projectPath: "/Users/jason/code/agent-deck",
			wantGroup:   "code", // parent of "agent-deck", skipped "Users"
		},
		{
			name:        "deep path returns immediate parent",
			projectPath: "/var/www/sites/production/app",
			wantGroup:   "production", // parent of "app"
		},
		{
			name:        "home dir project returns parent",
			projectPath: "/home/dev/myproject",
			wantGroup:   "dev", // parent of "myproject", skipped "home"
		},
		{
			// EDGE CASE: Trailing slash causes ExtractGroupPath to see an empty
			// final element, so the "last meaningful part" check doesn't trigger
			// the "return parent" logic. This is documented behavior, not a bug.
			name:        "trailing slash returns leaf (edge case)",
			projectPath: "/home/user/projects/app/",
			wantGroup:   "app", // NOT "projects" - trailing slash changes behavior
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := session.ExtractGroupPath(tt.projectPath)
			if got != tt.wantGroup {
				t.Errorf("ExtractGroupPath(%q) = %q, want %q", tt.projectPath, got, tt.wantGroup)
			}
		})
	}
}

// TestRegisterSession_ExplicitGroup tests that explicit group paths override auto-computation
func TestRegisterSession_ExplicitGroup(t *testing.T) {
	inst := session.NewRegisteredInstance(
		"Test",
		"/home/user/projects/app",
		"custom-group", // Explicit group
		"shell",
		"agentdeck_test",
	)

	if inst.GroupPath != "custom-group" {
		t.Errorf("GroupPath = %q, want %q", inst.GroupPath, "custom-group")
	}
}

// TestRegisterSession_TmuxSessionReference tests that NewRegisteredInstance
// creates a tmux session reference with the correct name so that the session
// can be found later by tmux name (needed for duplicate detection)
func TestRegisterSession_TmuxSessionReference(t *testing.T) {
	tmuxName := "agentdeck_1234567890"
	inst := session.NewRegisteredInstance(
		"Test Project",
		"/home/user/project",
		"",
		"claude",
		tmuxName,
	)

	// The tmux session must be retrievable with the correct name
	// This is critical for duplicate detection in handleRegisterSession
	tmuxSession := inst.GetTmuxSession()
	if tmuxSession == nil {
		t.Fatal("GetTmuxSession() returned nil - duplicate detection would fail")
	}

	if tmuxSession.Name != tmuxName {
		t.Errorf("TmuxSession.Name = %q, want %q - duplicate detection would fail", tmuxSession.Name, tmuxName)
	}
}

// TestRegisterSession_DuplicateDetection tests that duplicate sessions are detected
// by matching tmux session names across multiple saved instances. This is the core
// behavior that prevents registering the same tmux session twice.
func TestRegisterSession_DuplicateDetection(t *testing.T) {
	tmpDir := t.TempDir()
	profileDir := filepath.Join(tmpDir, ".agent-deck", "profiles", "test")
	if err := os.MkdirAll(profileDir, 0755); err != nil {
		t.Fatalf("Failed to create profile dir: %v", err)
	}

	oldHome := os.Getenv("HOME")
	if err := os.Setenv("HOME", tmpDir); err != nil {
		t.Fatalf("Failed to set HOME: %v", err)
	}
	defer func() { _ = os.Setenv("HOME", oldHome) }()

	storage, err := session.NewStorageWithProfile("test")
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}

	// Create and save first session
	tmuxName := "agentdeck_duplicate_test"
	first := session.NewRegisteredInstance("First", "/tmp/first", "", "claude", tmuxName)

	instances := []*session.Instance{first}
	groupTree := session.NewGroupTreeWithGroups(instances, nil)
	if err := storage.SaveWithGroups(instances, groupTree); err != nil {
		t.Fatalf("Failed to save first session: %v", err)
	}

	// Reload and check for duplicate (simulating what handleRegisterSession does)
	loaded, _, err := storage.LoadWithGroups()
	if err != nil {
		t.Fatalf("Failed to load sessions: %v", err)
	}

	// Try to find existing session with same tmux name
	// This mirrors lines 160-182 in register_session_cmd.go
	var foundDuplicate *session.Instance
	for _, inst := range loaded {
		tmuxSess := inst.GetTmuxSession()
		if tmuxSess != nil && tmuxSess.Name == tmuxName {
			foundDuplicate = inst
			break
		}
	}

	if foundDuplicate == nil {
		t.Fatal("Should have found existing session with matching tmux name")
	}
	if foundDuplicate.Title != "First" {
		t.Errorf("Found duplicate has wrong title: got %q, want %q", foundDuplicate.Title, "First")
	}
}

// TestRegisterSession_InstanceIDUniqueness tests that each registered instance
// gets a unique ID, preventing storage corruption from ID collisions
func TestRegisterSession_InstanceIDUniqueness(t *testing.T) {
	ids := make(map[string]bool)

	for i := 0; i < 100; i++ {
		inst := session.NewRegisteredInstance(
			"Test",
			"/tmp/test",
			"",
			"shell",
			"agentdeck_test",
		)
		if ids[inst.ID] {
			t.Errorf("Duplicate ID generated: %s", inst.ID)
		}
		ids[inst.ID] = true
	}
}
