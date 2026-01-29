/**
 * App Smoke Test
 *
 * This test renders the App component to catch runtime initialization errors
 * that aren't caught by build/lint tools:
 * - Temporal dead zone errors (using variables before declaration)
 * - Hook ordering violations
 * - Missing imports
 * - Context provider issues
 *
 * The test doesn't verify specific behavior - it just ensures the app
 * can mount without crashing. This is valuable because:
 * 1. `npm run build` only checks syntax, not runtime behavior
 * 2. ESLint's react-hooks/recommended doesn't catch TDZ issues
 * 3. These errors only manifest when the component actually renders
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// ── Mock Wails runtime ─────────────────────────────────────────────
vi.mock('../../wailsjs/runtime/runtime', () => ({
    EventsOn: vi.fn(() => vi.fn()),
    EventsOff: vi.fn(),
    EventsEmit: vi.fn(),
    WindowSetTitle: vi.fn(),
    BrowserOpenURL: vi.fn(),
    ClipboardGetText: vi.fn(() => Promise.resolve('')),
}));

// ── Mock Wails Go bindings ─────────────────────────────────────────
vi.mock('../../wailsjs/go/main/App', () => ({
    ListSessions: vi.fn(() => Promise.resolve([])),
    DiscoverProjects: vi.fn(() => Promise.resolve([])),
    CreateSession: vi.fn(() => Promise.resolve({})),
    CreateRemoteSession: vi.fn(() => Promise.resolve({})),
    RecordProjectUsage: vi.fn(() => Promise.resolve()),
    GetQuickLaunchFavorites: vi.fn(() => Promise.resolve([])),
    AddQuickLaunchFavorite: vi.fn(() => Promise.resolve()),
    GetQuickLaunchBarVisibility: vi.fn(() => Promise.resolve(true)),
    SetQuickLaunchBarVisibility: vi.fn(() => Promise.resolve()),
    GetGitBranch: vi.fn(() => Promise.resolve('')),
    IsGitWorktree: vi.fn(() => Promise.resolve(false)),
    GetSessionMetadata: vi.fn(() => Promise.resolve({})),
    MarkSessionAccessed: vi.fn(() => Promise.resolve()),
    GetDefaultLaunchConfig: vi.fn(() => Promise.resolve(null)),
    UpdateSessionCustomLabel: vi.fn(() => Promise.resolve()),
    GetFontSize: vi.fn(() => Promise.resolve(14)),
    SetFontSize: vi.fn(() => Promise.resolve()),
    GetScrollSpeed: vi.fn(() => Promise.resolve(1)),
    GetSavedLayouts: vi.fn(() => Promise.resolve([])),
    SaveLayout: vi.fn(() => Promise.resolve()),
    DeleteSavedLayout: vi.fn(() => Promise.resolve()),
    StartRemoteTmuxSession: vi.fn(() => Promise.resolve({})),
    BrowseLocalDirectory: vi.fn(() => Promise.resolve('')),
    GetSSHHostDisplayNames: vi.fn(() => Promise.resolve({})),
    DeleteSession: vi.fn(() => Promise.resolve()),
    OpenNewWindow: vi.fn(() => Promise.resolve()),
    GetOpenTabState: vi.fn(() => Promise.resolve(null)),
    SaveOpenTabState: vi.fn(() => Promise.resolve()),
    HasScanPaths: vi.fn(() => Promise.resolve(true)),
    GetSetupDismissed: vi.fn(() => Promise.resolve(true)),
    GetShowActivityRibbon: vi.fn(() => Promise.resolve(true)),
    RefreshSessionStatuses: vi.fn(() => Promise.resolve([])),
}));

// ── Mock logger ────────────────────────────────────────────────────
vi.mock('../logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// ── Mock context providers ─────────────────────────────────────────
vi.mock('../context/ThemeContext', () => ({
    useTheme: () => ({
        theme: 'dark',
        toggleTheme: vi.fn(),
    }),
    ThemeProvider: ({ children }) => children,
}));

// ── Mock Tooltip hook ──────────────────────────────────────────────
vi.mock('../Tooltip', () => ({
    useTooltip: () => ({
        tooltip: null,
        showTooltip: vi.fn(),
        hideTooltip: vi.fn(),
        TooltipComponent: () => null,
        show: vi.fn(),
        hide: vi.fn(),
        Tooltip: () => null,
    }),
}));

// ── Mock child components ──────────────────────────────────────────
// Mock all child components to isolate App.jsx's hook ordering
vi.mock('../Search', () => ({ default: () => null }));
vi.mock('../SessionSelector', () => ({ default: () => null }));
vi.mock('../CommandMenu', () => ({ default: () => null }));
vi.mock('../ToolPicker', () => ({ default: () => null }));
vi.mock('../SessionPicker', () => ({ default: () => null }));
vi.mock('../ConfigPicker', () => ({ default: () => null }));
vi.mock('../SettingsModal', () => ({ default: () => null }));
vi.mock('../ScanPathSetupModal', () => ({ default: () => null }));
vi.mock('../UnifiedTopBar', () => ({ default: () => null }));
vi.mock('../ShortcutBar', () => ({ default: () => null }));
vi.mock('../KeyboardHelpModal', () => ({ default: () => null }));
vi.mock('../RenameDialog', () => ({ default: () => null }));
vi.mock('../PaneLayout', () => ({ default: () => null }));
vi.mock('../FocusModeOverlay', () => ({ default: () => null }));
vi.mock('../MoveModeOverlay', () => ({ default: () => null }));
vi.mock('../SaveLayoutModal', () => ({ default: () => null }));
vi.mock('../HostPicker', () => ({ default: () => null, LOCAL_HOST_ID: 'local' }));
vi.mock('../DeleteSessionDialog', () => ({ default: () => null }));
vi.mock('../Toast', () => ({ default: () => null }));
vi.mock('../ToolIcon', () => ({ default: () => null, BranchIcon: () => null }));

// Import App after mocks are set up
import App from '../App';

describe('App smoke test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders without crashing', async () => {
        // This test catches runtime initialization errors like:
        // - "Cannot access 'X' before initialization" (TDZ errors)
        // - Hook ordering violations
        // - Missing context providers

        // Should not throw
        expect(() => {
            render(<App />);
        }).not.toThrow();
    });

    it('mounts hooks in correct order', async () => {
        // Render and verify the component mounted successfully
        // If hooks are called in wrong order (e.g., useInputPaste before useState),
        // this will throw a runtime error
        const { container } = render(<App />);

        // App should have rendered something
        expect(container).toBeTruthy();
        expect(container.innerHTML).not.toBe('');
    });
});
