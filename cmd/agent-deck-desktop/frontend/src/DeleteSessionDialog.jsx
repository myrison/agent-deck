import { useEffect, useRef } from 'react';
import './DeleteSessionDialog.css';
import { withKeyboardIsolation } from './utils/keyboardIsolation';
import { saveFocus } from './utils/focusManagement';

// Confirmation dialog for deleting a session
export default function DeleteSessionDialog({ session, onConfirm, onCancel }) {
    const cancelRef = useRef(null);
    const restoreFocusRef = useRef(null);

    useEffect(() => {
        // Save previous focus for restoration
        restoreFocusRef.current = saveFocus();

        // Focus cancel button on mount (safer default)
        if (cancelRef.current) {
            cancelRef.current.focus();
        }

        // Restore focus when dialog unmounts
        return () => {
            if (restoreFocusRef.current) {
                restoreFocusRef.current();
            }
        };
    }, []);

    const handleKeyDown = withKeyboardIsolation((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter') {
            // Only confirm if delete button is focused
            if (document.activeElement?.classList.contains('delete-dialog-confirm')) {
                e.preventDefault();
                onConfirm();
            }
        }
    });

    return (
        <div className="delete-dialog-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
            <div className="delete-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="delete-dialog-title">Delete Session?</div>
                <div className="delete-dialog-message">
                    <p>
                        This will permanently delete <strong>{session.customLabel || session.title}</strong> and kill its tmux session.
                    </p>
                    <p className="delete-dialog-warning">This action cannot be undone.</p>
                </div>
                <div className="delete-dialog-buttons">
                    <button
                        ref={cancelRef}
                        className="delete-dialog-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="delete-dialog-confirm"
                        onClick={onConfirm}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
