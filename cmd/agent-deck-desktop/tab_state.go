package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"syscall"
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

// readTabState reads the tab state file under a shared lock (allows concurrent readers).
func (m *TabStateManager) readTabState(fn func(state *TabStateFile) error) error {
	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(m.filePath), 0700); err != nil {
		return fmt.Errorf("failed to create tab state directory: %w", err)
	}

	// Open or create file (O_RDONLY would fail on non-existent; use RDWR|CREATE for consistency)
	f, err := os.OpenFile(m.filePath, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("failed to open tab state: %w", err)
	}
	defer f.Close()

	// Acquire shared lock (allows concurrent readers)
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_SH); err != nil {
		return fmt.Errorf("failed to lock tab state: %w", err)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	// Read current state
	state := &TabStateFile{
		Windows: map[string]WindowTabState{},
	}

	decoder := json.NewDecoder(f)
	if err := decoder.Decode(state); err != nil {
		if err != io.EOF {
			log.Printf("warning: failed to parse tab state, using defaults: %v", err)
		}
	}

	if state.Windows == nil {
		state.Windows = map[string]WindowTabState{}
	}

	return fn(state)
}

// writeTabState reads, mutates, and writes back the tab state file under an exclusive lock.
func (m *TabStateManager) writeTabState(fn func(state *TabStateFile) error) error {
	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(m.filePath), 0700); err != nil {
		return fmt.Errorf("failed to create tab state directory: %w", err)
	}

	// Open or create file
	f, err := os.OpenFile(m.filePath, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("failed to open tab state: %w", err)
	}
	defer f.Close()

	// Acquire exclusive lock (blocks until available)
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return fmt.Errorf("failed to lock tab state: %w", err)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	// Read current state
	state := &TabStateFile{
		Windows: map[string]WindowTabState{},
	}

	decoder := json.NewDecoder(f)
	if err := decoder.Decode(state); err != nil {
		if err != io.EOF {
			log.Printf("warning: failed to parse tab state, using defaults: %v", err)
		}
	}

	if state.Windows == nil {
		state.Windows = map[string]WindowTabState{}
	}

	// Execute the callback
	if err := fn(state); err != nil {
		return err
	}

	// Write back state
	if err := f.Truncate(0); err != nil {
		return fmt.Errorf("failed to truncate tab state: %w", err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return fmt.Errorf("failed to seek tab state: %w", err)
	}
	encoder := json.NewEncoder(f)
	encoder.SetIndent("", "  ")
	return encoder.Encode(state)
}

// GetTabState returns the saved tab state for a given window number.
// Returns nil (not an error) when no state has been saved.
func (m *TabStateManager) GetTabState(windowNum int) (*WindowTabState, error) {
	var result *WindowTabState

	err := m.readTabState(func(state *TabStateFile) error {
		key := fmt.Sprintf("%d", windowNum)
		if ws, ok := state.Windows[key]; ok {
			result = &ws
		}
		return nil
	})

	return result, err
}

// SaveTabState persists the tab state for a given window number.
func (m *TabStateManager) SaveTabState(windowNum int, state WindowTabState) error {
	return m.writeTabState(func(file *TabStateFile) error {
		state.SavedAt = time.Now().Unix()
		key := fmt.Sprintf("%d", windowNum)
		file.Windows[key] = state
		return nil
	})
}
