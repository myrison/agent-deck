/**
 * Tests for modal keyboard event isolation (PR #47)
 *
 * These tests verify that when a modal is open, keyboard events are properly
 * contained within the modal and do NOT leak to parent components or the
 * terminal behind it.
 *
 * Key behaviors tested:
 * 1. Modal handlers call stopPropagation() to prevent event bubbling
 * 2. App.jsx handleKeyDown returns early when specific modals are open
 * 3. The combination prevents keyboard shortcuts from leaking through modals
 *
 * The PR adds:
 * - stopPropagation() calls in modal keyDown handlers (defense-in-depth)
 * - Additional modal state checks in App.jsx handleKeyDown dependency array
 *
 * Testing approach: Since the actual React components require Wails bindings,
 * we test the behavior logic patterns extracted from the components.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Event Simulation Helpers
// ============================================================================

/**
 * Creates a mock keyboard event with propagation tracking
 */
function createMockKeyEvent(key, options = {}) {
    let propagationStopped = false;
    let defaultPrevented = false;

    return {
        key,
        metaKey: options.metaKey || false,
        ctrlKey: options.ctrlKey || false,
        shiftKey: options.shiftKey || false,
        altKey: options.altKey || false,
        target: options.target || { tagName: 'INPUT' },
        stopPropagation: () => {
            propagationStopped = true;
        },
        preventDefault: () => {
            defaultPrevented = true;
        },
        isPropagationStopped: () => propagationStopped,
        isDefaultPrevented: () => defaultPrevented,
    };
}

// ============================================================================
// Modal Handler Patterns (extracted from actual component code)
// ============================================================================

/**
 * Simulates CommandMenu.jsx handleKeyDown behavior WITH the PR #47 fix.
 * Returns object describing what actions were taken.
 */
function commandMenuHandleKeyDown(e, state = {}) {
    const { selectedIndex = 0, resultsLength = 5, onClose, onAction } = state;
    const result = { handled: false, action: null };

    // PR #47 FIX: Stop propagation to prevent App.jsx from receiving events
    e.stopPropagation();

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-down';
            result.newIndex = Math.min(selectedIndex + 1, resultsLength - 1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-up';
            result.newIndex = Math.max(selectedIndex - 1, 0);
            break;
        case 'Enter':
            e.preventDefault();
            result.handled = true;
            result.action = 'select';
            onAction?.();
            break;
        case 'Escape':
            e.preventDefault();
            result.handled = true;
            result.action = 'close';
            onClose?.();
            break;
        default:
            // Character keys pass through for search filtering
            result.handled = true;
            result.action = 'search-input';
    }

    return result;
}

/**
 * Simulates ConfigPicker.jsx handleKeyDown behavior WITH the PR #47 fix.
 */
function configPickerHandleKeyDown(e, state = {}) {
    const { selectedIndex = 0, configsLength = 3, onSelect, onCancel } = state;
    const result = { handled: false, action: null };

    // PR #47 FIX: Stop propagation
    e.stopPropagation();

    switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-next';
            result.newIndex = (selectedIndex + 1) % configsLength;
            break;
        case 'ArrowUp':
        case 'ArrowLeft':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-prev';
            result.newIndex = (selectedIndex - 1 + configsLength) % configsLength;
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            result.handled = true;
            result.action = 'select';
            onSelect?.();
            break;
        case 'Escape':
            e.preventDefault();
            result.handled = true;
            result.action = 'cancel';
            onCancel?.();
            break;
    }

    return result;
}

/**
 * Simulates RenameDialog.jsx handleKeyDown behavior WITH the PR #47 fix.
 */
function renameDialogHandleKeyDown(e, state = {}) {
    const { name = 'test', onSave, onCancel } = state;
    const result = { handled: false, action: null };

    // PR #47 FIX: Stop propagation
    e.stopPropagation();

    if (e.key === 'Enter') {
        e.preventDefault();
        if (name.trim()) {
            result.handled = true;
            result.action = 'save';
            onSave?.(name);
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        result.handled = true;
        result.action = 'cancel';
        onCancel?.();
    } else {
        // Character keys for typing
        result.handled = true;
        result.action = 'typing';
    }

    return result;
}

/**
 * Simulates SessionPicker.jsx handleKeyDown behavior WITH the PR #47 fix.
 */
function sessionPickerHandleKeyDown(e, state = {}) {
    const {
        selectedIndex = 0,
        totalOptions = 3,
        showLabelInput = false,
        onSelectSession,
        onCreateNew,
        onCancel,
    } = state;
    const result = { handled: false, action: null };

    // PR #47 FIX: Stop propagation
    e.stopPropagation();

    if (showLabelInput) {
        if (e.key === 'Enter') {
            e.preventDefault();
            result.handled = true;
            result.action = 'create-with-label';
        } else if (e.key === 'Escape') {
            e.preventDefault();
            result.handled = true;
            result.action = 'cancel-label';
        }
        return result;
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-down';
            result.newIndex = (selectedIndex + 1) % totalOptions;
            break;
        case 'ArrowUp':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-up';
            result.newIndex = (selectedIndex - 1 + totalOptions) % totalOptions;
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            result.handled = true;
            result.action = 'select';
            break;
        case 'Escape':
            e.preventDefault();
            result.handled = true;
            result.action = 'cancel';
            onCancel?.();
            break;
    }

    // Number keys for quick select
    if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < totalOptions) {
            e.preventDefault();
            result.handled = true;
            result.action = 'quick-select';
            result.selectedIndex = idx;
        }
    }

    return result;
}

/**
 * Simulates HostPicker.jsx handleKeyDown behavior WITH the PR #47 fix.
 */
function hostPickerHandleKeyDown(e, state = {}) {
    const { hostsLength = 3, selectedIndex = 0, onSelect, onCancel } = state;
    const result = { handled: false, action: null };

    // PR #47 FIX: Stop propagation
    e.stopPropagation();

    if (hostsLength === 0) {
        if (e.key === 'Escape') {
            e.preventDefault();
            result.handled = true;
            result.action = 'cancel';
            onCancel?.();
        }
        return result;
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-down';
            result.newIndex = (selectedIndex + 1) % hostsLength;
            break;
        case 'ArrowUp':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-up';
            result.newIndex = (selectedIndex - 1 + hostsLength) % hostsLength;
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            result.handled = true;
            result.action = 'select';
            onSelect?.();
            break;
        case 'Escape':
            e.preventDefault();
            result.handled = true;
            result.action = 'cancel';
            onCancel?.();
            break;
    }

    // Number keys for quick select
    if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < hostsLength) {
            e.preventDefault();
            result.handled = true;
            result.action = 'quick-select';
            result.selectedIndex = idx;
        }
    }

    return result;
}

// ============================================================================
// App.jsx Handler Pattern (simulates the global keyboard handler)
// ============================================================================

/**
 * Simulates App.jsx handleKeyDown behavior with modal state checks.
 * This is the pattern that PR #47 also modifies (adding more modal checks).
 */
function appHandleKeyDown(e, state = {}) {
    const {
        showHelpModal = false,
        showSettings = false,
        showCommandMenu = false,
        showLabelDialog = false,
        showRemotePathInput = false,
        // PR #47 additions:
        sessionPickerProject = null,
        showToolPicker = false,
        showConfigPicker = false,
        showHostPicker = false,
        showSaveLayoutModal = false,
        view = 'selector',
    } = state;

    const result = { handled: false, action: null };

    // PR #47 FIX: Extended modal check - early return if any modal is open
    if (
        showHelpModal ||
        showSettings ||
        showCommandMenu ||
        showLabelDialog ||
        showRemotePathInput ||
        // PR #47 additions:
        sessionPickerProject ||
        showToolPicker ||
        showConfigPicker ||
        showHostPicker ||
        showSaveLayoutModal
    ) {
        result.handled = false;
        result.action = 'blocked-by-modal';
        return result;
    }

    // Simulate some app shortcuts that could conflict
    const appMod = e.metaKey || e.ctrlKey;

    if (appMod && e.key === 'k') {
        e.preventDefault();
        result.handled = true;
        result.action = 'open-command-menu';
    } else if (appMod && e.key === 'n') {
        e.preventDefault();
        result.handled = true;
        result.action = 'new-session';
    } else if (appMod && e.key === 't') {
        e.preventDefault();
        result.handled = true;
        result.action = 'new-tab';
    } else if (e.key === 'Escape' && appMod && view === 'terminal') {
        e.preventDefault();
        result.handled = true;
        result.action = 'back-to-selector';
    } else if (appMod && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        result.handled = true;
        result.action = 'switch-tab';
        result.tabIndex = parseInt(e.key, 10) - 1;
    }

    return result;
}

// ============================================================================
// Tests: Modal Handler Propagation Behavior
// ============================================================================

describe('Modal keyboard event isolation (PR #47)', () => {
    describe('stopPropagation behavior in modal handlers', () => {
        describe('CommandMenu', () => {
            it('stops propagation for arrow key navigation', () => {
                const event = createMockKeyEvent('ArrowDown');
                commandMenuHandleKeyDown(event);

                expect(event.isPropagationStopped()).toBe(true);
                expect(event.isDefaultPrevented()).toBe(true);
            });

            it('stops propagation for character keys (search input)', () => {
                const event = createMockKeyEvent('s');
                commandMenuHandleKeyDown(event);

                expect(event.isPropagationStopped()).toBe(true);
            });

            it('stops propagation for Enter key', () => {
                const onAction = vi.fn();
                const event = createMockKeyEvent('Enter');
                commandMenuHandleKeyDown(event, { onAction });

                expect(event.isPropagationStopped()).toBe(true);
                expect(onAction).toHaveBeenCalled();
            });

            it('stops propagation for Escape key', () => {
                const onClose = vi.fn();
                const event = createMockKeyEvent('Escape');
                commandMenuHandleKeyDown(event, { onClose });

                expect(event.isPropagationStopped()).toBe(true);
                expect(onClose).toHaveBeenCalled();
            });

            it('handles keyboard navigation correctly', () => {
                const downEvent = createMockKeyEvent('ArrowDown');
                const downResult = commandMenuHandleKeyDown(downEvent, {
                    selectedIndex: 2,
                    resultsLength: 5,
                });
                expect(downResult.newIndex).toBe(3);

                const upEvent = createMockKeyEvent('ArrowUp');
                const upResult = commandMenuHandleKeyDown(upEvent, {
                    selectedIndex: 2,
                    resultsLength: 5,
                });
                expect(upResult.newIndex).toBe(1);
            });

            it('clamps navigation at boundaries', () => {
                const atEndEvent = createMockKeyEvent('ArrowDown');
                const endResult = commandMenuHandleKeyDown(atEndEvent, {
                    selectedIndex: 4,
                    resultsLength: 5,
                });
                expect(endResult.newIndex).toBe(4);

                const atStartEvent = createMockKeyEvent('ArrowUp');
                const startResult = commandMenuHandleKeyDown(atStartEvent, {
                    selectedIndex: 0,
                    resultsLength: 5,
                });
                expect(startResult.newIndex).toBe(0);
            });
        });

        describe('ConfigPicker', () => {
            it('stops propagation for all navigation keys', () => {
                ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((key) => {
                    const event = createMockKeyEvent(key);
                    configPickerHandleKeyDown(event);
                    expect(event.isPropagationStopped()).toBe(true);
                });
            });

            it('stops propagation for Space key selection', () => {
                const onSelect = vi.fn();
                const event = createMockKeyEvent(' ');
                configPickerHandleKeyDown(event, { onSelect });

                expect(event.isPropagationStopped()).toBe(true);
                expect(onSelect).toHaveBeenCalled();
            });

            it('wraps navigation at boundaries', () => {
                const atEndEvent = createMockKeyEvent('ArrowDown');
                const endResult = configPickerHandleKeyDown(atEndEvent, {
                    selectedIndex: 2,
                    configsLength: 3,
                });
                expect(endResult.newIndex).toBe(0);

                const atStartEvent = createMockKeyEvent('ArrowUp');
                const startResult = configPickerHandleKeyDown(atStartEvent, {
                    selectedIndex: 0,
                    configsLength: 3,
                });
                expect(startResult.newIndex).toBe(2);
            });
        });

        describe('RenameDialog', () => {
            it('stops propagation for all keys', () => {
                const event = createMockKeyEvent('a');
                renameDialogHandleKeyDown(event);

                expect(event.isPropagationStopped()).toBe(true);
            });

            it('calls onSave for Enter with non-empty name', () => {
                const onSave = vi.fn();
                const event = createMockKeyEvent('Enter');
                renameDialogHandleKeyDown(event, { name: 'new-name', onSave });

                expect(onSave).toHaveBeenCalledWith('new-name');
            });

            it('does not call onSave for Enter with empty name', () => {
                const onSave = vi.fn();
                const event = createMockKeyEvent('Enter');
                renameDialogHandleKeyDown(event, { name: '   ', onSave });

                expect(onSave).not.toHaveBeenCalled();
            });

            it('calls onCancel for Escape', () => {
                const onCancel = vi.fn();
                const event = createMockKeyEvent('Escape');
                renameDialogHandleKeyDown(event, { onCancel });

                expect(onCancel).toHaveBeenCalled();
            });
        });

        describe('SessionPicker', () => {
            it('stops propagation for navigation keys', () => {
                const downEvent = createMockKeyEvent('ArrowDown');
                sessionPickerHandleKeyDown(downEvent);
                expect(downEvent.isPropagationStopped()).toBe(true);

                const upEvent = createMockKeyEvent('ArrowUp');
                sessionPickerHandleKeyDown(upEvent);
                expect(upEvent.isPropagationStopped()).toBe(true);
            });

            it('stops propagation for number keys (quick select)', () => {
                const event = createMockKeyEvent('1');
                const result = sessionPickerHandleKeyDown(event, { totalOptions: 5 });

                expect(event.isPropagationStopped()).toBe(true);
                expect(result.action).toBe('quick-select');
                expect(result.selectedIndex).toBe(0);
            });

            it('handles label input mode separately', () => {
                const enterEvent = createMockKeyEvent('Enter');
                const result = sessionPickerHandleKeyDown(enterEvent, {
                    showLabelInput: true,
                });

                expect(enterEvent.isPropagationStopped()).toBe(true);
                expect(result.action).toBe('create-with-label');
            });

            it('wraps navigation at boundaries', () => {
                const atEndEvent = createMockKeyEvent('ArrowDown');
                const endResult = sessionPickerHandleKeyDown(atEndEvent, {
                    selectedIndex: 2,
                    totalOptions: 3,
                });
                expect(endResult.newIndex).toBe(0);
            });
        });

        describe('HostPicker', () => {
            it('stops propagation for navigation keys', () => {
                const event = createMockKeyEvent('ArrowDown');
                hostPickerHandleKeyDown(event, { hostsLength: 3 });

                expect(event.isPropagationStopped()).toBe(true);
            });

            it('handles empty hosts list gracefully', () => {
                const escapeEvent = createMockKeyEvent('Escape');
                const onCancel = vi.fn();
                hostPickerHandleKeyDown(escapeEvent, { hostsLength: 0, onCancel });

                expect(onCancel).toHaveBeenCalled();

                const arrowEvent = createMockKeyEvent('ArrowDown');
                const result = hostPickerHandleKeyDown(arrowEvent, { hostsLength: 0 });
                expect(result.action).toBe(null);
            });

            it('supports number key quick select', () => {
                const event = createMockKeyEvent('3');
                const result = hostPickerHandleKeyDown(event, { hostsLength: 5 });

                expect(result.action).toBe('quick-select');
                expect(result.selectedIndex).toBe(2);
            });
        });
    });

    describe('App.jsx modal state checks', () => {
        it('blocks shortcuts when CommandMenu is open', () => {
            const event = createMockKeyEvent('k', { metaKey: true });
            const result = appHandleKeyDown(event, { showCommandMenu: true });

            expect(result.action).toBe('blocked-by-modal');
            expect(result.handled).toBe(false);
        });

        it('blocks shortcuts when HelpModal is open', () => {
            const event = createMockKeyEvent('n', { metaKey: true });
            const result = appHandleKeyDown(event, { showHelpModal: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when Settings is open', () => {
            const event = createMockKeyEvent('t', { metaKey: true });
            const result = appHandleKeyDown(event, { showSettings: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when LabelDialog is open', () => {
            const event = createMockKeyEvent('k', { metaKey: true });
            const result = appHandleKeyDown(event, { showLabelDialog: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        // PR #47 additions - these modals now also block shortcuts
        it('blocks shortcuts when SessionPicker is open (PR #47)', () => {
            const event = createMockKeyEvent('k', { metaKey: true });
            const result = appHandleKeyDown(event, {
                sessionPickerProject: { path: '/some/path', name: 'Project' },
            });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when ToolPicker is open (PR #47)', () => {
            const event = createMockKeyEvent('n', { metaKey: true });
            const result = appHandleKeyDown(event, { showToolPicker: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when ConfigPicker is open (PR #47)', () => {
            const event = createMockKeyEvent('t', { metaKey: true });
            const result = appHandleKeyDown(event, { showConfigPicker: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when HostPicker is open (PR #47)', () => {
            const event = createMockKeyEvent('k', { metaKey: true });
            const result = appHandleKeyDown(event, { showHostPicker: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('blocks shortcuts when SaveLayoutModal is open (PR #47)', () => {
            const event = createMockKeyEvent('n', { metaKey: true });
            const result = appHandleKeyDown(event, { showSaveLayoutModal: true });

            expect(result.action).toBe('blocked-by-modal');
        });

        it('allows shortcuts when no modals are open', () => {
            const event = createMockKeyEvent('k', { metaKey: true });
            const result = appHandleKeyDown(event, {});

            expect(result.action).toBe('open-command-menu');
            expect(result.handled).toBe(true);
        });
    });
});

// ============================================================================
// Tests: Real-World Scenarios
// ============================================================================

describe('Real-world keyboard interaction scenarios', () => {
    describe('Scenario: User types in CommandMenu search', () => {
        it('typing "settings" filters results without triggering app shortcuts', () => {
            const appShortcutsTriggered = [];
            const searchInput = [];

            // Simulate typing "settings" in command menu
            const chars = 'settings'.split('');

            chars.forEach((char) => {
                const event = createMockKeyEvent(char);

                // Modal handler runs first, stops propagation
                commandMenuHandleKeyDown(event);
                searchInput.push(char);

                // App handler would run, but propagation is stopped
                // In real code, this means the handler never receives the event
                if (!event.isPropagationStopped()) {
                    // This simulates what would happen without stopPropagation
                    const appResult = appHandleKeyDown(event, {});
                    if (appResult.handled) {
                        appShortcutsTriggered.push(appResult.action);
                    }
                }
            });

            // Search input should have all characters
            expect(searchInput.join('')).toBe('settings');

            // No app shortcuts should have been triggered
            expect(appShortcutsTriggered).toHaveLength(0);
        });

        it('Escape closes menu without triggering app Escape handler', () => {
            const onClose = vi.fn();
            const appEscapeTriggered = vi.fn();

            const event = createMockKeyEvent('Escape');

            // Modal handles Escape
            commandMenuHandleKeyDown(event, { onClose });

            // Modal closed
            expect(onClose).toHaveBeenCalled();

            // Propagation stopped, so app handler never runs
            expect(event.isPropagationStopped()).toBe(true);
        });
    });

    describe('Scenario: User navigates ConfigPicker', () => {
        it('arrow keys navigate options without affecting app state', () => {
            const appNavigations = [];

            // Navigate down through 3 configs
            for (let i = 0; i < 3; i++) {
                const event = createMockKeyEvent('ArrowDown');

                // ConfigPicker handles it
                configPickerHandleKeyDown(event, {
                    selectedIndex: i,
                    configsLength: 3,
                });

                // If propagation wasn't stopped, this would reach app
                if (!event.isPropagationStopped()) {
                    appNavigations.push('down');
                }
            }

            // No events reached app handler
            expect(appNavigations).toHaveLength(0);
        });

        it('Space key selects config without propagating', () => {
            const onSelect = vi.fn();
            const event = createMockKeyEvent(' ');

            configPickerHandleKeyDown(event, { onSelect });

            expect(onSelect).toHaveBeenCalled();
            expect(event.isPropagationStopped()).toBe(true);
        });
    });

    describe('Scenario: User renames a session', () => {
        it('typing in rename field stays isolated', () => {
            const newName = 'my-new-session';
            const events = [];

            newName.split('').forEach((char) => {
                const event = createMockKeyEvent(char);
                renameDialogHandleKeyDown(event);

                expect(event.isPropagationStopped()).toBe(true);
                events.push(char);
            });

            expect(events.join('')).toBe(newName);
        });

        it('Enter submits without propagating', () => {
            const onSave = vi.fn();
            const event = createMockKeyEvent('Enter');

            renameDialogHandleKeyDown(event, {
                name: 'new-session-name',
                onSave,
            });

            expect(onSave).toHaveBeenCalledWith('new-session-name');
            expect(event.isPropagationStopped()).toBe(true);
        });
    });

    describe('Scenario: Quick select with number keys', () => {
        it('number keys in SessionPicker select sessions without switching tabs', () => {
            // In App.jsx, Cmd+1-9 switches tabs
            // In SessionPicker, 1-9 (without modifier) quick-selects sessions
            // Without stopPropagation, both could trigger

            const tabSwitchAttempts = [];

            // Press '2' to quick-select second session
            const event = createMockKeyEvent('2');

            // SessionPicker handles it
            const result = sessionPickerHandleKeyDown(event, {
                totalOptions: 5,
            });

            expect(result.action).toBe('quick-select');
            expect(result.selectedIndex).toBe(1);

            // Propagation stopped
            expect(event.isPropagationStopped()).toBe(true);

            // App handler would NOT receive this
            // (In real code, the event never bubbles up)
        });
    });

    describe('Scenario: Defense in depth', () => {
        it('both stopPropagation AND modal check protect against leaks', () => {
            // This tests that PR #47 provides two layers of protection:
            // 1. Modal handlers call stopPropagation (prevents bubbling)
            // 2. App.jsx checks modal state (returns early if modal open)

            // Layer 1: stopPropagation
            const event = createMockKeyEvent('k', { metaKey: true });
            commandMenuHandleKeyDown(event);
            expect(event.isPropagationStopped()).toBe(true);

            // Layer 2: App modal check (even if propagation wasn't stopped)
            const appResult = appHandleKeyDown(
                createMockKeyEvent('k', { metaKey: true }),
                { showCommandMenu: true }
            );
            expect(appResult.action).toBe('blocked-by-modal');
        });

        it('multiple modal states all block shortcuts', () => {
            const modalStates = [
                { showHelpModal: true },
                { showSettings: true },
                { showCommandMenu: true },
                { showLabelDialog: true },
                { showRemotePathInput: true },
                { sessionPickerProject: { path: '/test' } },
                { showToolPicker: true },
                { showConfigPicker: true },
                { showHostPicker: true },
                { showSaveLayoutModal: true },
            ];

            modalStates.forEach((state) => {
                const event = createMockKeyEvent('k', { metaKey: true });
                const result = appHandleKeyDown(event, state);

                expect(result.action).toBe('blocked-by-modal');
            });
        });
    });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('Edge cases and boundary conditions', () => {
    it('handles rapid key presses', () => {
        const events = [];

        // Simulate rapid typing
        for (let i = 0; i < 20; i++) {
            const event = createMockKeyEvent('a');
            commandMenuHandleKeyDown(event);
            events.push(event.isPropagationStopped());
        }

        // All events should have propagation stopped
        expect(events.every((stopped) => stopped)).toBe(true);
    });

    it('handles modifier key combinations in modal', () => {
        // Cmd+P in CommandMenu pins project (handled by modal)
        const event = createMockKeyEvent('p', { metaKey: true });
        commandMenuHandleKeyDown(event);

        // Propagation still stopped even for modified keys
        expect(event.isPropagationStopped()).toBe(true);
    });

    it('handles special keys correctly', () => {
        const specialKeys = ['Tab', 'Backspace', 'Delete', 'Home', 'End'];

        specialKeys.forEach((key) => {
            const event = createMockKeyEvent(key);
            commandMenuHandleKeyDown(event);

            // All keys stop propagation in CommandMenu
            expect(event.isPropagationStopped()).toBe(true);
        });
    });

    it('handles empty results in CommandMenu', () => {
        const event = createMockKeyEvent('ArrowDown');
        const result = commandMenuHandleKeyDown(event, {
            selectedIndex: 0,
            resultsLength: 0,
        });

        // Should handle gracefully (clamped at -1 which is min of 0 and -1)
        expect(event.isPropagationStopped()).toBe(true);
    });
});

// ============================================================================
// Tests: Comparison WITHOUT Fix (demonstrates the bug)
// ============================================================================

describe('Behavior WITHOUT PR #47 fix (demonstrates the bug)', () => {
    /**
     * These handlers simulate the behavior BEFORE the fix was applied,
     * showing what would happen without stopPropagation.
     */
    function commandMenuWithoutFix(e) {
        // NO stopPropagation call!
        if (e.key === 'Escape') {
            e.preventDefault();
        }
        // Events bubble up to parent...
    }

    it('events LEAK to parent without stopPropagation', () => {
        const event = createMockKeyEvent('s');

        // Without the fix, propagation is NOT stopped
        commandMenuWithoutFix(event);

        // Event would bubble up
        expect(event.isPropagationStopped()).toBe(false);

        // Parent handler would receive it
        // (This is the bug - character 's' might trigger a shortcut)
    });

    it('demonstrates the fix: WITH stopPropagation events do NOT leak', () => {
        const eventWithoutFix = createMockKeyEvent('s');
        commandMenuWithoutFix(eventWithoutFix);
        expect(eventWithoutFix.isPropagationStopped()).toBe(false);

        const eventWithFix = createMockKeyEvent('s');
        commandMenuHandleKeyDown(eventWithFix);
        expect(eventWithFix.isPropagationStopped()).toBe(true);
    });
});
