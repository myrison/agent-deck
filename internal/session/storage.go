package session

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/asheshgoplani/agent-deck/internal/tmux"
)

const (
	// maxBackupGenerations is the number of rolling backups to keep
	maxBackupGenerations = 3
)

// expandTilde expands ~ to the user's home directory with path traversal protection
// It also fixes malformed paths that have ~ in the middle (e.g., "/some/path~/actual/path")
func expandTilde(path string) string {
	// Fix malformed paths that have ~ in the middle
	// This can happen when textinput suggestion appends instead of replaces
	if idx := strings.Index(path, "~/"); idx > 0 {
		path = path[idx:]
	}

	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			// Clean the path to resolve .. and other special sequences
			expanded := filepath.Join(home, path[2:])
			cleaned := filepath.Clean(expanded)
			// Verify the cleaned path is still under home directory (prevent path traversal)
			if strings.HasPrefix(cleaned, home) {
				return cleaned
			}
			// Path traversal detected - log and return original
			log.Printf("Warning: path traversal detected in %q, ignoring expansion", path)
		}
	} else if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
	}
	return path
}

// StorageData represents the JSON structure for persistence
type StorageData struct {
	Instances []*InstanceData `json:"instances"`
	Groups    []*GroupData    `json:"groups,omitempty"` // Persist empty groups
	UpdatedAt time.Time       `json:"updated_at"`
}

// InstanceData represents the serializable session data
type InstanceData struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	CustomLabel string `json:"custom_label,omitempty"` // User-provided label (from desktop app)
	ProjectPath string `json:"project_path"`
	GroupPath       string    `json:"group_path"`
	ParentSessionID string    `json:"parent_session_id,omitempty"` // Links to parent session (sub-session support)
	Command         string    `json:"command"`
	Tool            string    `json:"tool"`
	Status          Status    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
	LastAccessedAt  time.Time `json:"last_accessed_at,omitempty"`
	WaitingSince    time.Time `json:"waiting_since,omitempty"` // When session entered waiting status
	TmuxSession     string    `json:"tmux_session"`

	// Worktree support
	WorktreePath     string `json:"worktree_path,omitempty"`
	WorktreeRepoRoot string `json:"worktree_repo_root,omitempty"`
	WorktreeBranch   string `json:"worktree_branch,omitempty"`

	// Claude session (persisted for resume after app restart)
	ClaudeSessionID  string    `json:"claude_session_id,omitempty"`
	ClaudeDetectedAt time.Time `json:"claude_detected_at,omitempty"`

	// Gemini session (persisted for resume after app restart)
	GeminiSessionID  string    `json:"gemini_session_id,omitempty"`
	GeminiDetectedAt time.Time `json:"gemini_detected_at,omitempty"`
	GeminiYoloMode   *bool     `json:"gemini_yolo_mode,omitempty"`

	// OpenCode session (persisted for resume after app restart)
	OpenCodeSessionID  string    `json:"opencode_session_id,omitempty"`
	OpenCodeDetectedAt time.Time `json:"opencode_detected_at,omitempty"`

	// Latest user input for context
	LatestPrompt string `json:"latest_prompt,omitempty"`

	// Session label/summary (Claude's session description)
	SessionLabel string `json:"session_label,omitempty"`

	// MCP tracking (persisted for sync status display)
	LoadedMCPNames []string `json:"loaded_mcp_names,omitempty"`

	// Launch config used for this session
	LaunchConfigName string `json:"launch_config_name,omitempty"`
	DangerousMode    bool   `json:"dangerous_mode,omitempty"`

	// Remote session support
	RemoteHost     string `json:"remote_host,omitempty"`      // SSH host identifier
	RemoteTmuxName string `json:"remote_tmux_name,omitempty"` // tmux session name on remote
}

// GroupData represents serializable group data
type GroupData struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Expanded    bool   `json:"expanded"`
	Order       int    `json:"order"`
	DefaultPath string `json:"default_path,omitempty"`
}

// Storage handles persistence of session data
// Thread-safe with mutex protection for concurrent access
type Storage struct {
	path    string
	profile string     // The profile this storage is for
	mu      sync.Mutex // Protects all file operations
}

// NewStorage creates a new storage instance using the default profile.
// It automatically runs migration from old layout if needed.
func NewStorage() (*Storage, error) {
	return NewStorageWithProfile("")
}

// NewStorageWithProfile creates a storage instance for a specific profile.
// If profile is empty, uses the effective profile (from env var or config).
// Automatically runs migration from old layout if needed.
func NewStorageWithProfile(profile string) (*Storage, error) {
	// Run migration if needed (safe to call multiple times)
	needsMigration, err := NeedsMigration()
	if err != nil {
		log.Printf("Warning: failed to check migration status: %v", err)
	} else if needsMigration {
		result, err := MigrateToProfiles()
		if err != nil {
			return nil, fmt.Errorf("migration failed: %w", err)
		}
		if result.Migrated {
			log.Printf("Migration: %s", result.Message)
		}
	}

	// Get effective profile
	effectiveProfile := GetEffectiveProfile(profile)

	// Get storage path for this profile
	path, err := GetStoragePathForProfile(effectiveProfile)
	if err != nil {
		return nil, err
	}

	// Ensure directory exists with secure permissions (0700 = owner only)
	// This protects session data on shared systems
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	s := &Storage{
		path:    path,
		profile: effectiveProfile,
	}

	// Clean up any leftover temp files from previous crashes
	s.cleanupTempFiles()

	return s, nil
}

// Profile returns the profile name this storage is using
func (s *Storage) Profile() string {
	return s.profile
}

// Path returns the file path this storage is using
func (s *Storage) Path() string {
	return s.path
}

// cleanupTempFiles removes any leftover .tmp files from previous crashes
func (s *Storage) cleanupTempFiles() {
	tmpPath := s.path + ".tmp"
	if _, err := os.Stat(tmpPath); err == nil {
		if err := os.Remove(tmpPath); err != nil {
			log.Printf("Warning: failed to clean up temp file %s: %v", tmpPath, err)
		} else {
			log.Printf("Cleaned up leftover temp file from previous session")
		}
	}
}

// Save persists instances to JSON file
// DEPRECATED: Use SaveWithGroups to ensure groups are not lost
func (s *Storage) Save(instances []*Instance) error {
	return s.SaveWithGroups(instances, nil)
}

// SaveWithGroups persists instances and groups to JSON file
// Uses atomic write pattern with:
// - Mutex for thread safety
// - Rolling backups (3 generations)
// - fsync for durability
// - Data validation
func (s *Storage) SaveWithGroups(instances []*Instance, groupTree *GroupTree) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Convert instances to serializable format
	data := StorageData{
		Instances: make([]*InstanceData, len(instances)),
		UpdatedAt: time.Now(),
	}

	for i, inst := range instances {
		tmuxName := ""
		if inst.tmuxSession != nil {
			tmuxName = inst.tmuxSession.Name
		}

		// ═══════════════════════════════════════════════════════════════════
		// LAYER 1: Save-time preservation
		//
		// Preserves RemoteTmuxName even when tmuxSession is nil. This handles:
		// - Transient SSH failures that cause tmux_session to be temporarily unavailable
		// - Desktop app crashes during remote session operations
		// - Network interruptions during save
		//
		// Without this, RemoteTmuxName would be lost on save, making the session
		// unrecognizable during future discovery cycles (no way to match it to
		// the tmux session on remote). Layer 2 and 3 depend on RemoteTmuxName
		// being preserved here.
		// ═══════════════════════════════════════════════════════════════════
		if tmuxName == "" && hasRemoteTmuxFallback(inst.RemoteHost, inst.RemoteTmuxName) {
			tmuxName = inst.RemoteTmuxName
		}

		// Get WaitingSince from runtime state tracker if available, fall back to persisted value
		waitingSince := inst.WaitingSince
		if inst.tmuxSession != nil {
			if runtimeWaitingSince := inst.tmuxSession.GetWaitingSince(); !runtimeWaitingSince.IsZero() {
				waitingSince = runtimeWaitingSince
			}
		}

		data.Instances[i] = &InstanceData{
			ID:          inst.ID,
			Title:       inst.Title,
			CustomLabel: inst.CustomLabel,
			ProjectPath: inst.ProjectPath,
			GroupPath:          inst.GroupPath,
			ParentSessionID:    inst.ParentSessionID,
			Command:            inst.Command,
			Tool:               inst.Tool,
			Status:             inst.Status,
			CreatedAt:          inst.CreatedAt,
			LastAccessedAt:     inst.LastAccessedAt,
			WaitingSince:       waitingSince,
			TmuxSession:        tmuxName,
			WorktreePath:       inst.WorktreePath,
			WorktreeRepoRoot:   inst.WorktreeRepoRoot,
			WorktreeBranch:     inst.WorktreeBranch,
			ClaudeSessionID:    inst.ClaudeSessionID,
			ClaudeDetectedAt:   inst.ClaudeDetectedAt,
			GeminiSessionID:    inst.GeminiSessionID,
			GeminiDetectedAt:   inst.GeminiDetectedAt,
			GeminiYoloMode:     inst.GeminiYoloMode,
			OpenCodeSessionID:  inst.OpenCodeSessionID,
			OpenCodeDetectedAt: inst.OpenCodeDetectedAt,
			LatestPrompt:       inst.LatestPrompt,
			SessionLabel:       inst.SessionLabel,
			LoadedMCPNames:     inst.LoadedMCPNames,
			LaunchConfigName:   inst.LaunchConfigName,
			DangerousMode:      inst.DangerousMode,
			RemoteHost:         inst.RemoteHost,
			RemoteTmuxName:     inst.RemoteTmuxName,
		}
	}

	// Save groups (including empty ones)
	if groupTree != nil {
		data.Groups = make([]*GroupData, 0, len(groupTree.GroupList))
		for _, g := range groupTree.GroupList {
			data.Groups = append(data.Groups, &GroupData{
				Name:        g.Name,
				Path:        g.Path,
				Expanded:    g.Expanded,
				Order:       g.Order,
				DefaultPath: g.DefaultPath,
			})
		}
	}

	// Validate data before saving
	if err := validateStorageData(&data); err != nil {
		return fmt.Errorf("data validation failed: %w", err)
	}

	// Marshal to JSON
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	// ═══════════════════════════════════════════════════════════════════
	// ATOMIC WRITE PATTERN: Prevents data corruption on crash/power loss
	// 1. Write to temporary file
	// 2. fsync the temp file (ensures data reaches disk)
	// 3. Rotate backups (rolling 3 generations)
	// 4. Atomic rename temp to final
	// ═══════════════════════════════════════════════════════════════════

	tmpPath := s.path + ".tmp"

	// Step 1: Write to temporary file (0600 = owner read/write only for security)
	if err := os.WriteFile(tmpPath, jsonData, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	// Step 2: fsync the temp file to ensure data reaches disk before rename
	// This is critical for crash safety - without fsync, data could be lost
	if err := syncFile(tmpPath); err != nil {
		// Log but don't fail - atomic rename still provides some safety
		log.Printf("Warning: fsync failed for %s: %v", tmpPath, err)
	}

	// Step 3: Rotate backups before overwriting
	if _, err := os.Stat(s.path); err == nil {
		s.rotateBackups()
	}

	// Step 4: Atomic rename (this is atomic on POSIX systems)
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("failed to finalize save: %w", err)
	}

	return nil
}

// LoadStorageData reads raw StorageData from the JSON file without converting to Instance objects.
// This is useful for callers that work directly with InstanceData (e.g., desktop app).
// Returns empty StorageData if file doesn't exist.
func (s *Storage) LoadStorageData() (*StorageData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if file exists
	if _, err := os.Stat(s.path); os.IsNotExist(err) {
		return &StorageData{
			Instances: []*InstanceData{},
			Groups:    []*GroupData{},
			UpdatedAt: time.Time{},
		}, nil
	}

	// Try to load from main file first
	data, err := s.loadFromFile(s.path)
	if err != nil {
		// Main file is corrupted - try to recover from backups
		log.Printf("Warning: main storage file corrupted (%v), attempting recovery from backup", err)
		data, err = s.recoverFromBackups()
		if err != nil {
			return nil, fmt.Errorf("failed to load and no valid backup found: %w", err)
		}
		log.Printf("Successfully recovered from backup")
	}

	return data, nil
}

// SaveStorageData persists raw StorageData to the JSON file.
// Uses atomic write pattern with fsync, backup rotation, and validation.
// This is useful for callers that work directly with InstanceData (e.g., desktop app).
func (s *Storage) SaveStorageData(data *StorageData) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Update timestamp
	data.UpdatedAt = time.Now()

	// Validate data before saving
	if err := validateStorageData(data); err != nil {
		return fmt.Errorf("data validation failed: %w", err)
	}

	// Marshal to JSON
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	// Atomic write pattern (same as SaveWithGroups)
	tmpPath := s.path + ".tmp"

	// Step 1: Write to temporary file
	if err := os.WriteFile(tmpPath, jsonData, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	// Step 2: fsync the temp file
	if err := syncFile(tmpPath); err != nil {
		log.Printf("Warning: fsync failed for %s: %v", tmpPath, err)
	}

	// Step 3: Rotate backups before overwriting
	if _, err := os.Stat(s.path); err == nil {
		s.rotateBackups()
	}

	// Step 4: Atomic rename
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("failed to finalize save: %w", err)
	}

	return nil
}

// validateStorageData checks data integrity before saving
func validateStorageData(data *StorageData) error {
	if data == nil {
		return fmt.Errorf("data is nil")
	}

	// Check for duplicate session IDs
	seenIDs := make(map[string]bool)
	for _, inst := range data.Instances {
		if inst.ID == "" {
			return fmt.Errorf("instance has empty ID")
		}
		if seenIDs[inst.ID] {
			return fmt.Errorf("duplicate instance ID: %s", inst.ID)
		}
		seenIDs[inst.ID] = true
	}

	// Check for duplicate group paths
	seenPaths := make(map[string]bool)
	for _, g := range data.Groups {
		if g.Path == "" {
			return fmt.Errorf("group has empty path")
		}
		if seenPaths[g.Path] {
			return fmt.Errorf("duplicate group path: %s", g.Path)
		}
		seenPaths[g.Path] = true
	}

	return nil
}

// syncFile calls fsync on a file to ensure data is written to disk
func syncFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// rotateBackups maintains rolling backups: .bak, .bak.1, .bak.2
func (s *Storage) rotateBackups() {
	bakPath := s.path + ".bak"

	// Shift existing backups: .bak.2 <- .bak.1 <- .bak <- current
	for i := maxBackupGenerations - 1; i > 0; i-- {
		oldPath := fmt.Sprintf("%s.%d", bakPath, i-1)
		if i == 1 {
			oldPath = bakPath
		}
		newPath := fmt.Sprintf("%s.%d", bakPath, i)

		// Remove the oldest backup to make room
		if i == maxBackupGenerations-1 {
			os.Remove(newPath)
		}

		// Rename to shift
		if _, err := os.Stat(oldPath); err == nil {
			if err := os.Rename(oldPath, newPath); err != nil {
				log.Printf("Warning: failed to rotate backup %s -> %s: %v", oldPath, newPath, err)
			}
		}
	}

	// Copy current file to .bak
	if err := copyFile(s.path, bakPath); err != nil {
		log.Printf("Warning: failed to create backup file %s: %v", bakPath, err)
	}
}

// copyFile copies a file from src to dst (0600 = owner read/write only for security)
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0600)
}

// Load reads instances from JSON file
func (s *Storage) Load() ([]*Instance, error) {
	instances, _, err := s.LoadWithGroups()
	return instances, err
}

// LoadWithGroups reads instances and groups from JSON file
// Automatically recovers from backup if main file is corrupted
func (s *Storage) LoadWithGroups() ([]*Instance, []*GroupData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if file exists
	if _, err := os.Stat(s.path); os.IsNotExist(err) {
		log.Printf("[STORAGE-DEBUG] LoadWithGroups: file does not exist (profile=%s, path=%s), returning empty instances", s.profile, s.path)
		return []*Instance{}, nil, nil
	}

	// Try to load from main file first
	data, err := s.loadFromFile(s.path)
	if err != nil {
		// Main file is corrupted - try to recover from backups
		log.Printf("Warning: main storage file corrupted (%v), attempting recovery from backup", err)
		data, err = s.recoverFromBackups()
		if err != nil {
			return nil, nil, fmt.Errorf("failed to load and no valid backup found: %w", err)
		}
		log.Printf("Successfully recovered from backup")

		// Save the recovered data back to main file
		// (this will create a new backup of the corrupted file first)
		// Note: We don't call SaveWithGroups here to avoid deadlock (we hold the mutex)
		// Instead, we'll just write directly
	}

	return s.convertToInstances(data)
}

// loadFromFile reads and parses a storage file
func (s *Storage) loadFromFile(path string) (*StorageData, error) {
	jsonData, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	var data StorageData
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	return &data, nil
}

// recoverFromBackups tries to load data from backup files in order
func (s *Storage) recoverFromBackups() (*StorageData, error) {
	bakPath := s.path + ".bak"

	// Try backups in order: .bak, .bak.1, .bak.2
	backupPaths := []string{bakPath}
	for i := 1; i < maxBackupGenerations; i++ {
		backupPaths = append(backupPaths, fmt.Sprintf("%s.%d", bakPath, i))
	}

	for _, tryPath := range backupPaths {
		if _, err := os.Stat(tryPath); os.IsNotExist(err) {
			continue
		}

		data, err := s.loadFromFile(tryPath)
		if err != nil {
			log.Printf("Backup %s also corrupted: %v", tryPath, err)
			continue
		}

		log.Printf("Recovered data from backup: %s", tryPath)
		return data, nil
	}

	return nil, fmt.Errorf("all backups corrupted or missing")
}

// convertToInstances converts StorageData to Instance slice
func (s *Storage) convertToInstances(data *StorageData) ([]*Instance, []*GroupData, error) {

	// ═══════════════════════════════════════════════════════════════════
	// MIGRATION: Convert old "My Sessions" paths to normalized "my-sessions"
	// Old versions used DefaultGroupName ("My Sessions") as both name AND path.
	// This caused the group to be undeletable since path matched the protection check.
	// Now we use DefaultGroupPath ("my-sessions") for paths, keeping name as display.
	// ═══════════════════════════════════════════════════════════════════
	migratedGroups := false
	for i, g := range data.Groups {
		if g.Path == DefaultGroupName {
			data.Groups[i].Path = DefaultGroupPath
			migratedGroups = true
			log.Printf("Migration: Converted group path '%s' -> '%s'", DefaultGroupName, DefaultGroupPath)
		}
	}
	for i, inst := range data.Instances {
		if inst.GroupPath == DefaultGroupName {
			data.Instances[i].GroupPath = DefaultGroupPath
			migratedGroups = true
		}
	}
	if migratedGroups {
		log.Printf("Migration: Updated default group paths from '%s' to '%s'", DefaultGroupName, DefaultGroupPath)
	}

	// Convert to instances
	instances := make([]*Instance, len(data.Instances))
	for i, instData := range data.Instances {
		// Recreate tmux session object from stored name
		// Use ReconnectSessionWithStatus to restore the exact status state
		var tmuxSess *tmux.Session

		// ═══════════════════════════════════════════════════════════════════
		// LAYER 2: Load-time recovery
		//
		// Reconstructs tmuxSession from RemoteTmuxName when TmuxSession field
		// is empty. This handles sessions that were saved with nil tmuxSession
		// (Layer 1 preserved the name, but the object was lost). Recovery scenarios:
		// - SSH was down during save, but restored by load time
		// - Desktop app restarted after crash during remote operation
		// - Session data restored from backup
		//
		// Uses lazy executor (nil) to prevent slow startup when remote hosts
		// are unreachable. The executor will be created on first access.
		// If recovery fails here, Layer 3 will attempt repair during discovery.
		// ═══════════════════════════════════════════════════════════════════
		tmuxSessionName := instData.TmuxSession
		if tmuxSessionName == "" && hasRemoteTmuxFallback(instData.RemoteHost, instData.RemoteTmuxName) {
			tmuxSessionName = instData.RemoteTmuxName
			log.Printf("Recovery: Using RemoteTmuxName for %s: %s", instData.ID, tmuxSessionName)
		}

		if tmuxSessionName != "" {
			// Convert Status enum to string for tmux package
			// This restores the exact status across app restarts
			previousStatus := statusToString(instData.Status)

			// Check if this is a remote session
			if instData.RemoteHost != "" {
				// Remote session - defer SSH executor creation until needed (lazy initialization)
				// This prevents slow startup when remote hosts are unreachable or slow
				// The executor will be created on first access (preview, attach, status update)
				tmuxSess = tmux.ReconnectSessionWithStatusAndExecutor(
					tmuxSessionName,
					instData.Title,
					instData.ProjectPath,
					instData.Command,
					previousStatus,
					nil, // SSH executor created lazily
				)
				// Store remote host info for lazy executor creation
				tmuxSess.RemoteHostID = instData.RemoteHost
			} else {
				// Local session
				tmuxSess = tmux.ReconnectSessionWithStatus(
					tmuxSessionName,
					instData.Title,
					instData.ProjectPath,
					instData.Command,
					previousStatus,
				)
			}

			// ═══════════════════════════════════════════════════════════════════
			// Handle reconnection failure gracefully
			//
			// If reconnection fails (tmuxSess is nil), skip this session instead
			// of crashing. This can happen when:
			// - tmux session name is malformed or invalid
			// - Remote host is permanently unavailable
			// - Session was manually deleted on remote but still in sessions.json
			//
			// The session will be marked as stale on next discovery cycle.
			// ═══════════════════════════════════════════════════════════════════
			if tmuxSess == nil {
				log.Printf("Warning: Failed to reconnect session %s (tmux: %s, remote: %s)",
					instData.ID, tmuxSessionName, instData.RemoteHost)
				// Don't add to instances array - skip corrupted session
				continue
			}

			// Pass instance ID for activity hooks (enables real-time status updates)
			tmuxSess.InstanceID = instData.ID
			// Enable mouse mode for proper scrolling (local sessions only)
			// Skip for remote sessions - would trigger slow SSH during startup
			if instData.RemoteHost == "" && tmuxSess.Exists() {
				// Ignore errors - non-fatal, older tmux versions may not support all options
				_ = tmuxSess.EnableMouseMode()
			}
		}

		// Migrate old sessions without GroupPath
		groupPath := instData.GroupPath
		if groupPath == "" {
			groupPath = extractGroupPath(instData.ProjectPath)
		}

		// Migrate remote sessions with flat group prefix (e.g., "remote") to hierarchical path
		// (e.g., "remote/Jeeves"). Desktop app commit 911bdce persisted flat "remote" GroupPath;
		// fixed for new sessions in 6b94e96, but existing sessions need this migration.
		if instData.RemoteHost != "" && groupPath != "" {
			rdSettings := GetRemoteDiscoverySettings()
			prefix := rdSettings.GroupPrefix
			if prefix == "" {
				prefix = "remote"
			}
			// Only migrate if the path is exactly the prefix without a hostname segment
			if groupPath == prefix {
				newPath := resolveRemoteHostGroupPath(instData.RemoteHost, prefix)
				log.Printf("Migration: Remote session %s group path '%s' -> '%s'", instData.ID, prefix, newPath)
				groupPath = newPath
			}

			// Migrate remote sessions stuck in default group to their host's root group.
			// This happens when RemoteTmuxName was empty, preventing discovery from
			// updating the group path. Move them to the host's base group so they
			// at least appear under the correct remote host hierarchy.
			if groupPath == DefaultGroupPath {
				newPath := resolveRemoteHostGroupPath(instData.RemoteHost, prefix)
				log.Printf("Migration: Remote session %s group path '%s' -> '%s'", instData.ID, DefaultGroupPath, newPath)
				groupPath = newPath
			}
		}

		// Backfill RemoteTmuxName from TmuxSession for remote sessions.
		// Early versions of discovery did not always persist RemoteTmuxName,
		// causing sessions to be unrecognizable on subsequent discovery cycles.
		// Also backfilled at discovery time in DiscoverRemoteSessionsForHost;
		// this handles sessions loaded from disk before discovery runs.
		if instData.RemoteHost != "" && instData.RemoteTmuxName == "" && instData.TmuxSession != "" {
			instData.RemoteTmuxName = instData.TmuxSession
			log.Printf("Migration: Backfilled RemoteTmuxName for %s: %s", instData.ID, instData.TmuxSession)
		}

		// Expand tilde in project path (handles paths like ~/project saved from UI)
		projectPath := expandTilde(instData.ProjectPath)

		inst := &Instance{
			ID:          instData.ID,
			Title:       instData.Title,
			CustomLabel: instData.CustomLabel,
			ProjectPath: projectPath,
			GroupPath:          groupPath,
			ParentSessionID:    instData.ParentSessionID,
			Command:            instData.Command,
			Tool:               instData.Tool,
			Status:             instData.Status,
			CreatedAt:          instData.CreatedAt,
			LastAccessedAt:     instData.LastAccessedAt,
			WaitingSince:       instData.WaitingSince,
			WorktreePath:       instData.WorktreePath,
			WorktreeRepoRoot:   instData.WorktreeRepoRoot,
			WorktreeBranch:     instData.WorktreeBranch,
			ClaudeSessionID:    instData.ClaudeSessionID,
			ClaudeDetectedAt:   instData.ClaudeDetectedAt,
			GeminiSessionID:    instData.GeminiSessionID,
			GeminiDetectedAt:   instData.GeminiDetectedAt,
			GeminiYoloMode:     instData.GeminiYoloMode,
			OpenCodeSessionID:  instData.OpenCodeSessionID,
			OpenCodeDetectedAt: instData.OpenCodeDetectedAt,
			LatestPrompt:       instData.LatestPrompt,
			SessionLabel:       instData.SessionLabel,
			LoadedMCPNames:     instData.LoadedMCPNames,
			LaunchConfigName:   instData.LaunchConfigName,
			DangerousMode:      instData.DangerousMode,
			RemoteHost:         instData.RemoteHost,
			RemoteTmuxName:     instData.RemoteTmuxName,
			tmuxSession:        tmuxSess,
		}

		// Update status immediately to prevent flickering on startup
		// Without this, UI renders saved status, then first tick changes it
		// Skip remote sessions - UpdateStatus() triggers SSH executor creation which
		// causes significant delay (~3s for many remote sessions). Remote sessions
		// will get their status updated on first tick instead.
		if tmuxSess != nil && instData.RemoteHost == "" {
			_ = inst.UpdateStatus()
		}

		instances[i] = inst
	}

	return instances, data.Groups, nil
}

// GetStoragePath returns the path to the sessions.json file for the default profile.
// DEPRECATED: Use GetStoragePathForProfile for explicit profile support.
func GetStoragePath() (string, error) {
	return GetStoragePathForProfile(DefaultProfile)
}

// GetStoragePathForProfile returns the path to the sessions.json file for a specific profile.
func GetStoragePathForProfile(profile string) (string, error) {
	if profile == "" {
		profile = DefaultProfile
	}

	profileDir, err := GetProfileDir(profile)
	if err != nil {
		return "", err
	}

	return filepath.Join(profileDir, "sessions.json"), nil
}

// GetUpdatedAt returns the last modification timestamp of the storage file
// This is read from the UpdatedAt field in the JSON file.
// Returns an error if the file doesn't exist or can't be read.
func (s *Storage) GetUpdatedAt() (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if file exists
	if _, err := os.Stat(s.path); os.IsNotExist(err) {
		return time.Time{}, err
	}

	// Load and parse the file
	data, err := s.loadFromFile(s.path)
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to load storage file: %w", err)
	}

	return data.UpdatedAt, nil
}

// statusToString converts a Status enum to the string expected by tmux.ReconnectSessionWithStatus
// hasRemoteTmuxFallback returns true if this session has remote session
// metadata that can be used to recover a lost tmux_session field.
// Used by both save-time preservation (Layer 1) and load-time recovery (Layer 2).
func hasRemoteTmuxFallback(remoteHost, remoteTmuxName string) bool {
	return remoteHost != "" && remoteTmuxName != ""
}

func statusToString(s Status) string {
	switch s {
	case StatusRunning:
		return "active"
	case StatusWaiting:
		return "waiting"
	case StatusIdle:
		return "idle"
	case StatusError:
		return "waiting" // Treat errors as needing attention
	default:
		return "waiting"
	}
}
