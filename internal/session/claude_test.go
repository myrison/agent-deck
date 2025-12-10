package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetClaudeConfigDir_Default(t *testing.T) {
	// Unset env var to test default
	os.Unsetenv("CLAUDE_CONFIG_DIR")

	dir := GetClaudeConfigDir()
	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, ".claude")

	if dir != expected {
		t.Errorf("GetClaudeConfigDir() = %s, want %s", dir, expected)
	}
}

func TestGetClaudeConfigDir_EnvOverride(t *testing.T) {
	os.Setenv("CLAUDE_CONFIG_DIR", "/custom/path")
	defer os.Unsetenv("CLAUDE_CONFIG_DIR")

	dir := GetClaudeConfigDir()
	if dir != "/custom/path" {
		t.Errorf("GetClaudeConfigDir() = %s, want /custom/path", dir)
	}
}

func TestGetClaudeSessionID_NotFound(t *testing.T) {
	id, err := GetClaudeSessionID("/nonexistent/path")
	if err == nil {
		t.Error("Expected error for nonexistent path")
	}
	if id != "" {
		t.Errorf("Expected empty ID, got %s", id)
	}
}
