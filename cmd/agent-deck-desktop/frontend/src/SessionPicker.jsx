import { useState, useEffect, useRef } from 'react';
import './SessionPicker.css';
import { createLogger } from './logger';
import ToolIcon from './ToolIcon';
import { withKeyboardIsolation } from './utils/keyboardIsolation';
import { useFocusManagement } from './utils/focusManagement';
import { getStatusLabel } from './utils/statusLabel';

const logger = createLogger('SessionPicker');

export default function SessionPicker({ projectPath, projectName, sessions, onSelectSession, onCreateNew, onCancel }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showLabelInput, setShowLabelInput] = useState(false);
    const [customLabel, setCustomLabel] = useState('');
    const containerRef = useRef(null);
    const labelInputRef = useRef(null);

    // Total options = existing sessions + "New Session" option
    const totalOptions = (sessions?.length || 0) + 1;
    const newSessionIndex = sessions?.length || 0;

    // Save focus on mount for restoration when picker closes
    useFocusManagement(true);

    useEffect(() => {
        logger.info('Session picker opened', { projectPath, projectName, sessionCount: sessions?.length || 0 });
        containerRef.current?.focus();
    }, [projectPath, projectName, sessions]);

    useEffect(() => {
        if (showLabelInput && labelInputRef.current) {
            labelInputRef.current.focus();
        }
    }, [showLabelInput]);

    const handleKeyDown = withKeyboardIsolation((e) => {
        if (showLabelInput) {
            // Handle label input mode
            if (e.key === 'Enter') {
                e.preventDefault();
                handleCreateWithLabel();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowLabelInput(false);
                setCustomLabel('');
                containerRef.current?.focus();
            }
            return;
        }

        const withMod = e.metaKey || e.ctrlKey;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % totalOptions);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + totalOptions) % totalOptions);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (selectedIndex === newSessionIndex) {
                    // "New Session" selected
                    if (withMod) {
                        // Cmd/Ctrl+Enter - show label input
                        setShowLabelInput(true);
                    } else {
                        // Regular Enter - auto-label
                        handleCreateNew();
                    }
                } else {
                    // Existing session selected
                    handleSelect(sessions[selectedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                logger.info('Session picker cancelled');
                onCancel();
                break;
        }

        // Number keys for quick select (1-9)
        if (e.key >= '1' && e.key <= '9') {
            const idx = parseInt(e.key, 10) - 1;
            if (idx < totalOptions) {
                e.preventDefault();
                if (idx === newSessionIndex) {
                    if (withMod) {
                        setShowLabelInput(true);
                    } else {
                        handleCreateNew();
                    }
                } else if (idx < sessions.length) {
                    handleSelect(sessions[idx]);
                }
            }
        }
    });

    const handleSelect = (session) => {
        logger.info('Session selected', { sessionId: session.id, label: session.customLabel });
        onSelectSession(session.id);
    };

    const handleCreateNew = () => {
        logger.info('Creating new session with auto-label', { projectPath });
        onCreateNew(null);
    };

    const handleCreateWithLabel = () => {
        const label = customLabel.trim();
        logger.info('Creating new session with custom label', { projectPath, label });
        onCreateNew(label || null);
        setShowLabelInput(false);
        setCustomLabel('');
    };

    const getStatusIndicator = (status) => {
        switch (status?.toLowerCase()) {
            case 'running':
                return { symbol: '●', className: 'running' };
            case 'waiting':
            case 'idle':
                return { symbol: '○', className: 'waiting' };
            case 'error':
                return { symbol: '!', className: 'error' };
            default:
                return { symbol: '○', className: 'unknown' };
        }
    };

    const getDisplayLabel = (session) => {
        if (session.customLabel) {
            return session.customLabel;
        }
        // Fallback to tool name if no label
        return session.tool || 'Session';
    };

    const getHostBadge = (session) => {
        if (session.isRemote) {
            return (session.remoteHostDisplayName || session.remoteHost || 'remote').toLowerCase();
        }
        return 'local';
    };

    return (
        <div className="session-picker-overlay" onClick={onCancel}>
            <div
                ref={containerRef}
                className="session-picker-container"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                tabIndex={0}
            >
                <div className="session-picker-header">
                    <h3>{projectName}</h3>
                    <p className="session-picker-path">{projectPath}</p>
                </div>

                {showLabelInput ? (
                    <div className="session-picker-label-input">
                        <label>Enter session label:</label>
                        <input
                            ref={labelInputRef}
                            type="text"
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            placeholder="e.g., bugfix, feature, exploration"
                            maxLength={30}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck="false"
                        />
                        <div className="session-picker-label-actions">
                            <button onClick={() => { setShowLabelInput(false); setCustomLabel(''); }}>
                                Cancel
                            </button>
                            <button onClick={handleCreateWithLabel} className="primary">
                                Create
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {sessions && sessions.length > 0 && (
                            <div className="session-picker-section">
                                <div className="session-picker-section-title">Existing Sessions</div>
                                <div className="session-picker-options">
                                    {sessions.map((session, index) => {
                                        const status = getStatusIndicator(session.status);
                                        return (
                                            <button
                                                key={session.id}
                                                className={`session-picker-option ${index === selectedIndex ? 'selected' : ''}`}
                                                onClick={() => handleSelect(session)}
                                                onMouseEnter={() => setSelectedIndex(index)}
                                            >
                                                <span className="session-picker-tool-icon">
                                                    <ToolIcon tool={session.tool} size={16} />
                                                </span>
                                                <span className={`session-picker-status ${status.className}`}>
                                                    {status.symbol}
                                                </span>
                                                <div className="session-picker-info">
                                                    <div className="session-picker-label">
                                                        {getDisplayLabel(session)}
                                                    </div>
                                                    <div className="session-picker-meta">
                                                        {getStatusLabel(session.status, session.waitingSince).label}
                                                    </div>
                                                </div>
                                                <span className={`session-picker-host ${session.isRemote ? 'remote' : 'local'}`}>
                                                    {getHostBadge(session)}
                                                </span>
                                                <span className="session-picker-shortcut">{index + 1}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="session-picker-section">
                            <div className="session-picker-options">
                                <button
                                    className={`session-picker-option session-picker-new ${selectedIndex === newSessionIndex ? 'selected' : ''}`}
                                    onClick={() => handleCreateNew()}
                                    onMouseEnter={() => setSelectedIndex(newSessionIndex)}
                                >
                                    <span className="session-picker-new-icon">+</span>
                                    <div className="session-picker-info">
                                        <div className="session-picker-label">New Session</div>
                                        <div className="session-picker-meta">
                                            <kbd>⌘↵</kbd> to add label
                                        </div>
                                    </div>
                                    <span className="session-picker-shortcut">{newSessionIndex + 1}</span>
                                </button>
                            </div>
                        </div>
                    </>
                )}

                <div className="session-picker-footer">
                    <span className="session-picker-hint"><kbd>↑↓</kbd> Navigate</span>
                    <span className="session-picker-hint"><kbd>1-{totalOptions}</kbd> Quick select</span>
                    <span className="session-picker-hint"><kbd>↵</kbd> Select</span>
                    <span className="session-picker-hint"><kbd>Esc</kbd> Cancel</span>
                </div>
            </div>
        </div>
    );
}
