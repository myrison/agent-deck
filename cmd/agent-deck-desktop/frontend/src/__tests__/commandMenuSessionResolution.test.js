/**
 * Tests for single-session project attach resolution in CommandMenu (Cmd+K)
 *
 * These tests verify the behavioral logic for resolving a full session object
 * when a project has exactly one session. PR #78 changed CommandMenu to look
 * up the full session from the sessions array instead of using a partial
 * summary with spread project info.
 *
 * Why this matters: The partial summary lacked fields like remote_host,
 * remote_tmux_name, and custom_label — causing stale data when switching
 * to a session via the command menu.
 *
 * Testing approach: Since CommandMenu requires Wails bindings, we extract
 * and test the session resolution logic from CommandMenu.jsx handleSelect.
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Extracted Logic: Single-Session Project Attach
// Mirrors the project-type branch in handleSelect (CommandMenu.jsx ~line 356)
// ============================================================================

/**
 * Resolves the session to pass to onSelectSession when a project has exactly
 * one session. Prefers the full session object from the sessions array;
 * falls back to a partial summary with project info if not found.
 *
 * @param {Object} projectItem - The project command menu item
 * @param {Array} sessions - Full sessions array from props
 * @returns {Object} The session object to pass to onSelectSession
 */
function resolveSingleSession(projectItem, sessions) {
    const summarySession = projectItem.sessions[0];
    const fullSession = sessions.find(s => s.id === summarySession.id);
    if (fullSession) {
        return fullSession;
    }
    // Fallback: use summary + project info (best effort)
    return { ...summarySession, title: projectItem.title, projectPath: projectItem.projectPath };
}

// ============================================================================
// Tests: Single-Session Resolution
// ============================================================================

describe('CommandMenu single-session project resolution', () => {
    const fullSessions = [
        {
            id: 'session-1',
            title: 'Agent Deck',
            projectPath: '/home/jason/agent-deck',
            status: 'running',
            tool: 'claude',
            remoteHost: 'host197',
            remoteTmuxName: 'agentdeck_agent-deck_aabb1122',
            customLabel: 'Bug Fix: Auth Flow',
        },
        {
            id: 'session-2',
            title: 'Worker',
            projectPath: '/home/jason/worker',
            status: 'idle',
            tool: 'claude',
        },
    ];

    it('returns full session with all fields when found in sessions array', () => {
        const projectItem = {
            type: 'project',
            title: 'Agent Deck',
            projectPath: '/home/jason/agent-deck',
            sessions: [{ id: 'session-1', status: 'running' }],
        };

        const result = resolveSingleSession(projectItem, fullSessions);

        // Should return the full session, not the partial summary
        expect(result.id).toBe('session-1');
        expect(result.remoteHost).toBe('host197');
        expect(result.remoteTmuxName).toBe('agentdeck_agent-deck_aabb1122');
        expect(result.customLabel).toBe('Bug Fix: Auth Flow');
        expect(result.tool).toBe('claude');
    });

    it('falls back to summary with project info when session not in array', () => {
        const projectItem = {
            type: 'project',
            title: 'Unknown Project',
            projectPath: '/home/jason/unknown',
            sessions: [{ id: 'session-missing', status: 'idle' }],
        };

        const result = resolveSingleSession(projectItem, fullSessions);

        // Should contain the summary fields plus project info
        expect(result.id).toBe('session-missing');
        expect(result.title).toBe('Unknown Project');
        expect(result.projectPath).toBe('/home/jason/unknown');
        expect(result.status).toBe('idle');
    });

    it('fallback result includes only summary fields plus project context', () => {
        const projectItem = {
            type: 'project',
            title: 'My Project',
            projectPath: '/home/jason/project',
            sessions: [{ id: 'session-x', status: 'waiting' }],
            // These project-only fields should NOT leak into the session object
            isRemote: true,
            remoteHost: 'host1',
            sessionCount: 1,
        };

        const result = resolveSingleSession(projectItem, []);

        // Should have session summary fields + title/projectPath
        expect(result.id).toBe('session-x');
        expect(result.status).toBe('waiting');
        expect(result.title).toBe('My Project');
        expect(result.projectPath).toBe('/home/jason/project');
        // Should NOT have project-item-only fields
        expect(result.isRemote).toBeUndefined();
        expect(result.remoteHost).toBeUndefined();
        expect(result.sessionCount).toBeUndefined();
    });

    it('returns full session even when summary has stale data', () => {
        // Summary might have old status from when projects were loaded
        const projectItem = {
            type: 'project',
            title: 'Agent Deck',
            projectPath: '/home/jason/agent-deck',
            sessions: [{ id: 'session-1', status: 'idle' }], // Stale status
        };

        const result = resolveSingleSession(projectItem, fullSessions);

        // Full session has the current status, not the stale one
        expect(result.status).toBe('running');
    });
});

// ============================================================================
// Tests: Integration with handleSelect decision tree
// ============================================================================

/**
 * Mirrors the project-type decision tree in handleSelect (CommandMenu.jsx).
 * Given a project item, determines which callback to invoke.
 */
function handleProjectSelect(item, sessions, callbacks, options = {}) {
    const { newSessionMode = false } = options;
    const sessionCount = item.sessions?.length ?? 0;

    if (newSessionMode) {
        if (sessionCount > 0) {
            callbacks.onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
            return 'session-picker';
        }
        callbacks.onShowHostPicker?.(item.projectPath, item.title);
        return 'host-picker';
    }

    if (sessionCount > 1) {
        callbacks.onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
        return 'session-picker';
    }

    if (sessionCount === 1) {
        const resolved = resolveSingleSession(item, sessions);
        callbacks.onSelectSession?.(resolved);
        return 'select-session';
    }

    if (item.isRemote && item.remoteHost) {
        callbacks.onShowToolPicker?.(item.projectPath, item.title, item.isRemote, item.remoteHost);
        return 'tool-picker';
    }

    callbacks.onLaunchProject?.(item.projectPath, item.title, 'claude');
    return 'launch-project';
}

describe('CommandMenu project selection decision tree', () => {
    it('single session: passes full session object to onSelectSession', () => {
        const onSelectSession = vi.fn();
        const fullSessions = [
            { id: 's1', title: 'My Session', remoteHost: 'host1', customLabel: 'Label' },
        ];
        const item = {
            type: 'project',
            title: 'Project',
            projectPath: '/path',
            sessions: [{ id: 's1', status: 'idle' }],
        };

        handleProjectSelect(item, fullSessions, { onSelectSession });

        expect(onSelectSession).toHaveBeenCalledTimes(1);
        const calledWith = onSelectSession.mock.calls[0][0];
        expect(calledWith.remoteHost).toBe('host1');
        expect(calledWith.customLabel).toBe('Label');
    });

    it('multiple sessions: shows session picker instead of resolving', () => {
        const onShowSessionPicker = vi.fn();
        const item = {
            type: 'project',
            title: 'Multi',
            projectPath: '/multi',
            sessions: [{ id: 's1' }, { id: 's2' }],
        };

        const result = handleProjectSelect(item, [], { onShowSessionPicker });

        expect(result).toBe('session-picker');
        expect(onShowSessionPicker).toHaveBeenCalledWith('/multi', 'Multi', item.sessions);
    });

    it('no sessions: launches new project with default tool', () => {
        const onLaunchProject = vi.fn();
        const item = {
            type: 'project',
            title: 'Empty',
            projectPath: '/empty',
            sessions: [],
        };

        const result = handleProjectSelect(item, [], { onLaunchProject });

        expect(result).toBe('launch-project');
        expect(onLaunchProject).toHaveBeenCalledWith('/empty', 'Empty', 'claude');
    });
});
