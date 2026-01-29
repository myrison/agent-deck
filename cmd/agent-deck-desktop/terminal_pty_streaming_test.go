package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================
// shouldUsePTYStreaming() Tests
// ============================================================

// TestShouldUsePTYStreaming_EnvEnabled verifies env var takes precedence over config
func TestShouldUsePTYStreaming_EnvEnabled(t *testing.T) {
	os.Setenv("REVDEN_PTY_STREAMING", "enabled")
	defer os.Unsetenv("REVDEN_PTY_STREAMING")

	result := shouldUsePTYStreaming()
	assert.True(t, result, "should return true when REVDEN_PTY_STREAMING=enabled")
}

// TestShouldUsePTYStreaming_EnvDisabled verifies non-"enabled" env value returns false
func TestShouldUsePTYStreaming_EnvDisabled(t *testing.T) {
	os.Setenv("REVDEN_PTY_STREAMING", "disabled")
	defer os.Unsetenv("REVDEN_PTY_STREAMING")

	result := shouldUsePTYStreaming()
	assert.False(t, result, "should return false when REVDEN_PTY_STREAMING=disabled")
}

// TestShouldUsePTYStreaming_EnvUnsetConfigEnabled verifies config fallback when env unset
func TestShouldUsePTYStreaming_EnvUnsetConfigEnabled(t *testing.T) {
	os.Unsetenv("REVDEN_PTY_STREAMING")

	// Create temp HOME with config file
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	require.NoError(t, os.MkdirAll(configDir, 0700))

	configPath := filepath.Join(configDir, "config.toml")
	configContent := `[desktop.terminal]
pty_streaming = true
`
	require.NoError(t, os.WriteFile(configPath, []byte(configContent), 0644))

	result := shouldUsePTYStreaming()
	assert.True(t, result, "should return true when config has pty_streaming=true")
}

// TestShouldUsePTYStreaming_EnvUnsetConfigDisabled verifies config disables when env unset
func TestShouldUsePTYStreaming_EnvUnsetConfigDisabled(t *testing.T) {
	os.Unsetenv("REVDEN_PTY_STREAMING")

	// Create temp HOME with config file
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	require.NoError(t, os.MkdirAll(configDir, 0700))

	configPath := filepath.Join(configDir, "config.toml")
	configContent := `[desktop.terminal]
pty_streaming = false
`
	require.NoError(t, os.WriteFile(configPath, []byte(configContent), 0644))

	result := shouldUsePTYStreaming()
	assert.False(t, result, "should return false when config has pty_streaming=false")
}

// TestShouldUsePTYStreaming_ConfigCorrupt verifies error handling returns default (false)
func TestShouldUsePTYStreaming_ConfigCorrupt(t *testing.T) {
	os.Unsetenv("REVDEN_PTY_STREAMING")

	// Create temp HOME with corrupt config file
	tmpHome := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	configDir := filepath.Join(tmpHome, ".agent-deck")
	require.NoError(t, os.MkdirAll(configDir, 0700))

	configPath := filepath.Join(configDir, "config.toml")
	configContent := `[desktop.terminal
invalid toml syntax`
	require.NoError(t, os.WriteFile(configPath, []byte(configContent), 0644))

	result := shouldUsePTYStreaming()
	assert.False(t, result, "should return false (default) when config is corrupt")
}

// ============================================================
// findLastValidUTF8Boundary() Tests
// ============================================================

// TestFindLastValidUTF8Boundary tests UTF-8 boundary detection.
// This is critical for preventing corrupted multi-byte characters in streaming mode.
func TestFindLastValidUTF8Boundary(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			name:     "empty data",
			input:    []byte{},
			expected: 0,
		},
		{
			name:     "complete ASCII",
			input:    []byte("hello"),
			expected: 5,
		},
		{
			name:     "complete UTF-8 emoji",
			input:    []byte("hello 🎉"),
			expected: 10, // "hello " (6) + 🎉 (4 bytes)
		},
		{
			name:     "incomplete UTF-8 emoji - first byte only",
			input:    []byte("hello \xF0"), // Start of 4-byte sequence
			expected: 6,                     // Should return up to "hello "
		},
		{
			name:     "incomplete UTF-8 emoji - two bytes",
			input:    []byte("hello \xF0\x9F"), // First 2 bytes of 🎉
			expected: 6,                         // Should return up to "hello "
		},
		{
			name:     "incomplete UTF-8 emoji - three bytes",
			input:    []byte("hello \xF0\x9F\x8E"), // First 3 bytes of 🎉
			expected: 6,                             // Should return up to "hello "
		},
		{
			name:     "incomplete 2-byte UTF-8",
			input:    []byte("test \xC3"), // Start of é (2-byte)
			expected: 5,                    // Should return up to "test "
		},
		{
			name:     "complete multi-byte then incomplete",
			input:    []byte("café\xF0"), // Complete "café" then incomplete emoji
			expected: 5,                   // Should return complete "café"
		},
		{
			name:     "multiple complete UTF-8 chars",
			input:    []byte("日本語"), // Complete Japanese characters
			expected: 9,                // 3 chars × 3 bytes each
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findLastValidUTF8Boundary(tt.input)
			if result != tt.expected {
				t.Errorf("findLastValidUTF8Boundary(%q) = %d, want %d",
					string(tt.input), result, tt.expected)
			}
		})
	}
}

// TestFindLastValidUTF8BoundaryInvalidSequences tests handling of invalid UTF-8.
func TestFindLastValidUTF8BoundaryInvalidSequences(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			name:  "invalid start byte",
			input: []byte{0xFF, 0xFF}, // Invalid UTF-8 start bytes
			// The function returns 1 because it checks last 4 bytes looking for valid rune start
			// 0xFF is treated as RuneError with size 1, so it stops at byte 1
			expected: 1,
		},
		{
			name:     "valid then invalid",
			input:    []byte("ok\xFF"),
			expected: 2, // Should return up to "ok"
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findLastValidUTF8Boundary(tt.input)
			if result != tt.expected {
				t.Errorf("findLastValidUTF8Boundary(%v) = %d, want %d",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestVerifyTmuxConfig removed - was a permanently skipped non-test.
// See adversarial review: skipped tests provide zero verification.

// TestStripTTSMarkers tests TTS marker removal from terminal output.
func TestStripTTSMarkers(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no markers",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "start marker only",
			input:    "hello «tts»world",
			expected: "hello world",
		},
		{
			name:     "end marker only",
			input:    "hello«/tts» world",
			expected: "hello world",
		},
		{
			name:     "both markers",
			input:    "before«tts»content«/tts»after",
			expected: "beforecontentafter",
		},
		{
			name:     "multiple markers",
			input:    "«tts»first«/tts» and «tts»second«/tts»",
			expected: "first and second",
		},
		{
			name:     "empty input",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripTTSMarkers(tt.input)
			if result != tt.expected {
				t.Errorf("stripTTSMarkers(%q) = %q, want %q",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestNormalizeCRLF tests line ending normalization for xterm.js.
func TestNormalizeCRLF(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "LF only",
			input:    "line1\nline2\n",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "CRLF already",
			input:    "line1\r\nline2\r\n",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "CR only",
			input:    "line1\rline2\r",
			expected: "line1\r\nline2\r\n",
		},
		{
			name:     "mixed endings",
			input:    "line1\nline2\r\nline3\r",
			expected: "line1\r\nline2\r\nline3\r\n",
		},
		{
			name:     "no line endings",
			input:    "single line",
			expected: "single line",
		},
		{
			name:     "empty",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeCRLF(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeCRLF(%q) = %q, want %q",
					tt.input, result, tt.expected)
			}
		})
	}
}

// TestItoa removed - was testing language operators instead of application logic.
// See adversarial review: Go's type system already guarantees int-to-string conversion works.
// Recommendation: Use strconv.Itoa() in production code and remove custom implementation.

// ============================================================
// verifyTmuxConfig() Tests
// ============================================================

// TestVerifyTmuxConfig_StatusAlreadyOff removed per adversarial review.
// Verdict: REMOVE - Tests implementation detail (no-op optimization) rather than
// behavioral outcome. Users only care that status ends up off, not whether the
// function skipped the set-option call when it was already off.

// TestVerifyTmuxConfig_StatusOn verifies status set to off when currently on
func TestVerifyTmuxConfig_StatusOn(t *testing.T) {
	// Skip if tmux not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	// Create test session
	sessionName := "test-verify-status-on"
	createCmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	require.NoError(t, createCmd.Run())
	defer exec.Command("tmux", "kill-session", "-t", sessionName).Run()

	// Set status to on explicitly
	setOnCmd := exec.Command("tmux", "set-option", "-t", sessionName, "status", "on")
	require.NoError(t, setOnCmd.Run())

	// Verify config - should set to off
	err := verifyTmuxConfig(sessionName)
	assert.NoError(t, err, "should succeed and set status to off")

	// Confirm status now off
	checkCmd := exec.Command("tmux", "show-option", "-t", sessionName, "-v", "status")
	output, err := checkCmd.Output()
	require.NoError(t, err)
	assert.Equal(t, "off\n", string(output), "status should be set to off")
}

// TestVerifyTmuxConfig_ShowOptionFails verifies non-fatal error when show-option fails
func TestVerifyTmuxConfig_ShowOptionFails(t *testing.T) {
	// Use non-existent session - show-option will fail but is non-fatal
	sessionName := "non-existent-session-show-fail"

	// Function ignores show-option errors and tries set-option anyway
	err := verifyTmuxConfig(sessionName)

	// Expect error from set-option (session doesn't exist)
	assert.Error(t, err, "should return error when session doesn't exist")
	assert.Contains(t, err.Error(), "failed to set tmux status off", "error should mention set-option failure")
}

// TestVerifyTmuxConfig_SetOptionFails removed per adversarial review.
// Verdict: REWRITE->REMOVE - Duplicates TestVerifyTmuxConfig_ShowOptionFails.
// Both use non-existent sessions and test the same error path. Creating a distinct
// failure mode where show-option succeeds but set-option fails is not possible with
// real tmux, so this test is redundant and has been removed.
