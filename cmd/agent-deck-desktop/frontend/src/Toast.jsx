import { useState, useEffect, useCallback, useRef } from 'react';
import { EventsOn } from '../wailsjs/runtime/runtime';
import './Toast.css';

/**
 * Toast notification component for displaying brief messages.
 * Listens to 'toast:show' events from the Go backend.
 *
 * Event payload: { message: string, type: 'info' | 'success' | 'error' | 'warning' }
 */
export default function Toast() {
    const [toasts, setToasts] = useState([]);
    const mountedRef = useRef(true);

    // Add a toast with auto-dismiss
    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random();
        const toast = { id, message, type };

        setToasts(prev => [...prev, toast]);

        // Auto-dismiss after 3 seconds (5s for errors)
        const duration = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    // Listen for toast events from backend
    useEffect(() => {
        mountedRef.current = true;
        const handler = (data) => {
            if (!mountedRef.current) return;
            if (data?.message) {
                addToast(data.message, data.type || 'info');
            }
        };
        EventsOn('toast:show', handler);

        return () => { mountedRef.current = false; };
    }, [addToast]);

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    <span className="toast-icon">
                        {toast.type === 'success' && '✓'}
                        {toast.type === 'error' && '✕'}
                        {toast.type === 'warning' && '⚠'}
                        {toast.type === 'info' && 'ℹ'}
                    </span>
                    <span className="toast-message">{toast.message}</span>
                </div>
            ))}
        </div>
    );
}
