import { useState, useEffect, useRef } from 'react';
import './HostPicker.css';
import { createLogger } from './logger';
import { ListSSHHosts, GetSSHHostStatus, GetSSHHostDisplayNames, TestSSHConnection } from '../wailsjs/go/main/App';
import { withKeyboardIsolation } from './utils/keyboardIsolation';

const logger = createLogger('HostPicker');

// Special ID for local host option (always first)
export const LOCAL_HOST_ID = 'local';

export default function HostPicker({ onSelect, onCancel }) {
    const [sshHosts, setSSHHosts] = useState([]);
    const [hostStatuses, setHostStatuses] = useState({});
    const [hostDisplayNames, setHostDisplayNames] = useState({}); // hostId -> friendly name
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [testing, setTesting] = useState(null); // hostId being tested
    const containerRef = useRef(null);

    // Build full host list with Local first
    const hosts = [LOCAL_HOST_ID, ...sshHosts];

    // Load SSH hosts on mount
    useEffect(() => {
        const loadHosts = async () => {
            try {
                const [hostList, displayNames] = await Promise.all([
                    ListSSHHosts(),
                    GetSSHHostDisplayNames(),
                ]);
                setSSHHosts(hostList || []);
                setHostDisplayNames(displayNames || {});
                logger.info('Loaded SSH hosts', { count: hostList?.length || 0, displayNames });

                // Get connection statuses for SSH hosts
                if (hostList && hostList.length > 0) {
                    const statuses = await GetSSHHostStatus();
                    const statusMap = {};
                    for (const status of statuses || []) {
                        statusMap[status.hostId] = status;
                    }
                    setHostStatuses(statusMap);
                }
            } catch (err) {
                logger.error('Failed to load SSH hosts:', err);
            }
            setLoading(false);
        };
        loadHosts();
    }, []);

    // Focus container when loading completes (the container isn't rendered during loading state)
    useEffect(() => {
        if (!loading) {
            containerRef.current?.focus();
        }
    }, [loading]);

    const handleTestConnection = async (hostId, e) => {
        e.stopPropagation();
        setTesting(hostId);
        try {
            await TestSSHConnection(hostId);
            // Update status to connected
            setHostStatuses(prev => ({
                ...prev,
                [hostId]: { hostId, connected: true, lastError: '' }
            }));
            logger.info('SSH connection test passed', { hostId });
        } catch (err) {
            // Update status with error
            setHostStatuses(prev => ({
                ...prev,
                [hostId]: { hostId, connected: false, lastError: err.toString() }
            }));
            logger.error('SSH connection test failed', { hostId, error: err });
        }
        setTesting(null);
    };

    const handleKeyDown = withKeyboardIsolation((e) => {
        // Always handle Escape
        if (e.key === 'Escape') {
            e.preventDefault();
            logger.info('Host picker cancelled');
            onCancel();
            return;
        }

        // L key to quick-select Local
        if (e.key === 'l' || e.key === 'L') {
            e.preventDefault();
            logger.info('L key pressed - selecting Local');
            handleSelect(LOCAL_HOST_ID);
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % hosts.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + hosts.length) % hosts.length);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                handleSelect(hosts[selectedIndex]);
                break;
        }
        // Number keys for quick select (1-9)
        if (e.key >= '1' && e.key <= '9') {
            const idx = parseInt(e.key, 10) - 1;
            if (idx < hosts.length) {
                e.preventDefault();
                handleSelect(hosts[idx]);
            }
        }
    });

    const handleSelect = (hostId) => {
        logger.info('Host selected', { hostId });
        onSelect(hostId);
    };

    if (loading) {
        return (
            <div className="host-picker-overlay" onClick={onCancel}>
                <div className="host-picker-container" onClick={e => e.stopPropagation()}>
                    <div className="host-picker-loading">Loading hosts...</div>
                </div>
            </div>
        );
    }

    // Render helper for a host option
    const renderHostOption = (hostId, index) => {
        const isLocal = hostId === LOCAL_HOST_ID;
        const status = hostStatuses[hostId];
        const isConnected = status?.connected;
        const hasError = status?.lastError;
        // Use friendly display name if available, fall back to hostId
        // Add "(via SSH)" suffix to clarify these are remote connections
        const baseName = hostDisplayNames[hostId] || hostId;
        const displayName = `${baseName} (via SSH)`;

        return (
            <button
                key={hostId}
                className={`host-picker-option ${index === selectedIndex ? 'selected' : ''} ${isLocal ? 'local' : ''}`}
                onClick={() => handleSelect(hostId)}
                onMouseEnter={() => setSelectedIndex(index)}
            >
                {isLocal ? (
                    // Local option with distinct styling
                    <>
                        <span className="host-picker-local-icon">💻</span>
                        <div className="host-picker-info">
                            <div className="host-picker-name">Local</div>
                            <div className="host-picker-subtitle-text">Use native folder picker</div>
                        </div>
                        <span className="host-picker-shortcut local-shortcut">L</span>
                    </>
                ) : (
                    // SSH host option
                    <>
                        <span className="host-picker-server-icon">🖥️</span>
                        <span className={`host-picker-status-dot ${isConnected ? 'connected' : hasError ? 'error' : 'unknown'}`}>
                            {isConnected ? '●' : hasError ? '○' : '○'}
                        </span>
                        <div className="host-picker-info">
                            <div className="host-picker-name">{displayName}</div>
                            {hasError && (
                                <div className="host-picker-error" title={hasError}>
                                    {hasError.substring(0, 50)}...
                                </div>
                            )}
                        </div>
                        <button
                            className="host-picker-test"
                            onClick={(e) => handleTestConnection(hostId, e)}
                            disabled={testing === hostId}
                            title="Test connection"
                        >
                            {testing === hostId ? '...' : '🔌'}
                        </button>
                        <span className="host-picker-shortcut">{index + 1}</span>
                    </>
                )}
            </button>
        );
    };

    return (
        <div className="host-picker-overlay" onClick={onCancel}>
            <div
                ref={containerRef}
                className="host-picker-container"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                tabIndex={0}
            >
                <div className="host-picker-header">
                    <h3>Select Host</h3>
                    <p className="host-picker-subtitle">Choose where to create the session</p>
                </div>
                <div className="host-picker-options">
                    {hosts.map((hostId, index) => renderHostOption(hostId, index))}
                </div>
                <div className="host-picker-footer">
                    <span className="host-picker-hint"><kbd>↑↓</kbd> Navigate</span>
                    <span className="host-picker-hint"><kbd>L</kbd> Local</span>
                    <span className="host-picker-hint"><kbd>1-9</kbd> Quick select</span>
                    <span className="host-picker-hint"><kbd>Enter</kbd> Select</span>
                    <span className="host-picker-hint"><kbd>Esc</kbd> Cancel</span>
                </div>
            </div>
        </div>
    );
}
