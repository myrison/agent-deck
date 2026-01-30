# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
make build          # Build binary to ./build/agent-deck
make test           # Run all tests
make lint           # Run golangci-lint
make fmt            # Format code
make run            # Run in development mode
make dev            # Auto-reload on changes (requires air)
make install-user   # Install to ~/.local/bin (no sudo)

# Desktop app commands
make desktop-dev      # Run desktop app in dev mode (shows as "RevDen (Dev)")
make desktop-build    # Build production desktop app
make desktop-install  # Build and install to /Applications
```

**Single test file:**
```bash
go test -v ./internal/session -run TestStorageSave
```

**Debug mode:**
```bash
AGENTDECK_DEBUG=1 go run ./cmd/agent-deck
```

## Git & Pull Requests

**⚠️ CRITICAL - THIS IS A FORK ⚠️**

**NEVER submit PRs to the upstream repository (asheshgoplani/agent-deck).**

This is Jason's personal fork with custom modifications. ALL pull requests must target:
- **Repository**: `myrison/agent-deck` (the fork)
- **Base branch**: `main`

### Creating Pull Requests

**USE THE SKILL**: `/create-fork-pr <title>` - This skill has safeguards to prevent upstream submission

**If using `gh` directly**, you MUST explicitly specify the fork:
```bash
# ✅ CORRECT - Explicitly targets the fork
gh pr create --repo myrison/agent-deck --base main --title "..." --body "..."

# ❌ WRONG - Defaults to upstream!
gh pr create --title "..." --body "..."
```

**Before creating ANY PR:**
1. Verify you're targeting `myrison/agent-deck` (NOT `asheshgoplani/agent-deck`)
2. Verify base branch is `main`
3. If you accidentally create an upstream PR, close it immediately with an apology

## Development Workflow - Git Worktrees

**⚠️ CRITICAL - ALWAYS USE WORKTREES FOR DEVELOPMENT ⚠️**

**ALL development work MUST be done in a git worktree, NEVER in the main clone.**

### Worktree Workflow (MANDATORY)

When starting ANY development task:

1. **Check if you're in the main clone:**
   ```bash
   git rev-parse --show-toplevel  # If this is the main repo, create a worktree
   ```

2. **Look for an existing worktree matching the task:**
   ```bash
   git worktree list
   # Or use the skill: /worktree-list
   ```

3. **If no matching worktree exists, create one:**
   ```bash
   # Use the skill (PREFERRED):
   /dev-test-worktree <branch-name>

   # Or manually:
   git worktree add ../agent-deck-<feature-name> -b <branch-name>
   cd ../agent-deck-<feature-name>
   ```

4. **Work in the worktree, not the main clone**

### Why Worktrees?

- **Isolation**: Keep main clone clean and stable
- **Parallel work**: Test multiple branches simultaneously
- **Safety**: Protect main branch from accidental changes
- **Clean state**: Each worktree has its own working directory and index

### Example

```bash
# ✅ CORRECT - Create worktree first
/dev-test-worktree feat-new-feature
# ... work is now isolated in worktree ...

# ❌ WRONG - Working directly in main clone
cd ~/agent-deck
git checkout -b feat-new-feature
# ... this pollutes the main clone ...
```

**If you receive a development request and detect you're in the main clone, your FIRST action must be to set up a worktree.**

## Architecture Overview

Agent Deck is a terminal session manager for AI coding agents (Claude Code, Gemini CLI, OpenCode), built with Go and Bubble Tea TUI framework. It runs sessions inside tmux for persistence.

### Layer Structure

```
cmd/agent-deck/         CLI entry point & commands
    └─ main.go, *_cmd.go (session, group, mcp, worktree, try commands)

internal/
├── session/            Core business logic
│   ├── instance.go     Session data model (Instance struct)
│   ├── storage.go      JSON persistence (~/.agent-deck/profiles/)
│   ├── claude.go       Claude Code integration (session detection, MCP reading)
│   ├── gemini.go       Gemini CLI integration
│   ├── opencode_*.go   OpenCode integration
│   ├── groups.go       Hierarchical group management
│   ├── mcp_catalog.go  MCP server definitions from config
│   └── pool_manager.go MCP socket pooling for memory efficiency
│
├── ui/                 Bubble Tea TUI (Model-View-Update pattern)
│   ├── home.go         Main TUI model, event loop, keyboard handling
│   ├── list.go         Session/group tree rendering
│   ├── search.go       Fuzzy search with status filters
│   ├── mcp_dialog.go   MCP attach/detach modal
│   ├── forkdialog.go   Fork session modal (Claude only)
│   └── styles.go       Lipgloss color schemes
│
├── tmux/               tmux integration
│   ├── tmux.go         Session cache (O(1) lookups), session management
│   ├── detector.go     Status detection (running/waiting/idle/error)
│   └── pty.go          Pane content capture
│
├── mcppool/            Unix socket pooling for shared MCP processes
├── git/                Git worktree operations
├── experiments/        Quick experiments (try command)
├── platform/           OS detection (Unix vs Windows)
├── profile/            Claude profile detection
└── update/             Auto-update mechanism
```

### Key Data Flow

1. **Session Creation**: `Instance` created → saved to `sessions.json` → tmux session started → AI tool launched
2. **Status Detection**: tmux cache refreshed → pane content captured → pattern matching → status updated
3. **MCP Management**: Config parsed → MCPs toggled in `.claude.json` or `.mcp.json` → session restarted
4. **Session Fork** (Claude): Session files copied with new ID → new Instance linked to parent → MCPs restored

### Important Patterns

- **Session Cache**: `tmux.RefreshSessionCache()` is called once per tick, reducing O(n) subprocess calls to O(1)
- **Responsive Layout**: TUI adapts based on terminal width (<50, 50-79, 80+ columns)
- **Atomic Writes**: Storage uses temp files + rename for crash safety, keeps 3 backup generations
- **Platform Files**: Use `_unix.go` and `_windows.go` suffixes for platform-specific code

## Configuration

- **User config**: `~/.agent-deck/config.toml` (MCP definitions, defaults, pool settings)
- **Session data**: `~/.agent-deck/profiles/{profile}/sessions.json`
- **Logs**: `~/.agent-deck/logs/agentdeck_*.log`

## Testing Conventions

- Tests use temporary directories, no external dependencies
- Integration tests may spawn real tmux sessions (slower)
- Use `t.TempDir()` for file-based tests
- Platform-specific tests use build tags

## Native Desktop App (In Development)

A Wails-based native app (`cmd/agent-deck-desktop/`) complements the TUI with better UX:

- **xterm.js** for terminal emulation with Cmd+F searchable scrollback
- **Keeps tmux as backend** for session persistence, SSH support, and crash recovery
- Attaches to existing Agent Deck sessions via `tmux attach-session`
- Pre-loads scrollback into xterm.js buffer so search works through history

**Key files:**
- `cmd/agent-deck-desktop/` - Wails app (Go backend + React frontend)
- `docs/native-app-prototype-plan.md` - Implementation phases and architecture
- `docs/native-app-research.md` - Design rationale and competitive analysis

**Run in dev mode:**
```bash
make desktop-dev    # From repo root - uses "RevDen (Dev)" branding
```

## Debugging Desktop App

### Frontend Logs

**NEVER ask the user to tail logs** - do it yourself! Use these commands:

```bash
# Recent frontend console logs
tail -50 ~/.agent-deck/logs/frontend-console.log

# Live tail with grep
tail -f ~/.agent-deck/logs/frontend-console.log | grep -E "ERROR|WARN|pattern"
```

**Or use the skill:** `/read-desktop-logs` - reads and analyzes frontend console logs automatically.

### Backend Logs

```bash
# Most recent log file
ls -t ~/.agent-deck/logs/agentdeck_*.log | head -1 | xargs tail -100
```
