/**
 * Utility for modal keyboard event isolation.
 *
 * When a modal is open, keyboard events should not leak to parent components
 * (e.g., App.jsx global shortcuts or the terminal behind the modal).
 *
 * This wrapper ensures e.stopPropagation() is called before any handler logic,
 * providing consistent keyboard isolation across all modal components.
 */

/**
 * Wraps a keyboard event handler with stopPropagation to prevent event bubbling.
 * Use this for modal components that need to isolate their keyboard handling.
 *
 * @param {Function} handler - The keyboard event handler to wrap
 * @returns {Function} A wrapped handler that stops propagation before calling the original
 *
 * @example
 * // In a modal component:
 * const handleKeyDown = withKeyboardIsolation((e) => {
 *   if (e.key === 'Escape') onClose();
 * });
 */
export function withKeyboardIsolation(handler) {
    return (e) => {
        // Stop propagation to prevent App.jsx and background components from receiving these events
        e.stopPropagation();
        handler(e);
    };
}
