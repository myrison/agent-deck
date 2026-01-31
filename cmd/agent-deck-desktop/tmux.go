package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/asheshgoplani/agent-deck/internal/session"
	"github.com/asheshgoplani/agent-deck/internal/tmux"
)

// shellUnsafePattern matches characters that could cause shell injection.
// Used to validate arguments before building remote shell commands.
// Includes newline/carriage return to prevent command injection via tmux send-keys.
// Note: ~ (tilde) is allowed as it's commonly used for home directory paths.
var shellUnsafePattern = regexp.MustCompile(`[;&|$` + "`" + `\\(){}[\]<>!*?#\n\r]`)

// SessionInfo represents an Agent Deck session for the frontend.
type SessionInfo struct {
	ID                    string    `json:"id"`
	Title                 string    `json:"title"`
	CustomLabel           string    `json:"customLabel,omitempty"`
	ProjectPath           string    `json:"projectPath"`
	GroupPath             string    `json:"groupPath"`
	Tool                  string    `json:"tool"`
	Status                string    `json:"status"`
	TmuxSession           string    `json:"tmuxSession"`
	IsRemote              bool      `json:"isRemote"`
	RemoteHost            string    `json:"remoteHost,omitempty"`
	RemoteHostDisplayName string    `json:"remoteHostDisplayName,omitempty"` // Friendly name from config (group_name)
	GitBranch             string    `json:"gitBranch,omitempty"`
	IsWorktree            bool      `json:"isWorktree,omitempty"`
	GitDirty              bool      `json:"gitDirty,omitempty"`
	GitAhead              int       `json:"gitAhead,omitempty"`
	GitBehind             int       `json:"gitBehind,omitempty"`
	LastAccessedAt        time.Time `json:"lastAccessedAt,omitempty"`
	WaitingSince          time.Time `json:"waitingSince,omitempty"` // When session entered waiting status
	LaunchConfigName      string    `json:"launchConfigName,omitempty"`
	LoadedMCPs            []string  `json:"loadedMcps,omitempty"`
	DangerousMode         bool      `json:"dangerousMode,omitempty"`
}

// SessionMetadata represents runtime metadata for a session's status bar.
type SessionMetadata struct {
	Hostname  string `json:"hostname"`
	Cwd       string `json:"cwd"`
	GitBranch string `json:"gitBranch"`
}

// GroupInfo represents group information for the frontend
type GroupInfo struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	SessionCount int    `json:"sessionCount"`           // Direct sessions in this group
	TotalCount   int    `json:"totalCount"`             // Sessions including subgroups
	Level        int    `json:"level"`                  // Nesting level (0 for root)
	HasChildren  bool   `json:"hasChildren"`            // Has subgroups
	Expanded     bool   `json:"expanded"`               // TUI expand state (default)
	RemoteHostID string `json:"remoteHostId,omitempty"` // SSH host ID for remote host groups
}

// SessionsWithGroups combines sessions and groups for hierarchical display
type SessionsWithGroups struct {
	Sessions []SessionInfo `json:"sessions"`
	Groups   []GroupInfo   `json:"groups"`
}

// tmuxBinaryPath is the resolved path to tmux, used by all components.
// GUI apps on macOS don't inherit shell PATH, so we probe common locations.
var tmuxBinaryPath = findTmuxPath()

// findTmuxPath locates the tmux binary, checking common Homebrew paths
// that GUI apps don't have in their default PATH.
func findTmuxPath() string {
	// First try the simple case - tmux in PATH
	if path, err := exec.LookPath("tmux"); err == nil {
		return path
	}

	// GUI apps on macOS don't inherit shell PATH, so check common locations
	commonPaths := []string{
		"/opt/homebrew/bin/tmux", // Apple Silicon Homebrew
		"/usr/local/bin/tmux",    // Intel Homebrew
		"/usr/bin/tmux",          // System (unlikely)
	}

	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Fallback to bare "tmux" and hope for the best
	return "tmux"
}

// ensureTmuxRunning starts the tmux server if it isn't already running.
// This is called at app startup so that session listing works immediately.
// If tmux is already running, start-server is a no-op.
func ensureTmuxRunning() {
	cmd := exec.Command(tmuxBinaryPath, "start-server")
	if err := cmd.Run(); err != nil {
		log.Printf("warning: failed to start tmux server: %v", err)
	}
}

// maxConcurrentStatusChecks limits how many tmux capture-pane subprocesses run in parallel.
// This prevents spawning too many processes when polling many sessions.
const maxConcurrentStatusChecks = 8

// TmuxManager handles tmux session operations.
type TmuxManager struct {
	adapter *session.StorageAdapter // Unified storage layer with debounced writes
}

// NewTmuxManager creates a new TmuxManager.
// Returns an error if the storage adapter cannot be initialized, since the app
// cannot function properly without session persistence.
func NewTmuxManager() (*TmuxManager, error) {
	// Create storage adapter with 500ms debounce for status updates
	adapter, err := session.NewStorageAdapterWithProfile("", 500*time.Millisecond)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage adapter: %w", err)
	}
	return &TmuxManager{
		adapter: adapter,
	}, nil
}

// Close flushes any pending storage updates and releases resources.
// Call this during app shutdown to prevent data loss from unflushed debounced updates.
func (tm *TmuxManager) Close() {
	if tm.adapter != nil {
		tm.adapter.FlushPendingUpdates()
	}
}

// GetTmuxPath returns the path to the tmux binary.
func (tm *TmuxManager) GetTmuxPath() string {
	return tmuxBinaryPath
}

// generateSessionID creates a unique session ID matching the TUI format: {8-char-hex}-{unix-timestamp}
func generateSessionID() string {
	bytes := make([]byte, 4) // 4 bytes = 8 hex chars
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp if random fails
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%s-%d", hex.EncodeToString(bytes), time.Now().Unix())
}

// extractGroupPath derives a group path from a project directory path.
// Returns the parent directory name of the project (e.g., "/Users/jason/hc-repo/agent-deck" → "hc-repo").
// Falls back to "my-sessions" if no meaningful parent is found.
// This mirrors internal/session/instance.go:extractGroupPath but uses "my-sessions" directly
// (the TUI uses DefaultGroupName/"My Sessions" which then gets migrated to "my-sessions").
func extractGroupPath(projectPath string) string {
	parts := strings.Split(projectPath, "/")
	for i := len(parts) - 1; i >= 0; i-- {
		part := parts[i]
		if part != "" && part != "Users" && part != "home" && !strings.HasPrefix(part, ".") {
			if i > 0 && i == len(parts)-1 {
				parent := parts[i-1]
				if parent != "" && parent != "Users" && parent != "home" && !strings.HasPrefix(parent, ".") {
					return parent
				}
			}
			return part
		}
	}
	return "my-sessions"
}

// countSessionsAtPath returns the number of existing sessions at a given project path.
func (tm *TmuxManager) countSessionsAtPath(projectPath string) int {
	if tm.adapter == nil {
		return 0
	}

	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return 0
	}

	// Normalize the path for comparison
	normalizedPath := filepath.Clean(projectPath)

	count := 0
	for _, inst := range data.Instances {
		if filepath.Clean(inst.ProjectPath) == normalizedPath {
			count++
		}
	}
	return count
}

// PersistSession adds a new session to sessions.json.
func (tm *TmuxManager) PersistSession(s SessionInfo) error {
	if tm.adapter == nil {
		return fmt.Errorf("storage adapter not initialized")
	}

	// Flush any pending debounced updates to prevent race condition where
	// stale queued updates overwrite this immediate save.
	tm.adapter.FlushPendingUpdates()

	// Load current data
	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return fmt.Errorf("failed to load sessions: %w", err)
	}

	// Create new instance entry
	now := time.Now()
	// For remote sessions, the tmux session name is also the remote tmux name
	// (the desktop creates the tmux session on the remote host with this name).
	// The TUI uses RemoteTmuxName for discovery matching.
	remoteTmuxName := ""
	if s.IsRemote {
		remoteTmuxName = s.TmuxSession
	}

	newInstance := &session.InstanceData{
		ID:               s.ID,
		Title:            s.Title,
		CustomLabel:      s.CustomLabel,
		ProjectPath:      s.ProjectPath,
		GroupPath:        s.GroupPath,
		Tool:             s.Tool,
		Status:           session.Status(s.Status),
		TmuxSession:      s.TmuxSession,
		CreatedAt:        now,
		LastAccessedAt:   now,
		RemoteHost:       s.RemoteHost,
		RemoteTmuxName:   remoteTmuxName,
		LaunchConfigName: s.LaunchConfigName,
		LoadedMCPNames:   s.LoadedMCPs,
		DangerousMode:    s.DangerousMode,
	}

	// Append and save
	data.Instances = append(data.Instances, newInstance)
	return tm.adapter.SaveStorageData(data)
}

// detectSessionStatus captures tmux pane content and detects the actual status.
// Returns the detected status ("running", "waiting", "idle", "error") and whether detection succeeded.
func (tm *TmuxManager) detectSessionStatus(tmuxSession, tool string) (string, bool) {
	// Capture pane content (last 50 lines should be enough for detection)
	cmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession, "-p", "-S", "-50")
	output, err := cmd.Output()
	if err != nil {
		return "", false
	}

	content := string(output)
	if content == "" {
		return "idle", true
	}

	contentLower := strings.ToLower(content)

	// ═══════════════════════════════════════════════════════════════════════
	// PRIORITY 1: BUSY indicators - Check these FIRST
	// If busy, session is definitely "running" regardless of prompt state
	// ═══════════════════════════════════════════════════════════════════════

	// Check for explicit interrupt messages (most reliable)
	busyIndicators := []string{
		"ctrl+c to interrupt",
		"esc to interrupt",
	}
	for _, indicator := range busyIndicators {
		if strings.Contains(contentLower, indicator) {
			return "running", true
		}
	}

	// Check for spinner characters in last 25 lines (indicates active processing)
	// These are the exact braille spinner chars from cli-spinners "dots"
	// Used by Claude Code for "Thinking...", "Flummoxing...", "Running...", etc.
	spinnerChars := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
	lines := strings.Split(content, "\n")
	lastLines := lines
	if len(lastLines) > 25 {
		lastLines = lastLines[len(lastLines)-25:]
	}
	for _, line := range lastLines {
		for _, spinner := range spinnerChars {
			if strings.Contains(line, spinner) {
				return "running", true
			}
		}
	}

	// Check for timing indicators with "tokens" (indicates active processing)
	// Format: "Thinking… (45s · 1234 tokens · ...)" or "Flummoxing... (5m 53s · ↓ 5.0k tokens · ...)"
	if strings.Contains(contentLower, "tokens") {
		// Has tokens count - check if it's a processing indicator
		if strings.Contains(contentLower, "thinking") ||
			strings.Contains(contentLower, "connecting") ||
			strings.Contains(contentLower, "flummoxing") ||
			strings.Contains(contentLower, "running") {
			return "running", true
		}
	}

	// ═══════════════════════════════════════════════════════════════════════
	// PRIORITY 2: WAITING detection - Use prompt detector to check if at prompt
	// If prompt is present, session is healthy and waiting for input
	// ═══════════════════════════════════════════════════════════════════════
	detector := tmux.NewPromptDetector(tool)
	if detector.HasPrompt(content) {
		return "waiting", true
	}

	// ═══════════════════════════════════════════════════════════════════════
	// PRIORITY 3: ERROR detection - Only check if session appears stuck
	// Check LAST 10 non-empty lines only - real startup failures appear at bottom
	// Don't scan scrollback - avoids false positives from discussed errors
	// ═══════════════════════════════════════════════════════════════════════

	// Extract last 10 non-empty lines for error checking
	// Filter out blank lines to handle tmux padding
	var nonEmptyLines []string
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			nonEmptyLines = append(nonEmptyLines, line)
		}
	}

	errorCheckLines := nonEmptyLines
	if len(errorCheckLines) > 10 {
		errorCheckLines = errorCheckLines[len(errorCheckLines)-10:]
	}
	recentContent := strings.Join(errorCheckLines, "\n")
	recentLower := strings.ToLower(recentContent)

	// Check for SSH/connection error patterns
	errorPatterns := []string{
		"failed to start terminal",
		"failed to restart remote session",
		"failed to create remote tmux session",
		"ssh connection failed",
		"could not resolve hostname",
		"connection refused",
		"permission denied (publickey",
		"no route to host",
		"network is unreachable",
		"operation timed out",
		"host key verification failed",
	}
	for _, pattern := range errorPatterns {
		if strings.Contains(recentLower, pattern) {
			return "error", true
		}
	}

	// Default to idle if we can't determine
	return "idle", true
}

// detectSessionStatusViaFile checks Claude/Gemini session file modification time.
// Returns status and whether file-based detection succeeded.
//
// Claude Code writes progress events every 1 second during tool execution,
// making file mtime a reliable "running" indicator.
//
// The fileBasedEnabled parameter should be pre-checked by the caller to avoid
// creating a new DesktopSettingsManager for each session during parallel detection.
//
// TODO: Enable file-based detection in TUI app (internal/tmux/tmux.go) as well
func (tm *TmuxManager) detectSessionStatusViaFile(inst *session.InstanceData, fileBasedEnabled bool) (string, bool) {
	if !fileBasedEnabled {
		return "", false
	}

	// Only supported for Claude and Gemini (local sessions only)
	if inst.Tool != "claude" && inst.Tool != "gemini" {
		return "", false
	}

	// Skip remote sessions - file-based detection only works locally
	if inst.RemoteHost != "" {
		return "", false
	}

	var filePath string

	// Lazy discovery: if ClaudeSessionID is empty, try to discover it from Claude's files
	if inst.Tool == "claude" && inst.ClaudeSessionID == "" && inst.ProjectPath != "" {
		if discoveredID, err := session.GetClaudeSessionID(inst.ProjectPath); err == nil && discoveredID != "" {
			inst.ClaudeSessionID = discoveredID
			// Persist the discovered ID so future checks don't need to rediscover
			if tm.adapter != nil {
				tm.adapter.ScheduleUpdate(inst.ID, session.FieldUpdate{ClaudeSessionID: &discoveredID})
			}
		}
	}

	if inst.Tool == "claude" && inst.ClaudeSessionID != "" {
		filePath = tm.getClaudeJSONLPath(inst)
	} else if inst.Tool == "gemini" && inst.GeminiSessionID != "" {
		filePath = tm.getGeminiSessionPath(inst)
	}

	if filePath == "" {
		return "", false
	}

	stat, err := os.Stat(filePath)
	if err != nil {
		return "", false
	}

	// If modified within last 90 seconds, agent is actively working.
	// Claude writes progress events every 1 second during tool execution,
	// but during extended thinking (API calls, reasoning) it may not write
	// for 2-3 minutes. 90 seconds provides a reasonable buffer.
	if time.Since(stat.ModTime()) < 90*time.Second {
		return "running", true
	}

	return "", false // Fall back to visual detection
}

// getClaudeJSONLPath returns the path to Claude's session JSONL file.
// Uses the same logic as internal/session/instance.go:GetJSONLPath()
func (tm *TmuxManager) getClaudeJSONLPath(inst *session.InstanceData) string {
	if inst.ClaudeSessionID == "" {
		return ""
	}

	configDir := session.GetClaudeConfigDir()

	// Resolve symlinks in project path
	resolvedPath := inst.ProjectPath
	if resolved, err := filepath.EvalSymlinks(inst.ProjectPath); err == nil {
		resolvedPath = resolved
	}

	// Convert to Claude's directory format (non-alphanumeric → hyphens)
	projectDirName := session.ConvertToClaudeDirName(resolvedPath)
	sessionFile := filepath.Join(configDir, "projects", projectDirName, inst.ClaudeSessionID+".jsonl")

	if _, err := os.Stat(sessionFile); os.IsNotExist(err) {
		return ""
	}
	return sessionFile
}

// getGeminiSessionPath returns the path to Gemini's session JSON file.
func (tm *TmuxManager) getGeminiSessionPath(inst *session.InstanceData) string {
	// Length check to prevent panic on short session IDs
	if inst.GeminiSessionID == "" || len(inst.GeminiSessionID) < 8 || inst.ProjectPath == "" {
		return ""
	}

	home, _ := os.UserHomeDir()

	// Gemini uses SHA256 hash of project path
	hash := sha256.Sum256([]byte(inst.ProjectPath))
	projectHash := hex.EncodeToString(hash[:])

	// Find most recent session file matching the session ID
	// Gemini session files are named: session-{timestamp}-{sessionID}.json
	pattern := filepath.Join(home, ".gemini", "tmp", projectHash, "chats", "session-*-"+inst.GeminiSessionID[:8]+"*.json")
	matches, _ := filepath.Glob(pattern)

	if len(matches) == 0 {
		return ""
	}

	// Return most recently modified
	var newest string
	var newestTime time.Time
	for _, m := range matches {
		if info, err := os.Stat(m); err == nil && info.ModTime().After(newestTime) {
			newestTime = info.ModTime()
			newest = m
		}
	}
	return newest
}

// updateWaitingSinceTracking adjusts waitingSince based on status transitions.
// Sets waitingSince to now if status is "waiting" or "idle" and timestamp is missing.
// Only clears waitingSince when session becomes "running" (activity detected).
// This preserves the timestamp for "idle" sessions so the frontend can show elapsed wait time
// (e.g., "ready 5m" → "ready 1h" → "idle 4h" progression).
// Updates the updates map for persistence and returns the effective waitingSince.
func updateWaitingSinceTracking(instID string, status string, currentWaitingSince time.Time, updates map[string]session.FieldUpdate) time.Time {
	waitingSince := currentWaitingSince

	// Set waitingSince if session is waiting/idle and timestamp is missing.
	// Both "waiting" and "idle" represent inactive states where we want to track
	// how long the session has been waiting for user input.
	if (status == "waiting" || status == "idle") && waitingSince.IsZero() {
		waitingSince = time.Now()
		if u, ok := updates[instID]; ok {
			u.WaitingSince = &waitingSince
			updates[instID] = u
		} else {
			updates[instID] = session.FieldUpdate{WaitingSince: &waitingSince}
		}
	}

	// Only clear waitingSince when session becomes "running" (activity detected).
	// Don't clear for "idle" - the frontend uses waitingSince to show elapsed time
	// progression (ready 1m → ready 5m → ready 1h → idle 4h).
	if status == "running" && !currentWaitingSince.IsZero() {
		waitingSince = time.Time{}
		if u, ok := updates[instID]; ok {
			u.ClearWaitingSince = true
			updates[instID] = u
		} else {
			updates[instID] = session.FieldUpdate{ClearWaitingSince: true}
		}
	}

	return waitingSince
}

// convertInstancesToSessionInfos converts raw instance data to SessionInfo slice.
// Includes all sessions, marking local ones without running tmux as "exited".
// Detects actual status from pane content (in parallel) and updates waitingSince timestamps.
// Sorts by LastAccessedAt.
func (tm *TmuxManager) convertInstancesToSessionInfos(instances []*session.InstanceData) []SessionInfo {
	runningTmux := tm.getRunningTmuxSessions()

	// Load SSH host configs for display name lookup
	sshHosts := session.GetAvailableSSHHosts()

	// Phase 1: Collect local sessions that need status detection
	var sessionsToDetect []sessionToDetect
	for _, inst := range instances {
		_, exists := runningTmux[inst.TmuxSession]
		isRemote := inst.RemoteHost != ""
		if !isRemote && exists {
			sessionsToDetect = append(sessionsToDetect, sessionToDetect{
				tmuxSession: inst.TmuxSession,
				tool:        inst.Tool,
				instance:    inst, // For file-based activity detection
			})
		}
	}

	// Phase 2: Detect statuses in parallel (bounded concurrency)
	detectedResults := tm.detectStatusesParallel(sessionsToDetect)

	// Phase 3: Build result with detected statuses
	result := make([]SessionInfo, 0, len(instances))
	updates := make(map[string]session.FieldUpdate) // Track updates to persist

	for _, inst := range instances {
		// Check if tmux session actually exists (for local sessions)
		_, exists := runningTmux[inst.TmuxSession]
		isRemote := inst.RemoteHost != ""

		// Determine effective status
		status := string(inst.Status)
		waitingSince := inst.WaitingSince

		if !isRemote && !exists {
			// Local session without running tmux is "exited"
			status = "exited"
			// Persist the exited status to storage if it changed
			if string(inst.Status) != "exited" {
				updates[inst.ID] = session.FieldUpdate{Status: &status}
			}
		} else if !isRemote && exists {
			// Use pre-detected status from parallel detection
			if detected, ok := detectedResults[inst.TmuxSession]; ok {
				if detected.status != string(inst.Status) {
					status = detected.status
					updates[inst.ID] = session.FieldUpdate{Status: &detected.status}
				} else {
					status = detected.status
				}
			}
		}

		// Track waitingSince transitions (sets when entering waiting, clears when leaving)
		waitingSince = updateWaitingSinceTracking(inst.ID, status, waitingSince, updates)

		// Get git info for the project path (only for local sessions with running tmux)
		// Skip git info for exited sessions (no point checking)
		var gitInfo GitInfo
		if !isRemote && exists {
			gitInfo = tm.getGitInfo(inst.ProjectPath)
		}

		// Get display name for remote host (uses group_name from config if set)
		var remoteHostDisplayName string
		if isRemote && inst.RemoteHost != "" {
			if hostDef, ok := sshHosts[inst.RemoteHost]; ok {
				remoteHostDisplayName = hostDef.GetGroupName(inst.RemoteHost)
			} else {
				remoteHostDisplayName = inst.RemoteHost // Fallback to host ID
			}
		}

		// Use LastAccessedAt if set, otherwise fall back to CreatedAt
		lastAccessed := inst.LastAccessedAt
		if lastAccessed.IsZero() {
			lastAccessed = inst.CreatedAt
		}

		// Normalize empty group paths for existing sessions.
		// Sessions created by older versions or the TUI may have empty group_path.
		groupPath := inst.GroupPath
		if groupPath == "" {
			if inst.ProjectPath != "" {
				groupPath = extractGroupPath(inst.ProjectPath)
			} else {
				groupPath = "my-sessions"
			}
		}

		result = append(result, SessionInfo{
			ID:                    inst.ID,
			Title:                 inst.Title,
			CustomLabel:           inst.CustomLabel,
			ProjectPath:           inst.ProjectPath,
			GroupPath:             groupPath,
			Tool:                  inst.Tool,
			Status:                status,
			TmuxSession:           inst.TmuxSession,
			IsRemote:              isRemote,
			RemoteHost:            inst.RemoteHost,
			RemoteHostDisplayName: remoteHostDisplayName,
			GitBranch:             gitInfo.Branch,
			IsWorktree:            gitInfo.IsWorktree,
			GitDirty:              gitInfo.IsDirty,
			GitAhead:              gitInfo.Ahead,
			GitBehind:             gitInfo.Behind,
			LastAccessedAt:        lastAccessed,
			WaitingSince:          waitingSince,
			LaunchConfigName:      inst.LaunchConfigName,
			LoadedMCPs:            inst.LoadedMCPNames,
			DangerousMode:         inst.DangerousMode,
		})
	}

	// Persist any status/timestamp updates via debounced scheduler (don't block UI)
	if len(updates) > 0 && tm.adapter != nil {
		for id, update := range updates {
			tm.adapter.ScheduleUpdate(id, update)
		}
	}

	// Sort by LastAccessedAt (most recent first)
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastAccessedAt.After(result[j].LastAccessedAt)
	})

	return result
}

// sessionToDetect identifies a session for status detection.
type sessionToDetect struct {
	tmuxSession string
	tool        string
	instance    *session.InstanceData // For file-based activity detection
}

// detectionResult holds the result of status detection for a session.
type detectionResult struct {
	status     string
	contextPct *int // Claude context usage percentage (nil if not available/applicable)
}

// detectStatusesParallel detects status for multiple sessions in parallel.
// Uses a bounded worker pool to limit concurrent tmux subprocess spawning.
// Tries file-based detection first (for Claude/Gemini), falling back to visual detection.
// Also extracts context percentage for Claude sessions.
func (tm *TmuxManager) detectStatusesParallel(sessions []sessionToDetect) map[string]detectionResult {
	if len(sessions) == 0 {
		return nil
	}

	// Check file-based detection setting once for all sessions (not per-session)
	// This avoids creating a new DesktopSettingsManager inside the worker loop
	dsm := NewDesktopSettingsManager()
	fileBasedEnabled, _ := dsm.GetFileBasedActivityDetection()

	results := make(map[string]detectionResult)
	resultsMu := sync.Mutex{}

	// Use a semaphore (buffered channel) to limit concurrency
	sem := make(chan struct{}, maxConcurrentStatusChecks)
	var wg sync.WaitGroup

	for _, sess := range sessions {
		wg.Add(1)
		go func(s sessionToDetect, fileEnabled bool) {
			defer wg.Done()

			// Acquire semaphore slot
			sem <- struct{}{}
			defer func() { <-sem }()

			var result detectionResult

			// Try file-based detection first (for Claude/Gemini)
			if s.instance != nil {
				if status, ok := tm.detectSessionStatusViaFile(s.instance, fileEnabled); ok {
					result.status = status
					// For Claude sessions, we still need pane content for context percentage
					// even if file-based status detection succeeded
					if s.tool == "claude" {
						result.contextPct = tm.extractContextPctFromPane(s.tmuxSession)
					}
					resultsMu.Lock()
					results[s.tmuxSession] = result
					resultsMu.Unlock()
					return
				}
			}

			// Fall back to visual detection (terminal output parsing)
			status, ok := tm.detectSessionStatus(s.tmuxSession, s.tool)
			if ok {
				result.status = status
				// For Claude sessions, extract context percentage from pane content
				if s.tool == "claude" {
					result.contextPct = tm.extractContextPctFromPane(s.tmuxSession)
				}
				resultsMu.Lock()
				results[s.tmuxSession] = result
				resultsMu.Unlock()
			}
		}(sess, fileBasedEnabled)
	}

	wg.Wait()
	return results
}

// extractContextPctFromPane captures tmux pane content and extracts Claude's context percentage.
// Returns nil if not found or on error.
func (tm *TmuxManager) extractContextPctFromPane(tmuxSession string) *int {
	// Capture pane content (last 50 lines should include status bar)
	cmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession, "-p", "-S", "-50")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	return tmux.ExtractContextPercent(string(output))
}

// ListSessions returns all Agent Deck sessions from sessions.json.
func (tm *TmuxManager) ListSessions() ([]SessionInfo, error) {
	if tm.adapter == nil {
		return nil, fmt.Errorf("storage adapter not initialized")
	}

	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return nil, err
	}

	return tm.convertInstancesToSessionInfos(data.Instances), nil
}

// ListSessionsWithGroups returns sessions along with group information for hierarchical display.
func (tm *TmuxManager) ListSessionsWithGroups() (SessionsWithGroups, error) {
	if tm.adapter == nil {
		return SessionsWithGroups{}, fmt.Errorf("storage adapter not initialized")
	}

	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return SessionsWithGroups{}, err
	}

	// Convert instances to SessionInfo using shared helper
	sessions := tm.convertInstancesToSessionInfos(data.Instances)

	// Build group info from stored groups
	groups := make([]GroupInfo, 0, len(data.Groups))
	groupSessionCounts := make(map[string]int) // path -> direct session count

	// Count direct sessions per group
	for _, sess := range sessions {
		groupPath := sess.GroupPath
		if groupPath == "" {
			groupPath = "my-sessions" // Default group
		}
		groupSessionCounts[groupPath]++
	}

	// Process each group
	for _, g := range data.Groups {
		// Calculate level from path (count slashes)
		level := strings.Count(g.Path, "/")

		// Check if this group has subgroups
		hasChildren := false
		for _, otherG := range data.Groups {
			if strings.HasPrefix(otherG.Path, g.Path+"/") {
				hasChildren = true
				break
			}
		}

		// Calculate total count (including subgroups)
		totalCount := 0
		for path, count := range groupSessionCounts {
			if path == g.Path || strings.HasPrefix(path, g.Path+"/") {
				totalCount += count
			}
		}

		// Check if this group corresponds to a remote SSH host
		remoteHostID, _ := session.GetSSHHostIDFromGroupPath(g.Path)

		groups = append(groups, GroupInfo{
			Name:         g.Name,
			Path:         g.Path,
			SessionCount: groupSessionCounts[g.Path],
			TotalCount:   totalCount,
			Level:        level,
			HasChildren:  hasChildren,
			Expanded:     g.Expanded,
			RemoteHostID: remoteHostID,
		})
	}

	// Sort groups by order
	sort.Slice(groups, func(i, j int) bool {
		// First by order, then by path for deterministic ordering
		if groups[i].Level != groups[j].Level {
			// Parents before children
			pathI := groups[i].Path
			pathJ := groups[j].Path
			if strings.HasPrefix(pathJ, pathI+"/") {
				return true
			}
			if strings.HasPrefix(pathI, pathJ+"/") {
				return false
			}
		}
		return groups[i].Path < groups[j].Path
	})

	// If there are sessions without groups and no "my-sessions" group exists, add it
	if count, exists := groupSessionCounts["my-sessions"]; exists && count > 0 {
		hasMySessionsGroup := false
		for _, g := range groups {
			if g.Path == "my-sessions" {
				hasMySessionsGroup = true
				break
			}
		}
		if !hasMySessionsGroup {
			groups = append([]GroupInfo{{
				Name:         "My Sessions",
				Path:         "my-sessions",
				SessionCount: count,
				TotalCount:   count,
				Level:        0,
				HasChildren:  false,
				Expanded:     true,
			}}, groups...)
		}
	}

	return SessionsWithGroups{Sessions: sessions, Groups: groups}, nil
}

// GitInfo contains git repository information for a session.
type GitInfo struct {
	Branch     string
	IsWorktree bool
	IsDirty    bool
	Ahead      int
	Behind     int
}

// getGitInfo returns comprehensive git information for a project path.
func (tm *TmuxManager) getGitInfo(projectPath string) GitInfo {
	info := GitInfo{}
	if projectPath == "" {
		return info
	}

	// Get git branch
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = projectPath
	output, err := cmd.Output()
	if err != nil {
		return info
	}
	info.Branch = strings.TrimSpace(string(output))

	// Check if worktree: .git is a file (worktree) vs directory (main clone)
	gitPath := filepath.Join(projectPath, ".git")
	fileInfo, err := os.Stat(gitPath)
	if err == nil {
		info.IsWorktree = !fileInfo.IsDir()
	}

	// Check if dirty: git status --porcelain returns non-empty if there are changes
	statusCmd := exec.Command("git", "status", "--porcelain")
	statusCmd.Dir = projectPath
	statusOutput, err := statusCmd.Output()
	if err == nil {
		info.IsDirty = len(strings.TrimSpace(string(statusOutput))) > 0
	}

	// Get ahead/behind counts: git rev-list --left-right --count HEAD...@{u}
	// Returns "ahead\tbehind" or errors if no upstream
	aheadBehindCmd := exec.Command("git", "rev-list", "--left-right", "--count", "HEAD...@{u}")
	aheadBehindCmd.Dir = projectPath
	aheadBehindOutput, err := aheadBehindCmd.Output()
	if err == nil {
		parts := strings.Fields(strings.TrimSpace(string(aheadBehindOutput)))
		if len(parts) == 2 {
			fmt.Sscanf(parts[0], "%d", &info.Ahead)
			fmt.Sscanf(parts[1], "%d", &info.Behind)
		}
	}

	return info
}

// getRunningTmuxSessions returns a map of currently running tmux session names.
func (tm *TmuxManager) getRunningTmuxSessions() map[string]bool {
	result := make(map[string]bool)

	// Ensure tmux server is available before querying sessions.
	// This handles the case where tmux stopped after app launch (crash, manual kill).
	ensureTmuxRunning()

	// Run: tmux list-sessions -F "#{session_name}"
	// Use resolved tmux path for GUI app compatibility
	cmd := exec.Command(tmuxBinaryPath, "list-sessions", "-F", "#{session_name}")
	output, err := cmd.Output()
	if err != nil {
		// No sessions exist or tmux still unavailable
		return result
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line != "" {
			result[line] = true
		}
	}

	return result
}

// GetScrollback captures the scrollback buffer from a tmux session.
func (tm *TmuxManager) GetScrollback(tmuxSession string, lines int) (string, error) {
	if lines <= 0 {
		lines = 10000
	}

	// tmux capture-pane -t <session> -p -S -<lines>
	// -e preserves escape sequences (colors)
	// Use resolved tmux path for GUI app compatibility
	cmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession, "-p", "-e", "-S", fmt.Sprintf("-%d", lines))
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	// Convert LF to CRLF for xterm.js
	// tmux outputs \n line endings, but xterm.js interprets \n as "move down"
	// without returning to column 0. We need \r\n for proper rendering.
	content := string(output)
	content = strings.ReplaceAll(content, "\r\n", "\n") // Normalize any existing CRLF
	content = strings.ReplaceAll(content, "\n", "\r\n") // Convert all LF to CRLF

	return content, nil
}

// SessionExists checks if a tmux session exists.
func (tm *TmuxManager) SessionExists(tmuxSession string) bool {
	cmd := exec.Command(tmuxBinaryPath, "has-session", "-t", tmuxSession)
	return cmd.Run() == nil
}

// RemoteSessionExists checks if a tmux session exists on a remote host.
func (tm *TmuxManager) RemoteSessionExists(hostID, tmuxSession string, sshBridge *SSHBridge) bool {
	if sshBridge == nil {
		return false
	}
	tmuxPath := sshBridge.GetTmuxPath(hostID)
	cmd := fmt.Sprintf("%s has-session -t %q 2>/dev/null && echo yes || echo no", tmuxPath, tmuxSession)
	output, err := sshBridge.RunCommand(hostID, cmd)
	if err != nil {
		return false
	}
	return strings.TrimSpace(output) == "yes"
}

// RestartRemoteSession recreates a tmux session on a remote host for a session in error state.
// It creates the tmux session and sends the tool command to start it.
func (tm *TmuxManager) RestartRemoteSession(hostID, tmuxSession, projectPath, tool string, sshBridge *SSHBridge) error {
	if sshBridge == nil {
		return fmt.Errorf("SSH bridge not initialized")
	}

	tmuxPath := sshBridge.GetTmuxPath(hostID)

	// Create the tmux session on the remote host
	// Use -A flag to attach if exists, or create if not (avoids "duplicate session" error)
	createCmd := fmt.Sprintf("%s new-session -d -s %q -c %q 2>/dev/null || true", tmuxPath, tmuxSession, projectPath)
	if _, err := sshBridge.RunCommand(hostID, createCmd); err != nil {
		return fmt.Errorf("failed to create remote tmux session: %w", err)
	}

	// Send the tool command to start the session
	toolCmd := tool
	if toolCmd == "" || toolCmd == "shell" {
		// For shell sessions, just start a clean shell (no command needed, tmux starts bash/zsh by default)
		return nil
	}

	// For agent tools like claude, gemini, opencode - send the command
	escapedCmd := strings.ReplaceAll(toolCmd, "'", "'\\''")
	sendCmd := fmt.Sprintf("%s send-keys -t %q '%s' Enter", tmuxPath, tmuxSession, escapedCmd)
	if _, err := sshBridge.RunCommand(hostID, sendCmd); err != nil {
		// Non-fatal - session exists, just tool might not have started
		fmt.Printf("Warning: failed to send tool command to restarted session: %v\n", err)
	}

	return nil
}

// GetSessionMetadata retrieves runtime metadata for a tmux session.
// This includes hostname and current working directory from the tmux pane.
func (tm *TmuxManager) GetSessionMetadata(tmuxSession string) SessionMetadata {
	result := SessionMetadata{}

	// Get hostname
	hostnameBytes, err := exec.Command("hostname", "-s").Output()
	if err == nil {
		result.Hostname = strings.TrimSpace(string(hostnameBytes))
	}

	// Get current working directory from tmux pane
	// Use tmux display-message with pane_current_path format
	cwdBytes, err := exec.Command(tmuxBinaryPath, "display-message", "-t", tmuxSession, "-p", "#{pane_current_path}").Output()
	if err == nil {
		result.Cwd = strings.TrimSpace(string(cwdBytes))
	}

	// Get git branch for the current working directory
	if result.Cwd != "" {
		gitInfo := tm.getGitInfo(result.Cwd)
		result.GitBranch = gitInfo.Branch
	}

	return result
}

// toolCommandResult holds the result of building a tool command from a launch config.
type toolCommandResult struct {
	toolCmd          string
	cmdArgs          []string
	launchConfigName string
	loadedMCPs       []string
	dangerousMode    bool
}

// buildToolCommand constructs the tool command and arguments from a tool name and optional config key.
// If forRemote is true, MCP config paths with ~ are NOT expanded (let remote shell handle it).
// Returns the command parts needed to launch the AI tool.
func buildToolCommand(tool, configKey string, forRemote bool) toolCommandResult {
	result := toolCommandResult{}

	// Get base tool command
	switch tool {
	case "claude":
		result.toolCmd = "claude"
	case "gemini":
		result.toolCmd = "gemini"
	case "opencode":
		result.toolCmd = "opencode"
	default:
		result.toolCmd = tool // Allow custom tools
	}

	// Apply launch config if provided
	if configKey != "" {
		cfg := session.GetLaunchConfigByKey(configKey)
		if cfg != nil {
			result.launchConfigName = cfg.Name
			result.dangerousMode = cfg.DangerousMode

			// Add dangerous mode flag
			if cfg.DangerousMode {
				switch tool {
				case "claude":
					result.cmdArgs = append(result.cmdArgs, "--dangerously-skip-permissions")
				case "gemini":
					result.cmdArgs = append(result.cmdArgs, "--yolo")
				}
			}

			// Add MCP config path if specified
			if cfg.MCPConfigPath != "" {
				var mcpPath string
				if forRemote {
					// For remote sessions, don't expand ~ locally - the remote shell will handle it.
					// This ensures the path refers to the remote user's home directory.
					mcpPath = cfg.MCPConfigPath
				} else {
					// For local sessions, expand ~ to the local home directory.
					expandedPath, err := cfg.ExpandMCPConfigPath()
					if err == nil && expandedPath != "" {
						mcpPath = expandedPath
					}
				}
				if mcpPath != "" {
					switch tool {
					case "claude":
						result.cmdArgs = append(result.cmdArgs, "--mcp-config", mcpPath)
					}
					// Parse MCP names for display (uses local expansion for parsing)
					if mcpNames, err := cfg.ParseMCPNames(); err == nil {
						result.loadedMCPs = mcpNames
					}
				}
			}

			// Add extra args
			result.cmdArgs = append(result.cmdArgs, cfg.ExtraArgs...)
		}
	}

	return result
}

// sanitizeShellArg checks if an argument is safe for shell command construction.
// Returns an error if the argument contains shell metacharacters.
func sanitizeShellArg(arg string) error {
	if shellUnsafePattern.MatchString(arg) {
		return fmt.Errorf("argument contains unsafe shell characters: %q", arg)
	}
	return nil
}

// sanitizeShellArgs validates all arguments are safe for shell command construction.
// Returns an error if any argument contains shell metacharacters.
func sanitizeShellArgs(args []string) error {
	for _, arg := range args {
		if err := sanitizeShellArg(arg); err != nil {
			return err
		}
	}
	return nil
}

// CreateSession creates a new tmux session and launches an AI tool.
// If configKey is non-empty, the launch config settings will be applied.
// The session is persisted to sessions.json so it survives app restarts.
func (tm *TmuxManager) CreateSession(projectPath, title, tool, configKey string) (SessionInfo, error) {
	// Validate projectPath exists locally
	// This prevents silent fallback to home directory when path is from remote/docker
	if projectPath != "" {
		info, err := os.Stat(projectPath)
		if err != nil {
			if os.IsNotExist(err) {
				return SessionInfo{}, fmt.Errorf("project path does not exist: %s (this may be a remote path - use the remote session option)", projectPath)
			}
			return SessionInfo{}, fmt.Errorf("cannot access project path %s: %w", projectPath, err)
		}
		if !info.IsDir() {
			return SessionInfo{}, fmt.Errorf("project path is not a directory: %s", projectPath)
		}
	}

	// Generate unique session ID (matches TUI format: {8-char-hex}-{unix-timestamp})
	sessionID := generateSessionID()

	// Generate unique tmux session name
	sessionName := fmt.Sprintf("agentdeck_%d", time.Now().UnixNano())

	// Create tmux session
	cmd := exec.Command(tmuxBinaryPath, "new-session", "-d", "-s", sessionName, "-c", projectPath)
	if err := cmd.Run(); err != nil {
		return SessionInfo{}, fmt.Errorf("failed to create tmux session: %w", err)
	}

	// Build tool command with optional launch config settings
	tcr := buildToolCommand(tool, configKey, false /* forRemote */)

	// Build the full command string
	fullCmd := tcr.toolCmd
	if len(tcr.cmdArgs) > 0 {
		fullCmd = tcr.toolCmd + " " + strings.Join(tcr.cmdArgs, " ")
	}

	// Send the tool command to the session
	// Note: exec.Command handles argument escaping properly for local execution
	sendCmd := exec.Command(tmuxBinaryPath, "send-keys", "-t", sessionName, fullCmd, "Enter")
	if err := sendCmd.Run(); err != nil {
		// Don't fail if we can't send the command, the session is still usable
		fmt.Printf("Warning: failed to send tool command: %v\n", err)
	}

	// Count existing sessions at this path to auto-generate label for duplicates
	count := tm.countSessionsAtPath(projectPath)
	customLabel := ""
	if count > 0 {
		customLabel = fmt.Sprintf("#%d", count+1)
	}

	// Build session info
	sessionInfo := SessionInfo{
		ID:               sessionID, // Use proper ID, not tmux name
		Title:            title,
		CustomLabel:      customLabel,
		ProjectPath:      projectPath,
		GroupPath:        extractGroupPath(projectPath),
		Tool:             tool,
		Status:           "running",
		TmuxSession:      sessionName,
		LaunchConfigName: tcr.launchConfigName,
		LoadedMCPs:       tcr.loadedMCPs,
		DangerousMode:    tcr.dangerousMode,
		LastAccessedAt:   time.Now(),
	}

	// Persist to sessions.json so session survives app restarts
	if err := tm.PersistSession(sessionInfo); err != nil {
		// Log warning but don't fail - session is still usable
		fmt.Printf("Warning: failed to persist session: %v\n", err)
	}

	return sessionInfo, nil
}

// CreateRemoteSession creates a new tmux session on a remote host and launches an AI tool.
// The hostID should match a configured [ssh_hosts.X] section in config.toml.
// If configKey is non-empty, the launch config settings will be applied.
// The session is persisted to sessions.json so it survives app restarts.
func (tm *TmuxManager) CreateRemoteSession(hostID, projectPath, title, tool, configKey string, sshBridge *SSHBridge) (SessionInfo, error) {
	// Validate that the host is configured
	if !sshBridge.IsHostConfigured(hostID) {
		return SessionInfo{}, fmt.Errorf("SSH host %q is not configured in config.toml", hostID)
	}

	// Generate unique session ID (matches TUI format: {8-char-hex}-{unix-timestamp})
	sessionID := generateSessionID()

	// Generate unique tmux session name
	sessionName := fmt.Sprintf("agentdeck_%d", time.Now().UnixNano())

	// Get tmux path for remote host (may be non-standard on some servers)
	tmuxPath := sshBridge.GetTmuxPath(hostID)

	// Create tmux session on remote host
	createCmd := fmt.Sprintf("%s new-session -d -s %s -c %q", tmuxPath, sessionName, projectPath)
	if _, err := sshBridge.RunCommand(hostID, createCmd); err != nil {
		return SessionInfo{}, fmt.Errorf("failed to create remote tmux session: %w", err)
	}

	// Build tool command with optional launch config settings
	// forRemote=true: don't expand ~ locally, let remote shell handle it
	tcr := buildToolCommand(tool, configKey, true /* forRemote */)

	// Validate tool command and arguments are safe for shell command construction.
	// This prevents command injection via malicious tool names or ExtraArgs.
	if err := sanitizeShellArg(tcr.toolCmd); err != nil {
		// Clean up the remote tmux session we created
		killCmd := fmt.Sprintf("%s kill-session -t %s", tmuxPath, sessionName)
		_, _ = sshBridge.RunCommand(hostID, killCmd) // Best-effort cleanup
		return SessionInfo{}, fmt.Errorf("unsafe characters in tool command: %w", err)
	}
	if err := sanitizeShellArgs(tcr.cmdArgs); err != nil {
		// Clean up the remote tmux session we created
		killCmd := fmt.Sprintf("%s kill-session -t %s", tmuxPath, sessionName)
		_, _ = sshBridge.RunCommand(hostID, killCmd) // Best-effort cleanup
		return SessionInfo{}, fmt.Errorf("unsafe characters in launch config arguments: %w", err)
	}

	// Build the full command string
	fullCmd := tcr.toolCmd
	if len(tcr.cmdArgs) > 0 {
		fullCmd = tcr.toolCmd + " " + strings.Join(tcr.cmdArgs, " ")
	}

	// Send the tool command to the remote session
	// Escape single quotes in command for shell safety
	escapedCmd := strings.ReplaceAll(fullCmd, "'", "'\\''")
	sendCmd := fmt.Sprintf("%s send-keys -t %s '%s' Enter", tmuxPath, sessionName, escapedCmd)

	// Track whether the tool command was sent successfully
	toolCommandSent := true
	if _, err := sshBridge.RunCommand(hostID, sendCmd); err != nil {
		toolCommandSent = false
		fmt.Printf("Warning: failed to send tool command to remote session: %v\n", err)
	}

	// Count existing sessions at this path to auto-generate label for duplicates
	count := tm.countSessionsAtPath(projectPath)
	customLabel := ""
	if count > 0 {
		customLabel = fmt.Sprintf("#%d", count+1)
	}

	// Determine status based on whether tool command was sent
	status := "running"
	if !toolCommandSent {
		status = "idle" // Tool didn't start, session is just an empty shell
	}

	// Build proper hierarchical group path (e.g., "remote/Docker" instead of just "remote")
	rdSettings := session.GetRemoteDiscoverySettings()
	groupPrefix := rdSettings.GroupPrefix
	if groupPrefix == "" {
		groupPrefix = "remote"
	}
	sshHosts := session.GetAvailableSSHHosts()
	groupName := hostID
	if hostDef, ok := sshHosts[hostID]; ok {
		groupName = hostDef.GetGroupName(hostID)
	}
	groupPath := session.TransformRemoteGroupPath("", groupPrefix, groupName)

	// Build session info with remote fields set
	sessionInfo := SessionInfo{
		ID:                    sessionID,
		Title:                 title,
		CustomLabel:           customLabel,
		ProjectPath:           projectPath,
		GroupPath:             groupPath,
		Tool:                  tool,
		Status:                status,
		TmuxSession:           sessionName,
		IsRemote:              true,
		RemoteHost:            hostID,
		RemoteHostDisplayName: groupName,
		LaunchConfigName:      tcr.launchConfigName,
		LoadedMCPs:            tcr.loadedMCPs,
		DangerousMode:         tcr.dangerousMode,
		LastAccessedAt:        time.Now(),
	}

	// Persist to sessions.json so session survives app restarts
	if err := tm.PersistSession(sessionInfo); err != nil {
		// Log warning but don't fail - session is still usable
		fmt.Printf("Warning: failed to persist remote session: %v\n", err)
	}

	// Register the session on the remote host so its TUI/desktop app can see it
	// This calls `agent-deck register-session` on the remote machine
	tm.registerSessionOnRemote(hostID, sessionName, projectPath, tool, title, sshBridge)

	return sessionInfo, nil
}

// registerSessionOnRemote calls agent-deck register-session on the remote host
// to register the session in the remote machine's sessions.json.
// This is a best-effort operation - failures are logged but don't cause the
// session creation to fail.
func (tm *TmuxManager) registerSessionOnRemote(hostID, tmuxName, projectPath, tool, title string, sshBridge *SSHBridge) {
	if sshBridge == nil {
		return
	}

	// First check if agent-deck is installed on the remote host
	checkCmd := "which agent-deck 2>/dev/null || command -v agent-deck 2>/dev/null || echo ''"
	output, err := sshBridge.RunCommand(hostID, checkCmd)
	if err != nil || strings.TrimSpace(output) == "" {
		// agent-deck not installed on remote - this is expected for some hosts
		log.Printf("agent-deck not installed on remote host %s, skipping remote registration", hostID)
		return
	}

	// Build the register-session command
	// Escape arguments for shell safety
	escapedTmux := strings.ReplaceAll(tmuxName, "'", "'\\''")
	escapedPath := strings.ReplaceAll(projectPath, "'", "'\\''")
	escapedTool := strings.ReplaceAll(tool, "'", "'\\''")
	escapedTitle := strings.ReplaceAll(title, "'", "'\\''")

	registerCmd := fmt.Sprintf(
		"agent-deck register-session --tmux '%s' --path '%s' --tool '%s' --title '%s' --json --idempotent",
		escapedTmux, escapedPath, escapedTool, escapedTitle)

	output, err = sshBridge.RunCommand(hostID, registerCmd)
	if err != nil {
		log.Printf("Warning: failed to register session on remote host %s: %v", hostID, err)
		return
	}

	log.Printf("Registered session on remote host %s: %s", hostID, strings.TrimSpace(output))
}

// MarkSessionAccessed schedules a deferred update to the last_accessed_at timestamp.
// The update will be flushed within 500ms (debounce window).
// This keeps the session list sorted by most recently used.
func (tm *TmuxManager) MarkSessionAccessed(sessionID string) error {
	if tm.adapter == nil {
		return fmt.Errorf("storage adapter not initialized")
	}

	// Use debounced update for efficiency
	now := time.Now()
	tm.adapter.ScheduleUpdate(sessionID, session.FieldUpdate{LastAccessedAt: &now})
	return nil
}

// validSessionStatuses defines the set of status values that can be persisted.
var validSessionStatuses = map[string]bool{
	"running": true,
	"idle":    true,
	"waiting": true,
	"error":   true,
	"paused":  true,
	"exited":  true,
}

// UpdateSessionStatus updates the status field for a session in sessions.json.
// The TUI's StorageWatcher (fsnotify) will detect the write and reload.
func (tm *TmuxManager) UpdateSessionStatus(sessionID, status string) error {
	if tm.adapter == nil {
		return fmt.Errorf("storage adapter not initialized")
	}
	if !validSessionStatuses[status] {
		return fmt.Errorf("invalid session status: %q", status)
	}

	// Flush any pending debounced updates to prevent race condition where
	// stale queued updates overwrite this immediate save.
	tm.adapter.FlushPendingUpdates()

	// Use immediate update (not debounced) since status changes should be visible quickly
	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return err
	}

	found := false
	for _, inst := range data.Instances {
		if inst.ID == sessionID {
			inst.Status = session.Status(status)
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return tm.adapter.SaveStorageData(data)
}

// DeleteSession removes a session from sessions.json and kills its tmux session.
// If the session is remote, it will attempt to kill the tmux session via SSH.
func (tm *TmuxManager) DeleteSession(sessionID string, sshBridge *SSHBridge) error {
	if tm.adapter == nil {
		return fmt.Errorf("storage adapter not initialized")
	}

	// Flush any pending debounced updates to prevent race condition where
	// stale queued updates overwrite this immediate save.
	tm.adapter.FlushPendingUpdates()

	// Load current data
	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return fmt.Errorf("failed to load sessions: %w", err)
	}

	// Find the session and remove it
	found := false
	var tmuxSession string
	var remoteHost string
	newInstances := make([]*session.InstanceData, 0, len(data.Instances))
	for _, inst := range data.Instances {
		if inst.ID == sessionID {
			found = true
			tmuxSession = inst.TmuxSession
			remoteHost = inst.RemoteHost
			// Skip this session (don't add to newInstances)
			continue
		}
		newInstances = append(newInstances, inst)
	}

	if !found {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Kill the tmux session
	if tmuxSession != "" {
		if remoteHost != "" && sshBridge != nil {
			// Remote session - kill via SSH
			tmuxPath := sshBridge.GetTmuxPath(remoteHost)
			killCmd := fmt.Sprintf("%s kill-session -t %q 2>/dev/null || true", tmuxPath, tmuxSession)
			if _, err := sshBridge.RunCommand(remoteHost, killCmd); err != nil {
				// Log warning but continue - the session may already be dead
				fmt.Printf("Warning: failed to kill remote tmux session: %v\n", err)
			}
		} else {
			// Local session - kill directly
			cmd := exec.Command(tmuxBinaryPath, "kill-session", "-t", tmuxSession)
			if err := cmd.Run(); err != nil {
				// Log warning but continue - the session may already be dead
				fmt.Printf("Warning: failed to kill tmux session: %v\n", err)
			}
		}
	}

	// Save with the session removed
	data.Instances = newInstances
	return tm.adapter.SaveStorageData(data)
}

// UpdateSessionCustomLabel updates the custom_label field for a session.
// Pass an empty string to remove the custom label.
// For remote sessions, this also syncs the label to the remote host's storage.
func (tm *TmuxManager) UpdateSessionCustomLabel(sessionID, customLabel string) error {
	if tm.adapter == nil {
		return fmt.Errorf("storage adapter not initialized")
	}

	// Load storage to check if this is a remote session
	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return fmt.Errorf("failed to load storage data: %w", err)
	}

	// Find the session to check if it's remote
	var remoteHost, remoteTmuxName string
	for _, inst := range data.Instances {
		if inst.ID == sessionID {
			remoteHost = inst.RemoteHost
			remoteTmuxName = inst.RemoteTmuxName
			// Fallback to TmuxSession if RemoteTmuxName is not set (older sessions)
			if remoteTmuxName == "" {
				remoteTmuxName = inst.TmuxSession
			}
			break
		}
	}

	// If this is a remote session, sync the label to the remote host
	if remoteHost != "" && remoteTmuxName != "" {
		if err := session.UpdateRemoteSessionCustomLabel(remoteHost, remoteTmuxName, customLabel); err != nil {
			log.Printf("Warning: failed to sync custom label to remote host %s: %v", remoteHost, err)
			// Don't fail the whole operation - still update locally
		}
	}

	// Update local storage (debounced)
	tm.adapter.ScheduleUpdate(sessionID, session.FieldUpdate{CustomLabel: &customLabel})
	return nil
}

// StatusUpdate contains the status and timestamp updates for a session.
type StatusUpdate struct {
	ID           string    `json:"id"`
	Status       string    `json:"status"`
	WaitingSince time.Time `json:"waitingSince,omitempty"`
	ContextPct   *int      `json:"contextPct,omitempty"` // Claude context usage percentage (0-100), nil if not available
}

// RefreshSessionStatuses detects the current status for the specified session IDs.
// This is a lightweight operation that only checks tmux pane content - no git info.
// Uses parallel detection with bounded concurrency for performance.
// Returns status updates for each session. Sessions not found are omitted from result.
func (tm *TmuxManager) RefreshSessionStatuses(sessionIDs []string) ([]StatusUpdate, error) {
	if len(sessionIDs) == 0 {
		return nil, nil
	}
	if tm.adapter == nil {
		return nil, fmt.Errorf("storage adapter not initialized")
	}

	// Build lookup set for quick ID matching
	idSet := make(map[string]bool, len(sessionIDs))
	for _, id := range sessionIDs {
		idSet[id] = true
	}

	// Load current sessions data
	data, err := tm.adapter.LoadStorageData()
	if err != nil {
		return nil, err
	}

	// Get running tmux sessions (single subprocess call)
	runningTmux := tm.getRunningTmuxSessions()

	// Phase 1: Collect local sessions that need status detection
	var sessionsToDetect []sessionToDetect
	// Also build a map of instance data for quick lookup
	instanceMap := make(map[string]*session.InstanceData)
	for _, inst := range data.Instances {
		if !idSet[inst.ID] {
			continue
		}
		instanceMap[inst.ID] = inst
		_, exists := runningTmux[inst.TmuxSession]
		isRemote := inst.RemoteHost != ""
		if !isRemote && exists {
			sessionsToDetect = append(sessionsToDetect, sessionToDetect{
				tmuxSession: inst.TmuxSession,
				tool:        inst.Tool,
				instance:    inst, // For file-based activity detection
			})
		}
	}

	// Phase 2: Detect statuses in parallel (bounded concurrency)
	detectedResults := tm.detectStatusesParallel(sessionsToDetect)

	// Phase 3: Build result with detected statuses
	result := make([]StatusUpdate, 0, len(sessionIDs))
	updates := make(map[string]session.FieldUpdate) // Track changes to persist

	for _, id := range sessionIDs {
		inst, ok := instanceMap[id]
		if !ok {
			continue
		}

		_, exists := runningTmux[inst.TmuxSession]
		isRemote := inst.RemoteHost != ""

		// Determine effective status
		status := string(inst.Status)
		waitingSince := inst.WaitingSince
		var contextPct *int

		if !isRemote && !exists {
			// Local session without running tmux is "exited"
			status = "exited"
			// Persist the exited status to storage if it changed
			if string(inst.Status) != "exited" {
				updates[inst.ID] = session.FieldUpdate{Status: &status}
			}
		} else if !isRemote && exists {
			// Use pre-detected status from parallel detection
			if detected, ok := detectedResults[inst.TmuxSession]; ok {
				if detected.status != string(inst.Status) {
					status = detected.status
					updates[inst.ID] = session.FieldUpdate{Status: &detected.status}
				} else {
					status = detected.status
				}
				// Pass through context percentage for Claude sessions
				contextPct = detected.contextPct
			}
		}
		// For remote sessions, keep stored status (can't capture pane remotely)

		// Track waitingSince transitions (sets when entering waiting, clears when leaving)
		waitingSince = updateWaitingSinceTracking(inst.ID, status, waitingSince, updates)

		result = append(result, StatusUpdate{
			ID:           inst.ID,
			Status:       status,
			WaitingSince: waitingSince,
			ContextPct:   contextPct,
		})
	}

	// Persist updates via debounced scheduler (don't block the response)
	if len(updates) > 0 {
		for id, update := range updates {
			tm.adapter.ScheduleUpdate(id, update)
		}
	}

	return result, nil
}
