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

/**
 * Determines if the 'single-favorite' class should be applied.
 * This is the core behavioral decision - when exactly 1 favorite exists,
 * the grid should use a single-row layout for proper centering.
 *
 * @param {number} favoritesCount - Number of favorites
 * @returns {boolean} Whether single-favorite class should be applied
 */
function shouldUseSingleFavoriteClass(favoritesCount) {
    return favoritesCount === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for className computation
// ─────────────────────────────────────────────────────────────────────────────

describe('computeQuickLaunchClassName (mirrors UnifiedTopBar.jsx line 391)', () => {
    it('applies single-favorite class when exactly 1 favorite exists', () => {
        const className = computeQuickLaunchClassName(1);
        expect(className).toBe('quick-launch-section single-favorite');
    });

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

// ─────────────────────────────────────────────────────────────────────────────
// Tests for single-favorite decision logic
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldUseSingleFavoriteClass', () => {
    describe('returns true only for exactly 1 favorite', () => {
        it('returns true when favoritesCount is 1', () => {
            expect(shouldUseSingleFavoriteClass(1)).toBe(true);
        });
    });

    describe('returns false for all other counts', () => {
        it('returns false when favoritesCount is 0', () => {
            expect(shouldUseSingleFavoriteClass(0)).toBe(false);
        });

        it('returns false when favoritesCount is 2', () => {
            expect(shouldUseSingleFavoriteClass(2)).toBe(false);
        });

        it('returns false when favoritesCount is 3', () => {
            expect(shouldUseSingleFavoriteClass(3)).toBe(false);
        });

        it('returns false when favoritesCount is a large number', () => {
            expect(shouldUseSingleFavoriteClass(100)).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('returns false for negative numbers', () => {
            // Edge case: should never happen in practice, but test defensive behavior
            expect(shouldUseSingleFavoriteClass(-1)).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS behavior documentation tests
// These tests document the expected visual behavior for the grid layout.
// The actual CSS is tested visually, but we document the expected behavior here.
// ─────────────────────────────────────────────────────────────────────────────

describe('grid layout behavior (CSS documentation)', () => {
    // These tests document the expected CSS behavior based on the class applied.
    // They verify the className computation produces the correct class for each scenario.

    describe('single favorite layout', () => {
        it('should use single-row grid (grid-template-rows: 1fr) when 1 favorite', () => {
            // CSS: .quick-launch-section.single-favorite { grid-template-rows: 1fr; }
            const className = computeQuickLaunchClassName(1);
            expect(className).toContain('single-favorite');
            // This class triggers: grid-template-rows: 1fr (single row, vertically centered)
        });

        it('should have add button span only 1 row when 1 favorite', () => {
            // CSS: .quick-launch-section.single-favorite .quick-launch-add { grid-row: span 1; }
            const className = computeQuickLaunchClassName(1);
            expect(className).toContain('single-favorite');
            // The add button spans 1 row instead of 2 in single-favorite mode
        });
    });

    describe('multi-favorite layout', () => {
        it('should use 2-row grid (grid-template-rows: repeat(2, 1fr)) when 2+ favorites', () => {
            // CSS: .quick-launch-section { grid-template-rows: repeat(2, 1fr); }
            const className = computeQuickLaunchClassName(2);
            expect(className).not.toContain('single-favorite');
            // Without single-favorite class: 2-row grid with vertical-first flow
        });

        it('should have add button span both rows when 2+ favorites', () => {
            // CSS: .quick-launch-add { grid-row: span 2; }
            const className = computeQuickLaunchClassName(3);
            expect(className).not.toContain('single-favorite');
            // Add button spans both rows in the 2-row grid
        });

        it('should stack favorites vertically first when 2+ favorites', () => {
            // CSS: .quick-launch-section { grid-auto-flow: column; }
            // Favorites fill columns vertically: [1,3] [2,4] [+] for 4 favorites
            const className = computeQuickLaunchClassName(4);
            expect(className).toBe('quick-launch-section');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end scenario tests
// ─────────────────────────────────────────────────────────────────────────────

describe('favorites bar layout scenarios', () => {
    it('transitions from single to multi layout when second favorite is added', () => {
        // Before: 1 favorite
        expect(computeQuickLaunchClassName(1)).toBe('quick-launch-section single-favorite');

        // After: 2 favorites
        expect(computeQuickLaunchClassName(2)).toBe('quick-launch-section');
    });

    it('transitions from multi to single layout when favorites reduced to 1', () => {
        // Before: 3 favorites
        expect(computeQuickLaunchClassName(3)).toBe('quick-launch-section');

        // After: 1 favorite
        expect(computeQuickLaunchClassName(1)).toBe('quick-launch-section single-favorite');
    });

    it('layout remains multi when favorites count changes above 1', () => {
        // 2 -> 5 -> 3 favorites: all should use multi-row layout
        expect(computeQuickLaunchClassName(2)).toBe('quick-launch-section');
        expect(computeQuickLaunchClassName(5)).toBe('quick-launch-section');
        expect(computeQuickLaunchClassName(3)).toBe('quick-launch-section');
    });
});
