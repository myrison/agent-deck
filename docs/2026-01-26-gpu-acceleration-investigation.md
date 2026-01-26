# GPU Acceleration & Input Latency Investigation - Agent Deck Desktop

**Date:** 2026-01-26
**Author:** Alfred (Claude Code Worker), continued by Alfred session 2
**Status:** Investigation Complete, Solution Design Phase
**Topic:** Analysis of GPU acceleration, multi-session performance, and **typing input latency root cause**

---

## Executive Summary

The agent-deck desktop application currently does **not** use GPU acceleration for terminal rendering. The xterm.js WebGL addon is installed but explicitly disabled due to scroll detection issues with macOS WKWebView. This, combined with the per-session polling architecture, creates performance bottlenecks when multiple sessions are open simultaneously.

**Key Findings:**
- WebGL addon disabled (breaks scroll detection in WKWebView)
- Each session spawns independent polling goroutine (80ms interval)
- No visibility-based optimization for background terminals
- Wails/macOS does not expose GPU acceleration settings

---

## Current Architecture

### Rendering Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  Terminal.jsx                        │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │              xterm.js v6                     │    │    │
│  │  │         DOM Renderer (default)              │    │    │
│  │  │    WebGL Addon: DISABLED (commented out)    │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Wails v2 Runtime                           │
│                  (WKWebView on macOS)                        │
│            GPU settings: NOT CONFIGURABLE                    │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Session Polling Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    TerminalManager                            │
│                  (map[sessionID]*Terminal)                    │
└──────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
    │Terminal1│   │Terminal2│   │Terminal3│   │TerminalN│
    │ polling │   │ polling │   │ polling │   │ polling │
    │  80ms   │   │  80ms   │   │  80ms   │   │  80ms   │
    └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
    tmux capture  tmux capture  tmux capture  tmux capture
       -pane         -pane         -pane         -pane
```

**Problem:** With N sessions open, there are N independent polling loops, each spawning a `tmux capture-pane` subprocess every 80ms.

---

## Detailed Findings

### 1. WebGL Addon Status

**Location:** `cmd/agent-deck-desktop/frontend/src/Terminal.jsx`

```javascript
// Line 7
// import { WebglAddon } from '@xterm/addon-webgl'; // Disabled - breaks scroll detection

// Lines 119-122
// Using DOM renderer (xterm.js v6 default)
// Note: WebGL addon breaks scroll detection in WKWebView
logger.info('xterm.js v6 initialized with DOM renderer');
```

**Root Cause:** The WebGL addon interferes with scroll event detection in Apple's WKWebView, which Wails uses on macOS. This prevents proper scroll indicator updates and user scroll interactions.

**Package Status:** WebGL addon IS installed and available:
```json
// package.json
"@xterm/addon-webgl": "^0.19.0"
```

### 2. Wails/macOS GPU Configuration

**Finding:** Wails v2 does not expose GPU acceleration settings for macOS.

Per [Wails Issue #2264](https://github.com/wailsapp/wails/issues/2264), GPU settings were added for Windows and Linux, but macOS was excluded because Apple's WKWebView APIs don't expose hardware acceleration controls.

**Current behavior:**
- Windows: `WebviewGpuPolicy` configurable
- Linux: `WebviewGpuPolicy` configurable (defaults to `Never`)
- macOS: Uses system defaults, not configurable

### 3. Polling Configuration

**Location:** `cmd/agent-deck-desktop/terminal.go`

| Setting | Value | Purpose |
|---------|-------|---------|
| Local polling | 80ms | ~12.5 FPS for responsive typing |
| Remote polling | 80ms | Matches local for consistency |
| Reconnect backoff | 500ms base | Exponential backoff for SSH |

**Code References:**
```go
// terminal.go:754 - Local polling
ticker := time.NewTicker(80 * time.Millisecond) // ~12.5 fps

// terminal.go:432 - Remote polling
ticker := time.NewTicker(80 * time.Millisecond) // Match local polling rate
```

### 4. Terminal Manager Structure

**Location:** `cmd/agent-deck-desktop/terminal_manager.go`

```go
type TerminalManager struct {
    terminals map[string]*Terminal  // One Terminal per session
    mu        sync.RWMutex
    ctx       context.Context
    sshBridge *SSHBridge
}
```

Each `Terminal` instance maintains:
- Its own polling goroutine
- Independent `HistoryTracker` for viewport diffing
- Separate tmux subprocess spawning

---

## Performance Impact Analysis

### CPU Overhead (N Sessions)

| Sessions | Poll Calls/sec | Subprocesses/sec | Impact |
|----------|---------------|------------------|--------|
| 1 | 12.5 | 12.5 | Minimal |
| 4 | 50 | 50 | Noticeable |
| 8 | 100 | 100 | Significant |
| 16 | 200 | 200 | Severe |

### DOM Rendering Costs

Without WebGL, xterm.js uses DOM-based rendering:
- Each character cell is a DOM element
- Large outputs require extensive DOM manipulation
- No GPU offloading for text rendering
- Scrollback buffer operations are CPU-bound

---

## Recommendations by Priority

### Priority 1: High Impact, Low Effort

#### 1.1 Visibility-Based Polling Reduction

**Description:** Reduce polling frequency for unfocused/background terminals.

**Implementation:**
```go
// In terminal.go, modify pollTmuxLoop
func (t *Terminal) pollTmuxLoop() {
    activeTicker := time.NewTicker(80 * time.Millisecond)   // Focused
    idleTicker := time.NewTicker(200 * time.Millisecond)    // Background

    for {
        select {
        case <-t.tmuxStopChan:
            return
        case <-t.getCurrentTicker().C:  // Switch based on focus state
            t.pollTmuxOnce()
        }
    }
}
```

**Expected Impact:** 60% reduction in polling overhead for background sessions.

#### 1.2 Lazy Terminal Initialization

**Description:** Only start polling when terminal pane becomes visible.

**Implementation:**
- Add `isVisible` flag to Terminal struct
- Defer `startTmuxPolling()` until pane is rendered
- Stop polling when pane is hidden (e.g., different tab)

**Expected Impact:** Zero overhead for sessions not currently displayed.

### Priority 2: Medium Impact, Medium Effort

#### 2.1 Batch Tmux Commands

**Description:** Consolidate multiple `tmux capture-pane` calls into single tmux invocation.

**Current (N calls):**
```bash
tmux capture-pane -t session1 -p -e
tmux capture-pane -t session2 -p -e
tmux capture-pane -t session3 -p -e
```

**Proposed (1 call):**
```bash
tmux list-panes -a -F "#{session_name}" | while read s; do
    tmux capture-pane -t "$s" -p -e
done
```

Or use tmux scripting:
```bash
tmux run-shell "capture multiple panes in one tmux context"
```

**Expected Impact:** Reduce subprocess overhead by ~80% for same-host sessions.

#### 2.2 Differential Polling Rates

**Description:** Adjust polling based on session activity.

| State | Polling Rate | Trigger |
|-------|-------------|---------|
| Active typing | 50ms | Recent input |
| Idle watching | 80ms | No input, content changing |
| Background | 200ms | Unfocused |
| Dormant | 500ms | No changes for 30s |

### Priority 3: High Impact, High Effort

#### 3.1 Fix WebGL Scroll Detection (BIGGEST WIN)

**Description:** Re-enable WebGL addon by implementing alternative scroll detection.

**Current Issue:** WKWebView doesn't fire native scroll events when using WebGL canvas.

**Potential Solutions:**

1. **RAF-based scroll polling** (implemented but may need enhancement):
   ```javascript
   // Already exists in Terminal.jsx but may need adjustment for WebGL
   const rafId = requestAnimationFrame(checkScrollPosition);
   ```

2. **Custom scroll overlay:**
   ```javascript
   // Transparent div over terminal catches wheel events
   <div className="scroll-capture-overlay" onWheel={handleWheel} />
   ```

3. **xterm.js buffer API monitoring:**
   ```javascript
   // Watch buffer.active.viewportY changes directly
   term.buffer.active.onLineFeed(() => updateScrollState());
   ```

**Expected Impact:** 2-5x rendering performance improvement for large outputs.

**Files to Modify:**
- `frontend/src/Terminal.jsx` - Re-enable WebGL, implement new scroll detection
- Potentially add WebGL-specific CSS adjustments

#### 3.2 Web Worker Terminal Processing

**Description:** Move terminal data processing to Web Workers.

**Benefits:**
- Main thread stays responsive
- Parallel processing of multiple sessions
- Better utilization of multi-core CPUs

**Complexity:** High - requires restructuring data flow between Go backend and React frontend.

---

## Roadmap Alignment

Per `ROADMAP.md`, these optimizations align with planned work:

| Version | Feature | Status |
|---------|---------|--------|
| v0.6.0 | GPU acceleration | Planned |
| v0.7.0 | Performance optimization | Planned |
| v0.7.0 | Reduce memory usage | Planned |
| v0.7.0 | Optimize scrollback rendering | Planned |
| v0.7.0 | Virtual scrolling | Planned |

---

## Implementation Recommendation

**Suggested Order:**

1. **Week 1:** Implement visibility-based polling (Priority 1.1)
2. **Week 2:** Add lazy terminal initialization (Priority 1.2)
3. **Week 3-4:** Investigate and fix WebGL scroll detection (Priority 3.1)
4. **Week 5:** Implement batched tmux commands (Priority 2.1)

This order provides incremental improvements while working toward the highest-impact change (WebGL re-enablement).

---

## Appendix: File References

| File | Purpose | Key Lines |
|------|---------|-----------|
| `Terminal.jsx` | Frontend terminal component | 7, 119-122 |
| `terminal.go` | Backend terminal management | 754, 432 |
| `terminal_manager.go` | Multi-session management | Full file |
| `history_tracker.go` | Viewport diffing logic | Full file |
| `ROADMAP.md` | Feature planning | 219 |
| `package.json` | Frontend dependencies | WebGL addon |

---

## Typing Input Latency Analysis (Session 2 Findings)

### Root Cause Confirmed

The user-reported typing lag is **NOT related to GPU/rendering** but is caused by the **polling architecture**:

```
User types → WriteTerminal() → PTY write → tmux receives IMMEDIATELY
                                              ↓
                                        (up to 80ms wait)
                                              ↓
Display update ← terminal:data event ← pollTmuxOnce() ← 80ms ticker
```

The input reaches tmux instantly, but visual feedback is delayed by up to 80ms while waiting for the next poll cycle.

### Why Polling Was Implemented

From `TECHNICAL_DEBT.md` (Resolved Issue: "Scrollback Pre-loading Visual Artifacts"):

> When connecting to tmux sessions, the terminal displayed garbled/overlapping text. This was caused by:
> 1. `tmux capture-pane` outputs LF (`\n`) line endings, but xterm.js interprets `\n` as "move cursor down" without carriage return
> 2. TUI applications (Claude Code, vim, nano) use escape sequences that corrupt xterm.js scrollback buffer

The polling architecture was a **deliberate tradeoff**: sacrifice input latency for correct scrollback rendering.

### Key Code Locations

| File | Function | Line | Purpose |
|------|----------|------|---------|
| `terminal.go` | `readLoopDiscard()` | 692-720 | Discards PTY output in polling mode |
| `terminal.go` | `pollTmuxLoop()` | 753-765 | 80ms polling ticker |
| `terminal.go` | `pollTmuxOnce()` | 767-866+ | Captures tmux state, emits diffs |
| `terminal.go` | `StartTmuxSession()` | 207-259 | Initializes polling mode |
| `Terminal.jsx` | `handleAltScreenChange()` | 156-163 | Tracks alt-screen state in frontend |

### Alt-Screen Tracking Already Exists

The codebase already tracks when TUI apps enter "alternate screen" mode (vim, nano, less, Claude Code in TUI mode):

**Backend** (`terminal.go:803-815`):
```go
// Step 2: Track alt-screen state changes (vim, less, htop)
if inAltScreen != tracker.inAltScreen {
    tracker.SetAltScreen(inAltScreen)
    runtime.EventsEmit(t.ctx, "terminal:altscreen", map[string]interface{}{
        "sessionId":   t.sessionID,
        "inAltScreen": inAltScreen,
    })
}
```

**Frontend** (`Terminal.jsx:154-163`):
```javascript
let isInAltScreen = false;
const handleAltScreenChange = (payload) => {
    if (payload?.sessionId !== sessionId) return;
    isInAltScreen = payload.inAltScreen;
    setIsAltScreen(payload.inAltScreen);
};
EventsOn('terminal:altscreen', handleAltScreenChange);
```

### Solution Analysis

#### ❌ Solution 4: Selective PTY Passthrough (NOT Recommended)

**Original idea:** Stream PTY output when NOT in alt-screen, use polling only for TUI apps.

**Why it won't work for Claude Code:**
- Claude Code IS a TUI app that uses alt-screen even at its `>` prompt
- The corruption occurs specifically WITH TUI escape sequences
- We'd still need polling for Claude Code sessions, which is the primary use case

**Verdict:** This would only help pure shell sessions (bash prompt), not the main use case.

#### ✅ Solution 2: Reduced Polling Interval (Recommended First Step)

**Current:** 80ms (~12.5 FPS)
**Proposed:** 30-40ms (~25-33 FPS)

**Pros:**
- Simple single-line change
- Cuts theoretical max latency in half
- Low risk

**Cons:**
- 2-3x increase in `tmux capture-pane` subprocess calls
- Increased CPU usage
- Doesn't eliminate latency, just reduces it

**Implementation:**
```go
// terminal.go:754
ticker := time.NewTicker(30 * time.Millisecond) // ~33 fps (was 80ms)
```

#### ⚡ Solution 3: Local Input Echo (Medium Priority)

**Concept:** Echo typed characters immediately in xterm.js, then let the next poll reconcile.

**Implementation sketch:**
```javascript
// Terminal.jsx - onData handler
term.onData((data) => {
    // Send to backend (unchanged)
    WriteTerminal(sessionId, data);

    // Immediately echo locally for responsiveness
    if (!isInAltScreen && isPrintableInput(data)) {
        term.write(data);  // Local echo
    }
});
```

**Challenges:**
1. **Input transformation**: Shell may transform input (aliases, tab completion, etc.)
2. **Visual glitches**: Need to handle reconciliation carefully
3. **Password input**: Must detect and NOT echo password prompts

**Verdict:** Worth exploring as a second phase, but needs careful design.

#### 🔬 Solution 5: Adaptive Polling (Future Enhancement)

**Concept:** Dynamically adjust polling rate based on activity:

| State | Rate | Trigger |
|-------|------|---------|
| Active typing | 30ms | Input in last 500ms |
| Idle watching | 80ms | Content changing, no input |
| Background | 200ms | Terminal unfocused |
| Dormant | 500ms | No changes for 30s |

This optimizes the tradeoff between latency and CPU usage.

### Recommended Implementation Order

1. **Phase 1 (Quick Win):** Reduce polling interval to 40ms
   - Test latency improvement
   - Measure CPU impact
   - Adjust if needed (30ms if CPU is fine, 50ms if not)

2. **Phase 2 (If Phase 1 insufficient):** Implement adaptive polling
   - Higher rate during active typing
   - Lower rate when idle

3. **Phase 3 (Optional):** Local input echo for non-TUI contexts
   - Shell prompts only
   - Requires careful reconciliation logic

### Measurement Methodology

To quantify the improvement:

1. **Side-by-side comparison:** Open agent-deck and native tmux, type rapidly
2. **Video recording:** 60fps screen capture, count frames between keypress and character display
3. **Automated test:** Use tmux send-keys with timestamps, measure poll latency distribution

---

## References

- [Wails GPU Acceleration Issue #2264](https://github.com/wailsapp/wails/issues/2264)
- [Wails Options Documentation](https://wails.io/docs/reference/options/)
- [xterm.js WebGL Addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl)
- [WKWebView Documentation](https://developer.apple.com/documentation/webkit/wkwebview)
