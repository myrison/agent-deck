package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Log file for debugging - can be read by the developer
var debugLogFile *os.File

func init() {
	// Create log file in temp directory
	logPath := filepath.Join(os.TempDir(), "agent-deck-desktop-debug.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err == nil {
		debugLogFile = f
		fmt.Fprintf(debugLogFile, "=== Agent Deck Desktop Debug Log ===\n")
		fmt.Fprintf(debugLogFile, "Started: %s\n", time.Now().Format(time.RFC3339))
		fmt.Fprintf(debugLogFile, "Log file: %s\n\n", logPath)
		debugLogFile.Sync()
	}
}

// debugLog writes to file AND sends to frontend console
func (t *Terminal) debugLog(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	timestamp := time.Now().Format("15:04:05.000")
	logLine := fmt.Sprintf("[%s] %s\n", timestamp, msg)

	// Write to file
	if debugLogFile != nil {
		debugLogFile.WriteString(logLine)
		debugLogFile.Sync()
	}

	// Also send to frontend
	if t.ctx != nil {
		runtime.EventsEmit(t.ctx, "terminal:debug", msg)
	}
}

// stripTTSMarkers removes «tts» and «/tts» markers from output.
func stripTTSMarkers(s string) string {
	s = strings.ReplaceAll(s, "«tts»", "")
	s = strings.ReplaceAll(s, "«/tts»", "")
	return s
}

// Terminal manages the PTY and communication with the frontend.
type Terminal struct {
	ctx    context.Context
	pty    *PTY
	mu     sync.Mutex
	closed bool

	// Tmux polling mode
	tmuxSession    string
	tmuxPolling    bool
	tmuxStopChan   chan struct{}
	tmuxLastState  string
	historyTracker *HistoryTracker // Tracks scrollback to prevent data loss
}

// NewTerminal creates a new Terminal instance.
func NewTerminal() *Terminal {
	return &Terminal{}
}

// SetContext sets the Wails runtime context.
func (t *Terminal) SetContext(ctx context.Context) {
	t.ctx = ctx
}

// Start spawns the shell and begins reading from the PTY.
// Accepts initial terminal dimensions to set PTY size before shell starts.
func (t *Terminal) Start(cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.pty != nil {
		return nil // Already started
	}

	p, err := SpawnPTY("")
	if err != nil {
		return err
	}

	// Set initial size immediately before shell draws prompt
	if cols > 0 && rows > 0 {
		p.Resize(uint16(cols), uint16(rows))
	}

	t.pty = p
	t.closed = false

	// Start reading from PTY and emitting to frontend
	go t.readLoop()

	return nil
}

// AttachTmux attaches to an existing tmux session.
func (t *Terminal) AttachTmux(tmuxSession string, cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.pty != nil {
		return nil // Already started
	}

	p, err := SpawnPTYWithCommand("tmux", "attach-session", "-t", tmuxSession)
	if err != nil {
		return err
	}

	// Set initial size
	if cols > 0 && rows > 0 {
		p.Resize(uint16(cols), uint16(rows))
	}

	t.pty = p
	t.closed = false

	// Start reading from PTY and emitting to frontend
	go t.readLoop()

	return nil
}

// Write sends data to the PTY.
func (t *Terminal) Write(data string) error {
	t.mu.Lock()
	p := t.pty
	t.mu.Unlock()

	if p == nil {
		return nil
	}

	_, err := p.Write([]byte(data))
	return err
}

// Resize changes the PTY dimensions.
func (t *Terminal) Resize(cols, rows int) error {
	t.mu.Lock()
	p := t.pty
	t.mu.Unlock()

	if p == nil {
		return nil
	}

	return p.Resize(uint16(cols), uint16(rows))
}

// Close terminates the PTY and stops any tmux polling.
func (t *Terminal) Close() error {
	// Stop tmux polling if active (uses its own lock)
	t.StopTmuxPolling()

	t.mu.Lock()
	defer t.mu.Unlock()

	t.closed = true
	if t.pty != nil {
		err := t.pty.Close()
		t.pty = nil
		return err
	}
	return nil
}

// readLoop continuously reads from PTY and emits data to frontend.
func (t *Terminal) readLoop() {
	buf := make([]byte, 32*1024)

	for {
		t.mu.Lock()
		p := t.pty
		closed := t.closed
		t.mu.Unlock()

		if p == nil || closed {
			return
		}

		n, err := p.Read(buf)
		if err != nil {
			if t.ctx != nil && !t.closed {
				runtime.EventsEmit(t.ctx, "terminal:exit", err.Error())
			}
			return
		}

		if n > 0 && t.ctx != nil {
			output := stripTTSMarkers(string(buf[:n]))
			if len(output) > 0 {
				runtime.EventsEmit(t.ctx, "terminal:data", output)
			}
		}
	}
}

// StartTmuxPolling begins polling a tmux session instead of attaching.
// This avoids cursor position conflicts when scrollback is pre-loaded.
func (t *Terminal) StartTmuxPolling(tmuxSession string, cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.tmuxPolling {
		t.debugLog("[POLL] Already polling, ignoring StartTmuxPolling call")
		return nil // Already polling
	}

	t.debugLog("[POLL] Starting tmux polling for session=%s cols=%d rows=%d", tmuxSession, cols, rows)

	// Get current pane dimensions BEFORE resize
	beforeCmd := exec.Command("tmux", "display", "-t", tmuxSession, "-p", "#{pane_width}x#{pane_height}")
	beforeOut, _ := beforeCmd.Output()
	t.debugLog("[POLL] Pane dimensions BEFORE resize: %s", strings.TrimSpace(string(beforeOut)))

	// Resize the tmux WINDOW to match terminal dimensions
	// NOTE: resize-pane doesn't work for single-pane windows - must use resize-window
	if cols > 0 && rows > 0 {
		cmd := exec.Command("tmux", "resize-window", "-t", tmuxSession, "-x", itoa(cols), "-y", itoa(rows))
		err := cmd.Run()
		if err != nil {
			t.debugLog("[POLL] resize-window error: %v", err)
		} else {
			t.debugLog("[POLL] Resized tmux window to %dx%d", cols, rows)
		}

		// Wait for tmux to reflow content after resize
		time.Sleep(50 * time.Millisecond)

		// Verify resize took effect
		afterCmd := exec.Command("tmux", "display", "-t", tmuxSession, "-p", "#{pane_width}x#{pane_height}")
		afterOut, _ := afterCmd.Output()
		t.debugLog("[POLL] Pane dimensions AFTER resize: %s", strings.TrimSpace(string(afterOut)))
	}

	t.tmuxSession = tmuxSession
	t.tmuxPolling = true
	t.tmuxStopChan = make(chan struct{})
	t.tmuxLastState = ""
	t.closed = false
	t.historyTracker = NewHistoryTracker(tmuxSession, rows)

	// Start the polling goroutine
	go t.pollTmuxLoop()

	t.debugLog("[POLL] Polling goroutine started")
	return nil
}

// pollTmuxLoop continuously polls tmux and emits changes to frontend.
func (t *Terminal) pollTmuxLoop() {
	ticker := time.NewTicker(50 * time.Millisecond) // 50ms = 20 FPS, responsive enough
	defer ticker.Stop()

	for {
		select {
		case <-t.tmuxStopChan:
			return
		case <-ticker.C:
			t.pollTmuxOnce()
		}
	}
}

// pollTmuxOnce captures current tmux pane and emits any changes.
// Uses two-phase approach:
// 1. Fetch any history gap (lines that scrolled off between polls)
// 2. Diff viewport for in-place updates (spinners, progress bars)
func (t *Terminal) pollTmuxOnce() {
	t.mu.Lock()
	session := t.tmuxSession
	polling := t.tmuxPolling
	tracker := t.historyTracker
	t.mu.Unlock()

	if !polling || session == "" || tracker == nil {
		return
	}

	// Step 1: Get tmux info - history size and alt-screen status
	historySize, inAltScreen, err := tracker.GetTmuxInfo()
	if err != nil {
		t.debugLog("[POLL] GetTmuxInfo error: %v", err)
		// Session might have ended
		if t.ctx != nil {
			runtime.EventsEmit(t.ctx, "terminal:exit", "tmux session ended")
		}
		t.StopTmuxPolling()
		return
	}

	// Step 2: Track alt-screen state changes (vim, less, htop)
	if inAltScreen != tracker.inAltScreen {
		t.debugLog("[POLL] Alt-screen changed: %v -> %v", tracker.inAltScreen, inAltScreen)
		tracker.SetAltScreen(inAltScreen)
	}

	// Step 3: If NOT in alt-screen, fetch any history gap
	// (Don't append TUI frames to scrollback when in vim/less)
	if !inAltScreen && historySize > 0 {
		gap, err := tracker.FetchHistoryGap(historySize)
		if err != nil {
			t.debugLog("[POLL] FetchHistoryGap error: %v", err)
		} else if len(gap) > 0 {
			// Append gap lines to xterm (blind, no diff - these are history)
			t.debugLog("[POLL] Appending %d bytes of history gap (historySize=%d)", len(gap), historySize)
			if t.ctx != nil {
				runtime.EventsEmit(t.ctx, "terminal:data", gap)
			}
		}
	}

	// Step 4: Capture current viewport
	cmd := exec.Command("tmux", "capture-pane", "-t", session, "-p", "-e")
	output, err := cmd.Output()
	if err != nil {
		t.debugLog("[POLL] capture-pane error: %v", err)
		return
	}

	currentState := string(output)

	// Step 5: Only process if viewport changed
	t.mu.Lock()
	lastState := t.tmuxLastState
	t.mu.Unlock()

	if currentState != lastState {
		t.mu.Lock()
		t.tmuxLastState = currentState
		t.mu.Unlock()

		if t.ctx != nil {
			content := stripTTSMarkers(currentState)

			// Step 6: Diff viewport and emit minimal updates
			updateSequence := tracker.DiffViewport(content)

			if len(updateSequence) > 0 {
				lines := strings.Count(content, "\n")
				t.debugLog("[POLL] Viewport diff: %d bytes update, %d content lines, historySize=%d, altScreen=%v",
					len(updateSequence), lines, historySize, inAltScreen)
				runtime.EventsEmit(t.ctx, "terminal:data", updateSequence)
			}
		}
	}
}

// SendTmuxInput sends user input to the tmux session via send-keys.
func (t *Terminal) SendTmuxInput(data string) error {
	t.mu.Lock()
	session := t.tmuxSession
	polling := t.tmuxPolling
	t.mu.Unlock()

	if !polling || session == "" {
		t.debugLog("[INPUT] Ignoring input - polling=%v session=%q", polling, session)
		return nil
	}

	// Log input for debugging (show hex for control chars)
	if len(data) == 1 && data[0] < 32 {
		t.debugLog("[INPUT] Control char: 0x%02x", data[0])
	} else if len(data) <= 10 {
		t.debugLog("[INPUT] Text: %q", data)
	} else {
		t.debugLog("[INPUT] Text: %q... (%d bytes)", data[:10], len(data))
	}

	// Handle special characters that need tmux key names instead of -l (literal)
	// xterm sends these as control characters, but tmux send-keys -l doesn't
	// interpret them correctly - we need to use tmux key names
	var cmd *exec.Cmd
	switch data {
	case "\r", "\n": // Enter key
		cmd = exec.Command("tmux", "send-keys", "-t", session, "Enter")
	case "\x7f", "\b": // Backspace (DEL or BS)
		cmd = exec.Command("tmux", "send-keys", "-t", session, "BSpace")
	case "\x1b": // Escape
		cmd = exec.Command("tmux", "send-keys", "-t", session, "Escape")
	case "\t": // Tab
		cmd = exec.Command("tmux", "send-keys", "-t", session, "Tab")
	case "\x03": // Ctrl+C
		cmd = exec.Command("tmux", "send-keys", "-t", session, "C-c")
	case "\x04": // Ctrl+D
		cmd = exec.Command("tmux", "send-keys", "-t", session, "C-d")
	case "\x1a": // Ctrl+Z
		cmd = exec.Command("tmux", "send-keys", "-t", session, "C-z")
	case "\x0c": // Ctrl+L (clear)
		cmd = exec.Command("tmux", "send-keys", "-t", session, "C-l")
	default:
		// Check for escape sequences (arrow keys, function keys, etc.)
		if strings.HasPrefix(data, "\x1b[") || strings.HasPrefix(data, "\x1bO") {
			// Arrow keys and special keys come as escape sequences
			switch data {
			case "\x1b[A": // Up arrow
				cmd = exec.Command("tmux", "send-keys", "-t", session, "Up")
			case "\x1b[B": // Down arrow
				cmd = exec.Command("tmux", "send-keys", "-t", session, "Down")
			case "\x1b[C": // Right arrow
				cmd = exec.Command("tmux", "send-keys", "-t", session, "Right")
			case "\x1b[D": // Left arrow
				cmd = exec.Command("tmux", "send-keys", "-t", session, "Left")
			case "\x1b[H": // Home
				cmd = exec.Command("tmux", "send-keys", "-t", session, "Home")
			case "\x1b[F": // End
				cmd = exec.Command("tmux", "send-keys", "-t", session, "End")
			case "\x1b[3~": // Delete
				cmd = exec.Command("tmux", "send-keys", "-t", session, "DC")
			case "\x1b[5~": // Page Up
				cmd = exec.Command("tmux", "send-keys", "-t", session, "PPage")
			case "\x1b[6~": // Page Down
				cmd = exec.Command("tmux", "send-keys", "-t", session, "NPage")
			default:
				// Unknown escape sequence - send literally
				t.debugLog("[INPUT] Unknown escape sequence: %q", data)
				cmd = exec.Command("tmux", "send-keys", "-t", session, "-l", data)
			}
		} else {
			// Regular text - use literal mode
			cmd = exec.Command("tmux", "send-keys", "-t", session, "-l", data)
		}
	}

	err := cmd.Run()
	if err != nil {
		t.debugLog("[INPUT] send-keys error: %v", err)
	}
	return err
}

// ResizeTmuxPane resizes the tmux window to match terminal dimensions.
// NOTE: Named "Pane" for API compatibility but actually resizes the window,
// which is required for single-pane windows.
func (t *Terminal) ResizeTmuxPane(cols, rows int) error {
	t.mu.Lock()
	session := t.tmuxSession
	polling := t.tmuxPolling
	tracker := t.historyTracker
	t.mu.Unlock()

	if !polling || session == "" {
		return nil
	}

	t.debugLog("[RESIZE] Resizing tmux window to %dx%d", cols, rows)

	// Reset history tracker on resize - content will reflow at new width
	if tracker != nil {
		tracker.Reset()
		tracker.SetViewportRows(rows)
		t.debugLog("[RESIZE] Reset history tracker for new dimensions")
	}

	cmd := exec.Command("tmux", "resize-window", "-t", session, "-x", itoa(cols), "-y", itoa(rows))
	return cmd.Run()
}

// StopTmuxPolling stops the polling loop.
func (t *Terminal) StopTmuxPolling() {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.tmuxPolling && t.tmuxStopChan != nil {
		close(t.tmuxStopChan)
		t.tmuxPolling = false
		t.tmuxSession = ""
		t.tmuxLastState = ""
		t.historyTracker = nil

		// Re-enable cursor visibility for next terminal session
		// (polling mode hides cursor because TUI apps draw their own)
		if t.ctx != nil {
			runtime.EventsEmit(t.ctx, "terminal:data", "\x1b[?25h") // Show cursor
		}
	}
}

// IsTmuxPolling returns whether we're in tmux polling mode.
func (t *Terminal) IsTmuxPolling() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.tmuxPolling
}

// itoa converts int to string (simple helper to avoid strconv import).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	if n < 0 {
		return "-" + itoa(-n)
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
