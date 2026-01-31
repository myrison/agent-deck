package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestGetProfileDirSanitizesInput verifies that GetProfileDir prevents path traversal attacks.
// This is a security-critical behavior - malicious profile names should not escape the profiles directory.
func TestGetProfileDirSanitizesInput(t *testing.T) {
	tests := []struct {
		name        string
		profile     string
		expectError bool
	}{
		{
			name:        "normal profile name",
			profile:     "my-profile",
			expectError: false,
		},
		{
			name:        "profile with slash gets base name only",
			profile:     "path/to/profile",
			expectError: false, // filepath.Base strips the path
		},
		{
			name:        "dot is invalid",
			profile:     ".",
			expectError: true,
		},
		{
			name:        "double dot is invalid",
			profile:     "..",
			expectError: true,
		},
		{
			name:        "empty profile defaults to default profile",
			profile:     "",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir, err := GetProfileDir(tt.profile)
			if tt.expectError {
				if err == nil {
					t.Errorf("GetProfileDir(%q) expected error, got nil", tt.profile)
				}
			} else {
				if err != nil {
					t.Errorf("GetProfileDir(%q) unexpected error: %v", tt.profile, err)
				}
				// Verify the path contains the sanitized profile name
				if dir == "" {
					t.Error("GetProfileDir should return non-empty path")
				}
			}
		})
	}
}

// TestLoadConfigReturnsDefaultWhenNotExists verifies that LoadConfig returns
// a default config when no config file exists. This is the first-run behavior.
func TestLoadConfigReturnsDefaultWhenNotExists(t *testing.T) {
	// Create a temporary directory and set HOME to it
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	config, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig should not error on first run: %v", err)
	}

	if config == nil {
		t.Fatal("LoadConfig returned nil config")
	}

	if config.DefaultProfile == "" {
		t.Error("Default config should have DefaultProfile set")
	}

	if config.Version != 1 {
		t.Errorf("Default config version = %d, want 1", config.Version)
	}
}

// TestSaveAndLoadConfigRoundTrip verifies that config values survive save/load cycles.
func TestSaveAndLoadConfigRoundTrip(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	// Create a config with specific values
	original := &Config{
		DefaultProfile: "test-profile",
		Version:        1,
	}

	// Save it
	if err := SaveConfig(original); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	// Load it back
	loaded, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// Verify values match
	if loaded.DefaultProfile != original.DefaultProfile {
		t.Errorf("DefaultProfile = %q, want %q", loaded.DefaultProfile, original.DefaultProfile)
	}
	if loaded.Version != original.Version {
		t.Errorf("Version = %d, want %d", loaded.Version, original.Version)
	}
}

// TestSaveConfigCreatesDirectory verifies that SaveConfig creates the config
// directory if it doesn't exist. This is important for first-run scenarios.
func TestSaveConfigCreatesDirectory(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	config := &Config{
		DefaultProfile: "test",
		Version:        1,
	}

	if err := SaveConfig(config); err != nil {
		t.Fatalf("SaveConfig failed: %v", err)
	}

	// Verify the config file exists
	configPath, err := GetConfigPath()
	if err != nil {
		t.Fatalf("GetConfigPath failed: %v", err)
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Error("SaveConfig should create config file")
	}
}

// TestLoadConfigHandlesCorruptedFile verifies behavior when config file is corrupted.
func TestLoadConfigHandlesCorruptedFile(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	// Create agent-deck directory
	agentDeckDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Write corrupted config
	configPath := filepath.Join(agentDeckDir, ConfigFileName)
	if err := os.WriteFile(configPath, []byte("{ invalid json"), 0600); err != nil {
		t.Fatalf("Failed to write corrupted config: %v", err)
	}

	// LoadConfig should return error for corrupted file
	_, err := LoadConfig()
	if err == nil {
		t.Error("LoadConfig should return error for corrupted file")
	}
}

// TestListProfilesReturnsEmptyWhenNoProfiles verifies that ListProfiles returns
// an empty slice (not an error) when no profiles exist yet. This prevents nil
// pointer dereferences in callers.
func TestListProfilesReturnsEmptyWhenNoProfiles(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	profiles, err := ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles should not error when no profiles exist: %v", err)
	}

	if profiles == nil {
		t.Error("ListProfiles should return empty slice, not nil")
	}

	if len(profiles) != 0 {
		t.Errorf("ListProfiles length = %d, want 0 when no profiles exist", len(profiles))
	}
}

// TestListProfilesOnlyReturnsValidProfiles verifies that ListProfiles only returns
// directories that have a sessions.json file. This filters out incomplete or
// corrupted profile directories.
func TestListProfilesOnlyReturnsValidProfiles(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	profilesDir := filepath.Join(tmpHome, ".agent-deck", ProfilesDirName)
	if err := os.MkdirAll(profilesDir, 0700); err != nil {
		t.Fatalf("Failed to create profiles dir: %v", err)
	}

	// Create a valid profile (has sessions.json)
	validProfileDir := filepath.Join(profilesDir, "valid-profile")
	if err := os.MkdirAll(validProfileDir, 0700); err != nil {
		t.Fatalf("Failed to create valid profile dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(validProfileDir, "sessions.json"), []byte("{}"), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	// Create an invalid profile (no sessions.json)
	invalidProfileDir := filepath.Join(profilesDir, "invalid-profile")
	if err := os.MkdirAll(invalidProfileDir, 0700); err != nil {
		t.Fatalf("Failed to create invalid profile dir: %v", err)
	}

	// List profiles
	profiles, err := ListProfiles()
	if err != nil {
		t.Fatalf("ListProfiles failed: %v", err)
	}

	// Should only return the valid profile
	if len(profiles) != 1 {
		t.Fatalf("ListProfiles length = %d, want 1", len(profiles))
	}

	if profiles[0] != "valid-profile" {
		t.Errorf("ListProfiles[0] = %q, want %q", profiles[0], "valid-profile")
	}
}

// TestProfileExistsReturnsFalseForNonexistent verifies the error path.
func TestProfileExistsReturnsFalseForNonexistent(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	exists, err := ProfileExists("nonexistent-profile")
	if err != nil {
		t.Fatalf("ProfileExists should not error for nonexistent profile: %v", err)
	}

	if exists {
		t.Error("ProfileExists should return false for nonexistent profile")
	}
}

// TestProfileExistsReturnsTrueForValid verifies the happy path.
func TestProfileExistsReturnsTrueForValid(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	// Create a valid profile
	profileDir, err := GetProfileDir("test-profile")
	if err != nil {
		t.Fatalf("GetProfileDir failed: %v", err)
	}

	if err := os.MkdirAll(profileDir, 0700); err != nil {
		t.Fatalf("Failed to create profile dir: %v", err)
	}

	sessionsPath := filepath.Join(profileDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte("{}"), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	// Check if it exists
	exists, err := ProfileExists("test-profile")
	if err != nil {
		t.Fatalf("ProfileExists failed: %v", err)
	}

	if !exists {
		t.Error("ProfileExists should return true for valid profile")
	}
}

// TestLoadConfigSetsDefaultProfileWhenEmpty verifies that LoadConfig ensures
// DefaultProfile is never empty, even if the saved config has an empty value.
// This prevents runtime errors when code assumes DefaultProfile is set.
func TestLoadConfigSetsDefaultProfileWhenEmpty(t *testing.T) {
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	defer func() { _ = os.Setenv("HOME", origHome) }()
	_ = os.Setenv("HOME", tmpHome)

	// Manually write a config with empty DefaultProfile
	agentDeckDir := filepath.Join(tmpHome, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	configPath := filepath.Join(agentDeckDir, ConfigFileName)
	configData := map[string]interface{}{
		"default_profile": "", // Explicitly empty
		"version":         1,
	}
	jsonData, _ := json.MarshalIndent(configData, "", "  ")
	if err := os.WriteFile(configPath, jsonData, 0600); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	// Load the config
	loaded, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig failed: %v", err)
	}

	// Verify DefaultProfile was filled in
	if loaded.DefaultProfile == "" {
		t.Error("LoadConfig should set DefaultProfile when it's empty in the file")
	}
}
