# Agent Handoff: PTY Streaming Implementation Plan - Final Review

## Project Context

**Repo:** `/Users/jason/Documents/Seafile/My Library/HyperCurrent/gitclone/agent-deck`
**App:** RevDen (Agent Deck Desktop) - A Wails-based native app for managing AI coding agent sessions (Claude Code, Gemini CLI, etc.)

The desktop app connects to tmux sessions and renders terminal output via xterm.js. We've been struggling with rendering corruption during fast output bursts caused by a broken `DiffViewport()` algorithm that generates invalid ANSI sequences.

## What Was Accomplished

1. **Architecture document created:** `docs/scrollback-architecture.md` - Full problem statement and initial council findings

2. **Implementation plan created:** `docs/pty-streaming-implementation-plan.md` - Detailed 5-phase plan with:
   - Council-recommended phase reordering (streaming first, then history)
   - Attach-first seam strategy (fixes capture/attach race condition)
   - Edge case handling (alt-screen, partial ANSI/UTF-8, resize)
   - Rollback strategy with terminal state reset
   - SSH compatibility (existing polling preserved until Phase 4)

3. **First council review completed** - The plan was reviewed by GPT-5.2, Claude Opus 4.5, Gemini 3 Pro, and Grok 4. Key findings incorporated:
   - Original "capture then attach" seam strategy was brittle
   - Phase order changed to prioritize streaming stability
   - Six critical edge cases added
   - Rollback strategy strengthened

4. **Worktree created:** `../agent-deck-pty-streaming` on branch `feature/pty-streaming`

5. **Plan committed and pushed to main:** Commit `bfef25d`

## Your Mission

**Send the finalized plan to the LLM Council for one more review before implementation begins.**

Focus areas for this review:
1. **Proposed optimizations** - Are there ways to simplify or improve the implementation?
2. **Missing considerations** - Anything we haven't thought of?
3. **Phase 1 validation** - Is the "no history" approach for Phase 1 the right trade-off?
4. **UTF-8/ANSI handling** - Is the partial sequence handling approach sound?
5. **Risk ranking** - Which risks should we prioritize mitigating first?

## How to Query the Council

Use the `/council` skill:

```
/council Review the finalized PTY streaming implementation plan at docs/pty-streaming-implementation-plan.md.

This is a FINAL REVIEW before implementation begins. The plan has already been reviewed once and updated with council feedback.

Please focus on:
1. Proposed optimizations - Can any phases be simplified or combined?
2. Missing considerations - What haven't we thought of?
3. Phase 1 trade-off validation - Is skipping history initially the right approach?
4. UTF-8/ANSI partial sequence handling - Is the buffering approach sound?
5. Risk prioritization - Which risks should we tackle first?

Context: The app renders tmux sessions via xterm.js. The current DiffViewport() polling causes rendering corruption during fast output. We're replacing it with direct PTY streaming. SSH sessions will continue using polling until Phase 4.
```

## Key Files to Read

1. **The implementation plan:** `docs/pty-streaming-implementation-plan.md` (1126 lines)
2. **Architecture context:** `docs/scrollback-architecture.md`
3. **Current terminal code:** `cmd/agent-deck-desktop/terminal.go`
4. **Current history tracker:** `cmd/agent-deck-desktop/history_tracker.go`

## User Preferences (from this session)

1. **Phase 1 no-history:** Acceptable trade-off for initial testing
2. **tmux status bar:** Plan should verify `status off` at runtime (may need to set per-session)
3. **Feature flag:** Use env var `REVDEN_PTY_STREAMING` (not config file)
4. **SSH:** Mandatory daily-use feature, must not break. Keep polling until Phase 4.

## After Council Review

Once you have the council's feedback:
1. Update the plan with any optimizations/changes
2. Commit the updated plan
3. Report findings to the user for approval before implementation

## Notes

- The worktree `../agent-deck-pty-streaming` already exists with the feature branch
- No code changes have been made yet - this is planning only
- The existing polling implementation works (with corruption issues) - we're not breaking anything yet
