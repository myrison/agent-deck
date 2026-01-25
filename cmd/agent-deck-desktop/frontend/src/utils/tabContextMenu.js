/**
 * Utility functions for tab context menu
 *
 * These functions handle null safety for tab context menu operations,
 * preventing crashes when tab or session data is undefined.
 */

/**
 * Check if a tab context menu should be rendered.
 * Returns true only if the menu state exists and has valid tab/session data.
 *
 * @param {Object|null} tabContextMenu - The context menu state { x, y, tab }
 * @returns {boolean} - Whether the context menu should be rendered
 */
export function shouldRenderTabContextMenu(tabContextMenu) {
    return Boolean(tabContextMenu && tabContextMenu.tab?.session);
}

/**
 * Get the custom label from a tab, with null safety.
 *
 * @param {Object|null} tab - The tab object { id, session: { customLabel, ... } }
 * @returns {string|null} - The custom label or null if not available
 */
export function getTabCustomLabel(tab) {
    return tab?.session?.customLabel || null;
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
