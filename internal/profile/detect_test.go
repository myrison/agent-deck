package profile

import (
	"os"
	"testing"
)

func TestDetectCurrentProfile(t *testing.T) {
	// Save original env vars
	origAgentdeckProfile := os.Getenv("AGENTDECK_PROFILE")
	origClaudeConfigDir := os.Getenv("CLAUDE_CONFIG_DIR")
	defer func() {
		if origAgentdeckProfile != "" {
			_ = os.Setenv("AGENTDECK_PROFILE", origAgentdeckProfile)
		} else {
			_ = os.Unsetenv("AGENTDECK_PROFILE")
		}
		if origClaudeConfigDir != "" {
			_ = os.Setenv("CLAUDE_CONFIG_DIR", origClaudeConfigDir)
		} else {
			_ = os.Unsetenv("CLAUDE_CONFIG_DIR")
		}
	}()

	tests := []struct {
		name              string
		agentdeckProfile  string
		claudeConfigDir   string
		expectedContains  string // Expected profile (or substring for default case)
	}{
		{
			name:              "explicit AGENTDECK_PROFILE takes priority",
			agentdeckProfile:  "work",
			claudeConfigDir:   "/Users/test/.claude-personal",
			expectedContains:  "work",
		},
		{
			name:              "CLAUDE_CONFIG_DIR .claude-work suffix",
			agentdeckProfile:  "",
			claudeConfigDir:   "/Users/test/.claude-work",
			expectedContains:  "work",
		},
		{
			name:              "CLAUDE_CONFIG_DIR .claude-personal suffix",
			agentdeckProfile:  "",
			claudeConfigDir:   "/Users/test/.claude-personal",
			expectedContains:  "personal",
		},
		{
			name:              "CLAUDE_CONFIG_DIR with hyphen pattern",
			agentdeckProfile:  "",
			claudeConfigDir:   "/opt/claude-production",
			expectedContains:  "production",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear env vars
			_ = os.Unsetenv("AGENTDECK_PROFILE")
			_ = os.Unsetenv("CLAUDE_CONFIG_DIR")

			// Set test env vars
			if tt.agentdeckProfile != "" {
				_ = os.Setenv("AGENTDECK_PROFILE", tt.agentdeckProfile)
			}
			if tt.claudeConfigDir != "" {
				_ = os.Setenv("CLAUDE_CONFIG_DIR", tt.claudeConfigDir)
			}

			result := DetectCurrentProfile()
			if result != tt.expectedContains {
				t.Errorf("DetectCurrentProfile() = %q, want %q", result, tt.expectedContains)
			}
		})
	}
}

func TestDetectCurrentProfile_DefaultFallback(t *testing.T) {
	// Save original env vars
	origAgentdeckProfile := os.Getenv("AGENTDECK_PROFILE")
	origClaudeConfigDir := os.Getenv("CLAUDE_CONFIG_DIR")
	defer func() {
		if origAgentdeckProfile != "" {
			_ = os.Setenv("AGENTDECK_PROFILE", origAgentdeckProfile)
		} else {
			_ = os.Unsetenv("AGENTDECK_PROFILE")
		}
		if origClaudeConfigDir != "" {
			_ = os.Setenv("CLAUDE_CONFIG_DIR", origClaudeConfigDir)
		} else {
			_ = os.Unsetenv("CLAUDE_CONFIG_DIR")
		}
	}()

	// Clear all env vars
	_ = os.Unsetenv("AGENTDECK_PROFILE")
	_ = os.Unsetenv("CLAUDE_CONFIG_DIR")

	result := DetectCurrentProfile()
	// Should return either the config default or "default"
	if result == "" {
		t.Error("DetectCurrentProfile() should not return empty string")
	}
}
