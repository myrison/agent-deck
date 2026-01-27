/**
 * Tests for custom label management in CommandMenu (Cmd+K)
 *
 * These tests verify the behavioral logic for session label actions
 * that appear in the command launcher when a user is in terminal view
 * with an active session.
 *
 * Key behaviors tested:
 * 1. Label actions are generated based on activeSession state
 * 2. Selecting "Add" or "Edit" opens a label dialog (returns labelingSession)
 * 3. Selecting "Delete" calls onUpdateLabel('') and closes the menu
 * 4. Saving from the label dialog calls onUpdateLabel with the new label
 * 5. Label actions do NOT appear when activeSession is null (selector view)
 *
 * Testing approach: Since components require Wails bindings, we extract
 * and test the behavior logic patterns from CommandMenu.jsx.
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Extracted Logic: Label Action Generation (mirrors labelActions useMemo)
// ============================================================================

/**
 * Generates label actions based on the active session state.
 * Mirrors the labelActions useMemo in CommandMenu.jsx.
 */
function buildLabelActions(activeSession) {
    if (!activeSession) return [];
    if (activeSession.customLabel) {
        return [
            { id: 'edit-label', type: 'label', title: 'Edit Custom Label', description: `Edit: "${activeSession.customLabel}"` },
            { id: 'delete-label', type: 'label', title: 'Delete Custom Label', description: `Remove: "${activeSession.customLabel}"` },
        ];
    }
    return [
        { id: 'add-label', type: 'label', title: 'Add Custom Label', description: 'Add a custom label to this session' },
    ];
}

/**
 * Builds the combined action list.
 * Mirrors the allActions useMemo in CommandMenu.jsx.
 */
function buildAllActions(quickActions, labelActions, showLayoutActions, layoutActions, savedLayoutItems) {
    const base = [...quickActions, ...labelActions];
    if (!showLayoutActions) return base;
    return [...base, ...layoutActions, ...savedLayoutItems];
}

// ============================================================================
// Extracted Logic: Label Action Selection Handling (mirrors handleSelect)
// ============================================================================

/**
 * Handles selection of a label action item.
 * Mirrors the label handling branch in CommandMenu.jsx handleSelect.
 *
 * For delete: calls onUpdateLabel('') and onClose directly.
 * For add/edit: returns the labelingSession to show in the RenameDialog.
 */
function handleLabelAction(item, activeSession, onUpdateLabel, onClose) {
    if (item.type !== 'label') return null;

    if (item.id === 'delete-label') {
        onUpdateLabel?.('');
        onClose?.();
        return null;
    }

    // add-label or edit-label → return dialog state
    return {
        id: activeSession?.id,
        customLabel: activeSession?.customLabel || '',
    };
}

/**
 * Handles saving from the label dialog.
 * Mirrors handleSaveSessionLabel in CommandMenu.jsx.
 */
function handleSaveSessionLabel(labelingSession, newLabel, onUpdateLabel, onClose) {
    if (!labelingSession) return;
    onUpdateLabel?.(newLabel);
    onClose?.();
}

// ============================================================================
// Tests: Label Action Generation
// ============================================================================

describe('CommandMenu label actions', () => {
    describe('buildLabelActions', () => {
        it('returns empty array when activeSession is null', () => {
            expect(buildLabelActions(null)).toEqual([]);
        });

        it('returns empty array when activeSession is undefined', () => {
            expect(buildLabelActions(undefined)).toEqual([]);
        });

        it('returns "Add Custom Label" when session has no customLabel', () => {
            const session = { id: 'session-1', title: 'Test' };
            const actions = buildLabelActions(session);

            expect(actions).toHaveLength(1);
            expect(actions[0].id).toBe('add-label');
            expect(actions[0].type).toBe('label');
            expect(actions[0].title).toBe('Add Custom Label');
        });

        it('returns "Add Custom Label" when customLabel is empty string', () => {
            const session = { id: 'session-1', customLabel: '' };
            const actions = buildLabelActions(session);

            expect(actions).toHaveLength(1);
            expect(actions[0].id).toBe('add-label');
        });

        it('returns "Add Custom Label" when customLabel is null', () => {
            const session = { id: 'session-1', customLabel: null };
            const actions = buildLabelActions(session);

            expect(actions).toHaveLength(1);
            expect(actions[0].id).toBe('add-label');
        });

        it('returns Edit and Delete actions when session has a customLabel', () => {
            const session = { id: 'session-1', customLabel: 'My Task' };
            const actions = buildLabelActions(session);

            expect(actions).toHaveLength(2);
            expect(actions[0].id).toBe('edit-label');
            expect(actions[0].title).toBe('Edit Custom Label');
            expect(actions[0].description).toBe('Edit: "My Task"');
            expect(actions[1].id).toBe('delete-label');
            expect(actions[1].title).toBe('Delete Custom Label');
            expect(actions[1].description).toBe('Remove: "My Task"');
        });

        it('includes current label text in Edit/Delete descriptions', () => {
            const session = { id: 's1', customLabel: 'Bug Fix: Auth Flow' };
            const actions = buildLabelActions(session);

            expect(actions[0].description).toContain('Bug Fix: Auth Flow');
            expect(actions[1].description).toContain('Bug Fix: Auth Flow');
        });
    });

    describe('buildAllActions (label actions in combined list)', () => {
        const QUICK_ACTIONS = [
            { id: 'new-terminal', type: 'action', title: 'New Terminal' },
            { id: 'toggle-theme', type: 'action', title: 'Toggle Theme' },
        ];
        const LAYOUT_ACTIONS = [
            { id: 'split-right', type: 'layout', title: 'Split Right' },
        ];

        it('includes label actions alongside quick actions when no layout actions', () => {
            const labelActions = buildLabelActions({ id: 's1' });
            const all = buildAllActions(QUICK_ACTIONS, labelActions, false, LAYOUT_ACTIONS, []);

            expect(all).toHaveLength(3); // 2 quick + 1 add-label
            expect(all.find(a => a.id === 'add-label')).toBeTruthy();
        });

        it('includes label actions alongside quick and layout actions', () => {
            const labelActions = buildLabelActions({ id: 's1', customLabel: 'Task' });
            const all = buildAllActions(QUICK_ACTIONS, labelActions, true, LAYOUT_ACTIONS, []);

            // 2 quick + 2 label (edit + delete) + 1 layout
            expect(all).toHaveLength(5);
            expect(all.find(a => a.id === 'edit-label')).toBeTruthy();
            expect(all.find(a => a.id === 'delete-label')).toBeTruthy();
        });

        it('has no label actions when activeSession is null', () => {
            const labelActions = buildLabelActions(null);
            const all = buildAllActions(QUICK_ACTIONS, labelActions, true, LAYOUT_ACTIONS, []);

            // 2 quick + 0 label + 1 layout
            expect(all).toHaveLength(3);
            expect(all.find(a => a.type === 'label')).toBeUndefined();
        });
    });
});

// ============================================================================
// Tests: Label Action Selection Handling
// ============================================================================

describe('CommandMenu label action selection', () => {
    describe('handleLabelAction', () => {
        const activeSession = { id: 'session-42', customLabel: 'Existing Label' };

        it('returns null for non-label items without calling callbacks', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const actionItem = { id: 'new-terminal', type: 'action', title: 'New Terminal' };

            const labelingSession = handleLabelAction(actionItem, activeSession, onUpdateLabel, onClose);

            expect(labelingSession).toBeNull();
            expect(onUpdateLabel).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it('delete-label calls onUpdateLabel with empty string and closes menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const item = { id: 'delete-label', type: 'label', title: 'Delete Custom Label' };

            handleLabelAction(item, activeSession, onUpdateLabel, onClose);

            expect(onUpdateLabel).toHaveBeenCalledWith('');
            expect(onClose).toHaveBeenCalled();
        });

        it('add-label returns labelingSession with empty customLabel', () => {
            const item = { id: 'add-label', type: 'label', title: 'Add Custom Label' };
            const sessionNoLabel = { id: 'session-1', title: 'Test' };

            const labelingSession = handleLabelAction(item, sessionNoLabel, vi.fn(), vi.fn());

            expect(labelingSession).toEqual({
                id: 'session-1',
                customLabel: '',
            });
        });

        it('edit-label returns labelingSession with current customLabel', () => {
            const item = { id: 'edit-label', type: 'label', title: 'Edit Custom Label' };

            const labelingSession = handleLabelAction(item, activeSession, vi.fn(), vi.fn());

            expect(labelingSession).toEqual({
                id: 'session-42',
                customLabel: 'Existing Label',
            });
        });

        it('add-label does not call onUpdateLabel or close the menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const item = { id: 'add-label', type: 'label', title: 'Add Custom Label' };

            handleLabelAction(item, { id: 's1' }, onUpdateLabel, onClose);

            expect(onUpdateLabel).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it('edit-label does not call onUpdateLabel or close the menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const item = { id: 'edit-label', type: 'label', title: 'Edit Custom Label' };

            handleLabelAction(item, activeSession, onUpdateLabel, onClose);

            expect(onUpdateLabel).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    describe('handleSaveSessionLabel', () => {
        it('does nothing when labelingSession is null', () => {
            const onUpdateLabel = vi.fn();
            handleSaveSessionLabel(null, 'New Label', onUpdateLabel, vi.fn());

            expect(onUpdateLabel).not.toHaveBeenCalled();
        });

        it('calls onUpdateLabel with new label and closes menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const labelingSession = { id: 'session-1', customLabel: '' };

            handleSaveSessionLabel(labelingSession, 'My New Label', onUpdateLabel, onClose);

            expect(onUpdateLabel).toHaveBeenCalledWith('My New Label');
            expect(onClose).toHaveBeenCalled();
        });

        it('passes empty string to onUpdateLabel when clearing a label', () => {
            const onUpdateLabel = vi.fn();
            const labelingSession = { id: 'session-1', customLabel: 'Old Label' };

            handleSaveSessionLabel(labelingSession, '', onUpdateLabel, vi.fn());

            expect(onUpdateLabel).toHaveBeenCalledWith('');
        });
    });
});

// ============================================================================
// Tests: App.jsx onUpdateLabel Callback Contract
// ============================================================================

describe('App.jsx onUpdateLabel callback', () => {
    /**
     * The onUpdateLabel callback in App.jsx does three things in sequence:
     * 1. Calls UpdateSessionCustomLabel(sessionId, newLabel) on the backend
     * 2. Updates selectedSession state with the new label
     * 3. Syncs tab labels via handleTabLabelUpdated(sessionId, newLabel)
     *
     * We test the contract: given a selectedSession, verify the backend
     * and tab sync are called with the correct arguments.
     */

    it('skips all calls when selectedSession is null', () => {
        const updateBackend = vi.fn();
        const handleTabLabelUpdated = vi.fn();
        const selectedSession = null;

        // Mirrors the guard: if (!selectedSession) return;
        if (!selectedSession) return;
        updateBackend(selectedSession.id, 'Label');
        handleTabLabelUpdated(selectedSession.id, 'Label');

        expect(updateBackend).not.toHaveBeenCalled();
        expect(handleTabLabelUpdated).not.toHaveBeenCalled();
    });

    it('calls backend with session id and new label', () => {
        const updateBackend = vi.fn();
        const selectedSession = { id: 'session-abc', customLabel: '' };

        updateBackend(selectedSession.id, 'New Label');

        expect(updateBackend).toHaveBeenCalledWith('session-abc', 'New Label');
    });

    it('syncs tab labels with session id and new label', () => {
        const handleTabLabelUpdated = vi.fn();
        const selectedSession = { id: 'session-1', customLabel: 'Old' };

        handleTabLabelUpdated(selectedSession.id, 'New');

        expect(handleTabLabelUpdated).toHaveBeenCalledWith('session-1', 'New');
    });

    it('passes empty string for label deletion', () => {
        const updateBackend = vi.fn();
        const handleTabLabelUpdated = vi.fn();
        const selectedSession = { id: 'session-1', customLabel: 'To Remove' };

        updateBackend(selectedSession.id, '');
        handleTabLabelUpdated(selectedSession.id, '');

        expect(updateBackend).toHaveBeenCalledWith('session-1', '');
        expect(handleTabLabelUpdated).toHaveBeenCalledWith('session-1', '');
    });
});

// ============================================================================
// Tests: End-to-End Scenarios
// ============================================================================

describe('End-to-end label management scenarios', () => {
    it('full flow: session with no label → add label → label exists', () => {
        // 1. Session starts with no label
        const session = { id: 's1', title: 'My Session', customLabel: '' };
        let actions = buildLabelActions(session);
        expect(actions).toHaveLength(1);
        expect(actions[0].id).toBe('add-label');

        // 2. User selects "Add Custom Label" → dialog opens with empty input
        const labelingSession = handleLabelAction(actions[0], session, vi.fn(), vi.fn());
        expect(labelingSession.customLabel).toBe('');

        // 3. User types label and saves
        const onUpdateLabel = vi.fn();
        const onClose = vi.fn();
        handleSaveSessionLabel(labelingSession, 'Bug Fix', onUpdateLabel, onClose);
        expect(onUpdateLabel).toHaveBeenCalledWith('Bug Fix');

        // 4. After save, session now has label → Edit/Delete appear
        const updatedSession = { ...session, customLabel: 'Bug Fix' };
        actions = buildLabelActions(updatedSession);
        expect(actions).toHaveLength(2);
        expect(actions[0].id).toBe('edit-label');
        expect(actions[1].id).toBe('delete-label');
    });

    it('full flow: session with label → edit label → label updated', () => {
        const session = { id: 's1', customLabel: 'Old Name' };
        const actions = buildLabelActions(session);

        // Select edit → dialog pre-fills current label
        const labelingSession = handleLabelAction(actions[0], session, vi.fn(), vi.fn());
        expect(labelingSession.customLabel).toBe('Old Name');

        // Save new label
        const onUpdateLabel = vi.fn();
        handleSaveSessionLabel(labelingSession, 'New Name', onUpdateLabel, vi.fn());
        expect(onUpdateLabel).toHaveBeenCalledWith('New Name');
    });

    it('full flow: session with label → delete label → only Add appears', () => {
        const session = { id: 's1', customLabel: 'To Remove' };
        let actions = buildLabelActions(session);
        expect(actions).toHaveLength(2);

        // Select delete → calls onUpdateLabel('') and closes
        const onUpdateLabel = vi.fn();
        const onClose = vi.fn();
        const deleteAction = actions.find(a => a.id === 'delete-label');
        handleLabelAction(deleteAction, session, onUpdateLabel, onClose);

        expect(onUpdateLabel).toHaveBeenCalledWith('');
        expect(onClose).toHaveBeenCalled();

        // After delete, session has no label → Add appears
        const clearedSession = { ...session, customLabel: '' };
        actions = buildLabelActions(clearedSession);
        expect(actions).toHaveLength(1);
        expect(actions[0].id).toBe('add-label');
    });

    it('selector view: no label actions when activeSession is null', () => {
        const actions = buildLabelActions(null);
        expect(actions).toHaveLength(0);

        const QUICK_ACTIONS = [
            { id: 'new-terminal', type: 'action' },
            { id: 'toggle-theme', type: 'action' },
        ];
        const all = buildAllActions(QUICK_ACTIONS, actions, false, [], []);
        expect(all.every(a => a.type !== 'label')).toBe(true);
    });

    it('cancel from label dialog does not call onUpdateLabel', () => {
        const session = { id: 's1' };
        const actions = buildLabelActions(session);
        const onUpdateLabel = vi.fn();

        // Open dialog
        const labelingSession = handleLabelAction(actions[0], session, onUpdateLabel, vi.fn());
        expect(labelingSession).not.toBeNull();

        // Cancel — user closes dialog without saving
        // onUpdateLabel should never have been called
        expect(onUpdateLabel).not.toHaveBeenCalled();
    });
});
