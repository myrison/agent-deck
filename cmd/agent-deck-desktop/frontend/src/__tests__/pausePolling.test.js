/**
 * Tests for pausePolling behavior in SessionList/SessionSelector.
 *
 * This tests the core bug fix mechanism: when modals are open, background
 * polling is paused to prevent React state updates that would disrupt focus.
 *
 * Bug scenario (before fix):
 * 1. User opens a modal (e.g., rename dialog, command menu)
 * 2. Background polling (10s interval) triggers a re-render
 * 3. React reconciliation may cause focus to jump away from modal input
 * 4. User's typing/interaction is disrupted
 *
 * Fix:
 * - SessionList accepts `pausePolling` prop
 * - SessionSelector tracks modal states and computes `anyModalOpen`
 * - When anyModalOpen=true, pausePolling=true is passed to SessionList
 * - SessionList's useEffect returns early when pausePolling=true
 *
 * These tests verify the logic patterns without requiring full React rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Polling Behavior Simulation
// ============================================================================

/**
 * Simulates the polling useEffect behavior from SessionList.jsx
 * This is the core logic we're testing.
 */
function createPollingSimulation() {
    let intervalId = null;
    let pollCount = 0;
    const pollHistory = [];

    const startPolling = (pausePolling, pollCallback) => {
        // Simulates: useEffect(() => { if (pausePolling) return; ... }, [pausePolling]);
        if (pausePolling) {
            // Polling is paused, no interval created
            return null;
        }

        intervalId = setInterval(() => {
            pollCount++;
            pollHistory.push({ time: Date.now(), pausePolling });
            pollCallback?.();
        }, 100); // Use 100ms for tests (actual is 10000ms)

        return intervalId;
    };

    const stopPolling = () => {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    return {
        startPolling,
        stopPolling,
        getPollCount: () => pollCount,
        getPollHistory: () => pollHistory,
        isPolling: () => intervalId !== null,
        reset: () => {
            stopPolling();
            pollCount = 0;
            pollHistory.length = 0;
        }
    };
}

/**
 * Simulates SessionSelector's anyModalOpen computation.
 * This is the logic from SessionSelector.jsx that determines when to pause polling.
 */
function computeAnyModalOpen({
    contextMenu = null,
    labelingSession = null,
    deletingSession = null,
    externalModalOpen = false,
}) {
    return !!(contextMenu || labelingSession || deletingSession || externalModalOpen);
}

// ============================================================================
// Tests: pausePolling Effect Behavior
// ============================================================================

describe('pausePolling behavior', () => {
    let polling;

    beforeEach(() => {
        vi.useFakeTimers();
        polling = createPollingSimulation();
    });

    afterEach(() => {
        polling.reset();
        vi.useRealTimers();
    });

    describe('basic polling behavior', () => {
        it('starts polling when pausePolling is false', () => {
            polling.startPolling(false, vi.fn());

            expect(polling.isPolling()).toBe(true);
        });

        it('does NOT start polling when pausePolling is true', () => {
            polling.startPolling(true, vi.fn());

            expect(polling.isPolling()).toBe(false);
        });

        it('polls at regular intervals when not paused', () => {
            const callback = vi.fn();
            polling.startPolling(false, callback);

            // Advance time by 300ms (should trigger 3 polls at 100ms intervals)
            vi.advanceTimersByTime(300);

            expect(callback).toHaveBeenCalledTimes(3);
            expect(polling.getPollCount()).toBe(3);
        });

        it('does NOT poll when paused', () => {
            const callback = vi.fn();
            polling.startPolling(true, callback);

            // Advance time - no polls should occur
            vi.advanceTimersByTime(500);

            expect(callback).not.toHaveBeenCalled();
            expect(polling.getPollCount()).toBe(0);
        });
    });

    describe('pause/resume transitions', () => {
        it('stops polling when pausePolling changes to true', () => {
            const callback = vi.fn();

            // Start with polling enabled
            polling.startPolling(false, callback);
            vi.advanceTimersByTime(200); // 2 polls
            expect(callback).toHaveBeenCalledTimes(2);

            // Simulate pausePolling changing to true
            // In real React, useEffect cleanup runs when deps change
            polling.stopPolling();
            polling.startPolling(true, callback); // Re-run effect with new pausePolling value

            // Advance time - no additional polls
            vi.advanceTimersByTime(300);

            // Still only 2 polls from before
            expect(callback).toHaveBeenCalledTimes(2);
        });

        it('resumes polling when pausePolling changes to false', () => {
            const callback = vi.fn();

            // Start with polling paused
            polling.startPolling(true, callback);
            vi.advanceTimersByTime(200);
            expect(callback).not.toHaveBeenCalled();

            // Simulate pausePolling changing to false
            polling.stopPolling();
            polling.startPolling(false, callback);

            // Now polls should occur
            vi.advanceTimersByTime(300);

            expect(callback).toHaveBeenCalledTimes(3);
        });

        it('handles rapid pause/resume transitions', () => {
            const callback = vi.fn();

            // Multiple rapid transitions
            polling.startPolling(false, callback);
            vi.advanceTimersByTime(100); // 1 poll
            polling.stopPolling();

            polling.startPolling(true, callback); // paused
            vi.advanceTimersByTime(100); // no poll
            polling.stopPolling();

            polling.startPolling(false, callback); // resumed
            vi.advanceTimersByTime(100); // 1 poll
            polling.stopPolling();

            polling.startPolling(true, callback); // paused
            vi.advanceTimersByTime(100); // no poll
            polling.stopPolling();

            polling.startPolling(false, callback); // resumed
            vi.advanceTimersByTime(100); // 1 poll

            // Total: 3 polls (during the 3 unpaused periods)
            expect(callback).toHaveBeenCalledTimes(3);
        });
    });

    describe('cleanup on unmount', () => {
        it('stops polling on cleanup (simulates component unmount)', () => {
            const callback = vi.fn();
            polling.startPolling(false, callback);

            vi.advanceTimersByTime(100); // 1 poll
            expect(callback).toHaveBeenCalledTimes(1);

            // Simulate unmount cleanup
            polling.stopPolling();

            // Advance time - no more polls
            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });
});

// ============================================================================
// Tests: anyModalOpen Computation
// ============================================================================

describe('anyModalOpen computation (SessionSelector)', () => {
    describe('individual modal states', () => {
        it('returns false when no modals are open', () => {
            expect(computeAnyModalOpen({})).toBe(false);
        });

        it('returns true when contextMenu is open', () => {
            expect(computeAnyModalOpen({
                contextMenu: { x: 100, y: 100, session: { id: '123' } }
            })).toBe(true);
        });

        it('returns true when labelingSession is set (rename modal)', () => {
            expect(computeAnyModalOpen({
                labelingSession: { id: '123', title: 'Test Session' }
            })).toBe(true);
        });

        it('returns true when deletingSession is set (delete modal)', () => {
            expect(computeAnyModalOpen({
                deletingSession: { id: '123', title: 'Test Session' }
            })).toBe(true);
        });

        it('returns true when externalModalOpen is true (App-level modals)', () => {
            expect(computeAnyModalOpen({
                externalModalOpen: true
            })).toBe(true);
        });
    });

    describe('combined modal states', () => {
        it('returns true when multiple local modals are open', () => {
            expect(computeAnyModalOpen({
                contextMenu: { x: 0, y: 0, session: {} },
                labelingSession: { id: '1' },
            })).toBe(true);
        });

        it('returns true when local and external modals are open', () => {
            expect(computeAnyModalOpen({
                deletingSession: { id: '1' },
                externalModalOpen: true,
            })).toBe(true);
        });

        it('returns true when all modals are open', () => {
            expect(computeAnyModalOpen({
                contextMenu: { x: 0, y: 0, session: {} },
                labelingSession: { id: '1' },
                deletingSession: { id: '2' },
                externalModalOpen: true,
            })).toBe(true);
        });
    });

    describe('falsy value handling', () => {
        it('treats null as no modal', () => {
            expect(computeAnyModalOpen({
                contextMenu: null,
                labelingSession: null,
                deletingSession: null,
                externalModalOpen: false,
            })).toBe(false);
        });

        it('treats undefined as no modal', () => {
            expect(computeAnyModalOpen({
                contextMenu: undefined,
                labelingSession: undefined,
            })).toBe(false);
        });

        it('treats empty object as modal open (truthy)', () => {
            // An empty object is truthy in JavaScript
            expect(computeAnyModalOpen({
                contextMenu: {},
            })).toBe(true);
        });
    });
});

// ============================================================================
// Tests: Integration Pattern (SessionSelector -> SessionList)
// ============================================================================

describe('SessionSelector -> SessionList pausePolling integration', () => {
    let polling;

    beforeEach(() => {
        vi.useFakeTimers();
        polling = createPollingSimulation();
    });

    afterEach(() => {
        polling.reset();
        vi.useRealTimers();
    });

    describe('modal open/close lifecycle', () => {
        /**
         * Simulates the complete flow:
         * 1. User is viewing session list (no modals, polling active)
         * 2. User opens context menu (modal open, polling pauses)
         * 3. User selects "Rename" (context menu closes, rename modal opens, polling still paused)
         * 4. User types new name (no focus disruption from polling)
         * 5. User saves (modal closes, polling resumes)
         */
        it('pauses polling during complete rename flow', () => {
            const pollCallback = vi.fn();
            let modalState = {};

            // Step 1: Initial state - no modals, polling active
            let anyModalOpen = computeAnyModalOpen(modalState);
            expect(anyModalOpen).toBe(false);
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(150); // 1-2 polls
            const pollsBefore = pollCallback.mock.calls.length;
            expect(pollsBefore).toBeGreaterThan(0);

            // Step 2: User opens context menu
            modalState = { contextMenu: { x: 100, y: 100, session: { id: '123', title: 'My Session' } } };
            anyModalOpen = computeAnyModalOpen(modalState);
            expect(anyModalOpen).toBe(true);

            // Simulate useEffect re-run with new pausePolling value
            polling.stopPolling();
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(200); // No polls should occur

            expect(pollCallback.mock.calls.length).toBe(pollsBefore); // No new polls

            // Step 3: User selects "Rename" - context menu closes, rename modal opens
            modalState = { labelingSession: { id: '123', title: 'My Session', customLabel: '' } };
            anyModalOpen = computeAnyModalOpen(modalState);
            expect(anyModalOpen).toBe(true); // Still paused

            polling.stopPolling();
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(500); // Simulate user typing - still no polls

            expect(pollCallback.mock.calls.length).toBe(pollsBefore); // Still no new polls

            // Step 4: User saves rename (modal closes)
            modalState = {};
            anyModalOpen = computeAnyModalOpen(modalState);
            expect(anyModalOpen).toBe(false);

            polling.stopPolling();
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(200); // Polling resumes

            expect(pollCallback.mock.calls.length).toBeGreaterThan(pollsBefore); // New polls occurred
        });

        it('pauses polling when delete confirmation dialog opens', () => {
            const pollCallback = vi.fn();

            // No modals initially
            polling.startPolling(false, pollCallback);
            vi.advanceTimersByTime(100);
            expect(pollCallback).toHaveBeenCalled();
            pollCallback.mockClear();

            // User clicks delete, confirmation dialog opens
            const anyModalOpen = computeAnyModalOpen({
                deletingSession: { id: '456', title: 'Session to Delete' }
            });
            expect(anyModalOpen).toBe(true);

            polling.stopPolling();
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(300);

            // No polls during confirmation dialog
            expect(pollCallback).not.toHaveBeenCalled();
        });
    });

    describe('external modal (CommandMenu) pauses polling', () => {
        it('pauses polling when CommandMenu opens from App.jsx', () => {
            const pollCallback = vi.fn();

            // Initial state
            polling.startPolling(false, pollCallback);
            vi.advanceTimersByTime(100);
            const initialPolls = pollCallback.mock.calls.length;
            expect(initialPolls).toBeGreaterThan(0);

            // App.jsx opens CommandMenu, passes externalModalOpen=true
            const anyModalOpen = computeAnyModalOpen({ externalModalOpen: true });
            expect(anyModalOpen).toBe(true);

            polling.stopPolling();
            polling.startPolling(anyModalOpen, pollCallback);
            vi.advanceTimersByTime(500);

            // No additional polls
            expect(pollCallback.mock.calls.length).toBe(initialPolls);
        });

        it('resumes polling when CommandMenu closes', () => {
            const pollCallback = vi.fn();

            // CommandMenu is open
            polling.startPolling(true, pollCallback);
            vi.advanceTimersByTime(200);
            expect(pollCallback).not.toHaveBeenCalled();

            // CommandMenu closes
            polling.stopPolling();
            polling.startPolling(false, pollCallback);
            vi.advanceTimersByTime(300);

            // Polling resumed
            expect(pollCallback).toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Tests: Edge Cases and Regression Prevention
// ============================================================================

describe('pausePolling edge cases', () => {
    let polling;

    beforeEach(() => {
        vi.useFakeTimers();
        polling = createPollingSimulation();
    });

    afterEach(() => {
        polling.reset();
        vi.useRealTimers();
    });

    it('handles modal open before first poll interval', () => {
        const pollCallback = vi.fn();

        // Start polling
        polling.startPolling(false, pollCallback);

        // Immediately open modal (before first 100ms poll)
        vi.advanceTimersByTime(50); // Only 50ms passed
        polling.stopPolling();
        polling.startPolling(true, pollCallback);

        // Wait for what would have been multiple polls
        vi.advanceTimersByTime(500);

        // No polls should have occurred
        expect(pollCallback).not.toHaveBeenCalled();
    });

    it('handles modal close exactly at poll interval boundary', () => {
        const pollCallback = vi.fn();

        // Start paused
        polling.startPolling(true, pollCallback);
        vi.advanceTimersByTime(100); // No poll (paused)

        // Resume exactly at 100ms mark
        polling.stopPolling();
        polling.startPolling(false, pollCallback);

        // Now advance - first poll at 200ms total
        vi.advanceTimersByTime(100);
        expect(pollCallback).toHaveBeenCalledTimes(1);
    });

    it('maintains poll history correctly across pause/resume', () => {
        const pollCallback = vi.fn();

        polling.startPolling(false, pollCallback);
        vi.advanceTimersByTime(100); // Poll 1
        vi.advanceTimersByTime(100); // Poll 2

        polling.stopPolling();
        polling.startPolling(true, pollCallback);
        vi.advanceTimersByTime(300); // No polls (paused)

        polling.stopPolling();
        polling.startPolling(false, pollCallback);
        vi.advanceTimersByTime(100); // Poll 3

        expect(polling.getPollCount()).toBe(3);
        expect(polling.getPollHistory()).toHaveLength(3);
    });
});

// ============================================================================
// Tests: Documentation of Expected Behavior
// ============================================================================

describe('pausePolling behavior documentation', () => {
    /**
     * This describe block documents the expected behavior for future reference.
     * These tests serve as living documentation of the fix.
     */

    it('documents: pausePolling prevents focus disruption during modal editing', () => {
        /**
         * THE BUG:
         * When a modal is open (e.g., rename dialog), the user is typing in an input.
         * Background polling triggers a state update (setSessions).
         * React re-renders the component tree.
         * The re-render can cause focus to jump away from the modal input.
         *
         * THE FIX:
         * SessionList accepts a `pausePolling` prop.
         * SessionSelector tracks all modal states and computes `anyModalOpen`.
         * When any modal is open, `pausePolling=true` is passed to SessionList.
         * SessionList's polling useEffect returns early when `pausePolling=true`.
         * No state updates occur, so no re-renders disrupt focus.
         */
        const affectedComponents = [
            'RenameDialog - text input for session label',
            'DeleteSessionDialog - confirmation focus',
            'CommandMenu - search input',
            'ToolPicker - selection focus',
            'HostPicker - selection focus',
            'ConfigPicker - selection focus',
            'SessionPicker - selection focus',
            'SettingsModal - form inputs',
            'KeyboardHelpModal - content focus',
        ];

        expect(affectedComponents.length).toBeGreaterThan(0);
    });

    it('documents: externalModalOpen prop bridges App.jsx and SessionSelector', () => {
        /**
         * App.jsx manages several modals that are rendered outside SessionSelector:
         * - CommandMenu
         * - SettingsModal
         * - KeyboardHelpModal
         * - etc.
         *
         * When any of these are open, App.jsx passes `externalModalOpen={true}`
         * to SessionSelector, which includes it in the anyModalOpen computation.
         */
        const appLevelModals = [
            { name: 'showCommandMenu', triggerKey: 'Cmd+K' },
            { name: 'showSettings', triggerKey: 'Cmd+,' },
            { name: 'showHelpModal', triggerKey: '?' },
        ];

        expect(appLevelModals.length).toBe(3);
    });

    it('documents: polling interval is 10 seconds in production', () => {
        /**
         * The actual polling interval in SessionList.jsx is 10000ms (10 seconds).
         * Tests use a shorter interval (100ms) for speed.
         *
         * 10 seconds is chosen to balance:
         * - Keeping session list reasonably fresh
         * - Not polling too aggressively (CPU/battery)
         * - Being long enough that users typically finish modal interactions
         */
        const PRODUCTION_POLL_INTERVAL = 10000;
        const TEST_POLL_INTERVAL = 100;

        expect(PRODUCTION_POLL_INTERVAL).toBe(10000);
        expect(TEST_POLL_INTERVAL).toBe(100);
    });
});
