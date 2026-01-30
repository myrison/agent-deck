package update

import (
	"testing"
	"time"
)

// =============================================================================
// CompareVersions Tests
// =============================================================================
// Tests the semantic version comparison used to determine if updates are available.
// This is critical for ensuring users are correctly notified of new versions.

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		name string
		v1   string
		v2   string
		want int
	}{
		// Equal versions
		{"equal simple", "1.0.0", "1.0.0", 0},
		{"equal with v prefix", "v1.0.0", "1.0.0", 0},
		{"equal both v prefix", "v2.1.0", "v2.1.0", 0},

		// v1 < v2 (update available)
		{"patch update", "1.0.0", "1.0.1", -1},
		{"minor update", "1.0.0", "1.1.0", -1},
		{"major update", "1.0.0", "2.0.0", -1},
		{"minor with v prefix", "v1.2.0", "v1.3.0", -1},
		{"complex update", "1.2.3", "1.2.4", -1},

		// v1 > v2 (downgrade/rollback)
		{"patch downgrade", "1.0.1", "1.0.0", 1},
		{"minor downgrade", "1.1.0", "1.0.0", 1},
		{"major downgrade", "2.0.0", "1.0.0", 1},
		{"complex downgrade", "2.1.0", "1.9.9", 1},

		// Partial versions (should be padded with zeros)
		{"short v1", "1.0", "1.0.0", 0},
		{"short v2", "1.0.0", "1.0", 0},
		{"short both", "1", "1.0.0", 0},
		{"short update needed", "1.0", "1.0.1", -1},

		// Edge cases
		{"zero versions", "0.0.0", "0.0.0", 0},
		{"zero to one", "0.0.0", "0.0.1", -1},
		{"high numbers", "10.20.30", "10.20.31", -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CompareVersions(tt.v1, tt.v2)
			if got != tt.want {
				t.Errorf("CompareVersions(%q, %q) = %d, want %d", tt.v1, tt.v2, got, tt.want)
			}
		})
	}
}

// TestCompareVersions_Symmetry verifies the comparison is antisymmetric:
// if CompareVersions(a, b) = 1, then CompareVersions(b, a) = -1
func TestCompareVersions_Symmetry(t *testing.T) {
	pairs := [][2]string{
		{"1.0.0", "2.0.0"},
		{"1.2.3", "1.2.4"},
		{"v0.9.0", "v1.0.0"},
	}

	for _, pair := range pairs {
		forward := CompareVersions(pair[0], pair[1])
		backward := CompareVersions(pair[1], pair[0])

		if forward == 0 && backward != 0 {
			t.Errorf("CompareVersions(%q, %q) = 0 but reverse = %d", pair[0], pair[1], backward)
		}
		if forward == 1 && backward != -1 {
			t.Errorf("CompareVersions(%q, %q) = 1 but reverse = %d (want -1)", pair[0], pair[1], backward)
		}
		if forward == -1 && backward != 1 {
			t.Errorf("CompareVersions(%q, %q) = -1 but reverse = %d (want 1)", pair[0], pair[1], backward)
		}
	}
}

// =============================================================================
// CheckForUpdate Tests
// =============================================================================
// Tests the fork's disabled update checking behavior.
// This fork disables auto-update to prevent accidental upgrades that would
// break custom functionality (desktop app, SSH support, etc.).

func TestCheckForUpdate_ForkBehavior(t *testing.T) {
	// The fork should always return "no update available" regardless of inputs
	tests := []struct {
		name           string
		currentVersion string
		forceCheck     bool
	}{
		{"normal check", "1.0.0", false},
		{"force check", "1.0.0", true},
		{"old version", "0.0.1", false},
		{"very old version forced", "0.0.1", true},
		{"dev version", "0.0.0-dev", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := CheckForUpdate(tt.currentVersion, tt.forceCheck)

			// Should never error
			if err != nil {
				t.Errorf("CheckForUpdate() error = %v, want nil", err)
			}

			// Should never report update available
			if info.Available {
				t.Error("CheckForUpdate() Available = true, want false (fork disables updates)")
			}

			// Should preserve current version in response
			if info.CurrentVersion != tt.currentVersion {
				t.Errorf("CheckForUpdate() CurrentVersion = %q, want %q", info.CurrentVersion, tt.currentVersion)
			}

			// LatestVersion should be empty (no API call made)
			if info.LatestVersion != "" {
				t.Errorf("CheckForUpdate() LatestVersion = %q, want empty (fork skips API)", info.LatestVersion)
			}
		})
	}
}

// TestCheckForUpdateAsync_ForkBehavior tests the async version also returns disabled state
func TestCheckForUpdateAsync_ForkBehavior(t *testing.T) {
	ch := CheckForUpdateAsync("1.0.0")

	// Should receive result quickly (no network call)
	select {
	case info := <-ch:
		if info.Available {
			t.Error("CheckForUpdateAsync() Available = true, want false")
		}
		if info.CurrentVersion != "1.0.0" {
			t.Errorf("CheckForUpdateAsync() CurrentVersion = %q, want %q", info.CurrentVersion, "1.0.0")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("CheckForUpdateAsync() timed out - should return immediately for fork")
	}
}

// =============================================================================
// SetCheckInterval Tests
// =============================================================================

func TestSetCheckInterval(t *testing.T) {
	// Save original and restore after test
	original := checkInterval
	defer func() { checkInterval = original }()

	tests := []struct {
		name  string
		hours int
		want  time.Duration
	}{
		{"positive hours", 2, 2 * time.Hour},
		{"one hour", 1, 1 * time.Hour},
		{"large value", 24, 24 * time.Hour},
		{"zero keeps default", 0, original}, // 0 should not change
		{"negative keeps default", -1, original},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset to original before each test
			checkInterval = original
			SetCheckInterval(tt.hours)

			if checkInterval != tt.want {
				t.Errorf("SetCheckInterval(%d): checkInterval = %v, want %v", tt.hours, checkInterval, tt.want)
			}
		})
	}
}
