package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newTestTabStateManager(t *testing.T) *TabStateManager {
	t.Helper()
	return &TabStateManager{
		filePath: filepath.Join(t.TempDir(), "open_tabs.json"),
	}
}

func TestTabState_EmptyState(t *testing.T) {
	m := newTestTabStateManager(t)

	state, err := m.GetTabState(1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != nil {
		t.Fatalf("expected nil state for empty file, got %+v", state)
	}
}

func TestTabState_SaveAndLoad(t *testing.T) {
	m := newTestTabStateManager(t)

	input := WindowTabState{
		ActiveTabId: "tab-1",
		Tabs: []SavedTab{
			{
				ID:           "tab-1",
				Name:         "My Session",
				ActivePaneId: "pane-1",
				OpenedAt:     1000,
				Layout: &SavedLayoutNode{
					Type: "pane",
					ID:   "pane-1",
					Binding: &PaneBinding{
						ProjectPath: "/home/user/project",
						ProjectName: "project",
						Tool:        "claude",
					},
				},
			},
			{
				ID:           "tab-2",
				Name:         "Another",
				ActivePaneId: "pane-2",
				OpenedAt:     2000,
				Layout: &SavedLayoutNode{
					Type: "pane",
					ID:   "pane-2",
				},
			},
		},
	}

	if err := m.SaveTabState(1, input); err != nil {
		t.Fatalf("save error: %v", err)
	}

	got, err := m.GetTabState(1)
	if err != nil {
		t.Fatalf("load error: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil state")
	}
	if got.ActiveTabId != "tab-1" {
		t.Errorf("activeTabId = %q, want %q", got.ActiveTabId, "tab-1")
	}
	if len(got.Tabs) != 2 {
		t.Fatalf("tabs count = %d, want 2", len(got.Tabs))
	}
	if got.Tabs[0].Name != "My Session" {
		t.Errorf("tab[0].name = %q, want %q", got.Tabs[0].Name, "My Session")
	}
	if got.Tabs[0].Layout.Binding.Tool != "claude" {
		t.Errorf("tab[0] binding tool = %q, want %q", got.Tabs[0].Layout.Binding.Tool, "claude")
	}
	if got.SavedAt == 0 {
		t.Error("expected savedAt to be set")
	}
}

func TestTabState_MultiWindowIsolation(t *testing.T) {
	m := newTestTabStateManager(t)

	state1 := WindowTabState{
		ActiveTabId: "w1-tab",
		Tabs:        []SavedTab{{ID: "w1-tab", Name: "Window 1"}},
	}
	state2 := WindowTabState{
		ActiveTabId: "w2-tab",
		Tabs:        []SavedTab{{ID: "w2-tab", Name: "Window 2"}},
	}

	if err := m.SaveTabState(1, state1); err != nil {
		t.Fatalf("save window 1: %v", err)
	}
	if err := m.SaveTabState(2, state2); err != nil {
		t.Fatalf("save window 2: %v", err)
	}

	got1, err := m.GetTabState(1)
	if err != nil {
		t.Fatalf("load window 1: %v", err)
	}
	got2, err := m.GetTabState(2)
	if err != nil {
		t.Fatalf("load window 2: %v", err)
	}

	if got1.ActiveTabId != "w1-tab" {
		t.Errorf("window 1 activeTabId = %q, want %q", got1.ActiveTabId, "w1-tab")
	}
	if got2.ActiveTabId != "w2-tab" {
		t.Errorf("window 2 activeTabId = %q, want %q", got2.ActiveTabId, "w2-tab")
	}

	// Window 3 should have no state
	got3, err := m.GetTabState(3)
	if err != nil {
		t.Fatalf("load window 3: %v", err)
	}
	if got3 != nil {
		t.Errorf("expected nil for window 3, got %+v", got3)
	}
}

func TestTabState_CorruptFileRecovery(t *testing.T) {
	m := newTestTabStateManager(t)

	// Write corrupt JSON
	dir := filepath.Dir(m.filePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(m.filePath, []byte("{invalid json!!!"), 0600); err != nil {
		t.Fatal(err)
	}

	// Should recover gracefully
	state, err := m.GetTabState(1)
	if err != nil {
		t.Fatalf("unexpected error on corrupt file: %v", err)
	}
	if state != nil {
		t.Errorf("expected nil state from corrupt file, got %+v", state)
	}
}

func TestTabState_OverwriteExisting(t *testing.T) {
	m := newTestTabStateManager(t)

	// Save initial state
	initial := WindowTabState{
		ActiveTabId: "tab-old",
		Tabs:        []SavedTab{{ID: "tab-old", Name: "Old"}},
	}
	if err := m.SaveTabState(1, initial); err != nil {
		t.Fatal(err)
	}

	// Overwrite
	updated := WindowTabState{
		ActiveTabId: "tab-new",
		Tabs:        []SavedTab{{ID: "tab-new", Name: "New"}},
	}
	if err := m.SaveTabState(1, updated); err != nil {
		t.Fatal(err)
	}

	got, err := m.GetTabState(1)
	if err != nil {
		t.Fatal(err)
	}
	if got.ActiveTabId != "tab-new" {
		t.Errorf("activeTabId = %q after overwrite, want %q", got.ActiveTabId, "tab-new")
	}
	if len(got.Tabs) != 1 || got.Tabs[0].Name != "New" {
		t.Errorf("unexpected tab after overwrite: %+v", got.Tabs)
	}
}

func TestTabState_SplitLayout(t *testing.T) {
	m := newTestTabStateManager(t)

	state := WindowTabState{
		ActiveTabId: "tab-1",
		Tabs: []SavedTab{{
			ID:           "tab-1",
			Name:         "Split Tab",
			ActivePaneId: "pane-left",
			Layout: &SavedLayoutNode{
				Type:      "split",
				Direction: "vertical",
				Ratio:     0.6,
				Children: []*SavedLayoutNode{
					{Type: "pane", ID: "pane-left", Binding: &PaneBinding{
						ProjectPath: "/project-a",
						ProjectName: "project-a",
						CustomLabel: "Backend",
						Tool:        "claude",
					}},
					{Type: "pane", ID: "pane-right", Binding: &PaneBinding{
						ProjectPath: "/project-b",
						ProjectName: "project-b",
						Tool:        "shell",
					}},
				},
			},
		}},
	}

	if err := m.SaveTabState(1, state); err != nil {
		t.Fatal(err)
	}

	got, err := m.GetTabState(1)
	if err != nil {
		t.Fatal(err)
	}

	tab := got.Tabs[0]
	if tab.Layout.Type != "split" {
		t.Fatalf("layout type = %q, want split", tab.Layout.Type)
	}
	if tab.Layout.Ratio != 0.6 {
		t.Errorf("ratio = %f, want 0.6", tab.Layout.Ratio)
	}
	left := tab.Layout.Children[0]
	if left.Binding.CustomLabel != "Backend" {
		t.Errorf("left binding customLabel = %q, want %q", left.Binding.CustomLabel, "Backend")
	}
	right := tab.Layout.Children[1]
	if right.Binding.Tool != "shell" {
		t.Errorf("right binding tool = %q, want %q", right.Binding.Tool, "shell")
	}
}

func TestTabState_JSONFormat(t *testing.T) {
	m := newTestTabStateManager(t)

	state := WindowTabState{
		ActiveTabId: "tab-1",
		Tabs: []SavedTab{{
			ID:   "tab-1",
			Name: "Test",
		}},
	}
	if err := m.SaveTabState(1, state); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		t.Fatal(err)
	}

	// Should be valid JSON with expected structure
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := raw["windows"]; !ok {
		t.Error("missing 'windows' key in JSON")
	}
}
