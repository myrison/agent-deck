package session

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/BurntSushi/toml"
)

// ============================================================================
// ValidateSSHHostID Tests
// ============================================================================

func TestValidateSSHHostID_ValidIDs(t *testing.T) {
	validCases := []string{
		"my-server",
		"server123",
		"dev_machine",
		"A-B-C",
		"host",
		"h",
		"123",
	}

	for _, hostID := range validCases {
		errMsg := ValidateSSHHostID(hostID)
		if errMsg != "" {
			t.Errorf("ValidateSSHHostID(%q) = %q, want empty string (valid)", hostID, errMsg)
		}
	}
}

func TestValidateSSHHostID_EmptyString(t *testing.T) {
	errMsg := ValidateSSHHostID("")
	if errMsg == "" {
		t.Error("ValidateSSHHostID(\"\") should return error for empty string")
	}
	if errMsg != "Host ID is required" {
		t.Errorf("Unexpected error message: %q", errMsg)
	}
}

func TestValidateSSHHostID_InvalidCharacters(t *testing.T) {
	invalidCases := []struct {
		hostID string
		desc   string
	}{
		{"my server", "space character"},
		{"server.local", "dot character"},
		{"host@domain", "at sign"},
		{"host/path", "forward slash"},
		{"host:22", "colon"},
		{"host$var", "dollar sign"},
		{"server!", "exclamation mark"},
		{"ホスト", "unicode characters"},
		{"host name", "multiple spaces"},
	}

	for _, tc := range invalidCases {
		errMsg := ValidateSSHHostID(tc.hostID)
		if errMsg == "" {
			t.Errorf("ValidateSSHHostID(%q) should reject %s", tc.hostID, tc.desc)
		}
	}
}

// ============================================================================
// SetSSHHost Tests
// ============================================================================

func TestSetSSHHost_CreatesNewHost(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create a new SSH host
	def := SSHHostDef{
		Host:         "192.168.1.100",
		User:         "developer",
		Port:         22,
		Description:  "Test server",
		GroupName:    "Dev Server",
		AutoDiscover: true,
	}

	err := SetSSHHost("test-server", def)
	if err != nil {
		t.Fatalf("SetSSHHost failed: %v", err)
	}

	// Reload and verify
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	savedHost, exists := config.SSHHosts["test-server"]
	if !exists {
		t.Fatal("Expected test-server to exist in SSHHosts")
	}

	if savedHost.Host != "192.168.1.100" {
		t.Errorf("Host: got %q, want %q", savedHost.Host, "192.168.1.100")
	}
	if savedHost.User != "developer" {
		t.Errorf("User: got %q, want %q", savedHost.User, "developer")
	}
	if savedHost.Port != 22 {
		t.Errorf("Port: got %d, want %d", savedHost.Port, 22)
	}
	if savedHost.Description != "Test server" {
		t.Errorf("Description: got %q, want %q", savedHost.Description, "Test server")
	}
	if savedHost.GroupName != "Dev Server" {
		t.Errorf("GroupName: got %q, want %q", savedHost.GroupName, "Dev Server")
	}
	if !savedHost.AutoDiscover {
		t.Error("AutoDiscover should be true")
	}
}

func TestSetSSHHost_UpdatesExistingHost(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create initial host
	initialDef := SSHHostDef{
		Host:        "192.168.1.100",
		User:        "developer",
		Port:        22,
		Description: "Initial description",
	}

	if err := SetSSHHost("test-server", initialDef); err != nil {
		t.Fatalf("Initial SetSSHHost failed: %v", err)
	}

	// Update the host
	ClearUserConfigCache()
	updatedDef := SSHHostDef{
		Host:         "10.0.0.50",
		User:         "admin",
		Port:         2222,
		Description:  "Updated description",
		AutoDiscover: true,
	}

	if err := SetSSHHost("test-server", updatedDef); err != nil {
		t.Fatalf("Update SetSSHHost failed: %v", err)
	}

	// Reload and verify
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	savedHost := config.SSHHosts["test-server"]
	if savedHost.Host != "10.0.0.50" {
		t.Errorf("Host not updated: got %q, want %q", savedHost.Host, "10.0.0.50")
	}
	if savedHost.User != "admin" {
		t.Errorf("User not updated: got %q, want %q", savedHost.User, "admin")
	}
	if savedHost.Port != 2222 {
		t.Errorf("Port not updated: got %d, want %d", savedHost.Port, 2222)
	}
	if savedHost.Description != "Updated description" {
		t.Errorf("Description not updated: got %q, want %q", savedHost.Description, "Updated description")
	}
}

func TestSetSSHHost_EnablesRemoteDiscoveryWhenAutoDiscoverSet(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create a host with auto_discover enabled
	def := SSHHostDef{
		Host:         "192.168.1.100",
		AutoDiscover: true,
	}

	if err := SetSSHHost("discoverable-host", def); err != nil {
		t.Fatalf("SetSSHHost failed: %v", err)
	}

	// Verify that remote discovery is enabled
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	if !config.RemoteDiscovery.Enabled {
		t.Error("RemoteDiscovery.Enabled should be automatically set to true when host has AutoDiscover")
	}
}

func TestSetSSHHost_PreservesOtherHosts(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create an initial config file to ensure we don't use the shared defaultUserConfig
	initialConfig := `default_tool = "claude"`
	configPath := filepath.Join(agentDeckDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(initialConfig), 0600); err != nil {
		t.Fatalf("Failed to write initial config: %v", err)
	}
	ClearUserConfigCache()

	// Create first host
	if err := SetSSHHost("host-one", SSHHostDef{Host: "host1.example.com"}); err != nil {
		t.Fatalf("First SetSSHHost failed: %v", err)
	}

	// Create second host
	ClearUserConfigCache()
	if err := SetSSHHost("host-two", SSHHostDef{Host: "host2.example.com"}); err != nil {
		t.Fatalf("Second SetSSHHost failed: %v", err)
	}

	// Verify both hosts exist in the config file
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	if _, exists := config.SSHHosts["host-one"]; !exists {
		t.Error("host-one should still exist after adding host-two")
	}
	if _, exists := config.SSHHosts["host-two"]; !exists {
		t.Error("host-two should exist")
	}
	// Verify the config file only has our hosts
	if len(config.SSHHosts) != 2 {
		t.Errorf("Config file should have exactly 2 hosts, got %d: %v", len(config.SSHHosts), config.SSHHosts)
	}
}

// ============================================================================
// RemoveSSHHost Tests
// ============================================================================

func TestRemoveSSHHost_RemovesExistingHost(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create host first
	if err := SetSSHHost("to-remove", SSHHostDef{Host: "example.com"}); err != nil {
		t.Fatalf("SetSSHHost failed: %v", err)
	}

	// Verify host exists
	ClearUserConfigCache()
	config, _ := LoadUserConfig()
	if _, exists := config.SSHHosts["to-remove"]; !exists {
		t.Fatal("Host should exist before removal")
	}

	// Remove the host
	ClearUserConfigCache()
	if err := RemoveSSHHost("to-remove"); err != nil {
		t.Fatalf("RemoveSSHHost failed: %v", err)
	}

	// Verify removal
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	if _, exists := config.SSHHosts["to-remove"]; exists {
		t.Error("Host should not exist after removal")
	}
}

func TestRemoveSSHHost_PreservesOtherHosts(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Create two hosts
	if err := SetSSHHost("keep-me", SSHHostDef{Host: "keep.example.com"}); err != nil {
		t.Fatalf("SetSSHHost failed: %v", err)
	}
	ClearUserConfigCache()
	if err := SetSSHHost("delete-me", SSHHostDef{Host: "delete.example.com"}); err != nil {
		t.Fatalf("SetSSHHost failed: %v", err)
	}

	// Remove one host
	ClearUserConfigCache()
	if err := RemoveSSHHost("delete-me"); err != nil {
		t.Fatalf("RemoveSSHHost failed: %v", err)
	}

	// Verify only target host was removed
	ClearUserConfigCache()
	config, err := LoadUserConfig()
	if err != nil {
		t.Fatalf("LoadUserConfig failed: %v", err)
	}

	if _, exists := config.SSHHosts["delete-me"]; exists {
		t.Error("delete-me should have been removed")
	}
	if _, exists := config.SSHHosts["keep-me"]; !exists {
		t.Error("keep-me should still exist")
	}
}

func TestRemoveSSHHost_NonexistentHost(t *testing.T) {
	// Setup isolated environment
	tempDir := t.TempDir()
	t.Setenv("HOME", tempDir)
	ClearUserConfigCache()

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create agent-deck dir: %v", err)
	}

	// Remove nonexistent host (should not error)
	err := RemoveSSHHost("nonexistent")
	if err != nil {
		t.Errorf("RemoveSSHHost(nonexistent) should not error, got: %v", err)
	}
}

// ============================================================================
// SSHHostDef Helper Methods Tests
// ============================================================================

func TestSSHHostDef_GetGroupName(t *testing.T) {
	tests := []struct {
		name      string
		def       SSHHostDef
		hostID    string
		wantGroup string
	}{
		{
			name:      "returns GroupName when set",
			def:       SSHHostDef{GroupName: "My Server"},
			hostID:    "server-1",
			wantGroup: "My Server",
		},
		{
			name:      "returns hostID when GroupName is empty",
			def:       SSHHostDef{},
			hostID:    "server-1",
			wantGroup: "server-1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.def.GetGroupName(tt.hostID)
			if got != tt.wantGroup {
				t.Errorf("GetGroupName() = %q, want %q", got, tt.wantGroup)
			}
		})
	}
}

func TestSSHHostDef_GetSessionPrefix(t *testing.T) {
	tests := []struct {
		name       string
		def        SSHHostDef
		hostID     string
		wantPrefix string
	}{
		{
			name:       "returns SessionPrefix when set",
			def:        SSHHostDef{SessionPrefix: "[MBP]"},
			hostID:     "mac-mini",
			wantPrefix: "[MBP]",
		},
		{
			name:       "returns GroupName when SessionPrefix empty and GroupName set",
			def:        SSHHostDef{GroupName: "Mac Mini"},
			hostID:     "mac-mini",
			wantPrefix: "Mac Mini",
		},
		{
			name:       "returns hostID when both are empty",
			def:        SSHHostDef{},
			hostID:     "mac-mini",
			wantPrefix: "mac-mini",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.def.GetSessionPrefix(tt.hostID)
			if got != tt.wantPrefix {
				t.Errorf("GetSessionPrefix() = %q, want %q", got, tt.wantPrefix)
			}
		})
	}
}

// ============================================================================
// SSH Host Config Parsing Tests (TOML format)
// ============================================================================

func TestSSHHostConfig_ParseFromTOML(t *testing.T) {
	configContent := `
[ssh_hosts.dev-server]
host = "192.168.1.100"
user = "developer"
port = 2222
identity_file = "~/.ssh/dev_key"
description = "Development server"
group_name = "Dev Server"
auto_discover = true
tmux_path = "/opt/homebrew/bin/tmux"

[ssh_hosts.prod]
host = "prod.example.com"
user = "deploy"
auto_discover = false
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	var config UserConfig
	if _, err := toml.DecodeFile(configPath, &config); err != nil {
		t.Fatalf("Failed to decode config: %v", err)
	}

	// Verify dev-server
	devServer, exists := config.SSHHosts["dev-server"]
	if !exists {
		t.Fatal("Expected dev-server to be parsed")
	}
	if devServer.Host != "192.168.1.100" {
		t.Errorf("dev-server.Host = %q, want %q", devServer.Host, "192.168.1.100")
	}
	if devServer.User != "developer" {
		t.Errorf("dev-server.User = %q, want %q", devServer.User, "developer")
	}
	if devServer.Port != 2222 {
		t.Errorf("dev-server.Port = %d, want %d", devServer.Port, 2222)
	}
	if devServer.IdentityFile != "~/.ssh/dev_key" {
		t.Errorf("dev-server.IdentityFile = %q, want %q", devServer.IdentityFile, "~/.ssh/dev_key")
	}
	if devServer.GroupName != "Dev Server" {
		t.Errorf("dev-server.GroupName = %q, want %q", devServer.GroupName, "Dev Server")
	}
	if !devServer.AutoDiscover {
		t.Error("dev-server.AutoDiscover should be true")
	}
	if devServer.TmuxPath != "/opt/homebrew/bin/tmux" {
		t.Errorf("dev-server.TmuxPath = %q, want %q", devServer.TmuxPath, "/opt/homebrew/bin/tmux")
	}

	// Verify prod
	prod, exists := config.SSHHosts["prod"]
	if !exists {
		t.Fatal("Expected prod to be parsed")
	}
	if prod.Host != "prod.example.com" {
		t.Errorf("prod.Host = %q, want %q", prod.Host, "prod.example.com")
	}
	if prod.AutoDiscover {
		t.Error("prod.AutoDiscover should be false")
	}
}

func TestSSHHostConfig_JumpHost(t *testing.T) {
	configContent := `
[ssh_hosts.bastion]
host = "bastion.example.com"
user = "admin"

[ssh_hosts.internal]
host = "10.0.0.50"
user = "developer"
jump_host = "bastion"
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		t.Fatalf("Failed to write config: %v", err)
	}

	var config UserConfig
	if _, err := toml.DecodeFile(configPath, &config); err != nil {
		t.Fatalf("Failed to decode config: %v", err)
	}

	internal := config.SSHHosts["internal"]
	if internal.JumpHost != "bastion" {
		t.Errorf("internal.JumpHost = %q, want %q", internal.JumpHost, "bastion")
	}
}

