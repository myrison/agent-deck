import { useState, useEffect, useCallback } from 'react';
import './ScanPathSetupModal.css';
import { SetScanPaths, SetSetupDismissed, BrowseLocalDirectory } from '../wailsjs/go/main/App';
import { createLogger } from './logger';

const logger = createLogger('ScanPathSetupModal');

export default function ScanPathSetupModal({ onComplete, onSkip }) {
    const [paths, setPaths] = useState([]);
    const [inputValue, setInputValue] = useState('');

    const handleBrowse = async () => {
        try {
            const dir = await BrowseLocalDirectory('');
            if (dir) {
                addPath(dir);
            }
        } catch (err) {
            logger.error('Failed to browse directory:', err);
        }
    };

    const addPath = (path) => {
        const trimmed = path.trim().replace(/\/+$/, '');
        if (!trimmed) return;
        if (paths.includes(trimmed)) return;
        setPaths(prev => [...prev, trimmed]);
        setInputValue('');
    };

    const removePath = (path) => {
        setPaths(prev => prev.filter(p => p !== path));
    };

    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPath(inputValue);
        }
    };

    const handleGetStarted = async () => {
        if (paths.length === 0) return;
        try {
            await SetScanPaths(paths);
            logger.info('Saved scan paths from setup', { count: paths.length });
            onComplete();
        } catch (err) {
            logger.error('Failed to save scan paths:', err);
        }
    };

    const handleSkip = async () => {
        try {
            await SetSetupDismissed(true);
            logger.info('Setup dismissed');
        } catch (err) {
            logger.error('Failed to save dismissed state:', err);
        }
        onSkip();
    };

    // Escape = skip
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            handleSkip();
        }
    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    return (
        <div className="scan-setup-overlay" onClick={handleSkip}>
            <div className="scan-setup-container" onClick={(e) => e.stopPropagation()}>
                <div className="scan-setup-header">
                    <h2>Where are your projects?</h2>
                    <p className="scan-setup-description">
                        Add directories where you keep your code projects. RevDen will scan
                        these paths to discover projects and show them in the command palette.
                    </p>
                </div>

                <div className="scan-setup-content">
                    <div className="scan-setup-input-row">
                        <input
                            type="text"
                            className="scan-setup-input"
                            placeholder="~/projects or /path/to/code"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            autoFocus
                        />
                        <button
                            className="scan-setup-browse-btn"
                            onClick={handleBrowse}
                        >
                            Browse
                        </button>
                    </div>

                    <div className="scan-setup-path-list">
                        {paths.length === 0 ? (
                            <div className="scan-setup-empty">
                                No paths added yet. Browse or type a path above.
                            </div>
                        ) : (
                            paths.map(path => (
                                <div key={path} className="scan-setup-path-item">
                                    <span className="scan-setup-path-text" title={path}>
                                        {path}
                                    </span>
                                    <button
                                        className="scan-setup-path-remove"
                                        onClick={() => removePath(path)}
                                        title="Remove path"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="scan-setup-footer">
                    <button className="scan-setup-skip-btn" onClick={handleSkip}>
                        Skip for now
                    </button>
                    <button
                        className="scan-setup-start-btn"
                        onClick={handleGetStarted}
                        disabled={paths.length === 0}
                    >
                        Get Started
                    </button>
                </div>
            </div>
        </div>
    );
}
