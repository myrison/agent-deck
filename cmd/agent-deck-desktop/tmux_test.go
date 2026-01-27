package main

import (
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

// TestTmuxManagerSessionExists tests session existence checking
func TestTmuxManagerSessionExists(t *testing.T) {
	// Skip if tmux is not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()

	// Non-existent session should return false
	if tm.SessionExists("definitely_not_a_real_session_name_12345") {
		t.Error("Expected SessionExists to return false for non-existent session")
	}
}

// TestTmuxManagerCreateSession tests session creation
func TestTmuxManagerCreateSession(t *testing.T) {
	// Skip if tmux is not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()
	tmpDir := t.TempDir()

	// Create a session
	session, err := tm.CreateSession(tmpDir, "Test Session", "claude", "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Verify session info
	if session.Title != "Test Session" {
		t.Errorf("Expected title 'Test Session', got '%s'", session.Title)
	}
	if session.ProjectPath != tmpDir {
		t.Errorf("Expected projectPath '%s', got '%s'", tmpDir, session.ProjectPath)
	}
	if session.Tool != "claude" {
		t.Errorf("Expected tool 'claude', got '%s'", session.Tool)
	}
	if session.TmuxSession == "" {
		t.Error("Expected TmuxSession to be set")
	}
	if !strings.HasPrefix(session.TmuxSession, "agentdeck_") {
		t.Errorf("Expected TmuxSession to start with 'agentdeck_', got '%s'", session.TmuxSession)
	}

	// Verify the tmux session actually exists
	if !tm.SessionExists(session.TmuxSession) {
		t.Error("Created session should exist in tmux")
	}

	// Clean up: kill the test session
	exec.Command("tmux", "kill-session", "-t", session.TmuxSession).Run()
}

// TestTmuxManagerGetRunningSessionsFormat tests session listing format
func TestTmuxManagerGetRunningSessionsFormat(t *testing.T) {
	// Skip if tmux is not available
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()
	sessions := tm.getRunningTmuxSessions()

	// Just verify it returns a map (may be empty if no sessions running)
	if sessions == nil {
		t.Error("getRunningTmuxSessions should not return nil")
	}
}

// TestEnsureTmuxRunningIsIdempotent verifies that calling ensureTmuxRunning
// multiple times does not break session listing — this is the core invariant
// the PR introduces (called at startup and before every session query).
func TestEnsureTmuxRunningIsIdempotent(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()

	// Create a test session so we have something to find
	tmpDir := t.TempDir()
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", "test_idempotent_check", "-c", tmpDir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create test tmux session: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", "test_idempotent_check").Run()

	// Call ensureTmuxRunning multiple times (simulating startup + refresh)
	ensureTmuxRunning()
	ensureTmuxRunning()
	ensureTmuxRunning()

	// Session listing should still find our test session
	sessions := tm.getRunningTmuxSessions()
	if !sessions["test_idempotent_check"] {
		t.Error("Expected to find test_idempotent_check session after repeated ensureTmuxRunning calls")
	}
}

// TestGetRunningTmuxSessionsFindsCreatedSession verifies that
// getRunningTmuxSessions (which now calls ensureTmuxRunning internally)
// returns sessions that were created before the call.
func TestGetRunningTmuxSessionsFindsCreatedSession(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()
	tmpDir := t.TempDir()

	sessionName := "test_listing_recovery"
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", sessionName, "-c", tmpDir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create test session: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", sessionName).Run()

	// getRunningTmuxSessions now calls ensureTmuxRunning before listing.
	// Verify the created session appears in the listing.
	sessions := tm.getRunningTmuxSessions()
	if !sessions[sessionName] {
		t.Errorf("Expected session %q in running sessions map, got: %v", sessionName, sessions)
	}
}

// TestGenerateSessionIDFormat verifies the session ID format matches
// {8-hex-chars}-{unix-timestamp}, which downstream consumers (sessions.json,
// TUI, frontend) depend on for parsing and display.
func TestGenerateSessionIDFormat(t *testing.T) {
	// Pattern: 8 hex chars, dash, unix timestamp (digits)
	pattern := regexp.MustCompile(`^[0-9a-f]{8}-\d+$`)

	for i := 0; i < 10; i++ {
		id := generateSessionID()
		if !pattern.MatchString(id) {
			t.Errorf("generateSessionID() = %q, does not match expected format {8-hex}-{timestamp}", id)
		}
	}
}

// TestGenerateSessionIDUniqueness verifies that two IDs generated in rapid
// succession are distinct — the random prefix differentiates them even when
// the timestamp component is identical.
func TestGenerateSessionIDUniqueness(t *testing.T) {
	id1 := generateSessionID()
	id2 := generateSessionID()
	if id1 == id2 {
		t.Errorf("generateSessionID() produced identical IDs on successive calls: %q", id1)
	}
}

// TestBuildToolCommandPassesCustomToolThrough verifies that an unrecognized
// tool name is used as-is for the command — this is the fallthrough behavior
// that allows users to configure arbitrary tools beyond claude/gemini/opencode.
func TestBuildToolCommandPassesCustomToolThrough(t *testing.T) {
	result := buildToolCommand("my-custom-agent", "", false)
	if result.toolCmd != "my-custom-agent" {
		t.Errorf("buildToolCommand with custom tool: got toolCmd %q, want %q", result.toolCmd, "my-custom-agent")
	}
	if len(result.cmdArgs) != 0 {
		t.Errorf("buildToolCommand with no config should produce no args, got %v", result.cmdArgs)
	}
}

// TestBuildToolCommandNoConfigProducesCleanResult verifies that calling
// buildToolCommand without a launch config produces a result with no
// dangerous mode, no config name, and no extra arguments — the baseline
// state that CreateSession and CreateRemoteSession build upon.
func TestBuildToolCommandNoConfigProducesCleanResult(t *testing.T) {
	result := buildToolCommand("claude", "", false)
	if result.dangerousMode {
		t.Error("Expected dangerousMode=false with no launch config")
	}
	if result.launchConfigName != "" {
		t.Errorf("Expected empty launchConfigName, got %q", result.launchConfigName)
	}
	if len(result.loadedMCPs) != 0 {
		t.Errorf("Expected no loaded MCPs, got %v", result.loadedMCPs)
	}
}

// TestBuildToolCommandNonexistentConfig verifies that a non-existent config key
// is handled gracefully — the tool command is still usable.
func TestBuildToolCommandNonexistentConfig(t *testing.T) {
	result := buildToolCommand("claude", "nonexistent-config-key-xyz", false)
	if result.toolCmd != "claude" {
		t.Errorf("Expected toolCmd 'claude', got %q", result.toolCmd)
	}
	// With a non-existent config, no extra args or config name should be set
	if result.launchConfigName != "" {
		t.Errorf("Expected empty launchConfigName, got %q", result.launchConfigName)
	}
}

// TestSanitizeShellArgBlocksDangerousInput verifies that shell metacharacters
// are rejected, preventing command injection in remote session commands.
func TestSanitizeShellArgBlocksDangerousInput(t *testing.T) {
	dangerous := []string{
		"cmd; rm -rf /",
		"cmd && evil",
		"cmd | pipe",
		"$(malicious)",
		"`backtick`",
		"cmd\nevil",       // newline injection
		"cmd\revil",       // carriage return injection
		"arg > /etc/file", // redirect
		"arg < input",     // redirect
		"cmd()",           // subshell
		"${VAR}",          // variable expansion
		"cmd!hist",        // history expansion
		"arg*glob",        // glob
		"arg?match",       // glob
		"arg#comment",     // comment
	}

	for _, input := range dangerous {
		t.Run(input, func(t *testing.T) {
			err := sanitizeShellArg(input)
			if err == nil {
				t.Errorf("sanitizeShellArg(%q) should have returned error for dangerous input", input)
			}
		})
	}
}

// TestSanitizeShellArgAllowsSafeInput verifies that normal tool arguments
// pass validation — including paths with tildes, which are common for
// home directory references.
func TestSanitizeShellArgAllowsSafeInput(t *testing.T) {
	safe := []string{
		"claude",
		"--dangerously-skip-permissions",
		"--mcp-config",
		"~/path/to/config.json",
		"/usr/local/bin/tool",
		"my-session-name",
		"simple_arg",
		"arg.with.dots",
		"arg-with-dashes",
		"arg=value",
		"\"quoted\"",
		"'single-quoted'",
	}

	for _, input := range safe {
		t.Run(input, func(t *testing.T) {
			err := sanitizeShellArg(input)
			if err != nil {
				t.Errorf("sanitizeShellArg(%q) = %v, expected nil for safe input", input, err)
			}
		})
	}
}

// TestSanitizeShellArgsRejectsAnyDangerousArg verifies that the batch
// validation function fails if any single argument is dangerous.
func TestSanitizeShellArgsRejectsAnyDangerousArg(t *testing.T) {
	args := []string{"safe-arg", "--flag", "cmd; evil", "another-safe"}
	err := sanitizeShellArgs(args)
	if err == nil {
		t.Error("sanitizeShellArgs should reject the batch if any argument is dangerous")
	}
}

// TestSanitizeShellArgsAcceptsAllSafe verifies batch validation passes
// when all arguments are safe.
func TestSanitizeShellArgsAcceptsAllSafe(t *testing.T) {
	args := []string{"claude", "--dangerously-skip-permissions", "--mcp-config", "~/config.json"}
	err := sanitizeShellArgs(args)
	if err != nil {
		t.Errorf("sanitizeShellArgs with safe args returned error: %v", err)
	}
}

