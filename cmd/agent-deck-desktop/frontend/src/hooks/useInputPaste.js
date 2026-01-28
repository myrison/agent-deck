/**
 * useInputPaste.js
 *
 * Hook to handle paste events in text inputs when the Wails menu:paste event fires.
 *
 * In Wails apps on macOS, Cmd+V is intercepted by the native menu before it reaches
 * the browser, so normal paste doesn't work in text inputs. The native menu handler
 * emits a 'menu:paste' event with the clipboard text. This hook listens for that
 * event and inserts the text into the currently focused input.
 *
 * IMPORTANT: This hook explicitly excludes xterm.js textareas - terminal paste is
 * handled separately by Terminal.jsx's handleMenuPaste which writes to the PTY.
 */

import { useEffect } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';

/**
 * Check if an element is inside an xterm.js terminal container.
 * xterm uses a hidden textarea for input that we must not interfere with.
 */
function isXtermElement(element) {
    // xterm's textarea is inside a .xterm container and has class xterm-helper-textarea
    if (element.classList?.contains('xterm-helper-textarea')) {
        return true;
    }
    // Also check if any ancestor has the .xterm class
    return element.closest?.('.xterm') !== null;
}

/**
 * Enables paste functionality for text inputs in the current component.
 *
 * When 'menu:paste' is received, if a text input or textarea is focused
 * (excluding xterm.js terminals), the clipboard text is inserted at the cursor position.
 *
 * @param {boolean} enabled - Whether paste handling is enabled (default: true)
 */
export function useInputPaste(enabled = true) {
    useEffect(() => {
        if (!enabled) return;

        const handleMenuPaste = (text) => {
            if (!text) return;

            // Check if a text input or textarea is focused
            const activeElement = document.activeElement;
            if (!activeElement) return;

            // Skip xterm.js elements - terminal paste is handled by Terminal.jsx
            if (isXtermElement(activeElement)) {
                return;
            }

            const isTextInput = (
                activeElement.tagName === 'INPUT' &&
                (activeElement.type === 'text' || activeElement.type === 'search' || activeElement.type === 'password')
            );
            const isTextarea = activeElement.tagName === 'TEXTAREA';

            if (!isTextInput && !isTextarea) return;

            // Insert text at cursor position
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            const currentValue = activeElement.value;

            const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);

            // Update the input value
            activeElement.value = newValue;

            // Move cursor to end of inserted text
            const newCursorPos = start + text.length;
            activeElement.setSelectionRange(newCursorPos, newCursorPos);

            // Trigger React's onChange by dispatching an input event
            const inputEvent = new Event('input', { bubbles: true });
            activeElement.dispatchEvent(inputEvent);
        };

        const cancelPaste = EventsOn('menu:paste', handleMenuPaste);

        return () => {
            if (cancelPaste) cancelPaste();
        };
    }, [enabled]);
}
