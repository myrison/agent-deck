/**
 * Tests for tab state persistence functions from layoutUtils.js
 *
 * These functions control the save/restore cycle for open tabs:
 *   - layoutToTabSaveFormat: converts live layout to saveable format (preserving pane IDs)
 *   - restoreTabLayout: resolves saved bindings back to live sessions
 *   - findBestSessionForBinding: priority-based session matching for restore
 */

import { describe, it, expect } from 'vitest';
import {
    layoutToTabSaveFormat,
    restoreTabLayout,
    findBestSessionForBinding,
} from '../layoutUtils';

// ─── Helpers ────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
    return {
        id: 'session-1',
        title: 'my-project',
        projectPath: '/home/user/project',
        tool: 'claude',
        customLabel: '',
        remoteHost: '',
        ...overrides,
    };
}

function makePaneLayout(session, paneId = 'pane-1') {
    return {
        type: 'pane',
        id: paneId,
        sessionId: session?.id || null,
        session: session || null,
    };
}

function makeSplitLayout(left, right, opts = {}) {
    return {
        type: 'split',
        direction: opts.direction || 'vertical',
        ratio: opts.ratio || 0.5,
        children: [left, right],
    };
}

// ─── findBestSessionForBinding ──────────────────────────────────────

describe('findBestSessionForBinding', () => {
    const sessions = [
        makeSession({ id: 's1', projectPath: '/proj-a', tool: 'claude', customLabel: 'Backend' }),
        makeSession({ id: 's2', projectPath: '/proj-a', tool: 'shell', customLabel: '' }),
        makeSession({ id: 's3', projectPath: '/proj-a', tool: 'claude', customLabel: '' }),
        makeSession({ id: 's4', projectPath: '/proj-b', tool: 'claude', customLabel: '' }),
    ];

    it('matches by customLabel first within same project', () => {
        const binding = { projectPath: '/proj-a', customLabel: 'Backend', tool: 'shell' };
        const result = findBestSessionForBinding(binding, sessions);
        // Should pick s1 (label match) even though tool says 'shell'
        expect(result.id).toBe('s1');
    });

    it('falls back to tool match when no customLabel match', () => {
        const binding = { projectPath: '/proj-a', customLabel: 'NonExistent', tool: 'shell' };
        const result = findBestSessionForBinding(binding, sessions);
        // No label match, should pick s2 (tool match)
        expect(result.id).toBe('s2');
    });

    it('falls back to first session in project when no label or tool match', () => {
        const binding = { projectPath: '/proj-a', customLabel: 'NonExistent', tool: 'gemini' };
        const result = findBestSessionForBinding(binding, sessions);
        // No label or tool match, should pick first in /proj-a
        expect(result.id).toBe('s1');
    });

    it('returns null when no sessions match the project path', () => {
        const binding = { projectPath: '/proj-c', tool: 'claude' };
        const result = findBestSessionForBinding(binding, sessions);
        expect(result).toBeNull();
    });

    it('returns null for null binding', () => {
        expect(findBestSessionForBinding(null, sessions)).toBeNull();
    });

    it('returns null for binding with empty projectPath', () => {
        // extractBindingFromSession defaults to '' when session.projectPath is falsy
        expect(findBestSessionForBinding({ projectPath: '', tool: 'claude' }, sessions)).toBeNull();
    });

    it('returns null when available sessions is empty', () => {
        const binding = { projectPath: '/proj-a', tool: 'claude' };
        expect(findBestSessionForBinding(binding, [])).toBeNull();
    });

    it('matches tool when customLabel is absent in binding', () => {
        const binding = { projectPath: '/proj-a', tool: 'shell' };
        const result = findBestSessionForBinding(binding, sessions);
        expect(result.id).toBe('s2');
    });
});

// ─── layoutToTabSaveFormat ──────────────────────────────────────────

describe('layoutToTabSaveFormat', () => {
    it('preserves pane ID from live layout', () => {
        const session = makeSession();
        const layout = makePaneLayout(session, 'my-pane-42');
        const saved = layoutToTabSaveFormat(layout);

        expect(saved.id).toBe('my-pane-42');
        expect(saved.type).toBe('pane');
    });

    it('produces binding sufficient to resolve back to the original session', () => {
        const session = makeSession({
            id: 's-unique',
            projectPath: '/home/user/project',
            title: 'my-project',
            tool: 'claude',
            customLabel: 'Backend',
            remoteHost: 'macstudio',
        });
        const layout = makePaneLayout(session);
        const saved = layoutToTabSaveFormat(layout);

        // The binding must contain enough info for findBestSessionForBinding to resolve
        expect(saved.binding).toBeDefined();
        const resolved = findBestSessionForBinding(saved.binding, [session]);
        expect(resolved).not.toBeNull();
        expect(resolved.id).toBe('s-unique');
    });

    it('omits binding for panes with no session', () => {
        const layout = makePaneLayout(null, 'empty-pane');
        const saved = layoutToTabSaveFormat(layout);

        expect(saved.binding).toBeUndefined();
        expect(saved.id).toBe('empty-pane');
    });

    it('saved pane contains only type, id, and binding keys', () => {
        const session = makeSession();
        const layout = makePaneLayout(session);
        const saved = layoutToTabSaveFormat(layout);

        // The save format contract: only structural + binding data, no live session objects
        expect(Object.keys(saved).sort()).toEqual(['binding', 'id', 'type']);
    });

    it('preserves split structure with ratio and direction', () => {
        const left = makePaneLayout(makeSession({ id: 's1' }), 'left-pane');
        const right = makePaneLayout(makeSession({ id: 's2' }), 'right-pane');
        const layout = makeSplitLayout(left, right, { direction: 'horizontal', ratio: 0.7 });
        const saved = layoutToTabSaveFormat(layout);

        expect(saved.type).toBe('split');
        expect(saved.direction).toBe('horizontal');
        expect(saved.ratio).toBe(0.7);
        expect(saved.children).toHaveLength(2);
        expect(saved.children[0].id).toBe('left-pane');
        expect(saved.children[1].id).toBe('right-pane');
    });

    it('handles nested splits', () => {
        const pane1 = makePaneLayout(makeSession({ id: 's1' }), 'p1');
        const pane2 = makePaneLayout(makeSession({ id: 's2' }), 'p2');
        const pane3 = makePaneLayout(makeSession({ id: 's3' }), 'p3');
        const innerSplit = makeSplitLayout(pane1, pane2, { direction: 'horizontal' });
        const outerSplit = makeSplitLayout(innerSplit, pane3, { direction: 'vertical' });

        const saved = layoutToTabSaveFormat(outerSplit);

        expect(saved.type).toBe('split');
        expect(saved.children[0].type).toBe('split');
        expect(saved.children[0].children[0].id).toBe('p1');
        expect(saved.children[0].children[1].id).toBe('p2');
        expect(saved.children[1].id).toBe('p3');
    });
});

// ─── restoreTabLayout ───────────────────────────────────────────────

describe('restoreTabLayout', () => {
    it('resolves binding to a matching session', () => {
        const sessions = [
            makeSession({ id: 's1', projectPath: '/proj', tool: 'claude' }),
        ];
        const savedNode = {
            type: 'pane',
            id: 'pane-1',
            binding: { projectPath: '/proj', tool: 'claude' },
        };

        const restored = restoreTabLayout(savedNode, sessions);

        expect(restored.type).toBe('pane');
        expect(restored.id).toBe('pane-1');
        expect(restored.session).not.toBeNull();
        expect(restored.session.id).toBe('s1');
        expect(restored.sessionId).toBe('s1');
    });

    it('preserves saved pane ID for activePaneId reference', () => {
        const savedNode = {
            type: 'pane',
            id: 'saved-pane-42',
            binding: null,
        };

        const restored = restoreTabLayout(savedNode, []);
        expect(restored.id).toBe('saved-pane-42');
    });

    it('leaves pane empty when no session matches binding', () => {
        const savedNode = {
            type: 'pane',
            id: 'pane-1',
            binding: { projectPath: '/nonexistent', tool: 'claude' },
        };

        const restored = restoreTabLayout(savedNode, []);
        expect(restored.session).toBeNull();
        expect(restored.sessionId).toBeNull();
    });

    it('avoids assigning the same session to multiple panes', () => {
        const sessions = [
            makeSession({ id: 's1', projectPath: '/proj', tool: 'claude' }),
        ];
        const savedSplit = {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
                { type: 'pane', id: 'pane-1', binding: { projectPath: '/proj', tool: 'claude' } },
                { type: 'pane', id: 'pane-2', binding: { projectPath: '/proj', tool: 'claude' } },
            ],
        };

        const restored = restoreTabLayout(savedSplit, sessions);

        // First pane gets the session, second pane should be empty (only 1 session available)
        const leftSession = restored.children[0].session;
        const rightSession = restored.children[1].session;

        expect(leftSession).not.toBeNull();
        expect(leftSession.id).toBe('s1');
        expect(rightSession).toBeNull();
    });

    it('restores split structure with direction and ratio', () => {
        const sessions = [
            makeSession({ id: 's1', projectPath: '/proj-a', tool: 'claude' }),
            makeSession({ id: 's2', projectPath: '/proj-b', tool: 'shell' }),
        ];
        const savedSplit = {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.6,
            children: [
                { type: 'pane', id: 'pane-1', binding: { projectPath: '/proj-a', tool: 'claude' } },
                { type: 'pane', id: 'pane-2', binding: { projectPath: '/proj-b', tool: 'shell' } },
            ],
        };

        const restored = restoreTabLayout(savedSplit, sessions);

        expect(restored.type).toBe('split');
        expect(restored.direction).toBe('horizontal');
        expect(restored.ratio).toBe(0.6);
        expect(restored.children[0].session.id).toBe('s1');
        expect(restored.children[1].session.id).toBe('s2');
    });

    it('respects pre-assigned session IDs via assignedIds parameter', () => {
        const sessions = [
            makeSession({ id: 's1', projectPath: '/proj', tool: 'claude' }),
            makeSession({ id: 's2', projectPath: '/proj', tool: 'claude' }),
        ];
        const savedNode = {
            type: 'pane',
            id: 'pane-1',
            binding: { projectPath: '/proj', tool: 'claude' },
        };

        // s1 is already assigned
        const alreadyAssigned = new Set(['s1']);
        const restored = restoreTabLayout(savedNode, sessions, alreadyAssigned);

        // Should skip s1 and pick s2
        expect(restored.session.id).toBe('s2');
    });

    it('generates pane ID when saved node has no ID', () => {
        const savedNode = {
            type: 'pane',
            // no id field
        };

        const restored = restoreTabLayout(savedNode, []);
        expect(restored.id).toBeTruthy();
        expect(restored.id).toMatch(/^pane-/);
    });
});

// ─── Round-trip: save then restore ──────────────────────────────────

describe('tab state round-trip', () => {
    it('round-trips a single pane with session binding', () => {
        const session = makeSession({
            id: 's1',
            title: 'my-project',
            projectPath: '/home/user/project',
            tool: 'claude',
            customLabel: 'Backend',
        });
        const liveLayout = makePaneLayout(session, 'my-pane');

        // Save
        const saved = layoutToTabSaveFormat(liveLayout);

        // Restore with the same session available
        const restored = restoreTabLayout(saved, [session]);

        expect(restored.id).toBe('my-pane');
        expect(restored.session.id).toBe('s1');
    });

    it('round-trips a split layout preserving both pane bindings', () => {
        const s1 = makeSession({ id: 's1', projectPath: '/proj-a', tool: 'claude', customLabel: 'API' });
        const s2 = makeSession({ id: 's2', projectPath: '/proj-b', tool: 'shell' });
        const liveLayout = makeSplitLayout(
            makePaneLayout(s1, 'left'),
            makePaneLayout(s2, 'right'),
            { direction: 'vertical', ratio: 0.6 },
        );

        const saved = layoutToTabSaveFormat(liveLayout);
        const restored = restoreTabLayout(saved, [s1, s2]);

        expect(restored.children[0].session.id).toBe('s1');
        expect(restored.children[1].session.id).toBe('s2');
        expect(restored.direction).toBe('vertical');
        expect(restored.ratio).toBe(0.6);
    });

    it('shows launcher for deleted session after round-trip', () => {
        const session = makeSession({ id: 's1', projectPath: '/proj', tool: 'claude' });
        const liveLayout = makePaneLayout(session, 'my-pane');

        // Save while session exists
        const saved = layoutToTabSaveFormat(liveLayout);

        // Restore with session deleted (empty session list)
        const restored = restoreTabLayout(saved, []);

        expect(restored.id).toBe('my-pane');
        expect(restored.session).toBeNull();
        expect(restored.sessionId).toBeNull();
    });
});
