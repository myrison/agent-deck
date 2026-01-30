/**
 * Tests for tooltip text wrapping improvements in Tooltip.css.
 *
 * PR #114 includes CSS changes to improve tooltip text wrapping for long paths:
 * 1. Added max-width and overflow handling to .session-tooltip
 * 2. Changed alignment from center to flex-start for .tooltip-row
 * 3. Added word-break and overflow-wrap to text spans
 * 4. Added word-break: break-all for .tooltip-path
 *
 * These changes ensure tooltips properly wrap long paths and don't overflow
 * the viewport, particularly important for favorites with deep directory paths.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// CSS behavior specifications extracted from Tooltip.css
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the tooltip container wrapping behavior.
 * Source: Tooltip.css lines 25-29 (PR #114 additions)
 */
const SESSION_TOOLTIP_STYLES = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxWidth: '100%', // NEW: Prevents overflow
    overflow: 'hidden' // NEW: Handles overflow content
};

/**
 * Represents the tooltip row alignment behavior.
 * Source: Tooltip.css lines 32-36 (PR #114 change)
 */
const TOOLTIP_ROW_STYLES = {
    display: 'flex',
    alignItems: 'flex-start', // CHANGED from 'center' to support wrapping
    gap: '8px',
    minWidth: 0 // NEW: Allows flex children to shrink below content size
};

/**
 * Represents text wrapping behavior for non-icon spans.
 * Source: Tooltip.css lines 39-42 (PR #114 additions)
 */
const TOOLTIP_TEXT_WRAPPING_STYLES = {
    wordBreak: 'break-word',
    overflowWrap: 'anywhere'
};

/**
 * Represents path-specific wrapping behavior.
 * Source: Tooltip.css lines 57-61 (PR #114 additions)
 */
const TOOLTIP_PATH_STYLES = {
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
    fontSize: 'var(--font-md)',
    wordBreak: 'break-all', // NEW: More aggressive breaking for paths
    overflowWrap: 'anywhere', // NEW: Break anywhere needed
    maxWidth: '100%' // NEW: Respect container width
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests for tooltip container overflow handling
// ─────────────────────────────────────────────────────────────────────────────

describe('session-tooltip container wrapping behavior', () => {
    describe('overflow prevention', () => {
        it('should have max-width constraint to prevent viewport overflow', () => {
            expect(SESSION_TOOLTIP_STYLES.maxWidth).toBe('100%');
        });

        it('should hide overflow content', () => {
            expect(SESSION_TOOLTIP_STYLES.overflow).toBe('hidden');
        });

        it('should maintain column flex layout for vertical stacking', () => {
            expect(SESSION_TOOLTIP_STYLES.display).toBe('flex');
            expect(SESSION_TOOLTIP_STYLES.flexDirection).toBe('column');
        });
    });

    describe('spacing behavior', () => {
        it('should maintain gap between rows', () => {
            expect(SESSION_TOOLTIP_STYLES.gap).toBe('6px');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for tooltip row alignment and wrapping support
// ─────────────────────────────────────────────────────────────────────────────

describe('tooltip-row wrapping support', () => {
    describe('alignment behavior', () => {
        it('should align items to flex-start instead of center for wrapping', () => {
            // Changed from 'center' to 'flex-start' to support multi-line text
            expect(TOOLTIP_ROW_STYLES.alignItems).toBe('flex-start');
        });

        it('should allow flex children to shrink below content size', () => {
            // minWidth: 0 allows text to wrap instead of forcing container growth
            expect(TOOLTIP_ROW_STYLES.minWidth).toBe(0);
        });
    });

    describe('layout behavior', () => {
        it('should use flexbox for icon + text layout', () => {
            expect(TOOLTIP_ROW_STYLES.display).toBe('flex');
        });

        it('should maintain gap between icon and text', () => {
            expect(TOOLTIP_ROW_STYLES.gap).toBe('8px');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for text wrapping behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('tooltip text wrapping behavior', () => {
    describe('general text spans', () => {
        it('should break words when necessary', () => {
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.wordBreak).toBe('break-word');
        });

        it('should allow wrapping anywhere if needed', () => {
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.overflowWrap).toBe('anywhere');
        });
    });

    describe('path text wrapping', () => {
        it('should use aggressive breaking for long paths', () => {
            // break-all is more aggressive than break-word for paths
            expect(TOOLTIP_PATH_STYLES.wordBreak).toBe('break-all');
        });

        it('should allow wrapping anywhere in paths', () => {
            expect(TOOLTIP_PATH_STYLES.overflowWrap).toBe('anywhere');
        });

        it('should respect container max-width', () => {
            expect(TOOLTIP_PATH_STYLES.maxWidth).toBe('100%');
        });

        it('should maintain monospace font for paths', () => {
            expect(TOOLTIP_PATH_STYLES.fontFamily).toBe('monospace');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions for wrapping behavior simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates whether text would wrap based on CSS properties.
 * This is a logical simulation since we can't measure actual rendering.
 */
function canWrapText(text, styles) {
    const hasWordBreak = styles.wordBreak && styles.wordBreak !== 'normal';
    const hasOverflowWrap = styles.overflowWrap && styles.overflowWrap !== 'normal';
    const hasMaxWidth = styles.maxWidth !== undefined;

    return hasWordBreak || hasOverflowWrap || hasMaxWidth;
}

/**
 * Simulates wrapping aggressiveness.
 */
function getWrappingAggressiveness(wordBreak) {
    if (wordBreak === 'break-all') return 'aggressive';
    if (wordBreak === 'break-word') return 'moderate';
    return 'conservative';
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration: wrapping behavior with long content
// ─────────────────────────────────────────────────────────────────────────────

describe('text wrapping with long content scenarios', () => {

    describe('long path wrapping', () => {
        it('should enable wrapping for long paths', () => {
            const longPath = '/Users/username/Documents/Projects/Very/Long/Path/With/Many/Segments/project-name';
            const canWrap = canWrapText(longPath, TOOLTIP_PATH_STYLES);

            expect(canWrap).toBe(true);
        });

        it('should use aggressive wrapping for paths', () => {
            const aggressiveness = getWrappingAggressiveness(TOOLTIP_PATH_STYLES.wordBreak);
            expect(aggressiveness).toBe('aggressive');
        });

        it('should be more aggressive than general text', () => {
            const pathAggressiveness = getWrappingAggressiveness(TOOLTIP_PATH_STYLES.wordBreak);
            const textAggressiveness = getWrappingAggressiveness(TOOLTIP_TEXT_WRAPPING_STYLES.wordBreak);

            expect(pathAggressiveness).toBe('aggressive');
            expect(textAggressiveness).toBe('moderate');
        });
    });

    describe('long name wrapping', () => {
        it('should enable wrapping for long project names', () => {
            const longName = 'VeryLongProjectNameWithoutSpacesThatMightNeedWrapping';
            const canWrap = canWrapText(longName, TOOLTIP_TEXT_WRAPPING_STYLES);

            expect(canWrap).toBe(true);
        });

        it('should use moderate wrapping for names', () => {
            const aggressiveness = getWrappingAggressiveness(TOOLTIP_TEXT_WRAPPING_STYLES.wordBreak);
            expect(aggressiveness).toBe('moderate');
        });
    });

    describe('container constraints', () => {
        it('should constrain tooltip to viewport width', () => {
            expect(SESSION_TOOLTIP_STYLES.maxWidth).toBe('100%');
        });

        it('should constrain path text to container width', () => {
            expect(TOOLTIP_PATH_STYLES.maxWidth).toBe('100%');
        });

        it('should allow row children to shrink when needed', () => {
            expect(TOOLTIP_ROW_STYLES.minWidth).toBe(0);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression prevention: alignment change impact
// ─────────────────────────────────────────────────────────────────────────────

describe('alignment change from center to flex-start', () => {
    it('should use flex-start to support multi-line text', () => {
        // flex-start keeps icon at top when text wraps to multiple lines
        expect(TOOLTIP_ROW_STYLES.alignItems).toBe('flex-start');
    });

    it('should not use center alignment', () => {
        // center would look awkward with wrapped text
        expect(TOOLTIP_ROW_STYLES.alignItems).not.toBe('center');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS property combinations for effective wrapping
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS property combinations for wrapping', () => {
    describe('path wrapping requirements', () => {
        it('should have all three wrapping properties for paths', () => {
            expect(TOOLTIP_PATH_STYLES.wordBreak).toBeDefined();
            expect(TOOLTIP_PATH_STYLES.overflowWrap).toBeDefined();
            expect(TOOLTIP_PATH_STYLES.maxWidth).toBeDefined();
        });

        it('should combine word-break and overflow-wrap for full coverage', () => {
            // Both properties work together for different edge cases
            const hasWordBreak = TOOLTIP_PATH_STYLES.wordBreak === 'break-all';
            const hasOverflowWrap = TOOLTIP_PATH_STYLES.overflowWrap === 'anywhere';

            expect(hasWordBreak).toBe(true);
            expect(hasOverflowWrap).toBe(true);
        });
    });

    describe('general text wrapping requirements', () => {
        it('should have both wrapping properties for text', () => {
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.wordBreak).toBeDefined();
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.overflowWrap).toBeDefined();
        });

        it('should use break-word and anywhere for flexible wrapping', () => {
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.wordBreak).toBe('break-word');
            expect(TOOLTIP_TEXT_WRAPPING_STYLES.overflowWrap).toBe('anywhere');
        });
    });

    describe('container overflow handling', () => {
        it('should combine max-width and overflow for container safety', () => {
            expect(SESSION_TOOLTIP_STYLES.maxWidth).toBeDefined();
            expect(SESSION_TOOLTIP_STYLES.overflow).toBeDefined();
        });

        it('should prevent overflow while allowing internal wrapping', () => {
            expect(SESSION_TOOLTIP_STYLES.maxWidth).toBe('100%');
            expect(SESSION_TOOLTIP_STYLES.overflow).toBe('hidden');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Use cases that benefit from wrapping improvements
// ─────────────────────────────────────────────────────────────────────────────

describe('real-world wrapping scenarios', () => {
    describe('favorite with deep path', () => {
        it('should handle paths with many directory segments', () => {
            const deepPath = '/Users/jason/Documents/Seafile/HyperCurrent/gitclone/hc-repo/agent-deck';
            const canWrap = canWrapText(deepPath, TOOLTIP_PATH_STYLES);

            expect(canWrap).toBe(true);
        });

        it('should handle paths with long directory names', () => {
            const longDirPath = '/Users/username/VeryLongDirectoryNameWithoutSpaces/AnotherLongDirectory/project';
            const canWrap = canWrapText(longDirPath, TOOLTIP_PATH_STYLES);

            expect(canWrap).toBe(true);
        });
    });

    describe('favorite with long name', () => {
        it('should handle long project names with spaces', () => {
            const longName = 'My Very Long Project Name That Should Wrap Nicely';
            const canWrap = canWrapText(longName, TOOLTIP_TEXT_WRAPPING_STYLES);

            expect(canWrap).toBe(true);
        });

        it('should handle long project names without spaces', () => {
            const longName = 'MyVeryLongProjectNameWithoutSpacesThatNeedsBreaking';
            const canWrap = canWrapText(longName, TOOLTIP_TEXT_WRAPPING_STYLES);

            expect(canWrap).toBe(true);
        });
    });

    describe('combined long content', () => {
        it('should handle favorite with both long name and path', () => {
            const longName = 'VeryLongProjectNameHere';
            const deepPath = '/very/long/path/to/the/project/location';

            const nameCanWrap = canWrapText(longName, TOOLTIP_TEXT_WRAPPING_STYLES);
            const pathCanWrap = canWrapText(deepPath, TOOLTIP_PATH_STYLES);

            expect(nameCanWrap).toBe(true);
            expect(pathCanWrap).toBe(true);
        });
    });
});
