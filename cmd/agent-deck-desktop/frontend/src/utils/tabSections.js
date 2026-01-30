import { getTabSession } from './tabContextMenu';

/**
 * Groups tabs into local and remote sections.
 * Maintains original order within each section.
 *
 * @param {Array} tabs - Array of tab objects
 * @returns {{ localTabs: Array, remoteTabs: Array }} - Tabs grouped by section
 */
export function groupTabsBySection(tabs) {
    const localTabs = [];
    const remoteTabs = [];

    tabs.forEach(tab => {
        const session = getTabSession(tab);
        if (session?.isRemote) {
            remoteTabs.push(tab);
        } else {
            localTabs.push(tab);
        }
    });

    return { localTabs, remoteTabs };
}

/**
 * Checks if drag-drop is allowed between two tabs.
 * Returns true only if both tabs are in the same section (both local or both remote).
 *
 * @param {Object} draggedTab - The tab being dragged
 * @param {Object} targetTab - The tab being dragged over
 * @returns {boolean} - Whether reordering is allowed
 */
export function canReorderBetween(draggedTab, targetTab) {
    const draggedSession = getTabSession(draggedTab);
    const targetSession = getTabSession(targetTab);
    const draggedIsRemote = draggedSession?.isRemote ?? false;
    const targetIsRemote = targetSession?.isRemote ?? false;
    return draggedIsRemote === targetIsRemote;
}

/**
 * Converts section-relative index to global tab array index.
 * Used when reordering tabs within a section.
 *
 * @param {number} sectionIndex - Index within the section
 * @param {boolean} isRemote - Whether this is the remote section
 * @param {Array} localTabs - Array of local tabs
 * @param {Array} remoteTabs - Array of remote tabs (unused but included for clarity)
 * @returns {number} - Global index in the full tab array
 */
export function sectionIndexToGlobalIndex(sectionIndex, isRemote, localTabs, remoteTabs) {
    if (isRemote) {
        // Remote tabs come after all local tabs
        return localTabs.length + sectionIndex;
    }
    return sectionIndex;
}

/**
 * Checks if a tab is in the remote section.
 *
 * @param {Object} tab - The tab to check
 * @returns {boolean} - Whether the tab is remote
 */
export function isRemoteTab(tab) {
    const session = getTabSession(tab);
    return session?.isRemote ?? false;
}

/**
 * Sorts tabs so local tabs come first, then remote tabs.
 * Used for initial tab restoration to ensure consistent section ordering.
 *
 * @param {Array} tabs - Array of tab objects
 * @returns {Array} - Sorted array with local tabs first
 */
export function sortTabsBySection(tabs) {
    return [...tabs].sort((a, b) => {
        const aRemote = isRemoteTab(a);
        const bRemote = isRemoteTab(b);
        if (aRemote === bRemote) return 0;
        return aRemote ? 1 : -1; // Local tabs first
    });
}
