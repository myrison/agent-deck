/**
 * Tests for terminal paste functionality
 *
 * These tests verify that the custom key event handler correctly allows
 * paste operations to pass through to the browser, which triggers the
 * native paste event that xterm.js handles.
 *
 * Platform-specific behavior:
 * - macOS: Cmd+V is paste. Ctrl+V passes through to terminal (Claude Code uses it for image paste)
 * - Windows/Linux: Ctrl+V is paste
 *
 * Background: xterm.js attachCustomKeyEventHandler works as follows:
 * - return true: xterm.js handles the key
 * - return false: browser handles the key (needed for paste to work)
 *
 * For paste to work, we MUST return false so the browser can trigger the
 * native paste event, which xterm.js then receives and processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock navigator.platform for platform detection tests
const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

function mockPlatform(platform) {
    Object.defineProperty(navigator, 'platform', {
        value: platform,
        writable: true,
        configurable: true,
    });
}

function restorePlatform() {
    if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
    }
}

/**
 * Simulates the paste detection logic from Terminal.jsx's attachCustomKeyEventHandler.
 * This is the exact logic used in the component.
 */
function isPasteShortcut(e, isMac) {
    return e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey &&
        (isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey));
}

/**
 * Simulates the custom key event handler's decision for paste shortcuts.
 * Returns true if browser should handle (handler returns false), false otherwise.
 */
function shouldBrowserHandlePaste(e, isMac) {
    if (isPasteShortcut(e, isMac)) {
        return true; // Browser should handle paste
    }
    return false; // xterm.js handles other keys
}

describe('Terminal paste functionality', () => {
    describe('macOS paste behavior', () => {
        const isMac = true;

        it('should detect Cmd+V as paste on macOS', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(true);
        });

        it('should detect uppercase V with Cmd as paste on macOS', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'V',
            };
            expect(isPasteShortcut(event, isMac)).toBe(true);
        });

        it('should NOT detect Ctrl+V as paste on macOS (used for Claude Code image paste)', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // Ctrl+V on Mac should pass through to terminal for Claude Code image paste
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Cmd+Ctrl+V as paste on macOS', () => {
            const event = {
                metaKey: true,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // Both modifiers = not a standard paste
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Cmd+Shift+V as paste (paste-without-formatting)', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Cmd+Alt+V as paste', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: true,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Cmd+C as paste (that is copy)', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'c',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect plain V key as paste', () => {
            const event = {
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });
    });

    describe('Windows/Linux paste behavior', () => {
        const isMac = false;

        it('should detect Ctrl+V as paste on Windows/Linux', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(true);
        });

        it('should detect uppercase V with Ctrl as paste on Windows/Linux', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'V',
            };
            expect(isPasteShortcut(event, isMac)).toBe(true);
        });

        it('should NOT detect Cmd+V as paste on Windows/Linux (no Cmd key)', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // Meta key on Windows is the Windows key, not used for paste
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Ctrl+Shift+V as paste (paste-without-formatting)', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: true,
                altKey: false,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });

        it('should NOT detect Ctrl+Alt+V as paste', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: true,
                key: 'v',
            };
            expect(isPasteShortcut(event, isMac)).toBe(false);
        });
    });

    describe('Custom key handler paste behavior', () => {
        it('should let browser handle Cmd+V on macOS', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            expect(shouldBrowserHandlePaste(event, true)).toBe(true);
        });

        it('should NOT let browser handle Ctrl+V on macOS (passes to terminal)', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // Ctrl+V on Mac should go to terminal for Claude Code image paste
            expect(shouldBrowserHandlePaste(event, true)).toBe(false);
        });

        it('should let browser handle Ctrl+V on Windows/Linux', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            expect(shouldBrowserHandlePaste(event, false)).toBe(true);
        });

        it('should let xterm handle other Cmd+key combinations', () => {
            const event = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'k',
            };
            expect(shouldBrowserHandlePaste(event, true)).toBe(false);
        });

        it('should let xterm handle plain character keys', () => {
            const event = {
                metaKey: false,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'a',
            };
            expect(shouldBrowserHandlePaste(event, true)).toBe(false);
        });
    });

    describe('Claude Code image paste (Ctrl+V on Mac)', () => {
        it('should allow Ctrl+V to pass through to terminal on macOS', () => {
            const event = {
                metaKey: false,
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // On Mac, Ctrl+V should NOT be intercepted as paste
            // It should pass through to the terminal so Claude Code can use it for image paste
            expect(isPasteShortcut(event, true)).toBe(false);
            expect(shouldBrowserHandlePaste(event, true)).toBe(false);
        });

        it('should NOT affect text paste (Cmd+V) on macOS', () => {
            const cmdV = {
                metaKey: true,
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                key: 'v',
            };
            // Cmd+V should still trigger browser paste for text
            expect(isPasteShortcut(cmdV, true)).toBe(true);
            expect(shouldBrowserHandlePaste(cmdV, true)).toBe(true);
        });
    });

    describe('Integration expectations', () => {
        it('documents the expected behavior: platform-specific paste shortcuts', () => {
            // This test documents the critical platform-specific behavior:
            //
            // macOS:
            // - Cmd+V -> browser paste (for text) -> xterm.js onData
            // - Ctrl+V -> terminal (for Claude Code image paste)
            //
            // Windows/Linux:
            // - Ctrl+V -> browser paste (for text) -> xterm.js onData
            // - Cmd/Meta+V -> not used (Meta = Windows key)

            const cmdV = { metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: 'v' };
            const ctrlV = { metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, key: 'v' };

            // macOS: Cmd+V is paste, Ctrl+V passes through
            expect(shouldBrowserHandlePaste(cmdV, true)).toBe(true);
            expect(shouldBrowserHandlePaste(ctrlV, true)).toBe(false);

            // Windows/Linux: Ctrl+V is paste, Cmd+V is not standard
            expect(shouldBrowserHandlePaste(ctrlV, false)).toBe(true);
            expect(shouldBrowserHandlePaste(cmdV, false)).toBe(false);
        });
    });
});
