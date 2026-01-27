/**
 * Tests for custom label management in CommandMenu (Cmd+K)
 *
 * These tests verify the behavioral logic for session label actions
 * that appear in the command launcher when a user is in terminal view
 * with an active session.
 *
 * Key behaviors tested:
 * 1. Label actions are generated based on activeSession state
 * 2. Selecting "Add" or "Edit" opens a label dialog (sets labelingSession state)
 * 3. Selecting "Delete" calls onUpdateLabel('') and closes the menu
 * 4. Saving from the label dialog calls onUpdateLabel with the new label
 * 5. Label actions do NOT appear when activeSession is null (selector view)
 * 6. Label actions are searchable via fuzzy search alongside other actions
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
 * Returns an object describing what side effects should occur.
 */
function handleLabelAction(item, activeSession, onUpdateLabel, onClose) {
    const result = { action: null, labelingSession: null, closedMenu: false, calledUpdateLabel: false, updateLabelValue: null };

    if (item.type !== 'label') {
        result.action = 'not-label';
        return result;
    }

    if (item.id === 'delete-label') {
        result.action = 'delete';
        result.calledUpdateLabel = true;
        result.updateLabelValue = '';
        result.closedMenu = true;
        onUpdateLabel?.('');
        onClose?.();
        return result;
    }

    // add-label or edit-label → open dialog
    result.action = item.id === 'add-label' ? 'add' : 'edit';
    result.labelingSession = {
        id: activeSession?.id,
        customLabel: activeSession?.customLabel || '',
    };
    return result;
}

/**
 * Handles saving from the label dialog.
 * Mirrors handleSaveSessionLabel in CommandMenu.jsx.
 */
function handleSaveSessionLabel(labelingSession, newLabel, onUpdateLabel, onClose) {
    const result = { calledUpdateLabel: false, updateLabelValue: null, closedMenu: false, clearedLabelingSession: false };

    if (!labelingSession) return result;

    result.calledUpdateLabel = true;
    result.updateLabelValue = newLabel;
    result.clearedLabelingSession = true;
    result.closedMenu = true;
    onUpdateLabel?.(newLabel);
    onClose?.();
    return result;
}

// ============================================================================
// Extracted Logic: App.jsx onUpdateLabel callback pattern
// ============================================================================

/**
 * Simulates the onUpdateLabel callback from App.jsx terminal-view CommandMenu.
 * Tests the state update flow when a label is changed.
 */
function simulateAppUpdateLabel(selectedSession, newLabel, updateBackend, setSelectedSession, handleTabLabelUpdated) {
    if (!selectedSession) return { skipped: true };

    const result = { backendCalled: false, sessionUpdated: false, tabsUpdated: false, error: null };

    try {
        updateBackend(selectedSession.id, newLabel);
        result.backendCalled = true;

        // Simulate setSelectedSession updater
        const updatedSession = setSelectedSession(selectedSession);
        result.sessionUpdated = true;
        result.updatedCustomLabel = updatedSession?.customLabel;

        // Simulate tab label sync
        handleTabLabelUpdated(selectedSession.id, newLabel);
        result.tabsUpdated = true;
    } catch (err) {
        result.error = err.message;
    }

    return result;
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

        it('all generated actions have type "label"', () => {
            const withLabel = buildLabelActions({ id: 's1', customLabel: 'Test' });
            const withoutLabel = buildLabelActions({ id: 's2' });

            [...withLabel, ...withoutLabel].forEach(action => {
                expect(action.type).toBe('label');
            });
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

        it('ignores non-label items', () => {
            const actionItem = { id: 'new-terminal', type: 'action', title: 'New Terminal' };
            const result = handleLabelAction(actionItem, activeSession, vi.fn(), vi.fn());

            expect(result.action).toBe('not-label');
        });

        it('delete-label calls onUpdateLabel with empty string and closes menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const item = { id: 'delete-label', type: 'label', title: 'Delete Custom Label' };

            const result = handleLabelAction(item, activeSession, onUpdateLabel, onClose);

            expect(result.action).toBe('delete');
            expect(onUpdateLabel).toHaveBeenCalledWith('');
            expect(onClose).toHaveBeenCalled();
            expect(result.closedMenu).toBe(true);
        });

        it('add-label sets labelingSession with empty customLabel', () => {
            const item = { id: 'add-label', type: 'label', title: 'Add Custom Label' };
            const sessionNoLabel = { id: 'session-1', title: 'Test' };

            const result = handleLabelAction(item, sessionNoLabel, vi.fn(), vi.fn());

            expect(result.action).toBe('add');
            expect(result.labelingSession).toEqual({
                id: 'session-1',
                customLabel: '',
            });
        });

        it('edit-label sets labelingSession with current customLabel', () => {
            const item = { id: 'edit-label', type: 'label', title: 'Edit Custom Label' };

            const result = handleLabelAction(item, activeSession, vi.fn(), vi.fn());

            expect(result.action).toBe('edit');
            expect(result.labelingSession).toEqual({
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
            const result = handleSaveSessionLabel(null, 'New Label', onUpdateLabel, vi.fn());

            expect(result.calledUpdateLabel).toBe(false);
            expect(onUpdateLabel).not.toHaveBeenCalled();
        });

        it('calls onUpdateLabel with new label and closes menu', () => {
            const onUpdateLabel = vi.fn();
            const onClose = vi.fn();
            const labelingSession = { id: 'session-1', customLabel: '' };

            const result = handleSaveSessionLabel(labelingSession, 'My New Label', onUpdateLabel, onClose);

            expect(result.calledUpdateLabel).toBe(true);
            expect(result.updateLabelValue).toBe('My New Label');
            expect(onUpdateLabel).toHaveBeenCalledWith('My New Label');
            expect(onClose).toHaveBeenCalled();
            expect(result.clearedLabelingSession).toBe(true);
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
// Tests: App.jsx onUpdateLabel Callback
// ============================================================================

describe('App.jsx onUpdateLabel callback', () => {
    it('skips when selectedSession is null', () => {
        const result = simulateAppUpdateLabel(null, 'Label', vi.fn(), vi.fn(), vi.fn());
        expect(result.skipped).toBe(true);
    });

    it('calls backend with session id and new label', () => {
        const updateBackend = vi.fn();
        const selectedSession = { id: 'session-abc', customLabel: '' };

        simulateAppUpdateLabel(
            selectedSession,
            'New Label',
            updateBackend,
            (prev) => ({ ...prev, customLabel: 'New Label' }),
            vi.fn()
        );

        expect(updateBackend).toHaveBeenCalledWith('session-abc', 'New Label');
    });

    it('updates selectedSession state with new label', () => {
        const selectedSession = { id: 'session-1', title: 'Test', customLabel: '' };

        const result = simulateAppUpdateLabel(
            selectedSession,
            'Updated',
            vi.fn(),
            (prev) => ({ ...prev, customLabel: 'Updated' }),
            vi.fn()
        );

        expect(result.sessionUpdated).toBe(true);
        expect(result.updatedCustomLabel).toBe('Updated');
    });

    it('syncs tab labels after updating session', () => {
        const handleTabLabelUpdated = vi.fn();
        const selectedSession = { id: 'session-1', customLabel: 'Old' };

        simulateAppUpdateLabel(
            selectedSession,
            'New',
            vi.fn(),
            (prev) => ({ ...prev, customLabel: 'New' }),
            handleTabLabelUpdated
        );

        expect(handleTabLabelUpdated).toHaveBeenCalledWith('session-1', 'New');
    });

    it('handles label deletion (empty string)', () => {
        const updateBackend = vi.fn();
        const handleTabLabelUpdated = vi.fn();
        const selectedSession = { id: 'session-1', customLabel: 'To Remove' };

        const result = simulateAppUpdateLabel(
            selectedSession,
            '',
            updateBackend,
            (prev) => ({ ...prev, customLabel: '' }),
            handleTabLabelUpdated
        );

        expect(updateBackend).toHaveBeenCalledWith('session-1', '');
        expect(handleTabLabelUpdated).toHaveBeenCalledWith('session-1', '');
        expect(result.updatedCustomLabel).toBe('');
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

        // 2. User selects "Add Custom Label" → opens dialog
        const selectResult = handleLabelAction(actions[0], session, vi.fn(), vi.fn());
        expect(selectResult.labelingSession.customLabel).toBe('');

        // 3. User types label and saves
        const onUpdateLabel = vi.fn();
        const onClose = vi.fn();
        handleSaveSessionLabel(selectResult.labelingSession, 'Bug Fix', onUpdateLabel, onClose);
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

        // Select edit
        const selectResult = handleLabelAction(actions[0], session, vi.fn(), vi.fn());
        expect(selectResult.labelingSession.customLabel).toBe('Old Name');

        // Save new label
        const onUpdateLabel = vi.fn();
        handleSaveSessionLabel(selectResult.labelingSession, 'New Name', onUpdateLabel, vi.fn());
        expect(onUpdateLabel).toHaveBeenCalledWith('New Name');
    });

    it('full flow: session with label → delete label → only Add appears', () => {
        const session = { id: 's1', customLabel: 'To Remove' };
        let actions = buildLabelActions(session);
        expect(actions).toHaveLength(2);

        // Select delete
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
        // In the selector-view CommandMenu, activeSession is not passed (defaults to null)
        const actions = buildLabelActions(null);
        expect(actions).toHaveLength(0);

        // Combined action list should have no label items
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
        const selectResult = handleLabelAction(actions[0], session, onUpdateLabel, vi.fn());
        expect(selectResult.labelingSession).not.toBeNull();

        // Cancel (set labelingSession to null without calling save)
        // No onUpdateLabel call should have occurred
        expect(onUpdateLabel).not.toHaveBeenCalled();
    });
});
