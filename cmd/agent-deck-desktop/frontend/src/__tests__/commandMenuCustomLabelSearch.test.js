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
            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-4');
        });

        it('finds session with custom label "bug fixes"', () => {
            const fuse = new Fuse(mockSessions, fuseConfig);
            const results = fuse.search('bug fixes');

            expect(results.length).toBeGreaterThanOrEqual(1);
            const foundIds = results.map(r => r.item.id);
            expect(foundIds).toContain('session-5');
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

        // Should find the exact match
        expect(results.length).toBeGreaterThanOrEqual(1);
        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-4');
        const session4Result = results.find(r => r.item.id === 'session-4');
        expect(session4Result).toBeDefined();
        expect(session4Result.item.customLabel).toBe('integration tests');
    });

    it('user story: developer partially remembers label, types "bug" to find "bug fixes"', () => {
        const fuse = new Fuse(mockSessions, fuseConfig);

        const results = fuse.search('bug');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-5'); // customLabel: "bug fixes"
    });
});

// ============================================================================
// Tests: Edge Cases and Special Characters
// ============================================================================

describe('Edge cases: special characters and unusual labels', () => {
    const edgeCaseSessions = [
        {
            id: 'session-emoji',
            title: 'React Components',
            customLabel: '🚀 production deploy',
            projectPath: '/projects/web',
            tool: 'claude',
            status: 'running',
        },
        {
            id: 'session-symbols',
            title: 'API Tests',
            customLabel: '@critical #bug-fix $urgent',
            projectPath: '/projects/api',
            tool: 'claude',
            status: 'waiting',
        },
        {
            id: 'session-unicode',
            title: 'Database Migration',
            customLabel: 'データベース migration',
            projectPath: '/projects/db',
            tool: 'gemini',
            status: 'idle',
        },
        {
            id: 'session-whitespace-only',
            title: 'Performance',
            customLabel: '   ',
            projectPath: '/projects/perf',
            tool: 'claude',
            status: 'running',
        },
        {
            id: 'session-very-long',
            title: 'Documentation',
            customLabel: 'this is an extremely long custom label that a user might create when they want to add lots of context about what they are working on in this particular session including many details',
            projectPath: '/projects/docs',
            tool: 'claude',
            status: 'idle',
        },
    ];

    it('finds session with emoji in custom label', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);
        const results = fuse.search('🚀');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-emoji');
    });

    it('finds session when searching for text part of emoji label', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);
        const results = fuse.search('production deploy');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-emoji');
    });

    it('finds session with special symbols in label', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);

        // Search for part of the label without symbols
        const results = fuse.search('critical bug-fix');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-symbols');
    });

    it('finds session with unicode characters in label', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);
        const results = fuse.search('データベース');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-unicode');
    });

    it('handles whitespace-only label gracefully', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);

        // Searching for whitespace should not crash
        const results = fuse.search('   ');

        // Whitespace-only label should not match whitespace search meaningfully
        // (Fuse.js will likely trim and return no strong matches)
        expect(() => results.length).not.toThrow();
    });

    it('handles very long labels without crashing', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);

        // Search within the long label
        const results = fuse.search('extremely long custom label');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-very-long');
    });

    it('searches in very long label by partial match', () => {
        const fuse = new Fuse(edgeCaseSessions, fuseConfig);

        // Search for distinctive words from the long label (shorter query works better with fuzzy search)
        const results = fuse.search('extremely long label');

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-very-long');
    });
});

// ============================================================================
// Tests: Disambiguating Sessions with Similar Metadata
// ============================================================================

describe('Disambiguation: sessions with identical labels but different metadata', () => {
    const duplicateLabelSessions = [
        {
            id: 'session-dup-1',
            title: 'Backend API',
            customLabel: 'testing',
            projectPath: '/projects/api-v1',
            tool: 'claude',
            status: 'running',
        },
        {
            id: 'session-dup-2',
            title: 'Backend API',
            customLabel: 'testing',
            projectPath: '/projects/api-v2',
            tool: 'claude',
            status: 'waiting',
        },
        {
            id: 'session-dup-3',
            title: 'Backend API',
            customLabel: 'testing',
            projectPath: '/projects/api-v3',
            tool: 'gemini',
            status: 'idle',
        },
    ];

    it('finds all sessions with identical label and title but different paths', () => {
        const fuse = new Fuse(duplicateLabelSessions, fuseConfig);
        const results = fuse.search('testing');

        // All three should be found
        expect(results.length).toBeGreaterThanOrEqual(3);

        const foundIds = results.map(r => r.item.id);
        expect(foundIds).toContain('session-dup-1');
        expect(foundIds).toContain('session-dup-2');
        expect(foundIds).toContain('session-dup-3');
    });

    it('can narrow down results by combining label with project path', () => {
        const fuse = new Fuse(duplicateLabelSessions, fuseConfig);
        const results = fuse.search('testing v2');

        // Should find and prioritize the v2 session
        expect(results.length).toBeGreaterThan(0);
        const v2Session = results.find(r => r.item.projectPath === '/projects/api-v2');
        expect(v2Session).toBeDefined();
        expect(v2Session.item.id).toBe('session-dup-2');
    });

    it('differentiates sessions by tool type when labels match', () => {
        const fuse = new Fuse(duplicateLabelSessions, fuseConfig);

        // All sessions have the same label, but we can verify different tools exist
        const allSessions = duplicateLabelSessions;
        const tools = new Set(allSessions.map(s => s.tool));

        expect(tools.has('claude')).toBe(true);
        expect(tools.has('gemini')).toBe(true);

        // When searching by label alone, all sessions are found
        const results = fuse.search('testing');
        expect(results.length).toBe(3);

        // Verify we can distinguish by checking the tool field
        const geminiSession = results.find(r => r.item.tool === 'gemini');
        expect(geminiSession).toBeDefined();
        expect(geminiSession.item.id).toBe('session-dup-3');
    });
});

// ============================================================================
// Tests: Label Precedence and Scoring
// ============================================================================

describe('Label search precedence and scoring', () => {
    const precedenceSessions = [
        {
            id: 'label-exact',
            title: 'Frontend Work',
            customLabel: 'refactor',
            projectPath: '/projects/web',
            tool: 'claude',
            status: 'running',
        },
        {
            id: 'title-exact',
            title: 'refactor',
            customLabel: 'backend work',
            projectPath: '/projects/api',
            tool: 'claude',
            status: 'running',
        },
        {
            id: 'path-match',
            title: 'Database Schema',
            customLabel: 'migration',
            projectPath: '/projects/refactor-2024',
            tool: 'claude',
            status: 'running',
        },
    ];

    it('prioritizes label match over project path match when weights are equal', () => {
        const fuse = new Fuse(precedenceSessions, fuseConfig);
        const results = fuse.search('refactor');

        // Sessions with "refactor" in label or title should rank above path-only match
        const topTwo = results.slice(0, 2).map(r => r.item.id);

        expect(topTwo).toContain('label-exact');
        expect(topTwo).toContain('title-exact');
    });

    it('label and title have equal weight (both should score similarly)', () => {
        const fuse = new Fuse(precedenceSessions, fuseConfig);
        const results = fuse.search('refactor');

        // Find the label match and title match in results
        const labelMatch = results.find(r => r.item.id === 'label-exact');
        const titleMatch = results.find(r => r.item.id === 'title-exact');

        // Both should have similar scores (within reasonable threshold)
        expect(labelMatch.score).toBeDefined();
        expect(titleMatch.score).toBeDefined();

        // Scores should be close (difference < 0.1 suggests equal weighting)
        const scoreDiff = Math.abs(labelMatch.score - titleMatch.score);
        expect(scoreDiff).toBeLessThan(0.15);
    });
});
