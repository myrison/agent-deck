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

const windowStateFile = "window-state.json"

// Package-level hooks for testing. In production, these use the real implementations.
var (
	getStatePath       = defaultGetStatePath
	checkProcessExists = defaultProcessExists
	getCurrentPID      = os.Getpid
	getEnvVar          = os.Getenv
)

// WindowInfo tracks a single window instance.
type WindowInfo struct {
	PID       int       `json:"pid"`
	StartedAt time.Time `json:"startedAt"`
}

// WindowState tracks all active window instances across processes.
type WindowState struct {
	ActiveWindows map[string]WindowInfo `json:"activeWindows"`
}

// defaultGetStatePath returns the path to the window state file.
func defaultGetStatePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		// Fall back to /tmp if home dir unavailable (rare edge case)
		log.Printf("warning: could not determine home directory, using /tmp: %v", err)
		return filepath.Join("/tmp", ".agent-deck", windowStateFile)
	}
	return filepath.Join(home, ".agent-deck", windowStateFile)
}

// withFileLock executes fn while holding an exclusive lock on the state file.
// This ensures cross-process safety when multiple windows manipulate state.
func withFileLock(fn func(state *WindowState) error) error {
	path := getStatePath()

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Open or create file
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return fmt.Errorf("failed to open window state: %w", err)
	}
	defer f.Close()

	// Acquire exclusive lock (blocks until available)
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return fmt.Errorf("failed to lock window state: %w", err)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)

	// Read current state
	state := &WindowState{
		ActiveWindows: make(map[string]WindowInfo),
	}

	// Try to decode existing state
	decoder := json.NewDecoder(f)
	if err := decoder.Decode(state); err != nil {
		if err != io.EOF {
			// Log non-EOF errors (actual JSON parse failures) but continue with defaults
			log.Printf("warning: failed to parse window state, using defaults: %v", err)
		}
		// Empty file (io.EOF) is normal for first run - silently use defaults
	}

	// Ensure map is initialized (might be nil from empty file)
	if state.ActiveWindows == nil {
		state.ActiveWindows = make(map[string]WindowInfo)
	}

	// Execute the function
	if err := fn(state); err != nil {
		return err
	}

	// Write back state
	if err := f.Truncate(0); err != nil {
		return fmt.Errorf("failed to truncate window state: %w", err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		return fmt.Errorf("failed to seek window state: %w", err)
	}
	encoder := json.NewEncoder(f)
	encoder.SetIndent("", "  ")
	return encoder.Encode(state)
}

// registerWindow claims a window number and registers this process.
// Returns the assigned window number.
func registerWindow() (int, error) {
	var windowNum int

	err := withFileLock(func(state *WindowState) error {
		// Clean up dead windows first
		for numStr, info := range state.ActiveWindows {
			if !checkProcessExists(info.PID) {
				delete(state.ActiveWindows, numStr)
			}
		}

		// Check if we were passed a window number via env
		if envNum := getEnvVar("REVDEN_WINDOW_NUM"); envNum != "" {
			if n, err := fmt.Sscanf(envNum, "%d", &windowNum); err == nil && n == 1 && windowNum > 0 {
				// Use the assigned number
			} else {
				windowNum = 1 // Default to primary (invalid or non-positive numbers)
			}
		} else {
			windowNum = 1 // No env var = primary
		}

		// Register ourselves
		state.ActiveWindows[fmt.Sprintf("%d", windowNum)] = WindowInfo{
			PID:       getCurrentPID(),
			StartedAt: time.Now(),
		}

		return nil
	})

	return windowNum, err
}

// allocateNextWindowNumber reserves the next window number for spawning.
// Called before launching a new window process.
// Uses gap-filling: finds the lowest unused number starting from 2,
// so window numbers stay compact (2, 3, 4...) across sessions.
func allocateNextWindowNumber() (int, error) {
	var nextNum int

	err := withFileLock(func(state *WindowState) error {
		// Clean up dead windows first
		for numStr, info := range state.ActiveWindows {
			if !checkProcessExists(info.PID) {
				delete(state.ActiveWindows, numStr)
			}
		}

		// Find the lowest available number starting from 2
		for candidate := 2; ; candidate++ {
			key := fmt.Sprintf("%d", candidate)
			if _, exists := state.ActiveWindows[key]; !exists {
				nextNum = candidate
				// Reserve this number so concurrent allocations don't collide.
				// The child process overwrites with its real PID on registration.
				state.ActiveWindows[key] = WindowInfo{
					PID:       getCurrentPID(),
					StartedAt: time.Now(),
				}
				break
			}
		}

		return nil
	})

	return nextNum, err
}

// unregisterWindow removes this window from active windows on shutdown.
func unregisterWindow(windowNum int) {
	_ = withFileLock(func(state *WindowState) error {
		delete(state.ActiveWindows, fmt.Sprintf("%d", windowNum))
		return nil
	})
}

// defaultProcessExists checks if a process with given PID is still running.
func defaultProcessExists(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix, FindProcess always succeeds. Send signal 0 to check.
	err = process.Signal(syscall.Signal(0))
	return err == nil
}
