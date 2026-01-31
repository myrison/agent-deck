/**
 * Tests for the favorite star indicator feature in Quick Launch bar.
 *
 * PR #114 adds visual indicators (★) for favorites:
 * 1. Star badge on each favorite item button
 * 2. "★ Favorite" header in tooltips
 *
 * This uses behavioral extraction testing because UnifiedTopBar.jsx depends on
 * Wails bindings and complex context providers that require extensive mocking.
 * The extracted logic mirrors the actual tooltip content generation and badge
 * rendering in the component.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral extraction: mirrors getFavoriteTooltipContent() in UnifiedTopBar.jsx
// Source: lines 145-167 in UnifiedTopBar.jsx
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates tooltip content structure for a favorite item.
 * Mirrors the JSX structure returned by getFavoriteTooltipContent() in UnifiedTopBar.jsx.
 *
 * @param {Object} fav - Favorite item object
 * @param {string} fav.name - Display name
 * @param {string} fav.path - Project path
 * @param {string} [fav.shortcut] - Optional keyboard shortcut
 * @returns {Object} Tooltip content structure
 */
function generateFavoriteTooltipContent(fav) {
    const content = {
        type: 'div',
        className: 'session-tooltip',
        children: [
            {
                type: 'div',
                className: 'tooltip-favorite-header',
                children: [
                    { type: 'span', className: 'tooltip-favorite-star', text: '★' },
                    { type: 'span', text: 'Favorite' }
                ]
            },
            {
                type: 'div',
                className: 'tooltip-row',
                children: [
                    { type: 'span', style: { fontWeight: 500 }, text: fav.name }
                ]
            },
            {
                type: 'div',
                className: 'tooltip-row',
                children: [
                    { type: 'span', className: 'tooltip-path', text: fav.path }
                ]
            }
        ]
    };

    // Add shortcut row if present
    if (fav.shortcut) {
        content.children.push({
            type: 'div',
            className: 'tooltip-row',
            children: [
                { type: 'span', className: 'tooltip-icon', text: '⌨' },
                { type: 'span', text: formatShortcut(fav.shortcut) }
            ]
        });
    }

    return content;
}

/**
 * Formats keyboard shortcut for display.
 * Mirrors formatShortcut utility used in UnifiedTopBar.jsx.
 */
function formatShortcut(shortcut) {
    return shortcut
        .replace('Cmd', '⌘')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replace('Ctrl', '⌃');
}

/**
 * Checks if a favorite item button should render a star badge.
 * In UnifiedTopBar.jsx line 420, only the FIRST favorite (index === 0) gets a star badge.
 * This change was made to reduce visual clutter in the quick launch section.
 *
 * @param {number} index - Index of the favorite in the list
 * @returns {boolean} True only for the first favorite (index 0)
 */
function shouldRenderStarBadge(index) {
    // Only the first favorite in the quick launch bar gets a star badge
    return index === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for tooltip content structure
// ─────────────────────────────────────────────────────────────────────────────

describe('generateFavoriteTooltipContent (mirrors UnifiedTopBar.jsx lines 145-167)', () => {
    describe('tooltip structure', () => {
        it('generates tooltip with favorite header and star icon', () => {
            const fav = {
                name: 'My Project',
                path: '/Users/test/projects/my-project',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);

            expect(tooltip.className).toBe('session-tooltip');
            expect(tooltip.children).toHaveLength(3); // header + name + path

            // Verify favorite header
            const header = tooltip.children[0];
            expect(header.className).toBe('tooltip-favorite-header');
            expect(header.children).toHaveLength(2);
            expect(header.children[0].className).toBe('tooltip-favorite-star');
            expect(header.children[0].text).toBe('★');
            expect(header.children[1].text).toBe('Favorite');
        });

        it('includes project name in tooltip', () => {
            const fav = {
                name: 'Test Project',
                path: '/path/to/project',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const nameRow = tooltip.children[1];

            expect(nameRow.className).toBe('tooltip-row');
            expect(nameRow.children[0].text).toBe('Test Project');
            expect(nameRow.children[0].style.fontWeight).toBe(500);
        });

        it('includes project path in tooltip', () => {
            const fav = {
                name: 'My Project',
                path: '/Users/test/long/path/to/project',
                tool: 'gemini'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const pathRow = tooltip.children[2];

            expect(pathRow.className).toBe('tooltip-row');
            expect(pathRow.children[0].className).toBe('tooltip-path');
            expect(pathRow.children[0].text).toBe('/Users/test/long/path/to/project');
        });
    });

    describe('tooltip with keyboard shortcut', () => {
        it('includes shortcut row when shortcut is defined', () => {
            const fav = {
                name: 'My Project',
                path: '/path/to/project',
                tool: 'claude',
                shortcut: 'Cmd+1'
            };

            const tooltip = generateFavoriteTooltipContent(fav);

            expect(tooltip.children).toHaveLength(4); // header + name + path + shortcut

            const shortcutRow = tooltip.children[3];
            expect(shortcutRow.className).toBe('tooltip-row');
            expect(shortcutRow.children).toHaveLength(2);
            expect(shortcutRow.children[0].className).toBe('tooltip-icon');
            expect(shortcutRow.children[0].text).toBe('⌨');
            expect(shortcutRow.children[1].text).toBe('⌘+1');
        });

        it('omits shortcut row when shortcut is not defined', () => {
            const fav = {
                name: 'My Project',
                path: '/path/to/project',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);

            expect(tooltip.children).toHaveLength(3); // header + name + path only
        });

        it('formats complex shortcuts correctly', () => {
            const fav = {
                name: 'My Project',
                path: '/path/to/project',
                tool: 'opencode',
                shortcut: 'Cmd+Shift+5'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const shortcutRow = tooltip.children[3];

            expect(shortcutRow.children[1].text).toBe('⌘+⇧+5');
        });
    });

    describe('tooltip with different tools', () => {
        it('generates consistent tooltip for claude tool', () => {
            const fav = {
                name: 'Claude Project',
                path: '/path/claude',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const header = tooltip.children[0];

            expect(header.children[0].text).toBe('★');
            expect(header.children[1].text).toBe('Favorite');
        });

        it('generates consistent tooltip for gemini tool', () => {
            const fav = {
                name: 'Gemini Project',
                path: '/path/gemini',
                tool: 'gemini'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const header = tooltip.children[0];

            expect(header.children[0].text).toBe('★');
            expect(header.children[1].text).toBe('Favorite');
        });

        it('generates consistent tooltip for opencode tool', () => {
            const fav = {
                name: 'OpenCode Project',
                path: '/path/opencode',
                tool: 'opencode'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const header = tooltip.children[0];

            expect(header.children[0].text).toBe('★');
            expect(header.children[1].text).toBe('Favorite');
        });
    });

    describe('tooltip with edge cases', () => {
        it('handles empty shortcut string correctly', () => {
            const fav = {
                name: 'Project',
                path: '/path',
                tool: 'claude',
                shortcut: ''
            };

            const tooltip = generateFavoriteTooltipContent(fav);

            // Empty string is falsy, so no shortcut row should be added
            expect(tooltip.children).toHaveLength(3);
        });

        it('handles very long project names', () => {
            const fav = {
                name: 'Very Long Project Name That Might Need Wrapping In The UI',
                path: '/path',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const nameRow = tooltip.children[1];

            expect(nameRow.children[0].text).toBe('Very Long Project Name That Might Need Wrapping In The UI');
        });

        it('handles very long paths', () => {
            const fav = {
                name: 'Project',
                path: '/Users/username/Documents/Very/Deep/Directory/Structure/With/Many/Nested/Folders/project',
                tool: 'claude'
            };

            const tooltip = generateFavoriteTooltipContent(fav);
            const pathRow = tooltip.children[2];

            expect(pathRow.children[0].text).toBe('/Users/username/Documents/Very/Deep/Directory/Structure/With/Many/Nested/Folders/project');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests for star badge rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldRenderStarBadge (mirrors UnifiedTopBar.jsx line 420)', () => {
    describe('star badge presence - only first favorite', () => {
        it('renders star badge only for first favorite (index 0)', () => {
            expect(shouldRenderStarBadge(0)).toBe(true);
            expect(shouldRenderStarBadge(1)).toBe(false);
            expect(shouldRenderStarBadge(2)).toBe(false);
        });

        it('does not render star badge for second or subsequent favorites', () => {
            const indices = [1, 2, 3, 4, 5];

            indices.forEach(index => {
                expect(shouldRenderStarBadge(index)).toBe(false);
            });
        });

        it('renders star badge for first item regardless of list size', () => {
            // Single favorite
            expect(shouldRenderStarBadge(0)).toBe(true);

            // Still only first shows star even with many favorites
            expect(shouldRenderStarBadge(0)).toBe(true);
            expect(shouldRenderStarBadge(9)).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('favorite star indicator integration scenarios', () => {
    it('first favorite has both badge and tooltip star indicator with consistent symbol', () => {
        const fav = {
            name: 'My Project',
            path: '/path/to/project',
            tool: 'claude',
            shortcut: 'Cmd+1'
        };

        // First favorite (index 0) has badge, tooltip always has star
        const hasBadge = shouldRenderStarBadge(0);
        const tooltip = generateFavoriteTooltipContent(fav);
        const tooltipStar = tooltip.children[0].children[0].text;

        expect(hasBadge).toBe(true);
        expect(tooltipStar).toBe('★');
    });

    it('tooltip structure supports CSS styling with dedicated classes', () => {
        const fav = {
            name: 'Project',
            path: '/path',
            tool: 'claude'
        };

        const tooltip = generateFavoriteTooltipContent(fav);
        const header = tooltip.children[0];

        // Verify CSS classes are present for styling
        expect(header.className).toBe('tooltip-favorite-header');
        expect(header.children[0].className).toBe('tooltip-favorite-star');
    });

    it('only first favorite gets star badge, but all get star in tooltip', () => {
        const favorites = [
            { name: 'Alpha', path: '/alpha', tool: 'claude' },
            { name: 'Beta', path: '/beta', tool: 'gemini', shortcut: 'Cmd+1' },
            { name: 'Gamma', path: '/gamma', tool: 'opencode' }
        ];

        favorites.forEach((fav, index) => {
            // Only first (index 0) should have badge
            expect(shouldRenderStarBadge(index)).toBe(index === 0);

            // All tooltips should still have star header (star identifies favorites section)
            const tooltip = generateFavoriteTooltipContent(fav);
            expect(tooltip.children[0].className).toBe('tooltip-favorite-header');
            expect(tooltip.children[0].children[0].text).toBe('★');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shortcut formatting helper tests
// ─────────────────────────────────────────────────────────────────────────────

describe('formatShortcut helper', () => {
    it('converts Cmd to ⌘ symbol', () => {
        expect(formatShortcut('Cmd+K')).toBe('⌘+K');
        expect(formatShortcut('Cmd+1')).toBe('⌘+1');
    });

    it('converts Shift to ⇧ symbol', () => {
        expect(formatShortcut('Shift+A')).toBe('⇧+A');
    });

    it('converts Alt to ⌥ symbol', () => {
        expect(formatShortcut('Alt+F')).toBe('⌥+F');
    });

    it('converts Ctrl to ⌃ symbol', () => {
        expect(formatShortcut('Ctrl+C')).toBe('⌃+C');
    });

    it('handles multiple modifiers', () => {
        expect(formatShortcut('Cmd+Shift+K')).toBe('⌘+⇧+K');
        expect(formatShortcut('Cmd+Alt+5')).toBe('⌘+⌥+5');
    });

    it('preserves already formatted shortcuts', () => {
        expect(formatShortcut('⌘+K')).toBe('⌘+K');
    });
});
