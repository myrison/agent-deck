# tmux Multi-Client Size Mismatch - Executive Summary

**Issue:** Dot fill pattern appears in Agent Deck TUI when both TUI and RevvySwarm desktop app are attached to the same tmux session.

**Root Cause:** tmux's `window-size latest` setting causes the window to resize to the LAST client's dimensions, making the other client's viewport incorrect.

---

## Quick Answer to Your Questions

### 1. Should we change tmux `window-size` to `largest` or `manual`?

**✅ YES - Change to `largest`**

This is the recommended solution because:
- **No dots in any client** - all clients see full content
- **Scrolling works** - smaller clients scroll to see full viewport
- **Zero code changes** - just a tmux config setting
- **Best UX** - works like VNC/screen sharing viewers
- **No pipe-pane impact** - streaming architecture unaffected

### 2. Should one app detach when the other attaches to the same session?

**❌ NO - Don't implement mutual exclusion**

This would:
- Destroy multi-client workflow (can't monitor in desktop while using TUI)
- Require code changes in both clients
- Go against tmux's design philosophy
- Create worse UX than the scrolling approach

### 3. Is this behavior acceptable as-is with user documentation?

**⚠️ MARGINALLY - but `window-size largest` is strictly better**

Documenting the current behavior is an option, but why not just fix it with a one-line config change?

### 4. Does this create any issues for the PTY streaming implementation?

**✅ NO - No issues for pipe-pane streaming**

The pipe-pane architecture (Phase 4, see `docs/scrollback-architecture.md`) is unaffected:
- Desktop app explicitly calls `resize-window` on resize (terminal.go:1209)
- Resize handling includes pause → truncate → capture → resume
- Log file management is independent of multi-client attachment
- **The size mismatch is purely visual, not a data loss issue**

---

## Recommended Implementation

### Option 1: Quick Fix (User Configuration)

Add to `~/.tmux.conf`:
```bash
set-option -g window-size largest
```

### Option 2: Code Change (Automatic for all users)

In `internal/tmux/tmux.go`, add after line 871 (in `EnableMouseMode()` function):

```go
// Set window-size to largest for multi-client scenarios
// This prevents dot fill patterns when TUI and desktop app are both attached
// Smaller clients see full content via scrolling (like VNC/screen sharing)
if err := exec.SetServerOption("window-size", "largest"); err != nil {
    // Non-fatal: older tmux versions may not support this
    debugLog("%s: failed to set window-size: %v", s.DisplayName, err)
}
```

---

## Testing

Run the test script to see the behavior difference:

```bash
./docs/test-window-size-settings.sh
```

Or test manually:
1. Start TUI session: `agent-deck`
2. Attach desktop app to same session
3. Resize desktop app window
4. Observe: With `latest`, TUI shows dots. With `largest`, TUI scrolls.

---

## Decision Recommendation

**Implement Option 2** (automatic code change) because:
- Users get the fix automatically without config changes
- Consistent behavior across all installations
- Still respects user's `~/.tmux.conf` if they override it
- Minimal risk (non-fatal error handling)

---

## Files for Review

- **Full Analysis**: `docs/tmux-multi-client-size-mismatch.md` (comprehensive 300-line document)
- **Test Script**: `docs/test-window-size-settings.sh` (interactive demonstration)
- **This Summary**: `docs/tmux-multi-client-SUMMARY.md` (you are here)

---

## Next Steps

1. **Review** this summary and the full analysis document
2. **Test** the recommended setting: `tmux set-option -g window-size largest`
3. **Decide** whether to implement as code change (Option 2) or document as user config (Option 1)
4. **Validate** with real workflow: TUI + desktop app simultaneously
5. **Update docs** if implementing as user configuration option
