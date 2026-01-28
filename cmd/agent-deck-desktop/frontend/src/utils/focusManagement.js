/**
 * Focus management utilities for modal dialogs.
 *
 * When a modal opens, it should save the currently focused element.
 * When it closes, focus should be restored to that element (or a fallback).
 */

/**
 * Saves the currently focused element and returns a function to restore focus.
 * Call this when opening a modal to capture what was focused before.
 *
 * @param {HTMLElement} [fallback] - Optional fallback element if original is gone
 * @returns {Function} A function that restores focus when called
 *
 * @example
 * // When opening modal:
 * const restoreFocus = saveFocus();
 *
 * // When closing modal:
 * restoreFocus();
 */
export function saveFocus(fallback = null) {
    const previouslyFocused = document.activeElement;

    return () => {
        // Try to restore to the originally focused element
        if (previouslyFocused && document.contains(previouslyFocused)) {
            // Check if element is still focusable
            if (typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
                return;
            }
        }

        // Try fallback if provided
        if (fallback && document.contains(fallback)) {
            if (typeof fallback.focus === 'function') {
                fallback.focus();
                return;
            }
        }

        // Last resort: blur active element to avoid stuck focus
        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
    };
}

/**
 * React hook for focus management in modals.
 * Automatically saves focus on mount and restores on unmount.
 *
 * @param {boolean} isOpen - Whether the modal is currently open
 * @param {React.RefObject} [fallbackRef] - Optional ref to fallback element
 *
 * @example
 * function MyModal({ isOpen, onClose }) {
 *     useFocusManagement(isOpen);
 *     if (!isOpen) return null;
 *     return <div>...</div>;
 * }
 */
export function useFocusManagement(isOpen, fallbackRef = null) {
    const { useRef, useEffect } = require('react');
    const restoreFocusRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            // Save current focus when modal opens
            const fallback = fallbackRef?.current;
            restoreFocusRef.current = saveFocus(fallback);
        } else if (restoreFocusRef.current) {
            // Restore focus when modal closes
            restoreFocusRef.current();
            restoreFocusRef.current = null;
        }
    }, [isOpen, fallbackRef]);

    // Also restore focus on unmount if modal is still open
    useEffect(() => {
        return () => {
            if (restoreFocusRef.current) {
                restoreFocusRef.current();
            }
        };
    }, []);
}

/**
 * Creates a focus trap that returns focus when the trap is released.
 * Useful for modals that need to ensure focus stays within them.
 *
 * @param {HTMLElement} container - The modal container element
 * @returns {{ release: Function }} Object with release function
 */
export function createFocusTrap(container) {
    const previouslyFocused = document.activeElement;

    return {
        release: () => {
            if (previouslyFocused && document.contains(previouslyFocused)) {
                if (typeof previouslyFocused.focus === 'function') {
                    previouslyFocused.focus();
                }
            }
        }
    };
}
