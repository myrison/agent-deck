/**
 * Shared utility for computing human-friendly status labels.
 * Used by ActivityRibbon, SessionPicker, and other components.
 */

/**
 * Compute a display label and tier for a session's status.
 *
 * @param {string} status - The session status ('running', 'waiting', 'idle', 'exited', 'error')
 * @param {string|Date} waitingSince - ISO timestamp or Date when waiting started
 * @returns {{ label: string, tier: string }}
 *   - label: Human-friendly text like "active", "ready 5m", "idle 2h", "exited"
 *   - tier: Color tier ('running', 'hot', 'warm', 'amber', 'cold')
 */
export function getStatusLabel(status, waitingSince) {
    // Handle running status
    if (status === 'running') {
        return { label: 'active', tier: 'running' };
    }

    // Handle exited sessions
    if (status === 'exited') {
        return { label: 'exited', tier: 'cold' };
    }

    // Check if we have valid waitingSince data
    let hasValidTime = false;
    let diffMin = 0;
    let diffHour = 0;

    if (waitingSince) {
        const now = new Date();
        const since = new Date(waitingSince);

        // Valid if parseable and after 2020 (filters Go zero time)
        if (!isNaN(since.getTime()) && since.getFullYear() >= 2020) {
            const diffMs = now - since;
            if (diffMs >= 0) {
                hasValidTime = true;
                diffMin = Math.floor(diffMs / 60000);
                diffHour = Math.floor(diffMin / 60);
            }
        }
    }

    // Determine tier and label based on status and wait time
    if (hasValidTime) {
        if (diffMin < 1) {
            return { label: 'ready <1m', tier: 'hot' };
        } else if (diffMin < 10) {
            return { label: `ready ${diffMin}m`, tier: 'hot' };
        } else if (diffMin < 60) {
            return { label: `ready ${diffMin}m`, tier: 'warm' };
        } else if (diffHour < 4) {
            return { label: `ready ${diffHour}h`, tier: 'amber' };
        } else {
            return { label: `idle ${diffHour}h`, tier: 'cold' };
        }
    }

    // No valid time data - show status-based label
    if (status === 'waiting') {
        return { label: 'ready', tier: 'warm' };
    } else if (status === 'idle') {
        return { label: 'idle', tier: 'cold' };
    } else if (status === 'error') {
        return { label: 'error', tier: 'cold' };
    }

    // Unknown status - show generic
    return { label: status || 'unknown', tier: 'cold' };
}
