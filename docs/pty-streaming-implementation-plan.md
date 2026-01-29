# PTY Streaming Implementation Plan

**Status:** Council Reviewed - Ready for Implementation
**Branch:** `feature/pty-streaming`
**Worktree:** `../agent-deck-pty-streaming`
**Created:** 2026-01-29
**Council Review:** 2026-01-29 (GPT-5.2, Gemini 3 Pro, Claude Opus 4.5, Grok 4)

---

## Executive Summary

Replace the broken polling + DiffViewport architecture with direct PTY streaming from `tmux attach-session`. The current architecture's viewport diffing algorithm (`DiffViewport()`) generates invalid ANSI escape sequences during fast output, causing rendering corruption that requires window resize to fix.

**Key Insight:** The PTY infrastructure already exists - we already spawn `tmux attach-session` in a PTY and have it working for INPUT. The change is to use its OUTPUT for display instead of discarding it.

### Council Verdict

**Approved with modifications.** The council identified critical issues with the original "Trim Viewport" seam strategy and recommended phase reordering. Key changes incorporated:

1. **Seam strategy refined** - Address capture/attach race condition
2. **Phase order changed** - Prioritize stable streaming before history hydration
3. **Additional edge cases added** - Alternate screen, partial ANSI, UTF-8 boundaries
4. **Rollback strategy strengthened** - Include hard terminal reset

---

## Problem Statement

### Current Architecture (Broken)

```
┌─────────────────────────────────────────────────────────────────┐
│                    POLLING MODE (Current)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. StartTmuxSession() captures full history via capture-pane  │
│   2. Spawns PTY with tmux attach-session                        │
│   3. DISCARDS PTY output (readLoopDiscard())                    │
│   4. pollTmuxLoop() runs every 80ms:                            │
│      └─► capture-pane → DiffViewport() → terminal:data          │
│                                                                  │
│   PROBLEM: DiffViewport() generates bad ANSI sequences          │
│            during fast output, causing rendering corruption      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Root Cause (Confirmed by LLM Council)

The `DiffViewport()` function in `history_tracker.go` compares previous and current viewport states and emits cursor positioning + line updates. During rapid output bursts:
- Lines scroll faster than 80ms poll interval
- Diff algorithm generates sequences like `\x1b[5;1H` (move to row 5)
- But xterm.js cursor is at a different position
- Result: Visual desync, text overlapping, corruption

### Why Polling Was Originally Used

The polling approach was adopted because Claude Code and other TUI apps emit escape sequences (cursor positioning, screen clearing) that prevent xterm.js from building up a proper scrollback buffer. By polling tmux's rendered viewport, the intention was to capture "clean" output.

However, this introduced a worse problem: the diff algorithm itself generates incompatible sequences.

---

## Proposed Architecture: PTY Streaming

```
┌─────────────────────────────────────────────────────────────────┐
│                    PTY STREAMING (Proposed)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. Capture HISTORY ONLY: tmux capture-pane -S - -E -1         │
│      (scrollback above viewport, sanitized)                      │
│                                                                  │
│   2. Emit history → terminal:history → xterm.write()            │
│                                                                  │
│   3. Spawn PTY with tmux attach-session                         │
│      └─► tmux sends full viewport redraw on attach              │
│      └─► PTY output streams directly to terminal:data           │
│                                                                  │
│   4. Resize: PTY.Resize() triggers SIGWINCH → tmux redraws      │
│                                                                  │
│   BENEFIT: Single source of truth, no diff algorithm,           │
│            tmux handles all viewport state                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Works

1. **tmux is a terminal multiplexer** - it maintains complete viewport state
2. **On client attach**, tmux sends a full screen redraw including correct cursor position
3. **On SIGWINCH** (resize), tmux redraws automatically
4. **No dual-state problem** - xterm.js just renders what tmux sends

### The "Seam" Problem and Solution

**Problem:** How do we combine pre-loaded history with live PTY output without duplication or gaps?

**Original Strategy - "Trim Viewport":** Capture history with `-E -1`, then start PTY stream.

**Council Finding:** This strategy has a **critical race condition**:

```
Timeline showing race condition:
  T0: capture-pane returns history (lines 1-500)
  T1: tmux writes lines 501-503 to pane (DURING THE GAP)
  T2: You call attach-session
  T3: PTY stream starts at line 504

  Result: Lines 501-503 LOST FOREVER
```

**Revised Strategy - "Attach-First" (Council Recommended):**

1. **Start PTY stream FIRST** - attach to tmux, begin buffering output
2. **Wait for initial redraw** - tmux sends full viewport on attach
3. **THEN capture history** - capture scrollback relative to the redraw frame
4. **Deduplicate overlap** - compare last N lines of history with first lines of stream

```go
// Revised flow in StartTmuxSession()
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error {
    // 1. Resize tmux window
    // 2. Spawn PTY and START BUFFERING immediately
    // 3. Wait for initial redraw frame (detect via heuristic or timeout)
    // 4. THEN capture history with -E -(pane_height)
    // 5. Emit history, then flush buffered PTY data
    // 6. Continue streaming
}
```

**Why Attach-First Works:**
- No gap for data loss - we're already listening when tmux writes
- May have duplicates, but duplicates are safer than loss
- Deduplication can compare line content to trim overlap

**Alternative for Phase 1:** Skip history entirely, prove streaming works first (council recommended).

**Research Verification:**
```
history_size=21, pane_height=10, cursor_y=9 (bottom)

capture-pane -S - -E -1:  21 lines (scrollback only)
capture-pane (default):   10 lines (viewport only)
No overlap, clean seam!

NOTE: The "-E -1" approach works statically but has race condition
during the capture→attach transition. Use attach-first for safety.
```

---

## Implementation Phases

**Council Recommendation:** Reorder phases to prioritize stable streaming before history hydration.

### Phase 1: Stable Streaming Viewport (NO HISTORY)

**Goal:** Prove PTY streaming works for live viewport. **Ignore scrollback history initially.**

This phase directly fixes the corruption bug with minimum complexity.

**SSH Compatibility:** SSH sessions will continue using the existing polling implementation until Phase 4. This ensures no breakage for SSH users (a mandatory daily use feature).

#### 1.0 Pre-flight Checks

Before implementing, verify these tmux configurations:

```go
// Verify tmux status bar is hidden (council edge case: UI leakage)
func verifyTmuxConfig(tmuxSession string) error {
    // Check if status is off
    cmd := exec.Command(tmuxBinaryPath, "show-option", "-t", tmuxSession, "-v", "status")
    output, _ := cmd.Output()
    status := strings.TrimSpace(string(output))

    if status != "off" {
        // Force status off for this session
        exec.Command(tmuxBinaryPath, "set-option", "-t", tmuxSession, "status", "off").Run()
        log.Printf("[PTY-STREAM] Forced tmux status off for session %s", tmuxSession)
    }
    return nil
}
```

**Manual verification:**
```bash
# Check current tmux status setting
tmux show-option -g status
# Should output: status off

# If not, RevDen should set it per-session on attach
```

#### 1.1 Modify StartTmuxSession() - Streaming Only

**Current code path:**
```go
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error {
    // 1. Resize tmux window
    // 2. Capture FULL history: capture-pane -S - -E -
    // 3. Emit via terminal:history
    // 4. Spawn PTY
    // 5. go t.readLoopDiscard()  // ← DISCARD OUTPUT
    // 6. t.startTmuxPolling()    // ← START POLLING
}
```

**Phase 1 code path (NO HISTORY):**
```go
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error {
    // 1. Resize tmux window
    // 2. Spawn PTY with tmux attach-session
    // 3. go t.readLoopStream()   // ← STREAM OUTPUT
    // 4. tmux sends full viewport redraw on attach
    // 5. NO history capture, NO polling
    //
    // Scrollback will be empty until Phase 2
}
```

**Why skip history in Phase 1:**
- Simplest possible change to fix corruption
- Proves streaming works under fast output (`seq 1 10000`)
- No race conditions to debug
- Can still scroll within viewport, just no pre-attach history

#### 1.2 New Function: readLoopStream()

```go
// readLoopStream reads from PTY and emits to frontend.
// This is the core of the PTY streaming architecture.
func (t *Terminal) readLoopStream() {
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
                runtime.EventsEmit(t.ctx, "terminal:exit",
                    TerminalEvent{SessionID: t.sessionID, Data: err.Error()})
            }
            return
        }

        if n > 0 && t.ctx != nil {
            data := string(buf[:n])
            data = stripTTSMarkers(data)
            if len(data) > 0 {
                runtime.EventsEmit(t.ctx, "terminal:data",
                    TerminalEvent{SessionID: t.sessionID, Data: data})
            }
        }
    }
}
```

#### 1.3 Modify History Capture

**Before:**
```go
historyCmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession,
    "-p", "-e", "-S", "-", "-E", "-")  // Full content
```

**After:**
```go
historyCmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession,
    "-p", "-e", "-S", "-", "-E", "-1")  // Scrollback only, exclude viewport
```

#### 1.4 Remove/Disable Polling for Display

Keep polling infrastructure for status detection but don't use it for display:

```go
// Option A: Remove polling entirely
// func (t *Terminal) startTmuxPolling(...) - DELETE or mark deprecated

// Option B: Lightweight status polling (recommended for Phase 1)
func (t *Terminal) startStatusPolling(tmuxSession string) {
    ticker := time.NewTicker(500 * time.Millisecond)  // Slower is fine
    defer ticker.Stop()

    for {
        select {
        case <-t.tmuxStopChan:
            return
        case <-ticker.C:
            t.pollStatusOnly()  // Just check alt-screen state
        }
    }
}

func (t *Terminal) pollStatusOnly() {
    // Only query tmux for alt-screen status, no capture-pane
    cmd := exec.Command(tmuxBinaryPath, "display-message", "-t", t.tmuxSession,
        "-p", "#{alternate_on}")
    output, err := cmd.Output()
    if err != nil {
        return
    }

    inAltScreen := strings.TrimSpace(string(output)) == "1"
    if inAltScreen != t.lastAltScreen {
        t.lastAltScreen = inAltScreen
        if t.ctx != nil {
            runtime.EventsEmit(t.ctx, "terminal:altscreen", map[string]interface{}{
                "sessionId":   t.sessionID,
                "inAltScreen": inAltScreen,
            })
        }
    }
}
```

#### 1.5 Handle Partial UTF-8 Sequences (Council Edge Case)

PTY reads can split multi-byte UTF-8 characters at arbitrary boundaries:

```go
type PTYStreamReader struct {
    pty            *PTY
    incompleteUTF8 []byte
}

func (r *PTYStreamReader) Read() (string, error) {
    buf := make([]byte, 32*1024)
    n, err := r.pty.Read(buf)
    if err != nil {
        return "", err
    }

    // Combine with previous incomplete sequence
    data := append(r.incompleteUTF8, buf[:n]...)

    // Find last valid UTF-8 boundary
    validEnd := findLastValidUTF8Boundary(data)
    r.incompleteUTF8 = data[validEnd:]

    return string(data[:validEnd]), nil
}

func findLastValidUTF8Boundary(data []byte) int {
    // Walk backwards to find complete UTF-8 sequence
    for i := len(data) - 1; i >= 0 && i >= len(data)-4; i-- {
        if utf8.RuneStart(data[i]) {
            // Check if this rune is complete
            r, size := utf8.DecodeRune(data[i:])
            if r != utf8.RuneError && i+size == len(data) {
                return len(data) // All complete
            }
            return i // Incomplete, return up to this point
        }
    }
    return len(data)
}
```

### Phase 2: History Hydration (The Seam)

**Goal:** Add scrollback history using the "Attach-First" strategy.

#### 2.1 Attach-First Seam Implementation

```go
func (t *Terminal) StartTmuxSessionWithHistory(tmuxSession string, cols, rows int) error {
    // 1. Resize tmux window
    resizeCmd := exec.Command(tmuxBinaryPath, "resize-window", "-t", tmuxSession,
        "-x", itoa(cols), "-y", itoa(rows))
    resizeCmd.Run()

    // 2. Spawn PTY and START BUFFERING immediately
    pty, err := SpawnPTYWithCommand(tmuxBinaryPath, "attach-session", "-t", tmuxSession)
    if err != nil {
        return err
    }
    t.pty = pty

    // 3. Start buffering PTY output (don't emit yet)
    streamBuffer := &bytes.Buffer{}
    bufferDone := make(chan struct{})
    go func() {
        buf := make([]byte, 32*1024)
        for {
            select {
            case <-bufferDone:
                return
            default:
                n, err := pty.Read(buf)
                if err != nil {
                    close(bufferDone)
                    return
                }
                streamBuffer.Write(buf[:n])
            }
        }
    }()

    // 4. Wait for initial redraw (heuristic: 100ms or detect clear sequence)
    time.Sleep(100 * time.Millisecond)

    // 5. NOW capture history (after attach, so no race)
    historyCmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession,
        "-p", "-e", "-S", "-", "-E", fmt.Sprintf("-%d", rows))
    historyOutput, _ := historyCmd.Output()

    // 6. Emit history
    if len(historyOutput) > 0 {
        history := sanitizeHistoryForXterm(string(historyOutput))
        runtime.EventsEmit(t.ctx, "terminal:history",
            TerminalEvent{SessionID: t.sessionID, Data: history})
    }

    // 7. Stop buffering, dedupe, then emit buffered data
    close(bufferDone)
    bufferedData := streamBuffer.String()
    // TODO: Dedupe overlap between history tail and buffered data head
    runtime.EventsEmit(t.ctx, "terminal:data",
        TerminalEvent{SessionID: t.sessionID, Data: bufferedData})

    // 8. Switch to live streaming
    go t.readLoopStream()

    return nil
}
```

### Phase 3: Resize Handling

**Goal:** Ensure smooth resize with proper SIGWINCH propagation.

**Council Note:** Resize is the #1 cause of PTY stream corruption. SIGWINCH must propagate correctly from frontend → PTY → tmux → shell.

#### 3.1 Modify Resize() in terminal.go

```go
func (t *Terminal) Resize(cols, rows int) error {
    t.mu.Lock()
    p := t.pty
    session := t.tmuxSession
    t.mu.Unlock()

    // Resize PTY - sends SIGWINCH to tmux client
    if p != nil {
        if err := p.Resize(uint16(cols), uint16(rows)); err != nil {
            t.debugLog("[RESIZE] PTY resize error: %v", err)
        }
    }

    // Also resize tmux window (belt and suspenders)
    if session != "" {
        cmd := exec.Command(tmuxBinaryPath, "resize-window", "-t", session,
            "-x", itoa(cols), "-y", itoa(rows))
        cmd.Run()
    }

    // tmux will send a full viewport redraw automatically via PTY
    // No need to manually refresh - the stream handles it!

    return nil
}
```

#### 3.2 Frontend Resize Handling

The frontend already has resize logic in `Terminal.jsx`. For PTY streaming:

```javascript
// Current: refreshScrollbackAfterResize() clears xterm and re-fetches history
//
// For PTY streaming, we may NOT need this - tmux's redraw should be sufficient.
// However, keep it as a fallback for edge cases (scrollback truncation on resize).

const refreshScrollbackAfterResize = async () => {
    // Only refresh if scrollback was truncated during resize
    // This is a defensive measure, not the primary mechanism
    if (!session?.tmuxSession || !xtermRef.current) return;

    try {
        await RefreshTerminalAfterResize(sessionId);
    } catch (err) {
        logger.error('[RESIZE-REFRESH] Failed:', err);
    }
};
```

### Phase 4: Remote Sessions (SSH)

**Goal:** Extend PTY streaming to SSH sessions.

**IMPORTANT:** SSH is a mandatory daily-use feature. Until this phase is complete, SSH sessions will continue using the existing polling implementation. The Phase 1-3 changes are scoped to LOCAL sessions only via:

```go
func (t *Terminal) StartTmuxSession(...) error {
    if t.isRemoteSession {
        // Use existing polling implementation (unchanged)
        return t.startTmuxSessionPolling(...)
    }

    // Use new PTY streaming for local sessions
    return t.startTmuxSessionStreaming(...)
}
```

**Council Additions for Remote Sessions:**

1. **Backpressure/Flow Control** - If remote outputs faster than network can handle, need buffering strategy
2. **Reconnect Strategy** - On SSH disconnect, re-attach and rebuild state
3. **SSH Keepalives** - Streaming connections drop faster than polling; implement keepalives
4. **TERM Mismatch** - Ensure `TERM` env var matches frontend renderer capabilities

The existing `SpawnSSHPTY()` function already handles the basic pattern:

```go
// From pty.go - already exists!
func SpawnSSHPTY(hostID, tmuxSession string, sshBridge *SSHBridge) (*PTY, error) {
    conn, err := sshBridge.GetConnection(hostID)
    // ...
    attachCmd := fmt.Sprintf("%s attach-session -t %q", tmuxPath, tmuxSession)
    sshCmd, err := conn.StartInteractiveSession(attachCmd)
    // ...
    ptmx, err := pty.Start(sshCmd)
    return &PTY{cmd: sshCmd, file: ptmx}, nil
}
```

#### 4.1 Modify StartRemoteTmuxSession()

Same pattern as local, with additional SSH considerations:

```go
func (t *Terminal) StartRemoteTmuxSession(...) error {
    // 1. SSH resize command
    // 2. SSH capture history (Phase 2 attach-first strategy)
    // 3. Emit via terminal:history
    // 4. Spawn SSH PTY
    // 5. go t.readLoopStream()  // Same streaming loop!
    // 6. Start SSH keepalive goroutine (council recommendation)
}
```

#### 4.2 SSH Reconnection Handler (Council Recommendation)

```go
func (t *Terminal) handleSSHReconnect() {
    // 1. Stop current stream
    t.Close()

    // 2. Re-establish SSH connection
    conn, err := t.sshBridge.Reconnect(t.remoteHostID)
    if err != nil {
        // Emit connection-failed event
        return
    }

    // 3. Re-attach with full state rebuild
    // Uses Phase 2 attach-first strategy
    t.StartRemoteTmuxSession(...)
}
```

The key insight: Once we have a PTY (local or SSH), `readLoopStream()` works identically.

### Phase 5: Cleanup and Polish

#### 4.1 Remove Dead Code

- `DiffViewport()` in history_tracker.go (or mark deprecated)
- `FetchHistoryGap()` - no longer needed
- `buildFullViewportOutput()` - no longer needed
- `pollTmuxLoop()` for display purposes

#### 4.2 Update HistoryTracker

Repurpose or simplify:

```go
// Option A: Remove entirely - no longer needed
// Option B: Keep for status tracking only
type StatusTracker struct {
    tmuxSession  string
    lastAltScreen bool
}
```

#### 4.3 Update Frontend

Simplify `Terminal.jsx`:

- Remove debug overlay code (or keep for development)
- Simplify event handling (terminal:data is now direct stream)
- Keep RAF batching for performance

---

## Function Signatures

### New Functions

```go
// terminal.go

// readLoopStream reads PTY output and emits to frontend.
// Replaces readLoopDiscard() for display.
func (t *Terminal) readLoopStream()

// startStatusPolling monitors alt-screen state without display polling.
// Optional - can be removed if alt-screen tracking is handled differently.
func (t *Terminal) startStatusPolling(tmuxSession string)

// pollStatusOnly queries tmux for alt-screen status only.
func (t *Terminal) pollStatusOnly()
```

### Modified Functions

```go
// terminal.go

// StartTmuxSession - modified to use PTY streaming
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error
// Changes:
// - History capture uses -E -1 instead of -E -
// - Calls readLoopStream() instead of readLoopDiscard()
// - Does not start display polling

// StartRemoteTmuxSession - modified to use PTY streaming
func (t *Terminal) StartRemoteTmuxSession(...) error
// Same changes as StartTmuxSession

// Resize - simplified, relies on SIGWINCH
func (t *Terminal) Resize(cols, rows int) error
// Changes:
// - Remove history tracker reset
// - Remove manual refresh logic
```

### Deprecated/Removed Functions

```go
// terminal.go
func (t *Terminal) pollTmuxLoop()      // Remove or repurpose
func (t *Terminal) pollTmuxOnce()      // Remove

// history_tracker.go
func (ht *HistoryTracker) DiffViewport(...)      // Remove
func (ht *HistoryTracker) FetchHistoryGap(...)   // Remove
func (ht *HistoryTracker) buildFullViewportOutput(...) // Remove
```

---

## Event Flow Diagrams

### Initial Connection

```
┌──────────────────────────────────────────────────────────────────┐
│                    INITIAL CONNECTION FLOW                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Frontend                    Backend                   tmux       │
│     │                          │                         │        │
│     │  StartTmuxSession()      │                         │        │
│     │─────────────────────────>│                         │        │
│     │                          │                         │        │
│     │                          │  resize-window          │        │
│     │                          │────────────────────────>│        │
│     │                          │                         │        │
│     │                          │  capture-pane -E -1     │        │
│     │                          │────────────────────────>│        │
│     │                          │<────────────────────────│        │
│     │                          │  (scrollback only)      │        │
│     │                          │                         │        │
│     │  terminal:history        │                         │        │
│     │<─────────────────────────│                         │        │
│     │  xterm.write(history)    │                         │        │
│     │                          │                         │        │
│     │                          │  PTY: tmux attach       │        │
│     │                          │────────────────────────>│        │
│     │                          │<════════════════════════│        │
│     │                          │  VIEWPORT REDRAW        │        │
│     │                          │  (cursor positioning,   │        │
│     │                          │   all visible lines)    │        │
│     │                          │                         │        │
│     │  terminal:data           │                         │        │
│     │<═════════════════════════│                         │        │
│     │  xterm.write(viewport)   │                         │        │
│     │                          │                         │        │
│     │    ═══ STREAMING ═══     │                         │        │
│     │<═════════════════════════│<════════════════════════│        │
│     │   (live output)          │   (PTY output)          │        │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Resize Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                       RESIZE FLOW                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Frontend                    Backend                   tmux       │
│     │                          │                         │        │
│     │  ResizeTerminal()        │                         │        │
│     │─────────────────────────>│                         │        │
│     │                          │                         │        │
│     │                          │  PTY.Resize()           │        │
│     │                          │  (sends SIGWINCH)       │        │
│     │                          │────────────────────────>│        │
│     │                          │                         │        │
│     │                          │  resize-window          │        │
│     │                          │────────────────────────>│        │
│     │                          │                         │        │
│     │                          │<════════════════════════│        │
│     │                          │  VIEWPORT REDRAW        │        │
│     │                          │  (automatic on resize)  │        │
│     │                          │                         │        │
│     │  terminal:data           │                         │        │
│     │<═════════════════════════│                         │        │
│     │  xterm.write(redraw)     │                         │        │
│     │                          │                         │        │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Test Plan

### Manual Tests

#### Phase 1 Tests (Local Sessions)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **Basic attach** | Start Claude session, attach via desktop app | Terminal displays correctly, can type |
| **seq 1 10000** | Run `seq 1 10000` in attached session | All numbers visible, no corruption |
| **Fast output** | Run `/context` in Claude Code | Renders cleanly, no overlapping text |
| **Scroll up** | Mouse wheel up after large output | Can scroll through history |
| **Search** | Cmd+F, search for text | Finds matches in scrollback |
| **History preserved** | Scroll up after attach | Previous session content visible |
| **Cursor position** | After output stops, type | Cursor at correct position |

#### Phase 2 Tests (Resize)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **Resize during idle** | Resize window when no output | Content reflows cleanly |
| **Resize during output** | Resize while `seq` running | No corruption, continues correctly |
| **Resize scrollback** | Scroll up, then resize | Scrollback still accessible |
| **Rapid resize** | Drag window edge quickly | No crash, eventual correct state |

#### Phase 3 Tests (Remote Sessions)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **SSH attach** | Attach to remote tmux session | Same behavior as local |
| **SSH fast output** | Run `seq 1 10000` on remote | All numbers visible |
| **SSH disconnect** | Kill SSH, reconnect | Reconnection works |
| **SSH resize** | Resize remote session | Redraws correctly |

#### Regression Tests (Existing Features)

| Feature | Test | Pass Criteria |
|---------|------|---------------|
| **Scrolling** | Wheel scroll | Smooth, indicator works |
| **Copy** | Select + Cmd+C | Text in clipboard |
| **Paste** | Cmd+V | Text inserted |
| **Search** | Cmd+F | Matches found |
| **Alt-screen** | Open vim | Page Up/Down work |
| **Soft newline** | Shift+Enter | Newline without execute |

### Automated Tests

```go
// terminal_test.go

func TestReadLoopStream_EmitsData(t *testing.T) {
    // Create mock PTY that writes known data
    // Verify terminal:data events emitted correctly
}

func TestHistoryCapture_ExcludesViewport(t *testing.T) {
    // Create tmux session with known content
    // Capture with -E -1
    // Verify viewport rows not included
}

func TestResize_TriggersRedraw(t *testing.T) {
    // Attach to session
    // Call Resize()
    // Verify PTY receives SIGWINCH
    // Verify tmux sends redraw
}
```

---

## Rollback Strategy

**Council Critical Finding:** Rollback must handle **terminal state pollution**, not just code switching.

### The State Problem

If you switch from Streaming back to Polling mid-session:
- Frontend terminal may be stuck in alternate screen mode
- Cursor position may be wrong
- Colors/styles may be corrupted
- Simply switching code paths won't fix the visual state

### Hard Reset Requirement (Council Mandated)

**Every rollback MUST include a terminal state reset:**

```go
func (t *Terminal) executeRollback() {
    // 1. Stop PTY streaming
    t.Close()

    // 2. Send terminal reset sequence to frontend
    // RIS (Reset to Initial State) clears all modes and state
    if t.ctx != nil {
        runtime.EventsEmit(t.ctx, "terminal:reset",
            TerminalEvent{SessionID: t.sessionID, Data: "\x1bc"})
    }

    // 3. Clear frontend terminal buffer
    // Frontend should call xterm.reset() on receiving terminal:reset

    // 4. THEN re-initialize with polling
    go t.readLoopDiscard()
    t.startTmuxPolling(t.tmuxSession, t.viewportRows)

    // 5. Re-capture and emit full history
    t.emitFullHistory()
}
```

### Frontend Reset Handler

```javascript
// Terminal.jsx - add handler for terminal:reset event
const handleTerminalReset = (payload) => {
    if (payload?.sessionId !== sessionId) return;

    if (xtermRef.current) {
        // Full terminal reset
        xtermRef.current.reset();
        xtermRef.current.clear();
        logger.info('[RESET] Terminal state cleared for rollback');
    }
};
const cancelReset = EventsOn('terminal:reset', handleTerminalReset);
```

### Feature Flag Approach (Recommended)

Add a config option to switch between modes:

```go
// terminal.go
func (t *Terminal) StartTmuxSession(...) error {
    // ...

    if t.usePTYStreaming {
        // New path: PTY streaming
        go t.readLoopStream()
    } else {
        // Old path: Polling
        go t.readLoopDiscard()
        t.startTmuxPolling(tmuxSession, rows)
    }
}
```

```toml
# config.toml
[desktop]
use_pty_streaming = true  # false to rollback
```

### Environment Variable Toggle

Control streaming mode via environment variable:

```bash
# Enable PTY streaming (will be default eventually)
export REVDEN_PTY_STREAMING=enabled

# Disable to use legacy polling
export REVDEN_PTY_STREAMING=disabled
```

```go
// Check env var - defaults to enabled once stable
func (t *Terminal) shouldUsePTYStreaming() bool {
    env := os.Getenv("REVDEN_PTY_STREAMING")
    if env == "disabled" {
        return false
    }
    return true  // Default: enabled
}
```

---

## Risk Assessment

### Council-Identified Edge Cases (Must Address)

| Edge Case | Description | Mitigation |
|-----------|-------------|------------|
| **Alternate Screen Buffer** | vim/htop use alternate screen; history shouldn't be prepended there | Detect `#{alternate_on}` via tmux; skip history in alt-screen mode |
| **Partial ANSI Sequences** | PTY chunks can split `\x1b[` from `31m` | Stateful ANSI parser that buffers incomplete sequences |
| **Partial UTF-8 Sequences** | Multi-byte chars can split at read boundaries | Buffer incomplete UTF-8; emit only complete runes |
| **tmux Status Bar Leakage** | `attach-session` shows full tmux UI including status bar | RevDen hides tmux status via `set -g status off` (already configured) |
| **Resize/Reflow Desync** | Resize can cause history/viewport mismatch | Trust SIGWINCH; add fallback full refresh |
| **Connection Drop Mid-Sequence** | SSH dies while `\x1b[38;2;255;` in progress | Reset ANSI parser state on reconnect |

### Phase 1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Partial ANSI corruption** | Medium | High | Implement stateful parser (see 1.5) |
| **Initial cursor wrong** | Medium | Medium | tmux sends cursor position on attach |
| **Performance regression** | Low | Medium | Compare CPU/memory vs polling |
| **tmux version variance** | Low | Medium | Test tmux 2.x and 3.x |

### Phase 2 Risks (History Hydration)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Capture/attach race** | High | High | Use attach-first strategy (council fix) |
| **Duplicate lines at seam** | Medium | Low | Dedupe overlap buffer |
| **Alt-screen history injection** | Medium | Medium | Skip history when `#{alternate_on}` |

### Phase 3 Risks (Resize)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Resize corruption** | Medium | Medium | Trust SIGWINCH; add fallback refresh |
| **Scrollback truncation** | Low | High | Keep refresh-after-resize as safety net |

### Phase 4 Risks (SSH)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Backpressure overflow** | Medium | High | Implement flow control or throttling |
| **SSH latency affects streaming** | Medium | Medium | Buffer and batch |
| **SSH reconnection breaks state** | Medium | High | Full state rebuild on reconnect |
| **Keepalive timeout** | Medium | Medium | Implement SSH keepalives |

### Overall Assessment

**Risk Level: Medium**

The PTY streaming approach is fundamentally simpler than polling + diff. The council identified critical edge cases that must be addressed, particularly:
1. The capture/attach race condition (fixed by attach-first strategy)
2. Partial sequence handling (UTF-8 and ANSI)
3. Terminal state reset on rollback

The rollback strategy with hard reset provides a safety net.

---

## Success Criteria

### Must Have (Phase 1)

- [ ] `seq 1 10000` renders all numbers correctly
- [ ] `/context` in Claude Code renders without corruption
- [ ] No visible "seam" between history and viewport
- [ ] Cursor is at correct position after attach
- [ ] Typing works immediately after attach
- [ ] Scroll up reveals history

### Should Have (Phase 2-3)

- [ ] Resize works smoothly
- [ ] Remote sessions work identically to local
- [ ] Alt-screen apps (vim, nano) work correctly
- [ ] No performance regression vs polling

### Nice to Have (Phase 4)

- [ ] Code cleanup complete
- [ ] Test coverage for new code
- [ ] Documentation updated

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 2-4 hours | None |
| Phase 2 | 1-2 hours | Phase 1 |
| Phase 3 | 2-3 hours | Phase 1 |
| Phase 4 | 1-2 hours | Phases 1-3 |

**Total: 6-11 hours**

Note: Actual time depends on edge cases discovered during testing.

---

## Open Questions

1. **Alt-screen detection:** Should we keep lightweight polling for alt-screen state, or can we detect it from PTY output?

2. **History refresh on reconnect:** When SSH reconnects, should we re-emit full history or just resume streaming?

3. **Frontend buffer size:** Is the current RAF batching sufficient, or do we need larger buffers for PTY streaming?

4. **Debug tooling:** Should we keep the debug overlay (Cmd+Shift+D) or remove it?

---

## Appendix: Research Findings

### History Capture Verification

```bash
# Test showing -E -1 correctly excludes viewport
tmux new-session -d -s test -x 80 -y 10
for i in $(seq 1 30); do tmux send-keys -t test "echo 'LINE_$i'" Enter; done
sleep 0.3

tmux display-message -t test -p "history_size=#{history_size}, pane_height=#{pane_height}"
# Output: history_size=21, pane_height=10

tmux capture-pane -t test -p -S - -E -1 | wc -l
# Output: 21 (scrollback only)

tmux capture-pane -t test -p | wc -l
# Output: 10 (viewport only)

# Total: 31 lines, 21 + 10 = 31, clean seam!
```

### tmux Attach Behavior

Per tmux documentation and empirical testing:
- Attaching a client causes tmux to send a full viewport redraw
- The redraw includes cursor positioning sequences
- SIGWINCH to the PTY triggers another full redraw

### Existing PTY Infrastructure

The codebase already has:
- `SpawnPTYWithCommand()` - spawns local PTY with any command
- `SpawnSSHPTY()` - spawns PTY running SSH session
- `PTY.Read()`, `PTY.Write()`, `PTY.Resize()`, `PTY.Close()`

The current code spawns the PTY but discards its output (`readLoopDiscard()`). The change is to use its output for display.

---

## Appendix: LLM Council Deliberation Summary

### Council Composition
- **GPT-5.2** (OpenAI) - Ranked #1 by peers
- **Claude Opus 4.5** (Anthropic)
- **Gemini 3 Pro** (Google) - Served as Chairman
- **Grok 4** (xAI)

### Key Council Findings

#### 1. Seam Strategy Verdict: **Brittle in Original Form**

The council unanimously identified the capture/attach race condition as the critical flaw:

> "There is a time gap between the execution of `capture-pane` and the moment `tmux attach-session` emits its initial full redraw. Output generated during this gap may be lost or duplicated."

**Solution adopted:** Attach-first strategy (see Phase 2).

#### 2. Missing Edge Cases Identified

The council identified six critical edge cases not in the original plan:
- Alternate screen buffer handling
- Partial ANSI sequence splitting
- Partial UTF-8 character splitting
- tmux status bar leakage
- Resize/reflow desynchronization
- Connection drop mid-sequence

All have been added to the risk assessment with mitigations.

#### 3. Phase Reordering Recommendation

> "The current plan likely attempts to solve the seamless history (the 'hard part') before validating the stream. We recommend prioritizing stable streaming viewport first."

**Adopted:** Phase 1 now focuses on streaming only (no history), Phase 2 adds history hydration.

#### 4. Rollback Strategy Strengthening

> "The rollback plan needs to account for State Pollution, not just code switching... The Rollback mechanism must include a soft reset."

**Adopted:** Added mandatory terminal reset (`\x1bc` / RIS) on rollback.

#### 5. Remote SSH Considerations

Council added requirements for:
- Backpressure/flow control
- SSH keepalives
- Reconnection with full state rebuild
- TERM environment variable matching

### Council Consensus Statement

> "The proposal to replace polling with direct PTY streaming is architecturally sound and necessary to resolve the rendering corruption issues. However, the specific 'Trim Viewport' seam strategy is brittle and introduces a critical race condition. Additionally, there is a major integration risk regarding tmux UI leakage that appears unaddressed."

**Final verdict:** Approved with modifications (incorporated into this plan).
