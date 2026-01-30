# Plan: Restore Scrollback History Retention

## Problem Summary

Commit `2f0cd9e` ("perf(desktop): optimize PTY streaming and reduce debug noise") broke scrollback retention by removing the **Idle Refresh** mechanism. This mechanism was the working solution for accumulating scrollback in PTY streaming mode.

### What Broke
- **Backend**: Removed `idleRefreshTimer`, `lastDataTimeAtomic`, `triggerIdleRefresh()` and related functions
- **Frontend**: Removed `handleIdleRefresh` handler and `terminal:idle-refresh` event listener
- **Result**: Scrollback no longer accumulates as content scrolls up

### What to Keep from 2f0cd9e
- Cached `isScrolledUpRef` for mouse event performance
- Atomic `lastDataTimeAtomic` operations (will restore with this optimization)
- `stripOutputNoise()` helper function
- Conditional debug instrumentation with `AGENTDECK_DEBUG`
- Debug log cleanup (reduced console noise)
- 500ms polling interval for alt-screen (sufficient for that use case)

---

## Implementation Plan

### Step 1: Restore Backend Idle Refresh Fields

**File**: `cmd/agent-deck-desktop/terminal.go`

Add fields to Terminal struct (after line 178, before closing brace):

```go
// Idle refresh for scrollback accumulation (PTY streaming mode)
idleRefreshTimer          *time.Timer
lastDataTimeAtomic        int64 // Unix millis - atomic for lock-free hot path
lastInputTime             time.Time
linesSinceLastRefresh     int
idleRefreshTimeoutMs      int   // Default 500, 0 = disabled
idleRefreshThresholdLines int   // Default 50
```

### Step 2: Initialize Idle Refresh in Streaming Mode

**File**: `cmd/agent-deck-desktop/terminal.go`

In `startTmuxSessionStreaming()`, add initialization before starting the read loop:

```go
t.idleRefreshTimeoutMs = 500      // 500ms of no output triggers refresh
t.idleRefreshThresholdLines = 50  // Need at least 50 lines of output
```

### Step 3: Restore `resetIdleRefreshTimer()` Function

**File**: `cmd/agent-deck-desktop/terminal.go`

```go
// resetIdleRefreshTimer records data arrival time for idle detection.
// Uses atomic operations to avoid mutex lock on every PTY data chunk.
func (t *Terminal) resetIdleRefreshTimer() {
    atomic.StoreInt64(&t.lastDataTimeAtomic, time.Now().UnixMilli())

    t.mu.Lock()
    defer t.mu.Unlock()

    if t.idleRefreshTimer != nil || t.idleRefreshTimeoutMs <= 0 {
        return
    }
    timeout := t.idleRefreshTimeoutMs
    t.idleRefreshTimer = time.AfterFunc(time.Duration(timeout)*time.Millisecond, func() {
        t.checkIdleRefresh()
    })
}
```

### Step 4: Restore `checkIdleRefresh()` Function

**File**: `cmd/agent-deck-desktop/terminal.go`

```go
// checkIdleRefresh checks if enough idle time has passed to trigger a refresh.
func (t *Terminal) checkIdleRefresh() {
    t.mu.Lock()
    timeout := t.idleRefreshTimeoutMs
    if timeout <= 0 || t.closed {
        t.idleRefreshTimer = nil
        t.mu.Unlock()
        return
    }
    t.mu.Unlock()

    lastData := time.UnixMilli(atomic.LoadInt64(&t.lastDataTimeAtomic))
    elapsed := time.Since(lastData)

    if elapsed < time.Duration(timeout)*time.Millisecond {
        remaining := time.Duration(timeout)*time.Millisecond - elapsed
        t.mu.Lock()
        t.idleRefreshTimer = time.AfterFunc(remaining, func() {
            t.checkIdleRefresh()
        })
        t.mu.Unlock()
        return
    }

    t.mu.Lock()
    t.idleRefreshTimer = nil
    t.mu.Unlock()
    t.triggerIdleRefresh()
}
```

### Step 5: Restore `triggerIdleRefresh()` Function

**File**: `cmd/agent-deck-desktop/terminal.go`

```go
// triggerIdleRefresh captures full tmux scrollback and emits to frontend.
func (t *Terminal) triggerIdleRefresh() {
    t.mu.Lock()
    if t.closed {
        t.mu.Unlock()
        return
    }
    session := t.tmuxSession
    inAltScreen := t.lastAltScreen
    lines := t.linesSinceLastRefresh
    threshold := t.idleRefreshThresholdLines
    lastInput := t.lastInputTime
    ctx := t.ctx
    sessionID := t.sessionID
    t.mu.Unlock()

    // Guards: skip if alt-screen, below threshold, or user typed recently
    if session == "" || inAltScreen || lines < threshold {
        return
    }
    if time.Since(lastInput) < 200*time.Millisecond {
        return
    }

    // Capture full scrollback
    cmd := exec.Command(tmuxBinaryPath, "capture-pane", "-t", session, "-p", "-e", "-S", "-", "-E", "-")
    output, err := cmd.Output()
    if err != nil {
        t.debugLog("[IDLE-REFRESH] capture-pane error: %v", err)
        return
    }

    content := sanitizeHistoryForXterm(string(output))
    content = normalizeCRLF(content)

    t.debugLog("[IDLE-REFRESH] Captured %d bytes, emitting terminal:idle-refresh", len(content))

    if ctx != nil {
        runtime.EventsEmit(ctx, "terminal:idle-refresh",
            TerminalEvent{SessionID: sessionID, Data: content})
    }

    t.mu.Lock()
    t.linesSinceLastRefresh = 0
    t.mu.Unlock()
}
```

### Step 6: Wire Up Idle Refresh in Read Loop

**File**: `cmd/agent-deck-desktop/terminal.go`

In `readLoopStream()`, after emitting `terminal:data`, add:

```go
// Trigger idle refresh timer
t.resetIdleRefreshTimer()

// Track lines for threshold
t.mu.Lock()
t.linesSinceLastRefresh += strings.Count(output, "\n")
t.mu.Unlock()
```

### Step 7: Track User Input Time

**File**: `cmd/agent-deck-desktop/terminal.go`

In `Write()` function, add at the start:

```go
t.mu.Lock()
t.lastInputTime = time.Now()
t.mu.Unlock()
```

### Step 8: Clean Up Timer on Stop

**File**: `cmd/agent-deck-desktop/terminal.go`

In `stopTmuxPolling()`, add timer cleanup:

```go
if t.idleRefreshTimer != nil {
    t.idleRefreshTimer.Stop()
    t.idleRefreshTimer = nil
}
```

### Step 9: Add Frontend Handler

**File**: `cmd/agent-deck-desktop/frontend/src/Terminal.jsx`

Add after the `cancelResizeEpoch` line (~line 724):

```javascript
// ============================================================
// IDLE REFRESH HANDLER (PTY streaming mode)
// ============================================================
// After 500ms of no output, the backend captures full tmux scrollback
// and sends it here. We reset xterm and rewrite with full content
// to fix scrollback accumulation issues from cursor-positioning sequences.
const handleIdleRefresh = (payload) => {
    if (payload?.sessionId !== sessionId) return;
    if (!xtermRef.current || !payload.data) return;

    const term = xtermRef.current;
    const wasAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;

    logger.info('[IDLE-REFRESH] Received', payload.data.length, 'bytes, resetting xterm');

    // Reset and rewrite with full scrollback
    term.reset();
    term.write(payload.data);

    // Restore scroll position
    if (wasAtBottom) {
        term.scrollToBottom();
    }
};
const cancelIdleRefresh = EventsOn('terminal:idle-refresh', handleIdleRefresh);
```

### Step 10: Add Frontend Cleanup

**File**: `cmd/agent-deck-desktop/frontend/src/Terminal.jsx`

In the cleanup return function, add:

```javascript
cancelIdleRefresh();
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `cmd/agent-deck-desktop/terminal.go` | Add struct fields, restore 4 functions, wire up in read loop |
| `cmd/agent-deck-desktop/frontend/src/Terminal.jsx` | Add event handler and cleanup |

---

## Verification

### Test 1: Large Output Scrollback
```bash
# In a RevDen session, run:
seq 1 10000
# Then: Cmd+F and search for "1" - should find "1", "10", "100", "1000", "10000"
# Scroll up - should see all 10000 lines
```

### Test 2: Claude Code Context
```bash
# In a Claude Code session:
/context
# Scroll up - should see full context output in scrollback
```

### Test 3: Tab Switching Preservation
1. Run `seq 1 5000` in tab 1
2. Switch to tab 2
3. Switch back to tab 1
4. Scrollback should still be present

### Test 4: Alt-Screen Apps
1. Open `vim` or `nano`
2. Exit
3. Previous scrollback should be intact (idle refresh skips alt-screen)

### Side Effects to Verify
- Typing responsiveness not degraded
- No duplicate content on screen
- Cursor position correct after idle refresh
