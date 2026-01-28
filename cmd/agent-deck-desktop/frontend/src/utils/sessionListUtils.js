/**
 * Pure utility functions for SessionList rendering.
 *
 * Extracted from SessionList.jsx so they can be tested and reused.
 */

/**
 * Format a relative time string (e.g., "5m", "2h", "3d")
 * @param {string|null} dateString - ISO date string
 * @returns {string|null} Relative time label or null
 */
export function formatRelativeTime(dateString) {
    if (!dateString) return null;

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;

    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHour < 24) return `${diffHour}h`;
    if (diffDay < 7) return `${diffDay}d`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w`;
    return date.toLocaleDateString();
}

/**
 * Compute relative project path based on configured roots.
 * @param {string|null} fullPath - Absolute project path
 * @param {string[]} projectRoots - Configured project root directories
 * @returns {string} Shortened display path
 */
export function getRelativeProjectPath(fullPath, projectRoots) {
    if (!fullPath || !projectRoots || projectRoots.length === 0) {
        const parts = fullPath?.split('/').filter(Boolean) || [];
        if (parts.length >= 2) {
            return `.../${parts.slice(-2).join('/')}`;
        }
        return fullPath || '';
    }

    for (const root of projectRoots) {
        if (fullPath.startsWith(root)) {
            const rootName = root.split('/').filter(Boolean).pop();
            const relativePath = fullPath.slice(root.length).replace(/^\//, '');
            if (relativePath) {
                return `${rootName}/${relativePath}`;
            }
            return rootName;
        }
    }

    const parts = fullPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
        return `.../${parts.slice(-2).join('/')}`;
    }
    return fullPath;
}

/**
 * Get the CSS color for a session status.
 * @param {string} status - Session status
 * @returns {string} CSS color string
 */
export function getStatusColor(status) {
    switch (status) {
        case 'running': return '#4ecdc4';
        case 'waiting': return '#ffe66d';
        case 'idle': return '#6c757d';
        case 'error': return '#ff6b6b';
        case 'exited': return '#ff6b6b';
        default: return '#6c757d';
    }
}

/**
 * Filter sessions based on a status filter mode.
 * @param {Array} sessions - Full session list
 * @param {string} statusFilter - 'all' | 'active' | 'idle'
 * @returns {Array} Filtered session list
 */
export function filterSessions(sessions, statusFilter) {
    if (statusFilter === 'active') {
        return sessions.filter(s => s.status === 'running' || s.status === 'waiting');
    }
    if (statusFilter === 'idle') {
        return sessions.filter(s => s.status === 'idle');
    }
    return sessions;
}
