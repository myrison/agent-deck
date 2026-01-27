/**
 * Tests for paste duplication fix (PR #61)
 *
 * Root causes of the paste duplication bug:
 * 1. EventsOn listeners accumulated on useEffect re-runs (no cleanup)
 * 2. Cmd+V fired paste through two paths (Wails menu:paste + browser paste)
 * 3. menu:paste is global — all Terminal components received it
 *
 * Fixes applied:
 * - Capture cancel functions from all EventsOn calls and invoke them in useEffect cleanup
 * - Add e.preventDefault() to the paste key handler
 * - Add focus guard so menu:paste only writes to the focused terminal
 * - Add 100ms dedup as defense-in-depth
 *
 * Testing approach: We test the behavioral logic patterns extracted from Terminal.jsx,
 * since the actual React component requires Wails bindings. Each test verifies
 * observable behavior (what gets written to the terminal), not implementation details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// EventsOn Listener Lifecycle Simulator
// ============================================================================

/**
 * Simulates the Wails EventsOn/cancel pattern used in Terminal.jsx.
 *
 * The real Wails EventsOn returns a cancel function. Before the fix,
 * Terminal.jsx did not capture or call these cancel functions, so
 * listeners accumulated across useEffect re-runs.
 */
function createEventBus() {
    const listeners = new Map(); // eventName -> Set<handler>

    return {
        /**
         * Register a listener. Returns a cancel function that removes
         * only THIS specific listener (not all listeners for the event).
         */
        EventsOn(eventName, handler) {
            if (!listeners.has(eventName)) {
                listeners.set(eventName, new Set());
            }
            listeners.get(eventName).add(handler);

            // Return cancel function (like real Wails runtime)
            return () => {
                const set = listeners.get(eventName);
                if (set) {
                    set.delete(handler);
                    if (set.size === 0) listeners.delete(eventName);
                }
            };
        },

        /** Emit an event to all registered listeners */
        emit(eventName, data) {
            const set = listeners.get(eventName);
            if (set) {
                for (const handler of set) {
                    handler(data);
                }
            }
        },

        /** Get the number of listeners for an event */
        listenerCount(eventName) {
            return listeners.get(eventName)?.size || 0;
        },
    };
}

// ============================================================================
// Terminal Paste Handler Simulator
// ============================================================================

/**
 * Simulates the menu:paste handler logic from Terminal.jsx.
 * Returns what would be written to the terminal.
 */
function createPasteHandler() {
    let isFocused = false;
    let lastPaste = { text: '', time: 0 };
    const writes = [];

    return {
        setFocused(focused) {
            isFocused = focused;
        },

        /**
         * Handles a menu:paste event, applying focus guard and dedup.
         * Mirrors the handleMenuPaste function in Terminal.jsx.
         */
        handleMenuPaste(text, now = Date.now()) {
            // Guard: terminal must exist (simulated as always true here)
            // Guard: terminal must be focused
            if (!isFocused) return;

            if (text && text.length > 0) {
                // Dedup: skip if identical text pasted within 100ms
                if (text === lastPaste.text && now - lastPaste.time < 100) {
                    return;
                }
                lastPaste = { text, time: now };
                writes.push(text);
            }
        },

        getWrites() {
            return [...writes];
        },

        clearWrites() {
            writes.length = 0;
        },
    };
}

// ============================================================================
// Tests: Listener Cleanup Prevents Accumulation
// ============================================================================

describe('EventsOn listener cleanup (root cause #1)', () => {
    it('listeners accumulate when cancel functions are not called', () => {
        const bus = createEventBus();
        const writes = [];

        // Simulate 3 useEffect mount cycles WITHOUT cleanup (the bug)
        for (let i = 0; i < 3; i++) {
            bus.EventsOn('menu:paste', (text) => {
                writes.push(text);
            });
            // No cleanup — cancel function is discarded
        }

        // One paste event triggers all 3 accumulated listeners
        bus.emit('menu:paste', 'hello');
        expect(writes).toEqual(['hello', 'hello', 'hello']);
        expect(bus.listenerCount('menu:paste')).toBe(3);
    });

    it('listeners do not accumulate when cancel functions are called on cleanup', () => {
        const bus = createEventBus();
        const writes = [];

        // Simulate 3 useEffect mount/cleanup cycles WITH the fix
        let cancel = null;
        for (let i = 0; i < 3; i++) {
            // Cleanup previous listener (simulates useEffect return)
            if (cancel) cancel();

            // Register new listener (simulates useEffect body)
            cancel = bus.EventsOn('menu:paste', (text) => {
                writes.push(text);
            });
        }

        // One paste event triggers exactly 1 listener
        bus.emit('menu:paste', 'hello');
        expect(writes).toEqual(['hello']);
        expect(bus.listenerCount('menu:paste')).toBe(1);
    });

    it('cancel removes only the specific listener, not all listeners for the event', () => {
        const bus = createEventBus();
        const writesA = [];
        const writesB = [];

        // Two different terminals register paste listeners
        const cancelA = bus.EventsOn('menu:paste', (text) => writesA.push(text));
        const cancelB = bus.EventsOn('menu:paste', (text) => writesB.push(text));

        expect(bus.listenerCount('menu:paste')).toBe(2);

        // Terminal A unmounts, cancels its listener
        cancelA();

        expect(bus.listenerCount('menu:paste')).toBe(1);

        // Paste event fires — only Terminal B receives it
        bus.emit('menu:paste', 'hello');
        expect(writesA).toEqual([]);
        expect(writesB).toEqual(['hello']);
    });

    it('cleanup of all 12 event listeners leaves zero listeners', () => {
        const bus = createEventBus();
        const eventNames = [
            'terminal:altscreen',
            'settings:autoCopyOnSelect',
            'terminal:debug',
            'menu:paste',
            'menu:copy',
            'terminal:history',
            'terminal:data',
            'terminal:exit',
            'terminal:connection-lost',
            'terminal:reconnecting',
            'terminal:connection-restored',
            'terminal:connection-failed',
        ];

        // Register all 12 listeners and collect cancel functions
        const cancels = eventNames.map(name =>
            bus.EventsOn(name, () => {})
        );

        // Verify all registered
        for (const name of eventNames) {
            expect(bus.listenerCount(name)).toBe(1);
        }

        // Cleanup: call all cancel functions (simulates useEffect return)
        for (const cancel of cancels) {
            cancel();
        }

        // Verify all removed
        for (const name of eventNames) {
            expect(bus.listenerCount(name)).toBe(0);
        }
    });
});

// ============================================================================
// Tests: Focus Guard for Multi-Pane Paste Isolation
// ============================================================================

describe('Focus guard for paste events (root cause #3)', () => {
    it('paste writes to the focused terminal only', () => {
        const terminalA = createPasteHandler();
        const terminalB = createPasteHandler();

        // Terminal A is focused, Terminal B is not
        terminalA.setFocused(true);
        terminalB.setFocused(false);

        // Global menu:paste fires to both
        terminalA.handleMenuPaste('hello world');
        terminalB.handleMenuPaste('hello world');

        expect(terminalA.getWrites()).toEqual(['hello world']);
        expect(terminalB.getWrites()).toEqual([]);
    });

    it('paste writes to neither terminal when none is focused', () => {
        const terminalA = createPasteHandler();
        const terminalB = createPasteHandler();

        terminalA.setFocused(false);
        terminalB.setFocused(false);

        terminalA.handleMenuPaste('hello world');
        terminalB.handleMenuPaste('hello world');

        expect(terminalA.getWrites()).toEqual([]);
        expect(terminalB.getWrites()).toEqual([]);
    });

    it('switching focus changes which terminal receives paste', () => {
        const terminalA = createPasteHandler();
        const terminalB = createPasteHandler();

        // First paste: A is focused
        terminalA.setFocused(true);
        terminalB.setFocused(false);
        terminalA.handleMenuPaste('first paste');
        terminalB.handleMenuPaste('first paste');

        // Switch focus to B
        terminalA.setFocused(false);
        terminalB.setFocused(true);
        terminalA.handleMenuPaste('second paste');
        terminalB.handleMenuPaste('second paste');

        expect(terminalA.getWrites()).toEqual(['first paste']);
        expect(terminalB.getWrites()).toEqual(['second paste']);
    });

    it('ignores empty or null paste text regardless of focus', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        terminal.handleMenuPaste('');
        terminal.handleMenuPaste(null);
        terminal.handleMenuPaste(undefined);

        expect(terminal.getWrites()).toEqual([]);
    });
});

// ============================================================================
// Tests: Dedup Mechanism (Defense-in-Depth)
// ============================================================================

describe('Paste dedup mechanism (defense-in-depth)', () => {
    it('blocks identical text pasted within 100ms', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        const baseTime = 1000000;
        terminal.handleMenuPaste('hello', baseTime);
        terminal.handleMenuPaste('hello', baseTime + 50); // 50ms later — blocked

        expect(terminal.getWrites()).toEqual(['hello']);
    });

    it('allows identical text pasted after 100ms', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        const baseTime = 1000000;
        terminal.handleMenuPaste('hello', baseTime);
        terminal.handleMenuPaste('hello', baseTime + 100); // exactly 100ms — allowed

        expect(terminal.getWrites()).toEqual(['hello', 'hello']);
    });

    it('allows different text pasted within 100ms', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        const baseTime = 1000000;
        terminal.handleMenuPaste('hello', baseTime);
        terminal.handleMenuPaste('world', baseTime + 10); // different text — allowed

        expect(terminal.getWrites()).toEqual(['hello', 'world']);
    });

    it('resets dedup timer after each successful paste', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        const baseTime = 1000000;
        terminal.handleMenuPaste('hello', baseTime);             // written
        terminal.handleMenuPaste('hello', baseTime + 50);        // blocked (50ms)
        terminal.handleMenuPaste('hello', baseTime + 100);       // written (100ms from first)
        terminal.handleMenuPaste('hello', baseTime + 150);       // blocked (50ms from third)
        terminal.handleMenuPaste('hello', baseTime + 200);       // written (100ms from third)

        expect(terminal.getWrites()).toEqual(['hello', 'hello', 'hello']);
    });

    it('handles rapid multi-line paste content correctly', () => {
        const terminal = createPasteHandler();
        terminal.setFocused(true);

        const multilineText = 'line1\nline2\nline3\nline4\nline5';
        const baseTime = 1000000;

        // Simulate the original bug: same text fired multiple times rapidly
        terminal.handleMenuPaste(multilineText, baseTime);
        terminal.handleMenuPaste(multilineText, baseTime + 5);
        terminal.handleMenuPaste(multilineText, baseTime + 10);
        terminal.handleMenuPaste(multilineText, baseTime + 15);
        terminal.handleMenuPaste(multilineText, baseTime + 20);

        // Only the first should go through
        expect(terminal.getWrites()).toEqual([multilineText]);
    });
});

// ============================================================================
// Tests: preventDefault in Paste Key Handler
// ============================================================================

describe('Paste key handler preventDefault (root cause #2)', () => {
    /**
     * Simulates the paste key detection logic from Terminal.jsx.
     * Before the fix, Cmd+V would both:
     *   1. Fire the browser paste event (which xterm.js would process)
     *   2. Fire via Wails menu:paste
     * The fix adds e.preventDefault() to block path #1.
     */
    function simulatePasteKeyHandler(e, isMac) {
        if (e.type !== 'keydown') return true;

        const isPaste = e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey &&
            (isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey));

        if (isPaste) {
            e.preventDefault(); // The fix: prevent browser paste
            return false;
        }

        return true;
    }

    function createKeyEvent(key, options = {}) {
        let defaultPrevented = false;
        return {
            key,
            type: options.type || 'keydown',
            metaKey: options.metaKey || false,
            ctrlKey: options.ctrlKey || false,
            shiftKey: options.shiftKey || false,
            altKey: options.altKey || false,
            preventDefault() { defaultPrevented = true; },
            get defaultPrevented() { return defaultPrevented; },
        };
    }

    it('Cmd+V on macOS calls preventDefault and returns false', () => {
        const event = createKeyEvent('v', { metaKey: true });
        const result = simulatePasteKeyHandler(event, true);

        expect(result).toBe(false);
        expect(event.defaultPrevented).toBe(true);
    });

    it('Ctrl+V on Windows/Linux calls preventDefault and returns false', () => {
        const event = createKeyEvent('v', { ctrlKey: true });
        const result = simulatePasteKeyHandler(event, false);

        expect(result).toBe(false);
        expect(event.defaultPrevented).toBe(true);
    });

    it('Ctrl+V on macOS does NOT preventDefault (used for image paste)', () => {
        const event = createKeyEvent('v', { ctrlKey: true });
        const result = simulatePasteKeyHandler(event, true);

        expect(result).toBe(true); // Let xterm handle it
        expect(event.defaultPrevented).toBe(false);
    });

    it('keyup events are ignored (only keydown is processed)', () => {
        const event = createKeyEvent('v', { metaKey: true, type: 'keyup' });
        const result = simulatePasteKeyHandler(event, true);

        expect(result).toBe(true);
        expect(event.defaultPrevented).toBe(false);
    });

    it('non-paste key combos are not affected', () => {
        const event = createKeyEvent('c', { metaKey: true });
        const result = simulatePasteKeyHandler(event, true);

        expect(result).toBe(true);
        expect(event.defaultPrevented).toBe(false);
    });
});

// ============================================================================
// Tests: End-to-End Scenario Simulations
// ============================================================================

describe('End-to-end paste scenarios', () => {
    it('simulates the original bug: useEffect re-runs cause duplicate pastes', () => {
        const bus = createEventBus();
        const writes = [];

        // Simulate: Terminal mounts 5 times (React re-renders, dep changes)
        // WITHOUT the fix — no cleanup, listeners accumulate
        for (let i = 0; i < 5; i++) {
            bus.EventsOn('menu:paste', (text) => writes.push(text));
        }

        bus.emit('menu:paste', 'multi-line\ncontent\nhere');

        // Bug: paste appears 5 times
        expect(writes).toHaveLength(5);
        expect(writes.every(w => w === 'multi-line\ncontent\nhere')).toBe(true);
    });

    it('simulates the fix: cleanup prevents duplicate pastes', () => {
        const bus = createEventBus();
        const writes = [];

        // Simulate: Terminal mounts 5 times WITH cleanup (the fix)
        let cancel = null;
        for (let i = 0; i < 5; i++) {
            if (cancel) cancel();
            cancel = bus.EventsOn('menu:paste', (text) => writes.push(text));
        }

        bus.emit('menu:paste', 'multi-line\ncontent\nhere');

        // Fix: paste appears exactly once
        expect(writes).toHaveLength(1);
        expect(writes[0]).toBe('multi-line\ncontent\nhere');
    });

    it('simulates multi-pane scenario: only focused pane receives paste', () => {
        const bus = createEventBus();
        const paneA = createPasteHandler();
        const paneB = createPasteHandler();
        const paneC = createPasteHandler();

        // Each pane registers its own paste listener
        bus.EventsOn('menu:paste', (text) => paneA.handleMenuPaste(text));
        bus.EventsOn('menu:paste', (text) => paneB.handleMenuPaste(text));
        bus.EventsOn('menu:paste', (text) => paneC.handleMenuPaste(text));

        // Pane B is focused
        paneA.setFocused(false);
        paneB.setFocused(true);
        paneC.setFocused(false);

        // Global menu:paste fires
        bus.emit('menu:paste', 'paste content');

        // Only pane B received it
        expect(paneA.getWrites()).toEqual([]);
        expect(paneB.getWrites()).toEqual(['paste content']);
        expect(paneC.getWrites()).toEqual([]);
    });

    it('simulates the combined fix: cleanup + focus guard + dedup', () => {
        const bus = createEventBus();
        const paneA = createPasteHandler();
        const paneB = createPasteHandler();
        const baseTime = 1000000;

        // Mount cycle 1
        let cancelA1 = bus.EventsOn('menu:paste', (text) => paneA.handleMenuPaste(text, baseTime));
        let cancelB1 = bus.EventsOn('menu:paste', (text) => paneB.handleMenuPaste(text, baseTime));

        // Mount cycle 2 — with cleanup
        cancelA1();
        cancelB1();
        let cancelA2 = bus.EventsOn('menu:paste', (text) => paneA.handleMenuPaste(text, baseTime));
        let cancelB2 = bus.EventsOn('menu:paste', (text) => paneB.handleMenuPaste(text, baseTime));

        // Only pane A focused
        paneA.setFocused(true);
        paneB.setFocused(false);

        // Fire paste — only pane A should receive, exactly once
        bus.emit('menu:paste', 'test paste');

        expect(paneA.getWrites()).toEqual(['test paste']);
        expect(paneB.getWrites()).toEqual([]);
        expect(bus.listenerCount('menu:paste')).toBe(2); // Both registered, focus guard filters

        // Cleanup
        cancelA2();
        cancelB2();
        expect(bus.listenerCount('menu:paste')).toBe(0);
    });
});
