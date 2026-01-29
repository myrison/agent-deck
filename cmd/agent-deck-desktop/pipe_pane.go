package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// PipePaneTailer streams bytes from a tmux pipe-pane log file to the frontend.
// This bypasses the DiffViewport algorithm that causes rendering corruption
// during fast output by sending raw bytes directly to xterm.js.
type PipePaneTailer struct {
	mu sync.Mutex

	ctx       context.Context // Wails runtime context
	sessionID string
	logPath   string

	file     *os.File
	running  bool
	paused   bool // True when streaming is paused (e.g., during resize)
	stopChan chan struct{}
	position int64 // Current read position in file

	// Stats for debugging
	bytesRead int64
	emitCount int64
}

// NewPipePaneTailer creates a tailer for the given session.
// logPath is where tmux pipe-pane will write output.
func NewPipePaneTailer(sessionID, logPath string) *PipePaneTailer {
	return &PipePaneTailer{
		sessionID: sessionID,
		logPath:   logPath,
	}
}

// SetContext sets the Wails runtime context for event emission.
func (pt *PipePaneTailer) SetContext(ctx context.Context) {
	pt.mu.Lock()
	pt.ctx = ctx
	pt.mu.Unlock()
}

// Start begins tailing the log file and emitting bytes to the frontend.
// Call this after enabling pipe-pane in tmux.
func (pt *PipePaneTailer) Start() error {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	if pt.running {
		return nil // Already running
	}

	// Wait briefly for file to be created by pipe-pane
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(pt.logPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Open log file for reading
	f, err := os.OpenFile(pt.logPath, os.O_RDONLY|os.O_CREATE, 0644)
	if err != nil {
		return fmt.Errorf("failed to open pipe-pane log: %w", err)
	}

	pt.file = f
	pt.position = 0
	pt.bytesRead = 0
	pt.emitCount = 0
	pt.running = true
	pt.stopChan = make(chan struct{})

	go pt.tailLoop()

	return nil
}

// Stop stops the tailer without removing the log file.
func (pt *PipePaneTailer) Stop() {
	pt.mu.Lock()
	running := pt.running
	stopChan := pt.stopChan
	pt.mu.Unlock()

	if !running {
		return
	}

	// Signal stop
	close(stopChan)

	// Wait briefly for loop to exit
	time.Sleep(50 * time.Millisecond)

	pt.mu.Lock()
	if pt.file != nil {
		pt.file.Close()
		pt.file = nil
	}
	pt.running = false
	pt.mu.Unlock()
}

// Pause temporarily stops emitting bytes to the frontend.
// Used during resize to avoid interleaving stream bytes with capture-pane refresh.
func (pt *PipePaneTailer) Pause() {
	pt.mu.Lock()
	pt.paused = true
	pt.mu.Unlock()
}

// Resume resumes emitting bytes after a pause.
func (pt *PipePaneTailer) Resume() {
	pt.mu.Lock()
	pt.paused = false
	pt.mu.Unlock()
}

// Truncate resets the read position and truncates the log file.
// Used after resize to discard stale bytes that were written during the resize.
// This ensures streaming resumes fresh from the post-resize state.
func (pt *PipePaneTailer) Truncate() {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	// Reset read position
	pt.position = 0

	// Truncate the log file if open
	if pt.file != nil {
		// Close and reopen to truncate (more reliable across platforms)
		pt.file.Close()
		f, err := os.OpenFile(pt.logPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0644)
		if err == nil {
			pt.file = f
		}
	}
}

// Cleanup stops the tailer and removes the log file.
func (pt *PipePaneTailer) Cleanup() {
	pt.Stop()

	// Remove log file
	if pt.logPath != "" {
		os.Remove(pt.logPath)
	}
}

// tailLoop continuously reads new bytes from the log file and emits them.
func (pt *PipePaneTailer) tailLoop() {
	ticker := time.NewTicker(10 * time.Millisecond) // Fast polling for responsive output
	defer ticker.Stop()

	buf := make([]byte, 64*1024) // 64KB buffer for large bursts

	for {
		select {
		case <-pt.stopChan:
			return
		case <-ticker.C:
			pt.readAndEmit(buf)
		}
	}
}

// readAndEmit reads new bytes from the log file and emits them to the frontend.
func (pt *PipePaneTailer) readAndEmit(buf []byte) {
	pt.mu.Lock()
	f := pt.file
	ctx := pt.ctx
	sessionID := pt.sessionID
	position := pt.position
	paused := pt.paused
	pt.mu.Unlock()

	if f == nil || ctx == nil || paused {
		return
	}

	// Check file size - if it shrunk, reset position (file was truncated)
	stat, err := f.Stat()
	if err != nil {
		return
	}
	if stat.Size() < position {
		// File was truncated, reset to beginning
		pt.mu.Lock()
		pt.position = 0
		position = 0
		pt.mu.Unlock()
	}

	// Seek to current position
	_, err = f.Seek(position, io.SeekStart)
	if err != nil {
		return
	}

	// Read new bytes
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return
	}

	if n > 0 {
		// Update position and stats
		pt.mu.Lock()
		pt.position = position + int64(n)
		pt.bytesRead += int64(n)
		pt.emitCount++
		pt.mu.Unlock()

		// Emit to frontend
		data := string(buf[:n])
		// Strip TTS markers if present
		data = stripTTSMarkers(data)

		if len(data) > 0 {
			runtime.EventsEmit(ctx, "terminal:data",
				TerminalEvent{SessionID: sessionID, Data: data})
		}
	}
}

// GetStats returns debugging statistics.
func (pt *PipePaneTailer) GetStats() (bytesRead, emitCount int64) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	return pt.bytesRead, pt.emitCount
}

// GetPipePaneLogPath returns the path for a session's pipe-pane log file.
// Uses /tmp/agentdeck-pipe-{sessionID}.log pattern.
func GetPipePaneLogPath(sessionID string) string {
	// Sanitize sessionID for filename safety
	safe := sessionID
	// Replace any path separators
	safe = filepath.Base(safe)
	return filepath.Join(os.TempDir(), fmt.Sprintf("agentdeck-pipe-%s.log", safe))
}

// EnablePipePane enables tmux pipe-pane for the given session.
// Creates/truncates the log file first.
func EnablePipePane(tmuxSession, logPath string) error {
	// Create/truncate log file
	f, err := os.Create(logPath)
	if err != nil {
		return fmt.Errorf("failed to create log file: %w", err)
	}
	f.Close()

	// Enable pipe-pane with append mode
	// Note: -o flag means "only if pipe-pane not already active"
	cmd := exec.Command(tmuxBinaryPath, "pipe-pane", "-t", tmuxSession,
		fmt.Sprintf("cat >> '%s'", logPath))
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to enable pipe-pane: %w", err)
	}

	return nil
}

// DisablePipePane disables pipe-pane for the given session.
func DisablePipePane(tmuxSession string) error {
	// Calling pipe-pane with no command disables it
	cmd := exec.Command(tmuxBinaryPath, "pipe-pane", "-t", tmuxSession)
	return cmd.Run()
}
