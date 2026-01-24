package ui

import (
	"os/exec"
	"runtime"
	"strings"
)

// DetectSystemTheme returns "dark" or "light" based on OS settings.
// Falls back to "dark" if detection fails.
func DetectSystemTheme() string {
	switch runtime.GOOS {
	case "darwin":
		return detectMacOSTheme()
	case "linux":
		return detectLinuxTheme()
	default:
		return "dark" // Default fallback for Windows and others
	}
}

// detectMacOSTheme checks AppleInterfaceStyle for dark mode
func detectMacOSTheme() string {
	cmd := exec.Command("defaults", "read", "-g", "AppleInterfaceStyle")
	output, err := cmd.Output()
	if err != nil {
		// Key doesn't exist when in light mode
		return "light"
	}
	if strings.TrimSpace(string(output)) == "Dark" {
		return "dark"
	}
	return "light"
}

// detectLinuxTheme checks GNOME/GTK settings for dark mode
func detectLinuxTheme() string {
	// Try GNOME color-scheme first (GNOME 42+)
	cmd := exec.Command("gsettings", "get", "org.gnome.desktop.interface", "color-scheme")
	output, err := cmd.Output()
	if err == nil {
		lower := strings.ToLower(string(output))
		if strings.Contains(lower, "dark") {
			return "dark"
		}
		if strings.Contains(lower, "light") {
			return "light"
		}
	}

	// Fallback: check GTK theme name for "dark" suffix
	cmd = exec.Command("gsettings", "get", "org.gnome.desktop.interface", "gtk-theme")
	output, err = cmd.Output()
	if err == nil && strings.Contains(strings.ToLower(string(output)), "dark") {
		return "dark"
	}

	// Default to dark on Linux
	return "dark"
}
