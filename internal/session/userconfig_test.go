package session

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/BurntSushi/toml"
)

func TestUserConfig_ClaudeConfigDir(t *testing.T) {
	// Create temp config file
	tmpDir := t.TempDir()
	configContent := `
[claude]
config_dir = "~/.claude-work"

[tools.test]
command = "test"
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Test parsing
	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.Claude.ConfigDir != "~/.claude-work" {
		t.Errorf("Claude.ConfigDir = %s, want ~/.claude-work", config.Claude.ConfigDir)
	}
}

func TestUserConfig_ClaudeConfigDirEmpty(t *testing.T) {
	// Test with no Claude section
	tmpDir := t.TempDir()
	configContent := `
[tools.test]
command = "test"
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.Claude.ConfigDir != "" {
		t.Errorf("Claude.ConfigDir = %s, want empty string", config.Claude.ConfigDir)
	}
}

func TestGlobalSearchConfig(t *testing.T) {
	// Create temp config with global search settings
	tmpDir := t.TempDir()
	configContent := `
[global_search]
enabled = true
tier = "auto"
memory_limit_mb = 150
recent_days = 60
index_rate_limit = 30
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Test parsing
	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if !config.GlobalSearch.Enabled {
		t.Error("Expected GlobalSearch.Enabled to be true")
	}
	if config.GlobalSearch.Tier != "auto" {
		t.Errorf("Expected tier 'auto', got %q", config.GlobalSearch.Tier)
	}
	if config.GlobalSearch.MemoryLimitMB != 150 {
		t.Errorf("Expected MemoryLimitMB 150, got %d", config.GlobalSearch.MemoryLimitMB)
	}
	if config.GlobalSearch.RecentDays != 60 {
		t.Errorf("Expected RecentDays 60, got %d", config.GlobalSearch.RecentDays)
	}
	if config.GlobalSearch.IndexRateLimit != 30 {
		t.Errorf("Expected IndexRateLimit 30, got %d", config.GlobalSearch.IndexRateLimit)
	}
}

func TestGlobalSearchConfigDefaults(t *testing.T) {
	// Config without global_search section should parse with zero values
	// (defaults are applied by LoadUserConfig, not parsing)
	tmpDir := t.TempDir()
	configContent := `default_tool = "claude"`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	// When parsing directly without LoadUserConfig, values should be zero
	if config.GlobalSearch.Enabled {
		t.Error("GlobalSearch.Enabled should be false when not specified (zero value)")
	}
	if config.GlobalSearch.MemoryLimitMB != 0 {
		t.Errorf("Expected default MemoryLimitMB 0 (zero value), got %d", config.GlobalSearch.MemoryLimitMB)
	}
}

func TestGlobalSearchConfigDisabled(t *testing.T) {
	// Test explicitly disabling global search
	tmpDir := t.TempDir()
	configContent := `
[global_search]
enabled = false
tier = "disabled"
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.GlobalSearch.Enabled {
		t.Error("Expected GlobalSearch.Enabled to be false")
	}
	if config.GlobalSearch.Tier != "disabled" {
		t.Errorf("Expected tier 'disabled', got %q", config.GlobalSearch.Tier)
	}
}

func TestSaveUserConfig(t *testing.T) {
	// Setup: use temp directory
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()

	// Clear cache
	ClearUserConfigCache()

	// Create agent-deck directory
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)

	// Create config to save
	config := &UserConfig{
		DefaultTool: "claude",
		Claude: ClaudeSettings{
			DangerousMode: true,
			ConfigDir:     "~/.claude-work",
		},
		Logs: LogSettings{
			MaxSizeMB:     20,
			MaxLines:      5000,
			RemoveOrphans: true,
		},
	}

	// Save it
	err := SaveUserConfig(config)
	if err != nil {
		t.Fatalf("SaveUserConfig failed: %v", err)
	}

	// Clear cache and reload
	ClearUserConfigCache()
	loaded, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	// Verify values
	if loaded.DefaultTool != "claude" {
		t.Errorf("DefaultTool: got %q, want %q", loaded.DefaultTool, "claude")
	}
	if !loaded.Claude.DangerousMode {
		t.Error("DangerousMode should be true")
	}
	if loaded.Claude.ConfigDir != "~/.claude-work" {
		t.Errorf("ConfigDir: got %q, want %q", loaded.Claude.ConfigDir, "~/.claude-work")
	}
	if loaded.Logs.MaxSizeMB != 20 {
		t.Errorf("MaxSizeMB: got %d, want %d", loaded.Logs.MaxSizeMB, 20)
	}
}

func TestGetTheme_Default(t *testing.T) {
	// Setup: use temp directory with no config
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	theme := GetTheme()
	if theme != "dark" {
		t.Errorf("GetTheme: got %q, want %q", theme, "dark")
	}
}

func TestGetTheme_Light(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// Create config with light theme
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{Theme: "light"}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	theme := GetTheme()
	if theme != "light" {
		t.Errorf("GetTheme: got %q, want %q", theme, "light")
	}
}

func TestWorktreeConfig(t *testing.T) {
	// Create temp config with worktree settings
	tmpDir := t.TempDir()
	configContent := `
[worktree]
default_location = "subdirectory"
auto_cleanup = false
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	// Test parsing
	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.Worktree.DefaultLocation != "subdirectory" {
		t.Errorf("Expected DefaultLocation 'subdirectory', got %q", config.Worktree.DefaultLocation)
	}
	if config.Worktree.AutoCleanup {
		t.Error("Expected AutoCleanup to be false")
	}
}

func TestWorktreeConfigDefaults(t *testing.T) {
	// Config without worktree section should parse with zero values
	// (defaults are applied by GetWorktreeSettings, not parsing)
	tmpDir := t.TempDir()
	configContent := `default_tool = "claude"`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	// When parsing directly without GetWorktreeSettings, values should be zero
	if config.Worktree.DefaultLocation != "" {
		t.Errorf("Expected empty DefaultLocation (zero value), got %q", config.Worktree.DefaultLocation)
	}
	if config.Worktree.AutoCleanup {
		t.Error("AutoCleanup should be false when not specified (zero value)")
	}
}

func TestGetWorktreeSettings(t *testing.T) {
	// Setup: use temp directory with no config
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// With no config, should return defaults
	settings := GetWorktreeSettings()
	if settings.DefaultLocation != "sibling" {
		t.Errorf("GetWorktreeSettings DefaultLocation: got %q, want %q", settings.DefaultLocation, "sibling")
	}
	if !settings.AutoCleanup {
		t.Error("GetWorktreeSettings AutoCleanup: should default to true")
	}
}

func TestGetWorktreeSettings_FromConfig(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// Create config with custom worktree settings
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)
	config := &UserConfig{
		Worktree: WorktreeSettings{
			DefaultLocation: "subdirectory",
			AutoCleanup:     false,
		},
	}
	_ = SaveUserConfig(config)
	ClearUserConfigCache()

	settings := GetWorktreeSettings()
	if settings.DefaultLocation != "subdirectory" {
		t.Errorf("GetWorktreeSettings DefaultLocation: got %q, want %q", settings.DefaultLocation, "subdirectory")
	}
	if settings.AutoCleanup {
		t.Error("GetWorktreeSettings AutoCleanup: should be false from config")
	}
}

// ============================================================================
// Preview Settings Tests
// ============================================================================

func TestPreviewSettings(t *testing.T) {
	// Create temp config
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	// Write config with preview settings
	content := `
[preview]
show_output = true
show_analytics = false
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.Preview.ShowOutput == nil || !*config.Preview.ShowOutput {
		t.Error("Expected Preview.ShowOutput to be true")
	}
	if config.Preview.ShowAnalytics == nil {
		t.Error("Expected Preview.ShowAnalytics to be set")
	} else if *config.Preview.ShowAnalytics {
		t.Error("Expected Preview.ShowAnalytics to be false")
	}
}

func TestPreviewSettingsDefaults(t *testing.T) {
	cfg := &UserConfig{}

	// Default: output ON, analytics ON (both default to true when not set)
	if !cfg.GetShowOutput() {
		t.Error("GetShowOutput should default to true")
	}
	if !cfg.GetShowAnalytics() {
		t.Error("GetShowAnalytics should default to true")
	}
}

func TestPreviewSettingsExplicitTrue(t *testing.T) {
	// Test when analytics is explicitly set to true
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	content := `
[preview]
show_output = false
show_analytics = true
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if config.GetShowOutput() {
		t.Error("GetShowOutput should be false")
	}
	if !config.GetShowAnalytics() {
		t.Error("GetShowAnalytics should be true when explicitly set")
	}
}

func TestPreviewSettingsNotSet(t *testing.T) {
	// Test when preview section exists but analytics is not set
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.toml")

	content := `
[preview]
show_output = true
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if !config.GetShowOutput() {
		t.Error("GetShowOutput should be true")
	}
	// When not set, ShowAnalytics should default to true
	if !config.GetShowAnalytics() {
		t.Error("GetShowAnalytics should default to true when not set")
	}
}

func TestGetPreviewSettings(t *testing.T) {
	// Setup: use temp directory with no config
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// With no config, should return defaults (both true)
	settings := GetPreviewSettings()
	if !settings.GetShowOutput() {
		t.Error("GetPreviewSettings ShowOutput: should default to true")
	}
	if !settings.GetShowAnalytics() {
		t.Error("GetPreviewSettings ShowAnalytics: should default to true")
	}
}

func TestGetPreviewSettings_FromConfig(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// Create config with custom preview settings
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)

	// Write config directly to test explicit false
	configPath := filepath.Join(agentDeckDir, "config.toml")
	content := `
[preview]
show_output = true
show_analytics = false
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	ClearUserConfigCache()

	settings := GetPreviewSettings()
	if !settings.GetShowOutput() {
		t.Error("GetPreviewSettings ShowOutput: should be true from config")
	}
	if settings.GetShowAnalytics() {
		t.Error("GetPreviewSettings ShowAnalytics: should be false from config")
	}
}

// ============================================================================
// Notifications Settings Tests
// ============================================================================

func TestNotificationsConfig_Defaults(t *testing.T) {
	// Test that default values are applied when section not present
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// With no config file, GetNotificationsSettings should return defaults
	settings := GetNotificationsSettings()
	if !settings.Enabled {
		t.Error("notifications should be enabled by default")
	}
	if settings.MaxShown != 6 {
		t.Errorf("max_shown should default to 6, got %d", settings.MaxShown)
	}
}

func TestNotificationsConfig_FromTOML(t *testing.T) {
	// Test parsing explicit TOML config
	tmpDir := t.TempDir()
	configContent := `
[notifications]
enabled = true
max_shown = 4
`
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	var config UserConfig
	_, err := toml.DecodeFile(configPath, &config)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}

	if !config.Notifications.Enabled {
		t.Error("Expected Notifications.Enabled to be true")
	}
	if config.Notifications.MaxShown != 4 {
		t.Errorf("Expected MaxShown 4, got %d", config.Notifications.MaxShown)
	}
}

func TestGetNotificationsSettings(t *testing.T) {
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	// Create config with custom notification settings
	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)

	configPath := filepath.Join(agentDeckDir, "config.toml")
	content := `
[notifications]
enabled = true
max_shown = 8
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	ClearUserConfigCache()

	settings := GetNotificationsSettings()
	if !settings.Enabled {
		t.Error("GetNotificationsSettings Enabled: should be true from config")
	}
	if settings.MaxShown != 8 {
		t.Errorf("GetNotificationsSettings MaxShown: got %d, want 8", settings.MaxShown)
	}
}

func TestGetNotificationsSettings_PartialConfig(t *testing.T) {
	// Test that missing fields get defaults
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	_ = os.Setenv("HOME", tempDir)
	defer func() { _ = os.Setenv("HOME", originalHome) }()
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	_ = os.MkdirAll(agentDeckDir, 0700)

	// Config with only enabled set, max_shown should get default
	configPath := filepath.Join(agentDeckDir, "config.toml")
	content := `
[notifications]
enabled = true
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}
	ClearUserConfigCache()

	settings := GetNotificationsSettings()
	if !settings.Enabled {
		t.Error("GetNotificationsSettings Enabled: should be true")
	}
	if settings.MaxShown != 6 {
		t.Errorf("GetNotificationsSettings MaxShown: should default to 6, got %d", settings.MaxShown)
	}
}

// ============================================================================
// SaveUserConfig Merge Behavior Tests
// ============================================================================

func TestSaveUserConfig_PreservesUnknownSections(t *testing.T) {
	// This test verifies that SaveUserConfig preserves sections not defined in
	// the UserConfig struct (like [desktop] from the desktop app).
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	defer os.Setenv("HOME", originalHome)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create initial config with a [desktop] section that UserConfig doesn't know about
	configPath := filepath.Join(agentDeckDir, "config.toml")
	initialContent := `# Agent Deck Configuration
default_tool = "claude"

[desktop]
auto_copy_on_select = true
font_size = 14
custom_setting = "preserve_me"

[logs]
max_size_mb = 10
`
	if err := os.WriteFile(configPath, []byte(initialContent), 0600); err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}
	ClearUserConfigCache()

	// Load the config (this ignores [desktop] since it's not in the struct)
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	// Modify a known field
	config.DefaultTool = "gemini"
	config.Logs.MaxSizeMB = 20

	// Save the config - this should preserve [desktop]
	if err := SaveUserConfig(config); err != nil {
		t.Fatalf("SaveUserConfig failed: %v", err)
	}

	// Read the raw file content to verify [desktop] is preserved
	savedContent, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read saved config: %v", err)
	}

	// Parse as generic map to check desktop section
	var savedMap map[string]interface{}
	if err := toml.Unmarshal(savedContent, &savedMap); err != nil {
		t.Fatalf("Failed to parse saved config: %v", err)
	}

	// Verify [desktop] section is preserved
	desktop, ok := savedMap["desktop"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected [desktop] section to be preserved, but it's missing")
	}

	// Verify desktop values are intact
	if autoCopy, ok := desktop["auto_copy_on_select"].(bool); !ok || !autoCopy {
		t.Errorf("Expected desktop.auto_copy_on_select = true, got %v", desktop["auto_copy_on_select"])
	}
	if fontSize, ok := desktop["font_size"].(int64); !ok || fontSize != 14 {
		t.Errorf("Expected desktop.font_size = 14, got %v", desktop["font_size"])
	}
	if customSetting, ok := desktop["custom_setting"].(string); !ok || customSetting != "preserve_me" {
		t.Errorf("Expected desktop.custom_setting = 'preserve_me', got %v", desktop["custom_setting"])
	}

	// Verify UserConfig fields were updated
	ClearUserConfigCache()
	reloaded, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}
	if reloaded.DefaultTool != "gemini" {
		t.Errorf("Expected default_tool = 'gemini', got %q", reloaded.DefaultTool)
	}
	if reloaded.Logs.MaxSizeMB != 20 {
		t.Errorf("Expected logs.max_size_mb = 20, got %d", reloaded.Logs.MaxSizeMB)
	}
}

func TestSaveUserConfig_OverwritesKnownSections(t *testing.T) {
	// Verify that known sections (defined in UserConfig struct) ARE overwritten
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	defer os.Setenv("HOME", originalHome)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create initial config with logs section
	configPath := filepath.Join(agentDeckDir, "config.toml")
	initialContent := `
[logs]
max_size_mb = 50
max_lines = 20000
remove_orphans = false
`
	if err := os.WriteFile(configPath, []byte(initialContent), 0600); err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}
	ClearUserConfigCache()

	// Create a new config with different logs values
	config := &UserConfig{
		Logs: LogSettings{
			MaxSizeMB:     10,
			MaxLines:      5000,
			RemoveOrphans: true,
		},
	}

	// Save - should completely replace [logs] section
	if err := SaveUserConfig(config); err != nil {
		t.Fatalf("SaveUserConfig failed: %v", err)
	}

	// Reload and verify
	ClearUserConfigCache()
	reloaded, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}

	if reloaded.Logs.MaxSizeMB != 10 {
		t.Errorf("Expected logs.max_size_mb = 10, got %d", reloaded.Logs.MaxSizeMB)
	}
	if reloaded.Logs.MaxLines != 5000 {
		t.Errorf("Expected logs.max_lines = 5000, got %d", reloaded.Logs.MaxLines)
	}
	if !reloaded.Logs.RemoveOrphans {
		t.Error("Expected logs.remove_orphans = true")
	}
}

func TestSaveUserConfig_CreatesNewFile(t *testing.T) {
	// Verify SaveUserConfig works when no config file exists
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	defer os.Setenv("HOME", originalHome)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Don't create config file - it shouldn't exist
	configPath := filepath.Join(agentDeckDir, "config.toml")
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatal("Config file should not exist before test")
	}

	config := &UserConfig{
		DefaultTool: "claude",
		Theme:       "light",
	}

	if err := SaveUserConfig(config); err != nil {
		t.Fatalf("SaveUserConfig failed: %v", err)
	}

	// Verify file was created
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		t.Fatal("Config file should have been created")
	}

	// Verify content
	ClearUserConfigCache()
	reloaded, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}
	if reloaded.DefaultTool != "claude" {
		t.Errorf("Expected default_tool = 'claude', got %q", reloaded.DefaultTool)
	}
	if reloaded.Theme != "light" {
		t.Errorf("Expected theme = 'light', got %q", reloaded.Theme)
	}
}

func TestSaveUserConfig_HandlesCorruptedExistingFile(t *testing.T) {
	// Verify SaveUserConfig handles a corrupted config.toml gracefully
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	defer os.Setenv("HOME", originalHome)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Write corrupted TOML content
	configPath := filepath.Join(agentDeckDir, "config.toml")
	corruptedContent := `this is not valid toml [[[
broken = syntax "unterminated
`
	if err := os.WriteFile(configPath, []byte(corruptedContent), 0600); err != nil {
		t.Fatalf("Failed to write corrupted config: %v", err)
	}

	config := &UserConfig{
		DefaultTool: "gemini",
	}

	// SaveUserConfig should succeed even with corrupted existing file
	// (it falls back to empty map when parsing fails)
	if err := SaveUserConfig(config); err != nil {
		t.Fatalf("SaveUserConfig failed on corrupted file: %v", err)
	}

	// Verify new content is valid
	ClearUserConfigCache()
	reloaded, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("Failed to reload config: %v", err)
	}
	if reloaded.DefaultTool != "gemini" {
		t.Errorf("Expected default_tool = 'gemini', got %q", reloaded.DefaultTool)
	}
}

func TestSaveUserConfig_PreservesComplexUnknownStructures(t *testing.T) {
	// Verify complex unknown structures are preserved: nested tables, arrays,
	// and top-level keys that might be added by future features or plugins.
	tempDir := t.TempDir()
	originalHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	defer os.Setenv("HOME", originalHome)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	configPath := filepath.Join(agentDeckDir, "config.toml")
	// Config with complex structures: nested tables, arrays, top-level unknown key
	initialContent := `# Header comment
custom_top_level_flag = true
default_tool = "claude"

[desktop]
auto_copy_on_select = true
font_size = 14
recent_projects = ["~/code/project1", "~/code/project2", "~/code/project3"]

[desktop.keybindings]
copy = "Cmd+C"
paste = "Cmd+V"
search = "Cmd+F"

[desktop.theme]
name = "dark"
accent_color = "#007ACC"
`
	if err := os.WriteFile(configPath, []byte(initialContent), 0600); err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}
	ClearUserConfigCache()

	config := &UserConfig{
		DefaultTool: "gemini",
	}

	if err := SaveUserConfig(config); err != nil {
		t.Fatalf("SaveUserConfig failed: %v", err)
	}

	// Read raw and verify complex structures preserved
	savedContent, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read saved config: %v", err)
	}

	var savedMap map[string]interface{}
	if err := toml.Unmarshal(savedContent, &savedMap); err != nil {
		t.Fatalf("Failed to parse saved config: %v", err)
	}

	// Verify top-level unknown key preserved
	if flag, ok := savedMap["custom_top_level_flag"].(bool); !ok || !flag {
		t.Errorf("Expected custom_top_level_flag = true, got %v", savedMap["custom_top_level_flag"])
	}

	// Verify known field was updated
	if defaultTool, ok := savedMap["default_tool"].(string); !ok || defaultTool != "gemini" {
		t.Errorf("Expected default_tool = 'gemini', got %v", savedMap["default_tool"])
	}

	// Verify [desktop] with array values preserved
	desktop, ok := savedMap["desktop"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected [desktop] section to be preserved")
	}

	// Check array value
	recentProjects, ok := desktop["recent_projects"].([]interface{})
	if !ok {
		t.Fatal("Expected desktop.recent_projects array to be preserved")
	}
	if len(recentProjects) != 3 {
		t.Errorf("Expected 3 recent_projects, got %d", len(recentProjects))
	}

	// Verify nested table [desktop.keybindings] preserved
	keybindings, ok := desktop["keybindings"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected [desktop.keybindings] nested table to be preserved")
	}
	if copy, ok := keybindings["copy"].(string); !ok || copy != "Cmd+C" {
		t.Errorf("Expected desktop.keybindings.copy = 'Cmd+C', got %v", keybindings["copy"])
	}
	if search, ok := keybindings["search"].(string); !ok || search != "Cmd+F" {
		t.Errorf("Expected desktop.keybindings.search = 'Cmd+F', got %v", keybindings["search"])
	}

	// Verify nested table [desktop.theme] preserved
	theme, ok := desktop["theme"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected [desktop.theme] nested table to be preserved")
	}
	if name, ok := theme["name"].(string); !ok || name != "dark" {
		t.Errorf("Expected desktop.theme.name = 'dark', got %v", theme["name"])
	}
	if color, ok := theme["accent_color"].(string); !ok || color != "#007ACC" {
		t.Errorf("Expected desktop.theme.accent_color = '#007ACC', got %v", theme["accent_color"])
	}
}
