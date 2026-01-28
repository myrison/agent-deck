import { useMemo } from 'react';
import './ActivityRibbon.css';
import { getStatusLabel } from './utils/statusLabel';

/**
 * ActivityRibbon displays a status indicator above session tabs.
 * Shows how long the agent has been waiting for input.
 *
 * For multi-pane tabs, shows the most urgent status across all sessions.
 *
 * Tiers:
 * - running: "active" (green)
 * - hot (<10 min): "ready Xm" (bright green)
 * - warm (10-60 min): "ready Xm" (yellow)
 * - amber (1-4 hours): "ready Xh" (orange)
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
        return getStatusLabel(activeStatus, activeWaitingSince);
    }, [activeStatus, activeWaitingSince]);

    return (
        <div className={`activity-ribbon tier-${tier}`} draggable="false">
            {label}
        </div>
    );
}
