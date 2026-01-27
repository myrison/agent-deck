import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTooltip } from './Tooltip';
import { useTheme } from './context/ThemeContext';
import './App.css';
import Search from './Search';
import SessionSelector from './SessionSelector';
import CommandMenu from './CommandMenu';
import ToolPicker from './ToolPicker';
import SessionPicker from './SessionPicker';
import ConfigPicker from './ConfigPicker';
import SettingsModal from './SettingsModal';
import UnifiedTopBar from './UnifiedTopBar';
import ShortcutBar from './ShortcutBar';
import KeyboardHelpModal from './KeyboardHelpModal';
import RenameDialog from './RenameDialog';
import PaneLayout from './PaneLayout';
import FocusModeOverlay from './FocusModeOverlay';
import MoveModeOverlay from './MoveModeOverlay';
import SaveLayoutModal from './SaveLayoutModal';
import HostPicker, { LOCAL_HOST_ID } from './HostPicker';
import DeleteSessionDialog from './DeleteSessionDialog';
import Toast from './Toast';
import { BranchIcon } from './ToolIcon';
import { ListSessions, DiscoverProjects, CreateSession, CreateRemoteSession, RecordProjectUsage, GetQuickLaunchFavorites, AddQuickLaunchFavorite, GetQuickLaunchBarVisibility, SetQuickLaunchBarVisibility, GetGitBranch, IsGitWorktree, GetSessionMetadata, MarkSessionAccessed, GetDefaultLaunchConfig, UpdateSessionCustomLabel, GetFontSize, SetFontSize, GetScrollSpeed, GetSavedLayouts, SaveLayout, DeleteSavedLayout, StartRemoteTmuxSession, BrowseLocalDirectory, GetSSHHostDisplayNames, DeleteSession, OpenNewWindow, GetOpenTabState, SaveOpenTabState } from '../wailsjs/go/main/App';
import { createLogger } from './logger';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from './constants/terminal';
import { shouldInterceptShortcut, hasAppModifier } from './utils/platform';
import {
    createSinglePaneLayout,
    splitPane,
    closePane as closePaneInLayout,
    updateSplitRatio,
    getAdjacentPane,
    getCyclicPane,
    getPaneList,
    findPane,
    updatePaneSession,
    countPanes,
    balanceLayout,
    createPresetLayout,
    applyPreset,
    getFirstPaneId,
    swapPaneSessions,
    layoutToSaveFormat,
    layoutToTabSaveFormat,
    applySavedLayout,
    restoreTabLayout,
} from './layoutUtils';
import { updateSessionLabelInLayout, tabContainsSession } from './utils/tabContextMenu';
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

const logger = createLogger('App');

// Helper to get effective config key - fetches default if none provided
const getEffectiveConfigKey = async (configKey, tool) => {
    if (configKey) {
        logger.debug('Using provided config key', { tool, configKey });
        return configKey;
    }
    try {
        const defaultConfig = await GetDefaultLaunchConfig(tool);
        if (defaultConfig?.key) {
            logger.info('Using default config', { tool, configKey: defaultConfig.key, configName: defaultConfig.name });
            return defaultConfig.key;
        }
        logger.info('No default config found for tool', { tool });
    } catch (err) {
        logger.warn('Failed to get default config:', err);
    }
    return '';
};

function App() {
    const searchAddonRef = useRef(null);
    const [showSearch, setShowSearch] = useState(false);
    const [searchFocusTrigger, setSearchFocusTrigger] = useState(0); // Increments to trigger focus
    const [view, setView] = useState('selector'); // 'selector' or 'terminal'
    const [selectedSession, setSelectedSession] = useState(null);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [showCommandMenu, setShowCommandMenu] = useState(false);
    const [sessions, setSessions] = useState([]);
    const [projects, setProjects] = useState([]);
    const [showToolPicker, setShowToolPicker] = useState(false);
    const [toolPickerProject, setToolPickerProject] = useState(null);
    const [sessionPickerProject, setSessionPickerProject] = useState(null); // { path, name, sessions }
    const [showQuickLaunch, setShowQuickLaunch] = useState(true); // Show by default if favorites exist
    const [palettePinMode, setPalettePinMode] = useState(false); // When true, selecting pins instead of launching
    const [paletteNewTabMode, setPaletteNewTabMode] = useState(false); // When true, Cmd+T was used to open palette
    const [paletteNewSessionMode, setPaletteNewSessionMode] = useState(false); // When true, Cmd+N was used - new session only
    const [quickLaunchKey, setQuickLaunchKey] = useState(0); // For forcing refresh
    const [shortcuts, setShortcuts] = useState({}); // shortcut -> {path, name, tool}
    const [favorites, setFavorites] = useState([]); // All quick launch favorites
    const [gitBranch, setGitBranch] = useState(''); // Current git branch for selected session
    const [isWorktree, setIsWorktree] = useState(false); // Whether session is in a git worktree
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'active', 'idle'
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [showConfigPicker, setShowConfigPicker] = useState(false);
    const [configPickerTool, setConfigPickerTool] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showLabelDialog, setShowLabelDialog] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    // Tab state - now includes layout tree and active pane
    // Each tab: { id, name, layout: LayoutNode, activePaneId: string, openedAt, zoomedPaneId: string|null }
    const [openTabs, setOpenTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [fontSize, setFontSizeState] = useState(DEFAULT_FONT_SIZE);
    const [scrollSpeed, setScrollSpeedState] = useState(100); // Default 100%
    // Move mode - when true, shows pane numbers for session swap
    const [moveMode, setMoveMode] = useState(false);
    // Saved layouts
    const [savedLayouts, setSavedLayouts] = useState([]);
    const [showSaveLayoutModal, setShowSaveLayoutModal] = useState(false);

    // Build saved layout shortcut map for keyboard handling
    const savedLayoutShortcuts = useMemo(() => {
        const map = {};
        for (const layout of savedLayouts) {
            if (layout.shortcut) {
                map[layout.shortcut.toLowerCase()] = layout;
            }
        }
        return map;
    }, [savedLayouts]);

    const sessionSelectorRef = useRef(null);
    const terminalRefs = useRef({});
    const searchRefs = useRef({});
    const tabsRestoredRef = useRef(false);

    // Tooltip for back button
    const { show: showBackTooltip, hide: hideBackTooltip, Tooltip: BackTooltip } = useTooltip();

    // Theme context for toggle
    const { theme, setTheme } = useTheme();

    // Host-first session creation flow state
    const [showHostPicker, setShowHostPicker] = useState(false);
    const [selectedRemoteHost, setSelectedRemoteHost] = useState(null);
    const [showRemotePathInput, setShowRemotePathInput] = useState(false);
    // pendingHostSelection tracks project info from CommandMenu while user selects host
    // { path?: string, name?: string } - existing project info (used as default for folder picker)
    const [pendingHostSelection, setPendingHostSelection] = useState(null);
    // SSH host display names (hostId -> friendly name like "MacBook" or "Docker")
    const [sshHostDisplayNames, setSSHHostDisplayNames] = useState({});

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

    // Load shortcuts, bar visibility, and font size on mount
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

        // Load font size preference
        const loadFontSize = async () => {
            try {
                const size = await GetFontSize();
                setFontSizeState(size);
                logger.info('Loaded font size', { size });
            } catch (err) {
                logger.error('Failed to load font size:', err);
            }
        };
        loadFontSize();

        // Load scroll speed preference
        const loadScrollSpeed = async () => {
            try {
                const speed = await GetScrollSpeed();
                setScrollSpeedState(speed);
                logger.info('Loaded scroll speed', { speed });
            } catch (err) {
                logger.error('Failed to load scroll speed:', err);
            }
        };
        loadScrollSpeed();

        // Load saved layouts
        const loadSavedLayouts = async () => {
            try {
                const layouts = await GetSavedLayouts();
                setSavedLayouts(layouts || []);
                logger.info('Loaded saved layouts', { count: layouts?.length || 0 });
            } catch (err) {
                logger.error('Failed to load saved layouts:', err);
            }
        };
        loadSavedLayouts();

        // Load SSH host display names for friendly naming in dialogs
        const loadSSHHostDisplayNames = async () => {
            try {
                const names = await GetSSHHostDisplayNames();
                setSSHHostDisplayNames(names || {});
                logger.info('Loaded SSH host display names', { names });
            } catch (err) {
                logger.error('Failed to load SSH host display names:', err);
            }
        };
        loadSSHHostDisplayNames();

        // Restore open tabs from previous session
        const restoreOpenTabs = async () => {
            try {
                const [allSessions, savedState] = await Promise.all([
                    ListSessions(),
                    GetOpenTabState(),
                ]);

                if (!savedState || !savedState.tabs || savedState.tabs.length === 0) {
                    logger.info('No saved tab state to restore');
                    return;
                }

                const sessions = allSessions || [];
                const assignedIds = new Set();
                const restoredTabs = [];

                for (const savedTab of savedState.tabs) {
                    if (!savedTab.layout) continue;

                    const layout = restoreTabLayout(savedTab.layout, sessions, assignedIds);
                    const activePaneId = findPane(layout, savedTab.activePaneId)
                        ? savedTab.activePaneId
                        : getFirstPaneId(layout);

                    restoredTabs.push({
                        id: savedTab.id,
                        name: savedTab.name,
                        layout,
                        activePaneId,
                        openedAt: savedTab.openedAt || Date.now(),
                        zoomedPaneId: null,
                    });
                }

                if (restoredTabs.length > 0) {
                    setOpenTabs(restoredTabs);

                    // Restore active tab — fall back to first tab if saved ID is missing
                    const restoredActiveId = restoredTabs.find(t => t.id === savedState.activeTabId)
                        ? savedState.activeTabId
                        : restoredTabs[0].id;
                    setActiveTabId(restoredActiveId);

                    // Set view to terminal and select the first session from the active tab
                    const activeTab = restoredTabs.find(t => t.id === restoredActiveId);
                    if (activeTab) {
                        const panes = getPaneList(activeTab.layout);
                        const firstBound = panes.find(p => p.session);
                        if (firstBound) {
                            setSelectedSession(firstBound.session);
                        }
                        setView('terminal');
                    }

                    logger.info('Restored tab state', {
                        tabCount: restoredTabs.length,
                        activeTabId: restoredActiveId,
                    });
                }
            } catch (err) {
                logger.error('Failed to restore tab state:', err);
            } finally {
                tabsRestoredRef.current = true;
            }
        };
        restoreOpenTabs();
    }, [loadShortcuts]);

    // Debounced save of open tab state whenever tabs change
    useEffect(() => {
        if (!tabsRestoredRef.current) return; // Don't save before restore completes
        if (openTabs.length === 0) return;    // Don't persist empty state

        const timer = setTimeout(() => {
            const tabs = openTabs.map(tab => ({
                id: tab.id,
                name: tab.name,
                layout: layoutToTabSaveFormat(tab.layout),
                activePaneId: tab.activePaneId,
                openedAt: tab.openedAt || 0,
            }));

            SaveOpenTabState({
                activeTabId: activeTabId || '',
                tabs,
            }).catch(err => {
                logger.error('Failed to save tab state:', err);
            });
        }, 1000);

        return () => clearTimeout(timer);
    }, [openTabs, activeTabId]);

    // Listen for menu:newWindow event (File > New Window)
    useEffect(() => {
        const handleNewWindow = () => {
            logger.info('Menu: New Window triggered');
            OpenNewWindow().catch(err => {
                logger.error('Failed to open new window:', err);
            });
        };

        EventsOn('menu:newWindow', handleNewWindow);
        return () => EventsOff('menu:newWindow', handleNewWindow);
    }, []);

    // Helper to get friendly SSH host name with "(via SSH)" suffix
    const getSSHHostFriendlyName = useCallback((hostId) => {
        const baseName = sshHostDisplayNames[hostId] || hostId;
        return `${baseName} (via SSH)`;
    }, [sshHostDisplayNames]);

    const handleCloseSearch = useCallback(() => {
        setShowSearch(false);
    }, []);

    // Load sessions and projects for command menu
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
        if (showCommandMenu) {
            loadSessionsAndProjects();
        }
    }, [showCommandMenu, loadSessionsAndProjects]);

    // Handle command menu actions
    const handlePaletteAction = useCallback((actionId) => {
        switch (actionId) {
            case 'new-terminal':
                logger.info('Palette action: new terminal');
                setSelectedSession(null);
                setView('terminal');
                // Re-open CommandMenu after palette closes (defer to next tick)
                setTimeout(() => setShowCommandMenu(true), 0);
                break;
            case 'new-window':
                logger.info('Palette action: new window');
                OpenNewWindow().catch(err => {
                    logger.error('Failed to open new window:', err);
                });
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
            case 'toggle-theme':
                logger.info('Palette action: toggle theme', { currentTheme: theme });
                // Toggle between light and dark (skip auto for quick toggle)
                setTheme(theme === 'dark' ? 'light' : 'dark');
                break;
            case 'delete-session':
                logger.info('Palette action: delete session');
                setShowDeleteDialog(true);
                break;
            default:
                logger.warn('Unknown palette action:', actionId);
        }
    }, [view, loadSessionsAndProjects, theme, setTheme]);

    // Get the current active tab
    const activeTab = openTabs.find(t => t.id === activeTabId);

    // Tab management handlers - defined early so other handlers can use them
    const handleOpenTab = useCallback((session) => {
        // Check if session is already open in any tab's pane
        for (const tab of openTabs) {
            const panes = getPaneList(tab.layout);
            const paneWithSession = panes.find(p => p.session?.id === session.id);
            if (paneWithSession) {
                // Session exists in this tab, switch to it
                setActiveTabId(tab.id);
                // Update the tab's active pane to this one
                setOpenTabs(prev => prev.map(t =>
                    t.id === tab.id
                        ? { ...t, activePaneId: paneWithSession.id }
                        : t
                ));
                return;
            }
        }
        // Create new tab with single-pane layout containing the session
        const layout = createSinglePaneLayout(session);
        const newTab = {
            id: `tab-${session.id}-${Date.now()}`,
            name: session.customLabel || session.title,
            layout,
            activePaneId: layout.id,
            openedAt: Date.now(),
            zoomedPaneId: null,
        };
        logger.info('Opening new tab', { tabId: newTab.id, sessionTitle: session.title });
        setOpenTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
    }, [openTabs]);

    const handleCloseTab = useCallback((tabId) => {
        setOpenTabs(prev => {
            const tabIndex = prev.findIndex(t => t.id === tabId);
            if (tabIndex === -1) return prev;

            const newTabs = prev.filter(t => t.id !== tabId);
            logger.info('Closing tab', { tabId, remainingTabs: newTabs.length });

            // If closing active tab, switch to adjacent
            if (tabId === activeTabId) {
                if (newTabs.length === 0) {
                    // No tabs left, return to selector
                    setActiveTabId(null);
                    setSelectedSession(null);
                    setView('selector');
                    setGitBranch('');
                    setIsWorktree(false);
                } else {
                    // Switch to previous tab, or next if at start
                    const newIndex = Math.min(tabIndex, newTabs.length - 1);
                    const newActiveTab = newTabs[newIndex];
                    setActiveTabId(newActiveTab.id);
                    // Get the active pane's session from the new active tab
                    const activePane = findPane(newActiveTab.layout, newActiveTab.activePaneId);
                    setSelectedSession(activePane?.session || null);
                }
            }

            return newTabs;
        });
    }, [activeTabId]);

    const handleSwitchTab = useCallback(async (tabId) => {
        const tab = openTabs.find(t => t.id === tabId);
        if (!tab) return;

        logger.info('Switching to tab', { tabId, tabName: tab.name });
        setActiveTabId(tabId);
        setView('terminal');

        // Get the active pane's session from the tab
        const activePane = findPane(tab.layout, tab.activePaneId);
        const session = activePane?.session;
        setSelectedSession(session || null);

        // Update git info for the session using real-time cwd from tmux
        if (session?.tmuxSession) {
            try {
                const metadata = await GetSessionMetadata(session.tmuxSession);
                setGitBranch(metadata.gitBranch || '');
                // Check worktree status for the actual cwd
                if (metadata.cwd) {
                    const worktree = await IsGitWorktree(metadata.cwd);
                    setIsWorktree(worktree);
                } else {
                    setIsWorktree(false);
                }
            } catch (err) {
                setGitBranch('');
                setIsWorktree(false);
            }
        } else {
            setGitBranch('');
            setIsWorktree(false);
        }
    }, [openTabs]);

    // ============================================================
    // PANE MANAGEMENT - Layout manipulation handlers
    // ============================================================

    // Focus a specific pane
    const handlePaneFocus = useCallback((paneId) => {
        if (!activeTabId) return;

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;

            const pane = findPane(tab.layout, paneId);
            if (!pane) return tab;

            logger.debug('Pane focused', { paneId, hasSession: !!pane.session });

            // Update selectedSession to match the focused pane
            if (pane.session) {
                setSelectedSession(pane.session);
                // Update git info using real-time cwd from tmux
                if (pane.session.tmuxSession) {
                    GetSessionMetadata(pane.session.tmuxSession).then(async (metadata) => {
                        setGitBranch(metadata.gitBranch || '');
                        if (metadata.cwd) {
                            const worktree = await IsGitWorktree(metadata.cwd);
                            setIsWorktree(worktree);
                        } else {
                            setIsWorktree(false);
                        }
                    }).catch(() => {
                        setGitBranch('');
                        setIsWorktree(false);
                    });
                } else {
                    setGitBranch('');
                    setIsWorktree(false);
                }
            } else {
                setSelectedSession(null);
                setGitBranch('');
                setIsWorktree(false);
            }

            return { ...tab, activePaneId: paneId };
        }));
    }, [activeTabId]);

    // Split the active pane
    const handleSplitPane = useCallback((direction) => {
        if (!activeTab) return;

        const { layout, newPaneId } = splitPane(activeTab.layout, activeTab.activePaneId, direction);
        logger.info('Split pane', { direction, newPaneId });

        setOpenTabs(prev => prev.map(tab =>
            tab.id === activeTabId
                ? { ...tab, layout, activePaneId: newPaneId }
                : tab
        ));

        // Clear selected session since new pane is empty
        setSelectedSession(null);
        setGitBranch('');
        setIsWorktree(false);
    }, [activeTab, activeTabId]);

    // Close the active pane
    const handleClosePane = useCallback(() => {
        if (!activeTab) return;

        const paneCount = countPanes(activeTab.layout);
        if (paneCount <= 1) {
            // Last pane - close the tab instead
            handleCloseTab(activeTabId);
            return;
        }

        // Find a sibling pane to focus after closing
        const nextPaneId = getCyclicPane(activeTab.layout, activeTab.activePaneId, 'next');
        const newLayout = closePaneInLayout(activeTab.layout, activeTab.activePaneId);

        if (!newLayout) {
            // This shouldn't happen given the paneCount check above
            handleCloseTab(activeTabId);
            return;
        }

        logger.info('Closed pane', { closedPaneId: activeTab.activePaneId, newActivePaneId: nextPaneId });

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            return { ...tab, layout: newLayout, activePaneId: nextPaneId };
        }));

        // Update selected session to the new active pane
        const newActivePane = findPane(newLayout, nextPaneId);
        if (newActivePane?.session) {
            setSelectedSession(newActivePane.session);
        } else {
            setSelectedSession(null);
            setGitBranch('');
            setIsWorktree(false);
        }
    }, [activeTab, activeTabId, handleCloseTab]);

    // Clear session from active pane (keeps pane structure, removes session)
    const handleClearSession = useCallback(() => {
        if (!activeTab) return;

        const pane = findPane(activeTab.layout, activeTab.activePaneId);
        if (!pane?.session) {
            logger.info('Pane already empty, nothing to clear');
            return;
        }

        logger.info('Clearing session from pane', { paneId: activeTab.activePaneId, sessionTitle: pane.session.title });

        const newLayout = updatePaneSession(activeTab.layout, activeTab.activePaneId, null);

        setOpenTabs(prev => prev.map(tab =>
            tab.id === activeTabId
                ? { ...tab, layout: newLayout }
                : tab
        ));

        // Clear selected session since pane is now empty
        setSelectedSession(null);
        setGitBranch('');
        setIsWorktree(false);
    }, [activeTab, activeTabId]);

    // Navigate to adjacent pane
    const handleNavigatePane = useCallback((direction) => {
        if (!activeTab) return;

        const adjacentPaneId = getAdjacentPane(activeTab.layout, activeTab.activePaneId, direction);
        if (adjacentPaneId) {
            handlePaneFocus(adjacentPaneId);
        }
    }, [activeTab, handlePaneFocus]);

    // Navigate to next/previous pane (cyclic)
    const handleCyclicNavigatePane = useCallback((direction) => {
        if (!activeTab) return;

        const nextPaneId = getCyclicPane(activeTab.layout, activeTab.activePaneId, direction);
        if (nextPaneId) {
            handlePaneFocus(nextPaneId);
        }
    }, [activeTab, handlePaneFocus]);

    // Update split ratio
    const handleRatioChange = useCallback((paneId, newRatio) => {
        if (!activeTabId) return;

        setOpenTabs(prev => prev.map(tab =>
            tab.id === activeTabId
                ? { ...tab, layout: updateSplitRatio(tab.layout, paneId, newRatio) }
                : tab
        ));
    }, [activeTabId]);

    // Balance all panes
    const handleBalancePanes = useCallback(() => {
        if (!activeTabId) return;

        logger.info('Balancing panes');
        setOpenTabs(prev => prev.map(tab =>
            tab.id === activeTabId
                ? { ...tab, layout: balanceLayout(tab.layout) }
                : tab
        ));
    }, [activeTabId]);

    // Toggle zoom on active pane
    const handleToggleZoom = useCallback(() => {
        if (!activeTab) return;

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            const newZoomedPaneId = tab.zoomedPaneId ? null : tab.activePaneId;
            logger.info('Toggle zoom', { zoomedPaneId: newZoomedPaneId });
            return { ...tab, zoomedPaneId: newZoomedPaneId };
        }));
    }, [activeTab, activeTabId]);

    // Exit zoom mode
    const handleExitZoom = useCallback(() => {
        if (!activeTab || !activeTab.zoomedPaneId) return;

        setOpenTabs(prev => prev.map(tab =>
            tab.id === activeTabId
                ? { ...tab, zoomedPaneId: null }
                : tab
        ));
    }, [activeTab, activeTabId]);

    // Apply a layout preset
    const handleApplyPreset = useCallback((presetType) => {
        if (!activeTab) return;

        const presetLayout = createPresetLayout(presetType);
        const { layout, closedSessions } = applyPreset(activeTab.layout, presetLayout);
        const firstPaneId = getFirstPaneId(layout);

        logger.info('Applied preset', { presetType, closedSessions: closedSessions.length });

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            return {
                ...tab,
                layout,
                activePaneId: firstPaneId,
                zoomedPaneId: null, // Exit zoom when applying preset
            };
        }));

        // Update selected session to the first pane's session
        const firstPane = findPane(layout, firstPaneId);
        setSelectedSession(firstPane?.session || null);
    }, [activeTab, activeTabId]);

    // Build pane number map for move mode (paneId -> 1, 2, 3, ...)
    const buildPaneNumberMap = useCallback((layout) => {
        if (!layout) return {};
        const panes = getPaneList(layout);
        const map = {};
        panes.forEach((pane, index) => {
            map[pane.id] = index + 1; // 1-indexed for user display
        });
        return map;
    }, []);

    // Enter move mode
    const handleEnterMoveMode = useCallback(() => {
        if (!activeTab || countPanes(activeTab.layout) < 2) {
            logger.info('Cannot enter move mode - need at least 2 panes');
            return;
        }
        logger.info('Entering move mode');
        setMoveMode(true);
    }, [activeTab]);

    // Exit move mode
    const handleExitMoveMode = useCallback(() => {
        logger.info('Exiting move mode');
        setMoveMode(false);
    }, []);

    // Swap sessions by pane number (1-indexed)
    const handleMoveToPane = useCallback((targetPaneNumber) => {
        if (!activeTab || !moveMode) return;

        const paneNumberMap = buildPaneNumberMap(activeTab.layout);

        // Find target pane ID by number
        const targetPaneId = Object.entries(paneNumberMap).find(
            ([_, num]) => num === targetPaneNumber
        )?.[0];

        if (!targetPaneId) {
            logger.warn('Invalid pane number', { targetPaneNumber });
            handleExitMoveMode();
            return;
        }

        // Don't swap with self
        if (targetPaneId === activeTab.activePaneId) {
            logger.info('Cannot swap pane with itself');
            handleExitMoveMode();
            return;
        }

        logger.info('Swapping sessions', {
            from: activeTab.activePaneId,
            to: targetPaneId,
            targetNumber: targetPaneNumber
        });

        // Swap sessions
        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            return {
                ...tab,
                layout: swapPaneSessions(tab.layout, tab.activePaneId, targetPaneId),
            };
        }));

        // Exit move mode
        handleExitMoveMode();
    }, [activeTab, activeTabId, moveMode, buildPaneNumberMap, handleExitMoveMode]);

    // Open save layout modal
    const handleOpenSaveLayoutModal = useCallback(() => {
        if (!activeTab || countPanes(activeTab.layout) < 2) {
            logger.info('Cannot save layout - need at least 2 panes');
            return;
        }
        setShowSaveLayoutModal(true);
    }, [activeTab]);

    // Save current layout
    const handleSaveLayout = useCallback(async (name, shortcut) => {
        if (!activeTab) return;

        try {
            // Convert current layout to save format (strips sessions)
            const layoutStructure = layoutToSaveFormat(activeTab.layout);

            const savedLayout = await SaveLayout({
                id: '', // Will be assigned by backend
                name,
                layout: layoutStructure,
                shortcut: shortcut || '',
                createdAt: 0, // Will be set by backend
            });

            logger.info('Layout saved', { id: savedLayout.id, name });

            // Refresh saved layouts
            const layouts = await GetSavedLayouts();
            setSavedLayouts(layouts || []);

            setShowSaveLayoutModal(false);
        } catch (err) {
            logger.error('Failed to save layout:', err);
        }
    }, [activeTab]);

    // Apply a saved layout
    const handleApplySavedLayout = useCallback((savedLayout) => {
        if (!activeTab || !savedLayout?.layout) return;

        const { layout, closedSessions } = applySavedLayout(activeTab.layout, savedLayout.layout, sessions);
        const firstPaneId = getFirstPaneId(layout);

        logger.info('Applied saved layout', { name: savedLayout.name, closedSessions: closedSessions.length });

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            return {
                ...tab,
                layout,
                activePaneId: firstPaneId,
                zoomedPaneId: null, // Exit zoom when applying layout
            };
        }));

        // Update selected session to the first pane's session
        const firstPane = findPane(layout, firstPaneId);
        setSelectedSession(firstPane?.session || null);
    }, [activeTab, activeTabId, sessions]);

    // Handle layout actions from command menu
    // NOTE: Defined after all the handlers it depends on to avoid forward reference issues
    const handleLayoutAction = useCallback((actionId) => {
        logger.info('Layout action from palette', { actionId });
        switch (actionId) {
            case 'split-right':
                handleSplitPane('vertical');
                break;
            case 'split-down':
                handleSplitPane('horizontal');
                break;
            case 'close-pane':
                handleClosePane();
                break;
            case 'clear-session':
                handleClearSession();
                break;
            case 'balance-panes':
                handleBalancePanes();
                break;
            case 'toggle-zoom':
                handleToggleZoom();
                break;
            case 'move-to-pane':
                handleEnterMoveMode();
                break;
            case 'layout-single':
                handleApplyPreset('single');
                break;
            case 'layout-2-col':
                handleApplyPreset('2-col');
                break;
            case 'layout-2-row':
                handleApplyPreset('2-row');
                break;
            case 'layout-2x2':
                handleApplyPreset('2x2');
                break;
            case 'save-layout':
                handleOpenSaveLayoutModal();
                break;
            default:
                // Check for saved layout IDs (format: 'saved-layout:id')
                if (actionId.startsWith('saved-layout:')) {
                    const layoutId = actionId.replace('saved-layout:', '');
                    const savedLayout = savedLayouts.find(l => l.id === layoutId);
                    if (savedLayout) {
                        handleApplySavedLayout(savedLayout);
                    } else {
                        logger.warn('Saved layout not found:', layoutId);
                    }
                } else {
                    logger.warn('Unknown layout action:', actionId);
                }
        }
    }, [handleSplitPane, handleClosePane, handleClearSession, handleBalancePanes, handleToggleZoom, handleEnterMoveMode, handleApplyPreset, handleOpenSaveLayoutModal, savedLayouts, handleApplySavedLayout]);

    // Delete a saved layout
    const handleDeleteSavedLayout = useCallback(async (layoutId) => {
        try {
            await DeleteSavedLayout(layoutId);
            logger.info('Layout deleted', { layoutId });

            // Refresh saved layouts
            const layouts = await GetSavedLayouts();
            setSavedLayouts(layouts || []);
        } catch (err) {
            logger.error('Failed to delete layout:', err);
            throw err; // Re-throw so caller can handle (e.g., keep dialog open)
        }
    }, []);

    // Open a session in the active pane (from command menu)
    const handlePaneSessionSelect = useCallback((paneId) => {
        // This is called when user clicks on an empty pane
        // Opens command menu to select a session for this pane
        if (!activeTabId) return;

        // First, ensure this pane is focused
        handlePaneFocus(paneId);

        // Then open command menu
        setShowCommandMenu(true);
    }, [activeTabId, handlePaneFocus]);

    // Assign a session to the current active pane
    const handleAssignSessionToPane = useCallback((session) => {
        if (!activeTab) return;

        logger.info('Assigning session to pane', { paneId: activeTab.activePaneId, sessionTitle: session.title });

        setOpenTabs(prev => prev.map(tab => {
            if (tab.id !== activeTabId) return tab;
            return {
                ...tab,
                layout: updatePaneSession(tab.layout, tab.activePaneId, session),
                // Update tab name if it's a single-pane tab
                name: countPanes(tab.layout) === 1 ? (session.customLabel || session.title) : tab.name,
            };
        }));

        setSelectedSession(session);
    }, [activeTab, activeTabId]);

    // Launch a project with the specified tool and optional config
    // customLabel is optional - if provided, will be set as the session's custom label
    const handleLaunchProject = useCallback(async (projectPath, projectName, tool, configKey = '', customLabel = '') => {
        console.error('[DEBUG] handleLaunchProject called', { projectPath, projectName, tool, configKey, customLabel });
        try {
            // Auto-fetch default config if none provided
            const effectiveConfigKey = await getEffectiveConfigKey(configKey, tool);

            logger.info('Launching project', { projectPath, projectName, tool, configKey: effectiveConfigKey, customLabel });
            console.error('[DEBUG] Calling CreateSession with:', { projectPath, projectName, tool, effectiveConfigKey });

            // Create session with config key
            const session = await CreateSession(projectPath, projectName, tool, effectiveConfigKey);
            console.error('[DEBUG] CreateSession returned:', session);
            logger.info('Session created', { sessionId: session.id, tmuxSession: session.tmuxSession });

            // Validate session object
            if (!session || !session.id || !session.tmuxSession) {
                throw new Error('Invalid session returned from CreateSession');
            }

            // Set custom label if provided
            if (customLabel) {
                try {
                    await UpdateSessionCustomLabel(session.id, customLabel);
                    session.customLabel = customLabel;
                    logger.info('Custom label set', { customLabel });
                } catch (err) {
                    logger.warn('Failed to set custom label:', err);
                }
            }

            // Record usage for frecency
            await RecordProjectUsage(projectPath);

            // Load git branch and worktree status using real-time cwd from tmux
            try {
                const metadata = await GetSessionMetadata(session.tmuxSession);
                setGitBranch(metadata.gitBranch || '');
                if (metadata.cwd) {
                    const worktree = await IsGitWorktree(metadata.cwd);
                    setIsWorktree(worktree);
                } else {
                    setIsWorktree(false);
                }
                logger.info('Git info:', { branch: metadata.gitBranch || '(not a git repo)', cwd: metadata.cwd });
            } catch (err) {
                setGitBranch('');
                setIsWorktree(false);
            }

            // Open as tab and switch to terminal view
            handleOpenTab(session);
            setSelectedSession(session);
            setView('terminal');
        } catch (err) {
            logger.error('Failed to launch project:', err);
            // Show alert so user knows something went wrong
            alert(`Failed to create session: ${err.message || err}`);
        }
    }, [handleOpenTab]);

    // Launch a remote session (modified version of handleLaunchProject)
    const handleLaunchRemoteProject = useCallback(async (hostId, projectPath, projectName, tool, configKey = '') => {
        try {
            // Auto-fetch default config if none provided
            const effectiveConfigKey = await getEffectiveConfigKey(configKey, tool);

            logger.info('Launching remote project', { hostId, projectPath, projectName, tool, configKey: effectiveConfigKey });

            // Create session on remote host
            const session = await CreateRemoteSession(hostId, projectPath, projectName, tool, effectiveConfigKey);
            logger.info('Remote session created', { sessionId: session.id, tmuxSession: session.tmuxSession, remoteHost: session.remoteHost });

            // Clear remote session state
            setSelectedRemoteHost(null);

            // Open as tab and switch to terminal view
            handleOpenTab(session);
            setSelectedSession(session);
            setView('terminal');
            // Remote sessions don't have local git info
            setGitBranch('');
            setIsWorktree(false);
        } catch (err) {
            logger.error('Failed to launch remote project:', err);
            // Show alert so user knows something went wrong
            alert(`Failed to create remote session: ${err.message || err}`);
        }
    }, [handleOpenTab]);

    // Show tool picker for a project
    const handleShowToolPicker = useCallback((projectPath, projectName, isRemote, remoteHost) => {
        logger.info('Showing tool picker', { projectPath, projectName, isRemote, remoteHost });
        setToolPickerProject({ path: projectPath, name: projectName, isRemote: !!isRemote, remoteHost: remoteHost || null });
        setShowToolPicker(true);
    }, []);

    // Show session picker for a project with multiple sessions
    const handleShowSessionPicker = useCallback((projectPath, projectName, projectSessions) => {
        // Derive remote info from sessions
        // If ALL sessions are remote and from the SAME host, treat project as remote
        let isRemote = false;
        let remoteHost = null;

        if (projectSessions && projectSessions.length > 0) {
            const remoteSessions = projectSessions.filter(s => s.isRemote);
            if (remoteSessions.length === projectSessions.length && remoteSessions.length > 0) {
                // All sessions are remote - check if all from same host
                const hosts = new Set(remoteSessions.map(s => s.remoteHost).filter(Boolean));
                if (hosts.size === 1) {
                    isRemote = true;
                    remoteHost = remoteSessions[0].remoteHost;
                }
            }
        }

        logger.info('Showing session picker', { projectPath, projectName, sessionCount: projectSessions?.length, isRemote, remoteHost });
        setSessionPickerProject({
            path: projectPath,
            name: projectName,
            sessions: projectSessions,
            isRemote,
            remoteHost
        });
    }, []);

    // Handle session selection from session picker
    const handleSessionPickerSelect = useCallback((sessionId) => {
        // Look up in picker's sessions first (source of truth), then global sessions as fallback
        const session = sessionPickerProject?.sessions?.find(s => s.id === sessionId)
            ?? sessions.find(s => s.id === sessionId);
        if (session) {
            logger.info('Session picker: attaching to session', { sessionId, title: session.title });
            handleOpenTab(session);
            setSelectedSession(session);
            setView('terminal');
        } else {
            logger.warn('Session picker: session not found', { sessionId });
        }
        setSessionPickerProject(null);
    }, [sessions, sessionPickerProject, handleOpenTab]);

    // Handle creating a new session from session picker
    const handleSessionPickerCreateNew = useCallback(async (customLabel) => {
        if (!sessionPickerProject) return;

        const { path, name, isRemote, remoteHost } = sessionPickerProject;
        const tool = 'claude'; // Default tool for session picker (could be made configurable later)

        logger.info('Session picker: creating new session', {
            path,
            name,
            customLabel,
            isRemote,
            remoteHost
        });

        try {
            if (isRemote && remoteHost) {
                // Create remote session - handleLaunchRemoteProject handles config fetching
                await handleLaunchRemoteProject(remoteHost, path, name, tool, '');
                // Note: customLabel not supported for remote sessions yet via this path
                if (customLabel) {
                    logger.warn('Custom label not applied to remote session (not implemented)');
                }
            } else {
                // Create local session - handleLaunchProject handles config fetching
                await handleLaunchProject(path, name, tool, '', customLabel || '');
            }
        } catch (err) {
            logger.error('Session picker: failed to create session', err);
            // Error is already shown by handleLaunchProject/handleLaunchRemoteProject
        } finally {
            setSessionPickerProject(null);
        }
    }, [sessionPickerProject, handleLaunchProject, handleLaunchRemoteProject]);

    // Cancel session picker
    const handleCancelSessionPicker = useCallback(() => {
        logger.info('Session picker cancelled');
        setSessionPickerProject(null);
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
        setShowCommandMenu(true);
    }, []);

    // Close palette and reset modes
    const handleClosePalette = useCallback(() => {
        setShowCommandMenu(false);
        setPalettePinMode(false);
        setPaletteNewTabMode(false);
        setPaletteNewSessionMode(false);
    }, []);

    // Handle tool selection from picker (use default config if available)
    const handleToolSelected = useCallback(async (tool) => {
        console.error('[DEBUG] handleToolSelected called', { tool, toolPickerProject });
        if (toolPickerProject) {
            // Try to get default config for this tool
            let configKey = '';
            try {
                const defaultConfig = await GetDefaultLaunchConfig(tool);
                if (defaultConfig?.key) {
                    configKey = defaultConfig.key;
                    logger.info('Using default config', { tool, configKey });
                }
            } catch (err) {
                logger.warn('Failed to get default config:', err);
            }

            // Check if this is a remote session
            if (toolPickerProject.isRemote && toolPickerProject.remoteHost) {
                console.error('[DEBUG] Launching REMOTE project', { host: toolPickerProject.remoteHost, path: toolPickerProject.path });
                handleLaunchRemoteProject(toolPickerProject.remoteHost, toolPickerProject.path, toolPickerProject.name, tool, configKey);
            } else {
                console.error('[DEBUG] Launching LOCAL project', { path: toolPickerProject.path, name: toolPickerProject.name, tool, configKey });
                handleLaunchProject(toolPickerProject.path, toolPickerProject.name, tool, configKey);
            }
        } else {
            console.error('[DEBUG] handleToolSelected: toolPickerProject is null/undefined!');
        }
        setShowToolPicker(false);
        setToolPickerProject(null);
        setSelectedRemoteHost(null);
    }, [toolPickerProject, handleLaunchProject, handleLaunchRemoteProject]);

    // Handle tool selection with config picker (Cmd+Enter)
    const handleToolSelectedWithConfig = useCallback((tool) => {
        logger.info('Opening config picker', { tool });
        setShowToolPicker(false);
        setConfigPickerTool(tool);
        setShowConfigPicker(true);
    }, []);

    // Handle config selection from picker
    const handleConfigSelected = useCallback((configKey) => {
        if (toolPickerProject && configPickerTool) {
            // Check if this is a remote session
            if (toolPickerProject.isRemote && toolPickerProject.remoteHost) {
                handleLaunchRemoteProject(toolPickerProject.remoteHost, toolPickerProject.path, toolPickerProject.name, configPickerTool, configKey);
            } else {
                handleLaunchProject(toolPickerProject.path, toolPickerProject.name, configPickerTool, configKey);
            }
        }
        setShowConfigPicker(false);
        setConfigPickerTool(null);
        setToolPickerProject(null);
        setSelectedRemoteHost(null);
    }, [toolPickerProject, configPickerTool, handleLaunchProject, handleLaunchRemoteProject]);

    // Cancel config picker
    const handleCancelConfigPicker = useCallback(() => {
        setShowConfigPicker(false);
        setConfigPickerTool(null);
        // Go back to tool picker
        setShowToolPicker(true);
    }, []);

    // Cancel tool picker
    const handleCancelToolPicker = useCallback(() => {
        setShowToolPicker(false);
        setToolPickerProject(null);
        // Clear remote session state if in remote flow
        setSelectedRemoteHost(null);
    }, []);

    // ==================== Host-First Session Creation ====================

    // Handle host selection from HostPicker
    const handleHostSelected = useCallback(async (hostId) => {
        console.error('[DEBUG] handleHostSelected called', { hostId, pendingProject: pendingHostSelection });
        logger.info('Host selected', { hostId, pendingProject: pendingHostSelection });
        setShowHostPicker(false);

        if (hostId === LOCAL_HOST_ID) {
            // Local: open native folder picker
            try {
                const defaultDir = pendingHostSelection?.path || '';
                console.error('[DEBUG] Opening folder picker with defaultDir:', defaultDir);
                const selectedPath = await BrowseLocalDirectory(defaultDir);
                console.error('[DEBUG] Folder picker returned:', selectedPath);
                if (selectedPath) {
                    const name = selectedPath.split('/').pop() || 'project';
                    logger.info('Local folder selected', { selectedPath, name });
                    const toolProject = { path: selectedPath, name, isRemote: false, remoteHost: null };
                    console.error('[DEBUG] Setting toolPickerProject:', toolProject);
                    setToolPickerProject(toolProject);
                    setShowToolPicker(true);
                } else {
                    logger.info('Folder picker cancelled');
                }
            } catch (err) {
                console.error('[DEBUG] Folder picker error:', err);
                logger.error('Failed to open folder picker:', err);
            }
            setPendingHostSelection(null);
        } else {
            // Remote: show path input
            setSelectedRemoteHost(hostId);
            setShowRemotePathInput(true);
        }
    }, [pendingHostSelection]);

    // Cancel host picker
    const handleCancelHostPicker = useCallback(() => {
        setShowHostPicker(false);
        setSelectedRemoteHost(null);
        setPendingHostSelection(null);
    }, []);

    // Handle remote path input
    const handleRemotePathSubmit = useCallback((path) => {
        console.error('[DEBUG] handleRemotePathSubmit called', { path, selectedRemoteHost });
        if (!path.trim()) {
            console.error('[DEBUG] handleRemotePathSubmit: empty path, returning');
            return;
        }
        logger.info('Remote path entered', { path, host: selectedRemoteHost });
        setShowRemotePathInput(false);
        setPendingHostSelection(null);
        // Extract project name from path (last component)
        const projectName = path.split('/').pop() || path;
        const toolProject = { path: path.trim(), name: projectName, isRemote: true, remoteHost: selectedRemoteHost };
        console.error('[DEBUG] Setting toolPickerProject for remote:', toolProject);
        setToolPickerProject(toolProject);
        setShowToolPicker(true);
    }, [selectedRemoteHost]);

    // Cancel remote path input
    const handleCancelRemotePathInput = useCallback(() => {
        setShowRemotePathInput(false);
        setSelectedRemoteHost(null);
        setPendingHostSelection(null);
    }, []);

    // Start host-first session creation flow (called from CommandMenu in newSessionMode)
    const handleStartHostSelection = useCallback((projectPath, projectName) => {
        logger.info('Starting host selection flow', { projectPath, projectName });
        setPendingHostSelection({ path: projectPath, name: projectName });
        setShowHostPicker(true);
    }, []);

    // Open settings modal
    const handleOpenSettings = useCallback(() => {
        logger.info('Opening settings modal');
        setShowSettings(true);
    }, []);

    // Handle saving custom label for current session
    const handleSaveSessionCustomLabel = useCallback(async (newLabel) => {
        if (!selectedSession) return;
        try {
            logger.info('Saving session custom label', { sessionId: selectedSession.id, newLabel });
            await UpdateSessionCustomLabel(selectedSession.id, newLabel);
            // Update local state
            setSelectedSession(prev => ({ ...prev, customLabel: newLabel }));
        } catch (err) {
            logger.error('Failed to save session custom label:', err);
        }
        setShowLabelDialog(false);
    }, [selectedSession]);

    // Handle tab label updated from context menu
    const handleTabLabelUpdated = useCallback((sessionId, newLabel) => {
        setOpenTabs(prev => prev.map(tab => {
            // Check if this tab contains the session (works with layout-based tabs)
            if (!tabContainsSession(tab, sessionId)) {
                return tab;
            }
            // Update the session label within the layout
            return {
                ...tab,
                layout: updateSessionLabelInLayout(tab.layout, sessionId, newLabel),
            };
        }));
        if (selectedSession?.id === sessionId) {
            setSelectedSession(prev => prev ? { ...prev, customLabel: newLabel || undefined } : prev);
        }
    }, [selectedSession]);

    const handleSelectSession = useCallback(async (session) => {
        logger.info('Selecting session:', session.title);

        // Open as tab
        handleOpenTab(session);

        setSelectedSession(session);
        setView('terminal');

        // Update last accessed timestamp for sorting
        try {
            await MarkSessionAccessed(session.id);
        } catch (err) {
            logger.warn('Failed to mark session accessed:', err);
        }

        // Load git branch and worktree status using real-time cwd from tmux
        if (session.tmuxSession) {
            try {
                const metadata = await GetSessionMetadata(session.tmuxSession);
                setGitBranch(metadata.gitBranch || '');
                // Check worktree status for the actual cwd
                if (metadata.cwd) {
                    const worktree = await IsGitWorktree(metadata.cwd);
                    setIsWorktree(worktree);
                } else {
                    setIsWorktree(false);
                }
                logger.info('Git info:', { branch: metadata.gitBranch || '(not a git repo)', cwd: metadata.cwd, isWorktree: metadata.cwd ? 'checking...' : false });
            } catch (err) {
                logger.warn('Failed to get git info:', err);
                setGitBranch('');
                setIsWorktree(false);
            }
        } else {
            setGitBranch('');
            setIsWorktree(false);
        }
    }, [handleOpenTab]);

    const handleNewTerminal = useCallback(() => {
        logger.info('Starting new terminal');
        setSelectedSession(null);
        setView('terminal');
        setShowCommandMenu(true);  // Auto-open CommandMenu
    }, []);

    const handleBackToSelector = useCallback(() => {
        logger.info('Returning to session selector');
        setView('selector');
        setSelectedSession(null);
        setShowSearch(false);
        setGitBranch('');
        setIsWorktree(false);
    }, []);

    // Handle session deletion - close any tabs containing the deleted session
    const handleSessionDeleted = useCallback((deletedSessionId) => {
        logger.info('Session deleted, closing related tabs', { sessionId: deletedSessionId });

        setOpenTabs(prev => {
            // Find tabs that have the deleted session in any pane
            const tabsToClose = [];
            const tabsToUpdate = [];

            for (const tab of prev) {
                const panes = getPaneList(tab.layout);
                const hasDeletedSession = panes.some(p => p.session?.id === deletedSessionId);

                if (hasDeletedSession) {
                    // Check if all panes have the deleted session (or are empty)
                    const nonDeletedPanes = panes.filter(p => p.session && p.session.id !== deletedSessionId);
                    if (nonDeletedPanes.length === 0) {
                        // All panes had the deleted session - close the tab
                        tabsToClose.push(tab.id);
                    } else {
                        // Some panes have other sessions - just clear the deleted session from panes
                        tabsToUpdate.push(tab.id);
                    }
                }
            }

            if (tabsToClose.length === 0 && tabsToUpdate.length === 0) {
                return prev;
            }

            // Filter out closed tabs and update remaining tabs
            let newTabs = prev.filter(t => !tabsToClose.includes(t.id));

            // Clear deleted session from remaining panes
            newTabs = newTabs.map(tab => {
                if (!tabsToUpdate.includes(tab.id)) return tab;

                // Update panes to clear the deleted session
                const updateLayout = (node) => {
                    if (!node) return node;
                    if (node.session?.id === deletedSessionId) {
                        return { ...node, session: null };
                    }
                    if (node.children) {
                        return { ...node, children: node.children.map(updateLayout) };
                    }
                    return node;
                };

                return { ...tab, layout: updateLayout(tab.layout) };
            });

            // Handle active tab being closed
            if (tabsToClose.includes(activeTabId)) {
                if (newTabs.length === 0) {
                    setActiveTabId(null);
                    setSelectedSession(null);
                    setView('selector');
                    setGitBranch('');
                    setIsWorktree(false);
                } else {
                    const newActiveTab = newTabs[0];
                    setActiveTabId(newActiveTab.id);
                    const activePane = findPane(newActiveTab.layout, newActiveTab.activePaneId);
                    setSelectedSession(activePane?.session || null);
                }
            }

            return newTabs;
        });
    }, [activeTabId]);

    // Handle delete button click from terminal header
    const handleDeleteCurrentSession = useCallback(async () => {
        if (!selectedSession) return;
        try {
            logger.info('Deleting current session', { sessionId: selectedSession.id, title: selectedSession.title });
            await DeleteSession(selectedSession.id);
            logger.info('Session deleted successfully');
            // Trigger cleanup of tabs containing this session
            handleSessionDeleted(selectedSession.id);
            setShowDeleteDialog(false);
        } catch (err) {
            logger.error('Failed to delete session:', err);
            alert('Failed to delete session. Please try again.');
        }
    }, [selectedSession, handleSessionDeleted]);

    // Handle opening help modal
    const handleOpenHelp = useCallback(() => {
        logger.info('Opening help modal');
        setShowHelpModal(true);
    }, []);

    // Handle font size change (delta: +1 or -1)
    const handleFontSizeChange = useCallback(async (delta) => {
        const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize + delta));
        if (newSize === fontSize) return; // No change (at limit)

        try {
            await SetFontSize(newSize);
            setFontSizeState(newSize);
            logger.info('Font size changed', { from: fontSize, to: newSize });
        } catch (err) {
            logger.error('Failed to set font size:', err);
        }
    }, [fontSize]);

    // Reset font size to default
    const handleFontSizeReset = useCallback(async () => {
        if (fontSize === DEFAULT_FONT_SIZE) return; // Already at default

        try {
            await SetFontSize(DEFAULT_FONT_SIZE);
            setFontSizeState(DEFAULT_FONT_SIZE);
            logger.info('Font size reset to default', { size: DEFAULT_FONT_SIZE });
        } catch (err) {
            logger.error('Failed to reset font size:', err);
        }
    }, [fontSize]);

    // Set font scale on document root so CSS variables in :root can use it
    useEffect(() => {
        const fontScale = fontSize / 14;
        document.documentElement.style.setProperty('--font-scale', fontScale);
        logger.debug('Font scale updated', { fontSize, fontScale });
    }, [fontSize]);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback((e) => {
        // Don't handle shortcuts when modals with input fields or their own handlers are open
        // This includes modals with text input (CommandMenu, RenameDialog, etc) and modal handlers (HelpModal, Settings)
        // Also includes picker modals that handle their own keyboard navigation
        if (showHelpModal || showSettings || showCommandMenu || showLabelDialog || showDeleteDialog || showRemotePathInput ||
            sessionPickerProject || showToolPicker || showConfigPicker || showHostPicker || showSaveLayoutModal) {
            return;
        }

        // Don't intercept typing in input fields (fallback check if an input exists outside modals)
        const isTypingInInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

        // Move mode keyboard handling - intercept number keys and Escape
        if (moveMode) {
            // Number keys 1-9 to select target pane
            if (e.key >= '1' && e.key <= '9' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                const paneNumber = parseInt(e.key, 10);
                handleMoveToPane(paneNumber);
                return;
            }
            // Escape to cancel move mode
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleExitMoveMode();
                return;
            }
            // Block other keys during move mode
            return;
        }

        // Check custom shortcuts first (user-defined quick launch)
        // Skip when typing in input fields without modifiers
        const shortcutKey = buildShortcutKey(e);
        if (!isTypingInInput && shortcuts[shortcutKey]) {
            e.preventDefault();
            const fav = shortcuts[shortcutKey];
            logger.info('Custom shortcut triggered', { shortcut: shortcutKey, name: fav.name });
            handleLaunchProject(fav.path, fav.name, fav.tool);
            return;
        }

        // Check saved layout shortcuts (only in terminal view with active tab)
        // Skip when typing in input fields without modifiers
        if (!isTypingInInput && view === 'terminal' && activeTab && savedLayoutShortcuts[shortcutKey]) {
            e.preventDefault();
            const layout = savedLayoutShortcuts[shortcutKey];
            logger.info('Saved layout shortcut triggered', { shortcut: shortcutKey, name: layout.name });
            handleApplySavedLayout(layout);
            return;
        }

        // Helper to check if app shortcut should fire (respects terminal passthrough on macOS)
        const inTerminal = view === 'terminal';
        const appMod = shouldInterceptShortcut(e, inTerminal);

        // Cmd+/ or Ctrl+/ to open help (works in both views)
        if (appMod && e.key === '/') {
            e.preventDefault();
            e.stopPropagation();
            handleOpenHelp();
            return;
        }
        // Cmd+Shift+N - Open new window (production only)
        if (hasAppModifier(e) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
            e.preventDefault();
            e.stopPropagation();
            logger.info('Cmd+Shift+N pressed - opening new window');
            OpenNewWindow().catch(err => {
                logger.error('Failed to open new window:', err);
            });
            return;
        }
        // Cmd+N - New session mode (shows only projects for launching new sessions)
        if (hasAppModifier(e) && !e.shiftKey && e.key === 'n') {
            e.preventDefault();
            logger.info('Cmd+N pressed - opening command menu for new session');
            setPaletteNewSessionMode(true);
            setShowCommandMenu(true);
            return;
        }
        // Cmd+F to open search (only in terminal view)
        // On macOS, Ctrl+F passes through to terminal (forward-char in bash/readline)
        if (appMod && e.key === 'f' && inTerminal) {
            e.preventDefault();
            setShowSearch(true);
            // Always trigger focus - works whether search is opening or already open
            setSearchFocusTrigger(prev => prev + 1);
        }
        // Cmd+K - Open command menu
        // On macOS, Ctrl+K passes through to terminal (kill-line in bash/readline)
        if (appMod && e.key === 'k') {
            e.preventDefault();
            logger.info('Cmd+K pressed - opening command menu');
            setShowCommandMenu(true);
        }
        // Cmd+T - Open new tab (opens command menu to select session/project)
        // On macOS, Ctrl+T passes through to terminal (transpose-chars in bash)
        if (appMod && e.key === 't') {
            e.preventDefault();
            logger.info('Cmd+T pressed - opening command menu for new tab');
            setPaletteNewTabMode(true);
            setShowCommandMenu(true);
        }
        // Cmd+W to close current tab
        // On macOS, Ctrl+W passes through to terminal (delete-word in bash, search in nano)
        if (appMod && e.key === 'w' && inTerminal) {
            e.preventDefault();
            if (activeTabId) {
                logger.info('Cmd+W pressed - closing current tab');
                handleCloseTab(activeTabId);
            } else {
                // Fallback: show confirmation if no tabs
                logger.info('Cmd+W pressed - showing close confirmation');
                setShowCloseConfirm(true);
            }
        }
        // Cmd+1-9 to switch to tab by number
        if (appMod && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const tabIndex = parseInt(e.key, 10) - 1;
            if (tabIndex < openTabs.length) {
                const tab = openTabs[tabIndex];
                logger.info('Tab shortcut pressed', { key: e.key, tabId: tab.id });
                handleSwitchTab(tab.id);
            }
        }
        // Cmd+[ for previous tab
        if (appMod && e.key === '[' && openTabs.length > 1) {
            e.preventDefault();
            const currentIndex = openTabs.findIndex(t => t.id === activeTabId);
            if (currentIndex <= 0) return; // Guard: -1 (not found) or 0 (already first)
            const prevTab = openTabs[currentIndex - 1];
            logger.info('Switching to previous tab');
            handleSwitchTab(prevTab.id);
        }
        // Cmd+] for next tab
        if (appMod && e.key === ']' && openTabs.length > 1) {
            e.preventDefault();
            const currentIndex = openTabs.findIndex(t => t.id === activeTabId);
            if (currentIndex === -1 || currentIndex >= openTabs.length - 1) return; // Guard: not found or already last
            const nextTab = openTabs[currentIndex + 1];
            logger.info('Switching to next tab');
            handleSwitchTab(nextTab.id);
        }
        // Cmd+Escape to go back to session selector (skip when any modal is open)
        const anyModalOpen = showSettings || showSearch || showLabelDialog || showCommandMenu;
        if (appMod && e.key === 'Escape' && inTerminal && !anyModalOpen) {
            e.preventDefault();
            handleBackToSelector();
        }
        // Cmd+R to add/edit custom label (only in terminal view with a session)
        // On macOS, Ctrl+R passes through to terminal (reverse-search in bash)
        if (appMod && e.key === 'r' && inTerminal && selectedSession) {
            e.preventDefault();
            logger.info('Cmd+R pressed - opening label dialog');
            setShowLabelDialog(true);
        }
        // Shift+5 (%) to cycle session status filter (only in selector view)
        // Skip when typing in input fields
        if (!isTypingInInput && e.key === '%' && view === 'selector') {
            e.preventDefault();
            handleCycleStatusFilter();
        }
        // Cmd+Shift+H to toggle collapse/expand all groups (only in selector view)
        if (appMod && e.shiftKey && e.key === 'H' && view === 'selector') {
            e.preventDefault();
            logger.info('Cmd+Shift+H pressed - toggling all groups');
            if (sessionSelectorRef.current?.toggleAllGroups) {
                sessionSelectorRef.current.toggleAllGroups();
            }
        }
        // Cmd+, to open settings (macOS standard, works in both views)
        if (appMod && !e.shiftKey && e.key === ',') {
            e.preventDefault();
            handleOpenSettings();
        }

        // ============================================================
        // PANE MANAGEMENT SHORTCUTS (terminal view only)
        // ============================================================

        // Cmd+D - Split pane right (vertical divider)
        if (appMod && !e.shiftKey && e.key === 'd' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+D pressed - split right');
            handleSplitPane('vertical');
            return;
        }

        // Cmd+Shift+D - Split pane down (horizontal divider)
        if (appMod && e.shiftKey && e.key === 'D' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+Shift+D pressed - split down');
            handleSplitPane('horizontal');
            return;
        }

        // Cmd+Shift+W - Clear session from pane (keeps pane structure)
        if (appMod && e.shiftKey && e.key === 'W' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+Shift+W pressed - clear session from pane');
            handleClearSession();
            return;
        }

        // Cmd+Option+W - Close current pane (removes pane from grid)
        if (appMod && e.altKey && e.key === 'w' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+Option+W pressed - close pane');
            handleClosePane();
            return;
        }

        // Cmd+Option+Arrow keys - Navigate between panes
        if (appMod && e.altKey && view === 'terminal') {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handleNavigatePane('left');
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                handleNavigatePane('right');
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                handleNavigatePane('up');
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                handleNavigatePane('down');
                return;
            }
        }

        // Cmd+Option+[ and Cmd+Option+] - Cycle through panes
        if (appMod && e.altKey && e.key === '[' && view === 'terminal') {
            e.preventDefault();
            handleCyclicNavigatePane('prev');
            return;
        }
        if (appMod && e.altKey && e.key === ']' && view === 'terminal') {
            e.preventDefault();
            handleCyclicNavigatePane('next');
            return;
        }

        // Cmd+Shift+Z - Toggle zoom on current pane
        if (appMod && e.shiftKey && e.key === 'Z' && view === 'terminal') {
            e.preventDefault();
            logger.info('Cmd+Shift+Z pressed - toggle zoom');
            handleToggleZoom();
            return;
        }

        // Escape - Exit zoom mode (if zoomed)
        if (e.key === 'Escape' && view === 'terminal' && activeTab?.zoomedPaneId) {
            e.preventDefault();
            handleExitZoom();
            return;
        }

        // Cmd+Option+= - Balance pane sizes
        if (appMod && e.altKey && e.key === '=' && view === 'terminal') {
            e.preventDefault();
            handleBalancePanes();
            return;
        }

        // Layout presets: Cmd+Option+1/2/3/4
        if (appMod && e.altKey && view === 'terminal') {
            if (e.key === '1') {
                e.preventDefault();
                handleApplyPreset('single');
                return;
            }
            if (e.key === '2') {
                e.preventDefault();
                handleApplyPreset('2-col');
                return;
            }
            if (e.key === '3') {
                e.preventDefault();
                handleApplyPreset('2-row');
                return;
            }
            if (e.key === '4') {
                e.preventDefault();
                handleApplyPreset('2x2');
                return;
            }
        }

        // Cmd++ (Cmd+=) to increase font size (works everywhere)
        if (appMod && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            handleFontSizeChange(1);
        }
        // Cmd+- to decrease font size (works everywhere)
        if (appMod && e.key === '-') {
            e.preventDefault();
            handleFontSizeChange(-1);
        }
        // Cmd+0 to reset font size to default (works everywhere)
        if (appMod && e.key === '0') {
            e.preventDefault();
            handleFontSizeReset();
        }
    }, [view, showSearch, showHelpModal, showSettings, showLabelDialog, showDeleteDialog, showCommandMenu, showRemotePathInput, sessionPickerProject, showToolPicker, showConfigPicker, showHostPicker, showSaveLayoutModal, handleBackToSelector, buildShortcutKey, shortcuts, savedLayoutShortcuts, handleLaunchProject, handleApplySavedLayout, handleCycleStatusFilter, handleOpenHelp, handleNewTerminal, handleOpenSettings, selectedSession, activeTabId, openTabs, handleCloseTab, handleSwitchTab, handleFontSizeChange, handleFontSizeReset, activeTab, handleSplitPane, handleClosePane, handleClearSession, handleNavigatePane, handleCyclicNavigatePane, handleToggleZoom, handleExitZoom, handleBalancePanes, handleApplyPreset, moveMode, handleMoveToPane, handleExitMoveMode]);

    useEffect(() => {
        // Use capture phase to intercept keys before terminal swallows them
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    // Show session selector
    if (view === 'selector') {
        return (
            <div id="App">
                {showQuickLaunch && (
                    <UnifiedTopBar
                        key={quickLaunchKey}
                        onLaunch={handleLaunchProject}
                        onShowToolPicker={handleShowToolPicker}
                        onOpenPalette={() => setShowCommandMenu(true)}
                        onOpenPaletteForPinning={handleOpenPaletteForPinning}
                        onShortcutsChanged={loadShortcuts}
                        openTabs={openTabs}
                        activeTabId={activeTabId}
                        onSwitchTab={handleSwitchTab}
                        onCloseTab={handleCloseTab}
                        onTabLabelUpdated={handleTabLabelUpdated}
                        onSessionDeleted={handleSessionDeleted}
                    />
                )}
                <SessionSelector
                    ref={sessionSelectorRef}
                    onSelect={handleSelectSession}
                    onNewTerminal={handleNewTerminal}
                    statusFilter={statusFilter}
                    onCycleFilter={handleCycleStatusFilter}
                    onOpenPalette={() => setShowCommandMenu(true)}
                    onOpenHelp={handleOpenHelp}
                    onSessionDeleted={handleSessionDeleted}
                />
                {showCommandMenu && (
                    <CommandMenu
                        onClose={handleClosePalette}
                        onSelectSession={handleSelectSession}
                        onAction={handlePaletteAction}
                        onLaunchProject={handleLaunchProject}
                        onShowToolPicker={handleShowToolPicker}
                        onShowSessionPicker={handleShowSessionPicker}
                        onShowHostPicker={handleStartHostSelection}
                        onPinToQuickLaunch={handlePinToQuickLaunch}
                        sessions={sessions}
                        projects={projects}
                        favorites={favorites}
                        pinMode={palettePinMode}
                        newTabMode={paletteNewTabMode}
                        newSessionMode={paletteNewSessionMode}
                    />
                )}
                {showToolPicker && toolPickerProject && (
                    <ToolPicker
                        projectPath={toolPickerProject.path}
                        projectName={toolPickerProject.name}
                        onSelect={handleToolSelected}
                        onSelectWithConfig={handleToolSelectedWithConfig}
                        onCancel={handleCancelToolPicker}
                    />
                )}
                {showConfigPicker && toolPickerProject && configPickerTool && (
                    <ConfigPicker
                        tool={configPickerTool}
                        projectPath={toolPickerProject.path}
                        projectName={toolPickerProject.name}
                        onSelect={handleConfigSelected}
                        onCancel={handleCancelConfigPicker}
                    />
                )}
                {showHostPicker && (
                    <HostPicker
                        onSelect={handleHostSelected}
                        onCancel={handleCancelHostPicker}
                    />
                )}
                {showRemotePathInput && selectedRemoteHost && (
                    <RenameDialog
                        currentName=""
                        title={`Project Path on ${getSSHHostFriendlyName(selectedRemoteHost)}`}
                        placeholder="/home/user/projects/myproject"
                        onSave={handleRemotePathSubmit}
                        onCancel={handleCancelRemotePathInput}
                    />
                )}
                {sessionPickerProject && (
                    <SessionPicker
                        projectPath={sessionPickerProject.path}
                        projectName={sessionPickerProject.name}
                        sessions={sessionPickerProject.sessions}
                        onSelectSession={handleSessionPickerSelect}
                        onCreateNew={handleSessionPickerCreateNew}
                        onCancel={handleCancelSessionPicker}
                    />
                )}
                {showSettings && (
                    <SettingsModal
                        onClose={() => setShowSettings(false)}
                        fontSize={fontSize}
                        onFontSizeChange={(newSize) => setFontSizeState(newSize)}
                        scrollSpeed={scrollSpeed}
                        onScrollSpeedChange={(newSpeed) => setScrollSpeedState(newSpeed)}
                    />
                )}
                {showHelpModal && (
                    <KeyboardHelpModal onClose={() => setShowHelpModal(false)} />
                )}
            </div>
        );
    }

    // Determine what to render in the pane area
    const renderPaneContent = () => {
        if (!activeTab) {
            // No active tab - show empty state
            return (
                <div className="pane-empty">
                    <div className="pane-empty-icon">+</div>
                    <div className="pane-empty-text">No session open</div>
                    <div className="pane-empty-hint">
                        Press <kbd>Cmd</kbd>+<kbd>K</kbd> to open a session
                    </div>
                </div>
            );
        }

        // Determine which layout to render (zoomed or full)
        const layoutToRender = activeTab.zoomedPaneId
            ? findPane(activeTab.layout, activeTab.zoomedPaneId)
            : activeTab.layout;

        if (!layoutToRender) {
            return null;
        }

        // Build pane number map for move mode
        const paneNumberMap = buildPaneNumberMap(activeTab.layout);

        return (
            <PaneLayout
                node={layoutToRender}
                activePaneId={activeTab.activePaneId}
                onPaneFocus={handlePaneFocus}
                onRatioChange={handleRatioChange}
                onPaneSessionSelect={handlePaneSessionSelect}
                terminalRefs={terminalRefs}
                searchRefs={searchRefs}
                fontSize={fontSize}
                scrollSpeed={scrollSpeed}
                moveMode={moveMode}
                paneNumberMap={paneNumberMap}
            />
        );
    };

    // Show terminal
    return (
        <div id="App">
            {showQuickLaunch && (
                <UnifiedTopBar
                    key={quickLaunchKey}
                    onLaunch={handleLaunchProject}
                    onShowToolPicker={handleShowToolPicker}
                    onOpenPalette={() => setShowCommandMenu(true)}
                    onOpenPaletteForPinning={handleOpenPaletteForPinning}
                    onShortcutsChanged={loadShortcuts}
                    openTabs={openTabs}
                    activeTabId={activeTabId}
                    onSwitchTab={handleSwitchTab}
                    onCloseTab={handleCloseTab}
                    onTabLabelUpdated={handleTabLabelUpdated}
                    onSessionDeleted={handleSessionDeleted}
                />
            )}
            <div className="terminal-header">
                <button
                    className="back-button"
                    onClick={() => { hideBackTooltip(); handleBackToSelector(); }}
                    onMouseEnter={(e) => showBackTooltip(e, 'Back to sessions (⌘Esc)')}
                    onMouseLeave={hideBackTooltip}
                >
                    ← Sessions
                </button>
                <BackTooltip />
                {activeTab && (
                    <div className="session-title-header">
                        <span className="tab-pane-count">
                            {countPanes(activeTab.layout) > 1 && `${countPanes(activeTab.layout)} panes`}
                        </span>
                        {selectedSession && (
                            <>
                                {selectedSession.dangerousMode && (
                                    <span className="header-danger-icon" title="Dangerous mode enabled">!</span>
                                )}
                                {selectedSession.title}
                                {selectedSession.customLabel && (
                                    <span className="header-custom-label">{selectedSession.customLabel}</span>
                                )}
                                {gitBranch && (
                                    <span className={`git-branch${isWorktree ? ' is-worktree' : ''}`}>
                                        <span className="git-branch-icon">{isWorktree ? '🌿' : <BranchIcon size={12} />}</span>
                                        {gitBranch}
                                    </span>
                                )}
                                {selectedSession.launchConfigName && (
                                    <span className="header-config-badge">{selectedSession.launchConfigName}</span>
                                )}
                            </>
                        )}
                        {!selectedSession && (
                            <span style={{ color: 'var(--text-muted)' }}>Empty pane - Cmd+K to open session</span>
                        )}
                    </div>
                )}
                {/* Spacer to push delete button to the right */}
                <div style={{ flex: 1 }} />
                {/* Delete session button - only shown when a session is selected */}
                {selectedSession && (
                    <button
                        className="header-delete-button"
                        onClick={() => setShowDeleteDialog(true)}
                        title="Delete this session"
                    >
                        Delete
                    </button>
                )}
            </div>
            <div className="terminal-container">
                {renderPaneContent()}
            </div>
            <ShortcutBar
                view="terminal"
                onBackToSessions={handleBackToSelector}
                onSplitPane={() => handleSplitPane('vertical')}
                onOpenSearch={() => {
                    setShowSearch(true);
                    setSearchFocusTrigger(prev => prev + 1);
                }}
                onOpenPalette={() => setShowCommandMenu(true)}
                onOpenHelp={handleOpenHelp}
                hasPanes={activeTab && countPanes(activeTab.layout) > 1}
            />
            {showSearch && (
                <Search
                    terminal={searchRefs.current?.[activeTab?.activePaneId]?.terminal}
                    searchAddon={searchRefs.current?.[activeTab?.activePaneId]?.searchAddon || searchAddonRef.current}
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
            {/* Zoom mode overlay */}
            {activeTab?.zoomedPaneId && (
                <FocusModeOverlay onExit={handleExitZoom} />
            )}
            {/* Move mode overlay */}
            {moveMode && (
                <MoveModeOverlay onExit={handleExitMoveMode} />
            )}
            {/* Save layout modal */}
            {showSaveLayoutModal && (
                <SaveLayoutModal
                    onSave={handleSaveLayout}
                    onClose={() => setShowSaveLayoutModal(false)}
                />
            )}
            {showCommandMenu && (
                <CommandMenu
                    onClose={handleClosePalette}
                    onSelectSession={(session) => {
                        // If we have an active pane without a session, assign to it
                        if (activeTab && !findPane(activeTab.layout, activeTab.activePaneId)?.session) {
                            handleAssignSessionToPane(session);
                        } else {
                            handleSelectSession(session);
                        }
                    }}
                    onAction={handlePaletteAction}
                    onLayoutAction={handleLayoutAction}
                    showLayoutActions={true}
                    savedLayouts={savedLayouts}
                    onDeleteSavedLayout={handleDeleteSavedLayout}
                    onLaunchProject={(path, name, tool, config, label) => {
                        // If we have an active empty pane, launch into it
                        // For now, use the default behavior (creates new tab)
                        handleLaunchProject(path, name, tool, config, label);
                    }}
                    onShowToolPicker={handleShowToolPicker}
                    onShowSessionPicker={handleShowSessionPicker}
                    onShowHostPicker={handleStartHostSelection}
                    onPinToQuickLaunch={handlePinToQuickLaunch}
                    activeSession={selectedSession}
                    onUpdateLabel={(newLabel) => {
                        if (!selectedSession) return;
                        UpdateSessionCustomLabel(selectedSession.id, newLabel)
                            .then(() => {
                                setSelectedSession(prev => prev ? { ...prev, customLabel: newLabel || '' } : prev);
                                handleTabLabelUpdated(selectedSession.id, newLabel);
                            })
                            .catch(err => logger.error('Failed to update label:', err));
                    }}
                    sessions={sessions}
                    projects={projects}
                    favorites={favorites}
                    pinMode={palettePinMode}
                    newTabMode={paletteNewTabMode}
                    newSessionMode={paletteNewSessionMode}
                />
            )}
            {sessionPickerProject && (
                <SessionPicker
                    projectPath={sessionPickerProject.path}
                    projectName={sessionPickerProject.name}
                    sessions={sessionPickerProject.sessions}
                    onSelectSession={handleSessionPickerSelect}
                    onCreateNew={handleSessionPickerCreateNew}
                    onCancel={handleCancelSessionPicker}
                />
            )}
            {showToolPicker && toolPickerProject && (
                <ToolPicker
                    projectPath={toolPickerProject.path}
                    projectName={toolPickerProject.name}
                    onSelect={handleToolSelected}
                    onSelectWithConfig={handleToolSelectedWithConfig}
                    onCancel={handleCancelToolPicker}
                />
            )}
            {showConfigPicker && toolPickerProject && configPickerTool && (
                <ConfigPicker
                    tool={configPickerTool}
                    projectPath={toolPickerProject.path}
                    projectName={toolPickerProject.name}
                    onSelect={handleConfigSelected}
                    onCancel={handleCancelConfigPicker}
                />
            )}
            {showHostPicker && (
                <HostPicker
                    onSelect={handleHostSelected}
                    onCancel={handleCancelHostPicker}
                />
            )}
            {showRemotePathInput && selectedRemoteHost && (
                <RenameDialog
                    currentName=""
                    title={`Project Path on ${getSSHHostFriendlyName(selectedRemoteHost)}`}
                    placeholder="/home/user/projects/myproject"
                    onSave={handleRemotePathSubmit}
                    onCancel={handleCancelRemotePathInput}
                />
            )}
            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    fontSize={fontSize}
                    onFontSizeChange={(newSize) => setFontSizeState(newSize)}
                    scrollSpeed={scrollSpeed}
                    onScrollSpeedChange={(newSpeed) => setScrollSpeedState(newSpeed)}
                />
            )}
            {showHelpModal && (
                <KeyboardHelpModal onClose={() => setShowHelpModal(false)} />
            )}
            {showLabelDialog && selectedSession && (
                <RenameDialog
                    currentName={selectedSession.customLabel || ''}
                    title={selectedSession.customLabel ? 'Edit Custom Label' : 'Add Custom Label'}
                    placeholder="Enter label..."
                    onSave={handleSaveSessionCustomLabel}
                    onCancel={() => setShowLabelDialog(false)}
                />
            )}
            {showDeleteDialog && selectedSession && (
                <DeleteSessionDialog
                    session={selectedSession}
                    onConfirm={handleDeleteCurrentSession}
                    onCancel={() => setShowDeleteDialog(false)}
                />
            )}
            <Toast />
        </div>
    );
}

export default App;
