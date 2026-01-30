import { useState, useEffect, useCallback, useRef } from 'react';
import './UnifiedTopBar.css';
import { GetQuickLaunchFavorites, RemoveQuickLaunchFavorite, UpdateQuickLaunchShortcut, UpdateQuickLaunchFavoriteName, UpdateSessionCustomLabel, DeleteSession } from '../wailsjs/go/main/App';
import ShortcutEditor from './ShortcutEditor';
import RenameDialog from './RenameDialog';
import DeleteSessionDialog from './DeleteSessionDialog';
import SessionTab from './SessionTab';
import { createLogger } from './logger';
import { formatShortcut } from './utils/shortcuts';
import { getToolColor } from './utils/tools';
import { shouldRenderTabContextMenu, hasTabCustomLabel, getTabSession } from './utils/tabContextMenu';
import { groupTabsBySection, canReorderBetween } from './utils/tabSections';
import ToolIcon from './ToolIcon';
import { useTooltip } from './Tooltip';

const logger = createLogger('UnifiedTopBar');

export default function UnifiedTopBar({
    onLaunch,
    onShowToolPicker,
    onOpenPalette,
    onOpenPaletteForPinning,
    onShortcutsChanged,
    openTabs = [],
    activeTabId = null,
    onSwitchTab,
    onCloseTab,
    onReorderTab,
    onTabLabelUpdated,
    onSessionDeleted,
    showActivityRibbon = true,
    showContextMeter = true,
}) {
    const [favorites, setFavorites] = useState([]);
    const [contextMenu, setContextMenu] = useState(null);
    const [editingShortcut, setEditingShortcut] = useState(null);
    const [editingName, setEditingName] = useState(null);
    const [tabContextMenu, setTabContextMenu] = useState(null); // { x, y, tab }
    const [labelingTab, setLabelingTab] = useState(null);
    const [deletingTab, setDeletingTab] = useState(null); // Tab being deleted (for confirmation dialog)
    const [dragState, setDragState] = useState(null); // { draggedTabId, overTabId, dropSide }
    // Use a ref to track drag state for the drop handler to avoid stale closure issues
    const dragStateRef = useRef(null);
    const { show: showTooltip, hide: hideTooltip, Tooltip } = useTooltip();

    // Load favorites
    const loadFavorites = useCallback(async () => {
        try {
            const result = await GetQuickLaunchFavorites();
            logger.info('Loaded favorites', { count: result?.length || 0 });
            setFavorites(result || []);
        } catch (err) {
            logger.error('Failed to load favorites:', err);
        }
    }, []);

    useEffect(() => {
        loadFavorites();
    }, [loadFavorites]);

    const handleFavoriteClick = (fav, e) => {
        if (e.metaKey || e.ctrlKey) {
            logger.info('Cmd+Click on favorite, showing tool picker', { name: fav.name });
            onShowToolPicker?.(fav.path, fav.name);
        } else {
            logger.info('Launching favorite', { name: fav.name, tool: fav.tool });
            onLaunch?.(fav.path, fav.name, fav.tool);
        }
    };

    const handleContextMenu = (e, fav) => {
        e.preventDefault();
        logger.debug('Context menu on favorite', { name: fav.name });
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            favorite: fav,
        });
    };

    const handleRemoveFavorite = async () => {
        if (!contextMenu?.favorite) return;

        try {
            logger.info('Removing favorite', { path: contextMenu.favorite.path });
            await RemoveQuickLaunchFavorite(contextMenu.favorite.path);
            loadFavorites();
            onShortcutsChanged?.();
        } catch (err) {
            logger.error('Failed to remove favorite:', err);
        }
        setContextMenu(null);
    };

    const handleEditShortcut = () => {
        if (!contextMenu?.favorite) return;
        const fav = contextMenu.favorite;
        logger.info('Opening shortcut editor', { name: fav.name });
        setEditingShortcut({
            path: fav.path,
            name: fav.name,
            shortcut: fav.shortcut || '',
        });
        setContextMenu(null);
    };

    const handleRename = () => {
        if (!contextMenu?.favorite) return;
        const fav = contextMenu.favorite;
        logger.info('Opening rename dialog', { name: fav.name });
        setEditingName({
            path: fav.path,
            name: fav.name,
        });
        setContextMenu(null);
    };

    const handleSaveName = async (newName) => {
        if (!editingName || !newName.trim()) return;

        try {
            logger.info('Saving name', { path: editingName.path, name: newName });
            await UpdateQuickLaunchFavoriteName(editingName.path, newName.trim());
            loadFavorites();
        } catch (err) {
            logger.error('Failed to save name:', err);
        }
        setEditingName(null);
    };

    const handleSaveShortcut = async (newShortcut) => {
        if (!editingShortcut) return;

        try {
            logger.info('Saving shortcut', { path: editingShortcut.path, shortcut: newShortcut });
            await UpdateQuickLaunchShortcut(editingShortcut.path, newShortcut);
            loadFavorites();
            onShortcutsChanged?.();
        } catch (err) {
            logger.error('Failed to save shortcut:', err);
        }
        setEditingShortcut(null);
    };

    // Tooltip content for favorites
    const getFavoriteTooltipContent = useCallback((fav) => {
        return `${fav.name}\n${fav.path}${fav.shortcut ? `\n${formatShortcut(fav.shortcut)}` : ''}`;
    }, []);

    // Build existing shortcuts map for conflict detection
    const existingShortcuts = favorites.reduce((acc, fav) => {
        if (fav.shortcut) {
            acc[fav.shortcut] = fav.path;
        }
        return acc;
    }, {});

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // Tab context menu handlers
    const handleTabContextMenu = useCallback((e, tab) => {
        e.preventDefault();
        hideTooltip();
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 100);
        setTabContextMenu({ x, y, tab });
    }, [hideTooltip]);

    const closeTabContextMenu = useCallback(() => {
        setTabContextMenu(null);
    }, []);

    const handleTabAddLabel = useCallback(() => {
        if (!tabContextMenu?.tab) return;
        setLabelingTab(tabContextMenu.tab);
        setTabContextMenu(null);
    }, [tabContextMenu]);

    const handleTabRemoveLabel = useCallback(async () => {
        if (!tabContextMenu?.tab) return;
        const session = getTabSession(tabContextMenu.tab);
        if (!session) return;
        try {
            await UpdateSessionCustomLabel(session.id, '');
            onTabLabelUpdated?.(session.id, '');
        } catch (err) {
            logger.error('Failed to remove tab label:', err);
        }
        setTabContextMenu(null);
    }, [tabContextMenu, onTabLabelUpdated]);

    const handleTabSaveLabel = useCallback(async (newLabel) => {
        if (!labelingTab || !newLabel.trim()) return;
        const session = getTabSession(labelingTab);
        if (!session) return;
        try {
            await UpdateSessionCustomLabel(session.id, newLabel.trim());
            onTabLabelUpdated?.(session.id, newLabel.trim());
        } catch (err) {
            logger.error('Failed to save tab label:', err);
        }
        setLabelingTab(null);
    }, [labelingTab, onTabLabelUpdated]);

    // Delete session handlers
    const handleTabDeleteSession = useCallback(() => {
        if (!tabContextMenu?.tab) return;
        const session = getTabSession(tabContextMenu.tab);
        if (!session) {
            logger.warn('Cannot delete: no session in tab');
            setTabContextMenu(null);
            return;
        }
        logger.info('Opening delete confirmation', { sessionId: session.id, title: session.title });
        setDeletingTab(tabContextMenu.tab);
        setTabContextMenu(null);
    }, [tabContextMenu]);

    const handleConfirmDeleteSession = useCallback(async () => {
        if (!deletingTab) return;
        const session = getTabSession(deletingTab);
        if (!session) {
            setDeletingTab(null);
            return;
        }
        try {
            logger.info('Deleting session', { sessionId: session.id, title: session.title });
            await DeleteSession(session.id);
            logger.info('Session deleted successfully');
            // Notify parent to handle cleanup (close tabs, update state)
            onSessionDeleted?.(session.id);
            setDeletingTab(null);
        } catch (err) {
            logger.error('Failed to delete session:', err);
            alert('Failed to delete session. Please try again.');
        }
    }, [deletingTab, onSessionDeleted]);

    const handleCancelDeleteSession = useCallback(() => {
        setDeletingTab(null);
    }, []);

    // Close context menu on click outside
    useEffect(() => {
        if (contextMenu) {
            document.addEventListener('click', closeContextMenu);
            return () => document.removeEventListener('click', closeContextMenu);
        }
    }, [contextMenu, closeContextMenu]);

    // Close tab context menu on click outside or Escape
    useEffect(() => {
        if (tabContextMenu) {
            const handleClick = () => setTabContextMenu(null);
            const handleEscape = (e) => { if (e.key === 'Escape') setTabContextMenu(null); };
            document.addEventListener('click', handleClick);
            document.addEventListener('keydown', handleEscape);
            return () => {
                document.removeEventListener('click', handleClick);
                document.removeEventListener('keydown', handleEscape);
            };
        }
    }, [tabContextMenu]);

    // Tab drag-and-drop handlers
    // Helper to update both state and ref
    const updateDragState = useCallback((newState) => {
        dragStateRef.current = newState;
        setDragState(newState);
    }, []);

    // Shared reorder logic - prevents duplication and double-execution
    // Returns true if reorder was performed
    const executeReorder = useCallback((dragState, source) => {
        if (!dragState?.draggedTabId || !dragState.overTabId || !onReorderTab) {
            return false;
        }
        // Guard: prevent double-execution when both drop and dragEnd fire
        if (dragState.reorderPerformed) {
            return false;
        }
        const overIndex = openTabs.findIndex(t => t.id === dragState.overTabId);
        if (overIndex === -1) {
            return false;
        }
        const targetIndex = dragState.dropSide === 'right' ? overIndex + 1 : overIndex;
        const fromIndex = openTabs.findIndex(t => t.id === dragState.draggedTabId);
        const adjustedIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;

        onReorderTab(dragState.draggedTabId, adjustedIndex);
        // Mark as performed to prevent double-execution
        dragStateRef.current = { ...dragState, reorderPerformed: true };
        return true;
    }, [openTabs, onReorderTab]);

    const handleTabDragStart = useCallback((e, tab) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
        const newState = { draggedTabId: tab.id, overTabId: null, dropSide: null, reorderPerformed: false };
        updateDragState(newState);
    }, [updateDragState]);

    const handleTabDragEnd = useCallback((e) => {
        const currentDragState = dragStateRef.current;

        // In WKWebView, the 'drop' event doesn't fire reliably.
        // Perform the reorder in dragEnd if we have valid target info and it hasn't been done yet.
        executeReorder(currentDragState, 'dragEnd');

        updateDragState(null);
    }, [executeReorder, updateDragState]);

    // Track last dragOver state to avoid redundant updates
    const lastDragOverStateRef = useRef({ tabId: null, side: null });

    const handleTabDragOver = useCallback((e, tab) => {
        e.preventDefault();
        const currentDragState = dragStateRef.current;
        if (!currentDragState || tab.id === currentDragState.draggedTabId) {
            if (currentDragState?.overTabId) {
                updateDragState({ ...currentDragState, overTabId: null, dropSide: null });
            }
            return;
        }

        // Check if cross-section drop (block it)
        const draggedTab = openTabs.find(t => t.id === currentDragState.draggedTabId);
        if (!canReorderBetween(draggedTab, tab)) {
            e.dataTransfer.dropEffect = 'none';
            if (currentDragState?.overTabId) {
                updateDragState({ ...currentDragState, overTabId: null, dropSide: null });
            }
            return;
        }

        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const side = e.clientX < midX ? 'left' : 'right';
        if (currentDragState.overTabId !== tab.id || currentDragState.dropSide !== side) {
            // Only update when something changes
            if (lastDragOverStateRef.current.tabId !== tab.id || lastDragOverStateRef.current.side !== side) {
                lastDragOverStateRef.current = { tabId: tab.id, side };
            }
            updateDragState({ ...currentDragState, overTabId: tab.id, dropSide: side });
        }
    }, [updateDragState, openTabs]);

    const handleTabDrop = useCallback((e) => {
        e.preventDefault();
        const currentDragState = dragStateRef.current;

        executeReorder(currentDragState, 'drop');
        updateDragState(null);
    }, [executeReorder, updateDragState]);

    const hasFavorites = favorites.length > 0;

    // Group tabs by local/remote sections
    const { localTabs, remoteTabs } = groupTabsBySection(openTabs);
    const hasRemoteTabs = remoteTabs.length > 0;
    const hasLocalTabs = localTabs.length > 0;

    // Helper to render a SessionTab with all the standard props
    const renderTab = (tab, index) => (
        <SessionTab
            key={tab.id}
            tab={tab}
            index={index}
            isActive={tab.id === activeTabId}
            onSwitch={() => onSwitchTab?.(tab.id)}
            onClose={() => onCloseTab?.(tab.id)}
            onContextMenu={(e) => handleTabContextMenu(e, tab)}
            isDragging={dragState?.draggedTabId === tab.id}
            dragOverSide={dragState?.overTabId === tab.id ? dragState.dropSide : null}
            onDragStart={(e) => handleTabDragStart(e, tab)}
            onDragEnd={handleTabDragEnd}
            onDragOver={(e) => handleTabDragOver(e, tab)}
            onDrop={handleTabDrop}
            showActivityRibbon={showActivityRibbon}
            showContextMeter={showContextMeter}
        />
    );

    return (
        <div className="unified-top-bar">
            {/* Quick Launch Section - 2-row grid with vertical-first stacking */}
            {hasFavorites && (
                <div className={`quick-launch-section${favorites.length === 1 ? ' single-favorite' : ''}`}>
                    {favorites.map((fav) => (
                        <button
                            key={fav.path}
                            className="quick-launch-item"
                            onClick={(e) => handleFavoriteClick(fav, e)}
                            onContextMenu={(e) => handleContextMenu(e, fav)}
                            onMouseEnter={(e) => showTooltip(e, getFavoriteTooltipContent(fav))}
                            onMouseLeave={hideTooltip}
                        >
                            <span
                                className="quick-launch-icon"
                                style={{ backgroundColor: getToolColor(fav.tool) }}
                            >
                                <ToolIcon tool={fav.tool} size={12} />
                            </span>
                            <span className="quick-launch-name">{fav.name}</span>
                            {fav.shortcut && (
                                <span className="quick-launch-shortcut">
                                    {formatShortcut(fav.shortcut)}
                                </span>
                            )}
                        </button>
                    ))}
                    <button
                        className="quick-launch-add"
                        onClick={onOpenPaletteForPinning}
                        title="Add favorite"
                    >
                        +
                    </button>
                </div>
            )}

            {/* Divider - only shown when favorites exist */}
            {hasFavorites && <div className="top-bar-divider" />}

            {/* Session Tabs Section - contains local and remote tab sections */}
            <div
                className={`session-tabs-section${!hasFavorites ? ' no-favorites' : ''}`}
                onDrop={handleTabDrop}
                onDragOver={(e) => e.preventDefault()}
            >
                {/* Local Tabs Section */}
                {hasLocalTabs && (
                    <div className={`tab-section local-section${hasRemoteTabs ? ' with-underline' : ''}`}>
                        {localTabs.map((tab, index) => renderTab(tab, index))}
                        {hasRemoteTabs && (
                            <div
                                className="section-underline local"
                                onMouseEnter={(e) => showTooltip(e, 'Local Sessions')}
                                onMouseLeave={hideTooltip}
                            />
                        )}
                    </div>
                )}

                {/* Section Gap - only when both sections exist */}
                {hasLocalTabs && hasRemoteTabs && (
                    <div className="section-gap" />
                )}

                {/* Remote Tabs Section */}
                {hasRemoteTabs && (
                    <div className="tab-section remote-section with-underline">
                        {remoteTabs.map((tab, index) => renderTab(tab, localTabs.length + index))}
                        <div
                            className="section-underline remote"
                            onMouseEnter={(e) => showTooltip(e, 'Remote Sessions')}
                            onMouseLeave={hideTooltip}
                        />
                    </div>
                )}
            </div>

            {/* Palette Button */}
            <button
                className="top-bar-palette-btn"
                onClick={onOpenPalette}
                title="Command Menu (Cmd+K)"
            >
                ⌘K
            </button>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="quick-launch-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button onClick={handleRename}>
                        Rename
                    </button>
                    <button onClick={handleEditShortcut}>
                        {contextMenu.favorite?.shortcut ? 'Edit Shortcut' : 'Set Shortcut'}
                    </button>
                    <button onClick={handleRemoveFavorite} className="danger">
                        Remove from Quick Launch
                    </button>
                </div>
            )}

            {/* Shortcut Editor Modal */}
            {editingShortcut && (
                <ShortcutEditor
                    projectName={editingShortcut.name}
                    projectPath={editingShortcut.path}
                    currentShortcut={editingShortcut.shortcut}
                    existingShortcuts={existingShortcuts}
                    onSave={handleSaveShortcut}
                    onCancel={() => setEditingShortcut(null)}
                />
            )}

            {/* Rename Dialog */}
            {editingName && (
                <RenameDialog
                    currentName={editingName.name}
                    onSave={handleSaveName}
                    onCancel={() => setEditingName(null)}
                />
            )}

            {/* Tab Context Menu */}
            {shouldRenderTabContextMenu(tabContextMenu) && (
                <div
                    className="session-tab-context-menu"
                    style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button onClick={handleTabAddLabel}>
                        {hasTabCustomLabel(tabContextMenu.tab) ? 'Edit Custom Label' : 'Add Custom Label'}
                    </button>
                    {hasTabCustomLabel(tabContextMenu.tab) && (
                        <button onClick={handleTabRemoveLabel}>
                            Remove Custom Label
                        </button>
                    )}
                    {getTabSession(tabContextMenu.tab) && (
                        <>
                            <div className="context-menu-divider" />
                            <button onClick={handleTabDeleteSession} className="danger">
                                Delete Session
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Tab Label Dialog */}
            {labelingTab && getTabSession(labelingTab) && (
                <RenameDialog
                    currentName={getTabSession(labelingTab)?.customLabel || ''}
                    title={getTabSession(labelingTab)?.customLabel ? 'Edit Custom Label' : 'Add Custom Label'}
                    placeholder="Enter label..."
                    onSave={handleTabSaveLabel}
                    onCancel={() => setLabelingTab(null)}
                />
            )}

            {/* Delete Session Confirmation Dialog */}
            {deletingTab && getTabSession(deletingTab) && (
                <DeleteSessionDialog
                    session={getTabSession(deletingTab)}
                    onConfirm={handleConfirmDeleteSession}
                    onCancel={handleCancelDeleteSession}
                />
            )}

            <Tooltip />
        </div>
    );
}
