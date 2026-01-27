import { useState, useEffect, useRef, useMemo } from 'react';
import Fuse from 'fuse.js';
import './CommandMenu.css';
import { createLogger } from './logger';
import ToolIcon from './ToolIcon';
import { formatShortcut } from './utils/shortcuts';
import { withKeyboardIsolation } from './utils/keyboardIsolation';
import RenameDialog from './RenameDialog';
import DeleteLayoutDialog from './DeleteLayoutDialog';

const logger = createLogger('CommandMenu');

// Quick actions available in the menu
const QUICK_ACTIONS = [
    { id: 'new-terminal', type: 'action', title: 'New Terminal', description: 'Start a new shell session' },
    { id: 'new-window', type: 'action', title: 'New Window', description: 'Open a new app window (⌘⇧N)' },
    { id: 'refresh-sessions', type: 'action', title: 'Refresh Sessions', description: 'Reload session list' },
    { id: 'toggle-quick-launch', type: 'action', title: 'Toggle Quick Launch Bar', description: 'Show/hide quick launch bar' },
    { id: 'toggle-theme', type: 'action', title: 'Toggle Theme', description: 'Switch between light and dark mode' },
];

// Layout actions - only shown when in terminal view
const LAYOUT_ACTIONS = [
    { id: 'split-right', type: 'layout', title: 'Split Right', description: 'Split pane vertically (Cmd+D)', shortcutHint: '⌘D' },
    { id: 'split-down', type: 'layout', title: 'Split Down', description: 'Split pane horizontally (Cmd+Shift+D)', shortcutHint: '⌘⇧D' },
    { id: 'clear-session', type: 'layout', title: 'Clear Session from Pane', description: 'Remove session but keep pane (Cmd+Shift+W)', shortcutHint: '⌘⇧W' },
    { id: 'close-pane', type: 'layout', title: 'Close Pane', description: 'Remove pane from grid (Cmd+Option+W)', shortcutHint: '⌘⌥W' },
    { id: 'move-to-pane', type: 'layout', title: 'Move Session to Pane...', description: 'Swap sessions between panes (press number)', shortcutHint: '1-9' },
    { id: 'balance-panes', type: 'layout', title: 'Balance Panes', description: 'Make all panes equal size (Cmd+Option+=)', shortcutHint: '⌘⌥=' },
    { id: 'toggle-zoom', type: 'layout', title: 'Toggle Zoom', description: 'Zoom/unzoom current pane (Cmd+Shift+Z)', shortcutHint: '⌘⇧Z' },
    { id: 'save-layout', type: 'layout', title: 'Save Current Layout...', description: 'Save this layout as a template' },
    { id: 'layout-single', type: 'layout', title: 'Layout: Single Pane', description: 'Single pane layout (Cmd+Option+1)', shortcutHint: '⌘⌥1' },
    { id: 'layout-2-col', type: 'layout', title: 'Layout: 2 Columns', description: 'Two columns side by side (Cmd+Option+2)', shortcutHint: '⌘⌥2' },
    { id: 'layout-2-row', type: 'layout', title: 'Layout: 2 Rows', description: 'Two rows stacked (Cmd+Option+3)', shortcutHint: '⌘⌥3' },
    { id: 'layout-2x2', type: 'layout', title: 'Layout: 2x2 Grid', description: 'Four panes in a grid (Cmd+Option+4)', shortcutHint: '⌘⌥4' },
];

export default function CommandMenu({
    onClose,
    onSelectSession,
    onAction,
    onLaunchProject, // (projectPath, projectName, tool, configKey?, customLabel?) => void
    onShowToolPicker, // (projectPath, projectName, isRemote, remoteHost) => void - for Cmd+Enter
    onShowSessionPicker, // (projectPath, projectName, sessions) => void - for projects with multiple sessions
    onShowHostPicker, // (projectPath, projectName) => void - for host-first flow in newSessionMode
    onPinToQuickLaunch, // (projectPath, projectName) => void - for Cmd+P
    onLayoutAction, // (actionId) => void - for layout actions
    onDeleteSavedLayout, // (layoutId) => void - for Cmd+Backspace on saved layouts
    activeSession = null, // Currently focused session (for label management in terminal view)
    onUpdateLabel, // (newLabel) => void - update active session label (empty string = delete)
    sessions = [],
    projects = [],
    favorites = [], // Quick launch favorites for shortcut hints
    savedLayouts = [], // Saved layout templates
    pinMode = false, // When true, selecting pins instead of launching
    showLayoutActions = false, // Show layout commands (when in terminal view)
    newTabMode = false, // When true, opened via Cmd+T for new tab
    newSessionMode = false, // When true, Cmd+N was used - only show projects for new session creation
}) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [labelingProject, setLabelingProject] = useState(null); // { path, name, isRemote, remoteHost } - for Shift+Enter
    const [labelingSession, setLabelingSession] = useState(null); // { id, customLabel } - for label editing
    const [deletingLayout, setDeletingLayout] = useState(null); // saved-layout item for deletion confirmation
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Log when menu opens
    useEffect(() => {
        logger.info('Command menu opened', { sessionCount: sessions.length, projectCount: projects.length });
        return () => logger.info('Command menu closed');
    }, [sessions.length, projects.length]);

    // Build lookup for favorites by path
    const favoritesLookup = useMemo(() => {
        const lookup = {};
        for (const fav of favorites) {
            lookup[fav.path] = fav;
        }
        return lookup;
    }, [favorites]);

    // Convert projects to menu items (show ALL projects, including those with sessions)
    const projectItems = useMemo(() => {
        return projects
            .map(p => {
                // Derive remote status from sessions - if any session is remote, project is remote
                const firstRemoteSession = p.sessions?.find(s => s.isRemote);
                return {
                    id: `project:${p.path}`,
                    type: 'project',
                    title: p.name,
                    projectPath: p.path,
                    score: p.score,
                    description: p.path,
                    isPinned: !!favoritesLookup[p.path],
                    shortcut: favoritesLookup[p.path]?.shortcut,
                    sessionCount: p.sessionCount || 0,
                    sessions: p.sessions || [],
                    // Remote status derived from sessions
                    isRemote: !!firstRemoteSession,
                    remoteHost: firstRemoteSession?.remoteHost || '',
                    remoteHostDisplayName: firstRemoteSession?.remoteHostDisplayName || '',
                };
            });
    }, [projects, favoritesLookup]);

    // Convert saved layouts to action format
    const savedLayoutItems = useMemo(() => {
        return savedLayouts.map(layout => ({
            id: `saved-layout:${layout.id}`,
            type: 'saved-layout',
            title: `Layout: ${layout.name}`,
            description: 'Apply saved layout',
            shortcutHint: layout.shortcut || null,
            layoutId: layout.id,
        }));
    }, [savedLayouts]);

    // Build dynamic label actions based on active session
    const labelActions = useMemo(() => {
        if (!activeSession) return [];
        if (activeSession.customLabel) {
            return [
                { id: 'edit-label', type: 'label', title: 'Edit Custom Label', description: `Edit: "${activeSession.customLabel}"` },
                { id: 'delete-label', type: 'label', title: 'Delete Custom Label', description: `Remove: "${activeSession.customLabel}"` },
            ];
        }
        return [
            { id: 'add-label', type: 'label', title: 'Add Custom Label', description: 'Add a custom label to this session' },
        ];
    }, [activeSession]);

    // Build delete session action (only when a session is active)
    const deleteAction = useMemo(() => {
        if (!activeSession) return [];
        return [
            { id: 'delete-session', type: 'action', title: 'Delete Session', description: `Delete "${activeSession.customLabel || activeSession.title}"` },
        ];
    }, [activeSession]);

    // Build list of all actions including layout actions if enabled
    const allActions = useMemo(() => {
        const base = [...QUICK_ACTIONS, ...labelActions, ...deleteAction];
        if (!showLayoutActions) return base;
        return [...base, ...LAYOUT_ACTIONS, ...savedLayoutItems];
    }, [showLayoutActions, savedLayoutItems, labelActions, deleteAction]);

    // Fuse.js configuration for fuzzy search
    const fuse = useMemo(() => new Fuse([...sessions, ...projectItems, ...allActions], {
        keys: [
            { name: 'title', weight: 0.4 },
            { name: 'projectPath', weight: 0.3 },
            { name: 'tool', weight: 0.1 },
            { name: 'description', weight: 0.2 },
            { name: 'name', weight: 0.4 },
        ],
        threshold: 0.4,
        includeScore: true,
    }), [sessions, projectItems, allActions]);

    // Get filtered results
    const results = useMemo(() => {
        if (pinMode) {
            // Pin mode: only show projects (not already pinned)
            const unpinnedProjects = projectItems.filter(p => !p.isPinned);
            if (!query.trim()) {
                logger.debug('Pin mode: showing unpinned projects', { count: unpinnedProjects.length });
                return unpinnedProjects;
            }
            // Filter with fuse but only from unpinned projects
            const pinFuse = new Fuse(unpinnedProjects, {
                keys: [{ name: 'title', weight: 0.5 }, { name: 'projectPath', weight: 0.5 }],
                threshold: 0.4,
            });
            return pinFuse.search(query).map(r => r.item);
        }

        // New session mode: only show projects (for launching new sessions)
        if (newSessionMode) {
            if (!query.trim()) {
                logger.debug('New session mode: showing all projects', { count: projectItems.length });
                return projectItems;
            }
            const projectFuse = new Fuse(projectItems, {
                keys: [{ name: 'title', weight: 0.5 }, { name: 'projectPath', weight: 0.5 }],
                threshold: 0.4,
            });
            return projectFuse.search(query).map(r => r.item);
        }

        if (!query.trim()) {
            // No query: show sessions first, then projects, then actions
            const allItems = [...sessions, ...projectItems, ...allActions];
            logger.debug('Showing all items (no query)', { count: allItems.length });
            return allItems;
        }
        const searchResults = fuse.search(query).map(result => result.item);
        logger.debug('Search results', { query, count: searchResults.length });
        return searchResults;
    }, [query, fuse, sessions, projectItems, allActions, pinMode, newSessionMode]);

    // Reset selection when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [results]);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedItem = listRef.current.querySelector('.menu-item.selected');
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex]);

    const handleKeyDown = withKeyboardIsolation((e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => {
                    const newIndex = Math.min(prev + 1, results.length - 1);
                    logger.debug('Navigate down', { from: prev, to: newIndex });
                    return newIndex;
                });
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => {
                    const newIndex = Math.max(prev - 1, 0);
                    logger.debug('Navigate up', { from: prev, to: newIndex });
                    return newIndex;
                });
                break;
            case 'Enter':
                e.preventDefault();
                if (results[selectedIndex]) {
                    const item = results[selectedIndex];
                    // Cmd+Enter on project shows tool picker
                    if ((e.metaKey || e.ctrlKey) && item.type === 'project') {
                        logger.info('Cmd+Enter on project, showing tool picker', { path: item.projectPath, isRemote: item.isRemote });
                        onShowToolPicker?.(item.projectPath, item.title, item.isRemote, item.remoteHost);
                        onClose();
                    } else if (e.shiftKey && item.type === 'project') {
                        // Shift+Enter on project prompts for custom label
                        logger.info('Shift+Enter on project, prompting for label', { path: item.projectPath, isRemote: item.isRemote });
                        setLabelingProject({ path: item.projectPath, name: item.title, isRemote: item.isRemote, remoteHost: item.remoteHost });
                    } else {
                        logger.info('Enter pressed, selecting item', { index: selectedIndex });
                        handleSelect(item);
                    }
                }
                break;
            case 'p':
            case 'P':
                // Cmd+P to pin project to Quick Launch
                if ((e.metaKey || e.ctrlKey) && results[selectedIndex]?.type === 'project') {
                    e.preventDefault();
                    const item = results[selectedIndex];
                    logger.info('Cmd+P on project, pinning to Quick Launch', { path: item.projectPath });
                    onPinToQuickLaunch?.(item.projectPath, item.title);
                    onClose();
                }
                break;
            case 'Escape':
                e.preventDefault();
                logger.info('Escape pressed, closing menu');
                onClose();
                break;
            case 'Backspace':
                // Cmd+Backspace to delete saved layout
                if ((e.metaKey || e.ctrlKey) && results[selectedIndex]?.type === 'saved-layout') {
                    e.preventDefault();
                    const layout = results[selectedIndex];
                    logger.info('Cmd+Backspace on saved layout, showing delete dialog', { layoutId: layout.layoutId });
                    setDeletingLayout(layout);
                }
                break;
        }
    });

    const handleSelect = (item) => {
        logger.info('Item selected', {
            title: item.title,
            type: item.type || 'session',
            id: item.id,
            pinMode
        });

        // In pin mode, selecting a project pins it
        if (pinMode && item.type === 'project') {
            logger.info('Pin mode: pinning project', { path: item.projectPath });
            onPinToQuickLaunch?.(item.projectPath, item.title);
            onClose();
            return;
        }

        if (item.type === 'label') {
            if (item.id === 'delete-label') {
                logger.info('Deleting session label', { sessionId: activeSession?.id });
                onUpdateLabel?.('');
                onClose();
                return;
            }
            // add-label or edit-label → show RenameDialog
            logger.info('Opening label dialog', { action: item.id, sessionId: activeSession?.id });
            setLabelingSession({ id: activeSession?.id, customLabel: activeSession?.customLabel || '' });
            return;
        } else if (item.type === 'action') {
            logger.info('Executing action', { actionId: item.id });
            onAction?.(item.id);
        } else if (item.type === 'layout' || item.type === 'saved-layout') {
            logger.info('Executing layout action', { actionId: item.id });
            onLayoutAction?.(item.id);
        } else if (item.type === 'project') {
            // Derive count from actual array to avoid sync issues with item.sessionCount
            const sessionCount = item.sessions?.length ?? 0;

            // In newSessionMode, use host-first flow for creating new sessions
            if (newSessionMode) {
                if (sessionCount > 0) {
                    // Show session picker with existing sessions + "New Session" option
                    logger.info('New session mode: showing session picker', { path: item.projectPath, count: sessionCount });
                    onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
                } else {
                    // No sessions - start host-first flow
                    logger.info('New session mode: starting host selection', { path: item.projectPath });
                    onShowHostPicker?.(item.projectPath, item.title);
                }
            } else if (sessionCount > 1) {
                // Multiple sessions exist - show session picker
                logger.info('Project has multiple sessions, showing picker', { path: item.projectPath, count: sessionCount });
                onShowSessionPicker?.(item.projectPath, item.title, item.sessions);
            } else if (sessionCount === 1) {
                // Single session exists - attach directly to it
                logger.info('Project has single session, attaching', { path: item.projectPath, sessionId: item.sessions[0].id });
                onSelectSession?.({ ...item.sessions[0], title: item.title, projectPath: item.projectPath });
            } else {
                // No sessions - launch new project
                if (item.isRemote && item.remoteHost) {
                    // Remote project: route through tool picker to preserve remote context
                    logger.info('Remote project with no sessions, showing tool picker', { path: item.projectPath, host: item.remoteHost });
                    onShowToolPicker?.(item.projectPath, item.title, item.isRemote, item.remoteHost);
                } else {
                    // Local project: launch with default tool (Claude)
                    logger.info('Launching project with default tool', { path: item.projectPath, tool: 'claude' });
                    onLaunchProject?.(item.projectPath, item.title, 'claude');
                }
            }
        } else {
            logger.info('Navigating to session', { sessionId: item.id, title: item.title });
            onSelectSession?.(item);
        }
        onClose();
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'running': return '#4ecdc4';
            case 'waiting': return '#ffe66d';
            case 'idle': return '#6c757d';
            case 'error': return '#ff6b6b';
            default: return '#6c757d';
        }
    };

    // Handle saving custom label and launching project
    const handleSaveProjectLabel = (customLabel) => {
        if (!labelingProject) return;
        if (labelingProject.isRemote && labelingProject.remoteHost) {
            // Remote projects: route through tool picker (labels not yet supported for remote launch)
            logger.info('Remote project with label, showing tool picker', { path: labelingProject.path, host: labelingProject.remoteHost });
            onShowToolPicker?.(labelingProject.path, labelingProject.name, true, labelingProject.remoteHost);
        } else {
            logger.info('Launching project with custom label', { path: labelingProject.path, customLabel });
            onLaunchProject?.(labelingProject.path, labelingProject.name, 'claude', '', customLabel);
        }
        setLabelingProject(null);
        onClose();
    };

    // Handle saving session custom label from label dialog
    const handleSaveSessionLabel = (newLabel) => {
        if (!labelingSession) return;
        logger.info('Saving session label', { sessionId: labelingSession.id, newLabel });
        onUpdateLabel?.(newLabel);
        setLabelingSession(null);
        onClose();
    };

    // Handle confirming layout deletion
    const handleConfirmDeleteLayout = async () => {
        if (!deletingLayout) return;
        logger.info('Confirming layout deletion', { layoutId: deletingLayout.layoutId });
        try {
            await onDeleteSavedLayout?.(deletingLayout.layoutId);
            setDeletingLayout(null);
            onClose(); // Close command menu after successful deletion
        } catch (err) {
            logger.error('Failed to delete layout:', err);
            // Keep dialog open on error so user can retry or cancel
        }
    };

    // Check if currently selected item is a saved layout (for footer hint)
    const selectedIsSavedLayout = results[selectedIndex]?.type === 'saved-layout';

    return (
        <div className="menu-overlay" onClick={onClose}>
            <div className="menu-container" onClick={(e) => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    type="text"
                    className="menu-input"
                    placeholder={
                        pinMode ? "Search projects to pin..."
                        : newSessionMode ? "Launch a new agent session in..."
                        : newTabMode ? "Search for a session to open in a new tab..."
                        : "Search sessions or actions..."
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                />
                <div className="menu-list" ref={listRef}>
                    {results.length === 0 ? (
                        <div className="menu-empty">No results found</div>
                    ) : (
                        results.map((item, index) => (
                            <button
                                key={item.id}
                                className={`menu-item ${index === selectedIndex ? 'selected' : ''} ${item.type || 'session'}`}
                                onClick={() => handleSelect(item)}
                                onMouseEnter={() => setSelectedIndex(index)}
                            >
                                {item.type === 'action' ? (
                                    <>
                                        <span className="menu-action-icon">{'>'}</span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">{item.description}</div>
                                        </div>
                                    </>
                                ) : item.type === 'layout' ? (
                                    <>
                                        <span className="menu-layout-icon">{'#'}</span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">{item.description}</div>
                                        </div>
                                        {item.shortcutHint && (
                                            <span className="menu-shortcut-hint">{item.shortcutHint}</span>
                                        )}
                                    </>
                                ) : item.type === 'saved-layout' ? (
                                    <>
                                        <span className="menu-layout-icon saved">{'★'}</span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">{item.description}</div>
                                        </div>
                                        {item.shortcutHint && (
                                            <span className="menu-shortcut-hint">{item.shortcutHint}</span>
                                        )}
                                    </>
                                ) : item.type === 'label' ? (
                                    <>
                                        <span className="menu-action-icon">{'✎'}</span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">{item.description}</div>
                                        </div>
                                    </>
                                ) : item.type === 'project' ? (
                                    <>
                                        <span className={`menu-project-icon ${item.sessionCount > 0 ? 'has-sessions' : ''}`}>
                                            {item.isPinned ? '★' : (item.sessionCount > 0 ? item.sessionCount : '+')}
                                        </span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">{item.projectPath}</div>
                                        </div>
                                        {(item.sessions?.length ?? 0) > 1 && (
                                            <span className="menu-session-count">
                                                {item.sessions.length} sessions
                                            </span>
                                        )}
                                        {item.shortcut && (
                                            <span className="menu-shortcut-hint">
                                                {formatShortcut(item.shortcut)}
                                            </span>
                                        )}
                                        <span className={`menu-host-badge ${item.isRemote ? 'remote' : 'local'}`}>
                                            {item.remoteHostDisplayName || item.remoteHost || 'local'}
                                        </span>
                                        <span className="menu-project-hint">
                                            {pinMode ? 'Enter to pin' : (item.isPinned ? 'Pinned' : '⌘P Pin')}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <span
                                            className="menu-tool-icon"
                                            style={{ backgroundColor: getStatusColor(item.status) }}
                                        >
                                            <ToolIcon tool={item.tool} size={14} status={item.status} />
                                        </span>
                                        <div className="menu-item-info">
                                            <div className="menu-item-title">{item.title}</div>
                                            <div className="menu-item-subtitle">
                                                {item.projectPath || item.groupPath || 'ungrouped'}
                                            </div>
                                        </div>
                                        {favoritesLookup[item.projectPath]?.shortcut && (
                                            <span className="menu-shortcut-hint">
                                                {formatShortcut(favoritesLookup[item.projectPath].shortcut)}
                                            </span>
                                        )}
                                        <span className={`menu-host-badge ${item.isRemote ? 'remote' : 'local'}`}>
                                            {item.remoteHostDisplayName || item.remoteHost || 'local'}
                                        </span>
                                        <span
                                            className="menu-status"
                                            style={{ color: getStatusColor(item.status) }}
                                        >
                                            {item.status}
                                        </span>
                                    </>
                                )}
                            </button>
                        ))
                    )}
                </div>
                <div className="menu-footer">
                    <span className="menu-hint"><kbd>↑↓</kbd> Navigate</span>
                    <span className="menu-hint"><kbd>Enter</kbd> {pinMode ? 'Pin to Quick Launch' : newSessionMode ? 'Launch' : 'Select'}</span>
                    {!pinMode && !newSessionMode && <span className="menu-hint"><kbd>⇧Enter</kbd> Label</span>}
                    {!pinMode && results[selectedIndex]?.type === 'project' && (
                        <span className="menu-hint"><kbd>⌘Enter</kbd> Tool picker</span>
                    )}
                    {!pinMode && !newSessionMode && <span className="menu-hint"><kbd>⌘P</kbd> Pin</span>}
                    {selectedIsSavedLayout && <span className="menu-hint"><kbd>⌘⌫</kbd> Delete</span>}
                    <span className="menu-hint"><kbd>Esc</kbd> Close</span>
                </div>
            </div>

            {labelingProject && (
                <RenameDialog
                    currentName=""
                    title="Add Custom Label"
                    placeholder="Enter label..."
                    onSave={handleSaveProjectLabel}
                    onCancel={() => setLabelingProject(null)}
                />
            )}

            {labelingSession && (
                <RenameDialog
                    currentName={labelingSession.customLabel || ''}
                    title={labelingSession.customLabel ? 'Edit Custom Label' : 'Add Custom Label'}
                    placeholder="Enter label..."
                    onSave={handleSaveSessionLabel}
                    onCancel={() => setLabelingSession(null)}
                />
            )}

            {deletingLayout && (
                <DeleteLayoutDialog
                    layout={deletingLayout}
                    onConfirm={handleConfirmDeleteLayout}
                    onCancel={() => setDeletingLayout(null)}
                />
            )}
        </div>
    );
}
