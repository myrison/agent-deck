package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// SavedTab represents a single persisted tab with its layout and session bindings.
type SavedTab struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Layout       *SavedLayoutNode `json:"layout"`
	ActivePaneId string           `json:"activePaneId"`
	OpenedAt     int64            `json:"openedAt"`
}

// WindowTabState represents the tab state for a single window.
type WindowTabState struct {
	ActiveTabId string     `json:"activeTabId"`
	Tabs        []SavedTab `json:"tabs"`
	SavedAt     int64      `json:"savedAt"`
}

// TabStateFile represents the on-disk format keyed by window number.
type TabStateFile struct {
	Windows map[string]WindowTabState `json:"windows"`
}

// TabStateManager manages persistence of open tab state.
type TabStateManager struct {
	filePath string
}

// NewTabStateManager creates a new TabStateManager using the default path.
func NewTabStateManager() *TabStateManager {
	home, _ := os.UserHomeDir()
	return &TabStateManager{
		filePath: filepath.Join(home, ".agent-deck", "desktop", "open_tabs.json"),
	}
}

// load reads the tab state file from disk.
func (m *TabStateManager) load() (*TabStateFile, error) {
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &TabStateFile{Windows: map[string]WindowTabState{}}, nil
		}
		return nil, err
	}

	var file TabStateFile
	if err := json.Unmarshal(data, &file); err != nil {
		// Corrupt file — return empty state (same pattern as SavedLayoutsManager)
		return &TabStateFile{Windows: map[string]WindowTabState{}}, nil
	}

	if file.Windows == nil {
		file.Windows = map[string]WindowTabState{}
	}

	return &file, nil
}

// save writes the tab state file to disk.
func (m *TabStateManager) save(file *TabStateFile) error {
	dir := filepath.Dir(m.filePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.filePath, data, 0600)
}

// GetTabState returns the saved tab state for a given window number.
// Returns nil (not an error) when no state has been saved.
func (m *TabStateManager) GetTabState(windowNum int) (*WindowTabState, error) {
	file, err := m.load()
	if err != nil {
		return nil, err
	}

	key := fmt.Sprintf("%d", windowNum)
	state, ok := file.Windows[key]
	if !ok {
		return nil, nil
	}
	return &state, nil
}

// SaveTabState persists the tab state for a given window number.
func (m *TabStateManager) SaveTabState(windowNum int, state WindowTabState) error {
	file, err := m.load()
	if err != nil {
		return err
	}

	state.SavedAt = time.Now().Unix()
	key := fmt.Sprintf("%d", windowNum)
	file.Windows[key] = state

	return m.save(file)
}
