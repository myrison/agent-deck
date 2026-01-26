/**
 * Tests for host-first session creation flow
 *
 * This flow ensures sessions are created with explicit host selection:
 * 1. User selects a project or triggers new session creation
 * 2. HostPicker shows with "Local" as first option + SSH hosts
 * 3. For Local: native folder picker opens, guaranteeing valid local path
 * 4. For Remote: path input dialog shows
 * 5. ToolPicker shows to select AI tool
 * 6. Session is created with correct host context
 *
 * This prevents the bug where sessions could be created with paths that
 * don't exist locally when the desktop app is accessed via SSH.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Constants (matching HostPicker.jsx)
// ============================================================================

const LOCAL_HOST_ID = 'local';

// ============================================================================
// Event Simulation Helpers
// ============================================================================

function createMockKeyEvent(key, options = {}) {
    let propagationStopped = false;
    let defaultPrevented = false;

    return {
        key,
        metaKey: options.metaKey || false,
        ctrlKey: options.ctrlKey || false,
        shiftKey: options.shiftKey || false,
        altKey: options.altKey || false,
        target: options.target || { tagName: 'DIV' },
        stopPropagation: () => {
            propagationStopped = true;
        },
        preventDefault: () => {
            defaultPrevented = true;
        },
        isPropagationStopped: () => propagationStopped,
        isDefaultPrevented: () => defaultPrevented,
    };
}

// ============================================================================
// HostPicker Handler Pattern (extracted from actual component)
// ============================================================================

/**
 * Simulates HostPicker.jsx handleKeyDown behavior.
 * Returns object describing what actions were taken.
 */
function hostPickerHandleKeyDown(e, state = {}) {
    const {
        hosts = [LOCAL_HOST_ID],
        selectedIndex = 0,
        onSelect,
        onCancel,
    } = state;

    const result = { handled: false, action: null };

    // Stop propagation for keyboard isolation
    e.stopPropagation();

    // Always handle Escape
    if (e.key === 'Escape') {
        e.preventDefault();
        result.handled = true;
        result.action = 'cancel';
        onCancel?.();
        return result;
    }

    // L key to quick-select Local
    if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        result.handled = true;
        result.action = 'select-local';
        onSelect?.(LOCAL_HOST_ID);
        return result;
    }

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-down';
            result.newIndex = (selectedIndex + 1) % hosts.length;
            break;
        case 'ArrowUp':
            e.preventDefault();
            result.handled = true;
            result.action = 'navigate-up';
            result.newIndex = (selectedIndex - 1 + hosts.length) % hosts.length;
            break;
        case 'Enter':
        case ' ':
            e.preventDefault();
            result.handled = true;
            result.action = 'select';
            onSelect?.(hosts[selectedIndex]);
            break;
    }

    // Number keys for quick select (1-9)
    if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < hosts.length) {
            e.preventDefault();
            result.handled = true;
            result.action = 'quick-select';
            result.selectedIndex = idx;
            onSelect?.(hosts[idx]);
        }
    }

    return result;
}

// ============================================================================
// Host Selection Handler Pattern (extracted from App.jsx)
// ============================================================================

/**
 * Simulates App.jsx handleHostSelected behavior.
 * Returns the result of the selection.
 */
async function handleHostSelected(hostId, state = {}) {
    const {
        pendingHostSelection = null,
        BrowseLocalDirectory = async () => '/selected/path',
        setToolPickerProject = vi.fn(),
        setShowToolPicker = vi.fn(),
        setSelectedRemoteHost = vi.fn(),
        setShowRemotePathInput = vi.fn(),
        setPendingHostSelection = vi.fn(),
    } = state;

    const result = {
        isLocal: hostId === LOCAL_HOST_ID,
        hostId,
        projectSet: null,
        nextStep: null,
    };

    if (hostId === LOCAL_HOST_ID) {
        // Local: open native folder picker
        const defaultDir = pendingHostSelection?.path || '';
        const selectedPath = await BrowseLocalDirectory(defaultDir);
        if (selectedPath) {
            const name = selectedPath.split('/').pop() || 'project';
            result.projectSet = { path: selectedPath, name, isRemote: false, remoteHost: null };
            result.nextStep = 'tool-picker';
            setToolPickerProject(result.projectSet);
            setShowToolPicker(true);
        } else {
            result.nextStep = 'cancelled';
        }
        setPendingHostSelection(null);
    } else {
        // Remote: show path input
        result.nextStep = 'remote-path-input';
        setSelectedRemoteHost(hostId);
        setShowRemotePathInput(true);
    }

    return result;
}

// ============================================================================
// CommandMenu Project Selection Pattern (extracted from CommandMenu.jsx)
// ============================================================================

/**
 * Simulates CommandMenu.jsx project selection in newSessionMode.
 */
function handleProjectSelection(item, state = {}) {
    const {
        newSessionMode = false,
        onShowHostPicker,
        onShowSessionPicker,
        onLaunchProject,
    } = state;

    const sessionCount = item.sessions?.length ?? 0;
    const result = { action: null, callbackCalled: null };

    if (newSessionMode) {
        if (sessionCount > 0) {
            result.action = 'show-session-picker';
            result.callbackCalled = 'onShowSessionPicker';
            onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
        } else {
            result.action = 'show-host-picker';
            result.callbackCalled = 'onShowHostPicker';
            onShowHostPicker?.(item.projectPath, item.title);
        }
    } else if (sessionCount > 1) {
        result.action = 'show-session-picker';
        result.callbackCalled = 'onShowSessionPicker';
        onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
    } else if (sessionCount === 1) {
        result.action = 'attach-session';
    } else {
        result.action = 'launch-project';
        result.callbackCalled = 'onLaunchProject';
        onLaunchProject?.(item.projectPath, item.title, 'claude');
    }

    return result;
}

// ============================================================================
// Tests: HostPicker Local Option
// ============================================================================

describe('HostPicker with Local option', () => {
    describe('Local as first option', () => {
        it('Local is always first in the hosts list', () => {
            const sshHosts = ['server1', 'server2'];
            const hosts = [LOCAL_HOST_ID, ...sshHosts];

            expect(hosts[0]).toBe(LOCAL_HOST_ID);
            expect(hosts).toEqual(['local', 'server1', 'server2']);
        });

        it('shows only Local when no SSH hosts configured', () => {
            const sshHosts = [];
            const hosts = [LOCAL_HOST_ID, ...sshHosts];

            expect(hosts).toEqual(['local']);
            expect(hosts.length).toBe(1);
        });
    });

    describe('L key quick-select', () => {
        it('L key selects Local immediately', () => {
            const onSelect = vi.fn();
            const event = createMockKeyEvent('l');

            hostPickerHandleKeyDown(event, { onSelect });

            expect(onSelect).toHaveBeenCalledWith(LOCAL_HOST_ID);
            expect(event.isPropagationStopped()).toBe(true);
        });

        it('uppercase L also selects Local', () => {
            const onSelect = vi.fn();
            const event = createMockKeyEvent('L');

            hostPickerHandleKeyDown(event, { onSelect });

            expect(onSelect).toHaveBeenCalledWith(LOCAL_HOST_ID);
        });
    });

    describe('keyboard navigation', () => {
        it('ArrowDown navigates through hosts list', () => {
            const hosts = [LOCAL_HOST_ID, 'server1', 'server2'];
            const event = createMockKeyEvent('ArrowDown');

            const result = hostPickerHandleKeyDown(event, {
                hosts,
                selectedIndex: 0,
            });

            expect(result.action).toBe('navigate-down');
            expect(result.newIndex).toBe(1);
        });

        it('ArrowUp navigates up with wrap-around', () => {
            const hosts = [LOCAL_HOST_ID, 'server1', 'server2'];
            const event = createMockKeyEvent('ArrowUp');

            const result = hostPickerHandleKeyDown(event, {
                hosts,
                selectedIndex: 0,
            });

            expect(result.newIndex).toBe(2); // Wraps to last
        });

        it('Enter selects current host', () => {
            const hosts = [LOCAL_HOST_ID, 'server1', 'server2'];
            const onSelect = vi.fn();
            const event = createMockKeyEvent('Enter');

            hostPickerHandleKeyDown(event, {
                hosts,
                selectedIndex: 1,
                onSelect,
            });

            expect(onSelect).toHaveBeenCalledWith('server1');
        });

        it('number keys quick-select by index', () => {
            const hosts = [LOCAL_HOST_ID, 'server1', 'server2'];
            const onSelect = vi.fn();

            // Press '1' for Local
            const event1 = createMockKeyEvent('1');
            hostPickerHandleKeyDown(event1, { hosts, onSelect });
            expect(onSelect).toHaveBeenCalledWith(LOCAL_HOST_ID);

            // Press '2' for server1
            const event2 = createMockKeyEvent('2');
            hostPickerHandleKeyDown(event2, { hosts, onSelect });
            expect(onSelect).toHaveBeenCalledWith('server1');
        });

        it('Escape cancels host picker', () => {
            const onCancel = vi.fn();
            const event = createMockKeyEvent('Escape');

            hostPickerHandleKeyDown(event, { onCancel });

            expect(onCancel).toHaveBeenCalled();
        });
    });

    describe('event isolation', () => {
        it('stops propagation for all key events', () => {
            const keys = ['l', 'L', 'ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape', '1'];

            keys.forEach((key) => {
                const event = createMockKeyEvent(key);
                hostPickerHandleKeyDown(event);
                expect(event.isPropagationStopped()).toBe(true);
            });
        });
    });
});

// ============================================================================
// Tests: Host Selection Flow
// ============================================================================

describe('Host selection flow', () => {
    describe('Local host selection', () => {
        it('opens folder picker when Local selected', async () => {
            const BrowseLocalDirectory = vi.fn().mockResolvedValue('/Users/test/project');
            const setToolPickerProject = vi.fn();
            const setShowToolPicker = vi.fn();

            const result = await handleHostSelected(LOCAL_HOST_ID, {
                BrowseLocalDirectory,
                setToolPickerProject,
                setShowToolPicker,
            });

            expect(BrowseLocalDirectory).toHaveBeenCalled();
            expect(result.isLocal).toBe(true);
            expect(result.nextStep).toBe('tool-picker');
            expect(setToolPickerProject).toHaveBeenCalledWith({
                path: '/Users/test/project',
                name: 'project',
                isRemote: false,
                remoteHost: null,
            });
            expect(setShowToolPicker).toHaveBeenCalledWith(true);
        });

        it('uses pending project path as default for folder picker', async () => {
            const BrowseLocalDirectory = vi.fn().mockResolvedValue('/Users/test/project');

            await handleHostSelected(LOCAL_HOST_ID, {
                pendingHostSelection: { path: '/Users/test/existing', name: 'existing' },
                BrowseLocalDirectory,
            });

            expect(BrowseLocalDirectory).toHaveBeenCalledWith('/Users/test/existing');
        });

        it('handles cancelled folder picker', async () => {
            const BrowseLocalDirectory = vi.fn().mockResolvedValue(''); // Empty = cancelled
            const setToolPickerProject = vi.fn();
            const setShowToolPicker = vi.fn();

            const result = await handleHostSelected(LOCAL_HOST_ID, {
                BrowseLocalDirectory,
                setToolPickerProject,
                setShowToolPicker,
            });

            expect(result.nextStep).toBe('cancelled');
            expect(setToolPickerProject).not.toHaveBeenCalled();
            expect(setShowToolPicker).not.toHaveBeenCalled();
        });

        it('clears pending selection after Local selection', async () => {
            const setPendingHostSelection = vi.fn();
            const BrowseLocalDirectory = vi.fn().mockResolvedValue('/path');

            await handleHostSelected(LOCAL_HOST_ID, {
                BrowseLocalDirectory,
                setPendingHostSelection,
            });

            expect(setPendingHostSelection).toHaveBeenCalledWith(null);
        });
    });

    describe('Remote host selection', () => {
        it('shows path input when remote host selected', async () => {
            const setSelectedRemoteHost = vi.fn();
            const setShowRemotePathInput = vi.fn();

            const result = await handleHostSelected('server1', {
                setSelectedRemoteHost,
                setShowRemotePathInput,
            });

            expect(result.isLocal).toBe(false);
            expect(result.nextStep).toBe('remote-path-input');
            expect(setSelectedRemoteHost).toHaveBeenCalledWith('server1');
            expect(setShowRemotePathInput).toHaveBeenCalledWith(true);
        });
    });

    describe('project path extraction', () => {
        it('extracts project name from path', async () => {
            const BrowseLocalDirectory = vi.fn().mockResolvedValue('/Users/jason/projects/my-app');
            const setToolPickerProject = vi.fn();

            await handleHostSelected(LOCAL_HOST_ID, {
                BrowseLocalDirectory,
                setToolPickerProject,
            });

            expect(setToolPickerProject).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'my-app',
                })
            );
        });

        it('handles root path correctly', async () => {
            const BrowseLocalDirectory = vi.fn().mockResolvedValue('/');
            const setToolPickerProject = vi.fn();

            await handleHostSelected(LOCAL_HOST_ID, {
                BrowseLocalDirectory,
                setToolPickerProject,
            });

            expect(setToolPickerProject).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'project', // Fallback name
                })
            );
        });
    });
});

// ============================================================================
// Tests: CommandMenu Integration (newSessionMode)
// ============================================================================

describe('CommandMenu project selection in newSessionMode', () => {
    describe('project with no existing sessions', () => {
        it('shows host picker instead of launching directly', () => {
            const onShowHostPicker = vi.fn();
            const onLaunchProject = vi.fn();

            const project = {
                projectPath: '/test/path',
                title: 'Test Project',
                sessions: [],
            };

            const result = handleProjectSelection(project, {
                newSessionMode: true,
                onShowHostPicker,
                onLaunchProject,
            });

            expect(result.action).toBe('show-host-picker');
            expect(onShowHostPicker).toHaveBeenCalledWith('/test/path', 'Test Project');
            expect(onLaunchProject).not.toHaveBeenCalled();
        });
    });

    describe('project with existing sessions', () => {
        it('shows session picker in newSessionMode', () => {
            const onShowHostPicker = vi.fn();
            const onShowSessionPicker = vi.fn();

            const project = {
                projectPath: '/test/path',
                title: 'Test Project',
                sessions: [{ id: 'session-1' }],
            };

            const result = handleProjectSelection(project, {
                newSessionMode: true,
                onShowHostPicker,
                onShowSessionPicker,
            });

            expect(result.action).toBe('show-session-picker');
            expect(onShowSessionPicker).toHaveBeenCalled();
            expect(onShowHostPicker).not.toHaveBeenCalled();
        });
    });

    describe('normal mode (not newSessionMode)', () => {
        it('launches directly for project with no sessions', () => {
            const onLaunchProject = vi.fn();
            const onShowHostPicker = vi.fn();

            const project = {
                projectPath: '/test/path',
                title: 'Test Project',
                sessions: [],
            };

            const result = handleProjectSelection(project, {
                newSessionMode: false,
                onLaunchProject,
                onShowHostPicker,
            });

            expect(result.action).toBe('launch-project');
            expect(onLaunchProject).toHaveBeenCalledWith('/test/path', 'Test Project', 'claude');
            expect(onShowHostPicker).not.toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Tests: Full Flow Integration
// ============================================================================

describe('Full host-first session creation flow', () => {
    it('complete local session creation flow', async () => {
        // Step 1: User is in newSessionMode, selects project with no sessions
        const onShowHostPicker = vi.fn();
        const project = { projectPath: '/original/path', title: 'Project', sessions: [] };

        handleProjectSelection(project, {
            newSessionMode: true,
            onShowHostPicker,
        });

        expect(onShowHostPicker).toHaveBeenCalledWith('/original/path', 'Project');

        // Step 2: HostPicker shows, user selects Local
        const onSelect = vi.fn();
        const lEvent = createMockKeyEvent('l');
        hostPickerHandleKeyDown(lEvent, { onSelect });

        expect(onSelect).toHaveBeenCalledWith(LOCAL_HOST_ID);

        // Step 3: Folder picker opens, user selects path
        const BrowseLocalDirectory = vi.fn().mockResolvedValue('/Users/test/selected-folder');
        const setToolPickerProject = vi.fn();
        const setShowToolPicker = vi.fn();

        const result = await handleHostSelected(LOCAL_HOST_ID, {
            pendingHostSelection: { path: '/original/path', name: 'Project' },
            BrowseLocalDirectory,
            setToolPickerProject,
            setShowToolPicker,
        });

        // Folder picker used original path as default
        expect(BrowseLocalDirectory).toHaveBeenCalledWith('/original/path');

        // ToolPicker is shown with the LOCAL project info
        expect(setToolPickerProject).toHaveBeenCalledWith({
            path: '/Users/test/selected-folder',
            name: 'selected-folder',
            isRemote: false,
            remoteHost: null,
        });
        expect(setShowToolPicker).toHaveBeenCalledWith(true);
    });

    it('complete remote session creation flow', async () => {
        // Step 1: User selects project in newSessionMode
        const onShowHostPicker = vi.fn();
        const project = { projectPath: '/local/path', title: 'Project', sessions: [] };

        handleProjectSelection(project, {
            newSessionMode: true,
            onShowHostPicker,
        });

        // Step 2: HostPicker shows, user selects remote host via number key
        const hosts = [LOCAL_HOST_ID, 'macstudio', 'server2'];
        const onSelectHost = vi.fn();
        const twoEvent = createMockKeyEvent('2');

        hostPickerHandleKeyDown(twoEvent, {
            hosts,
            onSelect: onSelectHost,
        });

        expect(onSelectHost).toHaveBeenCalledWith('macstudio');

        // Step 3: handleHostSelected routes to remote path input
        const setSelectedRemoteHost = vi.fn();
        const setShowRemotePathInput = vi.fn();

        const result = await handleHostSelected('macstudio', {
            setSelectedRemoteHost,
            setShowRemotePathInput,
        });

        expect(result.nextStep).toBe('remote-path-input');
        expect(setSelectedRemoteHost).toHaveBeenCalledWith('macstudio');
        expect(setShowRemotePathInput).toHaveBeenCalledWith(true);

        // Step 4: User enters remote path -> ToolPicker would show
        // (This is handled by handleRemotePathSubmit in App.jsx)
    });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('Edge cases', () => {
    it('handles empty project path in pending selection', async () => {
        const BrowseLocalDirectory = vi.fn().mockResolvedValue('/new/path');

        await handleHostSelected(LOCAL_HOST_ID, {
            pendingHostSelection: { path: '', name: '' },
            BrowseLocalDirectory,
        });

        expect(BrowseLocalDirectory).toHaveBeenCalledWith('');
    });

    it('handles null pending selection', async () => {
        const BrowseLocalDirectory = vi.fn().mockResolvedValue('/new/path');

        await handleHostSelected(LOCAL_HOST_ID, {
            pendingHostSelection: null,
            BrowseLocalDirectory,
        });

        expect(BrowseLocalDirectory).toHaveBeenCalledWith('');
    });

    it('handles path with spaces', async () => {
        const BrowseLocalDirectory = vi.fn().mockResolvedValue('/Users/test/my project');
        const setToolPickerProject = vi.fn();

        await handleHostSelected(LOCAL_HOST_ID, {
            BrowseLocalDirectory,
            setToolPickerProject,
        });

        expect(setToolPickerProject).toHaveBeenCalledWith(
            expect.objectContaining({
                path: '/Users/test/my project',
                name: 'my project',
            })
        );
    });

    it('handles deep nested path', async () => {
        const BrowseLocalDirectory = vi
            .fn()
            .mockResolvedValue('/Users/jason/Documents/Seafile/Projects/deep/nested/folder');
        const setToolPickerProject = vi.fn();

        await handleHostSelected(LOCAL_HOST_ID, {
            BrowseLocalDirectory,
            setToolPickerProject,
        });

        expect(setToolPickerProject).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'folder',
            })
        );
    });
});
