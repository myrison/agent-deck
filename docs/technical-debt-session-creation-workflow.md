# Technical Debt: Session Creation Workflow

**Created:** 2026-01-26
**Status:** Open
**Component:** Desktop App - Session Creation Flow

## Overview

The session creation workflow in the desktop app has several inconsistencies and UX issues that should be addressed. The core problem is that multiple entry points into session creation have different behaviors, and tool selection is often bypassed with a hardcoded default of "claude".

---

## Critical Issues

### 1. SessionPicker "New Session" always creates Claude sessions

**Location:** `cmd/agent-deck-desktop/frontend/src/App.jsx:1012`

```javascript
const tool = 'claude'; // Default tool for session picker (could be made configurable later)
```

**Problem:** If a user has a project with 3 Gemini sessions, clicks "New Session" in SessionPicker, they get a Claude session. This breaks user expectations - they likely want another session of the same type.

**Suggested Fix:** Either:
- Infer tool from existing sessions (if all same tool, use that)
- Show ToolPicker after "New Session" is selected
- Add tool indicator to the "New Session" option

---

### 2. Cmd+N (newSessionMode) skips tool selection entirely

**Location:** `cmd/agent-deck-desktop/frontend/src/CommandMenu.jsx:291-294`

```javascript
} else {
    // No sessions - launch new project with default tool (Claude)
    onLaunchProject?.(item.projectPath, item.title, 'claude');
}
```

**Problem:** When user presses Cmd+N to create a new session for a project with NO existing sessions, it auto-launches Claude. The user never gets to pick which tool (Claude/Gemini/OpenCode) they want.

**Suggested Fix:** Cmd+N should route through ToolPicker before creating the session, consistent with Cmd+Enter behavior.

---

### 3. Shift+Enter (label mode) also hardcodes Claude

**Location:** `cmd/agent-deck-desktop/frontend/src/CommandMenu.jsx:317`

```javascript
onLaunchProject?.(labelingProject.path, labelingProject.name, 'claude', '', customLabel);
```

**Problem:** Same issue - user can't choose tool when using Shift+Enter for labeled sessions.

**Suggested Fix:** After entering label, show ToolPicker, or allow Cmd+Enter from label dialog to access ToolPicker.

---

## Moderate Issues

### 4. newSessionMode inconsistent behavior based on existing session count

**Current Behavior:**
- 0 sessions → launches Claude immediately (no picker, no tool choice)
- 1+ sessions → shows SessionPicker (can create new OR attach to existing)

**Problem:** The mode is called "new session" but sometimes it lets you attach to existing sessions. This is inconsistent.

**Suggested Fix:** Consider renaming or clarifying the mode. Options:
- Always show SessionPicker with "New Session" pre-selected
- Always go to ToolPicker first, then create session
- Rename to "Open/Create Session" to be more accurate

---

### 5. SessionPicker doesn't indicate which tool will be used

**Location:** `cmd/agent-deck-desktop/frontend/src/SessionPicker.jsx:222-235`

**Problem:** The "New Session" button shows `+ New Session` with hint `⌘↵ to add label`. It doesn't tell the user what tool will be used or that they have no choice.

**Suggested Fix:** Show tool icon/name, e.g., "+ New Claude Session" or add tool selector inline.

---

### 6. No way to access ToolPicker from SessionPicker

**Problem:** Once you're in SessionPicker, if you want to create a new session with a different tool, you have to:
1. Cancel SessionPicker
2. Cmd+Enter on the project to get to ToolPicker

The flows are disconnected.

**Suggested Fix:** Add Cmd+Enter hint/handler in SessionPicker's "New Session" option to open ToolPicker.

---

## Minor Issues

### 7. ConfigPicker "Cancel" label is misleading

**Location:** `cmd/agent-deck-desktop/frontend/src/ConfigPicker.jsx:156`

**Problem:** The footer says `<kbd>Esc</kbd> Cancel` but Escape actually returns to ToolPicker (good UX, misleading hint).

**Suggested Fix:** Change hint to "Back" or "← Back".

---

### 8. Custom label not supported for remote sessions

**Location:** `cmd/agent-deck-desktop/frontend/src/App.jsx:1026-1028`

```javascript
if (customLabel) {
    logger.warn('Custom label not applied to remote session (not implemented)');
}
```

**Problem:** Silent failure - user enters a label but it's ignored for remote sessions.

**Suggested Fix:** Either implement custom labels for remote sessions or disable the option in the UI when creating remote sessions.

---

### 9. Empty pane flow always creates new tab

**Location:** `cmd/agent-deck-desktop/frontend/src/App.jsx:1965-1968`

```javascript
onLaunchProject={(path, name, tool, config, label) => {
    // If we have an active empty pane, launch into it
    // For now, use the default behavior (creates new tab)
    handleLaunchProject(path, name, tool, config, label);
}}
```

**Problem:** When user has split panes with an empty pane focused, launching a new session creates a new tab instead of filling the empty pane.

**Suggested Fix:** Check if active pane is empty and use `handleAssignSessionToPane` for the new session.

---

## Session Creation Entry Points Summary

| Entry Point | Current Behavior | Tool Choice? | Issues |
|-------------|------------------|--------------|--------|
| Cmd+K → project (0 sessions) | Launch Claude | No | #2 |
| Cmd+K → project (1 session) | Attach to session | N/A | None |
| Cmd+K → project (2+ sessions) | Show SessionPicker | No | #1, #5, #6 |
| Cmd+Enter → project | Show ToolPicker | Yes | None |
| Cmd+N → project (0 sessions) | Launch Claude | No | #2, #4 |
| Cmd+N → project (1+ sessions) | Show SessionPicker | No | #1, #4, #5 |
| Shift+Enter → project | Label → Launch Claude | No | #3 |
| SessionPicker → New Session | Launch Claude | No | #1, #5, #6 |
| ToolPicker → Cmd+Enter | Show ConfigPicker | Yes | None |

---

## Proposed Unified Flow

```
User selects project
    ├── Has existing sessions?
    │   ├── Yes → Show SessionPicker
    │   │         ├── Select existing → Attach
    │   │         └── New Session → ToolPicker → ConfigPicker (optional) → Launch
    │   └── No → ToolPicker → ConfigPicker (optional) → Launch
    │
    └── Cmd+Enter shortcut at any point → Jump to ToolPicker
```

This would make tool selection consistent across all entry points while still allowing quick access to existing sessions.
