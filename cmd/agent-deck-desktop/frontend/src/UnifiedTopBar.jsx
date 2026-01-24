import { useState, useEffect, useCallback } from 'react';
import './UnifiedTopBar.css';
import { GetQuickLaunchFavorites, RemoveQuickLaunchFavorite, UpdateQuickLaunchShortcut, UpdateQuickLaunchFavoriteName } from '../wailsjs/go/main/App';
import ShortcutEditor from './ShortcutEditor';
import RenameDialog from './RenameDialog';
import SessionTab from './SessionTab';
import { createLogger } from './logger';
import { formatShortcut } from './utils/shortcuts';
import { getToolColor } from './utils/tools';
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
}) {
    const [favorites, setFavorites] = useState([]);
    const [contextMenu, setContextMenu] = useState(null);
    const [editingShortcut, setEditingShortcut] = useState(null);
    const [editingName, setEditingName] = useState(null);
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

    // Close context menu on click outside
    useEffect(() => {
        if (contextMenu) {
            document.addEventListener('click', closeContextMenu);
            return () => document.removeEventListener('click', closeContextMenu);
        }
    }, [contextMenu, closeContextMenu]);

    const hasFavorites = favorites.length > 0;

    return (
        <div className="unified-top-bar">
            {/* Quick Launch Section */}
            {hasFavorites && (
                <div className="quick-launch-section">
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

            {/* Session Tabs Section */}
            <div className={`session-tabs-section${!hasFavorites ? ' no-favorites' : ''}`}>
                {openTabs.map((tab, index) => (
                    <SessionTab
                        key={tab.id}
                        tab={tab}
                        index={index}
                        isActive={tab.id === activeTabId}
                        onSwitch={() => onSwitchTab?.(tab.id)}
                        onClose={() => onCloseTab?.(tab.id)}
                    />
                ))}
            </div>

            {/* Palette Button */}
            <button
                className="top-bar-palette-btn"
                onClick={onOpenPalette}
                title="Command Palette (Cmd+K)"
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

            <Tooltip />
        </div>
    );
}
