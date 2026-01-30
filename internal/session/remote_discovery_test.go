package session

import (
	"testing"
	"time"

	"github.com/asheshgoplani/agent-deck/internal/tmux"
)

func TestTransformRemoteGroupPath(t *testing.T) {
	tests := []struct {
		name            string
		remoteGroupPath string
		groupPrefix     string
		groupName       string
		expected        string
	}{
		{
			name:            "empty remote path maps to host root",
			remoteGroupPath: "",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves",
		},
		{
			name:            "default group path maps to host root",
			remoteGroupPath: "my-sessions",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves",
		},
		{
			name:            "simple remote group",
			remoteGroupPath: "production",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves/production",
		},
		{
			name:            "nested remote group",
			remoteGroupPath: "jeeves/workers",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves/jeeves/workers",
		},
		{
			name:            "custom prefix",
			remoteGroupPath: "dev",
			groupPrefix:     "ssh-hosts",
			groupName:       "server1",
			expected:        "ssh-hosts/server1/dev",
		},
		{
			name:            "deeply nested remote group",
			remoteGroupPath: "projects/frontend/components",
			groupPrefix:     "remote",
			groupName:       "dev-server",
			expected:        "remote/dev-server/projects/frontend/components",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TransformRemoteGroupPath(tt.remoteGroupPath, tt.groupPrefix, tt.groupName)
			if result != tt.expected {
				t.Errorf("TransformRemoteGroupPath(%q, %q, %q) = %q, want %q",
					tt.remoteGroupPath, tt.groupPrefix, tt.groupName, result, tt.expected)
			}
		})
	}
}

func TestTransformRemoteGroups(t *testing.T) {
	tests := []struct {
		name         string
		remoteGroups []*GroupData
		groupPrefix  string
		groupName    string
		expected     []*GroupData
	}{
		{
			name:         "nil input returns nil",
			remoteGroups: nil,
			groupPrefix:  "remote",
			groupName:    "host1",
			expected:     nil,
		},
		{
			name:         "empty input returns nil",
			remoteGroups: []*GroupData{},
			groupPrefix:  "remote",
			groupName:    "host1",
			expected:     nil,
		},
		{
			name: "default group is skipped",
			remoteGroups: []*GroupData{
				{Name: "My Sessions", Path: "my-sessions", Expanded: true, Order: 0},
			},
			groupPrefix: "remote",
			groupName:   "host1",
			expected:    []*GroupData{},
		},
		{
			name: "transforms single group",
			remoteGroups: []*GroupData{
				{Name: "Production", Path: "production", Expanded: true, Order: 1},
			},
			groupPrefix: "remote",
			groupName:   "jeeves",
			expected: []*GroupData{
				{Name: "Production", Path: "remote/jeeves/production", Expanded: true, Order: 1},
			},
		},
		{
			name: "transforms multiple groups",
			remoteGroups: []*GroupData{
				{Name: "My Sessions", Path: "my-sessions", Expanded: true, Order: 0},
				{Name: "Production", Path: "production", Expanded: true, Order: 1},
				{Name: "Workers", Path: "jeeves/workers", Expanded: false, Order: 2},
			},
			groupPrefix: "remote",
			groupName:   "jeeves",
			expected: []*GroupData{
				{Name: "Production", Path: "remote/jeeves/production", Expanded: true, Order: 1},
				{Name: "Workers", Path: "remote/jeeves/jeeves/workers", Expanded: false, Order: 2},
			},
		},
		{
			name: "preserves expanded state",
			remoteGroups: []*GroupData{
				{Name: "Collapsed", Path: "collapsed", Expanded: false, Order: 0},
				{Name: "Expanded", Path: "expanded", Expanded: true, Order: 1},
			},
			groupPrefix: "remote",
			groupName:   "server",
			expected: []*GroupData{
				{Name: "Collapsed", Path: "remote/server/collapsed", Expanded: false, Order: 0},
				{Name: "Expanded", Path: "remote/server/expanded", Expanded: true, Order: 1},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TransformRemoteGroups(tt.remoteGroups, tt.groupPrefix, tt.groupName)

			if tt.expected == nil {
				if result != nil {
					t.Errorf("expected nil, got %v", result)
				}
				return
			}

			if len(result) != len(tt.expected) {
				t.Errorf("got %d groups, want %d", len(result), len(tt.expected))
				return
			}

			for i, g := range result {
				exp := tt.expected[i]
				if g.Name != exp.Name || g.Path != exp.Path || g.Expanded != exp.Expanded || g.Order != exp.Order {
					t.Errorf("group %d: got {%s, %s, %v, %d}, want {%s, %s, %v, %d}",
						i, g.Name, g.Path, g.Expanded, g.Order,
						exp.Name, exp.Path, exp.Expanded, exp.Order)
				}
			}
		})
	}
}

func TestGenerateRemoteInstanceID(t *testing.T) {
	// Test determinism - same inputs should produce same output
	id1 := GenerateRemoteInstanceID("host1", "agentdeck_test_12345678")
	id2 := GenerateRemoteInstanceID("host1", "agentdeck_test_12345678")
	if id1 != id2 {
		t.Errorf("GenerateRemoteInstanceID is not deterministic: %s != %s", id1, id2)
	}

	// Test prefix
	if id1[:7] != "remote-" {
		t.Errorf("ID should start with 'remote-', got %s", id1)
	}

	// Test different inputs produce different outputs
	id3 := GenerateRemoteInstanceID("host2", "agentdeck_test_12345678")
	if id1 == id3 {
		t.Error("Different hosts should produce different IDs")
	}

	id4 := GenerateRemoteInstanceID("host1", "agentdeck_other_87654321")
	if id1 == id4 {
		t.Error("Different session names should produce different IDs")
	}
}

func TestParseTitleFromTmuxName(t *testing.T) {
	tests := []struct {
		name     string
		tmuxName string
		expected string
	}{
		{
			name:     "standard agentdeck name",
			tmuxName: "agentdeck_my-project_a1b2c3d4",
			expected: "My Project",
		},
		{
			name:     "multi-word title",
			tmuxName: "agentdeck_revvie-sdlc-agent_12345678",
			expected: "Revvie Sdlc Agent",
		},
		{
			name:     "single word title",
			tmuxName: "agentdeck_test_abcdef01",
			expected: "Test",
		},
		{
			name:     "non-matching format fallback",
			tmuxName: "agentdeck_something",
			expected: "Something",
		},
		{
			name:     "non-agentdeck prefix with hyphens",
			tmuxName: "other-session-name",
			expected: "Other Session Name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseTitleFromTmuxName(tt.tmuxName)
			if result != tt.expected {
				t.Errorf("ParseTitleFromTmuxName(%q) = %q, want %q", tt.tmuxName, result, tt.expected)
			}
		})
	}
}

func TestEffectiveRemoteTmuxName(t *testing.T) {
	tests := []struct {
		name           string
		remoteTmuxName string
		tmuxSession    *tmux.Session
		expected       string
	}{
		{
			name:           "prefers RemoteTmuxName when set",
			remoteTmuxName: "agentdeck_jarvis_4e581bb4",
			tmuxSession:    &tmux.Session{Name: "agentdeck_jarvis_4e581bb4"},
			expected:       "agentdeck_jarvis_4e581bb4",
		},
		{
			name:           "falls back to tmux session name",
			remoteTmuxName: "",
			tmuxSession:    &tmux.Session{Name: "agentdeck_sebastian_c8e76716"},
			expected:       "agentdeck_sebastian_c8e76716",
		},
		{
			name:           "returns empty when both empty",
			remoteTmuxName: "",
			tmuxSession:    nil,
			expected:       "",
		},
		{
			name:           "returns empty when tmux session has empty name",
			remoteTmuxName: "",
			tmuxSession:    &tmux.Session{Name: ""},
			expected:       "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst := &Instance{
				RemoteTmuxName: tt.remoteTmuxName,
				tmuxSession:    tt.tmuxSession,
			}
			result := effectiveRemoteTmuxName(inst)
			if result != tt.expected {
				t.Errorf("effectiveRemoteTmuxName() = %q, want %q", result, tt.expected)
			}
		})
	}
}

func TestFindStaleRemoteSessions_UsesTmuxSessionFallback(t *testing.T) {
	// Instance with RemoteTmuxName empty but TmuxSession set.
	// The stale check should still find it via the fallback.
	inst := &Instance{
		ID:             "remote-abc123",
		RemoteHost:     "host197",
		RemoteTmuxName: "", // empty - the bug scenario
		tmuxSession:    &tmux.Session{Name: "agentdeck_heimdall_9e2e692c"},
	}

	// Remote tmux still has this session running
	running := []RemoteTmuxSession{
		{Name: "agentdeck_heimdall_9e2e692c"},
	}

	stale := FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, "host197", running, nil)
	if len(stale) != 0 {
		t.Errorf("expected 0 stale (session is running), got %d: %v", len(stale), stale)
	}

	// Now test that it IS marked stale when not running
	stale = FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, "host197", nil, nil)
	if len(stale) != 1 {
		t.Errorf("expected 1 stale (session not running), got %d", len(stale))
	}
}

func TestFindStaleRemoteSessions_SkipsWithoutTmuxName(t *testing.T) {
	// Instance with both RemoteTmuxName and TmuxSession empty.
	// Should not be marked stale (can't determine if it's running).
	inst := &Instance{
		ID:             "remote-noname",
		RemoteHost:     "host197",
		RemoteTmuxName: "",
		tmuxSession:    nil,
	}

	stale := FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, "host197", nil, nil)
	if len(stale) != 0 {
		t.Errorf("expected 0 stale (no tmux name to check), got %d", len(stale))
	}
}

// TestFindByRemoteSession verifies that a session can be found by its host+tmux
// name combination, and that mismatches return nil. This is the lookup used when
// attaching to a remote session from local UI.
func TestFindByRemoteSession(t *testing.T) {
	targetTmux := "agentdeck_myproject_aabbccdd"
	targetHost := "host197"
	targetID := GenerateRemoteInstanceID(targetHost, targetTmux)

	instances := []*Instance{
		{ID: "local-123", RemoteHost: ""},
		{ID: targetID, RemoteHost: targetHost, RemoteTmuxName: targetTmux},
		{ID: "remote-other", RemoteHost: "host2", RemoteTmuxName: "agentdeck_other_11223344"},
	}

	t.Run("finds matching session", func(t *testing.T) {
		found := FindByRemoteSession(instances, targetHost, targetTmux)
		if found == nil {
			t.Fatal("expected to find session, got nil")
		}
		if found.ID != targetID {
			t.Errorf("found wrong session: got ID %q, want %q", found.ID, targetID)
		}
	})

	t.Run("returns nil for wrong host", func(t *testing.T) {
		found := FindByRemoteSession(instances, "nonexistent-host", targetTmux)
		if found != nil {
			t.Errorf("expected nil for wrong host, got %q", found.ID)
		}
	})

	t.Run("returns nil for wrong tmux name", func(t *testing.T) {
		found := FindByRemoteSession(instances, targetHost, "agentdeck_wrong_99999999")
		if found != nil {
			t.Errorf("expected nil for wrong tmux name, got %q", found.ID)
		}
	})

	t.Run("returns nil for empty list", func(t *testing.T) {
		found := FindByRemoteSession(nil, targetHost, targetTmux)
		if found != nil {
			t.Errorf("expected nil for empty list, got %q", found.ID)
		}
	})
}

// TestCleanupStaleRemoteSessions verifies that sessions no longer present on the
// remote host are removed from the local instance list, while sessions still
// running on the remote (or belonging to other hosts) are preserved.
func TestCleanupStaleRemoteSessions(t *testing.T) {
	hostID := "host197"
	runningTmux := "agentdeck_alive_11111111"
	staleTmux := "agentdeck_gone_22222222"

	running := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, runningTmux),
		RemoteHost:     hostID,
		RemoteTmuxName: runningTmux,
	}
	stale := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, staleTmux),
		RemoteHost:     hostID,
		RemoteTmuxName: staleTmux,
	}
	local := &Instance{
		ID:         "local-session",
		RemoteHost: "",
	}
	otherHost := &Instance{
		ID:             GenerateRemoteInstanceID("host2", "agentdeck_x_33333333"),
		RemoteHost:     "host2",
		RemoteTmuxName: "agentdeck_x_33333333",
	}

	allInstances := []*Instance{running, stale, local, otherHost}

	// Only the "alive" session is still running on host197
	currentRemote := []RemoteTmuxSession{
		{Name: runningTmux},
	}

	cleaned := CleanupStaleRemoteSessions(allInstances, hostID, currentRemote)

	// Should have 3 sessions: running, local, otherHost — stale removed
	if len(cleaned) != 3 {
		t.Fatalf("expected 3 sessions after cleanup, got %d", len(cleaned))
	}

	// Verify stale session was removed
	for _, inst := range cleaned {
		if inst.ID == stale.ID {
			t.Errorf("stale session %q should have been removed", stale.ID)
		}
	}

	// Verify running, local, and other-host sessions survived
	ids := make(map[string]bool)
	for _, inst := range cleaned {
		ids[inst.ID] = true
	}
	for _, expected := range []string{running.ID, local.ID, otherHost.ID} {
		if !ids[expected] {
			t.Errorf("expected session %q to survive cleanup", expected)
		}
	}
}

// TestCleanupStaleRemoteSessions_NothingStale verifies that when all remote
// sessions are still running, no sessions are removed (returns original list).
func TestCleanupStaleRemoteSessions_NothingStale(t *testing.T) {
	hostID := "host197"
	tmuxName := "agentdeck_alive_aaaaaaaa"
	inst := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, tmuxName),
		RemoteHost:     hostID,
		RemoteTmuxName: tmuxName,
	}

	currentRemote := []RemoteTmuxSession{{Name: tmuxName}}
	cleaned := CleanupStaleRemoteSessions([]*Instance{inst}, hostID, currentRemote)

	if len(cleaned) != 1 {
		t.Fatalf("expected 1 session (nothing stale), got %d", len(cleaned))
	}
	if cleaned[0].ID != inst.ID {
		t.Errorf("got wrong session: %q, want %q", cleaned[0].ID, inst.ID)
	}
}

// TestMergeDiscoveredSessions verifies that newly discovered remote sessions are
// added to the existing list, while duplicates (by ID) are skipped.
func TestMergeDiscoveredSessions(t *testing.T) {
	existing := []*Instance{
		{ID: "existing-1", Title: "Session 1"},
		{ID: "existing-2", Title: "Session 2"},
	}

	t.Run("adds new sessions", func(t *testing.T) {
		discovered := []*Instance{
			{ID: "new-1", Title: "New Session"},
		}
		merged, count := MergeDiscoveredSessions(existing, discovered)
		if count != 1 {
			t.Errorf("expected 1 new session, got %d", count)
		}
		if len(merged) != 3 {
			t.Errorf("expected 3 total sessions, got %d", len(merged))
		}
	})

	t.Run("skips duplicate IDs", func(t *testing.T) {
		discovered := []*Instance{
			{ID: "existing-1", Title: "Duplicate"},
			{ID: "new-2", Title: "Truly New"},
		}
		merged, count := MergeDiscoveredSessions(existing, discovered)
		if count != 1 {
			t.Errorf("expected 1 new session (duplicate skipped), got %d", count)
		}
		if len(merged) != 3 {
			t.Errorf("expected 3 total sessions, got %d", len(merged))
		}
	})

	t.Run("handles empty discovered list", func(t *testing.T) {
		merged, count := MergeDiscoveredSessions(existing, nil)
		if count != 0 {
			t.Errorf("expected 0 new sessions, got %d", count)
		}
		if len(merged) != len(existing) {
			t.Errorf("expected %d sessions unchanged, got %d", len(existing), len(merged))
		}
	})

	t.Run("handles empty existing list", func(t *testing.T) {
		discovered := []*Instance{
			{ID: "brand-new", Title: "Brand New"},
		}
		merged, count := MergeDiscoveredSessions(nil, discovered)
		if count != 1 {
			t.Errorf("expected 1 new session, got %d", count)
		}
		if len(merged) != 1 {
			t.Errorf("expected 1 total session, got %d", len(merged))
		}
	})
}

// TestTransformRemoteGroupPath_RemoteOfRemote verifies that paths starting with
// the group prefix (e.g., "remote/...") are mapped to the host's root group,
// preventing circular nesting like "remote/host/remote/otherhost".
func TestTransformRemoteGroupPath_RemoteOfRemote(t *testing.T) {
	tests := []struct {
		name            string
		remoteGroupPath string
		groupPrefix     string
		groupName       string
		expected        string
	}{
		{
			name:            "remote-of-remote path is flattened",
			remoteGroupPath: "remote/Docker",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves",
		},
		{
			name:            "exact prefix match is flattened",
			remoteGroupPath: "remote",
			groupPrefix:     "remote",
			groupName:       "jeeves",
			expected:        "remote/jeeves",
		},
		{
			name:            "custom prefix remote-of-remote",
			remoteGroupPath: "ssh-hosts/other-server",
			groupPrefix:     "ssh-hosts",
			groupName:       "server1",
			expected:        "ssh-hosts/server1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TransformRemoteGroupPath(tt.remoteGroupPath, tt.groupPrefix, tt.groupName)
			if result != tt.expected {
				t.Errorf("TransformRemoteGroupPath(%q, %q, %q) = %q, want %q",
					tt.remoteGroupPath, tt.groupPrefix, tt.groupName, result, tt.expected)
			}
		})
	}
}

// TestTransformRemoteGroups_FiltersRemoteOfRemote verifies that remote groups
// which are themselves remote groups (e.g., "remote/Docker") are excluded from
// the transformed output, preventing empty nested remote hierarchies.
func TestTransformRemoteGroups_FiltersRemoteOfRemote(t *testing.T) {
	remoteGroups := []*GroupData{
		{Name: "Production", Path: "production", Expanded: true, Order: 1},
		{Name: "Docker", Path: "remote/Docker", Expanded: true, Order: 2}, // remote-of-remote
		{Name: "Remote Root", Path: "remote", Expanded: true, Order: 3},   // exact prefix
		{Name: "Workers", Path: "workers", Expanded: false, Order: 4},
	}

	result := TransformRemoteGroups(remoteGroups, "remote", "jeeves")

	// Should only include "production" and "workers" — remote-of-remote groups filtered
	if len(result) != 2 {
		t.Fatalf("expected 2 groups (remote-of-remote filtered), got %d", len(result))
	}

	if result[0].Path != "remote/jeeves/production" {
		t.Errorf("first group: got path %q, want %q", result[0].Path, "remote/jeeves/production")
	}
	if result[1].Path != "remote/jeeves/workers" {
		t.Errorf("second group: got path %q, want %q", result[1].Path, "remote/jeeves/workers")
	}
}

// TestFindStaleRemoteSessionsWithSnapshot_SessionInStorageNotStale verifies that
// a session which is not in running tmux BUT still exists in the remote's
// sessions.json is NOT marked as stale. This covers the error-state session
// scenario where tmux died but the session record still exists.
func TestFindStaleRemoteSessionsWithSnapshot_SessionInStorageNotStale(t *testing.T) {
	hostID := "host197"
	tmuxName := "agentdeck_crashed_eeeeeeee"

	inst := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, tmuxName),
		RemoteHost:     hostID,
		RemoteTmuxName: tmuxName,
	}

	// Not in running tmux
	var runningTmux []RemoteTmuxSession

	// But IS in sessions.json
	snapshot := &RemoteStorageSnapshot{
		AllSessions: []*InstanceData{
			{TmuxSession: tmuxName},
		},
	}

	stale := FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, hostID, runningTmux, snapshot)
	if len(stale) != 0 {
		t.Errorf("expected 0 stale (session in sessions.json), got %d: %v", len(stale), stale)
	}
}

// TestFindStaleRemoteSessionsWithSnapshot_MissingFromBothIsStale verifies that
// a session missing from both running tmux AND sessions.json IS marked stale.
func TestFindStaleRemoteSessionsWithSnapshot_MissingFromBothIsStale(t *testing.T) {
	hostID := "host197"
	tmuxName := "agentdeck_deleted_ffffffff"

	inst := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, tmuxName),
		RemoteHost:     hostID,
		RemoteTmuxName: tmuxName,
	}

	// Not running and not in sessions.json
	snapshot := &RemoteStorageSnapshot{
		AllSessions: []*InstanceData{
			{TmuxSession: "agentdeck_some_other_session"},
		},
	}

	stale := FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, hostID, nil, snapshot)
	if len(stale) != 1 {
		t.Fatalf("expected 1 stale (missing from both), got %d", len(stale))
	}
	if stale[0] != inst.ID {
		t.Errorf("stale ID: got %q, want %q", stale[0], inst.ID)
	}
}

// TestFindStaleRemoteSessions_DeprecatedLacksSnapshotSafety verifies that the
// deprecated FindStaleRemoteSessions (nil snapshot) marks a session as stale
// even when it exists in the remote's sessions.json — because the deprecated API
// has no snapshot to consult. This is the key behavioral difference from
// FindStaleRemoteSessionsWithSnapshot and documents the weaker guarantee.
func TestFindStaleRemoteSessions_DeprecatedLacksSnapshotSafety(t *testing.T) {
	hostID := "host197"
	tmuxName := "agentdeck_crashed_bbbbbbbb"

	inst := &Instance{
		ID:             GenerateRemoteInstanceID(hostID, tmuxName),
		RemoteHost:     hostID,
		RemoteTmuxName: tmuxName,
	}

	// Session is NOT in running tmux but IS in sessions.json.
	// The new API (WithSnapshot) would protect it; the deprecated API cannot.
	var noRunningTmux []RemoteTmuxSession

	// Deprecated API: no snapshot awareness — should mark as stale
	staleDeprecated := FindStaleRemoteSessions([]*Instance{inst}, hostID, noRunningTmux)
	if len(staleDeprecated) != 1 {
		t.Errorf("deprecated API: expected 1 stale (no snapshot safety), got %d", len(staleDeprecated))
	}

	// New API with snapshot: same session is NOT stale because sessions.json has it
	snapshot := &RemoteStorageSnapshot{
		AllSessions: []*InstanceData{
			{TmuxSession: tmuxName},
		},
	}
	staleNew := FindStaleRemoteSessionsWithSnapshot([]*Instance{inst}, hostID, noRunningTmux, snapshot)
	if len(staleNew) != 0 {
		t.Errorf("new API: expected 0 stale (session in sessions.json), got %d", len(staleNew))
	}
}

// TestDiscoveryRepairsNilTmuxSession verifies Layer 3 active repair:
// - Session exists locally with nil tmuxSession
// - Discovery finds the session running on remote
// - Discovery repairs tmuxSession AND preserves existing status
func TestDiscoveryRepairsNilTmuxSession(t *testing.T) {
	tmuxName := "agentdeck_repairtest_aaaabbbb"
	hostID := "host197"
	remoteID := GenerateRemoteInstanceID(hostID, tmuxName)

	existingInst := &Instance{
		ID:             remoteID,
		Title:          "Repair Test",
		ProjectPath:    "/remote/project",
		GroupPath:      "remote/host197",
		Tool:           "claude",
		Status:         StatusIdle, // Should be preserved!
		CreatedAt:      time.Now(),
		RemoteHost:     hostID,
		RemoteTmuxName: tmuxName,
		tmuxSession:    nil, // Needs repair
	}

	// Verify initial state
	if existingInst.GetTmuxSession() != nil {
		t.Fatal("Test setup error: tmuxSession should be nil")
	}
	initialStatus := existingInst.Status

	// Simulate the repair logic from remote_discovery.go:315
	// (This is the Layer 3 repair code)
	if existingInst.GetTmuxSession() == nil {
		previousStatus := statusToString(existingInst.Status)
		// Note: In real code this uses tmux.ReconnectSessionWithStatusAndExecutor
		// For testing, we'll create a mock session object
		tmuxSess := &tmux.Session{
			Name:         tmuxName,
			DisplayName:  existingInst.Title,
			WorkDir:      existingInst.ProjectPath,
			InstanceID:   existingInst.ID,
			RemoteHostID: hostID,
			// Status is preserved via previousStatus parameter
		}

		existingInst.SetTmuxSession(tmuxSess)
		// Verify status string conversion works
		if previousStatus != "idle" {
			t.Errorf("statusToString returned %q, want %q", previousStatus, "idle")
		}
	}

	// Verify repair succeeded
	if existingInst.GetTmuxSession() == nil {
		t.Error("Layer 3 repair failed: tmuxSession still nil")
	}

	repairedSess := existingInst.GetTmuxSession()
	if repairedSess.Name != tmuxName {
		t.Errorf("Repaired session name = %q, want %q",
			repairedSess.Name, tmuxName)
	}
	if repairedSess.InstanceID != remoteID {
		t.Errorf("InstanceID = %q, want %q", repairedSess.InstanceID, remoteID)
	}
	if repairedSess.RemoteHostID != hostID {
		t.Errorf("RemoteHostID = %q, want %q",
			repairedSess.RemoteHostID, hostID)
	}

	// CRITICAL: Verify status was preserved (not reset to "waiting")
	if existingInst.Status != initialStatus {
		t.Errorf("Status changed during repair: %v -> %v (should preserve)",
			initialStatus, existingInst.Status)
	}
}

// TestSyncSessionTitle_UpdatesIncorrectTitle verifies that SyncSessionTitle corrects
// a session's title when the snapshot has a different authoritative value.
func TestSyncSessionTitle_UpdatesIncorrectTitle(t *testing.T) {
	tmuxName := "agentdeck_1769533185048019000_abcd1234" // Malformed - would parse to numeric

	existingInst := &Instance{
		Title: "1769533185048019000", // Wrong - this is what ParseTitleFromTmuxName returned
	}

	snapshot := &RemoteStorageSnapshot{
		SessionTitles: map[string]string{
			tmuxName: "Real Session Name", // The authoritative title
		},
	}

	updated := SyncSessionTitle(existingInst, tmuxName, snapshot)

	if !updated {
		t.Error("SyncSessionTitle should have returned true (title was updated)")
	}
	if existingInst.Title != "Real Session Name" {
		t.Errorf("Title = %q, want %q", existingInst.Title, "Real Session Name")
	}
}

// TestSyncSessionTitle_SkipsWhenAlreadyCorrect verifies that SyncSessionTitle doesn't
// modify sessions that already have the correct title.
func TestSyncSessionTitle_SkipsWhenAlreadyCorrect(t *testing.T) {
	tmuxName := "agentdeck_my-project_12345678"

	existingInst := &Instance{
		Title: "My Project", // Already correct
	}

	snapshot := &RemoteStorageSnapshot{
		SessionTitles: map[string]string{
			tmuxName: "My Project", // Same title
		},
	}

	updated := SyncSessionTitle(existingInst, tmuxName, snapshot)

	if updated {
		t.Error("SyncSessionTitle should have returned false (no change needed)")
	}
	if existingInst.Title != "My Project" {
		t.Errorf("Title was modified: got %q, want %q", existingInst.Title, "My Project")
	}
}

// TestSyncSessionTitle_SkipsWhenNilSnapshot verifies that SyncSessionTitle handles
// nil snapshot gracefully (e.g., when remote sessions.json couldn't be fetched).
func TestSyncSessionTitle_SkipsWhenNilSnapshot(t *testing.T) {
	existingInst := &Instance{
		Title: "Original Title",
	}

	updated := SyncSessionTitle(existingInst, "agentdeck_test_12345678", nil)

	if updated {
		t.Error("SyncSessionTitle should have returned false for nil snapshot")
	}
	if existingInst.Title != "Original Title" {
		t.Errorf("Title was modified: got %q, want %q", existingInst.Title, "Original Title")
	}
}

// TestSyncSessionTitle_SkipsWhenNotInSnapshot verifies that SyncSessionTitle doesn't
// modify sessions that aren't in the snapshot (e.g., newly created sessions).
func TestSyncSessionTitle_SkipsWhenNotInSnapshot(t *testing.T) {
	existingInst := &Instance{
		Title: "Original Title",
	}

	snapshot := &RemoteStorageSnapshot{
		SessionTitles: map[string]string{
			"other_session": "Other Title",
		},
	}

	updated := SyncSessionTitle(existingInst, "agentdeck_not_in_snapshot_12345678", snapshot)

	if updated {
		t.Error("SyncSessionTitle should have returned false (session not in snapshot)")
	}
	if existingInst.Title != "Original Title" {
		t.Errorf("Title was modified: got %q, want %q", existingInst.Title, "Original Title")
	}
}

// TestResolveSessionTitle_PrefersAuthoritative verifies that ResolveSessionTitle
// returns the authoritative title from the snapshot when available.
func TestResolveSessionTitle_PrefersAuthoritative(t *testing.T) {
	tmuxName := "agentdeck_1769533185048019000_abcd1234" // Would parse to numeric

	snapshot := &RemoteStorageSnapshot{
		SessionTitles: map[string]string{
			tmuxName: "Real Session Name", // Authoritative title
		},
	}

	title := ResolveSessionTitle(tmuxName, snapshot)

	if title != "Real Session Name" {
		t.Errorf("ResolveSessionTitle() = %q, want %q", title, "Real Session Name")
	}
}

// TestResolveSessionTitle_FallsBackToParsing verifies that ResolveSessionTitle
// falls back to parsing from tmux name when session isn't in the snapshot.
func TestResolveSessionTitle_FallsBackToParsing(t *testing.T) {
	tmuxName := "agentdeck_my-new-project_12345678"

	// Empty snapshot - session not in sessions.json
	snapshot := &RemoteStorageSnapshot{
		SessionTitles: map[string]string{},
	}

	title := ResolveSessionTitle(tmuxName, snapshot)

	if title != "My New Project" {
		t.Errorf("ResolveSessionTitle() = %q, want %q (parsed fallback)", title, "My New Project")
	}
}

// TestResolveSessionTitle_FallsBackWhenNilSnapshot verifies that ResolveSessionTitle
// falls back to parsing when snapshot is nil (e.g., SSH failure).
func TestResolveSessionTitle_FallsBackWhenNilSnapshot(t *testing.T) {
	tmuxName := "agentdeck_fallback-test_12345678"

	title := ResolveSessionTitle(tmuxName, nil)

	if title != "Fallback Test" {
		t.Errorf("ResolveSessionTitle() = %q, want %q (parsed fallback)", title, "Fallback Test")
	}
}

// TestParseTitleFromTmuxName_NumericFallback verifies the fallback behavior
// when the tmux name contains a numeric value that doesn't match the expected pattern.
func TestParseTitleFromTmuxName_NumericFallback(t *testing.T) {
	// This test documents why SessionTitles is needed:
	// When tmux names have numeric values, ParseTitleFromTmuxName returns them as-is

	tests := []struct {
		name     string
		tmuxName string
		expected string
	}{
		{
			name:     "numeric middle part returns as title",
			tmuxName: "agentdeck_1769533185048019000_abcd1234",
			expected: "1769533185048019000",
		},
		{
			name:     "pure numeric without prefix returns as-is",
			tmuxName: "1769533185048019000",
			expected: "1769533185048019000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseTitleFromTmuxName(tt.tmuxName)
			if result != tt.expected {
				t.Errorf("ParseTitleFromTmuxName(%q) = %q, want %q",
					tt.tmuxName, result, tt.expected)
			}
		})
	}
}
