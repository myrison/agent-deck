/**
 * Utility functions for tab context menu
 *
 * These functions handle null safety for tab context menu operations,
 * preventing crashes when tab or session data is undefined.
 *
 * Tab structure (layout-based):
 *   { id, name, layout: LayoutNode, activePaneId, openedAt, zoomedPaneId }
 *
 * Layout is a tree of panes/splits. Each pane has:
 *   { type: 'pane', id, sessionId, session: SessionObject | null }
 */

/**
 * Get all panes from a layout node (recursive)
 * @param {Object} node - Layout node
 * @returns {Array} - Array of pane nodes
 */
function getPaneList(node) {
    if (!node) return [];
    if (node.type === 'pane') {
        return [node];
    }
    if (node.children) {
        return [...getPaneList(node.children[0]), ...getPaneList(node.children[1])];
    }
    return [];
}

/**
 * Find a specific pane by ID
 * @param {Object} node - Layout node
 * @param {string} paneId - Pane ID to find
 * @returns {Object|null} - The pane node or null
 */
function findPane(node, paneId) {
    if (!node) return null;
    if (node.type === 'pane') {
        return node.id === paneId ? node : null;
    }
    if (node.children) {
        return findPane(node.children[0], paneId) || findPane(node.children[1], paneId);
    }
    return null;
}

/**
 * Extract the primary session from a tab.
 * For layout-based tabs, gets the active pane's session or first available session.
 * Falls back to tab.session for legacy tab structure.
 *
 * @param {Object|null} tab - The tab object
 * @returns {Object|null} - The session object or null
 */
export function getTabSession(tab) {
    if (!tab) return null;

    // Layout-based tab structure
    if (tab.layout) {
        // Try to get the active pane's session first
        if (tab.activePaneId) {
            const activePane = findPane(tab.layout, tab.activePaneId);
            if (activePane?.session) {
                return activePane.session;
            }
        }
        // Fall back to first pane with a session
        const panes = getPaneList(tab.layout);
        const paneWithSession = panes.find(p => p.session);
        return paneWithSession?.session || null;
    }

    // Legacy tab structure (tab.session directly)
    return tab.session || null;
}

/**
 * Check if a tab context menu should be rendered.
 * Returns true only if the menu state exists and has valid tab with a session.
 *
 * @param {Object|null} tabContextMenu - The context menu state { x, y, tab }
 * @returns {boolean} - Whether the context menu should be rendered
 */
export function shouldRenderTabContextMenu(tabContextMenu) {
    if (!tabContextMenu || !tabContextMenu.tab) return false;
    const session = getTabSession(tabContextMenu.tab);
    return Boolean(session);
}

/**
 * Get the custom label from a tab, with null safety.
 *
 * @param {Object|null} tab - The tab object
 * @returns {string|null} - The custom label or null if not available
 */
export function getTabCustomLabel(tab) {
    const session = getTabSession(tab);
    return session?.customLabel || null;
}

/**
 * Check if a tab has a custom label set.
 *
 * @param {Object|null} tab - The tab object
 * @returns {boolean} - Whether the tab has a non-empty custom label
 */
export function hasTabCustomLabel(tab) {
    const label = getTabCustomLabel(tab);
    return Boolean(label && label.trim().length > 0);
}

/**
 * Get the context menu button text based on whether a label exists.
 *
 * @param {Object|null} tab - The tab object
 * @returns {string} - Either 'Edit Custom Label' or 'Add Custom Label'
 */
export function getTabLabelButtonText(tab) {
    return hasTabCustomLabel(tab) ? 'Edit Custom Label' : 'Add Custom Label';
}

/**
 * Update a session's customLabel within a layout by sessionId.
 * Returns a new layout with the updated session.
 *
 * @param {Object} layout - The layout node
 * @param {string} sessionId - The session ID to find
 * @param {string} newLabel - The new custom label (empty string to remove)
 * @returns {Object} - Updated layout node
 */
export function updateSessionLabelInLayout(layout, sessionId, newLabel) {
    if (!layout) return layout;

    if (layout.type === 'pane') {
        if (layout.session?.id === sessionId) {
            return {
                ...layout,
                session: {
                    ...layout.session,
                    customLabel: newLabel || undefined,
                },
            };
        }
        return layout;
    }

    // Split node - recurse into children
    if (layout.children) {
        return {
            ...layout,
            children: [
                updateSessionLabelInLayout(layout.children[0], sessionId, newLabel),
                updateSessionLabelInLayout(layout.children[1], sessionId, newLabel),
            ],
        };
    }

    return layout;
}

/**
 * Check if a tab contains a session with the given ID.
 *
 * @param {Object} tab - The tab object
 * @param {string} sessionId - The session ID to find
 * @returns {boolean} - Whether the tab contains the session
 */
export function tabContainsSession(tab, sessionId) {
    if (!tab || !sessionId) return false;

    // Legacy structure
    if (tab.session?.id === sessionId) return true;

    // Layout structure
    if (!tab.layout) return false;

    const panes = getPaneList(tab.layout);
    return panes.some(pane => pane.session?.id === sessionId);
}
