# tmux Multi-Client Size Mismatch Investigation

**Status:** Analysis Complete
**Created:** 2026-01-29
**Issue:** Dot fill pattern in Agent Deck TUI when both TUI and RevvySwarm desktop app are attached to same session

---

## Problem Statement

When the Agent Deck TUI and RevvySwarm desktop app are BOTH attached to the same tmux session simultaneously, the TUI displays tmux's filler dots (`.`) outside the active content area. This occurs because the two clients have different terminal dimensions, and tmux can only display one size at a time.

### Visual Example

```
TUI view (smaller terminal):
┌──────────────────────────┐
│ $ command output         │
│ more content             │
│ .........................│  ← Dots fill unused space
│ .........................│
└──────────────────────────┘

Desktop app view (larger terminal):
┌─────────────────────────────────────┐
│ $ command output                    │
│ more content                        │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

---

## Current Configuration

```bash
$ tmux show-options -g window-size
window-size latest

$ tmux show-window-options -g aggressive-resize
aggressive-resize off
```

### What `window-size latest` Does

With `window-size latest`:
- tmux resizes the window to match the **LAST client that attached or resized**
- When desktop app resizes → TUI view becomes too small → dots appear
- When TUI resizes → desktop app view becomes wrong size
- Each client's resize overwrites the other's preferred size

---

## Architecture Context

### How Each Client Attaches

| Client | Attach Method | Resize Behavior | File Reference |
|--------|---------------|-----------------|----------------|
| **TUI** | `tmux attach-session` via PTY | Terminal size propagated via PTY | `internal/tmux/executor_local.go:212-360` |
| **Desktop** | Hybrid: PTY for input + pipe-pane for output | Explicit `resize-window` calls | `cmd/agent-deck-desktop/terminal.go:253-381` |

### Desktop App Resize Logic

The desktop app (terminal.go:1172-1224) explicitly resizes tmux on every terminal resize:

```go
// Resize tmux window if we're attached to a session
if session != "" {
    cmd := exec.Command(tmuxBinaryPath, "resize-window", "-t", session, "-x", itoa(cols), "-y", itoa(rows))
    if err := cmd.Run(); err != nil {
        t.debugLog("[RESIZE] tmux resize-window error: %v", err)
    }
}
```

This means **every time the desktop app window resizes, it forces tmux to resize**, which causes the TUI to see dots.

### Pipe-Pane Streaming Impact

The desktop app uses pipe-pane streaming (Phase 4 implementation, see `docs/scrollback-architecture.md`). The resize handling includes:
1. Pause pipe-pane streaming
2. Resize PTY and tmux window
3. Wait for tmux to reflow content (50ms)
4. Capture fresh history
5. Truncate log file
6. Resume streaming from new position

**Conclusion:** The pipe-pane implementation is NOT affected by the multi-client size mismatch. The mismatch is purely visual on the smaller client.

---

## Solution Options

### Option 1: Change to `window-size largest` ✅ RECOMMENDED

```bash
tmux set-option -g window-size largest
```

**Behavior:**
- tmux window sized to the **largest** of all attached clients
- Smaller clients see the full content (no dots)
- Smaller clients have scrollable viewport
- Works like VNC/screen sharing - smaller viewer scrolls

**Pros:**
- ✅ No visual corruption in any client
- ✅ All content visible to all clients (via scrolling)
- ✅ Consistent with user expectations (like screen sharing)
- ✅ No code changes needed
- ✅ Works with existing pipe-pane architecture

**Cons:**
- ⚠️ Smaller clients must scroll to see full content
- ⚠️ Line wrapping optimized for largest client

**Testing needed:**
- Verify TUI scrolling works correctly with larger tmux window
- Test pipe-pane streaming on desktop during concurrent TUI attachment
- Verify cursor positioning in both clients

---

### Option 2: Change to `window-size smallest`

```bash
tmux set-option -g window-size smallest
```

**Behavior:**
- tmux window sized to the **smallest** of all attached clients
- Larger clients see dots/padding around content
- Smaller clients see full viewport without scrolling

**Pros:**
- ✅ Smaller client (TUI) sees full content without scrolling

**Cons:**
- ❌ Larger client (desktop) sees dots/wasted space
- ❌ Defeats purpose of desktop app's larger viewport
- ❌ User with bigger screen penalized
- ❌ Not recommended - worse UX overall

---

### Option 3: Explicit Detach-on-Attach Behavior

**Implementation:**
- When TUI attaches → detach desktop app
- When desktop app attaches → detach TUI
- User can only use one client at a time

**Pros:**
- ✅ No size mismatch (only one client)
- ✅ Clear ownership of session

**Cons:**
- ❌ Destroys multi-client workflow
- ❌ Can't monitor in desktop while interacting in TUI
- ❌ Requires code changes in both clients
- ❌ Goes against tmux's design philosophy

**Code changes needed:**
- TUI: Add `-d` flag to `tmux attach-session` to detach other clients
- Desktop: Check for active clients before attaching, prompt user

---

### Option 4: Manual Window Size (Advanced)

```bash
tmux set-option -g window-size manual
# Then explicitly set size per window:
tmux resize-window -t session:0 -x 120 -y 30
```

**Behavior:**
- Window size set explicitly, doesn't auto-adjust
- Requires manual management

**Pros:**
- ✅ Predictable size
- ✅ Can optimize for specific layout

**Cons:**
- ❌ User must manage sizes manually
- ❌ Breaks on terminal resize
- ❌ Not ergonomic for daily use
- ❌ Would need UI for size management

---

### Option 5: Accept Current Behavior (Document as Feature)

**Recommendation:** Document that dots are expected when using both clients simultaneously.

**Pros:**
- ✅ No code changes
- ✅ Reflects tmux's actual behavior
- ✅ Users can resize TUI terminal to match desktop

**Cons:**
- ❌ Poor UX for users who want to use both
- ❌ Looks like a bug to new users
- ❌ Doesn't provide guidance on workaround

---

## Recommendation: window-size largest

**Implement Option 1** - Change global tmux setting to `window-size largest`.

### Rationale

1. **Best overall UX**: All clients see full content (via scrolling if needed)
2. **Zero code changes**: Just a tmux config change
3. **Consistent with expectations**: Works like VNC/screen sharing viewers
4. **No pipe-pane impact**: Streaming architecture unaffected
5. **Preserves multi-client workflow**: Users can monitor in desktop while working in TUI

### Implementation

```go
// In internal/tmux/tmux.go, around line 667 (after other SetServerOption calls):
_ = exec.SetServerOption("window-size", "largest")
```

Or in user's `~/.tmux.conf`:
```bash
set-option -g window-size largest
```

### Testing Checklist

- [ ] Attach TUI to session, verify normal operation
- [ ] Attach desktop app to same session, verify no dots in TUI
- [ ] Resize desktop app, verify TUI scrolling works
- [ ] Resize TUI, verify desktop app shows full content
- [ ] Test pipe-pane streaming during concurrent attachment
- [ ] Test search (Cmd+F) in desktop app with TUI attached
- [ ] Test cursor positioning in both clients
- [ ] Verify `/context` command output visible in both clients

---

## Alternative: Hybrid Approach (Future Work)

For users who want the "best of both worlds," implement a **smart window sizing mode**:

1. **Monitor active client**: Track which client is receiving input
2. **Size to active client**: Resize window to match the client being used
3. **Freeze on idle**: When no input for 5 seconds, lock size
4. **Visual indicator**: Show which client's size is active

This would require significant code changes and introduce complexity. Recommend starting with `window-size largest` and gathering user feedback before considering this approach.

---

## References

- [tmux manual - window-size](https://man7.org/linux/man-pages/man1/tmux.1.html#WINDOWS_AND_PANES)
- `docs/scrollback-architecture.md` - Pipe-pane streaming architecture
- `internal/tmux/executor_local.go:212-360` - TUI attach implementation
- `cmd/agent-deck-desktop/terminal.go:253-381` - Desktop attach implementation

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-29 | Investigation complete | Identified `window-size latest` as root cause |
| 2026-01-29 | Recommend `window-size largest` | Best UX with zero code changes |

---

## Next Steps

1. **User testing**: Test `window-size largest` with real workflows
2. **Documentation**: Update README with multi-client usage guidance
3. **Config option**: Consider making window-size user-configurable in `config.toml`
4. **Monitor feedback**: Track user reports about multi-client behavior
