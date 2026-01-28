import { useState, useEffect, useRef, useCallback } from 'react';
import { createSearchManager } from './utils/searchUtils';
import { useFocusManagement } from './utils/focusManagement';
import './Search.css';

export default function Search({ terminal, searchAddon, onClose, focusTrigger }) {
    const [query, setQuery] = useState('');
    const [matchInfo, setMatchInfo] = useState(null); // { total, current }
    const inputRef = useRef(null);
    const searchManagerRef = useRef(null);

    // Save focus on mount for restoration when search closes
    useFocusManagement(true);

    // Initialize search manager when terminal is available
    useEffect(() => {
        if (terminal) {
            searchManagerRef.current = createSearchManager(terminal);
        }
        return () => {
            searchManagerRef.current?.dispose();
            searchManagerRef.current = null;
        };
    }, [terminal]);

    // Focus input on mount and whenever focusTrigger changes (Cmd+F pressed again)
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select(); // Also select text for easy replacement
    }, [focusTrigger]);

    // Handle search with debouncing for performance
    const doSearch = useCallback((searchQuery, direction = 'next') => {
        // Use xterm's SearchAddon for highlighting (if available)
        if (searchAddon && searchQuery) {
            const options = {
                regex: false,
                wholeWord: false,
                caseSensitive: false,
                incremental: true,
            };

            if (direction === 'next') {
                searchAddon.findNext(searchQuery, options);
            } else {
                searchAddon.findPrevious(searchQuery, options);
            }
        }

        // Use our custom search manager for counting
        if (!searchManagerRef.current || !searchQuery) {
            setMatchInfo(null);
            return;
        }

        let result;
        if (direction === 'search') {
            // Initial search
            result = searchManagerRef.current.search(searchQuery);
        } else if (direction === 'next') {
            // If query hasn't changed, navigate to next
            const state = searchManagerRef.current.getState();
            if (state.query === searchQuery && state.total > 0) {
                result = searchManagerRef.current.next();
            } else {
                // New query - do initial search
                result = searchManagerRef.current.search(searchQuery);
            }
        } else {
            // Previous
            const state = searchManagerRef.current.getState();
            if (state.query === searchQuery && state.total > 0) {
                result = searchManagerRef.current.previous();
            } else {
                // New query - do initial search
                result = searchManagerRef.current.search(searchQuery);
            }
        }

        if (result.total > 0) {
            setMatchInfo({ total: result.total, current: result.current });
        } else {
            setMatchInfo({ total: 0, current: 0 });
        }
    }, [searchAddon]);

    // Handle input change
    const handleChange = (e) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        doSearch(newQuery, 'search');
    };

    // Handle keyboard
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            // Clear search state before closing
            searchManagerRef.current?.clear();
            onClose?.();
        } else if (e.key === 'Enter') {
            if (e.shiftKey) {
                doSearch(query, 'prev');
            } else {
                doSearch(query, 'next');
            }
        }
    };

    // Render match info
    const renderMatchInfo = () => {
        if (!matchInfo) return null;

        if (matchInfo.total === 0) {
            return <span className="no-matches">No matches</span>;
        }

        return (
            <span className="match-count">
                ({matchInfo.current}/{matchInfo.total})
            </span>
        );
    };

    return (
        <div className="search-overlay">
            <div className="search-box">
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Search..."
                    data-testid="search-input"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                />
                <span className="search-status">
                    {renderMatchInfo()}
                </span>
                <span className="search-hint">
                    Enter: next | Shift+Enter: prev | Esc: close
                </span>
            </div>
        </div>
    );
}
