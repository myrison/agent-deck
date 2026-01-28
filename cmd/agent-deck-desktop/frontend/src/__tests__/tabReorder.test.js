/**
 * Tests for tab drag-and-drop reordering logic.
 *
 * The reorder function mirrors the handleReorderTab callback in App.jsx:
 *   Given a dragged tab ID and a target index, it moves the tab to that position.
 */

import { describe, it, expect } from 'vitest';

// Pure reorder function — mirrors handleReorderTab from App.jsx
function reorderTabs(tabs, draggedTabId, targetIndex) {
    const fromIndex = tabs.findIndex(t => t.id === draggedTabId);
    if (fromIndex === -1 || fromIndex === targetIndex) return tabs;
    const updated = [...tabs];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(targetIndex, 0, moved);
    return updated;
}

// ─── Helpers ────────────────────────────────────────────────────────

function makeTabs(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `tab-${i}`,
        name: `Tab ${i}`,
    }));
}

function ids(tabs) {
    return tabs.map(t => t.id);
}

// ─── reorderTabs ────────────────────────────────────────────────────

describe('reorderTabs', () => {
    it('moves a tab forward (index 0 → index 2)', () => {
        const tabs = makeTabs(4);
        const result = reorderTabs(tabs, 'tab-0', 2);
        expect(ids(result)).toEqual(['tab-1', 'tab-2', 'tab-0', 'tab-3']);
    });

    it('moves a tab backward (index 2 → index 0)', () => {
        const tabs = makeTabs(4);
        const result = reorderTabs(tabs, 'tab-2', 0);
        expect(ids(result)).toEqual(['tab-2', 'tab-0', 'tab-1', 'tab-3']);
    });

    it('moves a tab to the last position', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-0', 2);
        expect(ids(result)).toEqual(['tab-1', 'tab-2', 'tab-0']);
    });

    it('moves a tab from last to first', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-2', 0);
        expect(ids(result)).toEqual(['tab-2', 'tab-0', 'tab-1']);
    });

    it('returns same array when target equals current position (no-op)', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-1', 1);
        // Should return the original reference since no change
        expect(result).toBe(tabs);
    });

    it('returns same array for non-existent tab ID', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-99', 1);
        expect(result).toBe(tabs);
    });

    it('returns same array when only one tab exists', () => {
        const tabs = makeTabs(1);
        const result = reorderTabs(tabs, 'tab-0', 0);
        expect(result).toBe(tabs);
    });

    it('does not mutate the original array', () => {
        const tabs = makeTabs(3);
        const original = [...tabs];
        reorderTabs(tabs, 'tab-0', 2);
        expect(tabs).toEqual(original);
    });

    it('preserves all tab properties through reorder', () => {
        const tabs = [
            { id: 'tab-a', name: 'Alpha', layout: { type: 'pane' }, openedAt: 100 },
            { id: 'tab-b', name: 'Beta', layout: { type: 'pane' }, openedAt: 200 },
            { id: 'tab-c', name: 'Charlie', layout: { type: 'pane' }, openedAt: 300 },
        ];
        const result = reorderTabs(tabs, 'tab-c', 0);
        expect(result[0]).toEqual(tabs[2]); // tab-c moved to front
        expect(result[1]).toEqual(tabs[0]); // tab-a shifted
        expect(result[2]).toEqual(tabs[1]); // tab-b shifted
    });

    it('handles adjacent swap forward (index 1 → index 2)', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-1', 2);
        expect(ids(result)).toEqual(['tab-0', 'tab-2', 'tab-1']);
    });

    it('handles adjacent swap backward (index 1 → index 0)', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-1', 0);
        expect(ids(result)).toEqual(['tab-1', 'tab-0', 'tab-2']);
    });
});

// ─── Persistence integration ────────────────────────────────────────

describe('reorder persistence', () => {
    it('reordered tabs serialize in the new order', () => {
        const tabs = makeTabs(4);
        const reordered = reorderTabs(tabs, 'tab-3', 1);

        // Simulate what App.jsx does: map tabs to save format
        const serialized = reordered.map(tab => ({
            id: tab.id,
            name: tab.name,
        }));

        expect(serialized.map(t => t.id)).toEqual(['tab-0', 'tab-3', 'tab-1', 'tab-2']);
    });

    it('keyboard shortcut indices reflect reordered positions', () => {
        const tabs = makeTabs(4);
        const reordered = reorderTabs(tabs, 'tab-2', 0);

        // Cmd+1 should now be tab-2, Cmd+2 should be tab-0, etc.
        expect(reordered[0].id).toBe('tab-2'); // Cmd+1
        expect(reordered[1].id).toBe('tab-0'); // Cmd+2
        expect(reordered[2].id).toBe('tab-1'); // Cmd+3
        expect(reordered[3].id).toBe('tab-3'); // Cmd+4
    });
});
