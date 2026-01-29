# Scrollback Data Loss Fix - Architecture Document

**Status:** Phase 2.5 - Verification & Root Cause Investigation
**Created:** 2026-01-28
**Branch:** `fix/scrollback-debug`
**Last Updated:** 2026-01-28

---

## Problem Statement

When AI agents like Claude Code emit large amounts of output quickly (e.g., `/context` command), lines completely disappear from scrollback history. Users cannot scroll back to see the full output, creating a confusing, disjointed experience.

### Reproduction Steps
1. Open Agent Deck desktop app
2. Start a Claude Code session
3. Run `/context` command (or any command that produces fast output)
4. Attempt to scroll back through history
5. Observe: Lines are truncated, content is missing

---

## Root Causes Identified

| Issue | Severity | Description |
|-------|----------|-------------|
| **Eviction race condition** | Critical | tmux evicts lines before 80ms poll if output exceeds `history-limit` |
| **Silent gap loss** | High | `FetchHistoryGap()` errors logged but data permanently lost |
| **80ms polling interval** | Medium | Too slow for fast bursts (100+ lines between polls) |
| **xterm.js scrollback limit** | Medium | Hardcoded at 10,000 lines, not configurable |
| **No discontinuity detection** | Medium | Users don't know when data is lost |
| **Go→JS bridge bottleneck** | Unknown | Wails event queue may saturate under load |
| **Frontend write pressure** | Unknown | xterm.js may not keep up with rapid writes |

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE (Lossy)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Agent Output ──► tmux pane ──► [history buffer: N lines]      │
│                                         │                        │
│                                         ▼                        │
│                              pollTmuxLoop (80ms)                 │
│                                         │                        │
│                                         ▼                        │
│                            capture-pane + FetchHistoryGap        │
│                                         │                        │
│                                         ▼                        │
│                              EventsEmit("terminal:data")         │
│                                         │                        │
│                                         ▼                        │
│                               xterm.js write()                   │
│                                                                  │
│   PROBLEM: If output exceeds tmux history-limit between polls,  │
│            lines are PERMANENTLY LOST                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files
- `cmd/agent-deck-desktop/terminal.go` - Polling loop, gap fetching
- `cmd/agent-deck-desktop/history_tracker.go` - History index tracking
- `cmd/agent-deck-desktop/frontend/src/Terminal.jsx` - xterm.js integration

---

## Proposed Architecture: Hybrid Streaming + Polling

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROPOSED ARCHITECTURE (Lossless)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Agent Output ──► tmux pane ──┬──► pipe-pane ──► log file      │
│                                │         │                       │
│                                │         ▼                       │
│                                │    Go file reader               │
│                                │    (append-only, lossless)      │
│                                │         │                       │
│                                │         ▼                       │
│                                │  EventsEmit("terminal:data")    │
│                                │         │                       │
│                                │         ▼                       │
│                                │    xterm.js write()             │
│                                │    (with RAF batching)          │
│                                │                                 │
│                                └──► capture-pane (80ms)          │
│                                          │                       │
│                                          ▼                       │
│                                    Viewport state only           │
│                                    (cursor, alt-screen)          │
│                                                                  │
│   SOLUTION: pipe-pane provides lossless stream as source of     │
│             truth; polling only for viewport verification        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Concept: Raw vs Rendered Conflict

**The Problem:**
- `pipe-pane` outputs **raw bytes** (ANSI codes, no line wrapping)
- `capture-pane` outputs **rendered viewport** (wrapped by tmux)
- These are fundamentally different representations

**The Risk:**
- If you try to stitch pipe history with capture content, visual continuity breaks
- Window resizes cause tmux to reflow rendered text, but raw log doesn't reflow
- Lines will duplicate or disappear at boundaries

**The Solution:**
- Once pipe-pane is enabled, treat the **pipe log as canonical source of truth**
- Use capture-pane ONLY for cursor position and viewport state verification
- Do NOT try to merge the two data sources

---

## Key Discovery: Unused Code Exists

**Critical finding during exploration:**

The codebase already contains `EnablePipePane()` and `DisablePipePane()` methods that are **implemented but NEVER CALLED**:

- `internal/tmux/executor.go` - Interface definition
- `internal/tmux/executor_local.go` - Local implementation
- `internal/tmux/executor_ssh.go` - SSH implementation

**Action required:** Before implementing new code, test the existing dead code to discover why it was abandoned. This may reveal blockers (file locking, performance issues, rendering conflicts).

---

## Solution Phases: Crawl-Walk-Run

### Phase 0: Documentation
Create this document for long-term record.

### Phase 1: Setup, Baseline & Archeology
- Create worktree for isolated development
- **Investigate unused EnablePipePane code** (why was it abandoned?)
- Establish baseline performance metrics
- Create torture test infrastructure

### Phase 1.5: Instrumentation (Council Directive)
- Add counters at each pipeline stage to identify bottleneck
- Verify loss occurs in tmux capture, not Go→JS transport or xterm

### Phase 2: Quick Wins (Crawl)
- Make xterm.js scrollback configurable (currently 10,000 hardcoded)
- Add retry logic for `FetchHistoryGap()` with force resync
- Increase tmux `history-limit` to 50,000 for agent sessions
- Add discontinuity markers when data is lost
- Add frontend write batching (RAF-based)

### Phase 3: Adaptive Polling (Walk) - SIMPLIFIED
- Implement adaptive polling interval (20-80ms based on throughput)
- Simple burst detection only
- **Skip complex overlap reconciliation** (Council: "throw-away work")

### Phase 4: Hybrid Architecture (Run)
- Enable `pipe-pane` for lossless history streaming
- Define pipe log as canonical source of truth
- File lifecycle management (rotation, cleanup)
- Graceful degradation fallback
- Handle alt-screen content filtering

---

## Testing Strategy

### Torture Tests

| Test | Description | Pass Criteria |
|------|-------------|---------------|
| `seq 1 10000` | Verify all integers present | 0 missing numbers |
| 500-line burst | 500 lines in 50ms | <1% loss |
| Resize chaos | Resize during burst | No crash, <5% loss |
| Alt-screen | vim during output | Correct mode detection |
| CR/Progress | `\r` updates only | Final state visible |
| Split ANSI | Codes across chunks | No corruption |
| Unicode/Emoji | Wide characters | Correct rendering |
| Long lines | 100KB single line | No truncation |
| Crash recovery | Restart mid-stream | Session resumes |

### Side Effect Tests (Features That Must Continue Working)

| Feature | Test Method | Pass Criteria |
|---------|-------------|---------------|
| **Scrolling** | Wheel scroll up/down | Smooth, indicator works |
| **Copy** | Select text, Cmd+C | Text in clipboard |
| **Paste** | Cmd+V with text | Text inserted |
| **Image paste** | Ctrl+V (macOS SSH) | Remote path returned |
| **Search** | Cmd+F, type query | Matches found, navigation works |
| **Alt-screen** | Open vim, scroll | Page Up/Down sent correctly |
| **Resize** | Drag window | Content reflows properly |
| **Connection** | SSH disconnect | Overlay shows, reconnection works |
| **File drop** | Drag image | Path inserted correctly |
| **Soft newline** | Shift+Enter | Newline without execute |

### Metrics to Track

| Metric | Formula | Target |
|--------|---------|--------|
| Loss rate | (expected - captured) / expected | <0.1% (Phase 4) |
| P50 latency | Time from tmux to xterm | <50ms |
| P99 latency | Worst case latency | <200ms |
| Memory growth | RSS over 30min test | <10% |
| CPU during burst | Percentage | <50% |
| Ordering errors | Out-of-order lines | 0 |

---

## Success Criteria

### Phase 1 & 1.5 ✅ COMPLETE
- [x] Archeology complete - EnablePipePane exists but unused (needs investigation)
- [x] Baseline metrics documented (tmux capture-pane shows 0% loss)
- [x] Pipeline bottleneck identified (loss occurs in Go→JS→xterm.js, not tmux)
- [x] PipelineStats instrumentation added to terminal.go
- [x] Debug overlay added (Cmd+Shift+D) for real-time monitoring
- [ ] All side effect tests pass (needs manual verification)

### Phase 2 (Quick Wins) ✅ COMPLETE
- [ ] Loss rate reduced by 20-50% in torture tests (needs verification)
- [x] Scrollback configurable via settings (default increased to 50k)
- [ ] Discontinuity markers appear when data lost (deferred to Phase 3)
- [x] RAF write batching reduces frontend pressure
- [ ] All side effect tests pass (needs manual verification)
- [ ] No regression in P99 latency (needs verification)

### Phase 3 (Adaptive Polling)
- [ ] Additional 10-30% loss reduction
- [ ] Polling interval adapts to output rate
- [ ] Burst mode activates during fast output
- [ ] All side effect tests pass
- [ ] Memory growth <10% over baseline

### Phase 4 (Hybrid Architecture)
- [ ] Loss rate <0.1% in torture tests
- [ ] pipe-pane logs contain complete output
- [ ] Logs cleaned up on session close
- [ ] Log rotation works at 50MB
- [ ] Graceful degradation when pipe-pane fails
- [ ] All side effect tests pass
- [ ] CPU/memory overhead acceptable (<5% increase)
- [ ] Zero crashes in 8-hour soak test

---

## Critical Files

### Backend (Go)
| File | Purpose |
|------|---------|
| `cmd/agent-deck-desktop/terminal.go` | Polling loop, session management |
| `cmd/agent-deck-desktop/history_tracker.go` | History gap tracking, viewport diffing |
| `cmd/agent-deck-desktop/settings.go` | Desktop settings management |
| `internal/tmux/executor.go` | TmuxExecutor interface (has unused pipe-pane methods) |
| `internal/tmux/executor_local.go` | Local tmux implementation |
| `internal/tmux/executor_ssh.go` | SSH tmux implementation |

### Frontend (React)
| File | Purpose |
|------|---------|
| `frontend/src/Terminal.jsx` | xterm.js integration, event handlers |
| `frontend/src/constants/terminal.js` | Terminal configuration |
| `frontend/src/SettingsModal.jsx` | Settings UI |
| `frontend/src/utils/scrollAccumulator.js` | Wheel event handling |
| `frontend/src/utils/searchUtils.js` | Search functionality |

---

## LLM Council Review

This plan was reviewed by the LLM Council (GPT-5.2, Claude Opus 4.5, Gemini 3 Pro, Grok 4).

**Verdict:** Approved with modifications

**Key Council Directives Incorporated:**
1. ✅ Added Phase 1.5: Instrumentation (identify bottleneck before optimizing)
2. ✅ Added Code Archeology step (investigate unused EnablePipePane)
3. ✅ Simplified Phase 3 (no complex overlap reconciliation)
4. ✅ Addressed Raw vs Rendered conflict explicitly
5. ✅ Added file lifecycle management for pipe logs
6. ✅ Added frontend write batching (RAF-based)
7. ✅ Added comprehensive test scenarios (CR/progress, split ANSI, Unicode)
8. ✅ Documented remote session limitations

---

## Phase 2.5 Verification Results (2026-01-28)

### Test Results Summary

| Scenario | Events During Output | Data in Scrollback | Rendering Quality |
|----------|---------------------|-------------------|-------------------|
| Claude Code + `seq 1 10000` | **0 events** | ✅ Present (searchable) | ❌ Corrupts on interaction |
| Claude Code + any large output | **0 events** | ✅ Present (searchable) | ❌ Corrupts on interaction |
| Shell session + test script | ✅ Events populate | ✅ Present | ✅ Clean |
| Resize after corruption | Events appear | ✅ Present | ✅ Fixes rendering |

### Key Findings

**GOOD NEWS:** Data is NOT being lost. All lines are present and searchable in scrollback.

**UNEXPECTED DISCOVERY:** Two distinct issues identified:

#### Issue 1: Zero Events During Claude Code Output
When output streams in a Claude Code session, the debug overlay shows **0 events received** and **0 bytes**. However, the data IS in the scrollback (searchable). This means:
- The polling loop is either not running or not emitting during Claude Code command execution
- The scrollback data comes from the **initial history capture on attach**, not from streaming `terminal:data` events
- The 2 events / 1818 bytes observed was from viewport updates AFTER the command completed, not during

**Hypothesis:** Something about Claude Code sessions is preventing or bypassing the polling loop during output streaming.

#### Issue 2: Rendering Corruption on Interaction
When any of these occur in a Claude Code session with large scrollback:
- User opens search (Cmd+F)
- User resizes window
- Large output streams (e.g., AI assistant responses)

The viewport becomes visually corrupted:
- Text overlaps or gets misaligned
- Markdown tables render broken
- Lines appear in wrong positions

**Workaround:** Resizing the window again forces a full redraw and fixes the rendering.

**Hypothesis:** The viewport diff logic (`DiffViewport()` + history gap insertion) emits ANSI escape sequences that conflict with xterm.js internal cursor/scroll state, causing visual desync.

#### Issue 3: Wide Character (Emoji) Rendering
Green checkmark emojis (✅) consistently render with the right half clipped/cut off. This suggests:
- Wide character width calculation is incorrect somewhere in the pipeline
- tmux, xterm.js, or the sanitization code may be treating 2-cell-wide characters as 1-cell
- May be related to the viewport diff logic not accounting for wide character widths

### Reproduction Cases

1. **Zero events reproduction:**
   - Open RevDen desktop app
   - Attach to Claude Code session
   - Open debug overlay (Cmd+Shift+D)
   - Reset stats
   - Type `seq 1 10000` in the Claude Code prompt
   - Observe: Events stay at 0 during output

2. **Rendering corruption reproduction:**
   - Attach to Claude Code session
   - Have AI assistant output a large response (table, long text)
   - Observe: Rendering may corrupt
   - Resize window → Fixes rendering

### Root Cause Investigation Plan

**Option B selected:** Investigate WHY polling shows zero events during Claude Code command execution.

**Next steps:**
1. Add debug logging to `pollTmuxLoop()` to trace when/why polls happen ✅ DONE
2. Check if there's pause/resume logic affecting Claude Code sessions
3. Investigate if sessionID mismatch is causing event filtering
4. Examine the history capture vs polling code paths

### Automated Tests Status

All Phase 2 unit tests PASS:
- `pipeline_stats_test.go`: 3 tests ✅
- `desktop_settings_test.go` (scrollback): 9 tests ✅
- Frontend tests: 607 tests ✅

---

## Phase 2.6 Resolution (2026-01-28 Evening Session)

### Summary

The "zero events" issue was a **misdiagnosis** - events WERE being received, but the debug overlay wasn't auto-refreshing to show them. The real issues were:

1. **Debug overlay not auto-refreshing** - Used refs instead of state, fixed with interval
2. **Terminal remounting every 5 seconds** - Session status polling created new object refs, causing full terminal teardown/rebuild
3. **History gap escape sequences causing rendering corruption** - ANSI cursor save/restore conflicting with xterm.js state

### Root Causes Found

| Issue | Root Cause | Fix Applied |
|-------|-----------|-------------|
| "Zero events" in overlay | Overlay used `ref` (no re-render) | Added 200ms auto-refresh interval |
| 5-second flicker | `useEffect` depended on entire `session` object | Changed to stable IDs: `session?.id, session?.tmuxSession` |
| Rendering corruption (seq numbers mixing with /context) | History gap escape sequences conflicting with xterm.js | Disabled history gap injection |
| Full viewport redraw every poll | Debug code forcing `buildFullViewportOutput()` | Re-enabled smart diff |

### Changes Made This Session

#### 1. Debug Overlay Auto-Refresh (KEEP)
**File:** `frontend/src/Terminal.jsx`
**Change:** Added `useEffect` with 200ms interval to refresh overlay when visible
**Why:** The overlay used a ref to store stats, which doesn't trigger re-renders. Now auto-updates.

#### 2. Session ID in Status Bar (KEEP)
**File:** `frontend/src/StatusBar.jsx`, `frontend/src/StatusBar.css`
**Change:** Added session ID (first 8 chars) to status bar, clickable to copy full ID
**Why:** Useful for debugging, helps identify which session is attached

#### 3. Removed POLL-DEBUG Logging (KEEP)
**File:** `cmd/agent-deck-desktop/terminal.go`
**Change:** Removed `fmt.Printf("[POLL-DEBUG]...")` statements added during investigation
**Why:** Cleanup after investigation complete

#### 4. Disabled History Gap Injection (CONSIDER REVERTING)
**File:** `cmd/agent-deck-desktop/terminal.go`
**Change:** Commented out the escape sequence logic that injects history gaps:
```go
// Before: cursor save → move to bottom → emit gap with CRLF → restore cursor
// After: just emit viewport update, ignore history gap
_ = historyGap // Acknowledge but don't use
combined.WriteString(viewportUpdate)
```
**Why:** The escape sequences caused rendering corruption (old scrollback mixing with new content)
**Trade-off:** Streaming scrollback won't accumulate during fast output. Resize still fetches full history from tmux.
**RECOMMENDATION FOR NEXT AGENT:** Now that the 5-second remount bug is fixed, consider **re-enabling history gap injection** to test if it works correctly without the constant terminal remounting. The rendering corruption may have been caused by the interaction of history gap injection WITH the terminal remounting, not history gap injection alone.

#### 5. Re-enabled Smart Diff (KEEP)
**File:** `cmd/agent-deck-desktop/history_tracker.go`
**Change:** Removed debug code that forced full viewport redraw every poll:
```go
// Removed:
// DEBUG: Always use full viewport redraw to diagnose rendering artifacts
// return ht.buildFullViewportOutput(newLines)

// Re-enabled circuit breaker logic:
if diffPercent > 80 || lineMismatch {
    return ht.buildFullViewportOutput(newLines)
}
// Then smart diff for changed lines only
```
**Why:** Full redraws every 80ms caused flicker. Smart diff only updates changed lines.

#### 6. Fixed Terminal useEffect Dependencies (KEEP - THE REAL FIX)
**File:** `frontend/src/Terminal.jsx`
**Change:**
```javascript
// Before:
}, [searchRef, session, paneId, onFocus, fontSize, scrollSpeed]);

// After:
}, [searchRef, session?.id, session?.tmuxSession, session?.remoteHost, paneId, onFocus, fontSize, scrollSpeed]);
```
**Why:** Session status polling (every 5 seconds) creates new object references. Using the whole `session` object as a dependency caused the entire terminal to unmount/remount every 5 seconds. Using stable identifiers (`session?.id`, etc.) means the terminal only re-initializes when the actual session changes.

### Current Status

- ✅ **Stable** - No more 5-second flicker
- ✅ **Events display correctly** in debug overlay
- ✅ **Rendering clean** for normal output and `/context`
- ⚠️ **History gap injection disabled** - streaming scrollback won't accumulate (resize still works)
- ✅ **History gap injection CONFIRMED BROKEN** - Tested 2026-01-28 evening, still causes rendering corruption independent of remount bug

### Phase 2.7: History Gap Re-test (2026-01-28 Late Evening)

**Test performed:** Re-enabled history gap escape sequence injection after terminal remount bug was fixed.

**Result:** FAILED - Rendering corruption immediately visible. Multiple "Claude Code v2.1.23" headers overlapping, text from different scrollback regions mixing together.

**Conclusion:** The escape sequence approach (`\x1b7` save cursor → `\x1b[row;1H` move → emit CRLF → `\x1b8` restore) is fundamentally incompatible with xterm.js. This is NOT caused by the terminal remount bug - the two issues are independent.

**Code reverted:** History gap injection disabled again with updated comment noting the 2026-01-28 test.

### Remaining Issue: Fast Output Corruption

With history gap disabled, rendering is clean for normal use. However, **fast output still corrupts the display**:
- When large amounts of text stream quickly (e.g., `/context`, `seq 1 10000`)
- The viewport can become corrupted (partial output, missing lines)
- Resize fixes it (triggers full tmux history refresh)

### Phase 2.8: Fast Output Corruption Investigation (2026-01-28 Night)

**Experiments performed:**

| Experiment | Result | Conclusion |
|------------|--------|------------|
| 20ms polling (vs 80ms) | Still corrupts | Not a polling speed issue |
| Burst detection + auto-recovery | Doesn't fix | Can't undo corruption after it happens |
| Full viewport redraws (no diff) | **Works** but glitchy | **Diff algorithm is the culprit** |

**Key finding:** When `DiffViewport()` is bypassed and every poll does a full viewport redraw, the fast output renders correctly. However, 50 full redraws per second causes unacceptable visual flickering.

**Root cause confirmed:** The `DiffViewport()` smart diff algorithm in `history_tracker.go` generates incorrect ANSI escape sequences during fast output bursts. The algorithm compares previous and current viewport states and emits cursor positioning + line updates, but during rapid changes this produces invalid sequences that corrupt xterm.js rendering.

**Code reverted:** All experimental changes removed:
- Polling interval restored to 80ms
- Burst detection code removed
- Smart diff re-enabled (with known corruption issue)

### Current Workaround

Users can resize the window to trigger a full refresh and fix any corruption. This is suboptimal but functional.

### Real Fix Options

1. **Fix the diff algorithm** - Deep dive into `DiffViewport()` to understand why it generates bad ANSI sequences during fast output. May need fundamental redesign.

2. **Hybrid approach** - Use smart diff normally, detect stabilization after burst, do ONE full redraw. Similar to burst detection but only refresh once after output stops.

3. **pipe-pane architecture (Phase 4)** - Bypass polling entirely. Use tmux `pipe-pane` to stream output to a file, read file in Go, emit to xterm.js. This is the "proper" fix but significant work.

4. **Frontend accumulation** - Let xterm.js manage scrollback directly instead of backend polling.

### Next Steps

1. **Prioritize pipe-pane architecture** - The diff algorithm is fundamentally flawed for fast output. Rather than patching it, implement the lossless streaming approach.

2. **Wide character (emoji) rendering** - Still an open issue, not addressed this session.

---

## Remote Session Considerations

**Issue:** If tmux runs on a remote server (SSH), the pipe-pane log file is on the remote filesystem and cannot be directly read by the desktop app.

**Options:**
1. Accept limitation: pipe-pane only works for local sessions
2. Stream log via SSH: `ssh host "tail -f /tmp/log"`
3. Use tmux control mode for remote sessions

**Recommendation:** Start with local-only implementation, document the remote limitation, and address remote sessions in a future iteration.

---

## Phase 4: Pipe-Pane Streaming Implementation (2026-01-28)

### Branch: `feature/pipe-pane-streaming`

### Commits Made
1. `a2f3919` - Initial pipe-pane streaming implementation
2. `fd05476` - UTF-8 boundary splitting and bootstrap alignment fixes

### Problem Encountered: Cursor Position Desync

After implementing pipe-pane streaming, a critical regression occurred: **typed characters appear at the wrong screen location**.

#### Symptoms
- Initial history loads correctly
- First few characters appear at correct position
- On tab switch or resize, cursor jumps to wrong location
- Typed characters appear scattered down the left edge of the screen
- Multiple cursor indicators visible (blinking cursor at bottom while text appears elsewhere)

#### Root Cause Analysis

**Discovery via test script:**
```bash
tmux display-message -p "#{cursor_x},#{cursor_y}"  # Returns: x=10 y=8
tmux capture-pane -p -S - -E - | wc -l              # Returns: 24 lines
```

The issue: `capture-pane -S - -E -` returns **full viewport including trailing empty lines** (24 lines), but tmux cursor is at row 8. After writing 24 lines to xterm.js, cursor ends at row 24 (bottom) while tmux expects row 8.

**Pipe-pane output analysis (hex dump):**
```
1b5b3f32303236680d1b5b32431b5b34411b5b376d541b5b32376d0d0d0a...
```
Decodes to: `\x1b[?2026h` (bracketed paste) + `\r` + `\x1b[2C\x1b[4A` (move right 2, up 4)...

The pipe-pane stream includes **cursor positioning sequences** that assume cursor is at tmux's position, but xterm's cursor is at a different position after history load.

#### Attempted Fixes

| Attempt | Result | Why It Failed |
|---------|--------|---------------|
| Add cursor positioning after history | Partially worked | Breaks on resize/tab switch |
| Sanitize cursor sequences from pipe-pane | Completely broken | Claude Code UI needs cursor moves for prompt rendering |
| Strip only specific sequences | One char per line | Broke normal rendering flow |

### LLM Council Deliberation (2026-01-28)

Full council consulted with 4 models (GPT-5.2, Gemini 3 Pro, Claude Opus 4.5, Grok 4).

#### Consensus Finding

**`pipe-pane` is fundamentally the wrong primitive for driving a terminal renderer.**

`pipe-pane` gives "what the program wrote to PTY" not "what tmux currently has on screen." These diverge when:
- tmux does presentation work (redraws, reflow, status changes)
- Resize events cause tmux to redraw without program output
- Mode changes (copy-mode, alternate screen)

#### Council Recommendations (Prioritized)

**1. Immediate Fix: "Initialization Packet" Protocol**

If keeping `pipe-pane`, implement atomic handshake:
1. **Resize** tmux pane to match client dimensions
2. **Capture** content (`capture-pane -e -p -S -`)
3. **Query** cursor (`tmux display-message -p '#{cursor_x},#{cursor_y}'`)
4. **Construct** sync packet: content + `\x1b[row+1;col+1H` (absolute CUP)
5. **Only then** start `pipe-pane` streaming

**2. Handle Events as Destructive Re-syncs**

- **Tab switch**: Treat as fresh session - clear xterm, run full init
- **Resize**: Pause stream, resize tmux, re-run init sequence, resume

**3. Long-Term: PTY Streaming (Recommended)**

Replace `pipe-pane` with real tmux client via PTY:
```bash
tmux attach-session -t <target>  # Run inside PTY
```
Stream PTY output to xterm.js directly. This ensures:
- tmux sends initial full redraw including cursor
- tmux handles resize redraws automatically
- Single source of truth (no dual-state problem)

### Current Code State (End of Session)

**Files modified:**
- `cmd/agent-deck-desktop/terminal.go` - Added cursor positioning after history
- `cmd/agent-deck-desktop/pipe_pane.go` - Added (then reverted) sanitization
- `cmd/agent-deck-desktop/frontend/src/Terminal.jsx` - Added debug logging

**Status:** Broken. Sanitization reverted but cursor position issue remains.

### Next Steps for Continuation

1. **Implement "Initialization Packet" protocol** per council recommendation
2. **Add pause/resume mechanism** for pipe-pane during resize
3. **Consider PTY architecture** for long-term fix
4. **Test with Claude Code** specifically (has aggressive prompt refresh cycles)

---

## Troubleshooting Log

### Session: 2026-01-28 Late Night (Pipe-Pane Cursor Sync)

| Time | Action | Result |
|------|--------|--------|
| 22:48 | Started dev server on feature branch | App runs |
| 22:50 | Identified cursor at wrong position after history | Confirmed bug |
| 22:55 | Created test_pipe_pane.sh to analyze | Showed 24-line capture vs row 8 cursor |
| 23:00 | Added cursor positioning after history | Initial load fixed |
| 23:02 | Tested resize | Cursor still wrong after resize |
| 23:05 | Added RefreshAfterResize cursor positioning | Still broken |
| 23:07 | Discovered pipe-pane contains cursor sequences | Key insight |
| 23:08 | Added sanitizePipePaneOutput() | Completely broke - one char per line |
| 23:10 | Reverted sanitization | Back to original issue |
| 23:12 | Consulted LLM Council | Received architectural guidance |
| 23:20 | Council consensus: pipe-pane is wrong primitive | Need different approach |

### Debug Commands Used

```bash
# Check tmux cursor position
tmux display-message -t SESSION -p "#{cursor_x},#{cursor_y},#{pane_height}"

# Count capture-pane lines
tmux capture-pane -t SESSION -p -S - -E - | wc -l

# View pipe-pane hex output
tail -c 100 /tmp/agentdeck-pipe-*.log | xxd

# Watch frontend logs
tail -f ~/.agent-deck/logs/frontend-console.log | grep -E "(cursor|history|DEBUG)"

# Watch backend logs
tail -f /path/to/dev-server-output | grep -E "(PIPE-PANE|cursor)"
```

---

## References

- [xterm.js Documentation](https://xtermjs.org/)
- [tmux pipe-pane Manual](https://man7.org/linux/man-pages/man1/tmux.1.html)
- LLM Council deliberation transcript (2026-01-28)
- LLM Council deliberation on cursor sync (2026-01-28 late night)
