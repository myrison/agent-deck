package session

import (
	"os"
	"path/filepath"
	"testing"
)

// setupSSHHostConfig creates a temp HOME with a config.toml containing SSH host definitions.
// It returns a cleanup function that restores the original HOME and clears the config cache.
func setupSSHHostConfig(t *testing.T, configTOML string) {
	t.Helper()

	tempDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	t.Cleanup(func() {
		os.Setenv("HOME", origHome)
		ClearUserConfigCache()
	})

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create .agent-deck dir: %v", err)
	}

	configPath := filepath.Join(agentDeckDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}

	ClearUserConfigCache()
}

// TestGetSSHHostIDFromGroupPath_MatchesHostByGroupName verifies that a group path
// like "remote/Jeeves" correctly resolves to the SSH host ID "jeeves" when the host
// has group_name = "Jeeves". This is the primary behavior the PR depends on: the TUI
// and desktop app use this to look up SSH connectivity status for a group header.
func TestGetSSHHostIDFromGroupPath_MatchesHostByGroupName(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	hostID, found := GetSSHHostIDFromGroupPath("remote/Jeeves")
	if !found {
		t.Fatal("Expected to find host for path 'remote/Jeeves', got found=false")
	}
	if hostID != "jeeves" {
		t.Errorf("GetSSHHostIDFromGroupPath('remote/Jeeves') hostID = %q, want %q", hostID, "jeeves")
	}
}

// TestGetSSHHostIDFromGroupPath_MatchesHostByIDWhenNoGroupName verifies that when
// a host has no explicit group_name, the host ID itself is used as the group name.
// This is the fallback behavior in SSHHostDef.GetGroupName().
func TestGetSSHHostIDFromGroupPath_MatchesHostByIDWhenNoGroupName(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.dev-server]
host = "10.0.0.5"
`)

	hostID, found := GetSSHHostIDFromGroupPath("remote/dev-server")
	if !found {
		t.Fatal("Expected to find host for path 'remote/dev-server', got found=false")
	}
	if hostID != "dev-server" {
		t.Errorf("GetSSHHostIDFromGroupPath('remote/dev-server') hostID = %q, want %q", hostID, "dev-server")
	}
}

// TestGetSSHHostIDFromGroupPath_NestedSubgroupStillMatchesHost verifies that a nested
// path like "remote/Jeeves/projects" still resolves to the "jeeves" host. The function
// should only look at the first segment after the prefix, ignoring deeper nesting.
// This is important because remote sessions can be organized in subgroups under the host.
func TestGetSSHHostIDFromGroupPath_NestedSubgroupStillMatchesHost(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	hostID, found := GetSSHHostIDFromGroupPath("remote/Jeeves/projects/myapp")
	if !found {
		t.Fatal("Expected to find host for nested path 'remote/Jeeves/projects/myapp'")
	}
	if hostID != "jeeves" {
		t.Errorf("GetSSHHostIDFromGroupPath nested path: hostID = %q, want %q", hostID, "jeeves")
	}
}

// TestGetSSHHostIDFromGroupPath_NonRemotePathReturnsFalse verifies that local group
// paths (not starting with the remote prefix) are correctly rejected. This prevents
// the disconnected indicator from appearing on local groups.
func TestGetSSHHostIDFromGroupPath_NonRemotePathReturnsFalse(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	tests := []struct {
		name string
		path string
	}{
		{"local group", "my-sessions"},
		{"project group", "hc-repo"},
		{"empty path", ""},
		{"just prefix", "remote"},
		{"prefix without slash", "remotex/Jeeves"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, found := GetSSHHostIDFromGroupPath(tt.path)
			if found {
				t.Errorf("GetSSHHostIDFromGroupPath(%q) should return found=false for non-remote path", tt.path)
			}
		})
	}
}

// TestGetSSHHostIDFromGroupPath_NoMatchingHostReturnsFalse verifies that when the
// group path has the remote prefix but the group name doesn't match any configured
// SSH host, the function returns false. This handles the case where a remote group
// exists in sessions.json but the host has been removed from config.toml.
func TestGetSSHHostIDFromGroupPath_NoMatchingHostReturnsFalse(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	_, found := GetSSHHostIDFromGroupPath("remote/UnknownHost")
	if found {
		t.Error("GetSSHHostIDFromGroupPath('remote/UnknownHost') should return found=false when no host matches")
	}
}

// TestGetSSHHostIDFromGroupPath_NoSSHHostsConfigured verifies that when no SSH hosts
// are configured at all, any remote-looking path returns false.
func TestGetSSHHostIDFromGroupPath_NoSSHHostsConfigured(t *testing.T) {
	setupSSHHostConfig(t, `
default_tool = "claude"
`)

	_, found := GetSSHHostIDFromGroupPath("remote/SomeHost")
	if found {
		t.Error("GetSSHHostIDFromGroupPath should return false when no SSH hosts are configured")
	}
}

// TestGetSSHHostIDFromGroupPath_CustomGroupPrefix verifies that when the remote
// discovery group_prefix is customized (e.g., "servers" instead of "remote"),
// the function uses that prefix for matching. This ensures the indicator works
// for users who have changed the default group prefix.
func TestGetSSHHostIDFromGroupPath_CustomGroupPrefix(t *testing.T) {
	setupSSHHostConfig(t, `
[remote_discovery]
group_prefix = "servers"

[ssh_hosts.prod]
host = "prod.example.com"
group_name = "Production"
`)

	// Should match with custom prefix
	hostID, found := GetSSHHostIDFromGroupPath("servers/Production")
	if !found {
		t.Fatal("Expected to find host for path 'servers/Production' with custom prefix")
	}
	if hostID != "prod" {
		t.Errorf("hostID = %q, want %q", hostID, "prod")
	}

	// Should NOT match with default prefix when custom is configured
	_, found = GetSSHHostIDFromGroupPath("remote/Production")
	if found {
		t.Error("Should not match 'remote/Production' when custom prefix 'servers' is configured")
	}
}

// TestGetSSHHostIDFromGroupPath_MultipleHosts verifies that when multiple SSH hosts
// are configured, the correct host is matched for each group path.
func TestGetSSHHostIDFromGroupPath_MultipleHosts(t *testing.T) {
	setupSSHHostConfig(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"

[ssh_hosts.docker]
host = "192.168.1.200"
group_name = "Docker"

[ssh_hosts.prod]
host = "prod.example.com"
`)

	tests := []struct {
		path       string
		wantHostID string
		wantFound  bool
	}{
		{"remote/Jeeves", "jeeves", true},
		{"remote/Docker", "docker", true},
		{"remote/prod", "prod", true},
		{"remote/Unknown", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			hostID, found := GetSSHHostIDFromGroupPath(tt.path)
			if found != tt.wantFound {
				t.Errorf("GetSSHHostIDFromGroupPath(%q) found = %v, want %v", tt.path, found, tt.wantFound)
			}
			if found && hostID != tt.wantHostID {
				t.Errorf("GetSSHHostIDFromGroupPath(%q) hostID = %q, want %q", tt.path, hostID, tt.wantHostID)
			}
		})
	}
}
