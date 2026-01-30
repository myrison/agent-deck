/**
 * Tests for cursor position fix behavior (PR #113)
 *
 * These tests verify the scroll-on-click bug fix in Terminal.jsx that prevents
 * cursor position jumps when clicking in the terminal.
 *
 * The fix has two components:
 * 1. Direct buffer check for isScrolledUp (instead of cached ref)
 * 2. Grace period protection after alt-screen exit
 *
 * Since Terminal.jsx depends on xterm.js and Wails bindings that can't be easily
 * rendered in tests, we use BEHAVIORAL EXTRACTION to test the logic directly.
 * This mirrors the approach used in terminalWheelHandling.test.js.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// BEHAVIORAL EXTRACTION: forceAltKeyWhenScrolled decision logic
// =============================================================================
// Mirrors Terminal.jsx lines 192-206 (forceAltKeyWhenScrolled function)
//
// Production code:
//   const forceAltKeyWhenScrolled = (e) => {
//       const buffer = term.buffer.active;
//       const isScrolledUp = buffer.viewportY < buffer.baseY;
//       const inGracePeriod = (Date.now() - altScreenExitTime) < ALT_SCREEN_EXIT_GRACE_MS;
//       if (isScrolledUp || inGracePeriod) {
//           Object.defineProperty(e, 'altKey', { get: () => true, configurable: true });
//       }
//   };
// =============================================================================

/**
 * Determines if altKey should be forced on a mouse event to prevent cursor jumps.
 *
 * Mirrors the decision logic in Terminal.jsx forceAltKeyWhenScrolled
 *
 * @param {Object} params
 * @param {number} params.viewportY - Current viewport position
 * @param {number} params.baseY - Base scroll position (end of history)
 * @param {number} params.altScreenExitTime - Timestamp when alt-screen was exited (0 if not applicable)
 * @param {number} params.currentTime - Current timestamp (Date.now())
 * @param {number} params.gracePeriodMs - Grace period duration in ms (500 in production)
 * @returns {boolean} True if altKey should be forced
 */
function shouldForceAltKey({ viewportY, baseY, altScreenExitTime, currentTime, gracePeriodMs }) {
    const isScrolledUp = viewportY < baseY;
    const inGracePeriod = (currentTime - altScreenExitTime) < gracePeriodMs;
    return isScrolledUp || inGracePeriod;
}

/**
 * Simulates buffer state for testing.
 * In production, this comes from term.buffer.active
 */
function createMockBuffer(viewportY, baseY) {
    return { viewportY, baseY };
}

/**
 * Creates an alt-screen exit tracker that records exit timestamps.
 * Mirrors the altScreenExitTime variable behavior in Terminal.jsx (lines 189-190, 249-251)
 *
 * Production code:
 *   let altScreenExitTime = 0;
 *   const ALT_SCREEN_EXIT_GRACE_MS = 500;
 *   ...
 *   if (wasInAltScreen && !isInAltScreen) {
 *       ...
 *       altScreenExitTime = Date.now();
 *   }
 */
function createAltScreenTracker(gracePeriodMs = 500) {
    let exitTime = 0;

    return {
        /**
         * Record alt-screen exit (called when exiting Claude Code, vim, etc.)
         * Mirrors: altScreenExitTime = Date.now();
         */
        recordExit(timestamp) {
            exitTime = timestamp;
        },

        /**
         * Check if currently in grace period
         * Mirrors: (Date.now() - altScreenExitTime) < ALT_SCREEN_EXIT_GRACE_MS
         */
        isInGracePeriod(currentTime) {
            return (currentTime - exitTime) < gracePeriodMs;
        },

        /**
         * Get the exit timestamp
         */
        getExitTime() {
            return exitTime;
        },

        /**
         * Reset to initial state
         */
        reset() {
            exitTime = 0;
        },
    };
}

// =============================================================================
// TESTS: isScrolledUp detection (direct buffer check)
// =============================================================================

describe('isScrolledUp detection', () => {
    const ALT_SCREEN_EXIT_GRACE_MS = 500;

    it('returns false when at bottom (viewportY equals baseY)', () => {
        // User is at the bottom of scrollback - cursor clicks should work normally
        const buffer = createMockBuffer(100, 100);
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(false);
    });

    it('returns true when scrolled up (viewportY less than baseY)', () => {
        // User has scrolled up to view history - clicks should be intercepted
        const buffer = createMockBuffer(50, 100);
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns true when scrolled up by just one line', () => {
        // Edge case: minimal scroll should still trigger protection
        const buffer = createMockBuffer(99, 100);
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns true when scrolled to very top of history', () => {
        // User scrolled to the very beginning
        const buffer = createMockBuffer(0, 1000);
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('handles empty terminal (both values zero)', () => {
        // Fresh terminal with no scrollback
        const buffer = createMockBuffer(0, 0);
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(false);
    });
});

// =============================================================================
// TESTS: Grace period protection after alt-screen exit
// =============================================================================

describe('Alt-screen exit grace period', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const ALT_SCREEN_EXIT_GRACE_MS = 500;

    it('returns true during grace period after alt-screen exit', () => {
        const now = 1000;
        vi.setSystemTime(now);

        // Alt-screen just exited
        const altScreenExitTime = now - 100; // 100ms ago

        // User is at bottom (not scrolled up), but within grace period
        const result = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns false after grace period expires', () => {
        const now = 1000;
        vi.setSystemTime(now);

        // Alt-screen exited 600ms ago (past the 500ms grace period)
        const altScreenExitTime = now - 600;

        // User is at bottom
        const result = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(false);
    });

    it('returns true at exactly 499ms (just before expiry)', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const altScreenExitTime = now - 499;

        const result = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns false at exactly 500ms (at expiry)', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const altScreenExitTime = now - 500;

        const result = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(false);
    });

    it('returns false when no alt-screen exit has occurred (exitTime = 0)', () => {
        const now = 1000;
        vi.setSystemTime(now);

        // No alt-screen exit (default state)
        const result = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        // Note: 1000 - 0 = 1000, which is >= 500, so not in grace period
        expect(result).toBe(false);
    });
});

// =============================================================================
// TESTS: Alt-screen tracker (stateful manager)
// =============================================================================

describe('Alt-screen tracker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const GRACE_PERIOD_MS = 500;

    it('starts with no grace period active', () => {
        const tracker = createAltScreenTracker(GRACE_PERIOD_MS);
        vi.setSystemTime(1000);

        expect(tracker.isInGracePeriod(Date.now())).toBe(false);
        expect(tracker.getExitTime()).toBe(0);
    });

    it('activates grace period when alt-screen exit is recorded', () => {
        const tracker = createAltScreenTracker(GRACE_PERIOD_MS);
        const exitTime = 1000;
        vi.setSystemTime(exitTime);

        tracker.recordExit(exitTime);

        // Immediately after exit
        expect(tracker.isInGracePeriod(Date.now())).toBe(true);
        expect(tracker.getExitTime()).toBe(exitTime);
    });

    it('grace period expires after configured duration', () => {
        const tracker = createAltScreenTracker(GRACE_PERIOD_MS);
        vi.setSystemTime(1000);

        tracker.recordExit(1000);

        // During grace period
        vi.advanceTimersByTime(GRACE_PERIOD_MS - 1);
        expect(tracker.isInGracePeriod(Date.now())).toBe(true);

        // At expiry
        vi.advanceTimersByTime(1);
        expect(tracker.isInGracePeriod(Date.now())).toBe(false);
    });

    it('resets when reset() is called', () => {
        const tracker = createAltScreenTracker(GRACE_PERIOD_MS);
        vi.setSystemTime(1000);

        tracker.recordExit(1000);
        expect(tracker.isInGracePeriod(Date.now())).toBe(true);

        tracker.reset();
        expect(tracker.isInGracePeriod(Date.now())).toBe(false);
        expect(tracker.getExitTime()).toBe(0);
    });
});

// =============================================================================
// TESTS: Combined behavior (scrolled state + grace period)
// =============================================================================

describe('Combined isScrolledUp and grace period', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const ALT_SCREEN_EXIT_GRACE_MS = 500;

    it('returns true when both scrolled up AND in grace period', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const result = shouldForceAltKey({
            viewportY: 50, // scrolled up
            baseY: 100,
            altScreenExitTime: now - 100, // in grace period
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns true when scrolled up but NOT in grace period', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const result = shouldForceAltKey({
            viewportY: 50, // scrolled up
            baseY: 100,
            altScreenExitTime: now - 600, // expired
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns true when NOT scrolled up but in grace period', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const result = shouldForceAltKey({
            viewportY: 100, // at bottom
            baseY: 100,
            altScreenExitTime: now - 100, // in grace period
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);
    });

    it('returns false when neither scrolled up nor in grace period', () => {
        const now = 1000;
        vi.setSystemTime(now);

        const result = shouldForceAltKey({
            viewportY: 100, // at bottom
            baseY: 100,
            altScreenExitTime: now - 600, // expired
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(false);
    });
});

// =============================================================================
// TESTS: Event modification behavior
// =============================================================================

describe('Event altKey modification', () => {
    /**
     * Simulates the event modification performed by forceAltKeyWhenScrolled.
     * Mirrors Terminal.jsx line 204:
     *   Object.defineProperty(e, 'altKey', { get: () => true, configurable: true });
     */
    function applyAltKeyFix(event, shouldForce) {
        if (shouldForce) {
            Object.defineProperty(event, 'altKey', {
                get: () => true,
                configurable: true,
            });
        }
    }

    it('modifies event altKey to true when fix should be applied', () => {
        const mockEvent = { altKey: false, type: 'mousedown' };

        applyAltKeyFix(mockEvent, true);

        expect(mockEvent.altKey).toBe(true);
    });

    it('leaves event unchanged when fix should not be applied', () => {
        const mockEvent = { altKey: false, type: 'mousedown' };

        applyAltKeyFix(mockEvent, false);

        expect(mockEvent.altKey).toBe(false);
    });

    it('overrides existing altKey value when fix is applied', () => {
        // Even if user is actually holding alt, the getter returns true
        const mockEvent = { altKey: true, type: 'mousedown' };

        applyAltKeyFix(mockEvent, true);

        expect(mockEvent.altKey).toBe(true); // Still true (no harm)
    });

    it('makes altKey configurable for potential later modification', () => {
        const mockEvent = { altKey: false, type: 'mousedown' };

        applyAltKeyFix(mockEvent, true);

        // The property should be configurable
        const descriptor = Object.getOwnPropertyDescriptor(mockEvent, 'altKey');
        expect(descriptor.configurable).toBe(true);
    });
});

// =============================================================================
// END-TO-END TESTS: Complete cursor protection flow
// =============================================================================

describe('End-to-end cursor protection scenarios', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const ALT_SCREEN_EXIT_GRACE_MS = 500;

    it('protects clicks during Claude Code exit transition', () => {
        const tracker = createAltScreenTracker(ALT_SCREEN_EXIT_GRACE_MS);
        const baseTime = 1000;

        // Simulate: Claude Code is running (alt-screen active)
        // ... user is at bottom, not scrolled up

        // Claude Code exits at t=1000
        vi.setSystemTime(baseTime);
        tracker.recordExit(baseTime);

        // Click immediately after exit (t=1050, 50ms later)
        vi.setSystemTime(baseTime + 50);
        const click1 = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime: tracker.getExitTime(),
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(click1).toBe(true); // Protected

        // Click at t=1300 (300ms after exit)
        vi.setSystemTime(baseTime + 300);
        const click2 = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime: tracker.getExitTime(),
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(click2).toBe(true); // Still protected

        // Click at t=1600 (600ms after exit)
        vi.setSystemTime(baseTime + 600);
        const click3 = shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime: tracker.getExitTime(),
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(click3).toBe(false); // Grace period expired, normal behavior
    });

    it('protects clicks when user scrolls up to view history', () => {
        // User scrolls up to read previous output
        const buffer = createMockBuffer(50, 200);

        // Click while scrolled up
        const result = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result).toBe(true);

        // User scrolls back to bottom
        buffer.viewportY = 200;

        // Click at bottom
        const result2 = shouldForceAltKey({
            viewportY: buffer.viewportY,
            baseY: buffer.baseY,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        });
        expect(result2).toBe(false); // No protection needed
    });

    it('handles multiple alt-screen transitions correctly', () => {
        const tracker = createAltScreenTracker(ALT_SCREEN_EXIT_GRACE_MS);
        const baseTime = 1000;

        // First Claude Code session exits
        vi.setSystemTime(baseTime);
        tracker.recordExit(baseTime);

        // Wait for grace period to expire
        vi.setSystemTime(baseTime + 600);
        expect(tracker.isInGracePeriod(Date.now())).toBe(false);

        // Start and exit another Claude Code session
        const secondExitTime = baseTime + 1000;
        vi.setSystemTime(secondExitTime);
        tracker.recordExit(secondExitTime);

        // New grace period should be active
        vi.setSystemTime(secondExitTime + 100);
        expect(tracker.isInGracePeriod(Date.now())).toBe(true);
    });

    it('handles rapid clicking during output', () => {
        // Simulates user clicking repeatedly while Claude generates output
        // Buffer state changes between clicks
        const baseTime = 1000;
        vi.setSystemTime(baseTime);

        const clickResults = [];

        // Click 1: at bottom
        clickResults.push(shouldForceAltKey({
            viewportY: 100,
            baseY: 100,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        }));

        // Output arrives, buffer grows, but user is auto-scrolled to bottom
        // Click 2: still at bottom
        clickResults.push(shouldForceAltKey({
            viewportY: 150,
            baseY: 150,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        }));

        // User scrolls up to see something
        // Click 3: scrolled up
        clickResults.push(shouldForceAltKey({
            viewportY: 100,
            baseY: 200,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        }));

        // User scrolls back to bottom
        // Click 4: at bottom again
        clickResults.push(shouldForceAltKey({
            viewportY: 200,
            baseY: 200,
            altScreenExitTime: 0,
            currentTime: Date.now(),
            gracePeriodMs: ALT_SCREEN_EXIT_GRACE_MS,
        }));

        expect(clickResults).toEqual([false, false, true, false]);
    });
});
