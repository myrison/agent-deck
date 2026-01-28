package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

// GroupSettings stores desktop-specific group expand/collapse state
type GroupSettings struct {
	ExpandedGroups map[string]bool `json:"expandedGroups"`
}

// DesktopConfig represents the [desktop] section of config.toml
type DesktopConfig struct {
	Theme          string         `toml:"theme"`           // "dark", "light", or "auto"
	Terminal       TerminalConfig `toml:"terminal"`        // Terminal behavior settings
	SetupDismissed bool           `toml:"setup_dismissed"` // Whether first-launch setup was dismissed
}

// TerminalConfig represents terminal input behavior settings
type TerminalConfig struct {
	// SoftNewline controls how to insert a newline without executing
	// Options: "shift_enter" (default), "alt_enter", "both", "disabled"
	SoftNewline string `toml:"soft_newline"`
	// FontSize controls the terminal font size in pixels
	// Range: 8-32, Default: 14
	FontSize int `toml:"font_size"`
	// ScrollSpeed controls mouse/trackpad scroll speed as a percentage
	// Range: 50-250, Default: 100 (100% = normal speed)
	ScrollSpeed int `toml:"scroll_speed"`
	// ClickToCursor enables experimental click-to-position cursor feature
	// When enabled and in alt-screen mode (nano/vim), clicking sends arrow keys
	// to move the cursor to the clicked position. Default: false
	ClickToCursor bool `toml:"click_to_cursor"`
	// AutoCopyOnSelect enables automatic clipboard copy when text is selected
	// Similar to Kitty terminal behavior. Default: false
	AutoCopyOnSelect bool `toml:"auto_copy_on_select"`
	// ShowActivityRibbon shows a thin indicator below each tab displaying wait time
	// Shows how long the agent has been waiting for input. Default: true
	ShowActivityRibbon *bool `toml:"show_activity_ribbon"`
	// FileBasedActivityDetection uses session file mtime instead of visual detection
	// More reliable for Claude/Gemini. Not supported for OpenCode. Default: true
	FileBasedActivityDetection *bool `toml:"file_based_activity_detection"`
}

// DesktopSettingsManager manages desktop-specific settings in config.toml
type DesktopSettingsManager struct {
	configPath string
}

// NewDesktopSettingsManager creates a new desktop settings manager
func NewDesktopSettingsManager() *DesktopSettingsManager {
	home, _ := os.UserHomeDir()
	return &DesktopSettingsManager{
		configPath: filepath.Join(home, ".agent-deck", "config.toml"),
	}
}

// fullConfig represents the entire config.toml structure we care about
type fullConfig struct {
	Desktop DesktopConfig `toml:"desktop"`
	// Other sections are preserved as raw TOML
}

// loadDesktopSettings loads the desktop section from config.toml
func (dsm *DesktopSettingsManager) loadDesktopSettings() (*DesktopConfig, error) {
	defaults := &DesktopConfig{
		Theme: "dark",
		Terminal: TerminalConfig{
			SoftNewline: "both", // Both Shift+Enter and Alt+Enter by default
			FontSize:    14,     // Default font size
			ScrollSpeed: 100,    // Default scroll speed (100%)
		},
	}

	data, err := os.ReadFile(dsm.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return defaults, nil
		}
		return nil, err
	}

	var config fullConfig
	if err := toml.Unmarshal(data, &config); err != nil {
		return defaults, nil // Return defaults on parse error
	}

	// Apply defaults for empty values
	if config.Desktop.Theme == "" {
		config.Desktop.Theme = "dark"
	}

	// Validate theme value
	switch config.Desktop.Theme {
	case "dark", "light", "auto":
		// Valid
	default:
		config.Desktop.Theme = "dark"
	}

	// Validate and apply defaults for terminal settings
	if config.Desktop.Terminal.SoftNewline == "" {
		config.Desktop.Terminal.SoftNewline = "both"
	}
	switch config.Desktop.Terminal.SoftNewline {
	case "shift_enter", "alt_enter", "both", "disabled":
		// Valid
	default:
		config.Desktop.Terminal.SoftNewline = "both"
	}

	// Validate and apply defaults for font size (8-32, default 14)
	if config.Desktop.Terminal.FontSize == 0 {
		config.Desktop.Terminal.FontSize = 14
	} else if config.Desktop.Terminal.FontSize < 8 {
		config.Desktop.Terminal.FontSize = 8
	} else if config.Desktop.Terminal.FontSize > 32 {
		config.Desktop.Terminal.FontSize = 32
	}

	// Validate and apply defaults for scroll speed (50-250, default 100)
	if config.Desktop.Terminal.ScrollSpeed == 0 {
		config.Desktop.Terminal.ScrollSpeed = 100
	} else if config.Desktop.Terminal.ScrollSpeed < 50 {
		config.Desktop.Terminal.ScrollSpeed = 50
	} else if config.Desktop.Terminal.ScrollSpeed > 250 {
		config.Desktop.Terminal.ScrollSpeed = 250
	}

	// Apply default for ShowActivityRibbon (enabled by default)
	if config.Desktop.Terminal.ShowActivityRibbon == nil {
		enabled := true
		config.Desktop.Terminal.ShowActivityRibbon = &enabled
	}

	// Apply default for FileBasedActivityDetection (enabled by default)
	if config.Desktop.Terminal.FileBasedActivityDetection == nil {
		enabled := true
		config.Desktop.Terminal.FileBasedActivityDetection = &enabled
	}

	return &config.Desktop, nil
}

// saveDesktopSettings saves the desktop config, preserving other sections
func (dsm *DesktopSettingsManager) saveDesktopSettings(desktop *DesktopConfig) error {
	// Read existing config to preserve other sections
	existingData, _ := os.ReadFile(dsm.configPath)

	// Parse existing config into a map to preserve unknown sections
	var existingConfig map[string]interface{}
	if len(existingData) > 0 {
		if err := toml.Unmarshal(existingData, &existingConfig); err != nil {
			existingConfig = make(map[string]interface{})
		}
	} else {
		existingConfig = make(map[string]interface{})
	}

	// Build terminal config with optional fields
	terminalConfig := map[string]interface{}{
		"soft_newline":        desktop.Terminal.SoftNewline,
		"font_size":           desktop.Terminal.FontSize,
		"scroll_speed":        desktop.Terminal.ScrollSpeed,
		"click_to_cursor":     desktop.Terminal.ClickToCursor,
		"auto_copy_on_select": desktop.Terminal.AutoCopyOnSelect,
	}
	if desktop.Terminal.ShowActivityRibbon != nil {
		terminalConfig["show_activity_ribbon"] = *desktop.Terminal.ShowActivityRibbon
	}
	if desktop.Terminal.FileBasedActivityDetection != nil {
		terminalConfig["file_based_activity_detection"] = *desktop.Terminal.FileBasedActivityDetection
	}

	// Update the desktop section
	existingConfig["desktop"] = map[string]interface{}{
		"theme":           desktop.Theme,
		"setup_dismissed": desktop.SetupDismissed,
		"terminal":        terminalConfig,
	}

	// Ensure directory exists
	dir := filepath.Dir(dsm.configPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	// Encode to TOML
	var buf bytes.Buffer

	// Check if file existed and had content
	if len(existingData) == 0 {
		buf.WriteString("# Agent Deck Configuration\n\n")
	}

	if err := toml.NewEncoder(&buf).Encode(existingConfig); err != nil {
		return err
	}

	return os.WriteFile(dsm.configPath, buf.Bytes(), 0600)
}

// GetTheme returns the current desktop theme preference
func (dsm *DesktopSettingsManager) GetTheme() (string, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return "dark", err
	}
	return config.Theme, nil
}

// SetTheme sets the desktop theme preference
func (dsm *DesktopSettingsManager) SetTheme(theme string) error {
	// Validate theme
	theme = strings.ToLower(strings.TrimSpace(theme))
	switch theme {
	case "dark", "light", "auto":
		// Valid
	default:
		theme = "dark"
	}

	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{}
	}

	config.Theme = theme
	return dsm.saveDesktopSettings(config)
}

// GetSoftNewline returns the soft newline key preference
// Returns: "shift_enter", "alt_enter", "both", or "disabled"
func (dsm *DesktopSettingsManager) GetSoftNewline() (string, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return "both", err
	}
	return config.Terminal.SoftNewline, nil
}

// SetSoftNewline sets the soft newline key preference
func (dsm *DesktopSettingsManager) SetSoftNewline(mode string) error {
	// Validate mode
	mode = strings.ToLower(strings.TrimSpace(mode))
	switch mode {
	case "shift_enter", "alt_enter", "both", "disabled":
		// Valid
	default:
		mode = "both"
	}

	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.SoftNewline = mode
	return dsm.saveDesktopSettings(config)
}

// GetTerminalConfig returns the full terminal configuration
func (dsm *DesktopSettingsManager) GetTerminalConfig() (*TerminalConfig, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return &TerminalConfig{SoftNewline: "both", FontSize: 14, ScrollSpeed: 100}, err
	}
	return &config.Terminal, nil
}

// GetFontSize returns the terminal font size
// Returns: 8-32, default 14
func (dsm *DesktopSettingsManager) GetFontSize() (int, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return 14, err
	}
	return config.Terminal.FontSize, nil
}

// SetFontSize sets the terminal font size
// Valid range: 8-32
func (dsm *DesktopSettingsManager) SetFontSize(size int) error {
	// Clamp to valid range
	if size < 8 {
		size = 8
	} else if size > 32 {
		size = 32
	}

	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.FontSize = size
	return dsm.saveDesktopSettings(config)
}

// GetScrollSpeed returns the terminal scroll speed percentage
// Returns: 50-250, default 100
func (dsm *DesktopSettingsManager) GetScrollSpeed() (int, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return 100, err
	}
	return config.Terminal.ScrollSpeed, nil
}

// SetScrollSpeed sets the terminal scroll speed percentage
// Valid range: 50-250 (100 = normal speed)
func (dsm *DesktopSettingsManager) SetScrollSpeed(speed int) error {
	// Clamp to valid range
	if speed < 50 {
		speed = 50
	} else if speed > 250 {
		speed = 250
	}

	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.ScrollSpeed = speed
	return dsm.saveDesktopSettings(config)
}

// GetClickToCursor returns whether click-to-cursor is enabled
// This is an experimental feature for positioning cursor in nano/vim
func (dsm *DesktopSettingsManager) GetClickToCursor() (bool, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return false, err
	}
	return config.Terminal.ClickToCursor, nil
}

// SetClickToCursor enables or disables click-to-cursor feature
func (dsm *DesktopSettingsManager) SetClickToCursor(enabled bool) error {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.ClickToCursor = enabled
	return dsm.saveDesktopSettings(config)
}

// GetAutoCopyOnSelect returns whether auto-copy on select is enabled
// This feature automatically copies selected text to clipboard.
func (dsm *DesktopSettingsManager) GetAutoCopyOnSelect() (bool, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return false, err
	}
	return config.Terminal.AutoCopyOnSelect, nil
}

// SetAutoCopyOnSelect enables or disables auto-copy on select feature
func (dsm *DesktopSettingsManager) SetAutoCopyOnSelect(enabled bool) error {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.AutoCopyOnSelect = enabled
	return dsm.saveDesktopSettings(config)
}

// GetShowActivityRibbon returns whether the activity ribbon is enabled.
// The activity ribbon shows wait time below each session tab. Enabled by default.
func (dsm *DesktopSettingsManager) GetShowActivityRibbon() (bool, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return true, err // Default to enabled
	}
	if config.Terminal.ShowActivityRibbon == nil {
		return true, nil // Default to enabled
	}
	return *config.Terminal.ShowActivityRibbon, nil
}

// SetShowActivityRibbon enables or disables the activity ribbon on session tabs.
func (dsm *DesktopSettingsManager) SetShowActivityRibbon(enabled bool) error {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.ShowActivityRibbon = &enabled
	return dsm.saveDesktopSettings(config)
}

// GetFileBasedActivityDetection returns whether file-based activity detection is enabled.
// Uses session file modification time instead of visual detection. Default: true (enabled).
// More reliable for Claude/Gemini. Not supported for OpenCode.
func (dsm *DesktopSettingsManager) GetFileBasedActivityDetection() (bool, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return true, err // Default to enabled
	}
	if config.Terminal.FileBasedActivityDetection == nil {
		return true, nil // Default to enabled
	}
	return *config.Terminal.FileBasedActivityDetection, nil
}

// SetFileBasedActivityDetection enables or disables file-based activity detection.
func (dsm *DesktopSettingsManager) SetFileBasedActivityDetection(enabled bool) error {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.Terminal.FileBasedActivityDetection = &enabled
	return dsm.saveDesktopSettings(config)
}

// GetSetupDismissed returns whether the first-launch setup modal was dismissed
func (dsm *DesktopSettingsManager) GetSetupDismissed() (bool, error) {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		return false, err
	}
	return config.SetupDismissed, nil
}

// SetSetupDismissed sets whether the first-launch setup was dismissed
func (dsm *DesktopSettingsManager) SetSetupDismissed(dismissed bool) error {
	config, err := dsm.loadDesktopSettings()
	if err != nil {
		config = &DesktopConfig{
			Theme: "dark",
			Terminal: TerminalConfig{
				SoftNewline: "both",
				FontSize:    14,
				ScrollSpeed: 100,
			},
		}
	}

	config.SetupDismissed = dismissed
	return dsm.saveDesktopSettings(config)
}

// getGroupSettingsPath returns the path to the group settings JSON file
func (dsm *DesktopSettingsManager) getGroupSettingsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".agent-deck", "desktop-group-settings.json")
}

// loadGroupSettings loads the group settings from the JSON file
func (dsm *DesktopSettingsManager) loadGroupSettings() (*GroupSettings, error) {
	settingsPath := dsm.getGroupSettingsPath()
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &GroupSettings{ExpandedGroups: make(map[string]bool)}, nil
		}
		return nil, err
	}

	var settings GroupSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return &GroupSettings{ExpandedGroups: make(map[string]bool)}, nil
	}

	if settings.ExpandedGroups == nil {
		settings.ExpandedGroups = make(map[string]bool)
	}

	return &settings, nil
}

// saveGroupSettings saves the group settings to the JSON file
func (dsm *DesktopSettingsManager) saveGroupSettings(settings *GroupSettings) error {
	settingsPath := dsm.getGroupSettingsPath()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(settingsPath), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(settingsPath, data, 0600)
}

// GetExpandedGroups returns the map of group paths to their expanded state.
// Returns only paths that have been explicitly set in the desktop app.
// Groups not in this map should use their TUI default state.
func (dsm *DesktopSettingsManager) GetExpandedGroups() (map[string]bool, error) {
	settings, err := dsm.loadGroupSettings()
	if err != nil {
		return make(map[string]bool), err
	}
	return settings.ExpandedGroups, nil
}

// SetGroupExpanded sets the expanded state for a specific group path.
func (dsm *DesktopSettingsManager) SetGroupExpanded(path string, expanded bool) error {
	settings, err := dsm.loadGroupSettings()
	if err != nil {
		settings = &GroupSettings{ExpandedGroups: make(map[string]bool)}
	}

	settings.ExpandedGroups[path] = expanded
	return dsm.saveGroupSettings(settings)
}

// ResetGroupSettings clears all desktop-specific group expand/collapse overrides.
// After reset, groups will use their TUI default expand states.
func (dsm *DesktopSettingsManager) ResetGroupSettings() error {
	settings := &GroupSettings{ExpandedGroups: make(map[string]bool)}
	return dsm.saveGroupSettings(settings)
}

// SetAllGroupsExpanded sets the expanded state for all provided group paths.
// This is more efficient than calling SetGroupExpanded multiple times.
func (dsm *DesktopSettingsManager) SetAllGroupsExpanded(groupPaths []string, expanded bool) error {
	settings, err := dsm.loadGroupSettings()
	if err != nil {
		settings = &GroupSettings{ExpandedGroups: make(map[string]bool)}
	}

	for _, path := range groupPaths {
		settings.ExpandedGroups[path] = expanded
	}

	return dsm.saveGroupSettings(settings)
}
