# Scrollback Data Loss Fix - Architecture Document

**Status:** Phase 1 & 2 Complete
**Created:** 2026-01-28
**Branch:** `fix/scrollback-fast-streaming`
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

## Remote Session Considerations

**Issue:** If tmux runs on a remote server (SSH), the pipe-pane log file is on the remote filesystem and cannot be directly read by the desktop app.

**Options:**
1. Accept limitation: pipe-pane only works for local sessions
2. Stream log via SSH: `ssh host "tail -f /tmp/log"`
3. Use tmux control mode for remote sessions

**Recommendation:** Start with local-only implementation, document the remote limitation, and address remote sessions in a future iteration.

---

## References

- [xterm.js Documentation](https://xtermjs.org/)
- [tmux pipe-pane Manual](https://man7.org/linux/man-pages/man1/tmux.1.html)
- LLM Council deliberation transcript (2026-01-28)
