/**
 * Tests for enhanced terminal search utilities
 *
 * Tests findAllMatches() for buffer scanning and createSearchManager()
 * for match counting, navigation, and row decorations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findAllMatches, createSearchManager } from '../utils/searchUtils';

/**
 * Create a mock terminal for testing
 * @param {string[]} lines - Lines of text in the buffer
 * @param {object} options - Optional configuration
 * @param {number} options.baseY - Scrollback offset (default: 0)
 * @param {number} options.cursorY - Cursor Y position in viewport (default: 0)
 * @param {number} options.viewportY - Current viewport position (default: 0)
 * @param {number} options.rows - Visible rows (default: min(lines.length, 24))
 * @param {number} options.cols - Columns (default: 80)
 */
function createMockTerminal(lines = [], options = {}) {
    const {
        baseY = 0,
        cursorY = 0,
        viewportY = 0,
        rows = Math.min(lines.length, 24),
        cols = 80,
    } = options;

    const mockLines = lines.map(text => ({
        translateToString: () => text,
    }));

    const decorations = [];
    const markers = [];

    return {
        buffer: {
            active: {
                length: lines.length,
                baseY,
                cursorY,
                viewportY,
                getLine: (y) => mockLines[y] || null,
            },
        },
        rows,
        cols,
        registerMarker: vi.fn((offset) => {
            const marker = {
                line: offset,
                dispose: vi.fn(),
            };
            markers.push(marker);
            return marker;
        }),
        registerDecoration: vi.fn((options) => {
            const decoration = {
                options,
                onRender: vi.fn((callback) => callback(document.createElement('div'))),
                dispose: vi.fn(),
            };
            decorations.push(decoration);
            return decoration;
        }),
        scrollToLine: vi.fn(),
        // Expose for test assertions
        _decorations: decorations,
        _markers: markers,
    };
}

describe('findAllMatches', () => {
    describe('basic matching', () => {
        it('returns empty array for null terminal', () => {
            expect(findAllMatches(null, 'test')).toEqual([]);
        });

        it('returns empty array for empty query', () => {
            const terminal = createMockTerminal(['hello world']);
            expect(findAllMatches(terminal, '')).toEqual([]);
            expect(findAllMatches(terminal, null)).toEqual([]);
        });

        it('finds single match in single line', () => {
            const terminal = createMockTerminal(['hello world']);

            const matches = findAllMatches(terminal, 'world');

            expect(matches).toHaveLength(1);
            expect(matches[0]).toEqual({
                row: 0,
                startCol: 6,
                endCol: 11,
                text: 'world',
            });
        });

        it('finds match at beginning of line', () => {
            const terminal = createMockTerminal(['hello world']);

            const matches = findAllMatches(terminal, 'hello');

            expect(matches).toHaveLength(1);
            expect(matches[0].startCol).toBe(0);
            expect(matches[0].endCol).toBe(5);
        });

        it('finds match at end of line', () => {
            const terminal = createMockTerminal(['test string']);

            const matches = findAllMatches(terminal, 'string');

            expect(matches).toHaveLength(1);
            expect(matches[0].startCol).toBe(5);
            expect(matches[0].endCol).toBe(11);
        });
    });

    describe('multiple matches', () => {
        it('finds multiple matches in same line', () => {
            const terminal = createMockTerminal(['foo bar foo baz foo']);

            const matches = findAllMatches(terminal, 'foo');

            expect(matches).toHaveLength(3);
            expect(matches[0].startCol).toBe(0);
            expect(matches[1].startCol).toBe(8);
            expect(matches[2].startCol).toBe(16);
        });

        it('finds matches across multiple lines', () => {
            const terminal = createMockTerminal([
                'first line with test',
                'second line',
                'third line with test too',
            ]);

            const matches = findAllMatches(terminal, 'test');

            expect(matches).toHaveLength(2);
            expect(matches[0].row).toBe(0);
            expect(matches[1].row).toBe(2);
        });

        it('finds overlapping matches with correct endCol', () => {
            const terminal = createMockTerminal(['aaaa']);

            const matches = findAllMatches(terminal, 'aa');

            // 'aaaa' contains 'aa' at positions 0, 1, 2
            expect(matches).toHaveLength(3);

            // Verify both startCol and endCol for each match
            expect(matches[0]).toEqual({ row: 0, startCol: 0, endCol: 2, text: 'aa' });
            expect(matches[1]).toEqual({ row: 0, startCol: 1, endCol: 3, text: 'aa' });
            expect(matches[2]).toEqual({ row: 0, startCol: 2, endCol: 4, text: 'aa' });
        });
    });

    describe('case insensitivity', () => {
        it('matches regardless of case', () => {
            const terminal = createMockTerminal([
                'Hello World',
                'HELLO WORLD',
                'hello world',
            ]);

            const matches = findAllMatches(terminal, 'hello');

            expect(matches).toHaveLength(3);
        });

        it('preserves original text in match result', () => {
            const terminal = createMockTerminal(['HeLLo WoRLD']);

            const matches = findAllMatches(terminal, 'hello');

            expect(matches[0].text).toBe('HeLLo'); // Preserves original case
        });
    });

    describe('special characters', () => {
        it('matches text with special regex characters', () => {
            const terminal = createMockTerminal(['test.foo() and test.bar()']);

            // Note: findAllMatches uses indexOf, not regex, so . is literal
            const matches = findAllMatches(terminal, 'test.foo');

            expect(matches).toHaveLength(1);
            expect(matches[0].startCol).toBe(0);
        });

        it('matches brackets and parentheses', () => {
            const terminal = createMockTerminal(['array[0] = (a + b)']);

            const matches = findAllMatches(terminal, '[0]');

            expect(matches).toHaveLength(1);
        });

        it('matches paths with slashes', () => {
            const terminal = createMockTerminal(['cd /usr/local/bin']);

            const matches = findAllMatches(terminal, '/usr/local');

            expect(matches).toHaveLength(1);
            expect(matches[0].startCol).toBe(3);
        });
    });

    describe('empty lines', () => {
        it('handles empty lines in buffer', () => {
            const terminal = createMockTerminal([
                'first',
                '',
                'third',
            ]);

            const matches = findAllMatches(terminal, 'ir');

            expect(matches).toHaveLength(2);
            expect(matches[0].row).toBe(0);
            expect(matches[1].row).toBe(2);
        });

        it('handles buffer with all empty lines', () => {
            const terminal = createMockTerminal(['', '', '']);

            const matches = findAllMatches(terminal, 'test');

            expect(matches).toHaveLength(0);
        });
    });

    describe('edge cases', () => {
        it('handles single character matches', () => {
            const terminal = createMockTerminal(['a b a c a']);

            const matches = findAllMatches(terminal, 'a');

            expect(matches).toHaveLength(3);
        });

        it('handles very long lines', () => {
            const longLine = 'x'.repeat(1000) + 'find me' + 'x'.repeat(1000);
            const terminal = createMockTerminal([longLine]);

            const matches = findAllMatches(terminal, 'find me');

            expect(matches).toHaveLength(1);
            expect(matches[0].startCol).toBe(1000);
        });

        it('handles many lines', () => {
            const lines = Array(1000).fill('test line');
            const terminal = createMockTerminal(lines);

            const matches = findAllMatches(terminal, 'test');

            expect(matches).toHaveLength(1000);
        });

        it('handles query longer than any line content', () => {
            const terminal = createMockTerminal(['short', 'tiny']);

            const matches = findAllMatches(terminal, 'this query is much longer than any line');

            expect(matches).toHaveLength(0);
        });

        it('handles whitespace-only query', () => {
            const terminal = createMockTerminal(['hello world', 'foo  bar']);

            const matches = findAllMatches(terminal, ' ');

            // Should find spaces
            expect(matches.length).toBeGreaterThan(0);
        });

        it('finds emoji characters in content', () => {
            const terminal = createMockTerminal(['✅ test passed', '❌ test failed', '⚠️ warning']);

            const matches = findAllMatches(terminal, '✅');

            expect(matches).toHaveLength(1);
            expect(matches[0].row).toBe(0);
            expect(matches[0].text).toBe('✅');
        });

        it('finds CJK characters', () => {
            const terminal = createMockTerminal(['日本語テスト', '中文测试', 'English test']);

            const matches = findAllMatches(terminal, '日本語');

            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe('日本語');
        });

        it('finds accented characters', () => {
            const terminal = createMockTerminal(['café résumé', 'naïve über']);

            const matches = findAllMatches(terminal, 'café');

            expect(matches).toHaveLength(1);
            expect(matches[0].text).toBe('café');
        });

        it('finds combining characters', () => {
            // é can be represented as e + combining acute accent
            const terminal = createMockTerminal(['résumé test', 'normal text']);

            const matches = findAllMatches(terminal, 'résumé');

            expect(matches).toHaveLength(1);
        });

        it('handles mixed unicode and ASCII', () => {
            const terminal = createMockTerminal(['Error: 文件未找到', '✓ Success', 'Done']);

            const matches = findAllMatches(terminal, 'Error');

            expect(matches).toHaveLength(1);
            expect(matches[0].row).toBe(0);
        });

        it('handles multi-byte emoji with text search', () => {
            const terminal = createMockTerminal(['👨‍👩‍👧‍👦 family', 'test 🎉 celebration']);

            const matches = findAllMatches(terminal, 'family');

            expect(matches).toHaveLength(1);
        });
    });
});

describe('createSearchManager', () => {
    describe('initialization', () => {
        it('starts with empty state', () => {
            const terminal = createMockTerminal([]);
            const manager = createSearchManager(terminal);

            const state = manager.getState();

            expect(state.total).toBe(0);
            expect(state.current).toBe(0);
            expect(state.query).toBe('');
        });
    });

    describe('search()', () => {
        it('returns match count for valid query', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            const result = manager.search('foo');

            expect(result.total).toBe(2);
            expect(result.current).toBe(1); // Starts at first match
        });

        it('returns zero for no matches', () => {
            const terminal = createMockTerminal(['hello world']);
            const manager = createSearchManager(terminal);

            const result = manager.search('xyz');

            expect(result.total).toBe(0);
            expect(result.current).toBe(0);
        });

        it('returns zero for empty query', () => {
            const terminal = createMockTerminal(['hello world']);
            const manager = createSearchManager(terminal);

            const result = manager.search('');

            expect(result.total).toBe(0);
            expect(result.current).toBe(0);
        });

        it('updates state correctly', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');

            const state = manager.getState();
            expect(state.total).toBe(2);
            expect(state.current).toBe(1);
            expect(state.query).toBe('foo');
        });

        it('resets state on new search', () => {
            const terminal = createMockTerminal(['foo bar baz']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.next(); // Move to would-be next match
            manager.search('bar'); // New search

            const state = manager.getState();
            expect(state.query).toBe('bar');
            expect(state.current).toBe(1); // Reset to first match
        });
    });

    describe('next()', () => {
        it('navigates to next match', () => {
            const terminal = createMockTerminal(['foo bar foo baz foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            expect(manager.getState().current).toBe(1);

            manager.next();
            expect(manager.getState().current).toBe(2);

            manager.next();
            expect(manager.getState().current).toBe(3);
        });

        it('wraps around to first match', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            expect(manager.getState().current).toBe(1);

            manager.next();
            expect(manager.getState().current).toBe(2);

            manager.next(); // Wrap around
            expect(manager.getState().current).toBe(1);
        });

        it('returns zero when no matches', () => {
            const terminal = createMockTerminal(['hello']);
            const manager = createSearchManager(terminal);

            manager.search('xyz');
            const result = manager.next();

            expect(result.total).toBe(0);
            expect(result.current).toBe(0);
        });
    });

    describe('previous()', () => {
        it('navigates to previous match', () => {
            const terminal = createMockTerminal(['foo bar foo baz foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.next();
            manager.next();
            expect(manager.getState().current).toBe(3);

            manager.previous();
            expect(manager.getState().current).toBe(2);

            manager.previous();
            expect(manager.getState().current).toBe(1);
        });

        it('wraps around to last match', () => {
            const terminal = createMockTerminal(['foo bar foo baz foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            expect(manager.getState().current).toBe(1);

            manager.previous(); // Wrap around
            expect(manager.getState().current).toBe(3);
        });

        it('returns zero when no matches', () => {
            const terminal = createMockTerminal(['hello']);
            const manager = createSearchManager(terminal);

            manager.search('xyz');
            const result = manager.previous();

            expect(result.total).toBe(0);
            expect(result.current).toBe(0);
        });
    });

    describe('clear()', () => {
        it('resets all state', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.next();
            manager.clear();

            const state = manager.getState();
            expect(state.total).toBe(0);
            expect(state.current).toBe(0);
            expect(state.query).toBe('');
        });
    });

    describe('dispose()', () => {
        it('prevents further operations', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.dispose();

            // After dispose, operations should return empty results
            const searchResult = manager.search('foo');
            expect(searchResult.total).toBe(0);

            const nextResult = manager.next();
            expect(nextResult.total).toBe(0);
        });

        it('clears existing state', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.dispose();

            const state = manager.getState();
            expect(state.total).toBe(0);
            expect(state.current).toBe(0);
        });
    });

    describe('row decorations', () => {
        it('creates decorations for each unique row with matches', () => {
            const terminal = createMockTerminal([
                'foo bar',
                'baz foo',
                'qux',
            ]);
            const manager = createSearchManager(terminal);

            manager.search('foo');

            // Should have decorations for rows 0 and 1
            expect(terminal.registerDecoration).toHaveBeenCalledTimes(2);
        });

        it('creates decoration with correct marker and width', () => {
            const terminal = createMockTerminal(['foo bar'], { cols: 120 });
            const manager = createSearchManager(terminal);

            manager.search('foo');

            const decorationCall = terminal.registerDecoration.mock.calls[0][0];
            expect(decorationCall).toHaveProperty('marker');
            expect(decorationCall).toHaveProperty('width', 120); // Full terminal width
        });

        it('creates one decoration per unique row', () => {
            const terminal = createMockTerminal(['foo bar foo foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');

            // 3 matches on row 0, but only 1 decoration
            expect(terminal.registerDecoration).toHaveBeenCalledTimes(1);
        });

        it('creates decorations for multiple rows', () => {
            const terminal = createMockTerminal([
                'error on line 1',
                'normal text',
                'another error here',
                'more text',
                'final error',
            ]);
            const manager = createSearchManager(terminal);

            manager.search('error');

            // Should create decorations for rows 0, 2, and 4
            expect(terminal.registerDecoration).toHaveBeenCalledTimes(3);
        });

        it('clears decorations on new search', () => {
            const terminal = createMockTerminal(['foo bar', 'baz qux']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            const firstDecorations = [...terminal._decorations];

            manager.search('baz');

            // Previous decorations should be disposed
            for (const decoration of firstDecorations) {
                expect(decoration.dispose).toHaveBeenCalled();
            }
        });

        it('clears decorations on clear()', () => {
            const terminal = createMockTerminal(['foo bar']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            const decorations = [...terminal._decorations];

            manager.clear();

            for (const decoration of decorations) {
                expect(decoration.dispose).toHaveBeenCalled();
            }
        });

        it('handles decoration dispose throwing error', () => {
            const terminal = createMockTerminal(['foo bar', 'foo baz']);
            const manager = createSearchManager(terminal);

            manager.search('foo');

            // Make dispose throw on first decoration
            terminal._decorations[0].dispose = vi.fn(() => {
                throw new Error('Already disposed');
            });

            // Should not throw when clearing
            expect(() => manager.clear()).not.toThrow();
        });
    });

    describe('scroll behavior', () => {
        it('scrolls to match outside viewport', () => {
            const lines = Array(100).fill('some text');
            lines[50] = 'find this term';

            const terminal = createMockTerminal(lines, { rows: 24 });

            const manager = createSearchManager(terminal);
            manager.search('find this');

            expect(terminal.scrollToLine).toHaveBeenCalled();
        });

        it('scrolls to correct line (centered in viewport)', () => {
            const lines = Array(100).fill('some text');
            lines[50] = 'find this term';

            const terminal = createMockTerminal(lines, { rows: 24 });

            const manager = createSearchManager(terminal);
            manager.search('find this');

            // Should center the match: row 50 - floor(24/2) = 50 - 12 = 38
            const scrollCall = terminal.scrollToLine.mock.calls[0];
            expect(scrollCall[0]).toBe(38);
        });

        it('does not scroll when match is in viewport', () => {
            const terminal = createMockTerminal([
                'line 1',
                'find me',
                'line 3',
            ], { rows: 10 });

            const manager = createSearchManager(terminal);
            manager.search('find');

            // Match is on row 1, viewport shows 0-9, no scroll needed
            expect(terminal.scrollToLine).not.toHaveBeenCalled();
        });

        it('clamps scroll target to zero for matches near top', () => {
            const lines = Array(100).fill('some text');
            lines[5] = 'find this';

            // Set viewport to position 30, so row 5 is above viewport
            const terminal = createMockTerminal(lines, { rows: 24, viewportY: 30 });

            const manager = createSearchManager(terminal);
            manager.search('find this');

            // Row 5 - 12 = -7, should clamp to 0
            const scrollCall = terminal.scrollToLine.mock.calls[0];
            expect(scrollCall[0]).toBe(0);
        });

        it('scrolls on navigation to match outside viewport', () => {
            const lines = Array(100).fill('some text');
            lines[5] = 'find this';
            lines[80] = 'find this';

            const terminal = createMockTerminal(lines, { rows: 24, viewportY: 0 });

            const manager = createSearchManager(terminal);
            manager.search('find this');

            // First match is visible, no scroll
            terminal.scrollToLine.mockClear();

            // Navigate to second match at row 80 (outside viewport)
            terminal.buffer.active.viewportY = 0; // Still at top
            manager.next();

            expect(terminal.scrollToLine).toHaveBeenCalled();
        });
    });

    describe('baseY and cursorY offset handling', () => {
        it('creates markers with correct offset accounting for baseY and cursorY', () => {
            const lines = Array(50).fill('some text');
            lines[10] = 'find me';

            // Simulate scrollback: baseY is 100, cursor at row 5 in viewport
            const terminal = createMockTerminal(lines, { baseY: 100, cursorY: 5 });

            const manager = createSearchManager(terminal);
            manager.search('find');

            // Marker offset should be: row - baseY - cursorY = 10 - 100 - 5 = -95
            expect(terminal.registerMarker).toHaveBeenCalled();
            const markerCall = terminal.registerMarker.mock.calls[0];
            expect(markerCall[0]).toBe(10 - 100 - 5); // -95
        });

        it('handles matches with cursor at different positions', () => {
            const lines = ['line1', 'find me', 'line3'];
            const terminal = createMockTerminal(lines, { baseY: 0, cursorY: 10 });

            const manager = createSearchManager(terminal);
            manager.search('find');

            // Match is at row 1, offset = 1 - 0 - 10 = -9
            expect(terminal.registerMarker).toHaveBeenCalled();
            const markerCall = terminal.registerMarker.mock.calls[0];
            expect(markerCall[0]).toBe(1 - 0 - 10); // -9
        });

        it('handles matches in scrollback with positive baseY', () => {
            const lines = ['line1', 'find me', 'line3'];
            const terminal = createMockTerminal(lines, { baseY: 50, cursorY: 0 });

            const manager = createSearchManager(terminal);
            manager.search('find');

            // Should still find the match
            expect(manager.getState().total).toBe(1);
        });
    });

    describe('integration scenarios', () => {
        it('handles typical search workflow', () => {
            const terminal = createMockTerminal([
                'Error: file not found',
                'Processing...',
                'Error: permission denied',
                'Done',
                'Error: timeout',
            ]);
            const manager = createSearchManager(terminal);

            // Search for errors
            const result = manager.search('Error');
            expect(result.total).toBe(3);
            expect(result.current).toBe(1);

            // Navigate through results
            manager.next();
            expect(manager.getState().current).toBe(2);

            manager.next();
            expect(manager.getState().current).toBe(3);

            // Wrap around
            manager.next();
            expect(manager.getState().current).toBe(1);

            // Go back
            manager.previous();
            expect(manager.getState().current).toBe(3);

            // Clear and search for something else
            manager.clear();
            expect(manager.getState().total).toBe(0);

            manager.search('Done');
            expect(manager.getState().total).toBe(1);
            expect(manager.getState().current).toBe(1);
        });

        it('handles rapid consecutive searches', () => {
            const terminal = createMockTerminal(['abc def ghi']);
            const manager = createSearchManager(terminal);

            manager.search('a');
            manager.search('ab');
            manager.search('abc');

            const state = manager.getState();
            expect(state.query).toBe('abc');
            expect(state.total).toBe(1);
        });

        it('handles terminal with no content', () => {
            const terminal = createMockTerminal([]);
            const manager = createSearchManager(terminal);

            const result = manager.search('test');

            expect(result.total).toBe(0);
            expect(result.current).toBe(0);
        });
    });

    describe('error resilience', () => {
        it('handles marker returning null gracefully', () => {
            const terminal = createMockTerminal(['foo bar']);
            terminal.registerMarker = vi.fn(() => null);

            const manager = createSearchManager(terminal);
            const result = manager.search('foo');

            // Should still count matches even if decorations fail
            expect(result.total).toBe(1);
            expect(result.current).toBe(1);
        });

        it('handles decoration returning null gracefully', () => {
            const terminal = createMockTerminal(['foo bar']);
            terminal.registerDecoration = vi.fn(() => null);

            const manager = createSearchManager(terminal);
            const result = manager.search('foo');

            // Should still work without decorations
            expect(result.total).toBe(1);
            expect(result.current).toBe(1);
        });

        it('handles getLine returning null for valid index', () => {
            const terminal = createMockTerminal(['foo', 'bar', 'foo']);
            // Override getLine to return null for middle line
            terminal.buffer.active.getLine = (y) => {
                if (y === 1) return null;
                return { translateToString: () => ['foo', 'bar', 'foo'][y] };
            };

            const manager = createSearchManager(terminal);
            const result = manager.search('foo');

            // Should still find matches on lines 0 and 2
            expect(result.total).toBe(2);
        });

        it('handles repeated dispose calls', () => {
            const terminal = createMockTerminal(['foo bar']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.dispose();
            manager.dispose(); // Should not throw

            expect(manager.getState().total).toBe(0);
        });

        it('handles navigation after clear', () => {
            const terminal = createMockTerminal(['foo bar foo']);
            const manager = createSearchManager(terminal);

            manager.search('foo');
            manager.clear();

            // Navigation after clear should return zeros
            expect(manager.next()).toEqual({ total: 0, current: 0 });
            expect(manager.previous()).toEqual({ total: 0, current: 0 });
        });

        it('handles navigation before any search', () => {
            const terminal = createMockTerminal(['foo bar']);
            const manager = createSearchManager(terminal);

            // Navigation before search should return zeros
            expect(manager.next()).toEqual({ total: 0, current: 0 });
            expect(manager.previous()).toEqual({ total: 0, current: 0 });
        });

        it('handles null terminal in createSearchManager', () => {
            const manager = createSearchManager(null);

            expect(manager.search('foo')).toEqual({ total: 0, current: 0 });
            expect(manager.next()).toEqual({ total: 0, current: 0 });
            expect(manager.previous()).toEqual({ total: 0, current: 0 });
            expect(() => manager.dispose()).not.toThrow();
        });

        it('handles undefined terminal in createSearchManager', () => {
            const manager = createSearchManager(undefined);

            expect(manager.search('foo')).toEqual({ total: 0, current: 0 });
            expect(() => manager.clear()).not.toThrow();
        });
    });

    describe('state consistency', () => {
        it('maintains correct current index through navigation cycle', () => {
            const terminal = createMockTerminal(['a b a c a d a']);
            const manager = createSearchManager(terminal);

            manager.search('a');
            const total = manager.getState().total;

            // Navigate forward through all matches and back to start
            for (let i = 0; i < total; i++) {
                manager.next();
            }

            // Should be back at position 1
            expect(manager.getState().current).toBe(1);
        });

        it('maintains correct current index through reverse navigation cycle', () => {
            const terminal = createMockTerminal(['a b a c a d a']);
            const manager = createSearchManager(terminal);

            manager.search('a');
            const total = manager.getState().total;

            // Navigate backward through all matches and back to start
            for (let i = 0; i < total; i++) {
                manager.previous();
            }

            // Should be back at position 1
            expect(manager.getState().current).toBe(1);
        });

        it('returns consistent state after each operation', () => {
            const terminal = createMockTerminal(['test one', 'test two', 'test three']);
            const manager = createSearchManager(terminal);

            // Initial state
            let state = manager.getState();
            expect(state.total).toBe(0);
            expect(state.current).toBe(0);
            expect(state.query).toBe('');

            // After search
            manager.search('test');
            state = manager.getState();
            expect(state.total).toBe(3);
            expect(state.current).toBe(1);
            expect(state.query).toBe('test');

            // After next
            manager.next();
            state = manager.getState();
            expect(state.total).toBe(3);
            expect(state.current).toBe(2);
            expect(state.query).toBe('test');

            // After clear
            manager.clear();
            state = manager.getState();
            expect(state.total).toBe(0);
            expect(state.current).toBe(0);
            expect(state.query).toBe('');
        });
    });
});
