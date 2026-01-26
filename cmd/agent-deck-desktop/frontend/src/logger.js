// Development logger utility with backend file logging
//
// This module intercepts ALL console output and pipes it to the backend log file
// at ~/.agent-deck/logs/frontend-console.log so agents can read logs directly
// without requiring manual relay from the developer.
//
// Usage:
//   - Call installGlobalErrorHandler() at app startup (already done in main.jsx)
//   - All console.log/debug/info/warn/error calls are automatically captured
//   - Use createLogger(context) for contextual logging with nice formatting
//
// Agent access:
//   - Logs are written to: ~/.agent-deck/logs/frontend-console.log
//   - Use: tail -f ~/.agent-deck/logs/frontend-console.log
//   - Or use the /read-desktop-logs skill

import { LogFrontendDiagnostic } from '../wailsjs/go/main/App';

const isDev = import.meta.env.DEV;

const LOG_STYLES = {
    debug: 'color: #888',
    info: 'color: #4cc9f0',
    warn: 'color: #ffe66d; font-weight: bold',
    error: 'color: #ff6b6b; font-weight: bold',
};

// Format args for file logging (stringify objects, handle errors)
function formatArgs(args) {
    return args.map(arg => {
        if (arg instanceof Error) {
            return `${arg.message}\n${arg.stack || ''}`;
        }
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
}

// Store original console methods before overriding
const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

// Track if console interception is installed
let consoleInterceptionInstalled = false;

// Install console interception to capture ALL console output
function installConsoleInterception() {
    if (consoleInterceptionInstalled) return;
    consoleInterceptionInstalled = true;

    const levels = ['log', 'debug', 'info', 'warn', 'error'];

    levels.forEach(level => {
        console[level] = (...args) => {
            // Always call original console method first
            originalConsole[level](...args);

            // Pipe to backend log file (in dev mode, capture all; in prod, only warn/error)
            if (isDev || level === 'warn' || level === 'error') {
                const timestamp = new Date().toISOString();
                const message = `[${timestamp}] [CONSOLE.${level.toUpperCase()}] ${formatArgs(args)}`;
                LogFrontendDiagnostic(message).catch(() => {
                    // Ignore errors from logging - don't create infinite loop
                });
            }
        };
    });
}

class Logger {
    constructor(context) {
        this.context = context;
    }

    _log(level, ...args) {
        if (!isDev && level === 'debug') return;

        const prefix = `[${this.context}]`;
        const style = LOG_STYLES[level] || '';

        // Log to console (which will be intercepted and sent to backend)
        originalConsole[level](`%c${prefix}`, style, ...args);

        // Also write directly to backend with context prefix
        const timestamp = new Date().toISOString();
        const message = `[${timestamp}] [${level.toUpperCase()}] ${prefix} ${formatArgs(args)}`;
        LogFrontendDiagnostic(message).catch(() => {
            // Ignore errors from logging - don't create infinite loop
        });
    }

    debug(...args) {
        this._log('debug', ...args);
    }

    info(...args) {
        this._log('info', ...args);
    }

    warn(...args) {
        this._log('warn', ...args);
    }

    error(...args) {
        this._log('error', ...args);
    }
}

export function createLogger(context) {
    return new Logger(context);
}

// Global error handler - call once at app startup
let globalErrorHandlerInstalled = false;
export function installGlobalErrorHandler() {
    if (globalErrorHandlerInstalled) return;
    globalErrorHandlerInstalled = true;

    // Install console interception FIRST so all logs are captured
    installConsoleInterception();

    const globalLogger = createLogger('GLOBAL');

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        globalLogger.error('Unhandled promise rejection:', event.reason);
    });

    // Catch uncaught errors
    window.addEventListener('error', (event) => {
        globalLogger.error('Uncaught error:', event.error || event.message);
    });

    // Log that we've installed the handler
    LogFrontendDiagnostic('[INIT] Console interception and global error handler installed').catch(() => {});
}

export default { createLogger, installGlobalErrorHandler };
