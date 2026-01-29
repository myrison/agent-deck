# PTY Streaming Implementation Plan

**Status:** Final Council Review Complete - Ready for Implementation
**Branch:** `feature/pty-streaming`
**Worktree:** `../agent-deck-pty-streaming`
**Created:** 2026-01-29
**Council Review #1:** 2026-01-29 (GPT-5.2, Gemini 3 Pro, Claude Opus 4.5, Grok 4)
**Council Review #2:** 2026-01-29 (Final Review - same council)

---

## Executive Summary

Replace the broken polling + DiffViewport architecture with direct PTY streaming from `tmux attach-session`. The current architecture's viewport diffing algorithm (`DiffViewport()`) generates invalid ANSI escape sequences during fast output, causing rendering corruption that requires window resize to fix.

**Key Insight:** The PTY infrastructure already exists - we already spawn `tmux attach-session` in a PTY and have it working for INPUT. The change is to use its OUTPUT for display instead of discarding it.

### Council Verdict

**Approved with modifications.** Two council reviews were conducted. Key changes incorporated:

**Review #1 Changes:**
1. **Seam strategy refined** - Address capture/attach race condition
2. **Phase order changed** - Prioritize stable streaming before history hydration
3. **Additional edge cases added** - Alternate screen, partial ANSI, UTF-8 boundaries
4. **Rollback strategy strengthened** - Include hard terminal reset

**Review #2 Changes (Final):**
1. **"Blank Terminal" fix** - Phase 1 MUST include initial viewport snapshot (not just streaming)
2. **Throttling merged into Phase 1** - Client-side RAF batching to prevent DOM freezing
3. **Resize epochs added** - Prevent race condition between resize and in-flight data
4. **ANSI buffering removed** - Only buffer UTF-8 boundaries; xterm.js handles ANSI natively
5. **Risk priority reordered** - DOM freezing and blank screen are top priorities

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

### Phase 1: Stable Streaming Viewport (NO SCROLLBACK HISTORY)

**Goal:** Prove PTY streaming works for live viewport with initial state. **Ignore scrollback history initially.**

This phase directly fixes the corruption bug with minimum complexity.

**Critical Council Requirements (Review #2):**
1. **Initial viewport snapshot** - MUST capture and emit current visible pane on connect (prevents blank terminal)
2. **Client-side throttling** - MUST batch writes to xterm.js via requestAnimationFrame (prevents DOM freezing)
3. **Resize epochs** - MUST tag data with resize ID to prevent race conditions

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

**Phase 1 code path (WITH INITIAL VIEWPORT, NO SCROLLBACK):**
```go
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error {
    // 1. Resize tmux window
    // 2. Capture CURRENT VIEWPORT: capture-pane -p -e (visible pane only)
    // 3. Emit viewport via terminal:initial → xterm.write()
    // 4. Spawn PTY with tmux attach-session
    // 5. go t.readLoopStream()   // ← STREAM OUTPUT
    // 6. tmux sends full viewport redraw on attach (may duplicate, that's OK)
    // 7. NO scrollback history capture, NO polling
    //
    // Scrollback will be empty until Phase 2, but terminal is NOT blank
}
```

**Why this approach (Council Review #2):**
- **NOT blank on connect** - User sees current terminal state immediately
- Simplest possible change to fix corruption
- Proves streaming works under fast output (`seq 1 10000`)
- No race conditions to debug
- Can still scroll within viewport, just no pre-attach scrollback

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

#### 1.5 Handle Partial UTF-8 Sequences ONLY (Council Review #2 Clarification)

**Council Directive:** Buffer ONLY for UTF-8 byte boundaries. Do NOT attempt to parse or buffer ANSI escape sequences on the backend - xterm.js has a robust internal state machine that handles escape sequences split across packet boundaries perfectly.

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

#### 1.6 Initial Viewport Snapshot (Council Review #2 - MANDATORY)

**Problem:** If we skip history and only stream, the terminal is BLANK on connection until new output arrives.

**Solution:** Capture and emit the current visible pane BEFORE starting the stream.

```go
func (t *Terminal) StartTmuxSession(tmuxSession string, cols, rows int) error {
    // ... resize tmux window ...

    // MANDATORY: Capture current viewport BEFORE streaming
    // This prevents the "blank terminal" problem identified in Council Review #2
    viewportCmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", tmuxSession,
        "-p", "-e")  // Current viewport only (no -S or -E flags)
    viewportOutput, err := viewportCmd.Output()
    if err == nil && len(viewportOutput) > 0 {
        viewport := sanitizeHistoryForXterm(string(viewportOutput))
        runtime.EventsEmit(t.ctx, "terminal:initial",
            TerminalEvent{SessionID: t.sessionID, Data: viewport})
    }

    // Then spawn PTY and start streaming...
}
```

#### 1.7 Client-Side RAF Throttling (Council Review #2 - MANDATORY)

**Problem:** Raw streaming without rate-limiting will freeze the browser DOM if user runs `cat /dev/urandom` or dumps massive logs.

**Solution:** Batch writes to xterm.js via requestAnimationFrame.

```javascript
// Terminal.jsx - RAF batching for terminal writes
class TerminalWriter {
    constructor(terminal) {
        this.terminal = terminal;
        this.pendingData = '';
        this.rafId = null;
    }

    write(data) {
        this.pendingData += data;

        // Only schedule RAF if not already pending
        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
                if (this.pendingData.length > 0) {
                    this.terminal.write(this.pendingData);
                    this.pendingData = '';
                }
                this.rafId = null;
            });
        }
    }

    flush() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.pendingData.length > 0) {
            this.terminal.write(this.pendingData);
            this.pendingData = '';
        }
    }
}

// Usage in event handler
const writer = new TerminalWriter(xtermRef.current);
EventsOn('terminal:data', (payload) => {
    if (payload?.sessionId === sessionId && payload.data) {
        writer.write(payload.data);  // Batched via RAF
    }
});
```

#### 1.8 Resize Epochs (Council Review #2 - MANDATORY)

**Problem:** When user resizes the window, there's a race between:
1. Resize event reaching the server
2. In-flight data (formatted for OLD dimensions) reaching the client

**Solution:** Tag resize operations with an epoch ID. Discard stale data.

```go
// Backend: Track resize epoch
type Terminal struct {
    // ... existing fields ...
    resizeEpoch uint64
}

func (t *Terminal) Resize(cols, rows int) error {
    t.mu.Lock()
    t.resizeEpoch++
    epoch := t.resizeEpoch
    t.mu.Unlock()

    // Emit resize epoch to frontend
    if t.ctx != nil {
        runtime.EventsEmit(t.ctx, "terminal:resize-epoch",
            map[string]interface{}{
                "sessionId": t.sessionID,
                "epoch":     epoch,
            })
    }

    // ... existing resize logic ...
}
```

```javascript
// Frontend: Discard stale data after resize
let currentResizeEpoch = 0;
let resizeGraceUntil = 0;

EventsOn('terminal:resize-epoch', (payload) => {
    if (payload?.sessionId === sessionId) {
        currentResizeEpoch = payload.epoch;
        resizeGraceUntil = Date.now() + 100; // 100ms grace period
    }
});

EventsOn('terminal:data', (payload) => {
    // During grace period after resize, be cautious
    if (Date.now() < resizeGraceUntil) {
        // Option 1: Buffer and apply after grace period
        // Option 2: Apply anyway (tmux redraw will fix it)
        // We choose option 2 for simplicity - tmux's redraw handles it
    }
    writer.write(payload.data);
});
```

**Note:** The resize epoch mechanism is a safety net. In practice, tmux's SIGWINCH-triggered redraw usually fixes any transient corruption. The epoch tracking helps with edge cases during rapid resize operations.

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
| **Partial ANSI Sequences** | PTY chunks can split `\x1b[` from `31m` | ~~Stateful ANSI parser~~ **Council Review #2:** Do NOT buffer ANSI - xterm.js handles split sequences natively |
| **Partial UTF-8 Sequences** | Multi-byte chars can split at read boundaries | Buffer incomplete UTF-8; emit only complete runes |
| **tmux Status Bar Leakage** | `attach-session` shows full tmux UI including status bar | RevDen hides tmux status via `set -g status off` (already configured) |
| **Resize/Reflow Desync** | Resize can cause history/viewport mismatch | Trust SIGWINCH; add resize epochs (1.8) |
| **Connection Drop Mid-Sequence** | SSH dies while `\x1b[38;2;255;` in progress | ~~Reset ANSI parser state~~ Let xterm.js handle it on reconnect |
| **Blank Terminal on Connect** | (NEW - Review #2) Streaming-only means blank screen until output | **MANDATORY:** Emit initial viewport snapshot on connect (1.6) |
| **DOM Freezing** | (NEW - Review #2) Fast output freezes browser if unthrottled | **MANDATORY:** RAF batching for xterm.write() (1.7) |

### Phase 1 Risks (Updated Priority - Council Review #2)

**Council Priority Order:**
1. Browser main-thread freezing → Mitigated by 1.7 (RAF throttling)
2. Blank screen UX → Mitigated by 1.6 (initial viewport snapshot)
3. Resize/render races → Mitigated by 1.8 (resize epochs)
4. UTF-8 boundary corruption → Mitigated by 1.5 (UTF-8 buffering only)
5. Reconnect logic → Deferred to Phase 4

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **DOM freezing (fast output)** | High | High | RAF batching in frontend (see 1.7) - **MANDATORY** |
| **Blank terminal on connect** | High | High | Initial viewport snapshot (see 1.6) - **MANDATORY** |
| **Resize race condition** | Medium | Medium | Resize epochs (see 1.8) - **MANDATORY** |
| **Partial UTF-8 corruption** | Medium | Medium | UTF-8 boundary buffering (see 1.5) |
| **Initial cursor wrong** | Low | Medium | tmux sends cursor position on attach |
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

**Risk Level: Medium** (Reduced from initial assessment due to council clarifications)

The PTY streaming approach is fundamentally simpler than polling + diff. Two council reviews identified critical requirements:

**Review #1:**
1. The capture/attach race condition (fixed by attach-first strategy in Phase 2)
2. Terminal state reset on rollback

**Review #2 (Final):**
1. **Blank terminal problem** - Fixed by mandatory initial viewport snapshot (1.6)
2. **DOM freezing** - Fixed by mandatory RAF throttling (1.7)
3. **Resize races** - Fixed by resize epochs (1.8)
4. **ANSI buffering removed** - xterm.js handles it natively, reducing backend complexity
5. **UTF-8 only buffering** - Simpler implementation than originally planned

The rollback strategy with hard reset provides a safety net. The council's clarification that ANSI buffering is unnecessary significantly reduces implementation complexity.

---

## Success Criteria

### Council Review #2 - Phase 1 Checklist (MANDATORY)

Before merging Phase 1 PR, ALL of these must be true:

- [ ] **Protocol:** WebSocket sends `terminal:initial` (current viewport) on connect, then `terminal:data` (stream)
- [ ] **Safety:** Frontend limits `term.write()` calls via requestAnimationFrame (max ~60fps)
- [ ] **Encoding:** Pipeline is byte-stream until UTF-8 decoder at client; no ANSI parsing on backend
- [ ] **Logic:** No backend code attempts to regex/parse ANSI escape sequences

### Must Have (Phase 1)

- [ ] `seq 1 10000` renders all numbers correctly
- [ ] `/context` in Claude Code renders without corruption
- [ ] **Terminal is NOT blank on connection** (initial viewport snapshot works)
- [ ] Cursor is at correct position after attach
- [ ] Typing works immediately after attach
- [ ] **Browser does not freeze during fast output** (RAF throttling works)
- [ ] Resize during output does not cause permanent corruption

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

### Council Consensus Statement (Review #1)

> "The proposal to replace polling with direct PTY streaming is architecturally sound and necessary to resolve the rendering corruption issues. However, the specific 'Trim Viewport' seam strategy is brittle and introduces a critical race condition. Additionally, there is a major integration risk regarding tmux UI leakage that appears unaddressed."

**Verdict:** Approved with modifications (incorporated into this plan).

---

## Appendix: LLM Council Review #2 (Final Review)

### Review Date
2026-01-29

### Council Composition
Same as Review #1: GPT-5.2, Claude Opus 4.5, Gemini 3 Pro (Chairman), Grok 4

### Review Focus Areas
1. Proposed optimizations - Can phases be simplified?
2. Missing considerations - What haven't we thought of?
3. Phase 1 trade-off validation - Is skipping history the right approach?
4. UTF-8/ANSI handling - Is the buffering approach sound?
5. Risk prioritization - Which risks to tackle first?

### Key Findings

#### 1. Critical Gap: "Blank Terminal" Problem

The council unanimously identified a major UX flaw:

> "The plan to 'skip history' in Phase 1 contains a hidden flaw. If a user connects to an existing session, and you stream only new output, they will see a blank black screen until they type or output occurs."

**Mandatory Fix:** Phase 1 must include fetching a snapshot of the current visible pane (`tmux capture-pane -p -e`) immediately upon connection. This is "initial state," not "scrollback history."

#### 2. Merge Throttling Into Phase 1

> "You cannot ship raw streaming (Phase 1) without basic rendering protection. If a user runs `cat /dev/urandom` or a massive log dump, raw streaming without rate-limiting will freeze the browser DOM."

**Mandatory Fix:** Add basic client-side chunk accumulation via requestAnimationFrame (max ~60fps).

#### 3. Resize Race Condition

> "When a user resizes the window, there is a race between the resize event reaching the server and in-flight data (formatted for the old width) reaching the client."

**Mandatory Fix:** Implement a "Resize Epoch" or ID. Client should discard incoming frame data tagged with older resize ID.

#### 4. ANSI Buffering Correction

The council provided a critical technical directive:

> "Do NOT attempt to parse or buffer ANSI escape sequences on the backend. This is complexity hell (e.g., OSC sequences, differing terminators). Xterm.js has a robust internal state machine that handles escape sequences split across packet boundaries perfectly."

**Directive:** Buffer ONLY for UTF-8 byte boundaries. Pass raw ANSI bytes through.

#### 5. Updated Risk Priority

1. Browser main-thread freezing (throttling) - **HIGHEST**
2. Blank screen UX (initial viewport snapshot) - **HIGHEST**
3. Resize/render races (resize epochs) - **HIGH**
4. UTF-8 boundary corruption (byte-aware buffering) - **MEDIUM**
5. Reconnect logic - **DEFERRED TO PHASE 4**

### Council Consensus Statement (Review #2)

> "The plan is Approved for Implementation, subject to the inclusion of three mandatory stipulations: (1) Initial viewport snapshot to prevent blank terminal, (2) Client-side RAF throttling to prevent DOM freezing, (3) Resize epochs to prevent race conditions. The council's clarification that ANSI buffering is unnecessary significantly reduces implementation complexity."

**Final Verdict:** APPROVED FOR IMPLEMENTATION with mandatory Phase 1 amendments.

---

## Appendix: Implementation Troubleshooting Log

### Session Date
2026-01-29

### Problem: PTY Read Loop Blocking Forever

**Symptoms:**
- PTY streaming mode was implemented per the plan
- Initial viewport was captured and emitted correctly
- PTY was spawned successfully (tmux attach process started)
- `readLoopStream()` started but blocked on the first `p.Read()` call
- No data was ever received from the PTY
- Typing in the terminal showed nothing on screen

**Initial Hypotheses Investigated:**

1. **PTY size not set before tmux starts** - tmux queries terminal size on attach
   - Created `SpawnPTYWithCommandAndSize()` to set size before process starts
   - Result: Did not fix the issue

2. **tmux not sending data on attach** - Maybe tmux needed SIGWINCH to trigger redraw
   - Manually sent `kill -SIGWINCH <pid>` to the tmux attach process
   - Result: Did not fix the issue

3. **PTY file descriptor issue** - Maybe reads weren't working
   - Created standalone Go test (`pty_test_manual.go`) that attached to tmux via PTY
   - Result: **Standalone test worked perfectly** - received 248 bytes immediately
   - This proved the PTY/tmux mechanism was sound

4. **Lock contention** - Maybe the read loop was waiting for something
   - Added debug logging around mutex acquisition
   - Result: **Found the bug** - logs showed "Acquiring lock..." but never "Lock acquired"

### Root Cause: Mutex Deadlock

**The Bug:**
```go
func (t *Terminal) startTmuxSessionStreaming(...) error {
    t.mu.Lock()
    defer t.mu.Unlock()

    // ... lots of setup code ...

    go t.readLoopStream()  // Starts goroutine that will try to acquire t.mu

    t.startStatusPolling(tmuxSession)  // CALLS t.mu.Lock() WHILE ALREADY HOLDING IT!

    return nil
}

func (t *Terminal) startStatusPolling(tmuxSession string) {
    t.mu.Lock()      // ← DEADLOCK! Caller already holds this lock
    // ...
    t.mu.Unlock()
}
```

**Why This Causes a Deadlock:**
- Go's `sync.Mutex` is **NOT reentrant** (unlike some languages' locks)
- If a goroutine already holds a mutex and tries to acquire it again, it blocks forever
- `startTmuxSessionStreaming` held the lock via `defer t.mu.Unlock()`
- It then called `startStatusPolling()` which tried to acquire the same lock
- This blocked `startTmuxSessionStreaming` from returning
- Which meant `t.mu.Unlock()` was never called
- Which meant `readLoopStream()` could never acquire the lock to proceed

### The Fix

Removed lock acquisition from `startStatusPolling()` since its caller already holds the lock:

```go
// startStatusPolling begins lightweight polling for alt-screen status only.
// NOTE: Caller must hold t.mu lock - this function does NOT acquire the lock
// to avoid deadlock when called from startTmuxSessionStreaming.
func (t *Terminal) startStatusPolling(tmuxSession string) {
    // NOTE: No lock here - caller (startTmuxSessionStreaming) already holds it
    t.tmuxPolling = true
    t.tmuxStopChan = make(chan struct{})
    t.tmuxSession = tmuxSession

    go t.pollStatusLoop()
}
```

### Verification

After the fix, logs showed successful data flow:
```
[PTY-STREAM] p.Read() returned n=91 err=<nil>
[PTY-STREAM] Emitting 91 bytes via terminal:data
[PTY-STREAM] Emitting 1024 bytes via terminal:data
```

### Lessons Learned

1. **Go mutexes are not reentrant** - A goroutine cannot acquire a lock it already holds. This is different from Java's `synchronized` or C#'s `lock`. Always trace the call graph when adding `Lock()` calls.

2. **Standalone tests are invaluable** - When the full system isn't working, isolate the subsystem. Our standalone PTY test proved the PTY mechanism worked, which focused the investigation on the application-level code.

3. **Debug logging around lock acquisition** - Adding "Acquiring lock..." and "Lock acquired" messages immediately revealed the deadlock.

4. **Document lock requirements** - Functions that expect the caller to hold a lock should have clear comments stating this requirement.

5. **Prefer lock-free designs where possible** - The status polling could be refactored to not need shared state during initialization.

### Changes Made

| File | Change |
|------|--------|
| `terminal.go` | Fixed deadlock by removing lock from `startStatusPolling()` |
| `terminal.go` | Added debug logging for PTY streaming data flow |
| `pty.go` | Added `SpawnPTYWithCommandAndSize()` helper (kept for potential optimization) |

### Commits

- `7ae0af8` - feat(desktop): implement PTY streaming mode (Phase 1)
- `dd2e383` - fix(desktop): resolve deadlock in PTY streaming mode

### PR

https://github.com/myrison/agent-deck/pull/99
