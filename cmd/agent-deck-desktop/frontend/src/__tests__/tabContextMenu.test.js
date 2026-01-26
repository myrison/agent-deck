/**
 * Tests for tab context menu utility functions
 *
 * These tests verify null safety for tab context menu operations,
 * specifically addressing the crash when tab or session is undefined.
 *
 * Bug context: Right-clicking a session tab crashed the app when
 * tabContextMenu.tab or tabContextMenu.tab.session was undefined,
 * because the code accessed .session.customLabel without null checks.
 *
 * Regression: The fix initially broke the menu for layout-based tabs
 * because tabs use { layout: { type: 'pane', session: {...} } } structure,
 * not { session: {...} } directly.
 */

import { describe, it, expect } from 'vitest';
import {
    shouldRenderTabContextMenu,
    getTabCustomLabel,
    hasTabCustomLabel,
    getTabLabelButtonText,
    getTabSession,
    updateSessionLabelInLayout,
    tabContainsSession,
} from '../utils/tabContextMenu';

describe('tabContextMenu utilities', () => {
    describe('shouldRenderTabContextMenu', () => {
        describe('returns false for invalid menu states', () => {
            it('returns false when tabContextMenu is null', () => {
                expect(shouldRenderTabContextMenu(null)).toBe(false);
            });

            it('returns false when tabContextMenu is undefined', () => {
                expect(shouldRenderTabContextMenu(undefined)).toBe(false);
            });

            it('returns false when tabContextMenu.tab is undefined', () => {
                const menu = { x: 100, y: 200, tab: undefined };
                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });

            it('returns false when tabContextMenu.tab is null', () => {
                const menu = { x: 100, y: 200, tab: null };
                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });

            it('returns false when tabContextMenu.tab.session is undefined', () => {
                const menu = { x: 100, y: 200, tab: { id: 'tab-1', session: undefined } };
                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });

            it('returns false when tabContextMenu.tab.session is null', () => {
                const menu = { x: 100, y: 200, tab: { id: 'tab-1', session: null } };
                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });

            it('returns false when tab exists but has no session property', () => {
                const menu = { x: 100, y: 200, tab: { id: 'tab-1' } };
                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });
        });

        describe('returns true for valid menu states', () => {
            it('returns true when tab has valid session object', () => {
                const menu = {
                    x: 100,
                    y: 200,
                    tab: {
                        id: 'tab-1',
                        session: { id: 'session-1', title: 'Test', customLabel: null },
                    },
                };
                expect(shouldRenderTabContextMenu(menu)).toBe(true);
            });

            it('returns true when session has custom label', () => {
                const menu = {
                    x: 100,
                    y: 200,
                    tab: {
                        id: 'tab-1',
                        session: { id: 'session-1', title: 'Test', customLabel: 'My Label' },
                    },
                };
                expect(shouldRenderTabContextMenu(menu)).toBe(true);
            });

            it('returns true when session has empty string custom label', () => {
                const menu = {
                    x: 100,
                    y: 200,
                    tab: {
                        id: 'tab-1',
                        session: { id: 'session-1', title: 'Test', customLabel: '' },
                    },
                };
                expect(shouldRenderTabContextMenu(menu)).toBe(true);
            });

            it('returns true with minimal valid session object', () => {
                const menu = {
                    x: 0,
                    y: 0,
                    tab: { id: 't', session: {} },
                };
                expect(shouldRenderTabContextMenu(menu)).toBe(true);
            });
        });
    });

    describe('getTabCustomLabel', () => {
        it('returns null when tab is null', () => {
            expect(getTabCustomLabel(null)).toBe(null);
        });

        it('returns null when tab is undefined', () => {
            expect(getTabCustomLabel(undefined)).toBe(null);
        });

        it('returns null when tab.session is undefined', () => {
            expect(getTabCustomLabel({ id: 'tab-1' })).toBe(null);
        });

        it('returns null when tab.session is null', () => {
            expect(getTabCustomLabel({ id: 'tab-1', session: null })).toBe(null);
        });

        it('returns null when session.customLabel is undefined', () => {
            expect(getTabCustomLabel({ id: 'tab-1', session: { id: 's1' } })).toBe(null);
        });

        it('returns null when session.customLabel is null', () => {
            expect(getTabCustomLabel({ id: 'tab-1', session: { customLabel: null } })).toBe(null);
        });

        it('returns null when session.customLabel is empty string', () => {
            expect(getTabCustomLabel({ id: 'tab-1', session: { customLabel: '' } })).toBe(null);
        });

        it('returns the custom label when set', () => {
            const tab = { id: 'tab-1', session: { customLabel: 'My Custom Label' } };
            expect(getTabCustomLabel(tab)).toBe('My Custom Label');
        });

        it('returns the custom label with special characters', () => {
            const tab = { id: 'tab-1', session: { customLabel: 'Test 🚀 Label!' } };
            expect(getTabCustomLabel(tab)).toBe('Test 🚀 Label!');
        });
    });

    describe('hasTabCustomLabel', () => {
        it('returns false when tab is null', () => {
            expect(hasTabCustomLabel(null)).toBe(false);
        });

        it('returns false when tab is undefined', () => {
            expect(hasTabCustomLabel(undefined)).toBe(false);
        });

        it('returns false when session is undefined', () => {
            expect(hasTabCustomLabel({ id: 'tab-1' })).toBe(false);
        });

        it('returns false when customLabel is null', () => {
            expect(hasTabCustomLabel({ id: 'tab-1', session: { customLabel: null } })).toBe(false);
        });

        it('returns false when customLabel is empty string', () => {
            expect(hasTabCustomLabel({ id: 'tab-1', session: { customLabel: '' } })).toBe(false);
        });

        it('returns false when customLabel is whitespace only', () => {
            expect(hasTabCustomLabel({ id: 'tab-1', session: { customLabel: '   ' } })).toBe(false);
        });

        it('returns true when customLabel has content', () => {
            expect(hasTabCustomLabel({ id: 'tab-1', session: { customLabel: 'Label' } })).toBe(true);
        });

        it('returns true when customLabel has content with surrounding whitespace', () => {
            expect(hasTabCustomLabel({ id: 'tab-1', session: { customLabel: '  Label  ' } })).toBe(true);
        });
    });

    describe('getTabLabelButtonText', () => {
        it('returns "Add Custom Label" when tab is null', () => {
            expect(getTabLabelButtonText(null)).toBe('Add Custom Label');
        });

        it('returns "Add Custom Label" when tab is undefined', () => {
            expect(getTabLabelButtonText(undefined)).toBe('Add Custom Label');
        });

        it('returns "Add Custom Label" when session is missing', () => {
            expect(getTabLabelButtonText({ id: 'tab-1' })).toBe('Add Custom Label');
        });

        it('returns "Add Custom Label" when customLabel is null', () => {
            const tab = { id: 'tab-1', session: { customLabel: null } };
            expect(getTabLabelButtonText(tab)).toBe('Add Custom Label');
        });

        it('returns "Add Custom Label" when customLabel is empty', () => {
            const tab = { id: 'tab-1', session: { customLabel: '' } };
            expect(getTabLabelButtonText(tab)).toBe('Add Custom Label');
        });

        it('returns "Edit Custom Label" when customLabel exists', () => {
            const tab = { id: 'tab-1', session: { customLabel: 'My Label' } };
            expect(getTabLabelButtonText(tab)).toBe('Edit Custom Label');
        });
    });

    describe('real-world scenarios', () => {
        it('handles a freshly created tab without session data', () => {
            // Simulates a race condition where tab is created but session not yet loaded
            const partialTab = { id: 'new-tab' };
            const menu = { x: 100, y: 200, tab: partialTab };

            expect(shouldRenderTabContextMenu(menu)).toBe(false);
            expect(getTabCustomLabel(partialTab)).toBe(null);
            expect(hasTabCustomLabel(partialTab)).toBe(false);
            expect(getTabLabelButtonText(partialTab)).toBe('Add Custom Label');
        });

        it('handles a tab where session was removed/cleared', () => {
            // Simulates session being cleaned up while tab still exists
            const orphanedTab = { id: 'orphan-tab', session: null };
            const menu = { x: 100, y: 200, tab: orphanedTab };

            expect(shouldRenderTabContextMenu(menu)).toBe(false);
            expect(getTabCustomLabel(orphanedTab)).toBe(null);
            expect(hasTabCustomLabel(orphanedTab)).toBe(false);
        });

        it('handles normal tab with labeled session', () => {
            const normalTab = {
                id: 'tab-1',
                session: {
                    id: 'session-1',
                    title: 'claude-code-session',
                    customLabel: 'Bug Fix Work',
                    tool: 'claude',
                },
            };
            const menu = { x: 150, y: 80, tab: normalTab };

            expect(shouldRenderTabContextMenu(menu)).toBe(true);
            expect(getTabCustomLabel(normalTab)).toBe('Bug Fix Work');
            expect(hasTabCustomLabel(normalTab)).toBe(true);
            expect(getTabLabelButtonText(normalTab)).toBe('Edit Custom Label');
        });

        it('handles normal tab without label', () => {
            const unlabeledTab = {
                id: 'tab-2',
                session: {
                    id: 'session-2',
                    title: 'gemini-session',
                    customLabel: '',
                    tool: 'gemini',
                },
            };
            const menu = { x: 200, y: 100, tab: unlabeledTab };

            expect(shouldRenderTabContextMenu(menu)).toBe(true);
            expect(getTabCustomLabel(unlabeledTab)).toBe(null);
            expect(hasTabCustomLabel(unlabeledTab)).toBe(false);
            expect(getTabLabelButtonText(unlabeledTab)).toBe('Add Custom Label');
        });
    });

    /**
     * REGRESSION TESTS: Layout-based tab structure
     *
     * These tests ensure the context menu works with the actual tab structure
     * used in the app, where sessions are inside layout panes, not directly
     * on the tab object.
     *
     * Tab structure:
     *   { id, name, layout: LayoutNode, activePaneId, openedAt, zoomedPaneId }
     *
     * Single pane layout:
     *   { type: 'pane', id: 'pane-1', sessionId: 'x', session: {...} }
     *
     * Split layout:
     *   { type: 'split', direction: 'vertical', ratio: 0.5, children: [pane, pane] }
     */
    describe('layout-based tab structure (regression)', () => {
        describe('getTabSession', () => {
            it('extracts session from single-pane layout', () => {
                const layoutTab = {
                    id: 'tab-1',
                    name: 'Test Session',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        sessionId: 'session-1',
                        session: {
                            id: 'session-1',
                            title: 'Test Session',
                            customLabel: 'My Label',
                        },
                    },
                    activePaneId: 'pane-1',
                    openedAt: Date.now(),
                    zoomedPaneId: null,
                };

                expect(getTabSession(layoutTab)).toEqual({
                    id: 'session-1',
                    title: 'Test Session',
                    customLabel: 'My Label',
                });
            });

            it('extracts session from active pane in split layout', () => {
                const splitTab = {
                    id: 'tab-1',
                    name: 'Split Tab',
                    layout: {
                        type: 'split',
                        direction: 'vertical',
                        ratio: 0.5,
                        children: [
                            {
                                type: 'pane',
                                id: 'pane-1',
                                sessionId: 'session-1',
                                session: { id: 'session-1', title: 'Left', customLabel: null },
                            },
                            {
                                type: 'pane',
                                id: 'pane-2',
                                sessionId: 'session-2',
                                session: { id: 'session-2', title: 'Right', customLabel: 'Active' },
                            },
                        ],
                    },
                    activePaneId: 'pane-2', // Right pane is active
                    openedAt: Date.now(),
                    zoomedPaneId: null,
                };

                const session = getTabSession(splitTab);
                expect(session.id).toBe('session-2');
                expect(session.customLabel).toBe('Active');
            });

            it('falls back to first session when active pane has no session', () => {
                const splitTab = {
                    id: 'tab-1',
                    name: 'Split Tab',
                    layout: {
                        type: 'split',
                        direction: 'vertical',
                        ratio: 0.5,
                        children: [
                            {
                                type: 'pane',
                                id: 'pane-1',
                                sessionId: null,
                                session: null, // Empty pane
                            },
                            {
                                type: 'pane',
                                id: 'pane-2',
                                sessionId: 'session-2',
                                session: { id: 'session-2', title: 'Right', customLabel: 'Has Session' },
                            },
                        ],
                    },
                    activePaneId: 'pane-1', // Active pane is empty
                    openedAt: Date.now(),
                    zoomedPaneId: null,
                };

                const session = getTabSession(splitTab);
                expect(session.id).toBe('session-2');
            });

            it('returns null for layout with no sessions', () => {
                const emptyLayoutTab = {
                    id: 'tab-1',
                    name: 'Empty Tab',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        sessionId: null,
                        session: null,
                    },
                    activePaneId: 'pane-1',
                };

                expect(getTabSession(emptyLayoutTab)).toBe(null);
            });

            it('handles deeply nested split layouts', () => {
                const nestedTab = {
                    id: 'tab-1',
                    name: 'Nested',
                    layout: {
                        type: 'split',
                        direction: 'vertical',
                        children: [
                            {
                                type: 'split',
                                direction: 'horizontal',
                                children: [
                                    { type: 'pane', id: 'pane-1', session: null },
                                    { type: 'pane', id: 'pane-2', session: { id: 's2', title: 'Deep', customLabel: 'Found' } },
                                ],
                            },
                            { type: 'pane', id: 'pane-3', session: null },
                        ],
                    },
                    activePaneId: 'pane-2',
                };

                const session = getTabSession(nestedTab);
                expect(session.customLabel).toBe('Found');
            });

            it('falls back to legacy tab.session structure', () => {
                const legacyTab = {
                    id: 'tab-1',
                    session: { id: 's1', title: 'Legacy', customLabel: 'Old Style' },
                };

                expect(getTabSession(legacyTab).customLabel).toBe('Old Style');
            });
        });

        describe('shouldRenderTabContextMenu with layout tabs', () => {
            it('returns true for layout tab with session', () => {
                const menu = {
                    x: 100,
                    y: 200,
                    tab: {
                        id: 'tab-1',
                        layout: {
                            type: 'pane',
                            id: 'pane-1',
                            session: { id: 's1', title: 'Test' },
                        },
                        activePaneId: 'pane-1',
                    },
                };

                expect(shouldRenderTabContextMenu(menu)).toBe(true);
            });

            it('returns false for layout tab with empty pane', () => {
                const menu = {
                    x: 100,
                    y: 200,
                    tab: {
                        id: 'tab-1',
                        layout: {
                            type: 'pane',
                            id: 'pane-1',
                            session: null,
                        },
                        activePaneId: 'pane-1',
                    },
                };

                expect(shouldRenderTabContextMenu(menu)).toBe(false);
            });
        });

        describe('hasTabCustomLabel with layout tabs', () => {
            it('returns true when layout tab session has label', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's1', customLabel: 'My Work' },
                    },
                    activePaneId: 'pane-1',
                };

                expect(hasTabCustomLabel(tab)).toBe(true);
            });

            it('returns false when layout tab session has no label', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's1', customLabel: '' },
                    },
                    activePaneId: 'pane-1',
                };

                expect(hasTabCustomLabel(tab)).toBe(false);
            });
        });

        describe('getTabCustomLabel with layout tabs', () => {
            it('returns label from layout tab session', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's1', customLabel: 'Important Task' },
                    },
                    activePaneId: 'pane-1',
                };

                expect(getTabCustomLabel(tab)).toBe('Important Task');
            });
        });

        describe('updateSessionLabelInLayout', () => {
            it('updates label in single-pane layout', () => {
                const layout = {
                    type: 'pane',
                    id: 'pane-1',
                    session: { id: 'session-1', title: 'Test', customLabel: null },
                };

                const updated = updateSessionLabelInLayout(layout, 'session-1', 'New Label');

                expect(updated.session.customLabel).toBe('New Label');
                expect(updated.session.id).toBe('session-1');
            });

            it('updates label in split layout', () => {
                const layout = {
                    type: 'split',
                    direction: 'vertical',
                    children: [
                        { type: 'pane', id: 'pane-1', session: { id: 's1', customLabel: null } },
                        { type: 'pane', id: 'pane-2', session: { id: 's2', customLabel: 'Old' } },
                    ],
                };

                const updated = updateSessionLabelInLayout(layout, 's2', 'New Label');

                expect(updated.children[0].session.customLabel).toBeFalsy(); // unchanged (null or undefined)
                expect(updated.children[1].session.customLabel).toBe('New Label');
            });

            it('removes label when empty string passed', () => {
                const layout = {
                    type: 'pane',
                    id: 'pane-1',
                    session: { id: 's1', customLabel: 'Existing' },
                };

                const updated = updateSessionLabelInLayout(layout, 's1', '');

                expect(updated.session.customLabel).toBeUndefined();
            });

            it('does not modify layout when sessionId not found', () => {
                const layout = {
                    type: 'pane',
                    id: 'pane-1',
                    session: { id: 's1', customLabel: 'Keep' },
                };

                const updated = updateSessionLabelInLayout(layout, 'nonexistent', 'New');

                expect(updated.session.customLabel).toBe('Keep');
            });

            it('handles deeply nested layouts', () => {
                const layout = {
                    type: 'split',
                    children: [
                        {
                            type: 'split',
                            children: [
                                { type: 'pane', id: 'p1', session: { id: 's1' } },
                                { type: 'pane', id: 'p2', session: { id: 's2', customLabel: 'Deep' } },
                            ],
                        },
                        { type: 'pane', id: 'p3', session: { id: 's3' } },
                    ],
                };

                const updated = updateSessionLabelInLayout(layout, 's2', 'Updated Deep');

                expect(updated.children[0].children[1].session.customLabel).toBe('Updated Deep');
            });

            it('handles null layout gracefully', () => {
                expect(updateSessionLabelInLayout(null, 's1', 'Label')).toBeNull();
            });

            it('handles pane with null session', () => {
                const layout = {
                    type: 'pane',
                    id: 'pane-1',
                    session: null,
                };

                const updated = updateSessionLabelInLayout(layout, 's1', 'Label');

                expect(updated.session).toBeNull();
            });
        });

        describe('tabContainsSession', () => {
            it('returns true for layout tab containing session', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 'session-123' },
                    },
                };

                expect(tabContainsSession(tab, 'session-123')).toBe(true);
            });

            it('returns false for layout tab not containing session', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 'session-123' },
                    },
                };

                expect(tabContainsSession(tab, 'session-456')).toBe(false);
            });

            it('finds session in split layout', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'split',
                        children: [
                            { type: 'pane', id: 'p1', session: { id: 's1' } },
                            { type: 'pane', id: 'p2', session: { id: 's2' } },
                        ],
                    },
                };

                expect(tabContainsSession(tab, 's1')).toBe(true);
                expect(tabContainsSession(tab, 's2')).toBe(true);
                expect(tabContainsSession(tab, 's3')).toBe(false);
            });

            it('returns true for legacy tab.session structure', () => {
                const tab = {
                    id: 'tab-1',
                    session: { id: 'legacy-session' },
                };

                expect(tabContainsSession(tab, 'legacy-session')).toBe(true);
            });

            it('returns false for null/undefined inputs', () => {
                expect(tabContainsSession(null, 's1')).toBe(false);
                expect(tabContainsSession(undefined, 's1')).toBe(false);
                expect(tabContainsSession({ id: 'tab' }, null)).toBe(false);
                expect(tabContainsSession({ id: 'tab' }, undefined)).toBe(false);
            });

            it('handles tab with empty panes', () => {
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: null,
                    },
                };

                expect(tabContainsSession(tab, 's1')).toBe(false);
            });
        });

        describe('getTabSession for handler operations', () => {
            it('returns session with id for UpdateSessionCustomLabel calls', () => {
                // This test ensures the session has an id property for API calls
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: {
                            id: 'session-abc-123',
                            title: 'Test',
                            customLabel: 'My Label',
                        },
                    },
                    activePaneId: 'pane-1',
                };

                const session = getTabSession(tab);
                expect(session).not.toBeNull();
                expect(session.id).toBe('session-abc-123');
                expect(session.customLabel).toBe('My Label');
            });

            it('returns null for tab with empty pane (prevents API calls)', () => {
                // Handler should check for null session before making API calls
                const emptyPaneTab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: null,
                    },
                    activePaneId: 'pane-1',
                };

                expect(getTabSession(emptyPaneTab)).toBeNull();
            });

            it('works with RenameDialog props pattern', () => {
                // Tests the pattern used in RenameDialog currentName prop
                const tab = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's1', customLabel: 'Existing Label' },
                    },
                    activePaneId: 'pane-1',
                };

                // Pattern: getTabSession(labelingTab)?.customLabel || ''
                const currentName = getTabSession(tab)?.customLabel || '';
                expect(currentName).toBe('Existing Label');

                // With no label
                const tabNoLabel = {
                    ...tab,
                    layout: { ...tab.layout, session: { id: 's1', customLabel: null } },
                };
                const noLabelName = getTabSession(tabNoLabel)?.customLabel || '';
                expect(noLabelName).toBe('');
            });

            it('works with title dialog pattern (Edit vs Add)', () => {
                // Tests the pattern for determining dialog title
                const tabWithLabel = {
                    id: 'tab-1',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's1', customLabel: 'Has Label' },
                    },
                    activePaneId: 'pane-1',
                };

                const tabNoLabel = {
                    id: 'tab-2',
                    layout: {
                        type: 'pane',
                        id: 'pane-1',
                        session: { id: 's2', customLabel: '' },
                    },
                    activePaneId: 'pane-1',
                };

                // Pattern: getTabSession(labelingTab)?.customLabel ? 'Edit...' : 'Add...'
                const titleWithLabel = getTabSession(tabWithLabel)?.customLabel ? 'Edit Custom Label' : 'Add Custom Label';
                const titleNoLabel = getTabSession(tabNoLabel)?.customLabel ? 'Edit Custom Label' : 'Add Custom Label';

                expect(titleWithLabel).toBe('Edit Custom Label');
                expect(titleNoLabel).toBe('Add Custom Label');
            });
        });
    });
});
