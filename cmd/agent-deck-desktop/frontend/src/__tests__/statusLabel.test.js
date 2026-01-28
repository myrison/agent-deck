/**
 * Tests for statusLabel utility
 *
 * Tests getStatusLabel() which converts session status and wait time
 * into human-friendly display labels and color tiers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStatusLabel } from '../utils/statusLabel';

describe('getStatusLabel', () => {
    let mockNow;

    beforeEach(() => {
        // Mock Date.now() for consistent time calculations
        mockNow = new Date('2024-01-15T10:00:00Z');
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('status priority and mapping', () => {
        it('should return active label for running status', () => {
            const result = getStatusLabel('running', null);

            expect(result).toEqual({
                label: 'active',
                tier: 'running',
            });
        });

        it('should return running status regardless of waitingSince value', () => {
            const pastDate = new Date('2024-01-15T09:00:00Z');
            const result = getStatusLabel('running', pastDate.toISOString());

            // Even with old waitingSince, running takes precedence
            expect(result).toEqual({
                label: 'active',
                tier: 'running',
            });
        });

        it('should return exited label for exited status', () => {
            const result = getStatusLabel('exited', null);

            expect(result).toEqual({
                label: 'exited',
                tier: 'cold',
            });
        });

        it('should return error label for error status', () => {
            const result = getStatusLabel('error', null);

            expect(result).toEqual({
                label: 'error',
                tier: 'cold',
            });
        });

        it('should return idle label for idle status when no valid waitingSince', () => {
            const result = getStatusLabel('idle', null);

            expect(result).toEqual({
                label: 'idle',
                tier: 'cold',
            });
        });

        it('should return unknown label for unrecognized status', () => {
            const result = getStatusLabel('unknown-status', null);

            expect(result).toEqual({
                label: 'unknown-status',
                tier: 'cold',
            });
        });

        it('should return generic unknown for null status', () => {
            const result = getStatusLabel(null, null);

            expect(result).toEqual({
                label: 'unknown',
                tier: 'cold',
            });
        });
    });

    describe('time-based waiting status', () => {
        it('should return ready <1m when waiting less than 1 minute', () => {
            const waitingSince = new Date('2024-01-15T09:59:30Z'); // 30 seconds ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready <1m',
                tier: 'hot',
            });
        });

        it('should use hot tier for 1-9 minute waits', () => {
            const waitingSince = new Date('2024-01-15T09:55:00Z'); // 5 minutes ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 5m',
                tier: 'hot',
            });
        });

        it('should transition to warm tier at 10 minute boundary', () => {
            const waitingSince = new Date('2024-01-15T09:50:00Z'); // 10 minutes ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 10m',
                tier: 'warm',
            });
        });

        it('should use warm tier for 10-59 minute waits', () => {
            const waitingSince = new Date('2024-01-15T09:30:00Z'); // 30 minutes ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 30m',
                tier: 'warm',
            });
        });

        it('should transition to amber tier at 1 hour (60 minute) boundary', () => {
            const waitingSince = new Date('2024-01-15T09:00:00Z'); // 1 hour ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 1h',
                tier: 'amber',
            });
        });

        it('should use amber tier for 1-3 hour waits', () => {
            const waitingSince = new Date('2024-01-15T08:00:00Z'); // 2 hours ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 2h',
                tier: 'amber',
            });
        });

        it('should transition to idle at exactly 4 hour boundary', () => {
            const waitingSince = new Date('2024-01-15T06:00:00Z'); // 4 hours ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            // At 4 hours, diffHour = 4, condition diffHour < 4 is false, so goes to idle
            expect(result).toEqual({
                label: 'idle 4h',
                tier: 'cold',
            });
        });

        it('should use cold tier for waits >= 4 hours', () => {
            const waitingSince = new Date('2024-01-15T05:00:00Z'); // 5 hours ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'idle 5h',
                tier: 'cold',
            });
        });

        it('should round down minutes correctly', () => {
            // 9 minutes 59 seconds
            const waitingSince = new Date(mockNow.getTime() - 9 * 60 * 1000 - 59 * 1000);
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 9m',
                tier: 'hot',
            });
        });

        it('should round down hours correctly', () => {
            // 3 hours 59 minutes
            const waitingSince = new Date(mockNow.getTime() - (3 * 60 + 59) * 60 * 1000);
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 3h',
                tier: 'amber',
            });
        });

        it('should return ready 59m for 59 minute wait (upper boundary of warm tier)', () => {
            const waitingSince = new Date('2024-01-15T09:01:00Z'); // 59 minutes ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result).toEqual({
                label: 'ready 59m',
                tier: 'warm',
            });
        });
    });

    describe('waiting status without valid time', () => {
        it('should return ready label when waiting with no waitingSince', () => {
            const result = getStatusLabel('waiting', null);

            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });

        it('should return ready label when waiting with invalid ISO string', () => {
            const result = getStatusLabel('waiting', 'invalid-date');

            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });

        it('should return ready label when waiting with malformed date', () => {
            const result = getStatusLabel('waiting', 'not a date at all');

            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });
    });

    describe('time validation (Go zero time filtering)', () => {
        it('should filter Go zero time (year < 2020)', () => {
            // Go's zero time is 0001-01-01T00:00:00Z
            const result = getStatusLabel('waiting', '0001-01-01T00:00:00Z');

            // Should fall back to status-based label, not calculate time
            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });

        it('should accept year 2020 as valid boundary', () => {
            const waitingSince = new Date('2020-01-01T00:00:00Z');
            // Mock time to be after 2020
            const futureTime = new Date('2024-01-15T10:00:00Z');
            vi.setSystemTime(futureTime);

            const result = getStatusLabel('waiting', waitingSince.toISOString());

            // Should calculate time diff since it's year 2020 (threshold is >= 2020)
            // From 2020-01-01 to 2024-01-15 is about 4 years = 8760+ hours
            expect(result.label).toMatch(/^idle \d+h$/);
            expect(result.tier).toBe('cold'); // Very old = cold tier
        });

        it('should handle future dates gracefully (negative time diff)', () => {
            const futureDate = new Date(mockNow.getTime() + 1000 * 60); // 1 minute in the future
            const result = getStatusLabel('waiting', futureDate.toISOString());

            // Negative diff should be treated as invalid time
            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });

        it('should handle invalid ISO string returning NaN', () => {
            const result = getStatusLabel('waiting', 'invalid-date');

            expect(result).toEqual({
                label: 'ready',
                tier: 'warm',
            });
        });
    });

    describe('precedence: time-based labels override status-based', () => {
        it('should use time-based label even when error status has valid waitingSince', () => {
            const waitingSince = new Date('2024-01-15T09:00:00Z'); // 1 hour ago
            const result = getStatusLabel('error', waitingSince.toISOString());

            // When hasValidTime is true, time-based path takes precedence
            expect(result).toEqual({
                label: 'ready 1h',
                tier: 'amber',
            });
        });

        it('should use time-based label for unknown status with valid waitingSince', () => {
            const waitingSince = new Date('2024-01-15T09:00:00Z'); // 1 hour ago
            const result = getStatusLabel('unknown-status', waitingSince.toISOString());

            // When hasValidTime is true, time-based path is taken regardless of status
            expect(result).toEqual({
                label: 'ready 1h',
                tier: 'amber',
            });
        });
    });

    describe('case sensitivity', () => {
        it('should be case-sensitive for status matching', () => {
            // 'Running' (capital R) is not 'running'
            const result = getStatusLabel('Running', null);

            expect(result.label).toBe('Running'); // Treated as unknown status
            expect(result.tier).toBe('cold');
        });
    });

    describe('timestamp precision and formats', () => {
        it('should handle millisecond-precision timestamps', () => {
            const waitingSince = new Date(mockNow.getTime() - 5 * 60 * 1000);
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result.label).toBe('ready 5m');
            expect(result.tier).toBe('hot');
        });

        it('should handle Date objects as input (convert to string)', () => {
            const waitingSince = new Date('2024-01-15T09:55:00Z'); // 5 minutes ago
            const result = getStatusLabel('waiting', waitingSince); // Pass Date object

            // Constructor will attempt new Date(waitingSince) which coerces to string
            expect(result).toEqual({
                label: 'ready 5m',
                tier: 'hot',
            });
        });

        it('should handle ISO timestamps with timezone offset', () => {
            // 5 minutes ago in UTC-5 timezone
            const now = new Date('2024-01-15T15:00:00-05:00'); // 20:00 UTC
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

            vi.setSystemTime(now);
            const result = getStatusLabel('waiting', fiveMinutesAgo.toISOString());

            // Should convert to UTC and calculate correctly
            expect(result).toEqual({
                label: 'ready 5m',
                tier: 'hot',
            });
        });
    });

    describe('real-world scenarios', () => {
        it('should reflect session state: fresh running session', () => {
            const result = getStatusLabel('running', null);

            expect(result.label).toBe('active');
            expect(result.tier).toBe('running');
        });

        it('should reflect session state: session waiting for first user input', () => {
            const waitingSince = new Date('2024-01-15T09:59:45Z'); // 15 seconds ago
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result.label).toBe('ready <1m');
            expect(result.tier).toBe('hot');
        });

        it('should reflect session state: session completed', () => {
            const result = getStatusLabel('exited', null);

            expect(result.label).toBe('exited');
            expect(result.tier).toBe('cold');
        });

        it('should reflect session state: session waiting 15 minutes', () => {
            const waitingSince = new Date('2024-01-15T09:45:00Z');
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result.label).toBe('ready 15m');
            expect(result.tier).toBe('warm');
        });

        it('should reflect session state: session in error', () => {
            const result = getStatusLabel('error', null);

            expect(result.label).toBe('error');
            expect(result.tier).toBe('cold');
        });

        it('should reflect session state: session idle overnight', () => {
            const waitingSince = new Date('2024-01-14T10:00:00Z'); // Yesterday
            const result = getStatusLabel('waiting', waitingSince.toISOString());

            expect(result.label).toBe('idle 24h');
            expect(result.tier).toBe('cold');
        });
    });
});
