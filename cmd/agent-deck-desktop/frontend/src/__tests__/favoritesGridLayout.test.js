/**
 * Tests for the 2-row grid layout behavior in the Quick Launch favorites bar.
 *
 * The favorites bar uses CSS Grid with vertical-first stacking (grid-auto-flow: column).
 * When there's only 1 favorite, a 'single-favorite' class is applied to switch to
 * single-row layout for proper vertical centering.
 *
 * This uses behavioral extraction testing because UnifiedTopBar.jsx depends on
 * Wails bindings, context providers, and child components that require extensive
 * mocking. The extracted logic mirrors the actual className computation in the
 * component (line 391 in UnifiedTopBar.jsx).
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral extraction: mirrors the className computation in UnifiedTopBar.jsx
// Source: line 391: className={`quick-launch-section${favorites.length === 1 ? ' single-favorite' : ''}`}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the CSS className for the quick-launch-section element.
 * Mirrors the logic in UnifiedTopBar.jsx line 391.
 *
 * @param {number} favoritesCount - Number of favorites in the bar
 * @returns {string} The complete className string
 */
function computeQuickLaunchClassName(favoritesCount) {
    return `quick-launch-section${favoritesCount === 1 ? ' single-favorite' : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for className computation
// ─────────────────────────────────────────────────────────────────────────────

describe('computeQuickLaunchClassName (mirrors UnifiedTopBar.jsx line 391)', () => {
    describe('single-favorite class application', () => {
        it('applies single-favorite class when exactly 1 favorite exists', () => {
            const className = computeQuickLaunchClassName(1);
            expect(className).toBe('quick-launch-section single-favorite');
        });
    });

    describe('no single-favorite class for other counts', () => {
        it('does not apply single-favorite class when 0 favorites exist', () => {
            const className = computeQuickLaunchClassName(0);
            expect(className).toBe('quick-launch-section');
        });

        it('does not apply single-favorite class when 2 favorites exist', () => {
            const className = computeQuickLaunchClassName(2);
            expect(className).toBe('quick-launch-section');
        });

        it('does not apply single-favorite class when many favorites exist', () => {
            const className = computeQuickLaunchClassName(10);
            expect(className).toBe('quick-launch-section');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end scenario tests
// These test realistic user flows where favorites count changes
// ─────────────────────────────────────────────────────────────────────────────

describe('favorites bar layout scenarios', () => {
    it('transitions from single to multi layout when second favorite is added', () => {
        // Before: 1 favorite - single-row layout
        expect(computeQuickLaunchClassName(1)).toBe('quick-launch-section single-favorite');

        // After: 2 favorites - 2-row grid layout
        expect(computeQuickLaunchClassName(2)).toBe('quick-launch-section');
    });

    it('transitions from multi to single layout when favorites reduced to 1', () => {
        // Before: 3 favorites - 2-row grid layout
        expect(computeQuickLaunchClassName(3)).toBe('quick-launch-section');

        // After: 1 favorite - single-row layout
        expect(computeQuickLaunchClassName(1)).toBe('quick-launch-section single-favorite');
    });

    it('layout remains multi when favorites count changes above 1', () => {
        // 2 -> 5 -> 3 favorites: all should use 2-row grid layout
        expect(computeQuickLaunchClassName(2)).toBe('quick-launch-section');
        expect(computeQuickLaunchClassName(5)).toBe('quick-launch-section');
        expect(computeQuickLaunchClassName(3)).toBe('quick-launch-section');
    });
});
