/**
 * Tests for "Delete Session" action in Cmd+K command palette (PR #64)
 *
 * Key behaviors tested:
 * 1. Delete action description prefers customLabel over title
 * 2. Delete action description falls back to title when no customLabel
 * 3. Delete action handles empty-string customLabel as absent
 * 4. Full user flow: active session → delete action → dialog opens
 * 5. Selector view (no session) → delete action is absent
 *
 * Testing approach: Extracted logic pattern (mirrors useMemo/callback as
 * pure functions) — the project standard since component rendering requires
 * Wails bindings and the React plugin preamble fails in jsdom.
 * See also: commandMenuLabelActions.test.js, ModalKeyboardIsolation.test.js
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Extracted Logic (mirrors CommandMenu.jsx and App.jsx)
// ============================================================================

/** Mirrors deleteAction useMemo in CommandMenu.jsx */
function buildDeleteAction(activeSession) {
    if (!activeSession) return [];
    return [
        {
            id: 'delete-session',
            type: 'action',
            title: 'Delete Session',
            description: `Delete "${activeSession.customLabel || activeSession.title}"`,
        },
    ];
}

/** Mirrors allActions useMemo in CommandMenu.jsx */
function buildAllActions(quickActions, labelActions, deleteAction, showLayoutActions, layoutActions, savedLayoutItems) {
    const base = [...quickActions, ...labelActions, ...deleteAction];
    if (!showLayoutActions) return base;
    return [...base, ...layoutActions, ...savedLayoutItems];
}

/** Mirrors 'delete-session' case in App.jsx handlePaletteAction */
function handlePaletteAction(actionId, setShowDeleteDialog) {
    if (actionId === 'delete-session') {
        setShowDeleteDialog(true);
        return true;
    }
    return false;
}

// ============================================================================
// Tests: Description text reflects session identity correctly
// ============================================================================

describe('Delete session action description', () => {
    it('shows customLabel when session has one', () => {
        const session = { id: 's1', title: 'Project Name', customLabel: 'Bug Fix' };
        const [action] = buildDeleteAction(session);

        expect(action.description).toBe('Delete "Bug Fix"');
    });

    it('falls back to title when session has no customLabel', () => {
        const session = { id: 's1', title: 'My Agent Session' };
        const [action] = buildDeleteAction(session);

        expect(action.description).toBe('Delete "My Agent Session"');
    });

    it('treats empty-string customLabel as absent and uses title', () => {
        const session = { id: 's1', title: 'Fallback Title', customLabel: '' };
        const [action] = buildDeleteAction(session);

        expect(action.description).toBe('Delete "Fallback Title"');
    });
});

// ============================================================================
// Tests: End-to-End Scenarios
// ============================================================================

describe('Delete session from Cmd+K flow', () => {
    it('active session: generates delete action, appears in menu, dispatch opens dialog', () => {
        const session = { id: 'session-42', title: 'My Project', customLabel: 'Feature Work' };

        // Action is generated with session identity
        const deleteAction = buildDeleteAction(session);
        expect(deleteAction).toHaveLength(1);
        expect(deleteAction[0].description).toBe('Delete "Feature Work"');

        // Action appears in the combined action list
        const quickActions = [{ id: 'new-terminal', type: 'action' }];
        const allActions = buildAllActions(quickActions, [], deleteAction, false, [], []);
        expect(allActions.find(a => a.id === 'delete-session')).toBeTruthy();

        // Selecting the action opens the delete confirmation dialog
        const setShowDeleteDialog = vi.fn();
        handlePaletteAction('delete-session', setShowDeleteDialog);
        expect(setShowDeleteDialog).toHaveBeenCalledWith(true);
    });

    it('no active session (selector view): delete action is absent from menu', () => {
        const deleteAction = buildDeleteAction(null);
        expect(deleteAction).toHaveLength(0);

        const quickActions = [{ id: 'new-terminal', type: 'action' }];
        const allActions = buildAllActions(quickActions, [], deleteAction, false, [], []);
        expect(allActions.find(a => a.id === 'delete-session')).toBeUndefined();
    });
});
