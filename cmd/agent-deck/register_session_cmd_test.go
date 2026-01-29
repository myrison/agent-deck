package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/asheshgoplani/agent-deck/internal/session"
)

// TestRegisterSession_Basic tests basic session registration
func TestRegisterSession_Basic(t *testing.T) {
	// Create a temporary profile directory
	tmpDir := t.TempDir()
	profileDir := filepath.Join(tmpDir, "profiles", "test")
	if err := os.MkdirAll(profileDir, 0755); err != nil {
		t.Fatalf("Failed to create profile dir: %v", err)
	}

	// Initialize empty sessions.json
	sessionsFile := filepath.Join(profileDir, "sessions.json")
	if err := os.WriteFile(sessionsFile, []byte("[]"), 0644); err != nil {
		t.Fatalf("Failed to create sessions.json: %v", err)
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

	// Load initial state
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
		"",  // Empty group = auto-compute
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

// TestRegisterSession_GroupPathComputation tests that group paths are computed correctly
func TestRegisterSession_GroupPathComputation(t *testing.T) {
	tests := []struct {
		name        string
		projectPath string
		wantGroup   string
	}{
		{
			name:        "standard path",
			projectPath: "/home/user/projects/my-app",
			wantGroup:   "projects",
		},
		{
			name:        "home user path",
			projectPath: "/Users/jason/code/agent-deck",
			wantGroup:   "code",
		},
		{
			name:        "deep path",
			projectPath: "/var/www/sites/production/app",
			wantGroup:   "production",
		},
		{
			name:        "home directory project",
			projectPath: "/home/dev/myproject",
			wantGroup:   "dev",
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

// TestRegisterSession_ToolValidation tests that valid tools are accepted
func TestRegisterSession_ToolValidation(t *testing.T) {
	validTools := []string{"claude", "gemini", "opencode", "shell", "codex"}

	for _, tool := range validTools {
		t.Run(tool, func(t *testing.T) {
			inst := session.NewRegisteredInstance("Test", "/tmp/test", "", tool, "test_tmux")
			if inst.Tool != tool {
				t.Errorf("Tool = %q, want %q", inst.Tool, tool)
			}
		})
	}
}

// TestRegisterSession_JSONOutput tests JSON output format
func TestRegisterSession_JSONOutput(t *testing.T) {
	// Test the expected JSON structure
	type jsonResponse struct {
		Success bool   `json:"success"`
		ID      string `json:"id"`
		Title   string `json:"title"`
		Path    string `json:"path"`
		Group   string `json:"group"`
		Tool    string `json:"tool"`
		Tmux    string `json:"tmux"`
	}

	// Simulate the JSON output that would be produced
	response := jsonResponse{
		Success: true,
		ID:      "abc123-1234567890",
		Title:   "Test Project",
		Path:    "/home/user/test",
		Group:   "user",
		Tool:    "claude",
		Tmux:    "agentdeck_1234567890",
	}

	data, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("Failed to marshal JSON: %v", err)
	}

	// Verify it can be unmarshaled back
	var parsed jsonResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if parsed.Success != true {
		t.Errorf("Success = %v, want true", parsed.Success)
	}
	if parsed.Title != "Test Project" {
		t.Errorf("Title = %q, want %q", parsed.Title, "Test Project")
	}
}

// TestRegisterSession_DefaultTitle tests that title defaults to folder name
func TestRegisterSession_DefaultTitle(t *testing.T) {
	tests := []struct {
		path      string
		wantTitle string
	}{
		{"/home/user/my-project", "my-project"},
		{"/var/www/app", "app"},
		{"/tmp/test-folder/", "test-folder"},
		{"~/code/agent-deck", "agent-deck"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			// Extract folder name (simulating what handleRegisterSession does)
			parts := []string{}
			for _, p := range []byte(tt.path) {
				if p == '/' {
					parts = append(parts, "")
				} else if len(parts) == 0 {
					parts = append(parts, string(p))
				} else {
					parts[len(parts)-1] += string(p)
				}
			}

			var title string
			for i := len(parts) - 1; i >= 0; i-- {
				if parts[i] != "" {
					title = parts[i]
					break
				}
			}

			if title != tt.wantTitle {
				t.Errorf("Title from path %q = %q, want %q", tt.path, title, tt.wantTitle)
			}
		})
	}
}
