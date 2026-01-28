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

    it('preserves order when target equals current position (no-op)', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-1', 1);
        expect(ids(result)).toEqual(['tab-0', 'tab-1', 'tab-2']);
    });

    it('preserves order for non-existent tab ID', () => {
        const tabs = makeTabs(3);
        const result = reorderTabs(tabs, 'tab-99', 1);
        expect(ids(result)).toEqual(['tab-0', 'tab-1', 'tab-2']);
    });

    it('preserves order when only one tab exists', () => {
        const tabs = makeTabs(1);
        const result = reorderTabs(tabs, 'tab-0', 0);
        expect(ids(result)).toEqual(['tab-0']);
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
    it('reordered tab order persists through multiple reorders', () => {
        let tabs = makeTabs(4);
        tabs = reorderTabs(tabs, 'tab-3', 1);
        expect(ids(tabs)).toEqual(['tab-0', 'tab-3', 'tab-1', 'tab-2']);

        // Second reorder builds on the first
        tabs = reorderTabs(tabs, 'tab-0', 3);
        expect(ids(tabs)).toEqual(['tab-3', 'tab-1', 'tab-2', 'tab-0']);
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

// ─── Drop target index calculation ──────────────────────────────────
//
// Behavioral extraction: mirrors the handleTabDrop logic in UnifiedTopBar.jsx
// (lines 288-302). This is the bridge between the drag event (which tab was
// dropped on, which side) and the final reorder index passed to onReorderTab.
//
// The key behavior: when dragging a tab from BEFORE the drop target, the
// target index must be decremented by 1, because removing the dragged tab
// shifts everything left.

/**
 * Mirrors handleTabDrop in UnifiedTopBar.jsx.
 * Given the drag state and the tab list, computes what (draggedTabId, adjustedIndex)
 * would be passed to onReorderTab.
 *
 * Returns null if the drop should be a no-op (missing state, invalid target).
 */
function computeDropTarget(openTabs, dragState) {
    if (!dragState?.draggedTabId || !dragState.overTabId) return null;

    const overIndex = openTabs.findIndex(t => t.id === dragState.overTabId);
    if (overIndex === -1) return null;

    const targetIndex = dragState.dropSide === 'right' ? overIndex + 1 : overIndex;
    const fromIndex = openTabs.findIndex(t => t.id === dragState.draggedTabId);
    const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;

    return { draggedTabId: dragState.draggedTabId, targetIndex: adjustedIndex };
}

describe('computeDropTarget (mirrors handleTabDrop in UnifiedTopBar.jsx)', () => {
    it('drops on the left side of a tab places before that tab', () => {
        // Drag tab-3 and drop on the LEFT side of tab-1
        // tab-3 is at index 3, tab-1 is at index 1
        // targetIndex = overIndex = 1, fromIndex = 3
        // fromIndex (3) > targetIndex (1), so no adjustment → adjustedIndex = 1
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-3',
            overTabId: 'tab-1',
            dropSide: 'left',
        });
        expect(result).toEqual({ draggedTabId: 'tab-3', targetIndex: 1 });
        // Verify end-to-end: reorder should place tab-3 at index 1
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-0', 'tab-3', 'tab-1', 'tab-2']);
    });

    it('drops on the right side of a tab places after that tab', () => {
        // Drag tab-0 and drop on the RIGHT side of tab-2
        // tab-0 is at index 0, tab-2 is at index 2
        // targetIndex = overIndex + 1 = 3, fromIndex = 0
        // fromIndex (0) < targetIndex (3), so adjusted = 3 - 1 = 2
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-0',
            overTabId: 'tab-2',
            dropSide: 'right',
        });
        expect(result).toEqual({ draggedTabId: 'tab-0', targetIndex: 2 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-1', 'tab-2', 'tab-0', 'tab-3']);
    });

    it('adjusts index when dragging from before the drop target', () => {
        // Drag tab-0 and drop on the LEFT side of tab-2
        // targetIndex = overIndex = 2, fromIndex = 0
        // fromIndex (0) < targetIndex (2), so adjusted = 2 - 1 = 1
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-0',
            overTabId: 'tab-2',
            dropSide: 'left',
        });
        expect(result).toEqual({ draggedTabId: 'tab-0', targetIndex: 1 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-1', 'tab-0', 'tab-2', 'tab-3']);
    });

    it('does not adjust index when dragging from after the drop target', () => {
        // Drag tab-3 and drop on the RIGHT side of tab-1
        // targetIndex = overIndex + 1 = 2, fromIndex = 3
        // fromIndex (3) > targetIndex (2), so no adjustment → adjustedIndex = 2
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-3',
            overTabId: 'tab-1',
            dropSide: 'right',
        });
        expect(result).toEqual({ draggedTabId: 'tab-3', targetIndex: 2 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-0', 'tab-1', 'tab-3', 'tab-2']);
    });

    it('handles drop on right side of last tab (move to end)', () => {
        // Drag tab-0 to the right side of the last tab (tab-3)
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-0',
            overTabId: 'tab-3',
            dropSide: 'right',
        });
        // targetIndex = 4, fromIndex = 0, adjusted = 4 - 1 = 3
        expect(result).toEqual({ draggedTabId: 'tab-0', targetIndex: 3 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-1', 'tab-2', 'tab-3', 'tab-0']);
    });

    it('handles drop on left side of first tab (move to start)', () => {
        // Drag tab-3 to the left side of the first tab (tab-0)
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-3',
            overTabId: 'tab-0',
            dropSide: 'left',
        });
        // targetIndex = 0, fromIndex = 3, no adjustment
        expect(result).toEqual({ draggedTabId: 'tab-3', targetIndex: 0 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-3', 'tab-0', 'tab-1', 'tab-2']);
    });

    it('handles adjacent tab swap via right-side drop', () => {
        // Drag tab-1 onto the right side of tab-2 (adjacent swap forward)
        const tabs = makeTabs(4);
        const result = computeDropTarget(tabs, {
            draggedTabId: 'tab-1',
            overTabId: 'tab-2',
            dropSide: 'right',
        });
        // targetIndex = 3, fromIndex = 1, adjusted = 3 - 1 = 2
        expect(result).toEqual({ draggedTabId: 'tab-1', targetIndex: 2 });
        expect(ids(reorderTabs(tabs, result.draggedTabId, result.targetIndex)))
            .toEqual(['tab-0', 'tab-2', 'tab-1', 'tab-3']);
    });

    it('returns null when draggedTabId is missing', () => {
        const tabs = makeTabs(3);
        expect(computeDropTarget(tabs, { draggedTabId: null, overTabId: 'tab-1', dropSide: 'left' })).toBeNull();
    });

    it('returns null when overTabId is missing', () => {
        const tabs = makeTabs(3);
        expect(computeDropTarget(tabs, { draggedTabId: 'tab-0', overTabId: null, dropSide: 'left' })).toBeNull();
    });

    it('returns null when dragState is null', () => {
        const tabs = makeTabs(3);
        expect(computeDropTarget(tabs, null)).toBeNull();
    });

    it('returns null when overTabId does not exist in tabs', () => {
        const tabs = makeTabs(3);
        expect(computeDropTarget(tabs, {
            draggedTabId: 'tab-0',
            overTabId: 'tab-99',
            dropSide: 'left',
        })).toBeNull();
    });
});

// ─── Drop side determination ────────────────────────────────────────
//
// Behavioral extraction: mirrors the drop-side calculation in
// handleTabDragOver (UnifiedTopBar.jsx lines 280-282).
// Determines whether a drop indicator should appear on the left or right
// side of a tab based on cursor position relative to the tab's horizontal
// midpoint.

/**
 * Mirrors the drop side calculation in handleTabDragOver.
 * Given a tab's bounding rect and the cursor's clientX, returns 'left' or 'right'.
 */
function computeDropSide(rect, clientX) {
    const midX = rect.left + rect.width / 2;
    return clientX < midX ? 'left' : 'right';
}

describe('computeDropSide (mirrors handleTabDragOver in UnifiedTopBar.jsx)', () => {
    const rect = { left: 100, width: 80 }; // midpoint at 140

    it('returns "left" when cursor is left of the tab midpoint', () => {
        expect(computeDropSide(rect, 120)).toBe('left');
    });

    it('returns "right" when cursor is right of the tab midpoint', () => {
        expect(computeDropSide(rect, 160)).toBe('right');
    });

    it('returns "right" when cursor is exactly at the midpoint', () => {
        // clientX === midX → not less than, so 'right'
        expect(computeDropSide(rect, 140)).toBe('right');
    });

});

// ─── End-to-end drag scenario ───────────────────────────────────────
//
// Chains computeDropSide → computeDropTarget → reorderTabs to verify
// the full drag-and-drop pipeline behaves correctly as a unit.

describe('end-to-end drag scenarios', () => {
    it('dragging first tab past two tabs to the right places it third', () => {
        const tabs = makeTabs(5);
        // User drags tab-0, hovers over tab-2 at clientX 160 (right side)
        const side = computeDropSide({ left: 100, width: 80 }, 160);
        expect(side).toBe('right');

        const dropTarget = computeDropTarget(tabs, {
            draggedTabId: 'tab-0',
            overTabId: 'tab-2',
            dropSide: side,
        });
        expect(dropTarget.targetIndex).toBe(2);

        const result = reorderTabs(tabs, dropTarget.draggedTabId, dropTarget.targetIndex);
        expect(ids(result)).toEqual(['tab-1', 'tab-2', 'tab-0', 'tab-3', 'tab-4']);
    });

    it('dragging last tab to the left side of the second tab', () => {
        const tabs = makeTabs(5);
        const side = computeDropSide({ left: 100, width: 80 }, 110);
        expect(side).toBe('left');

        const dropTarget = computeDropTarget(tabs, {
            draggedTabId: 'tab-4',
            overTabId: 'tab-1',
            dropSide: side,
        });
        expect(dropTarget.targetIndex).toBe(1);

        const result = reorderTabs(tabs, dropTarget.draggedTabId, dropTarget.targetIndex);
        expect(ids(result)).toEqual(['tab-0', 'tab-4', 'tab-1', 'tab-2', 'tab-3']);
    });

    it('multiple sequential drags produce correct cumulative order', () => {
        let tabs = makeTabs(4); // [0, 1, 2, 3]

        // First drag: move tab-3 to before tab-1
        let target = computeDropTarget(tabs, {
            draggedTabId: 'tab-3', overTabId: 'tab-1', dropSide: 'left',
        });
        tabs = reorderTabs(tabs, target.draggedTabId, target.targetIndex);
        expect(ids(tabs)).toEqual(['tab-0', 'tab-3', 'tab-1', 'tab-2']);

        // Second drag: move tab-0 to after tab-2
        target = computeDropTarget(tabs, {
            draggedTabId: 'tab-0', overTabId: 'tab-2', dropSide: 'right',
        });
        tabs = reorderTabs(tabs, target.draggedTabId, target.targetIndex);
        expect(ids(tabs)).toEqual(['tab-3', 'tab-1', 'tab-2', 'tab-0']);
    });
});
