package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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

	// Redirect HOME so PersistSession writes to a temp dir, not real sessions.json
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

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

// TestExtractGroupPathReturnsParentForTypicalProjectPath verifies that for a
// typical macOS project path like "/Users/jason/hc-repo/agent-deck", the
// function returns the parent directory "hc-repo" — this is how sessions get
// grouped by their containing folder in the sidebar.
func TestExtractGroupPathReturnsParentForTypicalProjectPath(t *testing.T) {
	got := extractGroupPath("/Users/jason/hc-repo/agent-deck")
	if got != "hc-repo" {
		t.Errorf("extractGroupPath(/Users/jason/hc-repo/agent-deck) = %q, want %q", got, "hc-repo")
	}
}

// TestExtractGroupPathReturnsFallbackForEmptyPath verifies that an empty
// project path falls back to "my-sessions" — this is the default group used
// when there's no project context (e.g., sessions created without a directory).
func TestExtractGroupPathReturnsFallbackForEmptyPath(t *testing.T) {
	got := extractGroupPath("")
	if got != "my-sessions" {
		t.Errorf("extractGroupPath(%q) = %q, want %q", "", got, "my-sessions")
	}
}

// TestExtractGroupPathReturnsParentForLinuxHomePath verifies the function
// works for Linux-style home directories where /home is skipped the same
// way /Users is on macOS.
func TestExtractGroupPathReturnsParentForLinuxHomePath(t *testing.T) {
	got := extractGroupPath("/home/dev/projects/my-app")
	if got != "projects" {
		t.Errorf("extractGroupPath(/home/dev/projects/my-app) = %q, want %q", got, "projects")
	}
}

// TestExtractGroupPathSkipsHiddenParent verifies that when the parent
// directory starts with a dot (e.g., hidden config directories), the function
// returns the project directory itself rather than the hidden parent — hidden
// directories aren't meaningful group names.
func TestExtractGroupPathSkipsHiddenParent(t *testing.T) {
	got := extractGroupPath("/Users/jason/.config/my-app")
	if got != "my-app" {
		t.Errorf("extractGroupPath(/Users/jason/.config/my-app) = %q, want %q", got, "my-app")
	}
}

// TestExtractGroupPathReturnsDirNameForSingleSegmentPath verifies that a
// path with only one meaningful segment (e.g., "/tmp") returns that segment
// as the group name — there's no parent to use, so the directory itself is
// the group. This covers quick scratch sessions opened in /tmp.
func TestExtractGroupPathReturnsDirNameForSingleSegmentPath(t *testing.T) {
	got := extractGroupPath("/tmp")
	if got != "tmp" {
		t.Errorf("extractGroupPath(%q) = %q, want %q", "/tmp", got, "tmp")
	}
}

// TestExtractGroupPathReturnsUsernameForProjectDirectlyInHome verifies that
// when a project sits directly in the home directory (e.g., /Users/jason/my-project),
// the parent "jason" is returned as the group name. This is a realistic edge case
// for users who keep projects directly in ~ without an organizing subfolder.
func TestExtractGroupPathReturnsUsernameForProjectDirectlyInHome(t *testing.T) {
	got := extractGroupPath("/Users/jason/my-project")
	if got != "jason" {
		t.Errorf("extractGroupPath(/Users/jason/my-project) = %q, want %q", got, "jason")
	}
}

// TestExtractGroupPathHandlesDeeplyNestedPath verifies that for deeply
// nested project paths, the function still returns the immediate parent
// of the last path component — depth doesn't change the grouping logic.
func TestExtractGroupPathHandlesDeeplyNestedPath(t *testing.T) {
	got := extractGroupPath("/Users/jason/code/work/team/project-x")
	if got != "team" {
		t.Errorf("extractGroupPath(/Users/jason/code/work/team/project-x) = %q, want %q", got, "team")
	}
}

// TestCreateSessionSetsGroupPathFromProjectDir verifies that CreateSession
// populates the GroupPath field based on the project directory — this is
// the core behavior the PR introduces so the desktop app can display
// sessions grouped by their containing folder.
func TestCreateSessionSetsGroupPathFromProjectDir(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	// Redirect HOME so PersistSession writes to a temp dir, not real sessions.json
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	tm := NewTmuxManager()
	tmpDir := t.TempDir() // e.g., /var/folders/.../T/TestXxx/001

	session, err := tm.CreateSession(tmpDir, "Group Test", "claude", "")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", session.TmuxSession).Run()

	// GroupPath should be set (not empty) and match what extractGroupPath would return
	expected := extractGroupPath(tmpDir)
	if session.GroupPath != expected {
		t.Errorf("CreateSession GroupPath = %q, want %q (derived from %q)", session.GroupPath, expected, tmpDir)
	}
	if session.GroupPath == "" {
		t.Error("CreateSession should never produce an empty GroupPath")
	}
}

// TestConvertInstancesNormalizesEmptyGroupPathWithProjectPath verifies
// that when converting stored instances (from older versions or the TUI)
// that have an empty group_path but a valid project_path, the conversion
// derives the group path from the project path — ensuring consistent
// grouping in the sidebar.
func TestConvertInstancesNormalizesEmptyGroupPathWithProjectPath(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()

	// Create a tmux session so the instance won't be filtered as "not running"
	tmpDir := t.TempDir()
	sessionName := "test_normalize_grouppath"
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", sessionName, "-c", tmpDir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create test tmux session: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", sessionName).Run()

	// Simulate an instance from an older version with empty group_path
	instances := []instanceJSON{
		{
			ID:          "test-id-001",
			Title:       "Old Session",
			ProjectPath: "/Users/jason/hc-repo/agent-deck",
			GroupPath:   "", // Empty — the scenario this PR fixes
			Tool:        "claude",
			Status:      "running",
			TmuxSession: sessionName,
		},
	}

	result := tm.convertInstancesToSessionInfos(instances)
	if len(result) == 0 {
		t.Fatal("convertInstancesToSessionInfos returned no sessions (tmux session may not be detected)")
	}

	// The empty group_path should be normalized to the derived value
	if result[0].GroupPath != "hc-repo" {
		t.Errorf("Expected normalized GroupPath %q, got %q", "hc-repo", result[0].GroupPath)
	}
}

// TestConvertInstancesNormalizesEmptyGroupPathWithoutProjectPath verifies
// that when both group_path and project_path are empty (e.g., a shell-only
// session), the conversion defaults to "my-sessions" — the catch-all group.
func TestConvertInstancesNormalizesEmptyGroupPathWithoutProjectPath(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()

	// Create a tmux session so the instance won't be filtered
	tmpDir := t.TempDir()
	sessionName := "test_normalize_empty"
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", sessionName, "-c", tmpDir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create test tmux session: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", sessionName).Run()

	instances := []instanceJSON{
		{
			ID:          "test-id-002",
			Title:       "No Path Session",
			ProjectPath: "", // No project path
			GroupPath:   "", // No group path
			Tool:        "claude",
			Status:      "running",
			TmuxSession: sessionName,
		},
	}

	result := tm.convertInstancesToSessionInfos(instances)
	if len(result) == 0 {
		t.Fatal("convertInstancesToSessionInfos returned no sessions")
	}

	if result[0].GroupPath != "my-sessions" {
		t.Errorf("Expected GroupPath %q for session with no paths, got %q", "my-sessions", result[0].GroupPath)
	}
}

// TestUpdateSessionStatus_UpdatesStatusInJSON verifies that UpdateSessionStatus
// reads sessions.json, finds the matching session by ID, updates its status field,
// and writes the result atomically. This is the core persistence mechanism for
// status updates when a desktop terminal successfully attaches (PR #67).
func TestUpdateSessionStatus_UpdatesStatusInJSON(t *testing.T) {
	// Set up temp HOME so getSessionsPath() points to a test file
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	// Create the sessions directory structure
	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	// Write a sessions.json with a session in "error" status
	sessionsJSON := `{
  "instances": [
    {
      "id": "abc-123",
      "title": "Test Session",
      "status": "error",
      "tool": "claude",
      "project_path": "/tmp/test"
    },
    {
      "id": "def-456",
      "title": "Other Session",
      "status": "idle",
      "tool": "shell",
      "project_path": "/tmp/other"
    }
  ]
}`
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte(sessionsJSON), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	tm := NewTmuxManager()

	// Update the error session to "running"
	if err := tm.UpdateSessionStatus("abc-123", "running"); err != nil {
		t.Fatalf("UpdateSessionStatus failed: %v", err)
	}

	// Read back and verify
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		t.Fatalf("Failed to read sessions.json: %v", err)
	}

	var result map[string]json.RawMessage
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to parse result JSON: %v", err)
	}

	var instances []map[string]interface{}
	if err := json.Unmarshal(result["instances"], &instances); err != nil {
		t.Fatalf("Failed to parse instances: %v", err)
	}

	// Find the updated session
	for _, inst := range instances {
		id, _ := inst["id"].(string)
		status, _ := inst["status"].(string)
		if id == "abc-123" {
			if status != "running" {
				t.Errorf("Session abc-123 status = %q, want %q", status, "running")
			}
		}
		if id == "def-456" {
			if status != "idle" {
				t.Errorf("Session def-456 status should be unchanged (idle), got %q", status)
			}
		}
	}
}

// TestUpdateSessionStatus_SessionNotFound verifies that UpdateSessionStatus
// returns an error when the session ID doesn't exist in sessions.json.
func TestUpdateSessionStatus_SessionNotFound(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	sessionsJSON := `{
  "instances": [
    {"id": "abc-123", "title": "Test", "status": "error"}
  ]
}`
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte(sessionsJSON), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	tm := NewTmuxManager()
	err := tm.UpdateSessionStatus("nonexistent-id", "running")
	if err == nil {
		t.Error("UpdateSessionStatus should return error for nonexistent session ID")
	}
	if err != nil && !strings.Contains(err.Error(), "session not found") {
		t.Errorf("Error should mention 'session not found', got: %v", err)
	}
}

// TestUpdateSessionStatus_PreservesOtherFields verifies that UpdateSessionStatus
// only modifies the status field and preserves all other session data.
func TestUpdateSessionStatus_PreservesOtherFields(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	// Include extra fields that should be preserved
	sessionsJSON := `{
  "instances": [
    {
      "id": "abc-123",
      "title": "Test Session",
      "status": "error",
      "tool": "claude",
      "project_path": "/tmp/test",
      "remote_host": "dev-server",
      "claude_session_id": "session-xyz"
    }
  ],
  "version": "1.0"
}`
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte(sessionsJSON), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	tm := NewTmuxManager()
	if err := tm.UpdateSessionStatus("abc-123", "running"); err != nil {
		t.Fatalf("UpdateSessionStatus failed: %v", err)
	}

	// Read back and verify all fields preserved
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		t.Fatalf("Failed to read sessions.json: %v", err)
	}

	var result map[string]json.RawMessage
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	// Top-level "version" key should be preserved
	if string(result["version"]) != `"1.0"` {
		t.Errorf("Top-level 'version' field not preserved, got: %s", string(result["version"]))
	}

	var instances []map[string]interface{}
	if err := json.Unmarshal(result["instances"], &instances); err != nil {
		t.Fatalf("Failed to parse instances: %v", err)
	}

	inst := instances[0]
	if inst["title"] != "Test Session" {
		t.Errorf("title not preserved: %v", inst["title"])
	}
	if inst["tool"] != "claude" {
		t.Errorf("tool not preserved: %v", inst["tool"])
	}
	if inst["project_path"] != "/tmp/test" {
		t.Errorf("project_path not preserved: %v", inst["project_path"])
	}
	if inst["remote_host"] != "dev-server" {
		t.Errorf("remote_host not preserved: %v", inst["remote_host"])
	}
	if inst["claude_session_id"] != "session-xyz" {
		t.Errorf("claude_session_id not preserved: %v", inst["claude_session_id"])
	}
	if inst["status"] != "running" {
		t.Errorf("status should be updated to running, got: %v", inst["status"])
	}
}

// TestUpdateSessionStatus_AtomicWrite verifies that if a .tmp file exists from
// a previous failed write, UpdateSessionStatus still succeeds (overwrites it).
func TestUpdateSessionStatus_AtomicWrite(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	sessionsJSON := `{"instances": [{"id": "abc-123", "status": "error"}]}`
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte(sessionsJSON), 0600); err != nil {
		t.Fatalf("Failed to write sessions.json: %v", err)
	}

	// Create a stale .tmp file
	tmpPath := sessionsPath + ".tmp"
	if err := os.WriteFile(tmpPath, []byte("stale data"), 0600); err != nil {
		t.Fatalf("Failed to write stale .tmp file: %v", err)
	}

	tm := NewTmuxManager()
	if err := tm.UpdateSessionStatus("abc-123", "running"); err != nil {
		t.Fatalf("UpdateSessionStatus should succeed even with stale .tmp file: %v", err)
	}

	// Verify the .tmp file is gone (renamed to sessions.json)
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error("Stale .tmp file should be cleaned up after successful write")
	}

	// Verify the result
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		t.Fatalf("Failed to read sessions.json: %v", err)
	}
	if !strings.Contains(string(data), `"running"`) {
		t.Error("sessions.json should contain updated status 'running'")
	}
}

// TestConvertInstancesPreservesExistingGroupPath verifies that when an
// instance already has a non-empty group_path (set by a newer version),
// the conversion preserves it as-is — no override or normalization.
func TestConvertInstancesPreservesExistingGroupPath(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available, skipping integration test")
	}

	tm := NewTmuxManager()

	tmpDir := t.TempDir()
	sessionName := "test_preserve_grouppath"
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", sessionName, "-c", tmpDir)
	if err := cmd.Run(); err != nil {
		t.Fatalf("Failed to create test tmux session: %v", err)
	}
	defer exec.Command(tmuxBinaryPath, "kill-session", "-t", sessionName).Run()

	instances := []instanceJSON{
		{
			ID:          "test-id-003",
			Title:       "Existing Group Session",
			ProjectPath: "/Users/jason/hc-repo/agent-deck",
			GroupPath:   "custom-group", // Already set — should NOT be overridden
			Tool:        "claude",
			Status:      "running",
			TmuxSession: sessionName,
		},
	}

	result := tm.convertInstancesToSessionInfos(instances)
	if len(result) == 0 {
		t.Fatal("convertInstancesToSessionInfos returned no sessions")
	}

	if result[0].GroupPath != "custom-group" {
		t.Errorf("Expected preserved GroupPath %q, got %q", "custom-group", result[0].GroupPath)
	}
}

// TestPersistSessionWritesRemoteTmuxNameForRemote verifies that when
// PersistSession is called with IsRemote=true, the resulting sessions.json
// contains "remote_tmux_name" set to the TmuxSession value. The TUI's
// remote discovery logic uses this field to match discovered remote sessions
// back to persisted entries.
func TestPersistSessionWritesRemoteTmuxNameForRemote(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	// Create the sessions directory structure
	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	tm := NewTmuxManager()

	// Persist a remote session
	err := tm.PersistSession(SessionInfo{
		ID:          "remote-001",
		Title:       "Remote Session",
		ProjectPath: "/home/user/project",
		GroupPath:   "remote/Jeeves",
		Tool:        "claude",
		Status:      "running",
		TmuxSession: "agentdeck_12345",
		IsRemote:    true,
		RemoteHost:  "jeeves",
	})
	if err != nil {
		t.Fatalf("PersistSession failed: %v", err)
	}

	// Read back and verify remote_tmux_name is present
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		t.Fatalf("Failed to read sessions.json: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	var instances []map[string]interface{}
	if err := json.Unmarshal(raw["instances"], &instances); err != nil {
		t.Fatalf("Failed to parse instances: %v", err)
	}

	if len(instances) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(instances))
	}

	remoteTmuxName, ok := instances[0]["remote_tmux_name"].(string)
	if !ok {
		t.Fatal("remote_tmux_name field missing or not a string in persisted JSON")
	}
	if remoteTmuxName != "agentdeck_12345" {
		t.Errorf("remote_tmux_name = %q, want %q", remoteTmuxName, "agentdeck_12345")
	}
}

// TestPersistSessionOmitsRemoteTmuxNameForLocal verifies that when
// PersistSession is called with IsRemote=false, the resulting sessions.json
// does NOT contain "remote_tmux_name" (the field uses omitempty and should
// be absent for local sessions).
func TestPersistSessionOmitsRemoteTmuxNameForLocal(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	sessionsDir := filepath.Join(tmpHome, ".agent-deck", "profiles", "default")
	if err := os.MkdirAll(sessionsDir, 0755); err != nil {
		t.Fatalf("Failed to create sessions dir: %v", err)
	}

	tm := NewTmuxManager()

	// Persist a local session (IsRemote defaults to false)
	err := tm.PersistSession(SessionInfo{
		ID:          "local-001",
		Title:       "Local Session",
		ProjectPath: "/Users/jason/project",
		GroupPath:   "project",
		Tool:        "claude",
		Status:      "running",
		TmuxSession: "agentdeck_67890",
	})
	if err != nil {
		t.Fatalf("PersistSession failed: %v", err)
	}

	// Read back raw JSON and check that remote_tmux_name is absent
	sessionsPath := filepath.Join(sessionsDir, "sessions.json")
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		t.Fatalf("Failed to read sessions.json: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	var instances []map[string]interface{}
	if err := json.Unmarshal(raw["instances"], &instances); err != nil {
		t.Fatalf("Failed to parse instances: %v", err)
	}

	if len(instances) != 1 {
		t.Fatalf("Expected 1 instance, got %d", len(instances))
	}

	// remote_tmux_name should be absent (omitempty with empty string)
	if val, exists := instances[0]["remote_tmux_name"]; exists {
		t.Errorf("remote_tmux_name should be omitted for local sessions, but got: %v", val)
	}
}

