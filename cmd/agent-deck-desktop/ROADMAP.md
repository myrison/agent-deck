# Agent Deck Desktop - Feature Roadmap


### Build support for dragging / pasting an image into an ssh'd session (doesn't work by default)

## Label Visibility
- Labels indicate important work being done where the user has taken the trouble to apply a label
- add filter to session view that filters only to sessions with labels

### Detect session status changes better than we do today
- Auto-update logos for each session during refresh process to detect if it's in a shell or agent session
   - Currently it seems to only load once and never update
   - This should occur on session tabs, in the session launcher, and in the session list (anywhere the icon is seen)
   - It should be implemented with a shared logo location if not done this way already so the logo is updated 1x, and automatically appears everywhere

---

## Priorities to implement

### Add in-app settings for Project Discovery scan paths
- Currently `[project_discovery].scan_paths` must be manually edited in `~/.agent-deck/config.toml`
- Users can't discover new projects without existing sessions unless this is configured
- Add UI in Settings modal to:
  - View configured scan paths
  - Add/remove scan paths (with folder picker)
  - Set max_depth
  - Configure ignore patterns
- Without this, the host-first session creation flow fails because projects without sessions aren't discoverable

### Enable a button in the app for opening second app window
- Support with keyboard and launcher shortcut, probably Cmd+N, and reserve Cmd+T for new tab
- The app supports multiple instances at once
- How it works:
  - First instance launched becomes "primary" (manages the notification bar)
  - Additional instances run as "secondary" (fully functional, but don't manage notifications to avoid conflicts)
  - Both can view/attach/manage the same sessions

### Build support for dragging / pasting an image into an ssh'd session (doesn't work by default)

## Label Visibility
- Labels indicate important work being done where the user has taken the trouble to apply a label
- add filter to session view that filters only to sessions with labels


### Detect session status changes better than we do today
- Auto-update logos for each session during refresh process to detect if it's in a shell or agent session
   - Currently it seems to only load once and never update
   - This should occur on session tabs, in the session launcher, and in the session list (anywhere the icon is seen)
   - It should be implemented with a shared logo location if not done this way already so the logo is updated 1x, and automatically appears everywhere


---

## In implementation now

### grids / panel layouts
- need an easy way to replace session with another session vs. force close and re-add

### saving grids / panel layouts doesn't seem to save the sessions that were loaded within them
- every time you choose the launcher to open the same panel, it just opens a 2x2 grid with the
  item you chose in the launcher vs. opening the last saved layout

---

### Recently implemented
- Delete saved layouts via Cmd+Backspace in Command Menu ✓
- Window resize blank screen fix (terminal went blank on resize, required navigating away and back) ✓
- Turn front page view of sessions into a list of agents on left, preview pane on right (like TMUX)
- Add hostname to top status bar in session view to clearly indicate which host the session is running in
- Add path to same status menu, for same reason
- Bug: determine why branch sometimes not shown in this status bar (i.e. for agent-deck, no branch shown)
- Add button & launcher action & keyboard shortcut to hide all groups (i.e. collapse to single view)
- Support keybindings, combos that allow the keyboard to jump one word at a time on Mac, or to EOL, beginning of lines
- Update documentation to show capabilities of desktop app -- dedicated Readme, plus mention on front page Readme
   - Add remote SSH capabilities to main readme
- Add auto-copy on select to app, option to disable in settings
- Remove sessions from agent-deck sessions list
- Change highlighting on search function to highlight entire rows where term is found with lightly shaded color, and darker shared color highlights specific search term
- Command Shift Z shortcut doesn't work on sessions page in multi-pane view
- Opening settings panel from within a session returns user to session list, probably because it's firing on Cmd+, shortcut as well as Cmd+Shift+,
- New terminal session does not work, silently fails, This fails when choosing new session, or new remote session
**Multiple Claude sessions in same directory**
- Add an easy ability to create numerous Claude sessions in the same directory and to easily view them in menu trees and the launcher
   - Add option to launcher when searching for a session that asks to open an existing session (or choose from several existing sessions in a single directory, or open a new one in an existing directory)
   - This will require thought and planning to avoid confusion
   - End goal: allow users to work on multiple things at once in the same directory, with separate agents, and add labels to each duplicated session to distinguish them. If no label provided by user, auto-apply incremental label #1, #2, etc.
- Not able to delete saved layouts
- In command launcher, we say that Cmd+Enter opens a tool picker, but it's unclear if this actually works -- what is it supposed to do, and does it do it?
- grids / panel layouts - need an easy way to replace session with another session vs. force close and re-add

--

## v0.1.0 - Prototype ✓
**Status:** In validation
**Goal:** Prove the concept is worth pursuing

### Features
- [x] Basic terminal emulation with PTY
- [x] Tmux session listing and attachment
- [x] Session selector UI
- [x] Cmd+F search in scrollback
- [x] Navigation (back button, Cmd+,)
- [x] Cmd+W close confirmation
- [x] DevTools and logging infrastructure

### Known Limitations
- Remote sessions disabled
- No session management (create/delete)
- No MCP management
- Scrollback loading shows visual transition
- No command palette

---

## v0.2.0 - Core UX Fixes ✅
**Status:** Complete
**Goal:** Fix critical UX issues and add command palette

### Critical Fixes ✅

**Scrollback Visual Artifacts Fix** ✅
- Fixed with polling approach instead of `tmux attach`
- See `TECHNICAL_DEBT.md` for details

### Command Palette (Cmd+K) ✅

**Implemented Features:**
- [x] Fuzzy search via fuse.js
- [x] Jump to sessions with keyboard navigation
- [x] Quick actions (New Terminal, Refresh, Toggle Quick Launch)
- [x] ESC to close, Enter to select
- [x] Cmd+Enter for tool picker

### Project-Aware Session Launching ✅

**4-Phase Implementation Complete:**

1. **Phase 1 - Command Palette:** Fuzzy search across sessions, projects, and actions
2. **Phase 2 - Project Discovery:**
   - Scans configured paths for projects (git, npm, go, rust, python, CLAUDE.md)
   - Frecency scoring (use count × recency multiplier)
   - Config via `[project_discovery]` in `~/.agent-deck/config.toml`
3. **Phase 3 - Quick Launch Bar:**
   - Horizontal bar with pinned favorite projects
   - Right-click context menu for remove/edit shortcut
   - Persists to `~/.agent-deck/quick-launch.toml`
4. **Phase 4 - Custom Shortcuts:**
   - Assign keyboard shortcuts to favorites (Cmd+Shift+letter)
   - Conflict detection with reserved system keys
   - Global shortcut handling

**Key Files Added:**
- `frontend/src/CommandPalette.jsx` - Fuzzy search modal
- `frontend/src/ToolPicker.jsx` - Tool selection (Claude/Gemini/OpenCode)
- `frontend/src/QuickLaunchBar.jsx` - Pinned favorites bar
- `frontend/src/ShortcutEditor.jsx` - Custom shortcut recording
- `frontend/src/utils/shortcuts.js` - Shared shortcut formatting
- `frontend/src/utils/tools.js` - Shared tool config
- `project_discovery.go` - Project scanning + frecency
- `quick_launch.go` - Favorites persistence

---

### UX Improvements

**Session Selector Enhancements:**
- [ ] Show session preview on hover
- [ ] Filter by status (running/idle/waiting)
- [ ] Sort options (recent, name, status)
- [ ] Keyboard navigation (arrows, Enter)
- [ ] Search/filter sessions inline

**Terminal View:**
- [ ] Status bar (show session name, tool, status)
- [ ] Split pane support (future)
- [ ] Tabs for multiple terminals (future)
- [ ] Better loading states (progress bar)

**Visual Polish:**
- [ ] Smooth animations (fade in/out, slide)
- [ ] Better loading indicators
- [ ] Error messages with actions
- [ ] Tooltips on buttons
- [ ] Keyboard shortcut hints in UI

**Tool Icons:**
- [x] Change shell icon from `$` to `>` (right caret) - more common representation
- [x] Replace Claude `C` icon with Anthropic's official Claude logo
- [ ] Consider official logos for Gemini and OpenCode as well

---

## v0.3.0 - Remote Sessions
**Priority:** High
**Goal:** Support remote Agent Deck sessions via SSH

### Features
- [ ] Enable remote session selection
- [ ] SSH connection management
- [ ] Remote scrollback loading
- [ ] Connection status indicator
- [ ] Reconnect on disconnect

### Challenges
- SSH authentication (keys, agents)
- Network latency handling
- Scrollback performance over network
- Error handling for connection issues

---

## v0.4.0 - Session Management
**Priority:** Medium
**Goal:** Full session lifecycle from desktop app

### Features
- [ ] Create new Agent Deck session (with project picker)
- [ ] Delete sessions
- [ ] Rename sessions
- [ ] Move sessions between groups
- [ ] Duplicate/fork sessions (Claude only)
- [ ] Session metadata editing

---

## v0.5.0 - MCP Management
**Priority:** Medium
**Goal:** Manage MCPs without touching config files

### Features
- [ ] View attached MCPs for session
- [ ] Attach/detach MCPs (modal dialog)
- [ ] MCP status indicators
- [ ] MCP server configuration
- [ ] Test MCP connection

---

## v0.6.0 - Advanced Terminal Features
**Priority:** Low (Nice to have)

### Features
- [ ] Split panes (horizontal/vertical)
- [ ] Tabs for multiple terminals
- [ ] Terminal profiles (color schemes, fonts)
- [ ] Ligature support
- [ ] GPU acceleration
- [ ] Custom key bindings
- [ ] Copy/paste improvements
- [ ] URL click handling improvements

---

## v0.7.0 - Performance & Polish
**Priority:** Medium (After core features)

### Features
- [ ] Reduce memory usage
- [ ] Optimize scrollback rendering
- [ ] Lazy load session list
- [ ] Virtual scrolling for large outputs
- [ ] Debounced search
- [ ] Better resize handling (no jitter)

---

## v0.8.0 - Integrations
**Priority:** Low (Future exploration)

### Features
- [ ] GitHub integration (PR status in session list)
- [ ] Linear integration (issue status)
- [ ] Slack notifications for session events
- [ ] Export session logs
- [ ] Session recording/playback

---

## Backlog / Ideas

**Not prioritized - needs validation:**

- Global hotkey to show/hide app (Cmd+Shift+Space)
- System tray icon with quick session access
- Auto-attach to last session on startup
- Session templates (pre-configured setups)
- Collaborative sessions (shared tmux)
- AI assistant integration (Claude in sidebar)
- Session analytics (time spent, commands run)
- Backup/restore session configs
- Custom shell integration (session-aware prompt)

---

## Release Schedule (Tentative)

Assuming prototype validates:

- **v0.1.0** - Prototype (current)
- **v0.2.0** - Command Palette (2-3 weeks)
- **v0.3.0** - Remote Sessions (3-4 weeks)
- **v0.4.0** - Session Management (2-3 weeks)
- **v0.5.0** - MCP Management (2 weeks)
- **v0.6.0+** - TBD based on feedback

---

## Decision Log

**Why Wails over Electron?**
- Smaller binary size (~5MB vs ~150MB)
- Native performance (Go backend)
- Better terminal integration
- Faster startup time

**Why xterm.js?**
- Industry standard (VSCode, Hyper, etc.)
- Excellent addon ecosystem
- Active development
- Full ANSI/VT support

**Why not native macOS app?**
- Cross-platform potential (Linux, Windows)
- Web tech for UI is faster to iterate
- Easier to find contributors

**Why tmux integration vs direct shell?**
- Session persistence
- Leverage existing Agent Deck infrastructure
- Familiar to power users
- Window management (future splits)

### Click-to-cursor (experimental - ABANDONED)
- Position cursor with mouse click in terminal
- Works by sending arrow key sequences based on click position vs cursor position
- Guards: only at Claude Code prompts, normal buffer (not vim/nano), at bottom of scrollback
