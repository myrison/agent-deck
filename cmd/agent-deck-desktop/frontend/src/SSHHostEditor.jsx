import { useState, useEffect } from 'react';
import './SSHHostEditor.css';
import { TestSSHConnectionWithParams, BrowseLocalFile } from '../wailsjs/go/main/App';
import { createLogger } from './logger';

const logger = createLogger('SSHHostEditor');

/**
 * SSHHostEditor - A form component for adding/editing SSH host configurations.
 *
 * Props:
 * - host: Existing host data (for editing) or null (for adding)
 * - onSave: (hostData) => void - Called when user saves
 * - onCancel: () => void - Called when user cancels
 * - existingHostIds: string[] - List of existing host IDs (for validation)
 * - isNew: boolean - Whether this is a new host or editing existing
 */
export default function SSHHostEditor({ host, onSave, onCancel, existingHostIds = [], isNew = true }) {
    const [hostId, setHostId] = useState(host?.hostId || '');
    const [hostAddress, setHostAddress] = useState(host?.host || '');
    const [user, setUser] = useState(host?.user || '');
    const [port, setPort] = useState(host?.port || 22);
    const [identityFile, setIdentityFile] = useState(host?.identityFile || '');
    const [description, setDescription] = useState(host?.description || '');
    const [groupName, setGroupName] = useState(host?.groupName || '');
    const [autoDiscover, setAutoDiscover] = useState(host?.autoDiscover ?? true);
    const [isMacRemote, setIsMacRemote] = useState(host?.tmuxPath === '/opt/homebrew/bin/tmux');
    const [jumpHost, setJumpHost] = useState(host?.jumpHost || '');

    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null); // { success: boolean, message: string }
    const [errors, setErrors] = useState({});

    // Derive display name from hostId if not explicitly set
    useEffect(() => {
        if (isNew && hostId && !groupName) {
            // Auto-fill group name from host ID (capitalize, replace dashes/underscores)
            const displayName = hostId
                .replace(/[-_]/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            setGroupName(displayName);
        }
    }, [hostId, isNew, groupName]);

    const validateForm = () => {
        const newErrors = {};

        // Host ID validation
        if (!hostId.trim()) {
            newErrors.hostId = 'Host ID is required';
        } else if (!/^[a-zA-Z0-9_-]+$/.test(hostId)) {
            newErrors.hostId = 'Only letters, numbers, underscores, and hyphens allowed';
        } else if (isNew && existingHostIds.includes(hostId)) {
            newErrors.hostId = 'Host ID already exists';
        }

        // Host address validation
        if (!hostAddress.trim()) {
            newErrors.hostAddress = 'Host/IP address is required';
        }

        // Port validation
        if (port < 1 || port > 65535) {
            newErrors.port = 'Port must be between 1 and 65535';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = () => {
        if (!validateForm()) return;

        const tmuxPath = isMacRemote ? '/opt/homebrew/bin/tmux' : '';

        onSave({
            hostId: hostId.trim(),
            host: hostAddress.trim(),
            user: user.trim(),
            port: port || 22,
            identityFile: identityFile.trim(),
            description: description.trim(),
            groupName: groupName.trim() || hostId.trim(),
            autoDiscover,
            tmuxPath,
            jumpHost: jumpHost.trim(),
        });
    };

    const handleTestConnection = async () => {
        if (!hostAddress.trim()) {
            setTestResult({ success: false, message: 'Enter a host address first' });
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            // Test connection using provided parameters (no need to save first)
            await TestSSHConnectionWithParams(
                hostAddress.trim(),
                user.trim(),
                port || 22,
                identityFile.trim(),
                jumpHost.trim()
            );
            setTestResult({ success: true, message: 'Connected successfully!' });
            logger.info('SSH connection test succeeded', { hostId, host: hostAddress });
        } catch (err) {
            const message = err.message || String(err);
            // Clean up common error messages for user display
            let displayMessage = message;
            if (message.includes('permission denied')) {
                displayMessage = 'Permission denied - check credentials';
            } else if (message.includes('timeout')) {
                displayMessage = 'Connection timeout - check host address';
            } else if (message.includes('No route to host') || message.includes('Connection refused')) {
                displayMessage = 'Cannot reach host - check address/port';
            }
            setTestResult({ success: false, message: displayMessage });
            logger.error('SSH connection test failed', { hostId, host: hostAddress, error: message });
        } finally {
            setTesting(false);
        }
    };

    const handleBrowseIdentityFile = async () => {
        try {
            // Open file picker starting in ~/.ssh (Go handles ~ expansion)
            const file = await BrowseLocalFile('~/.ssh');
            if (file) {
                setIdentityFile(file);
            }
        } catch (err) {
            logger.error('Failed to browse for identity file:', err);
        }
    };

    return (
        <div className="ssh-host-editor">
            <div className="ssh-host-editor-form">
                {/* Host ID / Display Name Row */}
                <div className="ssh-host-editor-row">
                    <div className="ssh-host-editor-field">
                        <label>
                            Host ID <span className="required">*</span>
                        </label>
                        <input
                            type="text"
                            value={hostId}
                            onChange={(e) => setHostId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                            placeholder="my-server"
                            disabled={!isNew}
                            className={errors.hostId ? 'error' : ''}
                        />
                        {errors.hostId && <span className="error-message">{errors.hostId}</span>}
                        <span className="field-hint">Unique identifier (lowercase, no spaces)</span>
                    </div>
                    <div className="ssh-host-editor-field">
                        <label>Display Name</label>
                        <input
                            type="text"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            placeholder="My Server"
                        />
                        <span className="field-hint">Name shown in the sidebar</span>
                    </div>
                </div>

                {/* Host/IP and Port Row */}
                <div className="ssh-host-editor-row">
                    <div className="ssh-host-editor-field ssh-host-editor-field-wide">
                        <label>
                            Host / IP Address <span className="required">*</span>
                        </label>
                        <input
                            type="text"
                            value={hostAddress}
                            onChange={(e) => setHostAddress(e.target.value)}
                            placeholder="192.168.1.100 or server.example.com"
                            className={errors.hostAddress ? 'error' : ''}
                        />
                        {errors.hostAddress && <span className="error-message">{errors.hostAddress}</span>}
                    </div>
                    <div className="ssh-host-editor-field ssh-host-editor-field-narrow">
                        <label>Port</label>
                        <input
                            type="number"
                            value={port}
                            onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                            min="1"
                            max="65535"
                            className={errors.port ? 'error' : ''}
                        />
                        {errors.port && <span className="error-message">{errors.port}</span>}
                    </div>
                </div>

                {/* Username Row */}
                <div className="ssh-host-editor-row">
                    <div className="ssh-host-editor-field">
                        <label>Username</label>
                        <input
                            type="text"
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            placeholder="(current user)"
                        />
                        <span className="field-hint">Leave empty to use current username</span>
                    </div>
                    <div className="ssh-host-editor-field">
                        <label>SSH Key Path</label>
                        <div className="ssh-host-editor-file-input">
                            <input
                                type="text"
                                value={identityFile}
                                onChange={(e) => setIdentityFile(e.target.value)}
                                placeholder="~/.ssh/id_rsa"
                            />
                            <button
                                type="button"
                                className="ssh-host-browse-btn"
                                onClick={handleBrowseIdentityFile}
                            >
                                Browse
                            </button>
                        </div>
                        <span className="field-hint">Leave empty to use SSH agent</span>
                    </div>
                </div>

                {/* Checkboxes Row */}
                <div className="ssh-host-editor-checkboxes">
                    <label className="ssh-host-checkbox">
                        <input
                            type="checkbox"
                            checked={autoDiscover}
                            onChange={(e) => setAutoDiscover(e.target.checked)}
                        />
                        Auto-discover sessions
                        <span className="checkbox-hint">Show remote sessions in sidebar</span>
                    </label>
                    <label className="ssh-host-checkbox">
                        <input
                            type="checkbox"
                            checked={isMacRemote}
                            onChange={(e) => setIsMacRemote(e.target.checked)}
                        />
                        macOS with Homebrew
                        <span className="checkbox-hint">Uses /opt/homebrew/bin/tmux</span>
                    </label>
                </div>

                {/* Description */}
                <div className="ssh-host-editor-field ssh-host-editor-field-full">
                    <label>Description</label>
                    <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional description for this host"
                    />
                </div>
            </div>

            {/* Test Connection */}
            <div className="ssh-host-editor-test">
                <button
                    type="button"
                    className="ssh-host-test-btn"
                    onClick={handleTestConnection}
                    disabled={testing || !hostAddress.trim()}
                >
                    {testing ? 'Testing...' : 'Test Connection'}
                </button>
                {testResult && (
                    <span className={`ssh-host-test-result ${testResult.success ? 'success' : 'error'}`}>
                        {testResult.success ? '✓' : '✗'} {testResult.message}
                    </span>
                )}
            </div>

            {/* Actions */}
            <div className="ssh-host-editor-actions">
                <button type="button" className="ssh-host-cancel-btn" onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" className="ssh-host-save-btn" onClick={handleSave}>
                    {isNew ? 'Add Host' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}
