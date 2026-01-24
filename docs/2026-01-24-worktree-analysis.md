# Worktree Analysis - January 24, 2026

Analysis of uncommitted/unmerged work across git worktrees, with recommendations for cleanup after PR #1 merges.

## Context

PR #1 (`fix/xterm-resize-reflow`) addresses box-drawing character corruption during wheel scroll in the desktop app. This analysis determines which worktrees are superseded by that PR.

## Worktree Status

| Worktree | Branch | Uncommitted | Unmerged | Status |
|----------|--------|-------------|----------|--------|
| main | main | 0 | — | Clean |
| custom-session-names | feature/custom-session-names | 1 (deleted file) | 0 | Merged |
| custom-names | feature/desktop-custom-names | 0 | 0 | Merged |
| desktop-visual-scrollback | feature/desktop-visual-scrollback | 0 | 2 | Still valuable |
| session-ux-enhancements | feature/session-ux-enhancements | 0 | 2 | Partially cherry-picked |
| xterm-resize-fix | fix/xterm-resize-reflow | 0 | 4 | Superseded by PR #1 |

## Detailed Analysis

### xterm-resize-fix → SUPERSEDED by PR #1

The 4 commits in this worktree are **identical** to PR #1 (same SHAs):

```
beee333 feat(desktop): add frontend diagnostic logging support
26e8bfc fix(desktop): resolve box-drawing character corruption during wheel scroll
2980b1f fix(desktop): add DOM renderer and enhanced escape sanitization
374b80d fix(desktop): resolve xterm.js reflow corruption on initial load
```

**Recommendation:** Delete this worktree after PR #1 merges.

### desktop-visual-scrollback → STILL VALUABLE

This addresses a **separate problem** not covered by PR #1:

| Aspect | PR #1 | visual-scrollback |
|--------|-------|-------------------|
| **Problem** | Box-drawing corruption during scroll | Data loss when output faster than poll rate |
| **Solution** | Intercept wheel events, use scrollLines() | History stitching + viewport diffing |
| **Files** | Terminal.jsx rendering | history_tracker.go (new), Terminal.jsx |
| **Tests** | Manual test plan | 26 unit tests |

**Key features in visual-scrollback not in PR #1:**
- History gap detection (fetch lines that scrolled off between polls)
- Scroll lock behavior (auto-scroll only when at bottom)
- "New output ↓" indicator when scrolled up
- Alternate screen detection (pauses during vim/less)

**Recommendation:** Rebase onto main after PR #1 merges due to overlapping Terminal.jsx changes.

### session-ux-enhancements → PARTIALLY CHERRY-PICKED

Git context indicators (dirty/ahead/behind) were cherry-picked to main. Remaining commits are MCP-related display features that were deemed not ready (MCP badges read from .mcp.json which doesn't reflect --mcp-config overrides).

**Recommendation:** Can delete worktree; remaining work documented in code comments.

### custom-session-names / custom-names → MERGED

These features are now in main.

**Recommendation:** Delete worktrees to reduce clutter.

## Action Plan

After PR #1 merges:

1. **Delete superseded worktrees:**
   ```bash
   git worktree remove agent-deck-xterm-resize-fix
   git worktree remove agent-deck-custom-names
   git worktree remove agent-deck-custom-session-names
   git worktree remove agent-deck-session-ux-enhancements
   ```

2. **Rebase visual-scrollback:**
   ```bash
   cd agent-deck-desktop-visual-scrollback
   git fetch origin
   git rebase origin/main
   # Resolve conflicts in Terminal.jsx
   ```

3. **Clean up remote branches** (if pushed):
   ```bash
   git push origin --delete feature/desktop-custom-names
   git push origin --delete fix/xterm-resize-reflow
   ```
