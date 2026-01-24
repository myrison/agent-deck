import { useRef, useState, useEffect, useCallback } from 'react';
import './App.css';
import Terminal from './Terminal';
import Search from './Search';
import SessionSelector from './SessionSelector';
import CommandPalette from './CommandPalette';
import ToolPicker from './ToolPicker';
import QuickLaunchBar from './QuickLaunchBar';
import { ListSessions, DiscoverProjects, CreateSession, RecordProjectUsage, GetQuickLaunchFavorites, AddQuickLaunchFavorite, GetQuickLaunchBarVisibility, SetQuickLaunchBarVisibility, GetGitBranch, IsGitWorktree, MarkSessionAccessed } from '../wailsjs/go/main/App';
import { createLogger } from './logger';

const logger = createLogger('App');

function App() {
    const searchAddonRef = useRef(null);
    const [showSearch, setShowSearch] = useState(false);
    const [searchFocusTrigger, setSearchFocusTrigger] = useState(0); // Increments to trigger focus
    const [view, setView] = useState('selector'); // 'selector' or 'terminal'
    const [selectedSession, setSelectedSession] = useState(null);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [projects, setProjects] = useState([]);
    const [showToolPicker, setShowToolPicker] = useState(false);
    const [toolPickerProject, setToolPickerProject] = useState(null);
    const [showQuickLaunch, setShowQuickLaunch] = useState(true); // Show by default if favorites exist
    const [palettePinMode, setPalettePinMode] = useState(false); // When true, selecting pins instead of launching
    const [quickLaunchKey, setQuickLaunchKey] = useState(0); // For forcing refresh
    const [shortcuts, setShortcuts] = useState({}); // shortcut -> {path, name, tool}
    const [favorites, setFavorites] = useState([]); // All quick launch favorites
    const [gitBranch, setGitBranch] = useState(''); // Current git branch for selected session
    const [isWorktree, setIsWorktree] = useState(false); // Whether session is in a git worktree
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'active', 'idle'
    const sessionSelectorRef = useRef(null);

    // Cycle through status filter modes: all -> active -> idle -> all
    const handleCycleStatusFilter = useCallback(() => {
        setStatusFilter(current => {
            const modes = ['all', 'active', 'idle'];
            const currentIndex = modes.indexOf(current);
            const nextIndex = (currentIndex + 1) % modes.length;
            const nextMode = modes[nextIndex];
            logger.info('Cycling status filter', { from: current, to: nextMode });
            return nextMode;
        });
    }, []);

    // Build shortcut key from event
    const buildShortcutKey = useCallback((e) => {
        const parts = [];
        if (e.metaKey) parts.push('cmd');
        if (e.ctrlKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        if (e.key && e.key.length === 1) {
            parts.push(e.key.toLowerCase());
        }
        return parts.join('+');
    }, []);

    // Load shortcuts and favorites
    const loadShortcuts = useCallback(async () => {
        try {
            const favs = await GetQuickLaunchFavorites();
            setFavorites(favs || []);
            const shortcutMap = {};
            for (const fav of favs || []) {
                if (fav.shortcut) {
                    shortcutMap[fav.shortcut] = {
                        path: fav.path,
                        name: fav.name,
                        tool: fav.tool,
                    };
                }
            }
            setShortcuts(shortcutMap);
            logger.info('Loaded shortcuts', { count: Object.keys(shortcutMap).length, favorites: favs?.length || 0 });
        } catch (err) {
            logger.error('Failed to load shortcuts:', err);
        }
    }, []);

    // Load shortcuts and bar visibility on mount
    useEffect(() => {
        loadShortcuts();

        // Load bar visibility preference
        const loadBarVisibility = async () => {
            try {
                const visible = await GetQuickLaunchBarVisibility();
                setShowQuickLaunch(visible);
                logger.info('Loaded bar visibility', { visible });
            } catch (err) {
                logger.error('Failed to load bar visibility:', err);
            }
        };
        loadBarVisibility();
    }, [loadShortcuts]);

    const handleCloseSearch = useCallback(() => {
        setShowSearch(false);
    }, []);

    // Load sessions and projects for command palette
    const loadSessionsAndProjects = useCallback(async () => {
        try {
            logger.info('Loading sessions and projects for palette');
            const [sessionsResult, projectsResult] = await Promise.all([
                ListSessions(),
                DiscoverProjects(),
            ]);
            setSessions(sessionsResult || []);
            setProjects(projectsResult || []);
            logger.info('Loaded palette data', {
                sessions: sessionsResult?.length || 0,
                projects: projectsResult?.length || 0,
            });
        } catch (err) {
            logger.error('Failed to load palette data:', err);
        }
    }, []);

    // Load sessions/projects when palette opens
    useEffect(() => {
        if (showCommandPalette) {
            loadSessionsAndProjects();
        }
    }, [showCommandPalette, loadSessionsAndProjects]);

    // Handle command palette actions
    const handlePaletteAction = useCallback((actionId) => {
        switch (actionId) {
            case 'new-terminal':
                logger.info('Palette action: new terminal');
                setSelectedSession(null);
                setView('terminal');
                break;
            case 'refresh-sessions':
                logger.info('Palette action: refresh sessions');
                loadSessionsAndProjects();
                // If in selector view, tell it to refresh too
                if (view === 'selector') {
                    // Force re-render of selector
                    setView('selector');
                }
                break;
            case 'toggle-quick-launch':
                logger.info('Palette action: toggle quick launch bar');
                setShowQuickLaunch(prev => {
                    const newValue = !prev;
                    SetQuickLaunchBarVisibility(newValue).catch(err => {
                        logger.error('Failed to save bar visibility:', err);
                    });
                    return newValue;
                });
                break;
            default:
                logger.warn('Unknown palette action:', actionId);
        }
    }, [view, loadSessionsAndProjects]);

    // Launch a project with the specified tool
    const handleLaunchProject = useCallback(async (projectPath, projectName, tool) => {
        try {
            logger.info('Launching project', { projectPath, projectName, tool });

            // Create session
            const session = await CreateSession(projectPath, projectName, tool);
            logger.info('Session created', { sessionId: session.id, tmuxSession: session.tmuxSession });

            // Record usage for frecency
            await RecordProjectUsage(projectPath);

            // Load git branch and worktree status
            try {
                const [branch, worktree] = await Promise.all([
                    GetGitBranch(projectPath),
                    IsGitWorktree(projectPath)
                ]);
                setGitBranch(branch || '');
                setIsWorktree(worktree);
                logger.info('Git info:', { branch: branch || '(not a git repo)', isWorktree: worktree });
            } catch (err) {
                setGitBranch('');
                setIsWorktree(false);
            }

            // Switch to terminal view with the new session
            setSelectedSession(session);
            setView('terminal');
        } catch (err) {
            logger.error('Failed to launch project:', err);
            // Could show an error toast here
        }
    }, []);

    // Show tool picker for a project
    const handleShowToolPicker = useCallback((projectPath, projectName) => {
        logger.info('Showing tool picker', { projectPath, projectName });
        setToolPickerProject({ path: projectPath, name: projectName });
        setShowToolPicker(true);
    }, []);

    // Pin project to Quick Launch
    const handlePinToQuickLaunch = useCallback(async (projectPath, projectName) => {
        try {
            logger.info('Pinning to Quick Launch', { projectPath, projectName });
            await AddQuickLaunchFavorite(projectName, projectPath, 'claude');
            // Refresh favorites and Quick Launch Bar
            await loadShortcuts();
            setQuickLaunchKey(prev => prev + 1);
        } catch (err) {
            logger.error('Failed to pin to Quick Launch:', err);
        }
    }, [loadShortcuts]);

    // Open palette in pin mode (for adding favorites)
    const handleOpenPaletteForPinning = useCallback(() => {
        logger.info('Opening palette in pin mode');
        setPalettePinMode(true);
        setShowCommandPalette(true);
    }, []);

    // Close palette and reset pin mode
    const handleClosePalette = useCallback(() => {
        setShowCommandPalette(false);
        setPalettePinMode(false);
    }, []);

    // Handle tool selection from picker
    const handleToolSelected = useCallback((tool) => {
        if (toolPickerProject) {
            handleLaunchProject(toolPickerProject.path, toolPickerProject.name, tool);
        }
        setShowToolPicker(false);
        setToolPickerProject(null);
    }, [toolPickerProject, handleLaunchProject]);

    // Cancel tool picker
    const handleCancelToolPicker = useCallback(() => {
        setShowToolPicker(false);
        setToolPickerProject(null);
    }, []);

    const handleSelectSession = useCallback(async (session) => {
        logger.info('Selecting session:', session.title);
        setSelectedSession(session);
        setView('terminal');

        // Update last accessed timestamp for sorting
        try {
            await MarkSessionAccessed(session.id);
        } catch (err) {
            logger.warn('Failed to mark session accessed:', err);
        }

        // Load git branch and worktree status if session has a project path
        if (session.projectPath) {
            try {
                const [branch, worktree] = await Promise.all([
                    GetGitBranch(session.projectPath),
                    IsGitWorktree(session.projectPath)
                ]);
                setGitBranch(branch || '');
                setIsWorktree(worktree);
                logger.info('Git info:', { branch: branch || '(not a git repo)', isWorktree: worktree });
            } catch (err) {
                logger.warn('Failed to get git info:', err);
                setGitBranch('');
                setIsWorktree(false);
            }
        } else {
            setGitBranch('');
            setIsWorktree(false);
        }
    }, []);

    const handleNewTerminal = useCallback(() => {
        logger.info('Starting new terminal');
        setSelectedSession(null);
        setView('terminal');
    }, []);

    const handleBackToSelector = useCallback(() => {
        logger.info('Returning to session selector');
        setView('selector');
        setSelectedSession(null);
        setShowSearch(false);
        setGitBranch('');
        setIsWorktree(false);
    }, []);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback((e) => {
        // Check custom shortcuts first (user-defined)
        const shortcutKey = buildShortcutKey(e);
        if (shortcuts[shortcutKey]) {
            e.preventDefault();
            const fav = shortcuts[shortcutKey];
            logger.info('Custom shortcut triggered', { shortcut: shortcutKey, name: fav.name });
            handleLaunchProject(fav.path, fav.name, fav.tool);
            return;
        }

        // Cmd+F or Ctrl+F to open search (only in terminal view)
        if ((e.metaKey || e.ctrlKey) && e.key === 'f' && view === 'terminal') {
            e.preventDefault();
            setShowSearch(true);
            // Always trigger focus - works whether search is opening or already open
            setSearchFocusTrigger(prev => prev + 1);
        }
        // Cmd+K - Open command palette
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            logger.info('Cmd+K pressed - opening command palette');
            setShowCommandPalette(true);
        }
        // Cmd+W to close/back with confirmation
        if ((e.metaKey || e.ctrlKey) && e.key === 'w' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+W pressed - showing close confirmation');
            setShowCloseConfirm(true);
        }
        // Cmd+, to go back to session selector
        if ((e.metaKey || e.ctrlKey) && e.key === ',' && view === 'terminal') {
            e.preventDefault();
            handleBackToSelector();
        }
        // Shift+5 (%) to cycle session status filter (only in selector view)
        if (e.key === '%' && view === 'selector') {
            e.preventDefault();
            handleCycleStatusFilter();
        }
    }, [view, showSearch, handleBackToSelector, buildShortcutKey, shortcuts, handleLaunchProject, handleCycleStatusFilter]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Show session selector
    if (view === 'selector') {
        return (
            <div id="App">
                {showQuickLaunch && (
                    <QuickLaunchBar
                        key={quickLaunchKey}
                        onLaunch={handleLaunchProject}
                        onShowToolPicker={handleShowToolPicker}
                        onOpenPalette={() => setShowCommandPalette(true)}
                        onOpenPaletteForPinning={handleOpenPaletteForPinning}
                        onShortcutsChanged={loadShortcuts}
                    />
                )}
                <SessionSelector
                    onSelect={handleSelectSession}
                    onNewTerminal={handleNewTerminal}
                    statusFilter={statusFilter}
                    onCycleFilter={handleCycleStatusFilter}
                />
                {showCommandPalette && (
                    <CommandPalette
                        onClose={handleClosePalette}
                        onSelectSession={handleSelectSession}
                        onAction={handlePaletteAction}
                        onLaunchProject={handleLaunchProject}
                        onShowToolPicker={handleShowToolPicker}
                        onPinToQuickLaunch={handlePinToQuickLaunch}
                        sessions={sessions}
                        projects={projects}
                        favorites={favorites}
                        pinMode={palettePinMode}
                    />
                )}
                {showToolPicker && toolPickerProject && (
                    <ToolPicker
                        projectPath={toolPickerProject.path}
                        projectName={toolPickerProject.name}
                        onSelect={handleToolSelected}
                        onCancel={handleCancelToolPicker}
                    />
                )}
            </div>
        );
    }

    // Show terminal
    return (
        <div id="App">
            {showQuickLaunch && (
                <QuickLaunchBar
                    key={quickLaunchKey}
                    onLaunch={handleLaunchProject}
                    onShowToolPicker={handleShowToolPicker}
                    onOpenPalette={() => setShowCommandPalette(true)}
                    onOpenPaletteForPinning={handleOpenPaletteForPinning}
                    onShortcutsChanged={loadShortcuts}
                />
            )}
            <div className="terminal-header">
                <button className="back-button" onClick={handleBackToSelector} title="Back to sessions (Cmd+,)">
                    ← Sessions
                </button>
                {selectedSession && (
                    <div className="session-title-header">
                        {selectedSession.title}
                        {gitBranch && (
                            <span className={`git-branch${isWorktree ? ' is-worktree' : ''}`}>
                                <span className="git-branch-icon">{isWorktree ? '🌿' : '⎇'}</span>
                                {gitBranch}
                            </span>
                        )}
                    </div>
                )}
            </div>
            <div className="terminal-container">
                <Terminal
                    searchRef={searchAddonRef}
                    session={selectedSession}
                />
            </div>
            {showSearch && (
                <Search
                    searchAddon={searchAddonRef.current}
                    onClose={handleCloseSearch}
                    focusTrigger={searchFocusTrigger}
                />
            )}
            {showCloseConfirm && (
                <div className="modal-overlay" onClick={() => setShowCloseConfirm(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>Close Terminal?</h3>
                        <p>Are you sure you want to return to the session selector?</p>
                        <div className="modal-buttons">
                            <button className="modal-btn-cancel" onClick={() => setShowCloseConfirm(false)}>
                                Cancel
                            </button>
                            <button className="modal-btn-confirm" onClick={() => {
                                setShowCloseConfirm(false);
                                handleBackToSelector();
                            }}>
                                Close Terminal
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showCommandPalette && (
                <CommandPalette
                    onClose={handleClosePalette}
                    onSelectSession={handleSelectSession}
                    onAction={handlePaletteAction}
                    onLaunchProject={handleLaunchProject}
                    onShowToolPicker={handleShowToolPicker}
                    onPinToQuickLaunch={handlePinToQuickLaunch}
                    sessions={sessions}
                    projects={projects}
                    favorites={favorites}
                    pinMode={palettePinMode}
                />
            )}
            {showToolPicker && toolPickerProject && (
                <ToolPicker
                    projectPath={toolPickerProject.path}
                    projectName={toolPickerProject.name}
                    onSelect={handleToolSelected}
                    onCancel={handleCancelToolPicker}
                />
            )}
        </div>
    );
}

export default App;
