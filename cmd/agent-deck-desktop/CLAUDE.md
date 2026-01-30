# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
wails dev                   # Run in dev mode with hot reload
wails build                 # Build production binary
cd frontend && npm install  # Install frontend dependencies
```

## Debugging & Logging

**IMPORTANT: For frontend debugging, use the `/read-desktop-logs` skill.** This skill provides instructions for reading frontend console logs that are automatically captured to a file. All `console.log/debug/info/warn/error` calls are intercepted and piped to the log file in dev mode.

**Log location:**
```
~/.agent-deck/logs/frontend-console.log
```

**Reading logs:**
```bash
# Watch logs in real-time
tail -f ~/.agent-deck/logs/frontend-console.log

# View recent log entries
tail -100 ~/.agent-deck/logs/frontend-console.log

# Search for specific patterns
grep -i "DEBUG" ~/.agent-deck/logs/frontend-console.log | tail -50
```

**Frontend logging utility** (`frontend/src/logger.js`):
- All `console.*` calls are automatically intercepted and written to the log file (dev mode)
- `logger.debug()` - Dev mode only, with component context prefix
- `logger.info()` - With component context prefix
- `logger.warn()` / `logger.error()` - With component context prefix

**Adding debug logging:**
```javascript
import { createLogger } from './logger';
const logger = createLogger('MyComponent');
logger.info('Something happened', { data: value });

// Or just use console.log - it's automatically captured:
console.log('[DEBUG] checkpoint reached', { state });
```

**Common debugging steps:**
1. Run `wails dev` to start with hot reload
2. Run `tail -f ~/.agent-deck/logs/frontend-console.log` in another terminal to watch logs
3. Reproduce the issue in the app
4. Check the log file for errors and debug output
5. Errors from Go functions called via Wails bindings appear in the frontend catch blocks

## Git & Pull Requests

**IMPORTANT:** This is a fork. Never submit PRs to the upstream repository. When asked to create a PR, always target our fork's `main` branch only.

## Architecture Overview

RevDen (Agent Deck Desktop) is a Wails v2 native app wrapping the Agent Deck TUI. It provides xterm.js-based terminal emulation with searchable scrollback, connecting to existing tmux sessions managed by Agent Deck.

### Key Constraint

**tmux is the backend for session persistence** - the app attaches to existing Agent Deck sessions via `tmux attach-session`, never manages sessions directly. This enables crash recovery, SSH support, and sharing sessions with the TUI.

### Layer Structure

```
Go Backend (app.go, main.go)
├── Terminal (terminal.go)      PTY + tmux polling for display updates
│   ├── StartTmuxSession()      Polling mode: history → attach → poll
│   ├── pollTmuxLoop()          80ms polling, diff viewport updates
│   └── sanitizeHistoryForXterm() Strip escape sequences for scrollback
├── TmuxManager (tmux.go)       Session CRUD, reads sessions.json
├── ProjectDiscovery            Frecency-ranked project scanning
├── QuickLaunchManager          Pinned favorites with shortcuts
├── LaunchConfigManager         Per-tool launch configurations
└── DesktopSettingsManager      Theme, font size, soft newline mode

React Frontend (frontend/src/)
├── App.jsx                     Main state: tabs, sessions, modals, keyboard shortcuts
├── Terminal.jsx                xterm.js with polling event handling
│   ├── terminal:history        Initial scrollback from tmux
│   ├── terminal:data           Streaming updates (history gaps + viewport diffs)
│   └── Wheel interception      Programmatic scrollLines() for reliable rendering
├── UnifiedTopBar.jsx           Session tabs + quick launch bar
├── CommandMenu.jsx             Cmd+K fuzzy search (sessions + projects)
├── SessionSelector.jsx         Main session list view
└── SettingsModal.jsx           Theme, font size, soft newline preferences
```

### Data Flow: Two Modes

The app supports two terminal modes, controlled by `pty_streaming` in `~/.agent-deck/config.toml`:

#### Polling Mode (Default)

Legacy mode using capture-pane polling:

1. **Connect**: `StartTmuxSession()` → resize tmux → capture full history → emit `terminal:history` → attach PTY (input only) → start polling
2. **Poll loop** (80ms): Check alt-screen state → fetch history gap (new scrollback) → diff viewport → emit `terminal:data`
3. **Viewport diff**: `HistoryTracker.DiffViewport()` compares current vs last viewport, generates minimal ANSI update sequence
4. **History gap**: Lines that scrolled off viewport between polls are emitted verbatim for scrollback

**Known issue**: DiffViewport can generate invalid ANSI during fast output, causing rendering corruption.

#### PTY Streaming Mode (Experimental)

Direct PTY streaming that fixes ANSI corruption. Enable with `pty_streaming = true` under `[desktop.terminal]`.

1. **Connect**: `startTmuxSessionStreaming()` → resize tmux → attach PTY FIRST → buffer output (100ms)
2. **History capture**: Capture scrollback history AFTER attach (Attach-First strategy avoids race condition)
3. **Emit**: `terminal:history` (scrollback) → `terminal:data` (buffered viewport) → continue streaming
4. **Live streaming**: `readLoopStream()` emits PTY output directly to xterm.js
5. **Filtering**: `stripDeviceAttributes()` removes terminal ID sequences; `stripTTSMarkers()` removes TTS markers

**See**: `docs/pty-streaming-implementation-plan.md` for full architecture

### Key Files

| File | Purpose |
|------|---------|
| `terminal.go` | PTY management, tmux polling, escape sequence sanitization |
| `history_tracker.go` | Viewport diffing for efficient polling updates |
| `tmux.go` | Session listing, creation, git info, sessions.json parsing |
| `project_discovery.go` | Frecency-based project scanning from config.toml paths |
| `launch_config.go` | Launch configurations (dangerous mode, MCP configs, extra args) |
| `frontend/src/Terminal.jsx` | xterm.js setup, event handlers, wheel interception |
| `frontend/src/App.jsx` | State management, tab handling, keyboard shortcuts |

### Configuration

- **User config**: `~/.agent-deck/config.toml` (project_discovery.scan_paths)
- **Session data**: `~/.agent-deck/profiles/default/sessions.json`
- **Desktop settings**: `~/.agent-deck/desktop-settings.json` (theme, font size, soft newline)
- **Quick launch**: `~/.agent-deck/quick_launch.json`
- **Launch configs**: `~/.agent-deck/launch_configs.json`
- **Frecency data**: `~/.agent-deck/frecency.json`

### Important Patterns

- **Polling over streaming**: PTY output is discarded; display comes from `tmux capture-pane` polling. This prevents TUI escape sequences from corrupting xterm.js scrollback.
- **Wheel interception**: Native wheel events cause rendering corruption in WKWebView. The app intercepts wheel and calls `xterm.scrollLines()` programmatically.
- **History sanitization**: `sanitizeHistoryForXterm()` strips cursor positioning, screen clearing, and alternate buffer sequences while preserving colors.
- **Tab state**: Tabs are React state (`openTabs`), not persisted. Each tab holds a session reference and unique ID.

### Keyboard Shortcuts (App.jsx)

- `Cmd+K` - Command menu
- `Cmd+T` - New tab via menu
- `Cmd+W` - Close current tab
- `Cmd+1-9` - Switch to tab by number
- `Cmd+[` / `Cmd+]` - Previous/next tab
- `Cmd+F` - Search in terminal
- `Cmd+,` - Settings
- `Cmd+Escape` - Back to session selector
- `Cmd++` / `Cmd+-` - Font size
