package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/asheshgoplani/agent-deck/internal/session"
)

// shellUnsafePattern matches characters that could cause shell injection.
// Used to validate arguments before building remote shell commands.
var shellUnsafePattern = regexp.MustCompile(`[;&|$` + "`" + `\\(){}[\]<>!*?#~]`)

// SessionInfo represents an Agent Deck session for the frontend.
type SessionInfo struct {
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	CustomLabel      string    `json:"customLabel,omitempty"`
	ProjectPath      string    `json:"projectPath"`
	GroupPath        string    `json:"groupPath"`
	Tool             string    `json:"tool"`
	Status           string    `json:"status"`
	TmuxSession      string    `json:"tmuxSession"`
	IsRemote         bool      `json:"isRemote"`
	RemoteHost       string    `json:"remoteHost,omitempty"`
	GitBranch        string    `json:"gitBranch,omitempty"`
	IsWorktree       bool      `json:"isWorktree,omitempty"`
	GitDirty         bool      `json:"gitDirty,omitempty"`
	GitAhead         int       `json:"gitAhead,omitempty"`
	GitBehind        int       `json:"gitBehind,omitempty"`
	LastAccessedAt   time.Time `json:"lastAccessedAt,omitempty"`
	LaunchConfigName string    `json:"launchConfigName,omitempty"`
	LoadedMCPs       []string  `json:"loadedMcps,omitempty"`
	DangerousMode    bool      `json:"dangerousMode,omitempty"`
}

// sessionsJSON mirrors the storage format from internal/session/storage.go
type sessionsJSON struct {
	Instances []instanceJSON `json:"instances"`
}

type instanceJSON struct {
	ID               string    `json:"id"`
	Title            string    `json:"title"`
	CustomLabel      string    `json:"custom_label,omitempty"`
	ProjectPath      string    `json:"project_path"`
	GroupPath        string    `json:"group_path"`
	Tool             string    `json:"tool"`
	Status           string    `json:"status"`
	TmuxSession      string    `json:"tmux_session"`
	CreatedAt        time.Time `json:"created_at"`
	LastAccessedAt   time.Time `json:"last_accessed_at,omitempty"`
	RemoteHost       string    `json:"remote_host,omitempty"`
	LaunchConfigName string    `json:"launch_config_name,omitempty"`
	LoadedMCPNames   []string  `json:"loaded_mcp_names,omitempty"`
	DangerousMode    bool      `json:"dangerous_mode,omitempty"`
}

// TmuxManager handles tmux session operations.
type TmuxManager struct{}

// NewTmuxManager creates a new TmuxManager.
func NewTmuxManager() *TmuxManager {
	return &TmuxManager{}
}

// getSessionsPath returns the path to sessions.json for the default profile.
func (tm *TmuxManager) getSessionsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".agent-deck", "profiles", "default", "sessions.json"), nil
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

// countSessionsAtPath returns the number of existing sessions at a given project path.
func (tm *TmuxManager) countSessionsAtPath(projectPath string) int {
	sessionsPath, err := tm.getSessionsPath()
	if err != nil {
		return 0
	}

	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		return 0
	}

	var sessions sessionsJSON
	if err := json.Unmarshal(data, &sessions); err != nil {
		return 0
	}

	// Normalize the path for comparison
	normalizedPath := filepath.Clean(projectPath)

	count := 0
	for _, inst := range sessions.Instances {
		if filepath.Clean(inst.ProjectPath) == normalizedPath {
			count++
		}
	}
	return count
}

// PersistSession adds a new session to sessions.json.
func (tm *TmuxManager) PersistSession(s SessionInfo) error {
	sessionsPath, err := tm.getSessionsPath()
	if err != nil {
		return err
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(sessionsPath), 0700); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}

	// Read current sessions (or create empty structure if file doesn't exist)
	var raw map[string]json.RawMessage
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Initialize empty structure
			raw = map[string]json.RawMessage{
				"instances":  json.RawMessage("[]"),
				"updated_at": json.RawMessage(`"` + time.Now().Format(time.RFC3339Nano) + `"`),
			}
		} else {
			return fmt.Errorf("failed to read sessions file: %w", err)
		}
	} else {
		if err := json.Unmarshal(data, &raw); err != nil {
			return fmt.Errorf("failed to parse sessions file: %w", err)
		}
	}

	// Parse instances array using typed struct
	var instances []instanceJSON
	if rawInstances, ok := raw["instances"]; ok {
		if err := json.Unmarshal(rawInstances, &instances); err != nil {
			return fmt.Errorf("failed to parse instances: %w", err)
		}
	}

	// Create new instance entry using typed struct (provides compile-time safety)
	now := time.Now()
	newInstance := instanceJSON{
		ID:               s.ID,
		Title:            s.Title,
		CustomLabel:      s.CustomLabel,
		ProjectPath:      s.ProjectPath,
		GroupPath:        s.GroupPath,
		Tool:             s.Tool,
		Status:           s.Status,
		TmuxSession:      s.TmuxSession,
		CreatedAt:        now,
		LastAccessedAt:   now,
		RemoteHost:       s.RemoteHost,
		LaunchConfigName: s.LaunchConfigName,
		LoadedMCPNames:   s.LoadedMCPs,
		DangerousMode:    s.DangerousMode,
	}

	// Append new instance
	instances = append(instances, newInstance)

	// Marshal instances back
	instancesData, err := json.Marshal(instances)
	if err != nil {
		return fmt.Errorf("failed to marshal instances: %w", err)
	}
	raw["instances"] = instancesData

	// Update timestamp
	updatedAt, _ := json.Marshal(now.Format(time.RFC3339Nano))
	raw["updated_at"] = updatedAt

	// Write back with indentation (atomic write via temp file)
	output, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	tmpPath := sessionsPath + ".tmp"
	if err := os.WriteFile(tmpPath, output, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tmpPath, sessionsPath); err != nil {
		os.Remove(tmpPath) // Clean up temp file on failure
		return fmt.Errorf("failed to finalize save: %w", err)
	}

	return nil
}

// ListSessions returns all Agent Deck sessions from sessions.json.
func (tm *TmuxManager) ListSessions() ([]SessionInfo, error) {
	sessionsPath, err := tm.getSessionsPath()
	if err != nil {
		return nil, err
	}

	// Read and parse sessions.json
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []SessionInfo{}, nil
		}
		return nil, err
	}

	var sessions sessionsJSON
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, err
	}

	// Get list of running tmux sessions
	runningTmux := tm.getRunningTmuxSessions()

	// Convert to SessionInfo
	result := make([]SessionInfo, 0, len(sessions.Instances))
	for _, inst := range sessions.Instances {
		// Check if tmux session actually exists (for local sessions)
		_, exists := runningTmux[inst.TmuxSession]
		isRemote := inst.RemoteHost != ""

		// Skip local sessions without a running tmux session
		// Remote sessions are included even without local tmux verification
		if !exists && !isRemote {
			continue
		}

		// Get git info for the project path (only for local sessions)
		var gitInfo GitInfo
		if !isRemote {
			gitInfo = tm.getGitInfo(inst.ProjectPath)
		}

		// Use LastAccessedAt if set, otherwise fall back to CreatedAt
		lastAccessed := inst.LastAccessedAt
		if lastAccessed.IsZero() {
			lastAccessed = inst.CreatedAt
		}

		result = append(result, SessionInfo{
			ID:               inst.ID,
			Title:            inst.Title,
			CustomLabel:      inst.CustomLabel,
			ProjectPath:      inst.ProjectPath,
			GroupPath:        inst.GroupPath,
			Tool:             inst.Tool,
			Status:           inst.Status,
			TmuxSession:      inst.TmuxSession,
			IsRemote:         isRemote,
			RemoteHost:       inst.RemoteHost,
			GitBranch:        gitInfo.Branch,
			IsWorktree:       gitInfo.IsWorktree,
			GitDirty:         gitInfo.IsDirty,
			GitAhead:         gitInfo.Ahead,
			GitBehind:        gitInfo.Behind,
			LastAccessedAt:   lastAccessed,
			LaunchConfigName: inst.LaunchConfigName,
			LoadedMCPs:       inst.LoadedMCPNames,
			DangerousMode:    inst.DangerousMode,
		})
	}

	// Sort by LastAccessedAt (most recent first)
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastAccessedAt.After(result[j].LastAccessedAt)
	})

	return result, nil
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

	// Run: tmux list-sessions -F "#{session_name}"
	cmd := exec.Command("tmux", "list-sessions", "-F", "#{session_name}")
	output, err := cmd.Output()
	if err != nil {
		// tmux might not be running or no sessions exist
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
	cmd := exec.Command("tmux", "capture-pane", "-t", tmuxSession, "-p", "-e", "-S", fmt.Sprintf("-%d", lines))
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
	cmd := exec.Command("tmux", "has-session", "-t", tmuxSession)
	return cmd.Run() == nil
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
	// Generate unique session ID (matches TUI format: {8-char-hex}-{unix-timestamp})
	sessionID := generateSessionID()

	// Generate unique tmux session name
	sessionName := fmt.Sprintf("agentdeck_%d", time.Now().UnixNano())

	// Create tmux session
	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, "-c", projectPath)
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
	sendCmd := exec.Command("tmux", "send-keys", "-t", sessionName, fullCmd, "Enter")
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

	// Validate arguments are safe for shell command construction.
	// This prevents command injection via malicious ExtraArgs.
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

	// Build session info with remote fields set
	sessionInfo := SessionInfo{
		ID:               sessionID,
		Title:            title,
		CustomLabel:      customLabel,
		ProjectPath:      projectPath,
		Tool:             tool,
		Status:           status,
		TmuxSession:      sessionName,
		IsRemote:         true,
		RemoteHost:       hostID,
		LaunchConfigName: tcr.launchConfigName,
		LoadedMCPs:       tcr.loadedMCPs,
		DangerousMode:    tcr.dangerousMode,
		LastAccessedAt:   time.Now(),
	}

	// Persist to sessions.json so session survives app restarts
	if err := tm.PersistSession(sessionInfo); err != nil {
		// Log warning but don't fail - session is still usable
		fmt.Printf("Warning: failed to persist remote session: %v\n", err)
	}

	return sessionInfo, nil
}

// MarkSessionAccessed updates the last_accessed_at timestamp for a session.
// This keeps the session list sorted by most recently used.
func (tm *TmuxManager) MarkSessionAccessed(sessionID string) error {
	sessionsPath, err := tm.getSessionsPath()
	if err != nil {
		return err
	}

	// Read current sessions
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		return err
	}

	// Parse as raw JSON to preserve all fields
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Parse instances array
	var instances []map[string]interface{}
	if err := json.Unmarshal(raw["instances"], &instances); err != nil {
		return err
	}

	// Find and update the session
	found := false
	for i, inst := range instances {
		if id, ok := inst["id"].(string); ok && id == sessionID {
			instances[i]["last_accessed_at"] = time.Now().Format(time.RFC3339Nano)
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Marshal instances back
	instancesData, err := json.Marshal(instances)
	if err != nil {
		return err
	}
	raw["instances"] = instancesData

	// Write back with indentation (atomic write via temp file)
	output, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := sessionsPath + ".tmp"
	if err := os.WriteFile(tmpPath, output, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tmpPath, sessionsPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to finalize save: %w", err)
	}

	return nil
}

// UpdateSessionCustomLabel updates the custom_label field for a session.
// Pass an empty string to remove the custom label.
func (tm *TmuxManager) UpdateSessionCustomLabel(sessionID, customLabel string) error {
	sessionsPath, err := tm.getSessionsPath()
	if err != nil {
		return err
	}

	// Read current sessions
	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		return err
	}

	// Parse as raw JSON to preserve all fields
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Parse instances array
	var instances []map[string]interface{}
	if err := json.Unmarshal(raw["instances"], &instances); err != nil {
		return err
	}

	// Find and update the session
	found := false
	for i, inst := range instances {
		if id, ok := inst["id"].(string); ok && id == sessionID {
			if customLabel == "" {
				// Remove the custom_label field
				delete(instances[i], "custom_label")
			} else {
				instances[i]["custom_label"] = customLabel
			}
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Marshal instances back
	instancesData, err := json.Marshal(instances)
	if err != nil {
		return err
	}
	raw["instances"] = instancesData

	// Write back with indentation (atomic write via temp file)
	output, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := sessionsPath + ".tmp"
	if err := os.WriteFile(tmpPath, output, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tmpPath, sessionsPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to finalize save: %w", err)
	}

	return nil
}
