# Alternative Scrollback Architecture Analysis

**Date:** 2026-01-29
**Context:** Research alternative approaches to solve PTY streaming scrollback accumulation without relying on escape sequence manipulation
**Current Problem:** PTY streams contain cursor-positioning sequences that prevent xterm.js from naturally accumulating scrollback

---

## Executive Summary

After analyzing 5+ alternative architectures and researching existing implementations, **Option 2 (Server-Side Virtual Terminal)** combined with **Option 5 (Hybrid Mode)** offers the best balance of:
- ✅ Full scrollback history
- ✅ Smooth rendering with minimal flicker
- ✅ No manual refresh required
- ✅ CMD+F searchable history
- ⚠️ Moderate implementation complexity (1-2 weeks)

The key insight: **Process ANSI sequences server-side** to build a canonical terminal buffer, then send **structured updates** (not raw escape sequences) to the frontend. This solves the fundamental mismatch between tmux's cursor-positioning output and xterm.js's scrollback expectations.

---

## Background: Current Architecture

### The Core Problem

```
tmux PTY output:
  ↓ Cursor positioning sequences (ESC[H, ESC[row;colH)
  ↓ Go backend (passes through raw)
  ↓ WebSocket
  ↓ xterm.js (overwrites same screen positions, no scrollback)
```

**Why it fails:**
- tmux sends `ESC[H` (cursor home) to efficiently update screen locations
- xterm.js interprets this as "overwrite row 0" not "scroll and append"
- Result: Output visible in viewport but scrollback buffer stays empty

### What Works Today (DiffViewport Polling)

The codebase has a working polling mode that:
1. Calls `tmux capture-pane` every 80ms
2. Diffs viewport changes
3. Sends ANSI sequences to update changed lines
4. **Result:** Perfect scrollback, but corrupts during fast output

**Why it corrupts:** The diff algorithm (`DiffViewport()` in `history_tracker.go`) generates incorrect ANSI sequences when viewport changes rapidly. See `docs/scrollback-architecture.md` Phase 2.8 for details.

---

## Option 1: Dual-Stream Architecture

### Concept
Separate channels for viewport (PTY streaming) and scrollback (polling from tmux history).

```
Backend:
  Stream A: PTY output → xterm viewport (low latency, real-time)
  Stream B: Polling tmux scrollback → custom buffer (every 80ms, new lines only)

Frontend:
  - xterm.js displays Stream A (viewport only)
  - Custom buffer stores Stream B (scrollback history)
  - On scroll-up: Pause PTY, inject scrollback into xterm from custom buffer
  - On scroll-down: Resume PTY streaming
```

### Technical Research

**Scroll detection in xterm.js:**
- ✅ `term.onScroll()` fires when viewport scrolls
- ❌ Does NOT fire on user-initiated scroll ([Issue #3864](https://github.com/xtermjs/xterm.js/issues/3864))
- ✅ Can poll `buffer.active.viewportY` vs `buffer.active.baseY` to detect scroll position
- ⚠️ Requires RAF polling (already implemented in Terminal.jsx lines 450-502)

**Implementation approach:**
```javascript
// Detect scroll-up
const buffer = term.buffer.active;
const isScrolledUp = buffer.viewportY < buffer.baseY;

if (isScrolledUp && !scrollbackInjected) {
  // Request scrollback from backend
  const scrollback = await GetScrollbackHistory(sessionId, startLine, endLine);
  // Prepend to xterm buffer... HOW?
}
```

**CRITICAL BLOCKER:** xterm.js has no API to prepend content to scrollback buffer. From [GitHub Issue #2105](https://github.com/xtermjs/xterm.js/issues/2105):

> "Altering buffer content directly has to trigger several post actions, otherwise things can go wrong in very weird ways. Direct buffer manipulation should not be encouraged by any API."

The xterm.js team explicitly prevents direct buffer manipulation to maintain terminal standards compliance.

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ❌ **BLOCKED** | Cannot prepend to xterm buffer without private API abuse |
| **Implementation Complexity** | High | Would need to patch xterm.js internals (brittle) |
| **UX Quality** | Unknown | Can't test without buffer manipulation API |
| **Requirements Met** | ❌❌❌❌ | Fails all 4 requirements (can't implement) |
| **Maintainability** | Very Low | Breaking xterm.js updates would break app |

**Verdict:** ❌ **NOT VIABLE** - Fundamental API limitation

---

## Option 2: Server-Side Virtual Terminal

### Concept
Backend maintains a complete terminal buffer (like tmux does), processes ALL escape sequences server-side, and sends **structured diffs** to frontend instead of raw ANSI.

```
Backend (Go):
  1. Read PTY output byte-by-byte
  2. Process ANSI sequences with VT100 emulator library
  3. Build canonical terminal buffer (rows × cols of cells)
  4. Track cursor position, scrollback, attributes
  5. When buffer changes, send structured update:
     { type: 'insertLine', line: 'content', position: 123, style: {...} }

Frontend (xterm.js):
  - Receive structured updates via WebSocket
  - Apply updates using term.write() with position hints OR
  - Use ANSI sequences generated from structured data
  - Full history always available in canonical buffer
```

### Technical Research: Go Terminal Emulator Libraries

From web search results, several mature Go libraries exist:

#### 1. **github.com/vito/vt100** (Recommended)
- Complete VT100/ANSI terminal emulator
- Tracks cursor position, colors, attributes
- Maintains internal buffer representation
- Used in production by [Concourse CI](https://concourse-ci.org/)
- [Package Documentation](https://pkg.go.dev/github.com/vito/vt100)

**Example API:**
```go
import "github.com/vito/vt100"

term := vt100.NewVT100(24, 80) // rows, cols
term.Write([]byte("\x1b[H\x1b[2JHello")) // Process ANSI
buffer := term.Content() // Get rendered buffer state
```

#### 2. **github.com/charmbracelet/x/ansi** (Modern, 2026)
- ECMA-48 compliant ANSI parser
- Published January 2026 (actively maintained)
- From Charmbracelet (authors of Bubble Tea TUI framework used in agent-deck CLI)
- [Package Documentation](https://pkg.go.dev/github.com/charmbracelet/x/ansi)
- **Note:** Parser only, not full emulator (would need custom buffer logic)

#### 3. **github.com/Azure/go-ansiterm**
- Cross-platform VT100 parser
- Used by Docker/Azure
- [GitHub Repository](https://github.com/Azure/go-ansiterm)
- **Limitation:** Parser-focused, less buffer management

### Implementation Plan

**Phase 1: Proof of Concept (1-2 days)**
```go
// terminal_emulator.go
type TerminalEmulator struct {
    vt      *vt100.VT100
    buffer  *CircularBuffer  // Store scrollback
    lastSeq uint64           // Sequence number for frontend sync
}

func (e *TerminalEmulator) ProcessPTY(data []byte) []Update {
    e.vt.Write(data)
    return e.generateUpdates() // Detect changes, return structured diffs
}

type Update struct {
    Type     string `json:"type"`     // "insertLine", "updateLine", "scroll"
    Line     int    `json:"line"`     // Buffer position
    Content  string `json:"content"`  // Text + ANSI formatting
    SeqNum   uint64 `json:"seq"`      // For ordering
}
```

**Phase 2: Frontend Integration (2-3 days)**
```javascript
// Handle structured updates from backend
const handleTerminalUpdate = (update) => {
  switch (update.type) {
    case 'insertLine':
      // Construct ANSI to insert at specific position
      term.write(`\x1b[${update.line}H${update.content}\r\n`);
      break;
    case 'scroll':
      // Emit newlines to push content into scrollback
      term.write('\n'.repeat(update.count));
      break;
  }
};
```

**Phase 3: Scrollback Synchronization (2-3 days)**
- Maintain server-side scrollback buffer (50,000 lines)
- On frontend request (user scrolls up), send historical lines
- Use sequence numbers to prevent duplication

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ✅ **HIGH** | Mature Go libraries exist, proven in production |
| **Implementation Complexity** | Moderate | 1-2 weeks for full implementation |
| **UX Quality** | ✅ Excellent | Smooth, no flicker, low latency |
| **Requirements Met** | ✅✅✅✅ | All 4 requirements satisfied |
| **Maintainability** | High | Clean abstraction, isolated emulator component |

**Pros:**
- ✅ Clean separation of concerns (backend does heavy lifting)
- ✅ Full control over scrollback accumulation
- ✅ Network efficient (send diffs, not full frames)
- ✅ Can add features (line timestamps, search indexing)

**Cons:**
- ⚠️ Need to replicate tmux's terminal emulation logic (complex)
- ⚠️ Must handle ALL ANSI sequences correctly (or risk rendering bugs)
- ⚠️ Resize handling requires re-layout logic

**Biggest Risk:** Missing or incorrectly implementing an ANSI sequence causes rendering divergence between server buffer and xterm.js. Mitigation: Extensive testing, periodic full-refresh as fallback.

**Verdict:** ✅ **VIABLE** - Best long-term architecture

---

## Option 3: Replay Architecture

### Concept
Record ALL PTY output to an append-only log. On scrollback request, replay log through headless xterm.js instance to render historical content.

```
Backend:
  - Capture ALL PTY output to append-only log file
  - Index log: { byteOffset: lineNumber } for fast seeking
  - On scrollback request (frontend scrolls up):
    - Read log from byteOffset[startLine] to byteOffset[endLine]
    - Run through headless xterm.js or server-side emulator
    - Return rendered text

Frontend:
  - Display live PTY stream in main xterm instance
  - On scroll-up: Request scrollback range, inject into buffer
  - OR: Maintain complete log client-side, replay locally
```

### Technical Research: Headless xterm.js

Searched for "xterm.js headless replay" - **NO native headless mode exists**.

**Options:**
1. **JSDOM + xterm.js in Node.js** (server-side rendering)
   - Would require Node.js backend (current backend is Go)
   - Performance overhead of DOM emulation

2. **Client-side replay** (download log to browser)
   - 10k lines × 100 bytes/line = 1MB download
   - Replay in hidden xterm instance, extract buffer
   - **Problem:** Still can't extract scrollback buffer due to API limitations

3. **Go-based emulator replay** (Option 2 hybrid)
   - Use `vt100` library to replay log server-side
   - Return rendered lines to frontend
   - **This is just Option 2 with log storage**

### Log File Size Analysis

| Scenario | Output | Log Size | Retention |
|----------|--------|----------|-----------|
| 1 hour Claude Code session | ~50k lines | ~5MB | Delete on session close |
| 10k line burst (`seq 1 10000`) | 58KB | Instant | Same |
| 8-hour workday | ~300k lines | ~30MB | Log rotation at 50MB |

**Log rotation strategy:**
```bash
# Keep last 50MB per session
if [ $(stat -f%z "$LOG_FILE") -gt 52428800 ]; then
  tail -c 26214400 "$LOG_FILE" > "$LOG_FILE.tmp"
  mv "$LOG_FILE.tmp" "$LOG_FILE"
fi
```

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ⚠️ **MEDIUM** | No headless xterm; requires Option 2's emulator anyway |
| **Implementation Complexity** | High | Log indexing, rotation, replay logic |
| **UX Quality** | ⚠️ Medium | Replay latency on scroll-up (50-200ms) |
| **Requirements Met** | ✅✅⚠️⚠️ | Full history ✅, smooth ❌ (latency), no refresh ❌, search ⚠️ |
| **Maintainability** | Medium | Log files add operational complexity |

**Pros:**
- ✅ Guaranteed lossless (append-only log)
- ✅ Can replay from any point in history
- ✅ Useful for debugging/diagnostics

**Cons:**
- ❌ Replay latency breaks smooth scrolling
- ❌ Requires server-side emulator (same complexity as Option 2)
- ❌ Log rotation/cleanup adds operational burden
- ❌ Doesn't solve core problem (still need emulator to render)

**Verdict:** ⚠️ **NOT RECOMMENDED** - Adds complexity without solving core issue. If implementing server-side emulator anyway, Option 2 is cleaner.

---

## Option 4: tmux Query-on-Demand

### Concept
Let tmux be the source of truth. Query `tmux capture-pane` ONLY when user scrolls up, cache server-side.

```
Backend:
  - PTY stream for viewport (current approach)
  - On scroll-up event from frontend:
    - Check cache validity (invalidate on new output)
    - Run: tmux capture-pane -p -S -10000 -E -1
    - Cache result
    - Return to frontend
  - Invalidate cache when new PTY data arrives

Frontend:
  - Detect scroll-up (RAF polling buffer.viewportY)
  - Request scrollback from backend
  - Inject into xterm... HOW?
```

### Technical Research: tmux capture-pane Performance

From web search: [tmux Performance Issues](https://github.com/tmux/tmux/issues/4171)

**Known performance bottlenecks:**
- Resizing with 50k+ history takes 500ms+ ([GitHub Issue #4171](https://github.com/tmux/tmux/issues/4171))
- `capture-pane -S -` (full scrollback) on 50k lines: ~100-200ms
- Memory pressure with multiple panes × large history

**Recommended limits:**
- 10,000-50,000 lines max for responsive performance
- Default tmux history: 2,000 lines

**Caching strategy:**
```go
type ScrollbackCache struct {
    content      []string
    validUntil   time.Time
    historyLimit int
}

func (c *ScrollbackCache) Get() []string {
    if time.Now().After(c.validUntil) {
        return nil // Cache invalid
    }
    return c.content
}

func (c *ScrollbackCache) Invalidate() {
    c.validUntil = time.Now().Add(-1 * time.Second)
}
```

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ❌ **BLOCKED** | Same issue as Option 1: can't inject into xterm scrollback |
| **Implementation Complexity** | Medium | Caching logic straightforward |
| **UX Quality** | ⚠️ Medium | 100-200ms latency on scroll-up |
| **Requirements Met** | ❌❌❌❌ | Blocked by xterm.js API limitation |
| **Maintainability** | Medium | Cache invalidation adds complexity |

**Pros:**
- ✅ tmux is canonical source of truth
- ✅ No log files or replication

**Cons:**
- ❌ **SAME BLOCKER AS OPTION 1:** Cannot prepend to xterm buffer
- ❌ Performance degrades with large history (100-200ms latency)
- ❌ Only works for local sessions (SSH adds network latency)

**Verdict:** ❌ **NOT VIABLE** - Same API limitation as Option 1

---

## Option 5: Hybrid Mode with Smart Switching

### Concept
Auto-switch between PTY streaming (fast) and polling refresh (complete) based on activity.

```
Behavior:
  - During active output: PTY streaming mode (low latency, scrollback may lag)
  - When idle (500ms no output): Auto-refresh scrollback ONCE
  - User never manually refreshes
```

### Implementation

**Already 90% implemented in codebase:**
- DiffViewport polling works (proven perfect scrollback)
- PTY streaming exists (proven low latency)
- Just need: Auto-switch logic + fix DiffViewport corruption bug

```go
// terminal.go
type Terminal struct {
    mode          string // "pty-streaming" or "polling"
    lastOutputAt  time.Time
    switchPending bool
}

func (t *Terminal) readLoop() {
    for {
        data := t.pty.Read()

        if t.mode == "pty-streaming" {
            // Real-time streaming
            t.emit("terminal:data", data)
            t.lastOutputAt = time.Now()

            // Schedule switch to polling after idle
            if !t.switchPending {
                t.switchPending = true
                time.AfterFunc(500*time.Millisecond, t.checkSwitchToPolling)
            }
        }
    }
}

func (t *Terminal) checkSwitchToPolling() {
    if time.Since(t.lastOutputAt) > 500*time.Millisecond {
        // Idle - do ONE full refresh from tmux
        t.refreshScrollbackOnce()
        t.switchPending = false
    }
}

func (t *Terminal) refreshScrollbackOnce() {
    // Clear xterm, fetch full tmux history, re-render
    // This is ALREADY IMPLEMENTED in RefreshTerminalAfterResize()
    t.ctx.EventsEmit("terminal:clear", sessionID)
    history := tmux.CapturePane(-50000, -1) // Full history
    t.ctx.EventsEmit("terminal:history", history)
}
```

### How to Minimize Flicker

**Current resize refresh (Terminal.jsx lines 1029-1046):**
```javascript
const refreshScrollbackAfterResize = async () => {
    // Clear xterm
    xtermRef.current.clear();

    // Request fresh content from tmux
    await RefreshTerminalAfterResize(sessionId);
};
```

**Optimization strategies:**
1. **Double-buffering:** Render new content in hidden xterm instance, swap when ready
2. **Viewport preservation:** Save scroll position, restore after refresh
3. **Smooth transition:** Fade out/in with CSS animation (200ms)

**Best approach:** Viewport preservation
```javascript
const refreshScrollbackOnce = async () => {
    const savedViewportY = term.buffer.active.viewportY;
    const wasAtBottom = savedViewportY >= term.buffer.active.baseY;

    term.clear();
    await RefreshTerminalAfterResize(sessionId);

    if (!wasAtBottom) {
        // Restore scroll position
        term.scrollLines(savedViewportY - term.buffer.active.viewportY);
    }
};
```

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ✅ **HIGH** | 90% already implemented |
| **Implementation Complexity** | Low | 1-2 days (mostly testing) |
| **UX Quality** | ✅ Good | One 50ms flicker after output stops |
| **Requirements Met** | ✅✅✅✅ | Full history ✅, smooth ✅ (one flicker), no refresh ✅, search ✅ |
| **Maintainability** | High | Reuses existing code |

**Pros:**
- ✅ **Minimal new code** (reuse existing DiffViewport + PTY streaming)
- ✅ Best of both worlds: low latency + complete scrollback
- ✅ One 50ms flicker is acceptable (resize already does this)
- ✅ Works for local AND remote sessions

**Cons:**
- ⚠️ Must fix DiffViewport corruption bug (Phase 2.8 finding)
- ⚠️ Brief flicker every time output stops (mitigated by viewport preservation)

**Biggest Risk:** DiffViewport corruption bug may be unfixable. If so, use full viewport redraws (causes flicker but proven to work).

**Verdict:** ✅ **VIABLE** - Lowest risk, fastest implementation

---

## Option 6: PTY Attach Architecture (LLM Council Recommendation)

### Concept
Bypass `pipe-pane` entirely. Attach to tmux via PTY like a real terminal client.

```
Backend (Go):
  1. Spawn PTY running: tmux attach-session -t <target>
  2. Set PTY dimensions to match frontend (cols × rows)
  3. Stream PTY output directly to frontend
  4. tmux handles:
     - Initial full redraw (including scrollback)
     - Resize redraws (automatic SIGWINCH handling)
     - Cursor positioning (correct by design)

Frontend (xterm.js):
  - Receive PTY stream via WebSocket
  - Write to xterm.js with term.write()
  - Scrollback accumulates naturally (tmux sends full context)
```

### Why This Should Work (Council Analysis)

From `docs/scrollback-architecture.md` Council recommendations:

> "PTY Streaming ensures tmux sends initial full redraw including cursor. tmux handles resize redraws automatically. Single source of truth (no dual-state problem)."

**The key insight:** When you `tmux attach` via PTY, tmux sends a **full viewport snapshot** including cursor position on initial attach. This bootstraps xterm.js correctly.

### Current Problem with PTY Streaming

From `docs/pty-scrollback-troubleshooting.md`:

> "tmux sends cursor-positioning escape sequences through the PTY (e.g., `\x1b[H` for cursor home). xterm.js overwrites the same screen rows rather than accumulating scrollback."

**Why it happens:**
- tmux optimizes for efficiency: "move cursor to row 5, write text"
- xterm.js interprets as: "overwrite row 5 in viewport"
- No scrolling occurs

**Root cause:** Missing initial scrollback context. When tmux attaches to existing session, it assumes client already has the scrollback. It only sends **incremental updates** (cursor moves + new content).

### The Fix: Bootstrap Scrollback Before PTY Attach

```go
// StartTmuxSessionPTY - The correct PTY streaming implementation
func (t *Terminal) StartTmuxSessionPTY(tmuxSession string, cols, rows int) error {
    // Phase 1: Bootstrap scrollback (one-time)
    history := tmux.CapturePane(-50000, -1) // Full history from tmux
    t.ctx.EventsEmit("terminal:history", history) // Send to xterm

    // Phase 2: Attach PTY for live streaming
    pty := SpawnPTY("tmux", "attach-session", "-t", tmuxSession)
    pty.Resize(cols, rows)

    go t.readPTY(pty) // Stream to frontend

    return nil
}
```

**Frontend receives:**
1. `terminal:history` event → Writes 50k lines to xterm → Scrollback populated
2. PTY stream events → New output appends normally

**Critical:** Must send history BEFORE starting PTY stream, or first PTY chunk will corrupt scrollback.

### Why This Wasn't Tried Before

**Historical context from codebase exploration:**
- PTY streaming was attempted (see `HANDOFF-PTY-STREAMING.md`)
- Focus was on streaming-only approach (no bootstrap phase)
- Hybrid approach (bootstrap + stream) wasn't tested

### Assessment

| Criteria | Score | Notes |
|----------|-------|-------|
| **Technical Feasibility** | ✅ **HIGH** | PTY attach already implemented (pty.go) |
| **Implementation Complexity** | Low | Add history bootstrap before PTY start (10 lines of code) |
| **UX Quality** | ✅ Excellent | Smooth, no flicker, natural scrolling |
| **Requirements Met** | ✅✅✅✅ | All 4 requirements satisfied |
| **Maintainability** | Very High | Simplest possible architecture |

**Pros:**
- ✅ **Minimal code change** (add history bootstrap)
- ✅ Natural terminal behavior (tmux does what it does best)
- ✅ Resize handled automatically by tmux (sends redraw)
- ✅ Works for local sessions immediately
- ✅ No escape sequence parsing needed

**Cons:**
- ⚠️ Remote sessions need SSH PTY forwarding (already implemented)
- ⚠️ Must ensure history sent before PTY chunks arrive (ordering)

**Biggest Risk:** Race condition between history load and PTY stream start. Mitigation: Use synchronous history emit, then start PTY.

**Verdict:** ✅ **HIGHLY RECOMMENDED** - Simplest, most robust solution

---

## Recommendation Matrix

| Option | Complexity | Time to Implement | Success Likelihood | Long-term Maintainability |
|--------|-----------|-------------------|-------------------|---------------------------|
| **Option 1: Dual-Stream** | High | N/A (blocked) | 0% | N/A |
| **Option 2: Server-Side VT** | Moderate | 1-2 weeks | 90% | High |
| **Option 3: Replay** | High | 2-3 weeks | 60% | Medium |
| **Option 4: tmux On-Demand** | Medium | N/A (blocked) | 0% | N/A |
| **Option 5: Hybrid Mode** | Low | 1-2 days | 85% | High |
| **Option 6: PTY Bootstrap** | Very Low | 1 day | 95% | Very High |

---

## Final Recommendation: Crawl-Walk-Run Strategy

### Phase 1 (Crawl): PTY Bootstrap - 1 DAY ⭐ START HERE
**Implement Option 6 with history bootstrap**

```go
// terminal.go - Add this to existing StartTmuxSession
func (t *Terminal) StartTmuxSession(sessionID, tmuxSession string, cols, rows int) error {
    // 1. Fetch full history from tmux
    history, err := t.captureFullHistory(tmuxSession)
    if err != nil {
        return err
    }

    // 2. Emit history to frontend (synchronous - wait for ack)
    t.emitHistorySync(sessionID, history)

    // 3. NOW start PTY streaming (history already in xterm)
    pty := SpawnPTY("tmux", "attach-session", "-t", tmuxSession)
    pty.Resize(uint16(cols), uint16(rows))

    t.pty = pty
    go t.readPTY()

    return nil
}
```

**Why start here:**
- ✅ Minimal code change (1-2 hours)
- ✅ Reuses existing working code (history capture + PTY attach)
- ✅ 95% chance of success
- ✅ If it works, problem solved permanently

**If it works:** Ship it. Done.

**If it fails (scrollback still doesn't accumulate):**
- Investigate tmux output after bootstrap (does it send cursor moves?)
- Check xterm.js buffer state after history load
- Proceed to Phase 2

### Phase 2 (Walk): Hybrid Idle Refresh - 1-2 DAYS
**Implement Option 5 if Phase 1 fails**

Reuse existing DiffViewport polling, add auto-switch:
1. PTY streaming during active output
2. ONE polling refresh after 500ms idle
3. Fix DiffViewport corruption OR use full viewport redraws

**Why this is second:**
- ✅ 90% of code already exists
- ✅ Proven to work (resize refresh is this approach)
- ✅ Acceptable UX (one flicker after output stops)

**If it works:** Ship it. Monitor for corruption reports.

**If DiffViewport corruption unfixable:**
- Use full viewport redraws (causes flicker but proven)
- OR proceed to Phase 3

### Phase 3 (Run): Server-Side Emulator - 1-2 WEEKS
**Implement Option 2 for production-grade solution**

Long-term investment in architecture:
1. Integrate `github.com/vito/vt100` library
2. Build server-side terminal buffer
3. Send structured updates to frontend
4. Add advanced features (search indexing, replay)

**Why this is third:**
- ⚠️ Significant implementation effort
- ⚠️ Risk of ANSI sequence bugs
- ✅ But: Best long-term architecture for features

**When to do this:**
- After Phase 1 or 2 ships and stabilizes
- When adding features like multi-session search, session recording
- When scaling to 100+ concurrent sessions (reduce tmux polling load)

---

## Testing Checklist

For any implementation, verify:

### Functional Tests
- [ ] `seq 1 10000` - All numbers searchable in scrollback
- [ ] Fast bursts (500 lines in 50ms) - No data loss
- [ ] Resize during output - No corruption
- [ ] Alt-screen apps (vim, nano) - Scrollback not polluted
- [ ] Progress bars (`\r` overwrites) - Final state correct
- [ ] Unicode/emoji - Correct rendering (wide chars)
- [ ] Long lines (100KB) - No truncation

### Performance Tests
- [ ] P50 latency < 50ms (output to visible)
- [ ] P99 latency < 200ms
- [ ] Memory stable over 1-hour session
- [ ] CPU < 10% during idle
- [ ] Smooth scrolling (60fps)

### Integration Tests
- [ ] CMD+F search works through full history
- [ ] Copy/paste preserves formatting
- [ ] Resize triggers clean refresh
- [ ] Remote SSH sessions work identically
- [ ] Multiple panes don't interfere

---

## References & Research Sources

### Go Terminal Emulator Libraries
- [vt100 (vito) - Go Package](https://pkg.go.dev/github.com/vito/vt100)
- [vt100 (jaguilar) - Go Package](https://pkg.go.dev/github.com/jaguilar/vt100)
- [charmbracelet/x/ansi - ANSI Parser (2026)](https://pkg.go.dev/github.com/charmbracelet/x/ansi)
- [Azure/go-ansiterm - Cross-platform Parser](https://github.com/Azure/go-ansiterm)

### xterm.js Research
- [Issue #2105 - Buffer API Limitations](https://github.com/xtermjs/xterm.js/issues/2105)
- [Issue #3864 - onScroll Doesn't Fire on User Scroll](https://github.com/xtermjs/xterm.js/issues/3864)
- [Issue #3201 - User Scrolling Not Emitted](https://github.com/xtermjs/xterm.js/issues/3201)

### tmux Performance
- [Issue #4171 - Resize Performance with Large History](https://github.com/tmux/tmux/issues/4171)
- [How to Increase Scrollback Buffer](https://tmuxai.dev/tmux-increase-scrollback/)
- [Scrollback Buffer Best Practices](https://expertbeacon.com/tmux-in-practice-scrollback-buffer/)

### Internal Documentation
- `docs/pty-scrollback-troubleshooting.md` - Current problem analysis
- `docs/scrollback-architecture.md` - DiffViewport corruption investigation
- `HANDOFF-PTY-STREAMING.md` - Previous PTY streaming attempt

---

## Conclusion

**Start with Option 6 (PTY Bootstrap).** It's the simplest possible fix with the highest chance of success. If PTY streaming naturally accumulates scrollback after bootstrapping history, the problem is solved with ~10 lines of code.

If that fails, **fall back to Option 5 (Hybrid Mode)**, which reuses 90% of existing code and provides acceptable UX with minimal risk.

**Only invest in Option 2 (Server-Side Emulator)** if:
1. Both Option 6 and 5 fail, OR
2. You need advanced features (session recording, cross-session search)

**Avoid Options 1, 3, 4** - they're either blocked by xterm.js API limitations or add unnecessary complexity.

---

**Next Steps:**
1. Create feature branch: `fix/pty-bootstrap-scrollback`
2. Implement history bootstrap in `StartTmuxSession()`
3. Test with `seq 1 10000` and Claude Code `/context`
4. If successful, ship and close issue
5. If unsuccessful, document findings and move to Phase 2
