package ui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/asheshgoplani/agent-deck/internal/session"
)

// setupSSHHostConfigForUI creates a temp HOME with a config.toml containing SSH host
// definitions and clears the config cache. This is needed because renderGroupItem
// calls session.GetSSHHostIDFromGroupPath which reads the global config.
func setupSSHHostConfigForUI(t *testing.T, configTOML string) {
	t.Helper()

	tempDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tempDir)
	t.Cleanup(func() {
		os.Setenv("HOME", origHome)
		session.ClearUserConfigCache()
	})

	agentDeckDir := filepath.Join(tempDir, ".agent-deck")
	if err := os.MkdirAll(agentDeckDir, 0700); err != nil {
		t.Fatalf("Failed to create .agent-deck dir: %v", err)
	}

	configPath := filepath.Join(agentDeckDir, "config.toml")
	if err := os.WriteFile(configPath, []byte(configTOML), 0600); err != nil {
		t.Fatalf("Failed to write config.toml: %v", err)
	}

	session.ClearUserConfigCache()
}

// newMinimalHomeWithGroup creates a minimal Home model sufficient for renderGroupItem.
// Sets up a group tree containing the given group with zero sessions, and
// configures the sshHostConnected cache with the provided map.
func newMinimalHomeWithGroup(group *session.Group, sshConnected map[string]bool) *Home {
	h := &Home{
		width:            100,
		height:           30,
		sshHostConnected: sshConnected,
	}
	h.groupTree = session.NewGroupTree([]*session.Instance{})
	// Replace the auto-generated groups with just our test group
	h.groupTree.Groups = map[string]*session.Group{
		group.Path: group,
	}
	h.groupTree.RebuildGroupList()
	return h
}

// TestRenderGroupItem_ShowsDisconnectedIndicatorWhenHostIsDown verifies that
// when a remote SSH host is disconnected (sshHostConnected[hostID] == false),
// the group header rendering includes the ⊘ indicator. This is the core visual
// behavior the PR adds to the TUI.
func TestRenderGroupItem_ShowsDisconnectedIndicatorWhenHostIsDown(t *testing.T) {
	setupSSHHostConfigForUI(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	group := &session.Group{
		Name:     "Jeeves",
		Path:     "remote/Jeeves",
		Expanded: true,
		Sessions: []*session.Instance{},
	}

	h := newMinimalHomeWithGroup(group, map[string]bool{
		"jeeves": false, // disconnected
	})

	item := session.Item{
		Type:  session.ItemTypeGroup,
		Group: group,
		Level: 1,
		Path:  group.Path,
	}

	var b strings.Builder
	h.renderGroupItem(&b, item, false, 0)
	output := b.String()

	if !strings.Contains(output, "⊘") {
		t.Errorf("Expected disconnected indicator ⊘ in output when host is down.\nGot: %q", output)
	}
}

// TestRenderGroupItem_NoIndicatorWhenHostIsConnected verifies that when a remote
// SSH host is connected (sshHostConnected[hostID] == true), no disconnected
// indicator appears in the group header.
func TestRenderGroupItem_NoIndicatorWhenHostIsConnected(t *testing.T) {
	setupSSHHostConfigForUI(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	group := &session.Group{
		Name:     "Jeeves",
		Path:     "remote/Jeeves",
		Expanded: true,
		Sessions: []*session.Instance{},
	}

	h := newMinimalHomeWithGroup(group, map[string]bool{
		"jeeves": true, // connected
	})

	item := session.Item{
		Type:  session.ItemTypeGroup,
		Group: group,
		Level: 1,
		Path:  group.Path,
	}

	var b strings.Builder
	h.renderGroupItem(&b, item, false, 0)
	output := b.String()

	if strings.Contains(output, "⊘") {
		t.Errorf("Should NOT show disconnected indicator when host is connected.\nGot: %q", output)
	}
}

// TestRenderGroupItem_NoIndicatorWhenHostNotInCache verifies that when a remote
// host exists in config but has no entry in the sshHostConnected cache (e.g.,
// connectivity hasn't been checked yet), no indicator appears. The indicator
// only shows for explicitly disconnected hosts, not unknown ones.
func TestRenderGroupItem_NoIndicatorWhenHostNotInCache(t *testing.T) {
	setupSSHHostConfigForUI(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	group := &session.Group{
		Name:     "Jeeves",
		Path:     "remote/Jeeves",
		Expanded: true,
		Sessions: []*session.Instance{},
	}

	// Empty cache — host connectivity not yet determined
	h := newMinimalHomeWithGroup(group, map[string]bool{})

	item := session.Item{
		Type:  session.ItemTypeGroup,
		Group: group,
		Level: 1,
		Path:  group.Path,
	}

	var b strings.Builder
	h.renderGroupItem(&b, item, false, 0)
	output := b.String()

	if strings.Contains(output, "⊘") {
		t.Errorf("Should NOT show disconnected indicator when host connectivity is unknown.\nGot: %q", output)
	}
}

// TestRenderGroupItem_NoIndicatorForLocalGroup verifies that local (non-remote)
// groups never show the disconnected indicator, regardless of cache state.
func TestRenderGroupItem_NoIndicatorForLocalGroup(t *testing.T) {
	setupSSHHostConfigForUI(t, `
[ssh_hosts.jeeves]
host = "192.168.1.100"
group_name = "Jeeves"
`)

	group := &session.Group{
		Name:     "My Sessions",
		Path:     "my-sessions",
		Expanded: true,
		Sessions: []*session.Instance{},
	}

	h := newMinimalHomeWithGroup(group, map[string]bool{
		"jeeves": false, // some host is disconnected, but this isn't its group
	})

	item := session.Item{
		Type:  session.ItemTypeGroup,
		Group: group,
		Level: 0,
		Path:  group.Path,
	}

	var b strings.Builder
	h.renderGroupItem(&b, item, false, 0)
	output := b.String()

	if strings.Contains(output, "⊘") {
		t.Errorf("Local groups should never show disconnected indicator.\nGot: %q", output)
	}
}
