import { useState, useEffect, useCallback, useRef } from 'react';
import './SettingsModal.css';
import LaunchConfigEditor from './LaunchConfigEditor';
import { GetLaunchConfigs, DeleteLaunchConfig, GetSoftNewlineMode, SetSoftNewlineMode, SetFontSize, GetScrollSpeed, SetScrollSpeed, ResetGroupSettings, GetAutoCopyOnSelectEnabled, SetAutoCopyOnSelectEnabled, GetShowActivityRibbon, SetShowActivityRibbon, GetFileBasedActivityDetection, SetFileBasedActivityDetection, GetScanPaths, AddScanPath, RemoveScanPath, GetScanMaxDepth, SetScanMaxDepth, BrowseLocalDirectory, GetSSHHosts, AddSSHHost, UpdateSSHHost, RemoveSSHHost, TestSSHConnection } from '../wailsjs/go/main/App';
import { createLogger } from './logger';
import { TOOLS } from './utils/tools';
import ToolIcon from './ToolIcon';
import { useTheme } from './context/ThemeContext';
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from './constants/terminal';
import { useFocusManagement } from './utils/focusManagement';

const logger = createLogger('SettingsModal');

const DEFAULT_SCROLL_SPEED = 100;
const MIN_SCROLL_SPEED = 50;
const MAX_SCROLL_SPEED = 250;

export default function SettingsModal({ onClose, fontSize = DEFAULT_FONT_SIZE, onFontSizeChange, scrollSpeed = DEFAULT_SCROLL_SPEED, onScrollSpeedChange }) {
    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingConfig, setEditingConfig] = useState(null); // null = list view, object = editing
    const [creatingForTool, setCreatingForTool] = useState(null); // tool name when creating new
    const [softNewlineMode, setSoftNewlineMode] = useState('both');
    const [autoCopyOnSelect, setAutoCopyOnSelect] = useState(false);
    const [showActivityRibbon, setShowActivityRibbon] = useState(true);
    const [fileBasedActivityDetection, setFileBasedActivityDetection] = useState(true);
    const [scanPaths, setScanPaths] = useState([]);
    const [scanMaxDepth, setScanMaxDepth] = useState(2);
    const [sshHosts, setSSHHosts] = useState([]);
    const [editingSSHHost, setEditingSSHHost] = useState(null);
    const [sshHostForm, setSSHHostForm] = useState({
        hostId: '',
        host: '',
        user: '',
        port: 22,
        identityFile: '',
        groupName: '',
        autoDiscover: true,
        isMacRemote: false,
    });
    const [sshHostErrors, setSSHHostErrors] = useState({});
    const [testingSSHHost, setTestingSSHHost] = useState(null);
    const [sshTestResults, setSSHTestResults] = useState({});
    const { themePreference, setTheme } = useTheme();
    const containerRef = useRef(null);

    // Save focus on mount and restore on unmount
    useFocusManagement(true);

    // Focus the modal container on mount so Escape works immediately
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.focus();
        }
    }, []);

    // Load configs and terminal settings on mount
    useEffect(() => {
        loadConfigs();
        loadTerminalSettings();
        loadScanSettings();
        loadSSHHosts();
    }, []);

    const loadTerminalSettings = async () => {
        try {
            const mode = await GetSoftNewlineMode();
            setSoftNewlineMode(mode || 'both');
            logger.info('Loaded soft newline mode:', mode);
        } catch (err) {
            logger.error('Failed to load terminal settings:', err);
        }
        // Font size is passed as prop from App.jsx, no need to load here

        try {
            const autoCopyEnabled = await GetAutoCopyOnSelectEnabled();
            setAutoCopyOnSelect(autoCopyEnabled);
            logger.info('Loaded auto-copy on select:', autoCopyEnabled);
        } catch (err) {
            logger.error('Failed to load auto-copy setting:', err);
        }

        try {
            const ribbonEnabled = await GetShowActivityRibbon();
            setShowActivityRibbon(ribbonEnabled);
            logger.info('Loaded activity ribbon setting:', ribbonEnabled);
        } catch (err) {
            logger.error('Failed to load activity ribbon setting:', err);
        }

        try {
            const fileBasedEnabled = await GetFileBasedActivityDetection();
            setFileBasedActivityDetection(fileBasedEnabled);
            logger.info('Loaded file-based activity detection:', fileBasedEnabled);
        } catch (err) {
            logger.error('Failed to load file-based activity detection:', err);
        }
    };

    const handleSoftNewlineModeChange = async (mode) => {
        try {
            await SetSoftNewlineMode(mode);
            setSoftNewlineMode(mode);
            logger.info('Set soft newline mode:', mode);
        } catch (err) {
            logger.error('Failed to set soft newline mode:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleFontSizeChange = async (delta) => {
        const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize + delta));
        if (newSize === fontSize) return;
        try {
            await SetFontSize(newSize);
            if (onFontSizeChange) onFontSizeChange(newSize);
            logger.info('Set font size:', newSize);
        } catch (err) {
            logger.error('Failed to set font size:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleFontSizeReset = async () => {
        try {
            await SetFontSize(DEFAULT_FONT_SIZE);
            if (onFontSizeChange) onFontSizeChange(DEFAULT_FONT_SIZE);
            logger.info('Reset font size to default');
        } catch (err) {
            logger.error('Failed to reset font size:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleScrollSpeedChange = async (newSpeed) => {
        const clampedSpeed = Math.max(MIN_SCROLL_SPEED, Math.min(MAX_SCROLL_SPEED, newSpeed));
        if (clampedSpeed === scrollSpeed) return;
        try {
            await SetScrollSpeed(clampedSpeed);
            if (onScrollSpeedChange) onScrollSpeedChange(clampedSpeed);
            logger.info('Set scroll speed:', clampedSpeed);
        } catch (err) {
            logger.error('Failed to set scroll speed:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleScrollSpeedReset = async () => {
        try {
            await SetScrollSpeed(DEFAULT_SCROLL_SPEED);
            if (onScrollSpeedChange) onScrollSpeedChange(DEFAULT_SCROLL_SPEED);
            logger.info('Reset scroll speed to default');
        } catch (err) {
            logger.error('Failed to reset scroll speed:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleResetGroupSettings = async () => {
        if (!confirm('Reset all group expand/collapse settings to TUI defaults?')) return;
        try {
            await ResetGroupSettings();
            logger.info('Reset group settings to TUI defaults');
            alert('Group settings reset. Refresh the session list to see changes.');
        } catch (err) {
            logger.error('Failed to reset group settings:', err);
            alert('Failed to reset settings: ' + err.message);
        }
    };

    const handleAutoCopyOnSelectChange = async (enabled) => {
        try {
            await SetAutoCopyOnSelectEnabled(enabled);
            setAutoCopyOnSelect(enabled);
            logger.info('Set auto-copy on select:', enabled);
        } catch (err) {
            logger.error('Failed to save auto-copy setting:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleShowActivityRibbonChange = async (enabled) => {
        try {
            await SetShowActivityRibbon(enabled);
            setShowActivityRibbon(enabled);
            logger.info('Set activity ribbon:', enabled);
        } catch (err) {
            logger.error('Failed to save activity ribbon setting:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const handleFileBasedActivityDetectionChange = async (enabled) => {
        try {
            await SetFileBasedActivityDetection(enabled);
            setFileBasedActivityDetection(enabled);
            logger.info('Set file-based activity detection:', enabled);
        } catch (err) {
            logger.error('Failed to save file-based activity detection:', err);
            alert('Failed to save setting: ' + err.message);
        }
    };

    const loadScanSettings = async () => {
        try {
            const paths = await GetScanPaths();
            setScanPaths(paths || []);
            logger.info('Loaded scan paths', { count: paths?.length || 0 });
        } catch (err) {
            logger.error('Failed to load scan paths:', err);
        }
        try {
            const depth = await GetScanMaxDepth();
            setScanMaxDepth(depth || 2);
            logger.info('Loaded scan max depth', { depth });
        } catch (err) {
            logger.error('Failed to load scan max depth:', err);
        }
    };

    const handleAddScanPath = async () => {
        try {
            const dir = await BrowseLocalDirectory('');
            if (dir) {
                await AddScanPath(dir);
                const paths = await GetScanPaths();
                setScanPaths(paths || []);
                logger.info('Added scan path', { dir });
            }
        } catch (err) {
            logger.error('Failed to add scan path:', err);
        }
    };

    const handleRemoveScanPath = async (path) => {
        try {
            await RemoveScanPath(path);
            const paths = await GetScanPaths();
            setScanPaths(paths || []);
            logger.info('Removed scan path', { path });
        } catch (err) {
            logger.error('Failed to remove scan path:', err);
        }
    };

    const handleMaxDepthChange = async (delta) => {
        const newDepth = Math.max(1, Math.min(5, scanMaxDepth + delta));
        if (newDepth === scanMaxDepth) return;
        try {
            await SetScanMaxDepth(newDepth);
            setScanMaxDepth(newDepth);
            logger.info('Set scan max depth', { depth: newDepth });
        } catch (err) {
            logger.error('Failed to set scan max depth:', err);
        }
    };

    // SSH Host handlers
    const loadSSHHosts = async () => {
        try {
            const hosts = await GetSSHHosts();
            setSSHHosts(hosts || []);
            logger.info('Loaded SSH hosts', { count: hosts?.length || 0 });
        } catch (err) {
            logger.error('Failed to load SSH hosts:', err);
        }
    };

    const resetSSHHostForm = () => {
        setSSHHostForm({
            hostId: '',
            host: '',
            user: '',
            port: 22,
            identityFile: '',
            groupName: '',
            autoDiscover: true,
            isMacRemote: false,
        });
        setSSHHostErrors({});
        setEditingSSHHost(null);
    };

    const handleAddSSHHostClick = () => {
        resetSSHHostForm();
        setEditingSSHHost('new');
    };

    const handleEditSSHHost = (host) => {
        setSSHHostForm({
            hostId: host.hostId,
            host: host.host,
            user: host.user || '',
            port: host.port || 22,
            identityFile: host.identityFile || '',
            groupName: host.groupName || '',
            autoDiscover: host.autoDiscover ?? true,
            isMacRemote: host.tmuxPath === '/opt/homebrew/bin/tmux',
        });
        setEditingSSHHost(host.hostId);
    };

    const handleCancelSSHHostForm = () => {
        setEditingSSHHost(null);
        resetSSHHostForm();
    };

    const validateSSHHostForm = () => {
        const errors = {};
        if (!sshHostForm.hostId.trim()) {
            errors.hostId = 'Required';
        } else if (!/^[a-zA-Z0-9_-]+$/.test(sshHostForm.hostId)) {
            errors.hostId = 'Letters, numbers, dashes, underscores only';
        } else if (editingSSHHost === 'new' && sshHosts.some(h => h.hostId === sshHostForm.hostId)) {
            errors.hostId = 'Already exists';
        }
        if (!sshHostForm.host.trim()) {
            errors.host = 'Required';
        }
        setSSHHostErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSaveSSHHost = async () => {
        if (!validateSSHHostForm()) return;

        try {
            const tmuxPath = sshHostForm.isMacRemote ? '/opt/homebrew/bin/tmux' : '';

            if (editingSSHHost === 'new') {
                await AddSSHHost(
                    sshHostForm.hostId.trim(),
                    sshHostForm.host.trim(),
                    sshHostForm.user.trim(),
                    sshHostForm.port || 22,
                    sshHostForm.identityFile.trim(),
                    '', // description
                    sshHostForm.groupName.trim() || sshHostForm.hostId.trim(),
                    sshHostForm.autoDiscover,
                    tmuxPath,
                    '' // jumpHost
                );
                logger.info('Added SSH host', { hostId: sshHostForm.hostId });
            } else {
                await UpdateSSHHost(
                    sshHostForm.hostId.trim(),
                    sshHostForm.host.trim(),
                    sshHostForm.user.trim(),
                    sshHostForm.port || 22,
                    sshHostForm.identityFile.trim(),
                    '', // description
                    sshHostForm.groupName.trim() || sshHostForm.hostId.trim(),
                    sshHostForm.autoDiscover,
                    tmuxPath,
                    '' // jumpHost
                );
                logger.info('Updated SSH host', { hostId: sshHostForm.hostId });
            }

            await loadSSHHosts();
            setEditingSSHHost(null);
            resetSSHHostForm();
        } catch (err) {
            logger.error('Failed to save SSH host:', err);
            setSSHHostErrors({ submit: err.message || 'Failed to save host' });
        }
    };

    const handleRemoveSSHHost = async (hostId) => {
        if (!confirm(`Remove SSH host "${hostId}"?`)) return;
        try {
            await RemoveSSHHost(hostId);
            logger.info('Removed SSH host', { hostId });
            await loadSSHHosts();
        } catch (err) {
            logger.error('Failed to remove SSH host:', err);
            alert('Failed to remove host: ' + err.message);
        }
    };

    const handleTestSSHHost = async (hostId) => {
        setTestingSSHHost(hostId);
        setSSHTestResults(prev => ({ ...prev, [hostId]: null }));

        try {
            await TestSSHConnection(hostId);
            setSSHTestResults(prev => ({ ...prev, [hostId]: { success: true } }));
            logger.info('SSH test succeeded', { hostId });
        } catch (err) {
            setSSHTestResults(prev => ({
                ...prev,
                [hostId]: { success: false, message: err.message || 'Connection failed' }
            }));
            logger.error('SSH test failed', { hostId, error: err.message });
        } finally {
            setTestingSSHHost(null);
        }
    };

    const loadConfigs = async () => {
        try {
            setLoading(true);
            const result = await GetLaunchConfigs();
            setConfigs(result || []);
            logger.info('Loaded launch configs', { count: result?.length || 0 });
        } catch (err) {
            logger.error('Failed to load launch configs:', err);
        } finally {
            setLoading(false);
        }
    };

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (editingConfig || creatingForTool) {
                // Close editor, go back to list
                setEditingConfig(null);
                setCreatingForTool(null);
            } else {
                // Close modal
                onClose();
            }
        }
    }, [editingConfig, creatingForTool, onClose]);

    useEffect(() => {
        // Use capture phase to intercept before xterm can swallow the event
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    // Group configs by tool
    const configsByTool = {};
    TOOLS.forEach(tool => {
        configsByTool[tool.id] = configs.filter(c => c.tool === tool.id);
    });

    const handleEdit = (config) => {
        logger.info('Editing config', { key: config.key });
        setEditingConfig(config);
    };

    const handleDelete = async (config) => {
        if (!confirm(`Delete "${config.name}"?`)) return;

        try {
            await DeleteLaunchConfig(config.key);
            logger.info('Deleted config', { key: config.key });
            await loadConfigs();
        } catch (err) {
            logger.error('Failed to delete config:', err);
            alert('Failed to delete config: ' + err.message);
        }
    };

    const handleCreate = (toolId) => {
        logger.info('Creating new config for tool', { tool: toolId });
        setCreatingForTool(toolId);
    };

    const handleEditorSave = async () => {
        setEditingConfig(null);
        setCreatingForTool(null);
        await loadConfigs();
    };

    const handleEditorCancel = () => {
        setEditingConfig(null);
        setCreatingForTool(null);
    };

    // Show editor if editing or creating
    if (editingConfig || creatingForTool) {
        return (
            <div className="settings-overlay" onClick={onClose}>
                <div className="settings-container" onClick={(e) => e.stopPropagation()}>
                    <LaunchConfigEditor
                        config={editingConfig}
                        tool={creatingForTool || editingConfig?.tool}
                        onSave={handleEditorSave}
                        onCancel={handleEditorCancel}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-container" ref={containerRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="settings-close" onClick={onClose}>
                        &times;
                    </button>
                </div>

                <div className="settings-content">
                    {/* Theme Section */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🎨</span>
                            <h3>Appearance</h3>
                        </div>
                        <div className="settings-theme-options">
                            <button
                                className={`settings-theme-option ${themePreference === 'dark' ? 'active' : ''}`}
                                onClick={() => setTheme('dark')}
                            >
                                <span className="settings-theme-option-icon">🌙</span>
                                Dark
                            </button>
                            <button
                                className={`settings-theme-option ${themePreference === 'light' ? 'active' : ''}`}
                                onClick={() => setTheme('light')}
                            >
                                <span className="settings-theme-option-icon">☀️</span>
                                Light
                            </button>
                            <button
                                className={`settings-theme-option ${themePreference === 'auto' ? 'active' : ''}`}
                                onClick={() => setTheme('auto')}
                            >
                                <span className="settings-theme-option-icon">💻</span>
                                Auto
                            </button>
                        </div>
                        <div className="settings-checkbox-item settings-appearance-checkbox">
                            <label className="settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={showActivityRibbon}
                                    onChange={(e) => handleShowActivityRibbonChange(e.target.checked)}
                                />
                                Show activity ribbon on tabs
                            </label>
                            <p className="settings-input-description">
                                Display waiting time indicator below each session tab.
                            </p>
                        </div>
                        <div className="settings-checkbox-item settings-appearance-checkbox">
                            <label className="settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={fileBasedActivityDetection}
                                    onChange={(e) => handleFileBasedActivityDetectionChange(e.target.checked)}
                                />
                                File-based activity detection
                            </label>
                            <p className="settings-input-description">
                                Use Claude/Gemini session file timestamps to detect running status.
                                More reliable than terminal output parsing.
                            </p>
                        </div>
                    </div>

                    {/* Terminal Input Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">⌨️</span>
                            <h3>Terminal Input</h3>
                        </div>
                        <div className="settings-input-description">
                            Soft newline inserts a new line without executing the command.
                            You can also use <code>\</code> at the end of a line (backslash continuation).
                        </div>
                        <div className="settings-theme-options settings-input-options">
                            <button
                                className={`settings-theme-option ${softNewlineMode === 'both' ? 'active' : ''}`}
                                onClick={() => handleSoftNewlineModeChange('both')}
                                title="Both Shift+Enter and Option/Alt+Enter insert newline"
                            >
                                Both
                            </button>
                            <button
                                className={`settings-theme-option ${softNewlineMode === 'shift_enter' ? 'active' : ''}`}
                                onClick={() => handleSoftNewlineModeChange('shift_enter')}
                                title="Only Shift+Enter inserts newline"
                            >
                                Shift+Enter
                            </button>
                            <button
                                className={`settings-theme-option ${softNewlineMode === 'alt_enter' ? 'active' : ''}`}
                                onClick={() => handleSoftNewlineModeChange('alt_enter')}
                                title="Only Option/Alt+Enter inserts newline"
                            >
                                Opt+Enter
                            </button>
                            <button
                                className={`settings-theme-option ${softNewlineMode === 'disabled' ? 'active' : ''}`}
                                onClick={() => handleSoftNewlineModeChange('disabled')}
                                title="Disable soft newline (use backslash continuation instead)"
                            >
                                Disabled
                            </button>
                        </div>
                    </div>

                    {/* Font Size Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🔤</span>
                            <h3>Font Size</h3>
                        </div>
                        <div className="settings-input-description">
                            Terminal font size. Use <kbd>⌘+</kbd> / <kbd>⌘-</kbd> to adjust while in terminal.
                        </div>
                        <div className="settings-font-size-controls">
                            <button
                                className="settings-font-btn"
                                onClick={() => handleFontSizeChange(-1)}
                                disabled={fontSize <= MIN_FONT_SIZE}
                                title="Decrease font size"
                            >
                                −
                            </button>
                            <span className="settings-font-size-value">{fontSize}px</span>
                            <button
                                className="settings-font-btn"
                                onClick={() => handleFontSizeChange(1)}
                                disabled={fontSize >= MAX_FONT_SIZE}
                                title="Increase font size"
                            >
                                +
                            </button>
                            <button
                                className="settings-font-reset-btn"
                                onClick={handleFontSizeReset}
                                disabled={fontSize === DEFAULT_FONT_SIZE}
                                title={`Reset to default (${DEFAULT_FONT_SIZE}px)`}
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Scroll Speed Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🖱️</span>
                            <h3>Scroll Speed</h3>
                        </div>
                        <div className="settings-input-description">
                            Mouse and trackpad scroll speed in terminal. Higher values scroll faster.
                        </div>
                        <div className="settings-scroll-speed-controls">
                            <input
                                type="range"
                                className="settings-scroll-slider"
                                min={MIN_SCROLL_SPEED}
                                max={MAX_SCROLL_SPEED}
                                step={10}
                                value={scrollSpeed}
                                onChange={(e) => handleScrollSpeedChange(parseInt(e.target.value, 10))}
                                title={`Scroll speed: ${scrollSpeed}%`}
                            />
                            <span className="settings-scroll-speed-value">{scrollSpeed}%</span>
                            <button
                                className="settings-font-reset-btn"
                                onClick={handleScrollSpeedReset}
                                disabled={scrollSpeed === DEFAULT_SCROLL_SPEED}
                                title="Reset to default (100%)"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* Project Discovery Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🔍</span>
                            <h3>Project Discovery</h3>
                        </div>
                        <div className="settings-input-description">
                            Directories scanned for projects.
                        </div>
                        <div className="settings-scan-paths-list">
                            {scanPaths.length === 0 ? (
                                <div className="settings-empty">No scan paths configured</div>
                            ) : (
                                scanPaths.map(path => (
                                    <div key={path} className="settings-scan-path-item">
                                        <span className="settings-scan-path-text" title={path}>{path}</span>
                                        <button
                                            className="settings-scan-path-remove"
                                            onClick={() => handleRemoveScanPath(path)}
                                            title="Remove path"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="settings-scan-add-btn" onClick={handleAddScanPath}>
                            Add Scan Path
                        </button>
                        <div className="settings-scan-depth-row">
                            <span className="settings-scan-depth-label">Max depth</span>
                            <div className="settings-font-size-controls">
                                <button
                                    className="settings-font-btn"
                                    onClick={() => handleMaxDepthChange(-1)}
                                    disabled={scanMaxDepth <= 1}
                                    title="Decrease depth"
                                >
                                    −
                                </button>
                                <span className="settings-font-size-value">{scanMaxDepth}</span>
                                <button
                                    className="settings-font-btn"
                                    onClick={() => handleMaxDepthChange(1)}
                                    disabled={scanMaxDepth >= 5}
                                    title="Increase depth"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Remote Machines Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🌐</span>
                            <h3>Remote Machines</h3>
                        </div>
                        <div className="settings-input-description">
                            SSH hosts for remote session discovery. RevvySwarm must be installed on each machine.
                        </div>

                        {editingSSHHost ? (
                            <div className="settings-ssh-host-form">
                                <div className="settings-ssh-form-row">
                                    <div className="settings-ssh-form-field">
                                        <label>Display Name *</label>
                                        <input
                                            type="text"
                                            value={sshHostForm.groupName || sshHostForm.hostId}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setSSHHostForm(prev => ({
                                                    ...prev,
                                                    groupName: val,
                                                    // Only auto-derive hostId when creating new
                                                    ...(editingSSHHost === 'new' && !prev.hostId ? { hostId: val.toLowerCase().replace(/[^a-z0-9]/g, '-') } : {}),
                                                }));
                                            }}
                                            placeholder="My MacBook"
                                        />
                                        {sshHostErrors.hostId && (
                                            <span className="settings-ssh-error">{sshHostErrors.hostId}</span>
                                        )}
                                    </div>
                                    <div className="settings-ssh-form-field settings-ssh-form-field-wide">
                                        <label>Host / IP *</label>
                                        <input
                                            type="text"
                                            value={sshHostForm.host}
                                            onChange={(e) => setSSHHostForm(prev => ({ ...prev, host: e.target.value }))}
                                            placeholder="192.168.1.100"
                                        />
                                        {sshHostErrors.host && (
                                            <span className="settings-ssh-error">{sshHostErrors.host}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="settings-ssh-form-row">
                                    <div className="settings-ssh-form-field">
                                        <label>Username</label>
                                        <input
                                            type="text"
                                            value={sshHostForm.user}
                                            onChange={(e) => setSSHHostForm(prev => ({ ...prev, user: e.target.value }))}
                                            placeholder="(current user)"
                                        />
                                    </div>
                                    <div className="settings-ssh-form-field settings-ssh-form-field-narrow">
                                        <label>Port</label>
                                        <input
                                            type="number"
                                            value={sshHostForm.port}
                                            onChange={(e) => setSSHHostForm(prev => ({ ...prev, port: parseInt(e.target.value) || 22 }))}
                                        />
                                    </div>
                                </div>

                                {/* SSH Key section */}
                                <div className="settings-ssh-key-section">
                                    <label className="settings-ssh-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={!sshHostForm.identityFile}
                                            onChange={(e) => setSSHHostForm(prev => ({
                                                ...prev,
                                                identityFile: e.target.checked ? '' : '~/.ssh/id_rsa'
                                            }))}
                                        />
                                        Use default SSH keys
                                        <span className="settings-ssh-key-hint">
                                            SSH agent + ~/.ssh/id_ed25519, id_rsa, etc.
                                        </span>
                                    </label>
                                    {sshHostForm.identityFile && (
                                        <div className="settings-ssh-form-field settings-ssh-custom-key">
                                            <label>Custom Key Path</label>
                                            <input
                                                type="text"
                                                value={sshHostForm.identityFile}
                                                onChange={(e) => setSSHHostForm(prev => ({ ...prev, identityFile: e.target.value }))}
                                                placeholder="~/.ssh/id_rsa"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="settings-ssh-form-checkboxes">
                                    <label className="settings-ssh-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={sshHostForm.autoDiscover}
                                            onChange={(e) => setSSHHostForm(prev => ({ ...prev, autoDiscover: e.target.checked }))}
                                        />
                                        Auto-discover sessions
                                    </label>
                                    <label className="settings-ssh-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={sshHostForm.isMacRemote}
                                            onChange={(e) => setSSHHostForm(prev => ({ ...prev, isMacRemote: e.target.checked }))}
                                        />
                                        macOS with Homebrew
                                    </label>
                                </div>

                                {sshHostErrors.submit && (
                                    <div className="settings-ssh-error-banner">{sshHostErrors.submit}</div>
                                )}

                                <div className="settings-ssh-form-actions">
                                    <button className="settings-ssh-form-cancel" onClick={handleCancelSSHHostForm}>
                                        Cancel
                                    </button>
                                    <button className="settings-ssh-form-save" onClick={handleSaveSSHHost}>
                                        {editingSSHHost === 'new' ? 'Add Host' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="settings-ssh-hosts-list">
                                    {sshHosts.length === 0 ? (
                                        <div className="settings-empty">No remote hosts configured</div>
                                    ) : (
                                        sshHosts.map(host => (
                                            <div key={host.hostId} className="settings-ssh-host-item">
                                                <div className="settings-ssh-host-info">
                                                    <span className="settings-ssh-host-name">
                                                        {host.groupName || host.hostId}
                                                    </span>
                                                    <span className="settings-ssh-host-address">
                                                        {host.user ? `${host.user}@` : ''}{host.host}
                                                        {host.port && host.port !== 22 ? `:${host.port}` : ''}
                                                    </span>
                                                </div>
                                                <div className="settings-ssh-host-actions">
                                                    {sshTestResults[host.hostId] && (
                                                        <span className={`settings-ssh-test-result ${sshTestResults[host.hostId].success ? 'success' : 'error'}`}>
                                                            {sshTestResults[host.hostId].success ? '✓' : '✗'}
                                                        </span>
                                                    )}
                                                    <button
                                                        className="settings-ssh-host-test"
                                                        onClick={() => handleTestSSHHost(host.hostId)}
                                                        disabled={testingSSHHost === host.hostId}
                                                        title="Test connection"
                                                    >
                                                        {testingSSHHost === host.hostId ? '...' : 'Test'}
                                                    </button>
                                                    <button
                                                        className="settings-ssh-host-edit"
                                                        onClick={() => handleEditSSHHost(host)}
                                                        title="Edit host"
                                                    >
                                                        ✎
                                                    </button>
                                                    <button
                                                        className="settings-ssh-host-remove"
                                                        onClick={() => handleRemoveSSHHost(host.hostId)}
                                                        title="Remove host"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <button className="settings-ssh-add-btn" onClick={handleAddSSHHostClick}>
                                    Add Remote Machine
                                </button>
                            </>
                        )}
                    </div>

                    {/* Group Settings */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">📁</span>
                            <h3>Session Groups</h3>
                        </div>
                        <div className="settings-input-description">
                            Group expand/collapse state is saved separately from the TUI.
                            Reset to use the expand/collapse state from Agent Deck TUI.
                        </div>
                        <div className="settings-group-controls">
                            <button
                                className="settings-reset-groups-btn"
                                onClick={handleResetGroupSettings}
                                title="Reset group expand/collapse settings to TUI defaults"
                            >
                                Reset to TUI Defaults
                            </button>
                        </div>
                    </div>

                    {/* Experimental Features */}
                    <div className="settings-theme-section">
                        <div className="settings-theme-header">
                            <span className="settings-theme-icon">🧪</span>
                            <h3>Experimental</h3>
                        </div>
                        <div className="settings-checkbox-item">
                            <label className="settings-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={autoCopyOnSelect}
                                    onChange={(e) => handleAutoCopyOnSelectChange(e.target.checked)}
                                />
                                Auto-copy on select
                            </label>
                            <p className="settings-input-description">
                                Automatically copy selected text to clipboard.
                            </p>
                        </div>
                    </div>

                    {/* Launch Configurations */}
                    {loading ? (
                        <div className="settings-loading">Loading...</div>
                    ) : (
                        TOOLS.map(tool => (
                            <div key={tool.id} className="settings-tool-section">
                                <div className="settings-tool-header">
                                    <span
                                        className="settings-tool-icon"
                                        style={{ backgroundColor: tool.color }}
                                    >
                                        <ToolIcon tool={tool.id} size={14} />
                                    </span>
                                    <h3>{tool.name}</h3>
                                    <button
                                        className="settings-add-btn"
                                        onClick={() => handleCreate(tool.id)}
                                        title={`Add ${tool.name} configuration`}
                                    >
                                        +
                                    </button>
                                </div>

                                {configsByTool[tool.id].length === 0 ? (
                                    <div className="settings-empty">
                                        No configurations. Click + to add one.
                                    </div>
                                ) : (
                                    <div className="settings-config-list">
                                        {configsByTool[tool.id].map(config => (
                                            <div key={config.key} className="settings-config-item">
                                                <div className="settings-config-info">
                                                    {config.dangerousMode && (
                                                        <span
                                                            className="settings-danger-icon"
                                                            title="Dangerous mode enabled: auto-approves tool actions"
                                                        >
                                                            ⚠
                                                        </span>
                                                    )}
                                                    <span className="settings-config-name">
                                                        {config.name}
                                                    </span>
                                                    {config.isDefault && (
                                                        <span className="settings-default-badge">
                                                            default
                                                        </span>
                                                    )}
                                                </div>
                                                {config.description && (
                                                    <div className="settings-config-desc">
                                                        {config.description}
                                                    </div>
                                                )}
                                                {config.mcpNames && config.mcpNames.length > 0 && (
                                                    <div className="settings-config-mcps">
                                                        MCPs: {config.mcpNames.join(', ')}
                                                    </div>
                                                )}
                                                <div className="settings-config-actions">
                                                    <button
                                                        className="settings-edit-btn"
                                                        onClick={() => handleEdit(config)}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="settings-delete-btn"
                                                        onClick={() => handleDelete(config)}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="settings-footer">
                    <span className="settings-hint">
                        Press <kbd>Esc</kbd> to close
                    </span>
                </div>
            </div>
        </div>
    );
}
