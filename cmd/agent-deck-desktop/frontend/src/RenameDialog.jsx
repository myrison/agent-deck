import { useState, useEffect, useRef, useCallback } from 'react';
import './RenameDialog.css';
import { withKeyboardIsolation } from './utils/keyboardIsolation';
import { useFocusManagement } from './utils/focusManagement';

// Shared dialog component for renaming favorites or adding labels
export default function RenameDialog({ currentName, title = 'Rename', placeholder = 'Enter text...', onSave, onCancel }) {
    const [name, setName] = useState(currentName);
    const inputRef = useRef(null);

    // Save focus on mount and restore on unmount
    useFocusManagement(true);

    // Focus and select all text on mount
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    const handleKeyDown = withKeyboardIsolation((e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (name.trim()) {
                onSave(name);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    });

    return (
        <div className="rename-dialog-overlay" onClick={onCancel}>
            <div className="rename-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="rename-dialog-title">{title}</div>
                <input
                    ref={inputRef}
                    type="text"
                    className="rename-dialog-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                />
                <div className="rename-dialog-buttons">
                    <button className="rename-dialog-cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        className="rename-dialog-save"
                        onClick={() => onSave(name)}
                        disabled={!name.trim()}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
