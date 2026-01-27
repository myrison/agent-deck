/**
 * Tests for remote context propagation through CommandMenu session creation paths.
 *
 * PR #66 fixed 4 code paths in the desktop app that dropped remote/SSH context
 * when creating sessions, causing remote sessions to be created locally instead.
 *
 * Key behaviors tested:
 * 1. Cmd+Enter on a remote project passes isRemote/remoteHost to onShowToolPicker
 * 2. Shift+Enter label flow stores remote fields and routes remote projects through tool picker
 * 3. Selecting a remote project with 0 sessions routes through tool picker (not default local launch)
 * 4. handleShowToolPicker stores remote context in toolPickerProject state
 * 5. Local projects still launch with default tool (no regression)
 *
 * Testing approach: Since components require Wails bindings, we extract
 * and test the behavioral decision logic from CommandMenu.jsx and App.jsx.
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Extracted Logic: handleSelect for projects (mirrors CommandMenu.jsx)
// ============================================================================

/**
 * Simulates the project branch of handleSelect in CommandMenu.jsx.
 * This is the decision tree for what happens when a user selects a project.
 */
function handleProjectSelect(item, callbacks = {}, options = {}) {
    const {
        onSelectSession,
        onShowSessionPicker,
        onShowToolPicker,
        onShowHostPicker,
        onLaunchProject,
        onClose,
    } = callbacks;

    const { newSessionMode = false } = options;

    const sessionCount = item.sessions?.length ?? 0;

    if (newSessionMode) {
        if (sessionCount > 0) {
            onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
            return { action: 'show-session-picker' };
        } else {
            onShowHostPicker?.(item.projectPath, item.title);
            return { action: 'show-host-picker' };
        }
    } else if (sessionCount > 1) {
        onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
        return { action: 'show-session-picker' };
    } else if (sessionCount === 1) {
        onSelectSession?.({ ...item.sessions[0], title: item.title, projectPath: item.projectPath });
        return { action: 'attach-session' };
    } else {
        // No sessions - this is where the PR fix matters
        if (item.isRemote && item.remoteHost) {
            // Remote project: route through tool picker to preserve remote context
            onShowToolPicker?.(item.projectPath, item.title, item.isRemote, item.remoteHost);
            return { action: 'show-tool-picker-remote' };
        } else {
            // Local project: launch with default tool (Claude)
            onLaunchProject?.(item.projectPath, item.title, 'claude');
            return { action: 'launch-default' };
        }
    }
}

// ============================================================================
// Extracted Logic: Cmd+Enter handler (mirrors CommandMenu.jsx handleKeyDown Enter branch)
// ============================================================================

/**
 * Simulates the Cmd+Enter behavior for a project item.
 * The PR fix: now passes isRemote and remoteHost to onShowToolPicker.
 */
function handleCmdEnterOnProject(item, callbacks = {}) {
    const { onShowToolPicker, onClose } = callbacks;
    onShowToolPicker?.(item.projectPath, item.title, item.isRemote, item.remoteHost);
    onClose?.();
    return { action: 'show-tool-picker' };
}

// ============================================================================
// Extracted Logic: Shift+Enter label flow (mirrors CommandMenu.jsx)
// ============================================================================

/**
 * Simulates Shift+Enter on a project: stores labelingProject with remote fields.
 * The PR fix: now includes isRemote and remoteHost in the labeling state.
 */
function buildLabelingProjectState(item) {
    return {
        path: item.projectPath,
        name: item.title,
        isRemote: item.isRemote,
        remoteHost: item.remoteHost,
    };
}

/**
 * Simulates handleSaveProjectLabel in CommandMenu.jsx.
 * The PR fix: remote projects route through tool picker instead of onLaunchProject.
 */
function handleSaveProjectLabel(labelingProject, customLabel, callbacks = {}) {
    const { onShowToolPicker, onLaunchProject, onClose } = callbacks;

    if (!labelingProject) return { action: 'noop' };

    if (labelingProject.isRemote && labelingProject.remoteHost) {
        // Remote projects: route through tool picker
        onShowToolPicker?.(labelingProject.path, labelingProject.name, true, labelingProject.remoteHost);
        onClose?.();
        return { action: 'show-tool-picker-remote' };
    } else {
        // Local projects: launch with label
        onLaunchProject?.(labelingProject.path, labelingProject.name, 'claude', '', customLabel);
        onClose?.();
        return { action: 'launch-with-label' };
    }
}

// ============================================================================
// Extracted Logic: handleShowToolPicker (mirrors App.jsx)
// ============================================================================

/**
 * Simulates App.jsx handleShowToolPicker callback.
 * The PR fix: now accepts and stores isRemote/remoteHost params.
 */
function buildToolPickerProject(projectPath, projectName, isRemote, remoteHost) {
    return {
        path: projectPath,
        name: projectName,
        isRemote: !!isRemote,
        remoteHost: remoteHost || null,
    };
}

// ============================================================================
// Tests: Remote project with 0 sessions routes through tool picker
// ============================================================================

describe('Remote project with 0 sessions', () => {
    it('routes through tool picker when isRemote and remoteHost are set', () => {
        const onShowToolPicker = vi.fn();
        const onLaunchProject = vi.fn();

        const remoteProject = {
            projectPath: '/home/user/project',
            title: 'Remote Project',
            sessions: [],
            isRemote: true,
            remoteHost: 'docker-host',
        };

        const result = handleProjectSelect(remoteProject, {
            onShowToolPicker,
            onLaunchProject,
        });

        expect(result.action).toBe('show-tool-picker-remote');
        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/home/user/project',
            'Remote Project',
            true,
            'docker-host'
        );
        expect(onLaunchProject).not.toHaveBeenCalled();
    });

    it('launches with default tool when project is local (not remote)', () => {
        const onShowToolPicker = vi.fn();
        const onLaunchProject = vi.fn();

        const localProject = {
            projectPath: '/Users/jason/project',
            title: 'Local Project',
            sessions: [],
            isRemote: false,
            remoteHost: '',
        };

        const result = handleProjectSelect(localProject, {
            onShowToolPicker,
            onLaunchProject,
        });

        expect(result.action).toBe('launch-default');
        expect(onLaunchProject).toHaveBeenCalledWith(
            '/Users/jason/project',
            'Local Project',
            'claude'
        );
        expect(onShowToolPicker).not.toHaveBeenCalled();
    });

    it('treats project with isRemote but no remoteHost as local', () => {
        const onShowToolPicker = vi.fn();
        const onLaunchProject = vi.fn();

        const edgeCase = {
            projectPath: '/some/path',
            title: 'Edge Case',
            sessions: [],
            isRemote: true,
            remoteHost: '',  // Empty remoteHost despite isRemote=true
        };

        const result = handleProjectSelect(edgeCase, {
            onShowToolPicker,
            onLaunchProject,
        });

        expect(result.action).toBe('launch-default');
        expect(onLaunchProject).toHaveBeenCalled();
        expect(onShowToolPicker).not.toHaveBeenCalled();
    });

    it('treats project with remoteHost but no isRemote flag as local', () => {
        const onShowToolPicker = vi.fn();
        const onLaunchProject = vi.fn();

        const edgeCase = {
            projectPath: '/some/path',
            title: 'Edge Case',
            sessions: [],
            isRemote: false,
            remoteHost: 'docker-host',  // Has host but not flagged remote
        };

        const result = handleProjectSelect(edgeCase, {
            onShowToolPicker,
            onLaunchProject,
        });

        expect(result.action).toBe('launch-default');
        expect(onLaunchProject).toHaveBeenCalled();
        expect(onShowToolPicker).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Tests: Cmd+Enter passes remote context to tool picker
// ============================================================================

describe('Cmd+Enter on project passes remote context', () => {
    it('passes isRemote and remoteHost for remote project', () => {
        const onShowToolPicker = vi.fn();
        const onClose = vi.fn();

        const remoteProject = {
            projectPath: '/home/user/project',
            title: 'Remote Project',
            isRemote: true,
            remoteHost: 'macstudio',
        };

        handleCmdEnterOnProject(remoteProject, { onShowToolPicker, onClose });

        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/home/user/project',
            'Remote Project',
            true,
            'macstudio'
        );
        expect(onClose).toHaveBeenCalled();
    });

    it('passes false/undefined for local project', () => {
        const onShowToolPicker = vi.fn();

        const localProject = {
            projectPath: '/Users/jason/project',
            title: 'Local Project',
            isRemote: false,
            remoteHost: '',
        };

        handleCmdEnterOnProject(localProject, { onShowToolPicker });

        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/Users/jason/project',
            'Local Project',
            false,
            ''
        );
    });

    it('passes undefined remote fields when project has no remote properties', () => {
        const onShowToolPicker = vi.fn();

        const projectWithoutRemoteFields = {
            projectPath: '/Users/jason/project',
            title: 'Old Project',
        };

        handleCmdEnterOnProject(projectWithoutRemoteFields, { onShowToolPicker });

        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/Users/jason/project',
            'Old Project',
            undefined,
            undefined
        );
    });
});

// ============================================================================
// Tests: Shift+Enter label flow preserves remote context
// ============================================================================

describe('Shift+Enter label flow preserves remote context', () => {
    describe('saving project label', () => {
        it('routes remote project through tool picker on label save', () => {
            const onShowToolPicker = vi.fn();
            const onLaunchProject = vi.fn();
            const onClose = vi.fn();

            const labelingProject = {
                path: '/home/user/project',
                name: 'Remote',
                isRemote: true,
                remoteHost: 'docker-host',
            };

            const result = handleSaveProjectLabel(labelingProject, 'My Label', {
                onShowToolPicker,
                onLaunchProject,
                onClose,
            });

            expect(result.action).toBe('show-tool-picker-remote');
            expect(onShowToolPicker).toHaveBeenCalledWith(
                '/home/user/project',
                'Remote',
                true,
                'docker-host'
            );
            expect(onLaunchProject).not.toHaveBeenCalled();
            expect(onClose).toHaveBeenCalled();
        });

        it('launches local project with label directly', () => {
            const onShowToolPicker = vi.fn();
            const onLaunchProject = vi.fn();
            const onClose = vi.fn();

            const labelingProject = {
                path: '/Users/test/project',
                name: 'Local',
                isRemote: false,
                remoteHost: '',
            };

            const result = handleSaveProjectLabel(labelingProject, 'My Label', {
                onShowToolPicker,
                onLaunchProject,
                onClose,
            });

            expect(result.action).toBe('launch-with-label');
            expect(onLaunchProject).toHaveBeenCalledWith(
                '/Users/test/project',
                'Local',
                'claude',
                '',
                'My Label'
            );
            expect(onShowToolPicker).not.toHaveBeenCalled();
            expect(onClose).toHaveBeenCalled();
        });

        it('does nothing when labelingProject is null', () => {
            const onShowToolPicker = vi.fn();
            const onLaunchProject = vi.fn();

            const result = handleSaveProjectLabel(null, 'Label', {
                onShowToolPicker,
                onLaunchProject,
            });

            expect(result.action).toBe('noop');
            expect(onShowToolPicker).not.toHaveBeenCalled();
            expect(onLaunchProject).not.toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Tests: End-to-end remote session creation flows
// ============================================================================

describe('End-to-end remote context propagation', () => {
    it('Cmd+Enter on remote project -> tool picker receives remote context', () => {
        const onShowToolPicker = vi.fn();
        const onClose = vi.fn();

        // Step 1: User presses Cmd+Enter on remote project
        const remoteProject = {
            projectPath: '/home/user/app',
            title: 'My App',
            isRemote: true,
            remoteHost: 'docker-host',
        };

        handleCmdEnterOnProject(remoteProject, { onShowToolPicker, onClose });

        // Step 2: Verify tool picker receives ALL remote fields
        const [path, name, isRemote, host] = onShowToolPicker.mock.calls[0];
        expect(path).toBe('/home/user/app');
        expect(name).toBe('My App');
        expect(isRemote).toBe(true);
        expect(host).toBe('docker-host');

        // Step 3: Verify tool picker project state would be built correctly
        const toolPickerProject = buildToolPickerProject(path, name, isRemote, host);
        expect(toolPickerProject.isRemote).toBe(true);
        expect(toolPickerProject.remoteHost).toBe('docker-host');
    });

    it('selecting remote project with no sessions -> tool picker receives remote context', () => {
        const onShowToolPicker = vi.fn();

        // Remote project with 0 sessions
        const project = {
            projectPath: '/home/user/app',
            title: 'New Remote',
            sessions: [],
            isRemote: true,
            remoteHost: 'macstudio',
        };

        handleProjectSelect(project, { onShowToolPicker });

        // Verify tool picker called with remote fields
        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/home/user/app',
            'New Remote',
            true,
            'macstudio'
        );
    });

    it('Shift+Enter label flow on remote project -> tool picker receives remote context', () => {
        const onShowToolPicker = vi.fn();
        const onClose = vi.fn();

        // Step 1: Build labeling state from remote project
        const remoteProject = {
            projectPath: '/remote/path',
            title: 'Remote',
            isRemote: true,
            remoteHost: 'server1',
        };
        const labelingProject = buildLabelingProjectState(remoteProject);

        // Step 2: Save label -> routes through tool picker
        handleSaveProjectLabel(labelingProject, 'Custom Label', {
            onShowToolPicker,
            onClose,
        });

        // Step 3: Verify tool picker receives remote fields
        expect(onShowToolPicker).toHaveBeenCalledWith(
            '/remote/path',
            'Remote',
            true,
            'server1'
        );
    });

    it('non-remote project flows still work correctly (no regression)', () => {
        const onShowToolPicker = vi.fn();
        const onLaunchProject = vi.fn();

        // Local project with 0 sessions
        const localProject = {
            projectPath: '/Users/jason/project',
            title: 'Local Project',
            sessions: [],
            isRemote: false,
            remoteHost: '',
        };

        // handleSelect: should launch with default tool, NOT route through tool picker
        handleProjectSelect(localProject, { onShowToolPicker, onLaunchProject });
        expect(onLaunchProject).toHaveBeenCalledWith('/Users/jason/project', 'Local Project', 'claude');
        expect(onShowToolPicker).not.toHaveBeenCalled();

        // Label save: should launch directly, NOT route through tool picker
        onShowToolPicker.mockClear();
        onLaunchProject.mockClear();

        const labelingLocal = buildLabelingProjectState(localProject);
        handleSaveProjectLabel(labelingLocal, 'My Label', {
            onShowToolPicker,
            onLaunchProject,
        });
        expect(onLaunchProject).toHaveBeenCalledWith(
            '/Users/jason/project', 'Local Project', 'claude', '', 'My Label'
        );
        expect(onShowToolPicker).not.toHaveBeenCalled();
    });
});
