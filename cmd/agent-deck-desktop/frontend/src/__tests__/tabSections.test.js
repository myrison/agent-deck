/**
 * Tests for tab section grouping utilities
 *
 * These utilities support the tab bar's visual grouping of local vs remote sessions
 * with colored underlines and drag-drop constraints.
 *
 * Key behaviors:
 * - Local and remote tabs are visually separated with a gap
 * - Drag-drop is constrained to within the same section
 * - Empty tabs (no session) are filtered out of display
 */

import { describe, it, expect, vi } from 'vitest';
import {
    groupTabsBySection,
    canReorderBetween,
    sectionIndexToGlobalIndex,
    isRemoteTab,
    sortTabsBySection,
} from '../utils/tabSections';

// Mock getTabSession - needed since tabSections imports from tabContextMenu
vi.mock('../utils/tabContextMenu', () => ({
    getTabSession: vi.fn((tab) => {
        if (!tab) return null;
        // Layout-based tab
        if (tab.layout?.type === 'pane') {
            return tab.layout.session || null;
        }
        // Legacy tab
        return tab.session || null;
    }),
}));

/**
 * Helper to create a local tab with session
 */
function createLocalTab(id, sessionData = {}) {
    return {
        id,
        layout: {
            type: 'pane',
            id: `pane-${id}`,
            session: {
                id: `session-${id}`,
                title: `Local Session ${id}`,
                isRemote: false,
                ...sessionData,
            },
        },
        activePaneId: `pane-${id}`,
    };
}

/**
 * Helper to create a remote tab with session
 */
function createRemoteTab(id, sessionData = {}) {
    return {
        id,
        layout: {
            type: 'pane',
            id: `pane-${id}`,
            session: {
                id: `session-${id}`,
                title: `Remote Session ${id}`,
                isRemote: true,
                remoteHost: 'server.example.com',
                ...sessionData,
            },
        },
        activePaneId: `pane-${id}`,
    };
}

/**
 * Helper to create an empty tab (no session)
 */
function createEmptyTab(id) {
    return {
        id,
        layout: {
            type: 'pane',
            id: `pane-${id}`,
            session: null,
        },
        activePaneId: `pane-${id}`,
    };
}

describe('tabSections utilities', () => {
    describe('groupTabsBySection', () => {
        describe('separates local and remote tabs', () => {
            it('returns all tabs as local when no remote sessions exist', () => {
                const tabs = [
                    createLocalTab('1'),
                    createLocalTab('2'),
                    createLocalTab('3'),
                ];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                expect(localTabs).toHaveLength(3);
                expect(remoteTabs).toHaveLength(0);
                expect(localTabs.map((t) => t.id)).toEqual(['1', '2', '3']);
            });

            it('returns all tabs as remote when no local sessions exist', () => {
                const tabs = [
                    createRemoteTab('1'),
                    createRemoteTab('2'),
                ];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                expect(localTabs).toHaveLength(0);
                expect(remoteTabs).toHaveLength(2);
            });

            it('separates mixed local and remote tabs into correct sections', () => {
                const tabs = [
                    createLocalTab('local-1'),
                    createRemoteTab('remote-1'),
                    createLocalTab('local-2'),
                    createRemoteTab('remote-2'),
                ];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                expect(localTabs.map((t) => t.id)).toEqual(['local-1', 'local-2']);
                expect(remoteTabs.map((t) => t.id)).toEqual(['remote-1', 'remote-2']);
            });

            it('preserves original order within each section', () => {
                // Tabs in interleaved order
                const tabs = [
                    createLocalTab('L1'),
                    createRemoteTab('R1'),
                    createLocalTab('L2'),
                    createRemoteTab('R2'),
                    createLocalTab('L3'),
                ];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                // Order within section should match original insertion order
                expect(localTabs.map((t) => t.id)).toEqual(['L1', 'L2', 'L3']);
                expect(remoteTabs.map((t) => t.id)).toEqual(['R1', 'R2']);
            });
        });

        describe('filters empty tabs', () => {
            it('excludes tabs with no session from both sections', () => {
                const tabs = [
                    createLocalTab('local-1'),
                    createEmptyTab('empty-1'),
                    createRemoteTab('remote-1'),
                    createEmptyTab('empty-2'),
                ];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                expect(localTabs).toHaveLength(1);
                expect(remoteTabs).toHaveLength(1);
                // Empty tabs should not appear in either section
                const allIds = [...localTabs, ...remoteTabs].map((t) => t.id);
                expect(allIds).not.toContain('empty-1');
                expect(allIds).not.toContain('empty-2');
            });

            it('returns empty sections when all tabs are empty', () => {
                const tabs = [createEmptyTab('1'), createEmptyTab('2')];

                const { localTabs, remoteTabs } = groupTabsBySection(tabs);

                expect(localTabs).toHaveLength(0);
                expect(remoteTabs).toHaveLength(0);
            });
        });

        it('handles empty input array', () => {
            const { localTabs, remoteTabs } = groupTabsBySection([]);

            expect(localTabs).toEqual([]);
            expect(remoteTabs).toEqual([]);
        });
    });

    describe('canReorderBetween', () => {
        describe('allows reordering within same section', () => {
            it('returns true when both tabs are local', () => {
                const draggedTab = createLocalTab('dragged');
                const targetTab = createLocalTab('target');

                expect(canReorderBetween(draggedTab, targetTab)).toBe(true);
            });

            it('returns true when both tabs are remote', () => {
                const draggedTab = createRemoteTab('dragged');
                const targetTab = createRemoteTab('target');

                expect(canReorderBetween(draggedTab, targetTab)).toBe(true);
            });
        });

        describe('blocks cross-section reordering', () => {
            it('returns false when dragging local tab to remote section', () => {
                const draggedTab = createLocalTab('local');
                const targetTab = createRemoteTab('remote');

                expect(canReorderBetween(draggedTab, targetTab)).toBe(false);
            });

            it('returns false when dragging remote tab to local section', () => {
                const draggedTab = createRemoteTab('remote');
                const targetTab = createLocalTab('local');

                expect(canReorderBetween(draggedTab, targetTab)).toBe(false);
            });
        });
    });

    describe('sectionIndexToGlobalIndex', () => {
        it('returns section index directly for local tabs', () => {
            const localTabs = [createLocalTab('L1'), createLocalTab('L2')];
            const remoteTabs = [createRemoteTab('R1')];

            // Local section index 0 -> global index 0
            expect(sectionIndexToGlobalIndex(0, false, localTabs, remoteTabs)).toBe(0);
            // Local section index 1 -> global index 1
            expect(sectionIndexToGlobalIndex(1, false, localTabs, remoteTabs)).toBe(1);
        });

        it('offsets remote section indices by local tab count', () => {
            const localTabs = [createLocalTab('L1'), createLocalTab('L2'), createLocalTab('L3')];
            const remoteTabs = [createRemoteTab('R1'), createRemoteTab('R2')];

            // Remote section index 0 -> global index 3 (after 3 local tabs)
            expect(sectionIndexToGlobalIndex(0, true, localTabs, remoteTabs)).toBe(3);
            // Remote section index 1 -> global index 4
            expect(sectionIndexToGlobalIndex(1, true, localTabs, remoteTabs)).toBe(4);
        });

        it('handles empty local section', () => {
            const localTabs = [];
            const remoteTabs = [createRemoteTab('R1'), createRemoteTab('R2')];

            // With no local tabs, remote index 0 maps to global 0
            expect(sectionIndexToGlobalIndex(0, true, localTabs, remoteTabs)).toBe(0);
            expect(sectionIndexToGlobalIndex(1, true, localTabs, remoteTabs)).toBe(1);
        });
    });

    describe('isRemoteTab', () => {
        it('returns true for remote tab', () => {
            const remoteTab = createRemoteTab('remote');
            expect(isRemoteTab(remoteTab)).toBe(true);
        });

        it('returns false for local tab', () => {
            const localTab = createLocalTab('local');
            expect(isRemoteTab(localTab)).toBe(false);
        });

        it('returns false for null/undefined tab', () => {
            expect(isRemoteTab(null)).toBe(false);
            expect(isRemoteTab(undefined)).toBe(false);
        });
    });

    describe('sortTabsBySection', () => {
        it('places local tabs before remote tabs', () => {
            const tabs = [
                createRemoteTab('R1'),
                createLocalTab('L1'),
                createRemoteTab('R2'),
                createLocalTab('L2'),
            ];

            const sorted = sortTabsBySection(tabs);

            // All local tabs should come first
            expect(sorted[0].id).toBe('L1');
            expect(sorted[1].id).toBe('L2');
            expect(sorted[2].id).toBe('R1');
            expect(sorted[3].id).toBe('R2');
        });

        it('preserves relative order within sections (stable sort behavior)', () => {
            const tabs = [
                createRemoteTab('R1'),
                createRemoteTab('R2'),
                createLocalTab('L1'),
                createLocalTab('L2'),
                createRemoteTab('R3'),
            ];

            const sorted = sortTabsBySection(tabs);

            // Local tabs should maintain their relative order
            const localIds = sorted.filter((t) => !isRemoteTab(t)).map((t) => t.id);
            expect(localIds).toEqual(['L1', 'L2']);

            // Remote tabs should maintain their relative order
            const remoteIds = sorted.filter((t) => isRemoteTab(t)).map((t) => t.id);
            expect(remoteIds).toEqual(['R1', 'R2', 'R3']);
        });

        it('does not modify the original array', () => {
            const tabs = [createRemoteTab('R1'), createLocalTab('L1')];
            const originalOrder = [...tabs];

            sortTabsBySection(tabs);

            // Original array should be unchanged
            expect(tabs[0].id).toBe(originalOrder[0].id);
            expect(tabs[1].id).toBe(originalOrder[1].id);
        });

        it('handles empty array', () => {
            expect(sortTabsBySection([])).toEqual([]);
        });
    });

    describe('integration: drag-drop workflow', () => {
        it('correctly identifies valid drop targets after grouping', () => {
            const tabs = [
                createLocalTab('L1'),
                createLocalTab('L2'),
                createRemoteTab('R1'),
                createRemoteTab('R2'),
            ];

            const { localTabs, remoteTabs } = groupTabsBySection(tabs);

            // Dragging L1 - can drop on L2 (same section), not on R1/R2
            expect(canReorderBetween(localTabs[0], localTabs[1])).toBe(true);
            expect(canReorderBetween(localTabs[0], remoteTabs[0])).toBe(false);
            expect(canReorderBetween(localTabs[0], remoteTabs[1])).toBe(false);

            // Dragging R1 - can drop on R2 (same section), not on L1/L2
            expect(canReorderBetween(remoteTabs[0], remoteTabs[1])).toBe(true);
            expect(canReorderBetween(remoteTabs[0], localTabs[0])).toBe(false);
            expect(canReorderBetween(remoteTabs[0], localTabs[1])).toBe(false);
        });

        it('computes correct global indices for reorder operations', () => {
            const tabs = [
                createLocalTab('L1'),
                createLocalTab('L2'),
                createRemoteTab('R1'),
                createRemoteTab('R2'),
            ];

            const { localTabs, remoteTabs } = groupTabsBySection(tabs);

            // Dropping at remote section index 1 (between R1 and R2)
            // should translate to global index 3 (after L1, L2, R1)
            const globalIndex = sectionIndexToGlobalIndex(1, true, localTabs, remoteTabs);
            expect(globalIndex).toBe(3);

            // Dropping at local section index 0 (before L1)
            // should translate to global index 0
            const localGlobalIndex = sectionIndexToGlobalIndex(0, false, localTabs, remoteTabs);
            expect(localGlobalIndex).toBe(0);
        });
    });
});
