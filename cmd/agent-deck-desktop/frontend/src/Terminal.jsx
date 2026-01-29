import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
// import { WebglAddon } from '@xterm/addon-webgl'; // Disabled - breaks scroll detection
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';
import { StartTerminal, WriteTerminal, ResizeTerminal, CloseTerminal, StartTmuxSession, StartRemoteTmuxSession, LogFrontendDiagnostic, GetTerminalSettings, RefreshTerminalAfterResize, HandleRemoteImagePaste, HandleFileDrop } from '../wailsjs/go/main/App';
import { createLogger } from './logger';
import { DEFAULT_FONT_SIZE } from './constants/terminal';
import { EventsOn, ClipboardSetText, BrowserOpenURL } from '../wailsjs/runtime/runtime';
import { createScrollAccumulator, DEFAULT_SCROLL_SPEED, normalizeDeltaToPixels } from './utils/scrollAccumulator';
import { useTheme } from './context/ThemeContext';
import { getTerminalTheme } from './themes/terminal';
import { createMacKeyBindingHandler } from './hooks/useMacKeyBindings';
import { shouldInterceptShortcut, isMac } from './utils/platform';

// Connection state constants for remote sessions
const CONN_STATE = {
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    FAILED: 'failed',
};

// Base terminal options (theme applied dynamically)
const BASE_TERMINAL_OPTIONS = {
    fontFamily: '"MesloLGS NF", Menlo, Monaco, "Courier New", monospace',
    fontSize: DEFAULT_FONT_SIZE,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 50000,
    allowProposedApi: true,
    // xterm.js v6 uses DOM renderer by default, with VS Code-based scrollbar
    // Enable smooth scroll animation for visual smoothness (100ms duration)
    smoothScrollDuration: 100,
    fastScrollModifier: 'alt',
    // Window mode affects wrapping behavior
    windowsMode: false, // Unix-style wrapping (default)
    // Note: Terminal content doesn't reflow on resize (standard behavior)
    // Already-printed output stays wrapped at original width
};

// requestAnimationFrame throttle - fires at most once per frame
function rafThrottle(fn) {
    let rafId = null;
    return (...args) => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            rafId = null;
            fn(...args);
        });
    };
}

const logger = createLogger('Terminal');

export default function Terminal({ searchRef, session, paneId, onFocus, fontSize = DEFAULT_FONT_SIZE, scrollSpeed = DEFAULT_SCROLL_SPEED }) {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const searchAddonRef = useRef(null);
    const initRef = useRef(false);
    const isAtBottomRef = useRef(true);
    const lastPasteRef = useRef({ text: '', time: 0 });
    const [showScrollIndicator, setShowScrollIndicator] = useState(false);
    const [isAltScreen, setIsAltScreen] = useState(false);
    const [connectionState, setConnectionState] = useState(CONN_STATE.CONNECTED);
    const [connectionInfo, setConnectionInfo] = useState(null);
    const { theme } = useTheme();

    // RAF batching for terminal:data events (reduces DOM pressure during fast output)
    const writeBufferRef = useRef('');
    const rafWriteIdRef = useRef(null);
    const frontendStatsRef = useRef({
        eventsReceived: 0,
        bytesReceived: 0,
        rafFlushes: 0,
        bytesWritten: 0,
    });
    const [showDebugOverlay, setShowDebugOverlay] = useState(false);
    const [debugRefreshKey, setDebugRefreshKey] = useState(0); // Forces debug overlay re-render

    // Update terminal theme when app theme changes
    useEffect(() => {
        if (xtermRef.current) {
            const terminalTheme = getTerminalTheme(theme);
            xtermRef.current.options.theme = terminalTheme;
            logger.debug('Updated terminal theme to:', theme);
        }
    }, [theme]);

    // Update terminal font size when it changes
    useEffect(() => {
        if (xtermRef.current && fitAddonRef.current) {
            xtermRef.current.options.fontSize = fontSize;
            fitAddonRef.current.fit();
            logger.debug('Updated terminal font size to:', fontSize);
        }
    }, [fontSize]);

    // Initialize terminal
    useEffect(() => {
        // Prevent double initialization (React StrictMode)
        if (!terminalRef.current || initRef.current) return;
        initRef.current = true;

        logger.info('Initializing terminal', session ? `session: ${session.title}` : 'new terminal');

        // Get theme-specific terminal options
        const terminalTheme = getTerminalTheme(theme);
        const terminalOptions = {
            ...BASE_TERMINAL_OPTIONS,
            fontSize,
            theme: terminalTheme,
        };

        const term = new XTerm(terminalOptions);
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();
        const webLinksAddon = new WebLinksAddon((_event, uri) => {
            BrowserOpenURL(uri);
        });
        const unicode11Addon = new Unicode11Addon();

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);
        term.loadAddon(webLinksAddon);
        term.loadAddon(unicode11Addon);

        term.open(terminalRef.current);

        // Using DOM renderer (xterm.js v6 default)
        // Note: WebGL addon breaks scroll detection in WKWebView
        logger.info('xterm.js v6 initialized with DOM renderer');
        console.log('%c[RENDERER] Using DOM renderer', 'color: lime; font-weight: bold');
        LogFrontendDiagnostic('[RENDERER] Using DOM renderer');

        // Unicode 11 disabled for testing - may be related to rendering corruption
        // term.unicode.activeVersion = '11';

        // Initial fit
        fitAddon.fit();

        // Store refs
        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        searchAddonRef.current = searchAddon;

        // Expose for debugging (remove in production)
        window._xterm = term;

        // Expose terminal and search addon via ref for enhanced search
        if (searchRef) {
            searchRef.current = {
                terminal: term,
                searchAddon: searchAddon,
            };
        }

        // Get the session ID for this terminal (used for multi-pane support)
        const sessionId = session?.id || 'default';

        // ============================================================
        // ALT-SCREEN TRACKING (from backend via tmux)
        // ============================================================
        // The backend polls tmux for #{alternate_on} and emits terminal:altscreen
        // when apps like nano/vim/less switch to/from alternate screen buffer.
        // We use this to decide whether to send Page Up/Down for scrolling.
        // ============================================================
        let isInAltScreen = false;

        const handleAltScreenChange = (payload) => {
            if (payload?.sessionId !== sessionId) return;
            isInAltScreen = payload.inAltScreen;
            setIsAltScreen(payload.inAltScreen); // Update state for CSS class
            console.log(`%c[ALT-SCREEN] Changed to: ${isInAltScreen}`, 'color: magenta; font-weight: bold');
            LogFrontendDiagnostic(`[ALT-SCREEN] Changed to: ${isInAltScreen}`);
        };
        const cancelAltScreen = EventsOn('terminal:altscreen', handleAltScreenChange);

        // ============================================================
        // MOUSE MODE TRACKING (parser hooks - may not work in polling mode)
        // ============================================================
        // Track which mouse modes the backend application has enabled.
        // NOTE: In polling mode, these sequences may be stripped, so
        // alt-screen tracking above is more reliable.
        // ============================================================
        const mouseModes = new Set();

        // Monitor mouse mode enable sequences (CSI ? ... h)
        const enableHandler = term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
            for (const p of params) {
                if ([1000, 1002, 1003, 1006].includes(p)) {
                    mouseModes.add(p);
                    console.log(`%c[MOUSE] Enabled mode ${p}. Active modes:`, 'color: cyan', [...mouseModes]);
                    LogFrontendDiagnostic(`[MOUSE] Enabled mode ${p}. Active: ${[...mouseModes].join(',')}`);
                }
            }
            return false; // Allow xterm to process it too
        });

        // Monitor mouse mode disable sequences (CSI ? ... l)
        const disableHandler = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
            for (const p of params) {
                if (mouseModes.delete(p)) {
                    console.log(`%c[MOUSE] Disabled mode ${p}. Active modes:`, 'color: orange', [...mouseModes]);
                    LogFrontendDiagnostic(`[MOUSE] Disabled mode ${p}. Active: ${[...mouseModes].join(',')}`);
                }
            }
            return false;
        });

        // Handle data from terminal (user input) - send to PTY
        const dataDisposable = term.onData((data) => {
            WriteTerminal(sessionId, data).catch(console.error);
            // Track this as the active terminal for paste routing (reliable in WKWebView,
            // unlike textarea focus/blur events which are unreliable with native menus)
            window.__activeTerminalSessionId = sessionId;
            // Notify parent that this pane received input (for focus tracking)
            if (onFocus) {
                onFocus();
            }
        });

        // ============================================================
        // SOFT NEWLINE SUPPORT (multiline input without execute)
        // ============================================================
        // Claude Code and other AI tools support Shift+Enter for inserting
        // a newline without executing the command. We send ESC + CR (\x1b\r)
        // which is interpreted as "insert newline" rather than "execute".
        //
        // The user can configure this via Settings:
        // - "shift_enter": Only Shift+Enter triggers soft newline
        // - "alt_enter": Only Alt/Option+Enter triggers soft newline
        // - "both": Both Shift+Enter and Alt+Enter work (default)
        // - "disabled": Disable soft newline (use backslash continuation)
        //
        // Note: Backslash continuation (typing \ at end of line then Enter)
        // is always supported natively by Claude Code - no special handling needed.
        // ============================================================

        // Use ref to allow settings to be updated without recreating handler
        const softNewlineModeRef = { current: 'both' }; // Default to both
        const autoCopyOnSelectRef = { current: false }; // Auto-copy selected text to clipboard

        // Load settings asynchronously and update the refs
        GetTerminalSettings()
            .then(settings => {
                softNewlineModeRef.current = settings?.softNewline || 'both';
                autoCopyOnSelectRef.current = settings?.autoCopyOnSelect || false;
                logger.info('Loaded terminal settings:', {
                    softNewline: softNewlineModeRef.current,
                    autoCopyOnSelect: autoCopyOnSelectRef.current,
                });
            })
            .catch(err => {
                logger.warn('Failed to load terminal settings, using defaults:', err);
            });

        // Listen for settings changes from SettingsModal
        const handleAutoCopySettingChange = (enabled) => {
            autoCopyOnSelectRef.current = enabled;
            logger.info('Auto-copy on select setting changed:', enabled);
        };
        const cancelAutoCopy = EventsOn('settings:autoCopyOnSelect', handleAutoCopySettingChange);

        // ============================================================
        // AUTO-COPY ON SELECT
        // ============================================================
        // When enabled, automatically copy selected text to clipboard
        // Similar to Kitty terminal behavior.
        // ============================================================
        const selectionDisposable = term.onSelectionChange(() => {
            if (!autoCopyOnSelectRef.current) {
                return;
            }

            const selection = term.getSelection();
            if (selection && selection.length > 0) {
                // Use Wails clipboard API for better WKWebView compatibility
                ClipboardSetText(selection).catch(err => {
                    logger.warn('Failed to auto-copy selection:', err);
                });
            }
        });

        // Create Mac key bindings handler
        const handleMacKeyBinding = createMacKeyBindingHandler(WriteTerminal, sessionId);

        const customKeyHandler = term.attachCustomKeyEventHandler((e) => {
            // Only handle keydown events (not keyup)
            if (e.type !== 'keydown') {
                return true; // Let xterm handle it
            }

            // Let app-level shortcuts pass through to the document handler
            // These include pane management (Cmd+D, Cmd+Shift+Z, etc.)
            // Use shouldInterceptShortcut for consistency with App.jsx's appMod check
            if (shouldInterceptShortcut(e, true) && (e.shiftKey || e.altKey)) {
                // App shortcuts with Shift or Alt modifiers should not be consumed by xterm
                // Examples: Cmd+Shift+Z (zoom), Cmd+Alt+Arrow (navigate panes)
                return true; // Let event propagate to App's document handler
            }

            // Copy/Paste are handled via native menu callbacks (menu:copy, menu:paste events)
            // which bypass WKWebView keyboard event limitations. The handlers below are
            // fallbacks for when keyboard events do reach JavaScript (e.g., in browser dev mode).

            // Copy: Cmd+C on macOS, Ctrl+C on Windows/Linux (with selection only)
            const isCopy = e.key.toLowerCase() === 'c' && !e.shiftKey && !e.altKey &&
                (isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey));
            if (isCopy) {
                const selection = term.getSelection();
                if (selection && selection.length > 0) {
                    e.preventDefault();
                    ClipboardSetText(selection).catch(err => {
                        logger.warn('Failed to copy selection:', err);
                    });
                    return false;
                }
                // No selection: on Windows/Linux let Ctrl+C send SIGINT, on macOS no-op
                return !isMac;
            }

            // Remote Image Paste: Ctrl+V on macOS for SSH sessions
            // This checks clipboard for images and transfers them to the remote host
            // Distinct from Cmd+V (standard text paste)
            if (isMac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey) {
                if (session?.isRemote && session?.remoteHost) {
                    e.preventDefault();
                    HandleRemoteImagePaste(sessionId, session.remoteHost)
                        .then(result => {
                            if (result.noImage) {
                                // No image in clipboard, send normal Ctrl+V character (^V)
                                logger.debug('No image in clipboard, sending Ctrl+V character');
                                WriteTerminal(sessionId, '\x16').catch(console.error);
                            } else if (result.success) {
                                // Inject bracketed paste with image path
                                logger.info('Image pasted to remote:', result.remotePath, `(${result.byteCount} bytes)`);
                                WriteTerminal(sessionId, result.injectText).catch(console.error);
                            } else {
                                logger.error('Remote image paste failed:', result.error);
                                // Toast notification is emitted by the Go backend
                            }
                        })
                        .catch(err => {
                            logger.error('HandleRemoteImagePaste error:', err);
                        });
                    return false;
                }
            }

            // Paste: Cmd+V on macOS, Ctrl+V on Windows/Linux
            const isPaste = e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey &&
                (isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey));
            if (isPaste) {
                return false; // Let browser/menu handle paste
            }

            // Check for macOS navigation shortcuts first (Option+Arrow, Cmd+Arrow)
            const macKeyResult = handleMacKeyBinding(e);
            if (!macKeyResult) {
                // Mac key binding handled it, don't process further
                return false;
            }

            // Check if this key combo should trigger soft newline
            if (e.key === 'Enter') {
                const mode = softNewlineModeRef.current;

                // Determine if we should intercept based on current mode
                let shouldIntercept = false;
                if (mode === 'disabled') {
                    shouldIntercept = false;
                } else if (mode === 'shift_enter' && e.shiftKey && !e.altKey) {
                    shouldIntercept = true;
                } else if (mode === 'alt_enter' && e.altKey && !e.shiftKey) {
                    shouldIntercept = true;
                } else if (mode === 'both' && (e.shiftKey || e.altKey)) {
                    shouldIntercept = true;
                }

                if (shouldIntercept) {
                    e.preventDefault();
                    // Send ESC + CR sequence which Claude Code interprets as soft newline
                    WriteTerminal(sessionId, '\x1b\r').catch(console.error);
                    return false; // Prevent xterm from handling Enter
                }
            }

            // Let xterm.js handle all other keys normally
            return true;
        });
        logger.info('Keyboard handlers attached (soft newline + Mac navigation)');

        // ============================================================
        // SCROLL DETECTION & REPAIR SYSTEM
        // ============================================================
        // Problem: User scroll events don't fire in WKWebView
        // Solution: RAF polling to detect viewportY changes
        // ============================================================

        let sessionLoadComplete = false;
        let rafId = null;
        let scrollSettleTimer = null;
        let lastViewportY = -1; // Will be set after load completes
        let lastBaseY = -1;

        // Mark session load as complete - called after initial scrollback is written
        const markSessionLoadComplete = () => {
            sessionLoadComplete = true;
            const viewport = term.buffer.active;
            lastViewportY = viewport.viewportY;
            lastBaseY = viewport.baseY;

            // Diagnostic: inspect viewport element
            const viewportEl = terminalRef.current?.querySelector('.xterm-viewport');
            if (viewportEl) {
                const style = window.getComputedStyle(viewportEl);
                console.log(`%c[DIAG] .xterm-viewport: scrollTop=${viewportEl.scrollTop} scrollHeight=${viewportEl.scrollHeight} clientHeight=${viewportEl.clientHeight}`, 'color: magenta');
                console.log(`%c[DIAG] overflow: ${style.overflow} overflowY: ${style.overflowY}`, 'color: magenta');
                LogFrontendDiagnostic(`[DIAG] viewport: scrollTop=${viewportEl.scrollTop} scrollHeight=${viewportEl.scrollHeight} clientHeight=${viewportEl.clientHeight} overflow=${style.overflowY}`);

                // Try adding a pointerdown listener to see if pointer events work
                viewportEl.addEventListener('pointerdown', () => {
                    console.log('%c[EVENT] pointerdown on viewport!', 'color: red; font-weight: bold');
                    LogFrontendDiagnostic('[EVENT] pointerdown on viewport');
                });
            }

            console.log('%c========== SESSION LOAD COMPLETE ==========', 'color: lime; font-weight: bold; font-size: 14px');
            console.log(`%c[LOAD-DONE] viewportY=${lastViewportY} baseY=${lastBaseY} length=${viewport.length}`, 'color: lime');
            LogFrontendDiagnostic(`========== SESSION LOAD COMPLETE: viewportY=${lastViewportY} baseY=${lastBaseY} ==========`);
        };

        // Expose for calling after scrollback load
        term._markSessionLoadComplete = markSessionLoadComplete;

        const handleScrollFix = (source) => {
            const viewport = term.buffer.active;
            const isAtBottom = viewport.baseY + term.rows >= viewport.length;
            isAtBottomRef.current = isAtBottom;
            setShowScrollIndicator(!isAtBottom);
        };

        // Try multiple scroll detection methods for xterm.js v6
        // (scrollSettleTimer declared above)

        // Method 1: xterm.js onScroll API - triggers scroll indicator update
        const scrollDisposable = term.onScroll(() => {
            if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
            scrollSettleTimer = setTimeout(() => {
                attemptRepaint();
            }, 200);
        });

        // Method 2: Direct DOM scroll listener on viewport
        // In alt-screen mode, intercept scrollbar and send Page Up/Down to app
        const viewportEl = terminalRef.current?.querySelector('.xterm-viewport');
        let lastScrollTop = 0;
        let scrollbarThrottleTime = 0;
        const SCROLLBAR_THROTTLE_MS = 400;

        const handleDOMScroll = () => {
            if (!viewportEl || !xtermRef.current) return;

            const currentScrollTop = viewportEl.scrollTop;
            const scrollingUp = currentScrollTop < lastScrollTop;
            lastScrollTop = currentScrollTop;

            // In alt-screen mode, intercept scrollbar and send commands to app
            if (isInAltScreen) {
                const now = Date.now();
                if (now - scrollbarThrottleTime < SCROLLBAR_THROTTLE_MS) {
                    // Reset scroll position to prevent visual movement
                    xtermRef.current.scrollToBottom();
                    return;
                }
                scrollbarThrottleTime = now;

                // Send Page Up/Down based on scroll direction
                const pageSeq = scrollingUp ? '\x1b[5~' : '\x1b[6~';
                console.log(`%c[SCROLLBAR] Alt: Page ${scrollingUp ? 'Up' : 'Down'}`, 'color: cyan');
                WriteTerminal(sessionId, pageSeq).catch(console.error);

                // Reset scroll position
                xtermRef.current.scrollToBottom();
                return;
            }
        };
        if (viewportEl) {
            viewportEl.addEventListener('scroll', handleDOMScroll, { passive: true });
            console.log('%c[INIT] DOM scroll listener attached', 'color: green');
        }

        const attemptRepaint = () => {
            if (!xtermRef.current) return;

            const term = xtermRef.current;

            // Update scroll indicator state
            handleScrollFix('scroll-settle');

            // Standard xterm.js refresh - keep display in sync
            term.refresh(0, term.rows - 1);
        };

        // ============================================================
        // WHEEL EVENT HANDLER FOR ALTERNATE BUFFER APPS
        // ============================================================
        // Since we use polling mode (tmux capture-pane), mouse mode escape
        // sequences from apps go to tmux, not xterm.js. We can't track them.
        //
        // Strategy:
        // - Alt buffer (nano, micro, vim, less): Send throttled Page Up/Down
        // - Normal buffer (shell): Use programmatic xterm scroll
        //
        // We throttle alt-buffer scrolling aggressively to prevent rapid page jumps.
        // ============================================================
        let lastAltScrollTime = 0;
        let pendingDirection = null; // 'up' or 'down'
        const ALT_SCROLL_THROTTLE_MS = 400; // One page scroll per 400ms max

        // Use scroll accumulator utility for smooth trackpad scrolling
        const scrollAcc = createScrollAccumulator(scrollSpeed);

        // Gesture reset timer: clears accumulator after momentum ends to prevent
        // "gesture bleed" where leftover pixels from one gesture affect the next
        let wheelResetTimer = null;
        const GESTURE_RESET_MS = 150;

        const handleWheel = (e) => {
            // Always prevent default to stop browser from scrolling the viewport
            e.preventDefault();
            e.stopPropagation();

            if (!xtermRef.current) return;

            const term = xtermRef.current;
            const now = Date.now();

            // Alt buffer (nano, micro, vim, less, htop, etc.)
            if (isInAltScreen) {
                const scrollUp = e.deltaY < 0;
                pendingDirection = scrollUp ? 'up' : 'down';

                // Strict throttle: only send if enough time has passed
                if (now - lastAltScrollTime < ALT_SCROLL_THROTTLE_MS) {
                    return; // Swallow event, direction is saved
                }

                lastAltScrollTime = now;

                // Page Up = \x1b[5~, Page Down = \x1b[6~
                const pageSeq = pendingDirection === 'up' ? '\x1b[5~' : '\x1b[6~';
                pendingDirection = null;

                console.log(`%c[WHEEL] Alt: Page ${scrollUp ? 'Up' : 'Down'} (throttled)`, 'color: lime');
                WriteTerminal(sessionId, pageSeq).catch(console.error);
                return;
            }

            // Normal buffer (shell) - use scroll accumulator for smooth trackpad scrolling
            // Normalize deltaY to pixels based on deltaMode (handles pixel, line, and page modes)
            const deltaPixels = normalizeDeltaToPixels(e.deltaY, e.deltaMode);

            // Accumulator uses modulo to discard excess (prevents "scroll debt"),
            // clamping prevents massive jumps. macOS provides momentum via the
            // event stream itself - we don't simulate it.
            const linesToScroll = scrollAcc.accumulate(deltaPixels);
            if (linesToScroll !== 0) {
                term.scrollLines(linesToScroll);
            }

            // Reset accumulator after gesture ends to prevent "gesture bleed"
            // where leftover sub-line pixels affect the next scroll gesture
            clearTimeout(wheelResetTimer);
            wheelResetTimer = setTimeout(() => scrollAcc.reset(), GESTURE_RESET_MS);
        };


        // Use capture phase and NOT passive (so we can preventDefault)
        terminalRef.current?.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        console.log('%c[INIT] Wheel interception enabled - using programmatic scrollLines()', 'color: lime; font-weight: bold');
        LogFrontendDiagnostic('[INIT] Wheel interception enabled');

        console.log('%c[INIT] All scroll detection methods initialized', 'color: green; font-weight: bold');
        LogFrontendDiagnostic('[INIT] Scroll detection initialized');

        // Listen for debug messages from backend
        // Filter by sessionId for multi-pane support
        const handleDebug = (payload) => {
            // Filter: only process events for this terminal's session
            if (payload?.sessionId !== sessionId) return;
            logger.debug('[Backend]', payload.data);
        };
        const cancelDebug = EventsOn('terminal:debug', handleDebug);

        // ============================================================
        // MENU CLIPBOARD EVENTS (from Go menu callbacks)
        // ============================================================
        // These events are emitted by the Go menu callbacks when the user
        // triggers Cmd+V (paste) or Cmd+C (copy) via the native menu.
        // This bypasses WKWebView keyboard event issues.
        // ============================================================

        // Track active terminal on focus (click into pane) for multi-pane paste routing.
        // Uses window.__activeTerminalSessionId (also set by onData above) instead of
        // isFocusedRef, because WKWebView textarea focus/blur events are unreliable
        // when macOS native menu accelerators fire.
        const handleTermFocus = () => { window.__activeTerminalSessionId = sessionId; };
        if (term.textarea) {
            term.textarea.addEventListener('focus', handleTermFocus);
        }

        // Handle paste from menu (Cmd+V triggers Go callback which emits this)
        const handleMenuPaste = (text) => {
            if (!xtermRef.current) return;
            // Multi-pane filter: only paste in the last-active terminal.
            // If no terminal has been active yet, allow paste (single-pane graceful fallback).
            const activeId = window.__activeTerminalSessionId;
            if (activeId && activeId !== sessionId) return;
            if (text && text.length > 0) {
                // Dedup: skip if identical text pasted within 100ms (defense-in-depth)
                const now = Date.now();
                if (text === lastPasteRef.current.text && now - lastPasteRef.current.time < 100) {
                    return;
                }
                lastPasteRef.current = { text, time: now };

                WriteTerminal(sessionId, text).catch(err => {
                    logger.error('Failed to write paste to terminal:', err);
                });
            }
        };
        const cancelPaste = EventsOn('menu:paste', handleMenuPaste);

        // Handle copy from menu (Cmd+C triggers Go callback which emits this)
        const handleMenuCopy = () => {
            if (!xtermRef.current) return;
            const selection = xtermRef.current.getSelection();
            if (selection && selection.length > 0) {
                ClipboardSetText(selection).catch(err => {
                    logger.error('Failed to copy selection:', err);
                });
            }
        };
        const cancelCopy = EventsOn('menu:copy', handleMenuCopy);

        // Handle pre-loaded history (initial scrollback from tmux)
        // In polling mode, this contains the full scrollback captured before polling starts
        // Filter by sessionId for multi-pane support
        const handleTerminalHistory = (payload) => {
            // Filter: only process events for this terminal's session
            if (payload?.sessionId !== sessionId) return;

            const history = payload.data;
            logger.info('Received initial history:', history?.length || 0, 'bytes');
            if (xtermRef.current && history) {
                // Write initial scrollback to xterm
                xtermRef.current.write(history);
                xtermRef.current.scrollToBottom();

                // Mark session load complete for scroll tracking
                setTimeout(() => {
                    if (xtermRef.current?._markSessionLoadComplete) {
                        xtermRef.current._markSessionLoadComplete();
                    }
                }, 100);
            }
        };
        const cancelHistory = EventsOn('terminal:history', handleTerminalHistory);

        // Listen for data from backend (polling mode - history gaps and viewport diffs)
        // In polling mode, this receives:
        // 1. History gap lines (content that scrolled off viewport)
        // 2. Viewport diff updates (efficient in-place updates)
        // Filter by sessionId for multi-pane support
        //
        // RAF BATCHING: Instead of writing immediately (which can overwhelm xterm.js
        // during fast output like `seq 1 10000`), we buffer data and flush on the
        // next animation frame. This reduces DOM pressure and helps prevent data loss.
        const handleTerminalData = (payload) => {
            // Filter: only process events for this terminal's session
            if (payload?.sessionId !== sessionId) return;

            if (xtermRef.current && payload.data) {
                // Buffer the data
                writeBufferRef.current += payload.data;
                frontendStatsRef.current.eventsReceived++;
                frontendStatsRef.current.bytesReceived += payload.data.length;

                // Schedule RAF flush if not already scheduled
                if (rafWriteIdRef.current === null) {
                    rafWriteIdRef.current = requestAnimationFrame(() => {
                        if (xtermRef.current && writeBufferRef.current.length > 0) {
                            const data = writeBufferRef.current;
                            writeBufferRef.current = '';
                            xtermRef.current.write(data);
                            frontendStatsRef.current.rafFlushes++;
                            frontendStatsRef.current.bytesWritten += data.length;
                        }
                        rafWriteIdRef.current = null;
                    });
                }
            }
        };
        const cancelData = EventsOn('terminal:data', handleTerminalData);

        // Listen for terminal exit
        // Filter by sessionId for multi-pane support
        const handleTerminalExit = (payload) => {
            // Filter: only process events for this terminal's session
            if (payload?.sessionId !== sessionId) return;

            if (xtermRef.current) {
                xtermRef.current.write(`\r\n\x1b[31m[Terminal exited: ${payload.data}]\x1b[0m\r\n`);
            }
        };
        const cancelExit = EventsOn('terminal:exit', handleTerminalExit);

        // ============================================================
        // CONNECTION STATUS HANDLERS (for remote sessions)
        // ============================================================
        // These events track SSH connection health and display overlays
        // when the connection is lost, reconnecting, or failed.
        // All events include sessionId for multi-pane filtering.
        // ============================================================

        const handleConnectionLost = (data) => {
            if (data?.sessionId !== sessionId) return;  // Multi-pane filter
            logger.warn('[CONNECTION] Lost:', data);
            setConnectionState(CONN_STATE.DISCONNECTED);
            setConnectionInfo({
                hostId: data.hostId,
                error: data.error,
            });
        };
        const cancelConnLost = EventsOn('terminal:connection-lost', handleConnectionLost);

        const handleReconnecting = (data) => {
            if (data?.sessionId !== sessionId) return;  // Multi-pane filter
            logger.info('[CONNECTION] Reconnecting:', data);
            setConnectionState(CONN_STATE.RECONNECTING);
            setConnectionInfo({
                attempt: data.attempt,
                maxAttempts: data.maxAttempts,
            });
        };
        const cancelReconnecting = EventsOn('terminal:reconnecting', handleReconnecting);

        const handleConnectionRestored = (data) => {
            if (data?.sessionId !== sessionId) return;  // Multi-pane filter
            logger.info('[CONNECTION] Restored');
            setConnectionState(CONN_STATE.CONNECTED);
            setConnectionInfo(null);
        };
        const cancelConnRestored = EventsOn('terminal:connection-restored', handleConnectionRestored);

        const handleConnectionFailed = (data) => {
            if (data?.sessionId !== sessionId) return;  // Multi-pane filter
            logger.error('[CONNECTION] Failed:', data);
            setConnectionState(CONN_STATE.FAILED);
            setConnectionInfo({
                hostId: data.hostId,
            });
        };
        const cancelConnFailed = EventsOn('terminal:connection-failed', handleConnectionFailed);

        // ============================================================
        // FILE DROP HANDLER (drag-and-drop image support)
        // ============================================================
        // Wails emits 'files:dropped' with {x, y, paths} when files are
        // dropped onto the window. We use elementFromPoint with Retina
        // coordinate normalization to determine if this terminal pane
        // is the drop target, then call the Go backend to process images.
        // ============================================================
        const handleFileDrop = (data) => {
            if (!data || !data.paths || data.paths.length === 0) return;

            // Retina/HiDPI coordinate normalization:
            // Wails reports physical pixels; DOM uses logical (CSS) pixels
            const dpr = window.devicePixelRatio || 1;
            const logicalX = data.x / dpr;
            const logicalY = data.y / dpr;

            // Use elementFromPoint for robust pane detection (handles z-index, overlays)
            const targetEl = document.elementFromPoint(logicalX, logicalY);
            const isMyTerminal = targetEl && terminalRef.current?.contains(targetEl);
            if (!isMyTerminal) return;

            logger.info('[FILE-DROP] Files dropped on this pane:', data.paths.length, 'file(s)');

            HandleFileDrop(sessionId, session?.remoteHost || '', data.paths)
                .then(result => {
                    if (result.success) {
                        logger.info('[FILE-DROP] Injecting', result.injectText?.length || 0, 'chars');
                        WriteTerminal(sessionId, result.injectText).catch(console.error);
                    } else if (result.error) {
                        logger.error('[FILE-DROP] Failed:', result.error);
                    }
                })
                .catch(err => {
                    logger.error('[FILE-DROP] HandleFileDrop error:', err);
                });
        };
        const cancelFileDrop = EventsOn('files:dropped', handleFileDrop);

        // Track last sent dimensions to avoid duplicate calls
        let lastCols = term.cols;
        let lastRows = term.rows;

        // Debounced scrollback refresh - fixes xterm.js reflow issues with box-drawing chars
        // Only triggers after resize settles (no resize events for 400ms)
        // Clears xterm and requests fresh history from backend to restore all content
        let scrollbackRefreshTimer = null;
        const refreshScrollbackAfterResize = async () => {
            if (!session?.tmuxSession || !xtermRef.current) {
                logger.debug('[RESIZE-REFRESH] Skipped - no session or xterm');
                return;
            }

            try {
                logger.info('[RESIZE-REFRESH] Clearing xterm and requesting fresh content...');
                // Clear xterm to prepare for fresh content
                xtermRef.current.clear();

                // Request backend to re-emit full history via terminal:history event
                // This ensures scrollback is properly restored after resize
                await RefreshTerminalAfterResize(sessionId);
                logger.info('[RESIZE-REFRESH] Done - history refresh requested');
            } catch (err) {
                logger.error('[RESIZE-REFRESH] Failed:', err);
            }
        };

        // RAF-throttled resize handler - fires at most once per frame
        const handleResize = rafThrottle(() => {
            if (fitAddonRef.current && xtermRef.current) {
                try {
                    // Fit terminal to container
                    fitAddonRef.current.fit();

                    const { cols, rows } = xtermRef.current;

                    // Only send resize if dimensions actually changed
                    if (cols !== lastCols || rows !== lastRows) {
                        lastCols = cols;
                        lastRows = rows;

                        // Send resize to PTY (handles tmux resize internally)
                        ResizeTerminal(sessionId, cols, rows)
                            .then(() => {
                                // After resize, refresh terminal display
                                // This helps clear artifacts from stale content
                                if (xtermRef.current) {
                                    xtermRef.current.refresh(0, rows - 1);
                                }
                            })
                            .catch(console.error);

                        // Schedule debounced scrollback refresh (fixes box-drawing char reflow)
                        if (scrollbackRefreshTimer) {
                            clearTimeout(scrollbackRefreshTimer);
                        }
                        scrollbackRefreshTimer = setTimeout(refreshScrollbackAfterResize, 400);
                    }
                } catch (e) {
                    console.error('Resize error:', e);
                }
            }
        });

        // Handle window resize with ResizeObserver
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(terminalRef.current);

        // Start the terminal
        const { cols, rows } = term;

        const startTerminal = async () => {
            try {
                if (session && session.tmuxSession) {
                    if (session.isRemote && session.remoteHost) {
                        // Remote session - use SSH polling
                        logger.info('Connecting to remote tmux session (SSH polling mode):',
                            session.remoteHost, session.tmuxSession, 'sessionId:', sessionId);
                        // Backend handles:
                        // 1. SSH connection to remote host (auto-restarts session if needed)
                        // 2. History fetch + emit via terminal:history event
                        // 3. Polling loop for display updates via SSH
                        await StartRemoteTmuxSession(sessionId, session.remoteHost, session.tmuxSession, session.projectPath || '', session.tool || 'shell', cols, rows);
                        logger.info('Remote polling session started');
                        console.log('%c[LOAD] Remote SSH polling session started', 'color: cyan; font-weight: bold');
                        LogFrontendDiagnostic('[LOAD] Remote SSH polling session started');
                    } else {
                        // Local session - use local polling
                        logger.info('Connecting to tmux session (polling mode):', session.tmuxSession, 'sessionId:', sessionId);
                        // Backend handles:
                        // 1. History fetch + emit via terminal:history event
                        // 2. PTY attach for user input
                        // 3. Polling loop for display updates
                        await StartTmuxSession(sessionId, session.tmuxSession, cols, rows);
                        logger.info('Polling session started');
                        console.log('%c[LOAD] Polling session started', 'color: cyan; font-weight: bold');
                        LogFrontendDiagnostic('[LOAD] Polling session started');
                    }
                } else {
                    logger.info('Starting new terminal, sessionId:', sessionId);
                    await StartTerminal(sessionId, cols, rows);
                    logger.info('Terminal started');
                }
            } catch (err) {
                logger.error('Failed to start terminal:', err);
                term.write(`\x1b[31mFailed to start terminal: ${err}\x1b[0m\r\n`);
            }
        };

        startTerminal();

        // Focus terminal
        term.focus();

        return () => {
            logger.info('Cleaning up terminal, sessionId:', sessionId);

            // Cancel all Wails event listeners for this component instance.
            // Uses per-listener cancel functions (NOT EventsOff which is global).
            cancelAltScreen();
            cancelAutoCopy();
            cancelDebug();
            cancelPaste();
            cancelCopy();
            cancelHistory();
            cancelData();
            cancelExit();
            cancelConnLost();
            cancelReconnecting();
            cancelConnRestored();
            cancelConnFailed();

            // Flush any pending RAF buffer data before cleanup to prevent data loss
            if (rafWriteIdRef.current !== null) {
                cancelAnimationFrame(rafWriteIdRef.current);
                rafWriteIdRef.current = null;
            }
            // Write any remaining buffered data synchronously before dispose
            if (xtermRef.current && writeBufferRef.current.length > 0) {
                xtermRef.current.write(writeBufferRef.current);
                writeBufferRef.current = '';
            }

            // Close the PTY backend for this session
            CloseTerminal(sessionId).catch((err) => {
                logger.error('Failed to close terminal:', err);
            });

            if (cancelFileDrop) cancelFileDrop();
            if (scrollbackRefreshTimer) {
                clearTimeout(scrollbackRefreshTimer);
            }
            resizeObserver.disconnect();
            scrollDisposable.dispose();
            dataDisposable.dispose();
            selectionDisposable.dispose();
            if (term.textarea) {
                term.textarea.removeEventListener('focus', handleTermFocus);
            }
            if (customKeyHandler) customKeyHandler.dispose();
            // Clean up mouse mode parser handlers
            if (enableHandler) enableHandler.dispose();
            if (disableHandler) disableHandler.dispose();
            // Clean up scroll event listeners
            if (viewportEl) viewportEl.removeEventListener('scroll', handleDOMScroll);
            if (terminalRef.current) {
                terminalRef.current.removeEventListener('wheel', handleWheel);
            }
            if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
            if (wheelResetTimer) clearTimeout(wheelResetTimer);
            term.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
            searchAddonRef.current = null;
            initRef.current = false;
        };
    }, [searchRef, session, paneId, onFocus, fontSize, scrollSpeed]); // Note: theme/fontSize changes handled by separate useEffects

    // Scroll to bottom when indicator is clicked
    const handleScrollToBottom = () => {
        if (xtermRef.current) {
            xtermRef.current.scrollToBottom();
            isAtBottomRef.current = true;
            setShowScrollIndicator(false);
        }
    };

    // Render connection status overlay for remote sessions
    const renderConnectionStatus = () => {
        // Only show for remote sessions with non-connected state
        if (!session?.isRemote) return null;
        if (connectionState === CONN_STATE.CONNECTED) return null;

        let statusClass = '';
        let statusIcon = '';
        let statusText = '';

        switch (connectionState) {
            case CONN_STATE.DISCONNECTED:
                statusClass = 'disconnected';
                statusIcon = '⚠';
                statusText = 'Connection Lost';
                break;
            case CONN_STATE.RECONNECTING:
                statusClass = 'reconnecting';
                statusIcon = '↻';
                statusText = connectionInfo
                    ? `Reconnecting (${connectionInfo.attempt}/${connectionInfo.maxAttempts})...`
                    : 'Reconnecting...';
                break;
            case CONN_STATE.FAILED:
                statusClass = 'failed';
                statusIcon = '✕';
                statusText = 'Connection Failed';
                break;
            default:
                return null;
        }

        return (
            <div className={`connection-status ${statusClass}`}>
                <span className="connection-status-icon">{statusIcon}</span>
                <span className="connection-status-text">{statusText}</span>
            </div>
        );
    };

    // Debug overlay keyboard toggle (Cmd+Shift+D)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                setShowDebugOverlay(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Render the pipeline debug overlay
    const renderDebugOverlay = () => {
        if (!showDebugOverlay) return null;

        const stats = frontendStatsRef.current;
        const batchRatio = stats.rafFlushes > 0
            ? (stats.eventsReceived / stats.rafFlushes).toFixed(1)
            : '0';

        return (
            <div className="pipeline-debug-overlay">
                <div className="debug-header">Pipeline Stats (Cmd+Shift+D to close)</div>
                <div className="debug-row">
                    <span>Events Received:</span>
                    <span>{stats.eventsReceived}</span>
                </div>
                <div className="debug-row">
                    <span>Bytes Received:</span>
                    <span>{stats.bytesReceived}</span>
                </div>
                <div className="debug-row">
                    <span>RAF Flushes:</span>
                    <span>{stats.rafFlushes}</span>
                </div>
                <div className="debug-row">
                    <span>Batch Ratio:</span>
                    <span>{batchRatio}x</span>
                </div>
                <div className="debug-row">
                    <span>Bytes Written:</span>
                    <span>{stats.bytesWritten}</span>
                </div>
                <button
                    className="debug-reset-btn"
                    onClick={() => {
                        frontendStatsRef.current = {
                            eventsReceived: 0,
                            bytesReceived: 0,
                            rafFlushes: 0,
                            bytesWritten: 0,
                        };
                        // Force re-render by incrementing key
                        setDebugRefreshKey(k => k + 1);
                    }}
                >
                    Reset Stats
                </button>
            </div>
        );
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', '--wails-drop-target': 'drop' }} className={isAltScreen ? 'terminal-alt-screen' : ''}>
            <div
                ref={terminalRef}
                data-testid="terminal"
                style={{
                    width: '100%',
                    height: '100%',
                }}
            />
            {showScrollIndicator && (
                <button
                    className="scroll-indicator"
                    onClick={handleScrollToBottom}
                    title="Scroll to bottom"
                >
                    New output ↓
                </button>
            )}
            {renderConnectionStatus()}
            {renderDebugOverlay()}
        </div>
    );
}
