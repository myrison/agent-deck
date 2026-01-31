/**
 * Tests for custom label search in CommandMenu (Cmd+K)
 *
 * These tests verify that sessions can be found by their custom labels
 * in the command palette search, ensuring users can quickly find sessions
 * by the labels they've assigned.
 *
 * Key behaviors tested:
 * 1. Sessions with custom labels appear in search results when searching by label
 * 2. Multiple sessions with the same label are all found
 * 3. Fuzzy matching works for custom labels
 * 4. Custom label search is weighted appropriately with other search fields
 *
 * Testing approach: We use Fuse.js directly to test the search logic
 * that powers CommandMenu's search functionality.
 */

import { describe, it, expect } from 'vitest';
import Fuse from 'fuse.js';

// ============================================================================
// Test Data: Sample Sessions with Custom Labels
// ============================================================================

const mockSessions = [
    {
        id: 'session-1',
        title: 'Backend API Development',
        customLabel: 'unit tests',
        projectPath: '/projects/api-server',
        tool: 'claude',
        status: 'running',
    },
    {
        id: 'session-2',
        title: 'Frontend Components',
        customLabel: 'unit tests',
        projectPath: '/projects/web-app',
        tool: 'claude',
        status: 'waiting',
    },
    {
        id: 'session-3',
        title: 'Authentication Module',
        customLabel: 'unit tests',
        projectPath: '/projects/auth-service',
        tool: 'gemini',
        status: 'idle',
    },
    {
        id: 'session-4',
        title: 'Database Integration',
        customLabel: 'integration tests',
        projectPath: '/projects/api-server',
        tool: 'claude',
        status: 'running',
    },
    {
        id: 'session-5',
        title: 'UI Polish',
        customLabel: 'bug fixes',
        projectPath: '/projects/web-app',
        tool: 'claude',
        status: 'running',
    },
    {
        id: 'session-6',
        title: 'Performance Optimization',
        customLabel: '',
        projectPath: '/projects/api-server',
        tool: 'claude',
        status: 'idle',
    },
    {
        id: 'session-7',
        title: 'Documentation',
        projectPath: '/projects/docs',
        tool: 'claude',
        status: 'waiting',
    },
];

// ============================================================================
// Fuse.js Configuration (mirrors CommandMenu.jsx)
// ============================================================================

const fuseConfig = {
    keys: [
        { name: 'title', weight: 0.4 },
        { name: 'customLabel', weight: 0.4 },
        { name: 'projectPath', weight: 0.3 },
        { name: 'tool', weight: 0.1 },
        { name: 'description', weight: 0.2 },
        { name: 'name', weight: 0.4 },
    ],
    threshold: 0.4,
    includeScore: true,
};

// ============================================================================
// Tests: Custom Label Search
// ============================================================================

describe('CommandMenu custom label search', () => {
    describe('exact label matching', () => {
        it('finds all sessions with custom label "unit tests"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('unit tests');

            expect(results.length).toBeGreaterThanOrEqual(3);
            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1');
            expect(foundIds).toContain('session-2');
            expect(foundIds).toContain('session-3');
        });

        it('finds session with custom label "integration tests"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('integration tests');

            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].item.id).toBe('session-4');
        });

        it('finds session with custom label "bug fixes"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('bug fixes');

            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].item.id).toBe('session-5');
        });
    });

    describe('partial label matching', () => {
        it('finds sessions when searching for "unit"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('unit');

            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1');
            expect(foundIds).toContain('session-2');
            expect(foundIds).toContain('session-3');
        });

        it('finds sessions when searching for "tests"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('tests');

            // Should find all sessions with "tests" in their label
            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1'); // unit tests
            expect(foundIds).toContain('session-2'); // unit tests
            expect(foundIds).toContain('session-3'); // unit tests
            expect(foundIds).toContain('session-4'); // integration tests
        });

        it('finds session when searching for "integration"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('integration');

            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-4');
        });
    });

    describe('fuzzy label matching', () => {
        it('finds sessions with typos in label search', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);

            // Typo: "unt" instead of "unit"
            const results = fuse.search('unt tests');
            const foundIds = results.map(r => r.item.id);
            expect(foundIds.length).toBeGreaterThan(0);
        });

        it('finds sessions with case variations', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);

            // Different case
            const results = fuse.search('UNIT TESTS');
            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1');
            expect(foundIds).toContain('session-2');
            expect(foundIds).toContain('session-3');
        });
    });

    describe('sessions without custom labels', () => {
        it('does not match sessions without custom labels when searching for a label', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('unit tests');

            const foundIds = results.map(r => r.item.id);
            // Session 6 and 7 have no custom label, should not appear
            expect(foundIds).not.toContain('session-6');
            expect(foundIds).not.toContain('session-7');
        });

        it('still finds sessions without labels when searching by other fields', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('Documentation');

            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-7');
        });
    });

    describe('label search weighting', () => {
        it('prioritizes custom label matches over project path matches', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('unit');

            // Sessions with "unit" in customLabel should rank higher
            // than sessions with "unit" elsewhere
            const topResults = results.slice(0, 3);
            const topIds = topResults.map(r => r.item.id);

            expect(topIds).toContain('session-1');
            expect(topIds).toContain('session-2');
            expect(topIds).toContain('session-3');
        });

        it('custom label weight matches title weight (both 0.4)', () => {
            // Verify that the weights are equal
            const labelWeight = fuseConfig.keys.find(k => k.name === 'customLabel').weight;
            const titleWeight = fuseConfig.keys.find(k => k.name === 'title').weight;

            expect(labelWeight).toBe(0.4);
            expect(titleWeight).toBe(0.4);
        });
    });

    describe('combined field search', () => {
        it('finds sessions matching both label and project path', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            // Search for sessions with "unit" label in "api-server" project
            const results = fuse.search('unit api-server');

            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1'); // matches both
        });

        it('returns results when search matches title and label', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('backend unit');

            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-1'); // title: "Backend API Development", label: "unit tests"
        });
    });
});

// ============================================================================
// Tests: Real-World Use Case Scenario
// ============================================================================

describe('Real-world use case: finding sessions by custom label', () => {
    it('user story: developer has 3 sessions labeled "unit tests" and wants to find them all', () => {
        // Setup: Developer has multiple sessions across different projects,
        // all labeled "unit tests" for easy identification
        const fuse = new Fuse(mockSessions, fuseConfig);

        // User opens Cmd+K and types "unit"
        const results = fuse.search('unit');

        // Verify all 3 sessions with "unit tests" label are found
        const foundSessions = results.map(r => r.item);
        const unitTestSessions = foundSessions.filter(s => s.customLabel === 'unit tests');

        expect(unitTestSessions.length).toBe(3);
        expect(unitTestSessions.map(s => s.id)).toContain('session-1');
        expect(unitTestSessions.map(s => s.id)).toContain('session-2');
        expect(unitTestSessions.map(s => s.id)).toContain('session-3');

        // Verify they span different projects
        const projectPaths = unitTestSessions.map(s => s.projectPath);
        expect(projectPaths).toContain('/projects/api-server');
        expect(projectPaths).toContain('/projects/web-app');
        expect(projectPaths).toContain('/projects/auth-service');
    });

    it('user story: developer types full label name to find exact match', () => {
        const fuse = new Fuse(mockSessions, fuseConfig);

        // User types the exact label they remember setting
        const results = fuse.search('integration tests');

        // First result should be the exact match
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].item.customLabel).toBe('integration tests');
        expect(results[0].item.id).toBe('session-4');
    });

    it('user story: developer partially remembers label, types "bug" to find "bug fixes"', () => {
        const fuse = new Fuse(mockSessions, fuseConfig);

        const results = fuse.search('bug');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-5'); // customLabel: "bug fixes"
    });
});
