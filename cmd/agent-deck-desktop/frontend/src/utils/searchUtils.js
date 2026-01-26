/**
 * searchUtils.js - Enhanced terminal search with match counting and row highlighting
 *
 * Provides custom search functionality on top of xterm.js SearchAddon:
 * - Scans terminal buffer to count all matches
 * - Tracks current match position for navigation
 * - Creates row decorations for visual highlighting
 */

// Color scheme for highlighting
const COLORS = {
    ROW_HIGHLIGHT: 'rgba(255, 213, 0, 0.15)',     // Light yellow - full row
    MATCH_HIGHLIGHT: 'rgba(255, 213, 0, 0.4)',    // Medium yellow - match text
    ACTIVE_MATCH: 'rgba(255, 165, 0, 0.6)',       // Orange - current match
};

/**
 * Find all matches of a query in the terminal buffer
 *
 * @param {Terminal} terminal - xterm.js terminal instance
 * @param {string} query - Search query (case-insensitive)
 * @returns {Array<{row: number, startCol: number, endCol: number, text: string}>}
 */
export function findAllMatches(terminal, query) {
    if (!terminal || !query || query.length === 0) {
        return [];
    }

    const matches = [];
    const buffer = terminal.buffer.active;
    const searchLower = query.toLowerCase();

    // Scan all lines in the buffer (viewport + scrollback)
    for (let y = 0; y < buffer.length; y++) {
        const line = buffer.getLine(y);
        if (!line) continue;

        const lineText = line.translateToString();
        const lineLower = lineText.toLowerCase();

        // Find all occurrences in this line
        let startIndex = 0;
        while (true) {
            const matchIndex = lineLower.indexOf(searchLower, startIndex);
            if (matchIndex === -1) break;

            matches.push({
                row: y,
                startCol: matchIndex,
                endCol: matchIndex + query.length,
                text: lineText.substring(matchIndex, matchIndex + query.length),
            });

            startIndex = matchIndex + 1; // Continue searching after this match
        }
    }

    return matches;
}

/**
 * Create a search manager for a terminal instance
 *
 * @param {Terminal} terminal - xterm.js terminal instance
 * @returns {{
 *   search: (query: string) => {total: number, current: number},
 *   next: () => {total: number, current: number},
 *   previous: () => {total: number, current: number},
 *   clear: () => void,
 *   getState: () => {total: number, current: number, query: string},
 *   dispose: () => void
 * }}
 */
export function createSearchManager(terminal) {
    let matches = [];
    let currentIndex = -1;
    let currentQuery = '';
    let decorations = [];
    let disposed = false;

    /**
     * Clear all decorations
     */
    const clearDecorations = () => {
        for (const decoration of decorations) {
            try {
                decoration.dispose();
            } catch (e) {
                // Decoration may already be disposed
            }
        }
        decorations = [];
    };

    /**
     * Create row decoration for a match
     */
    const createRowDecoration = (row, isActive) => {
        if (!terminal || disposed) return null;

        try {
            const marker = terminal.registerMarker(row - terminal.buffer.active.baseY);
            if (!marker) return null;

            const decoration = terminal.registerDecoration({
                marker,
                width: terminal.cols,
                backgroundColor: isActive ? COLORS.ACTIVE_MATCH : COLORS.ROW_HIGHLIGHT,
            });

            if (decoration) {
                decoration.onRender((element) => {
                    element.style.backgroundColor = isActive ? COLORS.ACTIVE_MATCH : COLORS.ROW_HIGHLIGHT;
                    element.style.width = '100%';
                    element.style.opacity = '1';
                });
            }

            return decoration;
        } catch (e) {
            return null;
        }
    };

    /**
     * Create decorations for all matches
     */
    const createDecorations = () => {
        clearDecorations();

        if (!terminal || disposed || matches.length === 0) return;

        // Get unique rows with matches
        const rowsWithMatches = new Set(matches.map(m => m.row));

        // Create a decoration for each unique row
        for (const row of rowsWithMatches) {
            const isCurrentRow = currentIndex >= 0 && matches[currentIndex]?.row === row;
            const decoration = createRowDecoration(row, isCurrentRow);
            if (decoration) {
                decorations.push(decoration);
            }
        }
    };

    /**
     * Scroll to current match
     */
    const scrollToCurrentMatch = () => {
        if (!terminal || disposed || currentIndex < 0 || !matches[currentIndex]) return;

        const match = matches[currentIndex];
        const viewportTop = terminal.buffer.active.viewportY;
        const viewportBottom = viewportTop + terminal.rows - 1;

        // If match is outside viewport, scroll to it
        if (match.row < viewportTop || match.row > viewportBottom) {
            // Scroll so match is in the middle of viewport
            const targetY = Math.max(0, match.row - Math.floor(terminal.rows / 2));
            terminal.scrollToLine(targetY);
        }
    };

    /**
     * Search for a query
     */
    const search = (query) => {
        if (disposed) return { total: 0, current: 0 };

        currentQuery = query;

        if (!query || query.length === 0) {
            matches = [];
            currentIndex = -1;
            clearDecorations();
            return { total: 0, current: 0 };
        }

        // Find all matches
        matches = findAllMatches(terminal, query);

        if (matches.length === 0) {
            currentIndex = -1;
            clearDecorations();
            return { total: 0, current: 0 };
        }

        // Start at first match
        currentIndex = 0;
        createDecorations();
        scrollToCurrentMatch();

        return { total: matches.length, current: 1 };
    };

    /**
     * Navigate to next match
     */
    const next = () => {
        if (disposed || matches.length === 0) {
            return { total: 0, current: 0 };
        }

        // Wrap around
        currentIndex = (currentIndex + 1) % matches.length;
        createDecorations();
        scrollToCurrentMatch();

        return { total: matches.length, current: currentIndex + 1 };
    };

    /**
     * Navigate to previous match
     */
    const previous = () => {
        if (disposed || matches.length === 0) {
            return { total: 0, current: 0 };
        }

        // Wrap around
        currentIndex = currentIndex <= 0 ? matches.length - 1 : currentIndex - 1;
        createDecorations();
        scrollToCurrentMatch();

        return { total: matches.length, current: currentIndex + 1 };
    };

    /**
     * Clear search state
     */
    const clear = () => {
        matches = [];
        currentIndex = -1;
        currentQuery = '';
        clearDecorations();
    };

    /**
     * Get current search state
     */
    const getState = () => ({
        total: matches.length,
        current: currentIndex >= 0 ? currentIndex + 1 : 0,
        query: currentQuery,
    });

    /**
     * Dispose of the search manager
     */
    const dispose = () => {
        disposed = true;
        clear();
    };

    return {
        search,
        next,
        previous,
        clear,
        getState,
        dispose,
    };
}
