/**
 * Tests for ActivityRibbon component
 *
 * Tests the ActivityRibbon component which displays status indicators
 * for single and multi-pane sessions, showing how long the agent has been waiting.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityRibbon from '../ActivityRibbon';

describe('ActivityRibbon', () => {
    describe('single session (legacy)', () => {
        it('should display active label when running', () => {
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="running"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('active')).toBeInTheDocument();
            expect(container.querySelector('.activity-ribbon.tier-running')).toBeInTheDocument();
        });

        it('should display exited label when exited', () => {
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="exited"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('exited')).toBeInTheDocument();
            expect(container.querySelector('.activity-ribbon.tier-cold')).toBeInTheDocument();
        });

        it('should display error label when status is error', () => {
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="error"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('error')).toBeInTheDocument();
            expect(container.querySelector('.activity-ribbon.tier-cold')).toBeInTheDocument();
        });

        it('should display ready label when waiting with valid time', () => {
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={fiveMinutesAgo.toISOString()}
                />
            );

            expect(screen.getByText('ready 5m')).toBeInTheDocument();
            expect(container.querySelector('.activity-ribbon.tier-hot')).toBeInTheDocument();
        });

        it('should display idle label when idle status with no time', () => {
            render(
                <ActivityRibbon
                    sessions={undefined}
                    status="idle"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('idle')).toBeInTheDocument();
        });
    });

    describe('multi-session (array)', () => {
        it('should display status from first session when array provided', () => {
            const sessions = [
                { status: 'running', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('active')).toBeInTheDocument();
        });

        it('should pick worst status (error) when multiple sessions', () => {
            const now = new Date();
            const sessions = [
                { status: 'running', waitingSince: null },
                { status: 'waiting', waitingSince: new Date(now.getTime() - 5 * 60 * 1000).toISOString() },
                { status: 'error', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Error is highest priority (5), should be displayed
            expect(screen.getByText('error')).toBeInTheDocument();
        });

        it('should pick worst status (waiting) over running', () => {
            const now = new Date();
            const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
            const sessions = [
                { status: 'running', waitingSince: null },
                { status: 'waiting', waitingSince: tenMinutesAgo.toISOString() },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Waiting is priority 4, running is priority 2
            expect(screen.getByText('ready 10m')).toBeInTheDocument();
        });

        it('should pick idle over running', () => {
            const sessions = [
                { status: 'running', waitingSince: null },
                { status: 'idle', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Idle is priority 3, running is priority 2
            expect(screen.getByText('idle')).toBeInTheDocument();
        });

        it('should handle empty session array', () => {
            render(
                <ActivityRibbon
                    sessions={[]}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Should display unknown status
            expect(screen.getByText('unknown')).toBeInTheDocument();
        });

        it('should handle session with null status', () => {
            const sessions = [
                { status: null, waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // null status becomes 'unknown' in getStatusLabel
            expect(screen.getByText('unknown')).toBeInTheDocument();
        });

        it('should ignore undefined sessions in array', () => {
            const sessions = [
                undefined,
                { status: 'running', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Should skip undefined and use running from second session
            expect(screen.getByText('active')).toBeInTheDocument();
        });

        it('should use waiting time from worst session', () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            const sessions = [
                { status: 'waiting', waitingSince: oneHourAgo.toISOString() },
                { status: 'waiting', waitingSince: twoHoursAgo.toISOString() },
                { status: 'running', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Both are waiting (same priority), first one encountered should be picked
            expect(screen.getByText('ready 1h')).toBeInTheDocument();
        });

        it('should handle all sessions null or missing', () => {
            const sessions = [null, undefined, null];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // All skipped = worstSession remains null, returns null,null
            expect(screen.getByText('unknown')).toBeInTheDocument();
        });
    });

    describe('priority ordering', () => {
        const now = new Date();

        it('should prioritize error over all other statuses', () => {
            const sessions = [
                { status: 'exited', waitingSince: null },
                { status: 'running', waitingSince: null },
                { status: 'idle', waitingSince: null },
                { status: 'error', waitingSince: null },
                { status: 'waiting', waitingSince: new Date(now.getTime() - 10 * 60 * 1000).toISOString() },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('error')).toBeInTheDocument();
        });

        it('should prioritize waiting over idle and running', () => {
            const sessions = [
                { status: 'exited', waitingSince: null },
                { status: 'running', waitingSince: null },
                { status: 'waiting', waitingSince: new Date(now.getTime() - 5 * 60 * 1000).toISOString() },
                { status: 'idle', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('ready 5m')).toBeInTheDocument();
        });

        it('should prioritize idle over running and exited', () => {
            const sessions = [
                { status: 'exited', waitingSince: null },
                { status: 'running', waitingSince: null },
                { status: 'idle', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('idle')).toBeInTheDocument();
        });

        it('should prioritize running over exited', () => {
            const sessions = [
                { status: 'exited', waitingSince: null },
                { status: 'running', waitingSince: null },
            ];

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('active')).toBeInTheDocument();
        });
    });

    describe('rendering and memoization', () => {
        it('should render div with activity-ribbon class and tier', () => {
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="running"
                    waitingSince={null}
                />
            );

            const ribbon = container.querySelector('.activity-ribbon.tier-running');
            expect(ribbon).toBeInTheDocument();
        });

        it('should update when status changes', () => {
            const { rerender } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="running"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('active')).toBeInTheDocument();

            rerender(
                <ActivityRibbon
                    sessions={undefined}
                    status="exited"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('exited')).toBeInTheDocument();
            expect(screen.queryByText('active')).not.toBeInTheDocument();
        });

        it('should update when sessions array changes', () => {
            const sessions1 = [{ status: 'running', waitingSince: null }];
            const sessions2 = [{ status: 'exited', waitingSince: null }];

            const { rerender } = render(
                <ActivityRibbon
                    sessions={sessions1}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('active')).toBeInTheDocument();

            rerender(
                <ActivityRibbon
                    sessions={sessions2}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('exited')).toBeInTheDocument();
        });

        it('should update when waitingSince changes', () => {
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

            const { rerender } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={fiveMinutesAgo.toISOString()}
                />
            );

            expect(screen.getByText('ready 5m')).toBeInTheDocument();

            rerender(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={tenMinutesAgo.toISOString()}
                />
            );

            expect(screen.getByText('ready 10m')).toBeInTheDocument();
        });

        it('should apply correct tier class', () => {
            const { container: container1 } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="running"
                    waitingSince={null}
                />
            );

            expect(container1.querySelector('.activity-ribbon.tier-running')).toBeInTheDocument();
            expect(container1.querySelector('.activity-ribbon.tier-hot')).not.toBeInTheDocument();
        });

        it('should handle transition between tier classes', () => {
            const now = new Date();
            const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);
            const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);

            const { container, rerender } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={oneMinuteAgo.toISOString()}
                />
            );

            // 1 minute = hot tier
            expect(container.querySelector('.activity-ribbon.tier-hot')).toBeInTheDocument();

            rerender(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={twentyMinutesAgo.toISOString()}
                />
            );

            // 20 minutes = warm tier
            expect(container.querySelector('.activity-ribbon.tier-warm')).toBeInTheDocument();
            expect(container.querySelector('.activity-ribbon.tier-hot')).not.toBeInTheDocument();
        });
    });

    describe('edge cases', () => {
        it('should handle null sessions prop', () => {
            render(
                <ActivityRibbon
                    sessions={null}
                    status="running"
                    waitingSince={null}
                />
            );

            // Should fall back to legacy mode with status prop
            expect(screen.getByText('active')).toBeInTheDocument();
        });

        it('should handle large number of sessions', () => {
            const now = new Date();
            const sessions = Array(100).fill(null).map((_, i) => ({
                status: i === 50 ? 'error' : 'running',
                waitingSince: null,
            }));

            render(
                <ActivityRibbon
                    sessions={sessions}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Should find the error status
            expect(screen.getByText('error')).toBeInTheDocument();
        });

        it('should render valid JSX structure', () => {
            const { container } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="running"
                    waitingSince={null}
                />
            );

            const ribbon = container.querySelector('.activity-ribbon');
            expect(ribbon).toBeTruthy();
            expect(ribbon.textContent).toBe('active');
        });
    });

    describe('time update scenarios', () => {
        it('should handle session transitioning from waiting to exited', () => {
            const { rerender } = render(
                <ActivityRibbon
                    sessions={undefined}
                    status="waiting"
                    waitingSince={new Date().toISOString()}
                />
            );

            expect(screen.getByText('ready <1m')).toBeInTheDocument();

            rerender(
                <ActivityRibbon
                    sessions={undefined}
                    status="exited"
                    waitingSince={null}
                />
            );

            expect(screen.getByText('exited')).toBeInTheDocument();
        });

        it('should handle multi-session where one exits', () => {
            const now = new Date();
            const { rerender } = render(
                <ActivityRibbon
                    sessions={[
                        { status: 'running', waitingSince: null },
                        { status: 'waiting', waitingSince: new Date(now.getTime() - 5 * 60 * 1000).toISOString() },
                    ]}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            expect(screen.getByText('ready 5m')).toBeInTheDocument();

            // Second session exits
            rerender(
                <ActivityRibbon
                    sessions={[
                        { status: 'running', waitingSince: null },
                        { status: 'exited', waitingSince: null },
                    ]}
                    status={undefined}
                    waitingSince={undefined}
                />
            );

            // Now running is worst status
            expect(screen.getByText('active')).toBeInTheDocument();
        });
    });
});
