/**
 * Tests for tab context menu utility functions
 *
 * These tests verify null safety for tab context menu operations,
 * specifically addressing the crash when tab or session is undefined.
 *
 * Bug context: Right-clicking a session tab crashed the app when
 * tabContextMenu.tab or tabContextMenu.tab.session was undefined,
 * because the code accessed .session.customLabel without null checks.
 */

import { describe, it, expect } from 'vitest';
import {
    shouldRenderTabContextMenu,
    getTabCustomLabel,
    hasTabCustomLabel,
    getTabLabelButtonText,
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
});
