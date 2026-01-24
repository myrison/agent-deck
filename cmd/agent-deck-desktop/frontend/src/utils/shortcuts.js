/**
 * Format a keyboard shortcut string for display using Mac symbols.
 *
 * @param {string} s - Shortcut string like "cmd+shift+k"
 * @returns {string} Formatted string like "⌘⇧K"
 */
export function formatShortcut(s) {
    if (!s) return '';
    return s
        .replace(/cmd/g, '⌘')
        .replace(/ctrl/g, '⌃')
        .replace(/shift/g, '⇧')
        .replace(/alt/g, '⌥')
        .replace(/\+/g, '')
        .toUpperCase();
}
