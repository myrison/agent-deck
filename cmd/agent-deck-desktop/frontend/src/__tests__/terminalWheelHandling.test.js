/**
 * Tests for Terminal wheel event handling behavior
 *
 * These tests verify the wheel handling logic used by Terminal.jsx:
 *
 * 1. normalizeDeltaToPixels - Converting WheelEvent deltaMode to pixels
 *    (now exported from scrollAccumulator.js and used by Terminal.jsx)
 *
 * 2. Gesture reset timer - Clearing accumulator after inactivity
 *    (tested via behavioral extraction since the timer logic is inline)
 *
 * The normalizeDeltaToPixels tests now test the REAL utility function
 * imported from scrollAccumulator.js, ensuring production code is covered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createScrollAccumulator,
    normalizeDeltaToPixels,
    PIXELS_PER_LINE_DELTA,
    PIXELS_PER_PAGE_DELTA,
} from '../utils/scrollAccumulator';

// =============================================================================
// BEHAVIORAL EXTRACTION: Gesture Reset Timer
// This mirrors the logic in Terminal.jsx handleWheel (lines 519-522, 575-578)
// The timer logic is inline in Terminal.jsx, so we extract it for testing.
// =============================================================================

/**
 * Mirrors the gesture reset timer behavior in Terminal.jsx handleWheel
 *
 * Creates a gesture reset manager that clears the accumulator after a period
 * of inactivity, preventing "gesture bleed" where leftover sub-line pixels
 * from one scroll gesture affect the next.
 *
 * Production code (Terminal.jsx lines 519-522, 575-578):
 *   let wheelResetTimer = null;
 *   const GESTURE_RESET_MS = 150;
 *   ...
 *   clearTimeout(wheelResetTimer);
 *   wheelResetTimer = setTimeout(() => scrollAcc.reset(), GESTURE_RESET_MS);
 *
 * @param {Object} scrollAcc - Scroll accumulator instance
 * @param {number} resetMs - Milliseconds to wait before reset (150ms in production)
 * @returns {Object} Manager with recordActivity() method
 */
function createGestureResetManager(scrollAcc, resetMs) {
    let resetTimer = null;

    return {
        /**
         * Record scroll activity - resets the inactivity timer
         * Mirrors: clearTimeout(wheelResetTimer);
         *          wheelResetTimer = setTimeout(() => scrollAcc.reset(), GESTURE_RESET_MS);
         */
        recordActivity() {
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => scrollAcc.reset(), resetMs);
        },
    };
}

// =============================================================================
// TESTS: normalizeDeltaToPixels (real utility function)
// =============================================================================

describe('normalizeDeltaToPixels (real utility)', () => {
    it('passes through pixel mode (deltaMode 0) unchanged', () => {
        // Most common case: macOS trackpad
        expect(normalizeDeltaToPixels(50, 0)).toBe(50);
        expect(normalizeDeltaToPixels(-30, 0)).toBe(-30);
        expect(normalizeDeltaToPixels(0, 0)).toBe(0);
    });

    it('converts line mode (deltaMode 1) to pixels at configured multiplier', () => {
        // Some mice report in lines, not pixels
        expect(normalizeDeltaToPixels(3, 1)).toBe(3 * PIXELS_PER_LINE_DELTA);
        expect(normalizeDeltaToPixels(-2, 1)).toBe(-2 * PIXELS_PER_LINE_DELTA);
        expect(normalizeDeltaToPixels(1, 1)).toBe(PIXELS_PER_LINE_DELTA);
    });

    it('converts page mode (deltaMode 2) to pixels at configured multiplier', () => {
        // Rare: some accessibility tools or special hardware
        expect(normalizeDeltaToPixels(1, 2)).toBe(PIXELS_PER_PAGE_DELTA);
        expect(normalizeDeltaToPixels(-1, 2)).toBe(-PIXELS_PER_PAGE_DELTA);
        expect(normalizeDeltaToPixels(0.5, 2)).toBe(0.5 * PIXELS_PER_PAGE_DELTA);
    });

    it('handles fractional deltaY in pixel mode', () => {
        // Trackpad precision scrolling can produce fractional values
        expect(normalizeDeltaToPixels(0.5, 0)).toBe(0.5);
        expect(normalizeDeltaToPixels(-1.5, 0)).toBe(-1.5);
    });

    it('handles fractional deltaY in line mode', () => {
        expect(normalizeDeltaToPixels(0.5, 1)).toBe(0.5 * PIXELS_PER_LINE_DELTA);
    });

    it('handles unknown deltaMode as pixel mode (fallback)', () => {
        // Defensive: treat any unknown mode as pixels
        expect(normalizeDeltaToPixels(100, 3)).toBe(100);
        expect(normalizeDeltaToPixels(100, undefined)).toBe(100);
    });
});

describe('normalizeDeltaToPixels integration with scroll accumulator', () => {
    it('line mode events trigger scroll at correct threshold', () => {
        const acc = createScrollAccumulator(100); // threshold = 60px

        // 3 lines in line mode = 60px = exactly threshold
        const deltaPixels = normalizeDeltaToPixels(3, 1);
        expect(deltaPixels).toBe(60);

        const lines = acc.accumulate(deltaPixels);
        expect(lines).toBe(1);
    });

    it('page mode events trigger multiple lines (clamped)', () => {
        const acc = createScrollAccumulator(100); // threshold = 60px

        // 1 page in page mode = 400px
        const deltaPixels = normalizeDeltaToPixels(1, 2);
        expect(deltaPixels).toBe(400);

        // 400px / 60px threshold = 6.67 lines, but clamped to MAX_LINES_PER_EVENT (5)
        const lines = acc.accumulate(deltaPixels);
        expect(lines).toBe(5); // Clamped
    });

    it('pixel mode trackpad scroll feels natural', () => {
        const acc = createScrollAccumulator(100); // threshold = 60px

        // Simulate typical trackpad scroll: small, frequent events
        const trackpadDeltas = [5, 10, 15, 20, 15, 10, 5]; // Total = 80px
        let totalLines = 0;

        for (const delta of trackpadDeltas) {
            const pixels = normalizeDeltaToPixels(delta, 0);
            totalLines += acc.accumulate(pixels);
        }

        // 80px / 60px = 1.33 lines, should trigger 1 line
        expect(totalLines).toBe(1);
        expect(acc.getValue()).toBe(20); // Remainder: 80 % 60 = 20
    });
});

// =============================================================================
// TESTS: Gesture Reset Timer (behavioral extraction)
// =============================================================================

describe('Gesture reset timer behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const GESTURE_RESET_MS = 150; // Matches production value in Terminal.jsx

    it('resets accumulator after inactivity period', () => {
        const acc = createScrollAccumulator(100);
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Build up some accumulator value
        acc.accumulate(30); // Below threshold, banked
        expect(acc.getValue()).toBe(30);

        // Record activity (simulates wheel event)
        manager.recordActivity();

        // Advance time just before reset
        vi.advanceTimersByTime(GESTURE_RESET_MS - 1);
        expect(acc.getValue()).toBe(30); // Not reset yet

        // Advance past reset time
        vi.advanceTimersByTime(2);
        expect(acc.getValue()).toBe(0); // Reset!
    });

    it('extends reset timer on continued activity', () => {
        const acc = createScrollAccumulator(100);
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        acc.accumulate(30);
        manager.recordActivity();

        // Advance partway, then record more activity
        vi.advanceTimersByTime(100);
        expect(acc.getValue()).toBe(30);

        acc.accumulate(10);
        manager.recordActivity(); // Resets the timer

        // Advance another 100ms (total 200ms since first event)
        vi.advanceTimersByTime(100);
        expect(acc.getValue()).toBe(40); // Still not reset

        // Advance past new timeout (150ms from second activity)
        vi.advanceTimersByTime(60);
        expect(acc.getValue()).toBe(0); // Now reset
    });

    it('prevents gesture bleed between separate scroll gestures', () => {
        const acc = createScrollAccumulator(100); // threshold = 60
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // First gesture: accumulate 30px (below threshold)
        acc.accumulate(30);
        manager.recordActivity();
        expect(acc.getValue()).toBe(30);

        // Wait for gesture to end
        vi.advanceTimersByTime(GESTURE_RESET_MS + 10);
        expect(acc.getValue()).toBe(0); // Reset

        // Second gesture starts fresh
        const lines = acc.accumulate(65); // Should trigger 1 line
        expect(lines).toBe(1);
        expect(acc.getValue()).toBe(5); // 65 % 60 = 5
    });

    it('does not interfere with rapid continuous scrolling', () => {
        const acc = createScrollAccumulator(100); // threshold = 60
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Rapid scroll events (faster than reset timeout)
        let totalLines = 0;
        for (let i = 0; i < 10; i++) {
            totalLines += acc.accumulate(20); // 20px per event
            manager.recordActivity();
            vi.advanceTimersByTime(50); // 50ms between events (faster than 150ms)
        }

        // 200px total / 60px threshold = 3.33 lines
        expect(totalLines).toBe(3);
        // Remainder preserved throughout (no reset during scroll)
        expect(acc.getValue()).toBe(200 % 60); // 20px
    });
});

describe('Gesture reset realistic scenarios', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const GESTURE_RESET_MS = 150;

    it('handles macOS inertial scroll followed by new gesture', () => {
        const acc = createScrollAccumulator(100);
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Inertial scroll: initial burst then decay
        const inertialSequence = [100, 50, 20, 10, 5];
        let totalLines = 0;

        for (const delta of inertialSequence) {
            totalLines += acc.accumulate(delta);
            manager.recordActivity();
            vi.advanceTimersByTime(16); // ~60fps
        }

        // Total: 185px / 60 = 3.08 lines (3 triggered)
        expect(totalLines).toBe(3);
        expect(acc.getValue()).toBe(185 % 60); // 5px remainder

        // Gesture ends - wait for reset
        vi.advanceTimersByTime(GESTURE_RESET_MS + 10);
        expect(acc.getValue()).toBe(0); // Clean slate

        // New gesture starts
        const lines = acc.accumulate(70);
        expect(lines).toBe(1);
        expect(acc.getValue()).toBe(10);
    });

    it('handles user scrolling down then immediately up', () => {
        const acc = createScrollAccumulator(100);
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Scroll down
        acc.accumulate(40);
        manager.recordActivity();
        vi.advanceTimersByTime(30);

        // Quickly scroll up before reset
        acc.accumulate(-60);
        manager.recordActivity();

        // Accumulator tracks direction change: 40 - 60 = -20
        expect(acc.getValue()).toBe(-20);

        // Continue up
        const lines = acc.accumulate(-45); // -20 + -45 = -65
        manager.recordActivity();
        expect(lines).toBe(-1); // -65 / 60 = -1 (rounded toward zero)
        expect(acc.getValue()).toBe(-5); // -65 % 60 = -5
    });
});

// =============================================================================
// END-TO-END TESTS: Complete wheel handling flow
// =============================================================================

describe('End-to-end wheel handling flow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('simulates complete wheel event handling chain', () => {
        const GESTURE_RESET_MS = 150;
        const acc = createScrollAccumulator(100); // threshold = 60
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Simulate wheel events with different deltaModes
        const wheelEvents = [
            { deltaY: 20, deltaMode: 0 },  // 20px pixel mode
            { deltaY: 1, deltaMode: 1 },   // 1 line = 20px
            { deltaY: 25, deltaMode: 0 },  // 25px pixel mode
            // Total: 65px
        ];

        let totalLines = 0;
        for (const event of wheelEvents) {
            const deltaPixels = normalizeDeltaToPixels(event.deltaY, event.deltaMode);
            totalLines += acc.accumulate(deltaPixels);
            manager.recordActivity();
            vi.advanceTimersByTime(16);
        }

        expect(totalLines).toBe(1); // 65px / 60 = 1 line
        expect(acc.getValue()).toBe(5); // 65 % 60 = 5

        // Wait for gesture to end
        vi.advanceTimersByTime(GESTURE_RESET_MS);
        expect(acc.getValue()).toBe(0);
    });

    it('handles mouse wheel (line mode) vs trackpad (pixel mode)', () => {
        const GESTURE_RESET_MS = 150;
        const acc = createScrollAccumulator(100);
        const manager = createGestureResetManager(acc, GESTURE_RESET_MS);

        // Mouse wheel: line mode, discrete steps
        const mouseWheelEvent = { deltaY: 3, deltaMode: 1 }; // 3 lines = 60px
        let mousePixels = normalizeDeltaToPixels(mouseWheelEvent.deltaY, mouseWheelEvent.deltaMode);
        expect(mousePixels).toBe(60);

        let lines = acc.accumulate(mousePixels);
        expect(lines).toBe(1); // Exactly 1 line

        // Reset between inputs
        vi.advanceTimersByTime(GESTURE_RESET_MS + 10);
        manager.recordActivity(); // Dummy to reset

        acc.reset();

        // Trackpad: pixel mode, many small events
        const trackpadEvents = [
            { deltaY: 5, deltaMode: 0 },
            { deltaY: 10, deltaMode: 0 },
            { deltaY: 15, deltaMode: 0 },
            { deltaY: 20, deltaMode: 0 },
            { deltaY: 15, deltaMode: 0 },
        ]; // Total: 65px

        let trackpadLines = 0;
        for (const event of trackpadEvents) {
            const pixels = normalizeDeltaToPixels(event.deltaY, event.deltaMode);
            trackpadLines += acc.accumulate(pixels);
            manager.recordActivity();
            vi.advanceTimersByTime(16);
        }

        expect(trackpadLines).toBe(1); // 65px / 60 = 1 line
        expect(acc.getValue()).toBe(5); // 65 % 60 = 5
    });
});
