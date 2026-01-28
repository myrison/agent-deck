import { useCallback, useMemo, useRef } from 'react';
import './SessionTab.css';
import ToolIcon, { BranchIcon } from './ToolIcon';
import ActivityRibbon from './ActivityRibbon';
import { useTooltip } from './Tooltip';
import { createLogger } from './logger';
import { getPaneList, findPane, countPanes } from './layoutUtils';

const logger = createLogger('SessionTab');

// Status color mapping
function getStatusColor(status) {
    switch (status) {
        case 'running': return '#4ecdc4';
        case 'waiting': return '#ffe66d';
        case 'idle': return '#6c757d';
        case 'error': return '#ff6b6b';
        default: return '#6c757d';
    }
}

// Generate a consistent accent color from a string (for visual distinction)
// Uses golden ratio hashing for even color distribution
function getSessionAccentColor(str) {
    if (!str) return null;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Use golden ratio for good hue distribution
    const hue = Math.abs(hash * 137.508) % 360;
    return `hsl(${hue}, 55%, 55%)`;
}

// Get relative project path (simplified)
function getRelativePath(fullPath) {
    if (!fullPath) return '';
    const parts = fullPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
        return `.../${parts.slice(-2).join('/')}`;
    }
    return fullPath;
}

export default function SessionTab({ tab, index, isActive, onSwitch, onClose, onContextMenu, isDragging, dragOverSide, onDragStart, onDragEnd, onDragOver, onDrop, showActivityRibbon }) {
    const { show: showTooltip, hide: hideTooltip, Tooltip } = useTooltip();
    const tabButtonRef = useRef(null);

    // Extract session info from the new layout-based tab structure
    // Tab structure: { id, name, layout, activePaneId, openedAt, zoomedPaneId }
    const { primarySession, paneCount, sessions } = useMemo(() => {
        if (!tab.layout) {
            // Fallback for old tab structure (shouldn't happen but be safe)
            return { primarySession: tab.session, paneCount: 1, sessions: [tab.session].filter(Boolean) };
        }

        const panes = getPaneList(tab.layout);
        const panesWithSessions = panes.filter(p => p.session);
        const count = panes.length;

        // Get the active pane's session, or the first session if no active
        const activePane = findPane(tab.layout, tab.activePaneId);
        const primary = activePane?.session || panesWithSessions[0]?.session || null;

        return {
            primarySession: primary,
            paneCount: count,
            sessions: panesWithSessions.map(p => p.session),
        };
    }, [tab]);

    const session = primarySession;

    // Build rich tooltip content
    const getTooltipContent = useCallback(() => {
        const shortcutNum = index < 9 ? index + 1 : null;

        // Handle tabs with no sessions (empty panes only)
        if (!session) {
            return (
                <div className="session-tooltip">
                    <div className="tooltip-row tooltip-title">
                        <span className="tooltip-icon">+</span>
                        <span>Empty tab ({paneCount} pane{paneCount > 1 ? 's' : ''})</span>
                    </div>
                    {shortcutNum && (
                        <div className="tooltip-row tooltip-shortcut-hint">
                            <span className="tooltip-icon">⌘</span>
                            <span>Press ⌘{shortcutNum} to switch</span>
                        </div>
                    )}
                </div>
            );
        }

        const relativePath = getRelativePath(session.projectPath);
        const hostDisplayName = session.isRemote
            ? (session.remoteHostDisplayName || session.remoteHost)
            : null;

        return (
            <div className="session-tooltip">
                {/* Title and custom label */}
                <div className="tooltip-row tooltip-title">
                    <span className="tooltip-icon">
                        <ToolIcon tool={session.tool} size={12} />
                    </span>
                    <span>
                        {session.title}
                        {session.customLabel && (
                            <span className="tab-tooltip-label"> ({session.customLabel})</span>
                        )}
                    </span>
                </div>

                {/* Host indicator (remote sessions only) */}
                {hostDisplayName && (
                    <div className="tooltip-row tooltip-host">
                        <span className="tooltip-icon">🌐</span>
                        <span>{hostDisplayName}</span>
                    </div>
                )}

                {/* Multi-pane indicator */}
                {paneCount > 1 && (
                    <div className="tooltip-row tooltip-panes">
                        <span className="tooltip-icon">#</span>
                        <span>{paneCount} panes ({sessions.length} with sessions)</span>
                    </div>
                )}

                {/* Project path */}
                {relativePath && (
                    <div className="tooltip-row tooltip-path">
                        <span className="tooltip-icon">📁</span>
                        <span>{relativePath}</span>
                    </div>
                )}

                {/* Status */}
                <div className="tooltip-row tooltip-status">
                    <span
                        className="tooltip-icon tab-status-dot"
                        style={{ color: getStatusColor(session.status) }}
                    >●</span>
                    <span>{session.status || 'unknown'}</span>
                </div>

                {/* Git branch */}
                {session.gitBranch && (
                    <div className="tooltip-row tooltip-git">
                        <span className="tooltip-icon">{session.isWorktree ? '🌿' : <BranchIcon size={12} />}</span>
                        <span>
                            {session.gitBranch}
                            {session.isWorktree && ' (worktree)'}
                        </span>
                    </div>
                )}

                {/* Keyboard shortcut hint */}
                {shortcutNum && (
                    <div className="tooltip-row tooltip-shortcut-hint">
                        <span className="tooltip-icon">⌘</span>
                        <span>Press ⌘{shortcutNum} to switch</span>
                    </div>
                )}
            </div>
        );
    }, [session, sessions, paneCount, index]);

    const handleClose = (e) => {
        e.stopPropagation();
        logger.info('Closing tab', { tabId: tab.id, sessionTitle: session?.title || 'empty' });
        onClose?.();
    };

    // Custom drag start handler to set drag image to just the button (not the wrapper with ribbon)
    const handleDragStart = useCallback((e) => {
        // Set the drag image to just the tab button, not the entire wrapper
        if (tabButtonRef.current) {
            const rect = tabButtonRef.current.getBoundingClientRect();
            // Calculate offset from mouse position to button's top-left
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            e.dataTransfer.setDragImage(tabButtonRef.current, offsetX, offsetY);
        }
        // Call the parent's onDragStart
        onDragStart?.(e);
    }, [onDragStart]);

    // Calculate tab title and whether we have a custom label
    const { tabTitle, hasCustomLabel, toolTitle } = useMemo(() => {
        if (!session) {
            return {
                tabTitle: paneCount > 1 ? `${paneCount} panes` : 'Empty',
                hasCustomLabel: false,
                toolTitle: null
            };
        }
        const hasLabel = Boolean(session.customLabel);
        const displayName = session.customLabel || session.title;
        const suffix = sessions.length > 1 ? ` +${sessions.length - 1}` : '';
        return {
            tabTitle: displayName + suffix,
            hasCustomLabel: hasLabel,
            toolTitle: hasLabel ? session.title : null
        };
    }, [session, sessions.length, paneCount]);

    // Get accent color for visual distinction (based on custom label or title)
    const sessionAccentColor = useMemo(() => {
        if (!session) return null;
        // Use custom label if set, otherwise use title for distinction
        const distinctionKey = session.customLabel || session.title;
        return getSessionAccentColor(distinctionKey);
    }, [session]);

    return (
        <div
            className={`session-tab-wrapper${showActivityRibbon && sessions.length > 0 ? ' has-ribbon' : ''}${isDragging ? ' dragging' : ''}${dragOverSide === 'left' ? ' drag-over-left' : ''}${dragOverSide === 'right' ? ' drag-over-right' : ''}`}
            draggable="true"
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            {/* Activity ribbon positioned ABOVE the tab */}
            {showActivityRibbon && sessions.length > 0 && (
                <ActivityRibbon sessions={sessions} />
            )}
            <button
                ref={tabButtonRef}
                className={`session-tab${isActive ? ' active' : ''}${paneCount > 1 ? ' multi-pane' : ''}${hasCustomLabel ? ' has-label' : ''}${session?.isRemote ? ' is-remote' : ''}`}
                onClick={onSwitch}
                onContextMenu={onContextMenu}
                onMouseEnter={(e) => showTooltip(e, getTooltipContent())}
                onMouseLeave={hideTooltip}
                draggable="false"
                style={sessionAccentColor ? { '--session-accent': sessionAccentColor } : undefined}
            >
                {/* Accent indicator for visual distinction */}
                {sessionAccentColor && (
                    <span className="tab-accent" style={{ backgroundColor: sessionAccentColor }} />
                )}
                <span
                    className="tab-status"
                    style={{ backgroundColor: session ? getStatusColor(session.status) : '#6c757d' }}
                >
                    {session ? (
                        <ToolIcon tool={session.tool} size={10} status={session.status} />
                    ) : (
                        <span style={{ fontSize: '10px' }}>+</span>
                    )}
                </span>
                <span className="tab-title-container">
                    <span className={`tab-title${hasCustomLabel ? ' custom-label' : ''}`}>
                        {tabTitle}
                    </span>
                    {hasCustomLabel && toolTitle && (
                        <span className="tab-tool-subtitle">{toolTitle}</span>
                    )}
                </span>
                {paneCount > 1 && (
                    <span className="tab-pane-badge">{paneCount}</span>
                )}
                <button
                    className="tab-close"
                    onClick={handleClose}
                    title="Close tab"
                >
                    ×
                </button>
            </button>
            <Tooltip />
        </div>
    );
}
