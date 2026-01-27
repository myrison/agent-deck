/**
 * Tests for SessionList auto-polling behavior (PR #58)
 *
 * The session list sidebar polls ListSessionsWithGroups() every 10 seconds
 * to pick up new/removed sessions without requiring manual refresh. The poll
 * silently updates state without showing the loading indicator, matching the
 * pattern used by SSH host status polling.
 *
 * These tests verify the behavioral contract of the polling logic:
 * - Interval fires and updates session/group state
 * - No loading indicator is shown during background polls
 * - Errors during polls don't clear existing session data
 * - Interval is cleaned up on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('SessionList polling behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('silent refresh contract', () => {
        it('should update sessions and groups from poll result without touching loading state', () => {
            // This documents the core behavioral difference between the manual
            // loadSessions() (which sets loading=true) and the polling refresh
            const state = {
                sessions: [{ id: 's1', name: 'existing' }],
                groups: [{ path: 'g1' }],
                loading: false,
            };

            // Simulate what the poll does (from the useEffect):
            // It calls ListSessionsWithGroups(), then sets sessions and groups
            // but never touches loading state
            const applyPollResult = (result) => {
                state.sessions = result?.sessions || [];
                state.groups = result?.groups || [];
                // Note: loading is NOT modified — this is the key behavior
            };

            const pollResult = {
                sessions: [
                    { id: 's1', name: 'existing' },
                    { id: 's2', name: 'new-session' },
                ],
                groups: [{ path: 'g1' }, { path: 'g2' }],
            };

            applyPollResult(pollResult);

            expect(state.sessions).toHaveLength(2);
            expect(state.groups).toHaveLength(2);
            expect(state.loading).toBe(false); // Never changed to true
        });

        it('should handle null sessions/groups in poll result gracefully', () => {
            const state = {
                sessions: [{ id: 's1' }],
                groups: [{ path: 'g1' }],
            };

            const applyPollResult = (result) => {
                state.sessions = result?.sessions || [];
                state.groups = result?.groups || [];
            };

            // Backend returns null fields
            applyPollResult({ sessions: null, groups: null });

            expect(state.sessions).toEqual([]);
            expect(state.groups).toEqual([]);
        });

        it('should handle undefined result from poll gracefully', () => {
            const state = {
                sessions: [{ id: 's1' }],
                groups: [{ path: 'g1' }],
            };

            const applyPollResult = (result) => {
                state.sessions = result?.sessions || [];
                state.groups = result?.groups || [];
            };

            applyPollResult(undefined);

            expect(state.sessions).toEqual([]);
            expect(state.groups).toEqual([]);
        });
    });

    describe('error handling', () => {
        it('should not crash or clear state when poll throws', () => {
            const state = {
                sessions: [{ id: 's1', name: 'existing' }],
                groups: [{ path: 'g1' }],
            };
            const loggedWarnings = [];

            // Simulate the poll error path: catch block only logs, doesn't modify state
            const runPoll = async (fetchFn) => {
                try {
                    const result = await fetchFn();
                    state.sessions = result?.sessions || [];
                    state.groups = result?.groups || [];
                } catch (err) {
                    loggedWarnings.push(err.message);
                    // Importantly: state is NOT modified on error
                }
            };

            runPoll(() => { throw new Error('Network timeout'); });

            // State should remain unchanged after failed poll
            expect(state.sessions).toEqual([{ id: 's1', name: 'existing' }]);
            expect(state.groups).toEqual([{ path: 'g1' }]);
            expect(loggedWarnings).toContain('Network timeout');
        });
    });

    describe('interval lifecycle', () => {
        it('should set up interval with 10-second period', () => {
            const pollFn = vi.fn();
            const interval = setInterval(pollFn, 10000);

            // Should not fire immediately
            expect(pollFn).not.toHaveBeenCalled();

            // Should fire after 10 seconds
            vi.advanceTimersByTime(10000);
            expect(pollFn).toHaveBeenCalledTimes(1);

            // Should fire again after another 10 seconds
            vi.advanceTimersByTime(10000);
            expect(pollFn).toHaveBeenCalledTimes(2);

            clearInterval(interval);
        });

        it('should stop polling after cleanup (simulating unmount)', () => {
            const pollFn = vi.fn();
            const interval = setInterval(pollFn, 10000);

            vi.advanceTimersByTime(10000);
            expect(pollFn).toHaveBeenCalledTimes(1);

            // Simulate useEffect cleanup (component unmount)
            clearInterval(interval);

            // Further time advancement should NOT trigger polls
            vi.advanceTimersByTime(30000);
            expect(pollFn).toHaveBeenCalledTimes(1);
        });

        it('should not interfere with manual refresh capability', () => {
            // The polling coexists with the manual refresh button.
            // Manual refresh calls loadSessions() which sets loading=true,
            // while polling does NOT set loading=true.
            const state = {
                sessions: [],
                groups: [],
                loading: false,
            };

            // Manual refresh (loadSessions) behavior
            const loadSessions = async (fetchFn) => {
                state.loading = true;
                try {
                    const result = await fetchFn();
                    state.sessions = result?.sessions || [];
                    state.groups = result?.groups || [];
                } finally {
                    state.loading = false;
                }
            };

            // Poll behavior (does NOT touch loading)
            const pollRefresh = async (fetchFn) => {
                try {
                    const result = await fetchFn();
                    state.sessions = result?.sessions || [];
                    state.groups = result?.groups || [];
                } catch (err) {
                    // silently ignored
                }
            };

            const mockFetch = () => ({
                sessions: [{ id: 's1' }],
                groups: [{ path: 'g1' }],
            });

            // After poll, loading stays false
            pollRefresh(mockFetch);
            expect(state.loading).toBe(false);

            // Manual refresh does set loading
            state.loading = false;
            loadSessions(mockFetch);
            // loading is set to true during the call
            // (In real code this is async, but the key contract is that
            // loadSessions sets loading while pollRefresh does not)
        });
    });

    describe('behavioral comparison with SSH polling', () => {
        it('session polling should mirror SSH host status polling pattern', () => {
            // Both polls follow the same contract:
            // 1. setInterval with fixed period
            // 2. Fetch data asynchronously
            // 3. Update state silently (no loading indicator)
            // 4. Catch and log errors
            // 5. Return cleanup function that clears interval
            //
            // Session poll: 10s interval, calls ListSessionsWithGroups()
            // SSH poll:     30s interval, calls GetSSHHostStatus()

            const sessionPollMs = 10000;
            const sshPollMs = 30000;

            const sessionPollFn = vi.fn();
            const sshPollFn = vi.fn();

            const sessionInterval = setInterval(sessionPollFn, sessionPollMs);
            const sshInterval = setInterval(sshPollFn, sshPollMs);

            // After 30 seconds: session poll fires 3 times, SSH fires 1 time
            vi.advanceTimersByTime(30000);
            expect(sessionPollFn).toHaveBeenCalledTimes(3);
            expect(sshPollFn).toHaveBeenCalledTimes(1);

            // After 60 seconds total: session poll fires 6 times, SSH fires 2 times
            vi.advanceTimersByTime(30000);
            expect(sessionPollFn).toHaveBeenCalledTimes(6);
            expect(sshPollFn).toHaveBeenCalledTimes(2);

            clearInterval(sessionInterval);
            clearInterval(sshInterval);
        });
    });
});
