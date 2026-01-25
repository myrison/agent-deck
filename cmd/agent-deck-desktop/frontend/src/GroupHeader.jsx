import { useCallback } from 'react';
import './GroupHeader.css';

/**
 * GroupHeader renders a collapsible group row with expand/collapse toggle.
 *
 * @param {Object} props
 * @param {Object} props.group - GroupInfo object { name, path, sessionCount, totalCount, level, hasChildren, expanded }
 * @param {boolean} props.isExpanded - Current expanded state (from desktop settings)
 * @param {boolean} props.isSelected - Whether this group row is currently selected
 * @param {function} props.onToggle - Callback when expand/collapse is toggled
 * @param {function} props.onClick - Callback when group row is clicked
 */
export default function GroupHeader({ group, isExpanded, isSelected, onToggle, onClick }) {
    const handleClick = useCallback((e) => {
        e.preventDefault();
        if (onClick) onClick(group);
    }, [group, onClick]);

    const handleToggleClick = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onToggle) onToggle(group.path, !isExpanded);
    }, [group.path, isExpanded, onToggle]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (onToggle) onToggle(group.path, !isExpanded);
        }
    }, [group.path, isExpanded, onToggle]);

    // Determine indent level (CSS custom property for dynamic indentation)
    const indent = group.level * 16; // 16px per level

    // Get session count to display
    const countDisplay = group.hasChildren
        ? `${group.totalCount}`
        : `${group.sessionCount}`;

    return (
        <button
            className={`group-header ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : 'collapsed'}`}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            style={{ paddingLeft: `${12 + indent}px` }}
            data-group-path={group.path}
        >
            <span
                className="group-toggle"
                onClick={handleToggleClick}
                role="button"
                tabIndex={-1}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse group' : 'Expand group'}
            >
                {isExpanded ? '▼' : '▶'}
            </span>
            <span className="group-name">{group.name}</span>
            <span className="group-count">({countDisplay})</span>
        </button>
    );
}
