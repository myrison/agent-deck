/**
 * Tests for SessionList utility functions.
 *
 * These pure functions were extracted from SessionList.jsx to enable
 * direct behavioral testing of time formatting, path shortening,
 * status coloring, and session filtering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    formatRelativeTime,
    getRelativeProjectPath,
    getStatusColor,
    filterSessions,
} from '../utils/sessionListUtils';

describe('formatRelativeTime', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-27T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('null/invalid input', () => {
        it('returns null for null input', () => {
            expect(formatRelativeTime(null)).toBeNull();
        });

        it('returns null for undefined input', () => {
            expect(formatRelativeTime(undefined)).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(formatRelativeTime('')).toBeNull();
        });

        it('returns null for invalid date string', () => {
            expect(formatRelativeTime('not-a-date')).toBeNull();
        });
    });

    describe('time buckets', () => {
        it('returns "just now" for timestamps less than 60 seconds ago', () => {
            const thirtySecsAgo = new Date('2026-01-27T11:59:30Z').toISOString();
            expect(formatRelativeTime(thirtySecsAgo)).toBe('just now');
        });

        it('returns minutes for timestamps 1-59 minutes ago', () => {
            const fiveMinAgo = new Date('2026-01-27T11:55:00Z').toISOString();
            expect(formatRelativeTime(fiveMinAgo)).toBe('5m');
        });

        it('returns 1m at the 60-second boundary', () => {
            const sixtySecsAgo = new Date('2026-01-27T11:59:00Z').toISOString();
            expect(formatRelativeTime(sixtySecsAgo)).toBe('1m');
        });

        it('returns 59m just before the hour boundary', () => {
            const fiftyNineMinAgo = new Date('2026-01-27T11:01:00Z').toISOString();
            expect(formatRelativeTime(fiftyNineMinAgo)).toBe('59m');
        });

        it('returns hours for timestamps 1-23 hours ago', () => {
            const threeHoursAgo = new Date('2026-01-27T09:00:00Z').toISOString();
            expect(formatRelativeTime(threeHoursAgo)).toBe('3h');
        });

        it('returns 1h at the 60-minute boundary', () => {
            const oneHourAgo = new Date('2026-01-27T11:00:00Z').toISOString();
            expect(formatRelativeTime(oneHourAgo)).toBe('1h');
        });

        it('returns days for timestamps 1-6 days ago', () => {
            const twoDaysAgo = new Date('2026-01-25T12:00:00Z').toISOString();
            expect(formatRelativeTime(twoDaysAgo)).toBe('2d');
        });

        it('returns 1d at the 24-hour boundary', () => {
            const oneDayAgo = new Date('2026-01-26T12:00:00Z').toISOString();
            expect(formatRelativeTime(oneDayAgo)).toBe('1d');
        });

        it('returns weeks for timestamps 7-29 days ago', () => {
            const fourteenDaysAgo = new Date('2026-01-13T12:00:00Z').toISOString();
            expect(formatRelativeTime(fourteenDaysAgo)).toBe('2w');
        });

        it('returns 1w at the 7-day boundary', () => {
            const sevenDaysAgo = new Date('2026-01-20T12:00:00Z').toISOString();
            expect(formatRelativeTime(sevenDaysAgo)).toBe('1w');
        });

        it('returns locale date string for timestamps 30+ days ago', () => {
            const thirtyDaysAgo = new Date('2025-12-28T12:00:00Z').toISOString();
            const result = formatRelativeTime(thirtyDaysAgo);
            // Should be a locale date string, not a relative format
            expect(result).not.toMatch(/^\d+[mhdw]$/);
            expect(result).not.toBe('just now');
        });
    });

    describe('edge cases', () => {
        it('handles future timestamps (negative diff)', () => {
            const future = new Date('2026-01-27T13:00:00Z').toISOString();
            // Future timestamps produce negative diffs; diffSec < 60 is false
            // This is an edge case — the function doesn't explicitly handle it
            const result = formatRelativeTime(future);
            // Just verify it doesn't throw
            expect(result).toBeDefined();
        });

        it('handles timestamps at exact current time', () => {
            const now = new Date('2026-01-27T12:00:00Z').toISOString();
            expect(formatRelativeTime(now)).toBe('just now');
        });
    });
});

describe('getRelativeProjectPath', () => {
    describe('with no project roots', () => {
        it('returns last two path segments with ellipsis prefix', () => {
            expect(getRelativeProjectPath('/home/user/projects/myapp', []))
                .toBe('.../projects/myapp');
        });

        it('returns last two segments for null roots', () => {
            expect(getRelativeProjectPath('/home/user/projects/myapp', null))
                .toBe('.../projects/myapp');
        });
    });

    describe('with null/empty path', () => {
        it('returns empty string for null path', () => {
            expect(getRelativeProjectPath(null, [])).toBe('');
        });

        it('returns empty string for empty path', () => {
            expect(getRelativeProjectPath('', [])).toBe('');
        });
    });

    describe('with matching project roots', () => {
        it('returns root name + relative path when path matches a root', () => {
            const roots = ['/home/user/projects'];
            expect(getRelativeProjectPath('/home/user/projects/myapp', roots))
                .toBe('projects/myapp');
        });

        it('returns just root name when path equals the root exactly', () => {
            const roots = ['/home/user/projects'];
            expect(getRelativeProjectPath('/home/user/projects', roots))
                .toBe('projects');
        });

        it('matches the first applicable root', () => {
            const roots = ['/home/user/projects', '/home/user'];
            // Both roots match, but first one wins
            expect(getRelativeProjectPath('/home/user/projects/myapp', roots))
                .toBe('projects/myapp');
        });

        it('handles deeply nested paths under a root', () => {
            const roots = ['/home/user/projects'];
            expect(getRelativeProjectPath('/home/user/projects/deep/nested/app', roots))
                .toBe('projects/deep/nested/app');
        });
    });

    describe('with non-matching project roots', () => {
        it('falls back to last two segments with ellipsis', () => {
            const roots = ['/opt/other'];
            expect(getRelativeProjectPath('/home/user/projects/myapp', roots))
                .toBe('.../projects/myapp');
        });
    });

    describe('short paths', () => {
        it('returns full path for single-segment path with no roots', () => {
            expect(getRelativeProjectPath('/myapp', []))
                .toBe('/myapp');
        });

        it('returns full path for single-segment with non-matching roots', () => {
            expect(getRelativeProjectPath('/myapp', ['/other']))
                .toBe('/myapp');
        });
    });
});

describe('getStatusColor', () => {
    it('returns teal for running status', () => {
        expect(getStatusColor('running')).toBe('#4ecdc4');
    });

    it('returns yellow for waiting status', () => {
        expect(getStatusColor('waiting')).toBe('#ffe66d');
    });

    it('returns gray for idle status', () => {
        expect(getStatusColor('idle')).toBe('#6c757d');
    });

    it('returns red for error status', () => {
        expect(getStatusColor('error')).toBe('#ff6b6b');
    });

    it('returns gray for unknown status', () => {
        expect(getStatusColor('unknown')).toBe('#6c757d');
    });
});

describe('filterSessions', () => {
    const sessions = [
        { id: '1', name: 'running-1', status: 'running' },
        { id: '2', name: 'waiting-1', status: 'waiting' },
        { id: '3', name: 'idle-1', status: 'idle' },
        { id: '4', name: 'idle-2', status: 'idle' },
        { id: '5', name: 'running-2', status: 'running' },
        { id: '6', name: 'error-1', status: 'error' },
    ];

    describe('all filter', () => {
        it('returns all sessions unmodified', () => {
            const result = filterSessions(sessions, 'all');
            expect(result).toHaveLength(6);
            expect(result).toEqual(sessions);
        });
    });

    describe('active filter', () => {
        it('returns only running and waiting sessions', () => {
            const result = filterSessions(sessions, 'active');
            expect(result).toHaveLength(3);
            expect(result.every(s => s.status === 'running' || s.status === 'waiting')).toBe(true);
        });
    });

    describe('idle filter', () => {
        it('returns only idle sessions', () => {
            const result = filterSessions(sessions, 'idle');
            expect(result).toHaveLength(2);
            expect(result.every(s => s.status === 'idle')).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('returns empty array when no sessions match active filter', () => {
            const idleOnly = [{ id: '1', status: 'idle' }];
            expect(filterSessions(idleOnly, 'active')).toHaveLength(0);
        });

        it('returns empty array when no sessions match idle filter', () => {
            const runningOnly = [{ id: '1', status: 'running' }];
            expect(filterSessions(runningOnly, 'idle')).toHaveLength(0);
        });

        it('handles empty session array', () => {
            expect(filterSessions([], 'all')).toHaveLength(0);
            expect(filterSessions([], 'active')).toHaveLength(0);
            expect(filterSessions([], 'idle')).toHaveLength(0);
        });

        it('treats unknown filter as "all"', () => {
            expect(filterSessions(sessions, 'unknown')).toEqual(sessions);
        });
    });
});
