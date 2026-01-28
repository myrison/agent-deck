/**
 * Scroll Accumulator Utility
 *
 * This module provides a smooth scrolling accumulator pattern for terminal
 * wheel events. Trackpads generate many small deltaY values, and this
 * accumulator collects them until a threshold is reached before triggering
 * a scroll action.
 *
 * The scroll speed setting (50-250%) inversely affects the threshold:
 * - 100% (default): PIXELS_PER_LINE = 60 (baseline - responsive by default)
 * - 50% (slower): PIXELS_PER_LINE = 120 (need more delta to scroll)
 * - 200% (faster): PIXELS_PER_LINE = 30 (less delta needed to scroll)
 *
 * Formula: effectiveThreshold = DEFAULT_PIXELS_PER_LINE / (scrollSpeed / 100)
 *
 * IMPORTANT: On macOS, the OS already provides momentum via the wheel event
 * stream (many decreasing deltaY events over time). We do NOT simulate momentum
 * ourselves - we just clamp per-event output and discard excess to avoid
 * "scroll debt" that causes ghost scrolling after the user stops.
 */

export const DEFAULT_PIXELS_PER_LINE = 60;
export const MIN_SCROLL_SPEED = 50;
export const MAX_SCROLL_SPEED = 250;
export const DEFAULT_SCROLL_SPEED = 100;

// Maximum lines to scroll per event. Prevents massive jumps from macOS inertial
// scrolling where trackpad flicks generate deltaY bursts of 1000-4000+ pixels.
// At 60Hz+ event rate, 5 lines per event = 300 lines/sec (very fast scrolling).
export const MAX_LINES_PER_EVENT = 5;

// deltaMode multipliers for WheelEvent normalization
export const PIXELS_PER_LINE_DELTA = 20;  // Typical line height for deltaMode 1
export const PIXELS_PER_PAGE_DELTA = 400; // Typical page height for deltaMode 2

/**
 * Normalize WheelEvent deltaY to pixels based on deltaMode
 *
 * WheelEvent.deltaMode values:
 * - 0: DOM_DELTA_PIXEL (most common on macOS trackpad)
 * - 1: DOM_DELTA_LINE (some mice, older browsers)
 * - 2: DOM_DELTA_PAGE (rare, some accessibility tools)
 *
 * @param {number} deltaY - The raw deltaY from WheelEvent
 * @param {number} deltaMode - The deltaMode from WheelEvent (0, 1, or 2)
 * @returns {number} Normalized delta in pixels
 */
export function normalizeDeltaToPixels(deltaY, deltaMode) {
    if (deltaMode === 1) {
        return deltaY * PIXELS_PER_LINE_DELTA;
    }
    if (deltaMode === 2) {
        return deltaY * PIXELS_PER_PAGE_DELTA;
    }
    // deltaMode 0 (pixel mode) or unknown - pass through as-is
    return deltaY;
}

/**
 * Calculate the effective pixels-per-line threshold based on scroll speed setting
 *
 * @param {number} scrollSpeedPercent - Scroll speed as percentage (50-250, default 100)
 * @returns {number} Effective pixels per line threshold
 */
export function calculatePixelsPerLine(scrollSpeedPercent = DEFAULT_SCROLL_SPEED) {
    // Clamp to valid range
    const clampedSpeed = Math.max(MIN_SCROLL_SPEED, Math.min(MAX_SCROLL_SPEED, scrollSpeedPercent));
    return DEFAULT_PIXELS_PER_LINE / (clampedSpeed / 100);
}

/**
 * Create a scroll accumulator instance
 *
 * @param {number} scrollSpeedPercent - Scroll speed as percentage (50-250)
 * @returns {Object} Accumulator instance with methods
 */
export function createScrollAccumulator(scrollSpeedPercent = DEFAULT_SCROLL_SPEED) {
    let accumulator = 0;
    let pixelsPerLine = calculatePixelsPerLine(scrollSpeedPercent);

    return {
        /**
         * Add a delta value to the accumulator and calculate lines to scroll
         *
         * @param {number} deltaY - The wheel event deltaY value
         * @returns {number} Number of lines to scroll (positive = down, negative = up)
         */
        accumulate(deltaY) {
            accumulator += deltaY;

            if (Math.abs(accumulator) >= pixelsPerLine) {
                const rawLines = Math.trunc(accumulator / pixelsPerLine);

                // Clamp to prevent massive jumps from macOS inertial scrolling.
                const clampedLines = Math.max(-MAX_LINES_PER_EVENT, Math.min(MAX_LINES_PER_EVENT, rawLines));

                // KEY: Use modulo to keep only sub-line precision, discard excess.
                // This prevents "scroll debt" where we bank momentum that the OS
                // is already providing via subsequent inertial events. The OS event
                // stream IS the momentum - we don't need to simulate it.
                accumulator = accumulator % pixelsPerLine;

                return clampedLines;
            }

            return 0;
        },

        /**
         * Get the current accumulator value
         * @returns {number} Current accumulator value
         */
        getValue() {
            return accumulator;
        },

        /**
         * Get the current pixels per line threshold
         * @returns {number} Current threshold
         */
        getThreshold() {
            return pixelsPerLine;
        },

        /**
         * Reset the accumulator to zero
         */
        reset() {
            accumulator = 0;
        },

        /**
         * Update the scroll speed setting
         * @param {number} newSpeedPercent - New scroll speed percentage
         */
        setScrollSpeed(newSpeedPercent) {
            pixelsPerLine = calculatePixelsPerLine(newSpeedPercent);
            // Don't reset accumulator - allow smooth transition
        },
    };
}
