import { useState, useEffect, useCallback } from 'react';
import './ScanPathSetupModal.css';
import { SetScanPaths, SetSetupDismissed, BrowseLocalDirectory, GetSSHHosts, AddSSHHost, RemoveSSHHost, TestSSHConnection } from '../wailsjs/go/main/App';
import { createLogger } from './logger';

const logger = createLogger('ScanPathSetupModal');

export default function ScanPathSetupModal({ onComplete, onSkip }) {
    const [step, setStep] = useState(1);

    // Step 1: Project paths
    const [paths, setPaths] = useState([]);
    const [inputValue, setInputValue] = useState('');

    // Step 2: SSH hosts
    const [sshHosts, setSSHHosts] = useState([]);
    const [showHostForm, setShowHostForm] = useState(false);
    const [editingHost, setEditingHost] = useState(null);
    const [hostForm, setHostForm] = useState({
        hostId: '',
        host: '',
        user: '',
        port: 22,
        identityFile: '',
        groupName: '',
        autoDiscover: true,
        isMacRemote: false,
    });
    const [hostErrors, setHostErrors] = useState({});
    const [testingHost, setTestingHost] = useState(null);
    const [testResults, setTestResults] = useState({});

    // Load existing SSH hosts on mount
    useEffect(() => {
        loadSSHHosts();
    }, []);

    const loadSSHHosts = async () => {
        try {
            const hosts = await GetSSHHosts();
            setSSHHosts(hosts || []);
        } catch (err) {
            logger.error('Failed to load SSH hosts:', err);
        }
    };

    // Step 1 handlers
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

    // Step 2 handlers
    const resetHostForm = () => {
        setHostForm({
            hostId: '',
            host: '',
            user: '',
            port: 22,
            identityFile: '',
            groupName: '',
            autoDiscover: true,
            isMacRemote: false,
        });
        setHostErrors({});
        setEditingHost(null);
    };

    const handleAddHostClick = () => {
        resetHostForm();
        setShowHostForm(true);
    };

    const handleEditHost = (host) => {
        setHostForm({
            hostId: host.hostId,
            host: host.host,
            user: host.user || '',
            port: host.port || 22,
            identityFile: host.identityFile || '',
            groupName: host.groupName || '',
            autoDiscover: host.autoDiscover ?? true,
            isMacRemote: host.tmuxPath === '/opt/homebrew/bin/tmux',
        });
        setEditingHost(host.hostId);
        setShowHostForm(true);
    };

    const handleCancelHostForm = () => {
        setShowHostForm(false);
        resetHostForm();
    };

    const validateHostForm = () => {
        const errors = {};
        if (!hostForm.hostId.trim()) {
            errors.hostId = 'Required';
        } else if (!/^[a-zA-Z0-9_-]+$/.test(hostForm.hostId)) {
            errors.hostId = 'Letters, numbers, dashes, underscores only';
        } else if (!editingHost && sshHosts.some(h => h.hostId === hostForm.hostId)) {
            errors.hostId = 'Already exists';
        }
        if (!hostForm.host.trim()) {
            errors.host = 'Required';
        }
        setHostErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSaveHost = async () => {
        if (!validateHostForm()) return;

        try {
            const tmuxPath = hostForm.isMacRemote ? '/opt/homebrew/bin/tmux' : '';

            await AddSSHHost(
                hostForm.hostId.trim(),
                hostForm.host.trim(),
                hostForm.user.trim(),
                hostForm.port || 22,
                hostForm.identityFile.trim(),
                '', // description
                hostForm.groupName.trim() || hostForm.hostId.trim(),
                hostForm.autoDiscover,
                tmuxPath,
                '' // jumpHost
            );

            logger.info('Added SSH host', { hostId: hostForm.hostId });
            await loadSSHHosts();
            setShowHostForm(false);
            resetHostForm();
        } catch (err) {
            logger.error('Failed to save SSH host:', err);
            setHostErrors({ submit: err.message || 'Failed to save host' });
        }
    };

    const handleRemoveHost = async (hostId) => {
        try {
            await RemoveSSHHost(hostId);
            logger.info('Removed SSH host', { hostId });
            await loadSSHHosts();
        } catch (err) {
            logger.error('Failed to remove SSH host:', err);
        }
    };

    const handleTestHost = async (hostId) => {
        setTestingHost(hostId);
        setTestResults(prev => ({ ...prev, [hostId]: null }));

        try {
            await TestSSHConnection(hostId);
            setTestResults(prev => ({ ...prev, [hostId]: { success: true } }));
            logger.info('SSH test succeeded', { hostId });
        } catch (err) {
            setTestResults(prev => ({
                ...prev,
                [hostId]: { success: false, message: err.message || 'Connection failed' }
            }));
            logger.error('SSH test failed', { hostId, error: err.message });
        } finally {
            setTestingHost(null);
        }
    };

    // Navigation handlers
    const handleNext = async () => {
        if (step === 1) {
            // Save paths before moving to step 2
            if (paths.length > 0) {
                try {
                    await SetScanPaths(paths);
                    logger.info('Saved scan paths', { count: paths.length });
                } catch (err) {
                    logger.error('Failed to save scan paths:', err);
                }
            }
            setStep(2);
        }
    };

    const handleBack = () => {
        if (step === 2) {
            setStep(1);
        }
    };

    const handleGetStarted = async () => {
        try {
            // Save paths if we have any
            if (paths.length > 0) {
                await SetScanPaths(paths);
            }
            await SetSetupDismissed(true);
            logger.info('Setup completed', { pathCount: paths.length, hostCount: sshHosts.length });
            onComplete();
        } catch (err) {
            logger.error('Failed to complete setup:', err);
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
            if (showHostForm) {
                handleCancelHostForm();
            } else {
                handleSkip();
            }
        }
    }, [showHostForm]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    return (
        <div className="scan-setup-overlay" onClick={handleSkip}>
            <div className="scan-setup-container scan-setup-wizard" onClick={(e) => e.stopPropagation()}>
                {/* Step Indicator */}
                <div className="scan-setup-steps">
                    <div className={`scan-setup-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
                        <span className="scan-setup-step-number">1</span>
                        <span className="scan-setup-step-label">Projects</span>
                    </div>
                    <div className="scan-setup-step-divider" />
                    <div className={`scan-setup-step ${step === 2 ? 'active' : ''}`}>
                        <span className="scan-setup-step-number">2</span>
                        <span className="scan-setup-step-label">Remote Machines</span>
                    </div>
                </div>

                {/* Step 1: Project Paths */}
                {step === 1 && (
                    <>
                        <div className="scan-setup-header">
                            <h2>Where are your projects?</h2>
                            <p className="scan-setup-description">
                                Add directories where you keep your code projects. RevvySwarm will scan
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
                                className="scan-setup-next-btn"
                                onClick={handleNext}
                            >
                                Next
                            </button>
                        </div>
                    </>
                )}

                {/* Step 2: SSH Hosts */}
                {step === 2 && (
                    <>
                        <div className="scan-setup-header">
                            <h2>Connect Remote Machines</h2>
                            <p className="scan-setup-description">
                                Connect to other machines running RevvySwarm to see and manage their sessions
                                from here. RevvySwarm must be installed on each remote machine.
                            </p>
                        </div>

                        <div className="scan-setup-content">
                            {showHostForm ? (
                                <div className="scan-setup-host-form">
                                    <div className="scan-setup-form-row">
                                        <div className="scan-setup-form-field">
                                            <label>Display Name *</label>
                                            <input
                                                type="text"
                                                value={hostForm.groupName || hostForm.hostId}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setHostForm(prev => ({
                                                        ...prev,
                                                        groupName: val,
                                                        hostId: prev.hostId || val.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                                                    }));
                                                }}
                                                placeholder="My MacBook"
                                                autoFocus
                                            />
                                            {hostErrors.hostId && (
                                                <span className="scan-setup-error">{hostErrors.hostId}</span>
                                            )}
                                        </div>
                                        <div className="scan-setup-form-field scan-setup-form-field-wide">
                                            <label>Host / IP *</label>
                                            <input
                                                type="text"
                                                value={hostForm.host}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, host: e.target.value }))}
                                                placeholder="192.168.1.100"
                                            />
                                            {hostErrors.host && (
                                                <span className="scan-setup-error">{hostErrors.host}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="scan-setup-form-row">
                                        <div className="scan-setup-form-field">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={hostForm.user}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, user: e.target.value }))}
                                                placeholder="(current user)"
                                            />
                                        </div>
                                        <div className="scan-setup-form-field scan-setup-form-field-narrow">
                                            <label>Port</label>
                                            <input
                                                type="number"
                                                value={hostForm.port}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, port: parseInt(e.target.value) || 22 }))}
                                            />
                                        </div>
                                        <div className="scan-setup-form-field scan-setup-form-field-wide">
                                            <label>SSH Key Path</label>
                                            <input
                                                type="text"
                                                value={hostForm.identityFile}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, identityFile: e.target.value }))}
                                                placeholder="~/.ssh/id_rsa"
                                            />
                                        </div>
                                    </div>

                                    <div className="scan-setup-form-checkboxes">
                                        <label className="scan-setup-checkbox">
                                            <input
                                                type="checkbox"
                                                checked={hostForm.autoDiscover}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, autoDiscover: e.target.checked }))}
                                            />
                                            Auto-discover sessions
                                        </label>
                                        <label className="scan-setup-checkbox">
                                            <input
                                                type="checkbox"
                                                checked={hostForm.isMacRemote}
                                                onChange={(e) => setHostForm(prev => ({ ...prev, isMacRemote: e.target.checked }))}
                                            />
                                            macOS with Homebrew
                                        </label>
                                    </div>

                                    {hostErrors.submit && (
                                        <div className="scan-setup-error-banner">{hostErrors.submit}</div>
                                    )}

                                    <div className="scan-setup-form-actions">
                                        <button className="scan-setup-form-cancel" onClick={handleCancelHostForm}>
                                            Cancel
                                        </button>
                                        <button className="scan-setup-form-save" onClick={handleSaveHost}>
                                            Add Host
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="scan-setup-host-list">
                                        {sshHosts.length === 0 ? (
                                            <div className="scan-setup-empty">
                                                No remote hosts configured. This step is optional.
                                            </div>
                                        ) : (
                                            sshHosts.map(host => (
                                                <div key={host.hostId} className="scan-setup-host-item">
                                                    <div className="scan-setup-host-info">
                                                        <span className="scan-setup-host-name">
                                                            {host.groupName || host.hostId}
                                                        </span>
                                                        <span className="scan-setup-host-address">
                                                            {host.user ? `${host.user}@` : ''}{host.host}
                                                            {host.port && host.port !== 22 ? `:${host.port}` : ''}
                                                        </span>
                                                    </div>
                                                    <div className="scan-setup-host-actions">
                                                        {testResults[host.hostId] && (
                                                            <span className={`scan-setup-test-result ${testResults[host.hostId].success ? 'success' : 'error'}`}>
                                                                {testResults[host.hostId].success ? '✓' : '✗'}
                                                            </span>
                                                        )}
                                                        <button
                                                            className="scan-setup-host-test"
                                                            onClick={() => handleTestHost(host.hostId)}
                                                            disabled={testingHost === host.hostId}
                                                            title="Test connection"
                                                        >
                                                            {testingHost === host.hostId ? '...' : 'Test'}
                                                        </button>
                                                        <button
                                                            className="scan-setup-host-edit"
                                                            onClick={() => handleEditHost(host)}
                                                            title="Edit host"
                                                        >
                                                            ✎
                                                        </button>
                                                        <button
                                                            className="scan-setup-host-remove"
                                                            onClick={() => handleRemoveHost(host.hostId)}
                                                            title="Remove host"
                                                        >
                                                            &times;
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <button className="scan-setup-add-host-btn" onClick={handleAddHostClick}>
                                        + Add Remote Machine
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="scan-setup-footer">
                            <button className="scan-setup-back-btn" onClick={handleBack}>
                                Back
                            </button>
                            <div className="scan-setup-footer-right">
                                <button className="scan-setup-skip-btn" onClick={handleSkip}>
                                    Skip
                                </button>
                                <button
                                    className="scan-setup-start-btn"
                                    onClick={handleGetStarted}
                                >
                                    Get Started
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
