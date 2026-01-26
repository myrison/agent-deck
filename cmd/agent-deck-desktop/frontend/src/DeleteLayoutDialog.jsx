import { useEffect, useRef } from 'react';
import './DeleteLayoutDialog.css';

// Confirmation dialog for deleting a saved layout
export default function DeleteLayoutDialog({ layout, onConfirm, onCancel }) {
    const cancelRef = useRef(null);

    useEffect(() => {
        // Focus cancel button on mount (safer default)
        if (cancelRef.current) {
            cancelRef.current.focus();
        }
    }, []);

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter') {
            // Only confirm if delete button is focused
            if (document.activeElement?.classList.contains('delete-layout-dialog-confirm')) {
                e.preventDefault();
                onConfirm();
            }
        }
    };

    // Extract layout name from title (format is "Layout: {name}")
    const layoutName = layout?.title?.replace(/^Layout:\s*/, '') || 'this layout';

    return (
        <div className="delete-layout-dialog-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
            <div className="delete-layout-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="delete-layout-dialog-title">Delete Layout?</div>
                <div className="delete-layout-dialog-message">
                    <p>
                        This will permanently delete <strong>{layoutName}</strong>.
                    </p>
                    <p className="delete-layout-dialog-warning">This action cannot be undone.</p>
                </div>
                <div className="delete-layout-dialog-buttons">
                    <button
                        ref={cancelRef}
                        className="delete-layout-dialog-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="delete-layout-dialog-confirm"
                        onClick={onConfirm}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
