import { useMemo } from 'react';
import './ActivityRibbon.css';

/**
 * ActivityRibbon displays a status indicator below session tabs.
 * Shows how long the agent has been waiting for input.
 *
 * For multi-pane tabs, shows the most urgent status across all sessions.
 *
 * Tiers:
 * - running: "working..." (green)
 * - hot (<10 min): "waiting Xm" (bright green)
 * - warm (10-60 min): "waiting Xm" (yellow)
 * - amber (1-4 hours): "waiting Xh" (orange)
 * - cold (>4 hours): "idle Xh" (faded gray)
 * - exited: "exited" (gray)
 */

/**
 * Determine the "worst" (most urgent) status from multiple sessions.
 * Priority order: error > waiting > idle > running > exited > unknown
 */
function getWorstStatus(sessions) {
    if (!sessions || sessions.length === 0) {
        return { status: null, waitingSince: null };
    }

    // Status priority (higher number = more urgent)
    const statusPriority = {
        'error': 5,
        'waiting': 4,
        'idle': 3,
        'running': 2,
        'exited': 1,
        'unknown': 0,
    };

    let worstSession = null;
    let worstPriority = -1;

    for (const session of sessions) {
        if (!session) continue;

        const status = session.status || 'unknown';
        const priority = statusPriority[status] !== undefined ? statusPriority[status] : 0;

        if (priority > worstPriority) {
            worstPriority = priority;
            worstSession = session;
        }
    }

    if (!worstSession) {
        return { status: null, waitingSince: null };
    }

    return {
        status: worstSession.status,
        waitingSince: worstSession.waitingSince,
    };
}

export default function ActivityRibbon({ sessions, status, waitingSince }) {
    // Support both single session (legacy) and array of sessions (new)
    const { activeStatus, activeWaitingSince } = useMemo(() => {
        if (Array.isArray(sessions)) {
            // Multi-pane: determine worst status
            const { status: worstStatus, waitingSince: worstTime } = getWorstStatus(sessions);
            return { activeStatus: worstStatus, activeWaitingSince: worstTime };
        } else {
            // Single session (legacy)
            return { activeStatus: status, activeWaitingSince: waitingSince };
        }
    }, [sessions, status, waitingSince]);

    const { label, tier } = useMemo(() => {
        // Handle running status
        if (activeStatus === 'running') {
            return { label: 'working', tier: 'running' };
        }

        // Handle exited sessions
        if (activeStatus === 'exited') {
            return { label: 'exited', tier: 'cold' };
        }

        // Check if we have valid waitingSince data
        let hasValidTime = false;
        let diffMin = 0;
        let diffHour = 0;

        if (activeWaitingSince) {
            const now = new Date();
            const since = new Date(activeWaitingSince);

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
                return { label: 'waiting <1m', tier: 'hot' };
            } else if (diffMin < 10) {
                return { label: `waiting ${diffMin}m`, tier: 'hot' };
            } else if (diffMin < 60) {
                return { label: `waiting ${diffMin}m`, tier: 'warm' };
            } else if (diffHour < 4) {
                return { label: `waiting ${diffHour}h`, tier: 'amber' };
            } else {
                return { label: `idle ${diffHour}h`, tier: 'cold' };
            }
        }

        // No valid time data - show status-based label
        if (activeStatus === 'waiting') {
            return { label: 'waiting', tier: 'warm' };
        } else if (activeStatus === 'idle') {
            return { label: 'idle', tier: 'cold' };
        } else if (activeStatus === 'error') {
            return { label: 'error', tier: 'cold' };
        }

        // Unknown status - show generic
        return { label: activeStatus || 'unknown', tier: 'cold' };
    }, [activeStatus, activeWaitingSince]);

    return (
        <div className={`activity-ribbon tier-${tier}`}>
            {label}
        </div>
    );
}
