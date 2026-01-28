/**
 * Tests for tab session data refresh when switching to an existing tab.
 *
 * PR #78 changed handleOpenTab in App.jsx to refresh the session data stored
 * in the pane layout when a user switches to a tab that already has the
 * session open. Previously, the pane kept stale session data from when the
 * tab was first opened.
 *
 * Why this matters: Session fields like status, customLabel, and remoteTmuxName
 * can change between when a tab is opened and when the user switches back to it.
 * Without refreshing, the terminal header and sidebar show stale info.
 *
 * Testing approach: Since App.jsx requires Wails bindings, we test the
 * behavioral logic using pure functions from layoutUtils.js (updatePaneSession,
 * getPaneList) which are the building blocks of the refresh behavior.
 */

import { describe, it, expect } from 'vitest';
import { updatePaneSession, getPaneList, createSinglePaneLayout } from '../layoutUtils.js';

// ============================================================================
// Extracted Logic: Tab Session Refresh
// Mirrors the handleOpenTab session-exists branch in App.jsx (~line 476)
// ============================================================================

/**
 * Checks if a session is already open in any tab and returns the refresh action.
 * Mirrors the for-loop in handleOpenTab that searches tabs for existing sessions.
 *
 * @param {Array} openTabs - Current open tabs
 * @param {Object} session - Session being opened (with potentially updated data)
 * @returns {Object|null} { tabId, paneId, updatedLayout } if found, null if new tab needed
 */
function findAndRefreshExistingSession(openTabs, session) {
    for (const tab of openTabs) {
        const panes = getPaneList(tab.layout);
        const paneWithSession = panes.find(p => p.session?.id === session.id);
        if (paneWithSession) {
            return {
                tabId: tab.id,
                paneId: paneWithSession.id,
                updatedLayout: updatePaneSession(tab.layout, paneWithSession.id, session),
            };
        }
    }
    return null;
}

// ============================================================================
// Tests: Session Data Refresh in Existing Tab
// ============================================================================

describe('Tab session refresh on switch', () => {
    it('refreshes session data in pane when session is already open', () => {
        const oldSession = {
            id: 'session-1',
            title: 'Agent Deck',
            status: 'idle',
            customLabel: '',
        };
        const layout = createSinglePaneLayout(oldSession);

        const tab = {
            id: 'tab-1',
            name: 'Agent Deck',
            layout,
            activePaneId: layout.id,
        };

        // Session data has been updated since the tab was opened
        const updatedSession = {
            id: 'session-1',
            title: 'Agent Deck',
            status: 'running',
            customLabel: 'Bug Fix',
            remoteTmuxName: 'agentdeck_agent-deck_aabb1122',
        };

        const result = findAndRefreshExistingSession([tab], updatedSession);

        expect(result).not.toBeNull();
        expect(result.tabId).toBe('tab-1');

        // The layout should now contain the updated session data
        const panes = getPaneList(result.updatedLayout);
        expect(panes[0].session.status).toBe('running');
        expect(panes[0].session.customLabel).toBe('Bug Fix');
        expect(panes[0].session.remoteTmuxName).toBe('agentdeck_agent-deck_aabb1122');
    });

    it('returns null when session is not in any tab', () => {
        const layout = createSinglePaneLayout({ id: 'other-session', title: 'Other' });
        const tab = {
            id: 'tab-1',
            name: 'Other',
            layout,
            activePaneId: layout.id,
        };

        const result = findAndRefreshExistingSession([tab], { id: 'session-new', title: 'New' });

        expect(result).toBeNull();
    });

    it('skips panes with null session without crashing', () => {
        // A split layout can have an empty pane (session: null) when one side
        // hasn't been assigned a session yet. The search must skip these.
        const layout = {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
                { type: 'pane', id: 'pane-empty', sessionId: null, session: null },
                { type: 'pane', id: 'pane-filled', sessionId: 'session-1', session: { id: 'session-1', title: 'Filled', status: 'idle' } },
            ],
        };
        const tab = { id: 'tab-split', layout, activePaneId: 'pane-filled' };

        const updatedSession = { id: 'session-1', title: 'Filled', status: 'running' };
        const result = findAndRefreshExistingSession([tab], updatedSession);

        expect(result).not.toBeNull();
        expect(result.paneId).toBe('pane-filled');
        const panes = getPaneList(result.updatedLayout);
        const filledPane = panes.find(p => p.id === 'pane-filled');
        expect(filledPane.session.status).toBe('running');
    });

    it('finds session in correct tab when multiple tabs are open', () => {
        const layout1 = createSinglePaneLayout({ id: 'session-1', title: 'First' });
        const layout2 = createSinglePaneLayout({ id: 'session-2', title: 'Second' });

        const tabs = [
            { id: 'tab-1', layout: layout1, activePaneId: layout1.id },
            { id: 'tab-2', layout: layout2, activePaneId: layout2.id },
        ];

        const updatedSession = { id: 'session-2', title: 'Second Updated', status: 'running' };
        const result = findAndRefreshExistingSession(tabs, updatedSession);

        expect(result.tabId).toBe('tab-2');
        const panes = getPaneList(result.updatedLayout);
        expect(panes[0].session.title).toBe('Second Updated');
    });

    it('preserves other panes in split layout when refreshing one', () => {
        // Create a split layout with two panes
        const leftSession = { id: 'session-left', title: 'Left' };
        const rightSession = { id: 'session-right', title: 'Right', status: 'idle' };
        const layout = {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
                { type: 'pane', id: 'pane-left', sessionId: 'session-left', session: leftSession },
                { type: 'pane', id: 'pane-right', sessionId: 'session-right', session: rightSession },
            ],
        };

        const tab = { id: 'tab-split', layout, activePaneId: 'pane-left' };

        // Update only the right session
        const updatedRight = { id: 'session-right', title: 'Right', status: 'running' };
        const result = findAndRefreshExistingSession([tab], updatedRight);

        expect(result.paneId).toBe('pane-right');
        const panes = getPaneList(result.updatedLayout);
        const leftPane = panes.find(p => p.id === 'pane-left');
        const rightPane = panes.find(p => p.id === 'pane-right');

        // Left pane unchanged
        expect(leftPane.session.title).toBe('Left');
        // Right pane updated
        expect(rightPane.session.status).toBe('running');
    });
});
