package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Version is set at build time via ldflags.
var Version = "0.1.0-dev"

// App struct holds the application state.
type App struct {
	ctx              context.Context
	terminals        *TerminalManager // Manages multiple terminals for multi-pane support
	tmux             *TmuxManager
	projectDiscovery *ProjectDiscovery
	quickLaunch      *QuickLaunchManager
	launchConfig     *LaunchConfigManager
	desktopSettings  *DesktopSettingsManager
	savedLayouts     *SavedLayoutsManager
	tabState         *TabStateManager
	sshBridge        *SSHBridge
	windowNumber     int // 1 for primary window, 2+ for secondary windows
}

// NewApp creates a new App application struct.
// Returns an error if critical components (like storage) cannot be initialized.
func NewApp() (*App, error) {
	tmux, err := NewTmuxManager()
	if err != nil {
		return nil, fmt.Errorf("failed to initialize tmux manager: %w", err)
	}
	return &App{
		terminals:        NewTerminalManager(),
		tmux:             tmux,
		projectDiscovery: NewProjectDiscovery(),
		quickLaunch:      NewQuickLaunchManager(),
		launchConfig:     NewLaunchConfigManager(),
		desktopSettings:  NewDesktopSettingsManager(),
		savedLayouts:     NewSavedLayoutsManager(),
		tabState:         NewTabStateManager(),
		sshBridge:        NewSSHBridge(),
	}, nil
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Ensure tmux server is running so session listing and creation work immediately.
	// Without this, tmux list-sessions fails and all local sessions are hidden from the UI.
	ensureTmuxRunning()

	// Register this window and get assigned number
	windowNum, err := registerWindow()
	if err != nil {
		// Log error but continue with default (primary)
		windowNum = 1
	}
	a.windowNumber = windowNum

	a.terminals.SetContext(ctx)
	a.terminals.SetSSHBridge(a.sshBridge)
	// Store context for menu callbacks (paste, copy)
	SetAppContext(ctx)

	// Register file drop handler for drag-and-drop image support.
	// Wails provides native file paths on drop; we emit an event
	// to the frontend which determines the target terminal pane.
	wailsRuntime.OnFileDrop(a.ctx, func(x, y int, paths []string) {
		wailsRuntime.EventsEmit(a.ctx, "files:dropped", map[string]interface{}{
			"x":     x,
			"y":     y,
			"paths": paths,
		})
	})
}

// shutdown is called when the app is closing.
func (a *App) shutdown(ctx context.Context) {
	// Unregister this window from active windows
	unregisterWindow(a.windowNumber)

	// Flush pending storage updates to prevent data loss from debounced writes
	if a.tmux != nil {
		a.tmux.Close()
	}

	// Clean up SSH connections
	if a.sshBridge != nil {
		a.sshBridge.CloseAll()
	}
	a.terminals.CloseAll()
}

// GetVersion returns the application version.
func (a *App) GetVersion() string {
	return Version
}

// StartTerminal spawns the shell with initial dimensions for a session.
func (a *App) StartTerminal(sessionID string, cols, rows int) error {
	t := a.terminals.GetOrCreate(sessionID)
	return t.Start(cols, rows)
}

// WriteTerminal sends data to the PTY for a session.
func (a *App) WriteTerminal(sessionID, data string) error {
	t := a.terminals.Get(sessionID)
	if t == nil {
		return fmt.Errorf("terminal %s not found", sessionID)
	}
	return t.Write(data)
}

// ResizeTerminal changes the PTY dimensions for a session.
func (a *App) ResizeTerminal(sessionID string, cols, rows int) error {
	t := a.terminals.Get(sessionID)
	if t == nil {
		return fmt.Errorf("terminal %s not found", sessionID)
	}
	return t.Resize(cols, rows)
}

// CloseTerminal terminates the PTY for a session.
func (a *App) CloseTerminal(sessionID string) error {
	return a.terminals.Close(sessionID)
}

// ListSessions returns all Agent Deck sessions.
func (a *App) ListSessions() ([]SessionInfo, error) {
	return a.tmux.ListSessions()
}

// ListSessionsWithGroups returns sessions along with group information for hierarchical display.
func (a *App) ListSessionsWithGroups() (SessionsWithGroups, error) {
	return a.tmux.ListSessionsWithGroups()
}

// GetExpandedGroups returns the map of group paths to their expanded state.
// Desktop-specific overrides take precedence over TUI defaults.
func (a *App) GetExpandedGroups() (map[string]bool, error) {
	return a.desktopSettings.GetExpandedGroups()
}

// ToggleGroupExpanded toggles the expanded state for a group.
func (a *App) ToggleGroupExpanded(groupPath string, expanded bool) error {
	return a.desktopSettings.SetGroupExpanded(groupPath, expanded)
}

// ResetGroupSettings clears all desktop-specific group expand/collapse overrides.
// Groups will revert to using their TUI default expand states.
func (a *App) ResetGroupSettings() error {
	return a.desktopSettings.ResetGroupSettings()
}

// SetAllGroupsExpanded sets the expanded state for all provided group paths at once.
// This is more efficient than calling ToggleGroupExpanded multiple times.
func (a *App) SetAllGroupsExpanded(groupPaths []string, expanded bool) error {
	return a.desktopSettings.SetAllGroupsExpanded(groupPaths, expanded)
}

// AttachSession attaches to an existing tmux session (direct mode, no history preload).
// DEPRECATED: Use StartTmuxSession instead for the hybrid approach with scrollback support.
func (a *App) AttachSession(sessionID, tmuxSession string, cols, rows int) error {
	t := a.terminals.GetOrCreate(sessionID)
	return t.AttachTmux(tmuxSession, cols, rows)
}

// emitRunningStatus persists "running" status to sessions.json and emits
// an event so the frontend updates immediately. Used after successfully
// attaching to both local and remote tmux sessions.
func (a *App) emitRunningStatus(sessionID string) {
	if err := a.tmux.UpdateSessionStatus(sessionID, "running"); err != nil {
		fmt.Printf("Warning: failed to update session status: %v\n", err)
	}
	wailsRuntime.EventsEmit(a.ctx, "session:statusUpdate", map[string]string{
		"sessionId": sessionID,
		"status":    "running",
	})
}

// StartTmuxSession connects to a tmux session using the hybrid approach:
// 1. Fetches and emits sanitized history via terminal:history event
// 2. Attaches PTY for live streaming
//
// This is the preferred method for connecting to tmux sessions as it provides
// full scrollback history while maintaining real-time streaming.
// The sessionID is used to identify which pane/terminal this belongs to.
func (a *App) StartTmuxSession(sessionID, tmuxSession string, cols, rows int) error {
	t := a.terminals.GetOrCreate(sessionID)
	if err := t.StartTmuxSession(tmuxSession, cols, rows); err != nil {
		return err
	}

	a.emitRunningStatus(sessionID)
	return nil
}

// StartRemoteTmuxSession connects to a tmux session on a remote host via SSH.
// Uses SSH polling for display updates.
// If the remote tmux session doesn't exist (error state), it will be automatically restarted.
//
// Parameters:
//   - sessionID: identifier for this terminal pane
//   - hostID: SSH host identifier from config.toml [ssh_hosts.X]
//   - tmuxSession: tmux session name on the remote host
//   - projectPath: working directory for the session (used for restart)
//   - tool: tool type for the session (used for restart, e.g., "claude", "shell")
//   - cols, rows: initial terminal dimensions
func (a *App) StartRemoteTmuxSession(sessionID, hostID, tmuxSession, projectPath, tool string, cols, rows int) error {
	t := a.terminals.GetOrCreate(sessionID)
	if err := t.StartRemoteTmuxSession(hostID, tmuxSession, projectPath, tool, cols, rows, a.tmux, a.sshBridge); err != nil {
		return err
	}

	a.emitRunningStatus(sessionID)
	return nil
}

// GetScrollback returns the scrollback buffer for a tmux session.
func (a *App) GetScrollback(tmuxSession string) (string, error) {
	return a.tmux.GetScrollback(tmuxSession, 10000)
}

// RefreshScrollback fetches fresh scrollback from the tmux session for a given terminal.
// Called by frontend after resize to bypass xterm.js reflow issues with box-drawing chars.
func (a *App) RefreshScrollback(sessionID string) (string, error) {
	t := a.terminals.Get(sessionID)
	if t == nil {
		return "", nil
	}
	return t.GetScrollback()
}

// RefreshTerminalAfterResize re-emits full history to the frontend after a resize.
// This should be called by the frontend after clearing xterm to restore all content
// including scrollback history. It emits the content via terminal:history event.
func (a *App) RefreshTerminalAfterResize(sessionID string) error {
	t := a.terminals.Get(sessionID)
	if t == nil {
		return nil
	}
	return t.RefreshAfterResize()
}

// SessionExists checks if a tmux session exists.
func (a *App) SessionExists(tmuxSession string) bool {
	return a.tmux.SessionExists(tmuxSession)
}

// GetSessionMetadata returns runtime metadata for a tmux session.
func (a *App) GetSessionMetadata(tmuxSession string) SessionMetadata {
	return a.tmux.GetSessionMetadata(tmuxSession)
}

// DiscoverProjects finds all projects from configured paths and existing sessions.
func (a *App) DiscoverProjects() ([]ProjectInfo, error) {
	sessions, err := a.ListSessions()
	if err != nil {
		return nil, err
	}
	return a.projectDiscovery.DiscoverProjects(sessions)
}

// RecordProjectUsage records that a project was used (for frecency scoring).
func (a *App) RecordProjectUsage(projectPath string) error {
	return a.projectDiscovery.RecordUsage(projectPath)
}

// BrowseLocalDirectory opens a native directory picker dialog.
// Returns the selected directory path, or empty string if cancelled.
func (a *App) BrowseLocalDirectory(defaultDir string) (string, error) {
	if defaultDir == "" {
		defaultDir, _ = os.UserHomeDir()
	}
	return wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:                "Select Project Directory",
		DefaultDirectory:     defaultDir,
		CanCreateDirectories: false,
		ShowHiddenFiles:      false,
	})
}

// CreateSession creates a new tmux session and launches the specified AI tool.
// If configKey is provided, the launch config settings will be applied.
func (a *App) CreateSession(projectPath, title, tool, configKey string) (SessionInfo, error) {
	return a.tmux.CreateSession(projectPath, title, tool, configKey)
}

// GetQuickLaunchFavorites returns all quick launch favorites.
func (a *App) GetQuickLaunchFavorites() ([]QuickLaunchFavorite, error) {
	return a.quickLaunch.GetFavorites()
}

// AddQuickLaunchFavorite adds a project to quick launch.
func (a *App) AddQuickLaunchFavorite(name, path, tool string) error {
	return a.quickLaunch.AddFavorite(name, path, tool)
}

// RemoveQuickLaunchFavorite removes a project from quick launch.
func (a *App) RemoveQuickLaunchFavorite(path string) error {
	return a.quickLaunch.RemoveFavorite(path)
}

// UpdateQuickLaunchShortcut updates the keyboard shortcut for a favorite.
func (a *App) UpdateQuickLaunchShortcut(path, shortcut string) error {
	return a.quickLaunch.UpdateShortcut(path, shortcut)
}

// GetQuickLaunchBarVisibility returns whether the quick launch bar should be shown.
func (a *App) GetQuickLaunchBarVisibility() (bool, error) {
	return a.quickLaunch.GetBarVisibility()
}

// SetQuickLaunchBarVisibility sets whether the quick launch bar should be shown.
func (a *App) SetQuickLaunchBarVisibility(show bool) error {
	return a.quickLaunch.SetBarVisibility(show)
}

// UpdateQuickLaunchFavoriteName updates the display name for a favorite.
func (a *App) UpdateQuickLaunchFavoriteName(path, name string) error {
	return a.quickLaunch.UpdateFavoriteName(path, name)
}

// MarkSessionAccessed updates the last_accessed_at timestamp for a session.
// Call this when a user selects/opens a session to keep the list sorted by recency.
func (a *App) MarkSessionAccessed(sessionID string) error {
	return a.tmux.MarkSessionAccessed(sessionID)
}

// UpdateSessionStatus updates the status field for a session in sessions.json.
// Used by the terminal to persist status changes (e.g., "running" on successful attach).
func (a *App) UpdateSessionStatus(sessionID, status string) error {
	return a.tmux.UpdateSessionStatus(sessionID, status)
}

// UpdateSessionCustomLabel updates the custom label for a session.
// Pass an empty string to remove the custom label.
func (a *App) UpdateSessionCustomLabel(sessionID, customLabel string) error {
	return a.tmux.UpdateSessionCustomLabel(sessionID, customLabel)
}

// RefreshSessionStatuses returns the current status for the specified session IDs.
// This is a lightweight operation that only checks tmux pane content - no git info.
// Use this for periodic polling of open tab sessions instead of full ListSessions().
func (a *App) RefreshSessionStatuses(sessionIDs []string) ([]StatusUpdate, error) {
	return a.tmux.RefreshSessionStatuses(sessionIDs)
}

// DeleteSession removes a session from sessions.json and kills its tmux session.
// This syncs with the TUI via the shared sessions.json storage.
func (a *App) DeleteSession(sessionID string) error {
	return a.tmux.DeleteSession(sessionID, a.sshBridge)
}

// GetGitBranch returns the current git branch for a given directory.
// Returns empty string if not a git repository or on error.
func (a *App) GetGitBranch(projectPath string) string {
	projectPath = expandHome(projectPath)

	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = projectPath
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// IsGitWorktree returns true if the given path is a git worktree (not the main clone).
// Worktrees have a .git file pointing to the main repo, not a .git directory.
func (a *App) IsGitWorktree(projectPath string) bool {
	projectPath = expandHome(projectPath)

	// Check if .git is a file (worktree) vs directory (main clone)
	gitPath := filepath.Join(projectPath, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return false
	}
	// If .git is a file, it's a worktree (contains "gitdir: /path/to/main/.git/worktrees/...")
	return !info.IsDir()
}

// expandHome expands ~ to the user's home directory.
func expandHome(path string) string {
	if strings.HasPrefix(path, "~") {
		home, err := exec.Command("sh", "-c", "echo $HOME").Output()
		if err == nil {
			path = filepath.Join(strings.TrimSpace(string(home)), path[1:])
		}
	}
	return path
}

// GetProjectRoots returns the configured project scan paths.
// Used by the frontend to compute relative paths for display.
func (a *App) GetProjectRoots() []string {
	settings := a.projectDiscovery.getSettings()
	return settings.ScanPaths
}

// GetScanPaths returns raw scan paths with ~/ preserved for display in settings.
func (a *App) GetScanPaths() []string {
	return a.projectDiscovery.GetRawScanPaths()
}

// SetScanPaths writes scan paths to config.toml.
func (a *App) SetScanPaths(paths []string) error {
	return a.projectDiscovery.SetScanPaths(paths)
}

// AddScanPath appends a scan path (deduplicates).
func (a *App) AddScanPath(path string) error {
	return a.projectDiscovery.AddScanPath(path)
}

// RemoveScanPath removes a scan path by value.
func (a *App) RemoveScanPath(path string) error {
	return a.projectDiscovery.RemoveScanPath(path)
}

// GetScanMaxDepth returns the current max_depth setting for project scanning.
func (a *App) GetScanMaxDepth() int {
	return a.projectDiscovery.GetMaxDepth()
}

// SetScanMaxDepth saves the max_depth setting (clamped 1-5).
func (a *App) SetScanMaxDepth(depth int) error {
	return a.projectDiscovery.SetMaxDepth(depth)
}

// HasScanPaths returns whether any scan paths are configured.
func (a *App) HasScanPaths() bool {
	return a.projectDiscovery.HasScanPaths()
}

// GetSetupDismissed returns whether the first-launch setup was dismissed.
func (a *App) GetSetupDismissed() bool {
	dismissed, err := a.desktopSettings.GetSetupDismissed()
	if err != nil {
		return false
	}
	return dismissed
}

// SetSetupDismissed sets whether the first-launch setup was dismissed.
func (a *App) SetSetupDismissed(dismissed bool) error {
	return a.desktopSettings.SetSetupDismissed(dismissed)
}

// LogFrontendDiagnostic writes diagnostic info from frontend to the debug log file.
// This allows Claude to read diagnostic info that would otherwise only be in browser console.
func (a *App) LogFrontendDiagnostic(message string) {
	// LogDiagnostic writes directly to the debug log file and doesn't need a session
	LogDiagnostic(message)
}

// ==================== Launch Config Methods ====================

// GetLaunchConfigs returns all launch configurations.
func (a *App) GetLaunchConfigs() ([]LaunchConfigInfo, error) {
	return a.launchConfig.GetLaunchConfigs()
}

// GetLaunchConfigsForTool returns launch configs for a specific tool.
func (a *App) GetLaunchConfigsForTool(tool string) ([]LaunchConfigInfo, error) {
	return a.launchConfig.GetLaunchConfigsForTool(tool)
}

// GetLaunchConfig returns a single launch config by key.
func (a *App) GetLaunchConfig(key string) (*LaunchConfigInfo, error) {
	return a.launchConfig.GetLaunchConfig(key)
}

// GetDefaultLaunchConfig returns the default config for a tool, or nil if none set.
func (a *App) GetDefaultLaunchConfig(tool string) (*LaunchConfigInfo, error) {
	return a.launchConfig.GetDefaultLaunchConfig(tool)
}

// SaveLaunchConfig creates or updates a launch configuration.
func (a *App) SaveLaunchConfig(key, name, tool, description string, dangerousMode bool, mcpConfigPath string, extraArgs []string, isDefault bool) error {
	return a.launchConfig.SaveLaunchConfig(key, name, tool, description, dangerousMode, mcpConfigPath, extraArgs, isDefault)
}

// DeleteLaunchConfig removes a launch configuration.
func (a *App) DeleteLaunchConfig(key string) error {
	return a.launchConfig.DeleteLaunchConfig(key)
}

// ValidateMCPConfigPath validates an MCP config path and returns the MCP names.
func (a *App) ValidateMCPConfigPath(path string) ([]string, error) {
	return a.launchConfig.ValidateMCPConfigPath(path)
}

// GenerateConfigKey generates a unique config key from tool and name.
func (a *App) GenerateConfigKey(tool, name string) string {
	return a.launchConfig.GenerateConfigKey(tool, name)
}

// ==================== Desktop Settings Methods ====================

// GetDesktopTheme returns the current desktop theme preference.
// Returns "dark", "light", or "auto".
func (a *App) GetDesktopTheme() string {
	theme, err := a.desktopSettings.GetTheme()
	if err != nil {
		return "dark"
	}
	return theme
}

// SetDesktopTheme sets the desktop theme preference.
// Valid values: "dark", "light", "auto".
func (a *App) SetDesktopTheme(theme string) error {
	return a.desktopSettings.SetTheme(theme)
}

// GetSoftNewlineMode returns the current soft newline key preference.
// Returns: "shift_enter", "alt_enter", "both", or "disabled".
func (a *App) GetSoftNewlineMode() string {
	mode, err := a.desktopSettings.GetSoftNewline()
	if err != nil {
		return "both"
	}
	return mode
}

// SetSoftNewlineMode sets the soft newline key preference.
// Valid values: "shift_enter", "alt_enter", "both", "disabled".
func (a *App) SetSoftNewlineMode(mode string) error {
	return a.desktopSettings.SetSoftNewline(mode)
}

// GetTerminalSettings returns all terminal settings for the frontend.
func (a *App) GetTerminalSettings() map[string]interface{} {
	config, err := a.desktopSettings.GetTerminalConfig()
	if err != nil {
		return map[string]interface{}{
			"softNewline":      "both",
			"fontSize":         14,
			"clickToCursor":    false,
			"autoCopyOnSelect": false,
		}
	}
	return map[string]interface{}{
		"softNewline":      config.SoftNewline,
		"fontSize":         config.FontSize,
		"clickToCursor":    config.ClickToCursor,
		"autoCopyOnSelect": config.AutoCopyOnSelect,
	}
}

// GetFontSize returns the terminal font size (8-32, default 14).
func (a *App) GetFontSize() int {
	size, err := a.desktopSettings.GetFontSize()
	if err != nil {
		return 14
	}
	return size
}

// SetFontSize sets the terminal font size (clamped to 8-32).
func (a *App) SetFontSize(size int) error {
	return a.desktopSettings.SetFontSize(size)
}

// GetScrollSpeed returns the terminal scroll speed percentage (50-250, default 100).
func (a *App) GetScrollSpeed() int {
	speed, err := a.desktopSettings.GetScrollSpeed()
	if err != nil {
		return 100
	}
	return speed
}

// SetScrollSpeed sets the terminal scroll speed percentage (clamped to 50-250).
func (a *App) SetScrollSpeed(speed int) error {
	return a.desktopSettings.SetScrollSpeed(speed)
}

// GetClickToCursorEnabled returns whether click-to-cursor is enabled.
// This is an experimental feature for positioning cursor in nano/vim via clicks.
func (a *App) GetClickToCursorEnabled() bool {
	enabled, err := a.desktopSettings.GetClickToCursor()
	if err != nil {
		return false
	}
	return enabled
}

// SetClickToCursorEnabled enables or disables the click-to-cursor feature.
func (a *App) SetClickToCursorEnabled(enabled bool) error {
	return a.desktopSettings.SetClickToCursor(enabled)
}

// GetAutoCopyOnSelectEnabled returns whether auto-copy on select is enabled.
// When enabled, selected text is automatically copied to clipboard.
func (a *App) GetAutoCopyOnSelectEnabled() bool {
	enabled, err := a.desktopSettings.GetAutoCopyOnSelect()
	if err != nil {
		return false
	}
	return enabled
}

// SetAutoCopyOnSelectEnabled enables or disables auto-copy on select.
// Emits a 'settings:autoCopyOnSelect' event so running terminals can update.
func (a *App) SetAutoCopyOnSelectEnabled(enabled bool) error {
	err := a.desktopSettings.SetAutoCopyOnSelect(enabled)
	if err != nil {
		return err
	}
	// Emit event to notify running terminals of the setting change
	wailsRuntime.EventsEmit(a.ctx, "settings:autoCopyOnSelect", enabled)
	return nil
}

// GetShowActivityRibbon returns whether the activity ribbon is enabled.
// The activity ribbon shows wait time below each session tab. Enabled by default.
func (a *App) GetShowActivityRibbon() bool {
	enabled, err := a.desktopSettings.GetShowActivityRibbon()
	if err != nil {
		return true // Default to enabled
	}
	return enabled
}

// SetShowActivityRibbon enables or disables the activity ribbon on session tabs.
// Emits a 'settings:activityRibbon' event so the UI updates immediately.
func (a *App) SetShowActivityRibbon(enabled bool) error {
	err := a.desktopSettings.SetShowActivityRibbon(enabled)
	if err != nil {
		return err
	}
	// Emit event so tabs update without requiring refresh
	wailsRuntime.EventsEmit(a.ctx, "settings:activityRibbon", enabled)
	return nil
}

// GetFileBasedActivityDetection returns whether file-based activity detection is enabled.
// When enabled, Claude/Gemini session file modification times are used to detect "running"
// status instead of terminal output parsing. Enabled by default.
func (a *App) GetFileBasedActivityDetection() bool {
	enabled, err := a.desktopSettings.GetFileBasedActivityDetection()
	if err != nil {
		return true // Default to enabled
	}
	return enabled
}

// SetFileBasedActivityDetection enables or disables file-based activity detection.
func (a *App) SetFileBasedActivityDetection(enabled bool) error {
	return a.desktopSettings.SetFileBasedActivityDetection(enabled)
}

// ==================== SSH Remote Session Methods ====================

// TestSSHConnection tests if a remote host is reachable.
// hostID should match a configured [ssh_hosts.X] section in config.toml.
func (a *App) TestSSHConnection(hostID string) error {
	return a.sshBridge.TestConnection(hostID)
}

// GetSSHHostStatus returns connection status for all configured SSH hosts.
func (a *App) GetSSHHostStatus() []SSHHostStatus {
	statuses := a.sshBridge.GetHostStatus()
	result := make([]SSHHostStatus, len(statuses))
	for i, s := range statuses {
		var lastError string
		if s.LastError != nil {
			lastError = s.LastError.Error()
		}
		result[i] = SSHHostStatus{
			HostID:    s.HostID,
			Connected: s.Connected,
			LastError: lastError,
		}
	}
	return result
}

// ListSSHHosts returns all configured SSH host IDs.
func (a *App) ListSSHHosts() []string {
	return a.sshBridge.ListConfiguredHosts()
}

// GetSSHHostDisplayNames returns a map of hostID to display name.
// The display name is the GroupName from config.toml, or the hostID if not set.
// Used to show friendly names like "MacStudio" instead of raw host IDs in the UI.
func (a *App) GetSSHHostDisplayNames() map[string]string {
	return a.sshBridge.GetHostDisplayNames()
}

// SSHHostStatus represents the connection status of an SSH host.
type SSHHostStatus struct {
	HostID    string `json:"hostId"`
	Connected bool   `json:"connected"`
	LastError string `json:"lastError,omitempty"`
}

// ==================== Saved Layouts Methods ====================

// GetSavedLayouts returns all saved layout templates.
func (a *App) GetSavedLayouts() ([]SavedLayout, error) {
	return a.savedLayouts.GetSavedLayouts()
}

// SaveLayout saves a new layout or updates an existing one.
// Returns the saved layout with ID filled in.
func (a *App) SaveLayout(layout SavedLayout) (*SavedLayout, error) {
	return a.savedLayouts.SaveLayout(layout)
}

// DeleteSavedLayout removes a layout by ID.
func (a *App) DeleteSavedLayout(id string) error {
	return a.savedLayouts.DeleteLayout(id)
}

// GetSavedLayoutByID returns a single layout by ID.
func (a *App) GetSavedLayoutByID(id string) (*SavedLayout, error) {
	return a.savedLayouts.GetLayoutByID(id)
}

// ==================== Remote Session Creation ====================

// CreateRemoteSession creates a new tmux session on a remote host and launches the AI tool.
// hostID should match a configured [ssh_hosts.X] section in config.toml.
// If configKey is provided, the launch config settings will be applied.
func (a *App) CreateRemoteSession(hostID, projectPath, title, tool, configKey string) (SessionInfo, error) {
	return a.tmux.CreateRemoteSession(hostID, projectPath, title, tool, configKey, a.sshBridge)
}

// ==================== Multi-Window Support ====================

// OpenNewWindow launches a new application instance.
// Returns error in dev mode or if launch fails.
func (a *App) OpenNewWindow() error {
	// Block in dev mode - Wails dev server doesn't support multiple instances
	if os.Getenv("WAILS_DEV") != "" || Version == "0.1.0-dev" {
		return fmt.Errorf("new window not supported in development mode")
	}

	// Get path to running executable
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}

	// Resolve symlinks to get actual binary
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %w", err)
	}

	// Allocate next window number (file-locked, cross-process safe)
	nextNum, err := allocateNextWindowNumber()
	if err != nil {
		return fmt.Errorf("failed to allocate window number: %w", err)
	}

	// Launch new instance with window number env var
	cmd := exec.Command(execPath)
	cmd.Env = append(os.Environ(), fmt.Sprintf("REVDEN_WINDOW_NUM=%d", nextNum))

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to launch new window: %w", err)
	}

	return nil
}

// GetWindowNumber returns this window's number (1 for primary, 2+ for secondary).
func (a *App) GetWindowNumber() int {
	return a.windowNumber
}

// IsPrimaryWindow returns true if this is the primary (first) window.
func (a *App) IsPrimaryWindow() bool {
	return a.windowNumber == 1
}

// ==================== Tab State Persistence ====================

// GetOpenTabState returns the saved tab state for this window.
// Returns nil (not an error) when no state has been saved.
func (a *App) GetOpenTabState() (*WindowTabState, error) {
	return a.tabState.GetTabState(a.windowNumber)
}

// SaveOpenTabState persists the current tab state for this window.
func (a *App) SaveOpenTabState(state WindowTabState) error {
	return a.tabState.SaveTabState(a.windowNumber, state)
}
