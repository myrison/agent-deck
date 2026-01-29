package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopSettingsGetThemeDefault(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Default theme should be "dark"
	theme, err := dsm.GetTheme()
	if err != nil {
		t.Fatalf("GetTheme failed: %v", err)
	}
	if theme != "dark" {
		t.Errorf("Expected default theme 'dark', got '%s'", theme)
	}
}

func TestDesktopSettingsSetTheme(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set theme to light
	err := dsm.SetTheme("light")
	if err != nil {
		t.Fatalf("SetTheme('light') failed: %v", err)
	}

	// Verify it was saved
	theme, err := dsm.GetTheme()
	if err != nil {
		t.Fatalf("GetTheme failed: %v", err)
	}
	if theme != "light" {
		t.Errorf("Expected theme 'light', got '%s'", theme)
	}

	// Set theme to dark
	err = dsm.SetTheme("dark")
	if err != nil {
		t.Fatalf("SetTheme('dark') failed: %v", err)
	}

	theme, _ = dsm.GetTheme()
	if theme != "dark" {
		t.Errorf("Expected theme 'dark', got '%s'", theme)
	}

	// Set theme to auto
	err = dsm.SetTheme("auto")
	if err != nil {
		t.Fatalf("SetTheme('auto') failed: %v", err)
	}

	theme, _ = dsm.GetTheme()
	if theme != "auto" {
		t.Errorf("Expected theme 'auto', got '%s'", theme)
	}
}

func TestDesktopSettingsThemeToggle(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Simulate toggle behavior: dark -> light -> dark
	theme, _ := dsm.GetTheme()
	if theme != "dark" {
		t.Fatalf("Expected initial theme 'dark', got '%s'", theme)
	}

	// Toggle to light
	newTheme := "light"
	if theme == "light" {
		newTheme = "dark"
	}
	err := dsm.SetTheme(newTheme)
	if err != nil {
		t.Fatalf("SetTheme toggle failed: %v", err)
	}

	theme, _ = dsm.GetTheme()
	if theme != "light" {
		t.Errorf("Expected theme 'light' after toggle, got '%s'", theme)
	}

	// Toggle back to dark
	newTheme = "dark"
	if theme == "dark" {
		newTheme = "light"
	}
	err = dsm.SetTheme(newTheme)
	if err != nil {
		t.Fatalf("SetTheme toggle failed: %v", err)
	}

	theme, _ = dsm.GetTheme()
	if theme != "dark" {
		t.Errorf("Expected theme 'dark' after toggle, got '%s'", theme)
	}
}

func TestDesktopSettingsInvalidTheme(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Invalid theme should default to "dark"
	err := dsm.SetTheme("invalid-theme")
	if err != nil {
		t.Fatalf("SetTheme('invalid') failed: %v", err)
	}

	theme, _ := dsm.GetTheme()
	if theme != "dark" {
		t.Errorf("Expected invalid theme to default to 'dark', got '%s'", theme)
	}
}

func TestDesktopSettingsThemePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	// Create first manager, set theme
	dsm1 := &DesktopSettingsManager{configPath: configPath}
	err := dsm1.SetTheme("light")
	if err != nil {
		t.Fatalf("SetTheme failed: %v", err)
	}

	// Create new manager (simulating app restart), verify theme persisted
	dsm2 := &DesktopSettingsManager{configPath: configPath}
	theme, err := dsm2.GetTheme()
	if err != nil {
		t.Fatalf("GetTheme failed: %v", err)
	}
	if theme != "light" {
		t.Errorf("Expected persisted theme 'light', got '%s'", theme)
	}
}

func TestDesktopSettingsPreservesOtherSettings(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	// Write initial config with other settings
	initialConfig := `
[project_discovery]
scan_paths = ["~/projects"]

[desktop]
theme = "dark"

[desktop.terminal]
soft_newline = "shift_enter"
font_size = 16
scroll_speed = 120
`
	err := os.WriteFile(configPath, []byte(initialConfig), 0600)
	if err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Change theme
	err = dsm.SetTheme("light")
	if err != nil {
		t.Fatalf("SetTheme failed: %v", err)
	}

	// Read back config and verify other settings preserved
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read config: %v", err)
	}

	content := string(data)
	if !strings.Contains(content, "project_discovery") {
		t.Error("project_discovery section was lost")
	}
	if !strings.Contains(content, "scan_paths") {
		t.Error("scan_paths setting was lost")
	}
}

func TestDesktopSettingsThemeCaseInsensitive(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Test case insensitivity
	testCases := []struct {
		input    string
		expected string
	}{
		{"DARK", "dark"},
		{"Light", "light"},
		{"AUTO", "auto"},
		{"  dark  ", "dark"},
		{"LIGHT", "light"},
	}

	for _, tc := range testCases {
		err := dsm.SetTheme(tc.input)
		if err != nil {
			t.Fatalf("SetTheme('%s') failed: %v", tc.input, err)
		}

		theme, _ := dsm.GetTheme()
		if theme != tc.expected {
			t.Errorf("SetTheme('%s'): expected '%s', got '%s'", tc.input, tc.expected, theme)
		}
	}
}

func TestGetSetupDismissedDefault(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Default should be false (setup not dismissed)
	dismissed, err := dsm.GetSetupDismissed()
	if err != nil {
		t.Fatalf("GetSetupDismissed failed: %v", err)
	}
	if dismissed {
		t.Error("Expected default SetupDismissed to be false")
	}
}

func TestSetSetupDismissedRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Dismiss the setup
	err := dsm.SetSetupDismissed(true)
	if err != nil {
		t.Fatalf("SetSetupDismissed(true) failed: %v", err)
	}

	dismissed, err := dsm.GetSetupDismissed()
	if err != nil {
		t.Fatalf("GetSetupDismissed failed: %v", err)
	}
	if !dismissed {
		t.Error("Expected SetupDismissed to be true after setting it")
	}

	// Reset the dismissed flag
	err = dsm.SetSetupDismissed(false)
	if err != nil {
		t.Fatalf("SetSetupDismissed(false) failed: %v", err)
	}

	dismissed, _ = dsm.GetSetupDismissed()
	if dismissed {
		t.Error("Expected SetupDismissed to be false after resetting")
	}
}

func TestSetupDismissedPreservesOtherSettings(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set theme first
	err := dsm.SetTheme("light")
	if err != nil {
		t.Fatalf("SetTheme failed: %v", err)
	}

	// Now set setup dismissed
	err = dsm.SetSetupDismissed(true)
	if err != nil {
		t.Fatalf("SetSetupDismissed failed: %v", err)
	}

	// Verify theme is still correct
	theme, err := dsm.GetTheme()
	if err != nil {
		t.Fatalf("GetTheme failed: %v", err)
	}
	if theme != "light" {
		t.Errorf("Expected theme 'light' preserved after SetSetupDismissed, got '%s'", theme)
	}

	// Verify dismissed is still set
	dismissed, _ := dsm.GetSetupDismissed()
	if !dismissed {
		t.Error("Expected SetupDismissed still true after verifying theme")
	}
}

// =============================================================================
// File-Based Activity Detection Settings Tests
// =============================================================================

// TestFileBasedActivityDetectionDefaultEnabled verifies that file-based activity
// detection defaults to enabled when no config exists for better status detection
// reliability.
func TestFileBasedActivityDetectionDefaultEnabled(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Default should be true (enabled)
	enabled, err := dsm.GetFileBasedActivityDetection()
	if err != nil {
		t.Fatalf("GetFileBasedActivityDetection failed: %v", err)
	}
	if !enabled {
		t.Error("Expected default FileBasedActivityDetection to be true (enabled)")
	}
}

// TestFileBasedActivityDetectionRoundTrip verifies that the setting can be
// toggled on and off and persists correctly across manager instances.
func TestFileBasedActivityDetectionRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Disable the feature
	err := dsm.SetFileBasedActivityDetection(false)
	if err != nil {
		t.Fatalf("SetFileBasedActivityDetection(false) failed: %v", err)
	}

	enabled, err := dsm.GetFileBasedActivityDetection()
	if err != nil {
		t.Fatalf("GetFileBasedActivityDetection failed: %v", err)
	}
	if enabled {
		t.Error("Expected FileBasedActivityDetection to be false after disabling")
	}

	// Re-enable the feature
	err = dsm.SetFileBasedActivityDetection(true)
	if err != nil {
		t.Fatalf("SetFileBasedActivityDetection(true) failed: %v", err)
	}

	enabled, _ = dsm.GetFileBasedActivityDetection()
	if !enabled {
		t.Error("Expected FileBasedActivityDetection to be true after re-enabling")
	}
}

// TestFileBasedActivityDetectionPersistence verifies that the setting persists
// across manager instances (simulating app restart).
func TestFileBasedActivityDetectionPersistence(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	// First manager: disable the feature
	dsm1 := &DesktopSettingsManager{configPath: configPath}
	err := dsm1.SetFileBasedActivityDetection(false)
	if err != nil {
		t.Fatalf("SetFileBasedActivityDetection failed: %v", err)
	}

	// Second manager (simulating app restart): verify setting persisted
	dsm2 := &DesktopSettingsManager{configPath: configPath}
	enabled, err := dsm2.GetFileBasedActivityDetection()
	if err != nil {
		t.Fatalf("GetFileBasedActivityDetection failed: %v", err)
	}
	if enabled {
		t.Error("Expected FileBasedActivityDetection to remain false after 'restart'")
	}
}

// TestFileBasedActivityDetectionPreservesOtherSettings verifies that toggling
// this setting doesn't affect other settings like theme or font size.
func TestFileBasedActivityDetectionPreservesOtherSettings(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set theme and font size first
	dsm.SetTheme("light")
	dsm.SetFontSize(18)

	// Toggle file-based detection
	dsm.SetFileBasedActivityDetection(false)

	// Verify other settings preserved
	theme, _ := dsm.GetTheme()
	if theme != "light" {
		t.Errorf("Expected theme 'light' preserved, got '%s'", theme)
	}

	fontSize, _ := dsm.GetFontSize()
	if fontSize != 18 {
		t.Errorf("Expected fontSize 18 preserved, got %d", fontSize)
	}
}

// =============================================================================
// Scrollback Buffer Size Settings Tests
// =============================================================================

// TestGetScrollbackDefault verifies that GetScrollback returns 50000 when no
// config exists (default value for xterm.js scrollback buffer).
func TestGetScrollbackDefault(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	scrollback, err := dsm.GetScrollback()
	if err != nil {
		t.Fatalf("GetScrollback failed: %v", err)
	}
	if scrollback != 50000 {
		t.Errorf("Expected default scrollback 50000, got %d", scrollback)
	}
}

// TestSetScrollbackRoundTrip verifies that SetScrollback persists the value
// and GetScrollback retrieves it correctly.
func TestSetScrollbackRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set to a valid value within range
	err := dsm.SetScrollback(50000)
	if err != nil {
		t.Fatalf("SetScrollback(50000) failed: %v", err)
	}

	scrollback, err := dsm.GetScrollback()
	if err != nil {
		t.Fatalf("GetScrollback failed: %v", err)
	}
	if scrollback != 50000 {
		t.Errorf("Expected scrollback 50000, got %d", scrollback)
	}
}

// TestSetScrollbackClampsToMinimum verifies that values below 1000 are clamped
// to the minimum valid value of 1000.
func TestSetScrollbackClampsToMinimum(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set to below minimum
	err := dsm.SetScrollback(500)
	if err != nil {
		t.Fatalf("SetScrollback(500) failed: %v", err)
	}

	scrollback, _ := dsm.GetScrollback()
	if scrollback != 1000 {
		t.Errorf("Expected scrollback clamped to 1000, got %d", scrollback)
	}

	// Test with zero
	err = dsm.SetScrollback(0)
	if err != nil {
		t.Fatalf("SetScrollback(0) failed: %v", err)
	}

	scrollback, _ = dsm.GetScrollback()
	if scrollback != 1000 {
		t.Errorf("Expected scrollback clamped to 1000 for zero input, got %d", scrollback)
	}

	// Test with negative
	err = dsm.SetScrollback(-100)
	if err != nil {
		t.Fatalf("SetScrollback(-100) failed: %v", err)
	}

	scrollback, _ = dsm.GetScrollback()
	if scrollback != 1000 {
		t.Errorf("Expected scrollback clamped to 1000 for negative input, got %d", scrollback)
	}
}

// TestSetScrollbackClampsToMaximum verifies that values above 100000 are clamped
// to the maximum valid value of 100000.
func TestSetScrollbackClampsToMaximum(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set to above maximum
	err := dsm.SetScrollback(200000)
	if err != nil {
		t.Fatalf("SetScrollback(200000) failed: %v", err)
	}

	scrollback, _ := dsm.GetScrollback()
	if scrollback != 100000 {
		t.Errorf("Expected scrollback clamped to 100000, got %d", scrollback)
	}
}

// TestScrollbackPersistence verifies that the scrollback setting persists
// across manager instances (simulating app restart).
func TestScrollbackPersistence(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	// First manager: set scrollback
	dsm1 := &DesktopSettingsManager{configPath: configPath}
	err := dsm1.SetScrollback(75000)
	if err != nil {
		t.Fatalf("SetScrollback failed: %v", err)
	}

	// Second manager (simulating app restart): verify setting persisted
	dsm2 := &DesktopSettingsManager{configPath: configPath}
	scrollback, err := dsm2.GetScrollback()
	if err != nil {
		t.Fatalf("GetScrollback failed: %v", err)
	}
	if scrollback != 75000 {
		t.Errorf("Expected scrollback 75000 after 'restart', got %d", scrollback)
	}
}

// TestScrollbackPreservesOtherSettings verifies that setting scrollback doesn't
// affect other settings like theme, font size, or scroll speed.
func TestScrollbackPreservesOtherSettings(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set multiple settings first
	dsm.SetTheme("light")
	dsm.SetFontSize(18)
	dsm.SetScrollSpeed(150)

	// Now set scrollback
	err := dsm.SetScrollback(25000)
	if err != nil {
		t.Fatalf("SetScrollback failed: %v", err)
	}

	// Verify other settings preserved
	theme, _ := dsm.GetTheme()
	if theme != "light" {
		t.Errorf("Expected theme 'light' preserved, got '%s'", theme)
	}

	fontSize, _ := dsm.GetFontSize()
	if fontSize != 18 {
		t.Errorf("Expected fontSize 18 preserved, got %d", fontSize)
	}

	scrollSpeed, _ := dsm.GetScrollSpeed()
	if scrollSpeed != 150 {
		t.Errorf("Expected scrollSpeed 150 preserved, got %d", scrollSpeed)
	}
}

// TestScrollbackBoundaryValues verifies exact boundary behavior at min/max edges.
func TestScrollbackBoundaryValues(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	testCases := []struct {
		input    int
		expected int
		name     string
	}{
		{999, 1000, "just below minimum"},
		{1000, 1000, "exact minimum"},
		{1001, 1001, "just above minimum"},
		{99999, 99999, "just below maximum"},
		{100000, 100000, "exact maximum"},
		{100001, 100000, "just above maximum"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := dsm.SetScrollback(tc.input)
			if err != nil {
				t.Fatalf("SetScrollback(%d) failed: %v", tc.input, err)
			}

			scrollback, _ := dsm.GetScrollback()
			if scrollback != tc.expected {
				t.Errorf("SetScrollback(%d): expected %d, got %d", tc.input, tc.expected, scrollback)
			}
		})
	}
}

// TestGetTerminalConfigIncludesScrollback verifies that GetTerminalConfig returns
// the scrollback setting as part of the full terminal configuration.
func TestGetTerminalConfigIncludesScrollback(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	dsm := &DesktopSettingsManager{configPath: configPath}

	// Set a custom scrollback value
	dsm.SetScrollback(30000)

	// Get full terminal config
	termConfig, err := dsm.GetTerminalConfig()
	if err != nil {
		t.Fatalf("GetTerminalConfig failed: %v", err)
	}

	if termConfig.Scrollback != 30000 {
		t.Errorf("Expected TerminalConfig.Scrollback 30000, got %d", termConfig.Scrollback)
	}
}

// TestLoadDesktopSettingsValidatesScrollback verifies that loading a config with
// invalid scrollback values normalizes them to valid range.
func TestLoadDesktopSettingsValidatesScrollback(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")

	// Write config with invalid scrollback (below minimum)
	invalidConfig := `
[desktop]
theme = "dark"

[desktop.terminal]
scrollback = 500
`
	err := os.WriteFile(configPath, []byte(invalidConfig), 0600)
	if err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	dsm := &DesktopSettingsManager{configPath: configPath}
	scrollback, err := dsm.GetScrollback()
	if err != nil {
		t.Fatalf("GetScrollback failed: %v", err)
	}
	if scrollback != 1000 {
		t.Errorf("Expected scrollback clamped to 1000 on load, got %d", scrollback)
	}

	// Test with value above maximum
	invalidConfig = `
[desktop]
theme = "dark"

[desktop.terminal]
scrollback = 999999
`
	err = os.WriteFile(configPath, []byte(invalidConfig), 0600)
	if err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	scrollback, err = dsm.GetScrollback()
	if err != nil {
		t.Fatalf("GetScrollback failed: %v", err)
	}
	if scrollback != 100000 {
		t.Errorf("Expected scrollback clamped to 100000 on load, got %d", scrollback)
	}
}
