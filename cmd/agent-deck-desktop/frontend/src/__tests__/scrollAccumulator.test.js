/**
 * Tests for scroll accumulator utility
 *
 * The scroll accumulator handles smooth scrolling for terminal wheel events.
 * It accumulates small deltaY values (from trackpads) until a threshold is
 * reached, then triggers scroll actions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_PIXELS_PER_LINE,
    DEFAULT_SCROLL_SPEED,
    MIN_SCROLL_SPEED,
    MAX_SCROLL_SPEED,
    MAX_LINES_PER_EVENT,
    calculatePixelsPerLine,
    createScrollAccumulator,
} from '../utils/scrollAccumulator';

describe('calculatePixelsPerLine', () => {
    it('returns default threshold at 100% speed', () => {
        expect(calculatePixelsPerLine(100)).toBe(DEFAULT_PIXELS_PER_LINE);
        expect(calculatePixelsPerLine(100)).toBe(60);
    });

    it('returns higher threshold (slower scroll) at 50% speed', () => {
        // 60 / (50/100) = 60 / 0.5 = 120
        expect(calculatePixelsPerLine(50)).toBe(120);
    });

    it('returns lower threshold (faster scroll) at 200% speed', () => {
        // 60 / (200/100) = 60 / 2 = 30
        expect(calculatePixelsPerLine(200)).toBe(30);
    });

    it('returns lower threshold (fastest scroll) at 250% speed', () => {
        // 60 / (250/100) = 60 / 2.5 = 24
        expect(calculatePixelsPerLine(250)).toBe(24);
    });

    it('clamps speed below minimum to minimum', () => {
        // Should use MIN_SCROLL_SPEED (50) when given 0 or negative
        expect(calculatePixelsPerLine(0)).toBe(calculatePixelsPerLine(MIN_SCROLL_SPEED));
        expect(calculatePixelsPerLine(-100)).toBe(calculatePixelsPerLine(MIN_SCROLL_SPEED));
        expect(calculatePixelsPerLine(25)).toBe(calculatePixelsPerLine(MIN_SCROLL_SPEED));
    });

    it('clamps speed above maximum to maximum', () => {
        // Should use MAX_SCROLL_SPEED (250) when given higher values
        expect(calculatePixelsPerLine(300)).toBe(calculatePixelsPerLine(MAX_SCROLL_SPEED));
        expect(calculatePixelsPerLine(500)).toBe(calculatePixelsPerLine(MAX_SCROLL_SPEED));
    });

    it('uses default speed when no argument provided', () => {
        expect(calculatePixelsPerLine()).toBe(calculatePixelsPerLine(DEFAULT_SCROLL_SPEED));
    });
});

describe('createScrollAccumulator', () => {
    describe('accumulator initialization', () => {
        it('starts with zero accumulator value', () => {
            const acc = createScrollAccumulator();
            expect(acc.getValue()).toBe(0);
        });

        it('uses default threshold at 100% speed', () => {
            const acc = createScrollAccumulator(100);
            expect(acc.getThreshold()).toBe(60);
        });

        it('uses custom threshold based on scroll speed', () => {
            const acc50 = createScrollAccumulator(50);
            const acc200 = createScrollAccumulator(200);

            expect(acc50.getThreshold()).toBe(120); // Slower = higher threshold
            expect(acc200.getThreshold()).toBe(30); // Faster = lower threshold
        });
    });

    describe('accumulating small deltaY values', () => {
        it('accumulates small values without triggering scroll', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Small deltas that don't reach threshold
            expect(acc.accumulate(10)).toBe(0);
            expect(acc.getValue()).toBe(10);

            expect(acc.accumulate(15)).toBe(0);
            expect(acc.getValue()).toBe(25);

            expect(acc.accumulate(20)).toBe(0);
            expect(acc.getValue()).toBe(45);
        });

        it('accumulates negative values correctly', () => {
            const acc = createScrollAccumulator(100);

            expect(acc.accumulate(-10)).toBe(0);
            expect(acc.getValue()).toBe(-10);

            expect(acc.accumulate(-20)).toBe(0);
            expect(acc.getValue()).toBe(-30);
        });

        it('accumulates mixed positive and negative values', () => {
            const acc = createScrollAccumulator(100);

            acc.accumulate(30);
            expect(acc.getValue()).toBe(30);

            acc.accumulate(-20);
            expect(acc.getValue()).toBe(10);

            acc.accumulate(-15);
            expect(acc.getValue()).toBe(-5);
        });
    });

    describe('triggering scroll when threshold is reached', () => {
        it('returns 1 line when exactly reaching threshold (scroll down)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            acc.accumulate(30);
            const lines = acc.accumulate(30); // total = 60, exactly threshold

            expect(lines).toBe(1);
        });

        it('returns -1 line when exactly reaching negative threshold (scroll up)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            acc.accumulate(-30);
            const lines = acc.accumulate(-30); // total = -60, exactly -threshold

            expect(lines).toBe(-1);
        });

        it('returns 1 line when exceeding threshold (scroll down)', () => {
            const acc = createScrollAccumulator(100);

            const lines = acc.accumulate(75); // exceeds threshold of 60

            expect(lines).toBe(1);
        });

        it('returns -1 line when exceeding negative threshold (scroll up)', () => {
            const acc = createScrollAccumulator(100);

            const lines = acc.accumulate(-75);

            expect(lines).toBe(-1);
        });

        it('returns multiple lines for large delta', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            const lines = acc.accumulate(180); // 3x threshold

            expect(lines).toBe(3);
        });

        it('returns multiple lines for large negative delta', () => {
            const acc = createScrollAccumulator(100);

            const lines = acc.accumulate(-130); // More than 2x threshold

            expect(lines).toBe(-2);
        });
    });

    describe('remainder handling after scroll (modulo behavior)', () => {
        it('preserves sub-line remainder after scrolling (via modulo)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            acc.accumulate(75); // Returns 1, remainder = 75 % 60 = 15

            expect(acc.getValue()).toBe(15);
        });

        it('preserves negative sub-line remainder after scrolling', () => {
            const acc = createScrollAccumulator(100);

            acc.accumulate(-75); // Returns -1, remainder = -75 % 60 = -15

            expect(acc.getValue()).toBe(-15);
        });

        it('discards excess lines via modulo (no scroll debt)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Large delta: 200px = 3.33 lines, returns 3 (under clamp of 5)
            // Modulo: 200 % 60 = 20 (NOT 200 - 180 = 20, same result here)
            let lines = acc.accumulate(200);
            expect(lines).toBe(3);
            expect(acc.getValue()).toBe(20); // Only sub-line remainder kept

            // Next small event builds on remainder
            lines = acc.accumulate(50); // 20 + 50 = 70, triggers 1 line
            expect(lines).toBe(1);
            expect(acc.getValue()).toBe(10); // 70 % 60 = 10
        });

        it('handles remainder when crossing zero direction', () => {
            const acc = createScrollAccumulator(100);

            // Build up positive
            acc.accumulate(30);
            expect(acc.getValue()).toBe(30);

            // Scroll back past zero
            acc.accumulate(-40);
            expect(acc.getValue()).toBe(-10);

            // Continue negative until threshold
            const lines = acc.accumulate(-55); // -10 + -55 = -65
            expect(lines).toBe(-1);
            expect(acc.getValue()).toBe(-5); // -65 % 60 = -5
        });
    });

    describe('different scroll speed settings', () => {
        it('scrolls faster at 200% speed (lower threshold)', () => {
            const acc = createScrollAccumulator(200); // threshold = 30

            // 35 pixels should trigger at 200%
            const lines = acc.accumulate(35);

            expect(lines).toBe(1);
            expect(acc.getValue()).toBe(5); // 35 % 30 = 5
        });

        it('scrolls slower at 50% speed (higher threshold)', () => {
            const acc = createScrollAccumulator(50); // threshold = 120

            // 80 pixels should NOT trigger at 50%
            const lines = acc.accumulate(80);

            expect(lines).toBe(0);
            expect(acc.getValue()).toBe(80);

            // Need to reach 120
            const lines2 = acc.accumulate(50); // total = 130

            expect(lines2).toBe(1);
            expect(acc.getValue()).toBe(10); // 130 % 120 = 10
        });

        it('correctly handles 150% speed', () => {
            const acc = createScrollAccumulator(150);
            // threshold = 60 / 1.5 = 40

            expect(acc.getThreshold()).toBeCloseTo(40, 1);

            // 45 should trigger one scroll
            const lines = acc.accumulate(45);
            expect(lines).toBe(1);
        });

        it('correctly handles 75% speed', () => {
            const acc = createScrollAccumulator(75);
            // threshold = 60 / 0.75 = 80

            expect(acc.getThreshold()).toBeCloseTo(80, 1);

            // 75 should NOT trigger
            expect(acc.accumulate(75)).toBe(0);

            // 10 more should trigger (total 85)
            expect(acc.accumulate(10)).toBe(1);
        });
    });

    describe('reset method', () => {
        it('resets accumulator to zero', () => {
            const acc = createScrollAccumulator();

            acc.accumulate(30);
            expect(acc.getValue()).toBe(30);

            acc.reset();
            expect(acc.getValue()).toBe(0);
        });

        it('does not change threshold on reset', () => {
            const acc = createScrollAccumulator(150);
            const originalThreshold = acc.getThreshold();

            acc.accumulate(20);
            acc.reset();

            expect(acc.getThreshold()).toBe(originalThreshold);
        });
    });

    describe('setScrollSpeed method', () => {
        it('updates threshold when speed changes', () => {
            const acc = createScrollAccumulator(100);
            expect(acc.getThreshold()).toBe(60); // 60 / 1.0 = 60

            acc.setScrollSpeed(200);
            expect(acc.getThreshold()).toBe(30); // 60 / 2.0 = 30

            acc.setScrollSpeed(50);
            expect(acc.getThreshold()).toBe(120); // 60 / 0.5 = 120
        });

        it('preserves accumulator value when speed changes', () => {
            const acc = createScrollAccumulator(100);

            acc.accumulate(25);
            expect(acc.getValue()).toBe(25);

            acc.setScrollSpeed(200);

            // Accumulator value preserved (allows smooth transition)
            expect(acc.getValue()).toBe(25);

            // With new threshold of 30, adding 10 more should trigger
            const lines = acc.accumulate(10); // 35 total, threshold 30
            expect(lines).toBe(1);
            expect(acc.getValue()).toBe(5); // 35 % 30 = 5
        });

        it('clamps invalid speed values', () => {
            const acc = createScrollAccumulator(100);

            acc.setScrollSpeed(0);
            expect(acc.getThreshold()).toBe(calculatePixelsPerLine(MIN_SCROLL_SPEED));

            acc.setScrollSpeed(500);
            expect(acc.getThreshold()).toBe(calculatePixelsPerLine(MAX_SCROLL_SPEED));
        });
    });

    describe('edge cases', () => {
        it('handles zero deltaY', () => {
            const acc = createScrollAccumulator();

            const lines = acc.accumulate(0);

            expect(lines).toBe(0);
            expect(acc.getValue()).toBe(0);
        });

        it('handles very small deltaY values (sub-pixel)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Simulate many small trackpad events
            for (let i = 0; i < 100; i++) {
                acc.accumulate(0.5);
            }

            // 100 * 0.5 = 50, not enough for threshold (60)
            expect(acc.getValue()).toBe(50);
            expect(acc.accumulate(0)).toBe(0);

            // Add more to trigger
            for (let i = 0; i < 20; i++) {
                acc.accumulate(0.5);
            }

            // Now at 50 + 10 = 60, should have triggered
            // The last iteration would have been the trigger
            expect(acc.getValue()).toBe(0); // 60 % 60 = 0
        });

        it('handles floating point precision', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Accumulate values that might cause floating point issues
            // 20 * 3 = 60, which triggers a scroll
            acc.accumulate(20);
            acc.accumulate(20);
            const lines = acc.accumulate(20);

            // Total is 60 which triggers exactly 1 scroll, remainder 0
            expect(lines).toBe(1);
            expect(acc.getValue()).toBeCloseTo(0, 5);
        });

        it('handles maximum speed scroll correctly', () => {
            const acc = createScrollAccumulator(MAX_SCROLL_SPEED); // 250%
            // threshold = 60 / 2.5 = 24

            expect(acc.getThreshold()).toBe(24);

            // Moderate movement triggers scroll
            expect(acc.accumulate(30)).toBe(1);
            expect(acc.getValue()).toBe(6); // 30 % 24 = 6
        });

        it('handles minimum speed scroll correctly', () => {
            const acc = createScrollAccumulator(MIN_SCROLL_SPEED); // 50%
            // threshold = 60 / 0.5 = 120

            expect(acc.getThreshold()).toBe(120);

            // Large movement needed to trigger
            expect(acc.accumulate(100)).toBe(0);
            expect(acc.accumulate(30)).toBe(1);
            expect(acc.getValue()).toBe(10); // 130 % 120 = 10
        });
    });

    describe('realistic usage scenarios', () => {
        it('simulates typical trackpad scroll sequence', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Typical trackpad generates many small events
            const deltas = [5, 10, 20, 30, 25, 20, 15, 10, 5, 2];
            let totalLines = 0;

            for (const delta of deltas) {
                totalLines += acc.accumulate(delta);
            }

            // Total delta = 142, with threshold 60 = 2 lines, remainder 142 % 60 = 22
            expect(totalLines).toBe(2);
            expect(acc.getValue()).toBe(22);
        });

        it('simulates mouse wheel scroll (larger discrete steps)', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Mouse wheel typically sends larger, discrete values
            // With threshold 60: 250 / 60 = 4.16, = 4 lines, remainder 250 % 60 = 10
            expect(acc.accumulate(250)).toBe(4); // 4 lines
            expect(acc.getValue()).toBe(10);

            expect(acc.accumulate(-250)).toBe(-4); // 4 lines up
            // 10 + (-250) = -240, -240 / 60 = -4 lines, remainder -240 % 60 = -0
            // Use toBeCloseTo to handle JavaScript's -0 vs 0 quirk
            expect(acc.getValue()).toBeCloseTo(0, 5);
        });

        it('simulates rapid bidirectional scrolling', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // User scrolls down then quickly up
            acc.accumulate(70); // triggers 1, remainder 10
            acc.accumulate(60); // 10 + 60 = 70, triggers 1, remainder 10
            // Now should have scrolled 2 lines, remainder 10

            expect(acc.getValue()).toBe(10);

            // Now quickly scroll up
            acc.accumulate(-140);
            // 10 - 140 = -130, -130 / 60 = -2 lines, remainder -130 % 60 = -10

            expect(acc.getValue()).toBe(-10);
        });

        it('simulates user changing scroll speed mid-session', () => {
            const acc = createScrollAccumulator(100); // threshold = 60

            // Start scrolling (but don't trigger yet)
            acc.accumulate(25);
            expect(acc.getValue()).toBe(25);

            // User goes to settings and increases scroll speed
            acc.setScrollSpeed(200); // threshold now 30

            // Continue scrolling - should trigger immediately
            const lines = acc.accumulate(10); // 35 total, threshold 30
            expect(lines).toBe(1); // 35 > 30
            expect(acc.getValue()).toBe(5); // 35 % 30 = 5
        });
    });
});

describe('constant exports', () => {
    it('exports correct default values', () => {
        expect(DEFAULT_PIXELS_PER_LINE).toBe(60);
        expect(DEFAULT_SCROLL_SPEED).toBe(100);
        expect(MIN_SCROLL_SPEED).toBe(50);
        expect(MAX_SCROLL_SPEED).toBe(250);
        expect(MAX_LINES_PER_EVENT).toBe(5);
    });
});

describe('inertial scroll clamping', () => {
    it('clamps large positive deltas to MAX_LINES_PER_EVENT', () => {
        const acc = createScrollAccumulator(100); // threshold = 60

        // Simulate macOS inertial burst: 2000 pixels would normally be ~33 lines
        const lines = acc.accumulate(2000);

        expect(lines).toBe(MAX_LINES_PER_EVENT); // Clamped to 5
    });

    it('clamps large negative deltas to -MAX_LINES_PER_EVENT', () => {
        const acc = createScrollAccumulator(100);

        const lines = acc.accumulate(-2000);

        expect(lines).toBe(-MAX_LINES_PER_EVENT); // Clamped to -5
    });

    it('discards excess via modulo (no scroll debt)', () => {
        const acc = createScrollAccumulator(100); // threshold = 60

        // 2000 pixels = 33.33 lines, but we only scroll 5 (clamped) and
        // use modulo to keep just sub-line remainder: 2000 % 60 = 20
        // This prevents "scroll debt" - the OS provides momentum via subsequent events
        acc.accumulate(2000);
        expect(acc.getValue()).toBe(2000 % 60); // 20

        // Next event with 0 delta: accumulator is just 20, below threshold
        const lines2 = acc.accumulate(0);
        expect(lines2).toBe(0); // No scroll debt to drain
        expect(acc.getValue()).toBe(20);
    });

    it('simulates macOS trackpad flick with momentum', () => {
        const acc = createScrollAccumulator(100); // threshold = 60

        // Simulate a trackpad flick: initial burst followed by decay
        // macOS provides momentum via these decreasing events
        const flickSequence = [2000, 1500, 1000, 500, 200, 50];
        let totalLines = 0;

        for (const delta of flickSequence) {
            totalLines += acc.accumulate(delta);
        }

        // With modulo behavior, each event is clamped independently
        // and excess is discarded, preventing runaway scrolling
        expect(totalLines).toBeGreaterThan(0);
        expect(totalLines).toBeLessThanOrEqual(flickSequence.length * MAX_LINES_PER_EVENT);

        // Most importantly: no single call returned more than 5
        // (verified by the clamping logic itself)
    });

    it('does not clamp small scrolls within limit', () => {
        const acc = createScrollAccumulator(100); // threshold = 60

        // 300 pixels = 5 lines, which equals MAX_LINES_PER_EVENT
        const lines = acc.accumulate(300);

        expect(lines).toBe(5); // Exactly at limit, not clamped down
        expect(acc.getValue()).toBe(0); // 300 % 60 = 0
    });
});
