# Multi-Session Same-Directory Support - Implementation Plan

## Overview

Enable multiple Claude sessions in the same directory with clear labeling to distinguish them. Users can work on multiple things at once (bug fixes, features, exploration) with separate agents in the same project.

## Worktree

**Execute all changes in the worktree:**
```
Path: /Users/jason/Documents/Seafile/My Library/HyperCurrent/gitclone/agent-deck-multi-session-planning
Branch: feature/multi-session-same-dir
```

## Key Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Session list grouping | None for MVP - labels differentiate sessions |
| Launcher behavior | Inline sub-menu when project has existing sessions |
| Auto-label format | `#1`, `#2`, `#3` |
| Custom label input | Cmd+Enter on "New session" option in sub-menu |
| Tab bar display | Abbreviated path + label (e.g., `proj [bugfix]`) |
| Scope | Desktop app only (TUI continues to work, just less polished) |

## Architecture Summary

**Good news**: Backend already supports multiple sessions per directory:
- `countSessionsAtPath()` exists in tmux.go (lines 165-192)
- `CreateSession()` auto-generates `#N` labels when count > 0 (line 808)
- `customLabel` field exists on SessionInfo

**Changes needed are primarily UI-level in the desktop app.**

### Remote Session Support

Remote sessions are **already fully supported** by the existing backend:
- `CreateRemoteSession()` (lines 838-937) uses same `countSessionsAtPath()` for auto-labeling
- `customLabel` field works identically for local and remote sessions
- `UpdateSessionCustomLabel()` handles both local and remote sessions

**Key consideration**: `countSessionsAtPath()` counts ALL sessions (local + remote) at a given path. If `/home/user/project` exists locally AND on a remote host, both count toward the same sequence. This is acceptable behavior - the path is the grouping key regardless of host.

**SessionPicker must distinguish local vs remote**:
- Show host badge (e.g., "local" vs "dev-server") next to each session
- Use existing `isRemote` and `remoteHostDisplayName` fields from SessionInfo

---

## Implementation Tasks

### Task 1: Modify ProjectDiscovery to Return Session Details

**File**: `cmd/agent-deck-desktop/project_discovery.go`

**Current behavior** (lines 187-235):
- `ProjectInfo.HasSession` is a boolean
- `ProjectInfo.SessionID` stores single session ID
- Projects with sessions are included but CommandMenu filters them out

**Changes**:
1. Add `SessionCount int` field to `ProjectInfo`
2. Add `Sessions []SessionSummary` field (ID, CustomLabel, Status, Tool)
3. Modify `DiscoverProjects()` to collect ALL sessions per path, not just first

```go
type SessionSummary struct {
    ID                    string `json:"id"`
    CustomLabel           string `json:"customLabel,omitempty"`
    Status                string `json:"status"`
    Tool                  string `json:"tool"`
    IsRemote              bool   `json:"isRemote,omitempty"`
    RemoteHost            string `json:"remoteHost,omitempty"`
    RemoteHostDisplayName string `json:"remoteHostDisplayName,omitempty"`
}

type ProjectInfo struct {
    // ... existing fields
    SessionCount int              `json:"sessionCount"`
    Sessions     []SessionSummary `json:"sessions,omitempty"`
}
```

**Unit Tests Required**: `project_discovery_test.go`
- Test `DiscoverProjects()` returns correct `SessionCount` for paths with 0, 1, 2+ sessions
- Test `Sessions` slice contains correct summaries with all fields populated
- Test mixed local/remote sessions at same path are both included
- Test session status is correctly propagated

**Testable Acceptance Criteria**:
- [ ] `SessionCount` equals actual number of sessions at path
- [ ] `Sessions` slice contains ID, CustomLabel, Status, Tool for each session
- [ ] Remote sessions include `IsRemote=true` and `RemoteHostDisplayName`
- [ ] Existing `HasSession` behavior unchanged for backwards compatibility

---

### Task 2: Create SessionPicker Component

**New file**: `cmd/agent-deck-desktop/frontend/src/SessionPicker.jsx`

**Pattern**: Mirror `ToolPicker.jsx` (lines 1-112)

**Props**:
```javascript
{
    projectPath: string,
    projectName: string,
    sessions: SessionSummary[],  // existing sessions
    onSelectSession: (sessionId) => void,
    onCreateNew: (customLabel?) => void,  // null = auto-label
    onCancel: () => void,
}
```

**UI Structure** (with remote session support):
```
┌─────────────────────────────────────┐
│ my-project                      ← X │
├─────────────────────────────────────┤
│ Existing Sessions                   │
│  ○ [bugfix] - waiting    local ↵    │
│  ○ [#2] - running    dev-srv   ↵    │  ← remote badge
├─────────────────────────────────────┤
│ + New Session                  ↵    │
│   (⌘↵ to add label)                 │
└─────────────────────────────────────┘
```

**Keyboard handling**:
- `↑/↓` - navigate
- `Enter` - select session or create new (auto-label)
- `Cmd+Enter` on "New Session" - prompt for custom label
- `Escape` - close

**Unit Tests Required**: `SessionPicker.test.jsx`
- Test renders with 0 sessions (just "New Session" option)
- Test renders session list with correct labels and status indicators
- Test keyboard navigation cycles through all options
- Test Enter on session calls `onSelectSession` with correct ID
- Test Enter on "New Session" calls `onCreateNew` with null/undefined
- Test Cmd+Enter on "New Session" shows label input
- Test Escape calls `onCancel`
- Test remote sessions show host badge
- Test mixed local/remote sessions render correctly

**Testable Acceptance Criteria**:
- [ ] Modal appears when triggered, closes on Escape
- [ ] All existing sessions listed with label, status, and host badge
- [ ] Keyboard navigation works (↑/↓ cycles, Enter selects)
- [ ] Selecting session opens that session in tab
- [ ] "New Session" + Enter creates session with auto-label
- [ ] "New Session" + Cmd+Enter prompts for custom label input
- [ ] Remote sessions show `remoteHostDisplayName` badge

---

### Task 3: Modify CommandMenu to Show Projects WITH Sessions

**File**: `cmd/agent-deck-desktop/frontend/src/CommandMenu.jsx`

**Current behavior** (line 75):
```javascript
.filter(p => !p.hasSession) // Only show projects WITHOUT existing sessions
```

**Changes**:
1. Remove the filter - show ALL projects
2. Add visual indicator for projects with sessions (badge showing count)
3. On Enter for project WITH sessions → trigger SessionPicker
4. On Enter for project WITHOUT sessions → launch directly (current behavior)

**Modified rendering** (around line 332):
```javascript
{item.type === 'project' ? (
    <>
        <span className="menu-project-icon">
            {item.sessionCount > 0 ? `${item.sessionCount}` : '+'}
        </span>
        {/* ... rest of rendering */}
        {item.sessionCount > 0 && (
            <span className="menu-session-count">{item.sessionCount} session(s)</span>
        )}
    </>
) : /* ... */}
```

**Modified selection handler**:
```javascript
} else if (item.type === 'project') {
    if (item.sessionCount > 0) {
        // Has sessions - show picker
        onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
    } else {
        // No sessions - launch directly
        onLaunchProject?.(item.projectPath, item.title, 'claude');
    }
}
```

**Unit Tests Required**: `CommandMenu.test.jsx` (extend existing)
- Test projects with sessions are NOT filtered out
- Test project with `sessionCount > 0` shows count badge
- Test project with `sessionCount === 0` shows `+` icon
- Test Enter on project with sessions calls `onShowSessionPicker`
- Test Enter on project without sessions calls `onLaunchProject` directly
- Test session count badge displays correct number

**Testable Acceptance Criteria**:
- [ ] Projects with existing sessions appear in search results
- [ ] Session count badge visible for projects with sessions
- [ ] Enter on project with sessions → SessionPicker opens
- [ ] Enter on project without sessions → session created directly
- [ ] Existing Shift+Enter for custom label still works on new projects

---

### Task 4: Wire Up SessionPicker in App.jsx

**File**: `cmd/agent-deck-desktop/frontend/src/App.jsx`

**Add state** (around line 120):
```javascript
const [sessionPickerProject, setSessionPickerProject] = useState(null);
// { path, name, sessions }
```

**Add handler**:
```javascript
const handleShowSessionPicker = useCallback((projectPath, projectName, sessions) => {
    setSessionPickerProject({ path: projectPath, name: projectName, sessions });
}, []);

const handleSessionPickerSelect = useCallback((sessionId) => {
    // Find session and open it
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
        handleOpenTab(session);
    }
    setSessionPickerProject(null);
}, [sessions, handleOpenTab]);

const handleSessionPickerCreateNew = useCallback(async (customLabel) => {
    if (!sessionPickerProject) return;
    await handleLaunchProject(
        sessionPickerProject.path,
        sessionPickerProject.name,
        'claude',
        '',
        customLabel || ''  // empty = auto-generate
    );
    setSessionPickerProject(null);
}, [sessionPickerProject, handleLaunchProject]);
```

**Pass to CommandMenu**:
```javascript
<CommandMenu
    // ... existing props
    onShowSessionPicker={handleShowSessionPicker}
/>
```

**Render SessionPicker**:
```javascript
{sessionPickerProject && (
    <SessionPicker
        projectPath={sessionPickerProject.path}
        projectName={sessionPickerProject.name}
        sessions={sessionPickerProject.sessions}
        onSelectSession={handleSessionPickerSelect}
        onCreateNew={handleSessionPickerCreateNew}
        onCancel={() => setSessionPickerProject(null)}
    />
)}
```

**Unit Tests Required**: `App.test.jsx` (extend existing)
- Test `handleShowSessionPicker` sets state correctly
- Test `handleSessionPickerSelect` finds session and opens tab
- Test `handleSessionPickerSelect` handles missing session gracefully
- Test `handleSessionPickerCreateNew` with custom label calls `handleLaunchProject`
- Test `handleSessionPickerCreateNew` with null/empty uses auto-label
- Test SessionPicker renders when `sessionPickerProject` is set
- Test SessionPicker closes when `onCancel` called

**Testable Acceptance Criteria**:
- [ ] SessionPicker opens when `onShowSessionPicker` called from CommandMenu
- [ ] Selecting existing session opens it in a new/existing tab
- [ ] Creating new session with label creates session with that label
- [ ] Creating new session without label uses auto-generated `#N` label
- [ ] SessionPicker closes after selection or cancel

---

### Task 5: Update Tab Display to Show Labels

**File**: `cmd/agent-deck-desktop/frontend/src/SessionTab.jsx`

**Current**: Tab shows `session.title` (project name)

**Change**: Show `title [label]` when label exists

```javascript
const displayTitle = session.customLabel
    ? `${abbreviatedPath} [${session.customLabel}]`
    : abbreviatedPath;
```

**Unit Tests Required**: `SessionTab.test.jsx`
- Test tab without label shows abbreviated path only
- Test tab with label shows `path [label]` format
- Test very long labels are truncated appropriately
- Test special characters in labels render correctly

**Testable Acceptance Criteria**:
- [ ] Tab without label: shows `my-project`
- [ ] Tab with label: shows `my-project [bugfix]`
- [ ] Multiple tabs with same path but different labels are distinguishable
- [ ] Label truncation works for labels > 20 chars

---

### Task 6: Add CSS for New Components

**Files**:
- `cmd/agent-deck-desktop/frontend/src/SessionPicker.css` (new)
- `cmd/agent-deck-desktop/frontend/src/CommandMenu.css` (modify)

**SessionPicker.css**: Mirror ToolPicker.css structure

**CommandMenu.css additions**:
```css
.menu-session-count {
    font-size: 11px;
    color: var(--text-muted);
    margin-left: 8px;
}

.menu-project-icon.has-sessions {
    background: var(--accent-subtle);
    border-radius: 4px;
}
```

**Testable Acceptance Criteria**:
- [ ] SessionPicker modal styled consistently with ToolPicker
- [ ] Session count badge visible and readable in both light/dark themes
- [ ] Host badge for remote sessions has distinct styling
- [ ] Focus states visible for keyboard navigation

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `project_discovery.go` | Modify | Add SessionCount, Sessions fields |
| `SessionPicker.jsx` | Create | New component for session selection |
| `SessionPicker.css` | Create | Styles for SessionPicker |
| `CommandMenu.jsx` | Modify | Remove hasSession filter, add picker trigger |
| `CommandMenu.css` | Modify | Add session count badge styles |
| `App.jsx` | Modify | Add SessionPicker state and handlers |
| `SessionTab.jsx` | Modify | Show label in tab title |

---

## Verification Plan

### Unit Test Summary

| File | Tests Required |
|------|----------------|
| `project_discovery_test.go` | SessionCount, Sessions slice, remote sessions |
| `SessionPicker.test.jsx` | Rendering, keyboard nav, selection callbacks |
| `CommandMenu.test.jsx` | Session count display, picker trigger logic |
| `App.test.jsx` | SessionPicker state management, handlers |
| `SessionTab.test.jsx` | Label display formatting |

**Run all tests**: `cd cmd/agent-deck-desktop && go test ./... && cd frontend && npm test`

### Manual Testing Checklist

#### Local Sessions
1. **Session creation with auto-label**:
   - [ ] Create first session in a directory → no label
   - [ ] Create second session in same directory → should get `#2`
   - [ ] Create third → should get `#3`

2. **CommandMenu behavior**:
   - [ ] Search for project with no sessions → shows `+` icon, Enter launches directly
   - [ ] Search for project with sessions → shows count badge, Enter opens SessionPicker

3. **SessionPicker**:
   - [ ] Shows existing sessions with labels and status
   - [ ] Enter on session → opens that session
   - [ ] Enter on "New Session" → creates with auto-label
   - [ ] Cmd+Enter on "New Session" → prompts for custom label

4. **Tab display**:
   - [ ] Session without label → shows abbreviated path
   - [ ] Session with label → shows `path [label]`

5. **Label editing**:
   - [ ] Right-click session → Edit Custom Label still works
   - [ ] Can change `#2` to `bugfix` or any custom label

#### Remote Sessions
6. **Remote session creation**:
   - [ ] Create remote session on SSH host → no label (first)
   - [ ] Create second remote session on same host/path → should get `#2`

7. **SessionPicker with remote**:
   - [ ] Remote sessions show host badge (e.g., "dev-server")
   - [ ] Local sessions show "local" badge
   - [ ] Mixed local/remote at same path all appear in picker

8. **Cross-host labeling**:
   - [ ] Local `/home/user/proj` + remote `/home/user/proj` → separate sessions, counted together for `#N`

### Edge Cases

- [ ] Project with 10+ sessions (scrolling in picker works)
- [ ] Very long custom labels (truncation at ~20 chars)
- [ ] Special characters in labels (quotes, brackets, unicode)
- [ ] Session deleted while picker open (picker refreshes or handles gracefully)
- [ ] SSH host offline (remote sessions still show with status indicator)

### Smoke Test Script

```bash
# After implementation, run this sequence:
1. wails dev  # Start desktop app
2. Cmd+K → search for project without sessions → Enter → verify session created
3. Cmd+K → search for same project → verify picker shows with 1 session
4. Create new session via picker → verify #2 label
5. Check tab bar shows "project [#2]"
6. Right-click → Edit Label → change to "bugfix"
7. Verify tab shows "project [bugfix]"
8. Repeat steps 2-5 for remote session (if SSH configured)
```

---

## Future Enhancements (Not in MVP)

1. **Visual grouping in session list** - dividers or background tints for same-path sessions
2. **Contextual auto-labels** - detect git branch for initial label suggestion
3. **TUI parity** - implement same features in Bubble Tea TUI
4. **Bulk operations** - close all sessions in a directory
